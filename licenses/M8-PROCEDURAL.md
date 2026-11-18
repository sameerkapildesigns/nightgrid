# M8 visual lane: provenance of new environment / taxi visuals

Everything added in M8 (`src/client/env/*.js`) is **original procedural code written for NIGHTGRID in this
change**. No external models, textures, fonts, HDRIs or asset packs were downloaded or used.

| Visual | Source | Licence |
|---|---|---|
| Hover taxi (road traffic) | `src/client/env/taxi.js`, built at runtime from three.js primitives (Box, Cylinder, Octahedron, Extrude of hand-written 2D profiles), merged with `BufferGeometryUtils.mergeGeometries` | Project code (same terms as the rest of NIGHTGRID); three.js is MIT (`licenses/three.js-LICENSE.txt`) |
| Themed sky dome, window palette | `src/client/env/themes.js` (GLSL written here) | Project code |
| Setback tiers, spires, crown blades, halo rings, sawtooth roofs, glazing, containers, gantry cranes, edge fins / bollards / posts | `src/client/env/skyline.js`, three.js primitives + one hand-made prism | Project code |
| Container corrugation texture, taxi under-glow texture | Drawn at runtime on a 2D canvas in the same files | Project code |

Not used / not approved: Kenney and Tevy asset packs were considered earlier and **not selected**; nothing from
them is in this change and no asset approval is claimed.

No attribution is required for these visuals. Existing CC BY 4.0 car credits (NOTICE.md) are unchanged.
