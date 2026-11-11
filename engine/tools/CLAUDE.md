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
  `kit` and of every kit in `uses` (A game on two kits, below), each made with the manifest's
  `kitOptions` (`KitDef.kinds(manifest)`, Engine 0.15 T11, gap G17), and checks those options
  against each kit's `options` schema: `unknown_option` at `kitOptions.<kit>` (a kit the game does
  not use, or one with no options) or `kitOptions.<kit>.<field>`, `bad_option` at the field. No Node imports, so the screenshot page uses them in the
  browser too (`game-loader.ts` re-exports them).
- `kits.ts`: the kits by the `kit` (and `uses`) names in `game.json`: `allKits()`, `findKit(name)`,
  `loadKit(name)` (throws `unknownKitMessage(name, field?)` for an unknown kit), `kitKinds(name)`,
  `kitRules(name)` and (Engine 0.14, gap G12) `gameKits(manifest)` (`kit` then each of `uses`),
  `lookupRuleId(raw, kits, where?)` (a bare id is the main kit's rule, `kit:id` another kit's; the
  reason when the kit or rule is unknown) and `qualifiedRuleId(rule, mainKit)` (bare for the main
  kit, `kit:id` otherwise). Each kit says what it adds through its own hook, `kits/<name>/kit.ts` exporting
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
  `worldScenarios(content)` (Engine 0.15 T7, lesson D7): every `worlds-within/scenario` content
  file built at tick 0 with `engine/sim` (its snapshot, key table and the missions its
  opportunities offer), handed to `miniGameParamErrors` so a mission's `checkUse` checks its
  selectors against the worlds it is offered in.
- `run-file.ts`: the run-file schema (`runFileSchema`, with `orderEntrySchema` for recorded
  orders and `missionEntrySchema`/`MISSION_ACTIONS` for mission steps), `readRunFile(cwd, path)`, the check ops (`CHECK_OPS`, `CHECK_OP_MEANINGS`),
  `valueAt(state, path)` and `failsCheck(state, check)`.
