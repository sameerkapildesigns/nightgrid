// M8 hover taxi (road traffic "drones"): own procedural geometry, no external assets (see licenses/M8-PROCEDURAL.md).
// Visual only. The deterministic contact box in core/sim.js (2.6 m wide x 5.2 m long, 1.5 m gate) is untouched;
// this model is built to sit inside that footprint: |x| <= 1.30, |z| <= 2.60, hull bottom at the old box bottom.
// All taxis are drawn as instances: body (1 MeshStandardMaterial, vertex colours), lights (1 MeshBasicMaterial,
// vertex colours; the blinking roof beacon is a second instanced mesh sharing that material) and the existing
// additive under-glow FX. 7 taxis = 4 draw calls (was 7 meshes x 7 taxis = 49).
//
// Local frame matches the old makeDrone(): +z = forward (direction of travel), +y = road normal, origin = drone.world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function colored(geo, col) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const box = (w, h, d, x, y, z, col) => colored(new THREE.BoxGeometry(w, h, d).translate(x, y, z), col);
// side profile (z, y) extruded across x, centred
function profile(pts, width, col, bevel = 0.07) {
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 1 });
  g.translate(0, 0, -(width - 2 * bevel) / 2);   // extrusion axis (shape z) centred
  g.rotateY(-Math.PI / 2);                       // shape x (our z) -> +z forward, extrusion -> x (no mirroring)
  return colored(g, col);
}

export function buildTaxiGeometry({ paint = new THREE.Color(0.95, 0.72, 0.12) } = {}) {
  const PAINT = paint, DARK = new THREE.Color(0.035, 0.038, 0.05), GLASS = new THREE.Color(0.02, 0.05, 0.09), GUN = new THREE.Color(0.11, 0.115, 0.13), CHK = new THREE.Color(0.02, 0.02, 0.025);
  const body = [];
  // lower hull: wedge nose, raised tail deck; 2.36 m wide incl. bevel
  body.push(profile([[-2.44, -0.46], [-2.51, 0.32], [-1.55, 0.42], [1.25, 0.42], [2.5, 0.08], [2.44, -0.3], [1.9, -0.48], [-1.95, -0.48]], 2.36, PAINT));
  // greenhouse (dark glass), narrower
  body.push(profile([[-1.75, 0.38], [-1.25, 0.94], [0.45, 0.97], [1.32, 0.4]], 1.86, GLASS, 0.05));
  // roof cap + sign base
  body.push(box(1.3, 0.06, 1.25, 0, 0.99, -0.42, PAINT));
  body.push(box(0.5, 0.1, 0.22, 0, 1.06, -0.42, DARK));
  // underside skid + front splitter + rear diffuser
  body.push(box(1.9, 0.1, 4.3, 0, -0.53, 0, DARK));
  body.push(box(2.1, 0.08, 0.3, 0, -0.38, 2.42, DARK));
  body.push(box(1.9, 0.14, 0.18, 0, -0.32, -2.5, GUN));
  // checker band: one row of dark squares per side (the paint between them is the other half of the checker)
  for (const sx of [-1, 1]) for (let k = 0; k < 9; k++) body.push(box(0.03, 0.17, 0.36, sx * 1.205, 0.06 + (k % 2) * 0.17, -2.0 + k * 0.42, CHK));
  // hover nacelles at the four corners (gunmetal pods), 8-sided
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const c = new THREE.CylinderGeometry(0.27, 0.24, 1.15, 8, 1, false).rotateX(Math.PI / 2).translate(sx * 1.03, -0.4, sz * 1.72);
    body.push(colored(c, GUN));
  }
  const lights = [];
  const W = new THREE.Color(4.2, 4.0, 3.6), RED = new THREE.Color(5.0, 0.25, 0.3), AMB = new THREE.Color(3.2, 1.6, 0.2), SIGN = new THREE.Color(3.4, 2.6, 0.9), HOV = new THREE.Color(0.5, 1.8, 2.6);
  for (const sx of [-1, 1]) lights.push(box(0.6, 0.08, 0.05, sx * 0.68, 0.06, 2.505, W));          // headlight blades
  lights.push(box(2.0, 0.09, 0.04, 0, 0.24, -2.575, RED));                                         // tail bar
  for (const sx of [-1, 1]) lights.push(box(0.03, 0.05, 4.1, sx * 1.255, -0.22, 0, AMB));         // side amber line
  lights.push(box(0.86, 0.22, 0.3, 0, 1.22, -0.42, SIGN));                                         // roof TAXI light box
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) lights.push(box(0.34, 0.03, 0.85, sx * 1.03, -0.66, sz * 1.72, HOV));   // thruster glow under pods
  const beacon = colored(new THREE.OctahedronGeometry(0.13, 0).translate(0, 1.42, -0.42), new THREE.Color(1, 0.55, 0.05));
  const b = mergeGeometries(body), l = mergeGeometries(lights);
  b.computeVertexNormals(); b.computeBoundingSphere(); l.computeBoundingSphere();
  return { body: b, lights: l, beacon };
}
const triCount = g => (g.index ? g.index.count : g.attributes.position.count) / 3;

