# games/samples/rts-skirmish

The first RTS sample (Engine 0.9, `docs/ROADMAP.md`, "0.9 RTS kit and view"): one map, one side
(red: workers, a town centre, a hero) against a scripted raiding party (blue: four soldiers), on
`kits/rts` over an `engine/sim` world. The first folder under `games/samples/`. Since T11 it is
playable and replayable headless (`pnpm cli run`) and drawn by the Canvas2D backend for
screenshots and the backend parity test; since T12 it is played in the browser
(`index.html`, launcher link `games/samples/rts-skirmish/`), and a battle played there exports as
a run file that `pnpm -s cli run` replays to the same state hashes (the 0.9 "done when").
Since Engine 0.15 T14 it is **finished** as **The River Ford** (docs/BUILD-LOG.md, Engine 0.15,
decision 13): sfx for the battle's events and an MML song (`ford`), no placeholder look, an end
for a win and for a loss (the skin's banner over the picture, the page's end screen, the
`battle-end` jingle) and a `lost` run file beside the win. This file is the worked example of an
RTS game on the kit: "How it was built" below is the order to follow for a new one.

## How it was built (the worked example)

1. **`game.json`**: kit `rts`, the picture size, a seed, `headless.ts` and `view.ts`, and the
   content kinds it claims (the kit's `rts-map`, `rts-types`, `rts-enemy`; the engine's
   `palette`, `sprite`, `skin`, `sfx`, `song`).
2. **The world as data**: the map as a world scenario (`content/maps/*.world.json`, the sim's
   format with `"systems": "rts"`), the unit and building types (`content/types/`), the enemy's
   plan (`content/enemy/`). `pnpm -s cli validate games/samples/rts-skirmish --json` after each.
