// Ground clearance (pure). The city ground is a flat plane at GROUND_Y, but banked, rolled and
// inverted road sections dip below it (e.g. Velocity's barrel roll: edge ~-14 m). Instead of
// lowering the whole city, we rasterise the swept solid of every road (main path + branch) onto
// a horizontal grid: full road width plus a 1.4 m curb/rail strip each side, from the drivable
// surface (h = 0) to the top of the vehicle/rail envelope (h = +ENVELOPE) along the local surface
// normal, so upright, banked, vertical and inverted sections are all covered (the decorative hull
// skirt under an upright road is NOT swept: it is buried by design, as in v5b). Each grid cell
// records the lowest y of any swept point within CLEAR_R horizontally, minus the required margin. Where that is below GROUND_Y the ground
// is cut into a pit ("retaining" cut); everywhere else it stays exactly at GROUND_Y.
export const GROUND_Y = -0.06;
export const TERRAIN = { gantryHalf: 16, gantrySide: 3.4, gantryEnvelope: 15, cell: 2, block: 20, envelope: 3.2, sideExtra: 1.4, clearR: 1.6, margin: 0.4, flatMargin: 0.05, wallSlope: 4 };
// wallSlope: max rise per horizontal metre of the pit walls (4 = ~76 deg; steepest that keeps every pit inside the static building-exclusion proof). A chamfer distance pass shapes
// stepped grid cuts into smooth embankments; it only ever LOWERS cells, so clearance is preserved.
// What must clear the ground: the drivable surface + curbs/rails strip (full width + sideExtra) and
// the vehicle/rail envelope (+envelope along the surface normal, i.e. BELOW the deck when inverted).
// The decorative hull skirt under an upright road is buried by design (v5b), so it is not swept.
// Required clearance: flatMargin for an upright surface point (v5b ground sits 6 cm below flat road),
// margin for everything else (banked/vertical/inverted surface, envelope).
export function clearanceMargin(o, h, Uy) { return h === 0 && Uy > 0.9 ? o.flatMargin : o.margin; }

