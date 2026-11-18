// Input/network timeline loop (pure; runs inside a Web Worker in browsers, or directly in Node tests).
// It owns the NetClient: samples the LATEST input frame the page reported (held between reports), runs
// prediction steps and sends input on its own timer. A page whose rendering stalls therefore keeps
// delivering its last input on time instead of starving the server (which would make the car coast).
// The page only renders whatever view this loop last published.
import { decodeFrame } from './protocol.js';

export function createInputLoop({ nc, now, publish, intervalMs = 8, publishMs = 12, driver = null }) {
  const keys = decodeFrame(0); let frame = 0, lastPub = -1e9, lastTick = 0, stats = { ticks: 0, keyUpdates: 0, maxGapMs: 0, gaps: [] };
  const loop = {
    setFrame(f) { if (f !== frame) { frame = f; decodeFrame(f, keys); } stats.keyUpdates++; },
    driver,
    tick() {
      const t = now();
      if (lastTick) { const g = t - lastTick; if (g > stats.maxGapMs) stats.maxGapMs = g; if (stats.gaps.length < 20000) stats.gaps.push(g); }
      lastTick = t; stats.ticks++;
      const R = nc.race;
      if (R && loop.driver) Object.assign(keys, loop.driver(R.pred));
      const dtSec = Math.min(0.1, intervalMs / 1000);
      nc.frame(keys);
      if (R) R.pred.decay(dtSec);
      if (R && t - lastPub >= publishMs) { lastPub = t; publish(nc.view()); }
    },
    stats
  };
  return loop;
}
