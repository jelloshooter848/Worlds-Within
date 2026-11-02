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
  `.ww-out/`, git-ignored).
- `game-loader.ts`: `loadGame(cwd, dir)` reads `<dir>/game.json` and its content files with the
  file system (`readGameFiles`) and checks them with the engine's kinds plus the kit's. It never
  imports a game's code.
- `kits.ts`: `KIT_KINDS`, the content kinds each kit adds, by the `kit` name in `game.json`. Add a
  line when a kit gets content kinds.
- `commands/`: one file per command (`help.ts`, `validate.ts`).

## The contract

- `--json`: stdout gets exactly one line holding one JSON object, `{ ok, command, exitCode, ... }`,
  whatever happens: usage errors and crashes included (`error: { kind, message, stack? }`).
  Nothing else goes to stdout; `console.log` and friends are sent to stderr while a command runs.
- Exit codes (`exit-codes.ts`): `0` ok, `2` usage (unknown command or flag, missing or extra
  argument, a folder that is not there), `3` invalid content (the result names file and field),
  `4` failed check (valid content, a check failed: `run` assertions from T5), `5` crash (an
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
