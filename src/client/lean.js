// The mesh's +Z points forward, but the camera's +Z points backwards.
// Steering right is positive; yaw velocity while steering right is negative.
// Both up vectors must tip into the turn rather than away from it.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function bodyLean(r, car) {
  const roll = r.autopilot ? r.rollAI : r.steer * .34 * Math.min(1, r.speed / 40) - r.vl * .008;
  return clamp(-roll * (car ? .45 : 1),-.12,.12);
}
export function cameraLean(yawVelocity, speed01) {
  return clamp(-yawVelocity * .05 * speed01, -.12, .12);
}
