# engine/tools

Folder: `engine/tools`. Detailed rules: [`engine/tools/CLAUDE.md`](../../engine/tools/CLAUDE.md).

## Purpose

The command-line tools for agents and people: `pnpm cli <command> [arguments] [flags]`. Today it
validates a game's content, plays run files headless (seeded scripted input, tick assertions,
invariants, state hashes), writes replay files for failing runs, dumps the state at a tick and
edits content files (`get`, `set`, `add`, `remove`, `paste`, every write checked and verified) and runs
mutant checks (`mutants`: does a run fail when a kit rule is switched off?), and takes
deterministic screenshots of a run at a tick in headless Chromium (`screenshot`), and from
Engine 0.16 labelled sheets of several of them in one PNG (`sheet`). From Engine 0.10
a world run file also drives missions (`open`, `delegate`, `play`, `quit`), and `validate` checks
mini game params and `campaign` files against the content. From Engine 0.13 a game run file may
start from another run's end or a save code (`from`) and assert save codes (`codes`), and
`pnpm cli code <run-file>` prints a run's save code.

## Public API entry points

- Generated reference: [CLI reference](../reference/cli.md) (every command's help) and
  [schema reference](../reference/schemas.md) (every file format, each kit's `game.json`
  options, and from Engine 0.15 T11 a params page per mini game a game defines under
  `docs/reference/mini-games/`, `mini-game-docs.ts`, gap M11), plus the tables in the
  [cheat sheet](../CHEATSHEET.md). `pnpm docs:gen` writes them; `pnpm docs:check` (and `pnpm test`)
  fails when they are out of date.
- `pnpm cli help [command]`: the commands, global flags and exit codes, generated from the command
  schemas. `<command> --help` shows one command.
- `pnpm cli validate <game>`: checks `game.json` and every content file against its schema
  (starts nothing). From Engine 0.10 (gap G16) it also checks every level trigger's and mission's
  mini game id and `params` against the defs the game's headless module exports as
  `miniGames(content)` (`unknown_mini_game`, or the def's `paramsSchema` errors at
  `triggers.0.params.goal`, and from Engine 0.11 the def's `checkUse` problems as `bad_mini_game_use`;
  `mini-game-check.ts`). `--json` result:
  `{ ok, command: 'validate', exitCode, game, fileCount, errorCount, files: [{ file, errors }], errors }`,
  each error `{ file, path, pointer, message, code, row?, col?, line? }`.
- `pnpm cli run <run-file>`: plays a run file (`games/<game>/runs/<name>.run.json`; schema and
  format in `engine/tools/run-file.ts` and `engine/tools/CLAUDE.md`) headless from its seed with its
  scripted input, checking invariants every tick and assertions at their tick. `--json` result:
  `{ ok, command: 'run', exitCode, run, game, world, seed, ticks, lastTick, passed, checks, failure,
failures, hashes: [{ tick, hash }], finalHash, orders, ordersPlayed, refusedOrders, missions,
missionsPlayed, refusedMissions, experience, hashesChecked, hashMismatch, from, start, codes, codesChecked, replayFile, replay }`; `failure` names the first failing tick, the check, `expected`
  and `actual`. Exit 0 passed, 4 failed check or sync hash, 3 invalid run file or content.
- Campaign runs and save codes (Engine 0.13, decision 9): a game run file's `from` is
  `{ "run": "<run file>" }` (played first; this run starts from its game's campaign save at its
  last tick) or `{ "code": "<save code>" }` (decoded, refused with its code at `from.code`), and
  `codes: [{ tick, code }]` the save codes the game's campaign save must give (a different one fails
  like an assertion, kind `code`). `pnpm cli code <run-file> [--tick N]` prints
  `{ run, game, seed, start, tick, hash, code, save }`. The game implements `HeadlessGame.campaignSave()`
  and reads `HeadlessOptions.campaign`.
- Start levels and entries (Engine 0.14, gap G9, decision 6): a game run file's `start` is
  `{ "stage": n }` (a level of the game's level sequence, 0-based) or `{ "entry": "<id>" }` (a
  campaign entry, fresh, no carried record): tick 0 is that level's or entry's first state, so a
  later level's run file does not replay the earlier levels. It is checked first against the
  headless module's `starts(content)` (`no_start` at `start`, `bad_start` at `start.stage` /
  `start.entry`, exit 3), is a schema error with `from` or on a world run, reaches the game as
  `HeadlessOptions.start`, and `run`, `dump`, `trace`, `code`, `screenshot` and replay files keep
  it (results carry `start`).
