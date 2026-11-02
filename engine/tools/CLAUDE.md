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
  `--max-output`) and `fieldDocs` (a schema as help lines; T10 builds the generated docs on it).
- `args.ts`: `parseCommandLine(argv, registry)`. Positional arguments are taken in the order of the
  `args` object's keys; flag keys are camelCase and typed kebab-case (`maxOutput` ->
  `--max-output`); a boolean flag takes no value, others take `--flag value` or `--flag=value`;
  number flags are converted before the schema runs; `--` ends the flags. Every problem is a
  `UsageError`.
- `exit-codes.ts`: `EXIT`, the one place the exit codes are defined (see below), and `UsageError`.
- `output.ts`: the output cap (`DEFAULT_MAX_OUTPUT`, 32 KiB) and the output folder (`OUTPUT_DIR`,
  `.ww-out/`, git-ignored). Replay files go to `.ww-out/replays/`.
- `game-loader.ts`: `loadGame(cwd, dir)` reads `<dir>/game.json` and its content files with the
  file system (`readGameFiles`) and checks them with the engine's kinds plus the kit's. It never
  imports a game's code.
- `kits.ts`: `KIT_KINDS`, the content kinds each kit adds, and `KIT_RULES` / `kitRules(kit)`, the
  named rules each kit lets a run switch off (`engine/core/rules.ts`), by the `kit` name in
  `game.json`. Add a line when a kit gets content kinds or names rules.
- `run-file.ts`: the run-file schema (`runFileSchema`), `readRunFile(cwd, path)`, the check ops
  (`CHECK_OPS`, `CHECK_OP_MEANINGS`), `valueAt(state, path)` and `failsCheck(state, check)`.
- `headless-run.ts`: `playRun(cwd, runFile, { untilTick?, disableRules? })` loads the game, imports its headless
  module by the path in `game.json` (dynamic `import()` of a file URL, never a static import),
  plays the ticks and makes the checks; `stateHash(snapshot)`.
- `replay.ts`: replay files. `writeReplay(played, cwd, outDir)` writes one for a failed run,
  `replayOf` builds its JSON, `checkReplay` compares a replay's run with its stored failure and
  hashes.
- `content-path.ts`: paths for the editing verbs (`parsePath`, dotted or JSON pointer) and the
  edits on a parsed file (`getAt`, `setAt`, `addAt`, `removeAt`), plus `parseValue` (JSON, else a
  string).
- `content-file.ts`: `openContentFile(cwd, path)`: what an editable file is (its kind and form),
  how its text becomes a tree and back, and the check a new text must pass before it is written.
- `json-format.ts`: reads JSON remembering which objects are spread over lines, and writes it back
  through Prettier with the repo's settings, so edits are lint-clean and change little.
- `commands/`: one file per command (`help.ts`, `validate.ts`, `run.ts`, `dump.ts`, `mutants.ts`, and `edit.ts`
  for `get`, `set`, `add` and `remove`).

## The contract

- `--json`: stdout gets exactly one line holding one JSON object, `{ ok, command, exitCode, ... }`,
  whatever happens: usage errors and crashes included (`error: { kind, message, stack? }`).
  Nothing else goes to stdout; `console.log` and friends are sent to stderr while a command runs.
- Exit codes (`exit-codes.ts`): `0` ok, `2` usage (unknown command or flag, missing or extra
  argument, a folder that is not there), `3` invalid content (the result names file and field),
  `4` failed check (valid content, a check failed: a `run` assertion or invariant), `5` crash (an
  exception). `1` is never used by the CLI, so a `1` means Node died before it could report.
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
- `validate <game>`: checks `game.json` and every content file. Cheap: starts nothing. Result:
  `{ game, fileCount, errorCount, files: [{ file, errors }], errors: ContentError[] }` (errors as
  in `engine/core/content/validate.ts`, with repo paths). Exit 0 or 3. A folder that is not there
  is a usage error. Its own content code: `unknown_kit` (at `kit` in `game.json`).
- `run <runFile> [--disable-rule <ids>]`: plays a run file headless and checks it (below).
  `--disable-rule` switches kit rules off (comma-separated ids, on top of the run file's
  `disableRules`; an id the kit does not name is a usage error). Result: `{ run, game, seed,
disabledRules, ticks, lastTick, passed, checks: { assertions, invariants }, failure, failures, hashes: [{ tick,
hash }], finalHash, replayFile, replay }`. `failure` is the first failed check, `{ tick, kind: 'assertion' |
'invariant', index, path, op, expected, actual, message }`, or null; `failures` is every check
  that failed at that tick. The run stops at the first failing tick and then writes a replay file
  (below) whose path is `replayFile` (null when the run passed, and for replays). `replay` is the
  replay check on a replay file (null otherwise). Exit 0 passed, 4 a failed
  check, 3 (with `errors`) when the run file or the game's content breaks its schema (or the
  headless module is missing: `missing_file` / `no_headless_entry` at `headless` in `game.json`),
  2 when the run file is not there.
