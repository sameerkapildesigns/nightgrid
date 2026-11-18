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
export function themeFor(mapKey) { return THEMES[mapKey] || THEMES.velocity; }

// Sky dome material driven by the theme (replaces the hard-coded night gradient; same dome mesh).
export function makeSkyMaterial(th) {
  const s = th.sky, sun = s.sun;
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTop: { value: s.top }, uMid: { value: s.mid }, uHor: { value: s.hor }, uBelow: { value: s.below },
      uGA: { value: s.glowA }, uGAy: { value: s.glowAy }, uGAk: { value: s.glowAk }, uGB: { value: s.glowB }, uGBy: { value: s.glowBy }, uGBk: { value: s.glowBk },
      uSunOn: { value: sun ? 1 : 0 }, uSunDir: { value: new THREE.Vector3(...(sun ? sun.dir : [0, 1, 0])).normalize() }, uSunCol: { value: sun ? sun.col : new THREE.Color() }, uSunSize: { value: sun ? sun.size : 1 } },
    vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP; uniform vec3 uTop, uMid, uHor, uBelow, uGA, uGB, uSunDir, uSunCol; uniform float uGAy, uGAk, uGBy, uGBk, uSunOn, uSunSize;
      void main(){
        float y = vP.y;
        vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.2, y));
        c = mix(c, uTop, smoothstep(0.2, 0.75, y));
        c = mix(c, uBelow, smoothstep(-0.02, -0.4, y));
        c += uGA * exp(-abs(y - uGAy) * uGAk) * 0.45;
        c += uGB * exp(-abs(y - uGBy) * uGBk) * 0.25;
        if (uSunOn > 0.5) {
          float d = dot(vP, uSunDir);
          c += uSunCol * smoothstep(uSunSize, uSunSize + 0.0012, d);            // low disc
          c += uSunCol * 0.18 * pow(max(d, 0.0), 24.0) * smoothstep(-0.05, 0.08, y + 0.02);   // halo
          // horizontal haze bands across the sun (dusk cloud streaks)
          float band = smoothstep(0.0, 1.0, sin(y * 260.0 + 1.3) * 0.5 + 0.5) * smoothstep(0.08, 0.0, abs(y - 0.035));
          c *= 1.0 - band * 0.35 * pow(max(d, 0.0), 6.0);
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
