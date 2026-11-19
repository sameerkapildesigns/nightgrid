import {buildCircuitLandmarks} from './env/circuit-landmarks.js';
import {variantLabel} from '../core/variants.js';
import { createWeaponVis, updateWeaponHUD } from './weapons-vis.js';
import {buildR4Landmarks} from './env/r4-landmarks.js';
import {engineVoice} from './engine-profiles.js';
import {beatGlow} from './music-beat.js';
import { createMusic } from './music.js';
import { ambientGains, engineGains } from './audio-mix.js';
import { QUALITY, qualityLimits, qualitySample } from './quality.js';
// NIGHTGRID client: rendering, world building, car models, garage, FX, HUD, audio, input,
// cinematics. Moved from v5b game.html; simulation rules live in ../core (pure modules).
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TRK } from '../core/track.js';
import { clamp, lerp, mod, wrapA, damp, smooth, sstep, mulberry32, fmtTime as fmt } from '../core/math.js';
import { MAPS, MAP_KEYS, DEFAULT_MAP, S0, H0, WB, mkF } from '../core/maps.js';
import { createSim, PERS } from '../core/sim.js';
import { NetClient } from '../net/client.js';
import { WorkerNet } from './net-proxy.js';
import { finishAnnounce } from './finish-pos.js';
import { RemotePresenter, OwnSmoother, stepAt } from './present.js';
import { VIEW_FIELDS } from '../net/netcode.js';
import { encodeFrame } from '../net/protocol.js';
import { driveLine } from '../net/driver.js';
import { resolveMpConfig } from '../net/mp-config.js';
import { createLobbyUI, errorText } from './lobby.js';
import { createClock, createFpsMeter, SIM_DT } from '../core/clock.js';
import { createRecordStore, memoryStorage, recordKey } from '../core/records.js';
import { DRIVE_MODES } from '../core/pace.js';
import { createTilt } from '../core/tilt.js';
import { buildShelter, shelterTop } from '../core/shelter.js';
import { buildClearance, groundHeightAt, worstClearance, GROUND_Y } from '../core/terrain.js';
import { bodyLean, cameraLean } from './lean.js';
import { CARS, CAR_KEYS, SHORT, PAINTS, RIVAL_LIV, RIVAL_ORDER, raceCarKeys, isRaceReady } from '../core/roster.js';
import { MODEL_URLS } from './model-urls.js';
import { buildProcShip, shipStats } from './proc-ships.js';
import { createHazardVis, updateShield } from './hazards-vis.js';
import { applyPads } from '../core/hazards.js';
import { createPowerGate, ownFlags, PW_SHIELD, PW_SURGE } from './power-gate.js';
// M8-ENV HOOK H1: environment themes, skyline, edge dressing, hover taxi (visual only, src/client/env/)
import { themeFor, makeSkyMaterial, windowUniforms } from './env/themes.js';
import { shapeBuildings, buildSkyline, buildEdgeDressing } from './env/skyline.js';
import { createTaxiFleet } from './env/taxi.js';

// DEBUG is a build-time constant: true for `vite` dev and `vite build --mode test`,
// false for the production build (all debug hooks and the QA panel are compiled out).
const DEBUG = import.meta.env.DEV || import.meta.env.MODE === 'test';
window.__NG_OK = true;

/* ============================== utils (client-only) ============================== */
const V3 = THREE.Vector3;
const $ = id => document.getElementById(id);
// Client RNG: city, props, FX. Same seed/stream as v5b so the procedural city matches.
const rnd = mulberry32(2087);
const R = (a = 0, b = 1) => a + (b - a) * rnd();
const pick = arr => arr[Math.floor(rnd() * arr.length)];
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = smooth(xf), v = smooth(yf); return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v); }
const tick = () => new Promise(r => requestAnimationFrame(() => r()));


const NEON = {
  c: new THREE.Color(0x00f0ff), m: new THREE.Color(0xff2bd6), p: new THREE.Color(0x8a5cff),
  y: new THREE.Color(0xffc23f), r: new THREE.Color(0xff2a4a), g: new THREE.Color(0x7dff4a), w: new THREE.Color(0xffe2c0), o: new THREE.Color(0xff8a2a)
};
const NEON_CSS = ['#00f0ff', '#ff2bd6', '#8a5cff', '#ffc23f', '#ff3355', '#7dff4a'];

/* ============================== renderer ============================== */
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
let qualityMode = 'auto';
try { const q = JSON.parse(localStorage.getItem('nightgrid_v4_settings') || 'null')?.quality; if (QUALITY.includes(q)) qualityMode = q; } catch {}
let qualityState = { pr: qualityLimits(qualityMode, devicePixelRatio).max, bloom: qualityMode !== 'battery' };
let PR = qualityState.pr;
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
$('app').appendChild(renderer.domElement);
const MAXANI = Math.min(8, renderer.capabilities.getMaxAnisotropy());

const scene = new THREE.Scene();
const FOGD = 0.0024;
const FOGC = new THREE.Color(0x181b2b);   // cooler, more believable night haze (was violet)
scene.fog = new THREE.FogExp2(FOGC, FOGD);
scene.background = FOGC.clone();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 3600);
camera.position.set(0, 60, 0);

const FXShader = {
  uniforms: { tDiffuse: { value: null }, uAmt: { value: 0.0 }, uVP: { value: new THREE.Vector2(0.5, 0.56) }, uTime: { value: 0 }, uVig: { value: 0.55 }, uHit: { value: 0 }, uBlur: { value: 0 }, uTint: { value: new THREE.Color(0, 0, 0) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmt, uTime, uVig, uHit, uBlur; uniform vec3 uTint; uniform vec2 uVP; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5; float d = length(c); vec2 o = c * d * uAmt * 4.0;
      vec3 col = vec3(texture2D(tDiffuse, vUv - o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + o).b);
      if (uBlur > 0.0005) {
        // radial (zoom) blur away from the vanishing point; the car / centre stays sharp, edges streak
        vec2 v = vUv - uVP; vec2 ve = v * vec2(1.0, 1.35); float m = smoothstep(0.12, 0.48, length(ve));
        vec3 acc = col; float w = 1.0; float jit = hash(vUv * 731.0 + uTime) * 0.5;
        for (int i = 1; i <= 8; i++) { float f = (float(i) + jit) / 8.0; float k = 1.0 - f * 0.55; acc += texture2D(tDiffuse, vUv - v * uBlur * f * m).rgb * k; w += k; }
        col = acc / w;
      }
      col += uTint * smoothstep(0.25, 0.8, d);
      col *= 1.0 - smoothstep(0.38, 0.95, d) * uVig;
      col += vec3(1.0, 0.08, 0.3) * uHit * smoothstep(0.3, 0.85, d) * 0.5;
      col += (hash(vUv * vec2(1931.0, 1093.0) + fract(uTime)) - 0.5) * 0.014;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`
};
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
renderer.info.autoReset = false;
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.72, 0.42, 0.92);
{ const o = bloom.setSize.bind(bloom); bloom.setSize = (w, h) => o(Math.max(1, Math.round(w * 0.5)), Math.max(1, Math.round(h * 0.5))); }
bloom.enabled = qualityState.bloom;
composer.addPass(bloom);
const fxPass = new ShaderPass(FXShader);
composer.addPass(fxPass);
composer.addPass(new OutputPass());

const hemi = new THREE.HemisphereLight(0x67708f, 0x16141f, 0.5); scene.add(hemi);   // M8-ENV HOOK H2: named so applyTheme can tint it
const moon = new THREE.DirectionalLight(0x8a9cff, 0.35); moon.position.set(-200, 400, 100); scene.add(moon);

/* ============================== textures ============================== */
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = MAXANI;
  return t;
}
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function neonText(g, t, x, y, col) {
  g.shadowColor = col; g.shadowBlur = 26; g.fillStyle = col; g.fillText(t, x, y);
  g.shadowBlur = 10; g.fillText(t, x, y);
  g.shadowBlur = 0; g.globalAlpha = 0.6; g.fillStyle = '#fff'; g.fillText(t, x, y); g.globalAlpha = 1;
}
const radialTex = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});
const FONT_JP = '"Hiragino Sans","Noto Sans JP","Noto Sans CJK JP","Yu Gothic","Meiryo",sans-serif';

/* ============================== sky + env ============================== */
const sky = new THREE.Mesh(new THREE.SphereGeometry(2800, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `varying vec3 vP;
    void main(){
      float y = vP.y;
      vec3 top = vec3(0.003,0.003,0.014), mid = vec3(0.022,0.008,0.05), hor = vec3(0.05,0.012,0.09);
      vec3 c = mix(hor, mid, smoothstep(0.0, 0.2, y));
      c = mix(c, top, smoothstep(0.2, 0.75, y));
      c = mix(c, vec3(0.03,0.01,0.05), smoothstep(-0.02, -0.4, y));
      c += vec3(0.30,0.05,0.26) * exp(-abs(y - 0.015) * 26.0) * 0.45;
      c += vec3(0.02,0.10,0.14) * exp(-abs(y - 0.06) * 12.0) * 0.25;
      gl_FragColor = vec4(c, 1.0);
    }`
}));
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);
// M8-ENV HOOK H3: per-map theme (fog/background colour, sky dome, hemi/moon tint, rain tint). Fog DENSITY unchanged.
let THEME = themeFor('velocity');
function applyTheme(key) {
  THEME = themeFor(key, variantMask);
  FOGC.copy(THEME.fog); scene.fog.color.copy(THEME.fog); scene.background.copy(THEME.fog);
  const old = sky.material; sky.material = makeSkyMaterial(THEME); sky.material.uniforms.uFX.value=old.uniforms?.uFX?.value??1; old.dispose();
  hemi.color.copy(THEME.hemiSky); hemi.groundColor.copy(THEME.hemiGround); hemi.intensity = THEME.hemiI;
  moon.color.copy(THEME.moon); moon.intensity = THEME.moonI;
  if (typeof rainMat !== 'undefined') { rainMat.uniforms.uRainC.value.copy(THEME.rain).multiplyScalar(THEME.rainA); }
}

function buildEnv() {
  const es = new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: new THREE.Color(0.02, 0.01, 0.05) })));
  es.add(new THREE.Mesh(new THREE.CylinderGeometry(55, 55, 10, 48, 1, true), new THREE.MeshBasicMaterial({ side: THREE.BackSide, color: new THREE.Color(0.11, 0.09, 0.15) })));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cols = [NEON.c, NEON.m, NEON.w, NEON.y, NEON.w, NEON.w, NEON.c];   // mostly warm/white practical lights, fewer saturated neons
  for (let i = 0; i < 130; i++) {
    const m = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: pick(cols).clone().multiplyScalar(R(0.9, 3.4)) }));
    const a = R(0, Math.PI * 2), y = R(-26, 26), r = 32;
    m.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
    m.scale.set(R(0.4, 7), R(0.2, 4), 0.3);
    if (rnd() < 0.3) m.scale.set(R(0.2, 0.6), R(4, 14), 0.3);
    m.lookAt(0, y, 0);
    es.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(es, 0.02);
  scene.environment = rt.texture;
  pm.dispose();
}

/* ============================== simulation + track data ============================== */
// The pure simulation owns racers, physics, laps and the per-map track data.
const sim = createSim({ seed: 4242, events: null });   // events are attached below (SIMEV)
sim.weaponSlice=2; // Early review slice: mines and EMP only.
sim.hazards = true;   // M8: obstacles + shield/self-boost pads in single-player too (same layout as rooms)
const WEAPONS_AVAILABLE = import.meta.env.VITE_WEAPONS !== '0'; // Opt-in mines/EMP release; explicit 0 is the frontend kill switch.
let WVIS = null;
let HZV = null;      // hazard visuals for the current map (src/client/hazards-vis.js)
// Solo draws a fresh seed per start/restart; rooms use the server seed verbatim.
function racePickupLayout(seed){
  sim.setPickupSeed(seed);
  if(HZV){HZV.dispose();HZV=createHazardVis({WORLD,sim,radialTex});}
}
function soloPickupLayout(){racePickupLayout(crypto.getRandomValues(new Uint32Array(1))[0]);}

let variantMask=0; // This review exposes original circuits only.
let raceNPCCount=5,raceLapsSetting=0,soloRaceRules=true;
try{const saved=JSON.parse(localStorage.getItem('nightgrid_v4_settings')||'null');if([3,5,7].includes(saved?.npcs))raceNPCCount=saved.npcs;if([2,3,5].includes(saved?.laps))raceLapsSetting=saved.laps;}catch{}
const soloRivals=()=>Array.from({length:raceNPCCount},(_,i)=>({name:RIVAL_ORDER[i%3]+(i>=3?' '+(1+Math.floor(i/3)):'')}));
let MAPKEY = null, MAPDEF = null, TD, W0, SECTORS, MAIN, BR, SA, SB, OFF, SAm, SBm, LAPLEN, HASBR, SECCOL, SECSTART, LAPS = 3;
function loadTrackData(key) {
  if(key==='legacy')variantMask &=4;if(['casino','summit'].includes(key))variantMask=0;
  TD = sim.setTrack(key,variantMask);sim.setRaceLaps(soloRaceRules?raceLapsSetting:0);
  ({ MAIN, BR, SA, SB, OFF, SAm, SBm, LAPLEN, HASBR, W0, SECSTART, LAPS } = TD);
  MAPKEY = key; MAPDEF = TD.def;
  SECTORS = TD.SECTORS.map(s => Object.assign({}, s, { col: new THREE.Color(s.colHex != null ? s.colHex : s.css) }));
  SECCOL = []; { const N = MAIN.N; for (let i = 0; i < N; i++) { const c = new THREE.Color(); let w = 0; const acc = [0, 0, 0]; for (let j = -24; j <= 24; j += 4) { const s = MAIN.sec[mod(i + j, N)]; const sc2 = SECTORS[s].col; const k = (key === 'legacy' && s === 3) ? 0.55 : 1; acc[0] += sc2.r * k; acc[1] += sc2.g * k; acc[2] += sc2.b * k; w++; } c.setRGB(acc[0] / w, acc[1] / w, acc[2] / w); SECCOL.push(c); } }
}
let __initMap = DEFAULT_MAP; try { const v = localStorage.getItem('nightgrid_v4_map'); if (MAPS[v]) __initMap = v; } catch (e) { }
loadTrackData(__initMap);
const WORLD = new THREE.Group(); WORLD.name = 'WORLD';
// frame sampling (core) bound to the current track
const frameAt = (path, s, out) => sim.frameAt(path, s, out);
const worldPos = (path, s, d, h, out) => { const f = sim.frameAt(path, s, _fw); d += f.off; return out.copy(f.P).addScaledVector(f.R, d).addScaledVector(f.U, h); };
const _fw = mkF();
const raceS = (path, s) => sim.raceS(path, s);
const rdist = (path, s) => sim.rdist(path, s);


/* ============================== track meshes ============================== */
const HAZ = new THREE.Color(1.0, 0.45, 0.05);
function colAt(path, i) { return path === MAIN ? SECCOL[i] : HAZ; }

function ribbon(path, i0, count, prof, vScale, withColor, colScale = 1) {
  const np = prof(i0).length, nv = (count + 1) * np;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), col = withColor ? new Float32Array(nv * 3) : null;
  let k = 0, q = 0, c = 0;
  for (let s = 0; s <= count; s++) {
    const i = path.closed ? mod(i0 + s, path.N) : Math.min(path.N - 1, i0 + s);
    const pr = prof(i); const P = path.P[i], Rv = path.R[i], U = path.U[i];
    let ul = 0;
    for (let j = 0; j < np; j++) {
      const d = pr[j][0], h = pr[j][1];
      pos[k++] = P.x + Rv.x * d + U.x * h; pos[k++] = P.y + Rv.y * d + U.y * h; pos[k++] = P.z + Rv.z * d + U.z * h;
      if (j > 0) ul += Math.hypot(pr[j][0] - pr[j - 1][0], pr[j][1] - pr[j - 1][1]);
      uv[q++] = ul; uv[q++] = (i0 + s) * path.ds / vScale;
      if (col) { const cc = colAt(path, i); col[c++] = cc.r * colScale; col[c++] = cc.g * colScale; col[c++] = cc.b * colScale; }
    }
    // normalise u to 0..1
    const tot = ul || 1; for (let j = 0; j < np; j++) uv[(s * np + j) * 2] /= tot;
  }
  const idx = new Uint32Array(count * (np - 1) * 6); let w = 0;
  for (let s = 0; s < count; s++) for (let j = 0; j < np - 1; j++) { const a = s * np + j, b = a + 1, cc = a + np, d = cc + 1; idx[w++] = a; idx[w++] = b; idx[w++] = cc; idx[w++] = b; idx[w++] = d; idx[w++] = cc; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals();
  return g;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s3 = new V3(), _p3 = new V3(), _eu = new THREE.Euler(), _xa = new V3();
function setInst(mesh, k, x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0) {
  _eu.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_eu); _p3.set(x, y, z); _s3.set(sx, sy, sz);
  _m4.compose(_p3, _q, _s3); mesh.setMatrixAt(k, _m4);
}
// matrix whose local axes are x=left, y=surface normal, z=forward, at (d,h) on the path
function frameMat(path, i, d, h, sx, sy, sz, m = _m4) {
  const P = path.P[i], T = path.T[i], U = path.U[i], Rv = path.R[i];
  _xa.copy(Rv).negate(); m.makeBasis(_xa, U, T); m.scale(_s3.set(sx, sy, sz));
  m.setPosition(P.x + Rv.x * d + U.x * h, P.y + Rv.y * d + U.y * h, P.z + Rv.z * d + U.z * h);
  return m;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const beatMats=[];
function beatMaterial(mat){beatMats.push({mat,base:mat.color.clone()});return mat;}
const barrierMats = [];
function barrierMat() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uBeat: {value:1},uTime: { value: 0 }, uHit: { value: 0 }, uHitV: { value: 0 }, uFogD: { value: FOGD } },
    vertexShader: `varying vec2 vUv; varying float vFog; varying vec3 vC; uniform float uFogD;
      void main(){ vUv = uv; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); float fd = uFogD * length(mv.xyz); vFog = exp(-fd*fd); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uTime, uHit, uHitV,uBeat; varying vec2 vUv; varying float vFog; varying vec3 vC;
      void main(){
        float h = vUv.x, along = vUv.y;
        float g = pow(1.0 - h, 2.0);
        float scan = smoothstep(0.86, 1.0, fract(along * 0.5 - uTime * 0.9));
        float grid = smoothstep(0.9, 1.0, fract(along * 4.0)) * 0.3 + smoothstep(0.85, 1.0, fract(h * 5.0)) * 0.12;
        float hit = uHit * exp(-abs(along - uHitV) * 0.5);
        float a = (g * 0.2 + (scan * 0.55 + grid) * g + hit * 1.6 * (1.0 - h * 0.6)) * vFog;
        gl_FragColor = vec4(vC * a*uBeat, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, vertexColors: true
  });
  barrierMats.push(m); return m;
}
function coneGeo(rTop, rBot, height, sourceAtTop) {
  const g = new THREE.CylinderGeometry(rTop, rBot, height, 28, 1, true);
  const p = g.attributes.position, hh = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) { const y = p.getY(i) / height + 0.5; hh[i] = sourceAtTop ? y : 1 - y; }
  g.setAttribute('hh', new THREE.BufferAttribute(hh, 1));
  return g;
}
function coneMat(col, opacity, power = 1.6) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col.clone() }, uOpacity: { value: opacity }, uFogD: { value: FOGD }, uPow: { value: power } },
    vertexShader: `attribute float hh; varying float vH; varying vec3 vN; varying vec3 vV; varying float vFog; varying vec3 vCol; uniform float uFogD;
      void main(){
        #ifdef USE_INSTANCING
          mat4 m = modelMatrix * instanceMatrix;
        #else
          mat4 m = modelMatrix;
        #endif
        vec4 wp = m * vec4(position,1.0); vec4 mv = viewMatrix * wp;
        vN = normalize(mat3(viewMatrix) * mat3(m) * normal); vV = normalize(-mv.xyz); vH = hh;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0);
        #endif
        float fd = uFogD * length(mv.xyz); vFog = exp(-fd*fd);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uPow; varying float vH; varying vec3 vN; varying vec3 vV; varying float vFog; varying vec3 vCol;
      void main(){
        float f = abs(dot(normalize(vN), normalize(vV)));
        float a = pow(vH, uPow) * pow(f, 1.3) * uOpacity * vFog;
        gl_FragColor = vec4(uColor * vCol * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
}
function makeRoadMaps() {
  const W = 256, H = 1024;
  const map = canvasTex(W, H, g => {
    g.fillStyle = '#1a1922'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 9000; i++) { const v = 16 + Math.random() * 34 | 0; g.fillStyle = `rgba(${v},${v},${v + 10},${Math.random() * 0.55})`; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
    g.fillStyle = 'rgba(0,0,0,0.55)'; for (let y = 0; y < H; y += 256) g.fillRect(0, y, W, 4);
    g.fillStyle = 'rgba(255,255,255,0.05)'; for (let y = 4; y < H; y += 256) g.fillRect(0, y, W, 1);
    g.fillStyle = 'rgba(200,210,230,0.35)'; for (const x of [W / 3, 2 * W / 3]) for (let y = 0; y < H; y += 128) g.fillRect(x - 2, y + 12, 4, 66);
    g.fillStyle = '#22202e'; g.fillRect(0, 0, 14, H); g.fillRect(W - 14, 0, 14, H);
    // magnetic coil plates
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 64; y < H; y += 128) g.fillRect(0, y, W, 2);   // concrete expansion seams
  });
  const emi = canvasTex(W, H, g => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(150,160,180,0.42)'; for (const x of [W / 3, 2 * W / 3]) for (let y = 0; y < H; y += 128) g.fillRect(x - 1.5, y + 12, 3, 66);

  });
  const rough = canvasTex(W, H, g => {
    g.fillStyle = 'rgb(160,160,160)'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 4000; i++) { const v = 120 + Math.random() * 80 | 0; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    for (let i = 0; i < 46; i++) {
      const x = Math.random() * W, y = Math.random() * H, r = 18 + Math.random() * 55;
      g.save(); g.translate(x, y); g.scale(1, 2.6);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, r); gr.addColorStop(0, 'rgba(18,18,18,0.97)'); gr.addColorStop(0.7, 'rgba(18,18,18,0.6)'); gr.addColorStop(1, 'rgba(18,18,18,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.restore();
    }
    // polished wet wheel tracks: smoother bands -> soft streaky reflections
    for (const x of [0.17, 0.5, 0.83]) { const gr = g.createLinearGradient(W * (x - 0.07), 0, W * (x + 0.07), 0); gr.addColorStop(0, 'rgba(60,60,60,0)'); gr.addColorStop(0.5, 'rgba(60,60,60,0.55)'); gr.addColorStop(1, 'rgba(60,60,60,0)'); g.fillStyle = gr; g.fillRect(W * (x - 0.07), 0, W * 0.14, H); }
  }, false);
  for (const t of [map, emi, rough]) { t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping; }
  return { map, emi, rough };
}
function tunnelRanges(path) { const out = []; let st = -1; for (let i = 0; i < path.N; i++) { const t = path.tag[i] & TRK.TUNNEL; if (t && st < 0) st = i; if (!t && st >= 0) { out.push([st, i - 1]); st = -1; } } if (st >= 0) out.push([st, path.N - 1]); return out; }

function buildTrack() {
  const rm = makeRoadMaps();
  const roadMat = new THREE.MeshStandardMaterial({ map: rm.map, emissiveMap: rm.emi, emissive: new THREE.Color(1.0, 1.0, 1.0), roughnessMap: rm.rough, roughness: 1, metalness: 0.22, envMapIntensity: 1.5, side: THREE.DoubleSide });
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x100e1a, metalness: 0.8, roughness: 0.35, side: THREE.DoubleSide, envMapIntensity: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x15141f, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  const edgeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const tubeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const barM = barrierMat();
  const add = (g, m) => { const me = new THREE.Mesh(g, m); WORLD.add(me); return me; };
  // ---------- main ----------
  const M = MAIN;
  add(ribbon(M, 0, M.N, i => [[-M.WL[i], 0], [M.WR[i], 0]], 24, false), roadMat);
  add(ribbon(M, 0, M.N, i => [[-M.WL[i] - 1.1, 0.02], [-M.WL[i] - 1.1, -1.3], [M.WR[i] + 1.1, -1.3], [M.WR[i] + 1.1, 0.02]], 8, false), hullMat);
  add(ribbon(M, 0, M.N, i => [[-M.WL[i] + 0.25, 0.03], [-M.WL[i] + 0.65, 0.03]], 8, true, 1.7), edgeMat);
  // right edge strip: split at fork/merge so the divider reads correctly
  const rightEdge = (i0, cnt) => add(ribbon(M, i0, cnt, i => [[M.WR[i] - 0.65, 0.03], [M.WR[i] - 0.25, 0.03]], 8, true, 1.7), edgeMat);
  if (HASBR) { rightEdge(SB, mod(SA - SB, M.N) - 1); rightEdge(SA, SB - SA - 1); } else rightEdge(0, M.N);
  const wallSet = (i0, cnt, side) => {
    const dd = i => side < 0 ? -(M.WL[i] + 0.3) : (M.WR[i] + 0.3);
    add(ribbon(M, i0, cnt, i => [[dd(i), 0], [dd(i), 1.5]], 4, true, 1.0), barM);
    add(ribbon(M, i0, cnt, i => [[dd(i) + side * 0.05, 1.42], [dd(i) + side * 0.05, 1.56]], 4, true, 2.1), tubeMat);
    add(ribbon(M, i0, cnt, i => [[dd(i) + side * 0.3, 0.15], [dd(i) + side * 0.3, 0.9], [dd(i) + side * 0.7, 0.9], [dd(i) + side * 0.8, 0.02]], 4, false), metal);
  };
  wallSet(0, M.N, -1);
  if (HASBR) { wallSet(SB, mod(SA - SB, M.N) - 1, 1); wallSet(SA, SB - SA - 1, 1); } else wallSet(0, M.N, 1);
  // ---------- reflector posts every 9 m on both rails: strong close-range parallax ----------
  { const pts = []; for (let i = 0; i < M.N; i += 9) { if (HASBR && i > SA - 4 && i < SB + 4) continue; pts.push([i, -(M.WL[i] + 0.55)], [i, M.WR[i] + 0.55]); }
    const posts = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.82, 0.95) }), pts.length);
    pts.forEach(([i, d], k) => posts.setMatrixAt(k, frameMat(M, i, d, 1.9, 0.09, 0.9, 0.09))); WORLD.add(posts); }
  // ---------- shortcut branch: narrow, no rails ----------
  if (HASBR) {
  const B = BR;
  add(ribbon(B, 0, B.N - 1, i => [[-B.WL[i], 0], [B.WR[i], 0]], 24, false), roadMat);
  add(ribbon(B, 0, B.N - 1, i => [[-B.WL[i] - 0.3, 0.02], [-B.WL[i] - 0.3, -1.1], [B.WR[i] + 0.3, -1.1], [B.WR[i] + 0.3, 0.02]], 8, false), hullMat);
  const hazTex = canvasTex(64, 256, g => { for (let y = 0; y < 256; y += 64) { g.fillStyle = '#ff7a10'; g.fillRect(0, y, 64, 32); g.fillStyle = '#18080a'; g.fillRect(0, y + 32, 64, 32); } });
  hazTex.wrapT = THREE.RepeatWrapping;
  const hazMat = new THREE.MeshBasicMaterial({ map: hazTex, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  add(ribbon(B, 0, B.N - 1, i => [[-B.WL[i], 0.03], [-B.WL[i] + 0.6, 0.03]], 4, false), hazMat);
  add(ribbon(B, 0, B.N - 1, i => [[B.WR[i] - 0.6, 0.03], [B.WR[i], 0.03]], 4, false), hazMat);
  // divider gore + sign at the fork
  {
    const g = new THREE.Group(); g.matrixAutoUpdate = false; frameMat(M, SA, W0 + 0.0, 0, 1, 1, 1, g.matrix);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.8, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 1.6, 0.2) })); nose.position.set(0, 0.9, 0); g.add(nose);
    const tex = canvasTex(1024, 160, gg => {
      gg.fillStyle = '#07040e'; gg.fillRect(0, 0, 1024, 160); gg.textBaseline = 'middle';
      gg.font = '900 50px Orbitron'; gg.textAlign = 'left'; neonText(gg, '◀ SAFE ROUTE', 40, 82, '#b07bff');
      gg.textAlign = 'right'; neonText(gg, 'LOOP · NO RAILS ▶', 984, 82, '#ff8a2a');
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(22, 3.4), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2, 2, 2), side: THREE.DoubleSide }));
    panel.position.set(-3.5, 11, -40); panel.rotation.y = Math.PI; g.add(panel);
    for (const x of [-14, 7]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.6, 11, 0.6), metal); p.position.set(x, 5.5, -40); g.add(p); }
    WORLD.add(g); g.updateMatrixWorld(true);
  }
  }
  // ---------- Monaco tunnel ----------
  const tmat = new THREE.MeshStandardMaterial({ color: 0x0b0a13, metalness: 0.55, roughness: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.7 });
  const ringItems = [];
  for (const [a, b] of tunnelRanges(M)) {
    add(ribbon(M, a, b - a, i => { const w = M.W[i]; return [[-w - 1.2, -0.5], [-w - 1.2, 5.6], [-w + 2.2, 8.0], [w - 2.2, 8.0], [w + 1.2, 5.6], [w + 1.2, -0.5]]; }, 8, false), tmat);
    for (let i = a + 3; i < b; i += 6) ringItems.push(i);
  }
  const rings = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), ringItems.length * 3);
  ringItems.forEach((i, r) => {
    const w = M.W[i]; const col = (r % 2 ? NEON.y : NEON.m).clone().multiplyScalar(1.7);
    rings.setMatrixAt(r * 3, frameMat(M, i, 0, 7.9, 2 * (w - 2.2), 0.12, 0.5));
    rings.setMatrixAt(r * 3 + 1, frameMat(M, i, -(w + 1.1), 3.2, 0.12, 4.6, 0.4));
    rings.setMatrixAt(r * 3 + 2, frameMat(M, i, (w + 1.1), 3.2, 0.12, 4.6, 0.4));
    for (let q = 0; q < 3; q++) rings.setColorAt(r * 3 + q, col);
  });
  WORLD.add(rings);
  // ---------- supports: pillars under raised upright road, hangers above inverted road ----------
  const pil = [], hang = [];
  const addSupports = (path, step) => {
    for (let i = 0; i < path.N; i += step) {
      const P = path.P[i], U = path.U[i];
      if (U.y > 0.8 && P.y > 5) pil.push([P.x, P.y - 1.4, P.z]);
      if (U.y < -0.6) { const top = deckTopAt(P.x, P.z); if (top) hang.push([P.x, P.y + 1.4, P.z, top]); }
    }
  };
  addSupports(MAIN, 28); if (HASBR) addSupports(BR, 40);
  const pm = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ color: 0x14121e, metalness: 0.5, roughness: 0.5 }), pil.length + hang.length);
  const pn = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), pil.length + hang.length);
  let k = 0;
  for (const [x, y, z] of pil) { setInst(pm, k, x, y / 2, z, 2.4, y, 2.4); setInst(pn, k, x + 1.25, y / 2, z, 0.16, y * 0.92, 0.16); pn.setColorAt(k, NEON.p.clone().multiplyScalar(2.4)); k++; }
  for (const [x, y, z, top] of hang) { const hgt = top - y; setInst(pm, k, x, y + hgt / 2, z, 0.9, hgt, 0.9); setInst(pn, k, x + 0.55, y + hgt / 2, z, 0.12, hgt, 0.12); pn.setColorAt(k, NEON.r.clone().multiplyScalar(2.6)); k++; }
  WORLD.add(pm, pn);
  // M8-ENV HOOK H9: themed road-edge dressing outside the walls (no road/centreline change)
  buildEdgeDressing({ THEME, MAIN, BR: HASBR ? BR : null, WB, deckTopAt, isOpen: i => !inTunnel(i) && !(HASBR && i > SA - 6 && i < SB + 6) }, WORLD);
}

/* ============================== sky decks (hanging skylines) ============================== */
const DECKS = [];
function planDecks() {
  // R4: open sky. The old ceiling slabs and upside-down hanging city deliberately
  // filled the view above inversion sectors, making sky read as a second ground.
  DECKS.length=0;
}
function deckTopAt(x, z) { for (const d of DECKS) if (x > d.x0 && x < d.x1 && z > d.z0 && z < d.z1) return d.y; return 0; }

/* ============================== city ============================== */
const bList = [], hList = [], exclusions = [];
const SIGN_V = ['ラーメン', 'ネオン', '電脳街', '酒場', 'ホテル', '夜市', 'NEON', 'BAR', 'HOTEL', '24H', '寿司', 'CLUB'];
const SIGN_H = ['NIGHTGRID', 'KAGE ENERGY', 'OPEN 24H', 'MAGLEV CO', 'ROBO NOODLE', 'DATA BAR', 'HOTEL ASTRA', 'SYNTH CAFE', '電脳', 'PACHINKO'];
function makeSign(text, col, vertical) {
  const W = vertical ? 128 : 512, H = vertical ? 512 : 160;
  return canvasTex(W, H, g => {
    g.fillStyle = '#07040e'; g.fillRect(0, 0, W, H);
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.shadowColor = col; g.shadowBlur = 16; g.strokeStyle = col; g.lineWidth = 5; rr(g, 9, 9, W - 18, H - 18, 12); g.stroke();
    g.shadowBlur = 0; g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 1.5; rr(g, 9, 9, W - 18, H - 18, 12); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (vertical) {
      const ch = [...text]; const step = (H - 64) / ch.length; const sz = Math.min(90, step * 0.86);
      g.font = `900 ${sz}px Orbitron, ${FONT_JP}`;
      ch.forEach((c, k) => neonText(g, c, W / 2, 32 + (k + 0.5) * step, col));
    } else {
      let sz = 84; g.font = `900 ${sz}px Orbitron, ${FONT_JP}`;
      while (g.measureText(text).width > W - 70 && sz > 20) { sz -= 4; g.font = `900 ${sz}px Orbitron, ${FONT_JP}`; }
      neonText(g, text, W / 2, H / 2 + 3, col);
    }
  });
}
const flickerMats = [];
function windowMaterial() {
  const bMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.38, metalness: 0.55, envMapIntensity: 0.55 });
  const WU = windowUniforms(THEME);   // M8-ENV HOOK H4: themed window palette / density / cell size
  bMat.customProgramCacheKey = () => 'ngwin-m8';
  bMat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, WU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP; varying vec3 vLN; varying vec2 vSeed; varying vec3 vSc;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vLP = position * sc; vLP.y += instanceMatrix[3].y; vLN = normal; vSeed = floor(instanceMatrix[3].xz); vSc = sc;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLP; varying vec3 vLN; varying vec2 vSeed; varying vec3 vSc;
        uniform vec3 uWA, uWB, uWC; uniform vec2 uWSplit, uWCell; uniform float uWDens, uWInt;
        float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (abs(vLN.y) < 0.5) {
          vec2 sd = floor(vSeed + 0.5); vec2 nn = floor(vLN.xz + 0.5);
          vec2 q = abs(vLN.x) > 0.5 ? vec2(vLP.z + vSc.z * 0.5, vLP.y) : vec2(vLP.x + vSc.x * 0.5, vLP.y);
          vec2 cs = uWCell;
          vec2 g = q / cs; vec2 cell = floor(g); vec2 f = fract(g);
          float bs = h21(sd * 0.0137 + 0.3);
          float dens = (0.1 + 0.48 * bs) * uWDens;
          float win = smoothstep(0.1, 0.18, f.x) * smoothstep(0.9, 0.82, f.x) * smoothstep(0.2, 0.3, f.y) * smoothstep(0.86, 0.76, f.y);
          float r = h21(cell + sd + nn * 7.0);
          float rowR = h21(vec2(cell.y, bs * 91.0));
          float lit = step(1.0 - dens, r);
          lit = max(lit, step(0.94, rowR) * step(0.25, r));
          float hue = h21(vec2(bs * 17.0, 3.1));
          vec3 wc = hue < uWSplit.x ? uWA : (hue < uWSplit.y ? uWB : uWC);
          wc *= 0.5 + 0.9 * h21(cell * 1.7 + 3.0);
          float aa = clamp(1.0 - length(fwidth(g)) * 1.3, 0.0, 1.0);
          float val = mix(dens * 0.38, win * lit, aa);
          float ground = smoothstep(1.5, 4.5, vLP.y);
          totalEmissiveRadiance += wc * val * ground * 1.05 * uWInt;
          diffuseColor.rgb *= 0.75 + 0.5 * win;
        }`);
  };
  return bMat;
}
// M3 ground: same 6 km plane, material and texture mapping as v5b, but cut into pits wherever
// the swept road solid (core/terrain.js) dips below ground level. Flat 20 m tiles everywhere
// except pit blocks, which use the 2 m clearance grid. City foundations are untouched (buildings
// keep >= W+15 m from any low track sample, see tests).
let CLEARANCE = null;
function buildGroundGeometry(cx, cz) {
  const cl = CLEARANCE = buildClearance(TD), B = cl.block, half = 3000;
  const X0 = Math.floor((cx - half - cl.x0) / B) * B + cl.x0, Z0 = Math.floor((cz - half - cl.z0) / B) * B + cl.z0, nb = Math.ceil(2 * half / B);
  const pit = new Set(cl.blocks.map(([x, z]) => x + ',' + z));
  const pos = [], uv = [], idx = [];
  const vtx = (x, y, z) => { pos.push(x, y, z); uv.push((x - cx + half) / (2 * half), (half - (z - cz)) / (2 * half)); return pos.length / 3 - 1; };
  // flat tiles (shared vertex grid), skipping pit blocks
  const base = pos.length / 3;
  for (let j = 0; j <= nb; j++) for (let i = 0; i <= nb; i++) vtx(X0 + i * B, GROUND_Y, Z0 + j * B);
  for (let j = 0; j < nb; j++) for (let i = 0; i < nb; i++) {
    if (pit.has((X0 + i * B) + ',' + (Z0 + j * B))) continue;
    const a = base + j * (nb + 1) + i, b = a + 1, c = a + nb + 1, d = c + 1; idx.push(a, c, b, b, c, d);
  }
  const flatIdx = idx.length;
  // pit blocks at the clearance-grid resolution
  const per = Math.round(B / cl.cell);
  for (const [bx, bz] of cl.blocks) {
    const gi = Math.round((bx - cl.x0) / cl.cell), gj = Math.round((bz - cl.z0) / cl.cell), b0 = pos.length / 3;
    for (let j = 0; j <= per; j++) for (let i = 0; i <= per; i++) { const ii = Math.min(cl.nx - 1, gi + i), jj = Math.min(cl.nz - 1, gj + j); vtx(bx + i * cl.cell, cl.req[jj * cl.nx + ii], bz + j * cl.cell); }
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) { const a = b0 + j * (per + 1) + i, b = a + 1, c = a + per + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  g.addGroup(0, flatIdx, 0); g.addGroup(flatIdx, idx.length - flatIdx, 1);   // 0: flat tiles, 1: pit blocks
  return g;
}
let GROUND_TILES = [];
// split an indexed geometry (with material groups) into square tiles by triangle centroid; tiles share the
// source attributes (uploaded once) and get exact bounds from their own vertices
function tileGeometry(g, size) {
  const P = g.attributes.position.array, I = g.index.array, tiles = new Map();
  for (const gr of g.groups) for (let k = gr.start; k < gr.start + gr.count; k += 3) {
    const a = I[k] * 3, b = I[k + 1] * 3, c = I[k + 2] * 3;
    const key = Math.floor((P[a] + P[b] + P[c]) / 3 / size) + ',' + Math.floor((P[a + 2] + P[b + 2] + P[c + 2]) / 3 / size);
    let t = tiles.get(key); if (!t) tiles.set(key, t = [[], []]);
    t[gr.materialIndex].push(I[k], I[k + 1], I[k + 2]);
  }
  const out = [];
  for (const [, [i0, i1]] of tiles) {
    const geo = new THREE.BufferGeometry();
    for (const n in g.attributes) geo.setAttribute(n, g.attributes[n]);
    const idx = i0.concat(i1); geo.setIndex(idx); geo.addGroup(0, i0.length, 0); geo.addGroup(i0.length, i1.length, 1);
    const box = new THREE.Box3(), v = new THREE.Vector3(); for (const i of idx) box.expandByPoint(v.fromArray(P, i * 3));
    geo.boundingBox = box; geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    out.push({ geo, rect: [box.min.x, box.min.z, box.max.x, box.max.z] });
  }
  return out;
}
// ground tiles wholly beyond the fog's visible range are not drawn: FogExp2 transmits exp(-(d*rho)^2),
// i.e. < 0.012 % beyond d = 3/rho (1,250 m at rho = 0.0024), so skipping them is not visible
function cullGround(cam) {
  if (DEBUG && window.__ngNoCull) { for (const m of GROUND_TILES) { m.visible = true; m.frustumCulled = false; } return; }
  for (const m of GROUND_TILES) m.frustumCulled = true;
  if (!scene.fog || !scene.fog.density) return;
  const lim = 3 / scene.fog.density, x = cam.position.x, z = cam.position.z;
  for (const m of GROUND_TILES) { const [x0, z0, x1, z1] = m.userData.rect; const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1); m.visible = dx * dx + dz * dz < lim * lim; }
}
function buildCity() {
  // spatial hash of all track samples (with height + width)
  const CELL = 32, grid = new Map();
  const put = (path, step) => { for (let i = 0; i < path.N; i += step) { const p = path.P[i]; const k = Math.floor(p.x / CELL) + ',' + Math.floor(p.z / CELL); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([p.x, p.y, p.z, path === MAIN ? Math.max(MAIN.WL[i], MAIN.WR[i]) : WB + 2, path, i]); } };
  put(MAIN, 2); if (HASBR) put(BR, 2);
  const nearQ = (x, z, rad) => { const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), out = []; const nc = Math.ceil(rad / CELL); for (let a = -nc; a <= nc; a++) for (let b = -nc; b <= nc; b++) { const arr = grid.get((cx + a) + ',' + (cz + b)); if (arr) for (const s of arr) { const d = Math.hypot(s[0] - x, s[2] - z); if (d < rad) out.push([d, s]); } } return out; };
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const p of MAIN.P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const signsV = [], signsH = [];
  for (let gx = minX - 480; gx < maxX + 480; gx += 26) {
    for (let gz = minZ - 480; gz < maxZ + 480; gz += 26) {
      const x = gx + R(-3, 3), z = gz + R(-3, 3);
      const w = R(9, 19.5), dd = R(9, 19.5), hd = Math.hypot(w, dd) / 2;
      const near = nearQ(x, z, 64);
      let cap = 1e9, ok = true, dmin = 999, nearestS = null;
      for (const [d, s] of near) {
        if (d < dmin) { dmin = d; nearestS = s; }
        if (d < s[3] + 9 + hd) { if (s[1] < 16) { ok = false; break; } cap = Math.min(cap, s[1] - 18); }
      }
      if (!ok) continue;
      let ex = false; for (const e of exclusions) if (Math.hypot(e.x - x, e.z - z) < e.r + hd) { ex = true; break; }
      if (ex) continue;
      const far = dmin > 380;
      if (far && rnd() < 0.4) continue;
      const n = vnoise(x * 0.0045, z * 0.0045);
      let h = dmin < 70 ? R(16, 46) + n * 50 : R(18, 60) + n * 120 + (rnd() < 0.3 ? R(0, 50) : 0);
      if (rnd() < 0.05 && dmin > 60) h = R(150, 260);
      if (far) h *= 0.8;
      const deck = deckTopAt(x, z); if (deck) cap = Math.min(cap, deck - 120);
      h = Math.min(h, cap); if (h < 10) continue;
      bList.push({ x, z, w, d: dd, h, y0: 0, rot: 0, td: dmin });
      if (h > 70 && rnd() < 0.6 && h * 1.3 < cap) bList.push({ x, z, w: w * 0.68, d: dd * 0.68, h: h * R(0.12, 0.3), y0: h, rot: 0, td: dmin });
      if (dmin < 75 && nearestS && nearestS[1] < 16 && rnd() < 0.62 && !(nearestS[4] === MAIN && (MAIN.tag[nearestS[5]] & TRK.TUNNEL))) {
        const tx = nearestS[0] - x, tz = nearestS[2] - z;
        let nx = 0, nz = 0, ext, wid;
        if (Math.abs(tx) / w > Math.abs(tz) / dd) { nx = Math.sign(tx); ext = w / 2; wid = dd; } else { nz = Math.sign(tz); ext = dd / 2; wid = w; }
        const off = R(-1, 1) * Math.max(0, wid / 2 - 3);
        const vert = rnd() < 0.62;
        const sw = vert ? R(3, 4.2) : R(9, Math.min(15, wid - 1)), sh = vert ? sw * 3.6 : sw * 0.3;
        if (vert || wid >= 10) {
          const sy = clamp(R(7, 34), sh / 2 + 4, Math.max(sh / 2 + 4, h - sh / 2 - 2));
          (vert ? signsV : signsH).push({ x: x + nx * (ext + 0.25) + (nz !== 0 ? off : 0), y: sy, z: z + nz * (ext + 0.25) + (nx !== 0 ? off : 0), sw, sh, ry: Math.atan2(nx, nz), t: Math.floor(rnd() * (vert ? SIGN_V.length : SIGN_H.length)) });
        }
      }
      if (bList.length > 7800) break;
    }
  }
  // hanging skylines under the sky decks
  for (const D of DECKS) {
    for (let x = D.x0 + 10; x < D.x1 - 10; x += 30) for (let z = D.z0 + 10; z < D.z1 - 10; z += 30) {
      if (rnd() < 0.25) continue;
      const px = x + R(-5, 5), pz = z + R(-5, 5), w = R(10, 22), dd = R(10, 22), hd = Math.hypot(w, dd) / 2;
      let len = R(30, 150) * (0.6 + vnoise(px * 0.01, pz * 0.01) * 0.8);
      for (const [d, s] of nearQ(px, pz, 70)) if (d < s[3] + 14 + hd) len = Math.min(len, D.y - (s[1] + 30));
      if (len < 14) continue;
      hList.push({ x: px, z: pz, w, d: dd, h: len, y0: D.y - len, rot: 0 });
      if (rnd() < 0.4) hList.push({ x: px, z: pz, w: w * 0.5, d: dd * 0.5, h: R(8, 30), y0: D.y - len - R(8, 30) * 0.999, rot: 0, spire: 1 });
    }
  }
  // M8-ENV HOOK H5: themed massing (heights / setback tiers / harbour yards) before the meshes are built; own RNG
  const ENVCTX = { THEME, MAIN, BR: HASBR ? BR : null, WB, deckTopAt, isOpen: i => !inTunnel(i) && !(HASBR && i > SA - 6 && i < SB + 6) };
  const r4lm=buildR4Landmarks(scene,{key:MAPKEY,MAIN,BR:HASBR?BR:null},THEME);WORLD.add(r4lm);
  const footprints=r4lm.userData.r4Landmarks?.footprints||[];
  for(let i=bList.length-1;i>=0;i--){const b=bList[i];if(footprints.some(p=>Math.hypot(b.x-p.x,b.z-p.z)<p.r+Math.hypot(b.w,b.d)/2+4))bList.splice(i,1);}
  const ENVANN = shapeBuildings(ENVCTX, bList, [signsV, signsH]);
  const bMat = windowMaterial();
  const BB = THEME.building.base;   // tint ranges; same number of R() draws as before (city stream unchanged)
  const mkB = (list) => {
    const im = new THREE.InstancedMesh(BOX, bMat, list.length); const bc = new THREE.Color();
    list.forEach((b, k) => { setInst(im, k, b.x, b.y0 + b.h / 2, b.z, b.w, b.h, b.d, b.rot); bc.setRGB(lerp(BB[0], BB[3], R()), lerp(BB[1], BB[4], R()), lerp(BB[2], BB[5], R())); im.setColorAt(k, bc); });
    WORLD.add(im); return im;
  };
  mkB(bList); mkB(hList);
  // deck slabs
  const deckTex = canvasTex(256, 256, g => { g.fillStyle = '#05040a'; g.fillRect(0, 0, 256, 256); for (let i = 0; i < 70; i++) { g.fillStyle = pick(['#ffb46a', '#6ad6ff', '#ff4fd8', '#ffffff']); g.globalAlpha = R(0.4, 1); g.fillRect(R(0, 256), R(0, 256), R(2, 6), R(2, 6)); } g.globalAlpha = 1; g.strokeStyle = 'rgba(0,240,255,0.25)'; g.strokeRect(0, 0, 256, 256); });
  deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
  for (const D of DECKS) {
    const w = D.x1 - D.x0, d = D.z1 - D.z0;
    const t = deckTex.clone(); t.needsUpdate = true; t.repeat.set(w / 60, d / 60);
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 10, d), new THREE.MeshStandardMaterial({ color: 0x0b0a12, metalness: 0.7, roughness: 0.4, emissiveMap: t, emissive: new THREE.Color(1.3, 1.3, 1.3) }));
    slab.position.set((D.x0 + D.x1) / 2, D.y + 5, (D.z0 + D.z1) / 2); WORLD.add(slab);
    const edge = new THREE.MeshBasicMaterial({ color: NEON.m.clone().multiplyScalar(3) });
    for (const [x, z, sx, sz] of [[0, -d / 2, w, 1], [0, d / 2, w, 1], [-w / 2, 0, 1, d], [w / 2, 0, 1, d]]) { const e = new THREE.Mesh(new THREE.BoxGeometry(sx + 1, 1, sz + 1), edge); e.position.set(slab.position.x + x, D.y - 0.2, slab.position.z + z); WORLD.add(e); }
  }
  // neon strips on ground buildings
  const strips = [];
  for (const b of bList) {
    if (b.td > 220 || b.y0 > 0 || rnd() > 0.5) continue;
    const col = pick(THEME.strips);   // M8-ENV HOOK H6: themed neon strips (one pick, same RNG draw)
    const cx = rnd() < 0.5 ? -1 : 1, cz = rnd() < 0.5 ? -1 : 1;
    const sh = b.h * R(0.4, 0.95);
    strips.push([b.x + cx * b.w / 2, sh / 2 + R(0, b.h - sh), b.z + cz * b.d / 2, 0.38, sh, 0.38, col]);
    if (rnd() < 0.6) { const y = b.h - R(0.4, 6); strips.push([b.x, y, b.z, b.w + 0.3, 0.35, b.d + 0.3, col]); }
  }
  for (const b of hList) { if (rnd() > 0.45) continue; const col = pick(THEME.strips); strips.push([b.x, b.y0 + R(0.3, 3), b.z, b.w + 0.3, 0.35, b.d + 0.3, col]); }
  const sm = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), strips.length);
  strips.forEach((s, k) => { setInst(sm, k, s[0], s[1], s[2], s[3], s[4], s[5]); sm.setColorAt(k, s[6].clone().multiplyScalar(R(1.8, 3.2))); });
  beatMaterial(sm.material);WORLD.add(sm);
  const tall = bList.filter(b => b.h > 110 && b.y0 === 0);
  const av = new THREE.InstancedMesh(new THREE.SphereGeometry(0.7, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.4) }), Math.max(1, tall.length));
  tall.forEach((b, k) => setInst(av, k, b.x, b.h + 1, b.z, 1, 1, 1)); WORLD.add(av);
  // signs
  const plane = new THREE.PlaneGeometry(1, 1);
  const mk = (list, texts, vert) => {
    texts.forEach((txt, ti) => {
      const items = list.filter(s => s.t === ti); if (!items.length) return;
      const col = NEON_CSS[(ti * 7 + (vert ? 0 : 3)) % NEON_CSS.length];
      const mat = new THREE.MeshBasicMaterial({ map: makeSign(txt, col, vert), color: new THREE.Color(2.3, 2.3, 2.3) });
      if (ti % 4 === 1) flickerMats.push({ mat, seed: R(0, 100) });
      const im = new THREE.InstancedMesh(plane, mat, items.length);
      items.forEach((s, k) => setInst(im, k, s.x, s.y, s.z, s.sw, s.sh, 1, s.ry));
      WORLD.add(im);
    });
  };
  mk(signsV, SIGN_V, true); mk(signsH, SIGN_H, false);
  buildCircuitLandmarks(ENVCTX,WORLD);
  buildSkyline(ENVCTX, WORLD, ENVANN);   // M8-ENV HOOK H7: themed crowns / landmarks / harbour kit
  const GT = THEME.ground;   // M8-ENV HOOK H8: themed ground (grid colours, base colour, gloss)
  const gtex = canvasTex(256, 256, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256); g.fillStyle = GT.grid1; g.fillRect(0, 0, 256, 2); g.fillRect(0, 0, 2, 256); g.fillStyle = GT.grid2; g.fillRect(0, 128, 256, 1); g.fillRect(128, 0, 1, 256); });
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping; gtex.repeat.set(6000 / 50, 6000 / 50);
  // single-sided like v5b (no visible underside). Flat ground: original material. Pit embankments: matte
  // retaining-wall variant of the same material (no mirror streaks on steep faces).
  const gGeo = buildGroundGeometry((minX + maxX) / 2, (minZ + maxZ) / 2);
  const gMats = [new THREE.MeshStandardMaterial({ color: GT.color, roughness: GT.roughness, metalness: GT.metalness, envMapIntensity: 0.6, emissiveMap: gtex, emissive: new THREE.Color(GT.emissive, GT.emissive, GT.emissive) }),
    new THREE.MeshStandardMaterial({ color: 0x0c0b12, roughness: 0.88, metalness: 0.15, envMapIntensity: 0.15, emissiveMap: gtex, emissive: new THREE.Color(0.32, 0.32, 0.36) })];
  // M4 perf: the 6 km ground used to be ONE ~410k-triangle mesh, always drawn whole (frustum culling
  // cannot reject part of a mesh). It is split into 750 m tiles that SHARE the same vertex buffers and
  // materials (identical triangles), each with exact bounds, so off-screen tiles are culled, and tiles
  // entirely beyond the fog's visible range are skipped (see cullGround).
  const ground = new THREE.Group(); ground.name = 'ground';
  for (const t of tileGeometry(gGeo, 750)) { const m = new THREE.Mesh(t.geo, gMats); m.userData.rect = t.rect; ground.add(m); }
  GROUND_TILES = ground.children; WORLD.add(ground);
  return { minX, maxX, minZ, maxZ };
}

