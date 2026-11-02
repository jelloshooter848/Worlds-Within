import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { helpCommand } from './commands/help';
import { validateCommand } from './commands/validate';
import { EXIT } from './exit-codes';
import { main } from './main';
import { defineCommand, Registry } from './registry';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface Captured {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout parsed as JSON; fails the test unless it is exactly one object on one line. */
  json(): Record<string, unknown>;
}

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-cli-'));
  temps.push(dir);
  return dir;
}

async function cli(
  argv: string[],
  opts: { cwd?: string; outDir?: string; registry?: Registry } = {},
): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  const io = {
    stdout: (t: string) => void (stdout += t),
    stderr: (t: string) => void (stderr += t),
    cwd: opts.cwd ?? ROOT,
    outDir: opts.outDir ?? join(tempDir(), 'out'),
  };
  const code = await main(argv, io, opts.registry);
  return {
    code,
    stdout,
    stderr,
    json() {
      const lines = stdout.split('\n');
      expect(lines.length, `stdout: ${stdout}`).toBe(2);
      expect(lines[1]).toBe('');
      const value = JSON.parse(lines[0]!) as unknown;
      expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(true);
      return value as Record<string, unknown>;
    },
  };
}

/** A copy of games/demo in a temp folder (as `<tmp>/games/demo`), returning the temp root. */
function demoCopy(): string {
  const root = tempDir();
  cpSync(join(ROOT, 'games/demo'), join(root, 'games/demo'), { recursive: true });
  return root;
}

