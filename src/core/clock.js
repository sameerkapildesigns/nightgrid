// Fixed-step simulation clock with bounded catch-up and explicit stall handling.
//
// v5b advanced the simulation by min(frameDt, 50 ms), so below 20 FPS the whole race
// (cars AND the race clock) ran in slow motion. Here the simulation always advances in
// fixed SIM_DT steps by the *wall-clock* frame time, so race time tracks real time at
// low frame rates. Bounds:
//   - frame gaps up to `maxCatchUp` (250 ms, i.e. down to 4 FPS) are simulated in full;
//   - gaps between `maxCatchUp` and `stallAfter` simulate `maxCatchUp` and drop the rest
//     (counted in `droppedMs`, so the loss is visible, never silent);
//   - gaps >= `stallAfter` (1 s: tab suspension, debugger, OS sleep) are a *stall*: nothing
//     is simulated, the gap is counted, and the caller is told so it can pause the race.
// Dropped time is never added to the race clock, and the cars do not move during it, so
// lap times stay consistent with the simulated motion (equivalent to a pause).
export const SIM_DT = 1 / 120;

export function createClock({ step = SIM_DT, maxCatchUp = 0.25, stallAfter = 1.0 } = {}) {
  const c = {
    step, maxCatchUp, stallAfter,
    acc: 0, simTime: 0, wallTime: 0, steps: 0, droppedMs: 0, stalls: 0, lastStallMs: 0,
    // wallDt: real seconds since the previous frame. timeScale: e.g. 0.3 for finish slow-mo.
    // Returns { steps, h, simDt, dropped, stalled }.
    advance(wallDt, timeScale = 1) {
      if (!(wallDt > 0)) return { steps: 0, h: step, simDt: 0, dropped: 0, stalled: false };
      c.wallTime += wallDt;
      if (wallDt >= stallAfter) {
        c.stalls++; c.lastStallMs = wallDt * 1000; c.droppedMs += wallDt * 1000;
        return { steps: 0, h: step, simDt: 0, dropped: wallDt, stalled: true };
      }
      let dt = wallDt, dropped = 0;
      if (dt > maxCatchUp) { dropped = dt - maxCatchUp; dt = maxCatchUp; c.droppedMs += dropped * 1000; }
      c.acc += dt * timeScale;
      const maxSteps = Math.ceil(maxCatchUp / step) + 1;
      let n = Math.floor(c.acc / step + 1e-9);
      if (n > maxSteps) { c.droppedMs += (n - maxSteps) * step * 1000; n = maxSteps; c.acc = 0; }
      else c.acc -= n * step;
      c.steps += n; c.simTime += n * step;
      return { steps: n, h: step, simDt: n * step, dropped, stalled: false };
    },
    reset() { c.acc = 0; }
  };
  return c;
}

// Wall-clock FPS meter (v5b averaged the *capped* dt, so it could never report < 20 FPS).
export function createFpsMeter(windowSec = 1) {
  const m = { fps: 0, acc: 0, n: 0, minFps: Infinity,
    frame(wallDt) { if (!(wallDt > 0)) return m.fps; m.acc += wallDt; m.n++; if (m.acc >= windowSec) { m.fps = m.n / m.acc; m.minFps = Math.min(m.minFps, m.fps); m.acc = 0; m.n = 0; } return m.fps; } };
  return m;
}
