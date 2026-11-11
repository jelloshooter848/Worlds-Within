import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../engine/tools/exit-codes';
import { decodePng, type RgbaPicture } from '../../engine/tools/png-diff';
import { main } from '../../engine/tools/main';
import { launchChromium, NoBrowserError } from '../../engine/tools/screenshot';

// The mini siege's screenshots (Engine 0.11 T9): `pnpm cli screenshot` plays its run files,
// mission steps included, through the view module in headless Chromium. On both paths: the battle
// held during the freeze (delegated, world tick 80), the mission room mid-round (played, game tick
// 200), and the battle after the commit (delegated at 200, played at 600: world tick 194). Each
// picture must match the headless run's state hashes and be byte-identical on a second run, and
// the room and the battle must differ. Engine 0.12 T8 adds the preparation phase: the walls'
// tower-defense round mid-wave (fortify-played, game tick 90, its own skin) and the battle after a
// delegated fortify committed `overrun` (fortify-delegated, world tick 60: two walls gone).
// Engine 0.13 T8 adds the follow-up, started from its run's `from` as `pnpm cli run` starts it
// (gap M33): the dawn with the captain held (dawn-captured at 10: the captive marker in the HUD and
// the choices' offer) and with him on the map beside the sergeant (dawn-held at 30).
// Engine 0.16 F6: the picture is 320x180 (16:9), and the siege map in 3D low-poly
// (`--backend three`, the `three` skin at render scale 6: 1920x1080) is shot for the village held
// during the freeze, the dawn and the ridge camp, each byte-identical on a second run (SwiftShader
// allowed: the renderer is pinned, so the picture repeats on one machine).
// Engine 0.16 F8: the hosted rounds are drawn in 2D on the 3D page (the `three` skin's
// `rounds2d`), with the round packs (0x72's dungeon tiles, Kenney's tower defense): the rooms (the
// sabotage, and the rescue of dawn-rescue-played at 60) and the walls are shot in 2D and through
// `--backend three`, where a round's frame is the 2D picture scaled to 1920x1080; each
// byte-repeatable, and the 3D shot of a round is the 2D one scaled up.
// Engine 0.16 F9: the whole campaign in 3D, through `--backend three`: the siege before the
// sabotage, the freeze on the captured path, each path's siege end (the world its results screen
// lists) and the dawn at its start and its end, each matching the headless hashes and
// byte-identical on a second run.
// Skipped where Chromium is not installed (never in CI).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNS = 'games/samples/mini-siege/runs';
const temp = mkdtempSync(join(tmpdir(), 'ww-mini-siege-shots-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

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
if (missing) console.warn(`skipping the mini siege screenshots: ${missing}`);

/** Where `shot` writes its PNG. */
const shotPath = (run: string, tick: number, n: number, three = false) =>
  join(temp, `${run}-${tick}-${n}${three ? '-3d' : ''}.png`);

async function shot(run: string, tick: number, n: number, three = false): Promise<Record<string, unknown>> {
  let stdout = '';
  const code = await main(
    [
      'screenshot',
      `${RUNS}/${run}.run.json`,
      '--tick',
      String(tick),
      '--out',
      shotPath(run, tick, n, three),
      '--json',
      ...(three ? ['--backend', 'three', '--allow-software-gl'] : []),
    ],
    { stdout: (t) => void (stdout += t), stderr: () => {}, cwd: ROOT, outDir: join(temp, 'out') },
  );
  const result = JSON.parse(stdout) as Record<string, unknown>;
  expect(code, JSON.stringify(result)).toBe(EXIT.ok);
  expect(result.matchesHeadless).toBe(true);
  expect(result).toMatchObject(three ? { width: 1920, height: 1080 } : { width: 320, height: 180 });
  return result;
}

describe.skipIf(missing !== null)('the mini siege through pnpm cli screenshot', () => {
  const sha: Record<string, unknown> = {};
  it.each([
    ['delegated', 80, 'the battle held during the freeze'],
    ['played', 200, 'the mission room'],
    ['delegated', 200, 'the battle after a delegated commit'],
    ['played', 600, 'the battle after a played commit'],
    ['fortify-played', 90, "the walls' round"],
    ['fortify-delegated', 60, 'the battle after the walls were overrun'],
    ['dawn-captured', 10, 'the dawn with the captain held (the captive marker, the choices offered)'],
    ['dawn-held', 30, 'the dawn with the captain and the sergeant on the map'],
    ['dawn-rescue-played', 60, "the rescue's stockade"],
  ] as [string, number, string][])(
    '%s at tick %i (%s) is deterministic',
    async (run, tick) => {
      const first = await shot(run, tick, 1);
      const second = await shot(run, tick, 2);
      expect(second.sha256).toBe(first.sha256);
      sha[`${run}-${tick}`] = first.sha256;
    },
    120_000,
  );

  it('shows different pictures at each', () => {
    expect(new Set(Object.values(sha)).size).toBe(9);
  });
});

describe.skipIf(missing !== null)('the siege map in 3D low-poly (Engine 0.16 F6)', () => {
  const sha: Record<string, unknown> = {};
  it.each([
    ['delegated', 80, 'the village held during the freeze, late afternoon'],
    ['dawn-held', 30, 'the dawn assault, at dawn'],
    ['ridge-raid', 40, 'the ridge camp, in the morning'],
  ] as [string, number, string][])(
    '%s at tick %i (%s) is full HD and byte-repeatable',
    async (run, tick) => {
      const first = await shot(run, tick, 1, true);
      const second = await shot(run, tick, 2, true);
      expect(first).toMatchObject({ backend: 'three', renderScale: 6 });
      expect(second.sha256).toBe(first.sha256);
      sha[run] = first.sha256;
    },
    240_000,
  );

  it('shows a different picture for each map', () => {
    expect(new Set(Object.values(sha)).size).toBe(3);
  });
});

describe.skipIf(missing !== null)('the hosted rounds in 2D on the 3D page (Engine 0.16 F8)', () => {
  it.each([
    ['played', 200, 'the raiders’ camp'],
    ['dawn-rescue-played', 60, 'the stockade'],
    ['fortify-played', 90, 'the walls'],
  ] as [string, number, string][])(
    '%s at tick %i (%s) is the 2D round scaled to full HD, byte-repeatable',
    async (run, tick) => {
      const first = await shot(run, tick, 1, true);
      const second = await shot(run, tick, 2, true);
      expect(second.sha256).toBe(first.sha256);
      await shot(run, tick, 3);
      const big = decodePng(readFileSync(shotPath(run, tick, 1, true)));
      const small = decodePng(readFileSync(shotPath(run, tick, 3)));
      // Every 3D picture px is the 2D picture px it scales (nearest neighbour, six times).
      for (const [x, y] of [
        [10, 10],
        [160, 90],
        [300, 170],
        [77, 123],
      ] as const) {
        const at = (img: RgbaPicture, px: number, py: number) => [
          ...img.rgba.subarray((py * img.width + px) * 4, (py * img.width + px) * 4 + 4),
        ];
        // Within 3 per channel: a translucent fill may round one step apart between the two runs.
        const a = at(big, x * 6 + 3, y * 6 + 3);
        const b = at(small, x, y);
        expect(
          Math.max(...a.map((v, i) => Math.abs(v - b[i]!))),
          `${x},${y}: ${a} vs ${b}`,
        ).toBeLessThanOrEqual(3);
      }
    },
    240_000,
  );
});

describe.skipIf(missing !== null)('the whole campaign in 3D (Engine 0.16 F9)', () => {
  const sha: Record<string, unknown> = {};
  it.each([
    ['delegated', 20, 'the siege before the sabotage, its mission offered'],
    ['quit', 100, 'the freeze on the captured path: the round given up, the raid still open'],
    ['delegated', 260, "the siege's end on the delegated path: the ram burnt (what its results show)"],
    ['quit', 261, "the siege's end on the captured path: the captain taken"],
    ['dawn-captured', 10, 'the dawn with the captain held, night giving way'],
    ['dawn-held', 200, "the dawn's end with the captain on the map"],
  ] as [string, number, string][])(
    '%s at tick %i (%s) matches the headless hashes and is byte-identical twice',
    async (run, tick) => {
      const first = await shot(run, tick, 1, true);
      const second = await shot(run, tick, 2, true);
      expect(first).toMatchObject({ backend: 'three', renderScale: 6 });
      expect(second.sha256).toBe(first.sha256);
      sha[`${run}-${tick}`] = first.sha256;
    },
    240_000,
  );

  it('shows a different picture at each', () => {
    expect(new Set(Object.values(sha)).size).toBe(6);
  });
});
