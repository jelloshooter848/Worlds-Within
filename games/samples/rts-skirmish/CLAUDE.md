# games/samples/rts-skirmish

The first RTS sample (Engine 0.9, `docs/ROADMAP.md`, "0.9 RTS kit and view"): one map, one side
(red: workers, a town centre, a hero) against a scripted raiding party (blue: four soldiers), on
`kits/rts` over an `engine/sim` world. The first folder under `games/samples/`. Since T11 it is
playable and replayable headless (`pnpm cli run`) and drawn by the Canvas2D backend for
screenshots and the backend parity test; T12 adds the browser page and a recording from it.

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The world's rules (movement, combat, building, training, gathering)
are `engine/sim` systems; the kit turns selection and commands into orders and runs the enemy's
plan. The map, the types, the enemy's plan, the art and the skin are text files; never put map
rows, stats, plan steps or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).

## Files

- `game.json`: kit `rts`, 320x240 (decided in T3), seed 9, `headless.ts`, `view.ts`; content kinds
  `rts-map`, `rts-types`, `rts-enemy`, `palette`, `sprite`, `skin`. No `index.html` yet (T12), so
  the launcher and `pnpm build` do not list it.
- `content/maps/skirmish.world.json` (`rts-map`): a world scenario (`engine/sim` format,
  `"systems": "rts"`), 40x24 cells of 16 px (larger than the 20x15-cell picture): grass (`.`),
  dirt roads (`,`), rock (`#`, impassable) and a river (`~`, impassable) down columns 19-20 with
  two fords (rows 4-6 and 15-17). Terrain types are numbered in sorted character order: 0 rock,
  1 dirt, 2 grass, 3 water (the skin's `tiles` keys). Entities: red's town centre (3x3 at 3,9,
  the stockpile with 250 gold, trains workers), three gold nodes (8,6 and 8,15 with 300; 30,12
  with 500), three red workers, four blue soldiers (36-37, 10-11) and the `guard` squad with one
  named member, the hero Wren (`role: hero`, unit type `hero`, at 5,13). Every unit and building
  carries its type's numbers (the sim needs them in the components); `skirmish.test.ts` fails when
  they drift from the types file. The map holds no `RtsTypes`: the glue adds it.
- `content/types/skirmish.json` (`rts-types`): `worker` (gathers 5 at a time, builds at 2 work a
  tick, 50 gold, 25 ticks), `soldier` (30 hp, hits 4 every 3 ticks, 50 gold, 20 ticks), `hero`
  (80 hp, hits 6; trained nowhere), `town-centre` (3x3, drop-off, trains workers) and `barracks`
  (2x2, 100 gold, 60 work: 15 ticks for two workers, trains soldiers).
- `content/enemy/raiders.json` (`rts-enemy`): blue's plan: `camp` (tick 0: walk to a cell drawn
  from the box 32-34, 10-12), `raid` (once red has 7 units or more: attack the nearest red unit,
  again every 20 ticks while that holds) and `press` (from tick 400, every 20 ticks: attack
  anyway, so a player who never builds is raided too).
- Art, all text: `content/sprites/skirmish.txt` (palette `content/palettes/skirmish.json`): tiles
  (`grass`, `dirt`, `water`, `rock`), the three unit types in three facings (`down`, `up`,
  `right`; the skin mirrors `right` for `left`, and a diagonal uses its horizontal part, the
  four-way choice the task allows) with two walking steps each, `town-centre` (48x48),
  `barracks` (32x32), `site-3x3` and `site-2x2` (scaffolds for a building under construction),
  `ghost-2x2` (placing), `gold`/`gold-empty`, `ring` (selection), `hp-0`..`hp-8` and
  `p-0`..`p-8` (bars), `box` and the HUD icons. `content/palettes/skirmish-blue.json` is the same
  palette with the team colours blue (the enemy). `content/sprites/skirmish-font.txt`: the HUD
  digits.
- `content/skins/canvas2d.json`: every kind the kit presents (`unit:<type>`, `building:<kind>`
  with `idle`, `train`, `site`, `resource:gold`, `selection-ring`, `health-bar`,
  `progress-bar`, `ghost:barracks`, `selection-box`) and the enemy's `unit:<type>:enemy` /
  `building:<kind>:enemy` in the blue palette; unit states `idle`, `walk`, `attack`, `build`,
  `gather`; tiles `0`-`3`; HUD gold, own units and enemy units (icon and number).
