// M8 environment themes (client-only, visual). One theme per map key; pure data + tiny helpers.
// Everything here is cosmetic: no core/sim/net input reads any of it. Colours are linear-ish THREE values
// (bloom picks up anything > ~1). Fog DENSITY is deliberately NOT themed: several shaders in game.js read
// the global FOGD uniform, and visibility at speed must stay identical across maps.
import * as THREE from 'three';
const C = (r, g, b) => new THREE.Color(r, g, b);
const H = hex => new THREE.Color(hex);

export const THEMES = {
  // Velocity: elevated night city, cyan / violet. Tall slender towers, setback crowns, halo-ring landmarks.
  velocity: {
    key: 'velocity', label: 'NEON HEIGHTS',
    fog: H(0x141a30),
    sky: { top: C(0.002, 0.004, 0.02), mid: C(0.012, 0.012, 0.06), hor: C(0.03, 0.03, 0.12), below: C(0.02, 0.015, 0.06),
      glowA: C(0.12, 0.10, 0.42), glowAy: 0.02, glowAk: 22, glowB: C(0.0, 0.22, 0.30), glowBy: 0.07, glowBk: 10, sun: null },
    hemiSky: H(0x5a6aa8), hemiGround: H(0x12142a), hemiI: 0.5, moon: H(0x8aa4ff), moonI: 0.36,
    building: { base: [0.03, 0.035, 0.07, 0.05, 0.055, 0.11], heightMul: 1.0, nearCap: 0 },
    // window palette: three colours + cumulative split, density bias, cell size (m)
    windows: { a: C(0.45, 0.72, 1.0), b: C(0.2, 0.85, 1.0), c: C(0.6, 0.38, 1.0), split: [0.42, 0.74], dens: 0.9, cell: [1.8, 3.2], intensity: 0.85 },
    strips: [H(0x00f0ff), H(0x8a5cff), H(0x00f0ff), H(0x5a7bff), H(0xff2bd6)],
    ground: { color: 0x07070f, grid1: 'rgba(0,240,255,0.35)', grid2: 'rgba(138,92,255,0.22)', emissive: 0.5, roughness: 0.32, metalness: 0.6 },
    rain: C(0.5, 0.75, 1.0), rainA: 0.75,
    skyline: 'heights',
    edge: { kind: 'fins', a: C(0.0, 2.4, 3.0), b: C(1.3, 0.6, 3.2), step: 18 },
    taxi: { paint: C(0.95, 0.72, 0.12), glow: C(1.4, 0.75, 0.12) }
  },
  // Kage: warm harbour dusk, amber / teal industrial waterfront. Low long warehouses with sawtooth roofs,
  // gantry cranes and container stacks; dusk sky with a low sun; glossy teal "harbour" ground.
  technical: {
    key: 'technical', label: 'KAGE HARBOUR',
    fog: H(0x2a2230),
    sky: { top: C(0.012, 0.03, 0.06), mid: C(0.07, 0.06, 0.09), hor: C(0.34, 0.15, 0.06), below: C(0.03, 0.04, 0.05),
      glowA: C(0.9, 0.36, 0.08), glowAy: 0.01, glowAk: 14, glowB: C(0.0, 0.18, 0.2), glowBy: 0.16, glowBk: 6, sun: { dir: [0.62, 0.05, -0.78], col: C(2.4, 1.0, 0.3), size: 0.9965 } },
    hemiSky: H(0x9a7a6a), hemiGround: H(0x10242a), hemiI: 0.62, moon: H(0xffb070), moonI: 0.55,
    building: { base: [0.05, 0.04, 0.035, 0.09, 0.07, 0.06], heightMul: 0.62, nearCap: 30 },
    windows: { a: C(1.0, 0.6, 0.22), b: C(1.0, 0.8, 0.45), c: C(0.2, 0.85, 0.78), split: [0.55, 0.85], dens: 0.62, cell: [2.0, 2.9], intensity: 0.8 },
    strips: [H(0xffa330), H(0x2ad6c0), H(0xffa330), H(0xff6a2a), H(0x2ad6c0)],
    ground: { color: 0x061a1e, grid1: 'rgba(255,170,70,0.22)', grid2: 'rgba(40,214,192,0.18)', emissive: 0.4, roughness: 0.16, metalness: 0.75 },
    rain: C(1.0, 0.75, 0.5), rainA: 0.3,
    skyline: 'harbour',
    edge: { kind: 'bollards', a: C(3.2, 1.5, 0.2), b: C(0.2, 2.2, 2.0), step: 12 },
    taxi: { paint: C(0.95, 0.72, 0.12), glow: C(1.4, 0.75, 0.12) }
  },
  // Legacy: magenta rainy city. Same city kit as before with a magenta/rose palette, antennas and heavier rain.
  legacy: {
    key: 'legacy', label: 'NEON RAIN',
    fog: H(0x24132a),
    sky: { top: C(0.006, 0.002, 0.012), mid: C(0.04, 0.008, 0.045), hor: C(0.1, 0.015, 0.09), below: C(0.04, 0.01, 0.05),
      glowA: C(0.45, 0.05, 0.3), glowAy: 0.015, glowAk: 24, glowB: C(0.1, 0.02, 0.18), glowBy: 0.08, glowBk: 9, sun: null },
    hemiSky: H(0x7a5a8a), hemiGround: H(0x1a1020), hemiI: 0.5, moon: H(0xc08aff), moonI: 0.32,
    building: { base: [0.04, 0.025, 0.05, 0.08, 0.05, 0.09], heightMul: 1.0, nearCap: 0 },
    windows: { a: C(1.0, 0.45, 0.75), b: C(1.0, 0.7, 0.45), c: C(0.45, 0.6, 1.0), split: [0.5, 0.82], dens: 1.0, cell: [2.5, 3.4], intensity: 1.0 },
    strips: [H(0xff2bd6), H(0xff2a4a), H(0xff2bd6), H(0x8a5cff), H(0x00f0ff)],
    ground: { color: 0x0a060e, grid1: 'rgba(255,43,214,0.3)', grid2: 'rgba(0,240,255,0.15)', emissive: 0.5, roughness: 0.22, metalness: 0.7 },
    rain: C(0.85, 0.6, 1.0), rainA: 1.15,
    skyline: 'rain',
    edge: { kind: 'posts', a: C(3.2, 0.4, 2.4), b: C(0.4, 1.6, 3.2), step: 16 },
    taxi: { paint: C(0.95, 0.72, 0.12), glow: C(1.4, 0.75, 0.12) }
  }
};
// New circuits use the same fog density and renderer budget as the original maps.
THEMES.casino={...THEMES.legacy,key:'casino',label:'CASINO STRIP',fog:H(0x271a18),sky:{...THEMES.legacy.sky,glowA:C(.55,.20,.05),glowB:C(.30,.02,.04)},windows:{...THEMES.legacy.windows,a:C(1,.72,.3),b:C(1,.28,.20),c:C(1,.90,.65),intensity:1.1},strips:[H(0xffc04a),H(0xff4a49),H(0xffd67c),H(0xff536e)],edge:{kind:'posts',a:C(3.2,1.8,.35),b:C(3.0,.3,.45),step:14},rain:C(1,.75,.45),rainA:.35,skyline:'casino',taxi:{paint:C(.10,.025,.035),glow:C(2.8,1.5,.25)}};
THEMES.summit={...THEMES.velocity,key:'summit',label:'ARCOLOGY SUMMIT',fog:H(0x192235),sky:{...THEMES.velocity.sky,top:C(.005,.012,.03),hor:C(.08,.12,.20),glowA:C(.10,.18,.35)},windows:{...THEMES.velocity.windows,a:C(.55,.80,1),b:C(.80,.92,1),c:C(.8,.14,.22),intensity:.8},strips:[H(0xa4ddff),H(0xb8e9ff),H(0xff6c82),H(0x89a0ff)],edge:{kind:'bollards',a:C(1.8,2.5,3.1),b:C(2.8,.3,.4),step:12},rain:C(.8,.9,1),rainA:.35,skyline:'summit',taxi:{paint:C(.32,.40,.44),glow:C(.6,2,2.6)}};
THEMES.drift={...THEMES.technical,key:'drift',label:'SHINRAI DRIFTWAY',fog:H(0x101e29),sky:{...THEMES.technical.sky,sun:null,glowA:C(.1,.24,.19),glowB:C(.22,.08,.30)},windows:{...THEMES.technical.windows,a:C(.25,1,.65),b:C(.5,.35,1),c:C(.8,.65,1)},strips:[H(0x60ffac),H(0xab80ff),H(0x48e4f0),H(0xff79ce)],edge:{kind:'posts',a:C(.4,2.7,1.3),b:C(1.6,.6,2.8),step:12}};
export function themeFor(mapKey, vr=0) { const base=THEMES[mapKey]||THEMES.velocity; if(!(vr&4))return base; return {...base,label:base.label+' · NIGHT',fog:base.fog.clone().multiplyScalar(.65),sky:{...base.sky,top:base.sky.top.clone().multiplyScalar(.3),mid:base.sky.mid.clone().multiplyScalar(.35),hor:base.sky.hor.clone().multiplyScalar(.25),sun:null},hemiI:base.hemiI*.65,moonI:base.moonI*.8,windows:{...base.windows,intensity:base.windows.intensity*1.25}}; }