/* ============================== props ============================== */
const holoAds = [];
let chevTex, startLamps = [], searchlights = [], traffic, trafficLanes = [], holoCenter, BOUNDS;
function nearGantry(i) { for (const c of SECSTART) if (Math.abs(mod(i - c + MAIN.N / 2, MAIN.N) - MAIN.N / 2) < 16) return true; return false; }
const inTunnel = i => !!(MAIN.tag[i] & TRK.TUNNEL);
const nearFork = i => i > SA - 140 && i < SB + 140;
function planBillboards() {
  const cand = [];
  for (let i = 0; i < MAIN.N; i += 7) { const P = MAIN.P[i]; if (MAIN.U[i].y > 0.97 && P.y < 3 && !inTunnel(i) && !nearFork(i) && !nearGantry(i) && Math.abs(MAIN.KG[i]) < 0.004) cand.push(i); }
  for (let k = 0; k < 7; k++) {
    const i = cand[Math.floor((k + 0.5) / 7 * cand.length)]; if (i == null) continue;
    const s = k % 2 ? 1 : -1, d = s * (MAIN.W[i] + 30);
    const x = MAIN.P[i].x + MAIN.R[i].x * d, z = MAIN.P[i].z + MAIN.R[i].z * d;
    exclusions.push({ x, z, r: 22 }); holoAds.push({ i, s, x, z, ad: k % 3 });
  }
}
const ADS = [
  { t: 'KAGE ENERGY', s: '影 · DRINK THE DARK', a: '#ff2bd6', b: '#00f0ff' },
  { t: 'MAGLEV+', s: 'STICK TO ANYTHING · 0% APR', a: '#00f0ff', b: '#8a5cff' },
  { t: 'ネオン 2087', s: 'NIGHTGRID LEAGUE · LIVE TONIGHT', a: '#ffc23f', b: '#ff2bd6' }
];
const adCanvases = [];
function drawAd(k, t) {
  const { c, g, tex } = adCanvases[k]; const ad = ADS[k]; const W = 512, H = 256;
  g.clearRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, ad.a + '30'); bg.addColorStop(1, ad.b + '22'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = ad.b + '40'; g.lineWidth = 1;
  for (let x = (t * 30) % 32; x < W; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.save(); g.translate(96, 128); g.rotate(t * 0.8);
  g.strokeStyle = ad.a; g.lineWidth = 6; g.shadowColor = ad.a; g.shadowBlur = 20;
  g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 60, Math.sin(a) * 60); } g.closePath(); g.stroke();
  g.rotate(-t * 1.9); g.strokeStyle = ad.b; g.beginPath(); g.arc(0, 0, 34, 0, Math.PI * 1.4); g.stroke();
  g.restore();
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `900 46px Orbitron, ${FONT_JP}`; neonText(g, ad.t, 180, 104, ad.a);
  g.font = `700 22px Rajdhani, ${FONT_JP}`; g.fillStyle = ad.b; g.shadowColor = ad.b; g.shadowBlur = 10; g.fillText(ad.s, 182, 156); g.shadowBlur = 0;
  g.fillStyle = 'rgba(0,0,0,0.35)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
  const sy = (t * 90) % (H + 60) - 30; const sg = g.createLinearGradient(0, sy - 30, 0, sy + 30); sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(0.5, 'rgba(255,255,255,0.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = sg; g.fillRect(0, sy - 30, W, 60);
  if (Math.sin(t * 2.3 + k * 3) > 0.93) { for (let n = 0; n < 4; n++) { const y = Math.random() * H, h = 6 + Math.random() * 20; g.drawImage(c, 0, y, W, h, (Math.random() - 0.5) * 50, y, W, h); } }
  tex.needsUpdate = true;
}
function gantry(i, label, sub, col, big) {
  const g = new THREE.Group(); g.matrixAutoUpdate = false; frameMat(MAIN, i, 0, 0, 1, 1, 1, g.matrix);
  const W = Math.max(MAIN.WL[i], MAIN.WR[i]);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14121e, metalness: 0.8, roughness: 0.35 });
  const neon = beatMaterial(new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(3.2) }));
  for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 13, 1.2), dark); p.position.set(s * (W + 2.2), 6.5, 0); g.add(p);
    const n = new THREE.Mesh(new THREE.BoxGeometry(0.16, 11.5, 0.16), neon); n.position.set(s * (W + 1.55), 6.2, -0.65); g.add(n);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(2 * (W + 3), 1.8, 1.4), dark); beam.position.y = 12; g.add(beam);
  const un = new THREE.Mesh(new THREE.BoxGeometry(2 * (W + 2.4), 0.14, 0.14), neon); un.position.set(0, 11.05, -0.72); g.add(un);
  const css = '#' + col.getHexString();
  const tex = canvasTex(1024, 128, gg => {
    gg.fillStyle = '#06030c'; gg.fillRect(0, 0, 1024, 128);
    gg.textAlign = 'center'; gg.textBaseline = 'middle';
    gg.font = '900 54px Orbitron'; neonText(gg, label, 512, 58, css);
    gg.font = '700 20px Orbitron'; gg.fillStyle = 'rgba(255,255,255,0.7)'; gg.fillText(sub, 512, 108);
    gg.font = '900 60px Orbitron'; neonText(gg, '»', 50, 62, '#ffc23f'); neonText(gg, '«', 974, 62, '#ffc23f');
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 4, 1.7), new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(2.1, 2.1, 2.1) }));
  panel.position.set(0, 12, -0.72); panel.rotation.y = Math.PI; g.add(panel);
  if (big) {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 0.02, 0.03) });
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10), m); l.position.set((k - 1) * 2.2, 14.2, -0.3); g.add(l); startLamps.push(m);
    }
    const ct = canvasTex(256, 64, gg => { for (let y = 0; y < 2; y++) for (let x = 0; x < 16; x++) { gg.fillStyle = (x + y) % 2 ? '#d8d8e8' : '#0a0a10'; gg.fillRect(x * 16, y * 32, 16, 32); } });
    ct.magFilter = THREE.NearestFilter;
    const chk = new THREE.Mesh(new THREE.PlaneGeometry(2 * W, 2.4), new THREE.MeshStandardMaterial({ map: ct, roughness: 0.3, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    chk.rotation.x = -Math.PI / 2; chk.position.y = 0.05; g.add(chk);
  }
  WORLD.add(g); g.updateMatrixWorld(true);
}
function buildProps() {
  // gantries: start/finish + every sector entry
  gantry(SECSTART[0], `${MAPDEF.name.toUpperCase()} · START / FINISH`, `${LAPS} LAPS`, NEON.m, true);
  for (let s = 1; s < SECTORS.length; s++) gantry(SECSTART[s], `S${s + 1} · ${SECTORS[s].name}`, SECTORS[s].sub, SECTORS[s].col, false);
  // streetlights (frame-relative, so they work on banked & inverted road too)
  const lamps = []; let side = 1;
  const LC = [NEON.w, NEON.c, NEON.m, NEON.w, NEON.p];
  for (let i = 12; i < MAIN.N; i += 36) { if (inTunnel(i) || nearGantry(i) || Math.abs(MAIN.U[i].y) < 0.75) continue; side = -side; lamps.push({ i, s: side, col: LC[lamps.length % LC.length] }); }
  const poles = new THREE.InstancedMesh(BOX, new THREE.MeshStandardMaterial({ color: 0x1a1826, metalness: 0.8, roughness: 0.4 }), lamps.length * 2);
  const heads = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), lamps.length);
  const cg = coneGeo(0.5, 5.2, 9.4, true); cg.translate(0, -4.7, 0);
  const cones = new THREE.InstancedMesh(cg, coneMat(new THREE.Color(1, 1, 1), 0.22), lamps.length);
  const decGeo = new THREE.PlaneGeometry(1, 1); decGeo.rotateX(-Math.PI / 2);
  const decals = new THREE.InstancedMesh(decGeo, new THREE.MeshBasicMaterial({ map: radialTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, side: THREE.DoubleSide }), lamps.length);
  lamps.forEach((l, k) => {
    const { i } = l; const W = l.s < 0 ? MAIN.WL[i] : MAIN.WR[i];
    const dp = l.s * (W + 0.9), dh = l.s * (W - 2.4), da = l.s * (W - 0.9);
    poles.setMatrixAt(k * 2, frameMat(MAIN, i, dp, 5, 0.3, 10, 0.3));
    poles.setMatrixAt(k * 2 + 1, frameMat(MAIN, i, da, 10, 3.8, 0.22, 0.22));
    heads.setMatrixAt(k, frameMat(MAIN, i, dh, 9.8, 2.0, 0.14, 0.6)); heads.setColorAt(k, l.col.clone().lerp(NEON.w, 0.5).multiplyScalar(3));
    cones.setMatrixAt(k, frameMat(MAIN, i, dh, 9.8, 1, 1, 1)); cones.setColorAt(k, l.col.clone().lerp(NEON.w, 0.5).multiplyScalar(0.5));
    decals.setMatrixAt(k, frameMat(MAIN, i, dh, 0.05, 7, 1, 17)); decals.setColorAt(k, l.col.clone().multiplyScalar(0.55));
  });
  WORLD.add(poles, heads, cones, decals);
  // chevrons on the outside of corners
  chevTex = canvasTex(256, 64, g => {
    g.fillStyle = '#0a0612'; g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#ffc23f'; g.lineWidth = 9; g.lineJoin = 'miter'; g.shadowColor = '#ffc23f'; g.shadowBlur = 10;
    for (let x = 0; x < 256; x += 64) { g.beginPath(); g.moveTo(x + 16, 12); g.lineTo(x + 42, 32); g.lineTo(x + 16, 52); g.stroke(); }
  });
  chevTex.wrapS = THREE.RepeatWrapping; chevTex.repeat.set(1.5, 1);
  const chev = [];
  for (let i = 0; i < MAIN.N; i += 13) { if (Math.abs(MAIN.KG[i]) > 1 / 130 && !inTunnel(i) && !(i > SA - 5 && i < SB + 5)) chev.push(i); }
  const chm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: chevTex, color: new THREE.Color(2.2, 2.2, 2.2), side: THREE.DoubleSide }), chev.length);
  const za = new V3();
  chev.forEach((i, k) => {
    const s = MAIN.KG[i] > 0 ? 1 : -1, W = s > 0 ? MAIN.WR[i] : MAIN.WL[i], d = s * (W + 0.95);
    za.copy(MAIN.R[i]).multiplyScalar(-s);
    _m4.makeBasis(MAIN.T[i], MAIN.U[i], za); _m4.scale(_s3.set(6, 1.7, 1));
    const P = MAIN.P[i], Rv = MAIN.R[i], U = MAIN.U[i];
    _m4.setPosition(P.x + Rv.x * d + U.x * 2.5, P.y + Rv.y * d + U.y * 2.5, P.z + Rv.z * d + U.z * 2.5);
    chm.setMatrixAt(k, _m4);
  });
  WORLD.add(chm);
  // branch guide lights (cat-eyes): no rails here, so you need something to aim at
  const ce = [];
  if (HASBR) for (let i = 4; i < BR.N - 2; i += 6) for (const s of [-1, 1]) ce.push([i, s]);
  const cem = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 1.8, 0.2) }), ce.length);
  ce.forEach(([i, s], k) => cem.setMatrixAt(k, frameMat(BR, i, s * (WB + 0.15), 0.12, 0.3, 0.25, 1.2)));
  WORLD.add(cem);
  // holographic billboards
  for (let k = 0; k < 3; k++) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 256;
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    adCanvases.push({ c, g: c.getContext('2d'), tex }); drawAd(k, 0);
  }
  const frameMatN = beatMaterial(new THREE.MeshBasicMaterial({ color: NEON.c.clone().multiplyScalar(2.6) }));
  const legMat = new THREE.MeshStandardMaterial({ color: 0x15131f, metalness: 0.8, roughness: 0.4 });
  for (const h of holoAds) {
    const { i, s } = h; const cy = MAIN.P[i].y + 26;
    const grp = new THREE.Group(); grp.position.set(h.x, cy, h.z);
    const n = new V3().copy(MAIN.R[i]).multiplyScalar(-s).addScaledVector(MAIN.T[i], -0.75); n.y = 0; n.normalize();
    grp.lookAt(h.x + n.x, cy, h.z + n.z);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(34, 17), new THREE.MeshBasicMaterial({ map: adCanvases[h.ad].tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, color: new THREE.Color(2.0, 2.0, 2.0) }));
    beatMaterial(scr.material);grp.add(scr);
    for (const [x, y, w, hh] of [[0, 8.8, 35, 0.35], [0, -8.8, 35, 0.35], [-17.4, 0, 0.35, 17.6], [17.4, 0, 0.35, 17.6]]) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.35), frameMatN); b.position.set(x, y, -0.2); grp.add(b); }
    for (const x of [-10, 10]) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.1, cy - 8.8, 1.1), legMat); l.position.set(x, -(cy - 8.8) / 2 - 8.8, -1); grp.add(l); }
    WORLD.add(grp);
  }
  // central hologram over the Parabolica infield
  const ci = HASBR ? Math.round((SA + SB) / 2) : Math.round(MAIN.N * 0.55);
  const hc = MAIN.P[ci].clone().addScaledVector(MAIN.R[ci], 120);
  holoCenter = new THREE.Group(); holoCenter.position.set(hc.x, 130, hc.z);
  const hm1 = new THREE.MeshBasicMaterial({ color: NEON.m.clone().multiplyScalar(2.4), wireframe: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
  const hm2 = new THREE.MeshBasicMaterial({ color: NEON.c.clone().multiplyScalar(2.2), wireframe: true, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(46, 0.8, 8, 96), new THREE.MeshBasicMaterial({ color: NEON.m.clone().multiplyScalar(3) }));
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(38, 0.5, 8, 96), new THREE.MeshBasicMaterial({ color: NEON.c.clone().multiplyScalar(3) }));
  const ico = new THREE.Mesh(new THREE.IcosahedronGeometry(22, 1), hm2), ico2 = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 0), hm1);
  holoCenter.add(ring1, ring2, ico, ico2); holoCenter.userData = { ring1, ring2, ico, ico2 };
  const beamG = coneGeo(30, 3, 130, false); beamG.translate(0, -65, 0);
  holoCenter.add(new THREE.Mesh(beamG, coneMat(NEON.p.clone().multiplyScalar(0.5), 0.6, 1.2)));
  WORLD.add(holoCenter);
  // searchlights
  const tall = bList.filter(b => b.h > 120 && b.y0 === 0 && b.td < 420 && !deckTopAt(b.x, b.z)).slice(0, 7);
  const sg = coneGeo(14, 0.8, 340, false); sg.translate(0, 170, 0);
  tall.forEach((b, k) => { const m = new THREE.Mesh(sg, coneMat((k % 2 ? NEON.c : NEON.m).clone().multiplyScalar(0.55), 0.5, 2.2)); m.position.set(b.x, b.h, b.z); m.userData.ph = R(0, 10); searchlights.push(m); WORLD.add(m); });
  // flying traffic
  const TRN = 110; const cx = (BOUNDS.minX + BOUNDS.maxX) / 2, cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;
  traffic = new THREE.InstancedMesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffffff }), TRN);
  const tc = [new THREE.Color(3, 2.6, 2.0), new THREE.Color(3.2, 0.25, 0.35), NEON.c.clone().multiplyScalar(2.5), NEON.m.clone().multiplyScalar(2.5)];
  for (let k = 0; k < TRN; k++) {
    const lr = mulberry32(Math.floor(k / 6) * 7 + 3); const a = lr() * Math.PI;
    trafficLanes.push({ ox: cx + (lr() - 0.5) * 1200, oz: cz + (lr() - 0.5) * 1200, dx: Math.sin(a), dz: Math.cos(a), y: 110 + lr() * 80, sp: (24 + lr() * 40) * (k % 2 ? 1 : -1), ph: R(0, 2400), off: (k % 2 ? 2.5 : -2.5) });
    traffic.setColorAt(k, pick(tc));
  }
  WORLD.add(traffic);
}

