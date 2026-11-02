/**
 * The CLI's exit codes, grouped by kind of failure: the one place they are defined. Every command
 * exits with one of these, and its `--json` result carries the same number as `exitCode`.
 *
 * | code | name             | meaning                                                         |
 * | ---- | ---------------- | --------------------------------------------------------------- |
 * | 0    | `ok`             | the command did what it was asked and every check passed        |
 * | 2    | `usage`          | bad command line: unknown command or flag, missing argument     |
 * | 3    | `invalidContent` | a content file (or `game.json`) breaks its schema               |
 * | 4    | `failedCheck`    | the content is valid but a check failed (an assertion in a run) |
 * | 5    | `crash`          | an exception: a bug in the tools, the engine or the game        |
 *
 * 1 is left unused on purpose: Node exits with 1 on its own for an uncaught error, so a 1 always
 * means the CLI never got to report.
 */
export const EXIT = {
  ok: 0,
  usage: 2,
  invalidContent: 3,
  failedCheck: 4,
  crash: 5,
} as const;

export type ExitName = keyof typeof EXIT;
export type ExitCode = (typeof EXIT)[ExitName];

/** The name of an exit code (`3` -> `invalidContent`), for results and help. */
export function exitName(code: ExitCode): ExitName {
  return (Object.keys(EXIT) as ExitName[]).find((k) => EXIT[k] === code)!;
}

/** What each code means, one line each: printed by `help` and copied into the docs. */
export const EXIT_MEANINGS: Readonly<Record<ExitName, string>> = {
  ok: 'the command did what it was asked and every check passed',
  usage: 'bad command line: unknown command or flag, a missing or extra argument',
  invalidContent: 'a content file (or game.json) breaks its schema; the result names the file and field',
  failedCheck: 'the content is valid but a check failed',
  crash: 'an exception: a bug in the tools, the engine or the game',
};

/** A usage error: thrown by the parser or a command, reported with {@link EXIT.usage}. */
export class UsageError extends Error {
  override name = 'UsageError';
}
