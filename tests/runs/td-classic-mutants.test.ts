import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { main } from '../../engine/tools/main';

// The tower-defense kit is strict (Engine 0.12 T4), so `pnpm cli mutants` fails when a kit rule
// is unguarded. The 0.15 Winding Road, kept unchanged as games/td-classic in Engine 0.16 part E
// (E2), guards the kit's rules headless with five run files that never move: run that check here
// so CI holds it, and require no run weak on its own `guards`.
//
// Rules the kit gains later (part E's tower upgrades, splash and slow towers, E3 and E4) only
// change rounds with that content, which the classic road has none of, so no run file here can
// guard them without moving its frozen hashes; the sample's new runs and the kit's tests guard
// them. List each such rule in UNGUARDED (as rts-classic's test does, item 520) rather than
// re-record a run here.
const UNGUARDED: string[] = [];

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

interface GameMutants {
  strict: boolean;
  runs: { run: string; baseline: { passed: boolean }; weak: string[] }[];
  unguarded: string[];
}

describe('td-classic mutants', () => {
  it('guards every kit rule but the listed ones, and no run is weak', async () => {
    let stdout = '';
    const code = await main(['mutants', 'games/td-classic', '--json'], {
      stdout: (t) => void (stdout += t),
      stderr: () => {},
      cwd: ROOT,
    });
    const result = JSON.parse(stdout) as GameMutants;
    expect(result.strict).toBe(true);
    expect(result.unguarded).toEqual(UNGUARDED);
    // A strict kit's mutants exit 4 on any unguarded rule, listed or not.
    expect(code).toBe(UNGUARDED.length === 0 ? 0 : 4);
    for (const r of result.runs) {
      expect(r.baseline.passed, r.run).toBe(true);
      expect(r.weak, r.run).toEqual([]);
    }
  }, 120_000);
});
