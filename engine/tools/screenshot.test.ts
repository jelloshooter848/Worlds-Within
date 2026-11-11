import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';
import { firstDifference } from './commands/screenshot';
import { isSoftwareRenderer } from '@engine/backends/three';
import { chromiumArgs, launchChromium, NoBrowserError, pngSize, servedPath } from './screenshot';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WALK = 'games/samples/dungeon/runs/walk-east.run.json';
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

/**
 * A test-only PNG reader: 8-bit RGB or RGBA, not interlaced (what Chromium and the encoder in
 * `engine/core/content/png.ts` write), every row unfiltered. `pixel(x, y)` is `[r, g, b, a]`.
 */
function decodeRgbaPng(png: Buffer): { pixel(x: number, y: number): number[] } {
  const { width, height } = pngSize(png);
  const channels = png[25] === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i]!;
      const a = i >= channels ? out[y * stride + i - channels]! : 0;
      const b = y > 0 ? out[(y - 1) * stride + i]! : 0;
      const c = i >= channels && y > 0 ? out[(y - 1) * stride + i - channels]! : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const add = [0, a, b, (a + b) >> 1, paeth][filter]!;
      out[y * stride + i] = (x + add) & 0xff;
    }
  }
  return {
    pixel: (x, y) => {
      const at = y * stride + x * channels;
      return [out[at]!, out[at + 1]!, out[at + 2]!, channels === 4 ? out[at + 3]! : 255];
    },
  };
}

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
      game: 'games/samples/dungeon',
      tick: 60,
      width: 320,
      height: 180,
      matchesHeadless: true,
    });
    expect(a.result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.result.sha256).toBe(a.result.sha256);
    const pngA = readFileSync(join(dir, 'a.png'));
    expect(pngA.equals(readFileSync(join(dir, 'b.png')))).toBe(true);
    expect(pngSize(pngA)).toEqual({ width: 320, height: 180 });
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
    cpSync(join(ROOT, 'games/samples/dungeon'), join(dir, 'demo'), { recursive: true });
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
    cpSync(join(ROOT, 'games/samples/dungeon'), join(dir, 'demo'), { recursive: true });
    const manifest = join(dir, 'demo/game.json');
    const data = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    delete data.view;
    writeFileSync(manifest, JSON.stringify(data));
    const run = join(dir, 'demo/runs/walk-east.run.json');
    const { code, result } = await cli(['screenshot', run, '--tick', '1']);
    expect(code).toBe(EXIT.invalidContent);
    expect(result.errors).toEqual([expect.objectContaining({ path: 'view', code: 'no_view' })]);
  }, 60_000);

  it('draws the fx lab torch from its PNG sheet, the same bytes on two runs (Engine 0.16 T10)', async () => {
    const dir = tempDir();
    const run = 'games/fx-lab/runs/level-3.run.json';
    const a = await cli(['screenshot', run, '--tick', '40', '--out', join(dir, 'a.png')]);
    const b = await cli(['screenshot', run, '--tick', '40', '--out', join(dir, 'b.png')]);
    expect(a.code).toBe(EXIT.ok);
    expect(a.result.matchesHeadless).toBe(true);
    expect(b.result.sha256).toBe(a.result.sha256);
    // The first torch stands on the ground (its box 96, 208, 16x16): the sheet's 16x24 frame is
    // anchored on its bottom centre, so its pole (the frame's rows 18-23) is the sheet's own
    // pixels at 96, 218.
    const shot = decodeRgbaPng(readFileSync(join(dir, 'a.png')));
    const sheet = decodeRgbaPng(readFileSync(join(ROOT, 'games/fx-lab/assets/fx-lab-png/torch.png')));
    for (let y = 18; y < 24; y++) {
      for (let x = 0; x < 16; x++) {
        const want = sheet.pixel(1 + x, 1 + y);
        if (want[3] === 0) continue;
        // Within a little: the flame's additive particles and (Engine 0.16 part C T4) the torch's
        // own light glowing over the level's darkness shift the pole by a few dozen levels.
        const got = shot.pixel(96 + x, 200 + y);
        const off = Math.max(...[0, 1, 2].map((i) => Math.abs(got[i]! - want[i]!)));
        expect(off, `${x},${y}: ${got.join(',')} for ${want.join(',')}`).toBeLessThanOrEqual(64);
      }
    }
  }, 120_000);
});

