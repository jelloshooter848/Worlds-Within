# Credits for The River Ford's asset packs

Every folder under `assets/` is one pack and has a section here, checked by `pnpm cli validate`
(`engine/core/content/assets.ts`): its source, author and licence. Only CC0 is allowed unless an
owner decision is cited (docs/DESIGN.md, item 322). Fetched for Engine 0.16 part D, D7
(2026-11-11), from the pack's OpenGameArt mirror (kenney.nl blocks automated downloads).

## kenney-medieval-rts

- Source: https://opengameart.org/content/medieval-rts-120
  (https://opengameart.org/sites/default/files/kenney_medievalRTSpack.zip, "Medieval RTS (120+)",
  the zip of Kenney's "RTS Pack: Medieval"; also https://kenney.nl/assets/medieval-rts)
- Author: Kenney (Kenney Vleugels, www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`, and the OpenGameArt
  page)
- Use: the 2D art pass of The River Ford: the workers (villagers), soldiers (sword and shield),
  archers (the bowmen, from D8) and the hero (the king) in the pack's red for the player and blue
  for the AI's side; the town centre
  (the stone keep with a banner) and the barracks (the green-roofed hall, its roof in the team
  colour); the ground, roads, river, rocks, trees and gold; the building sites (the pack's crates
  and plank floors) and the placing ghost.
- Files (4 files, 180 KB):
  - `medieval-rts-sheet.png` (`Spritesheet/medievalRTS_spritesheet.png`, 550 x 550): every sprite
    of the pack at its default size in one sheet; the skin's `images.rts` names the units and
    buildings in it.
  - `medieval-rts-sheet-atlas.txt` (`Spritesheet/medievalRTS_spritesheet.xml`, renamed so it
    travels as text): the pack's own atlas, each sprite's rectangle in the sheet;
    `assets.test.ts` checks the skin's `rts` frames against it.
  - `ford-tiles.png` (256 x 96): made from `medieval-rts-sheet.png` by
    `games/samples/rts-skirmish/tools/ford-tiles.ts` (below).
  - `license.txt` (`License.txt`, line ends made Unix).
- Changed: nothing in the sheet itself. `ford-tiles.png` is the pack's art cut and scaled for the
  map's 16 px cells, which CC0 allows: the grass and water tiles (64 px) at a quarter size; road
  and river-bank cells for every set of open sides, laid in the pack's path, grass and water
  colours over its grass and water; rocks, trees and the gold rock (`medievalEnvironment_*`) at
  half size on the grass; the building sites from the crate and plank-floor tiles
  (`medievalTile_53` to `56`) with their grass made clear; the placing ghost is the barracks at
  half alpha. `assets.test.ts` checks the committed file against the script.
