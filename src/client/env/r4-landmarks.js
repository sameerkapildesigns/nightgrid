// R4 distant landmarks (client-only, cosmetic). No core / sim / net / record code reads any of this.
//
// buildR4Landmarks(scene, td, theme) -> THREE.Group with at most TWO merged meshes (body + glow) and
// <= R4_LANDMARK_TRI_BUDGET triangles in total. Add it to the map-local environment group. On map unload,
// dispose it through that group's normal traversal, or call disposeR4Landmarks(group).
//
// Safety rules, enforced per object BEFORE its geometry is accepted:
//  - Horizontal distance from the object's centre to EVERY sampled road point (td.MAIN, plus td.BR when that
//    array exists) must be >= road half width + object bounding radius + MARGIN. Height does not matter, so
//    nothing can overhang or sit above any road, at any elevation.
//  - Every object stands on the ground (base at BASE_Y). The kit has no roofs, decks or hanging parts.
//  - Footprints never overlap each other or the reserved circuit-landmarks.js features.
// Placement distance follows the scene fog (read only; fog is never changed) so silhouettes stay visible
// from the course instead of being fogged out entirely.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
 
export const R4_LANDMARK_TRI_BUDGET = 3000;
const MARGIN = 45;   // m kept clear beyond road edge + object bounding radius
const BASE_Y = -4;   // bases sink slightly below the y = 0 ground plane: no floating gaps
const GAP = 14;      // m between landmark footprints
const SEED = { velocity: 901, technical: 902, legacy: 903, casino: 904, summit: 905, drift: 906 };
 
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const C = (r, g, b) => new THREE.Color(r, g, b);
const glowOf = (c, k, fallback) => (c && c.isColor ? c.clone() : fallback.clone()).multiplyScalar(k);
const hwAt = (path, i) => Math.max(path.WL ? path.WL[i] || 0 : 0, path.WR ? path.WR[i] || 0 : 0) || 12;
 
// Distance at which the current fog is ~63 % opaque (FogExp2: 1 / density). Read only.
function visibleRange(scene) {
  const f = scene && scene.fog; let v = 600;
  if (f && f.isFogExp2 && f.density > 0) v = 1 / f.density;
  else if (f && f.isFog) v = f.near + (f.far - f.near) * 0.55;
  return Math.min(900, Math.max(220, v));
}
 
// Spatial index over every sampled road point (every 2nd sample, ~2 m) with its own half width.
function roadIndex(paths) {
  const CELL = 64, grid = new Map(); let maxHW = 0;
  for (const path of paths) {
    if (!path || !path.P) continue;
    for (let i = 0; i < path.P.length; i += 2) {
      const p = path.P[i]; if (!p) continue;
      const hw = hwAt(path, i); if (hw > maxHW) maxHW = hw;
      const key = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL);
      let a = grid.get(key); if (!a) grid.set(key, a = []); a.push(p.x, p.z, hw);
    }
  }
  return {
    clear(x, z, br) {
      const R = Math.ceil((maxHW + br + MARGIN) / CELL), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
        const arr = grid.get((cx + a) + ',' + (cz + b)); if (!arr) continue;
        for (let j = 0; j < arr.length; j += 3) {
          const dx = arr[j] - x, dz = arr[j + 1] - z, lim = arr[j + 2] + br + MARGIN;
          if (dx * dx + dz * dz < lim * lim) return false;
        }
      }
      return true;
    }
  };
}
 
// Horizontal frame at main-circuit sample i, derived from P only (tangent t, left normal n).
// Returns null where the road is near-vertical (loop / barrel), so no station is taken there.
function frame(M, i) {
  const P = M.P, N = P.length; i = ((i % N) + N) % N;
  const p = P[i], a = P[(i - 12 + N) % N], b = P[(i + 12) % N];
  let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz);
  if (!(l > 2)) return null;
  tx /= l; tz /= l;
  return { p, tx, tz, nx: -tz, nz: tx, hw: hwAt(M, i) };
}
 
// ---------- object kit: local coords, origin at ground centre, +y up ----------
function obj() { return { body: [], glow: [], br: -1, tris: 0 }; }
// Bakes a flat vertex colour (body parts get cheap fake sky shading from the normal), then strips normal / uv
// so every part shares the same attribute set (position + color) for mergeGeometries.
function paint(geo, col, shade) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = shade && nrm ? 0.62 + 0.38 * Math.max(0, nrm.getY(i)) + 0.12 * nrm.getX(i) : 1;
    c[i * 3] = col.r * k; c[i * 3 + 1] = col.g * k; c[i * 3 + 2] = col.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
  return geo;
}
function add(o, kind, geo, col) {
  paint(geo, col, kind === 'body'); o[kind].push(geo);
  o.tris += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
}
const boxG = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z);   // y = bottom
function radius(o) {
  if (o.br < 0) {
    let r = 0;
    for (const g of o.body.concat(o.glow)) { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)); if (d > r) r = d; } }
    o.br = r;
  }
  return o.br;
}
function disposeObj(o) { for (const g of o.body.concat(o.glow)) g.dispose(); }
 
