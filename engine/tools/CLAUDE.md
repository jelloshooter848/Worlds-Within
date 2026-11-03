# engine/tools

The CLI for agents and people: `pnpm cli <command> [arguments] [flags]`. Run `pnpm cli help` for
the commands (the help is generated from the command schemas). For a clean machine-readable stdout
use `pnpm -s cli ... --json`: without `-s`, pnpm itself prints a two-line banner on stdout before
the CLI starts.

## Files

- `cli.ts`: the entry point (`package.json` runs it with `tsx`). Only wires `main` to the process.
- `main.ts`: `main(argv, io, registry?)` runs one command line and returns the exit code; it never
  throws. `io` is `{ stdout, stderr, cwd, outDir? }`, so tests call it with captured output.
  `defaultRegistry()` lists every command.
- `registry.ts`: `Command` (`name`, `summary`, `args` and `flags` as `z.strictObject`s, `run`,
  optional `text`), `defineCommand`, `Registry`, `globalFlags` (`--json`, `--help`,
  `--max-output`) and `fieldDocs` (a schema as help lines).
- `args.ts`: `parseCommandLine(argv, registry)`. Positional arguments are taken in the order of the
  `args` object's keys; flag keys are camelCase and typed kebab-case (`maxOutput` ->
  `--max-output`); a boolean flag takes no value, others take `--flag value` or `--flag=value`;
  number flags are converted before the schema runs; `--` ends the flags. Every problem is a
  `UsageError`.
- `exit-codes.ts`: `EXIT`, the one place the exit codes are defined (see below), and `UsageError`.
- `output.ts`: the output cap (`DEFAULT_MAX_OUTPUT`, 32 KiB) and the output folder (`OUTPUT_DIR`,
  `.ww-out/`, git-ignored). Replay files go to `.ww-out/replays/`.
- `game-loader.ts`: `loadGame(cwd, dir)` reads `<dir>/game.json` and its content files with the
  file system (`readGameFiles`) and checks them with the engine's kinds plus its kits'. It never
  imports a game's code. `texts` keeps every file's text.
- `game-check.ts`: `checkGameTexts(texts, root)` and `gameKinds(manifestText, root, find?)`, the
  checks on a game's files once they are text. `gameKinds` merges the engine's kinds with those of
  `kit` and of every kit in `uses` (A game on two kits, below). No Node imports, so the screenshot page uses them in the
  browser too (`game-loader.ts` re-exports them).
- `kits.ts`: the kits by the `kit` (and `uses`) names in `game.json`: `allKits()`, `findKit(name)`,
  `loadKit(name)` (throws `unknownKitMessage(name, field?)` for an unknown kit), `kitKinds(name)` and
  `kitRules(name)`. Each kit says what it adds through its own hook, `kits/<name>/kit.ts` exporting
  `kit` (a `KitDef` from `engine/core/kit.ts`: content kinds, named rules, `strictMutants?`). There
  is no table of kits here: the hooks come from `kit-list.ts`.
- `kit-list.ts`: **generated** by `pnpm docs:gen` (`kit-list-gen.ts`) with one import per
  `kits/<name>/kit.ts` on disk; never edit it by hand. A new kit needs its `kit.ts` and
  `pnpm docs:gen`; `pnpm docs:check` and `kits.test.ts` fail while the list is stale.
