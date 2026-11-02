# engine/tools

Folder: `engine/tools`. Detailed rules: [`engine/tools/CLAUDE.md`](../../engine/tools/CLAUDE.md).

## Purpose

The command-line tools for agents and people: validate content, run a game headless from a run file,
dump state, take screenshots and edit content. **Placeholder:** the CLI lands during Engine 0.3.

## Public API entry points

<!-- Engine 0.3: list the CLI commands (`pnpm cli <command>`) and their `--json` results here. -->

None yet. The CLI commands are listed here as they land.

## Imports allowed

- Anything in `engine/` and `kits/`.
- Games are loaded by folder path at run time, never by a static import: nothing in `engine/`
  imports from `games/`.

## How to test

Tests will run in Node with `pnpm test`. Every run is repeatable from a seed.