export function createTaxiFleet(scene, { capacity = 16, paint } = {}) {
  const geo = buildTaxiGeometry({ paint });
  const bodyMat = new THREE.MeshStandardMaterial({ transparent:true, vertexColors: true, metalness: 0.45, roughness: 0.32, envMapIntensity: 1.1 });
  const lightMat = new THREE.MeshBasicMaterial({ transparent:true,vertexColors: true });
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const glowGeo = new THREE.PlaneGeometry(3.6, 6.6).rotateX(-Math.PI / 2).translate(0, -0.95, 0);
  const glowMat = new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.3, 0.75, 0.2), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const mk = (g, m) => { const im = new THREE.InstancedMesh(g, m, capacity); im.count = 0; im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.name = 'taxi'; scene.add(im); return im; };
  const body = mk(geo.body, bodyMat), lights = mk(geo.lights, lightMat), beacon = mk(geo.beacon, lightMat), glow = mk(glowGeo, glowMat);
  beacon.setColorAt(0, new THREE.Color(1, 1, 1));
  // Per-instance opacity lets traffic fade without popping, scaling or teleporting.
  for(const m of meshesForAlpha()){
    m.geometry.setAttribute('taxiAlpha',new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1),1));
  }
  function meshesForAlpha(){return [body,lights,beacon,glow];}
  for(const mat of [bodyMat,lightMat,glowMat])mat.onBeforeCompile=shader=>{
    shader.vertexShader='attribute float taxiAlpha; varying float vTaxiAlpha;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvTaxiAlpha=taxiAlpha;');
    shader.fragmentShader='varying float vTaxiAlpha;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a*=vTaxiAlpha;\nif(diffuseColor.a<.001)discard;');
  };
  const slots = [];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const meshes = [body, lights, beacon, glow];
  return {
    meshes,
    stats: { trisPerTaxi: Math.round(triCount(geo.body) + triCount(geo.lights) + triCount(geo.beacon)), materials: 2, drawCalls: meshes.length },
    // same shape as the old makeDrone() return value: { root, beacon }. root is NOT in the scene; game.js keeps
    // writing root.position/quaternion and beacon.material.color exactly as before, update() copies them.
    acquire() {
      if (slots.length >= capacity) throw new Error('taxi capacity');
      const k = slots.length, root = new THREE.Object3D(); root.userData.slot = k;
      const d = { root, beacon: { material: { color: new THREE.Color(1, 1, 1) } } };
      slots.push(d); for (const m of meshes) { m.setMatrixAt(k, zero); m.count = slots.length; }
      return d;
    },
    update(list) {
      for (const d of list) {
        if (!d.root || d.root.userData.slot == null) continue;
        const k = d.root.userData.slot; d.root.updateMatrix();
        for(const m of meshes)m.geometry.getAttribute('taxiAlpha').setX(k,d.visibility??1);
        for (const m of meshes) m.setMatrixAt(k, d.root.matrix);
        beacon.setColorAt(k, d.beacon.material.color);
      }
      for (const m of meshes){m.instanceMatrix.needsUpdate=true;m.geometry.getAttribute('taxiAlpha').needsUpdate=true;}
      if (beacon.instanceColor) beacon.instanceColor.needsUpdate = true;
    }
  };
}
