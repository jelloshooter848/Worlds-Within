import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { main } from '../../engine/tools/main';

// The tower-defense kit is strict (Engine 0.12 T4), so `pnpm cli mutants` fails when a kit rule
// is unguarded. The sample games/samples/tower-defense is where its rules are guarded: run that
// check here so CI holds it, and require no run weak on its own `guards`. A switched-off rule
// usually changes a sync hash first, which stops the run without a failed check, so each run's
// sync hashes leave out the ticks a guarded rule's mutant reaches changed before a check fails.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface GameMutants {
  strict: boolean;
  runs: { run: string; baseline: { passed: boolean }; weak: string[] }[];
  rules: { id: string; guardedBy: string[] }[];
  unguarded: string[];
}

describe('tower-defense mutants', () => {
  it('guards every kit rule, and no run is weak', async () => {
    let stdout = '';
    const code = await main(['mutants', 'games/samples/tower-defense', '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
    });
    const result = JSON.parse(stdout) as GameMutants;
    expect(code).toBe(0);
    expect(result.strict).toBe(true);
    expect(result.unguarded).toEqual([]);
    expect(result.rules).toHaveLength(18);
    for (const r of result.runs) {
      expect(r.baseline.passed, r.run).toBe(true);
      expect(r.weak, r.run).toEqual([]);
    }
  }, 120_000);
});
