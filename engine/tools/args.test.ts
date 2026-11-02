import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCommandLine, wantsJson } from './args';
import { UsageError } from './exit-codes';
import { defineCommand, fieldDocs, Registry } from './registry';

const run = defineCommand({
  name: 'run',
  summary: 'test command',
  args: z.strictObject({
    file: z.string().describe('the run file'),
    more: z.string().optional().describe('optional'),
  }),
  flags: z.strictObject({
    tick: z.number().int().min(0).optional().describe('a tick'),
    fast: z.boolean().default(false).describe('go fast'),
    mode: z.enum(['a', 'b']).default('a').describe('a mode'),
  }),
  run: () => ({ exit: 0, result: {} }),
});
const help = defineCommand({
  name: 'help',
  summary: 'help',
  args: z.strictObject({ command: z.string().optional() }),
  flags: z.strictObject({}),
  run: () => ({ exit: 0, result: {} }),
});
const registry = new Registry().add(help).add(run);
const parse = (argv: string[]) => parseCommandLine(argv, registry);

describe('parseCommandLine', () => {
  it('reads arguments in order and flags in any position', () => {
    const line = parse(['--json', 'run', 'a.json', '--tick', '120', '--fast', 'b', '--mode=b']);
    expect(line.command.name).toBe('run');
    expect(line.args).toEqual({ file: 'a.json', more: 'b' });
    expect(line.flags).toEqual({ tick: 120, fast: true, mode: 'b' });
    expect(line.global).toMatchObject({ json: true, help: false });
  });

  it('fills defaults and takes `--` as the end of flags', () => {
    const line = parse(['run', '--', '--odd-file']);
    expect(line.args).toEqual({ file: '--odd-file' });
    expect(line.flags).toEqual({ fast: false, mode: 'a' });
  });

  it('is help with no command', () => {
    expect(parse([]).command.name).toBe('help');
  });

  it.each([
    [['run', 'a', '--nope'], /unknown flag --nope for "run"/],
    [['--tick', '1', 'run', 'a'], /unknown flag --tick/],
    [['run'], /missing argument <file>/],
    [['run', 'a', 'b', 'c'], /extra: c/],
    [['run', 'a', '--tick'], /--tick needs a value/],
    [['run', 'a', '--tick', 'x'], /--tick: /],
    [['run', 'a', '--tick', '-1'], /--tick: /],
    [['run', 'a', '--mode', 'c'], /--mode: /],
    [['run', 'a', '--fast=maybe'], /true or false/],
    [['run', 'a', '--fast', '--fast'], /given twice/],
    [['run', 'a', '--maxOutput', '1000'], /unknown flag --maxOutput/],
    [['walk'], /unknown command "walk" \(known: help, run\)/],
    [['--max-output', '10', 'run', 'a'], /--max-output: /],
  ])('rejects %j', (argv, message) => {
    expect(() => parse(argv)).toThrow(UsageError);
    expect(() => parse(argv)).toThrow(message);
  });

  it('skips argument checks for --help', () => {
    expect(parse(['run', '--help']).global.help).toBe(true);
  });
});

describe('wantsJson', () => {
  it('sees --json before any --', () => {
    expect(wantsJson(['x', '--json'])).toBe(true);
    expect(wantsJson(['x', '--', '--json'])).toBe(false);
    expect(wantsJson(['x'])).toBe(false);
  });
});

describe('fieldDocs', () => {
  it('describes flags and arguments from the schemas', () => {
    expect(fieldDocs(run.args, 'arg').map((d) => d.usage)).toEqual(['<file>', '[more]']);
    expect(fieldDocs(run.flags, 'flag')).toEqual([
      { key: 'tick', usage: '--tick <number>', type: 'number', optional: true, description: 'a tick' },
      { key: 'fast', usage: '--fast', type: 'boolean', optional: true, description: 'go fast' },
      {
        key: 'mode',
        usage: '--mode <a|b>',
        type: 'enum',
        optional: true,
        values: ['a', 'b'],
        description: 'a mode',
      },
    ]);
  });

  it('refuses a command added twice or shadowing a global flag', () => {
    expect(() => new Registry().add(run).add(run)).toThrow(/twice/);
    const bad = { ...run, name: 'bad', flags: z.strictObject({ json: z.boolean() }) };
    expect(() => new Registry().add(bad)).toThrow(/global flag/);
  });
});
