// M3 driving modes + per-map pace (pure). Modes are separate from AI difficulty (Normal/Hard)
// and from the input method (Touch/Tilt/keyboard).
// Caps are for the FASTEST car (Streamliner, vmax modifier 1.035); other cars scale by
// modifier / 1.035, keeping their acceleration and grip differences.
export const DRIVE_MODES = ['assisted', 'expert'];
export const MODE = {
  // steerRise/steerNeutral/yaw: first-order rates (1/s). Total 90% steering response
  // (steer filter cascaded with yaw filter): assisted 0.325 s rise / 0.225 s neutral,
  // expert 0.283 s / 0.217 s (v5b: 0.64 s / 0.48 s). See tests/unit/handling.test.mjs.
  assisted: { steerRise: 9, steerNeutral: 16, yaw: 16, brake0: 20, brakeMax: 46, brakeRamp: 0.5, draftOverCap: false, cornerAssist: true, edgeAssist: 0.15 },
  expert: { steerRise: 11, steerNeutral: 18, yaw: 16, brake0: 46, brakeMax: 46, brakeRamp: 0.5, draftOverCap: true, cornerAssist: false, edgeAssist: 0 }
};
// km/h for the fastest car: [normal, boost]; cornerA: lateral accel (m/s^2) behind the
// curvature-based corner speed v = sqrt(A / k) (AI targets, Assisted corner easing).
// Tight-corner targets (km/h) at each map's tightest curvature: see PACE_TARGETS.
export const PACE = {
  velocity: { assisted: { kmh: [240, 300], cornerA: 64 }, expert: { kmh: [310, 380], cornerA: 104 } },
  technical: { assisted: { kmh: [180, 225], cornerA: 54 }, expert: { kmh: [240, 300], cornerA: 95 } },
  legacy: { assisted: { kmh: [210, 260], cornerA: 67 }, expert: { kmh: [280, 345], cornerA: 115 } }
};
export const PACE_TARGETS = {   // tight-corner speed ranges (km/h), user candidate hypotheses
  velocity: { assisted: [150, 180], expert: [190, 230] },
  technical: { assisted: [75, 110], expert: [100, 145] },
  legacy: { assisted: [95, 135], expert: [125, 175] }
};
export const FASTEST_MOD = 1.035;
export function paceFor(map, mode) {
  const p = (PACE[map] || PACE.velocity)[mode] || PACE.velocity.expert;
  return { normal: p.kmh[0] / 3.6, boost: p.kmh[1] / 3.6, cornerA: p.cornerA, mode: MODE[mode] || MODE.expert, modeKey: MODE[mode] ? mode : 'expert' };
}
// tightest-corner curvature metric shared by tests (max |KG| over a 40 m window)
export function cornerSpeed(cornerA, k) { return Math.sqrt(cornerA / Math.max(k, 1e-4)); }