- `headless-run.ts`: `playRun(cwd, runFile, { untilTick?, disableRules?, withSave?, onTick? })` loads the game, imports its headless
  module by the path in `game.json` (dynamic `import()` of a file URL, never a static import),
  checks the run file's `disableRules` and `guards` against the rules of the game's kits (bare ids
  `kit`'s, `kit:id` a `uses` kit's; A game on two kits, below), creates the game with
  `headlessRules(mainKit, byKit)` (`HeadlessOptions.disabledRules` and `disabledRulesByKit`; the
  result's `disabledRulesByKit` lists every kit), plays the ticks and
  makes the checks, hands recorded `orders` over at their ticks and compares the run file's sync
  `hashes` (Recorded orders, below); for a world run it builds the world instead (`world-run.ts`).
  `stateHash(snapshot)` (re-exported from `engine/core/state-hash.ts` since Engine 0.14 T8, so a
  browser page's step hook hashes with the same code), `orderOf(entry)`, `saveCodeNow(save, ctx)`. From Engine 0.13 it starts a
  game run from its `from` and checks its `codes` (Campaign runs and save codes, below).
  The snapshot of a tick is taken only when something reads it (a check, a hash, `onTick`, the
  last tick; Engine 0.16 part D, D9), so a long run that hashes every 100 ticks does not copy the
  world every tick (an invariant still reads every tick's). `onTick(tick, snapshot)` (Engine 0.14) sees every tick's snapshot as it is played, so a command
  that reads the state per tick (`trace`) uses the one playing loop. A game run's `start` (Engine
  0.14, gap G9) is checked against the game's `starts(content)` and handed to `createGame` as
  `HeadlessOptions.start` (Start levels and entries, below); `PlayedRun.start` is it, or null.
  `withWorld` (Engine 0.14 T7) reads the world's event log and timeline at the last tick
  (`PlayedRun.worldEvents`, `.timeline`; World event log and timeline, below). Engine 0.14 T9
  (`record --bot`): `prepare(game)` sees a game run's game once it is created, `frameFor(game,
scripted)` picks the frame each step reads, and `missionStep(step, index)` hands over a
  mission step in place of the file's entry.
- `world-data.ts` (Engine 0.14 T7): `playWorldData(cwd, runFile, untilTick)`, a run's event log
  and timeline for `events` and `timeline`, or `no_world` (`noWorldError`) for a game without the
  hooks.
- `dump-file.ts` (Engine 0.14 T7): dump files, `dumpFileSchema`, `parseDumpFile(text)`,
  `DUMP_FORMAT` (`worlds-within/dump`) and `DUMP_VERSION`; no Node imports, so the debugger page
  reads dump files with the same schema.
- `world-run.ts`: `loadWorldRun(cwd, runFile, worldFile, seed?)` builds a world run's world from
  its scenario with the engine system set the scenario names (`worldSystemSet(json)`:
  `SYSTEM_SETS` from `engine/sim`, `village` when it names none), no event log unless `{ log: true }`
  asks for one (Engine 0.14 T7: `events`, `timeline`, `dump --out`), and returns it
  with the set's name and the scenario's keys (`scenarioKeys`) (World runs, below);
  `loadMissionDefs`, `applyMissionStep` and `settleWorld` drive a world run's `missions`
  (Missions in world runs, below).
- `replay.ts`: replay files. `writeReplay(played, cwd, outDir)` writes one for a failed run,
  `replayOf` builds its JSON, `checkReplay` compares a replay's run with its stored failure and
  hashes.
- `screenshot.ts`: `serveRepo({ allow?, port?, handle? })` (Engine 0.14 T10: the repo served with
  Vite in middleware mode on 127.0.0.1, a free port by default, `handle` answering a request
  before Vite; the debugger's server uses it too) and `takeScreenshot(job, gameAbs, viewAbs)`, which serves the repo that way, opens the screenshot page in headless Chromium (Playwright) and
  returns the PNG bytes (or the page's `ShotRefusal`), and from Engine 0.16 T14
  `takeScreenshots(requests, launch)` (several jobs, each on a fresh page, in one Chromium behind
  one served repo) and `pngBytes(dataUrl)`; `launchChromium(opts?)` (throws
  `NoBrowserError` with the install command), `chromiumArgs(opts?)` (Chromium's flags per
  backend), `servedPath(abs)`, `pngSize(png)`.
- `check-values.ts` (Engine 0.14 T10): `CHECK_OPS`, `CheckOp`, `valueAt` and `failsCheck`, the
  run file's checks as pure functions (no Node imports), so the debugger page makes the same
  checks; `run-file.ts` re-exports them. Since Engine 0.15 T7 both take the world's key table
  (`WorldKeys`) for keyed paths, and `unknownKeyAt(state, path, keys)` finds a key the table lacks
  (Keyed paths, below).
- `event-filter.ts` (Engine 0.14 T10): `EventFilter`, `filterChanges`, `causeMatches`,
  `changeLine`: the event log's filters, shared by `events` and the debugger page.
- `debugger/` (Engine 0.14 T10): the in-browser simulation debugger, its own module with its own
  `CLAUDE.md` (the page, its pure model, its job and its Node server; The debugger, below).
- `shot-job.ts` (Engine 0.16 T14): `shotSetup(ctx, runFile, { tick, backend, allowSoftwareGl,
tiles? })`, the screenshot page's job for a run file (played headless to the tick, the game and
  its view module checked, the `three` skin for 3D, the `canvas2d` skin for PixiJS) and
  `invalidShot`, shared by `screenshot` and `sheet`.
- `png-diff.ts` (Engine 0.16 T13b-5): `decodePng(png)` (8-bit RGB or RGBA, every row filter) and
  `pixelDiff(a, b, { threshold, region?, skip? })` (pixels whose R, G or B differ by more than the
  threshold: count, share, largest channel difference, bounding box), for the PixiJS/Canvas2D
  parity test (Visual parity, below). Node only.
- `sheet.ts` and `sheet-overlay.ts` (Engine 0.16 T14): `sheet`'s tile grammar (`parseTiles`,
  `SHEET_BACKENDS`, `tileMeta`), `composeSheet(pictures, { columns, scale, title? })` (the tiles
  laid out with labels in headless Chromium) and, pure, the overlays a tile (or, from Engine 0.16
  part B, `screenshot --overlay`) draws (`parseOverlay`, `checkOverlay`, `sheetLevels`, `overlayUi`: the game's menu screens as the shell builds them
  or a `ui` file's screen, stepped with no input, as UI kit draw items; `overlayTransition`: a
  transition slot or kind at an age). Sheets, below.
- `screenshot/`: the tools-only screenshot page (`index.html`, `page.ts`) and the job it takes
  (`job.ts`). Never in the Pages build: `build/pages.ts` only builds the launcher and game pages.
- `content-path.ts`: paths for the editing verbs (`parsePath`, dotted or JSON pointer) and the
  edits on a parsed file (`getAt`, `setAt`, `addAt`, `removeAt`), plus `parseValue` (JSON, else a
  string). Text maps (Engine 0.14, gap G10): `parseGridRegion` (`rows.R1-R2`,
  `rows.R1.C1:R2.C2`), `gridRegion`, `gridRuler`, `rulerText`, `blockLines` and `pasteBlock`.
- `content-file.ts`: `openContentFile(cwd, path)`: what an editable file is (its kind and form),
  how its text becomes a tree and back, and the check a new text must pass before it is written.
- `json-format.ts`: reads JSON remembering which objects are spread over lines, and writes it back
  through Prettier with the repo's settings, so edits are lint-clean and change little.
- `schema-doc.ts`: `fieldRows(schema)`, a Zod schema as rows of a field table (path, type,
  required, default, limits, description), walked from Zod's `toJSONSchema` of the input shape.
- `mini-game-docs.ts` (Engine 0.15 T11, gap M11): `gameMiniGameDocs(root)` /
  `repoMiniGameDocs()`, the mini games the repo's games define (`gameFolders(root)`: every
  `games/**` folder with a `game.json`; each game's headless module imported by path for its
  `miniGames(content)`), one `GameMiniGameDoc` per def with a `paramsSchema` whose id no kit's
  `paramsDocs` has, for the generated params pages (`MINI_GAMES_DIR`).
- `docs-gen.ts`: the generated docs (below): `defaultDocSources()`, `generateDocs`, `writeDocs`,
  `staleDocs`. `docs.ts` is the entry point of `pnpm docs:gen` and `pnpm docs:check`; it writes
  (or checks) `kit-list.ts` first and only then imports `docs-gen.ts`, which reads every kit.
- `commands/`: one file per command (`help.ts`, `validate.ts`, `run.ts`, `dump.ts`, `trace.ts`, `events.ts`, `timeline.ts`, `code.ts`, `screenshot.ts`, `sheet.ts`, `debug.ts`, `mutants.ts`, `record.ts`, and `edit.ts`
  for `get`, `set`, `add`, `remove` and `paste`; `edit.ts`'s `writeValue(file, segments, value)`
  is the checked write `record` uses).

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
  field (`params.outcomes.0.outcome`). Since Engine 0.15 T7 (lesson D7) each mission is also
  checked against the game's world scenarios whose opportunities offer it (any
  `worlds-within/scenario` content file, built at tick 0): a selector that picks nothing there
  (`params.foes.0.select: picks no standing world entity in .../village.world.json`), a key,
  squad or rule name the scenario does not have, a budget faction with no `Stockpile`, more walls
  than build cells; a mission no scenario offers gets no world check. A game without the export is checked as before. Result:
  `{ game, fileCount, errorCount, files: [{ file, errors }], errors: ContentError[] }` (errors as
  in `engine/core/content/validate.ts`, with repo paths). Exit 0 or 3. A folder that is not there
  is a usage error. Its own content codes: `unknown_kit` (at `kit` or `uses.<i>` in `game.json`),
  `duplicate_kit` and `kind_clash` (at `uses.<i>`; A game on two kits, below). From Engine 0.16
  T10 it reads the game's `assets/` folder too and checks it (`engine/core/content/assets.ts`):
  `missing_credits` at `assets/CREDITS.md` (none, a pack folder it does not name, a missing
  `Source`/`Author`/`Licence`), `bad_licence` (not CC0, no owner decision cited) and, at the skin
  file, `missing_file`, `bad_image` and `frame_outside_image` at `images.<id>...`. It also runs
  each kind's checks across files (`checkAll`), such as the top-down rooms' `invalid_dungeon`, so
  content it passes is content the game can build.
- `run <runFile> [--disable-rule <ids>]`: plays a run file headless and checks it (below).
  `--disable-rule` switches kit rules off (comma-separated ids, on top of the run file's
  `disableRules`; `kit:id` for a kit the game `uses`; an id no kit of the game names, or a kit
  prefix the game does not use, is a usage error). `disabledRules` in the result is bare for the
  game's own kit and `kit:id` for another. Result: `{ run, game, world, seed,
disabledRules, ticks, lastTick, passed, checks: { assertions, invariants }, failure, failures, hashes: [{ tick,
hash }], finalHash, orders, ordersPlayed, refusedOrders, missions, missionsPlayed, refusedMissions,
experience, hashesChecked, hashMismatch, from, start, codes, codesChecked, replayFile, replay, debug }`.
  `failure` is the first failed check, `{ tick, kind: 'assertion' |
'invariant', index, path, op, expected, actual, message }`, or null; `failures` is every check
  that failed at that tick. The run stops at the first failing tick and then writes a replay file
  (below) whose path is `replayFile` (null when the run passed, and for replays). `replay` is the
  replay check on a replay file (null otherwise). `debug` (Engine 0.14 T11) is the line that
  opens a failed game run in the debugger at its failing tick, `pnpm cli debug <replayFile>` (the
  run file itself for a replay that failed again, with `--tick` at a sync hash mismatch), also
  printed in the text form (`open it in the debugger: ...`); null when the run passed and for a
  world run. `orders`, `ordersPlayed`, `refusedOrders`,
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
- `dump <runFile> --tick N [--out file.json]`: plays to tick N (no checks) and prints `{ run, game, world, seed, start, tick,
hash, state, orders, missions }`, the whole snapshot and the recorded orders and mission steps
  applied on the way (`tick < N`). N from 0 to the run's `ticks`, else a usage error. Capped like
  everything else: a big state gives the envelope plus `fullOutput`. `--out` (Engine 0.14 T7)
  also writes a dump file for the debugger (World event log and timeline, below) and prints the
  result without `state`, plus `out`, `bytes`, `format`, `events` (the number of changes, or null)
  and `timeline` (whether there is one); an `--out` not ending in `.json` is a usage error.
- `events <runFile> [--from N] [--to M] [--entity id] [--cause c] [--component name]` (Engine
  0.14 T7): the world's event log after the run's last tick (World event log and timeline, below).
  Result `{ run, game, world, seed, start, tick, worldTick, logFrom, from, to, entity, cause,
component, count, events }`. Exit 0; 3 for a bad run file or content, or `no_world` at `headless`
  in `game.json` for a game without the hooks; 2 for `--from` after `--to`.
- `timeline <runFile> [--tick N]` (Engine 0.14 T7): the timeline record at tick N (default the
  last). Result `{ run, game, world, seed, start, tick, ticks, worldTick, logFrom, timeline, entries
}`. Exit 0; 3 as for `events`; 2 for a `--tick` after the run's `ticks`.
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
- `screenshot <runFile> --tick N [--out path] [--backend canvas2d|three|pixi] [--allow-software-gl]
[--scale N] [--overlay o]`:
  a PNG of the frame at tick N (Screenshots, below). Result: `{ run, game, seed, start, tick, backend,
renderer, path, width, height, scale, overlay, bytes, sha256, hash, headlessHash, hashes, matchesHeadless }`.
  Exit 0, 4 when a state hash the page saw is not the headless one or (`three`) WebGL is not
  hardware-backed without `--allow-software-gl`, 3 for a bad run file or content, a game without
  `view`, or (`three`, `pixi`) a view without `frame()` or a game without a `three` (`canvas2d`)
  skin, 2 for a bad
  `--tick`, `--out` or flag, 5 when Chromium is not installed. With `--backend three`, a round the
  `three` skin lists in `rounds2d` (Engine 0.16 F8) is drawn as the 3D page draws it: every one of
  its frames through the game's Canvas2D skins, and a shot whose tick is in such a round is that
  2D picture scaled up to the 3D picture's size (1920x1080 for the mini siege).
- `sheet <runFile> --ticks <tiles> [--backend 2d|3d|pixi] [--allow-software-gl] [--out path]
[--columns N] [--scale N] [--labels a|b|...] [--title text]` (Engine 0.16 T14): labelled
  screenshots tiled into one PNG (Sheets, below). Result `{ run, path, width, height, bytes,
sha256, columns, scale, matchesHeadless, tiles, plays }`. Exit 0; 4 a page's state hashes differ
  from the headless run's (the PNG is still written) or a 3D play is refused (software WebGL
  without `--allow-software-gl`); 3 bad content (as `screenshot`); 2 a bad tile, a tick past its
  run, an overlay the game cannot show, labels that do not match the tiles or a bad `--out`; 5 no
  Chromium.
- `debug <file> [--tick N] [--port P] [--check]` (Engine 0.14 T10): the in-browser simulation
  debugger on a run, replay or dump file (The debugger, below). Result `{ url, file, kind, game,
ticks, openTick, failure, serving }`; with `--check` also `{ tick, hash, headlessHash, matchesHeadless,
mismatch, eventCount, failure, reproduced, hashMismatch }` (Engine 0.14 T11: a replay's failed
  check as the page found it, whether it reproduced, the first stored hash that differs). Exit 0; 4
  (`--check`) when the page's hash is not the headless run's, the page found a mismatch or a
  replay did not reproduce; 3 for a run file, dump file or content that breaks its schema; 2 for
  a file that is not there, a `--tick` past the run (or not a dump's own tick) or a world run; 5
  when Chromium is not installed (`--check`).
- `mutants <target>`: mutant checks (below) on a run file or a game folder, over the rules of
  every kit the game uses. Run file result: `{ run, game, kit, strict, kits: [{ kit, strict, rules
}], baseline: { passed, failure }, guards, rules: [{ id, kit, strict, description, skipped,
expected, passed, guarded, failure }], guarded, weak }`. Game folder result: `{ game, kit, strict,
kits: [{ kit, strict, rules, unguarded }], runs: [{ run, baseline, guards, guarded, weak }], rules:
[{ id, kit, strict, description, guardedBy }], unguarded }`. `kit` and `strict` are the game's own
  kit's; rule ids are bare for it and `kit:id` for a `uses` kit. Exit 0 when every run passes as
  it is and no strict kit's rule is weak (and, for a strict own kit, none unguarded); 4 when a run
  fails as it is (its rules are not tried), a weak rule belongs to a strict kit, or the game's own
  strict kit has an unguarded rule (a kit that is not strict only reports them, and a `uses` kit's
  unguarded rules are only reported; Mutant checks, below); 3 for a bad run file or content.
- `record <runFile> --mission <id> (--input <recording.json> | --bot <plan>) [--play N]` (Engine
  0.14 T9, gap M19): writes a hosted round's input into a run file's `play` step (Recording a
  round, below). Result `{ run, mission, play, tick, source, ticks, steps, input, file, kind, path,
pointer, written, verified, changed, restored, passed, finalHash, hashMismatch, failure,
crossErrors }`. Exit 0 written, verified and the run passes; 4 the run fails with it (the file is
  put back, `restored: true`) or the read-back differs; 3 a run file or recording that breaks the
  schema (`errors`, the file untouched); 2 no `play` step for that mission (or `--play N` past
  them), no or both sources, a recording of another mission or of another tick, an unfinished
  round, a bad bot plan, no bot for the round's mini game, or a game that cannot record.
- `get <file> <path> [--ruler]`: `{ file, kind, path, pointer, value }`; on a text grid's rows, a
  range or a rectangle also `{ rows, ruler, width, height, firstRow, firstColumn }` (Text maps,
  below). `set <file> <path> <value>`, `add <file> <path> <value>`, `remove <file> <path>` and
  `paste <file> rows.R.C <block> [--from-file path] [--transparent ch]`: the editing verbs
  (below). Result `{ file, kind, path, pointer, written, verified, changed, before, after,
crossErrors }` (and `region` for `paste`); exit 0 written and verified, 3 refused (with `errors`,
  file untouched), 4 written but the read-back differs, 2 a bad path, a bad block or a file that
  cannot be edited.

## Editing content

`get / set / add / remove <file> <path> [value]` edit any of a game's files with one verb set
(and `paste` a text map's rectangle: Text maps, below).

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

### Text maps: a ruler, regions and paste

Engine 0.14 (gap G10; docs/BUILD-LOG.md, Engine 0.14, decision 7, item 253). Every text-grid part
file (top-down rooms, platformer levels, tower-defence maps: `*.map.txt`) has two more paths and
one more verb, so moving one thing in a 60-column level is one call, not a `sed` or a `set` per
cell:

- **`get <grid> rows --ruler`** (or a range, **`rows.R1-R2`**, both rows included) prints the rows
  under a column ruler (a tens line and a units line) with each row's number before it:

  ```text
     0         1
     0123456789012345
   4 #......h.......#
   5 #......@.......O
  ```

  `--json` gives `{ rows, ruler: [tens, units], width, height, firstRow, firstColumn }` (`value`
  is `rows` too; `pointer` is null: a range has no JSON pointer). `--ruler` on any other path, or
  on a file that is not a text grid, is a usage error.

- **`get <grid> rows.R1.C1:R2.C2`** copies a rectangle (corners included): `value`/`rows` are its
  lines, `firstRow`/`firstColumn` its top-left cell. Text mode prints the bare lines, ready to
  save to a file and paste. A range alone prints bare lines too; add `--ruler` for the ruler (its
  columns start at `firstColumn`). Corners out of order or past the grid are usage errors.
- **`paste <grid> rows.R.C <block>`** writes the block over the grid from row R, column C, one
  block line per row. The block is lines of **equal width** split by `\n` (typed as two
  characters, or a real line break), or read from a file: `@path` or `--from-file <path>`
  (relative to the working folder; taken as it is, one final line break dropped). A typed block
  that starts with a real `@` (a player start) is written `\@...`. A block cell equal to
  **`--transparent <ch>`** leaves the cell under it alone (default: none, so a space is written as
  a space and the result is what was typed).
- A ragged block, an empty one, a block that runs past the grid's last row or a row's last column
  (`out_of_bounds: ...`), a path that is not one cell (`rows.R.C`), or both or neither of `<block>`
  and `--from-file` is a **usage error (exit 2), nothing written**: a paste never changes the
  grid's size or a row's width.
- Otherwise the paste goes through `set`'s pipeline: the whole file is checked against its kind's
  schema (the room's legend and size, one player start; a level's legend) and the game for new
  errors, refused with exit 3 and `errors` (file untouched); cross-file problems come back in
  `crossErrors`; the file is read back (`verified`). `before` and `after` are the rectangle's lines
  before and as read back, `region` is `{ row, col, height, width }`, and `changed: false` says the
  file already held the block. To move the demo's courtyard boulder at (2, 3) one cell down and
  left: `pnpm -s cli paste games/samples/dungeon/content/rooms/courtyard.map.txt rows.2.2 '..\nB.' --json`.
- Tests: `edit.test.ts` (Text maps), on the demo's rooms, the tower-defense sample's map and a
  platformer sample level.

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
- Rules (Engine 0.14, gap G12; docs/BUILD-LOG.md, Engine 0.14, decision 8, item 254): every
  kit's. A rule id is **bare** for `kit`'s rule (every run file from before stays valid, its
  hashes with it) and **qualified, `kit:id`**, for a `uses` kit's (`topdown:walls-block-movement`;
  `platformer:jump` in a platformer game is read as `jump` and written bare). `disableRules`,
  `guards` and `--disable-rule` take both; a prefix naming a kit the game does not use, or a rule
  its kit lacks, is `unknown_rule` at that entry (exit 3; a usage error for `--disable-rule`),
  naming the game's kits or the kit's rules. The game is created with `HeadlessOptions.disabledRules`
  (the main kit's ids, as before) and `disabledRulesByKit` (every kit's ids by kit name), and the
  game routes each kit's list to that kit's rule switch: `rulesOffFor(opts, kit)`
  (`engine/core/headless.ts`) into the round's `disabledRules` (the platformer sample's
  `hopperMiniGames(content, rulesOffFor(opts, 'topdown'))`, the mini siege's `miniGames(content,
opts)` for the `mission-room` and `td-defence` rounds). So each `RuleSwitch` only sees its own
  ids. `mutants` tries every kit's rules, each judged by its own kit's strictness (Mutant checks,
  below).
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
  rule list, see Mutant checks; `kit:id` for a kit the game `uses`, A game on two kits). An id no
  kit of the game names is an `unknown_rule` content error at that entry; an id twice is a schema
  error. Replay files keep the rules that were off (qualified where they were).
- `orders` (default none): recorded orders, `{ tick, ...order }` (Recorded orders, below).
- `hashes` (optional): sync hashes `[{ tick, hash }]` the run must give (Recorded orders, below).
- `missions` (default none): mission steps (Missions in world runs, and from Engine 0.11 Missions
  in game runs, below).
- `start` (optional, game runs, Engine 0.14): start at a later level (`{ "stage": n }`, 0-based)
  or campaign entry (`{ "entry": "<id>" }`), fresh, from tick 0 (Start levels and entries,
  below).
- `guards` (optional): the kit rules this run is meant to guard (Mutant checks; `kit:id` for a
  `uses` kit's rule). An id no kit of the game names is an `unknown_rule` content error at that
  entry (exit 3, naming the run file and `guards`); an id twice, or one the run's `disableRules`
  switches off, is a schema error.
- `path`: dotted, into the game's snapshot (`hero.hp`, `entities.0.kind`, `entities.length`). A path
  that is not in the snapshot always fails. Inside a world snapshot an entity is named by
  scenario key, id or kind, not by its place in a list (Keyed paths, below). The top-down kit's paths are listed in
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
  block for every tile shown; a round the skin's `rounds2d` lists, Engine 0.16 F8, is the 2D
  layer's: it needs a `canvas2d-<id>` skin and is left to the Canvas2D pass), and requires every
  hash list to equal the golden file. A run of 5000 ticks or more (the RTS sample's ten-minute
  matches, Engine 0.16 part D, D9) is played through views and presenters only for its first 600
  ticks, against its golden hashes up to there (`tests/runs/view-play.ts`: `loadRun` cuts it with
  `presentedRun`, `full: true` keeps it); the run-file tests and `mutants` play it whole.
- Run every game's run files: `pnpm test tests/runs`, or one by one with
  `pnpm -s cli run <file> --json`.
- A game's headless module (`headless` in `game.json`) exports `createGame(content, seed, opts?)`
  returning a `HeadlessGame` (`engine/core/headless.ts`); it passes `opts.disabledRules` to its
  kit and, on several kits, `rulesOffFor(opts, '<kit>')` to each `uses` kit's rounds.

## Keyed paths

Engine 0.15 T7 (gap M17; docs/BUILD-LOG.md, Engine 0.15, decision 8, item 285). A path that
names a world entity by its place in a component list (`world.components.Health.7.1.hp`) moves
whenever an entity is added; inside a world snapshot (an object with `entities` and
`components`: a game's `world`, or a world run's whole snapshot) three segments name it instead:

- **`key.<key>`**: the entity a scenario key names, through the world's key table (a game's
  `HeadlessGame.worldKeys()`, which `MissionHost` and the RTS skirmish give; a world run's
  scenario keys): `world.key.ram.Health.hp`, `world.key.captain.fate`; on a world run
  `key.ram.alive`.
- **`id.<n>`**: the entity with that id, for one the scenario did not key (a trained unit, a
  building placed in play): `world.id.16.Producer.queue.length`.
- **`one.<Kind>`**: the world-level component, the lowest-id entity holding it:
  `world.one.Missions.committed.0.outcome`, `world.one.WorldTime.frozen.length`,
  `world.one.Opportunities.list.0.status`. Null when the kind is listed and no entity holds it.

An entity reads as `{ id, alive, fate, <Kind>... }`: `alive` (it exists and its `Fate` is not
`dead`), `fate` (`Fate.state`, `active` without one, null once it is gone), and every component
kind the snapshot lists, its data or **null when the entity lacks it** (a captive's
`world.key.captain.Position` is null; a destroyed ram's `Health` is null). A kind the snapshot
does not list has no value, so a typo still fails. **A key the table lacks** is refused before the
run plays: `no_key` at the check's `path` (`assertions.3.path`), exit 3, naming the keys there
are. `run`, `trace`, replay files and the debugger's checks all read them the same way;
nothing is added to the snapshot, so no hash moves. The samples' run files use only these (no
positional component path is left in `games/samples/**/runs`); `engine/sim`'s fixtures keep their
`components.<Kind>.<i>.1` paths. Tests: `check-values.test.ts`.

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
  game's refusal) and the run goes on. A refusal that comes after its step (Engine 0.15 T8, gap
  M5: a hosted round's end the world would not take, such as a report over a declared limit,
  `report_over_limit`) is read from the game's optional `lateRefusals(sinceTick)` after each step
  and listed at the tick it came with `late: true` (text: `tick 126: refused late: play ...`).
  `experience` is the game's `missionExperience()` (the rounds' ticks per mission), never written
  to the world.
- `dump` and replay files keep the steps as for a world run. `game-missions-run.test.ts` covers
  steps, refusals, experience, hashes, dump, replay and the usage error with a plain-JS game;
  `missions-run.test.ts` the field errors of each kind of run.

## Recording a round

Engine 0.14 T9 (gap M19; docs/BUILD-LOG.md, Engine 0.14, decision 10, item 256): a game run
file's `play` step carries its round's input (`input`, `ScriptedInput` steps from the round's
frame 0). `record` writes one there with tools, from the page or from a kit's bot:

```text
# from the page: play the round with ?record, then in the console
#   copy(JSON.stringify(window.__ww.recordings()))   -> recording.json
pnpm -s cli record games/samples/mini-siege/runs/played.run.json --mission sabotage --input recording.json --json
# headless, the kit's bot plays the round
pnpm -s cli record games/samples/mini-siege/runs/played.run.json --mission sabotage --bot '{"engine-camp": [{"do": "fight"}]}' --json
```

- **Which step**: the run file's first `missions` entry with that `mission` and `action: "play"`
  (`--play N` for the N-th, 0-based); none is a usage error naming the play steps there are.
- **`--input <file>`**: `window.__ww.recordings()`'s list (`engine/core/shell/CLAUDE.md`), one
  entry of it, or a bare `{ steps }`. From a list, the entry of that mission at the step's tick
  (else its only one); a recording made at another tick (the round would start from another
  world) or of a round that had not ended is a usage error.
- **`--bot <plan>`** (JSON, or `@file`): the run is played (no checks) with that step's `input`
  left out; while the round it starts is hosted, each tick's frame is what the bot of the kit
  owning the round's mini game (`missions.round.game` in the snapshot) holds (only that step's
  round: the bot starts on the first hosted tick after the step is handed over and stops when its
  round ends, so earlier and later rounds play as the file says, and the recording kept is that
  mission's at the step's tick), through
  `KitDef.roundBots` (`engine/core/kit.ts`): the topdown kit's `TopDownBot` for `mission-room`
  (plan: per room id, the plain-data steps `fight`, `goto`, `pickup`, `chest`, `leave`), the
  tower-defense kit's `TdBot` for `td-defence` (plan: its steps). The game records the round
  (`HeadlessGame.recordRounds`, which `MissionHost` has) and that recording is written. A plan
  that does not fit the bot's schema is a usage error naming the field.
- **Writing** goes through the editing verbs' path (`writeValue`): the whole run file checked
  against its schema (a hold that is not an action is exit 3, `errors` at
  `missions.<i>.input.steps.<j>.hold.<k>`, the file untouched), written with the repo's Prettier
  settings, read back and verified. Then the run is played with its checks and sync hashes:
  `passed`, `finalHash`, `hashMismatch`, `failure`. A recording the run fails with is not kept:
  the file is put back as it was (`restored: true`, exit 4). A round that changes on purpose
  moves the sync hashes: drop them from the run file, record, then copy the run's new hashes in
  and `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`.
- Keys only: pointer taps (the walls' round's tower taps) are not input frames and are not
  recorded (gap D1, Engine 0.15).
- The mini siege's `played` and `fortify-played` rounds were recorded this way (their
  `CLAUDE.md`): re-recording either with its kit's bot writes the committed input unchanged.
  Tests: `record.test.ts`, and `tests/browser/mini-siege-page.test.ts` (a round played on the
  page with `?record`, written with `record`, passing with the golden hashes).

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
  `code_typo`, `code_newer`, `code_layout`, `code_campaign`, `code_position`, `code_record`;
  version 1 codes are still read, Engine 0.15 T8);
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
  Codes are save code version 2 since Engine 0.15 T8 (gap M38: missions by stable id code), and a
  game's `campaignSave()` is null until the entry is over (`entryOver`, gap M35), so a code is
  pinned at an entry's end.
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
`games/samples/platformer/runs/level-3-start.run.json`, level 3 from its own tick 0:

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
- **A game on several kits** (Engine 0.14, gap G12, decision 8): `mutants` tries every rule of
  `kit` and of each `uses` kit, ids as run files write them (`topdown:walls-block-movement`), and
  each row carries its `kit` and that kit's `strict`; `kits` lists each kit with its strictness.
  **Each rule is judged by its own kit's strictness**: a weak rule of a strict kit fails, a weak
  rule of a lenient kit is reported. A run without `guards` is expected to guard every rule of the
  game's own kit; **a `uses` kit's rule is expected only where a run file lists it in `guards`**
  (settled in T5, item 257): its round may play in a few run files only, and their sync hashes
  usually change before a check could notice. So in a game folder a `uses` kit's rules no run file
  guards are listed (`unguarded`, `kits[].unguarded`; text: `not guarded: no run file guards
<id>`) but fail nothing, even for a strict kit (the mini siege's `towerdefense`); a qualified
  guard a run does not guard fails when its kit is strict. Record the unguarded ones in the game's
  gap report. A rule switched off changes the sync hashes too, and a hash mismatch stops the run
  without a failed check, so a guard needs an assertion or invariant that fails before the first
  hash that moves.
- **A whole game.** `pnpm -s cli mutants games/<game> --json` plays every run file of the game
  (`*.run.json` in a `runs/` folder under it) the same way. `rules[].guardedBy` lists the run
  files that guard each rule and `unguarded` the rules no run file guards (text:
  `weak: no run file guards <id>`). Here a run is held only to its own `guards`: `runs[].weak` is
  the rules in its `guards` it does not guard (empty for a run without `guards`), since the game
  as a whole must guard every rule, not each run. For a strict kit an unguarded rule or a run with
  a weak rule is exit 4; any run that fails as it is is exit 4 for every kit; a bad run file is
  exit 3 with every run file's errors.
- Tests: `mutants.test.ts` adds a test-only strict kit and a lenient one to the kit list
  (`vi.mock('./kit-list')`) and writes its game, a plain-JS headless module, to a temp folder;
  a game on both (`uses`) covers qualified ids, an unknown kit prefix and per-kit strictness.
  `two-kits.test.ts` and `tests/runs/per-kit-rules.test.ts` cover the platformer test and the
  mini siege.

## Replay files

When `run` fails a check it writes a replay file to
`.ww-out/replays/<run name>-t<tick>-<hash>.run.json` (the output folder; `io.outDir` in tests) and
puts its path, relative to the working folder, in `replayFile`. The name comes from a hash of the
content, so the same failure writes the same file. A replay is an ordinary run file: `run` and
`dump` take it.

```json
{
  "game": "../../games/samples/dungeon",
  "seed": 1,
  "ticks": 100,
  "input": { "steps": [{ "frame": 0, "hold": ["right"] }] },
  "assertions": [{ "tick": 100, "path": "hero.room", "op": "eq", "value": "nowhere" }],
  "invariants": [{ "path": "hero.hp", "op": "gte", "value": 0 }],
  "hashEvery": 40,
  "replay": {
    "source": "../../games/samples/dungeon/runs/walk-east.run.json",
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
- Debugging: open it in the debugger, `pnpm cli debug <replayFile>` (the line `run` prints, its
  `debug`; Engine 0.14 T11): the page opens at the failing tick with the failed check (path, op,
  expected against the actual value there), a button for the tick before, the first stored hash
  that differs marked (stepping stops there), and the timeline of a game with a world. Headless,
  `pnpm -s cli debug <replayFile> --check --json` reports `{ openTick, failure, reproduced,
hashMismatch }` (exit 4 when it does not reproduce or a hash differs). Or with the CLI alone:
  `run` the replay, `trace <replay> --paths ...` over the ticks before the failure to see when a
  value went wrong, then `dump <replay> --tick N` at the failing tick, or at the mismatch tick and
  the stored hash tick before it, to see what changed.

## World event log and timeline

Engine 0.14 T7 (docs/BUILD-LOG.md, Engine 0.14, decisions 2-4, items 248-250): the world's event
log and its timeline as data, for agents now and the in-browser debugger and timeline viewer later.

- **Where it comes from.** A world run is built with its event log on (`loadWorldRun(..., { log:
true })`) and read directly (`eventsSince`, `worldTimeline` from `engine/sim`). A game run asks
  its game through the optional read-only `HeadlessGame` hooks `worldEvents(sinceTick)` and
  `timeline()` (`engine/core/headless.ts`): a `MissionHost` has both when its port does
  (`missionPort` fills them), so the mini siege only forwards them; the RTS skirmish reads its own
  world. The log is never in a snapshot, so **no hash moves** (the run files' golden hashes are the
  same with or without it). A game with neither hook (the platformer and top-down games) is exit 3,
  **`no_world` at `headless`** in its `game.json`.
- **World ticks, not game ticks.** A change's `tick` is the world tick, and a played mission round
  holds the world still while the game ticks on. `events --from/--to` filter world ticks (both
  included; `--to` defaults to the world tick at the end); the timeline's `clock`, which the tools
  fill for a game run from the world tick at every game tick played (`compressClock`, run-length),
  maps them back: `entries[].game` is the game tick a world tick was first reached at.
- **`events`** plays the run to its last tick and lists every kept `Change` (`{ tick, cause, op,
entity, component?, before?, value? }`) that passes the filters: `--entity` (an id), `--cause`
  (exact, or a prefix before `:`: `--cause mission` keeps `mission:sabotage`), `--component`.
  `events` is a top-level array, so the output cap halves it (whole changes). Text: one line per
  change, `t40 mission:sabotage set #29 WorldTime`. `logFrom` is the oldest world tick the log
  keeps; older ticks give what is kept, never an error.
- **`timeline`** plays to `--tick` (default the last) and prints the record (`timelineSchema`,
  `engine/sim/timeline.ts`; in `docs/reference/schemas.md`) and `entries`
  (`timelineEntries`: `{ tick, game, kind, id, by, detail }`, kinds `opportunity`, `open`,
  `freeze`, `unfreeze`, `commit`), a top-level array. Text: one line per entry. On the mini
  siege's `played.run.json` it lists the fortify window offered at 5 and closed at 30 by `time`,
  the sabotage window taken at world tick 40, the sabotage opened and `siege` frozen there, and
  the unfreeze and commit (`both-burnt`) at world tick 160, game tick 566 (the round held the world
  still from game tick 40 to 446).
- **Dump files** (`dump --tick N --out <file>.json`, `dump-file.ts`): `{ format:
"worlds-within/dump", version: 1, run, game, world, seed, start, tick, hash, state, orders,
missions, events, timeline }`, `run`, `game` and `world` relative to the dump file, `events` the
  kept log up to tick N (`{ from, tick, changes }`) and `timeline` the record there, both null for
  a game with no world. Written as one line of JSON; `parseDumpFile(text)` / `dumpFileSchema`
  read it back (in `docs/reference/schemas.md`).
- Tests: `world-data.test.ts` (the mini siege's timeline and events, a world run's, the RTS
  skirmish's, the filters, the cap, `no_world`, usage errors, a dump file round trip and a dump
  without a world).

## Screenshots

`pnpm -s cli screenshot games/samples/dungeon/runs/walk-east.run.json --tick 60 --json` writes
`.ww-out/screenshots/walk-east-t60.png` (or `--out <file>.png`, relative to the working folder) and
prints its `path`, `width`, `height` (the game's picture size: `screen` in `game.json`, 256x240
by default), `bytes` and `sha256` (the whole PNG, hex).

- The game names a view module in `game.json` (`view`, optional), which exports
  `createView(content, seed, opts?)` returning a `ViewGame` (`engine/core/view.ts`): the headless
  game plus `screen` (the manifest's picture size) and `render(r)`. The demo's is `games/samples/dungeon/view.ts`, drawing what its scene draws. No
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
  errors; from T13b-5 PixiJS's too). The page decodes the skins' PNG sheets (`withContentImages`, Engine 0.16 T10) before it
  makes the view, so every frame has them (`screenshot.test.ts` checks the fx lab's PNG torch on
  two runs). With `--backend three` it also loads the skins' glTF models first
  (`ModelLibrary.preload`, Engine 0.16 T11), so no model shows its text mesh stand-in. Text drawn with `debugText` uses a system font, so a
  PNG's hash can differ between machines; compare hashes on one machine.
- `--backend three` (Engine 0.6): the 3D picture. The page needs the view's `frame()` (else exit 3,
  `no_frame_hook` at `view` in `game.json`) and the command a skin with `"backend": "three"` in the
  game's content (else exit 3, `no_three_skin` at `content.skin`, listing the skins it has; checked
  before Chromium starts). The skins are the core `skinSet(content, 'three')` (Engine 0.7 T8):
  `three.json` for the game and `three-<id>.json` for the frames of mini game `<id>` (a scene of
  their own on the same canvas, `withSkin`, picked by `status.miniGame`). The page makes a WebGL
  canvas of the `screen` size and a `ThreePresenter` with the main skin (clear colour: the view's
  `background` when it gives one, else the skin's `background`, else black; gap G36; and the
  game's sprite files as decoded pixels, `contentPixelSheets`, for every skin's HUD, gap G33), reads the
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
- `--backend pixi` (Engine 0.16 T13b-5): the same 2D picture through the PixiJS backend. The page
  imports `@engine/backends/pixi` and builds a `pixiDisplay` on a WebGL canvas of the `screen`
  size with the game's `canvas2d` skins (`skinSet(content, 'canvas2d')`: main and mini-game
  rounds), its sprite sheets (`contentSheets`, PNG sheets decoded), fonts and the view's
  `background`; each tick it presents the view's `frame()` once and calls `display.present()`, as
  the shell does. The view needs `frame()` (else exit 3, `no_frame_hook`) and the game a
  `canvas2d` skin (else exit 3, `no_canvas2d_skin`). The display keeps its drawing buffer
  (`PixiDisplayOptions.preserveDrawingBuffer`), so `toDataURL` reads the canvas back after any
  picture. Chromium always runs on SwiftShader for `pixi` (`--use-angle=swiftshader
--enable-unsafe-swiftshader`): software WebGL is not refused as for `three` (a 2D picture needs
  no GPU to be right) and the result's `renderer` names the WebGL renderer string. Two runs give
  the same bytes. Vite pre-bundles `pixi.js` for the page (`ServeOptions.prebundle`: its
  `eventemitter3` and `earcut` are CommonJS). `--allow-software-gl` stays `three` only. Example:
  `pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 154 --backend pixi --json`.
  A PixiJS tile's overlay (`--overlay`, `sheet`) is the display's own: the UI through its
  `PixiUiPainter` (painted onto the end of the stage and taken off after the picture, so the
  frame is presented once per tick), a transition through its transition pass (an iris closes on
  the presenter's focus, the camera, as in the shell).
- **`--scale N` and `--overlay <o>`** (Engine 0.16 part B): `--scale` (whole, 1-16, default 1)
  returns every picture N times as large with image smoothing off (`ShotJob.scale`, the page's
  `pngOf`): each pixel an exact N x N block, so a 320x180 game at 6 is exactly 1920x1080 and
  `width`/`height` are the scaled size. `--overlay` takes one overlay in `sheet`'s grammar
  (`parseOverlay`: `title`, `pause`, `settings`, `controls`, `levels`, `clear`, `end`,
  `ui=<file>[.<widget>]`, from Engine 0.16 part C `dialog:<id>` (a `menus.dialogs` box as the
  shell shows it, `dialogScreen`, stepped until its first page is typed out unless `*<n>`), a
  transition slot or kind, each with `*<n>`), checked with
  `checkOverlay` before Chromium starts (usage error, exit 2, when the game cannot show it) and
  drawn through the same job as `sheet` (`shotSetup` with a one-tile `ShotJob.tiles`); `overlay`
  in the result is its label (null without one). Under `title` and `levels` (Engine 0.16 part C
  T1) the picture is drawn without its HUD, as the shell draws it (2D: the view's
  `ViewGame.showHud(false)` and the tick drawn again for those tiles; 3D: `ThreePresenter.showHud`);
  `settings` and `controls` keep it (they also open from the pause menu). The `clear` and `end` screens show the status of
  the frame drawn at the tick (`ViewGame.status()`, which `frameView` keeps; in 3D the frame's);
  `end` takes the heading and credits of the first `menus.triggers.end` entry whose test holds on
  that status (Engine 0.16 part C), as the shell would.
  `pnpm -s cli screenshot games/fx-lab/runs/level-1.run.json --tick 360 --scale 6 --overlay clear
--out x.png --json` writes the level-clear banner at 1536x1440.
- Chromium: `pnpm exec playwright install --with-deps chromium` (CI does this). Without it the
  command crashes (exit 5) with that line, and the browser tests skip with a message locally; in
  CI (`CI` set) they are required.

## Sheets

Engine 0.16 T14: `pnpm -s cli sheet games/fx-lab/runs/level-1.run.json --ticks
"154,level-3/120,300+pause,345+level*22@3d" --allow-software-gl --json` writes
`.ww-out/sheets/level-1.png` (or `--out`): one picture per tile, `--columns` (4) to a row, each at
`--scale` (1, whole numbers, nearest neighbour) under its label (the `--labels` caption, then
`level-1 t300 + pause [2D]`), with `--title` over the sheet.

- **Tiles** (`--ticks`, comma-separated) are `[<run>/]<tick>[+<overlay>][@<backend>]`. `<run>/`
  is another run file in the positional run file's folder (`level-3` or `level-3.run.json`), or
  (from Engine 0.16 T13b-9) a path relative to that folder, so one sheet can tile several games
  (`../../rts-classic/runs/battle/141` from `games/fx-lab/runs/level-1.run.json`).
  `@2d` / `@3d` (or `@canvas2d` / `@three`) or, from Engine 0.16 T13b-5, `@pixi` overrides
  `--backend` (`2d`, `3d`, `canvas2d`, `three`, `pixi`; default 2D). Labels end `[2D]`, `[3D]` or
  `[PixiJS]`. `--ticks "154@canvas2d,154@pixi,100+wipe*12@2d,100+wipe*12@pixi" --columns 2` puts
  the two 2D backends side by side, a row per tick.
- **Overlays** (`sheet-overlay.ts`) are drawn over the tick's picture by the engine's own code,
  never the game's: `title`, `pause`, `settings`, `controls` (the shell's menu screens from
  `game.json`'s `menus`, built as `GameMenus` builds them, with player 1's default keys and the
  default volumes and settings), and from Engine 0.16 part B `levels` (the level select over the
  game's levels, `sheetLevels`: its campaign's level entries, else its `level` files, named by
  their headers' `name`; nothing cleared yet), `clear` and `end` (the level-clear banner and the
  end screen, `menus.clear` / `menus.end`, with the tick's frame status as their stats), `dialog:<id>`
  (Engine 0.16 part C: a `menus.dialogs` box, its first page typed out unless `*<frames>`; an id
  the game lacks is a usage error naming the ids it has), `ui=<file>` (a `ui` content file's screen as it opens) or
  `ui=<file>.<widget>` (every widget closed, that one opened), each stepped `*<frames>` display
  frames with no input first (30 for menus, 120 for ui: focus tweens settle, a dialog types), or a
  transition: a slot of `game.json`'s `transitions` (`level`, `scene`, `mission`, `respawn`, `default`) or a
  kind (`fade`, `wipe`, `iris`, 20-frame halves), `*<age>` frames after it started (default its
  first fully covered frame). 2D paints them on a copy of the picture (`CanvasUiPainter`,
  `drawTransition`; an iris closes on the picture's centre, since the view's camera is inside the
  game's picture); 3D draws the frame again with the presenter's transition pass and its UI
  overlay (`ThreePresenter.transition`, `.ui`; an iris closes on the camera's focus). A tile's
  overlay the game cannot show (no `menus`, no such ui file or widget, no transition for a slot,
  an age past its end) is a usage error before Chromium starts.
- **How:** tiles are grouped into one play per run file and backend (in the order the tiles first
  name them); each is `screenshot`'s job (`shot-job.ts`) played to its highest tile tick with
  `ShotJob.tiles`, and the screenshot page returns one PNG per tile on the way
  (`ShotResult.tiles`). Each backend's plays share one Chromium (`takeScreenshots`), started with
  that backend's flags; the sheet is composed in a 2D Chromium page (`composeSheet`): a dark grey
  background, labels in monospace (white caption, grey details), larger from scale 2. The state
  hashes each page saw are compared with the headless run's (`plays[].matchesHeadless`).
- Same tiles and flags, same machine: byte-identical PNG (`sheet.test.ts`). Label text uses a
  system font, so a sheet's hash can differ between machines.
- The owner's effects sheet, `docs/reports/0.16a-effects-sheet.png`, is made by the command in
  `docs/BUILD-LOG.md` (Engine 0.16 part A). Review sheets are the one other place binary files may
  live (`docs/reports/*-sheet.png`, `tests/architecture/no-content.test.ts`).

## Visual parity (PixiJS and Canvas2D)

Engine 0.16 T13b-5: `tests/browser/pixi-parity.test.ts` plays the fx lab's `level-1`, the RTS
skirmish's `battle` and the tower defense's `won` run once per 2D backend through the screenshot
page (`shotSetup` and `takeScreenshots` with `ShotJob.tiles`, as `sheet` does), at ticks where
effects show (particles, flashes, tints, shake; parallax and the HUD are always on) and with a
fade, a wipe and (the fx lab) the pause menu over some, and compares each Canvas2D picture with
the PixiJS one (`png-diff.ts`). Both plays must give the headless run's state hashes. The
tolerance (a pixel differs when one of R, G, B differs by more than the threshold):

- RTS and tower defense (no glow, no additive blending): threshold 8, at most 0.1% of the pixels
  (they are equal to the bit on SwiftShader; the margin is for other GPUs).
- The fx lab (additive glowing particles, a glowing door): threshold 32, at most 1% of the pixels,
  because PixiJS's glow is a stretched soft halo sprite and Canvas2D's is `shadowBlur` (measured
  up to about 0.6%, all around the glowing things); its top half (sky, parallax, HUD, title, the
  pause menu) must also hold the strict bound.
- Not compared: the iris (PixiJS closes it on the camera's focus, the page's Canvas2D tile on the
  picture's centre).

It skips with a reason where Chromium is not installed (required in CI). To look at a difference,
make a side-by-side sheet: `pnpm -s cli sheet games/fx-lab/runs/level-1.run.json --ticks
"100@2d,100@pixi" --columns 2 --scale 2 --json`.

## The debugger

Engine 0.14 T10 (docs/BUILD-LOG.md, Engine 0.14, decisions 1 and 2): `pnpm cli debug <file>`
opens the in-browser simulation debugger, `debugger/` (its own `CLAUDE.md` has the details).

- **What it opens**: a run file, a replay file (a run file with a `replay` block) or a dump file
  (`dump --out`, `format: "worlds-within/dump"`), told apart by their shape. A run opens at
  `--tick` (default 0), a replay at its failing tick (`replay.failure.tick`), a dump at its own
  tick, read-only (its run plays there with Play from here, when it is a game run file that is
  there). A world run is a usage error (the page steps games; open a world run's dump file).
- **How**: the command plays the run headless to the open tick (for `headlessHash`), builds the
  page's job (the game's file texts, seed, input, orders, missions, rules, `from` save, `start`,
  checks, expected hashes: the golden file, the run's sync `hashes`, a replay's; the headless and
  view modules' URLs), serves the repo with `serveRepo` and the job on a GET-only route
  (`/__ww-debugger/job.json`, from memory, never a file read), prints the URL
  (`.../engine/tools/debugger/index.html?tick=N`) and **stays up until stopped** (Ctrl-C; the
  process keeps running for the server).
- **The page** checks the content, imports the headless module (and the view, for the picture),
  and steps the run as `run` does (orders, then mission steps, then the step); back is a rebuild
  from tick 0 and a replay forward, with every tick's snapshot and hash cached. Panels: picture,
  checks at the tick (and each assertion's result), hashes against the expected ones, a state
  tree with search and the changes since the previous tick, the event log (this step's world
  ticks, everything kept, or a world-tick span; filters for entity, cause and component, as
  `events` takes them). The first stored-hash, rewind or view mismatch stops stepping there.
- **The timeline viewer** (Engine 0.14 T11, decisions 2 and 4): a Timeline panel draws the
  timeline record at the tick shown (the game's `timeline()` with its clock filled as the CLI
  fills it) on one axis of game ticks: the world clock (moving or standing still), frozen spans,
  experience time, opportunity windows with each status change and its cause, and missions open
  to commit with the outcome; clicking a marker goes to its tick. Its model is pure
  (`debugger/timeline.ts`, tested in Node); `window.__wwDebugger.timeline()` prints it as text.
- **A failing replay** opens at `replay.failure.tick` with the failed check (path, op, expected
  against the actual value there), buttons for that tick and the tick before, and the first
  stored hash that differs (`replay.hashes`) marked in the banner and on the timeline.
- **`--check`**: opens the page in headless Chromium, goes to the open tick and returns the page's
  `tick`, `hash` and `mismatch` and the world's `eventCount` (null for a game with no world) beside
  `headlessHash` (a dump: the run's at the dump's tick, or null when it cannot be played) and
  `matchesHeadless`, and (T11) `failure` (a replay's check as the page found it: `actual`,
  `reached`, `reproduced`, `tickBefore`), `reproduced` and `hashMismatch` (the first stored hash
  that differs, `{ tick, expected, actual, source }`); exit 4 when they differ, the page found a
  mismatch or a replay did not reproduce.
  `pnpm -s cli debug games/samples/dungeon/runs/walk-east.run.json --tick 60 --check --json` exits 0.
- Tests: `debugger/model.test.ts`, `debugger/timeline.test.ts`, `debug.test.ts`, `run.test.ts`
  (`debug`), `tests/browser/debugger.test.ts`,
  `tests/build/pages.test.ts` (the page is not in the Pages build).

## Generated docs

`pnpm docs:gen` writes the kit list (`kit-list.ts`) and the pages from the code's own schemas; `pnpm docs:check` regenerates them
in memory and exits 4 with `<file>: <n> lines differ; first at line N: ...` for each stale one.
`docs.test.ts` makes the same check, so `pnpm test` fails on stale docs (CI also runs
`pnpm docs:check`).

- `docs/reference/cli.md`: `help` and `help <command>` for every command, the text `helpText`
  (`commands/help.ts`) prints, so the page and `pnpm cli help` are the same text.
- `docs/reference/schemas.md`: one section per format, from `defaultDocSources().subjects`: the
  manifest, run files, the engine's content kinds and each kit's (`allKits()`, from each kit's hook),
  and (Engine 0.11) "Mini game params", each kit's `paramsDocs()` (the topdown kit's
  `mission-room`, example `mission-room-params.json`), with links to the pages below, and (Engine
  0.15 T11, gap G17) "Kit options", each kit's `options` schema (example `<kit>-options.json`). Each has a field
  table (`fieldRows`) and an example from `docs/reference/examples/<name>.json|.txt` (plus a
  kind's part files, `room.map.txt`), which must pass the schema or generation fails.
- `docs/reference/mini-games/<game>-<id>.md` (Engine 0.15 T11, gap M11; docs/BUILD-LOG.md,
  Engine 0.15, decision 12): one page per mini game a game defines (`mini-game-docs.ts`: the
  platformer sample's `vault` and `cellar` room challenges, the lab's `stop-bar`), its params
  table from the def's `paramsSchema` and where the game's content names it. The games are
  always the repo's (`REPO_ROOT`), whatever root the pages are written under.
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