function pyramid(h, r, body, A, B) {                          // square pyramid with neon tier rings
  const o = obj(), hw0 = r * Math.SQRT1_2;
  add(o, 'body', new THREE.ConeGeometry(r, h, 4, 1, true).rotateY(Math.PI / 4).translate(0, h / 2, 0), body);
  [0.18, 0.38, 0.58, 0.78].forEach((f, k) => { const hw = hw0 * (1 - f) + 0.7; add(o, 'glow', boxG(hw * 2, 1.1, hw * 2, 0, f * h - 0.55, 0), k % 2 ? B : A); });
  add(o, 'glow', boxG(3, 3, 3, 0, h - 1.5, 0), A);
  return o;
}
function gateway(R, body, A, B) {                             // standing double ring on a plinth (faces the road)
  const o = obj(), cy = R + 9;
  add(o, 'body', boxG(R * 1.2, 9, 12, 0, 0, 0), body);
  for (const sx of [-1, 1]) add(o, 'body', boxG(3, R * 0.14 + 2, 3, sx * R * 0.5, 8, 0), body);
  add(o, 'glow', new THREE.TorusGeometry(R, 1.7, 4, 40).translate(0, cy, 0), A);
  add(o, 'glow', new THREE.TorusGeometry(R * 0.82, 0.9, 4, 36).translate(0, cy, 0), B);
  return o;
}
function crane(red, white, dark, tip, top) {                  // ship-to-shore crane, boom along +x (away from road)
  const o = obj();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(o, 'body', boxG(1.6, 52, 1.6, sx * 10, 0, sz * 8), red);
  for (const sz of [-1, 1]) add(o, 'body', boxG(21.6, 2, 1.6, 0, 38, sz * 8), white);
  add(o, 'body', boxG(95, 3, 4, 18, 52, 0), red);             // boom x -29.5 .. 65.5
  add(o, 'body', boxG(10, 5, 7, -23, 55, 0), white);          // machinery house
  add(o, 'body', boxG(1.6, 20, 1.6, -6, 55, 0), red);         // A-frame mast
  add(o, 'body', boxG(4, 3, 5, 26, 49, 0), dark);             // trolley / cab under the boom
  add(o, 'glow', boxG(2, 2, 2, 64, 55, 0), tip);
  add(o, 'glow', boxG(2, 2, 2, -6, 75, 0), top);
  return o;
}
function breakwater(body, white, band, lamp) {                // low mole along +x with a lighthouse on its head
  const o = obj();
  add(o, 'body', boxG(70, 6, 10, -30, 0, 0), body);
  add(o, 'body', new THREE.CylinderGeometry(3.2, 5, 34, 8, 1, true).translate(0, 23, 0), white);
  add(o, 'body', new THREE.CylinderGeometry(4.65, 4.65, 3, 8, 1, true).translate(0, 15.5, 0), band);
  add(o, 'body', new THREE.CylinderGeometry(4.05, 4.05, 3, 8, 1, true).translate(0, 27.5, 0), band);
  add(o, 'glow', new THREE.CylinderGeometry(2.6, 2.6, 4, 8).translate(0, 42, 0), lamp);
  add(o, 'body', new THREE.ConeGeometry(3.4, 3, 8).translate(0, 45.5, 0), white);
  return o;
}
function peak(h, r, sq, rock, snow, beacon) {                 // bare mountain with a snow cap
  const o = obj();
  add(o, 'body', new THREE.ConeGeometry(r, h, 9, 1, true).scale(1, 1, sq).translate(0, h / 2, 0), rock);
  add(o, 'body', new THREE.ConeGeometry(r * 0.34, h * 0.32, 9, 1, true).scale(1, 1, sq).translate(0, h * 0.84, 0), snow);
  if (beacon) add(o, 'glow', boxG(4, 4, 4, 0, h - 2, 0), beacon);
  return o;
}
function shed(L, wall, roof, A, B) {                          // low waterfront shed, lanterns on +z (road side)
  const o = obj();
  add(o, 'body', boxG(L, 13, 16, 0, 0, 0), wall);
  add(o, 'body', boxG(L + 2, 1, 19, 0, 13, 0), roof);
  add(o, 'glow', boxG(L + 2.2, 0.45, 0.5, 0, 12.6, 9.6), A);
  let k = 0; for (let x = -L / 2 + 6; x <= L / 2 - 6; x += 12, k++) add(o, 'glow', boxG(1.1, 1.6, 1.1, x, 8.5, 8.6), k % 2 ? B : A);
  return o;
}
function pagoda(wall, roof, A, B) {                           // three low tiers, ~25 m above ground
  const o = obj(); let y = 0;
  [[14, 9], [10.5, 5.5], [7.5, 4.5]].forEach(([w, h], k) => {
    add(o, 'body', boxG(w, h, w, 0, y, 0), wall); y += h;
    add(o, 'body', boxG(w + 5, 0.9, w + 5, 0, y, 0), roof);
    add(o, 'glow', boxG(w + 5.3, 0.3, w + 5.3, 0, y - 0.1, 0), k % 2 ? B : A); y += 0.9;
  });
  add(o, 'body', boxG(0.6, 6, 0.6, 0, y, 0), wall);
  add(o, 'glow', boxG(1.2, 1.2, 1.2, 0, y + 6, 0), A);
  return o;
}
function gate(post, A) {                                      // waterside gate, faces the road
  const o = obj();
  for (const sx of [-1, 1]) add(o, 'body', boxG(1.4, 18, 1.4, sx * 6, 0, 0), post);
  add(o, 'body', boxG(13.5, 0.8, 1, 0, 14, 0), post);
  add(o, 'glow', boxG(17, 1.2, 1.8, 0, 18, 0), A);
  return o;
}
function mast(H, body, A, B) {                                // Velocity: slender lattice mast, crossed light bars
  const o = obj();
  add(o, 'body', boxG(9, 4, 9, 0, 0, 0), body);
  add(o, 'body', boxG(2.2, H, 2.2, 0, 0, 0), body);
  [0.45, 0.62, 0.79].forEach((f, k) => add(o, 'glow', boxG(k % 2 ? 0.5 : 10, 0.5, k % 2 ? 10 : 0.5, 0, f * H, 0), k === 1 ? B : A));
  add(o, 'glow', boxG(2.4, 2.4, 2.4, 0, H, 0), B);
  return o;
}
function guyed(H, body, A, B, red) {                          // Legacy: banded broadcast mast with a platform disc
  const o = obj();
  add(o, 'body', boxG(1.6, H, 1.6, 0, 0, 0), body);
  for (let k = 1; k <= 5; k++) add(o, 'glow', boxG(2.1, 3, 2.1, 0, H * k / 6.3, 0), k % 2 ? A : B);
  add(o, 'body', new THREE.CylinderGeometry(7, 7, 1.2, 10).translate(0, H * 0.86, 0), body);
  add(o, 'glow', boxG(2.2, 2.2, 2.2, 0, H, 0), red);
  return o;
}
 
