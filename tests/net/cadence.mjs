// Own-car presentation cadence: the REAL worker host (8 ms input/prediction loop, 12 ms view publish) in
// Node, read by a 120 Hz "render" loop (M1 Pro ProMotion rate) the way game.js mpFrame reads RC.view.
// Measures how evenly the local car (and so the chase camera) moves per rendered frame.
// Assumption (not measured here): browser postMessage delivery to the page adds main-thread queueing;
// in Node the view arrives synchronously, so this is a lower bound on unevenness.
//
// usage: node tests/net/cadence.mjs --mode base|smooth --hz 120 --secs 20 [--lag 100 --jitter 30] [--out f.json]
import WebSocket from 'ws';
import { writeFileSync } from 'node:fs';
import { startLocalServer } from '../../server/local.mjs';
import { createWorkerHost } from '../../src/net/worker-host.js';
import { mod } from '../../src/core/math.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const pnow = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, p) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return +s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(4); };
const sum = a => ({ n: a.length, p50: pct(a, 0.5), p95: pct(a, 0.95), p99: pct(a, 0.99), max: a.length ? +Math.max(...a).toFixed(4) : null });
async function waitFor(fn, ms, what) { const t = pnow(); while (!fn()) { if (pnow() - t > ms) throw new Error('timeout: ' + what); await sleep(10); } }

const snapsSeen = [];
export async function run({ mode = 'base', hz = 120, secs = 20, lagMs = 0, jitterMs = 0 } = {}) {
  const P = mode === 'smooth' ? await import('../../src/client/present.js') : null;
  const srv = await startLocalServer({ port: 0, netsim: true, lagMs, jitterMs, log: false, room: { countdownMs: 2500 } });
  const res = await fetch(srv.url + '/api/rooms', { method: 'POST' }).then(r => r.json());
  let view = null, views = 0, viewGaps = [], lastViewAt = 0, st = null, race = null, pres = null, PRm = null;
  const host = createWorkerHost({ post: m => {
    if (m.t === 'snap') { if (PRm && pres) pres.push(m.s); else snapsSeen.push(m.s); }
    else if (m.t === 'view') { const t = pnow(); if (lastViewAt) viewGaps.push(t - lastViewAt); lastViewAt = t; view = m.v; views++; }
    else if (m.t === 'state' || m.t === 'ev') { st = m.st || st; if (m.t === 'ev' && m.type === 'race') race = m.m; }
  }, WebSocketImpl: WebSocket, now: pnow, allowAutodrive: true });
  host.onMessage({ t: 'connect', wsUrl: srv.url.replace('http', 'ws'), build: srv.build, name: 'W', code: res.code });
  await waitFor(() => host.nc && host.nc.you, 5000, 'welcome');
  const nc = host.nc;
  nc.addBot(); nc.addBot(); await waitFor(() => nc.room && nc.room.seats.length === 3, 5000, 'bots');
  nc.ready(true); await waitFor(() => nc.room.canStart, 5000, 'canStart'); nc.start();
  await waitFor(() => race, 6000, 'race');
  host.onMessage({ t: 'autodrive', on: true });
  const L = nc.race.pred.sim.track.MAIN.L;
  const sm = P ? new P.OwnSmoother(L) : null;
  // remote cars, drawn the way game.js does for each mode: base = Interpolator at serverNow (page clock);
  // smooth = RemotePresenter at the frame's presentation time (stepAt(O.t))
  const { Interpolator } = await import('../../src/net/netcode.js');
  PRm = P; pres = P ? new P.RemotePresenter(nc.race.pred.sim.track) : null; const interp = P ? null : new Interpolator(nc.race.pred.sim.track);
  const remoteIds = race.seats.map(s => s.id).filter(id => id !== nc.you);
  const rPrev = new Map(), rErr = [], rRepeat = { n: 0 };
  const frameErr = [], stepsPerFrame = [], repeats = { n: 0 }, frameDt = [];
  let prev = null, prevSteps = null, frames = 0;
  const T0 = pnow(), period = 1000 / hz; let next = T0;
  while (pnow() - T0 < (2.5 + secs) * 1000) {
    next += period; const w = next - pnow(); if (w > 1) await sleep(w - 1); while (pnow() < next) { /* spin to the frame boundary */ }
    const t = pnow(); if (!view || view.ended) continue;
    const v = view; const stp = P ? P.stepOf(v.time, race) : null;
    let s = v.me.s, br = v.me.br, speed = v.me.va;
    let presT = v.time;
    if (sm) { const o = sm.frame(v, t); s = o.s; br = o.br; presT = o.t; }
    // remote cars this frame
    if (interp) for (const x of snapsSeen.splice(0)) interp.push(x);
    for (const id of remoteIds) {
      const o = {}; const ok = P ? pres.sample(id, 0, o, { ownStep: P.stepAt(presT, race) }) : interp.sample(id, nc.serverNow(), o); if (!ok || o.speed < 20 || o.finished) { rPrev.delete(id); continue; }
      const q = rPrev.get(id), rb = o.path === nc.race.pred.sim.track.BR;
      if (q && q.br === rb) { let ds = o.s - q.s; if (!rb) { if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; } const dtr = (t - q.t) / 1000; rErr.push(Math.abs(ds - (o.va + q.va) / 2 * dtr)); if (Math.abs(ds) < 1e-6) rRepeat.n++; }
      rPrev.set(id, { s: o.s, br: rb, va: o.va, t });
    }   // expected motion always from the sim's own va (same basis for both modes)
    if (v.me.lap < 0 || v.me.speed < 20) { prev = null; continue; }   // grid / launch
    if (prev && prev.br === br) {
      let ds = s - prev.s; if (!br) { if (ds > L / 2) ds -= L; if (ds < -L / 2) ds += L; }
      const dt = (t - prev.t) / 1000; frameDt.push(dt * 1000);
      frameErr.push(Math.abs(ds - (speed + prev.v) / 2 * dt));
      if (Math.abs(ds) < 1e-6) repeats.n++;
      if (prevSteps != null && stp != null) stepsPerFrame.push(stp - prevSteps);
    }
    prev = { s, br, v: speed, t }; prevSteps = stp; frames++;
  }
  const out = { cfg: { mode, hz, secs, lagMs, jitterMs, seed: srv.rooms.get(res.code) && srv.rooms.get(res.code).room.seed }, frames,
    renderFrameMs: sum(frameDt), viewGapMs: sum(viewGaps), ownFrameErrM: sum(frameErr), ownFrameErrOver02m: frameErr.filter(x => x > 0.2).length,
    ownFrameErrOver05m: frameErr.filter(x => x > 0.5).length, remoteFrameErrM: sum(rErr), remoteFrameErrOver05m: rErr.filter(x => x > 0.5).length, remoteRepeatedFrames: rRepeat.n, remoteFrames: rErr.length, repeatedFrames: repeats.n,
    stepsPerFrameHist: stepsPerFrame.reduce((h, x) => (h[x] = (h[x] || 0) + 1, h), {}), smoother: sm ? sm.stats : null };
  host.onMessage({ t: 'leave' }); await srv.close();
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const o = await run({ mode: arg('mode', 'base'), hz: +arg('hz', 120), secs: +arg('secs', 20), lagMs: +arg('lag', 0), jitterMs: +arg('jitter', 0) });
  const txt = JSON.stringify(o, null, 1); if (arg('out', null)) writeFileSync(arg('out'), txt); console.log(txt); process.exit(0);
}
