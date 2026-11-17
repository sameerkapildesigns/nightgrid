// Map catalogue + per-map track data derivation (pure; no Three.js).
// Sector colours are CSS strings; the client turns them into THREE.Color.
import { TRK } from './track.js';
import { Vec3 } from './vec.js';
import { mod, clamp, sstep } from './math.js';

const sc = (name, sub, css) => ({ name, sub, css });
export const SECTORS_LEGACY = [
  sc('MONZA', 'S1 · FULL THROTTLE', '#00f0ff'),
  sc('EAU ROUGE', 'S2 · CLIMB · INVERT · ROLL', '#ff2b5e'),
  sc('SUZUKA', 'S3 · ESSES · CROSSOVER', '#7dff4a'),
  sc('MONACO', 'S4 · TUNNEL · HAIRPIN', '#ffc23f'),
  { name: 'PARABOLICA', sub: 'S5 · LOOP SHORTCUT OR LONG WAY', css: '#b07bff', colHex: 0xa86bff }
];
export const MAPS = {
  velocity: { key: 'velocity', name: 'Velocity Ring', short: 'Velocity', sub: 'High-speed · loop · barrel roll', blurb: 'Flat-out · 330 km/h avg', laps: 2, W0: 14, hasBr: false, ai: { vmax: 1.05, lat: 1.0 },
    sectors: [sc('SWEEPERS', 'S1 · BANKED FLAT-OUT', '#3fd8ff'), sc('SKY LOOP', 'S2 · LOOP · CAROUSEL', '#9a7bff'), sc('BARREL', 'S3 · ROLL · FINAL SWEEP', '#ff5ab8')], build: () => TRK.assembleCustom(TRK.DEFS.velocity()) },
  technical: { key: 'technical', name: 'Kage Circuit', short: 'Kage', sub: 'Technical · chicanes · hairpin', blurb: 'Brake · hairpin · 250 avg', laps: 3, W0: 10.5, hasBr: false, ai: { vmax: 1.03, lat: 1.26 },
    sectors: [sc('HARBOUR', 'S1 · BRAKE · CHICANE', '#ffb347'), sc('HAIRPIN', 'S2 · CLIMB · 180°', '#ff4f6d'), sc('ESSES', 'S3 · RHYTHM · CHICANE', '#5de0a0')], build: () => TRK.assembleCustom(TRK.DEFS.technical()) },
  legacy: { key: 'legacy', name: 'Legacy Grid', short: 'Legacy', sub: 'v3 mixed 5-sector', blurb: 'Mixed · v3 classic', laps: 3, W0: TRK.W0, hasBr: true, ai: { vmax: 1, lat: 1 }, sectors: SECTORS_LEGACY, build: () => TRK.assemble() }
};
export const MAP_KEYS = ['velocity', 'technical', 'legacy'];
export const DEFAULT_MAP = 'velocity';
export const S0 = 60;            // start line (main metres)
export const H0 = 1.0;           // nominal hover height
export const WB = TRK.WB;

export function mkPath(raw) {
  const N = raw.N;
  const p = { N, closed: raw.closed, ds: raw.ds, P: [], T: [], U: [], R: [], W: Float32Array.from(raw.W), WL: Float32Array.from(raw.W), WR: Float32Array.from(raw.W), sec: Int8Array.from(raw.sec), tag: Uint8Array.from(raw.tag), KG: raw.KG, KN: raw.KN };
  for (let i = 0; i < N; i++) { p.P.push(new Vec3(...raw.P[i])); p.T.push(new Vec3(...raw.T[i])); p.U.push(new Vec3(...raw.U[i])); p.R.push(new Vec3(...raw.R[i])); }
  p.L = raw.closed ? N * raw.ds : (N - 1) * raw.ds;
  return p;
}

// Builds everything the simulation needs for one map (was loadTrackData in v5b).
export function buildTrackData(key) {
  const def = MAPS[key]; if (!def) throw new Error('unknown map ' + key);
  const raw = def.build();
  const HASBR = !!raw.branch;
  const MAIN = mkPath(raw.main), BR = HASBR ? mkPath(raw.branch) : null;
  let SA, SB, OFF;
  if (HASBR) { SA = raw.branch.sA; SB = raw.branch.sB; OFF = raw.branch.off; } else { SA = SB = -1e9; OFF = 0; }
  const SAm = SA * MAIN.ds, SBm = SB * MAIN.ds;
  if (HASBR) for (let i = 0; i < MAIN.N; i++) {
    const s = i * MAIN.ds; let ex = 0;
    if (s < SAm && s > SAm - 120) ex = 2 * WB * sstep(SAm - 120, SAm - 40, s);
    if (s >= SBm && s < SBm + 130) ex = 2 * WB * (1 - sstep(SBm + 40, SBm + 120, s));
    MAIN.WR[i] = MAIN.W[i] + ex;
  }
  const SECTORS = def.sectors;
  const SECSTART = SECTORS.map(() => 0);
  for (let i = 1; i < MAIN.N; i++) if (MAIN.sec[i] !== MAIN.sec[i - 1]) SECSTART[MAIN.sec[i]] = i;
  SECSTART[0] = Math.round(S0 / MAIN.ds);
  return { key, def, MAIN, BR, HASBR, SA, SB, OFF, SAm, SBm, LAPLEN: MAIN.L, LAPS: def.laps, W0: def.W0, SECTORS, SECSTART };
}

// ---- frame sampling with branch->main delegation (was frameAt/worldPos/raceS/rdist) ----
export function mkF() { return { P: new Vec3(), T: new Vec3(), U: new Vec3(), R: new Vec3(), off: 0, i: 0, path: null }; }
export function frameAt(td, path, s, out) {
  let off = 0;
  if (!path.closed) { if (s < 0) { off = td.OFF; s = td.SAm + s; path = td.MAIN; } else if (s > path.L) { off = td.OFF; s = td.SBm + (s - path.L); path = td.MAIN; } }
  const f = (path.closed ? mod(s, path.L) : clamp(s, 0, path.L)) / path.ds;
  let i = Math.floor(f); const t = f - i; let j = i + 1;
  if (path.closed) { i %= path.N; j %= path.N; } else { i = Math.min(i, path.N - 1); j = Math.min(j, path.N - 1); }
  out.P.lerpVectors(path.P[i], path.P[j], t); out.T.lerpVectors(path.T[i], path.T[j], t).normalize();
  out.U.lerpVectors(path.U[i], path.U[j], t).normalize(); out.R.lerpVectors(path.R[i], path.R[j], t).normalize();
  out.off = off; out.i = t < 0.5 ? i : j; out.path = path; return out;
}
const _fw = mkF(), _fk = mkF();
export function worldPos(td, path, s, d, h, out) { const f = frameAt(td, path, s, _fw); d += f.off; return out.copy(f.P).addScaledVector(f.R, d).addScaledVector(f.U, h); }
export function kgAt(td, path, s) { const f = frameAt(td, path, s, _fk); return f.path.KG[f.i]; }
export function raceS(td, path, s) { return path === td.MAIN ? mod(s, td.MAIN.L) : td.SAm + clamp(s, 0, td.BR.L) / td.BR.L * (td.SBm - td.SAm); }
export function rdist(td, path, s) { return mod(raceS(td, path, s) - S0, td.LAPLEN); }
