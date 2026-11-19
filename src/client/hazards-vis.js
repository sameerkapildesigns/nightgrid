// M8 hazard presentation (client only; never changes the build id). Obstacles and pickup pads come from the
// deterministic layout in src/core/hazards.js (same list the server uses). Draw cost is fixed per map:
// obstacles = 3 instanced meshes (block, light bar, ground glow), pads = 3 instanced meshes (decal, shield
// icon, boost icon); a taken pad hides its icon and dims its decal (instance scale/colour only, no new objects).
// Shield bubbles: one shared geometry/material, a mesh is attached to a car only while it holds a shield.
import * as THREE from 'three';

const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _x = new THREE.Vector3(), _c = new THREE.Color();
function placeMat(M, s, d, h, sx, sy, sz, out = _m, yaw = 0) {
  const i = Math.round(s / M.ds) % M.N, P = M.P[i], T = M.T[i], U = M.U[i], R = M.R[i];
  _x.copy(R).negate(); out.makeBasis(_x, U, T);
  if (yaw) out.multiply(new THREE.Matrix4().makeRotationY(yaw));
  out.scale(_s.set(sx, sy, sz));
  out.setPosition(P.x + R.x * d + U.x * h, P.y + R.y * d + U.y * h, P.z + R.z * d + U.z * h);
  return out;
}
function tex(draw, w = 256, h = 256) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// black/amber chevrons with a magenta edge: readable at 300 km/h against the cyan/violet road
const stripeTex = () => tex((g, w, h) => {
  g.fillStyle = '#0b0a10'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffb21c';
  for (let k = -2; k < 6; k++) { g.beginPath(); const x = k * 64; g.moveTo(x, h); g.lineTo(x + 32, h); g.lineTo(x + 96, 0); g.lineTo(x + 64, 0); g.closePath(); g.fill(); }
  g.fillStyle = '#ff2bd6'; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14);
}, 256, 128);
const padTex = (col, glyph) => tex((g, w, h) => {
  g.clearRect(0, 0, w, h);
  if (glyph === 'B') {
    g.fillStyle = 'rgba(3,8,18,.85)'; g.fillRect(12, 6, w - 24, h - 12);
    g.strokeStyle = col; g.lineWidth = 14; g.lineJoin = 'miter';
    for (const y of [60, 130, 200]) { g.beginPath(); g.moveTo(40, y + 26); g.lineTo(128, y - 26); g.lineTo(216, y + 26); g.stroke(); }
    return;
  }
  g.translate(w / 2, h / 2);
  g.strokeStyle = col; g.lineWidth = 10; g.shadowColor = col; g.shadowBlur = 18;
  g.beginPath(); for (let k = 0; k < 6; k++) { const a = Math.PI / 3 * k + Math.PI / 6; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * 110, Math.sin(a) * 110); } g.closePath(); g.stroke();
  g.fillStyle = col; g.globalAlpha = 0.18; g.fill(); g.globalAlpha = 1;
  g.lineWidth = 14; g.beginPath();
  if (glyph === 'S') { g.moveTo(0, -62); g.lineTo(46, -40); g.lineTo(40, 22); g.lineTo(0, 62); g.lineTo(-40, 22); g.lineTo(-46, -40); g.closePath(); }
  else { for (const y of [-30, 18]) { g.moveTo(-44, y + 26); g.lineTo(0, y - 18); g.lineTo(44, y + 26); } }
  g.stroke();
});
export const PAD_COL = { S: new THREE.Color(0.25, 0.85, 2.2), B: new THREE.Color(2.4, 1.1, 0.15) };

