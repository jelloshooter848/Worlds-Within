import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../engine/tools/exit-codes';
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

async function shot(run: string, tick: number, n: number): Promise<Record<string, unknown>> {
  let stdout = '';
  const code = await main(
    [
      'screenshot',
      `${RUNS}/${run}.run.json`,
      '--tick',
      String(tick),
      '--out',
      join(temp, `${run}-${tick}-${n}.png`),
      '--json',
    ],
    { stdout: (t) => void (stdout += t), stderr: () => {}, cwd: ROOT, outDir: join(temp, 'out') },
  );
  const result = JSON.parse(stdout) as Record<string, unknown>;
  expect(code, JSON.stringify(result)).toBe(EXIT.ok);
  expect(result.matchesHeadless).toBe(true);
  expect(result).toMatchObject({ width: 256, height: 240 });
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
    expect(new Set(Object.values(sha)).size).toBe(6);
  });
});
