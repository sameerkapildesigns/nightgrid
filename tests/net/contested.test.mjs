// M8 contested pickups over REAL WebSockets (local runtime, netsim 100 ms RTT +-15 ms jitter per direction,
// clients running ahead of the server by their adaptive input lead). Two scripted humans drive the identical
// symmetric line (grid slots +-4.4 m, same throttle) onto the SAME pads, so both predict the claim:
//   row at Velocity 363 m (B S B): both aim at the centre SHIELD pad; row at 1736 m (S B S): centre BOOST pad.
// Server rule under test: claims are resolved in seat order inside one 120 Hz step, so an exact tie goes to the
// EARLIER SEAT (the host, seat 0, here). That is a deterministic tiebreak, not a random or "fair" one.
// Also exercised by the humans: H0 drives its shield into the 794 m obstacle (shield consumed over the network),
// H1 drives into the 976 m obstacle (bounded penalty). Then H1's socket is killed (auto-reconnect), the race is
// finished, the room goes back to the lobby and a rematch must start with every power and pad cleared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { NetClient } from '../../src/net/client.js';
import { waitFor, summarize } from './scenario.mjs';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// target lateral offset by along-track position (Velocity layout from src/core/hazards.js)
const PLAN = {
  0: s => (s > 700 && s < 820 ? -5.6 : 0),    // H0: shield pad, then its shield into obstacle 794 (d -5.6)
  1: s => (s > 880 && s < 1000 ? 5.6 : 0)     // H1: obstacle 976 (d +5.6), no shield (lost the tie)
};
function lineTo(plan) {
  return pred => {
    const r = pred && pred.me; if (!r) return { up: 0 };
    const M = pred.sim.track.MAIN; let tgt = plan(r.path === M ? r.s : 0);
    for (const dr of pred.sim.drones) { let g = dr.s - r.s; if (g > M.L / 2) g -= M.L; if (g < -M.L / 2) g += M.L; if (g > -6 && g < 45 && Math.abs(dr.d - tgt) < 3.2) tgt = dr.d + (dr.d > 0 ? -5 : 5); }   // pass taxis (scripted drivers otherwise sit behind them)
    const kg = pred.sim.kgAt(r.path, r.s + 10 + r.speed * 0.3);
    const st = Math.max(-1, Math.min(1, (tgt - r.d) * 0.06 + r.psi * 2.5 - 30 * kg));
    return { up: 1, down: 0, right: st > 0 ? st : 0, left: st < 0 ? -st : 0, boost: 0, drift: 0 };
  };
}