3. **Glue**: `content.ts` (the loaded bundle as map, types, plan, skin), `headless.ts` (the sim
   world behind the kit's `rtsGame` through the sim's `rtsWorldPort`, plus `sides` in the
   snapshot and the game's own end rule, `skirmishResult`), `actions.ts` (interface actions, so
   run files can drive the page's selection and commands).
4. **Run files** (`runs/`): orders recorded with a throwaway script (below), assertions read off
   `pnpm -s cli dump`, sync `hashes` from `run`, then `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`;
   `pnpm -s cli mutants games/samples/rts-skirmish --json` until every kit rule is guarded and no
   run is weak. One run per end: `battle` (a win) and `lost` (a loss).
5. **Art as text**: `content/sprites/*.txt` with its palettes, one frame for every kind, state
   and facing the kit presents (`skirmish.test.ts` fails on a missing one and on any fallback box
   drawn in any tick of any run); bigger pieces such as the end banners were made once by a
   throwaway script and kept as text.
6. **The skin** (`content/skins/canvas2d.json`): kinds to frames (the enemy's kinds in its own
   palette, `sideKinds`), tiles, the HUD, `events` (the kit's `RtsEventTracker` events and the
   game's `battle-end`, each to an sfx and an effect) and the end banners as HUD icons keyed on
   the frame's `won` / `lost` status. No `fallbackColor` but the sheet's own (`#ff00ff`, so a
   missing frame shows).
7. **Sound**: one line of MML per sfx (`content/sfx/`) and one looping song
   (`content/songs/ford.json`, all four channels the same length; the test checks it).
8. **The picture and the page**: `picture.ts` (the kit's `presentWorld` with the tick's events
   and the end status, onto the Canvas2D backend), `view.ts` (for `pnpm cli screenshot`),
   `play.ts` (the page's scene, no DOM) and `main.ts` + `index.html` (the DOM: the shell's boot
   with `audio` and the volume control, the bar, the end screen, the hook for the browser test).
9. **Browser test** (`tests/browser/rts-skirmish.test.ts`): from the games index's link, a whole
   battle by mouse and touch, the end screen, the export replayed headless.

## The rule

Content, skins and thin glue only (DESIGN.md: if two games could use it, it is engine; if it is
content, it is the game). The world's rules (movement, combat, building, training, gathering)
are `engine/sim` systems; the kit turns selection and commands into orders and runs the enemy's
plan. The map, the types, the enemy's plan, the art and the skin are text files; never put map
rows, stats, plan steps or pixel rows in `.ts` files (`tests/architecture/no-content.test.ts`).

## Files

- `game.json`: kit `rts`, 320x240 (decided in T3), seed 9, `headless.ts`, `view.ts`; content kinds
  `rts-map`, `rts-types`, `rts-enemy`, `palette`, `sprite`, `skin`, and since Engine 0.15 T14
  `sfx` and `song`. `index.html` is its page (title "RTS skirmish: The River Ford, ..."): the
  games index lists it and `pnpm build` emits `games/samples/rts-skirmish/index.html`.
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
  `site-2x2-half` (a barracks half built: its walls under the scaffold, Engine 0.15),
  `ghost-2x2` (placing), `gold`/`gold-empty`, `ring` (selection), `hp-0`..`hp-8` and
  `p-0`..`p-8` (bars), `box`, the HUD icons and (Engine 0.15 T14) the end banners `banner-won`
  ("VICTORY", red pennants) and `banner-lost` ("DEFEAT", blue pennants), 160x48, made once by a
  throwaway script and kept as text. `content/palettes/skirmish-blue.json` is the same
  palette with the team colours blue (the enemy). `content/sprites/skirmish-font.txt`: the HUD
  digits.
- `content/skins/canvas2d.json`: every kind the kit presents (`unit:<type>`, `building:<kind>`
  with `idle`, `train`, `site`, `resource:gold`, `selection-ring`, `health-bar`,
  `progress-bar`, `ghost:barracks`, `selection-box`) and the enemy's `unit:<type>:enemy` /
  `building:<kind>:enemy` in the blue palette; unit states `idle`, `walk`, `attack`, `build`,
  `gather`; tiles `0`-`3`; HUD gold, own units and enemy units (icon and number) and (Engine 0.15
  T14) the end banner, `won` / `lost` as `icon` items at 80,96 (the picture's centre). No look
  has a `fallbackColor` of its own (only the sheet's `#ff00ff`, so a missing frame shows).
  `events` (Engine 0.15 T14), keyed by the event's `side` (`type:side=own`): `unit-down` (`fall`
  for own, `slain` for the enemy, with particles in the side's colour), `unit-hit` (`clash`, a
  spark), `unit-ready:side=own` (`ready`), `site-placed:side=own` (`placed`),
  `building-done:side=own` (`built`, a flash), `building-hit:side=own` (`clash`),
  `stock-up:side=own` (`coin`), `battle-end:won` (`victory`, a gold tint) and `battle-end:lost`
  (`defeat`, a red tint); the enemy's training and building are silent. Its
  `background` (`#00a800`, the grass) is what the backend clears to (gap G36). The barracks (both
  sides) have a `byTag` look `{ "prefix": "progress:", "min": 50 }` (gap M2): a site at
  construction progress 50 or more draws `site-2x2-half`, below that the scaffold
  (`skirmish.test.ts` checks both over the `commands` run).
- Sound (Engine 0.15 T14): `content/sfx/` (`ready`, `fall`, `slain`, `clash`, `placed`,
  `built`, `coin`, `victory`, `defeat`; one line of MML each) and `content/songs/ford.json`, "The
  River Ford", an original looping march in G (126 bpm, two pulses, triangle and noise, every
  channel 1536 ticks), played by the page from the first click, tap or key.
- TypeScript is glue:
  - `content.ts`: `loadSkirmish(files)`, `skirmishMap`, `skirmishTypes`, `skirmishEnemy`,
    `skirmishScenario(content, seed)` (the map with the run's seed and the types table spawned
    first: entity 1 is the terrain, 2 the types, then the map's entities in file order),
    `skirmishSkin`, `PLAYER` (`red`), `SKIRMISH_MUSIC` (`ford`).
  - `headless.ts`: `createWorld(content, seed)` (`worldFromScenario`), `createGame(content, seed,
opts?)`: the kit's `rtsGame` with the world behind its port (`engine/sim`'s
    `rtsWorldPort(world)`, the one bridge since Engine 0.15 T6, gap M27), the enemy plan and the switched-off rules, wrapped in `SkirmishGame`. Its
    `order` takes a recorded order or an interface action (below); its snapshot is the kit's
    `{ world, kit }` plus `sides` (the kit's `sidesOf`, re-exported here; it moved to the kit in
    Engine 0.11 T8: per faction `units`, `unitTypes`, finished
    `buildings` by kind, `sites`, `stock`; red and blue always listed, a beaten side empty) and
    `ui.selection`. Engine 0.14 T7: `SkirmishGame` keeps its `world` and gives the optional
    `HeadlessGame` hooks `worldEvents(sinceTick)` (`eventsSince`) and `timeline()`
    (`worldTimeline`) for `pnpm cli events` and `timeline`; the log is never in the snapshot.
    Engine 0.15 T7: `worldKeys()` (the sim's `worldKeys`), for `world.key.<key>` run checks.
    Engine 0.15 T14: `skirmishResult(view)`, the game's end rule: `lost` once red has no unit,
    `won` once no other side has a unit or a building, else null. It reads the view and is kept
    out of the snapshot, so no hash moved; run files check the same through `sides`.
  - `actions.ts`: interface actions (`interfaceActionSchema`, `PlayerInterface`): `click`,
    `box` (world px, `additive`), `command` (a world point), `build`, `train`, `stop`, carried
    out by the kit's `Selection`, `commandAt`, `buildCommand`, `trainCommand`, `stopCommand` with
    the game's rule switch. A run file gives them in `orders` as `{ tick, ui, ... }` next to
    recorded orders; the order one gives is stamped with the next id like a page command. They
    exist so a run can drive the game as the page does and the kit's interface rules can be
    mutant-checked headless.
  - `picture.ts`: `skirmishLook(content)` (skin, the engine's `contentSheets`, size; the grass
    colour is the skin's `background`, Engine 0.15 gap G36), `sideKinds(frame)` (enemy units and buildings get the kind `<kind>:enemy`: a
    skin picks frames by kind only, and the kit tells sides apart by tag), `skirmishFrames(screen,
ui?)` (the engine's `FrameStream` over the kit's `presentWorld` for red; `ui` adds the
    page's selection, box, placing and camera), `skirmishPicture`, `skirmishCanvasPicture(r,
look, ui?, onSound?)`. Since Engine 0.15 T14 each stream's state is a `SkirmishPresentState`
    (the kit's `RtsPresentState`, an `RtsEventTracker` for red and the end seen so far): each frame
    carries the tick's events (none on a second frame of the same tick), a `battle-end` with
    `result` on the tick the battle ends (once per stream), and from then on `won: true` or
    `lost: true` in its status (the banner).
  - `view.ts`: `createView` for `pnpm cli screenshot` and the parity test: `render` (Canvas2D),
    `frame()`, and `order` (the same orders as the headless game). The camera is the map's
    centre.
  - no `files.ts`: `main.ts` imports its data files from `virtual:game-files` (the build's plugin, `build/game-files.ts`; no `files.ts` since Engine 0.14 T2).
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
    refusal; `result()` (Engine 0.15 T14) is `skirmishResult` now. The controls' selection is the page's own: the game's `ui.selection` stays `[]`, as
    in a replay of the recorded orders, so the page's hashes are the replay's.
  - `main.ts`: the DOM: `bootBrowserGame` with Canvas2D (`canvasDisplay` with the shell's
    `onSound`, so the skin's event sounds play), `pointer: true` and `touchPad: false`, `game` and
    `audio` (`contentSongs`, `contentSfx`, music `ford`; Engine 0.15 T14) with the shell's volume
    control and stored volumes (gap M1); Shift for additive selection; the bar under the picture
    (`#bar`: the status line, `#build-<building>`, `#train-<unit>`, `#stop`, `#heroes`,
    `#cancel`, `#export`); the end screen (`#end`, Engine 0.15 T14: `#end-title` "Victory: the
    ford is held" or "Defeat: your side has fallen", `#end-text` with the tick, and `#again`,
    Play again, which reloads the page), opened once when `result()` is first set; the game keeps
    stepping under it, so Export still ends on a hash tick; and `window.wwSkirmish`
    (`SkirmishHook`: `tick`, `sides`, `units`, `buildings`, `selection`, `camera`, `clientAt(wx,
wy)` (world px to client px through the camera and the display's `toClient`, Engine 0.15 gap
    D13), `message`, `result`, `exportRun(game?)`) for the browser test.
- `skirmish.test.ts`: content, the units' numbers against the types, the hero, `sides`,
  determinism, the interface actions of `commands.run.json` recording exactly
  `battle.run.json`'s orders, refusals, `sideKinds`, a sprite frame for every kind, state and
  facing and every tile the battle shows, and the view matching the headless game. Engine 0.15
  T14: the five run files, no look with its own fallback colour, every tick of every run drawn
  through Canvas2D without a fallback box, the song (its channels one length) and an sfx for
  every sound the skin names, the battle's events and sounds (the site, the barracks, the
  soldiers, gold, the fight, the four raiders down, `battle-end:won` once, the `won` status), the
  `lost` run's (every red unit down, `battle-end:lost`, the `lost` status) and `skirmishResult`
  on each run's end.

## Entity ids

1 terrain, 2 types, 3 town centre, 4-6 gold (north, south, east), 7-9 red workers, 10-13 blue
soldiers, 14 the `guard` squad, 15 the hero. New entities count on from 16 (the barracks in the
battle is 16, its soldiers 17-19). Orders name ids, so moving or adding an entity in the map
changes the ids of everything after it: re-record the run files (below).

## Run files

| run        | ticks | what happens                                                                                                                                                                         | guards             |
| ---------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `battle`   | 240   | workers 7 and 8 build a barracks (done by 30), 9 gathers; three soldiers trained (all out by 100); blue raids at 90; hero and soldiers attack at 100; blue beaten by 160             | both enemy rules   |
| `commands` | 240   | the same battle through interface actions (box, click, command, build, train); a box over the blue camp selects nothing                                                              | all five kit rules |
| `hold`     | 200   | no orders: blue camps and holds (red never reaches 7 units), nothing fights                                                                                                          | both enemy rules   |
| `economy`  | 200   | three workers gather, a fourth is trained and gathers, the hero walks to the road's end; gold 250 to 460                                                                             | both enemy rules   |
| `lost`     | 100   | (Engine 0.15 T14) a box over the whole map selects red's three workers and the hero, sent at raider 10 at tick 0; the last falls on tick 79 (red 0 units at 80), three raiders stand | both enemy rules   |

- Every run file carries its sync `hashes` (every 20 ticks) and has golden `<name>.hashes.json`;
  final hashes: `battle` `588fe33bb3ecfcfd`, `commands` `9f8fc0dc11549b95`, `hold`
  `dcf2c02f2cb6d266`, `economy` `34bf04d6b067075d`, `lost` `2cc7b6a08b67cdfd` (new in Engine 0.15
  T14; no other hash moved: the sounds, the end and the art are not in the snapshot).
- Checks read `sides.<faction>.*` (`sides.blue.units`, `sides.red.unitTypes.soldier`,
  `sides.red.buildings.barracks`), `kit.enemy.<step>.fired` / `.last` (the plan's progress),
  `kit.nextOrder` and `ui.selection`; `dump` shows the rest. A world entity is read by scenario
  key (`world.key.worker-3.Gatherer.node`, through the game's `worldKeys()`, Engine 0.15 T7, gap
  M17) or, for one made in play, by id (`world.id.16.Producer.queue.length`), never by its place
  in a component list (`engine/tools/CLAUDE.md`, Keyed paths).
- `pnpm -s cli mutants games/samples/rts-skirmish --json` exits 0 with every kit rule guarded
  and no run weak (`unguarded` and every `runs[].weak` empty). The kit is not strict, so
  `tests/runs/rts-skirmish-mutants.test.ts` holds the sample to that. A switched-off rule usually
  changes a sync hash first, and a hash mismatch stops the run without counting as a failed
  check, so every guard needs an assertion or invariant that fails before the first changed hash
  (tick 20): `kit.enemy.raid.fired` 0 at tick 1 or as an invariant (`enemy-waits-for-trigger`),
  `kit.enemy.camp.fired` 1 at tick 1 (`enemy-follows-plan`), and in `commands` worker 9 gathering
  node 5 at tick 1 and workers 7 and 8 node 4 at tick 31 (`world.key.worker-3.Gatherer.node`,
  `world.key.worker-1.Gatherer.node`, `command-gathers-resources`) and the hero's `Target` on
  raider 10 at tick 101 (`world.id.15.Target.entity`, `command-attacks-enemies`).
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
- **Sound**: the song starts with the first click, tap or key; the shell's mute button and
  volume slider (top right) keep the player's volumes in this browser.
- **The end**: when the raiders are beaten (or your last unit falls) the picture shows the
  banner, the jingle plays and the end screen opens with Play again.
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
the games index lists it as The River Ford and its link opens it, the volume control, a battle by
mouse and touch, the end screen on the win, the export replayed with `pnpm -s cli run`; skipped
where Chromium is missing). `tests/build/pages.test.ts` checks the launcher and the build
inputs list the page.

## Imports

- Allowed: relative paths inside this folder, `@engine/core/*`, `@engine/sim/*` (the glue
  builds the world), `@engine/backends/*` and `@kits/rts`.
- Never: other games or kits it does not use. Nothing in `engine/` or `kits/` imports from here.
