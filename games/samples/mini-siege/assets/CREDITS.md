# Credits for the mini siege's asset packs

Every folder under `assets/` is one pack and has a section here, checked by `pnpm cli validate`
(`engine/core/content/assets.ts`): its source, author and licence. Only CC0 is allowed unless an
owner decision is cited (docs/DESIGN.md, item 322). Fetched for Engine 0.16 part F, F1
(2026-11-10), for the siege map in 3D low-poly (the mockup `docs/reports/mockups/mini-siege-3d.png`).
Only the files the game will use were kept (about 8.7 MB in all, 221 GLB models). Every model is a
self-contained `.glb` with plain material or vertex colours and no texture, as the engine's model
check and `ModelLibrary` in Node need; `assets.test.ts` parses each one. The roadmap names three
packs; the other two are substitutes for what those three lack (people and sheep), and the
Quaternius village pack is the 2020 "Medieval Village Pack", not the newer textured MegaKit; these
choices are owner items (`docs/FEEDBACK-LOG.md`).

## kenney-castle-kit

- Source: https://opengameart.org/content/castle-kit
  (https://opengameart.org/sites/default/files/kenney_castle-kit.zip, version 2.0, 2024-03-27)
- Author: Kenney (www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the village walls, towers, gates and drawbridge, the raiders' siege engines whole and
  burnt (`*-demolished`), and the flags.
- Files (68 GLBs, 1.3 MB, from `Models/GLB format/`): every model but the ground, rocks and trees
  (the Nature Kit has those): `wall*` (straight, half, corners, doorway, pillar, stud, narrow,
  narrow stairs and wood), `tower-*` (square and hexagon bases, middles, tops and roofs,
  `tower-base`, `tower-top`, `tower-slant-roof`), `gate`, `metal-gate`, `door`, `bridge-draw`,
  `bridge-straight*`, `stairs-stone*`, `siege-ram`, `siege-catapult`, `siege-ballista`,
  `siege-tower`, `siege-trebuchet` and each one's `-demolished`, `flag`, `flag-wide`,
  `flag-pennant`, `flag-banner-long`, `flag-banner-short`; and `license.txt`.
- Changed: version 2.0 colours its models with one texture, `Textures/colormap.png` (a palette of
  flat and gradient swatches) that each GLB names as an outside file, which the engine's model
  check refuses. Each model's colormap was baked into a vertex colour (`COLOR_0`, the colormap
  under the vertex's UV, linear), with one plain white material; the texture, UVs and tangents
  were dropped and the buffer rebuilt with only what is still used. Geometry, nodes and
  transforms are the pack's own.

## kenney-nature-kit

- Source: https://opengameart.org/content/nature-kit
  (https://opengameart.org/sites/default/files/Nature%20Kit%20%282.1%29.zip, version 2.1)
- Author: Kenney (www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the land around the village: trees (green, dark and autumn), rocks, the river and path
  ground tiles, the wooden bridge, fences, the raiders' tents and campfires, the fields.
- Files (129 GLBs, 1.2 MB, from `Models/GLTF format/`, names unchanged): `tree_default`,
  `tree_oak`, `tree_detailed`, `tree_simple`, `tree_tall` (each also `_dark` and `_fall`),
  `tree_fat`, `tree_fat_fall`, `tree_cone`, `tree_small`, `tree_pine*` (DefaultA-B, RoundA-C,
  SmallA-B, TallA-B); `rock_largeA-F`, `rock_smallA-F`, `rock_tallA-C`; `ground_grass`,
  `ground_river*` and `ground_path*` (straight, bend, corner, cross, split, end, side, open, rocks,
  tile and their bank and closed forms); `bridge_wood`, `bridge_woodNarrow`, `bridge_woodRound`,
  `bridge_side_wood`, `bridge_center_wood`, `bridge_stone`; `fence_simple*`, `fence_corner`,
  `fence_gate`, `fence_planks*`, `fence_bend*`; `tent_detailedOpen`, `tent_detailedClosed`,
  `tent_smallOpen`, `tent_smallClosed`; `campfire_logs`, `campfire_stones`, `campfire_planks`;
  `crops_wheatStageA-B`, `crops_cornStageA-D`, `crops_dirt*`, `crop_pumpkin`; `plant_bush*`,
  `grass*`, `flower_redA`, `flower_yellowA`, `flower_purpleA`, `log*`, `stump_old`,
  `stump_round`, `sign`; and `license.txt`. Each is self-contained with flat material colours.
  Nothing was changed.

## quaternius-medieval-village

- Source: https://opengameart.org/content/lowpoly-medieval-village-pack
  (https://opengameart.org/sites/default/files/medieval_village_pack_-_dec_2020.zip, "Medieval
  Village Pack - Dec 2020"; also https://quaternius.com/packs/medievalvillage.html)
- Author: Quaternius
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the hall (`inn`), the village houses, the windmill (`mill`), the smithy, the well and the
  market and yard props.
- Files (19 GLBs, 2.8 MB): from `Buildings/OBJ/`: `inn`, `house-1` to `house-4`, `mill`,
  `blacksmith`; from `Props/OBJ/`: `well`, `market-stand-1`, `market-stand-2`, `cart`, `barrel`,
  `crate`, `hay`, `bags`, `bonfire`, `bonfire-lit`, `bench-1`, `fence`; and `license.txt`.
- Changed: the pack has OBJ, FBX and Blender files but no glTF (its Google Drive copy, the only
  other source, refused scripted downloads). Each `.obj` with its `.mtl` was converted to a `.glb`:
  one primitive per material, each material a plain colour from the MTL's `Kd` (metallic 0,
  roughness 1), faces fan-triangulated, the file's own normals kept, UVs dropped (no textures).
  Names were lower-cased with `_` turned into `-` (`MarketStand_1` is `market-stand-1`). The
  windmill's sails are part of the one mesh (the OBJ has no pivot to turn them on).

## quaternius-characters

- Source: https://opengameart.org/content/animated-characters-pack
  (https://opengameart.org/sites/default/files/ultimate_animated_character_pack_by_quaternius.zip,
  "Ultimate Animated Character Pack - Nov 2019"; also
  https://quaternius.com/packs/ultimatedanimatedcharacter.html)
- Author: Quaternius
- Licence: CC0 1.0 Universal (stated on the OpenGameArt page and quaternius.com; the zip holds no
  licence file)
- Use: the people, which none of the three named packs has: `knight-male` (the village's
  soldiers), `knight-golden-male` (Captain Hale), `viking-male` (the raiders and their guards),
  `worker-male` (the workers raising the watchtower).
- Files (4 GLBs, 3.1 MB), from `FBX/`: `Knight_Male`, `Knight_Golden_Male`, `Viking_Male`,
  `Worker_Male` as `knight-male.glb` and so on. Each keeps the clips `Idle`, `Walk`,
  `Walk_Carry`, `PickUp`, `Punch` (the attack), `RecieveHit` (sic), `Defeat` (a slump, the
  nearest to a death: the pack has no `Death`) and `Victory`; `SitDown`, `StandUp` and
  `Shoot_OneHanded` were left out.
- Changed: the zip's models are FBX (with OBJ and Blender files; no glTF). Each `.fbx` was read
  with three's `FBXLoader` and written with its `GLTFExporter` as a `.glb` (skinned, at most four
  bone weights a vertex): clip names lost their `CharacterArmature|` prefix and their redundant
  keyframes; equal vertices were merged and the unused UVs dropped; each material became a plain
  colour with the FBX's own diffuse value (metallic 0, roughness 1).

## quaternius-farm-animals

- Source: https://opengameart.org/content/lowpoly-animated-farm-animal-pack
  (https://opengameart.org/sites/default/files/Farm%20Animals%20by%20%40Quaternius.zip; also
  https://quaternius.com/packs/farmanimal.html)
- Author: Quaternius
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the sheep in the pen by the windmill, which none of the three named packs has.
- Files (1 GLB, 0.2 MB): `sheep.glb` from `FBX/Sheep.fbx`, clips `Idle` and `Jump`; and
  `license.txt`.
- Changed: converted from FBX as the characters were (above); clip names lost their `Armature|`
  prefix.
