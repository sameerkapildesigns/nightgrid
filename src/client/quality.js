// Render-only quality policy. No gameplay or network state.
export const QUALITY = ['auto', 'battery', 'high'];
export function qualityLimits(mode, dpr = 1) {
  const cap = mode === 'high' ? 2 : mode === 'battery' ? 1 : 1.5;
  return { max: Math.min(Math.max(0.75, dpr || 1), cap), min: mode === 'high' ? 1 : 0.75, bloom: mode !== 'battery' };
}
export function qualitySample(state, fps, limits) {
  const s = { ...state };
  s.low = fps < 48 ? (s.low || 0) + 1 : 0;
  s.high = fps >= 57 ? (s.high || 0) + 1 : 0;
  if (s.low >= 2) { s.pr = Math.max(Math.min(limits.min, limits.max), s.pr - 0.25); s.low = 0; }
  if (s.high >= 10) { s.pr = Math.min(limits.max, s.pr + 0.25); s.high = 0; }
  s.fxLow = fps < 30 && s.pr <= limits.min ? (s.fxLow || 0) + 1 : 0;
  s.fxHigh = fps > 50 ? (s.fxHigh || 0) + 1 : 0;
  if (!limits.bloom || s.fxLow >= 3) s.bloom = false;
  else if (s.fxHigh >= 5) s.bloom = true;
  return s;
}
