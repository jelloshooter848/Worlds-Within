import { afterAll, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { layoutScreen, overlaps, CONTROL_IDS } from '../../engine/core/input/touch-layout';
import { fitGame } from '../../engine/core/gfx/screen';
import { gameFiles } from '../../build/game-files';
import { EXIT } from '../../engine/tools/exit-codes';
import { main } from '../../engine/tools/main';
import { launchChromium, NoBrowserError, pngSize } from '../../engine/tools/screenshot';

// Two resolutions (docs/ROADMAP.md, 0.4 "Done when"): the demo builds and screenshots at a second
// picture size when only `screen` in its game.json changes. A copy of games/demo (its tests left
// out) with `screen` set to 320x240 must validate, play walk-east with the same state hashes as the
// committed golden file, screenshot at 320x240 (the same PNG bytes on two runs) like the demo does
// at 256x240, and build with Vite. The touch layout follows the new size.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ALT = { width: 320, height: 240 };
const GOLDEN = JSON.parse(readFileSync(join(ROOT, 'games/demo/runs/walk-east.hashes.json'), 'utf8')) as {
  hashes: unknown[];
};

const temp = mkdtempSync(join(tmpdir(), 'ww-two-res-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** games/demo copied to <temp>/games/demo with only `screen` in game.json changed. */
const copy = join(temp, 'games/demo');
cpSync(join(ROOT, 'games/demo'), copy, { recursive: true, filter: (src) => !src.endsWith('.test.ts') });
const manifestPath = join(copy, 'game.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, screen: ALT }, null, 2)}\n`);
const copyRun = join(copy, 'runs/walk-east.run.json');

async function cli(argv: string[]): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main([...argv, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
    outDir: join(temp, 'out'),
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

/** Whether headless Chromium starts here (required in CI, as in engine/tools/screenshot.test.ts). */
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
if (missing) console.warn(`skipping the two-resolution screenshots: ${missing}`);

describe('the demo at a second resolution (one config value changed)', () => {
  it('changed nothing in the copy but `screen`', () => {
    const original = JSON.parse(readFileSync(join(ROOT, 'games/demo/game.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(original.screen).toEqual({ width: 256, height: 240 });
    expect({ ...manifest, screen: ALT }).toEqual({ ...original, screen: ALT });
  });

  it('validates', async () => {
    const { code, result } = await cli(['validate', copy]);
    expect(result.errors ?? [], JSON.stringify(result.errors)).toEqual([]);
    expect(code).toBe(EXIT.ok);
  });

  it('plays walk-east with the same state hashes as at 256x240', async () => {
    const { code, result } = await cli(['run', copyRun]);
    expect(code).toBe(EXIT.ok);
    expect(result.hashes).toEqual(GOLDEN.hashes);
  });

  it.skipIf(missing !== null)(
    'screenshots at both sizes: right PNG size, the same bytes twice, the headless hashes',
    async () => {
      for (const [run, size] of [
        ['games/demo/runs/walk-east.run.json', { width: 256, height: 240 }],
        [copyRun, ALT],
      ] as const) {
        const shots = [];
        for (const name of ['a', 'b']) {
          const out = join(temp, `${size.width}x${size.height}-${name}.png`);
          const { code, result } = await cli(['screenshot', run, '--tick', '120', '--out', out]);
          expect(code, JSON.stringify(result)).toBe(EXIT.ok);
          expect(result).toMatchObject({ ...size, matchesHeadless: true });
          expect(pngSize(readFileSync(out))).toEqual(size);
          shots.push(result);
        }
        expect(shots[1]!.sha256).toBe(shots[0]!.sha256);
        expect(shots[0]!.hashes).toEqual(GOLDEN.hashes.slice(0, 4)); // ticks 0, 40, 80, 120
      }
    },
    180_000,
  );

  it('builds with Vite, the picture size read from the copied game.json', async () => {
    const vite = await import('vite');
    const outDir = join(temp, 'dist');
    await vite.build({
      configFile: false,
      root: temp,
      logLevel: 'silent',
      plugins: [gameFiles()],
      resolve: { alias: { '@engine': join(ROOT, 'engine'), '@kits': join(ROOT, 'kits') } },
      build: {
        outDir,
        emptyOutDir: true,
        target: 'es2022',
        rollupOptions: { input: join(copy, 'index.html') },
      },
    });
    expect(existsSync(join(outDir, 'games/demo/index.html'))).toBe(true);
    const js = readdirSync(join(outDir, 'assets'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(outDir, 'assets', f), 'utf8'))
      .join('\n');
    // game.json goes into the bundle as text (virtual:game-files), and main.ts sizes the canvas from it.
    expect(js).toMatch(/width\\?"\s*:\s*320/);
  }, 120_000);

  it('lays the touch controls out around the new picture size', () => {
    const screen = ALT;
    for (const [width, height, dpr] of [
      [393, 852, 3],
      [852, 393, 3],
      [1180, 820, 2],
    ] as const) {
      const insets = { top: 0, right: 0, bottom: 0, left: 0 };
      const inp = { width, height, insets, dpr, integerScale: true, touch: true, touchScale: 1, screen };
      const l = layoutScreen(inp);
      const b = fitGame(screen, l.frame.w, l.frame.h, dpr, true, l.fit);
      expect(l.game.w).toBeCloseTo(b.dw / dpr, 6);
      expect(l.game.h).toBeCloseTo(b.dh / dpr, 6);
      expect(l.game.w / l.game.h).toBeCloseTo(320 / 240, 6);
      for (const id of CONTROL_IDS) expect(overlaps(l.rects[id], l.game), id).toBe(false);
      expect(layoutScreen({ ...inp, screen: { width: 256, height: 240 } }).game).not.toEqual(l.game);
    }
  });
});