// ---------- placement ----------
function placer(index, budget) {
  const placed = [], body = [], glow = []; let tris = 0;
  return {
    body, glow, placed, get tris() { return tris; },
    reserve(x, z, r) { placed.push({ x, z, r, lm: false }); },
    put(o, x, z, ry) {
      const br = radius(o);
      if (tris + o.tris > budget) return false;
      if (!index.clear(x, z, br)) return false;
      for (const q of placed) if (Math.hypot(q.x - x, q.z - z) < q.r + br + GAP) return false;
      for (const g of o.body) body.push(g.rotateY(ry).translate(x, BASE_Y, z));
      for (const g of o.glow) glow.push(g.rotateY(ry).translate(x, BASE_Y, z));
      placed.push({ x, z, r: br, lm: true }); tris += o.tris;
      return true;
    }
  };
}
// face: 'road' local +z toward the road | 'away' local +x away from the road | 'along' local +x along the
// tangent with +z toward the road | 'rand'.  rotateY(a): +x -> (cos a, -sin a), +z -> (sin a, cos a).
function yaw(f, s, face, r) {
  if (face === 'rand') return r() * Math.PI * 2;
  const ax = f.nx * s, az = f.nz * s;                          // unit vector road -> object
  if (face === 'away') return Math.atan2(-az, ax);
  if (face === 'road') return Math.atan2(-ax, -az);
  return Math.atan2(-f.tz, f.tx) + (s > 0 ? Math.PI : 0);
}
// count objects spread evenly round the circuit; on failure retry other stations, then smaller scales.
function scatter(ctx, count, make, { near = 0, far = 0, side = 'alt', face = 'rand', phase = 0 } = {}) {
  const { M, N, r, pl } = ctx; let n = 0;
  for (let k = 0; k < count; k++) {
    let done = false;
    for (const sc of [1, 0.72, 0.5]) {
      const ob = make(k, sc);
      for (let t = 0; t < 4 && !done; t++) {
        const f = frame(M, Math.floor(((k + phase + 0.37 * t + (r() - 0.5) * 0.3) / count) * N + N));
        if (!f) continue;
        const s = side === 'alt' ? ((k + t) % 2 ? 1 : -1) : side === 'rand' ? (r() < 0.5 ? -1 : 1) : side;
        const d = f.hw + radius(ob) + MARGIN + 2 + near + r() * (far - near);
        done = pl.put(ob, f.p.x + f.nx * s * d, f.p.z + f.nz * s * d, yaw(f, s, face, r));
      }
      if (done) { n++; break; }
      disposeObj(ob);
    }
  }
  return n;
}
// count objects in a line parallel to the road at one station (crane quay, paired masts).
function row(ctx, count, spacing, make, { phase = 0, side = 1, near = 0, far = 0, face = 'rand' } = {}) {
  const { M, N, r, pl } = ctx;
  for (let t = 0; t < 6; t++) {
    const f = frame(M, Math.floor((phase + t * 0.071) * N)); if (!f) continue;
    let got = 0, d = -1;
    for (let c = 0; c < count; c++) {
      const ob = make(c);
      if (d < 0) d = f.hw + radius(ob) + MARGIN + 2 + near + r() * (far - near);
      const u = (c - (count - 1) / 2) * spacing;
      const x = f.p.x + f.nx * side * d + f.tx * u, z = f.p.z + f.nz * side * d + f.tz * u;
      if (pl.put(ob, x, z, yaw(f, side, face, r))) got++; else disposeObj(ob);
    }
    if (got) return got;
  }
  return 0;
}
// Keep clear of features circuit-landmarks.js builds at fixed stations (same s / M.ds maths, both sides).
function reserveStations(ctx, list) {
  const { M, pl } = ctx; if (!(M.ds > 0)) return;
  for (const [s, off, rad] of list) {
    const f = frame(M, Math.round(s / M.ds)); if (!f) continue;
    for (const sg of [-1, 1]) pl.reserve(f.p.x + f.nx * sg * off, f.p.z + f.nz * sg * off, rad);
  }
}
 
