# Credits for The Old Crypt's asset packs

Every folder under `assets/` is one pack and has a section here, checked by `pnpm cli validate`
(`engine/core/content/assets.ts`): its source, author and licence. Only CC0 is allowed unless an
owner decision is cited (docs/DESIGN.md, item 322). Fetched for Engine 0.16 part C, T2
(2026-11-10). File names were lower-cased with underscores turned into hyphens; nothing else was
changed. From part C, T3 the Canvas2D skin draws from `sheet.png`, and the text sheets
`content/sprites/crypt-art.txt` and `crypt-floor.txt` hold pieces cut, turned and pasted from it
(CC0 allows it; the few original pieces there are named in their header).

## dungeon-tileset-ii

- Source: https://0x72.itch.io/dungeontileset-ii (the free "0x72_DungeonTilesetII_v1.7.zip",
  406 kB, version 1.7)
- Author: 0x72
- Licence: CC0 1.0 Universal (stated as the asset licence on the itch.io page, "Creative Commons
  Zero v1.0 Universal"; the zip holds no licence file)
- Use: the 2D art pass of The Old Crypt: floors, walls, doors, chests, fountains, banners, the
  hero (`knight_m`), the monsters (imp, skeleton, goblin, orcs, chort, zombies, slugs), the boss
  (`big_demon` or `ogre`), weapons, hearts, flasks, coins, bombs, spikes and levers.
- Files (6 files, 65 KB):
  - `sheet.png` (`0x72_DungeonTilesetII_v1.7.png`, 512 x 512): every frame of the pack in one
    sheet. The zip's `frames/` folder holds the same frames as 750 separate PNGs; the sheet is
    kept instead, since a skin's `images` entry names frames as rectangles of one PNG.
  - `tile-list.txt` (`tile_list_v1.7`): one line per frame of `sheet.png`, `<name> <x> <y> <w>
<h>` (e.g. `knight_m_run_anim_f0 192 100 16 28`), the source for a skin's `frames`.
  - `atlas-floor-16x16.png`, `atlas-walls-low-16x16.png` and `atlas-walls-high-16x32.png`
    (`atlas_floor-16x16.png` and so on): the pack's autotile atlases (3 x 3 minimal layout).
  - `readme.txt` (`README`): the author's notes on the atlases.
- Left out: the `frames/` folder (the same art as `sheet.png`) and the macOS `__MACOSX` and
  `.DS_Store` files.
- Not in the pack: torches, bats and a sound set. The bats are the pack's imp, the torches an
  original brazier in the pack's colours (T3); the music and sound effects stay MML.