// Iterate swept-solid sample points of a path: callback(x, y, z, margin). Points every <= 1 m across
// the width and every <= 2 m along the surface normal from the surface (h = 0) to the envelope top.
// Sector/start gantries straddle the road (posts at W+2.2 m, beam/lamps up to ~14.2 m along U): within
// +-gantryHalf samples of each gantry the swept envelope widens/heightens so pits never bury them.
export function gantryZone(path, starts, o = TERRAIN) {
  const z = new Uint8Array(path.N); if (!starts) return z;
  for (const c of starts) for (let k = -o.gantryHalf; k <= o.gantryHalf; k++) z[((c + k) % path.N + path.N) % path.N] = 1;
  return z;
}
export function sweepPath(path, cb, o = TERRAIN, off = 0, zone = null) {
  for (let i = 0; i < path.N; i++) {
    const P = path.P[i], R = path.R[i], U = path.U[i], g = zone && zone[i];
    const side = g ? o.gantrySide : o.sideExtra, env = g ? o.gantryEnvelope : o.envelope;
    const dl = -(path.WL[i] + side), dr = path.WR[i] + side;
    const n = Math.max(2, Math.ceil(dr - dl));   // <=1 m steps, both edges included exactly
    for (let k = 0; k <= n; k++) { const d = dl + (dr - dl) * k / n;
      const nh = Math.max(1, Math.ceil(env / 2));   // <= 2 m along the normal: the envelope segment can span metres horizontally
      for (let q = 0; q <= nh; q++) { const h = env * q / nh; cb(P.x + R.x * (d + off) + U.x * h, P.y + R.y * (d + off) + U.y * h, P.z + R.z * (d + off) + U.z * h, clearanceMargin(o, h, U.y)); }
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
  const gz = gantryZone(td.MAIN, td.SECSTART, o);
  for (const p of paths) sweepPath(p, put, o, 0, p === td.MAIN ? gz : null);
  // slope-limited shaping: h <= h_neighbour + wallSlope * distance (two-pass 8-neighbour chamfer)
  const s1 = o.wallSlope * o.cell, s2 = o.wallSlope * o.cell * Math.SQRT2;
  for (let pass = 0; pass < 2; pass++) {
    const fwd = pass === 0, j0 = fwd ? 0 : nz - 1, j1 = fwd ? nz : -1, dj = fwd ? 1 : -1, i0 = fwd ? 0 : nx - 1, i1 = fwd ? nx : -1, di = dj;
    for (let j = j0; j !== j1; j += dj) for (let i = i0; i !== i1; i += di) {
      const k = j * nx + i; let v = req[k];
      const pj = j - dj, pi = i - di;
      if (pi >= 0 && pi < nx) v = Math.min(v, req[j * nx + pi] + s1);
      if (pj >= 0 && pj < nz) { v = Math.min(v, req[pj * nx + i] + s1); if (pi >= 0 && pi < nx) v = Math.min(v, req[pj * nx + pi] + s2); const qi = i + di; if (qi >= 0 && qi < nx) v = Math.min(v, req[pj * nx + qi] + s2); }
      req[k] = v;
    }
  }
  // pit blocks: block-aligned squares containing any cut cell, grown by one block of flat border
  const per = B / o.cell, bnx = Math.ceil(nx / per), bnz = Math.ceil(nz / per), cut = new Uint8Array(bnx * bnz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (req[j * nx + i] < GROUND_Y) cut[Math.floor(j / per) * bnx + Math.floor(i / per)] = 1;
  const blk = new Uint8Array(bnx * bnz);
  for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) if (cut[j * bnx + i]) for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < bnx && jj < bnz) blk[jj * bnx + ii] = 1; }
  const blocks = []; for (let j = 0; j < bnz; j++) for (let i = 0; i < bnx; i++) if (blk[j * bnx + i]) blocks.push([x0 + i * B, z0 + j * B]);
  return { x0, z0, cell: o.cell, nx, nz, req, block: B, blocks, opts: o };
}
// Ground height actually rendered at (x, z). The client mesh triangulates each cell as (a, c, b)
// and (b, c, d) with a = (i, j), b = (i+1, j), c = (i, j+1), d = (i+1, j+1): diagonal b-c. This
// reproduces that exact piecewise-planar surface (not bilinear). Outside the grid: flat GROUND_Y.
export function groundHeightAt(cl, x, z) {
  const fx = (x - cl.x0) / cl.cell, fz = (z - cl.z0) / cl.cell;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= cl.nx - 1 || j >= cl.nz - 1) return GROUND_Y;
  const tx = fx - i, tz = fz - j, g = (a, b) => cl.req[b * cl.nx + a];
  const A = g(i, j), Bv = g(i + 1, j), Cv = g(i, j + 1), D = g(i + 1, j + 1);
  return tx + tz <= 1 ? A + (Bv - A) * tx + (Cv - A) * tz : D + (Cv - D) * (1 - tx) + (Bv - D) * (1 - tz);
}
// Worst clearance of the swept road solid vs a ground function (negative = intersection).
// Returns the worst (smallest) slack: clearance minus required margin (rawOnly: plain y - ground).
export function worstClearance(td, groundFn, o = TERRAIN, rawOnly = false, sub = 1, lat = 0.5) {
  let worst = { c: Infinity }; const paths = [['main', td.MAIN]].concat(td.BR ? [['branch', td.BR]] : []);
  const lerp = (a, b, t) => a + (b - a) * t, gz = gantryZone(td.MAIN, td.SECSTART, o);
  for (const [name, p] of paths) for (let i = 0; i < p.N; i++) for (let q = 0; q < sub; q++) {
    // intermediate longitudinal samples between path samples i and i+1 (sub per metre), frames interpolated
    const t = q / sub, j = p.closed ? (i + 1) % p.N : Math.min(p.N - 1, i + 1), A = p, f = (k, c) => lerp(A[k][i][c], A[k][j][c], t);
    const P = { x: f('P', 'x'), y: f('P', 'y'), z: f('P', 'z') }, R = { x: f('R', 'x'), y: f('R', 'y'), z: f('R', 'z') }, U = { x: f('U', 'x'), y: f('U', 'y'), z: f('U', 'z') };
    const g = p === td.MAIN && gz[i] && gz[j], side = g ? o.gantrySide : o.sideExtra, env = g ? o.gantryEnvelope : o.envelope;
    const dl = -(lerp(p.WL[i], p.WL[j], t) + side), dr = lerp(p.WR[i], p.WR[j], t) + side;
    for (let d = dl; d <= dr + 1e-6; d += lat) for (let qh = 0, nh = Math.max(2, Math.ceil(env / 1)); qh <= nh; qh++) { const h = env * qh / nh;
      const x = P.x + R.x * d + U.x * h, y = P.y + R.y * d + U.y * h, z = P.z + R.z * d + U.z * h;
      const c = y - groundFn(x, z) - (rawOnly ? 0 : clearanceMargin(o, h, U.y));   // >= 0 means OK
      if (c < worst.c) worst = { c, path: name, i, s: +((i + t) * p.ds).toFixed(2), d: +d.toFixed(1), h, y: +y.toFixed(2), centreY: +P.y.toFixed(2) };
    }
  }
  return worst;
}