// ---------- per-map identity ----------
const RECIPES = {
  casino(ctx) {               // pyramids with neon tiers + one standing ring
    const { th, V, r } = ctx, body = C(0.035, 0.022, 0.02);
    const A = glowOf(th.edge && th.edge.a, 0.7, C(3.2, 1.8, 0.35)), B = glowOf(th.edge && th.edge.b, 0.7, C(3.0, 0.3, 0.45));
    reserveStations(ctx, [[1475, 120, 48],
      ...[700, 1050, 1500, 2150, 3400, 4000, 4700].map(s => [s, 105, 36]),
      ...[1000, 1800, 3300, 4300].map(s => [s, 85, 36])]);
    scatter(ctx, 1, (k, sc) => gateway(70 * sc, body, A, B), { near: 0.05 * V, far: 0.2 * V, face: 'road', phase: 0.55 });
    scatter(ctx, 5, (k, sc) => pyramid((95 + r() * 70) * sc, (62 + r() * 30) * sc, body, A, B), { near: 0.1 * V, far: 0.45 * V });
  },
  technical(ctx) {            // Kage: two quay rows of big cranes + breakwater lighthouses
    const { th, V } = ctx, red = C(0.2, 0.05, 0.025), white = C(0.22, 0.22, 0.24), dark = C(0.03, 0.03, 0.035);
    const amber = glowOf(th.edge && th.edge.a, 0.8, C(3.2, 1.5, 0.2)), redL = C(3.0, 0.25, 0.15), lamp = C(3.0, 2.2, 1.0);
    for (const [phase, side] of [[0.18, 1], [0.66, -1]])
      row(ctx, 4, 38, () => crane(red, white, dark, amber, redL), { phase, side, near: 0.05 * V, far: 0.3 * V, face: 'away' });
    scatter(ctx, 2, () => breakwater(dark, white, C(0.3, 0.04, 0.03), lamp), { near: 0.1 * V, far: 0.35 * V, face: 'along', phase: 0.4 });
  },
  summit(ctx) {               // exposed range well above the 180 m road
    const { th, V, r } = ctx, rock = C(0.018, 0.022, 0.032), snow = C(0.16, 0.19, 0.25);
    const red = glowOf(th.edge && th.edge.b, 0.8, C(2.8, 0.3, 0.4));
    reserveStations(ctx, [2500, 2580, 2660, 2740].map(s => [s, 55, 8]));
    scatter(ctx, 12, (k, sc) => peak((300 + r() * 130) * sc, (150 + r() * 80) * sc, 0.6 + r() * 0.4, rock, snow, k % 4 === 0 ? red : null), { far: 0.3 * V, side: 'rand' });
    scatter(ctx, 14, (k, sc) => peak((150 + r() * 80) * sc, (85 + r() * 45) * sc, 0.55 + r() * 0.45, rock, snow, null), { far: 0.2 * V, side: 'rand', phase: 0.5 });
  },
  drift(ctx) {                // Shinrai: low waterfront sheds, pagodas, gates (all low, kept nearer)
    const { th, V, r } = ctx, wall = C(0.02, 0.035, 0.04), roof = C(0.012, 0.018, 0.022);
    const A = glowOf(th.edge && th.edge.a, 0.7, C(0.4, 2.7, 1.3)), B = glowOf(th.edge && th.edge.b, 0.7, C(1.6, 0.6, 2.8));
    scatter(ctx, 6, (k, sc) => shed(Math.round((54 + r() * 30) * sc), wall, roof, A, B), { far: 0.18 * V, face: 'along' });
    scatter(ctx, 2, () => pagoda(wall, roof, A, B), { near: 0.02 * V, far: 0.2 * V, face: 'road', phase: 0.25 });
    scatter(ctx, 3, () => gate(wall, B), { far: 0.12 * V, face: 'road', phase: 0.4 });
  },
  velocity(ctx) {             // evenly spaced single masts, cyan / violet
    const { th, V, r } = ctx, body = C(0.02, 0.024, 0.04);
    const A = glowOf(th.edge && th.edge.a, 0.7, C(0, 2.4, 3.0)), B = glowOf(th.edge && th.edge.b, 0.8, C(1.3, 0.6, 3.2));
    scatter(ctx, 10, (k, sc) => mast((150 + r() * 80) * sc, body, A, B), { near: 0.15 * V, far: 0.45 * V });
  },
  legacy(ctx) {               // paired banded masts, magenta / blue: different rhythm from Velocity
    const { th, V, r } = ctx, body = C(0.025, 0.015, 0.03), red = C(3.0, 0.25, 0.3);
    const A = glowOf(th.edge && th.edge.a, 0.6, C(3.2, 0.4, 2.4)), B = glowOf(th.edge && th.edge.b, 0.6, C(0.4, 1.6, 3.2));
    for (let k = 0; k < 5; k++)
      row(ctx, 2, 46, () => guyed(110 + r() * 50, body, A, B, red), { phase: k / 5 + 0.1, side: k % 2 ? 1 : -1, near: 0.1 * V, far: 0.35 * V });
  }
};
 
