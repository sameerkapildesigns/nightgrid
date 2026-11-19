# NIGHTGRID: third-party assets, licences and adaptations

This file records every third-party asset the game ships, its licence, and every
adaptation. The licence texts are in `licenses/`; the shipped copies are in
`public/licenses/` and are served with the game at `licenses/…`.

## 3D models (all CC BY 4.0)

| File (`assets/models/`) | Model | Author / source | Licence |
|---|---|---|---|
| `hypercar.glb`, `endurance.glb`, `wedge.glb`, `rally.glb`, `streamliner.glb` | Hypercar, Endurance, Wedge, Rally-Raid (Off-roader), Streamliner | **Collect Cars** by **drcollect**, `models/full/` at pinned commit `70f467ab86d6ae9e8eea17d542ccdfac30550075` (https://github.com/drcollect/collect-cars) | CC BY 4.0 (models/images); MIT for the upstream viewer code. Text: `licenses/LICENSE.txt` |
| `wipeout.glb` | “Wipeout spaceship” | **colorsin**, https://sketchfab.com/3d-models/wipeout-spaceship-7c2f6c2789c143cfb79aff05c29c2cb7 | CC BY 4.0. Text: `licenses/WIPEOUT_LICENSE.txt` |

Credit line (also shown in the in-game Credits panel and the race HUD):
*Cars: Collect Cars by drcollect · Ship: Wipeout spaceship by colorsin · CC BY 4.0.*
This work is based on "Wipeout spaceship" (https://sketchfab.com/3d-models/wipeout-spaceship-7c2f6c2789c143cfb79aff05c29c2cb7) by colorsin (https://sketchfab.com/colorsin), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/).

### Adaptations

* **File-level (made before M1, inherited from the v5b baseline):** `wipeout.glb` was packed
  from the official Sketchfab glTF download into a single GLB; unreferenced UV sets 1–9 were
  removed. Geometry and the original 2k/4k PNG textures are unchanged. The note is also stored
  in the GLB's `asset.extras.modifications`. The five Collect Cars GLBs are the upstream files.
* **M1 changes no model file.** The six GLBs in `assets/models/` are byte-identical to the
  supplied M1 asset archives (SHA-256 below). They are now served as binary GLB with
  content-hashed filenames instead of base64 text.
* **Runtime only (unchanged from v5b, applied in memory, originals untouched):** scaled to
  game length and re-centred; Wipeout rotated 180°; livery paint/accent/neon material
  recolouring; wheel rigging (steer/spin pivots); glass made non-transmissive; in race mode
  only, textures larger than 1024 px are down-sampled into a separate in-memory copy (the
  garage shows the originals). No geometry or LOD changes.

SHA-256 of the shipped GLBs:

```
e184ea64522e3ff252a78ec4388600d795f3b72460ed927c4e8483ed7f4b8884  hypercar.glb
ddb3b6535b2580cd541ea2264f8dada47dda3675a7321209d4956e94c87d66ef  endurance.glb
317b97bf981a1abb9ffde86e2847bf969cc41945dd6822c4d0872ce498d3e793  wedge.glb
ca139d39823ac4644620f0e0b4753c73beec7b9edd2c23f2abd9ef1c759552e9  rally.glb
c344492938063395f1dcde05f1a06fe53264026f1781e28d89059515dc350943  streamliner.glb
ec0048ea1dd9f11b67158f343e8ef57c6a3da5d5441e55230a0ff5a3b7709ac1  wipeout.glb
```

### Archived, not shipped

`licenses/archived/Z32S_LICENSE.txt` is kept for the record of the “Z-32S _Hovercar_animated” model
by Animateria (CC BY 4.0). That model is **not** in the repository's assets, roster or build.

## Software

* **three.js** 0.170.0, MIT. It is bundled into the build; its licence is in `licenses/three.js-LICENSE.txt`
  and is shipped.
* **Fonts:** Orbitron, Rajdhani, Chakra Petch and Inter are loaded at runtime from Google Fonts
  (SIL OFL). They are not bundled.
* City, tracks, FX, audio and UI are procedural and part of the NIGHTGRID code.

## NIGHTGRID code

No open-source licence for the NIGHTGRID game code has been chosen yet. Making the repository
public does not by itself grant one. The third-party licences above apply to their assets only.

Release 2: KESTREL and MANTA are original procedural NIGHTGRID designs. Per-map CC0 music sources, authors, changes and retained CC BY fallback credits are listed in licenses/MUSIC.md and public/licenses/music-credits.txt.
