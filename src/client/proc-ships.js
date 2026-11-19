// R2: two ORIGINAL procedural anti-grav racers (no external designs, no downloaded models).
//   KESTREL (AG-K7): twin-hull catamaran. Slim cockpit spine, two outrigger pods joined by a
//     forward-swept canard and a swept main wing, twin pod fins, three nozzles.
//   MANTA (AG-M3):   wide flat delta lifting body, downturned wingtip fins, set-back bubble
//     canopy, dorsal blade, rear ring-duct engine with two side thrusters, hover pads.
// Output mimics a parsed glTF ({ scene, animations }) so game.js's existing buildCar() path
// (scaling, livery roles, emitters, shadow, underglow) handles them like the imported ship.
// Geometry is merged per material: at most 5 meshes per ship, bounded triangle counts
// (tests/unit/proc-ships.test.mjs). Built once per session and shared by every instance;
// disposeProcShip() frees it. Axes: +z nose, +y up, metres before buildCar's length scaling.
// Material names drive livery roles (roster.js tintMat/glassMat/neonMat/accentMat).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const PROC_MAT = { paint: 'Proc_Paint', accent: 'Proc_Accent', glass: 'Proc_Cristal_Canopy', neon: 'Proc_Neon', metal: 'Proc_Metal' };
export const PROC_LIMITS = { maxMeshes: 5, maxTris: 16000, minTris: 2000 };

function materials() {
  return {
    paint: new THREE.MeshPhysicalMaterial({ name: PROC_MAT.paint, color: 0xd9dde6, metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08 }),
    accent: new THREE.MeshStandardMaterial({ name: PROC_MAT.accent, color: 0x15171c, metalness: 0.6, roughness: 0.32 }),
    glass: new THREE.MeshPhysicalMaterial({ name: PROC_MAT.glass, color: 0x0a1020, metalness: 0.1, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.85 }),
    neon: new THREE.MeshStandardMaterial({ name: PROC_MAT.neon, color: 0x050505, emissive: 0x00f0ff, emissiveIntensity: 2 }),
    metal: new THREE.MeshStandardMaterial({ name: PROC_MAT.metal, color: 0x2a2d33, metalness: 0.9, roughness: 0.35 })
  };
}

// ---------- small geometry helpers (all return non-indexed-compatible BufferGeometry) ----------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), S = new THREE.Vector3(), P = new THREE.Vector3();
function place(g, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
  M4.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)); g.applyMatrix4(M4); return g;
}
// Body of revolution along z from a list of [z, r] stations (nose = larger z). Lathe spins around y,
// so build around y then rotate so y -> z.
function hull(stations, seg = 24) {
  const pts = stations.map(([z, r]) => new THREE.Vector2(Math.max(r, 1e-3), z));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);   // lathe axis y -> world +z (nose forward)
  return g;
}
// Extruded planform in the x/z plane, thickness along y. pts: [[x, z], ...] counter-clockwise from above.
function plate(pts, thick, bevel = 0.02) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -thick / 2); g.rotateX(-Math.PI / 2);   // shape y -> world -z, extrude z -> world y
  return g;
}
// Vertical fin profile in the y/z plane, thickness along x. pts: [[z, y], ...].
function fin(pts, thick, bevel = 0.015) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 });
  g.translate(0, 0, -thick / 2); g.rotateY(-Math.PI / 2);   // shape x -> world +z, extrude -> world x
  return g;
}
const box = (w, h, d, o) => place(new THREE.BoxGeometry(w, h, d), o);
const cyl = (rt, rb, h, seg, o) => place(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false), { rx: Math.PI / 2, ...o });
const ring = (r, tube, o, rs = 10, ts = 28) => place(new THREE.TorusGeometry(r, tube, rs, ts), o);
const disc = (r, o, seg = 24) => place(new THREE.CircleGeometry(r, seg), { ry: Math.PI, ...o });   // faces -z (rearward)
const dome = (o, seg = 22) => place(new THREE.SphereGeometry(1, seg, 12, 0, Math.PI * 2, 0, Math.PI / 2), o);
// Long thin strip from a to b ([x, y, z]), square section `t`.
function strip(a, b, t = 0.035) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A), len = d.length();
  const g = new THREE.BoxGeometry(t, t, len);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize());
  g.applyQuaternion(q); const m = A.add(B).multiplyScalar(0.5); g.translate(m.x, m.y, m.z); return g;
}
const mirrorX = g => { const c = g.clone(); c.scale(-1, 1, 1); flipWinding(c); return c; };
function flipWinding(g) {
  if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } g.index.needsUpdate = true; }
  else for (const at of Object.values(g.attributes)) {
    const n = at.itemSize, arr = at.array;
    for (let i = 0; i < at.count; i += 3) for (let k = 0; k < n; k++) { const t = arr[i * n + k]; arr[i * n + k] = arr[(i + 2) * n + k]; arr[(i + 2) * n + k] = t; }
    at.needsUpdate = true;
  }
  return g;
}
const sym = g => [g, mirrorX(g)];

