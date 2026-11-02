import { z } from 'zod';
import { EXIT, EXIT_MEANINGS, UsageError, type ExitName } from '../exit-codes';
import { fieldDocs, globalFlags, type Command, type FieldDoc, type Registry } from '../registry';

/**
 * `help [command]`: generated from the registry's schemas, so it always matches what the parser
 * accepts. Without a command it lists them all, the global flags and the exit codes.
 */

export interface CommandDoc {
  name: string;
  summary: string;
  usage: string;
  args: FieldDoc[];
  flags: FieldDoc[];
}

/** One command as help and the docs see it. */
export function commandDoc(command: Command): CommandDoc {
  const args = fieldDocs(command.args, 'arg');
  const flags = fieldDocs(command.flags, 'flag');
  const usage = ['pnpm cli', command.name, ...args.map((a) => a.usage), ...(flags.length ? ['[flags]'] : [])];
  return { name: command.name, summary: command.summary, usage: usage.join(' '), args, flags };
}

function fieldLines(docs: readonly FieldDoc[]): string[] {
  const width = Math.max(0, ...docs.map((d) => d.usage.length));
  return docs.map((d) => `  ${d.usage.padEnd(width)}  ${d.description}`);
}

function commandText(doc: CommandDoc): string[] {
  const lines = [`${doc.usage}`, '', `  ${doc.summary}`];
  if (doc.args.length) lines.push('', 'Arguments:', ...fieldLines(doc.args));
  if (doc.flags.length) lines.push('', 'Flags:', ...fieldLines(doc.flags));
  return lines;
}

const exitCodes = () =>
  (Object.keys(EXIT) as ExitName[]).map((name) => ({ code: EXIT[name], name, meaning: EXIT_MEANINGS[name] }));

/** Where the generated reference pages are (`docs-gen.ts` writes them from the same schemas). */
export const REFERENCE_PAGES =
  'docs/reference/cli.md (commands) and docs/reference/schemas.md (file formats)';

/** What `help` returns: every command (or just `name`), the global flags and, for all, the exit codes. */
export function helpResult(registry: Registry, name?: string): Record<string, unknown> {
  const globals = fieldDocs(globalFlags, 'flag');
  if (name !== undefined) {
    const command = registry.get(name);
    if (!command) throw new UsageError(`unknown command "${name}"`);
    return { commands: [commandDoc(command)], globalFlags: globals };
  }
  return { commands: registry.list().map(commandDoc), globalFlags: globals, exitCodes: exitCodes() };
}

/**
 * `help`'s text, from {@link helpResult}. The generated CLI reference (`docs/reference/cli.md`)
 * is made of this same text, so the two cannot differ.
 */
export function helpText(result: Record<string, unknown>): string {
  const commands = result.commands as CommandDoc[];
  const globals = result.globalFlags as FieldDoc[];
  if (commands.length === 1 && !result.exitCodes) {
    return [...commandText(commands[0]!), '', 'Global flags:', ...fieldLines(globals)].join('\n');
  }
  const width = Math.max(...commands.map((c) => c.name.length));
  const codes = result.exitCodes as ReturnType<typeof exitCodes>;
  return [
    'Usage: pnpm cli <command> [arguments] [flags]',
    '',
    'Commands:',
    ...commands.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
    '',
    'Global flags:',
    ...fieldLines(globals),
    '',
    'Exit codes:',
    ...codes.map((c) => `  ${c.code}  ${c.name.padEnd(14)}  ${c.meaning}`),
    '',
    'Run "pnpm cli help <command>" for one command.',
    `Reference pages: ${REFERENCE_PAGES}.`,
  ].join('\n');
}

/** Builds `help` for a registry (it lists the registry it is in). */
export function helpCommand(registry: Registry): Command {
  return {
    name: 'help',
    summary: 'list the commands, or show one command with its arguments and flags',
    args: z.strictObject({
      command: z.string().optional().describe('the command to show; all of them when left out'),
    }),
    flags: z.strictObject({}),
    run({ args }) {
      return { exit: EXIT.ok, result: helpResult(registry, args.command as string | undefined) };
    },
    text: helpText,
  };
}
