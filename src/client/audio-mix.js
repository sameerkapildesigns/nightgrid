// R2 audio audit: reversible levels for the always-on beds and the engine idle floor.
// Pure (no Web Audio), so the numbers are unit-tested. Defaults: both OFF.
//
// What was always on before R2 (AU.init in game.js), from the first click until the tab closes,
// on every screen including the garage:
//   - "hum":  white noise -> 140 Hz low-pass, gain 0.22  (constant low rumble; loudest bed)
//   - "rain": white noise -> 1.2-7 kHz band, gain 0.035 (constant hiss)
//   - engine idle floor: saw 46 Hz + square ~24 Hz through a Q5 low-pass, gain 0.09, with a
//     6.5 Hz vibrato (a buzzing warble even when parked or in menus), plus a 600 Hz sine at 0.006
//     (faint whine).
// Music, wind, drift, scrape, impacts, whoosh, beeps and weapon cues are unchanged.
export const AMBIENT = Object.freeze({ hum: 0.22, rain: 0.035 });
export const ENGINE_IDLE = Object.freeze({ body: 0.09, whine: 0.006 });

export function ambientGains(on) {
  return on ? { hum: AMBIENT.hum, rain: AMBIENT.rain } : { hum: 0, rain: 0 };
}

// Engine gains. idleOn = pre-R2 behaviour exactly. idleOn = false: the idle floor fades in with
// throttle or speed (full at throttle 1 or 20 % of top speed), so it is silent when parked or in
// menus and identical to pre-R2 once driving.
export function engineGains(s01, thr, boost, idleOn) {
  const floor = idleOn ? 1 : Math.min(1, Math.max(thr, s01 * 5, boost));
  return {
    body: ENGINE_IDLE.body * floor + thr * 0.07 + s01 * 0.06 + boost * 0.05,
    whine: ENGINE_IDLE.whine * floor + s01 * 0.018 + boost * 0.03
  };
}