// Merge each material's parts into one mesh; strip attributes to a common set first.
function assemble(name, parts, mats) {
  const scene = new THREE.Group(); scene.name = name;
  for (const [role, geos] of Object.entries(parts)) {
    if (!geos.length) continue;
    const clean = geos.map(g => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k); if (!n.attributes.uv) n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2)); return n; });
    const merged = mergeGeometries(clean, false);
    for (const g of new Set([...geos, ...clean])) g.dispose();
    merged.computeVertexNormals(); merged.computeBoundingBox(); merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, mats[role]); mesh.name = `${name}_${role}`;
    scene.add(mesh);
  }
  return scene;
}

// ---------- KESTREL: twin-hull catamaran ----------
function kestrel(mats) {
  const paint = [], accent = [], glass = [], neon = [], metal = [];
  const zTail = -2.35, podX = 1.02;
  // centre spine: needle nose, cockpit bulge, tapered tail
  paint.push(place(hull([[2.55, 0], [2.3, 0.08], [1.7, 0.2], [0.9, 0.33], [0.1, 0.38], [-0.9, 0.34], [-1.8, 0.27], [zTail, 0.22]], 28), { sy: 0.72, y: 0.36 }));
  glass.push(dome({ x: 0, y: 0.5, z: 0.45, sx: 0.27, sy: 0.24, sz: 0.95 }));
  accent.push(strip([0, 0.73, -0.4], [0, 0.6, -2.0], 0.06));                   // canopy spine rail
  // outrigger pods (stop at the same rear plane as the spine so all three nozzles line up)
  for (const s of [-1, 1]) {
    paint.push(place(hull([[1.55, 0], [1.35, 0.1], [0.8, 0.24], [-0.4, 0.29], [-1.6, 0.27], [zTail, 0.24]], 24), { x: s * podX, y: 0.3, sy: 0.82 }));
    metal.push(ring(0.29, 0.025, { x: s * podX, y: 0.3, z: 0.35, sy: 0.82 }, 6, 28));   // pod band
    accent.push(place(hull([[1.56, 0], [1.4, 0.075], [1.15, 0.155]], 24), { x: s * podX, y: 0.3, sy: 0.82 }));   // dark nose cone
    neon.push(strip([s * (podX + 0.255), 0.3, 0.9], [s * (podX + 0.25), 0.3, -2.1], 0.04));   // pod side light line
    // pod fin: tall swept blade, outboard of the pod
    accent.push(place(fin([[-2.3, 0], [-1.3, 0], [-1.85, 0.62], [-2.35, 0.66]], 0.06), { x: s * (podX + 0.05), y: 0.48 }));
    neon.push(strip([s * (podX + 0.05), 1.15, -2.37], [s * (podX + 0.05), 1.11, -1.87], 0.045));     // fin tip light
    // nozzles
    metal.push(cyl(0.2, 0.23, 0.16, 18, { x: s * podX, y: 0.3, z: zTail - 0.02 }));
    neon.push(disc(0.16, { x: s * podX, y: 0.3, z: zTail - 0.105 }));
  }
  // forward-swept canard joining spine and pods
  accent.push(...sym(plate([[0.25, 1.45], [podX - 0.15, 1.05], [podX - 0.15, 0.78], [0.25, 1.05]], 0.05)).map(g => place(g, { y: 0.33 })));
  // swept main wing, slight dihedral via two plates
  paint.push(...sym(plate([[0.3, -0.35], [podX, -0.95], [podX, -1.55], [0.3, -1.3]], 0.07)).map(g => place(g, { y: 0.3 })));
  neon.push(strip([0.32, 0.31, -0.33], [podX - 0.2, 0.31, -0.9], 0.03), strip([-0.32, 0.31, -0.33], [-podX + 0.2, 0.31, -0.9], 0.03));   // wing leading-edge lights
  // spine nozzle + splitter
  metal.push(cyl(0.18, 0.21, 0.16, 18, { y: 0.36, z: zTail - 0.02 }));
  neon.push(disc(0.145, { y: 0.36, z: zTail - 0.105 }));
  accent.push(plate([[-0.06, 2.3], [0.06, 2.3], [0.26, 1.85], [-0.26, 1.85]], 0.03, 0.01).translate(0, 0.17, 0));
  // hover pads under the pods
  for (const s of [-1, 1]) for (const z of [0.7, -1.5]) neon.push(place(new THREE.CircleGeometry(0.17, 16), { x: s * podX, y: 0.05, z, rx: Math.PI / 2 }));
  return assemble('KESTREL', { paint, accent, glass, neon, metal }, mats);
}

