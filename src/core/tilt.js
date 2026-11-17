// Relative tilt steering (pure). Input: DeviceOrientationEvent beta/gamma (degrees) and the
// screen orientation angle. Only relative tilt is used (no compass / absolute heading).
// Landscape steering axis is beta (device front-back axis becomes the wheel axis when the phone
// is held sideways). Sign per landscape orientation: angle 90 -> +beta, angle 270/-90 -> -beta.
// NOTE: axis/sign choice is from the W3C coordinate model; physical iPhone/Android calibration
// is UNVERIFIED.
export const TILT_DEFAULTS = { deadzone: 3, fullLock: 24, smoothing: 0.25 };
export function axisFor(sample, angle) {
  if (!sample || sample.beta == null || sample.gamma == null || !isFinite(sample.beta)) return null;
  const a = ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  if (a === 90) return sample.beta;
  if (a === 270) return -sample.beta;
  return null;   // portrait: tilt steering inactive (game is landscape-only)
}
export function createTilt(cfg = {}) {
  const c = Object.assign({}, TILT_DEFAULTS, cfg);
  const t = { neutral: null, steer: 0, cfg: c,
    recenter(sample, angle) { const v = axisFor(sample, angle); t.neutral = v; t.steer = 0; return v != null; },
    reset() { t.steer = 0; },
    // returns smoothed steer in [-1, 1] (+ = right)
    update(sample, angle) {
      const v = axisFor(sample, angle);
      if (v == null) { t.steer = 0; return 0; }
      if (t.neutral == null) t.neutral = v;
      let d = v - t.neutral; if (d > 180) d -= 360; if (d < -180) d += 360;
      const mag = Math.max(0, Math.abs(d) - c.deadzone) / Math.max(1, c.fullLock - c.deadzone);
      const target = Math.sign(d) * Math.min(1, mag);
      t.steer += (target - t.steer) * Math.min(1, Math.max(0, 1 - c.smoothing));
      return t.steer;
    } };
  return t;
}
