# games/samples/rts-skirmish

The first RTS sample (Engine 0.9, `docs/ROADMAP.md`, "0.9 RTS kit and view"): one map, one side
(red: workers, a town centre, a hero) against a scripted raiding party (blue: four soldiers), on
`kits/rts` over an `engine/sim` world. The first folder under `games/samples/`. Since T11 it is
playable and replayable headless (`pnpm cli run`) and drawn by the Canvas2D backend for
screenshots and the backend parity test; since T12 it is played in the browser
(`index.html`, launcher link `games/samples/rts-skirmish/`), and a battle played there exports as
a run file that `pnpm -s cli run` replays to the same state hashes (the 0.9 "done when").

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The world's rules (movement, combat, building, training, gathering)
are `engine/sim` systems; the kit turns selection and commands into orders and runs the enemy's
plan. The map, the types, the enemy's plan, the art and the skin are text files; never put map
rows, stats, plan steps or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).

## Files

- `game.json`: kit `rts`, 320x240 (decided in T3), seed 9, `headless.ts`, `view.ts`; content kinds
  `rts-map`, `rts-types`, `rts-enemy`, `palette`, `sprite`, `skin`. `index.html` is its page:
  the launcher lists it and `pnpm build` emits `games/samples/rts-skirmish/index.html`.
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
    `{ world, kit }` plus `sides` (the kit's `sidesOf`, re-exported here; it moved to the kit in
    Engine 0.11 T8: per faction `units`, `unitTypes`, finished
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
  - `files.ts` (browser only): the data files bundled as text (`import.meta.glob`, `?raw`).
  - `recording.ts`: `BattleRecorder(seed, hashEvery = 20)`: `reached(tick, snapshot)` (after
    every step, and at tick 0: a hash tick's snapshot is taken before that tick's orders, where
    `run` hashes it), `runFile(recorded, game = '..')` (the battle as a run file `{ game, seed,
ticks, orders, hashEvery, hashes }`, ending at the last hash tick, with the orders applied
    before it; null before tick 20). `stateHashOf(json)` is the tools' state hash through Web
    Crypto (`crypto.subtle`, so the page needs no Node).
  - `play.ts`: `SkirmishPlay`, the page's `Scene` (no DOM, no clock): the `SkirmishGame`, an
    `RtsCamera` over the whole map starting on the player's base, the kit's `RtsControls`
    (sharing the game's rule switch) and the recorder. Each loop step it carries out the bar's
    buttons (`press`: `build`, `train`, `stop`, `heroes`, `cancel`) and the pointer's gestures
    (an order goes to `RtsGame.issue`), hovers the placing ghost, and every `STEPS_PER_TICK` (6)
    steps the game one tick (`TICKS_PER_SECOND` 10 on the page; the tools play ticks as fast as
    they can). `buttons()` is what the bar shows (`build` for selected builders, `train` from
    the kit's `trainButtons`, `stop`, `placing`); `exportRun(game?)`; `message` is the last
    refusal. The controls' selection is the page's own: the game's `ui.selection` stays `[]`, as
    in a replay of the recorded orders, so the page's hashes are the replay's.
  - `main.ts`: the DOM: `bootBrowserGame` with Canvas2D (`canvasDisplay`), `pointer: true` and
    `touchPad: false`; Shift for additive selection; the bar under the picture (`#bar`: the
    status line, `#build-<building>`, `#train-<unit>`, `#stop`, `#heroes`, `#cancel`,
    `#export`), and `window.wwSkirmish` (`SkirmishHook`: `tick`, `sides`, `units`,
    `buildings`, `selection`, `camera`, `clientAt(wx, wy)` (world px to client px through the
    camera and the display), `message`, `exportRun(game?)`) for the browser test.
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
  and no run weak (`unguarded` and every `runs[].weak` empty). The kit is not strict, so
  `tests/runs/rts-skirmish-mutants.test.ts` holds the sample to that. A switched-off rule usually
  changes a sync hash first, and a hash mismatch stops the run without counting as a failed
  check, so every guard needs an assertion or invariant that fails before the first changed hash
  (tick 20): `kit.enemy.raid.fired` 0 at tick 1 or as an invariant (`enemy-waits-for-trigger`),
  `kit.enemy.camp.fired` 1 at tick 1 (`enemy-follows-plan`), and in `commands` worker 9 gathering
  node 5 at tick 1 and workers 7 and 8 node 4 at tick 31 (`world.components.Gatherer.<i>.1.node`,
  `command-gathers-resources`) and the hero's `Target` on raider 10 at tick 101
  (`world.components.Target.4`, `command-attacks-enemies`).
- Recording a battle: play it with the kit's commands in a throwaway script (`createGame`, then
  `game.rts.issue(draft)` or `game.order({ ui: ... })` at the ticks wanted, `game.step`), print
  `game.rts.recorded()` into the run file's `orders`, read the assertions off `dump`, copy the
  run's `hashes` in, then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.

## Playing in the browser

`pnpm dev`, then `games/samples/rts-skirmish/` from the launcher (or `pnpm build && pnpm
preview`). The picture is 320x240 over a 640x384 map; the bar under it holds the buttons.

- **Mouse**: left click selects one thing (own unit first, else any unit, else a building; empty
  ground clears), a left drag boxes your units, Shift adds to the selection, right click
  commands (an enemy: attack; gold with workers selected: gather; else move). The wheel zooms
  (0.5 to 2, about the cursor), a middle drag pans, and the cursor at the picture's edge scrolls.
- **Touch**: a tap selects, a one-finger drag boxes, a long-press (half a second) commands, two
  fingers pan and pinch-zoom. There is no on-screen pad.
- **Bar**: with workers selected, `Build <building>`, then click (tap) the north-west cell to
  place it (right click or `Cancel` stops placing); with a finished building selected, `Train
<unit>` queues one (the town centre trains workers, the barracks soldiers); `Stop`; `Hero`
  selects Wren alone. The status line shows the tick, the result once a side is beaten and the
  last refused order's reason (not enough gold, a blocked site).
- A battle: box workers 7 and 8 (just east of the town centre), build a barracks east of them, send
  worker 9 to the southern gold, select the finished barracks and train three soldiers; once red
  has 7 units blue raids; box the soldiers, Shift+click the hero and right click a raider.

## Exporting and replaying a battle

`Export` downloads the battle so far as `skirmish-t<tick>.run.json` (ending at the last tick that
is a multiple of 20, with the orders before it and the page's sync hashes, every 20 ticks). Save
it in `runs/` (its `game` is `..`) and replay it headless:
`pnpm -s cli run games/samples/rts-skirmish/runs/skirmish-t140.run.json --json` passes with
`hashesChecked` equal to the file's hashes and no `hashMismatch`. Any `hashMismatch` means the
page and the headless game played differently. Add assertions (from `dump`) and a golden
`.hashes.json` before keeping one as a run file of the game. A script reads the same with
`await window.wwSkirmish.exportRun()`.

## How to test

`pnpm test games/samples/rts-skirmish`, `pnpm -s cli validate games/samples/rts-skirmish --json`,
`pnpm -s cli run games/samples/rts-skirmish/runs/battle.run.json --json` (any run file),
`pnpm -s cli mutants games/samples/rts-skirmish --json`, `pnpm test tests/runs` (golden hashes;
backend parity plays every run through the view's `frame()` into the null backend and `render`
into Canvas2D), `pnpm -s cli screenshot games/samples/rts-skirmish/runs/battle.run.json --tick 140
--json` (the fight at the southern ford; `matchesHeadless` true). `play.test.ts`: the recorder
hashes as `run` does and gives `battle.run.json`'s hashes for its orders; `SkirmishPlay` driven
by scripted gestures and buttons builds, trains and beats the raid, and its export replays to its
hashes. The page itself: `pnpm vitest run tests/browser/rts-skirmish.test.ts` (headless Chromium:
the launcher lists it, a battle by mouse and touch, the export replayed with `pnpm -s cli run`;
skipped where Chromium is missing). `tests/build/pages.test.ts` checks the launcher and the build
inputs list the page.

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world), `@engine/backends/*` and `@kits/rts`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