// ---------- MANTA: wide delta lifting body with a ring duct ----------
function manta(mats) {
  const paint = [], accent = [], glass = [], neon = [], metal = [];
  const zTail = -2.25;
  // delta planform with a notched trailing edge
  const half = [[0, 2.6], [0.45, 1.6], [1.25, -0.6], [1.55, -1.75], [1.15, -1.95], [0.7, -1.6], [0.5, -2.05]];
  const outline = [...half, ...half.slice(1).reverse().map(([x, z]) => [-x, z])];
  paint.push(place(plate(outline, 0.1, 0.05), { y: 0.3 }));
  // centre body hump
  paint.push(place(hull([[2.35, 0], [1.9, 0.18], [1.0, 0.42], [0, 0.5], [-1.2, 0.48], [-1.9, 0.44], [zTail, 0.4]], 32), { sx: 0.9, sy: 0.85, y: 0.36 }));
  for (const s of [-1, 1]) neon.push(strip([s * 0.3, 0.42, 1.6], [s * 0.45, 0.42, -2.1], 0.025));   // hump-to-wing seam lights
  accent.push(strip([0, 0.79, -0.5], [0, 0.74, -1.75], 0.05));                     // dorsal spine ridge
  glass.push(dome({ y: 0.66, z: 0.2, sx: 0.3, sy: 0.26, sz: 0.85 }));
  // downturned wingtip fins
  for (const s of [-1, 1]) {
    accent.push(place(fin([[-2.0, 0.05], [-0.75, 0.05], [-1.3, -0.42], [-2.0, -0.46]], 0.06), { x: s * 1.5, y: 0.32, rz: s * 0.18 }));
    neon.push(strip([s * 0.47, 0.4, 1.55], [s * 1.5, 0.4, -1.65], 0.035));        // leading-edge light line
    neon.push(strip([s * 1.52, 0.0, -1.92], [s * 1.55, 0.03, -1.0], 0.04));        // tip fin bottom edge
    // flank intakes on the upper surface with a glowing slit
    metal.push(plate([[s * 0.44, 1.25], [s * 0.78, 0.55], [s * 0.78, 0.2], [s * 0.44, 0.55]], 0.12, 0.015).translate(0, 0.42, 0));
    neon.push(strip([s * 0.47, 0.49, 1.05], [s * 0.74, 0.49, 0.45], 0.03));
    // side thrusters
    metal.push(cyl(0.11, 0.13, 0.22, 14, { x: s * 0.75, y: 0.32, z: -1.95 }));
    neon.push(disc(0.085, { x: s * 0.75, y: 0.32, z: -2.07 }));
    // surface panel lines
    accent.push(strip([s * 0.55, 0.4, 0.9], [s * 1.2, 0.4, -1.3], 0.025));
  }
  // dorsal blade fin
  accent.push(fin([[-2.0, 0], [-0.6, 0], [-1.55, 0.58], [-2.05, 0.6]], 0.05).translate(0, 0.52, 0));
  neon.push(strip([0, 1.13, -2.05], [0, 1.11, -1.6], 0.045));
  // rear ring duct: shroud, stator struts, glowing core
  const duct = { y: 0.42, z: zTail - 0.05 };
  metal.push(ring(0.4, 0.085, duct, 10, 32));
  metal.push(cyl(0.36, 0.36, 0.28, 28, { ...duct, z: duct.z + 0.1 }));
  for (let k = 0; k < 3; k++) { const a = k * Math.PI * 2 / 3 + Math.PI / 2; metal.push(strip([0, duct.y, duct.z + 0.02], [Math.cos(a) * 0.36, duct.y + Math.sin(a) * 0.36, duct.z + 0.02], 0.04)); }
  neon.push(disc(0.3, { ...duct, z: duct.z - 0.01 }, 28));
  neon.push(ring(0.4, 0.02, { ...duct, z: duct.z - 0.08 }, 6, 32));
  // nose blade + hover pads
  accent.push(plate([[-0.18, 2.55], [0.18, 2.55], [0.6, 1.8], [-0.6, 1.8]], 0.03, 0.01).translate(0, 0.2, 0));
  for (const [x, z] of [[-0.8, 0.2], [0.8, 0.2], [-1.05, -1.3], [1.05, -1.3], [0, 1.3]]) neon.push(place(new THREE.CircleGeometry(0.16, 16), { x, y: 0.2, z, rx: Math.PI / 2 }));
  return assemble('MANTA', { paint, accent, glass, neon, metal }, mats);
}

const BUILDERS = { kestrel, manta };
// Nozzle centres [x, y] in builder space; roster emitF must match (proc-ships.test.mjs).
export const PROC_NOZZLES = { kestrel: [[0, 0.36], [-1.02, 0.3], [1.02, 0.3]], manta: [[0, 0.42], [-0.75, 0.32], [0.75, 0.32]] };
export const PROC_SHIP_KEYS = Object.keys(BUILDERS);

// Returns a glTF-like object for game.js loadCarAsset(): { scene, animations, parser, proc }.
export function buildProcShip(key) {
  const b = BUILDERS[key]; if (!b) throw new Error('unknown procedural ship ' + key);
  const scene = b(materials());
  return { scene, animations: [], parser: { json: {} }, proc: true };
}

export function shipStats(scene) {
  let tris = 0, meshes = 0; const mats = new Set();
  scene.traverse(o => { if (o.isMesh) { meshes++; mats.add(o.material); const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return { tris: Math.round(tris), meshes, materials: mats.size };
}

// Frees the shared geometry and source materials (instances made by buildCar clone materials).
export function disposeProcShip(gltf) {
  gltf.scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
}
