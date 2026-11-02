import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';
import { firstDifference } from './commands/screenshot';
import { isSoftwareRenderer } from '@engine/backends/three';
import { chromiumArgs, launchChromium, NoBrowserError, pngSize, servedPath } from './screenshot';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/demo/runs/walk-east.run.json';
const LAB = 'games/platformer-lab/runs/start-to-goal.run.json';

/**
 * Whether headless Chromium starts here. Locally a missing browser skips the browser tests with a
 * message; in CI (`CI` is set) it is required, so the tests run and fail loudly instead.
 */
async function browserMissing(): Promise<string | null> {
  try {
    await (await launchChromium()).close();
    return null;
  } catch (error) {
    if (process.env.CI || !(error instanceof NoBrowserError)) return null;
    return error.message;
  }
}
const missing = await browserMissing();
if (missing) console.warn(`skipping the screenshot browser tests: ${missing}`);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ww-shot-'));
  temps.push(dir);
  return dir;
}

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(tempDir(), 'out'),
  });
  expect(stdout.split('\n')).toHaveLength(2);
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

describe.skipIf(missing !== null)('screenshot (headless Chromium)', () => {
  it('gives a byte-identical PNG for the same run and tick on two runs in a row', async () => {
    const dir = tempDir();
    const a = await cli(['screenshot', WALK, '--tick', '60', '--out', join(dir, 'a.png')]);
    const b = await cli(['screenshot', WALK, '--tick', '60', '--out', join(dir, 'b.png')]);
    expect(a.code).toBe(EXIT.ok);
    expect(a.result).toMatchObject({
      ok: true,
      command: 'screenshot',
      run: WALK,
      game: 'games/demo',
      tick: 60,
      width: 256,
      height: 240,
      matchesHeadless: true,
    });
    expect(a.result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.result.sha256).toBe(a.result.sha256);
    const pngA = readFileSync(join(dir, 'a.png'));
    expect(pngA.equals(readFileSync(join(dir, 'b.png')))).toBe(true);
    expect(pngSize(pngA)).toEqual({ width: 256, height: 240 });
    expect(a.result.bytes).toBe(pngA.length);
  }, 120_000);

  it('draws a different picture once the hero has moved, with the headless state hash', async () => {
    const start = await cli(['screenshot', WALK, '--tick', '0']);
    const later = await cli(['screenshot', WALK, '--tick', '60']);
    expect(start.result.sha256).not.toBe(later.result.sha256);
    expect(start.result.path).toMatch(/screenshots\/walk-east-t0\.png$/);

    let dumped = '';
    await main(['dump', WALK, '--tick', '60', '--json'], {
      stdout: (t) => void (dumped += t),
      stderr: () => {},
      cwd: ROOT,
    });
    expect(later.result.hash).toBe((JSON.parse(dumped) as { hash: string }).hash);
    expect(later.result.headlessHash).toBe(later.result.hash);
  }, 120_000);

  it('takes the picture at the size game.json gives (320x180)', async () => {
    const dir = tempDir();
    cpSync(join(ROOT, 'games/demo'), join(dir, 'demo'), { recursive: true });
    const manifest = join(dir, 'demo/game.json');
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    data.screen = { width: 320, height: 180 };
    writeFileSync(manifest, JSON.stringify(data));
    const out = join(dir, 'wide.png');
    const run = join(dir, 'demo/runs/walk-east.run.json');
    const { code, result } = await cli(['screenshot', run, '--tick', '10', '--out', out]);
    expect(code).toBe(EXIT.ok);
    expect(result).toMatchObject({ width: 320, height: 180, matchesHeadless: true });
    expect(pngSize(readFileSync(out))).toEqual({ width: 320, height: 180 });
  }, 120_000);

  it('reports a game with no view module as invalid content at view', async () => {
    const dir = tempDir();
    cpSync(join(ROOT, 'games/demo'), join(dir, 'demo'), { recursive: true });
    const manifest = join(dir, 'demo/game.json');
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    delete data.view;
    writeFileSync(manifest, JSON.stringify(data));
    const run = join(dir, 'demo/runs/walk-east.run.json');
    const { code, result } = await cli(['screenshot', run, '--tick', '1']);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ path: 'view', code: 'no_view' })]);
  }, 60_000);
});

/** A copy of the demo with a `three` skin added, so only its view's missing `frame()` stops it. */
function demoWithThreeSkin(): string {
  const dir = tempDir();
  cpSync(join(ROOT, 'games/demo'), join(dir, 'demo'), { recursive: true });
  writeFileSync(join(dir, 'demo/content/skins/three.json'), JSON.stringify({ backend: 'three', kinds: {} }));
  return join(dir, 'demo/runs/walk-east.run.json');
}