- Recorded orders and sync hashes (Engine 0.9, lockstep replay): a run file's `orders` lists
  `{ tick, ...order }` entries in tick order (same tick: ascending `id`), each applied after its
  tick's state and before the step from it (a world: `applyOrder`; a game: its
  `HeadlessGame.order`, a usage error when it has none). Orders the world or game drops are listed
  in `refusedOrders`, not failures. `hashes: [{ tick, hash }]` are sync hashes `run` compares; the
  first that differs stops the run (exit 4) with `hashMismatch: { tick, expected, actual,
lastMatch }`. Malformed orders, ticks out of order or at/after `ticks`, and repeated ids are
  schema errors naming the entry (`orders.3.target.x`). `dump` and replay files carry the orders.
  Sample: `engine/sim/__fixtures__/battle.run.json` (`engine/tools/CLAUDE.md`, Recorded orders).
- Missions in world runs (Engine 0.10, item 161): a world run file's `missions` lists `{ tick,
mission, action: open | delegate | play | quit, outcome?, experienceTicks? }` steps in tick order,
  applied after that tick's orders and before the step from it; the world then settles after every
  step (`settleMissions`), so each mission commits by itself at open tick + `worldTimeCost` and
  scenario opportunities open and close on time. Definitions are `<id>.mission.json` beside the
  scenario (or in its `missions/` folder), checked as the `mission` content kind (errors name that
  file and field); effects name entities by the scenario's keys (`scenarioKeys`). Refused steps are
  listed in `refusedMissions` (`{ tick, mission, action, code, error }`), not failures; a `play` or
  `quit` at or after its commit tick is a `mission_unresolved` content error. `experienceTicks` are
  reported in `experience` and never reach the world, so they cannot change a hash. Samples:
  `engine/sim/__fixtures__/raid-*.run.json`, `opportunity-closing`, `frozen-construction`,
  `fixed-cost-few`/`-many` (`engine/tools/CLAUDE.md`, Missions in world runs).
- Missions in game runs (Engine 0.11, item 172): a game run file's `missions` are `{ tick,
mission, action, input? }`; each goes, without `tick`, to the game's `HeadlessGame.mission(step)`
  after that tick's orders (a game without it is a usage error). `play` starts the real kit round,
  with `input` its own recorded script; the run's next ticks play it. `outcome` and
  `experienceTicks` are schema errors on a game run (and `input` on a world run); refusals are
  listed in `refusedMissions` and `experience` is the game's `missionExperience()`
  (`engine/tools/CLAUDE.md`, Missions in game runs).
- World runs (Engine 0.8): a run file with `world` (a `*.world.json` scenario, relative to the
  run file) instead of `game` plays that `engine/sim` world with the system set its scenario
  names in `systems` (`village`, the 0.8 haul/build/patrol set, by default; `rts` for RTS battles;
  `world-run.ts`, `SYSTEM_SETS` in `engine/sim`); exactly one of the two, else a schema error. No
  input, `disableRules` or `guards` (schema errors); only an `rts` world takes `orders`; `seed`
  replaces the scenario's. `run`, `dump`, hashes and replays work as for a game, on `World.snapshot()`
  (paths like `components.Construction.0.1.done`); results give `world` (and `game: null`).
  `mutants` and `screenshot` refuse a world run (exit 2). Sample:
  `engine/sim/__fixtures__/village-build.run.json`.
- Replay files: a failing `run` writes `.ww-out/replays/<name>-t<tick>-<hash>.run.json` (path in
  `replayFile`), a run file with the seed, the input and checks up to the failing tick, and a
  `replay` block (`source`, `failure`, `hashes`). Running it fails at the same tick; `run` also
  compares the stored hashes and reports `replay.hashMismatch: { tick, expected, actual }` for the
  first one that differs. Format: `engine/tools/CLAUDE.md` (Replay files).
- `pnpm cli run <run-file> --disable-rule <ids>` plays it with kit rules switched off
  (comma-separated; a run file can also list them in `disableRules`); the result's
  `disabledRules` names them. A rule of a kit the game `uses` is written `kit:id`
  (`topdown:walls-block-movement`); a bare id is the game's own kit's.
- `pnpm cli mutants <run-file>`: plays the run as it is, then once per named rule of every kit the
  game uses with that rule off. `--json` result: `{ run, game, kit, strict, kits: [{ kit, strict,
rules }], baseline: { passed, failure }, guards, rules: [{ id, kit, strict, description, skipped,
expected, passed, guarded, failure }], guarded, weak }`; `weak` lists the rules the run is
  expected to guard (its `guards`, else every rule of the game's own kit) and still passes without
  (text: `weak: does not guard <id>`). Exit 0 when the run passes as it is, 4 when it does not, or
  when a weak rule's kit is strict (`strictMutants: true`): each rule is judged by its own kit.
  `pnpm cli mutants games/<game>` does this for every run file of the game and reports which run
  files guard each rule (`rules[].guardedBy`, `unguarded`, per kit `kits[].unguarded`); exit 4 for
  a strict own kit with an unguarded rule (a `uses` kit's unguarded rules are only reported).
  Details: `engine/tools/CLAUDE.md` (Mutant checks).
- `pnpm cli dump <run-file> --tick N [--out file.json]`: `{ run, game, world, seed, tick, hash, state, orders,
missions }`, the whole snapshot (a game's or a world's) at tick N and the recorded orders and
  mission steps applied before it. `--out` (Engine 0.14 T7) also writes a dump file for the
  debugger: `{ format: "worlds-within/dump", version: 1, ..., events, timeline }`, paths relative
  to it, the world's event log and timeline there (null for a game with no world); read it back
  with `parseDumpFile` / `dumpFileSchema` (`dump-file.ts`, no Node imports).
- `pnpm cli events <run-file> [--from N] [--to M] [--entity id] [--cause c] [--component name]`
  (Engine 0.14 T7): the world's event log, every kept change `{ tick, cause, op, entity,
component?, before?, value? }` in world ticks N to M, filtered by entity, cause (`mission`
  matches `mission:sabotage`) and component; `events` a top-level array the cap halves.
- `pnpm cli timeline <run-file> [--tick N]` (Engine 0.14 T7): the world's timeline record
  (`worlds-within/timeline`, `engine/sim/timeline.ts`): world tick, a game run's `clock` (world
  tick per game tick, run-length), frozen spans, experience per mission, opportunity windows with
  their status history, missions opened and committed, plus `entries`, the happenings by world
  tick with the game tick each fell on. A game run gives its world through the optional
  `HeadlessGame` hooks `worldEvents(sinceTick)` and `timeline()` (a `MissionHost` has them via
  `missionPort`); a game without them is exit 3, `no_world` at `headless`. A world run is played
  with its event log on. No hash moves: the log is never in a snapshot.
- `pnpm cli record <run-file> --mission <id> (--input <recording.json> | --bot <plan>) [--play N]`
  (Engine 0.14 T9, gap M19): writes a hosted round's recorded input into the run file's `play`
  step for that mission through the editing verbs' checked path, then plays the run: `{ run,
mission, play, tick, source, ticks, steps, input, written, verified, changed, restored, passed,
finalHash, hashMismatch, failure }`. `--input` takes what the page's `window.__ww.recordings()`
  gives (the list or one entry) or a bare `{ steps }` script; `--bot` plays the round headless
  with the kit's bot (`KitDef.roundBots`: `TopDownBot` for `mission-room`, `TdBot` for
  `td-defence`; the plan as JSON or `@file`) and records it. Exit 0 written and passing; 4 the
  run fails with it (the file is put back, `restored: true`); 3 a recording that breaks the
  schema (file untouched); 2 a mission with no play step, another mission's or tick's recording,
  a bad plan.
- `pnpm cli trace <run-file> --paths a,b [--from N] [--to M] [--every K]` (Engine 0.14, G8): a
  few snapshot paths over a range of ticks in one call: `{ run, game, world, seed, from, to, every,
paths, rows: [{ tick, hash, values }], missing, orders, missions }`, played like `dump` (game or
  world runs). A missing path is null and listed in `missing`; the cap halves `rows`; text mode is
  an aligned table. Bad paths or ticks exit 2, a bad run file or content exit 3.
- `pnpm cli debug <file> [--tick N] [--port P] [--check]` (Engine 0.14 T10): the in-browser
  simulation debugger on a run, replay or dump file, a tools-only page with its own module page,
  [engine/tools/debugger](engine-tools-debugger.md). Serves it and prints `{ url, file, kind, game,
ticks, openTick, serving }` (staying up until stopped); `--check` opens it in headless Chromium at
  the tick and adds `{ tick, hash, headlessHash, matchesHeadless, mismatch, eventCount }`, exit 4
  on a mismatch.
- `pnpm cli screenshot <run-file> --tick N [--out path] [--backend canvas2d|three|pixi]
[--allow-software-gl]`: plays the run in headless Chromium
  through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and the canvas2d
  backend, drawing every tick on the way, and writes the frame at tick N as a PNG of the game's picture size (`screen` in
  `game.json`, 256x240 by default; default
  `.ww-out/screenshots/<name>-t<N>.png`). `--json` result: `{ ok, command: 'screenshot', exitCode,
run, game, seed, start, tick, backend, renderer, path, width, height, bytes, sha256, hash, headlessHash,
hashes, matchesHeadless }` (`hashes`: the state hashes the page saw; all must be the headless run's).
  A run's `from` (Engine 0.13 T8) starts the view at the same campaign save `run` starts from.
  Two runs in a row give byte-identical PNGs. `--backend three` shows the view's `frame()`
  through the Three.js backend and the game's `three` skin (exit 3 `no_frame_hook` at `view`, or
  `no_three_skin` at `content.skin`, when either is missing); `renderer` is the WebGL renderer
  string, and a software one (SwiftShader, llvmpipe) is refused with exit 4 naming it and
  `--allow-software-gl`, which takes the picture on SwiftShader on purpose (needed in a container
  without a GPU). `--backend pixi` (Engine 0.16 T13b-5) shows the view's `frame()` through the
  PixiJS backend (`pixiDisplay`) and the game's `canvas2d` skin, always on SwiftShader, and is not
  refused on software WebGL: `renderer` names the WebGL renderer string (exit 3 `no_frame_hook`
  or `no_canvas2d_skin` when the view or skin is missing). Engine 0.16 part B: `--scale N` (1-16) writes the picture N times as large,
  each pixel an exact N x N block (a 320x180 game at `--scale 6` is exactly 1920x1080), and
  `--overlay <o>` draws one of `sheet`'s overlays over it (`title`, `pause`, `settings`,
  `controls`, `levels`, `clear`, `end`, `ui=<file>[.<widget>]`, a transition), through the same
  job; the result adds `scale` and `overlay`. Example: `pnpm -s cli screenshot
