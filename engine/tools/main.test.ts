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

/** A copy of games/samples/dungeon in a temp folder (as `<tmp>/games/samples/dungeon`), returning the temp root. */
function demoCopy(): string {
  const root = tempDir();
  cpSync(join(ROOT, 'games/samples/dungeon'), join(root, 'games/samples/dungeon'), { recursive: true });
  return root;
}

describe('validate', () => {
  it('passes games/samples/dungeon with one JSON object and exit 0', async () => {
    const run = await cli(['validate', 'games/samples/dungeon', '--json']);
    expect(run.code).toBe(EXIT.ok);
    const result = run.json();
    expect(result).toMatchObject({
      ok: true,
      command: 'validate',
      exitCode: 0,
      game: 'games/samples/dungeon',
      errorCount: 0,
    });
    expect(result.fileCount).toBeGreaterThan(5);
    expect(result.files).toContainEqual({ file: 'games/samples/dungeon/game.json', errors: 0 });
    expect(run.stderr).toBe('');
  });

  it('names the file and field of a broken field, with the invalid-content code', async () => {
    const root = demoCopy();
    const file = join(root, 'games/samples/dungeon/content/rooms/courtyard.json');
    const room = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    room.music = 42;
    writeFileSync(file, JSON.stringify(room));
    const run = await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    const result = run.json();
    expect(result).toMatchObject({ ok: false, exitCode: 3, errorCount: 1 });
    expect(result.errors).toEqual([
      expect.objectContaining({ file: 'games/samples/dungeon/content/rooms/courtyard.json', path: 'music' }),
    ]);
    expect(result.files).toContainEqual({
      file: 'games/samples/dungeon/content/rooms/courtyard.json',
      errors: 1,
    });
  });

  it('checks a skin: a bad field and a missing sheet or sound, at the skin file and field', async () => {
    const root = demoCopy();
    const game = join(root, 'games/samples/dungeon/game.json');
    const manifest = JSON.parse(readFileSync(game, 'utf8')) as { content: Record<string, string[]> };
    manifest.content['skin'] = ['content/skins/*.json'];
    writeFileSync(game, JSON.stringify(manifest));
    mkdirSync(join(root, 'games/samples/dungeon/content/skins'), { recursive: true });
    const skinFile = join(root, 'games/samples/dungeon/content/skins/canvas2d.json');
    const skin = {
      backend: 'canvas2d',
      sheets: { sheet: 'hero', fallbackColor: '#00a800' },
      kinds: { hero: { frames: { idle: { down: 'down-0', right: 'side-0' } }, flipFacing: true } },
      events: { title: { sound: 'crypt' } },
    };
    writeFileSync(skinFile, JSON.stringify(skin));
    expect((await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root })).code).toBe(EXIT.ok);

    writeFileSync(skinFile, JSON.stringify({ ...skin, kinds: { hero: { frames: {}, flipFacing: 'yes' } } }));
    const bad = await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root });
    expect(bad.code).toBe(EXIT.invalidContent);
    expect(bad.json().errors).toEqual([
      expect.objectContaining({
        file: 'games/samples/dungeon/content/skins/canvas2d.json',
        path: 'kinds.hero.flipFacing',
      }),
    ]);

    const cross = {
      ...skin,
      kinds: { hero: { sheet: 'nobody', frames: { idle: 'down-0' } } },
      events: { hit: { sound: 'boom' } },
    };
    writeFileSync(skinFile, JSON.stringify(cross));
    const run = await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.json().errors).toEqual([
      expect.objectContaining({
        file: 'games/samples/dungeon/content/skins/canvas2d.json',
        path: 'kinds.hero.sheet',
        code: 'missing_ref',
      }),
      expect.objectContaining({
        file: 'games/samples/dungeon/content/skins/canvas2d.json',
        path: 'events.hit.sound',
        code: 'missing_ref',
      }),
    ]);
  });

  it('checks a campaign file in any game, naming the file and field of a missing level or mission', async () => {
    const root = demoCopy();
    const game = join(root, 'games/samples/dungeon/game.json');
    const manifest = JSON.parse(readFileSync(game, 'utf8')) as { content: Record<string, string[]> };
    manifest.content['mission'] = ['content/missions/*.mission.json'];
    manifest.content['campaign'] = ['content/missions/*.campaign.json'];
    writeFileSync(game, JSON.stringify(manifest));
    mkdirSync(join(root, 'games/samples/dungeon/content/missions'), { recursive: true });
    const raid = {
      id: 'raid',
      title: 'Raid',
      worldTimeCost: 20,
      play: 'sabotage',
      onQuit: 'lost',
      outcomes: [{ id: 'lost', title: 'Lost' }],
    };
    writeFileSync(
      join(root, 'games/samples/dungeon/content/missions/raid.mission.json'),
      JSON.stringify(raid),
    );
    const file = join(root, 'games/samples/dungeon/content/missions/main.campaign.json');
    writeFileSync(file, JSON.stringify({ version: 1, id: 'main', entries: [{ mission: 'raid' }] }));
    expect((await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root })).code).toBe(EXIT.ok);

    const entries = [{ mission: 'raid' }, { mission: 'rescue' }, { level: 'level-1' }];
    writeFileSync(file, JSON.stringify({ version: 1, id: 'main', entries }));
    const bad = await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root });
    expect(bad.code).toBe(EXIT.invalidContent);
    const errors = bad.json().errors as { file: string; path: string; code: string }[];
    const at = 'games/samples/dungeon/content/missions/main.campaign.json';
    expect(errors.map(({ file, path, code }) => ({ file, path, code }))).toEqual([
      { file: at, path: 'entries.1.mission', code: 'missing_mission' },
      { file: at, path: 'entries.2.level', code: 'missing_level' },
    ]);
  });

  it('checks a mission file in any game, naming the file and field', async () => {
    const root = demoCopy();
    const game = join(root, 'games/samples/dungeon/game.json');
    const manifest = JSON.parse(readFileSync(game, 'utf8')) as { content: Record<string, string[]> };
    manifest.content['mission'] = ['content/missions/*.mission.json'];
    writeFileSync(game, JSON.stringify(manifest));
    mkdirSync(join(root, 'games/samples/dungeon/content/missions'), { recursive: true });
    const file = join(root, 'games/samples/dungeon/content/missions/raid.mission.json');
    const mission = {
      id: 'raid',
      title: 'Raid',
      worldTimeCost: 20,
      play: 'sabotage',
      onQuit: 'lost',
      outcomes: [
        { id: 'won', title: 'Won', weight: 2, effects: [{ type: 'destroy', entity: 'ram' }] },
        { id: 'lost', title: 'Lost' },
      ],
    };
    writeFileSync(file, JSON.stringify(mission));
    expect((await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root })).code).toBe(EXIT.ok);

    const outcomes = [mission.outcomes[0], { id: 'won', title: 'Again' }, mission.outcomes[1]];
    writeFileSync(file, JSON.stringify({ ...mission, worldTimeCost: -1, outcomes }));
    const bad = await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root });
    expect(bad.code).toBe(EXIT.invalidContent);
    const errors = bad.json().errors as { file: string; path: string; code: string }[];
    expect(errors.map(({ file, path, code }) => ({ file, path, code }))).toEqual([
      {
        file: 'games/samples/dungeon/content/missions/raid.mission.json',
        path: 'worldTimeCost',
        code: 'too_small',
      },
      {
        file: 'games/samples/dungeon/content/missions/raid.mission.json',
        path: 'outcomes.1.id',
        code: 'duplicate_outcome',
      },
    ]);
  });

  it('reports an unknown kit at the manifest field', async () => {
    const root = demoCopy();
    const file = join(root, 'games/samples/dungeon/game.json');
    writeFileSync(file, readFileSync(file, 'utf8').replace('"topdown"', '"nokit"'));
    const result = (await cli(['validate', 'games/samples/dungeon', '--json'], { cwd: root })).json();
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        file: 'games/samples/dungeon/game.json',
        path: 'kit',
        code: 'unknown_kit',
        message: expect.stringContaining('unknown kit "nokit" in "kit"'),
      }),
    );
    expect(result.exitCode).toBe(3);
  });

  it('checks PNG sheets and the credits of an assets/ folder (Engine 0.16 T10)', async () => {
    // A copy of the fx lab, whose 2D skin draws the torch from assets/fx-lab-png/torch.png.
    const root = tempDir();
    cpSync(join(ROOT, 'games/fx-lab'), join(root, 'games/fx-lab'), { recursive: true });
    const lab = join(root, 'games/fx-lab');
    const SKIN = 'games/fx-lab/content/skins/canvas2d.json';
    const CREDITS = 'games/fx-lab/assets/CREDITS.md';
    const errors = async () => {
      const run = await cli(['validate', 'games/fx-lab', '--json'], { cwd: root });
      const json = run.json();
      expect(run.code).toBe((json.errors as unknown[]).length === 0 ? EXIT.ok : EXIT.invalidContent);
      return (json.errors as { file: string; path: string; code: string }[]).map((e) => [
        e.file,
        e.path,
        e.code,
      ]);
    };
    expect(await errors()).toEqual([]);

    // A frame outside the image: the unlit torch moved down past the sheet's 52 rows.
    const skinPath = join(root, SKIN);
    const skinText = readFileSync(skinPath, 'utf8');
    writeFileSync(skinPath, skinText.replace('"y": 27', '"y": 40'));
    expect(await errors()).toEqual([
      [SKIN, 'images["lab-torch"].frames["torch-unlit"]', 'frame_outside_image'],
    ]);
    writeFileSync(skinPath, skinText);

    // A pack folder the credits do not name.
    mkdirSync(join(lab, 'assets/extra-pack'));
    cpSync(join(lab, 'assets/fx-lab-png/torch.png'), join(lab, 'assets/extra-pack/copy.png'));
    expect(await errors()).toEqual([[CREDITS, '["extra-pack"]', 'missing_credits']]);
    rmSync(join(lab, 'assets/extra-pack'), { recursive: true });

    // A licence that is not CC0, with no owner decision cited.
    const credits = readFileSync(join(root, CREDITS), 'utf8');
    writeFileSync(join(root, CREDITS), credits.replace('CC0 1.0 Universal', 'CC-BY-NC 4.0'));
    expect(await errors()).toEqual([[CREDITS, '["fx-lab-png"].licence', 'bad_licence']]);

    // No CREDITS.md at all, and the PNG gone: both reported, each at its file and field.
    rmSync(join(root, CREDITS));
    expect(await errors()).toEqual([[CREDITS, '', 'missing_credits']]);
    rmSync(join(lab, 'assets/fx-lab-png/torch.png'));
    writeFileSync(join(root, CREDITS), credits);
    expect(await errors()).toEqual([[SKIN, 'images["lab-torch"].image', 'missing_file']]);
  });

  it('prints one line per error for people', async () => {
    const root = demoCopy();
    writeFileSync(join(root, 'games/samples/dungeon/content/songs/crypt.json'), '{ nope');
    const run = await cli(['validate', 'games/samples/dungeon'], { cwd: root });
    expect(run.code).toBe(EXIT.invalidContent);
    expect(run.stdout).toContain('games/samples/dungeon: ');
    expect(run.stdout).toContain('games/samples/dungeon/content/songs/crypt.json: (file): not valid JSON');
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
    [['validate', 'games/samples/dungeon', '--bogus', '--json']],
    [['nope', '--json']],
    [['validate', '--json']],
    [['validate', 'games/samples/dungeon', 'extra', '--json']],
    [['--max-output', 'many', 'validate', 'games/samples/dungeon', '--json']],
  ])('%j exits 2 with one JSON object', async (argv) => {
    const run = await cli(argv);
    expect(run.code).toBe(EXIT.usage);
    expect(run.json()).toMatchObject({ ok: false, exitCode: 2, error: { kind: 'usage' } });
  });

  it('names the unknown flag, on stderr without --json', async () => {
    const run = await cli(['validate', 'games/samples/dungeon', '--bogus']);
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
    const file = join(root, 'games/samples/dungeon/content/palettes/hero.json');
    const palette = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    for (let i = 0; i < 10; i++) palette[`extra${i}`] = i;
    writeFileSync(file, JSON.stringify(palette));
    const outDir = join(root, 'out');
    const run = await cli(['validate', 'games/samples/dungeon', '--json', '--max-output', '600'], {
      cwd: root,
      outDir,
    });
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
      'trace',
      'events',
      'timeline',
      'code',
      'screenshot',
      'debug',
      'mutants',
      'record',
      'get',
      'set',
      'add',
      'remove',
      'paste',
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
    const out = spawnSync('pnpm', ['-s', 'cli', 'validate', 'games/samples/dungeon', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    expect(out.status).toBe(EXIT.ok);
    expect(JSON.parse(out.stdout)).toMatchObject({ ok: true, command: 'validate' });
    expect(existsSync(join(ROOT, 'engine/tools/cli.ts'))).toBe(true);
  }, 30_000);
});
