// Ground clearance (pure). The city ground is a flat plane at GROUND_Y, but banked, rolled and
// inverted road sections dip below it (e.g. Velocity's barrel roll: edge ~-14 m). Instead of
// lowering the whole city, we rasterise the swept solid of every road (main path + branch) onto
// a horizontal grid: full hull width incl. curbs/rails, from under the hull (-HULL) to the top
// of the vehicle/rail envelope (+ENVELOPE) along the local surface normal, so upright, banked,
// vertical and inverted sections are all covered. Each grid cell records the lowest y of any
// swept point within CLEAR_R horizontally, minus MARGIN. Where that is below GROUND_Y the ground
// is cut into a pit ("retaining" cut); everywhere else it stays exactly at GROUND_Y.
export const GROUND_Y = -0.06;
export const TERRAIN = { cell: 2, block: 20, envelope: 3.2, sideExtra: 1.4, clearR: 1.6, margin: 0.4, flatMargin: 0.05 };
// What must clear the ground: the drivable surface + curbs/rails strip (full width + sideExtra) and
// the vehicle/rail envelope (+envelope along the surface normal, i.e. BELOW the deck when inverted).
// The decorative hull skirt under an upright road is buried by design (v5b), so it is not swept.
// Required clearance: flatMargin for an upright surface point (v5b ground sits 6 cm below flat road),
// margin for everything else (banked/vertical/inverted surface, envelope).
export function clearanceMargin(o, h, Uy) { return h === 0 && Uy > 0.9 ? o.flatMargin : o.margin; }

// Iterate swept-solid sample points of a path: callback(x, y, z). Linear in h, so the two
// extremes (-hull, +envelope) bound the solid's y at every (sample, lateral offset).
export function sweepPath(path, cb, o = TERRAIN, off = 0) {
  for (let i = 0; i < path.N; i++) {
    const P = path.P[i], R = path.R[i], U = path.U[i];
    const dl = -(path.WL[i] + o.sideExtra), dr = path.WR[i] + o.sideExtra;
    const n = Math.max(2, Math.ceil(dr - dl));   // <=1 m steps, both edges included exactly
    for (let k = 0; k <= n; k++) { const d = dl + (dr - dl) * k / n;
      for (const h of [0, o.envelope]) cb(P.x + R.x * (d + off) + U.x * h, P.y + R.y * (d + off) + U.y * h, P.z + R.z * (d + off) + U.z * h, clearanceMargin(o, h, U.y));
    }
  }
}

// Returns { x0, z0, cell, nx, nz, req: Float32Array } where req is the required ground height
// (GROUND_Y where no cut is needed) and `blocks`: list of pit blocks (block-aligned rects).
export function buildClearance(td, o = TERRAIN) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  const paths = [td.MAIN].concat(td.BR ? [td.BR] : []);
  for (const p of paths) for (const v of p.P) { minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z); }
  const pad = 60, B = o.block;
  const x0 = Math.floor((minX - pad) / B) * B, z0 = Math.floor((minZ - pad) / B) * B;
  const nx = Math.ceil((maxX + pad - x0) / o.cell) + 1, nz = Math.ceil((maxZ + pad - z0) / o.cell) + 1;
  const req = new Float32Array(nx * nz).fill(GROUND_Y);
  const r = Math.ceil((o.clearR + o.cell) / o.cell);   // covers all 4 corners of any cell a swept point lies in (bilinear-safe)
  const put = (x, y, z, m) => {
    const lim = y - m; if (lim >= GROUND_Y) return;
    const ci = Math.round((x - x0) / o.cell), cj = Math.round((z - z0) / o.cell);
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      const dx = x0 + i * o.cell - x, dz = z0 + j * o.cell - z;
      if (dx * dx + dz * dz > (o.clearR + o.cell * 1.5) ** 2) continue;
      const k = j * nx + i; if (lim < req[k]) req[k] = lim;
    }
  };
  for (const p of paths) sweepPath(p, put, o);
  // pit blocks: block-aligned squares containing any cut cell, grown by one block of flat border
  const per = B / o.cell, bnx = Math.ceil(nx / per), bnz = Math.ceil(nz / per), cut = new Uint8Array(bnx * bnz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (req[j * nx + i] < GROUND_Y) cut[Math.floor(j / per) * bnx + Math.floor(i / per)] = 1;
  const blk = new Uint8Array(bnx * bnz);
  for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) if (cut[j * bnx + i]) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < bnx && jj < bnz) blk[jj * bnx + ii] = 1; }
  const blocks = []; for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) if (blk[j * bnx + i]) blocks.push([x0 + i * B, z0 + j * B]);
  return { x0, z0, cell: o.cell, nx, nz, req, block: B, blocks, opts: o };
}
// Ground height actually rendered at (x, z): bilinear over the cell grid (matches the mesh).
export function groundHeightAt(cl, x, z) {
  const fx = (x - cl.x0) / cl.cell, fz = (z - cl.z0) / cl.cell;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= cl.nx - 1 || j >= cl.nz - 1) return GROUND_Y;
  const tx = fx - i, tz = fz - j, g = (a, b) => cl.req[b * cl.nx + a];
  return (g(i, j) * (1 - tx) + g(i + 1, j) * tx) * (1 - tz) + (g(i, j + 1) * (1 - tx) + g(i + 1, j + 1) * tx) * tz;
}
// Worst clearance of the swept road solid vs a ground function (negative = intersection).
// Returns the worst (smallest) slack: clearance minus required margin (rawOnly: plain y - ground).
export function worstClearance(td, groundFn, o = TERRAIN, rawOnly = false) {
  let worst = { c: Infinity }; const paths = [['main', td.MAIN]].concat(td.BR ? [['branch', td.BR]] : []);
  for (const [name, p] of paths) for (let i = 0; i < p.N; i++) {
    const P = p.P[i], R = p.R[i], U = p.U[i];
    const dl = -(p.WL[i] + o.sideExtra), dr = p.WR[i] + o.sideExtra;
    for (let d = dl; d <= dr + 1e-6; d += 0.5) for (const h of [0, o.envelope / 2, o.envelope]) {
      const x = P.x + R.x * d + U.x * h, y = P.y + R.y * d + U.y * h, z = P.z + R.z * d + U.z * h;
      const c = y - groundFn(x, z) - (rawOnly ? 0 : clearanceMargin(o, h, U.y));   // >= 0 means OK
      if (c < worst.c) worst = { c, path: name, i, s: +(i * p.ds).toFixed(1), d: +d.toFixed(1), h, y: +y.toFixed(2), centreY: +P.y.toFixed(2) };
    }
  }
  return worst;
}
