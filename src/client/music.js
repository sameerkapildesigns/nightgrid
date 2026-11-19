// Licensed local music. Never starts until a user gesture. Audio errors never block racing.
// R2: per-map race tracks via music-map.js; a new track that fails to load falls back to the
// pre-R2 file for the rest of the session (the fallback itself is never retried in a loop).
import { musicSource, RACE_TRACKS } from './music-map.js';
const NEW_FILES = new Set(Object.values(RACE_TRACKS).map(t => t.file));
export function createMusic() {
  let enabled = true, unlocked = false, current = '', phase = 'title', map = 'velocity', paused = false;
  const failed = new Set();
  try { const s = JSON.parse(localStorage.getItem('nightgrid_v4_settings') || 'null'); if (typeof s?.music === 'boolean') enabled = s.music; } catch {}
  const audio = new Audio(); audio.loop = true; audio.preload = 'none'; audio.volume = 0.14;
  audio.addEventListener('error', () => { if (NEW_FILES.has(current) && !failed.has(current)) { failed.add(current); sync(); } });
  const source = () => musicSource(phase, map, failed);
  function sync() {
    if (!unlocked || !enabled || paused || document.hidden) { audio.pause(); return; }
    const next = source(); if (next !== current) { audio.pause(); current = next; audio.src = new URL(`audio/${next}`, document.baseURI).href; }
    if (audio.paused) audio.play().catch(() => {});
  }
  document.addEventListener('visibilitychange', sync);
  return { update(s, m, p) { phase=s; map=m; paused=p; sync(); }, unlock() { unlocked=true; sync(); }, setEnabled(on) { enabled=!!on; sync(); }, get enabled() { return enabled; }, get status() { return {enabled,unlocked,source:current,failed:[...failed],paused:audio.paused,volume:audio.volume,currentTime:audio.currentTime,readyState:audio.readyState,error:audio.error?.code || null}; } };
}
