// Smoothness / consistency measurement over REAL WebSockets against the local runtime, using the shipping
// netcode AND the page's presentation path (src/client/present.js, mode new). Headless: this measures
// networking + presentation math, not GPU frame rate.
//
// Per client, at a simulated 60 Hz render loop, it records what would be drawn:
//   own car: predicted state + visual correction (as game.js mpFrame)
//   remote cars: presentation sample (baseline: Interpolator.sample at serverNow; new: RemotePresenter)
//   HUD rank: as game.js (baseline: sim.ranks over displayed prog; new: presenter rank)
// The server's true state is recorded every tick, so displayed gaps can be compared to the truth at the
// same simulation step.
//
// usage: node tests/net/smooth.mjs --mode base|new --lag 100 --jitter 30 --bots 2 --secs 40 [--tight] [--out f.json]
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { startLocalServer } from '../../server/local.mjs';
import { NetClient } from '../../src/net/client.js';
import { SIM_DT } from '../../src/core/clock.js';
import { mod } from '../../src/core/math.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const pnow = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(3); };
const sum = a => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? +Math.max(...a).toFixed(3) : null });
async function waitFor(fn, ms, what) { const t = pnow(); while (!fn()) { if (pnow() - t > ms) throw new Error('timeout: ' + what); await sleep(20); } }

// Two humans driving the same line with a slow weave and staggered boost -> they pass each other repeatedly.
// `tight`: both aim at the same lateral line (close side-by-side passes, contact likely).
// `ram` (test-only, reads server truth): driver 1 aims at driver 0's lateral position -> repeated contact.
function driver(seed, tight, target = null) {
  let t = 0;
  return pred => {
    const r = pred && pred.me; t++;
    if (!r) return { up: 0 };
    const kg = pred.sim.kgAt(r.path, r.s + 10 + r.speed * 0.3);
    const wob = tight ? 0.15 * Math.sin(t * 0.004 + seed) : 0.25 * Math.sin(t * 0.013 + seed * 1.7);
    const tgt = target && target() != null ? Math.max(-6, Math.min(6, target())) : wob * 4;
    const st = Math.max(-1, Math.min(1, (target ? (tgt - r.d) * 0.04 : (r.d - tgt) * 0.03) + r.psi * 3 - 30 * kg));
    return { up: 1, down: 0, right: st > 0 ? st : 0, left: st < 0 ? -st : 0, boost: target ? ((t % 600) < 200 ? 1 : 0) : ((t + seed * 450) % 900 < 140 ? 1 : 0), drift: 0 };
  };
}

