// Release 2: solo-only catch-up assist for a player who is very far behind.
//
// What it does: raises the solo player's own speed caps (normal and boost) by at most
// CATCHUP.maxCap while the player is more than CATCHUP.startSec behind the nearest racer
// ahead, ramping smoothly to the cap at CATCHUP.fullSec. It never touches NPC pace, so the
// existing rubber band (sim.js stepAI) and the Legacy NPC baseline stay exactly as they are.
//
// Guarantees (tests/unit/catchup.test.mjs):
//  - zero effect within startSec of the car ahead, so it can never decide a close fight;
//  - zero effect when leading, after finishing, in rooms (sim.ghost) or with sim.catchup off;
//  - pure and deterministic: a function of race progress only, no RNG, no clock;
//  - laps driven while it is active are flagged (integrity.assist) and never record-eligible.
// Pure module: no DOM, no Three.js.

export const CATCHUP = Object.freeze({
  startSec: 6,       // below this gap to the car ahead: no assist at all
  fullSec: 14,       // at or beyond this gap: full assist
  maxCap: 0.05,      // +5 % on the player's own speed caps, never more
  progPerSec: 62     // metres of progress per second of gap (same constant as the NPC rubber band)
});

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

// Seconds `r` trails the nearest unfinished racer ahead of it (0 when nobody is ahead).
export function gapToCarAhead(racers, r, cfg = CATCHUP) {
  let best = Infinity;
  for (const o of racers) {
    if (o === r || o.finished) continue;
    const d = o.prog - r.prog;
    if (d > 0 && d < best) best = d;
  }
  return best === Infinity ? 0 : best / cfg.progPerSec;
}

// Cap multiplier for a gap in seconds: 1 up to startSec, smoothstep to 1 + maxCap at fullSec.
export function catchupMul(gapSec, cfg = CATCHUP) {
  if (!(gapSec > cfg.startSec)) return 1;
  const x = clamp01((gapSec - cfg.startSec) / (cfg.fullSec - cfg.startSec));
  return 1 + cfg.maxCap * x * x * (3 - 2 * x);
}

// Solo only: the page opts in with sim.catchup = true; rooms run with sim.ghost = true and the
// room server never sets sim.catchup, so either guard alone keeps multiplayer untouched.
export function catchupEligible(sim) {
  if (!sim.catchup || sim.ghost) return false;
  let humans = 0;
  for (const r of sim.racers) if (!r.isAI) humans++;
  return humans === 1;
}

// Per-step update (called by sim.step while racing). Writes r.catchMul on human racers.
export function updateCatchup(sim, cfg = CATCHUP) {
  const on = catchupEligible(sim);
  for (const r of sim.racers) {
    if (r.isAI) continue;
    const m = on && !r.finished && !r.autopilot && !(r.crashed > 0) ? catchupMul(gapToCarAhead(sim.racers, r, cfg), cfg) : 1;
    r.catchMul = m;
    if (m > 1 && r.lapIntegrity) r.lapIntegrity.assist = true;
  }
}
