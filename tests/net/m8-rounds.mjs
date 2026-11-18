// M8 headless matrix: 2/3/4/8 mixed racers (humans = shipping NetClient + line driver, plus server bots),
// two full rounds each in the SAME room (round 1 Kage, back to lobby, round 2 Velocity), then a leave.
// Checks: results identical on every client, no human DNF, rematch works, leave frees the seat; hazard
// telemetry read from the authoritative server sim (obstacle hits, pad claims, shields consumed) and
// prediction corrections per client. Real WebSockets over localhost with 60 ms RTT netsim.
// Usage: node tests/net/m8-rounds.mjs [--only 2,3,4,8] > log
import WebSocket from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { NetClient } from '../../src/net/client.js';
import { driver, waitFor, summarize } from './scenario.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const arg = process.argv.indexOf('--only'), only = arg > 0 ? process.argv[arg + 1].split(',').map(Number) : [2, 3, 4, 8];
const MIX = { 2: [2, 0], 3: [2, 1], 4: [3, 1], 8: [4, 4], 20: [10, 10] };
const srv = await startLocalServer({ port: 0, netsim: true, lagMs: 60, jitterMs: 10, log: false, createPerMin: 1000, budget: { maxActiveRooms: 4 }, room: { countdownMs: 2500, maxRaceMs: 600000 } });
const all = [];
let failed = 0;
const check = (ok, name, d = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${d ? '  — ' + d : ''}`); };
for (const n of only) {
  const [H, B] = MIX[n];
  const code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
  const cl = [];
  for (let i = 0; i < H; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'H' + i, onEvent: () => { } }); c.drive = driver(i); c.connect(code); cl.push(c); await waitFor(() => c.you, 10000, 'welcome'); }
  const host = cl[0];
  for (let b = 0; b < B; b++) host.addBot();
  await waitFor(() => host.room && host.room.seats.length === n, 10000, 'seats');
  for (const [round, map] of [[1, 'technical'], [2, 'velocity']]) {
    host.config({ map, mode: 'expert' });
    await waitFor(() => host.room.map === map && host.room.phase === 'lobby', 10000, 'config');
    for (const c of cl) c.ready(true);
    await waitFor(() => host.room.canStart, 10000, 'canStart'); host.start();
    await waitFor(() => cl.every(c => c.race && c.race.pred), 15000, 'race');
    const rs = srv.rooms.get(code);
    const tel = { hits: 0, claims: { S: 0, B: 0 }, shieldsUsed: 0, byBot: { hits: 0, claims: 0 } }, prev = new Map();
    let stop = false;
    const loop = (async () => {
      while (!stop) {
        for (const c of cl) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.016); }
        const sim = rs.sim;
        if (sim) for (const r of sim.racers) {
          const p = prev.get(r.id) || { obT: 0, shieldT: 0, surgeT: 0, passT: 0 };
          if (r.obT > p.obT + 0.2) { tel.hits++; if (r.isAI) tel.byBot.hits++; }
          if (r.shieldT > p.shieldT + 1) { tel.claims.S++; if (r.isAI) tel.byBot.claims++; }
          if (r.surgeT > p.surgeT + 0.5) { tel.claims.B++; if (r.isAI) tel.byBot.claims++; }
          if (r.passT > p.passT + 0.1) tel.shieldsUsed++;
          prev.set(r.id, { obT: r.obT, shieldT: r.shieldT, surgeT: r.surgeT, passT: r.passT });
        }
        await sleep(16);
      }
    })();
    const t0 = performance.now();
    await waitFor(() => cl.every(c => c.results), 480000, 'results');
    stop = true; await loop;
    const orders = cl.map(c => JSON.stringify(c.results.order.map(o => [o.id, o.pos, o.dnf ? 1 : 0, o.time]))), dnf = cl[0].results.order.filter(o => o.kind !== 'bot' && o.dnf).length;
    const corr = cl.flatMap(c => c.race ? c.race.pred.stats.corrections : []), hard = cl.reduce((a, c) => a + (c.race ? c.race.pred.stats.hard : 0), 0);
    const row = { n, humans: H, bots: B, round, map, wallS: Math.round((performance.now() - t0) / 1000), sameResults: orders.every(o => o === orders[0]), humanDNF: dnf, telemetry: tel, corrM: summarize(corr), hardSnaps: hard };
    all.push(row); console.log(JSON.stringify(row));
    check(row.sameResults, `n=${n} r${round} ${map}: results identical on ${H} clients`);
    check(dnf === 0, `n=${n} r${round}: no human DNF`);
    host.toLobby(); await waitFor(() => host.room.phase === 'lobby', 30000, 'lobby');
  }
  const last = cl[cl.length - 1]; last.leave();
  await waitFor(() => host.room.seats.length === n - 1, 15000, 'leave');
  check(host.room.seats.length === n - 1, `n=${n}: leave frees the seat`);
  for (const c of cl) c.leave();
  await sleep(500);
}
console.log('SUMMARY', JSON.stringify({ failed, rows: all.length }));
await srv.close(); process.exit(failed ? 1 : 0);