export function buildR4Landmarks(scene, td, theme) {
  const group = new THREE.Group(); group.name = 'r4-landmarks';
  const M = td && td.MAIN; if (!M || !M.P || M.P.length < 64) return group;
  const key = td.key || (theme && theme.key) || 'velocity';
  const recipe = RECIPES[key] || RECIPES.velocity;
  // td.BR (independent branch array) is read only if present; omitted, branches far from MAIN are untested.
  const ctx = { M, N: M.P.length, r: rng(SEED[key] || 900), V: visibleRange(scene), th: theme || {},
    pl: placer(roadIndex([M, td.BR]), R4_LANDMARK_TRI_BUDGET) };
  recipe(ctx);
  const mk = (list, mat, name) => {
    if (!list.length) { mat.dispose(); return; }
    const g = mergeGeometries(list, false); for (const x of list) x.dispose();
    if (!g) { mat.dispose(); return; }
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = name; m.matrixAutoUpdate = false; group.add(m);
  };
  mk(ctx.pl.body, new THREE.MeshBasicMaterial({ vertexColors: true }), 'r4-landmarks-body');
  mk(ctx.pl.glow, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), 'r4-landmarks-glow');
  group.userData.r4Landmarks = { key, tris: ctx.pl.tris, objects: ctx.pl.placed.filter(q => q.lm).length, footprints:ctx.pl.placed.filter(q=>q.lm).map(q=>({x:q.x,z:q.z,r:q.r})), range: Math.round(ctx.V) };
  return group;
}
 
export function disposeR4Landmarks(group) {
  if (!group) return;
  group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  if (group.parent) group.parent.remove(group);
}
 
