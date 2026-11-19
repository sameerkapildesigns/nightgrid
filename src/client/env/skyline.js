// M8 themed skyline + road-edge dressing (client-only, visual). Explicit inputs, no game.js globals:
//   ctx = { THEME, MAIN, BR, WB, deckTopAt(x,z), isOpen(i) }  (isOpen: main sample not in a tunnel / fork zone)
// Own seeded RNG per map, so the shared client RNG stream (city layout) is not consumed or reordered.
// Everything is instanced or merged: each feature family is one draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const SEED = { velocity: 801, technical: 802, legacy: 803, casino: 804, summit: 805 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
function put(im, k, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) { _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); im.setMatrixAt(k, _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))); }
function inst(geo, mat, n, name) { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, n)); im.count = n; im.name = name; return im; }
function vcol(geo, col) { geo = geo.index ? geo.toNonIndexed() : geo; for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k); const n = geo.attributes.position.count, c = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.set([col.r, col.g, col.b], i * 3); geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo; }

// Track clearance: any addition must stay >= 18 m under elevated road (same rule as buildCity) and
// >= 120 m under a sky deck.
function clearance(ctx) {
  const CELL = 40, grid = new Map(), add = (path, W) => { for (let i = 0; i < path.N; i += 3) { const p = path.P[i]; const k = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([p.x, p.y, p.z, W(i)]); } };
  add(ctx.MAIN, i => Math.max(ctx.MAIN.WL[i], ctx.MAIN.WR[i])); if (ctx.BR) add(ctx.BR, () => ctx.WB + 2);
  return (x, z, hd, top) => {
    const deck = ctx.deckTopAt(x, z); if (deck && top > deck - 120) return false;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) { const arr = grid.get((cx + a) + ',' + (cz + b)); if (arr) for (const s of arr) if (Math.hypot(s[0] - x, s[2] - z) < s[3] + 11 + hd && top > s[1] - 18) return false; }
    return true;
  };
}

// Called inside buildCity BEFORE the building InstancedMesh is made. Reshapes the planned ground buildings
// (heights only, never footprints, so the track/pit clearance tests still hold) and appends setback tiers that
// reuse the window material. Returns per-building annotations used by buildSkyline().
export function shapeBuildings(ctx, bList, signLists = []) {
  const T = ctx.THEME, r = rng(SEED[T.key] || 800), ok = clearance(ctx), ann = { yards: [], warehouses: [], towers: [] };
  const ground = bList.filter(b => b.y0 === 0);
  // buildCity's b.td is only exact within 64 m (999 beyond): measure true horizontal distance to the circuit here
  { const CELL = 60, g = new Map(), M = ctx.MAIN; for (let i = 0; i < M.N; i += 4) { const p = M.P[i], k = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL); if (!g.has(k)) g.set(k, []); g.get(k).push(p); }
    for (const b of ground) { b.tdx = b.td; if (b.td < 64) continue; const cx = Math.floor(b.x / CELL), cz = Math.floor(b.z / CELL); let best = 1e9;
      for (let a = -6; a <= 6; a++) for (let c = -6; c <= 6; c++) { const arr = g.get((cx + a) + ',' + (cz + c)); if (arr) for (const p of arr) { const d = Math.hypot(p.x - b.x, p.z - b.z); if (d < best) best = d; } }
      b.tdx = Math.min(b.td, best); } }   // tdx, not td: game.js short-circuits RNG draws on td
  if(T.key==='casino'){const i=Math.round(1475/ctx.MAIN.ds),p=ctx.MAIN.P[i],r=ctx.MAIN.R[i],n=Math.hypot(r.x,r.z),x=p.x-r.x/n*120,z=p.z-r.z/n*120;for(const b of ground)if(Math.hypot(b.x-x,b.z-z)<90)b.h=Math.min(b.h,5);}
  if (T.skyline === 'harbour') {
    // remove the generic roof boxes; waterfront is low and long, with a few dusk towers inland
    for (let i = bList.length - 1; i >= 0; i--) if (bList[i].y0 > 0) bList.splice(i, 1);
    for (const b of ground) {
      if (b.tdx < 300) {
        const yard = b.tdx > 34 && b.tdx < 190 && r() < 0.3;
        if (yard) { b.h = 2.2; ann.yards.push(b); continue; }
        b.h = Math.min(b.h, 13 + r() * 17); ann.warehouses.push(b);
      } else {
        b.h *= T.building.heightMul;
        if (b.h > 70 && r() < 0.5) ann.towers.push(b);
      }
    }
  } else {
    for (const b of ground) {
      if (b.h < 55) continue;
      const hd = Math.hypot(b.w, b.d) / 2;
      // setback tiers: 0.78 then 0.52 footprint, both window-textured
      let top = b.h; const tiers = b.h > 110 ? 2 : 1;
      for (let t = 0; t < tiers; t++) {
        const f = t ? 0.52 : 0.78, th = b.h * (t ? 0.08 + r() * 0.06 : 0.1 + r() * 0.12);
        if (!ok(b.x, b.z, hd, top + th + 12)) break;
        bList.push({ x: b.x, z: b.z, w: b.w * f, d: b.d * f, h: th, y0: top, rot: 0, td: b.td, tier: 1 }); top += th;
      }
      if (b.tdx < 520) ann.towers.push(Object.assign({ top }, b));
    }
  }
  // facade signs were planned against the original heights: drop any that would now float above a lowered roof
  if (T.skyline === 'harbour') for (const list of signLists) for (let i = list.length - 1; i >= 0; i--) {
    const sg = list[i];
    const host = ground.find(b => Math.abs(sg.x - b.x) <= b.w / 2 + 1 && Math.abs(sg.z - b.z) <= b.d / 2 + 1);
    if (!host) continue;
    if (sg.y + sg.sh / 2 > host.h - 1) { const ny = host.h - 1.5 - sg.sh / 2; if (ny - sg.sh / 2 > 3) sg.y = ny; else list.splice(i, 1); }
  }
  return ann;
}