/** A copy of the demo with a `three` skin added, so only its view's missing `frame()` stops it. */
function demoWithThreeSkin(): string {
  const dir = tempDir();
  cpSync(join(ROOT, 'games/samples/dungeon'), join(dir, 'demo'), { recursive: true });
  writeFileSync(join(dir, 'demo/content/skins/three.json'), JSON.stringify({ backend: 'three', kinds: {} }));
  return join(dir, 'demo/runs/walk-east.run.json');
}

describe.skipIf(missing !== null)('screenshot --scale and --overlay (Engine 0.16 part B)', () => {
  it('writes an exact 6x picture: every pixel an exact 6x6 block of the 1x one', async () => {
    const dir = tempDir();
    const one = await cli(['screenshot', WALK, '--tick', '30', '--out', join(dir, 'one.png')]);
    const six = await cli([
      'screenshot',
      WALK,
      '--tick',
      '30',
      '--scale',
      '6',
      '--out',
      join(dir, 'six.png'),
    ]);
    expect(six.code).toBe(EXIT.ok);
    expect(six.result).toMatchObject({
      width: 1920,
      height: 1080,
      scale: 6,
      overlay: null,
      matchesHeadless: true,
    });
    expect(six.result.hash).toBe(one.result.hash);
    const small = decodeRgbaPng(readFileSync(join(dir, 'one.png')));
    const big = decodeRgbaPng(readFileSync(join(dir, 'six.png')));
    for (const [x, y] of [
      [0, 0],
      [17, 33],
      [128, 120],
      [200, 170],
      [319, 179],
    ] as const)
      for (const [dx, dy] of [
        [0, 0],
        [5, 0],
        [0, 5],
        [5, 5],
        [3, 2],
      ] as const)
        expect(big.pixel(x * 6 + dx, y * 6 + dy), `${x},${y}`).toEqual(small.pixel(x, y));
  }, 120_000);

  it("draws one of sheet's overlays over the picture, and refuses one the game cannot show", async () => {
    const dir = tempDir();
    const run = 'games/fx-lab/runs/level-1.run.json';
    const plain = await cli(['screenshot', run, '--tick', '360', '--out', join(dir, 'p.png')]);
    const clear = await cli([
      'screenshot',
      run,
      '--tick',
      '360',
      '--overlay',
      'clear',
      '--out',
      join(dir, 'c.png'),
    ]);
    expect(clear.code).toBe(EXIT.ok);
    expect(clear.result).toMatchObject({ overlay: 'clear', width: 256, height: 240, matchesHeadless: true });
    expect(clear.result.sha256).not.toBe(plain.result.sha256);
    const levels = await cli(['screenshot', run, '--tick', '0', '--overlay', 'levels', '--scale', '2']);
    expect(levels.result).toMatchObject({ overlay: 'levels', width: 512, height: 480 });
    // The dungeon has an end screen (Engine 0.16 part C T7) but no level-clear banner.
    const bad = await cli(['screenshot', WALK, '--tick', '0', '--overlay', 'clear']);
    expect(bad.code).toBe(EXIT.usage);
    const noDialog = await cli(['screenshot', WALK, '--tick', '0', '--overlay', 'dialog:nope']);
    expect(noDialog.code).toBe(EXIT.usage);
    const nope = await cli(['screenshot', run, '--tick', '0', '--overlay', 'nope']);
    expect(nope.code).toBe(EXIT.usage);
  }, 120_000);
});

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

