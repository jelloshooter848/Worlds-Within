import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { main } from '../../engine/tools/main';

// The RTS kit is not strict, so `pnpm cli mutants` exits 0 even with weak or unguarded rules.
// The skirmish sample is where the kit's rules are mutant-checked headless, so hold it to the
// strict standard here: every rule guarded by some run file, and no run weak on its own `guards`.
// A switched-off rule usually changes a sync hash first, which is not a failed check, so each
// guard needs an assertion or invariant that fails before the first changed hash.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

// The one exception, for now, is `enemy-knows-only-what-it-saw` (Engine 0.16 part D, D6): it only
// changes a plan with `knowledge: "fog"`, which this sample's raiders do not have yet; the full
// match (D8, D9) gives the sample a fog opponent and a run file guarding it, and empties this list.
const UNGUARDED = ['enemy-knows-only-what-it-saw'];

interface GameMutants {
  runs: { run: string; baseline: { passed: boolean }; weak: string[] }[];
  unguarded: string[];
}

describe('rts-skirmish mutants', () => {
  it('guards every kit rule but the listed one, and no run is weak', async () => {
    let stdout = '';
    const code = await main(['mutants', 'games/samples/rts-skirmish', '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
    });
    const result = JSON.parse(stdout) as GameMutants;
    expect(code).toBe(0);
    expect(result.unguarded).toEqual(UNGUARDED);
    for (const r of result.runs) {
      expect(r.baseline.passed, r.run).toBe(true);
      expect(r.weak, r.run).toEqual([]);
    }
  }, 120_000);
});
