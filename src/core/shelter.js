// Rain shelter map (pure). Rain falls straight down in world space, so a drop is visible only if no
// surface lies above it. We bake, per horizontal cell, the height of the TOPMOST covering surface:
// road decks (main + branch, full width + rail strip, rails' 1.5 m top), tunnel roofs and sky-deck
// slabs. The rain shader hides a streak whose head is below that height (one texture fetch per vertex,
// no per-frame raycasts). Conservative limitations (documented): cells are `cell` m and each surface
// sample is written into its cell and the 8 neighbours, so rain is also hidden up to ~1 cell beside a
// deck/wall below its top; buildings are not baked (their opaque walls/roofs occlude rain through the
// depth test); vehicle bodies occlude through the depth test (glass is transparent and does not).
import { TRK } from './track.js';
export const SHELTER = { cell: 4, side: 1.4, railTop: 1.5, tunnelRoof: 8, open: -1e4 };
export function buildShelter(td, decks = [], o = SHELTER) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const paths = [td.MAIN].concat(td.BR ? [td.BR] : []);
  for (const p of paths) for (const v of p.P) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
  for (const d of decks) { minX = Math.min(minX, d.x0); maxX = Math.max(maxX, d.x1); minZ = Math.min(minZ, d.z0); maxZ = Math.max(maxZ, d.z1); }
  const pad = 40, x0 = minX - pad, z0 = minZ - pad;
  const nx = Math.ceil((maxX + pad - x0) / o.cell) + 1, nz = Math.ceil((maxZ + pad - z0) / o.cell) + 1;
  const top = new Float32Array(nx * nz).fill(o.open);
  const put = (x, y, z) => {
    const ci = Math.round((x - x0) / o.cell), cj = Math.round((z - z0) / o.cell);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) { if (i < 0 || j < 0 || i >= nx || j >= nz) continue; const k = j * nx + i; if (y > top[k]) top[k] = y; }
  };
  for (const p of paths) for (let i = 0; i < p.N; i++) {
    const P = p.P[i], R = p.R[i], U = p.U[i];
    const dl = -(p.WL[i] + o.side), dr = p.WR[i] + o.side, n = Math.max(2, Math.ceil((dr - dl) / 2));
    const roof = p === td.MAIN && (p.tag[i] & TRK.TUNNEL);
    for (let k = 0; k <= n; k++) {
      const d = dl + (dr - dl) * k / n;
      for (const h of roof ? [0, o.railTop, o.tunnelRoof] : [0, o.railTop]) put(P.x + R.x * d + U.x * h, P.y + R.y * d + U.y * h, P.z + R.z * d + U.z * h);
    }
  }
  for (const d of decks) for (let z = d.z0; z <= d.z1; z += o.cell) for (let x = d.x0; x <= d.x1; x += o.cell) put(x, d.y + 10, z);
  return { x0, z0, cell: o.cell, nx, nz, top };
}
// nearest-cell lookup, identical to the shader's NearestFilter sample
export function shelterTop(sh, x, z) {
  const i = Math.round((x - sh.x0) / sh.cell), j = Math.round((z - sh.z0) / sh.cell);
  if (i < 0 || j < 0 || i >= sh.nx || j >= sh.nz) return SHELTER.open;
  return sh.top[j * sh.nx + i];
}
export const isSheltered = (sh, x, y, z, eps = 0.15) => y < shelterTop(sh, x, z) - eps;
