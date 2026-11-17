// Small pure helpers shared by core and client (moved from v5b "utils").
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export const mod = (a, n) => ((a % n) + n) % n;
export const wrapA = a => mod(a + Math.PI, Math.PI * 2) - Math.PI;
export const damp = (k, dt) => 1 - Math.exp(-k * dt);
export const smooth = t => t * t * (3 - 2 * t);
export const sstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
export function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export function fmtTime(t) { if (t == null || !isFinite(t)) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(3); }
