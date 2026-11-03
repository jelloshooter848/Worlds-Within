# kits/towerdefense fixtures

Test-only content (`engine/core/CLAUDE.md`, Fixtures): only tests read these.

- `game/`: a tiny game folder on the kit (no headless module: `validate` only reads content).
  `content/maps/tiny.json` + `tiny.map.txt` is a 6x4 map whose path bends from the entry (top
  left) down to the exit (right), with three build cells beside it, 30 gold and 3 lives;
  `content/towers.json` has a cheap short `arrow` and a dear `cannon` (sell value given);
  `content/waves/tiny.json` has two waves (two runners; a brute then two runners with jitter) and
  a 40-tick timer.
- `bad/`: the same game broken twice: `start.lives` is 0 (a schema error in `tiny.json`) and the
  path stops short of the exit (`path_broken` in `tiny.map.txt`, row 2).

`tests/kits/towerdefense-validate.test.ts` runs `pnpm cli validate` on both.

`game.ts` (tests only) loads `game/` as a game would (`fixtureContent()`) and gives its round
(`fixtureRound()`, through `tdRound`), for the presentation, controls and headless game tests.
`mission-defence.test.ts` and `tests/kits/td-mission.test.ts` play the `td-defence` mission on
the tiny map (`fixtureRound()`); the world and mission they play it over are in
`tests/kits/__fixtures__/` (`walls.world.json`, `fortify.mission.json`).