/* ============================== ships ============================== */
function loft(st, segs = 22, capFront = true, capBack = true) {
  const pos = [], uv = [], idx = [];
  st.forEach((s, k) => {
    for (let j = 0; j <= segs; j++) {
      const a = j / segs * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a), e = 2 / s.p;
      const x = (s.x || 0) + s.w * Math.sign(c) * Math.pow(Math.abs(c), e), y = s.y + s.h * Math.sign(sn) * Math.pow(Math.abs(sn), e) * (sn < 0 ? (s.flat || 1) : 1);
      pos.push(x, y, s.z); uv.push(j / segs, k / (st.length - 1));
    }
  });
  const rw = segs + 1;
  for (let k = 0; k < st.length - 1; k++) for (let j = 0; j < segs; j++) { const a = k * rw + j, b = a + 1, c = a + rw, d = c + 1; idx.push(a, b, c, b, d, c); }
  const cap = (k, flip) => { const s = st[k]; const ci = pos.length / 3; pos.push(s.x || 0, s.y, s.z); uv.push(0.25, k / (st.length - 1)); for (let j = 0; j < segs; j++) { const a = k * rw + j, b = a + 1; flip ? idx.push(ci, b, a) : idx.push(ci, a, b); } };
  if (capBack) cap(0, true); if (capFront) cap(st.length - 1, false);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function liveryTex(cfg, accent) {
  return canvasTex(1024, 512, g => {
    const W = 1024, H = 512;
    g.fillStyle = accent ? cfg.accent : cfg.base; g.fillRect(0, 0, W, H);
    // subtle gradient
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.05)'); gr.addColorStop(1, 'rgba(0,0,0,0.2)'); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // panel seams
    const rr2 = mulberry32(cfg.num * 31 + (accent ? 7 : 0));
    g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 2;
    for (let y = 0; y < H; y += 64 + rr2() * 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let x = 0; x < W; x += 70 + rr2() * 90) { const y0 = rr2() * H; g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y0 + 80 + rr2() * 200); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let y = 2; y < H; y += 97) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.45)'; for (let i = 0; i < 220; i++) { g.fillRect(rr2() * W, rr2() * H, 2, 2); }
    if (accent) return;
    // racing stripe along the spine (u = 0.25 is the top of the hull)
    const sx = W * 0.25;
    g.fillStyle = cfg.stripe; g.fillRect(sx - 34, 0, 22, H); g.fillRect(sx + 12, 0, 22, H);
    if (cfg.hazard) { g.save(); g.beginPath(); g.rect(sx - 70, 0, 140, H); g.clip(); g.fillStyle = '#111'; for (let y = -140; y < H; y += 48) { g.beginPath(); g.moveTo(sx - 70, y); g.lineTo(sx + 70, y + 70); g.lineTo(sx + 70, y + 94); g.lineTo(sx - 70, y + 24); g.fill(); } g.restore(); }
    // side numbers (u = 0 is the left side, u = 0.5 the right side)
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const num = String(cfg.numTxt);
    for (const x of [0, W, W * 0.5]) {
      g.save(); g.translate(x, H * 0.52); g.rotate(x === W * 0.5 ? Math.PI / 2 : -Math.PI / 2);
      g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(0, 0, 54, 0, 7); g.fill();
      g.fillStyle = cfg.numCol || '#111'; g.font = '900 64px Orbitron'; g.fillText(num, 0, 4);
      g.restore();
    }
    // decals
    g.font = '700 22px Orbitron'; g.fillStyle = cfg.decal; g.globalAlpha = 0.8;
    g.save(); g.translate(W * 0.5, H * 0.8); g.rotate(Math.PI / 2); g.fillText(cfg.sponsor, 0, 0); g.restore();
    g.save(); g.translate(W * 0.02, H * 0.8); g.rotate(-Math.PI / 2); g.fillText(cfg.sponsor, 0, 0); g.restore();
    g.font = '700 16px Orbitron'; g.fillText('MAG-LEV', W * 0.25, H * 0.15); g.fillText(cfg.name, W * 0.25, H * 0.9);
    g.globalAlpha = 1;
  });
}
const SHIPCFG = {
  YOU: { name: 'NOVA', num: 7, numTxt: '7', base: '#dfe3ee', accent: '#16c8ff', stripe: '#ff2bd6', decal: '#0a2a44', sponsor: 'NIGHTGRID', neonA: NEON.c, neonB: NEON.m, W: 1.0, nose: 1.8, pod: 1.0, nozzles: 3, wing: 1.0, canopyL: 1.0, fin: 'twin' },
  VEX: { name: 'VEX', num: 13, numTxt: '13', base: '#1b0a0f', accent: '#ff2a3a', stripe: '#ffd23f', decal: '#ff6070', sponsor: 'KAGE ENERGY', numCol: '#c0102a', neonA: NEON.r, neonB: NEON.y, W: 0.86, nose: 2.5, pod: 0.8, nozzles: 2, wing: 0.8, canopyL: 0.85, fin: 'swept' },
  GHOST: { name: 'GHOST', num: 0, numTxt: '00', base: '#a4abc8', accent: '#7c55ff', stripe: '#ffffff', decal: '#3a2a80', sponsor: 'SPECTRAL', numCol: '#5a38d0', neonA: NEON.p, neonB: NEON.c, W: 1.14, nose: 1.6, pod: 0.95, nozzles: 3, wing: 0.0, canopyL: 1.3, fin: 'halo' },
  BLITZ: { name: 'BLITZ', num: 88, numTxt: '88', base: '#ffc81e', accent: '#141414', stripe: '#141414', decal: '#141414', sponsor: 'BLITZ HEAVY', hazard: true, neonA: NEON.o, neonB: NEON.y, W: 1.24, nose: 1.15, pod: 1.35, nozzles: 2, wing: 1.3, canopyL: 0.9, fin: 'big' }
};
const flameColBoost = new THREE.Color(1.4, 0.9, 2.6);
function makeShip(cfg, isPlayer) {
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const W = cfg.W;
  const tex = liveryTex(cfg, false), atex = liveryTex(cfg, true);
  const bodyMat = new THREE.MeshPhysicalMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color(0.2, 0.2, 0.22), metalness: 0.4, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.5 });
  const accMat = new THREE.MeshPhysicalMaterial({ map: atex, emissiveMap: atex, emissive: new THREE.Color(0.16, 0.16, 0.18), metalness: 0.5, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.5 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a12, metalness: 0.85, roughness: 0.35 });
  const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0a1020, metalness: 0.2, roughness: 0.02, clearcoat: 1, envMapIntensity: 2.6, transparent: true, opacity: 0.5, depthWrite: false });
  const nA = new THREE.MeshBasicMaterial({ color: cfg.neonA.clone().multiplyScalar(4) });
  const nB = new THREE.MeshBasicMaterial({ color: cfg.neonB.clone().multiplyScalar(3.2) });
  const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 0.25, 0.5) });
  const head = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4.4, 5) });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  // main body
  const bw = 0.82 * W;
  add(loft([
    { z: -2.15, w: bw * 0.9, h: 0.3, y: 0.0, p: 3.2, flat: 0.7 },
    { z: -1.3, w: bw, h: 0.38, y: 0.05, p: 3, flat: 0.7 },
    { z: 0.0, w: bw * 0.95, h: 0.37, y: 0.06, p: 2.6, flat: 0.7 },
    { z: 1.0, w: bw * 0.72, h: 0.29, y: 0.02, p: 2.4, flat: 0.7 },
    { z: 1.62, w: bw * 0.55, h: 0.21, y: -0.01, p: 2.2, flat: 0.7 }
  ], 24), bodyMat);
  // nose (separate accent piece, small seam gap)
  const nl = cfg.nose;
  add(loft([
    { z: 1.66, w: bw * 0.56, h: 0.215, y: -0.01, p: 2.2, flat: 0.7 },
    { z: 1.66 + nl * 0.45, w: bw * 0.36, h: 0.14, y: -0.04, p: 2.2, flat: 0.7 },
    { z: 1.66 + nl * 0.85, w: bw * 0.12, h: 0.06, y: -0.08, p: 2, flat: 0.7 },
    { z: 1.66 + nl, w: 0.02, h: 0.015, y: -0.09, p: 2 }
  ], 20), accMat);
  // side pods
  const ps = cfg.pod, px = bw + 0.24 * ps + 0.1;
  for (const sx of [-1, 1]) {
    add(loft([
      { x: sx * px, z: -2.25, w: 0.26 * ps, h: 0.24 * ps, y: -0.14, p: 2.4 },
      { x: sx * px, z: -0.8, w: 0.3 * ps, h: 0.27 * ps, y: -0.12, p: 2.4 },
      { x: sx * px, z: 0.6, w: 0.24 * ps, h: 0.21 * ps, y: -0.14, p: 2.4 },
      { x: sx * px, z: 1.35, w: 0.08 * ps, h: 0.08 * ps, y: -0.17, p: 2 }
    ], 16), accMat);
    add(new THREE.BoxGeometry(0.04, 0.05, 2.9), nB, sx * (px + 0.27 * ps), -0.12, -0.5);
    add(new THREE.BoxGeometry(0.05, 0.05, 2.6), nA, sx * (bw * 0.97), -0.24, -0.6);
    const pylon = add(new THREE.BoxGeometry(px - bw + 0.1, 0.08, 1.1), darkMat, sx * (bw + (px - bw) / 2), -0.1, -0.6);
    // hover pads
    for (const z of [0.5, -1.6]) { const pd = add(new THREE.CircleGeometry(0.3 * ps, 18), nA, sx * px, -0.14 - 0.25 * ps, z); pd.rotation.x = Math.PI / 2; }
    // headlight slits
    add(new THREE.BoxGeometry(0.22, 0.04, 0.08), head, sx * bw * 0.5, -0.06, 1.55);
  }
  // canopy + pilot
  const can = add(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), glassMat, 0, 0.3, 0.25);
  can.scale.set(0.4 * W, 0.34, 1.05 * cfg.canopyL); can.renderOrder = 2;
  add(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshStandardMaterial({ color: 0x111118, metalness: 0.6, roughness: 0.3 }), 0, 0.42, 0.05);
  add(new THREE.BoxGeometry(0.2, 0.04, 0.03), nA, 0, 0.45, 0.2);
  add(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), darkMat, 0, 0.29, 0.25).scale.set(0.42 * W, 0.04, 1.08 * cfg.canopyL);
  // rear engine block with nozzles
  add(loft([
    { z: -2.95, w: bw * 0.75, h: 0.3, y: 0.02, p: 6 },
    { z: -2.1, w: bw * 0.85, h: 0.33, y: 0.03, p: 6 }
  ], 20), darkMat);
  add(new THREE.BoxGeometry(bw * 1.4, 0.07, 0.05), tail, 0, 0.3, -2.97);
  const nz = cfg.nozzles === 3 ? [-0.46, 0, 0.46] : [-0.36, 0.36];
  const emitters = [], tails = [];
  nz.forEach((f, k) => {
    const x = f * W * (cfg.nozzles === 2 ? 1.25 : 1), r = (cfg.nozzles === 3 && k === 1 ? 0.13 : 0.17) * (cfg.nozzles === 2 ? 1.25 : 1) * Math.sqrt(W);
    const ring = add(new THREE.TorusGeometry(r, 0.05, 8, 20), darkMat, x, 0.02, -2.98);
    add(new THREE.CircleGeometry(r * 0.92, 18), nA, x, 0.02, -2.99).rotation.y = Math.PI;
    const e = new THREE.Object3D(); e.position.set(x, 0.02, -3.05); body.add(e); emitters.push(e);
  });
  // control surfaces (pivot groups)
  const surf = { flapL: null, flapR: null, finL: null, finR: null, canL: null, canR: null };
  if (cfg.wing > 0) {
    const span = 1.9 * W * cfg.wing;
    add(new THREE.BoxGeometry(span, 0.06, 0.5), accMat, 0, 0.62, -2.45);
    for (const sx of [-1, 1]) {
      add(new THREE.BoxGeometry(0.08, 0.36, 0.26), darkMat, sx * 0.42 * W, 0.42, -2.4);
      const pv = new THREE.Group(); pv.position.set(sx * span * 0.26, 0.62, -2.72); body.add(pv);
      add(new THREE.BoxGeometry(span * 0.46, 0.04, 0.28), bodyMat, 0, 0, -0.13, pv);
      add(new THREE.BoxGeometry(span * 0.44, 0.03, 0.03), nB, 0, 0, -0.27, pv);
      sx > 0 ? surf.flapL = pv : surf.flapR = pv;
      if (cfg.fin === 'big') add(new THREE.BoxGeometry(0.06, 0.5, 0.7), accMat, sx * span / 2, 0.58, -2.45);
    }
  } else {
    const halo = add(new THREE.TorusGeometry(0.55 * W, 0.045, 8, 32, Math.PI), accMat, 0, 0.3, -2.3); halo.rotation.x = 0;
    for (const sx of [-1, 1]) { const pv = new THREE.Group(); pv.position.set(sx * 0.62 * W, 0.12, -2.55); body.add(pv); add(new THREE.BoxGeometry(0.5 * W, 0.04, 0.3), accMat, sx * 0.2, 0, -0.1, pv); sx > 0 ? surf.flapL = pv : surf.flapR = pv; }
  }
  for (const sx of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(sx * px, 0.12, -1.9); body.add(pv);
    const fh = cfg.fin === 'big' ? 0.55 : cfg.fin === 'swept' ? 0.5 : 0.38;
    const fin = add(new THREE.BoxGeometry(0.05, fh, 0.6), accMat, 0, fh / 2, -0.15, pv);
    if (cfg.fin === 'swept') fin.rotation.x = -0.5;
    add(new THREE.BoxGeometry(0.03, fh * 0.9, 0.03), nA, 0, fh / 2, -0.45, pv);
    sx > 0 ? surf.finL = pv : surf.finR = pv;
    const cv = new THREE.Group(); cv.position.set(sx * bw * 0.62, -0.03, 1.15); body.add(cv);
    add(new THREE.BoxGeometry(0.42 * W, 0.03, 0.26), accMat, sx * 0.2 * W, 0, 0, cv);
    sx > 0 ? surf.canL = cv : surf.canR = cv;
  }
  // underglow
  const ug = new THREE.Mesh(new THREE.PlaneGeometry(4.8 * W, 8.2), new THREE.MeshBasicMaterial({ map: radialTex, color: cfg.neonA.clone().multiplyScalar(1.3), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  ug.rotation.x = -Math.PI / 2; ug.position.y = -0.98; root.add(ug);
  let light = null;
  if (isPlayer) { light = new THREE.PointLight(cfg.neonA, 30, 14, 2); light.position.set(0, -0.5, 0); root.add(light); }
  for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * 0.5, 0.3, -3.0); body.add(t); tails.push(t); }
  root.matrixAutoUpdate = true;
  return { root, body, neonA: cfg.neonA, ug, surf, emitters, tails, cfg };
}
function nameTag(text, col) {
  const tex = canvasTex(256, 64, g => { g.font = '900 34px Orbitron'; g.textAlign = 'center'; g.textBaseline = 'middle'; neonText(g, text, 128, 34, col); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(1.1, 1.1, 1.1) }));
  sp.scale.set(3.2, 0.8, 1); sp.position.y = 2.1; return sp;
}
// M8-ENV HOOK H10: road traffic = instanced procedural hover taxi (env/taxi.js). Same { root, beacon } contract;
// roots are not in the scene, updateDrones() copies them into the instance buffers. Contact box (core) unchanged.
let TAXI = null;
function makeDrone() { if (!TAXI) TAXI = createTaxiFleet(scene); return TAXI.acquire(); }

