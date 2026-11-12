import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from '../../engine/tools/exit-codes';
import { main } from '../../engine/tools/main';
import { launchChromium, NoBrowserError } from '../../engine/tools/screenshot';

// The tower-defense sample's screenshots (Engine 0.12 T5): `pnpm cli screenshot` plays its run
// files through the view module (`view.ts`) in headless Chromium. Before any wave (the build run,
// tick 120: towers, the cursor and the ghost), a wave being fought (the won run at tick 1300) and
// the round lost (the lost run at tick 480; Engine 0.16 E8's 16:9 map). Each picture must match the headless run's state
// hashes and be byte-identical on a second run, and the three must differ. Skipped where Chromium
// is not installed (never in CI).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RUNS = 'games/samples/tower-defense/runs';
const temp = mkdtempSync(join(tmpdir(), 'ww-tower-defense-shots-'));
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
if (missing) console.warn(`skipping the tower-defense screenshots: ${missing}`);

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
  expect(result).toMatchObject({ width: 480, height: 270 });
  return result;
}

describe.skipIf(missing !== null)('the tower-defense sample through pnpm cli screenshot', () => {
  const sha: Record<string, unknown> = {};
  it.each([
    ['build', 120, 'towers before any wave'],
    ['won', 1300, 'a wave being fought'],
    ['lost', 480, 'the round lost'],
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
    expect(new Set(Object.values(sha)).size).toBe(3);
  });
});
