# engine/tools

Folder: `engine/tools`. Detailed rules: [`engine/tools/CLAUDE.md`](../../engine/tools/CLAUDE.md).

## Purpose

The command-line tools for agents and people: `pnpm cli <command> [arguments] [flags]`. Today it
validates a game's content, plays run files headless (seeded scripted input, tick assertions,
invariants, state hashes), writes replay files for failing runs, dumps the state at a tick and
edits content files (`get`, `set`, `add`, `remove`, every write checked and verified) and runs
mutant checks (`mutants`: does a run fail when a kit rule is switched off?), and takes
deterministic screenshots of a run at a tick in headless Chromium (`screenshot`).

## Public API entry points

- Generated reference: [CLI reference](../reference/cli.md) (every command's help) and
  [schema reference](../reference/schemas.md) (every file format), plus the tables in the
  [cheat sheet](../CHEATSHEET.md). `pnpm docs:gen` writes them; `pnpm docs:check` (and `pnpm test`)
  fails when they are out of date.
- `pnpm cli help [command]`: the commands, global flags and exit codes, generated from the command
  schemas. `<command> --help` shows one command.
- `pnpm cli validate <game>`: checks `game.json` and every content file against its schema
  (starts nothing). From Engine 0.10 (gap G16) it also checks every level trigger's and mission's
  mini game id and `params` against the defs the game's headless module exports as
  `miniGames(content)` (`unknown_mini_game`, or the def's `paramsSchema` errors at
  `triggers.0.params.goal`; `mini-game-check.ts`). `--json` result:
  `{ ok, command: 'validate', exitCode, game, fileCount, errorCount, files: [{ file, errors }], errors }`,
  each error `{ file, path, pointer, message, code, row?, col?, line? }`.
- `pnpm cli run <run-file>`: plays a run file (`games/<game>/runs/<name>.run.json`; schema and
  format in `engine/tools/run-file.ts` and `engine/tools/CLAUDE.md`) headless from its seed with its
  scripted input, checking invariants every tick and assertions at their tick. `--json` result:
  `{ ok, command: 'run', exitCode, run, game, world, seed, ticks, lastTick, passed, checks, failure,
failures, hashes: [{ tick, hash }], finalHash, orders, ordersPlayed, refusedOrders, missions,
missionsPlayed, refusedMissions, experience, hashesChecked, hashMismatch, replayFile, replay }`; `failure` names the first failing tick, the check, `expected`
  and `actual`. Exit 0 passed, 4 failed check or sync hash, 3 invalid run file or content.
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
  `disabledRules` names them.
- `pnpm cli mutants <run-file>`: plays the run as it is, then once per named kit rule with that
  rule off. `--json` result: `{ run, game, kit, strict, baseline: { passed, failure }, guards,
rules: [{ id, description, skipped, expected, passed, guarded, failure }], guarded, weak }`;
  `weak` lists the rules the run is expected to guard (its `guards`, else every rule) and still
  passes without (text: `weak: does not guard <id>`). Exit 0 when the run passes as it is, 4 when
  it does not, or when the kit is strict (`strictMutants: true`) and a rule is weak.
  `pnpm cli mutants games/<game>` does this for every run file of the game and reports which run
  files guard each rule (`rules[].guardedBy`, `unguarded`); exit 4 for a strict kit with an
  unguarded rule. Details: `engine/tools/CLAUDE.md` (Mutant checks).
- `pnpm cli dump <run-file> --tick N`: `{ run, game, world, seed, tick, hash, state, orders,
missions }`, the whole snapshot (a game's or a world's) at tick N and the recorded orders and
  mission steps applied before it.
- `pnpm cli screenshot <run-file> --tick N [--out path] [--backend canvas2d|three]
[--allow-software-gl]`: plays the run in headless Chromium
  through the game's view module (`view` in `game.json`, `engine/core/view.ts`) and the canvas2d
  backend, drawing every tick on the way, and writes the frame at tick N as a PNG of the game's picture size (`screen` in
  `game.json`, 256x240 by default; default
  `.ww-out/screenshots/<name>-t<N>.png`). `--json` result: `{ ok, command: 'screenshot', exitCode,
run, game, seed, tick, backend, renderer, path, width, height, bytes, sha256, hash, headlessHash,
hashes, matchesHeadless }` (`hashes`: the state hashes the page saw; all must be the headless run's).
  Two runs in a row give byte-identical PNGs. `--backend three` shows the view's `frame()`
  through the Three.js backend and the game's `three` skin (exit 3 `no_frame_hook` at `view`, or
  `no_three_skin` at `content.skin`, when either is missing); `renderer` is the WebGL renderer
  string, and a software one (SwiftShader, llvmpipe) is refused with exit 4 naming it and
  `--allow-software-gl`, which takes the picture on SwiftShader on purpose (needed in a container
  without a GPU). Needs `pnpm exec playwright install --with-deps
chromium`. Details: `engine/tools/CLAUDE.md` (Screenshots).
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
- Every game's run files, and the engine's world run files (`engine/**/__fixtures__/*.run.json`),
  are checked by `tests/runs/run-files.test.ts` against committed golden
  hashes (`<name>.hashes.json`; regenerate with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).