- `mini-game-check.ts` (Engine 0.10, gap G16): `miniGameUses(content)` (each kit's
  `miniGameUses`, `kit` then `uses`, then the missions') and `miniGameErrors(cwd, gameDir,
content)`, which imports the game's headless module by path for its optional
  `miniGames(content)` and checks every use with `miniGameParamErrors`
  (`engine/core/minigame-params.ts`). No `miniGames` export (or no headless file): no errors.
- `run-file.ts`: the run-file schema (`runFileSchema`, with `orderEntrySchema` for recorded
  orders and `missionEntrySchema`/`MISSION_ACTIONS` for mission steps), `readRunFile(cwd, path)`, the check ops (`CHECK_OPS`, `CHECK_OP_MEANINGS`),
  `valueAt(state, path)` and `failsCheck(state, check)`.
- `headless-run.ts`: `playRun(cwd, runFile, { untilTick?, disableRules?, withSave?, onTick? })` loads the game, imports its headless
  module by the path in `game.json` (dynamic `import()` of a file URL, never a static import),
  checks the run file's `disableRules` and `guards` against the kit's rules, plays the ticks and
  makes the checks, hands recorded `orders` over at their ticks and compares the run file's sync
  `hashes` (Recorded orders, below); for a world run it builds the world instead (`world-run.ts`).
  `stateHash(snapshot)`, `orderOf(entry)`, `saveCodeNow(save, ctx)`. From Engine 0.13 it starts a
  game run from its `from` and checks its `codes` (Campaign runs and save codes, below).
  `onTick(tick, snapshot)` (Engine 0.14) sees every tick's snapshot as it is played, so a command
  that reads the state per tick (`trace`) uses the one playing loop. A game run's `start` (Engine
  0.14, gap G9) is checked against the game's `starts(content)` and handed to `createGame` as
  `HeadlessOptions.start` (Start levels and entries, below); `PlayedRun.start` is it, or null.
- `world-run.ts`: `loadWorldRun(cwd, runFile, worldFile, seed?)` builds a world run's world from
  its scenario with the engine system set the scenario names (`worldSystemSet(json)`:
  `SYSTEM_SETS` from `engine/sim`, `village` when it names none), no event log, and returns it
  with the set's name and the scenario's keys (`scenarioKeys`) (World runs, below);
  `loadMissionDefs`, `applyMissionStep` and `settleWorld` drive a world run's `missions`
  (Missions in world runs, below).
- `replay.ts`: replay files. `writeReplay(played, cwd, outDir)` writes one for a failed run,
  `replayOf` builds its JSON, `checkReplay` compares a replay's run with its stored failure and
  hashes.
- `screenshot.ts`: `takeScreenshot(job, gameAbs, viewAbs)` serves the repo with Vite in middleware
  mode on a free local port, opens the screenshot page in headless Chromium (Playwright) and
  returns the PNG bytes (or the page's `ShotRefusal`); `launchChromium(opts?)` (throws
  `NoBrowserError` with the install command), `chromiumArgs(opts?)` (Chromium's flags per
  backend), `servedPath(abs)`, `pngSize(png)`.
- `screenshot/`: the tools-only screenshot page (`index.html`, `page.ts`) and the job it takes
  (`job.ts`). Never in the Pages build: `build/pages.ts` only builds the launcher and game pages.
- `content-path.ts`: paths for the editing verbs (`parsePath`, dotted or JSON pointer) and the
  edits on a parsed file (`getAt`, `setAt`, `addAt`, `removeAt`), plus `parseValue` (JSON, else a
  string).
- `content-file.ts`: `openContentFile(cwd, path)`: what an editable file is (its kind and form),
  how its text becomes a tree and back, and the check a new text must pass before it is written.
- `json-format.ts`: reads JSON remembering which objects are spread over lines, and writes it back
  through Prettier with the repo's settings, so edits are lint-clean and change little.
- `schema-doc.ts`: `fieldRows(schema)`, a Zod schema as rows of a field table (path, type,
  required, default, limits, description), walked from Zod's `toJSONSchema` of the input shape.
- `docs-gen.ts`: the generated docs (below): `defaultDocSources()`, `generateDocs`, `writeDocs`,
  `staleDocs`. `docs.ts` is the entry point of `pnpm docs:gen` and `pnpm docs:check`; it writes
  (or checks) `kit-list.ts` first and only then imports `docs-gen.ts`, which reads every kit.
- `commands/`: one file per command (`help.ts`, `validate.ts`, `run.ts`, `dump.ts`, `trace.ts`, `code.ts`, `screenshot.ts`, `mutants.ts`, and `edit.ts`
  for `get`, `set`, `add` and `remove`).

## The contract

- `--json`: stdout gets exactly one line holding one JSON object, `{ ok, command, exitCode, ... }`,
  whatever happens: usage errors and crashes included (`error: { kind, message, stack? }`).
  Nothing else goes to stdout; `console.log` and friends are sent to stderr while a command runs.
- Exit codes (`exit-codes.ts`): `0` ok, `2` usage (unknown command or flag, missing or extra
  argument, a folder that is not there), `3` invalid content (the result names file and field),
  `4` failed check (valid content, a check failed: a `run` assertion or invariant, or
  `screenshot --backend three` refusing software WebGL), `5` crash (an exception). `1` is never used by the CLI, so a `1` means Node died before it could report.
- Output cap: over `--max-output` bytes (default 32 KiB) the whole result goes to
  `.ww-out/<command>-<hash>.json` (or `.txt` without `--json`), and the printed result is cut: the
  longest top-level arrays are halved until it fits, and it gets `truncated: true`,
  `fullOutput: <path relative to the working folder>` and `omitted: { <array>: <count> }`. Put
  long lists in top-level arrays of the result so the cap can cut them.
- Text mode (no `--json`) is for people: the command's `text(result)`, or the result as JSON.
  Usage errors and crashes go to stderr.

## Commands

- `help [command]`: the commands, the global flags and the exit codes; one command with its
  arguments and flags. `<command> --help` is the same as `help <command>`.
- `validate <game>`: checks `game.json` and every content file. Cheap: starts nothing (no world,
  no round). Once the content is valid, a game whose headless module exports `miniGames(content)`
  (`engine/core/headless.ts`, Engine 0.10, gap G16) has that module imported for its mini game
  defs, and every level trigger's `game` and `params` and every mission's `play` and `params` are
  checked against them: an id no def has is `unknown_mini_game` at that field
  (`triggers.0.game`, `play`), a param the def's `paramsSchema` rejects is an error at its field
  (`triggers.0.params.goal`, `params.goal`) with Zod's code, and (Engine 0.11) a problem the def's
  `checkUse` finds beyond the shape (the topdown kit's `mission-room`: an unknown room, a slot the
  room lacks, a rule naming an outcome the mission does not declare) is `bad_mini_game_use` at its
  field (`params.outcomes.0.outcome`). A game without the export is checked as before. Result:
  `{ game, fileCount, errorCount, files: [{ file, errors }], errors: ContentError[] }` (errors as
  in `engine/core/content/validate.ts`, with repo paths). Exit 0 or 3. A folder that is not there
  is a usage error. Its own content codes: `unknown_kit` (at `kit` or `uses.<i>` in `game.json`),
  `duplicate_kit` and `kind_clash` (at `uses.<i>`; A game on two kits, below). It also runs
  each kind's checks across files (`checkAll`), such as the top-down rooms' `invalid_dungeon`, so
  content it passes is content the game can build.
- `run <runFile> [--disable-rule <ids>]`: plays a run file headless and checks it (below).
  `--disable-rule` switches kit rules off (comma-separated ids, on top of the run file's
  `disableRules`; an id the kit does not name is a usage error). Result: `{ run, game, world, seed,
disabledRules, ticks, lastTick, passed, checks: { assertions, invariants }, failure, failures, hashes: [{ tick,
hash }], finalHash, orders, ordersPlayed, refusedOrders, missions, missionsPlayed, refusedMissions,
experience, hashesChecked, hashMismatch, from, start, codes, codesChecked, replayFile, replay }`.
  `failure` is the first failed check, `{ tick, kind: 'assertion' |
'invariant', index, path, op, expected, actual, message }`, or null; `failures` is every check
  that failed at that tick. The run stops at the first failing tick and then writes a replay file
  (below) whose path is `replayFile` (null when the run passed, and for replays). `replay` is the
  replay check on a replay file (null otherwise). `orders`, `ordersPlayed`, `refusedOrders`,
  `hashesChecked` and `hashMismatch` are about recorded orders and sync hashes (Recorded orders,
  below); `missions`, `missionsPlayed`, `refusedMissions` and `experience` about mission steps
  (Missions in world runs and Missions in game runs, below; a run file with `missions` for a game
  without a `mission` method is exit 2). Exit 0 passed, 4 a failed check or a sync hash that differs, 2 a run file with `orders`
  for a game without an `order` method, 3 (with `errors`) when the run file or the game's content breaks its schema (or the
  headless module is missing: `missing_file` / `no_headless_entry` at `headless` in `game.json`),
  2 when the run file is not there.
- `code <runFile> [--tick N]` (Engine 0.13): plays a game run file (no checks) to its last tick or
  tick N and prints the save code of the game's campaign save there: `{ run, game, seed, start, tick,
hash, code, save }` (Campaign runs and save codes, below). Exit 0; 3 for a bad run file or
  content, a game that gives no campaign save there (`no_campaign`) or a save the code cannot hold
  (`code_record`, ...); 2 for a world run, a game without `campaignSave`, or a bad `--tick`.
- `dump <runFile> --tick N`: plays to tick N (no checks) and prints `{ run, game, world, seed, start, tick,
hash, state, orders, missions }`, the whole snapshot and the recorded orders and mission steps
  applied on the way (`tick < N`). N from 0 to the run's `ticks`, else a usage error. Capped like
  everything else: a big state gives the envelope plus `fullOutput`.
- `trace <runFile> --paths a,b [--from N] [--to M] [--every K]` (Engine 0.14, gap G8, decision 5):
  plays the run like `dump` (no checks; orders, mission steps and `from` applied as `run` does)
  and reads the dotted snapshot paths (as assertions write them) at ticks N, N+K, ... up to M
  (defaults 0, the run's `ticks`, 1; M itself only when it is on that grid). Result: `{ run, game,
world, seed, start, from, to, every, paths, rows: [{ tick, hash, values: { <path>: value } }], missing:
[{ path, firstTick, ticks }], orders, missions }`; `hash` is the state hash `run` prints at that
  tick; a path not in the snapshot gives null and is listed in `missing` (a real null is not).
  `rows` is a top-level array, so the output cap halves it (whole rows) and the full trace is in
  `fullOutput`. Text: an aligned table, a column per path. Usage errors (exit 2): no paths, an
  empty path or segment, a path twice, `--from` after `--to`, `--to` after `ticks`, `--every` below
  1. Exit 3 for a bad run file or content. Works on game and world runs. Tests: `trace.test.ts`.
- `screenshot <runFile> --tick N [--out path] [--backend canvas2d|three] [--allow-software-gl]`:
  a PNG of the frame at tick N (Screenshots, below). Result: `{ run, game, seed, start, tick, backend,
renderer, path, width, height, bytes, sha256, hash, headlessHash, hashes, matchesHeadless }`.
  Exit 0, 4 when a state hash the page saw is not the headless one or (`three`) WebGL is not
  hardware-backed without `--allow-software-gl`, 3 for a bad run file or content, a game without
  `view`, or (`three`) a view without `frame()` or a game without a `three` skin, 2 for a bad
  `--tick`, `--out` or flag, 5 when Chromium is not installed.
- `mutants <target>`: mutant checks (below) on a run file or a game folder. Run file result:
  `{ run, game, kit, strict, baseline: { passed, failure }, guards, rules: [{ id, description,
skipped, expected, passed, guarded, failure }], guarded, weak }`. Game folder result: `{ game,
kit, strict, runs: [{ run, baseline, guards, guarded, weak }], rules: [{ id, description,
guardedBy }], unguarded }`. Exit 0 when every run passes as it is and, for a strict kit, nothing
  is weak or unguarded; 4 when a run fails as it is (its rules are not tried) or a strict kit has a
  weak or unguarded rule (a kit that is not strict only reports them); 3 for a bad run file or
  content.
- `get <file> <path>`: `{ file, kind, path, pointer, value }`. `set <file> <path> <value>`,
  `add <file> <path> <value>`, `remove <file> <path>`: the editing verbs (below). Result
  `{ file, kind, path, pointer, written, verified, changed, before, after, crossErrors }`; exit 0
  written and verified, 3 refused (with `errors`, file untouched), 4 written but the read-back
  differs, 2 a bad path or a file that cannot be edited.

## Editing content

`get / set / add / remove <file> <path> [value]` edit any of a game's files with one verb set.

- Files: `game.json` (kind `manifest`), the content files `game.json` claims (JSON, or a kind's
  `.txt` form when the kind has a `writeText`: sprites do), text-grid part files such as
  `rooms/hall.map.txt` (kind of the `.json` they belong to), and run files (`*.run.json`, kind
  `run`). Anything else is a usage error.
- Paths (`content-path.ts`): dotted (`frames.idle.2`, `content.room.0`, `legend["#"]`,
  `frames["down-0"].3`; a key that is not a plain name goes in `["..."]`) or a JSON pointer
  (`/frames/down-0/3`, `~1` is `/`). These are the same spellings as `path` and `pointer` in a
  `ContentError`, so an error's path can be fed straight back. `""` or `.` is the whole file. A
  number after a string picks one character: in a text grid, `rows.3` is row 3 and `rows.3.5` its
  cell in column 5 (a cell can only be read or set, to one character).
- A text-grid part file is edited as `{ rows: [...] }`; a sprite `.txt` file as its JSON shape
  (`{ palette, legend?, frames: { name: rows } }`).
- Values are parsed as JSON, and text that is not JSON is taken as a string: `set f bpm 140` sets a
  number, `set f id hall` a string, `set f id '"140"'` the string "140". A value starting with `--`
  goes after `--`.
- `set` replaces a value that is there. `add` appends to the array at the path, inserts into an
  array at an index from 0 to its length (`-` is the end), or adds a key an object lacks (a key
  that is there is a usage error: use `set`). `remove` deletes a key or an array item.
- Before writing, the whole edited file is checked against its kind's schema, and the game is
  checked for errors it did not have before (an `id` that no longer matches the file name, a
  pattern in `game.json` that now matches nothing). Any such error refuses the write: exit 3 with
  `errors`, and the file is not touched. Its own content code: `not_writable` (a sprite `.txt` with
  comments below its header, which would be lost, or a name with a space).
- Problems across files (each kind's `checkAll`, such as the rooms' `invalid_dungeon`: a door that
  leads nowhere, doors that do not line up) never refuse a write, because changing how rooms
  connect takes one edit per room and the dungeon is broken in between. The write goes through
  (exit 0, `verified: true`) and every such problem the game now has is listed in `crossErrors`
  (empty when there is none). `validate` and `run` still exit 3 on them, so finish the matching
  edit: to remove the demo's courtyard/guard-room door, `set .../courtyard.map.txt rows.5.15 '#'`
  then `set .../guard-room.map.txt rows.5.0 '#'`.
- JSON is written with the repo's Prettier settings (2 spaces, final newline), keeping each
  object's one-line or spread-out look; a grid one row per line with a final newline; a sprite
  `.txt` with its header comments kept. Writing a file back unchanged gives the same text.
- After writing, the file is read back from disk and parsed; `verified: true` says the text and
  the parsed content are exactly what was meant. `before` and `after` are the value at the edited
  place (`path`; for an `add` to an array, the new item), null when absent.

## A game on two kits

`game.json` names the game's kit in `kit` and, optionally, more kits in `uses` (Engine 0.7: a
platformer game whose door pushes a top-down mini game holds `room` files):

```text
{ "kit": "platformer", "uses": ["topdown"], "content": { "level": [...], "room": [...] } }
```

- Content kinds: the engine's, `kit`'s and each `uses` kit's (`gameKinds`, `game-check.ts`), so
  `validate`, the editing verbs, `run`, `dump`, `mutants` and the screenshot page read and check
  the other kit's files like the game's own (errors name the file and field).
- Errors at `game.json`: a name no kit has is `unknown_kit` at that field (`uses.1`); a kit listed
  twice (or `kit` again in `uses`) is `duplicate_kit`; a kind a `uses` kit adds that the engine or
  an earlier kit already has is `kind_clash`, naming both (`content kind "room" of kit "x" in
