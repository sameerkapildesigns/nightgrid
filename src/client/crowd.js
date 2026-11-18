// M7: presentation budget for big grids (up to 20 racers). Pure, no Three.js: game.js feeds camera-space
// facts each frame and applies the plan. The own car is never touched (always full detail, never labelled).
//
// Labels: a remote's name tag shows only if it is within LABEL_M of the camera, on screen, among the
// LABEL_MAX nearest, and at least MIN_PX away (screen space) from every nearer label already shown.
// Detail: 'full' = model + trails/exhaust/sparks/wheel animation; 'lite' = same model, effects off;
// 'far' = cheap proxy instead of the model. The FULL_MAX nearest remotes within FULL_M stay 'full'
// (near cars keep their detail); hysteresis (HYST m) stops threshold flicker.
export const CROWD = { LABEL_MAX: 6, LABEL_M: 140, MIN_PX: 44, FULL_MAX: 5, FULL_M: 60, FAR_M: 160, HYST: 12 };

// items: [{ id, dist, sx, sy, onScreen }] for REMOTE racers only (screen coords in CSS px).
// prev: Map id -> previous detail level (for hysteresis). Returns Map id -> { label, detail }.
export function planCrowd(items, prev = new Map(), C = CROWD) {
  const out = new Map();
  const byDist = items.slice().sort((a, b) => a.dist - b.dist || (a.id < b.id ? -1 : 1));
  const shown = [];
  let full = 0;
  for (const it of byDist) {
    let label = false;
    if (it.onScreen && it.dist <= C.LABEL_M && shown.length < C.LABEL_MAX) {
      label = shown.every(s => Math.hypot(s.sx - it.sx, s.sy - it.sy) >= C.MIN_PX);
      if (label) shown.push(it);
    }
    const was = prev.get(it.id) || 'full';
    const fullLim = C.FULL_M + (was === 'full' ? C.HYST : 0), farLim = C.FAR_M - (was === 'far' ? C.HYST : 0);
    let detail;
    if (it.dist > farLim) detail = 'far';
    else if (full < C.FULL_MAX && it.dist <= fullLim) { detail = 'full'; full++; }
    else detail = 'lite';
    out.set(it.id, { label, detail });
  }
  return out;
}