export function createHazardVis({ WORLD, sim, radialTex }) {
  const M = sim.track.MAIN, obs = sim.obstacles, pads = sim.pads;
  const group = new THREE.Group(); group.name = 'HAZARDS'; WORLD.add(group);
  // ---- obstacles: hover barrier block (own geometry; 12 tris) + emissive light bar + ground glow ----
  const blockMat = new THREE.MeshStandardMaterial({ map: stripeTex(), emissiveMap: null, color: 0xffffff, emissive: new THREE.Color(0.55, 0.32, 0.05), roughness: 0.55, metalness: 0.2 });
  blockMat.emissiveMap = blockMat.map;
  const block = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), blockMat, Math.max(1, obs.length));
  const bar = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4.5, 0.4, 2.8), toneMapped: false }), Math.max(1, obs.length));
  const glow = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: radialTex, color: new THREE.Color(1.6, 0.5, 0.9), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), Math.max(1, obs.length));
  obs.forEach((o, k) => {
    block.setMatrixAt(k, placeMat(M, o.s, o.d, o.h / 2 + 0.05, 2 * o.hw, o.h, 2 * o.hl));
    bar.setMatrixAt(k, placeMat(M, o.s, o.d, o.h + 0.12, 2 * o.hw + 0.2, 0.18, 0.35));
    glow.setMatrixAt(k, placeMat(M, o.s, o.d, 0.06, 2 * o.hw + 5, 1, 2 * o.hl + 6));
  });
  block.count = bar.count = glow.count = obs.length;
  group.add(block, bar, glow);
  // ---- pads: road decal + floating icon per kind ----
  const nS = pads.filter(p => p.kind === 'S').length, nB = pads.length - nS;
  const decal = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: padTex('#ffffff', 'S'), toneMapped: false }), Math.max(1, pads.length));
  const decalB = new THREE.InstancedMesh(decal.geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: padTex('#ffffff', 'B'), toneMapped: false, polygonOffset: true, polygonOffsetFactor: -4 }), Math.max(1, nB));
  const iconS = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.75, 0), new THREE.MeshBasicMaterial({ color: PAD_COL.S, toneMapped: false }), Math.max(1, nS));
  const iconB = new THREE.InstancedMesh(new THREE.ConeGeometry(0.6, 1.3, 4, 1), new THREE.MeshBasicMaterial({ color: PAD_COL.B, toneMapped: false }), Math.max(1, nB));
  for (const m of [decal, decalB]) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, pads.length) * 3), 3);
  decal.count = nS; decalB.count = nB; iconS.count = nS; iconB.count = nB;
  group.add(decal, decalB, iconS, iconB);
  const slot = pads.map(p => { const kS = pads.filter(q => q.kind === p.kind).indexOf(p); return kS; });
  const shown = pads.map(() => -1);
  function update(t) {
    const now = sim.time;
    pads.forEach((p, k) => {
      const ready = !(p.readyAt > now), S = p.kind === 'S', j = slot[k];
      const dm = S ? decal : decalB, im = S ? iconS : iconB, col = PAD_COL[p.kind];
      const pulse = ready ? 0.9 + 0.1 * Math.sin(t * 5 + k) : 0.15;
      dm.setMatrixAt(j, placeMat(M, p.s, p.d, 0.12, 4.6, 1, S ? 7.2 : 14)); _c.copy(col).multiplyScalar(pulse * 1.2); dm.setColorAt(j, _c);
      const sc = ready ? 1.6 : 0.0001;
      im.setMatrixAt(j, placeMat(M, p.s, p.d, 1.7 + 0.25 * Math.sin(t * 2.4 + k), sc, sc, sc, _m, t * 2.2 + k));
      if (shown[k] !== ready) shown[k] = ready;
    });
    for (const m of [decal, decalB, iconS, iconB]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
    bar.material.color.setRGB(4.5, 0.4, 2.8).multiplyScalar(0.7 + 0.3 * Math.sin(t * 7));
  }
  update(0);
  return { group, update, counts: { obstacles: obs.length, pads: pads.length, meshes: group.children.length } };
}

// ---- shield bubble (fresnel rim, additive; shared geometry + material) ----
let bubbleGeo = null, bubbleMat = null;
function bubble() {
  if (!bubbleGeo) {
    bubbleGeo = new THREE.SphereGeometry(1, 24, 14);
    bubbleMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uCol: { value: PAD_COL.S.clone() } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); vP = position; gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform float uTime; uniform vec3 uCol; varying vec3 vN; varying vec3 vV; varying vec3 vP; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 2.6); float hex = 0.5+0.5*sin(vP.y*18.0+uTime*4.0)*sin(vP.x*14.0-uTime*3.0); gl_FragColor = vec4(uCol*(f*0.38+0.1*f*hex), 1.0); }'
    });
  }
  return new THREE.Mesh(bubbleGeo, bubbleMat);
}
// called per racer per frame; on: racer holds a shield (own: shieldT; remote: pw flag)
export function updateShield(sh, on, t, pop) {
  if (!sh) return;
  if (on && !sh.shield) {
    const m = bubble(); const hl = sh.halfL || 2.3, hw = sh.halfW || 1.1;
    m.scale.set(hw * 1.6, Math.max(1.0, hw * 1.0), hl * 1.3); m.position.y = 0.25; m.renderOrder = 5; sh.root.add(m); sh.shield = m;
  }
  if (sh.shield) { sh.shield.visible = !!on; if (on) bubbleMat.uniforms.uTime.value = t; }
}
export function disposeShield(sh) { if (sh && sh.shield) { sh.shield.removeFromParent(); sh.shield = null; } }