"uses.0" clashes with kit "topdown"`). Kinds are never merged or overridden.
- Rules: only `kit`'s. `run`/`dump` check `disableRules`, `guards` and `--disable-rule` against
  `kit`'s rules, `mutants` tries `kit`'s rules and its strictness is `kit`'s. A `uses` kit's rules
  are not mutant-checked yet (the headless contract passes one flat `disabledRules` list, and each
  kit's `RuleSwitch` throws on ids it does not know); see the stacking-test gap report (G12).
- Imports: a game may import every kit it uses (`games -> kits` in `config/layers.js`; only sibling
  games are kept apart).

## Run files

`games/<game>/runs/<name>.run.json`, checked by `runFileSchema` (`run-file.ts`):

```json
{
  "game": "..",
  "seed": 1,
  "ticks": 240,
  "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
  "assertions": [{ "tick": 240, "path": "hero.room", "op": "eq", "value": "guard-room" }],
  "invariants": [{ "path": "hero.hp", "op": "gte", "value": 0 }],
  "hashEvery": 40,
  "disableRules": [],
  "guards": ["doors-change-room"]
}
```

- `game`: the game folder, relative to the run file's folder (`..` from `games/<game>/runs/`). A
  world run gives `world` instead (World runs, below); exactly one of the two.
- `seed` (optional): the world's seed; the manifest's `start.seed` when left out.
- `ticks`: how many steps to play. Tick 0 is the state the game starts in, tick `t` the state after
  `t` steps.
- `input.steps` (default none): `ScriptedInput` steps, `{ frame, hold: Action[] }`; each holds its
  actions from input frame `frame` on (until the next step). Frame `f` is the input of the step
  from tick `f` to `f + 1`.
- `assertions` (default none): `{ tick, path, op, value }`, checked at that tick (at most `ticks`).
- `invariants` (default none): `{ path, op, value }`, checked at every tick, tick 0 included.
- `hashEvery` (default 60): a state hash at every multiple of it, and always at the last tick
  played.
- `disableRules` (default none): kit rules switched off for the whole run (ids from the kit's
  rule list, see Mutant checks). An id the kit does not name is an `unknown_rule` content error at
  that entry; an id twice is a schema error. Replay files keep the rules that were off.
- `orders` (default none): recorded orders, `{ tick, ...order }` (Recorded orders, below).
- `hashes` (optional): sync hashes `[{ tick, hash }]` the run must give (Recorded orders, below).
- `missions` (default none): mission steps (Missions in world runs, and from Engine 0.11 Missions
  in game runs, below).
- `start` (optional, game runs, Engine 0.14): start at a later level (`{ "stage": n }`, 0-based)
  or campaign entry (`{ "entry": "<id>" }`), fresh, from tick 0 (Start levels and entries,
  below).
- `guards` (optional): the kit rules this run is meant to guard (Mutant checks). An id the kit
  does not name is an `unknown_rule` content error at that entry (exit 3, naming the run file and
  `guards`); an id twice, or one the run's `disableRules` switches off, is a schema error.
- `path`: dotted, into the game's snapshot (`hero.hp`, `entities.0.kind`, `entities.length`). A path
  that is not in the snapshot always fails. The top-down kit's paths are listed in
  `kits/topdown/CLAUDE.md` (Snapshots); `dump` shows them all.
- `op`: `eq`, `ne` (deep equality), `lt`, `lte`, `gt`, `gte` (numbers), `in`, `nin` (value is an
  array), `contains` (an array has an item equal to value, or a string contains it).
- State hash: the first 16 hex digits of the SHA-256 of the snapshot's canonical JSON
  (`canonicalJson`, sorted keys).
- Golden hashes: each run file has `<name>.hashes.json` next to it, `{ run, hashes }`.
  `tests/runs/run-files.test.ts` plays every `games/**/runs/*.run.json` twice, requires it to pass
  and both hash lists to equal the golden file, so CI checks them. After a change meant to change
  the state, regenerate with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and commit the files.
- `tests/runs/backend-parity.test.ts` plays every demo and platformer-lab run file presenting
  every tick through the null and the Canvas2D backends (and, for the lab, through the Three.js
  backend's Node-side `ThreeScene` with its `three` skin), and every other game's with a `view`
  (`games/<g>/` and `games/samples/<g>/`; recorded `orders` go to the view's `order` at their
  ticks, as `run` hands them over) through `frame()` into null, `render` into Canvas2D and, when the game has a `three` skin,
  `frame()` into `threeScenePresenter` with its `skinSet` (Engine 0.7 T8: no fallback boxes, a
  block for every tile shown), and requires every hash list to equal the golden file.
- Run every game's run files: `pnpm test tests/runs`, or one by one with
  `pnpm -s cli run <file> --json`.
- A game's headless module (`headless` in `game.json`) exports `createGame(content, seed, opts?)`
  returning a `HeadlessGame` (`engine/core/headless.ts`); it passes `opts.disabledRules` to its
  kit.

## World runs

From Engine 0.8 a run file can play a world (`engine/sim`) instead of a game: `world` names a
`*.world.json` scenario, relative to the run file. The sample is
`engine/sim/__fixtures__/village-build.run.json`:

```json
{
  "world": "village.world.json",
  "ticks": 1000,
  "assertions": [{ "tick": 500, "path": "components.Construction.0.1.done", "op": "eq", "value": true }],
  "invariants": [{ "path": "components.Squad.0.1.strength", "op": "eq", "value": 12 }],
  "hashEvery": 100
}
```

- Exactly one of `game` and `world`: both is a schema error at `world`, neither at the file (exit
  3, naming the run file).
- The world is `worldFromScenario` with the engine system set the scenario names in `systems`
  (`world-run.ts`; `SYSTEM_SETS` in `engine/sim/system-sets.ts`): `village` (the 0.8 set:
  haul, build, patrol, with their components) when it names none, or `rts` (the RTS units and
  economy, `RTS_COMPONENTS` and `RTS_SYSTEMS`), so an RTS battle can be a world run (items 118 and
  132). A name the engine has no set for is an `invalid_scenario` error at `systems`. A scenario that does not build is one `invalid_scenario` error per field, in
  the scenario file; a missing file is `missing_file` at the run file's `world`. `seed`, when
  given, replaces the scenario's.
- A world has no input and no kit: it is driven by recorded `orders` only (Recorded orders,
  below), and only an `rts` world takes them (`orders` on another set is a `no_orders` content
  error at `orders`). `input` with steps, `disableRules` and `guards` are schema errors on a world
  run, and `--disable-rule`, `mutants` and `screenshot` on one are
  usage errors (exit 2).
- A step is `world.step()` and the snapshot `world.snapshot()`: `{ seed, tick, nextId, rng,
entities, components: { <Kind>: [[id, data], ...] } }`, so paths read
  `components.<Kind>.<i>.1.<field>` (entry `i` in id order; `.0` is its id). The event log is not
  kept (it is not part of a snapshot). Hashes are the same as `engine/sim`'s own
  (`village.hashes.json`).
- `run`, `dump` and replays work as for a game; results carry `world` (the scenario, repo path)
  and `game: null` (and the other way round for a game run). A replay of a world run names
  `world`. `tests/runs/run-files.test.ts` also plays `engine/**/__fixtures__/*.run.json` against
  their golden `<name>.hashes.json`.

## Recorded orders

Engine 0.9 (items 124-125, the OpenRA lockstep idea): a battle is its seed plus its recorded
orders, and replaying them headless gives the same state hashes. The sample is
`engine/sim/__fixtures__/battle.run.json`, an `rts` world (`battle.world.json`) with seven orders
and its sync hashes:

```json
{
  "world": "battle.world.json",
  "ticks": 200,
  "orders": [
    { "tick": 0, "id": 1, "faction": "red", "type": "gather", "units": [5], "target": 4 },
    {
      "tick": 20,
      "id": 4,
      "faction": "blue",
      "type": "move",
      "units": [8, 9, 10],
      "target": { "x": 9, "y": 6 }
    }
  ],
  "hashEvery": 20,
  "hashes": [
    { "tick": 0, "hash": "fe79b2d56cdbb801" },
    { "tick": 20, "hash": "de6fea3c6c3deda9" }
  ]
}
```

- **`orders`**: entries `{ tick, ...order }` in tick order, same-tick entries in ascending `id`
  (ids unique). An entry is applied after the state of its tick (its checks and hash are taken
  first) and before the step from it, so `tick` must be below the run's `ticks`. On a world run
  every entry must be an `engine/core/orders.ts` order (`id` required; schema errors name the
  field, `orders.3.target.x`) and is applied with `applyOrder`; on a game run the entry without
  `tick` goes to the game's `HeadlessGame.order(order)` (`engine/core/headless.ts`), and a game
  without that method is a usage error (exit 2). Out of tick order, an id twice or out of order
  within a tick, or a tick at or after `ticks`, is a schema error at that entry.
- **Refused orders are not failures**: an order the world or game drops (a unit that died, a
  faction that cannot pay) is listed in `refusedOrders` (`{ tick, id, error }`) and the run goes
  on, as the battle would have.
- **`hashes`** (sync hashes, same `{ tick, hash }` format and same state hash as everywhere else):
  `run` hashes the state at each listed tick (also between `hashEvery` multiples) and compares.
  The first that differs stops the run (exit 4, `passed: false`, `failure: null`) with
  `hashMismatch: { tick, expected, actual, lastMatch }`: the state first differs after `lastMatch`
  (null when none matched) and by `tick` (text: `hash MISMATCH at tick 40 ... (the state first
differs after tick 20 and by tick 40)`). `hashesChecked` counts the hashes compared. Without
  `hashes` nothing is compared. Sync hashes every 20 ticks is the default (item 124): set
  `hashEvery` to 20 and copy the run's `hashes` into the file.
- **Recording a battle**: write the orders as they were applied, with their ticks, run the file
  once, and copy its `hashes` into it. The RTS sample's page records a battle played in the
  browser and exports it as such a file (`games/samples/rts-skirmish/CLAUDE.md`, Exporting and
  replaying a battle).
- `dump` prints the orders applied before its tick (`orders`); a replay file keeps the orders
  before the failing tick (and not `hashes`: its `replay.hashes` hold the run's); `screenshot`
  hands the orders to the view's `order` the same way.
- Try it: `pnpm -s cli run engine/sim/__fixtures__/battle.run.json` passes with 11 sync hashes;
  change an order (blue's move target to `{ "x": 9, "y": 7 }`) and it fails at tick 40.
  `orders-run.test.ts` covers all of this.

## Missions in world runs

Engine 0.10 (item 161; docs/BUILD-LOG.md, Engine 0.10, decisions 2 and 12): a world run file
drives missions (`engine/sim/mission.ts`) from data. The samples are the siege fixture,
`engine/sim/__fixtures__/siege.world.json` (an `rts` battle event `siege`, a barracks going up
outside it, four opportunities) with `raid`, `convoy`, `rescue` and `scout` `.mission.json` files
and seven run files (`raid-partial`, `raid-failure`, `opportunity-closing`, `frozen-construction`,
`raid-delegated`, `fixed-cost-few`, `fixed-cost-many`):

```json
{
  "world": "siege.world.json",
  "ticks": 60,
  "missions": [
    { "tick": 5, "mission": "raid", "action": "open" },
    { "tick": 5, "mission": "raid", "action": "play", "outcome": "partial", "experienceTicks": 240 }
  ]
}
```

- **Steps**: `{ tick, mission, action, outcome?, experienceTicks? }` in tick order, `tick` below
  `ticks`. Each applies after the state of its tick and after that tick's orders, before the step
  from it, in file order: `open` (`openMission`, with the scenario's keys as `refs`: an effect's
  `"entity": "ram"` is the entity keyed `ram`), `delegate` (one weighted draw from the mission's own generator seeded from the world seed, so its tick never moves a hash),
  `play` (needs `outcome`, the outcome the stand-in round reached) or `quit` (its `onQuit`).
- **The commit comes by itself.** After every step of a world run the tools call `settleMissions`,
  so a mission commits at open tick + `worldTimeCost`, after that tick's systems and before its
  snapshot (delegated then, `timeout`, if no step resolved it), and scenario opportunities open and
  close on time. There is no `commit` action. Without missions or opportunities this changes
  nothing, so the 0.8 and 0.9 hashes stay.
- **Definitions**: `<mission>.mission.json` beside the scenario, else in a `missions/` folder
  there (`missionFileCandidates`), checked as the `mission` content kind. Every mission a step names
  needs one: none is `missing_file` at `missions.<i>.mission` in the run file; a bad file gives its
  own errors (that file and field), and an `id` that is not the file name is `id_mismatch`.
- **Load checks** (exit 3, naming the run file and field): out of tick
  order; a tick at or after `ticks`; `play` without `outcome`, `outcome` on another action,
  `experienceTicks` on `open` or `delegate`, `input` (a game run's field); a `play` or `quit` at or after the commit tick its
  `open` fixed is `mission_unresolved` (the cost has run out by then).
- **Refused steps are not failures**: a step the world refuses (`mission_committed` for a retry,
  `mission_resolved`, `opportunity_closed`, `unknown_outcome`...) is listed in `refusedMissions`
  (`{ tick, mission, action, code, error }`; text: `tick 36: refused: open "raid":
mission_committed: ...`) and the run goes on, as with orders.
- **Experience ticks** are the stand-in round's own ticks: summed per mission in the result's
  `experience` (`[{ mission, ticks }]`) and never written to the world, so they cannot move it or
  change a hash (decision 2: the same ticks, commit tick and hashes however long the round took).
  `fixed-cost-few` (played at tick 5, 1 tick) and `fixed-cost-many` (played at tick 34, 100,000
  ticks) give the same hashes from the commit tick (35) on; `tests/runs/missions.test.ts` checks
  it with the other done-when cases.
- Paths read the mission state at `components.Missions.0.1` (`open`, `committed`), the time
  service at `components.WorldTime.0.1` and opportunities at `components.Opportunities.0.1.list`
  (sorted by id).
- `dump` lists the steps applied before its tick (`missions`); a replay file keeps the steps before
  the failing tick. `missions-run.test.ts` covers the errors, refusals, dump and replays.

## Missions in game runs

Engine 0.11 (item 172; docs/BUILD-LOG.md, Engine 0.11, decisions 1-3): a game run file takes the
same `missions` list, and the game plays them live. The game is a `MissionHost`
(`engine/core/mission-host.ts`) over its own game, or any `HeadlessGame` with `mission(step)`:

```json
{
  "game": "..",
  "ticks": 300,
  "missions": [
    { "tick": 20, "mission": "sabotage", "action": "open" },
    {
      "tick": 20,
      "mission": "sabotage",
      "action": "play",
      "input": { "steps": [{ "frame": 0, "hold": ["attack"] }] }
    }
  ]
}
```

- **Steps** `{ tick, mission, action, input? }`: each goes, without `tick`, to the game's
  `HeadlessGame.mission(step)` after the state of its tick and after that tick's orders, in file
  order. `open`, `delegate` and `quit` mean what they mean in a world run. **`play` starts the
  mission's real kit round** (the mini game its `play` names, built by the game's adapter from the
  snapshot the mission opened with); its `input`, when given, is the round's own recorded
  `ScriptedInput` script, frame 0 being the round's first tick (else the round reads the run's
  input). The run's following ticks play the round until it ends while the world waits (a step or
  order at such a tick is refused, `round_hosted`); the outcome is whatever the round's report
  maps to, and the result commits by itself at open tick + `worldTimeCost`. Check it with
  assertions on the snapshot (the mission's record after the commit; `missions.round` while a
  round is hosted and on the tick it ends).
- **Load checks** (exit 3): `outcome` and `experienceTicks` on a game run (the round gives both),
  `input` on anything but `play`; tick order and ticks as on a world run. A world run's
  `mission_unresolved` check cannot be made (its world ticks are not its game ticks once a round is
  played), so a late `play` or `quit` is refused at run time (`mission_committed`).
- A game without `mission` is a usage error (exit 2), as with `orders`.
- **Refused steps** are listed in `refusedMissions` (`{ tick, mission, action, code, error }`, the
  game's refusal) and the run goes on. `experience` is the game's `missionExperience()` (the
  rounds' ticks per mission), never written to the world.
- `dump` and replay files keep the steps as for a world run. `game-missions-run.test.ts` covers
  steps, refusals, experience, hashes, dump, replay and the usage error with a plain-JS game;
  `missions-run.test.ts` the field errors of each kind of run.

## Campaign runs and save codes

Engine 0.13 (docs/BUILD-LOG.md, Engine 0.13, decisions 6, 7 and 9, items 225, 226 and 228): a
game's campaign (`engine/core/campaign.ts`) plays its entries in order, and what carries from one
scenario to the next is a campaign save, packed into a short save code
(`engine/core/campaign-code.ts`). A game run file can start from one and check one:

```json
{
  "game": "..",
  "ticks": 300,
  "from": { "run": "played.run.json" },
  "codes": [{ "tick": 300, "code": "2B4K9-..." }]
}
```

- **`from`** (game runs only; on a world run a schema error at `from`): exactly one of
  `{ "run": "<run file>" }`, relative to this run file, and `{ "code": "<save code>" }`. With
  `run`, the tools play that run to its last tick (no checks) and read its game's campaign save
  there (`HeadlessGame.campaignSave()`: the entry it played ended, its carried record built from
  the world then). With `code`, they decode it against the game's content (`saveCodeContext`:
  its campaigns, missions and `worlds-within/scenario` files). Either way the game is created with
  `HeadlessOptions.campaign` set to that save and plays the campaign's next entry from tick 0.
  Errors (exit 3, in the run file): a code's refusal code at `from.code` (`code_empty`,
  `code_typo`, `code_newer`, `code_layout`, `code_campaign`, `code_position`, `code_record`);
  at `from.run` `from_chain` (the source run has a `from` itself: one step deep in 0.13),
  `from_game` (it plays another game) and `no_campaign` (its game gives no campaign save there);
  `campaign_done` at `from` (the save is past the campaign's last entry). The world's seed is the
  save's (`save.seed`, as the game's page plays a code), so a run file with `from` may leave
  `seed` out; a `seed` that differs from the save's is `seed_mismatch` at `seed`. The result's `from` is
  `{ run, code, campaign, position }` (null without one). A run from a run and a run from that
  run's code give the same hashes (`campaign-run.test.ts`).
- **`codes`** (game runs only): `[{ tick, code }]` in tick order, each at most `ticks`. At that
  tick the game's campaign save is packed and compared with `code` (case, dashes and spaces do not
  matter); a different one, or none, fails the run like an assertion (`failure.kind` `code`,
  `path` `codes.<i>`, `expected` the file's code, `actual` the run's), so a run file can pin the
  save code its end gives. `codes` counts them in the result, `codesChecked` those compared.
- A game without `campaignSave()` cannot take `from` or `codes` (exit 2), as with `orders`.
- Replay files keep `from` (a `run` rewritten relative to the replay) and the `codes` up to the
  failing tick (and, from Engine 0.14, `start`).
- `pnpm -s cli code <run-file> --json` prints the code at the run's last tick (`--tick N` for
  another). Tests: `campaign-run.test.ts` (a plain-JS game in a temp folder on two RTS maps and a
  campaign), and `save-code.test.ts` (the sim's captive fixtures: a code taken at the end of the
  first scenario restores the follow-up's start world with equal hashes).

## Start levels and entries

Engine 0.14 (gap G9; docs/BUILD-LOG.md, Engine 0.14, decision 6, item 252): a game run file can
start at a later level or campaign entry, so a later level's run file no longer replays the
earlier levels' input (and a change to level 1 moves no hash of it). The sample is
`games/platformer-test/runs/level-3-start.run.json`, level 3 from its own tick 0:

```json
{ "game": "..", "seed": 1, "start": { "stage": 2 }, "ticks": 869, "input": { "steps": [...] } }
```

- **`start`** is exactly one of **`{ "stage": n }`**, a level of the game's level sequence,
  0-based like the snapshot's `stage` (the platformer kit's `LevelSequence`: that level, fresh, and
  on from it as from any level), and **`{ "entry": "<id>" }`**, a campaign entry by id (the mini
  siege's `dawn`: that entry fresh, at its own start, with no carried record and nothing committed
  before it; `games/samples/mini-siege/runs/dawn-fresh.run.json`). Tick 0 is that level's or
  entry's first state: `level-3-start`'s ticks are `level-3`'s from tick 1161 on, with the same
  hashes.
- It reaches the game as `HeadlessOptions.start` (`engine/core/headless.ts`). The tools check it
  first against the game's headless module's optional **`starts(content)`** (`HeadlessStarts`:
  `stages`, the level ids in play order, and `entries`, the campaign's entry ids): a game without
  it, or without stages (entries) for a `stage` (`entry`) start, is **`no_start` at `start`**; a
  stage past the last level is `bad_start` at `start.stage`, an entry the game lacks `bad_start` at
  `start.entry`, each naming what the game has (exit 3, before anything is played). The
  platformer test, the platformer lab (stages, via the kit's `stageStarts` and `startStage`) and
  the mini siege (entries) export `starts`.
- Schema errors (exit 3): neither or both of `stage` and `entry`; `start` with `from` (at `start`:
  `from` already names where the run starts); `start` on a world run.
- `run`, `dump`, `trace`, `code` and `screenshot` (`ShotJob.start`, handed to `createView`) all
  start there, and their results carry `start` (null without one). A replay file keeps `start`
  and reproduces (`start-run.test.ts`).
- The full-replay run files (`level-2`, `level-3`, `level-4`) stay as they were, and their hashes
  with them; `level-2-start`, `level-3-start`, `level-4-start` and the lab's `mini-game-start`
  sit beside them.

## Mutant checks

A kit names its rules (`engine/core/rules.ts`: `defineRules`, `RuleSwitch`; the top-down kit's
are `TOPDOWN_RULES` in `kits/topdown/rules.ts`) and guards the code of each with
`rules.isOn(id)`. Each kit's hook (`kits.ts`) gives its list. `pnpm -s cli mutants <run-file> --json`
plays the run as it is, then once per rule with that rule off. A rule the run fails without is
`guarded`. The rules the run is `expected` to guard are its `guards` when the run file gives them,
else every rule it does not skip; an expected rule it still passes without is `weak` (text:
`weak: does not guard <id>`): the run's checks would not notice that rule breaking. A rule that is
neither guarded nor expected is listed as `not guarded` in text, and is not weak. Strengthen a
weak run with an assertion or invariant that the rule decides (walk-east guards
`doors-change-room` because it asserts the room it ends in). Rules the run file switches off
itself are `skipped`. To see one mutant fail: `pnpm -s cli run <run-file> --disable-rule <id>`.

- **Strict kits.** A kit opts in with `strictMutants: true` in its hook (`engine/core/kit.ts`).
  Then a weak rule fails `mutants` (exit 4, `strict: true`); for other kits (topdown) weak rules
  are only reported (exit 0).
- **A whole game.** `pnpm -s cli mutants games/<game> --json` plays every run file of the game
  (`*.run.json` in a `runs/` folder under it) the same way. `rules[].guardedBy` lists the run
  files that guard each rule and `unguarded` the rules no run file guards (text:
  `weak: no run file guards <id>`). Here a run is held only to its own `guards`: `runs[].weak` is
  the rules in its `guards` it does not guard (empty for a run without `guards`), since the game
  as a whole must guard every rule, not each run. For a strict kit an unguarded rule or a run with
  a weak rule is exit 4; any run that fails as it is is exit 4 for every kit; a bad run file is
  exit 3 with every run file's errors.
- Tests: `mutants.test.ts` adds a test-only strict kit to the kit list (`vi.mock('./kit-list')`)
  and writes its game, a plain-JS headless module, to a temp folder.

## Replay files

When `run` fails a check it writes a replay file to
`.ww-out/replays/<run name>-t<tick>-<hash>.run.json` (the output folder; `io.outDir` in tests) and
puts its path, relative to the working folder, in `replayFile`. The name comes from a hash of the
content, so the same failure writes the same file. A replay is an ordinary run file: `run` and
`dump` take it.

```json
{
  "game": "../../games/demo",
  "seed": 1,
  "ticks": 100,
  "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
  "assertions": [{ "tick": 100, "path": "hero.room", "op": "eq", "value": "nowhere" }],
  "invariants": [{ "path": "hero.hp", "op": "gte", "value": 0 }],
  "hashEvery": 40,
  "replay": {
    "source": "../../games/demo/runs/walk-east.run.json",
    "failure": {
      "tick": 100,
      "kind": "assertion",
      "path": "hero.room",
      "op": "eq",
      "expected": "nowhere",
      "message": "hero.room is \"guard-room\", expected \"nowhere\""
    },
    "hashes": [
      { "tick": 0, "hash": "d29e6b40530102ce" },
      { "tick": 100, "hash": "b1d5fbcc23948889" }
    ]
  }
}
```

- `game` and `replay.source` are relative to the replay file's folder, like `game` in any run file.
- `seed` is always written out (the seed the source run used). `ticks` is the first failing tick
  (1 when that is tick 0). `input.steps` keeps the steps with `frame` up to the failing tick,
  `assertions` those at or before it, `invariants` and `hashEvery` all as they were. A run's `from`
  and `start` (Engine 0.14) are kept, so the replay starts where the source run did.
- `replay.failure` is the source run's first failed check (`index` is left out: the assertion list
  is shorter). `replay.hashes` are the hashes the source run printed, up to and including the
  failing tick (`hashes` in its result).
- Playing a replay, `run` gives `replay: { source, expectedTick, reproduced, hashesChecked,
hashMismatch }`: `reproduced` is true when the first failure is at the same tick with the same
  check (kind, path, op, expected); `hashMismatch` is the first stored hash that differs,
  `{ tick, expected, actual }`, or null. A mismatch means the game's state is different by that
  tick (the game or its content changed since the source run); it fails the run (exit 4) even
  if every check passes. A replay that fails writes no further replay.
- Debugging: `run` the replay, `trace <replay> --paths ...` over the ticks before the failure to
  see when a value went wrong, then `dump <replay> --tick N` at the failing tick, or at the
  mismatch tick and the stored hash tick before it, to see what changed.

## Screenshots

`pnpm -s cli screenshot games/demo/runs/walk-east.run.json --tick 60 --json` writes
`.ww-out/screenshots/walk-east-t60.png` (or `--out <file>.png`, relative to the working folder) and
prints its `path`, `width`, `height` (the game's picture size: `screen` in `game.json`, 256x240
by default), `bytes` and `sha256` (the whole PNG, hex).

- The game names a view module in `game.json` (`view`, optional), which exports
  `createView(content, seed, opts?)` returning a `ViewGame` (`engine/core/view.ts`): the headless
  game plus `screen` (the manifest's picture size) and `render(r)`. The demo's is `games/demo/view.ts`, drawing what its scene draws. No
  `view` is a `no_view` content error at `view`; a missing file is `missing_file`.
- How: the command first plays the run headless to tick N (as `dump`), then serves the repo with
  a Vite dev server (middleware mode, no HMR, no dependency pre-bundling) and opens
  `engine/tools/screenshot/index.html` in headless Chromium with a viewport of the manifest's
  `screen` size (`ShotJob.screen`), devicePixelRatio 1. The page gets the game's file texts, seed,
  input, switched-off rules and picture size, checks the content, imports the view module by URL
  (the game is still loaded by folder path), steps it exactly N times with `ScriptedInput` (no
  real-time loop, no audio), drawing every tick (tick 0 included, as a player's screen would) with
  the canvas2d `CanvasRenderer` onto a canvas of that size (it fails if the view's `screen`
  differs), and returns the last picture as `canvas.toDataURL('image/png')`: the canvas, not a page
  screenshot, so page scaling and font smoothing stay out. A run file's recorded `orders` go to the
  view's `order` and, from Engine 0.11 T9, its game `missions` steps to the view's `mission` (the
  `HeadlessGame` method), after each tick's orders as `run` hands them over (`ShotJob.missions`),
  so a picture can show a mission round or the battle after its commit (the mini siege's). From
  Engine 0.13 T8 (gap M33) a run's `from` is played as `run` plays it: the job carries the start
  save `run` reads (`ShotJob.campaign`, `PlayedRun.startSave`) and the page hands it to
  `createView` as `HeadlessOptions.campaign`, so a follow-up's picture is the follow-up's. A run's
  `start` (Engine 0.14, gap G9) goes the same way (`ShotJob.start`, `HeadlessOptions.start`).
- `hash` is the state hash of the snapshot the page drew; `headlessHash` is `dump`'s at that tick;
  `hashes` are the state hashes the page saw while drawing every tick (tick 0, every `hashEvery`
  ticks and the last, as `run` lists them). All must match the headless run (`matchesHeadless`);
  if not, the view plays (or its drawing changes the state) differently from the headless module
  and the command exits 4 (the PNG is still written), with `message` naming the first tick.
- Same run file and tick, same machine: byte-identical PNG (`screenshot.test.ts` checks it for both
  backends, that different ticks give different PNGs, the software-GL refusal and the 3D content
  errors). Text drawn with `debugText` uses a system font, so a
  PNG's hash can differ between machines; compare hashes on one machine.
- `--backend three` (Engine 0.6): the 3D picture. The page needs the view's `frame()` (else exit 3,
  `no_frame_hook` at `view` in `game.json`) and the command a skin with `"backend": "three"` in the
  game's content (else exit 3, `no_three_skin` at `content.skin`, listing the skins it has; checked
  before Chromium starts). The skins are the core `skinSet(content, 'three')` (Engine 0.7 T8):
  `three.json` for the game and `three-<id>.json` for the frames of mini game `<id>` (a scene of
  their own on the same canvas, `withSkin`, picked by `status.miniGame`). The page makes a WebGL
  canvas of the `screen` size and a `ThreePresenter` with the main skin (clear colour: the view's
  `background`, else black), reads the
  renderer string (`webglRendererInfo`) first, then steps exactly as for canvas2d, syncing the
  scene with every tick's `frame()` (so the camera's lerp is the one play shows) and rendering
  once at tick N; the PNG is `toDataURL` of the WebGL canvas (`preserveDrawingBuffer`). The result's
  `renderer` is that string (null for canvas2d); `matchesHeadless` still compares state hashes.
- The renderer check: Chromium runs with the GPU on for `three` (`--enable-gpu
--ignore-gpu-blocklist`; canvas2d keeps `--disable-gpu`, so its PNGs are unchanged). If the
  renderer is a software one (`isSoftwareRenderer`: SwiftShader, llvmpipe...) the command exits 4
  with `refused: 'software_gl'`, `renderer` and a `message` naming the string and
  `--allow-software-gl`, and writes no PNG; no WebGL context at all is exit 4 with
  `refused: 'no_webgl'`. With `--allow-software-gl` Chromium starts with `--use-angle=swiftshader
--enable-unsafe-swiftshader`, so SwiftShader is used on purpose and two runs give the same bytes.
  In this container (no GPU) that flag is needed: `pnpm -s cli screenshot
games/platformer-lab/runs/start-to-goal.run.json --tick 120 --backend three --allow-software-gl
--json`. 3D PNG hashes differ between GPUs and drivers; compare them on one machine.
- Chromium: `pnpm exec playwright install --with-deps chromium` (CI does this). Without it the
  command crashes (exit 5) with that line, and the browser tests skip with a message locally; in
  CI (`CI` set) they are required.

## Generated docs

`pnpm docs:gen` writes the kit list (`kit-list.ts`) and three pages from the code's own schemas; `pnpm docs:check` regenerates them
in memory and exits 4 with `<file>: <n> lines differ; first at line N: ...` for each stale one.
`docs.test.ts` makes the same check, so `pnpm test` fails on stale docs (CI also runs
`pnpm docs:check`).

- `docs/reference/cli.md`: `help` and `help <command>` for every command, the text `helpText`
  (`commands/help.ts`) prints, so the page and `pnpm cli help` are the same text.
- `docs/reference/schemas.md`: one section per format, from `defaultDocSources().subjects`: the
  manifest, run files, the engine's content kinds and each kit's (`allKits()`, from each kit's hook),
  and (Engine 0.11) "Mini game params", each kit's `paramsDocs()` (the topdown kit's
  `mission-room`, example `mission-room-params.json`). Each has a field
  table (`fieldRows`) and an example from `docs/reference/examples/<name>.json|.txt` (plus a
  kind's part files, `room.map.txt`), which must pass the schema or generation fails.
- `docs/CHEATSHEET.md`: hand-written, except the blocks between `<!-- generated:<name> -->` and
  `<!-- /generated:<name> -->` (`CHEATSHEET_BLOCKS`: `files`, `run-file`, `check-ops`, `commands`,
  `exit-codes`). Every block must be there, and every marker must have a generator.
- Every field of a command, the manifest, the run file and every content kind needs a
  `.describe('...')`: the test fails on a field without one. A new content kind needs an example
  file. After changing a schema, a description or a command: `pnpm docs:gen` and commit the pages.

## Adding a command

1. Add `commands/<name>.ts` with `defineCommand({ name, summary, args, flags, run, text? })`.
   Describe every field with `.describe(...)`: that is its help line.
2. Register it in `defaultRegistry()` (`main.ts`).
3. Return `{ exit: EXIT.<name>, result }`; throw `UsageError` for a bad command line. Any other
   exception is a crash.
4. Test it through `main` with captured IO (see `main.test.ts`), and list it here and in
   `docs/modules/engine-tools.md`.
5. Run `pnpm docs:gen` so the CLI reference and the cheat sheet list it.

## Rules

- May import anything in `engine/` and `kits/` (`engine/sim` through `@engine/sim/index`).
- Loads a game by its folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/` (`tests/architecture/tools-no-game-import.test.ts` and `dependency-rule.test.ts`).
- Every run is repeatable from a seed, and nothing in a result depends on the clock: the capped
  output file is named by a hash of its content.
