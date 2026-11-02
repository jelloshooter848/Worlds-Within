import { z } from 'zod';
import type { ExitCode } from './exit-codes';

/**
 * The command registry. Each command declares its name, a one-line summary, and its positional
 * arguments and flags as Zod objects: the parser (`args.ts`) checks the command line against them,
 * and `help` (and, from T10, the generated docs) read the same schemas, so they cannot drift.
 *
 * Describe every field with `.describe('...')`: that text is the help line. Positional arguments
 * are taken in the order of the object's keys; an `.optional()` one may be left out. Flag keys are
 * written in camelCase and typed on the command line in kebab-case (`maxOutput` -> `--max-output`).
 * A boolean flag takes no value; any other flag takes one (`--tick 120` or `--tick=120`).
 */

/** The shape every args or flags schema has. */
export type Fields = z.ZodObject<z.ZodRawShape, z.core.$strict>;

/** Where a command runs: the folder paths are relative to, and where long output goes. */
export interface CommandContext {
  /** The working folder: command-line paths are relative to it. */
  cwd: string;
}

/**
 * What a command returns: an exit code and its result fields (the CLI adds `ok`, `command` and
 * `exitCode`). Put lists that can grow long (errors, files, ticks) in top-level arrays: when the
 * result is over the output cap, those are what gets cut (`output.ts`).
 */
export interface Outcome {
  exit: ExitCode;
  result: Record<string, unknown>;
}

export interface Command<A extends Fields = Fields, F extends Fields = Fields> {
  /** One lower-case word (or words joined by `-`). */
  name: string;
  /** One line, for `help`. */
  summary: string;
  args: A;
  flags: F;
  run(input: { args: z.output<A>; flags: z.output<F> }, ctx: CommandContext): Outcome | Promise<Outcome>;
  /** The result for people, without `--json`. Defaults to the result's fields, one per line. */
  text?(result: Record<string, unknown>): string;
}

/** Identity, but checks a command's `run` against its own schemas. */
export function defineCommand<A extends Fields, F extends Fields>(command: Command<A, F>): Command {
  return command as unknown as Command;
}

/** The flags every command takes. Kept out of each command's own `flags`. */
export const globalFlags = z.strictObject({
  json: z.boolean().default(false).describe('print exactly one JSON result object on stdout'),
  help: z.boolean().default(false).describe('show help for the command'),
  maxOutput: z
    .number()
    .int()
    .min(256)
    .optional()
    .describe('the output cap in bytes; longer output is cut and the rest written to a file'),
});

export type GlobalFlags = z.output<typeof globalFlags>;

/** The base type of a field: `boolean`, `number`, `string`, `enum`... after optional and default. */
export function baseType(field: z.ZodType): string {
  let t = field as z.ZodType;
  for (;;) {
    const def = t._zod.def as { type: string; innerType?: z.ZodType };
    if ((def.type === 'optional' || def.type === 'default' || def.type === 'nullable') && def.innerType) {
      t = def.innerType;
      continue;
    }
    return def.type;
  }
}

/** The values an enum field allows, or undefined. */
function enumValues(field: z.ZodType): string[] | undefined {
  let t = field as z.ZodType;
  while (true) {
    const def = t._zod.def as { type: string; innerType?: z.ZodType; entries?: Record<string, string> };
    if (def.type === 'enum' && def.entries) return Object.values(def.entries);
    if (!def.innerType) return undefined;
    t = def.innerType;
  }
}

/** One field as help and docs see it. */
export interface FieldDoc {
  /** The key in the schema (camelCase). */
  key: string;
  /** As typed: `--max-output` for a flag, `<game>` or `[game]` for an argument. */
  usage: string;
  type: string;
  optional: boolean;
  values?: string[];
  description: string;
}

/** camelCase -> kebab-case: `maxOutput` -> `max-output`. */
export function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** Every field of an args or flags object, in order, for help. */
export function fieldDocs(fields: Fields, as: 'arg' | 'flag'): FieldDoc[] {
  return Object.entries(fields.shape).map(([key, value]) => {
    const field = value as z.ZodType;
    const type = baseType(field);
    const optional = field.isOptional();
    const values = enumValues(field);
    const valueHint = type === 'boolean' ? '' : ` <${values ? values.join('|') : type}>`;
    const usage = as === 'flag' ? `--${kebab(key)}${valueHint}` : optional ? `[${key}]` : `<${key}>`;
    const doc: FieldDoc = { key, usage, type, optional, description: field.description ?? '' };
    if (values) doc.values = values;
    return doc;
  });
}

/** Commands by name, in the order they were added. */
export class Registry {
  private readonly commands = new Map<string, Command>();

  add(command: Command): this {
    if (this.commands.has(command.name)) throw new Error(`command "${command.name}" is added twice`);
    for (const key of Object.keys(command.flags.shape)) {
      if (key in globalFlags.shape)
        throw new Error(`command "${command.name}": --${kebab(key)} is a global flag`);
    }
    this.commands.set(command.name, command);
    return this;
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  list(): Command[] {
    return [...this.commands.values()];
  }
}
