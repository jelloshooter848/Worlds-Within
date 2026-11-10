# Credits for Hopper's Way's asset packs

Every folder under `assets/` is one pack and has a section here, checked by `pnpm cli validate`
(`engine/core/content/assets.ts`): its source, author and licence. Only CC0 is allowed unless an
owner decision is cited (docs/DESIGN.md, item 322). Fetched for Engine 0.16 part B, T4
(2026-11-10). Only the files the game will use were kept (about 1.8 MB in all); file names were
lower-cased with spaces turned into hyphens, and nothing else was changed unless a section says so.
Feedback items 364 and 365 (`docs/FEEDBACK-LOG.md`) say why there are four packs and not two.

## pixel-adventure-1

- Source: https://pixelfrog-assets.itch.io/pixel-adventure-1 (the free "Pixel Adventure 1.zip")
- Author: Pixel Frog
- Licence: CC0 1.0 Universal (stated as the asset licence on the itch.io page; the zip holds no
  licence file)
- Use: the 2D look: terrain, backgrounds, the player, items, checkpoints, traps and effects.
- Files (89 PNGs, 84 KB), the zip's `Free/` folder with these parts kept:
  - `terrain/terrain-16x16.png`, the 16 x 16 terrain tile sheet
  - `background/*.png`, seven 64 x 64 tiling background tiles (blue, brown, gray, green, pink,
    purple, yellow)
  - `characters/ninja-frog/*-32x32.png`, the player (idle, run, jump, fall, double jump, wall
    jump, hit) and `characters/appearing-96x96.png`, `characters/disappearing-96x96.png`
    (`Desappearing` in the zip); the other three characters were left out
  - `items/`: the fruits (collectables and `collected`), boxes, and the start, checkpoint (flag)
    and end checkpoints
  - `traps/`: arrow, blocks, falling platforms, fan, fire, moving platforms, rock head, sand, mud
    and ice, saw, spike head, spiked ball, spikes, trampoline
  - `other/`: confetti, dust particle, shadow, transition
- Left out: the menu buttons, level numbers and menu font, `Hello.png` and `20 Enemies.png` (an
  advert for the paid Pixel Adventure 2).

## kenney-pixel-platformer

- Source: https://kenney-assets.itch.io/pixel-platformer (Kenney's itch.io mirror of
  https://kenney.nl/assets/pixel-platformer, version 1.2)
- Author: Kenney (www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the 2D enemies (Pixel Adventure 1 has none; item 364) and a second tile set to choose from.
- Files (7 files, 10 KB): `tiles-packed.png` (the 18 x 18 tiles, `Tilemap/tilemap_packed.png`),
  `characters-packed.png` (the 24 x 24 characters and enemies,
  `Tilemap/tilemap-characters_packed.png`), `backgrounds-packed.png` (the 24 x 24 background
  tiles, `Tilemap/tilemap-backgrounds_packed.png`), the three `Tilesheet (...).txt` grid notes
  as `tilesheet-tiles.txt`, `tilesheet-characters.txt`, `tilesheet-backgrounds.txt`, and
  `license.txt`.

## kenney-platformer-kit

- Source: https://opengameart.org/content/platformer-kit
  (https://opengameart.org/sites/default/files/kenney_platformerKit_0.zip, version 1.1)
- Author: Kenney (www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the 2.5D view's terrain blocks, platforms, props, coins and the goal flag.
- Files (59 GLBs, 572 KB, from `Models/GLTF format/`): every model but the snow set: the grass
  blocks (`block*.glb`: plain, half, quarter, large, cliff, corners, ends, slopes, hexagons,
  dirt, moving), `platform`, `bridge*`, `ladder*`, `crate*`, `barrel`, `cube`, `coinGold`,
  `coinSilver`, `coinBronze`, `jewel`, `heart`, `key`, `flag`, `door`, `sign`, `button`,
  `lever`, `spikes*`, `saw`, `arrow`, `arrows`, `fence*`, `hedge*`, `tree`, `flowers`,
  `mushrooms`, `rocks`; and `license.txt`. Each is self-contained (no texture files: flat
  material colours), as the engine's model check needs.

## quaternius-platformer

- Source: https://quaternius.itch.io/ultimate-platformer-pack ("Ultimate Platformer Pack by
  Quaternius.zip", December 2021)
- Author: Quaternius
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the 2.5D player stand-in and enemies, which the Kenney Platformer Kit does not have
  (item 365).
- Files (5 GLBs, 1.1 MB): `character.glb` (the player stand-in; clips `Idle`, `Walk`, `Run`,
  `Jump`, `Jump_Idle`, `Jump_Land`, `Duck`, `HitReact`, `Death` and more), `enemy.glb`,
  `crab.glb`, `skull.glb` (walkers; clips `Idle`, `Walk`, `Jump`, `HitRecieve`, `Death` and
  more) and `bee.glb` (a flyer; `Flying`, `HitRecieve`, `Death`), from `Character/glTF/` and
  `Enemies/glTF/`; and `license.txt`. Changed: each `.gltf` (its buffer embedded as base64) was
  repacked as a `.glb` with the same glTF JSON and the same bytes, a quarter smaller.