// Called after the city meshes exist. Adds the themed crowns / landmarks / harbour kit to `world`.
export function buildSkyline(ctx, world, ann) {
  const T = ctx.THEME, r = rng((SEED[T.key] || 800) + 17), ok = clearance(ctx), out = [];
  const BOX = new THREE.BoxGeometry(1, 1, 1);
  const lit = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x15141d, metalness: 0.8, roughness: 0.38 });
  if (T.skyline === 'heights' || T.skyline === 'rain') {
    const towers = ann.towers.filter(b => b.top > 70).sort((a, b) => b.top - a.top);
    // spires + tip lights on the tallest third
    const sp = towers.filter((b, k) => k % 3 === 0 && ok(b.x, b.z, 4, b.top + 46));
    const spires = inst(BOX, darkMetal, sp.length, 'env-spire'), tips = inst(BOX, lit, sp.length, 'env-spire-tip');
    sp.forEach((b, k) => { const L = 18 + r() * 26; put(spires, k, b.x, b.top + L / 2, b.z, 0.7, L, 0.7); put(tips, k, b.x, b.top + L + 0.6, b.z, 1.1, 1.1, 1.1); tips.setColorAt(k, (T.skyline === 'rain' ? new THREE.Color(5, 0.3, 1.2) : new THREE.Color(0.6, 2.8, 4)).multiplyScalar(1)); });
    out.push(spires, tips);
    // crown light blades on the four corners of the top tier
    const cb = towers.slice(0, 160), blades = inst(BOX, lit, cb.length * 4, 'env-crown');
    cb.forEach((b, k) => { const f = 0.52, L = 6 + r() * 8; const col = (r() < 0.6 ? T.edge.a : T.edge.b).clone().multiplyScalar(0.9);
      for (let q = 0; q < 4; q++) { const sx = q & 1 ? 1 : -1, sz = q & 2 ? 1 : -1; put(blades, k * 4 + q, b.x + sx * b.w * f * 0.5, b.top - L / 2, b.z + sz * b.d * f * 0.5, 0.35, L, 0.35); blades.setColorAt(k * 4 + q, col); } });
    out.push(blades);
    if (T.skyline === 'heights') {
      // landmarks: halo-ring towers (stacked emissive rings around the 4 tallest towers near the circuit)
      const lm = towers.filter(b => b.tdx > 60 && b.tdx < 420).slice(0, 4);
      const ringGeo = new THREE.TorusGeometry(1, 0.05, 3, 40).rotateX(Math.PI / 2);
      const rings = inst(ringGeo, lit, lm.length * 3, 'env-halo');
      lm.forEach((b, k) => { const R0 = Math.hypot(b.w, b.d) * 0.8; for (let q = 0; q < 3; q++) { const y = b.top - 6 - q * 11, rr = R0 + q * 3.5; put(rings, k * 3 + q, b.x, y, b.z, rr, rr * 0.6, rr, 0, (q - 1) * 0.08); rings.setColorAt(k * 3 + q, (q === 1 ? T.edge.b : T.edge.a).clone().multiplyScalar(1.1)); } });
      out.push(rings);
    }
  }
  if (T.skyline === 'harbour') {
    // --- sawtooth warehouse roofs (prism teeth) + north-light glazing strips ---
    const prism = (() => { const g = new THREE.BufferGeometry(); const v = [-.5, 0, -.5, .5, 0, -.5, .5, 0, .5, -.5, 0, .5, -.5, 1, .5, .5, 1, .5];
      const idx = [0, 2, 1, 0, 3, 2, 3, 4, 5, 3, 5, 2, 0, 1, 5, 0, 5, 4, 0, 4, 3, 1, 2, 5]; g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); g.setIndex(idx); const ng = g.toNonIndexed(); ng.computeVertexNormals(); return ng; })();
    const teeth = [], glaze = [];
    for (const b of ann.warehouses) {
      const along = b.w >= b.d ? 'x' : 'z', L = along === 'x' ? b.w : b.d, Wd = along === 'x' ? b.d : b.w, n = Math.max(2, Math.round(L / 4.5)), tl = L / n, th = 1.8 + Wd * 0.04;
      for (let q = 0; q < n; q++) { const o = -L / 2 + tl * (q + 0.5); teeth.push([b, along, o, tl, Wd, th]); if (r() < 0.55) glaze.push([b, along, o + tl / 2 - 0.12, Wd, th]); }
    }
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3436, metalness: 0.55, roughness: 0.5 });
    const tm = inst(prism, roofMat, teeth.length, 'env-sawtooth');
    teeth.forEach(([b, al, o, tl, Wd, th], k) => { if (al === 'x') put(tm, k, b.x + o, b.h, b.z, tl, th, Wd, 0); else put(tm, k, b.x, b.h, b.z + o, tl, th, Wd, Math.PI / 2); });
    const gm = inst(BOX, lit, glaze.length, 'env-glazing'), gc = new THREE.Color();
    glaze.forEach(([b, al, o, Wd, th], k) => { gc.setRGB(0.95 + r() * 0.35, 0.45 + r() * 0.15, 0.1); if (r() < 0.25) gc.setRGB(0.1, 0.8, 0.75);
      if (al === 'x') put(gm, k, b.x + o, b.h + th * 0.45, b.z, 0.1, th * 0.6, Wd * 0.88); else put(gm, k, b.x, b.h + th * 0.45, b.z + o, Wd * 0.88, th * 0.6, 0.1); gm.setColorAt(k, gc); });
    out.push(tm, gm);
    // --- container yards: corrugated 12.2 x 2.6 x 2.6 boxes, stacked 1-4 high ---
    const ctex = (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 32; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 32); for (let x = 0; x < 128; x += 4) { g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, 0, 2, 32); } g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 0, 128, 2); g.fillRect(0, 30, 128, 2); g.fillRect(0, 0, 3, 32); g.fillRect(125, 0, 3, 32); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const cmat = new THREE.MeshStandardMaterial({ map: ctex, metalness: 0.35, roughness: 0.6 });
    const pal = [0x9a3a22, 0x1f6f78, 0xc77a1c, 0x2f4a6a, 0x7a2a2a, 0x2a8a7a, 0x8a8f96].map(h => new THREE.Color(h));
    const cont = [];
    for (const b of ann.yards) {
      const along = b.w >= b.d ? 0 : Math.PI / 2, L = along ? b.d : b.w, Wd = along ? b.w : b.d;
      const rows = Math.max(1, Math.floor((Wd - 1) / 2.9)), cols = Math.max(1, Math.floor((L - 0.5) / 12.6));
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { const hgt = 1 + Math.floor(r() * 4); for (let s = 0; s < hgt; s++) {
        const u = -L / 2 + 6.3 + j * 12.6, v = -Wd / 2 + 1.45 + i * 2.9; const x = along ? b.x + v : b.x + u, z = along ? b.z + u : b.z + v;
        cont.push([x, b.h + 1.3 + s * 2.62, z, along, pal[Math.floor(r() * pal.length)]]); } }
    }
    const cm = inst(BOX, cmat, cont.length, 'env-containers');
    cont.forEach(([x, y, z, ry, c], k) => { put(cm, k, x, y, z, 12.2, 2.6, 2.6, ry); cm.setColorAt(k, c); });
    out.push(cm);
    // --- ship-to-shore gantry cranes (landmark), merged geometry, one instance per yard nearest the circuit ---
    const crane = (() => {
      const red = new THREE.Color(0.75, 0.22, 0.1), wh = new THREE.Color(0.75, 0.73, 0.7), dk = new THREE.Color(0.08, 0.08, 0.1), parts = [];
      const bx = (w, h, d, x, y, z, c, rz = 0) => parts.push(vcol(new THREE.BoxGeometry(w, h, d).rotateZ(rz).translate(x, y, z), c));
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) bx(1.2, 46, 1.2, sx * 8, 23, sz * 7, red);                 // legs
      for (const sz of [-1, 1]) bx(17.2, 1.4, 1.2, 0, 30, sz * 7, wh);                                                  // portal beams
      for (const sx of [-1, 1]) bx(1.2, 1.4, 15.2, sx * 8, 30, 0, wh);
      for (const sx of [-1, 1]) bx(0.5, 22, 0.5, sx * 4.6, 37, 0, red, sx * 0.42);                                    // diagonal bracing
      bx(70, 2.4, 3.2, 14, 46.8, 0, red);                                                                            // boom (overhangs the water side)
      bx(18, 1.2, 3.0, -15, 49, 0, dk);                                                                             // backreach / counterweight deck
      bx(4, 3, 4, -20, 51, 0, wh);                                                                                    // machinery house
      bx(1.2, 14, 1.2, -2, 54, 0, red);                                                                               // A-frame mast
      bx(3, 2.2, 2.6, 22, 44.2, 0, wh);                                                                               // trolley + cab
      for (const sz of [-1, 1]) bx(0.15, 0.15, 1, 0, 0, sz * 0.2, dk);
      const g = mergeGeometries(parts); g.computeVertexNormals(); return g;
    })();
    const sites = ann.yards.slice().sort((a, b) => a.tdx - b.tdx).filter(b => ok(b.x, b.z, 30, 62));
    const picked = []; for (const b of sites) { if (picked.length >= 8) break; if (picked.every(p => Math.hypot(p.x - b.x, p.z - b.z) > 140)) picked.push(b); }
    const cr = inst(crane, new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.45 }), picked.length, 'env-crane');
    const cl = inst(BOX, lit, picked.length * 2, 'env-crane-light');
    picked.forEach((b, k) => { const ry = r() * Math.PI * 2; put(cr, k, b.x, b.h, b.z, 1, 1, 1, ry);
      const c = Math.cos(ry), s = Math.sin(ry); for (const [q, lx, ly] of [[0, 48, 48.4], [1, -2, 61.5]]) { put(cl, k * 2 + q, b.x + c * lx, b.h + ly, b.z - s * lx, 0.9, 0.9, 0.9); cl.setColorAt(k * 2 + q, q ? new THREE.Color(5, 0.35, 0.2) : new THREE.Color(4, 2.2, 0.4)); } });
    out.push(cr, cl);
    // --- dusk towers inland: amber crown bands ---
    const tw = ann.towers.slice(0, 60), band = inst(BOX, lit, tw.length, 'env-dusk-crown');
    tw.forEach((b, k) => { put(band, k, b.x, b.h - 1.2, b.z, b.w + 0.5, 0.6, b.d + 0.5); band.setColorAt(k, T.edge.a.clone().multiplyScalar(0.7)); });
    out.push(band);
  }
  for (const m of out) { if (m.instanceColor) m.instanceColor.needsUpdate = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); world.add(m); }
  return { meshes: out.length, instances: out.reduce((a, m) => a + m.count, 0) };
}