test('contested shield + boost pads, shield vs obstacle, reconnect and rematch over real sockets (100 ms RTT, jitter)', { timeout: 420000 }, async () => {
  const srv = await startLocalServer({ port: 0, netsim: true, lagMs: 100, jitterMs: 30, log: false, createPerMin: 1000, room: { countdownMs: 2500, maxRaceMs: 600000 } });
  try {
    const code = (await (await fetch(srv.url + '/api/rooms', { method: 'POST' })).json()).code;
    const cl = [];
    for (let i = 0; i < 2; i++) { const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: () => performance.now(), build: srv.build, name: 'H' + i, onEvent: () => { } }); c.drive = lineTo(PLAN[i]); c.connect(code); cl.push(c); await waitFor(() => c.you, 10000, 'welcome'); }
    const [h0, h1] = cl, rs = srv.rooms.get(code);
    h0.config({ map: 'velocity', mode: 'expert' }); await waitFor(() => h0.room.map === 'velocity' && h0.room.mode === 'expert', 5000, 'config');
    for (const c of cl) c.ready(true); await waitFor(() => h0.room.canStart, 5000, 'canStart'); h0.start();
    await waitFor(() => cl.every(c => c.race && c.race.pred), 15000, 'race');
    const ids = cl.map(c => c.you);
    // ---- telemetry: what each client PREDICTED vs what the server decided ----
    const T = { predClaim: [{}, {}], srvClaim: {}, flipMs: [[], []], padDiffMax: 0, padDiffLate: [], corrWindow: [[], []], leads: [], srvHits: {}, srvShieldUsed: {}, predHits: [0, 0] };
    const prevSrv = new Map(), prevPred = [{}, {}];
    let stop = false, dropT = null;
    const loop = (async () => {
      while (!stop) {
        const now = performance.now();
        for (const [k, c] of cl.entries()) {
          if (!c.race) continue;
          c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.016);
          const me = c.race.pred.me, pp = prevPred[k];
          for (const [f, kind] of [['shieldT', 'S'], ['surgeT', 'B']]) {
            if (me[f] > 0 && !(pp[f] > 0)) T.predClaim[k][kind] = T.predClaim[k][kind] || now;               // prediction took it
            const natural = kind === 'S' ? me.passT > 0 : now - T.predClaim[k][kind] > 1500;   // shield used / surge ran its 1.8 s
            if (!(me[f] > 0) && pp[f] > 0 && T.predClaim[k][kind] && !T.predClaim[k][kind + 'done'] && !natural) { T.flipMs[k].push([kind, Math.round(now - T.predClaim[k][kind])]); T.predClaim[k][kind + 'done'] = 1; }
          }
          if (me.obT > (pp.obT || 0) + 0.2) T.predHits[k]++;
          if (me.lap > 0) { T.predClaim[k].Sdone = T.predClaim[k].Bdone = 1; }
          prevPred[k] = { shieldT: me.shieldT, surgeT: me.surgeT, obT: me.obT };
          const st = c.race.pred.stats.corrections; if (st.length) T.corrWindow[k].push(st[st.length - 1]);
          if (rs.sim) { // pad convergence: absolute readyAt agrees with the server's once the snapshot has landed
            const tS = rs.sim.time, eff = x => (x > tS ? x : 0);   // a pad that is ready on the server: any past readyAt is 'ready'
            const d = Math.max(...rs.sim.pads.map((p, j) => Math.abs(eff(c.race.pred.sim.pads[j].readyAt || 0) - eff(p.readyAt || 0))));
            T.padDiffMax = Math.max(T.padDiffMax, d); if (T.lateCheck) T.padDiffLate.push(d);
          }
          T.leads.push(c.lead);
        }
        if (rs.sim) for (const r of rs.sim.racers) {
          const p = prevSrv.get(r.id) || {};
          const L1 = r.lap === 0 ? '' : 'L2';   // contested decisions are asserted on lap 1 only
          if (r.shieldT > 0 && !(p.shieldT > 0)) T.srvClaim[L1 + 'S:' + r.id] = (T.srvClaim[L1 + 'S:' + r.id] || 0) + 1;
          if (r.surgeT > 0 && !(p.surgeT > 0)) T.srvClaim[L1 + 'B:' + r.id] = (T.srvClaim[L1 + 'B:' + r.id] || 0) + 1;
          if (r.obT > (p.obT || 0) + 0.2) T.srvHits[r.id] = (T.srvHits[r.id] || 0) + 1;
          if (r.passT > (p.passT || 0) + 0.1) T.srvShieldUsed[r.id] = (T.srvShieldUsed[r.id] || 0) + 1;
          prevSrv.set(r.id, { shieldT: r.shieldT, surgeT: r.surgeT, obT: r.obT, passT: r.passT });
        }
        if (dropT == null && rs.sim && rs.sim.racers.find(r => r.id === ids[1]).s > 2100) { dropT = now; h1.ws.terminate(); }   // after the boost row
        await sleep(16);
      }
    })();
    await waitFor(() => dropT != null, 120000, 'past the boost row');
    await sleep(300); await waitFor(() => h1.status === 'open' && h1.ws && h1.ws.readyState === 1 && h1.race, 20000, 'reconnected');
    await sleep(2500); T.lateCheck = true; await sleep(2000);
    // steady state after reconnect: both predictors agree with the server on powers and pads
    const S = rs.sim, sv = id => S.racers.find(r => r.id === id);
    for (const [k, c] of cl.entries()) {
      const me = c.race.pred.me, s = sv(ids[k]);
      assert.equal(me.shieldT > 0, s.shieldT > 0, `H${k} shield flag converged`);
      assert.equal(me.surgeT > 0, s.surgeT > 0, `H${k} surge flag converged`);
    }
    assert.ok(Math.max(...T.padDiffLate) < 0.05, `pads converged after reconnect (max diff ${Math.max(...T.padDiffLate)})`);
    await waitFor(() => cl.every(c => c.results), 300000, 'results');
    stop = true; await loop;
    // ---- the contested decisions ----
    const sClaims = ids.map(id => T.srvClaim['S:' + id] || 0), bClaims = ids.map(id => T.srvClaim['B:' + id] || 0);
    const report = { ids, sClaims, bClaims, predClaimed: T.predClaim.map(p => Object.keys(p).filter(x => x.length === 1)), flipMs: T.flipMs, padDiffMaxDuringRace: +T.padDiffMax.toFixed(3),
      srvHits: T.srvHits, srvShieldUsed: T.srvShieldUsed, predHits: T.predHits, corrM: cl.map((c, k) => summarize(T.corrWindow[k])), hardSnaps: cl.map(c => c.race.pred.stats.hard), lead: summarize(T.leads), results: h0.results.order.map(o => [o.name, o.pos, o.dnf ? 'DNF' : +o.time.toFixed(2)]) };
    console.log('M8-CONTESTED', JSON.stringify(report));
    assert.equal(sClaims[0] + sClaims[1] >= 1, true, 'the shield pad was claimed');
    assert.equal(sClaims[1], 0, 'tie goes to the earlier seat (H0): H1 never got the contested shield');
    assert.ok(T.predClaim[1].S, 'H1 PREDICTED the shield (lead) before the server said no');
    assert.ok(T.flipMs[1].some(([k]) => k === 'S'), 'H1 prediction corrected back (shield removed)');
    assert.equal(bClaims[0] + bClaims[1], 1, 'exactly one racer got the contested boost pad (lap 1)');
    if (T.predClaim[0].B && T.predClaim[1].B) assert.ok(T.flipMs[bClaims[0] ? 1 : 0].some(([k]) => k === 'B'), 'the boost loser\'s prediction was corrected');
    assert.ok((T.srvShieldUsed[ids[0]] || 0) >= 1, 'H0 shield consumed by the obstacle on the server');
    assert.ok((T.srvHits[ids[1]] || 0) >= 1, 'H1 hit the obstacle on the server');
    assert.equal(cl[0].results.order.filter(o => o.dnf).length, 0);
    assert.deepEqual(cl[1].results.order.map(o => o.id), cl[0].results.order.map(o => o.id), 'same results both clients');
    assert.equal(report.hardSnaps.reduce((a, b) => a + b, 0), 0, 'no hard snaps');
    // ---- rematch: powers + pads cleared ----
    h0.toLobby(); await waitFor(() => h0.room.phase === 'lobby', 30000, 'lobby');
    for (const c of cl) c.ready(true); await waitFor(() => h0.room.canStart, 10000, 'canStart2'); h0.start();
    await waitFor(() => cl.every(c => c.race && c.race.pred && c.race.pred.me.s !== undefined) && rs.sim, 15000, 'race2');
    for (const r of rs.sim.racers) assert.ok(!(r.shieldT > 0) && !(r.surgeT > 0) && !(r.powCD > 0) && !(r.obT > 0), 'server powers cleared on rematch');
    assert.ok(rs.sim.pads.every(p => !(p.readyAt > rs.sim.time)), 'server pads all ready on rematch');
    for (const c of cl) { const me = c.race.pred.me; assert.ok(!(me.shieldT > 0) && !(me.surgeT > 0) && !(me.powCD > 0), 'client powers cleared'); assert.ok(c.race.pred.sim.pads.every(p => !(p.readyAt > c.race.pred.sim.time)), 'client pads ready'); }
    for (const c of cl) c.leave();
  } finally { await srv.close(); }
});