describe.skipIf(missing !== null)('screenshot --backend pixi (headless Chromium, T13b-5)', () => {
  const FX = 'games/fx-lab/runs/level-1.run.json';

  it('takes a byte-identical PixiJS PNG on software WebGL, naming the renderer', async () => {
    const dir = tempDir();
    const argv = (name: string) => [
      'screenshot',
      FX,
      '--tick',
      '154',
      '--backend',
      'pixi',
      '--out',
      join(dir, name),
    ];
    const a = await cli(argv('a.png'));
    expect(a.code, JSON.stringify(a.result)).toBe(EXIT.ok);
    expect(a.result).toMatchObject({
      ok: true,
      backend: 'pixi',
      tick: 154,
      width: 256,
      height: 240,
      matchesHeadless: true,
    });
    // Software WebGL is not refused for PixiJS: the result names it.
    expect(a.result.renderer).toEqual(expect.stringMatching(/\S/));
    const png = readFileSync(join(dir, 'a.png'));
    expect(pngSize(png)).toEqual({ width: 256, height: 240 });
    const b = await cli(argv('b.png'));
    expect(b.result.sha256).toBe(a.result.sha256);

    // The same tick through Canvas2D is a different file of nearly the same picture (the parity
    // test, tests/browser/pixi-parity.test.ts, measures how near).
    const flat = await cli(['screenshot', FX, '--tick', '154', '--out', join(dir, 'flat.png')]);
    expect(flat.result).toMatchObject({ backend: 'canvas2d', renderer: null, hash: a.result.hash });
    const p = decodeRgbaPng(png);
    const c = decodeRgbaPng(readFileSync(join(dir, 'flat.png')));
    // The HUD's corner is the same pixel in both.
    expect(p.pixel(4, 4)).toEqual(c.pixel(4, 4));
  }, 180_000);

  it('draws an overlay with the PixiJS UI painter', async () => {
    const dir = tempDir();
    const bare = await cli([
      'screenshot',
      FX,
      '--tick',
      '40',
      '--backend',
      'pixi',
      '--out',
      join(dir, 'a.png'),
    ]);
    const paused = await cli([
      'screenshot',
      FX,
      '--tick',
      '40',
      '--backend',
      'pixi',
      '--overlay',
      'pause',
      '--out',
      join(dir, 'b.png'),
    ]);
    expect(paused.code, JSON.stringify(paused.result)).toBe(EXIT.ok);
    expect(paused.result).toMatchObject({ backend: 'pixi', overlay: 'pause' });
    expect(paused.result.sha256).not.toBe(bare.result.sha256);
    // The overlay is taken off again: the state and the hashes are the bare run's.
    expect(paused.result.hash).toBe(bare.result.hash);
  }, 180_000);
});

describe('screenshot (no browser needed)', () => {
  it('refuses a tick after the run and an --out that is not a PNG', async () => {
    expect((await cli(['screenshot', WALK, '--tick', '9999'])).code).toBe(EXIT.usage);
    expect((await cli(['screenshot', WALK, '--tick', '1', '--out', 'x.jpg'])).code).toBe(EXIT.usage);
  });

  it('refuses a scale outside 1-16', async () => {
    expect((await cli(['screenshot', WALK, '--tick', '0', '--scale', '0'])).code).toBe(EXIT.usage);
    expect((await cli(['screenshot', WALK, '--tick', '0', '--scale', '17'])).code).toBe(EXIT.usage);
  });

  it('refuses --allow-software-gl without --backend three, and an unknown backend', async () => {
    expect((await cli(['screenshot', WALK, '--tick', '1', '--allow-software-gl'])).code).toBe(EXIT.usage);
    const pixiGl = ['screenshot', WALK, '--tick', '1', '--backend', 'pixi', '--allow-software-gl'];
    expect((await cli(pixiGl)).code).toBe(EXIT.usage);
    expect((await cli(['screenshot', WALK, '--tick', '1', '--backend', 'webgpu'])).code).toBe(EXIT.usage);
  });

  it('reports a game with no three skin as invalid content at content.skin, naming its skins', async () => {
    const { code, result } = await cli(['screenshot', WALK, '--tick', '1', '--backend', 'three']);
    expect(code).toBe(EXIT.invalidContent);
    const errors = result.errors as { file: string; path: string; code: string; message: string }[];
    expect(errors).toEqual([
      expect.objectContaining({
        file: 'games/samples/dungeon/game.json',
        path: 'content.skin',
        code: 'no_three_skin',
      }),
    ]);
    expect(errors[0]!.message).toContain('games/samples/dungeon/content/skins/canvas2d.json (canvas2d)');
  });

  it('turns the GPU off for canvas2d and picks the WebGL flags for three and pixi', () => {
    expect(chromiumArgs()).toContain('--disable-gpu');
    expect(chromiumArgs({ backend: 'three' })).not.toContain('--disable-gpu');
    expect(chromiumArgs({ backend: 'three' })).not.toContain('--use-angle=swiftshader');
    expect(chromiumArgs({ backend: 'three', allowSoftwareGl: true })).toEqual(
      expect.arrayContaining(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    );
    // PixiJS always draws on SwiftShader, so its PNGs are the same on every run (T13b-5).
    expect(chromiumArgs({ backend: 'pixi' })).toEqual(
      expect.arrayContaining(['--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
    );
    expect(chromiumArgs({ backend: 'pixi' })).not.toContain('--disable-gpu');
  });

  it('serves files in the repo by their path and others through /@fs/', () => {
    expect(servedPath(join(ROOT, 'games/samples/dungeon/view.ts'))).toBe('/games/samples/dungeon/view.ts');
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
