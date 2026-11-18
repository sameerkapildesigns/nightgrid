// M8 track hazards + pickups (pure, deterministic; no RNG, no Three.js).
// Layout is derived ONLY from track geometry, so the room server, the client predictor and the renderer all
// build the identical list from the map key. Obstacles are static data checked like road traffic (no physics
// bodies). Pickup pads are shared state owned by whoever runs the authoritative sim (the room server); clients
// only predict and are overwritten by the server's pad state every tick.
import { mod } from './math.js';

export const HAZ = {
  OB_HALF_LEN: 1.2, OB_HALF_W: 1.6, OB_HEIGHT: 1.6,   // obstacle block (metres, track space)
  CAR_HALF_LEN: 2.6, CAR_HALF_W: 1.4,                  // racer contact box (same as the drone model)
  OB_SPEED_KEEP: 0.6, OB_MAX_LOSS: 35, OB_GLANCE: 6, OB_DEBOUNCE: 0.5,
  START_CLEAR: 300, SEAM_CLEAR: 100, RUNUP: 120, RUNUP_K: 1 / 260, MIN_UPY: 0.8, OB_SPACING: 180, PAD_CLEAR: 80,
  PAD_HALF_LEN: 3.0, PAD_HALF_W: 2.0, PAD_RESPAWN: 6, CLAIM_COOLDOWN: 6,
  SHIELD_TIME: 15, SHIELD_PASS: 0.4, SURGE_TIME: 1.8,
  DRONE_HOP: 2.8, DRONE_HOP_RANGE: 9
};
export const OB_COUNT = { velocity: 4, technical: 3, legacy: 4 };
// Two pickup rows per lap: kinds across the road (left, centre, right). S = shield, B = self-boost.
export const PAD_ROWS = [['S', 'B', 'S'], ['B', 'S', 'B']];
const ROW_FRAC = [0.3, 0.75];

// Candidate check for a main-path station i (1 m spacing on every map).
function okStation(td, i, opt) {
  const M = td.MAIN, N = M.N, ds = M.ds, s = i * ds;
  const fromStart = Math.min(mod(s - 60, M.L), mod(60 - s, M.L));   // S0 = 60
  if (fromStart < HAZ.START_CLEAR) return false;
  if (Math.min(s, M.L - s) < HAZ.SEAM_CLEAR) return false;
  if (td.HASBR && s > td.SAm - 280 && s < td.SBm + 160) return false;   // fork, loop branch and merge
  const back = Math.round(HAZ.RUNUP / ds), fwd = Math.round(30 / ds);
  for (let k = -back; k <= fwd; k++) {
    const j = mod(i + k, N);
    if (M.tag[j] & 1) return false;                         // tunnel
    if (M.U[j].y < HAZ.MIN_UPY) return false;               // loop / roll / steep bank
    if (Math.abs(M.KG[j]) > HAZ.RUNUP_K) return false;      // corner in the run-up: not visible early enough
    if (Math.abs(M.WL[j] - M.W[j]) > 0.01 || Math.abs(M.WR[j] - M.W[j]) > 0.01) return false;   // widening (fork lane)
  }
  for (const a of opt.avoid || []) if (Math.min(mod(s - a.s, M.L), mod(a.s - s, M.L)) < a.c) return false;   // {s, clearance}
  return true;
}
// nearest valid station to a target fraction of the lap (searching both ways), or -1
function nearestOk(td, frac, opt) {
  const M = td.MAIN, i0 = Math.round(mod(60 + frac * M.L, M.L) / M.ds);
  for (let k = 0; k < M.N / 2; k += 5) for (const sg of [1, -1]) { const i = mod(i0 + sg * k, M.N); if (okStation(td, i, opt)) return i; }
  return -1;
}

// Deterministic layout for a track (cached on the track data object).
export function buildHazards(td) {
  if (td.hazards) return td.hazards;
  const M = td.MAIN, W = td.W0;
  const pads = [], rowS = [];
  PAD_ROWS.forEach((kinds, r) => {
    const i = nearestOk(td, ROW_FRAC[r], { avoid: rowS.map(s => ({ s, c: 400 })) });
    if (i < 0) return;
    const s = i * M.ds; rowS.push(s);
    kinds.forEach((kind, c) => pads.push({ s, d: (c - 1) * 0.5 * W, kind, row: r }));
  });
  const n = OB_COUNT[td.key] || 4, obs = [];
  for (let k = 0; k < n; k++) {
    const avoid = rowS.map(s => ({ s, c: HAZ.PAD_CLEAR })).concat(obs.map(o => ({ s: o.s, c: HAZ.OB_SPACING })));
    const i = nearestOk(td, (k + 0.5) / n, { avoid });
    if (i < 0) continue;
    obs.push({ s: i * M.ds, d: 0, hl: HAZ.OB_HALF_LEN, hw: HAZ.OB_HALF_W, h: HAZ.OB_HEIGHT });
  }
  obs.sort((a, b) => a.s - b.s);
  obs.forEach((o, k) => { o.d = (k % 2 ? 1 : -1) * 0.4 * W; });   // alternate sides in driving order
  return (td.hazards = { obstacles: obs, pads });
}
// signed shortest along-track gap b - a on a closed loop of length L
export const gapS = (a, b, L) => { let g = b - a; if (g > L / 2) g -= L; if (g < -L / 2) g += L; return g; };
// pad state codec for the 20 Hz tick: remaining respawn seconds (2 dp), 0 = ready
export const encodePads = (pads, t) => pads.map(p => (p.readyAt > t ? Math.round((p.readyAt - t) * 100) / 100 : 0));
export function applyPads(pads, enc, t) { if (!Array.isArray(enc)) return; for (let k = 0; k < pads.length && k < enc.length; k++) pads[k].readyAt = enc[k] > 0 ? t + enc[k] : 0; }
// power flags for remote-car presentation: 1 = shield armed, 2 = surge active
export const powerFlags = r => ((r.shieldT > 0 ? 1 : 0) | (r.surgeT > 0 ? 2 : 0));
