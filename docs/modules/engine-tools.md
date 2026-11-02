# engine/tools

Folder: `engine/tools`. Detailed rules: [`engine/tools/CLAUDE.md`](../../engine/tools/CLAUDE.md).

## Purpose

The command-line tools for agents and people: `pnpm cli <command> [arguments] [flags]`. Today it
validates a game's content, plays run files headless (seeded scripted input, tick assertions,
invariants, state hashes), writes replay files for failing runs and dumps the state at a tick;
screenshots and content editing arrive during the rest of Engine 0.3.

## Public API entry points

- `pnpm cli help [command]`: the commands, global flags and exit codes, generated from the command
  schemas. `<command> --help` shows one command.
- `pnpm cli validate <game>`: checks `game.json` and every content file against its schema
  (starts nothing). `--json` result:
  `{ ok, command: 'validate', exitCode, game, fileCount, errorCount, files: [{ file, errors }], errors }`,
  each error `{ file, path, pointer, message, code, row?, col?, line? }`.
- `pnpm cli run <run-file>`: plays a run file (`games/<game>/runs/<name>.run.json`; schema and
  format in `engine/tools/run-file.ts` and `engine/tools/CLAUDE.md`) headless from its seed with its
  scripted input, checking invariants every tick and assertions at their tick. `--json` result:
  `{ ok, command: 'run', exitCode, run, game, seed, ticks, lastTick, passed, checks, failure,
failures, hashes: [{ tick, hash }], finalHash, replayFile, replay }`; `failure` names the first
  failing tick, the check, `expected` and `actual`. Exit 0 passed, 4 failed check, 3 invalid run
  file or content.
- Replay files: a failing `run` writes `.ww-out/replays/<name>-t<tick>-<hash>.run.json` (path in
  `replayFile`), a run file with the seed, the input and checks up to the failing tick, and a
  `replay` block (`source`, `failure`, `hashes`). Running it fails at the same tick; `run` also
  compares the stored hashes and reports `replay.hashMismatch: { tick, expected, actual }` for the
  first one that differs. Format: `engine/tools/CLAUDE.md` (Replay files).
- `pnpm cli dump <run-file> --tick N`: `{ run, game, seed, tick, hash, state }`, the whole
  snapshot at tick N.
- Every game's run files are checked by `tests/runs/run-files.test.ts` against committed golden
  hashes (`<name>.hashes.json`; regenerate with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs`).
- Global flags: `--json` (exactly one JSON object on stdout), `--help`, `--max-output <bytes>`.
- Exit codes (`engine/tools/exit-codes.ts`): `0` ok, `2` usage, `3` invalid content, `4` failed
  check, `5` crash. Every `--json` result, failures included, is `{ ok, command, exitCode, ... }`.
- Output over the cap (32 KiB by default) is cut; the whole result is written under `.ww-out/` and
  the printed one has `truncated: true` and `fullOutput: <path>`.
- In code: `main(argv, io)` (`engine/tools/main.ts`), `defineCommand` and `Registry`
  (`registry.ts`), `loadGame(cwd, dir)` (`game-loader.ts`), `playRun` and `stateHash`
  (`headless-run.ts`), `runFileSchema`, `replaySchema` and `readRunFile` (`run-file.ts`),
  `writeReplay` and `checkReplay` (`replay.ts`).

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
invariants, broken run files, replay files and hash mismatches), and `tests/runs/run-files.test.ts` checks every game's run files
against their golden hashes.
