# engine/tools

Folder: `engine/tools`. Detailed rules: [`engine/tools/CLAUDE.md`](../../engine/tools/CLAUDE.md).

## Purpose

The command-line tools for agents and people: `pnpm cli <command> [arguments] [flags]`. Today it
validates a game's content; running a game headless from a run file, dumping state, screenshots
and content editing arrive during the rest of Engine 0.3.

## Public API entry points

- `pnpm cli help [command]`: the commands, global flags and exit codes, generated from the command
  schemas. `<command> --help` shows one command.
- `pnpm cli validate <game>`: checks `game.json` and every content file against its schema
  (starts nothing). `--json` result:
  `{ ok, command: 'validate', exitCode, game, fileCount, errorCount, files: [{ file, errors }], errors }`,
  each error `{ file, path, pointer, message, code, row?, col?, line? }`.
- Global flags: `--json` (exactly one JSON object on stdout), `--help`, `--max-output <bytes>`.
- Exit codes (`engine/tools/exit-codes.ts`): `0` ok, `2` usage, `3` invalid content, `4` failed
  check, `5` crash. Every `--json` result, failures included, is `{ ok, command, exitCode, ... }`.
- Output over the cap (32 KiB by default) is cut; the whole result is written under `.ww-out/` and
  the printed one has `truncated: true` and `fullOutput: <path>`.
- In code: `main(argv, io)` (`engine/tools/main.ts`), `defineCommand` and `Registry`
  (`registry.ts`), `loadGame(cwd, dir)` (`game-loader.ts`).

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
test spawns `pnpm -s cli` for real.