- TypeScript is glue:
  - `content.ts`: `loadSkirmish(files)`, `skirmishMap`, `skirmishTypes`, `skirmishEnemy`,
    `skirmishScenario(content, seed)` (the map with the run's seed and the types table spawned
    first: entity 1 is the terrain, 2 the types, then the map's entities in file order),
    `skirmishSkin`, `PLAYER` (`red`).
  - `headless.ts`: `createWorld(content, seed)` (`worldFromScenario`), `createGame(content, seed,
opts?)`: the kit's `rtsGame` with the world behind its port (`applyOrder`, `step`,
    `snapshot`), the enemy plan and the switched-off rules, wrapped in `SkirmishGame`. Its
    `order` takes a recorded order or an interface action (below); its snapshot is the kit's
    `{ world, kit }` plus `sides` (`sidesOf`: per faction `units`, `unitTypes`, finished
    `buildings` by kind, `sites`, `stock`; red and blue always listed, a beaten side empty) and
    `ui.selection`.
  - `actions.ts`: interface actions (`interfaceActionSchema`, `PlayerInterface`): `click`,
    `box` (world px, `additive`), `command` (a world point), `build`, `train`, `stop`, carried
    out by the kit's `Selection`, `commandAt`, `buildCommand`, `trainCommand`, `stopCommand` with
    the game's rule switch. A run file gives them in `orders` as `{ tick, ui, ... }` next to
    recorded orders; the order one gives is stamped with the next id like a page command. They
    exist so a run can drive the game as the page does and the kit's interface rules can be
    mutant-checked headless.
  - `picture.ts`: `skirmishLook(content)` (skin, the engine's `contentSheets`, size, grass
    background), `sideKinds(frame)` (enemy units and buildings get the kind `<kind>:enemy`: a
    skin picks frames by kind only, and the kit tells sides apart by tag), `skirmishFrames(screen,
ui?)` (the engine's `FrameStream` over the kit's `presentWorld` for red; `ui` adds the
    page's selection, box, placing and camera), `skirmishPicture`, `skirmishCanvasPicture`.
  - `view.ts`: `createView` for `pnpm cli screenshot` and the parity test: `render` (Canvas2D),
    `frame()`, and `order` (the same orders as the headless game). The camera is the map's
    centre.
- `skirmish.test.ts`: content, the units' numbers against the types, the hero, `sides`,
  determinism, the interface actions of `commands.run.json` recording exactly
  `battle.run.json`'s orders, refusals, `sideKinds`, a sprite frame for every kind, state and
  facing and every tile the battle shows, and the view matching the headless game.

## Entity ids

1 terrain, 2 types, 3 town centre, 4-6 gold (north, south, east), 7-9 red workers, 10-13 blue
soldiers, 14 the `guard` squad, 15 the hero. New entities count on from 16 (the barracks in the
battle is 16, its soldiers 17-19). Orders name ids, so moving or adding an entity in the map
changes the ids of everything after it: re-record the run files (below).

## Run files

| run        | ticks | what happens                                                                                                                                                             | guards             |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `battle`   | 240   | workers 7 and 8 build a barracks (done by 30), 9 gathers; three soldiers trained (all out by 100); blue raids at 90; hero and soldiers attack at 100; blue beaten by 160 | both enemy rules   |
| `commands` | 240   | the same battle through interface actions (box, click, command, build, train); a box over the blue camp selects nothing                                                  | all five kit rules |
| `hold`     | 200   | no orders: blue camps and holds (red never reaches 7 units), nothing fights                                                                                              | both enemy rules   |
| `economy`  | 200   | three workers gather, a fourth is trained and gathers, the hero walks to the road's end; gold 250 to 460                                                                 | both enemy rules   |

- Every run file carries its sync `hashes` (every 20 ticks) and has golden `<name>.hashes.json`;
  final hashes: `battle` `588fe33bb3ecfcfd`, `commands` `9f8fc0dc11549b95`, `hold`
  `dcf2c02f2cb6d266`, `economy` `34bf04d6b067075d`.
- Checks read `sides.<faction>.*` (`sides.blue.units`, `sides.red.unitTypes.soldier`,
  `sides.red.buildings.barracks`), `kit.enemy.<step>.fired` / `.last` (the plan's progress),
  `kit.nextOrder` and `ui.selection`; `dump` shows the rest (`world.components.<Kind>.<i>.1`).
- `pnpm -s cli mutants games/samples/rts-skirmish --json` exits 0 with every kit rule guarded
  (the kit is not strict, but nothing is weak here).
- Recording a battle: play it with the kit's commands in a throwaway script (`createGame`, then
  `game.rts.issue(draft)` or `game.order({ ui: ... })` at the ticks wanted, `game.step`), print
  `game.rts.recorded()` into the run file's `orders`, read the assertions off `dump`, copy the
  run's `hashes` in, then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.

## How to test

`pnpm test games/samples/rts-skirmish`, `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json` (any run file),
`pnpm -s cli mutants games/samples/rts-skirmish --json`, `pnpm test tests/runs` (golden hashes;
backend parity plays every run through the view's `frame()` into the null backend and `render`
into Canvas2D), `pnpm -s cli screenshot games/samples/rts-skirmish/runs/battle.run.json --tick 140
--json` (the fight at the southern ford; `matchesHeadless` true).

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world), `@engine/backends/*` and `@kits/rts`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