- A game on two kits: `uses` in `game.json` (beside `kit`) adds more kits' content kinds, merged
  by `gameKinds`; every command reads those files. `unknown_kit` / `duplicate_kit` / `kind_clash`
  name the `game.json` field. Rules and mutants stay `kit`'s (`engine/tools/CLAUDE.md`).
- Global flags: `--json` (exactly one JSON object on stdout), `--help`, `--max-output <bytes>`.
- Exit codes (`engine/tools/exit-codes.ts`): `0` ok, `2` usage, `3` invalid content, `4` failed
  check, `5` crash. Every `--json` result, failures included, is `{ ok, command, exitCode, ... }`.
- Output over the cap (32 KiB by default) is cut; the whole result is written under `.ww-out/` and
  the printed one has `truncated: true` and `fullOutput: <path>`.
- In code: `main(argv, io)` (`engine/tools/main.ts`), `defineCommand` and `Registry`
  (`registry.ts`), `loadGame(cwd, dir)`, `checkGameTexts` and `gameKinds` (`game-check.ts`, the engine's kinds plus `kit`'s and each `uses` kit's, re-exported by `game-loader.ts`),
  `takeScreenshot`, `launchChromium` and `pngSize` (`screenshot.ts`),
  `openContentFile` (`content-file.ts`), `parsePath`, `getAt`, `setAt`, `addAt`, `removeAt`
  (`content-path.ts`), `playRun` and `stateHash`
  (`headless-run.ts`), `runFileSchema`, `replaySchema` and `readRunFile` (`run-file.ts`),
  `writeReplay` and `checkReplay` (`replay.ts`), `loadWorldRun` and `worldSystemSet`
  (`world-run.ts`), `allKits`, `findKit`, `loadKit`, `kitKinds` and `kitRules`
  (`kits.ts`: each kit by its hook `kits/<name>/kit.ts`, listed in the generated `kit-list.ts`).

Example: `pnpm -s cli validate games/demo --json` prints
`{"ok":true,"command":"validate","exitCode":0,"game":"games/demo","fileCount":10,"errorCount":0,...}`
and exits 0. (`-s` keeps pnpm's own banner off stdout.)

## Imports allowed

- Anything in `engine/` and `kits/`.
- Games are loaded by folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/`.

## How to test

Tests sit next to the code and run with `pnpm test`: they call `main` with captured IO and check
the exit code and the one JSON object, using temp copies of `games/demo` for broken content. One
test spawns `pnpm -s cli` for real. `run.test.ts` covers `run` and `dump` (wrong assertions,
invariants, broken run files, replay files and hash mismatches), `mutants.test.ts` `--disable-rule`, `disableRules` and `mutants`, `edit.test.ts` the editing
verbs on temp copies of the demo, `orders-run.test.ts` recorded orders, sync hashes and system sets (the battle fixture, a stub game with `order`), `missions-run.test.ts` mission steps in world runs (refusals, schema and mission-file errors, dump and replays), `world-run.test.ts` `run`, `dump`, replays and `mutants` on the
sample world run and the game-or-world schema errors, `screenshot.test.ts` takes the same screenshot twice and
compares the bytes (canvas2d and three), checks the software-GL refusal and the 3D content errors (skipped with a message when Chromium is missing locally, required in CI), and `tests/runs/run-files.test.ts` checks every game's run files
against their golden hashes (`tests/runs/missions.test.ts` holds Engine 0.10's done-when cases).