- `dump <runFile> --tick N`: plays to tick N (no checks) and prints `{ run, game, seed, tick,
hash, state }`, the whole snapshot. N from 0 to the run's `ticks`, else a usage error. Capped like
  everything else: a big state gives the envelope plus `fullOutput`.
- `mutants <runFile>`: mutant checks (below). Result: `{ run, game, kit, baseline: { passed,
failure }, rules: [{ id, description, skipped, passed, guarded, failure }], guarded, weak }`.
  Exit 0 when the run passes as it is (weak rules are reported, not failed), 4 when it fails as it
  is (no rule is tried then), 3 for a bad run file or content.
- `get <file> <path>`: `{ file, kind, path, pointer, value }`. `set <file> <path> <value>`,
  `add <file> <path> <value>`, `remove <file> <path>`: the editing verbs (below). Result
  `{ file, kind, path, pointer, written, verified, changed, before, after }`; exit 0 written and
  verified, 3 refused (with `errors`, file untouched), 4 written but the read-back differs, 2 a
  bad path or a file that cannot be edited.

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
  pattern in `game.json` that now matches nothing). Any error refuses the write: exit 3 with
  `errors`, and the file is not touched. Its own content code: `not_writable` (a sprite `.txt` with
  comments below its header, which would be lost, or a name with a space).
- JSON is written with the repo's Prettier settings (2 spaces, final newline), keeping each
  object's one-line or spread-out look; a grid one row per line with a final newline; a sprite
  `.txt` with its header comments kept. Writing a file back unchanged gives the same text.
- After writing, the file is read back from disk and parsed; `verified: true` says the text and
  the parsed content are exactly what was meant. `before` and `after` are the value at the edited
  place (`path`; for an `add` to an array, the new item), null when absent.

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
  "disableRules": []
}
```

- `game`: the game folder, relative to the run file's folder (`..` from `games/<game>/runs/`).
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
- Run every game's run files: `pnpm test tests/runs`, or one by one with
  `pnpm -s cli run <file> --json`.
- A game's headless module (`headless` in `game.json`) exports `createGame(content, seed, opts?)`
  returning a `HeadlessGame` (`engine/core/headless.ts`); it passes `opts.disabledRules` to its
  kit.

## Mutant checks

A kit names its rules (`engine/core/rules.ts`: `defineRules`, `RuleSwitch`; the top-down kit's
are `TOPDOWN_RULES` in `kits/topdown/rules.ts`) and guards the code of each with
`rules.isOn(id)`. `kits.ts` maps each kit to its list. `pnpm -s cli mutants <run-file> --json`
plays the run as it is, then once per rule with that rule off. A rule the run fails without is
`guarded`; one it still passes without is `weak` (text: `weak: does not guard <id>`): the run's
checks would not notice that rule breaking. Strengthen a weak run with an assertion or invariant
that the rule decides (walk-east guards `doors-change-room` because it asserts the room it ends
in). Rules the run file switches off itself are `skipped`. Only a few top-down rules are named in
Engine 0.3; kits adopt this fully from Engine 0.5. To see one mutant fail:
`pnpm -s cli run <run-file> --disable-rule <id>`.

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
  `assertions` those at or before it, `invariants` and `hashEvery` all as they were.
- `replay.failure` is the source run's first failed check (`index` is left out: the assertion list
  is shorter). `replay.hashes` are the hashes the source run printed, up to and including the
  failing tick (`hashes` in its result).
- Playing a replay, `run` gives `replay: { source, expectedTick, reproduced, hashesChecked,
hashMismatch }`: `reproduced` is true when the first failure is at the same tick with the same
  check (kind, path, op, expected); `hashMismatch` is the first stored hash that differs,
  `{ tick, expected, actual }`, or null. A mismatch means the game's state is different by that
  tick (the game or its content changed since the source run); it fails the run (exit 4) even
  if every check passes. A replay that fails writes no further replay.
- Debugging: `run` the replay, then `dump <replay> --tick N` at the failing tick, or at the
  mismatch tick and the stored hash tick before it, to see what changed.

## Adding a command

1. Add `commands/<name>.ts` with `defineCommand({ name, summary, args, flags, run, text? })`.
   Describe every field with `.describe(...)`: that is its help line.
2. Register it in `defaultRegistry()` (`main.ts`).
3. Return `{ exit: EXIT.<name>, result }`; throw `UsageError` for a bad command line. Any other
   exception is a crash.
4. Test it through `main` with captured IO (see `main.test.ts`), and list it here and in
   `docs/modules/engine-tools.md`.

## Rules

- May import anything in `engine/` and `kits/`.
- Loads a game by its folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/` (`tests/architecture/tools-no-game-import.test.ts` and `dependency-rule.test.ts`).
- Every run is repeatable from a seed, and nothing in a result depends on the clock: the capped
  output file is named by a hash of its content.
