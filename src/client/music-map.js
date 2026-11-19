// R2 per-map race music: pure mapping (no DOM, no Audio), unit-tested.
// Each map gets its own beat-driven instrumental track once its file is added AND verified.
// Until a track's `ready` is true, that map keeps today's music exactly (`fallback`), so this
// change alters nothing audible until assets land. A new file that errors at runtime falls
// back for the rest of the session. Files are local, lazy (preload none), never third-party.
//
// Source/license pages checked 19 Nov 2026. Complete source recordings passed automated
// no-speech checks. Local MP3 conversions use short endpoint ramps against hard clicks;
// musical wrap/phrase continuity and subjective taste are not human-listening-verified.
// The original three tracks remain local runtime fallbacks.
export const MENU_TRACK = 'menu.mp3';

export const RACE_TRACKS = Object.freeze({
  velocity: { file: 'race-velocity.mp3', fallback: 'race-0.mp3', ready: true,
    title: 'Melodic EDM Loops', author: 'Fupi', url: 'https://opengameart.org/content/melodic-edm-loops', license: 'CC0',
    note: 'MelodicEDM short source loop, MP3 conversion with endpoint ramps' },
  technical: { file: 'race-kage.mp3', fallback: 'race-1.mp3', ready: true,
    title: 'Second Cruise', author: 'congusbongus', url: 'https://opengameart.org/content/second-cruise', license: 'CC0',
    note: 'Full source recording, local conversion' },
  casino: { file: 'race-casino.mp3', fallback: 'race-0.mp3', ready: true,
    title: 'Funky House', author: 'Of Far Different Nature', url: 'https://opengameart.org/content/funky-house', license: 'CC0',
    note: 'Original full recording, not Loop Box 4 version; endpoint ramps, musical seam unverified' },
  summit: { file: 'race-summit.mp3', fallback: 'race-0.mp3', ready: true,
    title: 'Slampe (synthwave house)', author: 'Fupi', url: 'https://opengameart.org/content/slampe-synthwave-house', license: 'CC0',
    note: 'Full source song, local conversion, endpoint ramps' },
  // Shinrai deliberately reuses the licensed Kage instrumental, no extra download.
  drift: { file: 'race-kage.mp3', fallback:'race-1.mp3',ready:true,title:'Second Cruise',author:'congusbongus',url:'https://opengameart.org/content/second-cruise',license:'CC0',note:'Intentional Kage instrumental reuse for Shinrai' },
  legacy: { file: 'race-legacy.mp3', fallback: 'race-2.mp3', ready: true,
    title: 'MicroWave', author: 'Fupi', url: 'https://opengameart.org/content/microwave-0', license: 'CC0',
    note: 'Full source recording passed automated no-speech check; musical seam unverified' }
});

// Unknown maps keep the pre-R2 rule: race-0.
const DEFAULT_RACE = 'race-0.mp3';

// Which file to play. `failed` is a Set of file names that errored this session.
export function musicSource(phase, map, failed = new Set(), tracks = RACE_TRACKS) {
  if (phase === 'title' || phase === 'loading') return MENU_TRACK;
  const t = tracks[map];
  if (!t) return DEFAULT_RACE;
  return t.ready && !failed.has(t.file) ? t.file : t.fallback;
}

// The pre-R2 mapping, kept for the parity test.
export function legacySource(phase, map) {
  return phase === 'title' || phase === 'loading' ? MENU_TRACK : `race-${{ velocity: 0, technical: 1, legacy: 2 }[map] || 0}.mp3`;
}

// Credits for tracks that are actually shipped (ready). Empty while assets are pending.
export function shippedMusicCredits(tracks = RACE_TRACKS) {
  return Object.entries(tracks).filter(([, t]) => t.ready).map(([map, t]) => ({ map, title: t.title, author: t.author, url: t.url, license: 'CC0' }));
}