describe('validate', () => {
  it('passes games/demo with one JSON object and exit 0', async () => {
    const run = await cli(['validate', 'games/demo', '--json']);
    expect(run.code).toBe(EXIT.ok);
    const result = run.json();
    expect(result).toMatchObject({
      ok: true,
      command: 'validate',
      exitCode: 0,
      game: 'games/demo',
      errorCount: 0,
    });
    expect(result.fileCount).toBeGreaterThan(5);
    expect(result.files).toContainEqual({ file: 'games/demo/game.json', errors: 0 });
    expect(run.stderr).toBe('');
  });

  it('names the file and field of a broken field, with the invalid-content code', async () => {
    const root = demoCopy();
    const file = join(root, 'games/demo/content/rooms/courtyard.json');
    const room = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    room.music = 42;
    writeFileSync(file, JSON.stringify(room));
    const run = await cli(['validate', 'games/demo', '--json'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    const result = run.json();
    expect(result).toMatchObject({ ok: false, exitCode: 3, errorCount: 1 });
    expect(result.errors).toEqual([
      expect.objectContaining({ file: 'games/demo/content/rooms/courtyard.json', path: 'music' }),
    ]);
    expect(result.files).toContainEqual({ file: 'games/demo/content/rooms/courtyard.json', errors: 1 });
  });

  it('checks a skin: a bad field and a missing sheet or sound, at the skin file and field', async () => {
    const root = demoCopy();
    const game = join(root, 'games/demo/game.json');
    const manifest = JSON.parse(readFileSync(game, 'utf8')) as { content: Record<string, string[]> };
    manifest.content['skin'] = ['content/skins/*.json'];
    writeFileSync(game, JSON.stringify(manifest));
    mkdirSync(join(root, 'games/demo/content/skins'));
    const skinFile = join(root, 'games/demo/content/skins/canvas2d.json');
    const skin = {
      backend: 'canvas2d',
      sheets: { sheet: 'demo-hero', fallbackColor: '#00a800' },
      kinds: { hero: { frames: { idle: { down: 'down-0', right: 'side-0' } }, flipFacing: true } },
      events: { title: { sound: 'demo' } },
    };
    writeFileSync(skinFile, JSON.stringify(skin));
    expect((await cli(['validate', 'games/demo', '--json'], { cwd: root })).code).toBe(EXIT.ok);

    writeFileSync(skinFile, JSON.stringify({ ...skin, kinds: { hero: { frames: {}, flipFacing: 'yes' } } }));
    const bad = await cli(['validate', 'games/demo', '--json'], { cwd: root });
    expect(bad.code).toBe(EXIT.invalidContent);
    expect(bad.json().errors).toEqual([
      expect.objectContaining({
        file: 'games/demo/content/skins/canvas2d.json',
        path: 'kinds.hero.flipFacing',
      }),
    ]);

    const cross = {
      ...skin,
      kinds: { hero: { sheet: 'nobody', frames: { idle: 'down-0' } } },
      events: { hit: { sound: 'boom' } },
    };
    writeFileSync(skinFile, JSON.stringify(cross));
    const run = await cli(['validate', 'games/demo', '--json'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.json().errors).toEqual([
      expect.objectContaining({
        file: 'games/demo/content/skins/canvas2d.json',
        path: 'kinds.hero.sheet',
        code: 'missing_ref',
      }),
      expect.objectContaining({
        file: 'games/demo/content/skins/canvas2d.json',
        path: 'events.hit.sound',
        code: 'missing_ref',
      }),
    ]);
  });

  it('reports an unknown kit at the manifest field', async () => {
    const root = demoCopy();
    const file = join(root, 'games/demo/game.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"topdown"', '"nokit"'));
    const result = (await cli(['validate', 'games/demo', '--json'], { cwd: root })).json();
    expect(result.errors).toContainEqual(
      expect.objectContaining({ file: 'games/demo/game.json', path: 'kit', code: 'unknown_kit' }),
    );
  });

  it('prints one line per error for people', async () => {
    const root = demoCopy();
    writeFileSync(join(root, 'games/demo/content/songs/demo.json'), '{ nope');
    const run = await cli(['validate', 'games/demo'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.stdout).toContain('games/demo: ');
    expect(run.stdout).toContain('games/demo/content/songs/demo.json: (file): not valid JSON');
  });

  it('calls a missing folder a usage error', async () => {
    const run = await cli(['validate', 'games/nothing-here', '--json']);
    expect(run.code).toBe(EXIT.usage);
    expect(run.json()).toMatchObject({
      ok: false,
      command: 'validate',
      exitCode: 2,
      error: { kind: 'usage' },
    });
  });
});

describe('usage errors', () => {
  it.each([
    [['validate', 'games/demo', '--bogus', '--json']],
    [['nope', '--json']],
    [['validate', '--json']],
    [['validate', 'games/demo', 'extra', '--json']],
    [['--max-output', 'many', 'validate', 'games/demo', '--json']],
  ])('%j exits 2 with one JSON object', async (argv) => {
    const run = await cli(argv);
    expect(run.code).toBe(EXIT.usage);
    expect(run.json()).toMatchObject({ ok: false, exitCode: 2, error: { kind: 'usage' } });
  });

  it('names the unknown flag, on stderr without --json', async () => {
    const run = await cli(['validate', 'games/demo', '--bogus']);
    expect(run.code).toBe(EXIT.usage);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('unknown flag --bogus');
  });
});

describe('crashes', () => {
  const boom = defineCommand({
    name: 'boom',
    summary: 'throws',
    args: z.strictObject({}),
    flags: z.strictObject({}),
    run() {
      console.log('noise that must not reach stdout');
      throw new Error('kaboom');
    },
  });
  const registry = () => {
    const r = new Registry();
    return r.add(helpCommand(r)).add(validateCommand).add(boom);
  };

  it('exits 5 and still prints exactly one JSON object', async () => {
    const run = await cli(['boom', '--json'], { registry: registry() });
    expect(run.code).toBe(EXIT.crash);
    expect(run.json()).toMatchObject({
      ok: false,
      command: 'boom',
      exitCode: 5,
      error: { kind: 'crash', message: 'kaboom' },
    });
    expect(run.stderr).toContain('noise');
  });
});

describe('output cap', () => {
  it('cuts a long result and writes all of it to a file named in the result', async () => {
    const root = demoCopy();
    // Ten unknown fields in one file: ten errors, far over a 600-byte cap.
    const file = join(root, 'games/demo/content/palettes/demo-hero.json');
    const palette = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (let i = 0; i < 10; i++) palette[`extra${i}`] = i;
    writeFileSync(file, JSON.stringify(palette));
    const outDir = join(root, 'out');
    const run = await cli(['validate', 'games/demo', '--json', '--max-output', '600'], { cwd: root, outDir });
    expect(run.code).toBe(EXIT.invalidContent);
    expect(Buffer.byteLength(run.stdout.trim())).toBeLessThanOrEqual(600);
    const result = run.json();
    expect(result).toMatchObject({ ok: false, truncated: true, errorCount: 10 });
    const fullPath = join(root, result.fullOutput as string);
    expect(fullPath.startsWith(outDir), fullPath).toBe(true);
    const full = JSON.parse(readFileSync(fullPath, 'utf8')) as { errors: unknown[] };
    expect(full.errors).toHaveLength(10);
    const omitted = result.omitted as Record<string, number>;
    expect((result.errors as unknown[]).length + (omitted.errors ?? 0)).toBe(10);
  });

  it('cuts long text output at a line and names the file', async () => {
    const root = tempDir();
    const run = await cli(['help', '--max-output', '300'], { cwd: root, outDir: 'out' });
    expect(run.code).toBe(EXIT.ok);
    expect(Buffer.byteLength(run.stdout)).toBeLessThanOrEqual(301);
    const path = /the full output is in (\S+)/.exec(run.stdout)?.[1];
    expect(path).toMatch(/^out\/help-[0-9a-f]{12}\.txt$/);
    expect(readFileSync(join(root, path!), 'utf8')).toContain('Exit codes:');
  });
});

describe('help', () => {
  it('lists every command from the registry', async () => {
    const result = (await cli(['help', '--json'])).json();
    const names = (result.commands as { name: string }[]).map((c) => c.name);
    expect(names).toEqual([
      'help',
      'validate',
      'run',
      'dump',
      'screenshot',
      'mutants',
      'get',
      'set',
      'add',
      'remove',
    ]);
    expect(result.exitCodes).toContainEqual(expect.objectContaining({ code: 3, name: 'invalidContent' }));
  });

  it('shows one command with --help, even without its arguments', async () => {
    const run = await cli(['validate', '--help']);
    expect(run.code).toBe(EXIT.ok);
    expect(run.stdout).toContain('pnpm cli validate <game>');
    expect(run.stdout).toContain('the game folder');
  });
});

describe('pnpm cli', () => {
  it('runs from the command line with one JSON object on stdout', () => {
    const out = spawnSync('pnpm', ['-s', 'cli', 'validate', 'games/demo', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out.status).toBe(EXIT.ok);
    expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, command: 'validate' });
    expect(existsSync(join(ROOT, 'engine/tools/cli.ts'))).toBe(true);
  }, 30_000);
});
