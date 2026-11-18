// Headless multiplayer scenarios over REAL WebSockets against the local runtime (server/local.mjs),
// using the shipping netcode (src/net/client.js + netcode.js). No rendering: this measures networking,
// prediction and authority, not handset frame rate.
import WebSocket from 'ws';
import { startLocalServer } from '../../server/local.mjs';
import { NetClient } from '../../src/net/client.js';
import { SIM_DT } from '../../src/core/clock.js';

const pnow = () => performance.now();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// simple line-follower for scripted human drivers (tuned offline; not an AI opponent)
export function driver(seed = 0) {
  let t = 0;
  return (pred, k = {}) => {
    const r = pred && pred.me; t++;
    if (!r) return { up: 0 };
    const kg = pred.sim.kgAt(r.path, r.s + 10 + r.speed * 0.3);
    const wob = 0.25 * Math.sin(t * 0.013 + seed * 1.7);   // human-ish weave so cars interact
    const st = Math.max(-1, Math.min(1, (r.d - wob * 4) * 0.03 + r.psi * 3 - 30 * kg));
    return { up: 1, down: 0, right: st > 0 ? st : 0, left: st < 0 ? -st : 0, boost: (t + seed * 97) % 900 < 120 ? 1 : 0, drift: 0, ...k };
  };
}
const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
export const summarize = a => ({ n: a.length, median: pct(a, 0.5), p95: pct(a, 0.95), max: a.length ? Math.max(...a) : null });

export async function scenario({ humans = 2, bots = 0, map = 'velocity', mode = 'assisted', lagMs = 0, jitterMs = 0, raceSeconds = 20, full = false,
  outageAtS = null, outageMs = 500, disconnectAtS = null, reconnect = true, server = null, room = {}, log = false, onFrame = null } = {}) {
  const srv = server || await startLocalServer({ port: 0, netsim: true, lagMs, jitterMs, log, room: { countdownMs: 2500, ...room } });
  if (server) srv.setNet({ lagMs, jitterMs });
  const res = await fetch(srv.url + '/api/rooms', { method: 'POST' }).then(r => r.json());
  if (!res.ok) throw new Error('create failed ' + res.error);
  const clients = []; const evs = [];
  for (let i = 0; i < humans; i++) {
    const c = new NetClient({ wsUrl: srv.url.replace('http', 'ws'), WebSocketImpl: WebSocket, now: pnow, build: srv.build, name: 'H' + (i + 1),
      onEvent: (t, m) => { evs.push([i, t, m && (m.error || m.reason || '')]); } });
    c.drive = driver(i); c.connect(res.code); clients.push(c);
    await waitFor(() => c.you, 5000, 'welcome');
  }
  const host = clients[0];
  await waitFor(() => host.room && host.room.seats.length === humans, 5000, 'all joined');
  for (let b = 0; b < bots; b++) host.addBot();
  host.config({ map, mode });
  await waitFor(() => host.room.seats.length === humans + bots && host.room.map === map && host.room.mode === mode, 5000, 'bots/config');
  for (const c of clients) c.ready(true);
  await waitFor(() => host.room.canStart, 5000, 'canStart');
  host.start();
  await waitFor(() => clients.every(c => c.race), 5000, 'race msg');
  // frame loop (~60 Hz) for every client
  let stop = false, outageDone = false, dcDone = false; const t0 = pnow();
  const loop = (async () => {
    while (!stop) {
      for (const c of clients) if (c.race) { c.frame(c.drive(c.race.pred)); c.race.pred.decay(0.016); if (onFrame) onFrame(c); }
      const el = (pnow() - t0) / 1000 - 2.5;
      if (outageAtS != null && !outageDone && el >= outageAtS) { outageDone = true; srv.outage(outageMs); }
      if (disconnectAtS != null && !dcDone && el >= disconnectAtS) { dcDone = true; const c = clients[clients.length - 1]; c.ws.terminate ? c.ws.terminate() : c.ws.close(); }
      await sleep(16);
    }
  })();
  if (full) await waitFor(() => clients.every(c => c.results), 400000, 'results');
  else await sleep(2500 + raceSeconds * 1000);
  stop = true; await loop;
  const roomSrv = srv.rooms.get(res.code);
  const st = roomSrv ? roomSrv.stats : null;
  const out = { humans, bots, map, mode, lagMs, jitterMs, elapsedS: +((pnow() - t0) / 1000).toFixed(1), clients: clients.map(c => clientStats(c)), server: st && serverStats(st), events: evs.filter(e => e[1] !== 'snap' && e[1] !== 'lobby') };
  out.results = clients.map(c => c.results ? c.results.order.map(o => `${o.pos}:${o.id}:${o.time}`).join(' ') : null);
  if (roomSrv) out.authoritative = roomSrv.sim ? roomSrv.sim.racers.map(r => ({ id: r.id, lap: r.lap, prog: +r.prog.toFixed(1), finished: r.finished })) : null;
  out.clientViews = clients.map(c => c.race && c.race.last ? c.race.last.a.map(a => [a[0], a[7], a[8]]) : null);
  for (const c of clients) c.leave();
  if (!server) await srv.close();
  return out;
}
function clientStats(c) {
  const R = c.race, el = (pnow() - c.stats.t0) / 1000;
  const corr = R ? R.pred.stats.corrections.slice(10) : [];   // skip the first second (lead settling)
  return { you: c.you, rttMs: +c.clock.rtt.toFixed(1), lead: c.lead, corrections: summarize(corr).median == null ? null : { ...summarize(corr), over1m: corr.filter(x => x > 1).length, perS: +(corr.filter(x => x > 0.05).length / el).toFixed(2), visualP95: summarize(R.pred.stats.visual.slice(10)).p95 },
    hardSnaps: R ? R.pred.stats.hard : 0, maxPending: R ? R.pred.stats.maxPending : 0, pendingNow: R ? R.pred.pending : 0, resyncs: R ? R.pred.stats.resyncs : 0,
    snapAgeMs: summarize(c.stats.snapAges.slice(20)), interpUnderruns: R ? R.interp.stats.underruns : 0,
    upMsgsPerS: +(c.stats.sentMsgs / el).toFixed(1), upBytesPerS: Math.round(c.stats.sentBytes / el), downMsgsPerS: +(c.stats.recvMsgs / el).toFixed(1), downBytesPerS: Math.round(c.stats.recvBytes / el) };
}
function serverStats(s) {
  return { ticks: s.ticks, steps: s.steps, tickMs: summarize(s.tickMs), overruns: s.overruns, lateTicks: s.lateTicks, droppedMs: Math.round(s.droppedMs), starvedFrames: s.starved, skippedFrames: s.skippedFrames, rejected: s.rejected, recvMsgs: s.recvMsgs, sentMsgs: s.sentMsgs };
}
export async function waitFor(fn, ms, what) { const t = pnow(); while (!fn()) { if (pnow() - t > ms) throw new Error('timeout: ' + what); await sleep(20); } }
export { SIM_DT };
