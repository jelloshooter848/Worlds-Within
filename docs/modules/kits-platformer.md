# kits/platformer

Folder: `kits/platformer`. Detailed rules: [`kits/platformer/CLAUDE.md`](../../kits/platformer/CLAUDE.md).

## Purpose

Gameplay rules for a side-scrolling platformer (Engine 0.5), extracted from SMBC as rules only,
with generic names and no SMBC content. Today it holds the kit's content kinds: `level` (a JSON
header plus a `.map.txt` text grid of the kit legend) and `profile` (physics numbers in whole
sub-pixel and 1/4096 px per tick units, and actor types such as `walker` and `shell` whose
behaviour is set by data), and a headless world (`PlatformerWorld`) that moves the player over a
level with SMBC-style whole-number physics and named, switchable movement rules, with a JSON-safe
snapshot and `platformerGame(world)` for the headless contract. Level objects, enemies, the mini
game hook and presentation frames follow later in 0.5. It never draws and holds no content beyond tiny test fixtures.

## Public API entry points

`index.ts`, imported as `@kits/platformer`, re-exports `legend` (`LEGEND`, the level text format),
`level` (`levelSchema`, `LevelDef`, `levelCells`, `levelSize`, `checkLevel`), `profile`
(`profileSchema`, `ProfileDef`, `profileKind`, `SUB`, `VEL`), `schema` (`levelKind`), `rules`
(`PLATFORMER_RULES`), `tiles` (`TileGrid`), `body` (`Body`, `moveX`, `moveY`), `player`
(`Player`), `world` (`PlatformerWorld`, `PlatformerEvent`) and `snapshot` (`snapshotWorld`,
`platformerGame`). `kit.ts` exports `kit`, the kit's hook for the tools (name `platformer`,
kinds `level` and `profile`, its named rules, `strictMutants: true`); `engine/tools/kits.ts` finds
it by the `kit` name in `game.json`.

## Imports allowed

- `kits/platformer` itself and `@engine/core/*` except its drawing and output side
  (`FORBIDDEN_CORE` in `config/layers.js`).
- Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits or games. No drawing calls, no
  `Math.random`, wall-clock time or DOM globals, no content outside `__fixtures__/`.

## How to test

`pnpm test kits/platformer` runs the schema tests and loads the fixture level and profile
(`kits/platformer/__fixtures__/`) through the kit's hook; `world.test.ts` covers the movement rules (each switched off must fail a
case), determinism and whole-number snapshots; `golden.test.ts` replays six scripted inputs and
must match SMBC's recorded player positions and velocities at every tick (the traces and their
provenance are in `kits/platformer/__fixtures__/golden/`; SMBC is not needed to run it). `pnpm docs:gen` keeps the kinds in
`docs/reference/schemas.md`; the architecture tests (`tests/architecture/`) check its imports,
drawing calls, content and agent docs.
