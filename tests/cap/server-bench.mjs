// M6 CAPACITY PROTOTYPE bench (local, isolated). Authoritative RoomServer in-process with a manual clock and
// byte-counting fake sockets (no JSON re-parse on the receive side, so tick time = server work only).
// Humans are driven by the scenario line-follower reading their own SERVER state (bench driver, not netcode).
// Each human sends 1 input batch per 50 ms tick (6 frames) + 1 ping/s, like the shipping client.
// Usage: node tests/cap/server-bench.mjs --n 4,8,12,20 [--rooms 2] [--secs 0=full race] [--rematch]
globalThis.NG_PROTO_MAX_SEATS = 20;
const { RoomServer } = await import('../../server/room-server.js');
const { fakeTimers, fakeRandom } = await import('../helpers/fake-timers.mjs');
const { encodeFrame, PROTOCOL } = await import('../../src/net/protocol.js');
const { driver } = await import('../net/scenario.mjs');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const NS = arg('n', '4,8,12,20').split(',').map(Number), ROOMS = +arg('rooms', 1), SECS = +arg('secs', 0), REMATCH = process.argv.includes('--rematch');
const BUILD = 'bench', J = JSON.stringify;
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3); };
function conn() { const c = { bytes: 0, msgs: 0, snapBytes: [], last: {}, send(t) { c.bytes += t.length; c.msgs++; if (t.startsWith('{"t":"s"')) c.snapBytes.push(t.length); else { const m = JSON.parse(t); c.last[m.t] = m; } }, close() { c.closed = true; }, bufferedAmount: () => 0 }; return c; }

function makeRoom(T, n, code) {
  const S = new RoomServer({ code, build: BUILD, timers: T, random: fakeRandom, cfg: { countdownMs: 3000, resultsHoldMs: 600000 } });
  const ps = [];
  for (let i = 0; i < n; i++) { const c = conn(); S.connect(c); S.message(c, J({ t: 'hello', p: PROTOCOL, build: BUILD, name: 'H' + (i + 1) })); ps.push({ c, id: c.last.welcome.id, drive: driver(i), seq: 0, inMsgs: 0 }); }
  for (const p of ps) S.message(p.c, J({ t: 'ready', ready: true }));
  // tick timing: whole tick and the snapshot broadcast inside it
  const snapMs = []; const bs = S.broadcastSnap.bind(S); S.broadcastSnap = now => { const t = performance.now(); bs(now); snapMs.push(performance.now() - t); };
  return { S, ps, snapMs, start() { S.message(ps[0].c, J({ t: 'start' })); } };
}
function feed(R, T) {   // one input batch per human per tick, from its server-side state
  const S = R.S; if (!S.sim || (S.room.phase !== 'race' && S.room.phase !== 'countdown')) return;
  for (const p of R.ps) {
    const me = S.sim.racers.find(r => r.id === p.id), want = S.step + 12, f = [];
    while (p.seq < want && f.length < 24) { f.push(encodeFrame(p.drive({ me, sim: S.sim }))); p.seq++; }
    if (f.length) { S.message(p.c, J({ t: 'in', q: p.seq - f.length, f })); p.inMsgs++; }
    if (S.step % 120 < 6) { S.message(p.c, J({ t: 'ping', c: T.now() })); p.inMsgs++; }
  }
}
async function runSet(n) {
  const T = fakeTimers(); const rooms = Array.from({ length: ROOMS }, (_, k) => makeRoom(T, n, 'BENCH' + k));
  rooms.forEach(R => R.start()); for (const R of rooms) R.ps.forEach(p => p.c.bytes = 0);
  const t0 = T.now(); let windows = []; const cpu0 = process.cpuUsage();
  const done = () => rooms.every(R => R.S.room.phase === 'results') || (SECS && T.now() - t0 > 3000 + SECS * 1000) || T.now() - t0 > 9 * 60e3;
  while (!done()) {
    for (const R of rooms) feed(R, T);
    const w = performance.now(); T.advance(50, () => rooms.forEach(R => R.S.housekeep())); windows.push(performance.now() - w);
  }
  const simS = (T.now() - t0) / 1000, cpu = process.cpuUsage(cpu0);
  const out = { n, rooms: ROOMS, simSeconds: +simS.toFixed(1), phase: rooms.map(R => R.S.room.phase), cpuS: +((cpu.user + cpu.system) / 1e6).toFixed(2) };
  const R = rooms[0], st = R.S.stats, tm = st.tickMs.slice(70);   // skip countdown
  out.tickMs = { p50: pct(tm, .5), p95: pct(tm, .95), max: pct(tm, 1), overruns50ms: st.overruns };
  out.snapBroadcastMs = { p50: pct(R.snapMs.slice(70), .5), p95: pct(R.snapMs.slice(70), .95) };
  out.allRoomsPer50msWindowMs = { p50: pct(windows.slice(70), .5), p95: pct(windows.slice(70), .95), max: pct(windows.slice(70), 1) };
  const sb = R.ps[0].c.snapBytes; out.snapshotBytesPerClient = { p50: pct(sb, .5), max: pct(sb, 1) };
  out.downBytesPerClientPerS = Math.round(R.ps.reduce((a, p) => a + p.c.bytes, 0) / n / simS);
  out.downBytesRoomPerS = Math.round(R.ps.reduce((a, p) => a + p.c.bytes, 0) / simS);
  out.inMsgsPerSRoom = +(R.ps.reduce((a, p) => a + p.inMsgs, 0) / simS).toFixed(1);
  out.outMsgsPerSRoom = +(R.ps.reduce((a, p) => a + p.c.msgs, 0) / simS).toFixed(1);
  out.billedReqPerHourRoom_20to1 = Math.round(out.inMsgsPerSRoom / 20 * 3600);
  if (R.S.results) { out.results = R.S.results.order.map(o => o.dnf ? 'DNF' : o.time).slice(0, 3).concat(['...']); out.humanDNF = R.S.results.order.filter(o => o.dnf).length; out.sameResultsAllClients = R.ps.every(p => J(p.c.last.results && p.c.last.results.order) === J(R.ps[0].c.last.results.order)); }
  if (REMATCH && R.S.room.phase === 'results') {
    R.S.message(R.ps[0].c, J({ t: 'lobby' })); for (const p of R.ps) { p.seq = 0; R.S.message(p.c, J({ t: 'ready', ready: true })); }
    R.start(); const t1 = T.now(); while (T.now() - t1 < 13000) { feed(R, T); T.advance(50, () => R.S.housekeep()); }
    out.rematch = { phase: R.S.room.phase, racing: R.S.sim ? R.S.sim.racers.filter(r => r.prog > 50).length + '/' + n : null };
  }
  return out;
}
for (const n of NS) console.log(JSON.stringify(await runSet(n)));
