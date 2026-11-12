# Credits for The Winding Road's asset pack

Every folder under `assets/` is one pack and has a section here, checked by `pnpm cli validate`
(`engine/core/content/assets.ts`): its source, author and licence. Only CC0 is allowed unless an
owner decision is cited (docs/DESIGN.md, item 322). Added for Engine 0.16 part E, E7
(2026-11-12), the tower defense's art (docs/ROADMAP.md, "0.16 part E": Kenney Tower Defense).

## kenney-tower-defense

- Source: https://opengameart.org/content/tower-defense-300-tilessprites
  (https://opengameart.org/sites/default/files/Tower%20Defense%20%28top-down%29.zip; Kenney's
  "Tower Defense (top-down)"; kenney.nl blocks automated downloads). The two scaled sheets are
  copied byte for byte from the mini siege's copy of the same pack
  (`games/samples/mini-siege/assets/kenney-tower-defense/`, fetched 2026-11-11 for Engine 0.16
  part F, F8), since games may not import each other.
- Author: Kenney (www.kenney.nl)
- Licence: CC0 1.0 Universal (the pack's `License.txt`, kept as `license.txt`)
- Use: the map's grass, decor, road and build plots, the three tower types at levels 1 to 3, the
  runner (a soldier) and the brute (a tank), the shots (bullets and shells) and the cursor's
  upgrade mark on a selected tower.
- Files (3 PNGs and `license.txt`): `tilesheet-16.png` and `tilesheet-24.png`, the pack's
  `Tilesheet/towerDefense_tilesheet.png` (23 x 13 tiles of 64 px) scaled down to 16 and 24 px
  tiles (a box filter, alpha kept); and `road-art.png`, cut and put together from those two by
  `tools/road-art.ts` (towers as a base and a turret, the frost tower and slowed enemies in ice
  blue, the tank's hull and turret, walk steps, half-alpha placing ghosts, road kerbs, the entry
  and exit), checked byte for byte against the script by `assets.test.ts`.
- Changed: scaled down, cut and recombined as above; no pixel drawn that is not the pack's own
  (the kerb is the pack's dirt darkened).
