// Input/network timeline loop (pure; runs inside a Web Worker in browsers, or directly in Node tests).
// It owns the NetClient: samples the LATEST input frame the page reported (held between reports), runs
// prediction steps and sends input on its own timer. A page whose rendering stalls therefore keeps
// delivering its last input on time instead of starving the server (which would make the car coast).
// The page releases input explicitly (blur / hidden / touch cancel send a neutral frame at once). As a
// safety net, input the page has not re-confirmed for STALE_PAGE_MS (page hung or crashed) is released.
import { decodeFrame, ZERO_FRAME } from './protocol.js';

export const STALE_PAGE_MS = 10000;
export function createInputLoop({ nc, now, publish, intervalMs = 8, publishMs = 12, driver = null }) {
  const keys = decodeFrame(ZERO_FRAME);   // neutral: no throttle, no steer (frame 0 would be full LEFT)
  let lastPub = -1e9, lastTick = 0, lastKeysAt = now();
  const stats = { ticks: 0, keyUpdates: 0, maxGapMs: 0, gaps: [], staleReleases: 0 };
  const loop = {
    frame: ZERO_FRAME, driver,
    setFrame(f) { if (f !== loop.frame) { loop.frame = f; decodeFrame(f, keys); } lastKeysAt = now(); stats.keyUpdates++; },
    get keys() { return keys; },
    tick() {
      const t = now();
      if (lastTick) { const g = t - lastTick; if (g > stats.maxGapMs) stats.maxGapMs = g; if (stats.gaps.length < 20000) stats.gaps.push(g); }
      lastTick = t; stats.ticks++;
      if (loop.frame !== ZERO_FRAME && t - lastKeysAt > STALE_PAGE_MS && !loop.driver) { loop.frame = ZERO_FRAME; decodeFrame(ZERO_FRAME, keys); stats.staleReleases++; }
      const R = nc.race;
      if (R && loop.driver) Object.assign(keys, loop.driver(R.pred));
      nc.frame(keys);
      if (R) R.pred.decay(Math.min(0.1, intervalMs / 1000));
      if (R && t - lastPub >= publishMs) { lastPub = t; publish(nc.view()); }
    },
    stats
  };
  return loop;
}