export async function run({ shove = 0, ram = false, mode = 'base', lagMs = 0, jitterMs = 0, bots = 2, secs = 40, tight = false, outageAtS = null, outageMs = 800, full = false } = {}) {
  const P = mode === 'new' ? await import('../../src/client/present.js') : null;
  const srv = await startLocalServer({ port: 0, netsim: true, lagMs, jitterMs, log: false, room: { countdownMs: 2500 } });
  const res = await fetch(srv.url + '/api/rooms', { method: 'POST' }).then(r => r.json());
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: pnow, build: srv.build, name: 'H' + (i + 1), onEvent: () => { } });
    c.useEventTime = false; c.drive = driver(i, tight); c.connect(res.code); clients.push(c);
    await waitFor(() => c.you, 5000, 'welcome');
  }
  const host = clients[0];
  await waitFor(() => host.room && host.room.seats.length === 2, 5000, 'joined');
  for (let b = 0; b < bots; b++) host.addBot();
  host.config({ map: 'velocity', mode: 'assisted' });
  await waitFor(() => host.room.seats.length === 2 + bots, 5000, 'bots');
  for (const c of clients) c.ready(true);
  await waitFor(() => host.room.canStart, 5000, 'canStart');
  host.start();
  await waitFor(() => clients.every(c => c.race), 5000, 'race');
  const rs = srv.rooms.get(res.code);
  if (ram) { const id0 = clients[0].you; clients[1].drive = driver(1, true, () => { const r = rs.sim && rs.sim.racers.find(x => x.id === id0); return r ? r.d : null; }); }
  const out = {}; let contacts = 0; const origStep = rs.sim.step; let shoves = 0; rs.sim.step = h => { origStep(h); if (shove && rs.sim.phase === 'race' && rs.step > 240 && rs.step % Math.round(shove * 120) === 0) { const v = rs.sim.racers.find(x => x.id === clients[0].you); if (v && !v.crashed) { const sg = (shoves++ % 2) ? 1 : -1; v.d += 1.2 * sg; v.vd += 4 * sg; v.va -= 6; } } const a = rs.sim.racers.find(x => x.id === clients[0].you), b = rs.sim.racers.find(x => x.id === clients[1].you); if (a && b && a.path === b.path) { const g = Math.abs(rs.sim.relS(a, b)), dd = Math.abs(a.d - b.d); if (g < 4.8 && dd < 2.8) contacts++; if (rs.sim.phase === 'race' && (rs.step % 120) === 0) (out.trace = out.trace || []).push([rs.step, +g.toFixed(1), +dd.toFixed(1), +a.speed.toFixed(0), +b.speed.toFixed(0), a.boost ? 1 : 0, b.boost ? 1 : 0]); } };
  // ---- server truth per tick ----
  const truth = new Map();   // step -> Map(id -> [prog, s, br])
  const origTick = rs.tick.bind(rs);
  rs.tick = () => { origTick(); if (rs.sim && rs.room.phase === 'race') { const br = rs.sim.track.BR; truth.set(rs.step, new Map(rs.sim.racers.map(r => [r.id, [r.prog, r.s, r.path === br, r.finished]]))); } };
  const L = clients[0].race.pred.sim.track.MAIN.L;
  // ---- per-client presentation state ----
  for (const c of clients) {
    c.pres = P ? new P.RemotePresenter(c.race.pred.sim.track) : null;
    c.rec = { snapGap: [], lastSnapAt: 0, remote: new Map(), ownJump: [], frames: [], rankFlips: 0, lastRank: null, rankT: [] };
    const orig = c.onSnapHook = c.onSnap.bind(c);
    c.onSnap = s => { const t = pnow(); if (c.rec.lastSnapAt) c.rec.snapGap.push(t - c.rec.lastSnapAt); c.rec.lastSnapAt = t; orig(s); if (c.pres && c.race) c.pres.push(s, c.serverNow()); };
  }
  const t0 = pnow(); let stop = false, outDone = false;
  const ids = clients[0].race.msg.seats.map(s => s.id);
  const loop = (async () => {
    let last = pnow();
    while (!stop) {
      const now = pnow(), dt = (now - last) / 1000; last = now;
      if (outageAtS != null && !outDone && (now - t0) / 1000 - 2.5 >= outageAtS) { outDone = true; srv.outage(outageMs); }
      for (const c of clients) {
        const R = c.race; if (!R || R.ended) continue;
        c.frame(c.drive(R.pred)); R.pred.decay(dt);
        if (R.pred.sim.phase !== 'race' && R.pred.sim.phase !== 'finished') continue;
        const me = R.pred.me, sn = c.serverNow();
        // own visual offset as DRAWN: baseline = worker correction; new = page OwnSmoother.softCorr on top
        const cv = R.pred.correction; let cl = { x: cv.x, y: cv.y, z: cv.z };
        if (P) { c.own = c.own || new P.OwnSmoother(R.pred.sim.track.MAIN.L); const pc = c.own.softCorr({ time: R.pred.sim.time, me: R.pred.me, corr: cl }); cl = { x: pc.x, y: pc.y, z: pc.z }; }
        // drawn world position = predicted world + drawn offset; second difference per frame (0 for steady
        // motion; a visible lurch/snap shows up as a spike). Compensated reconcile jumps cancel here.
        { const w = R.pred.me.world, D = { x: w.x + cl.x, y: w.y + cl.y, z: w.z + cl.z }, h = c.rec.Dh = c.rec.Dh || [];
          h.push(D); if (h.length > 3) h.shift();
          if (h.length === 3 && !(R.pred.me.crashed > 0)) { const j = Math.hypot(h[2].x - 2 * h[1].x + h[0].x, h[2].y - 2 * h[1].y + h[0].y, h[2].z - 2 * h[1].z + h[0].z); (c.rec.corrDelta = c.rec.corrDelta || []).push(j); if (j > 0.3 && (c.rec.bigCorr = c.rec.bigCorr || []).length < 10) c.rec.bigCorr.push({ j: +j.toFixed(2), step: R.pred.seq }); } }
        c.rec.lastCorr = cl;
        const own = { prog: me.prog, s: me.s, d: me.d, br: me.path === R.pred.sim.track.BR, step: R.pred.seq, finished: me.finished };
        const rows = [['own', own.prog, own.s, own.d, own.br]];
        for (const id of ids) {
          if (id === c.you) continue;
          const o = {};
          if (c.pres) { const vs = P.stepOf(R.pred.sim.time, R.msg); if (vs !== R.pred.seq) c.rec.stepMismatch = (c.rec.stepMismatch || 0) + 1; }
          const ok = c.pres ? c.pres.sample(id, sn, o, { ownStep: P.stepOf(R.pred.sim.time, R.msg) }) : R.interp.sample(id, sn, o);
          if (!ok) continue;
          const br = o.path === R.pred.sim.track.BR;
          rows.push([id, o.prog, o.s, o.d, br]);
          // remote discontinuity: per-frame motion vs speed*dt (track space)
          const st = c.rec.remote.get(id);
          if (st && st.br === br && dt > 0) {
            let ds = o.s - st.s; if (!br) { if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; }
            // time base = the clock the car is drawn on: new path = local step clock (same as the local car the
            // camera follows); baseline = estimated server wall clock
            const tdt = c.pres ? (R.pred.seq - st.step) * SIM_DT : dt;
            const exp = (o.speed * Math.cos(o.psi) + st.v) / 2 * tdt;
            const jerr = Math.abs(ds - exp);
            (c.rec.jump = c.rec.jump || []).push(jerr);
            if (jerr > 1 && (c.rec.bigJ = c.rec.bigJ || []).length < 12) c.rec.bigJ.push({ id, ds: +ds.toFixed(2), exp: +exp.toFixed(2), tdt: +tdt.toFixed(4), s: +o.s.toFixed(1), br });
            if (tdt > 0) { const vs = ds / tdt; if (st.vs != null) (c.rec.dv = c.rec.dv || []).push(Math.abs(vs - st.vs)); st.vs = vs; }
            c.rec.remote.set(id, { s: o.s, d: o.d, br, v: o.speed * Math.cos(o.psi), vs: st.vs, step: R.pred.seq });
          } else c.rec.remote.set(id, { s: o.s, d: o.d, br, v: o.speed * Math.cos(o.psi), vs: null, step: R.pred.seq });
        }
        // HUD rank as displayed
        let rank;
        if (c.pres) rank = c.pres.rank(c.you, own.prog, own.finished);
        else { const progs = rows.map(r => r[1]); rank = 1 + progs.slice(1).filter(p => p > own.prog).length; }
        if (c.rec.lastRank != null && rank !== c.rec.lastRank) c.rec.rankFlips++;
        c.rec.lastRank = rank;
        c.rec.frames.push({ step: own.step, rows, rank });
      }
      await sleep(16);
    }
  })();
  if (full) await waitFor(() => clients.every(c => c.results), 600000, 'results'); else await sleep(2500 + secs * 1000);
  stop = true; await loop;
  // ---- post-process vs truth ----
  const steps = [...truth.keys()].sort((a, b) => a - b);
  const truthAt = (step, id) => {   // linear between ticks
    let lo = 0, hi = steps.length - 1; if (!steps.length || step < steps[0] || step > steps[hi]) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (steps[m] <= step) lo = m; else hi = m; }
    const a = truth.get(steps[lo]).get(id), b = truth.get(steps[hi]).get(id); if (!a || !b) return null;
    const k = steps[hi] === steps[lo] ? 0 : (step - steps[lo]) / (steps[hi] - steps[lo]); return a[0] + (b[0] - a[0]) * k;
  };
  out.clients = clients.map(c => {
    const gapErr = [], trueFlipsBy = { n: 0 }; let lastTrueRank = null, falseRankFrames = 0, frames = 0, closeFrames = 0, closeErr = [];
    for (const f of c.rec.frames) {
      const ownT = truthAt(f.step, c.you); if (ownT == null) continue;
      let trueRank = 1; let allT = true;
      for (const r of f.rows.slice(1)) {
        const rt = truthAt(f.step, r[0]); if (rt == null) { allT = false; continue; }
        const dispGap = f.rows[0][1] - r[1], trueGap = ownT - rt;
        gapErr.push(Math.abs(dispGap - trueGap));
        if (Math.abs(trueGap) < 15) { closeFrames++; closeErr.push(Math.abs(dispGap - trueGap)); }
        if (rt > ownT) trueRank++;
      }
      if (!allT) continue;
      frames++; if (trueRank !== f.rank) falseRankFrames++;
      if (lastTrueRank != null && trueRank !== lastTrueRank) trueFlipsBy.n++; lastTrueRank = trueRank;
    }
    const P = c.race ? c.race.pred.stats : null;
    const corr = P ? P.corrections.slice(10) : [];
    return {
      you: c.you, rttMs: +c.clock.rtt.toFixed(1), lead: c.lead, leadMs: +(c.lead * SIM_DT * 1000).toFixed(0),
      snapGapMs: sum(c.rec.snapGap), snapAgeMs: sum(c.stats.snapAges.slice(20)),
      ownCorrectionM: sum(corr), ownCorrOver1m: corr.filter(x => x > 1).length, ownHardSnaps: P ? P.hard : 0, ownVisualM: sum(P ? P.visual.slice(10) : []), ownDrawnJerkM: sum(c.rec.corrDelta || []), bigCorrFrames: c.rec.bigCorr || [],
      remoteFrameJumpM: sum(c.rec.jump || []), remoteJumpsOver1m: (c.rec.jump || []).filter(x => x > 1).length, remoteJumpsOver3m: (c.rec.jump || []).filter(x => x > 3).length,
      remoteDvPerFrame: sum(c.rec.dv || []), remoteDvOver20: (c.rec.dv || []).filter(x => x > 20).length,
      interpUnderruns: c.race ? c.race.interp.stats.underruns : null, bigJumps: c.rec.bigJ || [], stepOfMismatches: c.rec.stepMismatch || 0, presStats: c.pres ? { snapsHard: c.pres.stats.snaps_hard, horizonS: sum(c.pres.stats.horizonS), softM: sum(c.pres.stats.soft) } : null,
      displayedGapErrM: sum(gapErr), closePassGapErrM: sum(closeErr), closeFrames,
      hudRankFlips: c.rec.rankFlips, trueRankFlips: trueFlipsBy.n, wrongRankFrames: falseRankFrames, rankFrames: frames,
      results: c.results ? c.results.order.map(o => `${o.pos}:${o.id}:${o.time}`).join(' ') : null
    };
  });
  out.cfg = { ram, mode, lagMs, jitterMs, bots, secs, tight, outageAtS, full };
  out.seed = rs.room.seed; out.humanContactSteps = contacts; out.injectedShoves = shoves; out.server = { ticks: rs.stats.ticks, lateTicks: rs.stats.lateTicks, starved: rs.stats.starved, skipped: rs.stats.skippedFrames };
  out.resultsAgree = full ? new Set(out.clients.map(x => x.results)).size === 1 : null;
  for (const c of clients) c.leave();
  await srv.close();
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const o = await run({ mode: arg('mode', 'base'), lagMs: +arg('lag', 0), jitterMs: +arg('jitter', 0), bots: +arg('bots', 2), secs: +arg('secs', 40), tight: !!arg('tight', false), shove: +arg('shove', 0), ram: !!arg('ram', false),
    outageAtS: arg('outage', null) == null ? null : +arg('outage'), full: !!arg('full', false) });
  const txt = JSON.stringify(o, null, 1);
  if (arg('out', null)) writeFileSync(arg('out'), txt);
  console.log(txt);
  process.exit(0);
}