describe.skipIf(missing !== null)('screenshot --backend three (headless Chromium)', () => {
  it('takes a byte-identical 3D PNG on SwiftShader with --allow-software-gl', async () => {
    const dir = tempDir();
    const argv = (name: string) => [
      'screenshot',
      LAB,
      '--tick',
      '120',
      '--backend',
      'three',
      '--allow-software-gl',
      '--out',
      join(dir, name),
    ];
    const a = await cli(argv('a.png'));
    const b = await cli(argv('b.png'));
    expect(a.code).toBe(EXIT.ok);
    expect(a.result).toMatchObject({
      ok: true,
      backend: 'three',
      tick: 120,
      width: 256,
      height: 240,
      matchesHeadless: true,
    });
    expect(a.result.renderer).toMatch(/SwiftShader/);
    expect(b.result.sha256).toBe(a.result.sha256);
    expect(readFileSync(join(dir, 'a.png')).equals(readFileSync(join(dir, 'b.png')))).toBe(true);

    const flat = await cli(['screenshot', LAB, '--tick', '120', '--out', join(dir, 'flat.png')]);
    expect(flat.result).toMatchObject({ backend: 'canvas2d', renderer: null });
    expect(flat.result.sha256).not.toBe(a.result.sha256);
  }, 180_000);

  it('refuses software WebGL without --allow-software-gl, naming the renderer and the flag', async () => {
    const out = join(tempDir(), 'x.png');
    const { code, result } = await cli([
      'screenshot',
      LAB,
      '--tick',
      '5',
      '--backend',
      'three',
      '--out',
      out,
    ]);
    const renderer = String(result.renderer);
    if (!isSoftwareRenderer(renderer)) {
      // A machine with a real GPU: the picture is taken.
      expect(code).toBe(EXIT.ok);
      return;
    }
    expect(code).toBe(EXIT.failedCheck);
    expect(result).toMatchObject({ ok: false, backend: 'three', refused: 'software_gl' });
    expect(result.message).toContain(renderer);
    expect(result.message).toContain('--allow-software-gl');
    expect(existsSync(out)).toBe(false);
  }, 120_000);

  it('reports a view without frame() as invalid content at view', async () => {
    const run = demoWithThreeSkin();
    const argv = ['screenshot', run, '--tick', '1', '--backend', 'three', '--allow-software-gl'];
    const { code, result } = await cli(argv);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([
      expect.objectContaining({
        file: expect.stringMatching(/demo\/game\.json$/),
        path: 'view',
        code: 'no_frame_hook',
      }),
    ]);
  }, 120_000);
});

describe('screenshot (no browser needed)', () => {
  it('refuses a tick after the run and an --out that is not a PNG', async () => {
    expect((await cli(['screenshot', WALK, '--tick', '9999'])).code).toBe(EXIT.usage);
    expect((await cli(['screenshot', WALK, '--tick', '1', '--out', 'x.jpg'])).code).toBe(EXIT.usage);
  });

  it('refuses --allow-software-gl without --backend three, and an unknown backend', async () => {
    expect((await cli(['screenshot', WALK, '--tick', '1', '--allow-software-gl'])).code).toBe(EXIT.usage);
    expect((await cli(['screenshot', WALK, '--tick', '1', '--backend', 'pixi'])).code).toBe(EXIT.usage);
  });

  it('reports a game with no three skin as invalid content at content.skin, naming its skins', async () => {
    const { code, result } = await cli(['screenshot', WALK, '--tick', '1', '--backend', 'three']);
    expect(code).toBe(EXIT.invalidContent);
    const errors = result.errors as { file: string; path: string; code: string; message: string }[];
    expect(errors).toEqual([
      expect.objectContaining({ file: 'games/demo/game.json', path: 'content.skin', code: 'no_three_skin' }),
    ]);
    expect(errors[0]!.message).toContain('games/demo/content/skins/canvas2d.json (canvas2d)');
  });

  it('turns the GPU off for canvas2d and picks the WebGL flags for three', () => {
    expect(chromiumArgs()).toContain('--disable-gpu');
    expect(chromiumArgs({ backend: 'three' })).not.toContain('--disable-gpu');
    expect(chromiumArgs({ backend: 'three' })).not.toContain('--use-angle=swiftshader');
    expect(chromiumArgs({ backend: 'three', allowSoftwareGl: true })).toEqual(
      expect.arrayContaining(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    );
  });

  it('serves files in the repo by their path and others through /@fs/', () => {
    expect(servedPath(join(ROOT, 'games/demo/view.ts'))).toBe('/games/demo/view.ts');
    expect(servedPath('/tmp/x/view.ts')).toBe('/@fs/tmp/x/view.ts');
  });

  it('finds the first tick where the page and the headless hashes differ', () => {
    const a = [
      { tick: 0, hash: 'a' },
      { tick: 40, hash: 'b' },
    ];
    expect(firstDifference(a, a)).toBeNull();
    expect(firstDifference(a, [a[0]!, { tick: 40, hash: 'x' }])).toBe(40);
    expect(firstDifference(a.slice(0, 1), a)).toBe(40);
    expect(firstDifference([], a)).toBe(0);
  });

  it('reads a PNG size and rejects other bytes', () => {
    expect(() => pngSize(Buffer.from('not a png at all, really not'))).toThrow('not a PNG');
  });
});
