import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicSource, legacySource, RACE_TRACKS, MENU_TRACK, shippedMusicCredits } from '../../src/client/music-map.js';

const MAPS = ['velocity', 'technical', 'casino', 'summit', 'legacy'];

test('every map has a distinct new track and an existing fallback', () => {
  for (const m of MAPS) assert.ok(RACE_TRACKS[m], m);
  assert.equal(new Set(MAPS.map(m => RACE_TRACKS[m].file)).size, MAPS.length);
  for (const m of MAPS) assert.match(RACE_TRACKS[m].fallback, /^race-[012]\.mp3$/);
  for (const m of MAPS) assert.match(RACE_TRACKS[m].url, /^https:\/\/opengameart\.org\//, 'local files only at runtime; url is provenance');
});

test('while assets are pending, music is identical to the pre-R2 mapping', () => {
  const pending=Object.fromEntries(MAPS.map(m=>[m,{...RACE_TRACKS[m],ready:false}]));
  for (const ph of ['title', 'loading', 'race', 'finished', 'countdown']) for (const m of [...MAPS, 'unknown'])
    assert.equal(musicSource(ph, m,new Set(),pending), legacySource(ph, m), `${ph}/${m}`);
  assert.deepEqual(shippedMusicCredits(pending), []);
});

test('ready tracks play per map; failed tracks fall back; menu unchanged', () => {
  const ready = Object.fromEntries(MAPS.map(m => [m, { ...RACE_TRACKS[m], ready: true }]));
  for (const m of MAPS) assert.equal(musicSource('race', m, new Set(), ready), RACE_TRACKS[m].file);
  assert.equal(musicSource('title', 'casino', new Set(), ready), MENU_TRACK);
  assert.equal(musicSource('race', 'summit', new Set(['race-summit.mp3']), ready), RACE_TRACKS.summit.fallback);
  assert.equal(shippedMusicCredits(ready).length, 5);
});

test('shipped map files exist with verified credits and a small download budget',async()=>{const{statSync,readFileSync}=await import('node:fs');for(const m of MAPS){const t=RACE_TRACKS[m];assert.equal(t.ready,true);assert.equal(t.license,'CC0');const st=statSync(new URL('../../public/audio/'+t.file,import.meta.url));assert.ok(st.size>10000&&st.size<2500000);assert.ok(readFileSync(new URL('../../public/licenses/music-credits.txt',import.meta.url),'utf8').includes(t.url));}});