// REPLACES themes.js from the line "// Sky dome material driven by the theme (replaces the hard-coded night
// gradient; same dome mesh)." through the closing "}" of makeSkyMaterial. Signature unchanged: makeSkyMaterial(th).
// Existing uniform names are kept (uFX, uRetro, uTop ... uSunSize). New: uStars, uMoonDir, uMoonCol.
 
// R4 per-map star field: [fraction of sky cells holding a star, brightness gain]. Dusk / rain maps are sparser.
const STARS = { velocity: [0.07, 1.0], technical: [0.035, 0.55], legacy: [0.045, 0.8], casino: [0.05, 0.85], summit: [0.1, 1.15], drift: [0.075, 1.0] };
const MOON_DIR = new THREE.Vector3(-0.55, 0.22, -0.8).normalize();
 
// Sky dome material driven by the theme (same dome mesh).
// R4: the view direction is world-space (modelMatrix, cameraPosition), so the horizon follows world up whatever
// the dome's transform or camera roll is. uFX = 0 (Low-FX) keeps only the gradient, glows and horizon line.
export function makeSkyMaterial(th) {
  const s = th.sky, sun = s.sun, st = STARS[th.key] || STARS.velocity;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uFX: { value: 1 }, uRetro: { value: new THREE.Color(th.key === 'casino' ? 0.7 : 0.5, 0.12, 0.6) },
      uTop: { value: s.top }, uMid: { value: s.mid }, uHor: { value: s.hor }, uBelow: { value: s.below },
      uGA: { value: s.glowA }, uGAy: { value: s.glowAy }, uGAk: { value: s.glowAk }, uGB: { value: s.glowB }, uGBy: { value: s.glowBy }, uGBk: { value: s.glowBk },
      uSunOn: { value: sun ? 1 : 0 }, uSunDir: { value: new THREE.Vector3(...(sun ? sun.dir : [0, 1, 0])).normalize() }, uSunCol: { value: sun ? sun.col : new THREE.Color() }, uSunSize: { value: sun ? sun.size : 1 },
      uStars: { value: new THREE.Vector2(st[0], st[1]) }, uMoonDir: { value: MOON_DIR.clone() }, uMoonCol: { value: new THREE.Color(0.62, 0.36, 0.78) } },
    vertexShader: `varying vec3 vD;
      void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vD = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `varying vec3 vD;
      uniform vec3 uTop, uMid, uHor, uBelow, uGA, uGB, uSunDir, uSunCol, uRetro, uMoonDir, uMoonCol;
      uniform vec2 uStars;
      uniform float uFX, uGAy, uGAk, uGBy, uGBk, uSunOn, uSunSize;
      vec3 h33(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
      void main(){
        vec3 d = normalize(vD);
        float y = d.y;                                            // world-up elevation
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.2, y));
        c = mix(c, uTop, smoothstep(0.2, 0.75, y));
        c = mix(c, uBelow, smoothstep(-0.02, -0.4, y));
        c += uGA * exp(-abs(y - uGAy) * uGAk) * 0.45;
        c += uGB * exp(-abs(y - uGBy) * uGBk) * 0.25;
        c += uRetro * exp(-abs(y - 0.015) * 18.0) * 0.65;         // purple horizon line (unchanged)
        c += uRetro * exp(-abs(y - 0.02) * 4.5) * 0.06;           // R4: faint wide purple haze around it
        c = mix(c, vec3(0.008, 0.004, 0.018), smoothstep(-0.08, -0.65, y) * 0.65);
        if (uFX > 0.5) {
          // Stars: equal-angle cube-face cells (no pole pinch, no atan seam), at most one star per cell.
          // Size is measured in screen pixels via fwidth, so every star is a stable ~1-2 px point at any
          // resolution. No time term: nothing twinkles or crawls.
          vec3 a = abs(d); vec2 fu; float face;
          if (a.x >= a.y && a.x >= a.z) { fu = d.zy / a.x; face = d.x > 0.0 ? 0.0 : 1.0; }
          else if (a.y >= a.z)          { fu = d.xz / a.y; face = d.y > 0.0 ? 2.0 : 3.0; }
          else                          { fu = d.xy / a.z; face = d.z > 0.0 ? 4.0 : 5.0; }
          vec2 g = (atan(fu) * 1.2732395 + 1.0) * 36.0;           // 72 x 72 cells per face
          vec2 px = fwidth(g);                                    // cells per pixel (huge only on face edges)
          vec2 cell = floor(g), f = fract(g) - 0.5;
          vec3 h = h33(vec3(cell, face * 97.0 + 13.0));
          float dens = max(uStars.x, 0.001);
          float t = (h.x - (1.0 - dens)) / dens;                  // >= 0 only in lit cells; 0..1 = magnitude rank
          vec2 o = (h.yz - 0.5) * 0.56;                           // keep stars off cell / face edges
          float r = length((f - o) / max(px, vec2(1e-4)));        // distance in pixels
          float lit = step(0.0, t) * step(max(px.x, px.y), 0.25) * smoothstep(0.03, 0.2, y);
          float tm = clamp(t, 0.0, 1.0);
          float mag = mix(0.35, 2.4, pow(tm, 6.0)) * uStars.y;    // few bright, many faint
          float core = 1.0 - smoothstep(0.35, 1.2, r);
          float halo = exp(-r * r * 0.2) * 0.22 * pow(tm, 4.0);    // tiny halo on the brightest only
          c += mix(vec3(0.72, 0.8, 1.0), vec3(1.0, 0.86, 0.76), h.y) * (core + halo) * mag * lit;
          // Restrained banded moon: ~2.6 deg disc, gaps widen toward its lower edge, below bloom level,
          // hidden on maps with a sun.
          float md = dot(d, uMoonDir), noSun = 1.0 - uSunOn;
          float disc = smoothstep(0.99885, 0.99905, md) * noSun;
          float q = (y - uMoonDir.y) / 0.046;                     // -1 bottom .. +1 top of the disc
          float w = clamp((0.2 - q) * 0.3, 0.0, 0.42);
          float band = mix(1.0, smoothstep(w, w + 0.1, fract(q * 3.5 + 0.25)), step(0.001, w));
          c += uMoonCol * mix(1.15, 0.7, clamp(0.5 - q * 0.5, 0.0, 1.0)) * disc * band;
          c += uMoonCol * 0.05 * pow(max(md, 0.0), 900.0) * noSun;
        }
        if (uSunOn > 0.5) {
          float sd = dot(d, uSunDir);
          c += uSunCol * smoothstep(uSunSize, uSunSize + 0.0012, sd);
          c += uSunCol * 0.18 * pow(max(sd, 0.0), 24.0) * smoothstep(-0.05, 0.08, y + 0.02);
          float bandS = smoothstep(0.0, 1.0, sin(y * 260.0 + 1.3) * 0.5 + 0.5) * smoothstep(0.08, 0.0, abs(y - 0.035));
          c *= 1.0 - bandS * 0.35 * pow(max(sd, 0.0), 6.0);
        }
        gl_FragColor = vec4(c, 1.0);
      }`
  });
}
 

// Window shader palette (game.js windowMaterial reads these as uniforms).
export function windowUniforms(th) {
  const w = th.windows;
  return { uWA: { value: w.a }, uWB: { value: w.b }, uWC: { value: w.c }, uWSplit: { value: new THREE.Vector2(w.split[0], w.split[1]) }, uWDens: { value: w.dens }, uWCell: { value: new THREE.Vector2(w.cell[0], w.cell[1]) }, uWInt: { value: w.intensity } };
}
