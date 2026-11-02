import { parseCommandLine, wantsJson } from './args';
import { dumpCommand } from './commands/dump';
import { addCommand, getCommand, removeCommand, setCommand } from './commands/edit';
import { helpCommand } from './commands/help';
import { mutantsCommand } from './commands/mutants';
import { runCommand } from './commands/run';
import { validateCommand } from './commands/validate';
import { EXIT, exitName, UsageError, type ExitCode } from './exit-codes';
import { capJson, capText, DEFAULT_MAX_OUTPUT, OUTPUT_DIR, writeFullOutput } from './output';
import { Registry, type Command } from './registry';

/**
 * The CLI's main: `pnpm cli <command> [arguments] [flags]`. It takes its IO as arguments, so tests
 * call it with captured output and the entry point (`cli.ts`) passes the real streams.
 *
 * The `--json` contract: stdout gets exactly one line, one JSON object
 * `{ ok, command, exitCode, ... }`, whatever happens (usage errors and crashes included), and
 * nothing else. Anything a command logs with `console` goes to stderr while it runs. Without
 * `--json` the result is printed for people: on stdout, or on stderr for usage errors and crashes.
 */

export interface CliIO {
  stdout(text: string): void;
  stderr(text: string): void;
  /** The working folder: paths on the command line, and the output folder, are relative to it. */
  cwd: string;
  /** Where capped output and replay files go, relative to `cwd`. Defaults to {@link OUTPUT_DIR}. */
  outDir?: string;
}

/** Every command, in help order. */
export function defaultRegistry(): Registry {
  const registry = new Registry();
  registry.add(helpCommand(registry));
  registry.add(validateCommand);
  registry.add(runCommand);
  registry.add(dumpCommand);
  registry.add(mutantsCommand);
  registry.add(getCommand);
  registry.add(setCommand);
  registry.add(addCommand);
  registry.add(removeCommand);
  return registry;
}

interface Report {
  exit: ExitCode;
  command: string | null;
  result: Record<string, unknown>;
  /** The command, for its text form; none for usage errors and crashes. */
  from?: Command;
}

function failure(exit: ExitCode, command: string | null, error: unknown): Report {
  const message = error instanceof Error ? error.message : String(error);
  const detail: Record<string, unknown> = { kind: exitName(exit), message };
  if (exit === EXIT.crash && error instanceof Error && error.stack) detail.stack = error.stack;
  return { exit, command, result: { error: detail } };
}

/** Sends `console.log` and friends to stderr while `fn` runs, so `--json` stdout stays one object. */
async function quietly<T>(io: CliIO, fn: () => Promise<T>): Promise<T> {
  const saved = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
  const toErr = (...parts: unknown[]) => io.stderr(`${parts.map(String).join(' ')}\n`);
  Object.assign(console, { log: toErr, info: toErr, debug: toErr, warn: toErr });
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}

async function execute(
  argv: readonly string[],
  registry: Registry,
  io: CliIO,
): Promise<Report & { max: number }> {
  let max = DEFAULT_MAX_OUTPUT;
  let name: string | null = null;
  try {
    const line = parseCommandLine(argv, registry);
    max = line.global.maxOutput ?? DEFAULT_MAX_OUTPUT;
    name = line.command.name;
    let command = line.command;
    let input = { args: line.args, flags: line.flags };
    if (line.global.help) {
      command = registry.get('help')!;
      const target = name === 'help' ? (line.args.command as string | undefined) : name;
      input = { args: target === undefined ? {} : { command: target }, flags: {} };
    }
    const outcome = await command.run(input, { cwd: io.cwd, outDir: io.outDir ?? OUTPUT_DIR });
    return { ...outcome, command: name, from: command, max };
  } catch (error) {
    const exit = error instanceof UsageError ? EXIT.usage : EXIT.crash;
    return { ...failure(exit, name, error), max };
  }
}

/** Runs one command line and returns the exit code. Never throws. Tests may pass their own registry. */
export async function main(
  argv: readonly string[],
  io: CliIO,
  registry: Registry = defaultRegistry(),
): Promise<ExitCode> {
  const json = wantsJson(argv);
  const report = json
    ? await quietly(io, () => execute(argv, registry, io))
    : await execute(argv, registry, io);
  const result = {
    ok: report.exit === EXIT.ok,
    command: report.command,
    exitCode: report.exit,
    ...report.result,
  };
  const outDir = io.outDir ?? OUTPUT_DIR;
  const save = (ext: 'json' | 'txt') => (text: string) =>
    writeFullOutput(io.cwd, outDir, report.command ?? 'cli', text, ext);
  try {
    if (json) {
      io.stdout(`${capJson(result, report.max, save('json'))}\n`);
    } else {
      const text = report.from?.text ? report.from.text(result) : textOf(result);
      const out = capText(text, report.max, save('txt'));
      if (report.from) io.stdout(`${out}\n`);
      else io.stderr(`${out}\n`);
    }
  } catch (error) {
    // Writing the output itself failed (the output folder cannot be made): still one object.
    const crash = failure(EXIT.crash, report.command, error);
    const line = { ok: false, command: report.command, exitCode: EXIT.crash, ...crash.result };
    if (json) io.stdout(`${JSON.stringify(line)}\n`);
    else io.stderr(`${String((crash.result.error as { message: string }).message)}\n`);
    return EXIT.crash;
  }
  return report.exit;
}

/** The default text form: an error's message, or the result's fields as JSON. */
function textOf(result: Record<string, unknown>): string {
  const error = result.error as { kind?: string; message?: string; stack?: string } | undefined;
  if (error?.message !== undefined) {
    const head = `${error.kind === 'usage' ? 'usage error' : 'crash'}: ${error.message}`;
    return error.kind === 'usage'
      ? `${head}\nRun "pnpm cli help" for the commands.`
      : `${head}\n${error.stack ?? ''}`;
  }
  return JSON.stringify(result, null, 2);
}
