// Vehicle roster, liveries and asset load-order policy (pure data).
// Models: Hypercar, Endurance, Wedge, Off-roader (rally), Streamliner from "Collect Cars" by
// drcollect (CC BY 4.0); "Wipeout spaceship" by colorsin (CC BY 4.0). See NOTICE.md.
// The archived Z-32S model is NOT part of the shipped roster.
export const CC_COMMIT = '70f467ab86d6ae9e8eea17d542ccdfac30550075';
export const CARS = {
  hypercar: { key: 'hypercar', title: 'HYPERCAR', nick: 'HC-01 SPECTRE', blurb: 'Floating rear wing · glowing wheel rings · forward canopy', len: 4.75,
    stats: { top: 0.94, acc: 0.78, grip: 0.80 }, mods: { vmax: 1.02, acc: 1.0, grip: 1.0 },
    accent: /Wing|Strake|Pylon|Scoop/, neon: /_Ring|WingTip/,
    emit: [[-0.42, 0.33, -2.39], [0, 0.31, -2.39], [0.42, 0.33, -2.39]] },
  endurance: { key: 'endurance', title: 'ENDURANCE', nick: 'LMP-9 VANGUARD', blurb: 'Le Mans prototype · shark fin · vents & diffuser', len: 4.9,
    stats: { top: 0.86, acc: 0.74, grip: 0.95 }, mods: { vmax: 0.99, acc: 0.97, grip: 1.08 },
    accent: /Fin|Endplate|Splitter|Vane|DiffuserBeam/, neon: /LightDivider|_Nut/,
    emit: [[-0.5, 0.31, -2.49], [0.5, 0.31, -2.49]] },
  wedge: { key: 'wedge', title: '80s WEDGE', nick: 'W-80 RAZOR', blurb: 'Angular retro-future wedge · pop-up lamps · louvres', len: 4.5,
    stats: { top: 0.82, acc: 0.95, grip: 0.88 }, mods: { vmax: 0.985, acc: 1.08, grip: 1.03 },
    accent: /Fin_|Fang|Chin|Louvre|Wiper/, neon: /_Lip/,
    emit: [[-0.42, 0.42, -2.25], [0.42, 0.42, -2.25]] },
  wipeout: { key: 'wipeout', kind: 'ship', title: 'WIPEOUT SPACESHIP', nick: 'AG-W', blurb: 'Imported anti-grav racer · official 2k/4k textures', len: 5.1,
    stats: { top: 0.97, acc: 0.8, grip: 0.8 }, mods: { vmax: 1.03, acc: 0.98, grip: 0.97 }, flip: true, hover: 0.5,
    minMeshes: 2, minTris: 20000, tintMat: null, tint: 0, glassMat: /Cockpit/, anims: null,
    emitF: [[0, 0.3, 1.25], [-0.13, 0.62, 0.7], [0.13, 0.62, 0.7]],
    credit: { title: 'Wipeout spaceship', author: 'colorsin', authorUrl: 'https://sketchfab.com/colorsin', url: 'https://sketchfab.com/3d-models/wipeout-spaceship-7c2f6c2789c143cfb79aff05c29c2cb7', mods: 'packed to GLB, unused UV sets 1-9 removed (geometry & original 2k/4k textures unchanged); rotated 180°, scaled; race textures capped 1024px' } },
  rally: { key: 'rally', title: 'OFF-ROADER', nick: 'RR-4 RALLY-RAID', blurb: 'Rally-raid concept · light pods · long-travel suspension', len: 4.6,
    stats: { top: 0.8, acc: 0.9, grip: 1.0 }, mods: { vmax: 0.98, acc: 1.05, grip: 1.1 }, accent: /Cladding|SkidPlate|RoofScoop|Fins/, neon: /PodLens|LightBar/, emitF: [[-0.27, 0.36, 1], [0.27, 0.36, 1]] },
  streamliner: { key: 'streamliner', title: 'STREAMLINER', nick: 'SL-1 STREAMLINER', blurb: 'Liquid-graphite land-speed shape · covered rear wheels', len: 5.2,
    stats: { top: 1.0, acc: 0.76, grip: 0.8 }, mods: { vmax: 1.035, acc: 0.95, grip: 0.96 }, accent: /Trim/, neon: /LightLine|_Ring/, emitF: [[-0.18, 0.3, 1], [0.18, 0.3, 1]] }
};
for (const k of ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner']) Object.assign(CARS[k], { kind: 'car', minMeshes: 5, minTris: 5000 });
// Garage order (v5b order). Hypercar is the default selection.
export const CAR_KEYS = ['hypercar', 'endurance', 'wedge', 'rally', 'streamliner', 'wipeout'];
export const DEFAULT_CAR = 'hypercar';
export const SHORT = { wipeout: ['Wipeout AG', 'Anti-grav racer · imported ship'], hypercar: ['Hypercar', 'Spectre · floating wing'], endurance: ['Endurance', 'Vanguard · Le Mans prototype'], wedge: ['Wedge', 'Razor · 80s retro wedge'], rally: ['Off-roader', 'Rally-Raid · long-travel'], streamliner: ['Streamliner', 'Land-speed · liquid graphite'] };
export const PAINTS = [
  { name: 'PEARL', paint: '#d9dde6', metal: 0.35, rough: 0.24, accent: '#15171c', neon: '#00f0ff' },
  { name: 'GRAPHITE', paint: '#2b2e35', metal: 0.6, rough: 0.3, accent: '#0a0b0e', neon: '#00f0ff' },
  { name: 'CRIMSON', paint: '#a3101f', metal: 0.45, rough: 0.26, accent: '#121216', neon: '#ff3355' },
  { name: 'ULTRAVIOLET', paint: '#3a1a92', metal: 0.5, rough: 0.25, accent: '#0d0b16', neon: '#c08bff' }
];
export const RIVAL_LIV = {
  VEX: { car: 'wedge', name: 'VEX #13', paint: '#141016', metal: 0.5, rough: 0.28, accent: '#ff2a3a', neon: '#ff3355' },
  GHOST: { car: 'wipeout', name: 'GHOST #00', paint: '#a8afc6', metal: 0.7, rough: 0.2, accent: '#5a3ae0', neon: '#b9a6ff' },
  BLITZ: { car: 'endurance', name: 'BLITZ #88', paint: '#f7bf12', metal: 0.25, rough: 0.32, accent: '#111111', neon: '#ff8a2a' }
};
export const RIVAL_ORDER = ['GHOST', 'VEX', 'BLITZ'];

// Cars a race needs: the selected car plus each rival's car (deduplicated).
export function raceCarKeys(selected) { return [...new Set([selected, ...RIVAL_ORDER.map(n => RIVAL_LIV[n].car)])]; }
// Boot order: the selected car first (it gates the garage), then rival cars (they gate
// "Race"). Every other car is fetched only when the player selects it.
export function bootLoadOrder(selected = DEFAULT_CAR) { return raceCarKeys(selected); }
export function isRaceReady(selected, statusOf) { return raceCarKeys(selected).every(k => { const s = statusOf(k); return s === 'ok' || s === 'failed'; }); }