/* ============================== FX ============================== */
function makeTrail(col, M = 20, near = [6, 20]) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(M * 2 * 3), a = new Float32Array(M * 2), e = new Float32Array(M * 2);
  for (let j = 0; j < M; j++) { const v = 1 - j / (M - 1); a[j * 2] = a[j * 2 + 1] = v; e[j * 2] = 0; e[j * 2 + 1] = 1; }
  const idx = []; for (let j = 0; j < M - 1; j++) { const p = j * 2; idx.push(p, p + 1, p + 2, p + 1, p + 3, p + 2); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('a', new THREE.BufferAttribute(a, 1)); geo.setAttribute('e', new THREE.BufferAttribute(e, 1)); geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: col.clone().multiplyScalar(1.6) }, uHot: { value: new THREE.Color(0, 0, 0) }, uTail: { value: col.clone().multiplyScalar(0.3) }, uNear: { value: new THREE.Vector2(near[0], near[1]) }, uTime: { value: 0 } },
    vertexShader: `attribute float a; attribute float e; varying float vA; varying float vA0; varying float vE; uniform vec2 uNear;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vA0 = a; vE = e; vA = a * smoothstep(uNear.x, uNear.y, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform vec3 uHot; uniform vec3 uTail; uniform float uTime; varying float vA; varying float vA0; varying float vE;
      void main(){
        float edge = 1.0 - abs(vE * 2.0 - 1.0);
        float soft = smoothstep(0.0, 0.75, edge);
        float flick = 0.82 + 0.18 * sin(uTime * 61.0 + vA0 * 23.0) * sin(uTime * 37.0 - vA0 * 11.0);
        float wisp = 0.55 + 0.45 * sin(vA0 * 26.0 - uTime * 31.0 + vE * 5.0) * sin(vA0 * 9.0 + uTime * 13.0);
        wisp = mix(1.0, wisp, smoothstep(0.85, 0.35, vA0));
        vec3 body = mix(uTail, uColor, smoothstep(0.05, 0.75, vA0));
        vec3 c = mix(body, uHot, smoothstep(0.86, 1.0, vA0));
        gl_FragColor = vec4(c * vA * vA * soft * flick * wisp, 1.0);
      }`,
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, side: THREE.DoubleSide
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  const hist = []; for (let j = 0; j < M; j++) hist.push(new V3());
  return { mesh, geo, hist, M, n: 0, base: col.clone(), mat, maxLen: 0, wobble: 0, seed: Math.random() * 50 };
}
const _tv = new V3(), _tw = new V3(), _td = new V3();
const _tq = new V3();
function updateTrail(tr, p, width) {
  const last = tr.hist.pop(); last.copy(p); tr.hist.unshift(last); tr.n = Math.min(tr.M, tr.n + 1);
  const pos = tr.geo.attributes.position.array, aA = tr.geo.attributes.a.array, ml = tr.maxLen;
  let dist = 0;
  for (let j = 0; j < tr.M; j++) {
    const q = tr.hist[Math.min(j, tr.n - 1)], nx = tr.hist[Math.min(j + 1, tr.n - 1)], pv = tr.hist[Math.max(j - 1, 0)];
    if (j > 0) dist += q.distanceTo(tr.hist[Math.min(j - 1, tr.n - 1)]);
    _td.subVectors(pv, nx); if (_td.lengthSq() < 1e-6) _td.set(0, 0, 1);
    _tv.subVectors(q, camera.position);
    _tw.crossVectors(_td, _tv).normalize();
    let w, fr;
    if (ml > 0) {   // fixed length in metres (frame-rate independent): narrow hot core -> wider soft wisp -> taper to nothing
      fr = Math.min(1, dist / ml); const v = j >= tr.n - 1 && j > 0 ? 0 : 1 - fr;
      aA[j * 2] = aA[j * 2 + 1] = v;
      w = width * (0.35 + 1.9 * fr) * Math.pow(1 - fr, 0.9);
      const wob = tr.wobble * fr * (Math.sin(gameTime * 23 + j * 1.9 + tr.seed) + 0.6 * Math.sin(gameTime * 37 - j * 3.1 + tr.seed * 2));
      _tq.copy(q).addScaledVector(_tw, wob);
    } else { w = width * (1 - j / tr.M * 0.7); _tq.copy(q); }
    _tw.multiplyScalar(w);
    pos[j * 6] = _tq.x + _tw.x; pos[j * 6 + 1] = _tq.y + _tw.y; pos[j * 6 + 2] = _tq.z + _tw.z;
    pos[j * 6 + 3] = _tq.x - _tw.x; pos[j * 6 + 4] = _tq.y - _tw.y; pos[j * 6 + 5] = _tq.z - _tw.z;
  }
  tr.geo.attributes.position.needsUpdate = true; if (ml > 0) tr.geo.attributes.a.needsUpdate = true;
}
const SPN = 1000;
const spGeo = new THREE.BufferGeometry();
const spPos = new Float32Array(SPN * 3), spCol = new Float32Array(SPN * 3), spSz = new Float32Array(SPN);
spGeo.setAttribute('position', new THREE.BufferAttribute(spPos, 3)); spGeo.setAttribute('col', new THREE.BufferAttribute(spCol, 3)); spGeo.setAttribute('sz', new THREE.BufferAttribute(spSz, 1));
const spMat = new THREE.ShaderMaterial({
  uniforms: { uH: { value: innerHeight * PR * 0.5 } },
  vertexShader: `attribute vec3 col; attribute float sz; varying vec3 vC; uniform float uH;
    void main(){ vC = col; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = sz * projectionMatrix[1][1] * uH / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if(d>.5)discard; float a=exp(-d*d*20.0)*(1.0-smoothstep(.32,.5,d)); gl_FragColor=vec4(vC*a,a); }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
});
const sparkPts = new THREE.Points(spGeo, spMat); sparkPts.frustumCulled = false; scene.add(sparkPts);
const sparks = []; for (let i = 0; i < SPN; i++) sparks.push({ p: new V3(), v: new V3(), life: 0, max: 1, c: new THREE.Color(), g: 16, size: .16 });
let spHead = 0;
function spark(x, y, z, vx, vy, vz, col, life, grav = 16) { const s = sparks[spHead]; spHead = (spHead + 1) % SPN; s.p.set(x, y, z); s.v.set(vx, vy, vz); s.life = s.max = life; s.c.copy(col); s.g = grav; s.size=R(.09,.22); }
const SPARK_HOT = new THREE.Color(1, 0.55, 0.15), SPARK_CY = new THREE.Color(0.3, 0.9, 1), FLAME = new THREE.Color(1, 0.45, 0.12), FLAMEB = new THREE.Color(0.5, 0.6, 1.4);
function updateSparks(dt) {
  for (let i = 0; i < SPN; i++) {
    const s = sparks[i];
    if (s.life > 0) {
      s.life -= dt; s.v.y -= s.g * dt; s.v.multiplyScalar(0.985); s.p.addScaledVector(s.v, dt);
      const k = Math.max(0, s.life / s.max);
      spPos[i * 3] = s.p.x; spPos[i * 3 + 1] = s.p.y; spPos[i * 3 + 2] = s.p.z;
      spCol[i * 3] = s.c.r * 2.5 * k*k; spCol[i * 3 + 1] = s.c.g * 2.5 * k*k; spCol[i * 3 + 2] = s.c.b * 2.5 * k*k; spSz[i] = s.size*(.4+.6*k);
    } else spSz[i] = 0;
  }
  spGeo.attributes.position.needsUpdate = spGeo.attributes.col.needsUpdate = spGeo.attributes.sz.needsUpdate = true;
}
const RAIN = 14000;
const rainGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(RAIN * 2 * 3), seed = new Float32Array(RAIN * 2 * 3), endp = new Float32Array(RAIN * 2);
  for (let i = 0; i < RAIN; i++) { const a = Math.random(), b = Math.random(), c = Math.random(); for (let e = 0; e < 2; e++) { const k = i * 2 + e; seed[k * 3] = a; seed[k * 3 + 1] = b; seed[k * 3 + 2] = c; endp[k] = e; } }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); rainGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 3)); rainGeo.setAttribute('endp', new THREE.BufferAttribute(endp, 1));
}
const rainMat = new THREE.ShaderMaterial({
  // M3: uShelter = baked topmost-covering-surface height per 4 m cell (core/shelter.js); a streak whose
  // HEAD is below it (under a deck / inverted road / tunnel roof) is hidden entirely. uShelterOn: 0/1.
  uniforms: { uTime: { value: 0 }, uCam: { value: new V3() }, uVel: { value: new V3() }, uBox: { value: new V3(110, 60, 110) }, uShelter: { value: null }, uShelterO: { value: new THREE.Vector2() }, uShelterS: { value: new THREE.Vector2(1, 1) }, uShelterOn: { value: 0 }, uRainC: { value: new THREE.Color(0.55, 0.68, 1.0) } },   // M8-ENV HOOK H12: uRainC (theme tint)
  vertexShader: `attribute vec3 seed; attribute float endp; uniform float uTime; uniform vec3 uCam, uVel, uBox; uniform sampler2D uShelter; uniform vec2 uShelterO, uShelterS; uniform float uShelterOn; varying float vA;
    void main(){
      float fall = 30.0 + seed.x * 14.0;
      vec3 base = seed * uBox; base.y -= uTime * fall;
      vec3 p = mod(base - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;
      float shel = 1.0;
      if (uShelterOn > 0.5) {
        vec2 uv = (p.xz - uShelterO) / uShelterS;
        if (uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0 && p.y < texture2D(uShelter, uv).r - 0.15) shel = 0.0;
      }
      vec3 rel = vec3(0.0, -fall, 0.0) - uVel;
      p -= rel * 0.024 * endp;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      float dist = length(mv.xyz);
      vA = shel * mix(0.32, 0.0, endp) * smoothstep(1.2, 5.0, dist) * (1.0 - smoothstep(32.0, 55.0, dist));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `varying float vA; uniform vec3 uRainC; void main(){ gl_FragColor = vec4(uRainC * vA, 1.0); }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
});
const rain = new THREE.LineSegments(rainGeo, rainMat); rain.frustumCulled = false; scene.add(rain);
let SHELTER_MAP = null;
function buildRainShelter() {   // per map, after planDecks(); texel centres = cell centres (NearestFilter)
  const sh = SHELTER_MAP = buildShelter(TD, DECKS);
  const old = rainMat.uniforms.uShelter.value; if (old) old.dispose();
  const tex = new THREE.DataTexture(sh.top, sh.nx, sh.nz, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.flipY = false; tex.needsUpdate = true;
  rainMat.uniforms.uShelter.value = tex;
  rainMat.uniforms.uShelterO.value.set(sh.x0 - sh.cell / 2, sh.z0 - sh.cell / 2);
  rainMat.uniforms.uShelterS.value.set(sh.nx * sh.cell, sh.nz * sh.cell);
  rainMat.uniforms.uShelterOn.value = 1;
}
const fxc = $('fx'), fxg = fxc.getContext('2d');
const lines = []; for (let i = 0; i < 80; i++) lines.push({ a: Math.random() * Math.PI * 2, r: Math.random(), l: 0.1 + Math.random() * 0.25, s: 0.6 + Math.random() });
function drawSpeedLines(intensity, draft, dt) {
  const W = fxc.width, H = fxc.height; fxg.clearRect(0, 0, W, H);
  if (intensity < 0.02 && draft < 0.02) return;
  const cx = W / 2, cy = H * 0.46, D = Math.hypot(W, H) * 0.5;
  fxg.lineCap = 'round';
  const tot = Math.max(intensity, draft);
  for (const l of lines) {
    l.r += dt * l.s * (1.4 + tot * 2.2); if (l.r > 1) { l.r = 0.3 + Math.random() * 0.2; l.a = Math.random() * Math.PI * 2; }
    const r0 = D * (0.35 + l.r * 0.65), r1 = r0 + D * l.l * tot;
    const ca = Math.cos(l.a), sa = Math.sin(l.a);
    const dr = draft > intensity;
    fxg.strokeStyle = dr ? `rgba(80,240,255,${0.45 * draft * l.r})` : `rgba(255,220,200,${0.35 * intensity * l.r})`; fxg.lineWidth = 1 + l.s;
    fxg.beginPath(); fxg.moveTo(cx + ca * r0, cy + sa * r0); fxg.lineTo(cx + ca * r1, cy + sa * r1); fxg.stroke();
  }
}

/* ============================== audio ============================== */
const MUSIC = createMusic();
document.addEventListener('pointerdown', () => MUSIC.unlock(), { capture: true });
document.addEventListener('keydown', () => MUSIC.unlock(), { capture: true });
const AU = {
  ctx: null, music: true,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();MUSIC.attach(c);
    const m = this.master = c.createGain(); m.gain.value = 0.75;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; m.connect(comp); comp.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1; this.nb = buf;
    const noise = () => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    const ef = this.ef = c.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.value = 400; ef.Q.value = 5;
    const eg = this.eg = c.createGain(); eg.gain.value = 0; ef.connect(eg); eg.connect(m);
    this.o1 = c.createOscillator(); this.o1.type = 'sawtooth'; this.o1.connect(ef);
    this.o2 = c.createOscillator(); this.o2.type = 'square'; const g2 = this.secondaryG = c.createGain(); g2.gain.value = 0.45; this.o2.connect(g2); g2.connect(ef);
    this.o3 = c.createOscillator(); this.o3.type = 'sine'; const g3 = this.wg = c.createGain(); g3.gain.value = 0; this.o3.connect(g3); g3.connect(m);
    const lfo = c.createOscillator(); lfo.frequency.value = 6.5; const lg = c.createGain(); lg.gain.value = 3; lfo.connect(lg); lg.connect(this.o1.frequency); lg.connect(this.o2.frequency);
    [this.o1, this.o2, this.o3, lfo].forEach(o => o.start());
    const wn = noise(), wf = this.wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 0.6;
    const wgn = this.windG = c.createGain(); wgn.gain.value = 0; wn.connect(wf); wf.connect(wgn); wgn.connect(m);
    const dn = noise(), df = c.createBiquadFilter(); df.type = 'bandpass'; df.frequency.value = 2800; df.Q.value = 2.5;
    const dg = this.driftG = c.createGain(); dg.gain.value = 0; dn.connect(df); df.connect(dg); dg.connect(m);
    const sn = noise(), sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 520; sf.Q.value = 3;
    const sgn = this.slipG = c.createGain(); sgn.gain.value = 0; sn.connect(sf); sf.connect(sgn); sgn.connect(m);
    const rn = noise(), rf = c.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1200; const rf2 = c.createBiquadFilter(); rf2.type = 'lowpass'; rf2.frequency.value = 7000;
    const amb0 = ambientGains(!!SETTINGS.ambient);   // R2: always-on beds now opt-in (Settings)
    const rg = this.rainG = c.createGain(); rg.gain.value = amb0.rain; rn.connect(rf); rf.connect(rf2); rf2.connect(rg); rg.connect(m);
    const hn = noise(), hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 140; const hg = this.humG = c.createGain(); hg.gain.value = amb0.hum; hn.connect(hf); hf.connect(hg); hg.connect(m);
    this.mus = c.createGain(); this.mus.gain.value = this.music ? 0.2 : 0; this.mus.connect(m);
    const dl = this.dl = c.createDelay(1); dl.delayTime.value = 60 / 108 * 0.75; const fb = c.createGain(); fb.gain.value = 0.32;
    const dlf = c.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2400; dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(this.mus);
    // Licensed audio loops replace the procedural backing track; engine and effects remain procedural.
  },
  engine(s01, thr, boost, drift, slip) {
    if (!this.ctx) return; const t = this.ctx.currentTime;
    const voice=engineVoice(state==='title'?GAR.sel:player.ship?.key||GAR.sel,s01,thr,boost);
    if(this.o1.type!==voice.primary)this.o1.type=voice.primary;if(this.o2.type!==voice.secondary)this.o2.type=voice.secondary;
    this.secondaryG.gain.setTargetAtTime(voice.mix,t,.12);
    this.o1.frequency.setTargetAtTime(voice.fundamental,t,.08);this.o2.frequency.setTargetAtTime(voice.secondaryHz,t,.08);this.o3.frequency.setTargetAtTime(voice.whineHz,t,.1);
    this.ef.frequency.setTargetAtTime(voice.cutoff,t,.1);this.lastVoice=voice;
    const eng = engineGains(s01, thr, boost, !!SETTINGS.engineIdle);   // R2: idle floor opt-in (audio-mix.js)
    this.eg.gain.setTargetAtTime(eng.body*voice.body, t, 0.1);
    this.wg.gain.setTargetAtTime(eng.whine*voice.air, t, 0.1);
    this.windG.gain.setTargetAtTime(s01 * s01 * 0.22 + boost * 0.16, t, 0.1); this.wf.frequency.setTargetAtTime(500 + s01 * 1400, t, 0.1);
    this.driftG.gain.setTargetAtTime(drift * 0.1, t, 0.04);
    this.slipG.gain.setTargetAtTime(slip * 0.16, t, 0.1);
  },
  env(node, t, a, peak, d) { node.gain.setValueAtTime(0.0001, t); node.gain.exponentialRampToValueAtTime(peak, t + a); node.gain.exponentialRampToValueAtTime(0.0001, t + a + d); },
  noiseHit(t, type, f0, f1, dur, peak, q = 1.2) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.nb; const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
    const g = c.createGain(); this.env(g, t, Math.min(0.08, dur * 0.2), peak, dur); s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.2);
  },
  whoosh() {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    this.noiseHit(t, 'bandpass', 250, 4200, 1.1, 0.75);
    this.noiseHit(t + 0.05, 'highpass', 2000, 6000, 0.6, 0.25);
    const o = c.createOscillator(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.6);
    const og = c.createGain(); this.env(og, t, 0.01, 0.55, 0.7); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.8);
  },
  zip() { const c = this.ctx; if (!c) return; this.noiseHit(c.currentTime, 'bandpass', 3500, 900, 0.32, 0.4, 4); },
  thud(x) {
    const c = this.ctx; if (!c) return; const t = c.currentTime; x = clamp(x, 0.1, 1);
    const o = c.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.22);
    const og = c.createGain(); this.env(og, t, 0.005, 0.7 * x, 0.28); o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.35);
    this.noiseHit(t, 'lowpass', 900, 300, 0.2, 0.6 * x);
  },
  beep(fr, dur = 0.2, vol = 0.22) {
    const c = this.ctx; if (!c) return; const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600;
    const g = c.createGain(); this.env(g, t, 0.005, vol, dur); o.connect(f); f.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  chime() { [0, 4, 7, 12].forEach((n, k) => setTimeout(() => this.beep(880 * Math.pow(2, n / 12), 0.25, 0.12), k * 70)); },
  weaponWarning(){const c=this.ctx;if(!c)return;const t=c.currentTime,o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(720,t);o.frequency.linearRampToValueAtTime(940,t+.09);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.028,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.13);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+.15);},
  crash() { const c = this.ctx; if (!c) return; const t = c.currentTime; this.thud(1); this.noiseHit(t, 'lowpass', 2500, 120, 1.4, 0.8, 0.7); },
  setAmbient(on) { SETTINGS.ambient = !!on; saveSettings(); if (!this.ctx) return; const a = ambientGains(!!on), t = this.ctx.currentTime; this.humG.gain.setTargetAtTime(a.hum, t, 0.2); this.rainG.gain.setTargetAtTime(a.rain, t, 0.2); },
  setMusic(on) { this.music = on; MUSIC.setEnabled(on); SETTINGS.music = !!on; saveSettings(); if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.2 : 0, this.ctx.currentTime, 0.2); },
  sched() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    if (this.nt < c.currentTime) this.nt = c.currentTime + 0.05;
    while (this.nt < c.currentTime + 0.15) { this.playStep(this.step, this.nt); this.nt += 60 / 108 / 4; this.step = (this.step + 1) % 64; }
  },
  midi(n) { return 440 * Math.pow(2, (n - 69) / 12); },
  playStep(s, t) {
    if (!this.music) return; const c = this.ctx;
    const bar = Math.floor(s / 16), st = s % 16, roots = [45, 41, 48, 43];
    const ch = bar === 0 ? [0, 3, 7, 12] : [0, 4, 7, 12], r = roots[bar];
    const bp = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1], bo = [0, 0, 12, 0, 0, 12, 0, 0, 0, 0, 12, 0, 0, 12, 0, 7];
    if (bp[st]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.midi(r - 12 + bo[st]);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 8; f.frequency.setValueAtTime(1400, t); f.frequency.exponentialRampToValueAtTime(160, t + 0.16);
      const g = c.createGain(); this.env(g, t, 0.005, 0.32, 0.17); o.connect(f); f.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.25);
    }
    if (st % 4 === 0) { const o = c.createOscillator(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); const g = c.createGain(); this.env(g, t, 0.003, 0.7, 0.2); o.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 0.3); }
    if (st % 8 === 4) { const s2 = c.createBufferSource(); s2.buffer = this.nb; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; const g = c.createGain(); this.env(g, t, 0.003, 0.32, 0.14); s2.connect(f); f.connect(g); g.connect(this.mus); s2.start(t, Math.random()); s2.stop(t + 0.2); }
    if (st % 2 === 1) { const s2 = c.createBufferSource(); s2.buffer = this.nb; const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000; const g = c.createGain(); this.env(g, t, 0.002, 0.09, 0.04); s2.connect(f); f.connect(g); g.connect(this.mus); s2.start(t, Math.random()); s2.stop(t + 0.08); }
    { const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = this.midi(r + 24 + ch[st % 4] + (st >= 8 ? 12 : 0)); const g = c.createGain(); this.env(g, t, 0.004, 0.06, 0.12); o.connect(g); g.connect(this.mus); g.connect(this.dl); o.start(t); o.stop(t + 0.2); }
    if (st === 0) {
      for (const n of ch.slice(0, 3)) {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.midi(r + 12 + n); o.detune.value = R(-8, 8);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900; const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.035, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
        o.connect(f); f.connect(g); g.connect(this.mus); o.start(t); o.stop(t + 2.4);
      }
    }
  },
  pause(p) { if (!this.ctx) return; p ? this.ctx.suspend() : this.ctx.resume(); }
};

/* ============================== CARS: real glTF models (roster/liveries in core/roster.js) ============================== */

const ASSETS = {};
const gltfLoader = new GLTFLoader();
// One source per model: the original binary GLB shipped with the build (hashed URL).
// (v5b fetched base64 text files with a jsDelivr fallback; both removed in M1.)
function carSources(k) { return [{ url: MODEL_URLS[k], label: 'local GLB' }]; }
async function fetchBuf(url, ms, onProg) {
  // stall timeout: abort only if no bytes arrive for `ms`; hard cap 5 min for big original-texture files
  const ac = new AbortController(); let to = setTimeout(() => ac.abort(), ms); const cap = setTimeout(() => ac.abort(), 300000);
  const prog = onProg; onProg = (g, t) => { clearTimeout(to); to = setTimeout(() => ac.abort(), ms); prog(g, t); };
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    if (!res.body || !res.body.getReader) { const b = await res.arrayBuffer(); onProg(b.byteLength, total); return b; }
    const rd = res.body.getReader(); const chunks = []; let got = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; chunks.push(value); got += value.length; onProg(got, total); }
    const out = new Uint8Array(got); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; }
    return out.buffer;
  } finally { clearTimeout(to); clearTimeout(cap); }
}
let assetUIT = 0;
const assetPromises = {};
// On-demand loading: a car is fetched only when it is selected or a race needs it.
// Each model is requested at most once; concurrent callers share the promise.
function ensureAsset(k) {
  if (!assetPromises[k]) {
    assetPromises[k] = loadCarAsset(k);
    assetPromises[k].then(() => { if (state === 'title') garageShow(); updateAssetUI(); });
  }
  return assetPromises[k];
}
const ensureRaceAssets = sel => Promise.all(raceCarKeys(sel).map(ensureAsset));
function loadCarAsset(k) {
  const A = ASSETS[k] = { key: k, status: 'loading', source: null, url: null, bytes: 0, total: 0, ms: 0, tris: 0, meshes: 0, materials: 0, error: null, attempts: [] };
  updateAssetUI();
  if (CARS[k].proc) return loadProcAsset(k, A);
  return (async () => {
    for (const src of carSources(k)) {
      const t0 = performance.now(); A.trying = src.label;
      try {
        const buf = await fetchBuf(src.url, 25000, (g, t) => { A.bytes = g; A.total = t; if (performance.now() - assetUIT > 120) { assetUIT = performance.now(); updateAssetUI(); } });
        if (buf.byteLength < 20) throw new Error('empty response');
        const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
        if (magic !== 'glTF') throw new Error('not a GLB (magic "' + magic.replace(/[^\x20-\x7e]/g, '?') + '")');
        const gltf = await new Promise((res, rej) => gltfLoader.parse(buf, '', res, rej));
        let tris = 0, meshes = 0; const mats = new Set();
        gltf.scene.traverse(o => { if (o.isMesh) { meshes++; mats.add(o.material); const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
        const C0 = CARS[k]; let maxTex = 0; gltf.parser.json.images && gltf.scene.traverse(o => { if (o.isMesh) for (const t of [o.material.map, o.material.normalMap]) if (t && t.image) maxTex = Math.max(maxTex, t.image.width); });
        if (meshes < C0.minMeshes || tris < C0.minTris) throw new Error(`parsed but suspicious: ${meshes} meshes / ${Math.round(tris)} tris`);
        Object.assign(A, { status: 'ok', maxTex, anims: gltf.animations.map(a => a.name), source: src.label, url: src.url, ms: Math.round(performance.now() - t0), tris: Math.round(tris), meshes, materials: mats.size, gltf, bytes: buf.byteLength });
        A.attempts.push(`${src.label}: OK`); updateAssetUI(); return A;
      } catch (e) {
        A.attempts.push(`${src.label}: ${e && e.name === 'AbortError' ? 'download stalled / timed out' : (e && e.message) || String(e)}`);
        A.bytes = 0;
      }
    }
    A.status = 'failed'; A.error = A.attempts.join(' | '); updateAssetUI(); return A;
  })();
}
// R2: original procedural ships: built once per session (no network), shared by every instance.
function loadProcAsset(k, A) {
  return Promise.resolve().then(() => {
    const t0 = performance.now(), C0 = CARS[k];
    try {
      const gltf = buildProcShip(k), st = shipStats(gltf.scene);
      if (st.meshes < C0.minMeshes || st.tris < C0.minTris) throw new Error(`built but suspicious: ${st.meshes} meshes / ${st.tris} tris`);
      Object.assign(A, { status: 'ok', maxTex: 0, anims: [], source: 'procedural', url: null, ms: Math.round(performance.now() - t0), tris: st.tris, meshes: st.meshes, materials: st.materials, gltf, bytes: 0 });
      A.attempts.push('procedural: OK');
    } catch (e) { A.attempts.push('procedural: ' + ((e && e.message) || String(e))); A.status = 'failed'; A.error = A.attempts.join(' | '); }
    updateAssetUI(); return A;
  });
}
function fmtMB(b) { return (b / 1048576).toFixed(1) + ' MB'; }
function updateAssetUI() {
  const el = $('assetList'); if (!el) return;
  el.innerHTML = CAR_KEYS.map(k => {
    const A = ASSETS[k], C = CARS[k];
    if (!A) return `<div class="wait">◌ ${C.title} · queued</div>`;
    if (A.status === 'loading') return `<div class="wait">◌ ${C.title} · ${A.trying || ''} ${A.bytes ? fmtMB(A.bytes) + (A.total ? ' / ' + fmtMB(A.total) : '') : 'connecting…'}</div>`;
    if (A.status === 'ok' && C.proc) return `<div class="ok">✓ ${C.title} · original procedural · ${A.tris.toLocaleString()} tris · ${A.meshes} meshes</div>`;
    if (A.status === 'ok') return `<div class="ok">✓ ${C.title} · GLB parsed · ${A.tris.toLocaleString()} tris · ${A.meshes} meshes · ${A.source}</div>`;
    return `<div class="bad">✗ ${C.title} · LOAD FAILED → PROCEDURAL FALLBACK<br><span style="opacity:.75">${A.error}</span></div>`;
  }).join('');
  if (typeof updateGarageUI === 'function' && GAR.ready) updateGarageUI();
}

const _bx = new THREE.Box3(), _bv = new V3(), _bc = new V3();
function labelSprite(text, col, w = 6) {
  const tex = canvasTex(512, 64, g => { g.font = '900 30px Orbitron'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(20,0,6,0.75)'; g.fillRect(0, 6, 512, 52); neonText(g, text, 256, 34, col); });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(w, w / 8, 1); sp.renderOrder = 10; return sp;
}
// Race-mode texture cap: oversized source textures (2k/4k) are down-sampled once into a shared copy for racing;
// the garage keeps the original textures untouched.
const TEXCAP = new Map();
function capTex(t, cap) {
  if (!t || !t.image || !t.image.width || Math.max(t.image.width, t.image.height) <= cap) return t;
  const key = t.uuid + ':' + cap; if (TEXCAP.has(key)) return TEXCAP.get(key);
  const im = t.image, k = cap / Math.max(im.width, im.height);
  const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const n = new THREE.CanvasTexture(c);
  for (const p of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel', 'offset', 'repeat']) { if (t[p] && t[p].isVector2) n[p].copy(t[p]); else n[p] = t[p]; }
  n.anisotropy = 4; n.needsUpdate = true; TEXCAP.set(key, n); return n;
}
const TEXSLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'];
function raceMat(m) {
  const n = new THREE.MeshStandardMaterial({ name: m.name, color: m.color.clone(), metalness: m.metalness, roughness: m.roughness, emissive: m.emissive.clone(), emissiveIntensity: m.emissiveIntensity, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest, envMapIntensity: 1.3 });
  for (const k of TEXSLOTS) if (m[k]) n[k] = capTex(m[k], 1024);
  if (m.normalScale) n.normalScale.copy(m.normalScale); if (m.aoMapIntensity != null) n.aoMapIntensity = m.aoMapIntensity;
  return n;
}
const _wp = new V3();
// Build one car/ship instance. mode 'garage' keeps the full source materials; 'race' converts to lighter
// MeshStandardMaterial (keeping PBR maps, capped). Geometry is always shared with the parsed glTF.
function buildCar(k, liv, mode, isPlayer = false) {
  const C = CARS[k], A = ASSETS[k];
  if (!A || A.status !== 'ok') return buildFallbackCar(k, liv, mode, isPlayer);
  const race = mode === 'race', ship = C.kind === 'ship';
  const root = new THREE.Group(), body = new THREE.Group(), norm = new THREE.Group(), orient = new THREE.Group();
  root.add(body); body.add(norm); norm.add(orient);
  const model = SkeletonUtils.clone(A.gltf.scene);   // keeps skinned meshes bound to their own cloned skeleton
  orient.add(model); if (C.flip) orient.rotation.y = Math.PI;
  let mixer = null;
  if (C.anims && A.gltf.animations.length) {
    mixer = new THREE.AnimationMixer(model);
    for (const [nm, mode2] of C.anims) {
      const clip = A.gltf.animations.find(a => a.name.includes(nm)); if (!clip) continue;
      const ac = mixer.clipAction(clip);
      if (mode2 === 'end') { ac.setLoop(THREE.LoopOnce, 1); ac.clampWhenFinished = true; ac.play(); ac.time = clip.duration; }
      else { ac.play(); ac.time = Math.random() * clip.duration; }
    }
    mixer.update(0);
  }
  norm.updateMatrixWorld(true);
  _bx.setFromObject(orient, true); _bx.getSize(_bv); _bx.getCenter(_bc);
  const s = C.len / _bv.z, lift = ship ? C.hover : 0;
  norm.scale.setScalar(s);
  norm.position.set(-_bc.x * s, -_bx.min.y * s - H0 + lift, -_bc.z * s);
  const paintC = new THREE.Color(liv.paint), accC = new THREE.Color(liv.accent), neonC = new THREE.Color(liv.neon);
  const mats = new Map();
  const mk = (role, m) => {
    const key = role + '|' + m.uuid; if (mats.has(key)) return mats.get(key);
    let n = race ? raceMat(m) : m.clone();
    if (role === 'paint') { n.color.copy(paintC); n.metalness = liv.metal; n.roughness = liv.rough; if (n.isMeshPhysicalMaterial) { n.clearcoat = 1; n.clearcoatRoughness = 0.06; } n.envMapIntensity = race ? 1.5 : 0.8; }
    else if (role === 'shipPaint') { n.color.set(0xffffff).lerp(paintC, C.tint); n.metalness = Math.max(n.metalness * 0.5, liv.metal * 0.6); n.roughness = Math.max(0.3, liv.rough + 0.12); n.envMapIntensity = race ? 1.2 : 0.7; }
    else if (role === 'accent') { n.color.copy(accC); n.metalness = 0.55; n.roughness = 0.3; n.envMapIntensity = race ? 1.4 : 0.8; }
    else if (role === 'neon') { n.color.setRGB(0.02, 0.02, 0.02); n.emissive.copy(neonC); n.emissiveIntensity = race ? 2.6 : 0.9; }
    else if (role === 'glass') {
      if (n.isMeshPhysicalMaterial) { n.transmission = 0; n.thickness = 0; }
      n.transparent = true; n.opacity = race ? 0.9 : 0.93; n.depthWrite = false; n.color.lerp(new THREE.Color(0x070a10), 0.85);
      n.metalness = 0; n.roughness = race ? 0.06 : 0.05; n.envMapIntensity = race ? 0.9 : 0.22; if (n.specularIntensity != null) n.specularIntensity = 0.5; if (n.clearcoat) n.clearcoat = 0.3;
    }
    else if (role === 'light') { n.emissiveIntensity = race ? Math.max(n.emissiveIntensity, 2.6) : 1.0; }
    else if (role === 'tail') { n.emissiveIntensity = race ? Math.max(n.emissiveIntensity, 3.0) : 1.2; }
    else { n.envMapIntensity = race ? 1.15 : 0.75; if (!race && ship && n.emissiveMap) n.emissiveIntensity = 0.7; }
    mats.set(key, n); return n;
  };
  let tris = 0, tail = null; const wheelParts = {};
  model.traverse(o => {
    if (!o.isMesh) return;
    const nm = o.name + '|' + (o.parent ? o.parent.name : '');
    const mn = o.material.name || '';
    let role;
    if (ship) role = C.glassMat && C.glassMat.test(mn) && /Cristal/.test(mn) ? 'glass' : C.neonMat && C.neonMat.test(mn) ? 'neon' : C.accentMat && C.accentMat.test(mn) ? 'accent' : C.tintMat && C.tintMat.test(mn) ? 'shipPaint' : 'other';
    else {
      role = /Paint|LiquidGraphite/i.test(mn) ? 'paint' : /Glass/i.test(mn) ? 'glass' : /Light_Red/i.test(mn) ? 'tail' : /Light_White|BrightRing/i.test(mn) ? 'light' : 'other';
      if (C.accent.test(nm) && role !== 'light') role = 'accent';
      if (C.neon.test(nm)) role = 'neon';
    }
    o.material = mk(role, o.material);
    o.castShadow = false; o.receiveShadow = false;
    if (o.isSkinnedMesh) o.frustumCulled = false;   // bind-pose bounds don't follow the animated rig
    const g = o.geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    const wm = nm.match(/Wheel_(FL|FR|RL|RR)_/); if (wm) (wheelParts[wm[1]] ||= []).push(o);
    if (/TailLight/.test(o.name)) tail = o;
  });
  const wheels = [];
  for (const wk in wheelParts) {
    const parts = wheelParts[wk]; const tyre = parts.find(p => /Tyre/.test(p.name)) || parts[0];
    const parent = tyre.parent;
    const steer = new THREE.Object3D(); steer.position.copy(tyre.position); parent.add(steer);
    const spin = new THREE.Object3D(); steer.add(spin);
    parent.updateMatrixWorld(true);
    for (const p of parts) spin.attach(p);
    tyre.geometry.computeBoundingBox();
    wheels.push({ steer, spin, front: steer.position.z > 0, base: steer.position.y, rad: Math.max(0.2, tyre.geometry.boundingBox.max.y * s) });
  }
  const W = _bv.x * s, L = _bv.z * s, Hm = _bv.y * s, y0 = -H0 + lift;
  const emitters = [], tails = [];
  if (ship) {
    // nozzle anchors in metres at the real rear of the imported hull (body space)
    for (const [fx, fy, sz] of C.emitF) { const e = new THREE.Object3D(); e.position.set(fx * W, y0 + fy * Hm, -L / 2 - 0.05); e.userData.sz = sz; body.add(e); emitters.push(e); }
    for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * W * 0.36, y0 + Hm * 0.45, -L / 2 + 0.1); body.add(t); tails.push(t); }
  } else if (C.emitF) {
    for (const [fx, fy, sz] of C.emitF) { const e = new THREE.Object3D(); e.position.set(fx * W, y0 + fy * Hm, -L / 2 - 0.04); e.userData.sz = sz; body.add(e); emitters.push(e); }
    if (tail) { tail.geometry.computeBoundingBox(); const tb = tail.geometry.boundingBox; const yc = (tb.min.y + tb.max.y) / 2 + tail.position.y; for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * tb.max.x * 0.8, yc, tb.min.z + tail.position.z - 0.03); model.add(t); tails.push(t); } }
    else for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * W * 0.33, y0 + Hm * 0.45, -L / 2 + 0.05); body.add(t); tails.push(t); }
  } else {
    const portMat = new THREE.MeshBasicMaterial({ color: neonC.clone().multiplyScalar(race ? 2.2 : 1.2) });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x0a0a10, metalness: 0.9, roughness: 0.3 });
    for (const [x, y, z] of C.emit) {
      const e = new THREE.Object3D(); e.position.set(x, y, z - 0.03); model.add(e); emitters.push(e); e.userData.sz = 1;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.07, 20), portMat); disc.position.set(x, y, z - 0.012); disc.rotation.y = Math.PI; model.add(disc);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 8, 22), rimMat); rim.position.set(x, y, z - 0.01); model.add(rim);
    }
    if (tail) { tail.geometry.computeBoundingBox(); const tb = tail.geometry.boundingBox; const yc = (tb.min.y + tb.max.y) / 2 + tail.position.y; for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * tb.max.x * 0.8, yc, tb.min.z + tail.position.z - 0.03); model.add(t); tails.push(t); } }
    else for (const sx of [-1, 1]) { const t = new THREE.Object3D(); t.position.set(sx * 0.6, 0.7, _bx.min.z); model.add(t); tails.push(t); }
  }
  // soft contact shadow + subtle underglow (kept low: it washed out the body in v3)
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.25, L * 1.08), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: ship ? 0.7 : 1, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.y = -H0 + 0.03; root.add(shadow);
  const ug = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.7, L * 1.3), new THREE.MeshBasicMaterial({ map: radialTex, color: neonC.clone().multiplyScalar(race ? 0.32 : 0.16), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  ug.rotation.x = -Math.PI / 2; ug.position.y = -H0 + 0.04; root.add(ug);
  if (isPlayer && race) { const light = new THREE.PointLight(neonC, 10, 9, 2); light.position.set(0, -0.55, 0); root.add(light); }
  return { root, body, norm, ug, wheels, emitters, tails, mixer, kind: C.kind, neonA: neonC, key: k, cfg: C, tris: Math.round(tris), fallback: false, scale: s, halfW: Math.min(W / 2, 1.45), halfL: L / 2, surf: {}, groundY: y0 + 0.08, dims: { W, L, H: Hm } };
}
const shadowTex = canvasTex(128, 256, (g, w, h) => {
  g.save(); g.translate(w / 2, h / 2); g.scale(1, h / w);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, w / 2); gr.addColorStop(0, 'rgba(0,0,0,0.85)'); gr.addColorStop(0.6, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, w / 2, 0, 7); g.fill(); g.restore();
});
// Explicitly-labelled procedural fallback (only used when a GLB could not be fetched/parsed)
const FB_MAP = { hypercar: 'GHOST', endurance: 'BLITZ', wedge: 'VEX', rally: 'BLITZ', streamliner: 'GHOST', wipeout: 'VEX', kestrel: 'VEX', manta: 'GHOST' };
function buildFallbackCar(k, liv, mode, isPlayer) {
  const base = SHIPCFG[FB_MAP[k]];
  const cfg = Object.assign({}, base, { neonA: new THREE.Color(liv.neon), neonB: new THREE.Color(liv.accent), base: liv.paint, sponsor: 'FALLBACK' });
  const sh = makeShip(cfg, isPlayer && mode === 'race');
  const tag = labelSprite('PROCEDURAL FALLBACK · GLB FAILED', '#ff3355', 6.5); tag.position.y = 2.9; sh.root.add(tag);
  Object.assign(sh, { fallback: true, key: k, tris: 0, wheels: [], scale: 1, halfW: 1.4, halfL: 3, groundY: -0.5 });
  return sh;
}

/* ============================== GARAGE / SHOWROOM ============================== */
const GAR = { scene: new THREE.Scene(), cam: new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 400), turn: new THREE.Group(), cars: {}, sel: 'hypercar', fit: null, paint: 0, rot: 0.75, drag: null, lastInteract: -10, variant: 0, ready: false };
function buildGarage() {
  const S = GAR.scene; S.background = new THREE.Color(0x05030c);
  const pm = new THREE.PMREMGenerator(renderer); S.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; S.environmentIntensity = 0.42; pm.dispose();
  const key = new THREE.DirectionalLight(0xfff2e6, 2.1); key.position.set(4, 7, 5); S.add(key);
  const rimC = new THREE.DirectionalLight(0x9fe8ff, 1.0); rimC.position.set(-6, 2.6, -5); S.add(rimC);
  const rimM = new THREE.DirectionalLight(0xffb0e8, 0.6); rimM.position.set(6, 1.8, -4.5); S.add(rimM);
  const low = new THREE.DirectionalLight(0xbfc8ff, 0.7); low.position.set(0, 0.4, 7); S.add(low);
  S.add(new THREE.HemisphereLight(0xc8d0e0, 0x08070a, 0.3));
  const gtx = canvasTex(512, 512, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 512, 512); g.strokeStyle = 'rgba(0,240,255,0.22)'; g.lineWidth = 1.5; for (let i = 0; i <= 512; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke(); } });
  gtx.wrapS = gtx.wrapT = THREE.RepeatWrapping; gtx.repeat.set(3, 3);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 96), new THREE.MeshStandardMaterial({ color: 0x030304, metalness: 0, roughness: 0.92, envMapIntensity: 0.03, emissiveMap: gtx, emissive: new THREE.Color(0.07, 0.07, 0.08) }));
  floor.rotation.x = -Math.PI / 2; S.add(floor);
  const ring1 = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.022, 8, 200), new THREE.MeshBasicMaterial({ color: NEON.c.clone().multiplyScalar(0.55) })); ring1.rotation.x = Math.PI / 2; ring1.position.y = 0.012; S.add(ring1);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(3.6, 0.012, 8, 200), new THREE.MeshBasicMaterial({ color: NEON.m.clone().multiplyScalar(0.35) })); ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.012; S.add(ring2);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(3.3, 96), new THREE.MeshStandardMaterial({ color: 0x0c0b13, metalness: 0, roughness: 0.88, envMapIntensity: 0.05 })); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.006; S.add(disc);
  const wallTex = canvasTex(1024, 64, g => { g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 64); for (let x = 20; x < 1024; x += 64) { g.fillStyle = x % 192 < 64 ? '#ff2bd6' : '#00d8ff'; g.fillRect(x, 0, 3, 64); } g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, 58, 1024, 2); });
  wallTex.wrapS = THREE.RepeatWrapping; wallTex.repeat.set(3, 1);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(16, 16, 12, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x07060d, side: THREE.BackSide, emissiveMap: wallTex, emissive: new THREE.Color(0.16, 0.16, 0.18), roughness: 0.9, envMapIntensity: 0.0 }));
  wall.position.y = 6; S.add(wall);
  S.add(GAR.turn);
  GAR.cam.position.set(6.3, 1.6, 6.1); GAR.cam.lookAt(0, 0.45, 0);
  GAR.ready = true;
}
function ensureGarageCar(k) {
  const st = ASSETS[k] ? ASSETS[k].status : 'none';
  const old = GAR.cars[k];
  if (old && old.paintIdx === GAR.paint && old.assetStatus === st) return old;
  if (old) GAR.turn.remove(old.root);
  if (st !== 'ok' && st !== 'failed') { const inst = { root: new THREE.Group(), wheels: [], kind: CARS[k].kind, paintIdx: GAR.paint, assetStatus: st, dims: { W: 2.4, L: CARS[k].len, H: 1.3 } }; GAR.turn.add(inst.root); GAR.cars[k] = inst; return inst; }   // empty turntable while the real model downloads (no unlabelled stand-in)
  const inst = buildCar(k, PAINTS[GAR.paint], 'garage');
  inst.paintIdx = GAR.paint; inst.assetStatus = st; inst.root.position.y = H0;
  for (const w of inst.wheels) if (w.front) w.steer.rotation.y = 0.32;
  GAR.turn.add(inst.root); GAR.cars[k] = inst; return inst;
}
function garageShow() { for (const key of CAR_KEYS) { const c = ensureGarageCar(key); c.root.visible = key === GAR.sel; } updateGarageUI(); }
function selectCar(k) { GAR.sel = k; ensureAsset(k); GAR.lastInteract = gameTime; garageShow(); mpCarChanged(); }
function cycleCar(d) { const i = CAR_KEYS.indexOf(GAR.sel); selectCar(CAR_KEYS[mod(i + d, CAR_KEYS.length)]); }
function setPaint(i) { GAR.paint = i; garageShow(); mpCarChanged(); }
function updateGarageUI() {
  const C = CARS[GAR.sel], A = ASSETS[GAR.sel], SN = SHORT[GAR.sel] || [C.nick, C.title];
  $('carNick').textContent = SN[0]; $('carTitle').textContent = SN[1];
  $('carDots').innerHTML = CAR_KEYS.map(k => `<button class="${k === GAR.sel ? 'on' : ''}" data-car="${k}" role="tab" aria-selected="${k === GAR.sel}" aria-label="${(SHORT[k] || [k])[0]}" title="${(SHORT[k] || [k])[0]}"></button>`).join('');
  // diagnostics live only in the QA panel
  const src = $('carSrc'); const fb = !!A && A.status === 'failed';
  if (!A || A.status === 'loading') { src.className = ''; src.innerHTML = `Loading real model… ${A && A.bytes ? fmtMB(A.bytes) : ''}`; }
  else if (A.status === 'ok' && C.proc) { src.className = ''; src.innerHTML = `Original NIGHTGRID design · procedural, no imported model<br>${A.tris.toLocaleString()} tris · ${A.meshes} meshes · ${A.materials} materials`; }
  else if (A.status === 'ok' && C.kind === 'ship') { const cr = C.credit; src.className = ''; src.innerHTML = `Imported GLB · “${cr.title}” by ${cr.author} · CC BY 4.0<br>${A.tris.toLocaleString()} tris · ${A.meshes} meshes · ${A.materials} mats · textures ≤${A.maxTex}px (race cap 1024)<br>${C.anims ? `rig · ${A.anims.length} clips · playing: flying idle + canopy closed` : 'static hull (no animation in source)'} · ${A.source} · ${(A.ms / 1000).toFixed(1)} s`; }
  else if (A.status === 'ok') { src.className = ''; src.innerHTML = `Real GLB · Collect Cars “${C.key}” by drcollect<br>${A.tris.toLocaleString()} tris · ${A.meshes} meshes · ${A.materials} materials · ${A.source} · ${(A.ms / 1000).toFixed(1)} s`; }
  else { src.className = 'fb'; src.innerHTML = `PROCEDURAL FALLBACK — not the real model<br>${A.error}`; }
  $('fallbackTag').style.display = fb ? 'block' : 'none';
  $('fallbackTag').textContent = `Model failed to load — showing a labelled stand-in, not the real ${SN[0]}`;
  const st = C.stats;
  $('carStats').innerHTML = [['Speed', st.top], ['Accel', st.acc], ['Grip', st.grip]].map(([n, v]) => `<div class="stat"><b>${n}</b><i style="--v:${Math.round(v * 100)}%"></i></div>`).join('');
  $('paints').innerHTML = PAINTS.map((p, i) => `<button class="sw2 ${i === GAR.paint ? 'on' : ''}" data-p="${i}" role="radio" aria-checked="${i === GAR.paint}" aria-label="${p.name}" title="${p.name}" style="background:radial-gradient(circle at 35% 35%,${p.paint} 55%,${p.neon} 56%)"></button>`).join('') + `<span class="pname">${PAINTS[GAR.paint].name[0] + PAINTS[GAR.paint].name.slice(1).toLowerCase()}</span>`;
  $('rivalsLine').innerHTML = 'Rivals · ' + Object.entries(RIVAL_LIV).map(([n, L]) => `${L.name}: ${CARS[L.car].title}`).join(' · ');
  if (typeof renderMapSeg === 'function') renderMapSeg();
  const settled = A && A.status !== 'loading' && A.status !== undefined;
  const ready = isRaceReady(GAR.sel, assetStatus);
  if (!raceStarting) {
    $('go').disabled = !(ready && state === 'title') || mapBusy;
    $('go').textContent = mapBusy ? 'Building…' : ready ? 'Race' : !settled ? `Loading ${A && A.bytes ? fmtMB(A.bytes) : '…'}` : 'Loading rivals…';
  }
  if ($('record')) $('record').textContent = isFinite(recordLap) ? `${modeLabel()} record ${fmt(recordLap)}` : `No ${modeLabel()} record yet`;
  GAR.fit = null;
}
function layoutMode() { GAR.fit = null; }
// Frame the car inside the screen area that no panel covers (desktop: between the side panels; narrow/mobile:
// above the bottom sheet). Uses a camera view offset, so the car is centred in the free gap at any size.
function garageFreeRect() {
  const W = innerWidth, H = innerHeight, r = el => { const e = $(el); if (!e || e.offsetParent === null) return null; return e.getBoundingClientRect(); };
  // free area = between the slim top bar and the bottom control bar; the bar's top fade (first 40px) may overlap
  const T = r('gTop'), Bb = r('gBar'), sheet = [...document.querySelectorAll('.sheet:not(.hide)')].map(e => e.getBoundingClientRect())[0];
  let x0 = 0, x1 = W, y0 = T ? T.bottom : 0, y1 = Bb ? Bb.top + 44 : H;
  if (sheet && W > 900) x1 = sheet.left - 10;
  if (document.body.classList.contains('touchmode') && W > H && H <= 520 && !sheet) return { x0: 208, x1: W - 12, y0: 52, y1: H - 70 };
  if (y1 - y0 < 140) y1 = y0 + 140;
  return { x0, x1, y0, y1 };
}
function fitGarage() { GAR.fit = garageFreeRect(); }
function updateGarage(dt) {
  if (!GAR.drag && gameTime - GAR.lastInteract > 2.5) GAR.rot += dt * 0.22;
  GAR.turn.rotation.y = GAR.rot;
  const c = GAR.cars[GAR.sel];
  if (c && c.mixer) c.mixer.update(dt);
  if (!GAR.fit) fitGarage();
  const F = GAR.fit, W = innerWidth, H = innerHeight, cam = GAR.cam;
  const fw = F.x1 - F.x0, fh = F.y1 - F.y0;
  cam.setViewOffset(W, H, W / 2 - (F.x0 + F.x1) / 2, H / 2 - (F.y0 + F.y1) / 2, W, H);
  const d = c && c.dims ? c.dims : { W: 2, L: 4.8, H: 1.3 };
  const focal = (H / 2) / Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
  const rH = 0.5 * Math.hypot(d.L, d.W) * 1.02, rV = d.H * 0.5 + rH * 0.26 + 0.15;
  const dist = clamp(Math.max(rH * focal / (0.5 * fw * 0.94), rV * focal / (0.5 * fh * 0.92)), 6.2, 15);
  const t = gameTime * 0.25, ty = (c && c.kind === 'ship' ? 0.5 : 0.25) + d.H * 0.32;
  GAR.dir = GAR.dir || new V3(6.3, 1.75, 6.1).normalize();
  cam.position.copy(GAR.dir).multiplyScalar(dist); cam.position.x += Math.sin(t) * 0.1; cam.position.y += ty;
  cam.lookAt(0, ty, 0);
  if (c && c.ug) c.ug.material.opacity = 0.18 + Math.sin(gameTime * 3) * 0.03;
}

/* ============================== EXHAUST: pooled additive glowing sprites (no cone geometry) ============================== */
const EXN = 7000;
const exGeo = new THREE.BufferGeometry();
const exPos = new Float32Array(EXN * 3), exCol = new Float32Array(EXN * 3), exSz = new Float32Array(EXN), exSeed = new Float32Array(EXN), exAge = new Float32Array(EXN);
for (let i = 0; i < EXN; i++) exSeed[i] = Math.random();
exGeo.setAttribute('position', new THREE.BufferAttribute(exPos, 3)); exGeo.setAttribute('col', new THREE.BufferAttribute(exCol, 3));
exGeo.setAttribute('sz', new THREE.BufferAttribute(exSz, 1)); exGeo.setAttribute('seed', new THREE.BufferAttribute(exSeed, 1)); exGeo.setAttribute('age', new THREE.BufferAttribute(exAge, 1));
const exMat = new THREE.ShaderMaterial({
  uniforms: { uH: { value: innerHeight * PR * 0.5 }, uTime: { value: 0 } },
  vertexShader: `attribute vec3 col; attribute float sz; attribute float seed; attribute float age; varying vec3 vC; varying float vS; varying float vA; uniform float uH;
    void main(){ vC = col; vS = seed; vA = age; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(sz * projectionMatrix[1][1] * uH / max(-mv.z, 0.1), 240.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `uniform float uTime; varying vec3 vC; varying float vS; varying float vA;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
    void main(){
      vec2 p = gl_PointCoord - 0.5; float r = length(p);
      float n = n2(p * 5.0 + vec2(vS * 17.0, uTime * 11.0 + vS * 5.0)) * 0.65 + n2(p * 11.0 - vec2(uTime * 7.0, vS * 9.0)) * 0.35;
      float rr = r * (1.0 + 0.55 * vA * (n - 0.45));          // noisy, wispy edge as the particle ages
      float a = exp(-rr * rr * 16.0) * (0.65 + 0.7 * n) * smoothstep(0.5, 0.36, r);
      float core = exp(-r * r * 90.0) * (1.0 - vA) * (1.0 - vA);
      vec3 c = vC * a + vec3(0.55, 0.95, 1.05) * core * min(0.9, dot(vC, vec3(0.33)));
      gl_FragColor = vec4(c, 1.0);
    }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
});
const exPts = new THREE.Points(exGeo, exMat); exPts.frustumCulled = false; exPts.renderOrder = 5; scene.add(exPts);
const EXP = { x: new Float32Array(EXN), y: new Float32Array(EXN), z: new Float32Array(EXN), vx: new Float32Array(EXN), vy: new Float32Array(EXN), vz: new Float32Array(EXN), life: new Float32Array(EXN), max: new Float32Array(EXN), size: new Float32Array(EXN), inten: new Float32Array(EXN), turb: new Float32Array(EXN), kind: new Uint8Array(EXN) };
let exHead = 0, exLive = 0;
function exEmit(x, y, z, vx, vy, vz, life, max, size, inten, kind, turb) {
  const i = exHead; exHead = (exHead + 1) % EXN;
  EXP.x[i] = x; EXP.y[i] = y; EXP.z[i] = z; EXP.vx[i] = vx; EXP.vy[i] = vy; EXP.vz[i] = vz;
  EXP.life[i] = life; EXP.max[i] = max; EXP.size[i] = size; EXP.inten[i] = inten; EXP.kind[i] = kind; EXP.turb[i] = turb;
}
const EXR = [[0.5, 1.0, 1.15], [0.18, 0.62, 1.0], [0.2, 0.28, 1.0], [0.55, 0.2, 0.95]];
function exUpdate(dt) {
  let live = 0; const t = gameTime, dr = Math.exp(-2.4 * dt);
  for (let i = 0; i < EXN; i++) {
    if (EXP.life[i] <= 0) { exSz[i] = 0; continue; }
    EXP.life[i] -= dt; if (EXP.life[i] <= 0) { exSz[i] = 0; continue; }
    live++;
    const a = 1 - EXP.life[i] / EXP.max[i], sd = exSeed[i] * 40, tb = EXP.turb[i] * a;
    EXP.vx[i] = EXP.vx[i] * dr + Math.sin(t * 14 + sd) * tb * dt;
    EXP.vy[i] = EXP.vy[i] * dr + Math.sin(t * 11.3 + sd * 1.7) * tb * dt;
    EXP.vz[i] = EXP.vz[i] * dr + Math.cos(t * 12.7 + sd * 0.6) * tb * dt;
    EXP.x[i] += EXP.vx[i] * dt; EXP.y[i] += EXP.vy[i] * dt; EXP.z[i] += EXP.vz[i] * dt;
    exPos[i * 3] = EXP.x[i]; exPos[i * 3 + 1] = EXP.y[i]; exPos[i * 3 + 2] = EXP.z[i];
    const I = EXP.inten[i];
    if (EXP.kind[i] === 1) { const k = I * (1 - a); exCol[i * 3] = k * 0.45; exCol[i * 3 + 1] = k * 0.95; exCol[i * 3 + 2] = k * 1.1; exSz[i] = EXP.size[i]; }
    else {
      let c0, c1, f;
      if (a < 0.1) { c0 = EXR[0]; c1 = EXR[1]; f = a / 0.1; } else if (a < 0.42) { c0 = EXR[1]; c1 = EXR[2]; f = (a - 0.1) / 0.32; } else { c0 = EXR[2]; c1 = EXR[3]; f = (a - 0.42) / 0.58; }
      const fade = Math.pow(1 - a, 1.6) * I;
      exCol[i * 3] = (c0[0] + (c1[0] - c0[0]) * f) * fade; exCol[i * 3 + 1] = (c0[1] + (c1[1] - c0[1]) * f) * fade; exCol[i * 3 + 2] = (c0[2] + (c1[2] - c0[2]) * f) * fade;
      exSz[i] = EXP.size[i] * (0.45 + 2.3 * a) * (1 - 0.25 * a);
    }
    exAge[i] = a;
  }
  exLive = live;
  exMat.uniforms.uTime.value = t;
  exGeo.attributes.position.needsUpdate = exGeo.attributes.col.needsUpdate = exGeo.attributes.sz.needsUpdate = exGeo.attributes.age.needsUpdate = true;
}
const _ex1 = new V3(), _ZERO = new V3();
function emitExhaust(r, dt) {
  const sh = r.ship, em = sh.emitters;
  if (!em || !em.length || r.crashed > 0 || dt <= 0) return;
  if (!r.emPrev || r.emPrev.length !== em.length) { r.emPrev = em.map(e => e.getWorldPosition(new V3())); r.emAcc = em.map(() => Math.random()); }
  const boost = r.boost, thr = r.thr, lod = r === player ? 1 : 0.42;
  const rate = (boost ? 280 : 12 + thr * 26) * lod;
  const F = r.F, wv = r.wvel || _ZERO;
  for (let k = 0; k < em.length; k++) {
    const cur = em[k].getWorldPosition(_ex1), prev = r.emPrev[k], esz = em[k].userData.sz || 1;
    if (prev.distanceToSquared(cur) > 900) prev.copy(cur);
    const cnt = rate * dt + r.emAcc[k], n = Math.floor(cnt); r.emAcc[k] = cnt - n;
    for (let j = 0; j < n; j++) {
      const f = (j + Math.random()) / n;
      const px = prev.x + (cur.x - prev.x) * f, py = prev.y + (cur.y - prev.y) * f, pz = prev.z + (cur.z - prev.z) * f;
      // particles keep most of the ship's velocity, so the plume stays short (~5-8 m) and bends with the path
      const back = boost ? R(9, 15) : R(2, 5), jit = boost ? 2.4 : 0.4;
      const vx = wv.x * 0.86 - F.x * back + R(-jit, jit), vy = wv.y * 0.86 - F.y * back + R(-jit, jit), vz = wv.z * 0.86 - F.z * back + R(-jit, jit);
      const life = boost ? R(0.2, 0.42) : R(0.06, 0.12);
      const age0 = (1 - f) * dt;
      exEmit(px + vx * age0, py + vy * age0, pz + vz * age0, vx, vy, vz, life - age0, life, (boost ? R(0.08, 0.17) : R(0.05, 0.1)) * esz, boost ? R(0.22, 0.42) : 0.14 + thr * 0.16, 0, boost ? 26 : 3);
    }
    if (boost) {
      { const cl = Math.min(0.03, dt * 0.9); exEmit(cur.x - F.x * 0.08, cur.y - F.y * 0.08, cur.z - F.z * 0.08, wv.x, wv.y, wv.z, cl, cl, R(0.2, 0.26) * esz, 1.0, 1, 0); }   // core glow lives < 1 frame: no dotted trail at low fps
      if (r === player && Math.random() < dt * 9) spark(cur.x, cur.y, cur.z, wv.x * 0.8 - F.x * R(6, 14) + R(-4, 4), wv.y * 0.8 + R(-3, 3), wv.z * 0.8 - F.z * R(6, 14) + R(-4, 4), Math.random() < 0.6 ? EX_SPARK_A : EX_SPARK_B, R(0.15, 0.35));
    }
    prev.copy(cur);
  }
}

/* ============================== VISUAL QA ============================== */
const QA = { mode: null };
function qaInfo(txt) {
  const A = Object.fromEntries(CAR_KEYS.map(k => [k, ASSETS[k] ? ASSETS[k].status + (ASSETS[k].source ? '@' + ASSETS[k].source : '') : 'none']));
  $('qaInfo').textContent = (txt ? txt + '\n' : '') + `car: ${GAR.sel} · paint: ${PAINTS[GAR.paint].name}\nassets: ${JSON.stringify(A).replace(/[{}"]/g, '').replace(/,/g, '\n        ')}`;
}
function qaOpen() { $('qa').classList.remove('hide'); qaInfo('QA panel open'); }
function qaGarageNext() {
  if (state !== 'title') toGarage();
  GAR.variant = (GAR.variant + 1) % (CAR_KEYS.length * PAINTS.length);
  GAR.paint = Math.floor(GAR.variant / CAR_KEYS.length) % PAINTS.length;
  selectCar(CAR_KEYS[GAR.variant % CAR_KEYS.length]); GAR.rot += 0.9;
  qaInfo(`garage variant ${GAR.variant + 1}/${CAR_KEYS.length * PAINTS.length}`);
}
function qaBoostDemo(inverted) {
  if (state === 'title' || state === 'loading') startRaceNow(); else { setPlayerCar(); player.emPrev = null; }
  QA.mode = inverted ? 'inverted' : 'boost';
  player.autopilot = true; player.qaBoost = true; player.meter = 1; player.crashed = 0;
  player.pers = { vmax: 92, lat: 80, acc: 30, brake: 46, off: 0, short: 0, aggr: 0, block: 0, boostUse: 0, margin: 5 };
  if (player.speed < 30) player.speed = 60;
  if (inverted) { player.path = MAIN; const inv = MAIN.U.findIndex(u => u.y < -0.5); player.s = inv > 0 ? mod(inv * MAIN.ds - 150, MAIN.L) : SECSTART[1] * MAIN.ds + 240; player.prevS = player.s; player.d = 0; player.dv = 0; player.speed = 80; player.lastRd = rdist(MAIN, player.s); player.emPrev = null; for (const t of player.trails) t.n = 0; }
  qaInfo(inverted ? 'INVERTED BOOST DEMO · autopilot, infinite boost through the first inversion' : 'SUSTAINED BOOST DEMO · autopilot, infinite boost');
}

/* ============================== racers (physics/AI in core/sim.js; visuals here) ============================== */
const racers = sim.racers, drones = sim.drones;
let player;
function makeTrailsFor(r) {
  if (!r.trails) r.trails = [];
  const tl = new THREE.Color(1, 0.06, 0.15);
  if (!r.trails.length) r.trails = [makeTrail(tl, 16), makeTrail(tl, 16)];
  const ne = (r.ship.emitters || []).length;
  while (r.trails.length < 2 + ne) { const t = makeTrail(r.ship.neonA, 22, [1.5, 5]); t.maxLen = 2; r.trails.push(t); }
  for (let k = 2; k < r.trails.length; k++) { r.trails[k].base.copy(r.ship.neonA); r.trails[k].mesh.visible = k < 2 + ne; }
  for (const t of r.trails) t.n = 0;
}
const assetStatus = k => (ASSETS[k] ? ASSETS[k].status : 'none');
function setPlayerCar() {
  const want = GAR.sel + ':' + GAR.paint + ':' + assetStatus(GAR.sel);
  if (player.carKey === want) return;
  if (player.ship) scene.remove(player.ship.root);
  player.ship = buildCar(GAR.sel, PAINTS[GAR.paint], 'race', true); scene.add(player.ship.root);
  player.carKey = want; player.carMods = CARS[GAR.sel].mods; player.emPrev = null;
  player.wallLim = player.ship.fallback ? 1.45 : 1.2;
  player.css = PAINTS[GAR.paint].neon;
  makeTrailsFor(player);
  const tag = $('carTag');
  if (player.ship.fallback) { tag.className = 'fb'; tag.textContent = `${CARS[GAR.sel].title} · PROCEDURAL FALLBACK (GLB FAILED)`; }
  else { tag.className = ''; tag.textContent = `${CARS[GAR.sel].nick} · ${CARS[GAR.sel].proc ? 'ORIGINAL DESIGN' : 'REAL GLB'}`; }
}
// Rival bodies are (re)built when their GLB arrives, so boot never waits for them.
function setRivalCar(r) {
  const pers=r.persKey||r.name.split(' ')[0],L = RIVAL_LIV[pers], want = L.car + ':' + assetStatus(L.car);
  if (r.carKey === want) return;
  if (r.ship) scene.remove(r.ship.root);
  r.ship = buildCar(L.car, L, 'race'); scene.add(r.ship.root); r.carKey = want; r.emPrev = null;
  const tag = nameTag(r.name, PERS[pers].css); tag.position.y = 1.5; r.ship.root.add(tag);
  makeTrailsFor(r);
}
function refreshRacerCars() { if (!player) return; if (MP.race) return mpRefreshCars(); setPlayerCar(); for (const r of racers) if (r !== player) setRivalCar(r); }
function buildRacers() {
  sim.addRacers(soloRivals());
  player = sim.player;
  refreshRacerCars();
  for (const d of drones) Object.assign(d, makeDrone());
}
const gridUp = () => sim.gridUp();

/* ============================== game state ============================== */
let state = 'loading', gameTime = 0, cdT = 0, introT = 0, finishT = 0, paused = false;
let shownResults = false;
// Records: production persists to localStorage; dev/test builds use an in-memory store so
// automated or debug sessions can never write a real record. Every lap is validated
// (core/records.js) before it is offered: physics bound, position jumps, autopilot, debug.
const RECORD_STORAGE = DEBUG ? memoryStorage() : (() => { try { return window.localStorage || memoryStorage(); } catch (e) { return memoryStorage(); } })();
const records = createRecordStore(RECORD_STORAGE, { lapLenOf: k => (k.split('~')[0].endsWith('_' + MAPKEY) ? LAPLEN : NaN) });
let recordLap = Infinity, lastRecordOffer = null;
// M3 driving mode (Assisted / Expert): separate from AI difficulty and from the input method.
// Fresh settings use Expert on every device; explicit saved choices persist.
let driveMode = (() => { try { const v = JSON.parse(localStorage.getItem('nightgrid_v4_settings') || 'null'); if (v && DRIVE_MODES.includes(v.mode)) return v.mode; } catch (e) { } return 'expert'; })();
sim.setMode(driveMode);
const modeLabel = () => (driveMode === 'assisted' ? 'Assisted' : 'Expert');
function loadRecord() { recordLap = records.get(recordKey(driveMode, MAPKEY, variantMask)); }
loadRecord();
const keys = sim.input;
let lastCount = -1;
const raceTime = () => sim.raceTime();
function flash(txt, color) { const el = $('msg'); el.textContent = txt; el.style.color = color || '#fff'; el.style.textShadow = `0 0 22px ${color || '#ff2bd6'}`; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function cpFlash(html) { const el = $('cp'); el.innerHTML = html; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
function secFlash(k) { const el = $('secflash'); const S = SECTORS[k]; el.innerHTML = `<small>${S.sub}</small>S${k + 1} · ${S.name}`; el.style.color = S.css; el.style.textShadow = `0 0 24px ${S.css}`; el.classList.remove('sflash'); void el.offsetWidth; el.classList.add('sflash'); }
// Meter shows gains. One quiet edge glow replaces all +BOOST text.
const boostGainGlow=document.createElement('div');boostGainGlow.id='boostGainGlow';boostGainGlow.setAttribute('aria-hidden','true');
boostGainGlow.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;background:radial-gradient(ellipse at center,transparent 58%,rgba(75,255,145,.2) 100%)';document.body.append(boostGainGlow);
let gainGlowAnimation=null,lastGainGlow=-Infinity;
function boostGainCue(){const now=performance.now();if(REDUCED||qualityMode==='battery'||!qualityState.bloom||now-lastGainGlow<850)return;lastGainGlow=now;gainGlowAnimation?.cancel();gainGlowAnimation=boostGainGlow.animate([{opacity:0},{opacity:.5,offset:.2},{opacity:0}],{duration:700});}
function earnPopup(){boostGainCue();}
/* ---------- M8 hazards: pickup / shield / obstacle presentation (own car only; remote shields from pw) ---------- */
function hazardEvents(me) {
  return {
    recoveryBoost:()=>{boostGainCue();AU.chime();},
    pickup: (r, kind) => { const k = typeof r === 'string' ? r : kind; if (k === 'S') { flash('SHIELD · 1 HIT', '#4fd8ff'); AU.chime(); } else if(k==='R'){boostGainCue();AU.chime();$('boost').animate([{filter:'brightness(3)'},{filter:'brightness(1)'}],{duration:400});const p=me();for(let i=0;i<20;i++)spark(p.world.x,p.world.y+1,p.world.z,R(-6,6),R(1,7),R(-6,6),new THREE.Color(.6,1,.2),R(.2,.5));}else { boostGainCue(); AU.whoosh(); CC.kick += 6; } },
    shieldPop: (r, what) => { const w = typeof r === 'string' ? r : what; const p = me(); if (w === 'expired') return; cpFlash('SHIELD ABSORBED'); AU.thud(0.4); for (let k = 0; k < 30; k++) spark(p.world.x, p.world.y + 0.6, p.world.z, R(-10, 10), R(-2, 9), R(-10, 10), SPARK_CY, R(0.3, 0.7)); },
    obstacleHit: () => { const p = me(); CC.shake += 0.7; hitFlash = Math.min(1, hitFlash + 0.6); AU.thud(0.9); for (let k = 0; k < 36; k++) spark(p.world.x, p.world.y + 0.4, p.world.z, R(-11, 11), R(-1, 9), R(-11, 11), k % 2 ? SPARK_HOT : FLAME, R(0.3, 0.9)); }
  };
}
let pwCache = '';
function updatePowerHUD() {
  const p = player; if (!p) return;
  const parts = [];
  const cf = MP.race ? mpPw() : PW_SHIELD | PW_SURGE;   // rooms: only server-confirmed powers (prediction can lose a contest)
  if (p.shieldT > 0 && (cf & PW_SHIELD)) parts.push(`<span class="pw s">⬢ SHIELD 1 HIT · ${Math.ceil(p.shieldT)}s</span>`);
  if (p.surgeT > 0 && (cf & PW_SURGE)) parts.push('<span class="pw b">▲ OVERDRIVE</span>');
  const h = parts.join(''); if (h !== pwCache) { pwCache = h; $('pwr').innerHTML = h; }
}
/* ---------- simulation events -> presentation ---------- */
function onWallHit(vn, s, Rw) {
  CC.shake += Math.min(0.9, vn / 26); hitFlash = Math.min(1, hitFlash + vn / 40);
  AU.thud(vn / 30);
  for (const m of barrierMats) { m.uniforms.uHit.value = Math.min(1.6, vn / 14); m.uniforms.uHitV.value = (player.path === MAIN ? player.s : SAm) / 4; }
  const p = player.world;
  const n = Math.min(40, vn * 1.5);
  for (let k = 0; k < n; k++) spark(p.x + Rw.x * s * 1.4, p.y + Rw.y * s * 1.4, p.z + Rw.z * s * 1.4, R(-6, 6) - Rw.x * s * R(2, 8), R(1, 8) - Rw.y * s * R(2, 8), R(-6, 6) - Rw.z * s * R(2, 8), k % 3 ? SPARK_HOT : SPARK_CY, R(0.3, 0.8));
}
sim.events = {
  weaponPickup: (r,kind) => {if(r===player){cpFlash(['','MISSILE ARMED','MINE ARMED','EMP ARMED'][kind]||'WEAPON ARMED');AU.chime();}},
  weaponEvent: e => {if(!['hit','blocked'].includes(e.result))return;if(e.victim===player.id)cpFlash(e.result==='blocked'?'SHIELD BLOCKED':e.kind===3?'EMP · BOOST LOCKED':e.kind===2?'MINE HIT':'MISSILE HIT');else if(e.owner===player.id&&e.result==='hit')cpFlash('HIT');},
  earn: (txt, col) => earnPopup(txt, col),
  flash, cp: cpFlash,
  sfx: (name, ...a) => { if (typeof AU[name] === 'function') AU[name](...a); },
  shake: x => { CC.shake += x; }, kick: x => { CC.kick += x; },
  wallHit: (r, vn, s, Rw) => onWallHit(vn, s, Rw),
  crash: r => {
    AU.crash(); CC.shake += 1.2; hitFlash = 1; $('crashv').classList.add('on');
    for (let k = 0; k < 60; k++) spark(r.world.x, r.world.y, r.world.z, R(-15, 15), R(-5, 15), R(-15, 15), k % 2 ? SPARK_HOT : FLAME, R(0.4, 1.2));
  },
  respawn: r => { if (r.trails) for (const t of r.trails) t.n = 0; $('crashv').classList.remove('on'); },
  racerReset: r => { if (r.trails) for (const t of r.trails) t.n = 0; },
  bump: (A, B, hit) => {
    CC.shake += Math.min(0.5, hit / 25); AU.thud(hit / 30);
    const cx = (A.world.x + B.world.x) / 2, cy = (A.world.y + B.world.y) / 2, cz = (A.world.z + B.world.z) / 2;
    for (let k = 0; k < 18; k++) spark(cx, cy, cz, R(-8, 8), R(-3, 7), R(-8, 8), k % 2 ? SPARK_HOT : SPARK_CY, R(0.3, 0.7));
  },
  droneHit: r => { CC.shake += 0.4; AU.thud(0.6); for (let k = 0; k < 20; k++) spark(r.world.x, r.world.y, r.world.z, R(-9, 9), R(-2, 8), R(-9, 9), SPARK_HOT, R(0.3, 0.8)); },
  ...hazardEvents(() => player),
  sector: sec => { secFlash(sec); $('sector').textContent = `S${sec + 1} · ${SECTORS[sec].name}`; $('sector').style.color = SECTORS[sec].css; },
  lap: lap => {
    if (lap.isBest) { $('best').classList.add('flash'); setTimeout(() => $('best').classList.remove('flash'), 2000); }
    lastRecordOffer = Object.assign({ time: lap.time, map: lap.map }, records.offer(recordKey(driveMode, MAPKEY, variantMask), lap));
    if (lastRecordOffer.saved) recordLap = lap.time;
  },
  playerFinish: () => {
    state = 'finished'; finishT = 0; orbitA = 0;
    FIN.on = CINE.on; FIN.t = 0;
    const f = frameAt(MAIN, raceS(player.path, player.s) + 34, _fci); FIN.pos.copy(f.P).addScaledVector(f.R, MAIN.WR[f.i] - 2.2).addScaledVector(f.U, 3.4); FIN.up.copy(f.U);
  }
};

/* ---------- camera ---------- */
const CC = { psi: 0, roll: 0, shake: 0, kick: 0, pos: new V3(), look: new V3(), up: new V3(0, 1, 0), h: 3 };
let boostAmt = 0, hitFlash = 0, orbitA = 0, flyS = 0; const MB = { blur: 0 };
const camFrom = new V3(), lookFrom = new V3(), _cp = new V3(), _cl = new V3(), camVel = new V3(), lastCam = new V3(), _cu = new V3();
const _fc = mkF();
function chaseTarget(dt, snap, outPos, outLook, outUp) {
  const r = player; const s01 = Math.min(r.speed / 92, 1.4);
  let psT = r.psi;
  if (r.speed > 8) { const vy = Math.atan2(-r.vd, r.va); const df = wrapA(vy - r.psi); if (Math.abs(df) < 1.2) psT = r.psi + df * 0.45; }
  if (snap) { CC.psi = psT; CC.h = 2.3; } else { CC.psi += wrapA(psT - CC.psi) * damp(5.5, dt); CC.h = lerp(CC.h, 2.15 + s01 * 0.3 - boostAmt * 0.3 + (r.h - H0) * 0.6, damp(6, dt)); }
  const dist = 7.2 + s01 * 1.4 + boostAmt * 1.5;
  const sc = r.s - dist * Math.cos(CC.psi);
  let dc = r.d + dist * Math.sin(CC.psi);
  // Stay on the branch behind a just-merged player until the chase camera clears it.
  const branchBehind=HASBR&&r.path===MAIN&&r.s>=SBm&&r.s-SBm<dist&&r.d>W0-2;
  const f=frameAt(branchBehind?BR:r.path,branchBehind?BR.L+(r.s-SBm)-dist*Math.cos(CC.psi):sc,_fc);
  if(branchBehind)dc-=OFF;
  const wl = f.path === BR ? WB + 2 : MAIN.WL[f.i] + 0.6, wr = f.path === BR ? WB + 2 : MAIN.WR[f.i] + 0.6;
  dc = clamp(dc + f.off, -wl, wr);
  let hc = r.h + CC.h;
  if (f.path === MAIN && (MAIN.tag[f.i] & TRK.TUNNEL)) hc = Math.min(hc, 6.8);
  outPos.copy(f.P).addScaledVector(f.R, dc).addScaledVector(f.U, hc);
  outLook.copy(r.world).addScaledVector(r.F, 6).addScaledVector(r.Uw, 0.55);
  outUp.copy(f.U);
}
function flyTarget(dt, outPos, outLook, outUp) {
  flyS += dt * 26;
  const s = mod(flyS, MAIN.L);
  const f = frameAt(MAIN, s, _fc);
  const sway = Math.sin(gameTime * 0.22) * 5;
  let hh = 6.5 + Math.sin(gameTime * 0.37) * 2; if (MAIN.tag[f.i] & TRK.TUNNEL) hh = Math.min(hh, 6);
  outPos.copy(f.P).addScaledVector(f.R, sway).addScaledVector(f.U, hh);
  worldPos(MAIN, s + 50, 0, 4, outLook);
  outUp.copy(f.U);
}
function applyCam(pos, look, up, dt, s01) {
  const sh = SETTINGS.shake ? CC.shake + boostAmt * 0.03 + Math.max(0, s01 - 0.8) * 0.035 : CC.shake * 0.15;
  const t = gameTime;
  camera.position.set(pos.x + (Math.sin(t * 47.3) + Math.sin(t * 31.7)) * sh * 0.12, pos.y + (Math.sin(t * 53.1) + Math.sin(t * 27.9)) * sh * 0.1, pos.z + (Math.sin(t * 41.9) + Math.sin(t * 37.3)) * sh * 0.12);
  camera.up.copy(up); camera.lookAt(look); camera.rotateZ(CC.roll);
}

/* ---------- visuals ---------- */
const _tp = new V3(), _fv = mkF(), _L = new V3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _mb = new THREE.Matrix4(), _eb = new THREE.Euler();
function updateVisual(r, dt) {
  const sh = r.ship;
  if (r.crashed > 0) {
    r.world.addScaledVector(r.crashVel, dt); r.crashVel.y -= 22 * dt;
    sh.root.position.copy(r.world);
    sh.root.rotation.x += r.crashSpin.x * dt; sh.root.rotation.y += r.crashSpin.y * dt; sh.root.rotation.z += r.crashSpin.z * dt;
    if (Math.random() < 0.6) spark(r.world.x, r.world.y, r.world.z, R(-3, 3), R(0, 4), R(-3, 3), FLAME, R(0.3, 0.8), -2);
    return;
  }
  if (!r.wvel) { r.wvel = new V3(); r.prevW = r.world.clone(); }
  if (dt > 0) { _tv.subVectors(r.world, r.prevW).divideScalar(dt); if (_tv.lengthSq() < 220 * 220) r.wvel.lerp(_tv, 0.5); }
  r.prevW.copy(r.world);
  sh.root.position.copy(r.world);
  _L.crossVectors(r.Uw, r.F).normalize();
  _mb.makeBasis(_L, r.Uw, r.F); _qa.setFromRotationMatrix(_mb);
  const sp = r.speed;
  const car = !sh.fallback && sh.kind === 'car';
  if (sh.mixer) sh.mixer.update(dt);
  const rollT = bodyLean(r, car);
  const pitchT = ((r.autopilot ? 0 : -r.acc * 0.0022) + r.vh * 0.02) * (car ? 0.6 : 1);
  r.roll = lerp(r.roll, rollT, damp(8, dt)); r.pitch = lerp(r.pitch, pitchT, damp(8, dt));
  _eb.set(r.pitch, 0, r.roll, 'YXZ'); _qb.setFromEuler(_eb);
  sh.root.quaternion.copy(_qa).multiply(_qb);
  sh.body.position.y = Math.sin(gameTime * 5.3 + r.phase) * (car ? 0.008 : 0.035);
  const st = r.steer, brk = (r === player && keys.down) ? 1 : 0;
  r.flapK = lerp(r.flapK, st, damp(10, dt));
  const S = sh.surf || {};
  if (S.flapL) S.flapL.rotation.x = -r.flapK * 0.5 - brk * 0.6;
  if (S.flapR) S.flapR.rotation.x = r.flapK * 0.5 - brk * 0.6;
  if (S.finL) S.finL.rotation.y = -r.flapK * 0.45; if (S.finR) S.finR.rotation.y = -r.flapK * 0.45;
  if (S.canL) S.canL.rotation.x = r.flapK * 0.35; if (S.canR) S.canR.rotation.x = -r.flapK * 0.35;
  // real wheels: roll with ground speed, front wheels steer, suspension follows the magnetic hover height
  if (sh.wheels && sh.wheels.length) {
    const sgn = r.va >= 0 ? 1 : -1, sus = clamp(H0 - r.h, -0.14, 0.3) / sh.scale;
    for (const w of sh.wheels) {
      w.spin.rotation.x = (w.spin.rotation.x + sgn * sp / w.rad * dt) % (Math.PI * 2);
      if (w.front) w.steer.rotation.y = -r.flapK * 0.42;
      w.steer.position.y = w.base + sus;
    }
  }
  sh.ug.material.opacity = 0.75 + Math.sin(gameTime * 9 + r.phase) * 0.08;
  sh.root.updateMatrixWorld();
  const tw = 0.06 + Math.min(1, sp / 90) * 0.06;
  if (sh.tails && sh.tails.length >= 2) { sh.tails[0].getWorldPosition(_tp); updateTrail(r.trails[0], _tp, tw * 0.7); sh.tails[1].getWorldPosition(_tp); updateTrail(r.trails[1], _tp, tw * 0.7); }
  const em = sh.emitters;
  for (let k = 2; k < r.trails.length && em && k - 2 < em.length; k++) {
    em[k - 2].getWorldPosition(_tp);
    const t = r.trails[k], U = t.mat.uniforms;
    U.uTime.value = gameTime + k;
    const esz = em[k - 2].userData.sz || 1;
    if (r.boost) { U.uHot.value.setRGB(0.35, 1.25, 1.55); U.uColor.value.setRGB(0.1, 0.32, 1.05); U.uTail.value.setRGB(0.3, 0.08, 0.75); t.maxLen = 1.2 + .3 * esz; t.wobble = 0; t.mesh.visible=false; }
    else { U.uHot.value.copy(t.base).multiplyScalar(0.18 * r.thr); U.uColor.value.copy(t.base).multiplyScalar(0.1 + r.thr * 0.16); U.uTail.value.copy(t.base).multiplyScalar(0.05); t.maxLen = 1.1 + 0.6 * r.thr; t.wobble = 0; t.mesh.visible=false; }
    updateTrail(t, _tp, (r.boost ? 0.11 : 0.045 + 0.02 * r.thr) * esz);
  }
  emitExhaust(r, dt);
  updateShield(sh, r.shieldT > 0 && (r !== player || !MP.race || (mpPw() & PW_SHIELD)), gameTime,r.passT>0);   // own bubble in rooms: confirmed only
  const gy = sh.groundY != null ? sh.groundY : -0.5, hw = sh.halfW || 1.1;
  if (r.drift && sp > 20 && Math.random() < 0.85) {
    for (const sx of [-1, 1]) { _tp.set(sx * hw * 0.9, gy, -(sh.halfL || 2.3) * 0.6); sh.root.localToWorld(_tp); spark(_tp.x, _tp.y, _tp.z, -r.F.x * sp * 0.15 + R(-3, 3), R(0.5, 4), -r.F.z * sp * 0.15 + R(-3, 3), Math.random() < 0.5 ? SPARK_HOT : sh.neonA, R(0.2, 0.5)); }
  }
  if (r.scrape && sp > 8) {
    _tp.set(-r.scrapeSide * (hw + 0.1), gy + 0.3, R(-1.5, 1.5)); sh.root.localToWorld(_tp);
    for (let k = 0; k < 3; k++) spark(_tp.x, _tp.y, _tp.z, r.F.x * sp * 0.3 + R(-4, 4), R(1, 6), r.F.z * sp * 0.3 + R(-4, 4), SPARK_HOT, R(0.2, 0.6));
  }
  if (r.h < 0.5 && sp > 30 && Math.random() < 0.5) { _tp.set(R(-1, 1), gy, R(-1.5, 1.5)); sh.root.localToWorld(_tp); spark(_tp.x, _tp.y, _tp.z, R(-3, 3), R(0, 3), R(-3, 3), SPARK_HOT, R(0.2, 0.4)); }
}
const EX_SPARK_A = new THREE.Color(0.55, 1.4, 1.8), EX_SPARK_B = new THREE.Color(0.9, 0.45, 1.8);
function updateDrones() {   // drone motion is simulated in core; this only places the meshes
  for (const d of drones) {
    if (!d.root) continue;
    d.root.position.copy(d.world);
    _L.crossVectors(MAIN.U[d.fi], MAIN.T[d.fi]).normalize(); _mb.makeBasis(_L, MAIN.U[d.fi], MAIN.T[d.fi]); d.root.quaternion.setFromRotationMatrix(_mb);
    d.beacon.material.color.setScalar(Math.sin(gameTime * 6 + d.lane) > 0 ? 4 : 0.3);
  }
  if (TAXI) TAXI.update(drones);   // M8-ENV HOOK H11
}

/* ---------- HUD ---------- */
const mm = $('minimap'), mg = mm.getContext('2d'); let mmBase, mmT; const mmPlayerFrame = mkF();
function arcPath(cx, cy, r, a0, a1) { const p = a => [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; const [x0, y0] = p(a0), [x1, y1] = p(a1); return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`; }
function initHUD() {
  const d = arcPath(162, 112, 92, Math.PI * 0.8, Math.PI * 2.2);
  $('arcbg').setAttribute('d', d); $('arcfg').setAttribute('d', d);
  let tk = '';
  for (let k = 0; k <= 10; k++) { const a = Math.PI * 0.8 + k / 10 * Math.PI * 1.4; const r0 = 104, r1 = k % 5 ? 109 : 114; tk += `<line x1="${162 + Math.cos(a) * r0}" y1="${112 + Math.sin(a) * r0}" x2="${162 + Math.cos(a) * r1}" y2="${112 + Math.sin(a) * r1}" stroke="rgba(0,240,255,${k % 5 ? .35 : .8})" stroke-width="2"/>`; }
  $('ticks').innerHTML = tk;
  const dpr = Math.min(2, window.devicePixelRatio || 1); mm.width = mm.height = 200 * dpr;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9; for (const p of MAIN.P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const S = 200 * dpr, pad = 16 * dpr, sc = (S - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (S - (maxX - minX) * sc) / 2, oz = (S - (maxZ - minZ) * sc) / 2;
  mmT = (x, z) => [S - (ox + (x - minX) * sc), S - (oz + (z - minZ) * sc)];
  mmBase = document.createElement('canvas'); mmBase.width = mmBase.height = S; const g = mmBase.getContext('2d');
  g.lineJoin = 'round'; g.lineCap = 'round';
  // One clear ribbon, dark edge, neutral rivals and a cyan directional player marker.
  const trackPath = (path, stride, closed = true) => { g.beginPath(); for (let i = 0; i < path.N; i += stride) { const [x, y] = mmT(path.P[i].x, path.P[i].z); i ? g.lineTo(x, y) : g.moveTo(x, y); } if (closed) g.closePath(); };
  trackPath(MAIN, 3); g.strokeStyle = '#07101b'; g.lineWidth = 11 * dpr; g.stroke();
  g.strokeStyle = '#d9e5ef'; g.lineWidth = 5.5 * dpr; g.stroke();
  if (HASBR) { trackPath(BR, 3, false); g.setLineDash([5 * dpr, 5 * dpr]); g.lineWidth = 3 * dpr; g.strokeStyle = '#8197aa'; g.stroke(); g.setLineDash([]); }
  const si = Math.round(S0 / MAIN.ds); const [sx, sy] = mmT(MAIN.P[si].x, MAIN.P[si].z); g.fillStyle = '#fff'; g.fillRect(sx - 3 * dpr, sy - 3 * dpr, 6 * dpr, 6 * dpr);
  mm.dpr = dpr;
  $('record').textContent = isFinite(recordLap) ? `${modeLabel()} record ${fmt(recordLap)}` : `No ${modeLabel()} record yet`;
}
let hudCache = {};
function setT(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function setH(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).innerHTML = v; } }
let mmFrame = 0, gapBehindPrev = 99, closingRate = 0;
function updateHUD(dt) {
  const rt = raceTime();
  setT('time', fmt(rt));
  setT('laptime', fmt(state === 'race' ? rt - player.lapStart : (player.lapTimes.length ? player.lapTimes[player.lapTimes.length - 1] : 0)));
  setT('best', fmt(sim.bestLap));
  setH('lapbig', `${Math.min(player.lap + 1, LAPS)}<span>/${LAPS}</span>`);
  let ranks = sim.ranks(), p = ranks.indexOf(player) + 1;
  const MPR = MP.race && MP.net && MP.net.race && MP.net.race.pres;
  if (MPR) {   // multiplayer: sticky position in the local timeline (src/client/present.js); results stay server-side
    p = MPR.rank(MP.net.you, player.prog, player.finished);
    ranks = ranks.filter(r => r !== player); p = Math.min(p, ranks.length + 1); ranks.splice(p - 1, 0, player);
  }
  setH('pos', `P${p}<small>/${racers.length}</small>`);
  // gaps (seconds, from distance and the chaser's speed)
  const ahead = ranks[p - 2], behind = ranks[p];
  let gh = '';
  if (ahead) { const g = ahead.finished && !player.finished ? null : (ahead.prog - player.prog) / Math.max(35, player.speed); gh += `<div class="g ah"><span>▲ ${ahead.name}</span><span>${g == null ? 'FIN' : '-' + g.toFixed(2)}</span></div>`; }
  let gb = 99;
  if (behind) { gb = (player.prog - behind.prog) / Math.max(35, behind.speed); gh += `<div class="g bh"><span>▼ ${behind.name}</span><span>+${gb.toFixed(2)}</span></div>`; }
  setH('gaps', gh || '<div class="g"><span>—</span></div>');
  if (state === 'race' && behind) { const rate = (gb - gapBehindPrev) / Math.max(dt, 1e-3); closingRate = lerp(closingRate, clamp(rate, -2, 2), damp(2, dt)); }
  gapBehindPrev = gb;
  const closing = state === 'race' && behind && gb < 1.4 && closingRate < -0.04;
  $('closing').classList.toggle('on', !!closing); if (closing) setT('closing', `▲ ${behind.name} CLOSING`);
  const kmh = Math.round(player.speed * 3.6);
  setT('spdT', String(kmh));
  setT('mobileSpeed', String(kmh)); setT('mobileTime', fmt(rt)); setT('mobileLap', `${Math.min(player.lap + 1, LAPS)}/${LAPS}`);
  const progress = $('raceProgress');
  progress.hidden = racers.length > 4;
  if (!progress.hidden) setH('raceProgress', racers.map(r => `<i style="left:${clamp(r.prog / (LAPLEN * LAPS), 0, 1) * 100}%;--r:${r === player ? '#00f0ff' : r.css};z-index:${r === player ? 2 : 1}" title="${escHtml(r.name)}">${escHtml(r.name[0])}</i>`).join(''));
  $('arcfg').setAttribute('stroke-dashoffset', String(100 - clamp(kmh / 460, 0, 1) * 100));
  $('boost').firstElementChild.style.width = (player.meter * 100).toFixed(1) + '%';
  $('boost').classList.toggle('on', player.boost); $('boost').classList.toggle('full', player.meter > 0.99);
  const dOn = player.draftT > 0.05 && !player.autopilot;
  $('draft').classList.toggle('on', dOn); $('dlbl').classList.toggle('on', dOn);
  $('draft').firstElementChild.style.width = (clamp(player.draftT / 1.5, 0, 1) * 100).toFixed(0) + '%';
  $('ww').classList.toggle('on', sim.wrongWayT > 0.8);
  if ((mmFrame++ & 1) === 0) {
    const S = mm.width, d = mm.dpr; mg.clearRect(0, 0, S, S); mg.drawImage(mmBase, 0, 0);
    for (const r of racers.filter(r => r !== player)) {
      const [x, y] = mmT(r.world.x, r.world.z); mg.fillStyle = '#8298ab'; mg.strokeStyle = '#08111d'; mg.lineWidth = 2 * d;
      mg.beginPath(); mg.arc(x, y, 4.5 * d, 0, 7); mg.fill(); mg.stroke();
    }
    const [px, py] = mmT(player.world.x, player.world.z);
    const pf = frameAt(player.path, player.s, mmPlayerFrame);
    const [fx, fy] = mmT(player.world.x + pf.T.x * 10, player.world.z + pf.T.z * 10);
    mg.save(); mg.translate(px, py); mg.rotate(Math.atan2(fy - py, fx - px) + Math.PI / 2);
    mg.beginPath(); mg.moveTo(0, -9 * d); mg.lineTo(6 * d, 7 * d); mg.lineTo(0, 4 * d); mg.lineTo(-6 * d, 7 * d); mg.closePath();
    mg.fillStyle = '#00eeff'; mg.strokeStyle = '#fff'; mg.lineWidth = 1.5 * d; mg.fill(); mg.stroke(); mg.restore();
    mg.shadowBlur = 0;
  }
}
function showResults() {
  if (MP.race) return mpShowResults();
  $('nextMap').hidden = false;
  $('nextMap').disabled = false;
  $('nextMap').textContent = `NEXT MAP · ${MAPS[MAP_KEYS[(MAP_KEYS.indexOf(MAPKEY) + 1) % MAP_KEYS.length]].short}`;
  const ranks = sim.ranks();
  const p = ranks.indexOf(player) + 1;
  const el = $('resPos'); el.textContent = `P${p}`; el.dataset.t = `P${p}`;
  let h = '<tr><th>POS</th><th>PILOT</th><th>BEST LAP</th><th>TIME</th></tr>';
  ranks.forEach((r, k) => {
    const best = r.lapTimes.length ? Math.min(...r.lapTimes) : null;
    h += `<tr class="${r === player ? 'me' : ''}"><td>P${k + 1}</td><td><span class="sw" style="background:${r.css};box-shadow:0 0 8px ${r.css}"></span>${r.name}</td><td>${fmt(best)}</td><td>${r.finished ? fmt(r.finishTime) : 'LAP ' + Math.min(r.lap + 1, LAPS) + '…'}</td></tr>`;
  });
  $('resTable').innerHTML = h;
  $('resLaps').innerHTML = player.lapTimes.map((t, k) => `LAP ${k + 1} &nbsp; ${fmt(t)}${t === sim.bestLap ? ' <span style="color:#ffc23f">★</span>' : ''}`).join('<br>') + (isFinite(recordLap) ? `<br><span style="color:#ffc23f">TRACK RECORD ${fmt(recordLap)}</span>` : '');
}

/* ---------- flow ---------- */
let raceStarting = false, lastPrecompile = null;
// Upload every texture the race scene uses, so the first intro frames don't stall on it.
function initSceneTextures(root) {
  const seen = new Set();
  root.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) for (const k in m) { const v = m[k]; if (v && v.isTexture && !seen.has(v)) { seen.add(v); renderer.initTexture(v); } } });
  return seen.size;
}
async function startRace() {
  if (state !== 'title' || raceStarting || mapBusy || isPortrait() || (MP.net && MP.net.room)) return;
  if (!isRaceReady(GAR.sel, assetStatus)) { ensureRaceAssets(GAR.sel); return; }
  raceStarting = true;
  try {
    AU.init(); sim.weapons = WEAPONS_AVAILABLE && !!SETTINGS.weapons; sim.catchup = SETTINGS.catchup !== false;sim.catchupStyle=SETTINGS.catchupStyle==='standard'?'standard':'strong'; sim.diff = SETTINGS.diff; sim.setMode(driveMode);
    refreshRacerCars(); soloPickupLayout();gridUp(); hudCache = {}; $('sector').textContent = `S1 · ${SECTORS[0].name}`; $('sector').style.color = SECTORS[0].css;
    $('go').blur(); $('go').disabled = true; $('go').textContent = 'Preparing…';
    for (const r of racers) updateVisual(r, 0);
    // Precompile all race materials (player + rival cars + world) and upload their textures
    // BEFORE the intro's wall clock starts, so shader compilation can't eat intro time.
    const t0 = performance.now();
    try { await renderer.compileAsync(scene, camera); } catch (e) { renderer.compile(scene, camera); }
    const textures = initSceneTextures(scene);
    lastPrecompile = { ms: Math.round(performance.now() - t0), programs: renderer.info.programs.length, textures };
    performance.mark('ng:race-precompiled');
  } finally { raceStarting = false; }
  if (state !== 'title') return;
  $('title').classList.add('hide'); $('hud').classList.add('on');
  introT = 0; camFrom.copy(CC.pos); lookFrom.copy(CC.look);
  introWall = performance.now(); last = introWall; clock.reset(); introStats = { frames: 0, maxFrameMs: 0, startedAt: introWall, endedAt: 0, skipped: false };
  if (CINE.on) { state = 'intro'; startIntroCine(); } else { state = 'intro'; endIntro(); }
  setTimeout(() => $('bl').classList.add('dim'), 9000);
}
let introStats = null;
function startRaceNow() { // QA: straight into a running race, no intro/countdown
  cineUI(false); FIN.on = false; FIN.t = 99;
  AU.init(); setPlayerCar(); $('sector').textContent = `S1 · ${SECTORS[0].name}`;
  $('title').classList.add('hide'); $('results').classList.add('hide'); $('hud').classList.add('on');
  shownResults = false; hudCache = {};
  sim.weapons = WEAPONS_AVAILABLE && !!SETTINGS.weapons; sim.catchup = SETTINGS.catchup !== false;sim.catchupStyle=SETTINGS.catchupStyle==='standard'?'standard':'strong'; soloPickupLayout();gridUp(); state = 'race'; sim.startRace();
  sim.pose(player); chaseTarget(0, true, CC.pos, CC.look, CC.up);
}
function toGarage() {
  document.body.classList.remove('racing');for(const id of ['fireWeapon','weaponSlot','weaponWarning','weaponTarget'])$(id).hidden=true;
  cineUI(false); FIN.on = false; FIN.t = 99;
  if (paused) { paused = false; AU.pause(false); }
  player.qaBoost = false; player.autopilot = false; player.pers = null; QA.mode = null;
  $('results').classList.add('hide'); $('pause').classList.add('hide'); $('hud').classList.remove('on'); $('crashv').classList.remove('on');
  $('title').classList.remove('hide');
  shownResults = false; gridUp(); for (const m of startLamps) m.color.setRGB(0.15, 0.02, 0.03);
  for (const r of racers) updateVisual(r, 0);
  state = 'title'; garageShow();
}
function restart() {
  cineUI(false); FIN.on = false; FIN.t = 99;
  $('results').classList.add('hide'); $('pause').classList.add('hide'); if (paused) { paused = false; AU.pause(false); }
  shownResults = false; hudCache = {};
  player.qaBoost = false; if (QA.mode) { player.autopilot = false; player.pers = null; QA.mode = null; }
  soloPickupLayout();gridUp(); for (const m of startLamps) m.color.setRGB(0.15, 0.02, 0.03);
  $('crashv').classList.remove('on');
  state = 'countdown'; cdT = 3.0; lastCount = -1; CC.shake = 0; boostAmt = 0;
  sim.pose(player); chaseTarget(0, true, CC.pos, CC.look, CC.up);
  $('hud').classList.add('on'); $('sector').textContent = `S1 · ${SECTORS[0].name}`; $('sector').style.color = SECTORS[0].css;
}
function togglePause() {
  if (MP.race) return;   // multiplayer races cannot be paused (the server keeps racing); use Leave race
  if (!(state === 'race' || state === 'countdown')) return;
  $('pauseHeading').textContent = 'PAUSED';
  paused = !paused; releaseAllInputs(); $('pause').classList.toggle('hide', !paused); AU.pause(paused); $('pauseNote').textContent = '';
}
function closeRaceMenu() {
  $('raceOptions').hidden = true;
  if (MP.race) $('pause').classList.add('hide');
  else if (paused && !isPortrait()) togglePause();
}
$('raceMenuBtn').addEventListener('click', () => {
  menuLeaveArm = 0; $('raceOptions').hidden = true;
  releaseAllInputs();
  if (MP.race) $('pause').classList.remove('hide'); else if (!paused) togglePause();
  $('pauseHeading').textContent = MP.race ? 'RACE MENU' : 'PAUSED';
  $('pauseNote').textContent = MP.race ? 'Online race continues. Other racers do not pause.' : 'Solo race paused.';
  $('menuRestart').hidden = !!MP.race;
  $('menuLeave').textContent = MP.race ? 'Leave race' : 'Garage';
});
$('menuSettings').addEventListener('click', () => { $('raceOptions').hidden = !$('raceOptions').hidden; });
$('menuRestart').addEventListener('click', () => { if (!MP.race) { releaseAllInputs(); restart(); } });
let menuLeaveArm = 0;
$('menuLeave').addEventListener('click', () => {
  if (MP.race && performance.now() - menuLeaveArm > 3000) { menuLeaveArm = performance.now(); $('menuLeave').textContent = 'Tap again to leave'; return; }
  $('pause').classList.add('hide'); releaseAllInputs(); if (MP.race) mpLeave(); else toGarage();
});
$('go').addEventListener('click', () => { if (isPortrait()) return; if (TOUCH) requestLandscape(); startRace(); });
$('again').addEventListener('click', () => { $('again').blur(); restart(); });
$('nextMap').addEventListener('click', async () => {
  if (MP.race || (MP.net && MP.net.room) || state !== 'finished' || $('nextMap').disabled) return;
  $('nextMap').disabled = true;
  const next = MAP_KEYS[(MAP_KEYS.indexOf(MAPKEY) + 1) % MAP_KEYS.length];
  toGarage();
  await switchMap(next, true, 0);
  await ensureRaceAssets(GAR.sel);
  if (state === 'title' && MAPKEY === next) startRace();
});
$('toGarage').addEventListener('click', () => { $('toGarage').blur(); if (MP.race) mpEndRaceView(); else toGarage(); });
$('prevCar').addEventListener('click', () => cycleCar(-1));
$('nextCar').addEventListener('click', () => cycleCar(1));
$('paints').addEventListener('click', e => { const p = e.target.closest('[data-p]'); if (p) setPaint(+p.dataset.p); });
$('carDots').addEventListener('click', e => { const p = e.target.closest('[data-car]'); if (p) selectCar(p.dataset.car); });
const openSheet = id => { for (const s of document.querySelectorAll('.sheet')) s.classList.toggle('hide', s.id !== id || !s.classList.contains('hide')); GAR.fit = null; };
$('credBtn').addEventListener('click', () => { $('homeMore').open = false; openSheet('credPanel'); });
$('ctrlBtn').addEventListener('click', () => { $('homeMore').open = false; openSheet('ctrlPanel'); });
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => { b.closest('.sheet').classList.add('hide'); GAR.fit = null; });
if (DEBUG) $('qa').addEventListener('click', e => { const b = e.target.closest('[data-qa]'); if (!b) return; b.blur(); const m = b.dataset.qa;
  if (m === 'garage') qaGarageNext(); else if (m === 'boost') qaBoostDemo(false); else if (m === 'inverted') qaBoostDemo(true); else if (m === 'exit') { toGarage(); qaInfo('back in garage'); } else if (m === 'close') $('qa').classList.add('hide'); });
{ // drag to rotate the showroom car
  const cv = renderer.domElement;
  cv.addEventListener('pointerdown', e => { if (state !== 'title') return; GAR.drag = e.clientX; cv.setPointerCapture && cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', e => { if (GAR.drag == null) return; GAR.rot += (e.clientX - GAR.drag) * 0.009; GAR.drag = e.clientX; GAR.lastInteract = gameTime; });
  const end = () => { GAR.drag = null; GAR.lastInteract = gameTime; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
}
let rearViewHeld=false;
const KEYMAP = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyX: 'drift', ShiftLeft: 'boost', ShiftRight: 'boost', Space: 'boost' };
addEventListener('keydown', e => {
  if(e.code==='KeyC'&&!TOUCH&&state==='race'&&!paused&&!/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName||'')){rearViewHeld=true;e.preventDefault();}
  const k = KEYMAP[e.code];
  if (k) { keys[k] = 1; e.preventDefault(); mpPushKeys(); }
  if (e.repeat) return;
  if (e.code === 'KeyF') { e.preventDefault(); if(!e.repeat)requestWeaponFire(); }
  if (state === 'title') { if (e.code === 'ArrowLeft' || e.code === 'KeyA') cycleCar(-1); if (e.code === 'ArrowRight' || e.code === 'KeyD') cycleCar(1); }
  if ((e.code === 'Enter' || e.code === 'Space') && state === 'intro') { endIntro(true); return; }
  if (e.code === 'Enter' && skipFinishCine()) return;
  if (e.code === 'Enter' && !MP.race && !(MP.net && MP.net.room)) { if (state === 'title') startRace(); else if (state === 'finished' || paused) restart(); }
  if (e.code === 'KeyR' && state === 'race' && !paused && !MP.race) sim.resetPlayer();
  if (e.code === 'Escape' && state === 'title') { for (const s of document.querySelectorAll('.sheet')) s.classList.add('hide'); GAR.fit = null; }
  if (e.code === 'Escape' && MP.race) { if ($('pause').classList.contains('hide')) $('raceMenuBtn').click(); else closeRaceMenu(); }
  else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyM') { AU.setMusic(!MUSIC.enabled); flash(MUSIC.enabled ? 'MUSIC ON' : 'MUSIC OFF', '#8a5cff'); }
});
addEventListener('keyup', e => {if(e.code==='KeyC'){rearViewHeld=false;e.preventDefault();} const k = KEYMAP[e.code]; if (k) { keys[k] = 0; e.preventDefault(); mpPushKeys(); } });
addEventListener('blur', () => {rearViewHeld=false; for (const k in keys) keys[k] = 0; mpPushKeys(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (MP.race) { releaseAllInputs(); mpPushKeys(true); } else if (state === 'race' && !paused) togglePause(); } });
addEventListener('pagehide', () => { if (MP.race) { releaseAllInputs(); mpPushKeys(true); } });
// multiplayer (worker path): every input change reaches the input worker immediately, not at the next
// rendered frame; releases are forced through even if the frame looks unchanged
function mpPushKeys(force = false) { const n = MP.net; if (n && n.isWorker && MP.race) n.setKeys(encodeFrame(keys), force); }
function resize() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  fxc.width = innerWidth; fxc.height = innerHeight;
  spMat.uniforms.uH.value = innerHeight * renderer.getPixelRatio() * 0.5;
  exMat.uniforms.uH.value = innerHeight * renderer.getPixelRatio() * 0.5;
  GAR.cam.aspect = innerWidth / innerHeight; GAR.cam.updateProjectionMatrix(); layoutMode();
}
addEventListener('resize', resize);

/* ---------- main loop: fixed-step simulation, wall-clock presentation ---------- */
// The simulation advances in fixed SIM_DT steps by real elapsed time (core/clock.js), so
// low frame rates no longer slow the race or its clock. Long stalls (>= 1 s: tab
// suspension, debugger, OS sleep) are not simulated; a running race is paused instead.
const clock = createClock();
const fpsMeter = createFpsMeter(1);
let introWall = 0, lastFps = 0, last = performance.now(), lowT = 0, adT = 0, RDT = 0, lastStall = null;
const prevBoost = { v: false };
function frame(now) {
  requestAnimationFrame(frame);
  if (!manualClock) advanceFrame(now);
}
// Presentation-only interpolation for the local slow-motion finish shot.
const finishPoseCache=new Map();
function captureFinishPoses(){for(const r of racers){let c=finishPoseCache.get(r);if(!c){c={prev:r.world.clone(),current:r.world.clone()};finishPoseCache.set(r,c);}c.prev.copy(r.world);}}
function blendFinishPoses(alpha){for(const r of racers){const c=finishPoseCache.get(r);if(!c)continue;c.current.copy(r.world);r.world.lerpVectors(c.prev,c.current,alpha);}}
function restoreFinishPoses(){for(const[r,c]of finishPoseCache)r.world.copy(c.current);}
let fxLowT = 0, fxHighT = 0, fxFallbacks = 0;
function advanceFrame(now, render = true) {
  document.body.classList.toggle('racing', state === 'race' || state === 'countdown');
  MUSIC.update(state, MAPKEY, paused);
  const wall = Math.max(0, (now - last) / 1000); last = now;
  RDT = Math.min(1.0, wall);
  const nBefore = fpsMeter.n; fpsMeter.frame(wall);
  if (fpsMeter.n === 0 && nBefore > 0) {   // a 1 s FPS window just closed (wall-clock based)
    lastFps = fpsMeter.fps;
    if (state !== 'loading' && !paused) {
      const before = qualityState.bloom;
      qualityState = qualitySample(qualityState, lastFps, qualityLimits(qualityMode, devicePixelRatio));
      if (before && !qualityState.bloom) fxFallbacks++;
      bloom.enabled = qualityState.bloom;
      if (PR !== qualityState.pr) { PR = qualityState.pr; renderer.setPixelRatio(PR); composer.setPixelRatio(PR); resize(); }
    }
  }
  if (state === 'loading' || window.__ngFreeze) return;
  if (paused) { composer.render(); return; }
  // brief slow motion right after the player crosses the line (finish camera)
  const ts = state === 'finished' && FIN.on && FIN.t < 2.2 ? 0.3 : 1;
  applyTilt();
  if (MP.race) { const tn = performance.now(); if (mpLastRender && mpRenderGaps.length < 50000) mpRenderGaps.push(tn - mpLastRender); mpLastRender = tn; mpRenderN++; if (MP.net && MP.net.isWorker && (mpRenderN & 15) === 0) MP.net.refreshState(); mpFrame(wall, Math.min(wall, clock.maxCatchUp), now); if (render && !(DEBUG && window.__ngRenderEvery > 1 && (mpRenderN % window.__ngRenderEvery))) renderNow(); return; }
  const adv = clock.advance(wall, ts);
  if (adv.stalled) onStall(wall);
  const smoothFinish=state==='finished'&&FIN.on&&FIN.t<3.4;
  if(!smoothFinish)finishPoseCache.clear();
  for(let i=0;i<adv.steps;i++){if(smoothFinish)captureFinishPoses();sim.step(adv.h);}
  gameTime=sim.time;
  if(smoothFinish)blendFinishPoses(Math.max(0,Math.min(1,clock.acc/adv.h)));
  try{update(adv.simDt,Math.min(wall,clock.maxCatchUp));if(render)renderNow();}
  finally{if(smoothFinish)restoreFinishPoses();}
}
// Gaps >= 1 s are never simulated (counted as dropped). A running race is additionally
// auto-paused when the gap is long enough to be a suspension (>= 3 s) rather than a hitch.
const AUTO_PAUSE_AFTER = 3.0;
function onStall(wall) {
  lastStall = { ms: Math.round(wall * 1000), state, at: Math.round(performance.now()), paused: false };
  if (!MP.race && wall >= AUTO_PAUSE_AFTER && (state === 'race' || state === 'countdown') && !paused) {
    lastStall.paused = true; togglePause(); $('pauseNote').textContent = `Auto-paused: the game was suspended for ${wall.toFixed(1)} s`; }
}
function renderNow() {
  const g = state === 'title';
  renderPass.scene = g ? GAR.scene : scene; renderPass.camera = g ? GAR.cam : camera;
  if (!g) cullGround(camera);
  renderer.info.reset();
  if (g) { fxPass.uniforms.uAmt.value = 0; fxPass.uniforms.uBlur.value = 0; }
  bloom.strength = g ? 0.12 : 0.5; bloom.threshold = g ? 1.35 : 1.0; renderer.toneMappingExposure = g ? 0.9 : 1.0;
  composer.render();
}
// dt: simulated seconds advanced this frame (already includes finish slow-mo);
// dt0: real presentation seconds this frame (bounded), used by scripted wall-clock sequences.
function update(dt, dt0) {
  if (state === 'finished') FIN.t += dt0;
  updateDrones();
  // countdown
  if (state === 'countdown') {
    cdT -= dt0;
    const n = Math.ceil(cdT);
    if (n !== lastCount && n > 0 && n <= 3) {
      lastCount = n; const el = $('count'); el.className = ''; el.textContent = n; void el.offsetWidth; el.className = 'pop';
      AU.beep(440, 0.22, 0.22); startLamps.forEach((m, k) => { if (k < 4 - n) m.color.setRGB(7, 0.3, 0.35); });
    }
    if (cdT <= 0) {
      state = 'race'; sim.diff = SETTINGS.diff; const perfect = MP.race ? false : sim.startRace();
      const el = $('count'); el.className = ''; el.textContent = 'GO'; void el.offsetWidth; el.className = 'pop go';
      AU.beep(880, 0.5, 0.26); startLamps.forEach(m => m.color.setRGB(0.4, 7, 1.5));
      secFlash(0);
      if (perfect) CC.kick = 8;
    }
  }
  if (state === 'finished') { cineUI(FIN.on && FIN.t < 3.4, false, FIN.on && FIN.t < 3.4); finishT += dt; if ((FIN.on ? FIN.t > 3.4 : finishT > 2.6) && !shownResults) { shownResults = true; $('results').classList.remove('hide'); } if (shownResults) showResults(); }
  for (const r of racers) updateVisual(r, dt);
  if (HZV) HZV.update(gameTime);
  if (WVIS) WVIS.update();
  updateWeaponHUD(sim, player, {enabled:sim.weapons, racing:state==='race', online:!!MP.race, pending:!!MP.net?.race?.view?.pendingFire,camera,warningTone:()=>AU.weaponWarning()});
  updatePowerHUD();
  const s01 = Math.min(player.speed / 92, 1.4);
  const boosting = player.boost && state === 'race' && !player.crashed;
  if (boosting && !prevBoost.v) { AU.whoosh(); CC.kick = 5; CC.shake += 0.12; }
  prevBoost.v = boosting;
  boostAmt = lerp(boostAmt, boosting ? 1 : 0, damp(boosting ? 6 : 2.5, dt));
  // camera
  let s01c = 0;
  if (state === 'title') { flyTarget(dt, _cp, _cl, _cu); CC.pos.lerp(_cp, damp(3, dt)); CC.look.lerp(_cl, damp(3, dt)); CC.up.lerp(_cu, damp(2, dt)).normalize(); CC.roll = 0; }
  else if (state === 'intro') {
    if (introStats) { introStats.frames++; introStats.maxFrameMs = Math.max(introStats.maxFrameMs, RDT * 1000); }
    introT = RDT > 0 ? (performance.now() - introWall) / 1000 : introT + dt0; cineIntroCam(introT, dt0); if (introT >= CINE.len) endIntro();   // wall-clock from intro start (set after shader precompile)
  } else if (state === 'finished' && FIN.on && FIN.t < 3.4) {   // trackside finish camera (live, not a replay)
    CC.pos.copy(FIN.pos); CC.look.lerp(player.world, damp(12, dt0)); CC.up.copy(FIN.up); CC.roll = 0;
  } else if (state === 'finished') {
    orbitA += dt * 0.35;
    const f = frameAt(player.path, player.s, _fc);
    _cp.copy(player.world).addScaledVector(f.R, Math.sin(orbitA) * 11).addScaledVector(f.T, Math.cos(orbitA) * 11).addScaledVector(f.U, 3.2);
    CC.pos.lerp(_cp, damp(2.5, dt)); CC.look.lerp(player.world, damp(4, dt)); CC.up.lerp(f.U, damp(3, dt)).normalize(); CC.roll = lerp(CC.roll, 0, damp(3, dt));
  } else if (player.crashed > 0) {
    CC.look.lerp(player.world, damp(5, dt));
  } else {
    chaseTarget(dt, state === 'countdown', _cp, _cl, _cu); CC.pos.copy(_cp); CC.look.copy(_cl);
    CC.up.lerp(_cu, damp(state === 'countdown' ? 20 : 7, dt)).normalize(); s01c = s01;
    CC.roll = lerp(CC.roll, cameraLean(player.yawV, s01), damp(5, dt));
  }
  if(rearViewHeld&&state==='race'&&!paused&&!(player.crashed>0)){const f=frameAt(player.path,player.s,_fc);CC.pos.copy(player.world).addScaledVector(f.T,8).addScaledVector(f.U,2.6);CC.look.copy(player.world).addScaledVector(f.T,-18).addScaledVector(f.U,.6);CC.up.copy(f.U);CC.roll=0;}
  CC.kick = lerp(CC.kick, 0, damp(3, dt));
  const fovT = state === 'title' ? 62 : state === 'intro' ? 50 : (state === 'finished' && FIN.on && FIN.t < 3.4) ? 44 : 66 + Math.min(s01c, 1.15) * 9 + boostAmt * 6 + Math.min(CC.kick, 5) + player.tow * 3;
  camera.fov = lerp(camera.fov, fovT, damp(4, dt)); camera.updateProjectionMatrix();
  applyCam(CC.pos, CC.look, CC.up, dt, s01c);
  CC.shake *= Math.exp(-dt * 5);
  camVel.subVectors(camera.position, lastCam).divideScalar(Math.max(dt, 1e-3)); if (camVel.length() > 220) camVel.set(0, 0, 0); lastCam.copy(camera.position);
  sky.position.copy(camera.position);if(sky.material.uniforms?.uFX)sky.material.uniforms.uFX.value=qualityMode==='battery'||!qualityState.bloom?0:1;
  updateSparks(dt);
  exUpdate(dt);
  rainMat.uniforms.uTime.value = gameTime; rainMat.uniforms.uCam.value.copy(camera.position); rainMat.uniforms.uVel.value.lerp(camVel, damp(6, dt));
  const musicGlow=beatGlow(MUSIC.sampleBeat(dt0,qualityMode!=='battery'&&qualityState.bloom&&!REDUCED&&state!=='title'&&!paused));
  for(const b of beatMats)b.mat.color.copy(b.base).multiplyScalar(musicGlow);
  for (const m of barrierMats) {m.uniforms.uBeat.value=musicGlow; m.uniforms.uTime.value = gameTime; m.uniforms.uHit.value *= Math.exp(-dt * 3.5); }
  hitFlash *= Math.exp(-dt * 4);
  const tw = state === 'race' ? player.tow : 0;
  const racingV = state === 'race' || state === 'countdown' || state === 'finished';
  const vms = racingV ? player.speed : 0, bk = BLUR_K[SETTINGS.blur] || 0;
  fxPass.uniforms.uTime.value = gameTime;
  fxPass.uniforms.uAmt.value = (bk > 0 ? Math.max(0, vms - 100) * 0.00009 * bk : 0) + hitFlash * 0.02;   // tiny CA only at very high speed
  fxPass.uniforms.uHit.value = hitFlash;
  fxPass.uniforms.uBlur.value = bk * (sstep(45, 120, vms) * 0.045 + boostAmt * 0.034 + tw * 0.01);
  MB.blur = fxPass.uniforms.uBlur.value;
  fxPass.uniforms.uTint.value.setRGB(0.0, 0.05 * tw, 0.07 * tw).addScalar(boostAmt * 0.02);
  drawSpeedLines(state === 'race' && SETTINGS.blur > 0 ? clamp(boostAmt * 0.55 + Math.max(0, s01 - 0.85) * 1.2, 0, 1) * (SETTINGS.blur === 2 ? 1 : 0.7) : 0, state === 'race' ? clamp(player.draftT / 1.5, 0, 1) * 0.8 : 0, dt);
  chevTex.offset.x -= dt * 1.6;
  adT += dt; if (adT > 0.05) { adT = 0; for (let k = 0; k < 3; k++) drawAd(k, gameTime + k * 1.7); }
  for (const f of flickerMats) { const v = Math.sin(gameTime * 23 + f.seed) * Math.sin(gameTime * 7.3 + f.seed * 2); f.mat.color.setScalar((v > 0.82 ? 0.25 : 2.3)*musicGlow); }
  const hc = holoCenter.userData; hc.ring1.rotation.x = gameTime * 0.3; hc.ring1.rotation.y = gameTime * 0.2; hc.ring2.rotation.y = -gameTime * 0.4; hc.ring2.rotation.z = gameTime * 0.25; hc.ico.rotation.y = gameTime * 0.15; hc.ico2.rotation.x = gameTime * 0.5; hc.ico2.rotation.y = -gameTime * 0.35;
  for (const s of searchlights) { const p = s.userData.ph; s.rotation.set(Math.sin(gameTime * 0.25 + p) * 0.42, 0, Math.cos(gameTime * 0.19 + p * 1.3) * 0.42); }
  for (let k = 0; k < trafficLanes.length; k++) { const l = trafficLanes[k]; const s = mod(gameTime * l.sp + l.ph, 2400) - 1200; setInst(traffic, k, l.ox + l.dx * s + l.dz * l.off, l.y, l.oz + l.dz * s - l.dx * l.off, 0.9, 0.5, 5, Math.atan2(l.dx, l.dz)); }
  traffic.instanceMatrix.needsUpdate = true;
  if (state === 'title') { updateGarage(dt); AU.engine(0, 0, 0, 0, 0); }
  else AU.engine(Math.min(player.speed / 92, 1.3), player.thr, boostAmt, player.drift && player.speed > 20 && !player.autopilot ? 1 : (player.scrape ? 0.7 : 0), tw);
  updateHUD(dt);
}


/* ---------- settings: motion blur / camera shake (reduced-motion aware) ---------- */
const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const SETTINGS = { blur: REDUCED ? 0 : 1, shake: !REDUCED, diff: 'normal', cine: true, steer: 'touch', mode: driveMode, quality: qualityMode, music: MUSIC.enabled, weapons: false, npcs:raceNPCCount,laps:raceLapsSetting, catchup: true,catchupStyle:'strong', ambient: false, engineIdle: false };
try { const s = JSON.parse(localStorage.getItem('nightgrid_v4_settings') || 'null'); if (s) Object.assign(SETTINGS, s); } catch (e) { }
const BLUR_K = [0, 1, 1.8];
function qualityUI() {
  for (const el of document.querySelectorAll('.qualityOptions')) el.innerHTML = QUALITY.map(q => `<button type="button" data-quality="${q}" role="radio" aria-checked="${q === qualityMode}" class="${q === qualityMode ? 'on' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('');
}
function applyQuality(q) {
  if (!QUALITY.includes(q)) return;
  SETTINGS.quality = qualityMode = q;if(q==='battery')gainGlowAnimation?.cancel();
  const limits = qualityLimits(q, devicePixelRatio);
  qualityState = { pr: limits.max, bloom: limits.bloom };
  PR = qualityState.pr; bloom.enabled = qualityState.bloom;
  renderer.setPixelRatio(PR); composer.setPixelRatio(PR); resize(); composer.render(); saveSettings();
}
document.addEventListener('click', e => { const m = e.target.closest('[data-music-toggle]'); if (m) AU.setMusic(!MUSIC.enabled); const b = e.target.closest('[data-quality]'); if (b) applyQuality(b.dataset.quality); });
function renderSettings() {
  qualityUI();
  const locked=state!=='title'||!!MP.net?.room;
  $('setNPCs').innerHTML=[3,5,7].map(n=>`<button data-npcs="${n}" class="${raceNPCCount===n?'on':''}" ${locked?'disabled':''}>${n} rivals</button>`).join('');
  $('setLaps').innerHTML=[[0,'Track'],[2,'2 laps'],[3,'3 laps'],[5,'5 laps']].map(([n,label])=>`<button data-laps="${n}" class="${raceLapsSetting===n?'on':''}" ${locked?'disabled':''}>${label}</button>`).join('');
  $('setWeapons').innerHTML = WEAPONS_AVAILABLE ? [false,true].map(on=>`<button data-weapons="${on?1:0}" class="${!!SETTINGS.weapons===on?'on':''}" role="radio" aria-checked="${!!SETTINGS.weapons===on}">${on?'Mines + EMP':'Clean'}</button>`).join('') : 'Weapons unavailable';
  for (const b of document.querySelectorAll('[data-music-toggle]')) { b.textContent = MUSIC.enabled ? 'Music: On' : 'Music: Off'; b.setAttribute('aria-pressed', String(MUSIC.enabled)); }
  $('setBlur').innerHTML = ['Off', 'Mild', 'Strong'].map((n, i) => `<button class="${SETTINGS.blur === i ? 'on' : ''}" data-blur="${i}" role="radio" aria-checked="${SETTINGS.blur === i}">${n}</button>`).join('');
  $('setShake').innerHTML = ['Off', 'On'].map((n, i) => `<button class="${+SETTINGS.shake === i ? 'on' : ''}" data-shake="${i}" role="radio" aria-checked="${+SETTINGS.shake === i}">${n}</button>`).join('');
  $('setMode').innerHTML = [['assisted', 'Assisted'], ['expert', 'Expert']].map(([k, n]) => `<button class="${driveMode === k ? 'on' : ''}" data-mode="${k}" role="radio" aria-checked="${driveMode === k}">${n}</button>`).join('');
  $('setAmbient').innerHTML = ['Off', 'On'].map((n, i) => `<button class="${+!!SETTINGS.ambient === i ? 'on' : ''}" data-ambient="${i}" role="radio" aria-checked="${+!!SETTINGS.ambient === i}">${n}</button>`).join('');
  $('setEngineIdle').innerHTML = ['Off', 'On'].map((n, i) => `<button class="${+!!SETTINGS.engineIdle === i ? 'on' : ''}" data-engine-idle="${i}" role="radio" aria-checked="${+!!SETTINGS.engineIdle === i}">${n}</button>`).join('');
  $('setCatchup').innerHTML = ['Off','Standard','Strong'].map((n,i)=>{const active=SETTINGS.catchup===false?0:SETTINGS.catchupStyle==='standard'?1:2;return `<button class="${active===i?'on':''}" data-catchup="${i}" role="radio" aria-checked="${active===i}">${n}</button>`;}).join('');
  $('setDiff').innerHTML = [['normal', 'Normal'], ['hard', 'Hard']].map(([k, n]) => `<button class="${SETTINGS.diff === k ? 'on' : ''}" data-diff="${k}" role="radio" aria-checked="${SETTINGS.diff === k}">${n}</button>`).join('');
  $('setCine').innerHTML = ['Off', 'On'].map((n, i) => `<button class="${+(SETTINGS.cine !== false) === i ? 'on' : ''}" data-cine="${i}" role="radio" aria-checked="${+(SETTINGS.cine !== false) === i}">${n}</button>`).join('');
  $('setSteer').innerHTML = [['touch', 'Touch'], ['tilt', 'Enable Tilt']].map(([k, n]) => `<button class="${(SETTINGS.steer || 'touch') === k ? 'on' : ''}" data-steer="${k}" role="radio" aria-checked="${(SETTINGS.steer || 'touch') === k}" style="min-height:44px">${n}</button>`).join('');
  $('setNote').textContent = REDUCED ? 'Reduced motion is on: blur and shake start off, cinematics are short and static.' : '';
}
function saveSettings() { try { localStorage.setItem('nightgrid_v4_settings', JSON.stringify(SETTINGS)); } catch (e) { } renderSettings(); }
$('setBlur').addEventListener('click', e => { const b = e.target.closest('[data-blur]'); if (b) { SETTINGS.blur = +b.dataset.blur; saveSettings(); } });
$('setShake').addEventListener('click', e => { const b = e.target.closest('[data-shake]'); if (b) { SETTINGS.shake = b.dataset.shake === '1'; saveSettings(); } });
$('setBtn').addEventListener('click', () => { $('homeMore').open = false; renderSettings();openSheet('setPanel'); });
$('setCine').addEventListener('click', e => { const b = e.target.closest('[data-cine]'); if (b) { SETTINGS.cine = b.dataset.cine === '1'; saveSettings(); } });
$('setMode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (!b || !DRIVE_MODES.includes(b.dataset.mode)) return; SETTINGS.mode = driveMode = b.dataset.mode; if (state === 'title') sim.setMode(driveMode); saveSettings(); loadRecord(); updateGarageUI(); });
$('setDiff').addEventListener('click', e => { const b = e.target.closest('[data-diff]'); if (b) { SETTINGS.diff = b.dataset.diff; sim.diff = SETTINGS.diff; saveSettings(); } });
$('setNPCs').addEventListener('click',e=>{const b=e.target.closest('[data-npcs]');if(!b||state!=='title'||MP.net?.room)return;raceNPCCount=SETTINGS.npcs=+b.dataset.npcs;swapRacers(()=>sim.addRacers(soloRivals()));refreshRacerCars();gridUp();saveSettings();updateGarageUI();});
$('setLaps').addEventListener('click',e=>{const b=e.target.closest('[data-laps]');if(!b||state!=='title'||MP.net?.room)return;raceLapsSetting=SETTINGS.laps=+b.dataset.laps;saveSettings();switchMap(MAPKEY,true,variantMask,true);});
$('setAmbient').addEventListener('click', e => { const b = e.target.closest('[data-ambient]'); if (b) AU.setAmbient(b.dataset.ambient === '1'); });
$('setEngineIdle').addEventListener('click', e => { const b = e.target.closest('[data-engine-idle]'); if (b) { SETTINGS.engineIdle = b.dataset.engineIdle === '1'; saveSettings(); } });
$('setCatchup').addEventListener('click', e => { const b = e.target.closest('[data-catchup]'); if (!b) return; SETTINGS.catchup=b.dataset.catchup!=='0';SETTINGS.catchupStyle=b.dataset.catchup==='1'?'standard':'strong';if(!MP.race){sim.catchup=SETTINGS.catchup;sim.catchupStyle=SETTINGS.catchupStyle;} saveSettings(); });
$('setWeapons').addEventListener('click', e => { const b=e.target.closest('[data-weapons]'); if(b&&state==='title'&&!MP.race){SETTINGS.weapons=b.dataset.weapons==='1';sim.weapons=WEAPONS_AVAILABLE&&SETTINGS.weapons;saveSettings();} });
sim.weapons=WEAPONS_AVAILABLE&&!!SETTINGS.weapons;
renderSettings();

/* ---------- cinematics: grid intro + finish camera (skippable, setting, reduced-motion aware) ---------- */
const CINE = { get on() { return SETTINGS.cine !== false; }, get len() { return REDUCED ? 2.6 : 6.0; } };
const FIN = { t: 99, on: false, pos: new V3(), up: new V3() };
const _cp2 = new V3(), _cl2 = new V3(), _cu2 = new V3(), _fci = mkF();
function cineUI(on, card, fin) { document.body.classList.toggle('cinematic', !!on); const c = $('cine'); c.classList.toggle('on', !!on); c.classList.toggle('card', !!card); c.classList.toggle('fin', !!fin); }
function cineIntroCam(t, dt) {
  const s0 = player.s, A = REDUCED ? 1.6 : 2.4, B = REDUCED ? 1.6 : 4.6, C = CINE.len;
  const f = frameAt(player.path, player.s, _fci);
  const orbit = (a, h, o1, o2, o3) => { o1.copy(player.world).addScaledVector(f.R, Math.sin(a) * 7.5).addScaledVector(f.T, Math.cos(a) * 7.5).addScaledVector(f.U, h); o2.copy(player.world).addScaledVector(f.U, 0.5); o3.copy(f.U); };
  if (t < A) {   // low side dolly back along the grid, past the rivals
    const e = REDUCED ? 0 : smooth(t / A);
    worldPos(MAIN, s0 - 16 + 9 * e, -1.5 + 3 * e, 1.0 + 0.4 * e, _cp); worldPos(MAIN, s0 + 18, 0, 1.2, _cl); _cu.copy(frameAt(MAIN, s0, _fc).U);
  } else if (t < B) {   // low orbit from front three-quarter round to behind the selected ship
    const e = smooth((t - A) / (B - A)); orbit(0.5 + 2.1 * e, 1.15 + 0.45 * e, _cp, _cl, _cu);
  } else {   // ease into the chase camera
    const e = smooth((t - B) / (C - B));
    if (REDUCED) { worldPos(MAIN, s0 - 16, -1.5, 1.0, _cp2); worldPos(MAIN, s0 + 18, 0, 1.2, _cl2); _cu2.copy(f.U); } else orbit(2.6, 1.6, _cp2, _cl2, _cu2);
    chaseTarget(dt, true, _cp, _cl, _cu);
    _cp.lerpVectors(_cp2, _cp, e); _cl.lerpVectors(_cl2, _cl, e); _cu.lerpVectors(_cu2, _cu, e).normalize();
  }
  CC.pos.copy(_cp); CC.look.copy(_cl); CC.up.copy(_cu); CC.roll = 0;
  cineUI(true, t > 0.3 && t < B - 0.2, false);
}
function startIntroCine() {
  $('cineSub').textContent = MAPDEF.sub; $('cineName').textContent = MAPDEF.name;
  $('cineMeta').textContent = `${LAPS} laps · ${(SHORT[GAR.sel] || [CARS[GAR.sel].nick])[0]} · ${modeLabel()} · ${SETTINGS.diff === 'hard' ? 'Hard' : 'Normal'} rivals`;
}
function endIntro(skipped = false) { if (state !== 'intro') return; if (introStats) { introStats.endedAt = performance.now(); introStats.skipped = skipped; introStats.wallSec = (introStats.endedAt - introStats.startedAt) / 1000; } state = 'countdown'; cdT = 3.0; lastCount = -1; cineUI(false); chaseTarget(0, true, CC.pos, CC.look, CC.up); }
function skipFinishCine() { if (state === 'finished' && FIN.on && FIN.t < 3.4) { FIN.t = 3.4; return true; } return false; }
$('cineSkip').addEventListener('click', e => { e.stopPropagation(); if (state === 'intro') endIntro(true); else skipFinishCine(); });
$('cine').addEventListener('pointerdown', () => { if (state === 'intro') endIntro(true); else skipFinishCine(); });

/* ---------- M2 mobile: landscape-only (touch devices) ---------- */
// Portrait shows a "Rotate your phone" panel: no new race can start, an active race is paused
// and every held input is released. Returning to landscape does NOT auto-resume: the pause
// screen shows an explicit Resume button. On the Race tap we best-effort request fullscreen and
// screen.orientation.lock('landscape'); rejection/unsupported (e.g. iPhone Safari) falls back to
// manual rotation. No CSS-rotated canvas.
let touchRelease = () => {};
function releaseAllInputs() {rearViewHeld=false; for (const k in keys) keys[k] = 0; touchRelease(); mpPushKeys(true); }
const isPortrait = () => TOUCH && innerHeight > innerWidth;
let orientLock = { requested: false, fullscreen: null, lock: null };
function checkOrientation() {
  const por = isPortrait();
  document.body.classList.toggle('portrait', por);
  if (!por) return;
  releaseAllInputs();
  if ((state === 'race' || state === 'countdown') && !paused) { togglePause(); $('pauseNote').textContent = 'Paused: rotate to landscape, then tap Resume.'; }
}
async function requestLandscape() {
  orientLock.requested = true;
  try { const el = document.documentElement; if (el.requestFullscreen && !document.fullscreenElement) { orientLock.fullscreen = 'pending'; await el.requestFullscreen({ navigationUI: 'hide' }); orientLock.fullscreen = 'ok'; } else orientLock.fullscreen = 'unsupported'; } catch (e) { orientLock.fullscreen = 'rejected'; }
  try { if (screen.orientation && screen.orientation.lock) { orientLock.lock = 'pending'; await screen.orientation.lock('landscape'); orientLock.lock = 'ok'; } else orientLock.lock = 'unsupported'; } catch (e) { orientLock.lock = 'rejected'; }
}
$('resumeBtn').addEventListener('click', e => { e.preventDefault(); releaseAllInputs(); closeRaceMenu(); });
addEventListener('resize', checkOrientation);
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', checkOrientation);

/* ---------- M2 optional tilt steering (touch devices; Touch is the default) ---------- */
// Enabled only by an explicit tap (iOS DeviceOrientationEvent.requestPermission() is called from
// that tap; never on page load). Without that method we listen and require real non-null
// events within 1.5 s. Denied / unavailable / no events -> message + Touch steering. Relative
// tilt only (beta/gamma; no compass, no absolute orientation). Only the preference is stored;
// sensor data never leaves the device. Boost/Brake stay touch, auto-throttle unchanged.
const tilt = createTilt();
let tiltSample = null, tiltLive = false, tiltListening = false;
const onOrient = e => { if (e.beta != null && e.gamma != null) { tiltSample = { beta: e.beta, gamma: e.gamma }; tiltLive = true; } };
const screenAngle = () => (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
function tiltMsg(t) { $('tiltMsg').textContent = t; }
function useTouchSteering(msg) { SETTINGS.steer = 'touch'; if (tiltListening) { removeEventListener('deviceorientation', onOrient); tiltListening = false; } tiltLive = false; tilt.reset(); releaseAllInputs(); saveSettings(); if (msg) tiltMsg(msg); }
async function enableTilt() {   // must be called from a user tap
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return useTouchSteering('Tilt is not available on this device; using Touch steering.');
  if (typeof DOE.requestPermission === 'function') {
    let r = 'denied'; try { r = await DOE.requestPermission(); } catch (e) { r = 'error'; }
    if (r !== 'granted') return useTouchSteering('Motion access was not granted; using Touch steering.');
  }
  tiltLive = false; tiltSample = null;
  if (!tiltListening) { addEventListener('deviceorientation', onOrient); tiltListening = true; }
  tiltMsg('Checking tilt sensor…');
  await new Promise(r => setTimeout(r, 1500));
  if (!tiltLive) return useTouchSteering('No tilt sensor events were received; using Touch steering.');
  SETTINGS.steer = 'tilt'; tilt.recenter(tiltSample, screenAngle()); saveSettings();
  tiltMsg('Tilt on. Hold the phone level in landscape and tap Recenter if needed.');
}
function applyTilt() {   // called every frame
  if (SETTINGS.steer !== 'tilt' || !TOUCH) return;
  const racing = (state === 'race' || state === 'countdown') && !paused && !isPortrait() && $('pause').classList.contains('hide');
  if (!racing || !tiltLive) { if (tilt.steer !== 0) { tilt.reset(); keys.left = keys.right = 0; } return; }
  if (touchHeld.left || touchHeld.right) return;   // touch steer pads still win
  const v = tilt.update(tiltSample, screenAngle());
  keys.right = v > 0 ? v : 0; keys.left = v < 0 ? -v : 0;
}
let touchHeld = {};
$('tiltRecenter').addEventListener('click', () => { if (tiltSample) { tilt.recenter(tiltSample, screenAngle()); tiltMsg('Recentred.'); } else tiltMsg('Enable Tilt first.'); });
$('setSteer').addEventListener('click', e => { const b = e.target.closest('[data-steer]'); if (!b) return; if (b.dataset.steer === 'tilt') enableTilt(); else useTouchSteering('Touch steering.'); });

function requestWeaponFire() {
  if(state!=='race'||paused||!$('pause').classList.contains('hide')||!sim.weapons)return;
  if(MP.race){if(MP.net?.fireWeapon)MP.net.fireWeapon();return;}
  const result=sim.fireWeapon(player);if(!result.ok)cpFlash(result.error==='cold'?'WEAPONS COLD':result.error==='no-weapon'?'FIND A WEAPON BOX':'NOT READY');
}
$('fireWeapon').addEventListener('pointerdown',e=>{e.preventDefault();e.stopPropagation();requestWeaponFire();});
/* ---------- touch driving (coarse pointers only): auto-throttle, hold Brake to slow/drift, steer pads, Boost ---------- */
const TOUCH = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || new URLSearchParams(location.search).has('touch');
document.body.classList.toggle('touchmode', TOUCH);
if (TOUCH) $('cineSkip').textContent = 'Skip';   // no Enter key on phones
if (TOUCH) {
  const held = {}, presses = new Map();
  for (const b of document.querySelectorAll('#touch button')) {
    // brake also switches the auto-throttle in the SAME event (not at the next 50 ms timer tick, which a
    // slow render frame can delay): measured 2.2 s brake-to-server latency on a ~1 FPS host before this
    const thr = () => { if (k === 'down' && (state === 'race' || state === 'countdown') && player && !player.autopilot && !paused) keys.up = held.down ? 0 : 1; };
    const k = b.dataset.k; if (!presses.has(k)) presses.set(k,new Set());
    const updateHeld = () => { held[k]=presses.get(k).size?1:0; keys[k]=held[k]; thr(); };
    const on = e => { e.preventDefault(); if (!$('pause').classList.contains('hide')) return; presses.get(k).add(e.pointerId);updateHeld();b.classList.add('on');if(b.setPointerCapture)try{b.setPointerCapture(e.pointerId);}catch{}mpPushKeys(); };
    const off = e => { presses.get(k).delete(e.pointerId);updateHeld();b.classList.remove('on');mpPushKeys(e && e.type==='pointercancel'); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('lostpointercapture', off);
  }
  touchHeld = held;
  touchRelease = () => { tilt.reset(); for(const set of presses.values())set.clear(); for (const k in held) held[k] = 0; for (const b of document.querySelectorAll('#touch button')) b.classList.remove('on'); };
  setInterval(() => { const racing = state === 'race' || state === 'countdown'; document.body.classList.toggle('racing', racing); if (racing && !player.autopilot && !paused && $('pause').classList.contains('hide')) { keys.up = held.down ? 0 : 1; mpPushKeys(); } }, 50);
  // (M2 fix) no inline pointer-events here: #cine is interactive only while .on (CSS); the
  // general #cine pointerdown handler above already covers touch.
}

/* ---------- map switching: dispose the old world (road, collision frames, city, props) and build the new one ---------- */
function disposeWorld() {
  const geos = new Set(), mats = new Set(), texs = new Set();
  WORLD.traverse(o => {
    if (o.geometry) geos.add(o.geometry);
    if (o.material) for (const m of [].concat(o.material)) { mats.add(m); for (const k in m) { const v = m[k]; if (v && v.isTexture) texs.add(v); } if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u.value && u.value.isTexture) texs.add(u.value); }
  });
  for (const g of geos) g.dispose(); for (const m of mats) m.dispose(); for (const t of texs) if (t !== radialTex && t !== shadowTex) t.dispose();
  WORLD.clear();beatMats.length=0;
  DECKS.length = 0; bList.length = 0; hList.length = 0; exclusions.length = 0; holoAds.length = 0; flickerMats.length = 0; barrierMats.length = 0; adCanvases.length = 0;
  startLamps = []; searchlights = []; trafficLanes = []; GROUND_TILES = [];
  return { geometries: geos.size, materials: mats.size, textures: texs.size };
}
let mapBusy = false, lastDispose = null;
async function switchMap(key, persist = true, vr = variantMask, force=false) {
  if(key==='legacy')vr &=4;if(['casino','summit'].includes(key))vr=0;
  if (!MAPS[key] || (!force && key === MAPKEY && vr === variantMask) || mapBusy || state !== 'title') return;
  mapBusy = true; $('go').disabled = true; $('go').textContent = 'Building…'; renderMapSeg(key); await tick(); await tick();
  const t0 = performance.now();
  lastDispose = disposeWorld();
  variantMask=vr; loadTrackData(key); applyTheme(key);   // M8-ENV HOOK H13a
  planDecks(); buildRainShelter(); buildTrack(); planBillboards(); BOUNDS = buildCity(); buildProps(); HZV = createHazardVis({ WORLD, sim, radialTex }); WVIS = createWeaponVis({ WORLD, sim });
  for (const r of racers) { r.path = MAIN; r.emPrev = null; r.prevS = undefined; for (const t of r.trails) t.n = 0; }
  gridUp(); initHUD(); loadRecord(); hudCache = {};
  flyS = mod(SECSTART[Math.min(1, SECSTART.length - 1)] + 280, MAIN.L);
  for (const r of racers) updateVisual(r, 0.016);
  renderer.compile(scene, camera);
  if (persist) try { localStorage.setItem('nightgrid_v4_map', key);localStorage.setItem('nightgrid_v4_variant',String(variantMask)); } catch (e) { }
  lastDispose.ms = Math.round(performance.now() - t0);
  mapBusy = false; updateGarageUI();
}
function renderMapSeg(pending) {
  const cur = pending || MAPKEY;
  if($('variants'))$('variants').innerHTML='';
  $('maps').innerHTML = MAP_KEYS.map(k => { const M = MAPS[k]; return `<button class="${k === cur ? 'on' : ''}" data-map="${k}" role="radio" aria-checked="${k === cur}" title="${M.name} — ${M.sub} · ${M.laps} laps">${M.short}<small>${M.blurb}</small></button>`; }).join('');
}
$('variants').addEventListener('click',e=>{const b=e.target.closest('[data-variant]');if(b&&!MP.race&&!(MP.net?.room))switchMap(MAPKEY,true,variantMask^(+b.dataset.variant));});
$('maps').addEventListener('click', e => { const b = e.target.closest('[data-map]'); if (b) switchMap(b.dataset.map); });

/* ---------- boot ---------- */
async function setLoad(p, txt) { $('loadbar').firstElementChild.style.width = (p * 100) + '%'; $('loadtxt').textContent = txt; await tick(); }
async function boot() {
  performance.mark('ng:boot');
  await setLoad(0.04, 'SPINNING UP RENDERER');
  // Selected car requested first (gates the garage), rival cars requested concurrently right
  // after (gate "Race"). Every other model is fetched only when selected.
  // The selected car's request is issued first (fetch starts synchronously inside ensureAsset);
  // the rival cars are requested immediately after, concurrently (no sequential waterfall).
  const selLoad = ensureAsset(GAR.sel);
  selLoad.then(() => performance.mark('ng:selected-car'));
  ensureRaceAssets(GAR.sel).then(() => { performance.mark('ng:race-ready'); refreshRacerCars(); updateGarageUI(); });
  try { await Promise.race([Promise.all([document.fonts.load('900 64px Orbitron'), document.fonts.load('700 30px Rajdhani')]), new Promise(r => setTimeout(r, 2500))]); } catch (e) { }
  buildEnv(); await setLoad(0.12, 'MAGNETISING CIRCUIT');
  applyTheme(MAPKEY);   // M8-ENV HOOK H13b
  scene.add(WORLD); planDecks(); buildRainShelter(); buildTrack(); planBillboards(); await setLoad(0.3, 'RAISING THE CITY · OPENING THE SKY');
  BOUNDS = buildCity(); await setLoad(0.55, 'WIRING NEON');
  buildProps(); HZV = createHazardVis({ WORLD, sim, radialTex }); WVIS = createWeaponVis({ WORLD, sim }); buildGarage(); performance.mark('ng:world-built'); await setLoad(0.7, `DOWNLOADING ${CARS[GAR.sel].title} (REAL GLB)…`);
  await Promise.race([selLoad, new Promise(r => setTimeout(r, 60000))]);
  updateAssetUI();
  await setLoad(0.86, 'BUILDING FLEET');
  buildRacers(); initHUD(); resize();
  flyS = mod(SECSTART[1] + 280, MAIN.L);
  flyTarget(0, CC.pos, CC.look, CC.up); applyCam(CC.pos, CC.look, CC.up, 0, 0);
  for (const r of racers) updateVisual(r, 0.016);
  garageShow();
  await setLoad(0.94, 'COMPILING SHADERS');
  renderer.compile(scene, camera); renderer.compile(GAR.scene, GAR.cam);
  $('load').classList.add('done');
  const st = assetStatus(GAR.sel);
  await setLoad(1, st === 'ok' ? `${CARS[GAR.sel].title} ready` : st === 'failed' ? 'model failed · labelled fallback in use' : 'still downloading');
  state = 'title'; last = performance.now(); updateGarageUI(); $('go').focus({ preventScroll: true });
  performance.mark('ng:title');
  checkOrientation();
  if (SETTINGS.steer === 'tilt') { SETTINGS.steer = 'touch'; renderSettings(); tiltMsg('Tap Enable Tilt to turn tilt steering back on.'); }
}
/* ============================== M4 private-room multiplayer ============================== */
// The room server is authoritative. In a multiplayer race the render sim (`sim`) is NOT stepped:
// the local car comes from the client predictor (src/net/netcode.js, replayed on every server
// snapshot), remote cars from snapshot interpolation, drones from the predictor. Lap/finish events
// from prediction are presentation only; positions, laps and results shown come from the server.
// Single-player records are never offered from a multiplayer race (no record hooks are attached).
const BUILD = __NG_BUILD__;
const MP = { net: null, race: null, ui: null, results: null, preparing: false, autodrive: false, leaveArm: 0, lastErr: null };
const MP_T = {}; let mpRenderN = 0, mpLastRender = 0; const mpRenderGaps = [];
// Backend location: VITE_MP_API_BASE at build time (production: required, https, e.g. the workers.dev URL);
// dev/test without it: same origin (Vite proxy / local runtime). See src/net/mp-config.js.
const MPC = resolveMpConfig({ mode: import.meta.env.MODE, apiBase: import.meta.env.VITE_MP_API_BASE, pageUrl: location.href });
const mpApi = path => MPC.http + '/' + path;
const mpWsBase = () => MPC.ws;
const mpSimEvents = {
  weaponEvent:e=>sim.events.weaponEvent(e),
  earn: (t, c) => earnPopup(t, c), cp: cpFlash, sfx: (name, ...a) => { if (typeof AU[name] === 'function') AU[name](...a); },
  shake: x => { CC.shake += x; }, kick: x => { CC.kick += x; },
  flash: (t, c) => { if (t !== 'VICTORY' && t !== 'FINISH') flash(t, c); },   // finishing is announced from the server state
  wallHit: (r, vn, s, Rw) => onWallHit(vn, s, Rw), crash: () => sim.events.crash(player), respawn: () => sim.events.respawn(player),
  droneHit: () => sim.events.droneHit(player), sector: sec => sim.events.sector(sec), ...hazardEvents(() => player),
  pickup: () => { },   // predicted claim: no feedback until the server confirms it (mpPowerSnap)
  shieldPop: (r, what) => { if (mpPw() & PW_SHIELD) hazardEvents(() => player).shieldPop(r, what); }, racerReset: () => { }, lap: () => { }, playerFinish: () => { }, bump: () => { }
};
function disposeRacerVis(r) {
  if (r.ship) scene.remove(r.ship.root);
  for (const t of r.trails || []) { scene.remove(t.mesh); t.geo.dispose(); t.mat.dispose(); }
  r.ship = null; r.trails = null; r.carKey = null;
}
function swapRacers(build) {
  for (const r of racers) disposeRacerVis(r);
  const dv = drones.map(d => ({ root: d.root, beacon: d.beacon }));
  racers.length = 0; drones.length = 0; sim.player = null; sim.finishOrder = []; sim.phase = 'grid'; sim.time = 0; sim.raceStart = 0;
  build();
  drones.forEach((d, k) => Object.assign(d, dv[k] || makeDrone()));
  player = sim.player;
}
const seatLivery = st => st.kind === 'bot' ? RIVAL_LIV[st.pers] : PAINTS[st.paint || 0];
function mpSetupRacers(m) {
  swapRacers(() => sim.addSeats(m.seats.map(st => ({ id: st.id, kind: st.kind, name: st.name, pers: st.pers, css: seatLivery(st).neon, carMods: CARS[st.car] ? CARS[st.car].mods : null })), m.you));
  for (const r of racers) { r.wallLim = 1.2; r.seat = m.seats.find(s => s.id === r.id); if (r !== player) r.autopilot = true; }
  mpRefreshCars();
}
function mpRefreshCars() {
  for (const r of racers) {
    const st = r.seat; if (!st) continue;
    const want = st.car + ':' + (st.paint || 0) + ':' + assetStatus(st.car); if (r.carKey === want) continue;
    if (r.ship) scene.remove(r.ship.root);
    const liv = seatLivery(st); r.ship = buildCar(st.car, liv, 'race', r === player); scene.add(r.ship.root); r.carKey = want; r.emPrev = null;
    if (r !== player) { const tag = nameTag(st.name.toUpperCase().slice(0, 12), liv.neon); tag.position.y = 1.5; r.ship.root.add(tag); }
    else { $('carTag').className = ''; $('carTag').textContent = `${CARS[st.car].nick} · ROOM ${MP.net && MP.net.code || ''}`; }
    makeTrailsFor(r);
  }
}
function mpRestoreSP() {
  soloRaceRules=true;LAPS=sim.setRaceLaps(raceLapsSetting);
  swapRacers(() => sim.addRacers(soloRivals()));
  sim.setMode(driveMode); refreshRacerCars(); gridUp();
  for (const r of racers) updateVisual(r, 0);
}
// The connection + input timeline + prediction run in a Web Worker when available, so a slow render
// thread cannot starve the server of input. Fallback (no Worker, or ?mpworker=0): same code on this thread.
const MP_USE_WORKER = typeof Worker !== 'undefined' && !/[?&]mpworker=0\b/.test(location.search);
function mpNet(name) {
  if (!MP.net) MP.net = MP_USE_WORKER
    ? new WorkerNet({ wsUrl: mpWsBase(), build: BUILD, name, onEvent: mpOnEvent, onFx: mpFx })
    : new NetClient({ wsUrl: mpWsBase(), WebSocketImpl: WebSocket, now: () => performance.now(), build: BUILD, name, events: mpSimEvents, onEvent: mpOnEvent });
  MP.net.name = name; if (DEBUG && MP.autodrive && MP.net.isWorker) MP.net.autodrive(true); return MP.net;
}
// presentation events forwarded from the worker's predictor (plain data)
function mpFx(list) {
  for (const [name, ...a] of list) {
    if (name === 'wallHit') onWallHit(...a);
    else if (name === 'crash' || name === 'respawn' || name === 'droneHit') mpSimEvents[name]();
    else if (mpSimEvents[name]) mpSimEvents[name](...a);
  }
}
async function mpCreate(name) {
  if (MP.net && !MP.net.room && MP.net.status !== 'closed') return;   // already connecting to a room (lobby also disables the button)
  MP.ui.setError('');
  // bounded: a stuck request must not leave "Create room" spinning; errors say what failed
  const ac = new AbortController(), to = setTimeout(() => ac.abort(), 10000), t0 = performance.now();
  try {
    const r = await fetch(mpApi('api/rooms'), { method: 'POST', signal: ac.signal });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { MP.lastErr = j.error || ('http-' + r.status); console.warn('[NIGHTGRID] create room failed:', r.status, j.error || '', mpApi('api/rooms')); return MP.ui.setError(MP.lastErr); }
    mpJoin(j.code, name);
  } catch (e) {
    MP.lastErr = e.name === 'AbortError' ? 'server-timeout' : 'server-unreachable';
    console.warn('[NIGHTGRID] create room request failed after', Math.round(performance.now() - t0), 'ms:', e.name, e.message, '- backend', mpApi('api/rooms'), '(a CORS block also shows up as this)');
    MP.ui.setError(MP.lastErr);
  } finally { clearTimeout(to); }
}
function mpJoin(code, name) {
  let tok = null; try { tok = sessionStorage.getItem('ng_tok_' + code); } catch (e) { }
  if (!mpNet(name).connect(code, tok)) MP.ui.setError('bad-code');
}
function mpReset(errCode) {
  soloRaceRules=true;
  if (MP.race) mpEndRaceView();
  const net = MP.net; MP.net = null; MP.results = null; if (net && net.status !== 'closed') net.leave();
  document.body.classList.remove('mpinroom');
  try { const u = new URL(location.href); if (u.searchParams.has('room')) { u.searchParams.delete('room'); history.replaceState(null, '', u); } } catch (e) { }
  if (MP.ui) { MP.ui.render(); if (errCode) MP.ui.setError(errCode); }
  if(state==='title'&&LAPS!== (raceLapsSetting||MAPDEF.laps))switchMap(MAPKEY,true,variantMask,true);
  updateGarageUI();
}
function mpLeave() { mpReset(); }
function mpCarChanged() { const n = MP.net; if (n && n.room && n.room.phase === 'lobby') n.car(GAR.sel, GAR.paint); }
function mpOnEvent(type, m) {
  const net = MP.net; if (!net) return;
  switch (type) {
    case 'welcome':
      soloRaceRules=false;
      try { sessionStorage.setItem('ng_tok_' + net.code, m.token); } catch (e) { }
      document.body.classList.add('mpinroom'); mpCarChanged(); MP.ui.setError('');
      try { const u = new URL(location.href); u.searchParams.set('room', net.code); history.replaceState(null, '', u); } catch (e) { }
      if (m.notice) MP.ui.setNote('The room restarted, so the last race was cancelled.');
      break;
    case 'lobby': {
      const room = m.room;soloRaceRules=false;
      for (const s of room.seats) ensureAsset(s.car);   // preload every car in the room
      if (state === 'title' && room.phase === 'lobby' && (room.map !== MAPKEY || (room.vr||0)!==variantMask || LAPS!==MAPS[room.map].laps) && !mapBusy) switchMap(room.map, false, room.vr||0,true);   // preload the circuit
      if (room.phase === 'lobby' && MP.race && state !== 'countdown' && state !== 'race') { /* stay on results until the player taps back */ }
      MP.ui.render(); break;
    }
    case 'race': mpBeginRace(m); break;
    case 'snap': if (net.race && MP.race && !MP.preparing && m && m.k != null) { mpPresenter(net.race).push(m); mpPowerSnap(m); } break;   // not while the circuit may still be switching
    case 'results': MP.results = m; if (MP.race && state !== 'finished') mpLocalFinish(true); break;
    case 'error': MP.lastErr = m.error; if (m.fatal) mpReset(m.error); else MP.ui.setError(m.error); break;
    case 'roomClosed': MP.lastErr = 'room-closed:' + m.reason; mpReset('room-closed:' + m.reason); break;
    case 'closed': if (MP.net) mpReset(m.reason === 'connection-lost' ? 'connection-lost' : m.reason); break;
    case 'reconnecting': MP.ui.render(); break;
  }
}
// M8: positive pickup feedback in rooms only from SERVER-CONFIRMED own power flags (src/client/power-gate.js)
function mpPowerSnap(m) {
  const f = ownFlags(m, MP.net.you); if (f == null) return;
  const G = MP.race.pwGate || (MP.race.pwGate = createPowerGate());
  for (const k of G.snap(f)) hazardEvents(() => player).pickup(k);
}
const mpPw = () => (MP.race && MP.race.pwGate ? MP.race.pwGate.flags : 0);
async function mpBeginRace(m) {
  if (MP.race && MP.race.msg.seed === m.seed && MP.race.msg.countdownAt === m.countdownAt) { MP.race.msg = m; return; }   // reconnect into the same race
  if (MP.preparing) return; MP.preparing = true;
  try {
    if (state !== 'title') mpEndRaceView();
    while (mapBusy) await tick();
    if (m.map !== MAPKEY || (m.rules?.vr||0)!==variantMask) await switchMap(m.map, false,m.rules?.vr||0);
    for (const st of m.seats) ensureAsset(st.car);
    racePickupLayout(m.seed);soloRaceRules=false;LAPS=sim.setRaceLaps(0);mpSetupRacers(m); sim.setMode(m.mode); sim.weapons=!!m.rules?.weapons; sim.catchup=false;
    MP.race = { msg: m, startAt: m.countdownAt }; MP.results = null;
    // input sampling, prediction steps and sending run on their own 25 ms timer, not on render frames,
    // so a slow render frame does not decide when inputs leave (the render frame only reads state)
    clearInterval(MP.tick); MP.tick = setInterval(mpInputTick, 25);
    AU.init(); hudCache = {}; $('sector').textContent = `S1 · ${SECTORS[0].name}`; $('sector').style.color = SECTORS[0].css;
    MP.ui.show(false); $('title').classList.add('hide'); $('results').classList.add('hide'); $('pause').classList.add('hide'); $('hud').classList.add('on');
    document.body.classList.add('mprace'); paused = false; cineUI(false); FIN.on = false; FIN.t = 99; shownResults = false;
    for (const lm of startLamps) lm.color.setRGB(0.15, 0.02, 0.03);
    state = 'countdown'; cdT = 3; lastCount = -1; CC.shake = 0; boostAmt = 0;
    sim.pose(player); chaseTarget(0, true, CC.pos, CC.look, CC.up);
    for (const r of racers) updateVisual(r, 0);
    try { await renderer.compileAsync(scene, camera); } catch (e) { }
  } finally { MP.preparing = false; }
}
const MP_COPY = VIEW_FIELDS;
function mpFrame(wall, dt0, nowMs = performance.now()) {
  const net = MP.net, RC = net && net.race;
  if (!RC || MP.preparing) { update(0, dt0); return; }
  let V;
  if (net.isWorker) { net.setKeys(encodeFrame(keys)); V = RC.view; }
  else { if (DEBUG && MP.autodrive) Object.assign(keys, driveLine(RC.pred)); net.frame(keys); RC.pred.decay(dt0); V = net.view(); }
  const sn = net.serverNow();
  if (state === 'countdown') cdT = (MP.race.startAt - sn) / 1000 + dt0;
  if (!V) { update(0, dt0); return; }   // worker has not published a view yet (first frames)
  // local car <- predicted view (+ blended visual correction)
  const me = V.me, wasCr = player.crashed > 0;
  for (const k of MP_COPY) player[k] = me[k];
  player.path = me.br ? BR : MAIN;
  if (me.crashed > 0) { if (!wasCr && me.world) { player.world.set(me.world.x, me.world.y, me.world.z); player.crashVel = me.crashVel ? new V3(me.crashVel.x, me.crashVel.y, me.crashVel.z) : new V3(); player.crashSpin = me.crashSpin ? new V3(me.crashSpin.x, me.crashSpin.y, me.crashSpin.z) : new V3(); } player.crashed = me.crashed; }
  let presT = V.time;   // presentation sim time shared by the local car and remote cars this frame
  if (!(me.crashed > 0)) {   // own car: smoothed between worker views (60 Hz) for any display rate (src/client/present.js OwnSmoother)
    player.crashed = 0;
    const O = (RC.own || (RC.own = new OwnSmoother(MAIN.L))).frame(V, nowMs); presT = O.t;
    if (O.br === !!me.br) { let ds = O.s - me.s; if (!O.br) { if (ds > MAIN.L / 2) ds -= MAIN.L; if (ds < -MAIN.L / 2) ds += MAIN.L; } player.prog = me.prog + ds; }   // HUD rank at the same instant as remotes
    player.s = O.s; player.d = O.d; player.h = O.h; player.psi = O.psi; player.path = O.br ? BR : MAIN;
    sim.pose(player); player.world.x += O.corr.x; player.world.y += O.corr.y; player.world.z += O.corr.z;
  }
  sim.weapons=!!V.weapons; sim.weaponState.shots=(V.wx||[]).filter(p=>p.kind===1);sim.weaponState.mines=(V.wx||[]).filter(p=>p.kind===2);sim.weaponState.pulses=(V.wx||[]).filter(p=>p.kind===3);
  sim.time = V.time; sim.raceStart = V.raceStart; sim.phase = state === 'countdown' ? 'grid' : (me.finished ? 'finished' : 'race'); sim.bestLap = me.bestLap;
  // remote cars <- dead-reckoned into the local car's timeline with soft correction (src/client/present.js)
  const PR = mpPresenter(RC), ownStep = stepAt(presT, MP.race.msg);
  for (const r of racers) {
    if (r === player || !PR.sample(r.id, sn, MP_T, { ownStep })) continue;
    r.path = MP_T.path === PR.td.BR ? BR : MAIN; r.s = MP_T.s; r.d = MP_T.d; r.h = MP_T.h; r.psi = MP_T.psi; r.speed = MP_T.speed; r.va = MP_T.va; r.vd = MP_T.vd;
    r.shieldT = MP_T.pw & 1 ? 1 : 0; r.surgeT = MP_T.pw & 2 ? 1 : 0;
    r.lap = MP_T.lap; r.prog = MP_T.prog; r.boost = MP_T.boost; r.finished = MP_T.finished; r.steer = MP_T.steer; r.drift = MP_T.drift; r.thr = MP_T.thr; r.rollAI = MP_T.rollNet; r.autopilot = true;
    if (MP_T.netCrashed) { if (!(r.crashed > 0)) { sim.pose(r); r.crashed = 1.7; r.crashVel = r.F.clone().multiplyScalar(r.speed * 0.8).addScaledVector(r.Uw, 6); r.crashSpin = new V3(R(-4, 4), R(-6, 6), R(-4, 4)); } }
    else { r.crashed = 0; sim.pose(r); }
  }
  if (V.pk) applyPads(sim.pads, V.pk, V.time);   // pad availability: server state (+ own-car prediction)
  V.drones.forEach((pd, k) => { const d = drones[k]; if (!d) return; d.s = pd[0]; d.d = pd[1]; d.h = pd[2]; d.world.set(pd[3], pd[4], pd[5]); d.fi = pd[6]; });
  const fo = RC.last ? RC.last.fo : V.fo; sim.finishOrder = fo.map(id => racers.find(r => r.id === id)).filter(Boolean);
  if (state === 'race' && me.finished) mpLocalFinish(false);
  else if (state === 'finished' && MP.finAnn && !MP.finAnn.done) { const a = finishAnnounce(fo, MP.net.you); if (a) { MP.finAnn.done = true; if (a === 'VICTORY') flash('VICTORY', '#ffc23f'); } }
  gameTime = sim.time;
  update(dt0, dt0);
  mpStatus(sn);
}
// one presenter per race; fed from every authoritative snapshot (worker or main-thread client)
function mpPresenter(RC) { if (!RC.pres) RC.pres = new RemotePresenter(sim.track); return RC.pres; }
function mpInputTick() {
  const net = MP.net; if (!MP.race || MP.preparing || !net || !net.race) return;
  if (net.isWorker) { net.setKeys(encodeFrame(keys)); return; }   // the worker steps on its own timer
  if (DEBUG && MP.autodrive) Object.assign(keys, driveLine(net.race.pred));
  net.frame(keys);
}
function mpLocalFinish(byServer) {
  state = 'finished'; finishT = 0; orbitA = 0; FIN.on = CINE.on && !byServer; FIN.t = byServer ? 99 : 0;
  const f = frameAt(MAIN, raceS(player.path, player.s) + 34, _fci); FIN.pos.copy(f.P).addScaledVector(f.R, MAIN.WR[f.i] - 2.2).addScaledVector(f.U, 3.4); FIN.up.copy(f.U);
  // the server's finish order lags our prediction (lead + half RTT), so the place is not known yet here:
  // announce FINISH now, VICTORY only once the server lists us first (mpFrame -> finishAnnounce)
  MP.finAnn = byServer ? null : { done: false };
  if (!byServer) { flash('FINISH', '#00f0ff'); AU.chime(); }
  else { flash('RACE OVER', '#8a5cff'); shownResults = true; $('results').classList.remove('hide'); }
}
function mpShowResults() {
  const res = MP.results;
  $('results').querySelector('.kicker').textContent = res ? 'ROOM RESULTS · SERVER' : 'FINISHED · WAITING FOR OTHERS';
  let h = '<tr><th>POS</th><th>PILOT</th><th>BEST LAP</th><th>TIME</th></tr>', myPos = '';
  if (res) {
    for (const o of res.order) {
      const liv = o.kind === 'bot' ? RIVAL_LIV[o.name] : PAINTS[o.paint || 0], col = liv ? liv.neon : '#0ff';
      if (o.id === MP.net.you) myPos = o.dnf ? 'DNF' : 'P' + o.pos;
      h += `<tr class="${o.id === MP.net.you ? 'me' : ''}"><td>P${o.pos}</td><td><span class="sw" style="background:${col};box-shadow:0 0 8px ${col}"></span>${escHtml(o.name)}${o.kind === 'bot' ? ' <small>BOT</small>' : ''}</td><td>${fmt(o.best)}</td><td>${o.dnf ? 'DNF' : fmt(o.time)}</td></tr>`;
    }
  } else {
    const ranks = sim.ranks(); myPos = 'P' + (ranks.indexOf(player) + 1);
    ranks.forEach((r, k) => { h += `<tr class="${r === player ? 'me' : ''}"><td>P${k + 1}</td><td><span class="sw" style="background:${r.css};box-shadow:0 0 8px ${r.css}"></span>${escHtml(r.name)}</td><td>—</td><td>${r.finished ? 'FIN' : 'LAP ' + Math.min(r.lap + 1, LAPS) + '…'}</td></tr>`; });
  }
  const el = $('resPos'); el.textContent = myPos; el.dataset.t = myPos;
  $('resTable').innerHTML = h;
  $('resLaps').innerHTML = player.lapTimes.map((t, k) => `LAP ${k + 1} ${fmt(t)}`).join(' &nbsp;·&nbsp; ') + '<br><span style="color:rgba(232,246,255,.5)">Multiplayer races never change single-player records.</span>';
  $('toGarage').textContent = 'BACK TO LOBBY';
  $('nextMap').hidden = true;
}
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function mpEndRaceView() {
  clearInterval(MP.tick); MP.tick = null; MP.race = null; document.body.classList.remove('mprace'); cineUI(false); FIN.on = false; FIN.t = 99;
  $('results').classList.add('hide'); $('hud').classList.remove('on'); $('crashv').classList.remove('on'); $('toGarage').textContent = 'BACK TO GARAGE';
  $('results').querySelector('.kicker').textContent = 'RACE COMPLETE';
  releaseAllInputs(); mpRestoreSP();
  $('title').classList.remove('hide'); shownResults = false; state = 'title'; garageShow();
  for (const lm of startLamps) lm.color.setRGB(0.15, 0.02, 0.03);
  if (MP.net && MP.net.room) MP.ui.show(true);
}
let mpStatT = 0;
function mpStatus(sn) {
  if (performance.now() - mpStatT < 500) return; mpStatT = performance.now();
  const n = MP.net; if (!n) return;
  $('mpStat').textContent = n.status === 'reconnecting' ? 'Reconnecting…' : `Room ${n.code} · ${Math.round(n.clock.rtt)} ms`;
}
$('mpLeave').addEventListener('click', () => {
  const b = $('mpLeave');
  if (performance.now() - MP.leaveArm > 3000) { MP.leaveArm = performance.now(); b.textContent = 'Tap again to leave'; setTimeout(() => { b.textContent = 'Leave race'; }, 3000); return; }
  b.textContent = 'Leave race'; mpLeave();
});
MP.ui = createLobbyUI({ el: $('mpPanel'), getNet: () => MP.net, onCreate: mpCreate, onJoin: async (c, name) => mpJoin(c, name), onLeave: mpLeave,
  onOpenChange: on => { GAR.fit = null; if (!on) $('mpBtn').focus({ preventScroll: true }); } });
$('mpBtn').addEventListener('click', () => { $('mpBtn').blur(); MP.ui.show(!MP.ui.open); });
{ const q = new URLSearchParams(location.search).get('room'); if (q) { MP.ui.setCode(q); MP.ui.show(true); } }
if (import.meta.env.VITE_MP === '0' || !MPC.enabled) { $('mpBtn').remove(); if (!MPC.enabled) console.info('[NIGHTGRID] multiplayer disabled:', MPC.reason); }

resize();
// ---------- debug / QA hooks: compiled into dev and `--mode test` builds only ----------
// In the production build DEBUG is the constant `false`, so this block (and the QA panel
// button) is removed by the minifier; `window.NG_DEBUG` / `window.__ng` do not exist.
let manualClock = false;
if (DEBUG) {
  const touch = () => { sim.debugTouched = true; };   // any direct state access taints laps for records
  const clockInfo = () => ({ simTime: +clock.simTime.toFixed(4), wallTime: +clock.wallTime.toFixed(4), steps: clock.steps, droppedMs: Math.round(clock.droppedMs), stalls: clock.stalls, lastStall, fps: +lastFps.toFixed(1), minFps: isFinite(fpsMeter.minFps) ? +fpsMeter.minFps.toFixed(1) : null, step: SIM_DT, raceTime: +sim.raceTime().toFixed(4) });
  window.NG_DEBUG = {
    get assets() { return Object.fromEntries(CAR_KEYS.map(k => { const a = ASSETS[k] || {}; return [k, { status: a.status || 'none', source: a.source, url: a.url, bytes: a.bytes, ms: a.ms, tris: a.tris, meshes: a.meshes, materials: a.materials, error: a.error, attempts: a.attempts }]; })); },
    get roster() { return CAR_KEYS.slice(); },
    get selectedCar() { return { key: GAR.sel, paint: PAINTS[GAR.paint].name, raceBody: player && player.ship ? (player.ship.fallback ? 'PROCEDURAL FALLBACK' : 'glTF:' + player.ship.key) : null }; },
    get fleet() { return racers.map(r => ({ name: r.name, body: !r.ship ? null : r.ship.fallback ? 'PROCEDURAL FALLBACK (' + r.ship.key + ')' : 'glTF:' + r.ship.key, tris: r.ship ? r.ship.tris : 0, wheels: r.ship ? (r.ship.wheels || []).length : 0, emitters: r.ship ? (r.ship.emitters || []).length : 0 })); },
    get speedFx() { return { kmh: player ? Math.round(player.speed * 3.6) : 0, boostAmt: +boostAmt.toFixed(2), blur: +MB.blur.toFixed(4), fov: +camera.fov.toFixed(1), setting: SETTINGS }; },
    get boost() { return player ? { meter: +player.meter.toFixed(3), active: !!player.boost, qaInfinite: !!player.qaBoost, exhaustParticlesLive: exLive } : null; },
    get state() { return state; },
    get rearView(){return rearViewHeld;},get paused() { return paused; },
    get map() { return { key: MAPKEY, name: MAPDEF.name, lengthM: Math.round(MAIN.L), laps: LAPS, sectors: SECTORS.map(s => s.name), record: isFinite(recordLap) ? recordLap : null, worldMeshes: WORLD.children.length, lastSwitch: lastDispose }; },
    get music() { return MUSIC.status; },
    get beatLights(){return{beat:MUSIC.beat,gains:beatMats.map(b=>b.mat.color.r/(b.base.r||1)),barriers:barrierMats.map(m=>m.uniforms.uBeat.value)};},get engineVoice(){return AU.lastVoice;},get audioMix(){return {ambient:SETTINGS.ambient,engineIdle:SETTINGS.engineIdle,hum:AU.humG?.gain.value,rain:AU.rainG?.gain.value,engine:AU.eg?.gain.value,whine:AU.wg?.gain.value};},
    get render() { return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, fps: +lastFps.toFixed(1), pixelRatio: PR, programs: renderer.info.programs.length, bloom: bloom.enabled, quality: qualityMode, fxFallbacks }; },
    get clock() { return clockInfo(); },
    get intro() { return introStats ? Object.assign({ len: CINE.len }, introStats) : null; },
    get precompile() { return lastPrecompile; },
    get records() { return { storage: 'memory (debug/test build)', current: isFinite(recordLap) ? recordLap : null, lastOffer: lastRecordOffer, rejected: records.rejected.slice() }; },
    get results() { return { lapTimes: player ? player.lapTimes.slice() : [], lapValid: player ? player.lapValid.slice() : [], finishTime: player ? player.finishTime : 0, order: sim.finishOrder.map(r => r.name), visible: !$('results').classList.contains('hide') }; },
    get ground() { const cl = CLEARANCE; if (!cl) return null; const w = worstClearance(TD, (x, z) => groundHeightAt(cl, x, z)); const fp = []; for (const b of bList) if (b.y0 === 0) { let hit = false; for (let u = -0.5; u <= 0.5 && !hit; u += 0.125) for (let v = -0.5; v <= 0.5 && !hit; v += 0.125) if (groundHeightAt(cl, b.x + u * b.w, b.z + v * b.d) < GROUND_Y - 1e-4) hit = true; if (hit) fp.push([Math.round(b.x), Math.round(b.z)]); } return { worst: w, pitBlocks: cl.blocks.length, buildingsOverPits: fp.length, buildingsChecked: bList.filter(b => b.y0 === 0).length }; },
    get drive() { return { mode: driveMode, simMode: sim.mode, pace: sim.pace && { normalKmh: +(sim.pace.normal * 3.6).toFixed(1), boostKmh: +(sim.pace.boost * 3.6).toFixed(1) }, recordKey: recordKey(driveMode, MAPKEY, variantMask), recordLabel: $('record').textContent }; },
    get rain() { return { shelterOn: rainMat.uniforms.uShelterOn.value, cells: SHELTER_MAP ? SHELTER_MAP.nx * SHELTER_MAP.nz : 0, camSheltered: SHELTER_MAP ? camera.position.y < shelterTop(SHELTER_MAP, camera.position.x, camera.position.z) - 0.15 : null }; },
    get tilt() { return { pref: SETTINGS.steer, live: tiltLive, listening: tiltListening, steer: tilt.steer, neutral: tilt.neutral, msg: $('tiltMsg').textContent }; },
    get mobile() { return { touch: TOUCH, portrait: isPortrait(), orientLock, keys: { ...keys } }; },
    get mp() {
      const n = MP.net, R = n && n.race, W = n && n.isWorker, st = W ? n.st : null;
      const q = (a, p) => { if (!a || !a.length) return null; const b = a.slice(-3000).sort((x, y) => x - y); return Math.round(b[Math.floor(b.length * p)]); };
      const corr = W ? (st && st.pstats ? st.pstats.corrections : []) : (R ? R.pred.stats.corrections : []);
      const cs = corr.slice(W ? 0 : 10).sort((x, y) => x - y);
      return { worker: !!W, inRoom: !!(n && n.room), code: n && n.code, you: n && n.you, status: n && n.status, room: n && n.room, race: !!MP.race, state, lastErr: MP.lastErr, results: MP.results && MP.results.order.map(o => [o.pos, o.id, o.time, o.dnf]),
        renderGaps: { p50: q(mpRenderGaps, .5), p95: q(mpRenderGaps, .95), over250ms: mpRenderGaps.filter(g => g > 250).length, over1s: mpRenderGaps.filter(g => g > 1000).length, frames: mpRenderGaps.length },
        net: W ? (st ? { loop: st.loop, ...st.netStats } : null) : (n ? { frameGapP50: q(n.stats.frameGaps, .5), frameGapP95: q(n.stats.frameGaps, .95), behindMax: n.stats.behindMax, resyncSteps: n.stats.resyncSteps, aheadRejections: (n.stats.ahead || []).slice(-3) } : null),
        rtt: n ? +(n.clock.rtt || 0).toFixed(1) : null, lead: n && n.lead, pending: W ? (st && st.pending) : (R ? R.pred.pending : null), mispredictP95: cs.length ? cs[Math.floor(cs.length * 0.95)] : null,
        hard: W ? (st && st.pstats ? st.pstats.hard : 0) : (R ? R.pred.stats.hard : 0),
        me: player ? { lap: player.lap, prog: +player.prog.toFixed(1), finished: player.finished, speed: +player.speed.toFixed(1) } : null, racers: racers.map(r => ({ id: r.id, name: r.name, lap: r.lap, prog: +r.prog.toFixed(1), body: r.ship ? (r.ship.fallback ? 'FALLBACK' : 'glTF:' + r.ship.key) : null })), recordsOffered: records.rejected.length + (lastRecordOffer ? 1 : 0) };
    },
    get timings() { return Object.fromEntries(performance.getEntriesByType('mark').filter(m => m.name.startsWith('ng:')).map(m => [m.name, Math.round(m.startTime)])); },
    qa: { open: qaOpen, garageNext: qaGarageNext, boostDemo: () => { touch(); qaBoostDemo(false); }, invertedDemo: () => { touch(); qaBoostDemo(true); }, exit: toGarage, select: (k, p) => { if (p != null) GAR.paint = p; selectCar(k); } }
  };
  window.__ng = { auditBuildings(){const hits=[];for(const [label,list]of[['ground',bList],['hanging',hList]])for(let k=0;k<list.length;k++){const b=list[k];for(const path of[MAIN,...(HASBR?[BR]:[])]){let hit=false;for(let i=0;i<path.N&&!hit;i+=2){const w=path===BR?WB:Math.max(path.WL[i],path.WR[i]);for(const d of[-w,0,w]){const p=path.P[i],u=path.U[i],r=path.R[i],x=p.x+r.x*d,y=p.y+r.y*d,z=p.z+r.z*d;if(Math.abs(x-b.x)<b.w/2+1&&Math.abs(z-b.z)<b.d/2+1&&y>b.y0-2&&y<b.y0+b.h+2){hits.push({label,k,s:i*path.ds,branch:path===BR,x:b.x,z:b.z,y0:b.y0,h:b.h});hit=true;break;}}}if(hit)break;}}return hits;}, GAR, simCore: sim, records, rain, rainMat, shelterAt: (x, z) => (SHELTER_MAP ? shelterTop(SHELTER_MAP, x, z) : null), get state() { return state; }, get player() { touch(); return player; }, racers, drones, camera, scene, renderer, get fps() { return lastFps; }, keys, get MAIN() { return MAIN; }, get BR() { return BR; }, get SAm() { return SAm; }, get SBm() { return SBm; }, get map() { return MAPKEY; }, switchMap, get lastDispose() { return lastDispose; }, get worldChildren() { return WORLD.children.length; },
    // deterministic stepping for tests: n frames of 1/60 s (2 fixed steps each)
    sim(sec) { touch(); RDT = 0; const n = Math.round(sec * 60); for (let i = 0; i < n; i++) { sim.step(SIM_DT); sim.step(SIM_DT); gameTime = sim.time; update(1 / 60, 1 / 60); } },
    // manual wall clock: drive the real frame path with synthetic frame gaps (low FPS / stalls)
    manualClock(on) { manualClock = !!on; last = performance.now(); },
    advance(ms, render = false) { const now = last + ms; advanceFrame(now, render); return clockInfo(); },
    render() { renderNow(); }, start() { startRace(); },
    // test builds: measure render cost for render-scale / bloom variants (restores the original afterwards)
    gfxProbe(n = 6) {
      const pr0 = PR, b0 = bloom.enabled, out = {};
      const time = () => { renderNow(); const t = performance.now(); for (let i = 0; i < n; i++) renderNow(); return +((performance.now() - t) / n).toFixed(1); };
      for (const [k, pr, bl] of [['pr' + pr0 + '+bloom', pr0, true], ['pr' + pr0 + '-bloom', pr0, false], ['pr0.5+bloom', 0.5, true], ['pr0.5-bloom', 0.5, false], ['pr0.35-bloom', 0.35, false]]) {
        renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize(); bloom.enabled = bl; out[k] = time();
      }
      renderer.setPixelRatio(pr0); composer.setPixelRatio(pr0); resize(); bloom.enabled = b0;
      return { ...out, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, w: innerWidth, h: innerHeight };
    },
    gfxSet({ pr, bloom: bl, hideWorld, hideCars } = {}) {   // test builds only: render-cost experiments
      if (pr != null) { PR = pr; renderer.setPixelRatio(pr); composer.setPixelRatio(pr); resize(); }
      if (bl != null) bloom.enabled = bl;
      if (hideWorld != null) WORLD.visible = !hideWorld;
      if (hideCars != null) for (const r of racers) if (r.ship) r.ship.root.visible = !hideCars;
      return { pr: PR, bloom: bloom.enabled };
    },
    triBreakdown() {   // test builds: triangles per top-level scene child (visible meshes only), largest first
      const out = [];
      for (const c of scene.children) { let t = 0, m = 0; c.traverseVisible(o => { if (o.isMesh && o.geometry) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; t += n * (o.isInstancedMesh ? o.count : 1); m++; } }); if (t) out.push([c.name || c.type, Math.round(t), m]); }
      return out.sort((a, b) => b[1] - a[1]).slice(0, 15);
    },
    worldMeshes() {   // test builds: WORLD meshes by triangles with bounding radius
      const w = scene.children.find(c => c.name === 'WORLD'), out = [];
      w.traverseVisible(o => { if (o.isMesh) { const g = o.geometry; if (!g.boundingSphere) g.computeBoundingSphere(); out.push([o.name || (o.material && o.material.type) || '?', Math.round((g.index ? g.index.count : g.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1)), Math.round(g.boundingSphere.radius), o.isInstancedMesh ? o.count : 0, o.frustumCulled]); } });
      return { fog: scene.fog ? [scene.fog.near, scene.fog.far, scene.fog.density] : null, far: camera.far, top: out.sort((a, b) => b[1] - a[1]).slice(0, 14) };
    },
    mpAutodrive(on) { MP.autodrive = !!on; if (MP.net && MP.net.isWorker) MP.net.autodrive(on); }, mpUI: () => MP.ui };
  $('qaBtn').addEventListener('click', () => { $('qaBtn').blur(); qaOpen(); });
} else {
  $('qaBtn').remove();   // the QA panel markup stays (hidden, never openable): garage UI writes diagnostics into it
}
requestAnimationFrame(frame);
boot().catch(e => { const el = $('err'); el.style.display = 'block'; el.textContent = 'Boot error: ' + e.message; console.error(e); });

