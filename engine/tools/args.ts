import type { z } from 'zod';
import { UsageError } from './exit-codes';
import {
  baseType,
  globalFlags,
  kebab,
  type Command,
  type Fields,
  type GlobalFlags,
  type Registry,
} from './registry';

/**
 * The argument parser: `argv` (without `node` and the script) into a command and its checked
 * arguments and flags. Every problem is a {@link UsageError} with a message naming the argument
 * or flag. Flags may come before or after the command's arguments; `--` ends the flags.
 */

export interface ParsedLine {
  command: Command;
  args: Record<string, unknown>;
  flags: Record<string, unknown>;
  global: GlobalFlags;
}

/** True when `argv` asks for `--json` (before any `--`): known even if the rest fails to parse. */
export function wantsJson(argv: readonly string[]): boolean {
  for (const token of argv) {
    if (token === '--') return false;
    if (token === '--json' || token === '--json=true') return true;
  }
  return false;
}

/** `max-output` -> `maxOutput`. */
function camel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Checks `raw` against `schema`, turning the first issues into one usage message. */
function check(
  schema: Fields,
  raw: Record<string, unknown>,
  label: (key: string) => string,
): Record<string, unknown> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data as Record<string, unknown>;
  const lines = result.error.issues.map((issue: z.core.$ZodIssue) => {
    const key = String(issue.path[0] ?? '');
    if (issue.code === 'invalid_type' && raw[key] === undefined) return `missing ${label(key)}`;
    return `${label(key)}: ${issue.message}`;
  });
  throw new UsageError(lines.join('; '));
}

/** The command `name`, or a usage error listing the known ones. */
function commandNamed(registry: Registry, name: string): Command {
  const command = registry.get(name);
  if (command) return command;
  const known = registry
    .list()
    .map((c) => c.name)
    .join(', ');
  throw new UsageError(`unknown command "${name}" (known: ${known})`);
}

/**
 * Parses a command line. With no command at all it is `help`. Throws {@link UsageError} for an
 * unknown command or flag, a flag given twice or missing its value, a missing or extra argument,
 * or a value its schema rejects.
 */
export function parseCommandLine(argv: readonly string[], registry: Registry): ParsedLine {
  let command: Command | undefined;
  const positionals: string[] = [];
  const rawGlobal: Record<string, unknown> = {};
  const rawFlags: Record<string, unknown> = {};
  let flagsDone = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!flagsDone && token === '--') {
      flagsDone = true;
      continue;
    }
    if (flagsDone || !token.startsWith('--') || token === '--') {
      if (command === undefined) command = commandNamed(registry, token);
      else positionals.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const name = token.slice(2, eq < 0 ? undefined : eq);
    const key = camel(name);
    const isGlobal = key in globalFlags.shape;
    const shape = isGlobal ? globalFlags.shape : command?.flags.shape;
    const field = shape?.[key as keyof typeof shape] as z.ZodType | undefined;
    if (!field || name !== kebab(key)) {
      const where = command ? ` for "${command.name}"` : '';
      const known = [...Object.keys(globalFlags.shape), ...Object.keys(command?.flags.shape ?? {})]
        .map((k) => `--${kebab(k)}`)
        .join(', ');
      throw new UsageError(`unknown flag --${name}${where} (known: ${known})`);
    }
    const target = isGlobal ? rawGlobal : rawFlags;
    if (key in target) throw new UsageError(`--${name} is given twice`);
    const type = baseType(field);
    let value: string | boolean;
    if (eq >= 0) {
      value = token.slice(eq + 1);
      if (type === 'boolean') {
        if (value !== 'true' && value !== 'false')
          throw new UsageError(`--${name} is true or false, not "${value}"`);
        value = value === 'true';
      }
    } else if (type === 'boolean') {
      value = true;
    } else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      value = next;
      i++;
    }
    target[key] =
      type === 'number' && typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))
        ? Number(value)
        : value;
  }

  command ??= commandNamed(registry, 'help');
  const keys = Object.keys(command.args.shape);
  if (positionals.length > keys.length) {
    const extra = positionals.slice(keys.length).join(' ');
    throw new UsageError(`"${command.name}" takes ${keys.length} argument(s); extra: ${extra}`);
  }
  const rawArgs: Record<string, unknown> = {};
  positionals.forEach((p, i) => (rawArgs[keys[i]!] = p));

  const global = check(globalFlags, rawGlobal, (k) => `--${kebab(k)}`) as GlobalFlags;
  // `<command> --help` shows help even when the command's own arguments are missing.
  if (global.help) return { command, args: rawArgs, flags: rawFlags, global };
  const flags = check(command.flags, rawFlags, (k) => `--${kebab(k)}`);
  const args = check(command.args, rawArgs, (k) => `argument <${k}>`);
  return { command, args, flags, global };
}
