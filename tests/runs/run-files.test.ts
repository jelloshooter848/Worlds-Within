import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../engine/tools/main';

// Every game's run files (games/**/runs/*.run.json), and the engine's world run files
// (engine/**/__fixtures__/*.run.json, Engine 0.8), through `pnpm cli run`, as CI sees them: each
// must pass, give the same state hashes twice in a row, and match its committed golden file
// (<name>.hashes.json next to it). After a change that is meant to change the state, regenerate
// the golden files with `WW_UPDATE_GOLDEN=1 pnpm test tests/runs` and commit them.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const UPDATE = process.env.WW_UPDATE_GOLDEN === '1';

/** Every run file in a `folder` folder under `dir` (`runs` in games/), as repo paths. */
function runFiles(dir: string, folder: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name !== 'node_modules') out.push(...runFiles(path, folder));
    } else if (e.name.endsWith('.run.json') && dir.endsWith(`/${folder}`)) out.push(path);
  }
  return out.sort();
}

async function run(file: string): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const code = await main(['run', file, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
  });
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

const files = [...runFiles('games', 'runs'), ...runFiles('engine', '__fixtures__')];

describe('run files', () => {
  it('finds the demo run', () => {
    expect(files).toContain('games/demo/runs/walk-east.run.json');
  });

  it('finds the sample world run', () => {
    expect(files).toContain('engine/sim/__fixtures__/village-build.run.json');
  });

  it('finds the recorded battle (an rts world with orders and sync hashes)', () => {
    expect(files).toContain('engine/sim/__fixtures__/battle.run.json');
  });

  it.each(files)('%s passes, twice with the same hashes, matching its golden file', async (file) => {
    const first = await run(file);
    expect(
      first.result.failure ?? null,
      JSON.stringify(first.result.errors ?? first.result.failure),
    ).toBeNull();
    expect(first.code).toBe(0);
    const second = await run(file);
    expect(second.result.hashes).toEqual(first.result.hashes);

    const golden = file.replace(/\.run\.json$/, '.hashes.json');
    const expected = { run: file, hashes: first.result.hashes };
    if (UPDATE) writeFileSync(join(ROOT, golden), `${JSON.stringify(expected, null, 2)}\n`);
    expect(
      existsSync(join(ROOT, golden)),
      `${golden} is missing: run WW_UPDATE_GOLDEN=1 pnpm test tests/runs`,
    ).toBe(true);
    expect(JSON.parse(readFileSync(join(ROOT, golden), 'utf8'))).toEqual(expected);
  });
});
