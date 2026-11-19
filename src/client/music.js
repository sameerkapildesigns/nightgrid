// Licensed local music. Never starts until a user gesture. Audio errors never block racing.
export function createMusic() {
  let enabled = true, unlocked = false, current = '', phase = 'title', map = 'velocity', paused = false;
  try { const s = JSON.parse(localStorage.getItem('nightgrid_v4_settings') || 'null'); if (typeof s?.music === 'boolean') enabled = s.music; } catch {}
  const audio = new Audio(); audio.loop = true; audio.preload = 'none'; audio.volume = 0.14;
  const source = () => phase === 'title' || phase === 'loading' ? 'menu.mp3' : `race-${{velocity:0,technical:1,legacy:2}[map] || 0}.mp3`;
  function sync() {
    if (!unlocked || !enabled || paused || document.hidden) { audio.pause(); return; }
    const next = source(); if (next !== current) { audio.pause(); current = next; audio.src = new URL(`audio/${next}`, document.baseURI).href; }
    if (audio.paused) audio.play().catch(() => {});
  }
  document.addEventListener('visibilitychange', sync);
  return { update(s, m, p) { phase=s; map=m; paused=p; sync(); }, unlock() { unlocked=true; sync(); }, setEnabled(on) { enabled=!!on; sync(); }, get enabled() { return enabled; }, get status() { return {enabled,unlocked,source:current,paused:audio.paused,volume:audio.volume,currentTime:audio.currentTime,readyState:audio.readyState,error:audio.error?.code || null}; } };
}
