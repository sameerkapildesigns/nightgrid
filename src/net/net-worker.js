// Web Worker entry: the multiplayer connection, input timeline and prediction live here, off the
// rendering thread. Messages: page -> worker {t:'connect'|'keys'|'call'|'leave'|'autodrive'};
// worker -> page {t:'ev'|'snap'|'view'|'state'}. Server time for the page: serverNow = page epoch ms + K.
import { NetClient } from './client.js';
import { createInputLoop } from './input-loop.js';
import { driveLine } from './driver.js';

let nc = null, loop = null, timer = null;
const post = m => self.postMessage(m);
const K = () => (nc && nc.clock.ready ? nc.clock.offset - performance.timeOrigin : null);
const state = () => nc && { room: nc.room, you: nc.you, code: nc.code, token: nc.token, status: nc.status, results: nc.results, K: K(), rtt: nc.clock.rtt, lead: nc.lead,
  pending: nc.race ? nc.race.pred.pending : null, pstats: nc.race ? { corrections: nc.race.pred.stats.corrections.slice(-400), hard: nc.race.pred.stats.hard, resyncs: nc.race.pred.stats.resyncs } : null,
  netStats: { snaps: nc.stats.snaps, sentMsgs: nc.stats.sentMsgs, recvMsgs: nc.stats.recvMsgs, behindMax: nc.stats.behindMax, resyncSteps: nc.stats.resyncSteps, ahead: nc.stats.ahead || [] },
  loop: loop ? { ticks: loop.stats.ticks, maxGapMs: Math.round(loop.stats.maxGapMs), keyUpdates: loop.stats.keyUpdates } : null };
self.onmessage = e => {
  const m = e.data;
  switch (m.t) {
    case 'connect':
      if (!nc) {
        nc = new NetClient({ wsUrl: m.wsUrl, WebSocketImpl: WebSocket, now: () => performance.now(), build: m.build, name: m.name, events: workerEvents,
          onEvent: (type, x) => { if (type === 'snap') post({ t: 'snap', s: { sn: x.sn, ph: x.ph, a: x.a, fo: x.fo, k: x.k } }); else post({ t: 'ev', type, m: x, st: state() }); } });
        loop = createInputLoop({ nc, now: () => performance.now(), publish: v => post({ t: 'view', v, K: K() }) });
        timer = setInterval(() => loop.tick(), 8);
      }
      nc.name = m.name; nc.connect(m.code, m.token); break;
    case 'keys': if (loop) loop.setFrame(m.f); break;
    case 'call': if (nc && typeof nc[m.op] === 'function') nc[m.op](...(m.args || [])); post({ t: 'state', st: state() }); break;
    case 'state': post({ t: 'state', st: state() }); break;
    case 'autodrive': if (loop && import.meta.env.MODE === 'test') loop.driver = m.on ? (p => driveLine(p)) : null; break;   // test builds only
    case 'leave': if (nc) nc.leave(); clearInterval(timer); timer = null; nc = null; loop = null; break;
  }
};
// presentation events from prediction -> plain data for the page
const q = []; let qT = null;
const send = (...a) => { q.push(a); if (!qT) qT = setTimeout(() => { qT = null; post({ t: 'fx', list: q.splice(0) }); }, 0); };
const workerEvents = {
  earn: (t, c) => send('earn', t, c), flash: (t, c) => send('flash', t, c), cp: h => send('cp', h), sfx: (n, ...a) => send('sfx', n, ...a),
  shake: x => send('shake', x), kick: x => send('kick', x), wallHit: (r, vn, s, Rw) => send('wallHit', vn, s, { x: Rw.x, y: Rw.y, z: Rw.z }),
  crash: () => send('crash'), respawn: () => send('respawn'), droneHit: () => send('droneHit'), sector: sec => send('sector', sec),
  racerReset: () => { }, lap: () => { }, playerFinish: () => { }, bump: () => { }, racer: () => { }
};
