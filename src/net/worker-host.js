// Message host for the multiplayer worker (pure: no `self`, injectable for Node tests).
// page -> host: {t:'connect', wsUrl, build, name, code, token} | {t:'keys', f} | {t:'call', op, args} | {t:'state'}
//               {t:'autodrive', on} (honoured only when allowAutodrive, i.e. test builds) | {t:'leave'}
// host -> page: {t:'ev', type, m, st} | {t:'snap', s} | {t:'view', v, K} | {t:'state', st} | {t:'fx', list}
// State ({t:'state'}) is also published on a timer (every 500 ms) so page diagnostics never go stale at
// low frame rates.
import { NetClient } from './client.js';
import { createInputLoop } from './input-loop.js';
import { driveLine } from './driver.js';

export const LOOP_MS = 8, STATE_MS = 500;
export function createWorkerHost({ post, WebSocketImpl, now, timeOrigin = 0, setInterval: si = setInterval, clearInterval: ci = clearInterval, setTimeout: st = setTimeout, allowAutodrive = false }) {
  let nc = null, loop = null, timer = null, lastState = -1e9;
  const K = () => (nc && nc.clock.ready ? nc.clock.offset - timeOrigin : null);
  const state = () => nc && { room: nc.room, you: nc.you, code: nc.code, token: nc.token, status: nc.status, results: nc.results, K: K(), rtt: nc.clock.rtt, lead: nc.lead,
    pending: nc.race ? nc.race.pred.pending : null, pstats: nc.race ? { corrections: nc.race.pred.stats.corrections.slice(-400), hard: nc.race.pred.stats.hard, resyncs: nc.race.pred.stats.resyncs } : null,
    netStats: { snaps: nc.stats.snaps, sentMsgs: nc.stats.sentMsgs, recvMsgs: nc.stats.recvMsgs, behindMax: nc.stats.behindMax, resyncSteps: nc.stats.resyncSteps, ahead: nc.stats.ahead || [] },
    loop: loop ? { ticks: loop.stats.ticks, maxGapMs: Math.round(loop.stats.maxGapMs), keyUpdates: loop.stats.keyUpdates, frame: loop.frame, staleReleases: loop.stats.staleReleases } : null, at: now() };
  // presentation events from prediction -> plain data
  const q = []; let qT = null;
  const send = (...a) => { q.push(a); if (!qT) qT = st(() => { qT = null; post({ t: 'fx', list: q.splice(0) }); }, 0); };
  const events = {
    earn: (t, c) => send('earn', t, c), flash: (t, c) => send('flash', t, c), cp: h => send('cp', h), sfx: (n, ...a) => send('sfx', n, ...a),
    shake: x => send('shake', x), kick: x => send('kick', x), wallHit: (r, vn, s, Rw) => send('wallHit', vn, s, { x: Rw.x, y: Rw.y, z: Rw.z }),
    crash: () => send('crash'), respawn: () => send('respawn'), droneHit: () => send('droneHit'), sector: sec => send('sector', sec),
    racerReset: () => { }, lap: () => { }, playerFinish: () => { }, bump: () => { }, racer: () => { }
  };
  const host = {
    get nc() { return nc; }, get loop() { return loop; },
    tick() { if (!loop) return; loop.tick(); const t = now(); if (t - lastState >= STATE_MS) { lastState = t; post({ t: 'state', st: state() }); } },
    onMessage(m) {
      switch (m && m.t) {
        case 'connect':
          if (!nc) {
            nc = new NetClient({ wsUrl: m.wsUrl, WebSocketImpl, now, build: m.build, name: m.name, events,
              onEvent: (type, x) => { if (type === 'snap') post({ t: 'snap', s: { sn: x.sn, ph: x.ph, a: x.a, fo: x.fo, k: x.k } }); else post({ t: 'ev', type, m: x, st: state() }); } });
            loop = createInputLoop({ nc, now, publish: v => post({ t: 'view', v, K: K() }) });
            timer = si(() => host.tick(), LOOP_MS);
          }
          nc.name = m.name; nc.connect(m.code, m.token); break;
        case 'keys': if (loop && Number.isInteger(m.f)) loop.setFrame(m.f); break;
        case 'call': if (nc && typeof nc[m.op] === 'function' && /^(addBot|removeBot|config|car|setName|ready|start|toLobby)$/.test(m.op)) nc[m.op](...(m.args || [])); post({ t: 'state', st: state() }); break;
        case 'state': post({ t: 'state', st: state() }); break;
        case 'autodrive': if (loop && allowAutodrive) loop.driver = m.on ? (p => driveLine(p)) : null; break;
        case 'leave': if (nc) nc.leave(); if (timer) ci(timer); timer = null; nc = null; loop = null; break;
      }
    }
  };
  return host;
}
