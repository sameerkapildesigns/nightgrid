# M8 visual lane: environment themes, hover taxi, track/building polish

Branch `claude/m8-visuals`, local only. Base: `claude/m7-rc20` @ bee26ee (build id 0661cad63d2e).
**Build id after M8: 0661cad63d2e (unchanged).** No core/net/server/protocol/wrangler/package/lockfile/roster/car-asset edits,
so the visual lane needs no Worker redeploy. Fallback cars untouched.

## What changed (visual only)
| Area | Velocity Ring | Kage Circuit | Legacy Grid |
|---|---|---|---|
| Identity | "Neon Heights": elevated night city, cyan/violet | "Kage Harbour": warm dusk waterfront, amber/teal | "Neon Rain": magenta rainy city |
| Sky | deep blue zenith, violet + cyan horizon bands | dusk gradient, low sun disc + halo + haze streaks | magenta/rose night |
| Massing | towers get 1–2 window-textured setback tiers (clearance-checked) | everything < 300 m from the circuit becomes 13–30 m warehouses or container yards; inland towers x0.62 | unchanged massing |
| Rooflines / landmarks | spires with tip lights, corner crown blades, 4 halo-ring landmark towers | sawtooth roofs + north-light glazing, corrugated container stacks (1–4 high), up to 8 ship-to-shore gantry cranes with warning lights, amber crown bands inland | spires (magenta tips), crown blades |
| Windows | cool cyan/white/violet, smaller cells | sparse sodium amber + some teal, small industrial cells | rose/amber/blue |
| Ground | dark blue, cyan/violet grid | glossy dark teal (harbour), faint amber/teal grid | dark plum, magenta grid, wetter |
| Road edge (outside walls) | slim cyan/violet light fins every 18 m | harbour bollards with amber/teal caps every 12 m | magenta/blue lamp posts every 16 m |
| Rain | light cool streaks (x0.75) | light warm drizzle (x0.3) | heaviest, magenta-white (x1.15) |
| Road traffic | hover taxi (all maps) | same | same |

**Unchanged, as requested.** Road ribbons, centrelines, walls, edge strips, gantries, the sector colours and the fog **density** stay as they were. Only the fog colour is themed, so visibility at speed is the same. The player car and rival GLBs, the camera and FOV, race pacing and the sim are untouched.

### Hover taxi (`src/client/env/taxi.js`)
- Own procedural geometry: an extruded wedge hull, a glass greenhouse, a roof TAXI light box with a blinking beacon, a checker band, four hover nacelles with thruster glow, headlight blades, a tail bar and side amber lines.
- **620 triangles** per taxi (492 body + 120 lights + 8 beacon), **2 materials** (vertex-coloured standard + basic).
- Bounds |x| ≤ 1.30 m, |z| ≤ 2.59 m, which fits inside the 2.6 × 5.2 contact footprint. The contact logic in `core/sim.js` is unchanged.
- All taxis are instanced: body, lights and beacon, plus the existing additive under-glow FX. That is **4 draw calls for all 7 taxis**, down from 7 meshes × 7 = 49.
- Same `{ root, beacon }` contract as the old `makeDrone()`.

## game.js hooks (all tagged `M8-ENV HOOK`, resolve by hand on merge)
| Hook | Where | Exact change |
|---|---|---|
| H1 | imports | +3 imports from `./env/themes.js`, `./env/skyline.js`, `./env/taxi.js` |
| H2 | lights | `scene.add(new THREE.HemisphereLight(...))` → `const hemi = ...; scene.add(hemi);` |
| H3 | after `scene.add(sky)` | new `let THEME` + `applyTheme(key)` (fog/background colour, sky material swap, hemi/moon tint, rain tint) |
| H4 | `windowMaterial()` | uniforms from `windowUniforms(THEME)`; GLSL literals → `uWCell`, `uWDens`, `uWA/B/C`, `uWSplit`, `uWInt`; `customProgramCacheKey` |
| H5 | `buildCity()` before `windowMaterial()` | `shapeBuildings(ENVCTX, bList, [signsV, signsH])`. Building tint `R(a,b)` → `lerp(BB[i], BB[i+3], R())` (same R() draw count, so the city RNG stream is unchanged) |
| H6 | `buildCity()` strip colours | `pick([...NEON])` → `pick(THEME.strips)` (two places, still one RNG draw each) |
| H7 | `buildCity()` after signs | `buildSkyline(ENVCTX, WORLD, ENVANN)` |
| H8 | `buildCity()` ground | grid colours and the flat-ground material params from `THEME.ground` |
| H9 | end of `buildTrack()` | `buildEdgeDressing({...}, WORLD)` |
| H10 | `makeDrone()` | body replaced by `createTaxiFleet(scene)` + `acquire()` |
| H11 | end of `updateDrones()` | `if (TAXI) TAXI.update(drones);` |
| H12 | `rainMat` | `uRainC` uniform replaces the literal rain colour |
| H13a/b | `switchMap()` / `boot()` | `applyTheme(key)` before the world is rebuilt |

New files: `src/client/env/{themes,skyline,taxi}.js`, `tests/e2e/visual-shots.mjs` (matched shots + render stats), `licenses/M8-PROCEDURAL.md`.

**Gameplay-lane note.** Obstacles, pickups and HUD are untouched. If the gameplay lane also edits `makeDrone`, `updateDrones` or `buildTrack()`'s tail, keep both changes: H9 and H11 are single appended lines.

## Measured render deltas
See `evidence/m8/RENDER-DELTAS.md` (generated from `before-render.json` / `after-render.json`, same seeds, same viewpoints).
These are SwiftShader (software GL) counts. Draw calls and triangles are comparable. **No hardware FPS is claimed, and actual 20-device FPS was not measured.**
The adaptive perf safeguards (pixel ratio, bloom fallbacks, ground culling) are untouched.

## Not done / known
- No new post-processing and no new lights.
- No camera, FOV, gameplay or HUD changes.
- Legacy is mostly a palette, sky, rain, crown and edge treatment (the cheap tier, as agreed).
- The PMREM environment reflection map is still the shared night map on all themes. Kage reflections therefore stay slightly cool. A per-theme `buildEnv` would cost about 1 PMREM pass per map switch; not done.
- Full `npm run test:e2e` was not run here because the Playwright browser bundle is not installed in this container. Unit tests pass 126/126. The visual-shot run loads all 3 maps at 2 viewports with page errors captured (see the json).