games/fx-lab/runs/level-1.run.json --tick 360 --scale 6 --overlay clear --out x.png --json`.
  Needs `pnpm exec playwright install --with-deps chromium`. Details: `engine/tools/CLAUDE.md`
  (Screenshots).
- `pnpm cli sheet <run-file> --ticks <tiles> [--backend 2d|3d|pixi] [--allow-software-gl]
[--out file.png] [--columns N] [--scale N] [--labels a|b|...] [--title text]` (Engine 0.16 T14):
  the owner's review sheet. Each tile is `[<run>/]<tick>[+<overlay>][@<backend>]`: a tick of the
  run file (or of another run file in its folder, `level-3/120`, or relative to it, `../../samples/rts-skirmish/runs/battle/141`), drawn as `screenshot` draws it,
  with an optional overlay drawn by the engine's own code (`title`, `pause`, `settings`,
  `controls` from `game.json`'s `menus`, and from Engine 0.16 part B `levels`, `clear` and `end`,
  the stat screens reading the tick's frame status; `ui=<file>[.<widget>]`; a transition slot or
  kind with `*<age>`, `respawn` among the slots) and an optional backend of its own (`@3d`, or `@pixi` for PixiJS: `120@canvas2d,120@pixi` puts
  the two 2D backends side by side, labelled `[2D]` and `[PixiJS]`). One Chromium per backend plays each run
  file once and checks its state hashes against the headless run's; the tiles are tiled with
  their labels (a caption from `--labels`, then run, tick, overlay and backend) into one PNG
  (default `.ww-out/sheets/<name>.png`), the same bytes every run on one machine. `--json` result:
  `{ run, path, width, height, bytes, sha256, columns, scale, matchesHeadless, tiles: [{ run, tick,
overlay, backend, label }], plays: [{ run, backend, renderer, ticks, hash, headlessHash,
matchesHeadless }] }`. Exit 4 when a page's hashes differ or a 3D play is refused (software
  WebGL), 3 for bad content, 2 for a bad tile, an overlay the game lacks or labels that do not
  match. `docs/reports/0.16a-effects-sheet.png` was made with it (the command is in
  `docs/BUILD-LOG.md`, Engine 0.16 part A). Code: `sheet.ts` (tiles, `composeSheet`),
  `sheet-overlay.ts` (overlays from the content, pure), `shot-job.ts` (the page's job, shared
  with `screenshot`) and `takeScreenshots` (several jobs in one Chromium).
- Visual parity (Engine 0.16 T13b-5): `tests/browser/pixi-parity.test.ts` draws the same ticks of
  the fx lab, the RTS skirmish and the tower defense through Canvas2D and PixiJS (effects on, with
  fades, wipes and the pause menu) and compares them with `png-diff.ts` (`decodePng`,
  `pixelDiff`). Tolerance: a pixel differs when R, G or B differs by more than the threshold; the
  RTS and TD (no glow) allow threshold 8 and 0.1% of the pixels, the fx lab (glow, additive
  particles: a halo sprite against `shadowBlur`) threshold 32 and 1%, with its top half held to
  the strict bound. The iris is not compared (PixiJS closes it on the camera's focus). Skipped
  without Chromium. Details: `engine/tools/CLAUDE.md` (Visual parity).
- `pnpm cli get <file> <path>`, `set <file> <path> <value>`, `add <file> <path> <value>`,
  `remove <file> <path>`: one verb set for editing `game.json`, content files, text-grid part
  files (`rows.3`, `rows.3.5`) and run files. Paths are dotted (`frames["down-0"].3`) or JSON
  pointers (`/frames/down-0/3`); values are JSON, else a string. A write is checked against the
  file's schema (and the game for new errors) first and refused with exit 3 and `errors`, file
  untouched, if it breaks anything; then written Prettier-clean, read back and reported as
  `{ file, kind, path, pointer, written, verified, changed, before, after, crossErrors }`.
  Cross-file problems (`invalid_dungeon`: doors that do not match yet) never refuse a write, so a
  door pair can be changed one room at a time; they are listed in `crossErrors` and `validate`
  fails on them until the matching edit is made. Details:
  `engine/tools/CLAUDE.md` (Editing content).
- Text maps (Engine 0.14, gap G10): `pnpm cli get <map> rows --ruler` (or `rows.R1-R2`) shows the
  rows under a column ruler with row numbers (`--json`: `{ rows, ruler, width, height, firstRow,
firstColumn }`); `get <map> rows.R1.C1:R2.C2` copies a rectangle; `paste <map> rows.R.C <block>`
  (`\n`-split lines, `@path` or `--from-file`, optional `--transparent <ch>`) writes one in a single
  call, through `set`'s schema check, `crossErrors` and read-back. A ragged block or one off the
  grid is exit 2 with nothing written. Works on rooms, platformer levels and tower-defence maps.
- Every game's run files, and the engine's world run files (`engine/**/__fixtures__/*.run.json`),
  are checked by `tests/runs/run-files.test.ts` against committed golden
  hashes (`<name>.hashes.json`; regenerate with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).
- A game on two kits: `uses` in `game.json` (beside `kit`) adds more kits' content kinds, merged
  by `gameKinds`; every command reads those files. `unknown_kit` / `duplicate_kit` / `kind_clash`
  name the `game.json` field. Every kit's rules can be switched off and are mutant-checked: bare
  ids are `kit`'s, `kit:id` a `uses` kit's (Engine 0.14, gap G12; `engine/tools/CLAUDE.md`).
- Global flags: `--json` (exactly one JSON object on stdout), `--help`, `--max-output <bytes>`.
- Exit codes (`engine/tools/exit-codes.ts`): `0` ok, `2` usage, `3` invalid content, `4` failed
  check, `5` crash. Every `--json` result, failures included, is `{ ok, command, exitCode, ... }`.
- Output over the cap (32 KiB by default) is cut; the whole result is written under `.ww-out/` and
  the printed one has `truncated: true` and `fullOutput: <path>`.
- In code: `main(argv, io)` (`engine/tools/main.ts`), `defineCommand` and `Registry`
  (`registry.ts`), `loadGame(cwd, dir)`, `checkGameTexts` and `gameKinds` (`game-check.ts`, the engine's kinds plus `kit`'s and each `uses` kit's, made with the manifest's `kitOptions` and checked against each kit's `options`, `unknown_option` / `bad_option`, gap G17; re-exported by `game-loader.ts`),
  `serveRepo`, `takeScreenshot`, `launchChromium` and `pngSize` (`screenshot.ts`), `valueAt` and
  `failsCheck` (`check-values.ts`, pure), `filterChanges` (`event-filter.ts`, pure),
  `openContentFile` (`content-file.ts`), `parsePath`, `getAt`, `setAt`, `addAt`, `removeAt`,
  `parseGridRegion`, `gridRuler` and `pasteBlock` (`content-path.ts`), `playRun` and `stateHash` (core's, `engine/core/state-hash.ts`)
  (`headless-run.ts`), `runFileSchema`, `replaySchema` and `readRunFile` (`run-file.ts`),
  `writeReplay` and `checkReplay` (`replay.ts`), `loadWorldRun` and `worldSystemSet`
  (`world-run.ts`), `allKits`, `findKit`, `loadKit`, `kitKinds` and `kitRules`
  (`kits.ts`: each kit by its hook `kits/<name>/kit.ts`, listed in the generated `kit-list.ts`).

Example: `pnpm -s cli validate games/samples/dungeon --json` prints
`{"ok":true,"command":"validate","exitCode":0,"game":"games/samples/dungeon","fileCount":10,"errorCount":0,...}`
and exits 0. (`-s` keeps pnpm's own banner off stdout.)

- Keyed paths (Engine 0.15 T7, gap M17): in a world snapshot, `key.<key>` (through the game's
  `worldKeys()` or a world run's scenario keys), `id.<n>` and `one.<Kind>` name an entity or the
  world-level component without its place in a component list (`world.key.ram.Health.hp`,
  `world.one.Missions.committed.0.outcome`); `valueAt` / `failsCheck` take the table, and a key
  the table lacks is `no_key` at the check's path (exit 3, `unknownKeyAt`). `validate` builds the
  game's world scenarios (`worldScenarios`) and checks each mission's selectors against the ones
  that offer it (lesson D7).
- Late refusals (Engine 0.15 T8, gap M5): a game's `lateRefusals(sinceTick)` (a `MissionHost`'s:
  a round's end the world refused) are added to `run`'s `refusedMissions` at the tick they came,
  with `late: true` (text: `refused late:`).

## Imports allowed

- Anything in `engine/` and `kits/`.
- Games are loaded by folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/`.

## How to test

Tests sit next to the code and run with `pnpm test`: they call `main` with captured IO and check
the exit code and the one JSON object, using temp copies of `games/samples/dungeon` for broken content. One
test spawns `pnpm -s cli` for real. `record.test.ts` covers `record` (the mini siege's sabotage and walls rounds re-recorded with the kits' bots giving the committed inputs and golden hashes, a page recording list, a round that moves the hashes put back with exit 4, a bad mission id exit 2, a schema-breaking recording exit 3 with the file untouched), `trace.test.ts` covers `trace` (rows, `--every`, missing paths, usage errors, the output cap, hashes equal to `run`'s on a world run and a mini siege run), `world-data.test.ts` covers `events`, `timeline` and `dump --out` (the mini siege, a world run, the skirmish, filters, `no_world`, a dump file round trip), `run.test.ts` covers `run` and `dump` (wrong assertions,
invariants, broken run files, replay files and hash mismatches), `mutants.test.ts` `--disable-rule`, `disableRules` and `mutants`, `edit.test.ts` the editing
verbs on temp copies of the demo, `orders-run.test.ts` recorded orders, sync hashes and system sets (the battle fixture, a stub game with `order`), `missions-run.test.ts` mission steps in world runs (refusals, schema and mission-file errors, dump and replays), `game-missions-run.test.ts` mission steps in game runs (a stub game with `mission`: refusals, experience, hashes, dump, replays, the usage error), `world-run.test.ts` `run`, `dump`, replays and `mutants` on the
sample world run and the game-or-world schema errors, `screenshot.test.ts` takes the same screenshot twice and
compares the bytes (canvas2d, three and pixi), an exact 6x picture (`--scale`) and an overlay (`--overlay`), checks the software-GL refusal and the 3D content errors (skipped with a message when Chromium is missing locally, required in CI), `sheet.test.ts` the tile grammar, the overlays from the fx lab's content and a 2D and 3D sheet of the fx lab made twice with the same bytes, and `tests/runs/run-files.test.ts` checks every game's run files
against their golden hashes (`tests/runs/missions.test.ts` holds Engine 0.10's done-when cases).
