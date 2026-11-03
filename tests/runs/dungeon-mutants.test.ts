import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { main } from '../../engine/tools/main';

// The top-down kit is not strict, so `pnpm cli mutants` exits 0 even with weak or unguarded rules.
// The dungeon sample (Engine 0.15 T12) is where the kit's rules are mutant-checked as a finished
// game, so hold it to the strict standard here: every rule guarded by some run file (walk-east,
// escape, lost-in-the-guard-room), and no run weak on its own `guards`.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface GameMutants {
  runs: { run: string; baseline: { passed: boolean }; weak: string[] }[];
  unguarded: string[];
}

describe('dungeon mutants', () => {
  it('guards every kit rule, and no run is weak', async () => {
    let stdout = '';
    const code = await main(['mutants', 'games/samples/dungeon', '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
    });
    const result = JSON.parse(stdout) as GameMutants;
    expect(code).toBe(0);
    expect(result.unguarded).toEqual([]);
    for (const r of result.runs) {
      expect(r.baseline.passed, r.run).toBe(true);
      expect(r.weak, r.run).toEqual([]);
    }
  }, 120_000);
});