// Road-edge dressing outside the walls (frame-relative, so banked / inverted road works). Never inside the
// driving width: lateral offset >= W + 1.35 m (walls sit at W + 0.3 .. W + 0.8).
export function buildEdgeDressing(ctx, world) {
  const T = ctx.THEME, E = T.edge, M = ctx.MAIN, out = [];
  const pts = [];
  for (let i = 6; i < M.N; i += E.step) { if (!ctx.isOpen(i)) continue; pts.push([i, -1], [i, 1]); }
  const mat = (path, i, d, h, sx, sy, sz, m) => { const P = path.P[i], Tn = path.T[i], U = path.U[i], Rv = path.R[i]; _p.copy(Rv).negate(); m.makeBasis(_p, U, Tn); m.scale(_s.set(sx, sy, sz)); m.setPosition(P.x + Rv.x * d + U.x * h, P.y + Rv.y * d + U.y * h, P.z + Rv.z * d + U.z * h); return m; };
  const side = (i, s) => s < 0 ? -(M.WL[i] + 1.45) : (M.WR[i] + 1.45);
  const lit = new THREE.MeshBasicMaterial({ color: 0xffffff });
  if (E.kind === 'fins') {   // slim light blades, alternating cyan / violet
    const g = new THREE.BoxGeometry(1, 1, 1); const im = inst(g, lit, pts.length, 'env-edge-fin');
    pts.forEach(([i, s], k) => { im.setMatrixAt(k, mat(M, i, side(i, s) + Math.sign(side(i, s)) * 0.6, 1.25, 0.06, 2.0, 0.16, _m)); im.setColorAt(k, (Math.floor(k / 2) % 2 ? E.b : E.a).clone().multiplyScalar(0.32)); });
    out.push(im);
  } else if (E.kind === 'bollards') {   // harbour bollards with amber / teal caps
    const body = inst(new THREE.CylinderGeometry(0.32, 0.4, 1.1, 8), new THREE.MeshStandardMaterial({ color: 0x24221f, metalness: 0.6, roughness: 0.5 }), pts.length, 'env-edge-bollard');
    const cap = inst(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 8), lit, pts.length, 'env-edge-cap');
    pts.forEach(([i, s], k) => { body.setMatrixAt(k, mat(M, i, side(i, s), 0.55, 1, 1, 1, _m)); cap.setMatrixAt(k, mat(M, i, side(i, s), 1.18, 1, 1, 1, _m)); cap.setColorAt(k, Math.floor(k / 2) % 3 === 2 ? E.b : E.a); });
    out.push(body, cap);
  } else {   // rain: slim magenta lamp posts with a lit head
    const post = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x1a1622, metalness: 0.7, roughness: 0.4 }), pts.length, 'env-edge-post');
    const head = inst(new THREE.BoxGeometry(1, 1, 1), lit, pts.length, 'env-edge-head');
    pts.forEach(([i, s], k) => { post.setMatrixAt(k, mat(M, i, side(i, s), 1.6, 0.16, 3.2, 0.16, _m)); head.setMatrixAt(k, mat(M, i, side(i, s), 3.25, 0.3, 0.14, 0.9, _m)); head.setColorAt(k, Math.floor(k / 2) % 2 ? E.b : E.a); });
    out.push(post, head);
  }
  for (const m of out) { if (m.instanceColor) m.instanceColor.needsUpdate = true; m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); world.add(m); }
  return { meshes: out.length, instances: pts.length };
}
