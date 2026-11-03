import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playRun } from '../../engine/tools/headless-run';

// Engine 0.14 (gap G12, decision 8): a game on several kits routes each kit's switched-off rules
// (`kit:id` in a run file or `--disable-rule`) to that kit's round only. The mini siege hosts a
// tower-defense round (`fortify`) over an RTS battle: a tower-defense rule off changes the round,
// a top-down rule off changes nothing in a run that never plays the top-down round.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FORTIFY = 'games/samples/mini-siege/runs/fortify-played.run.json';
const golden = JSON.parse(
  readFileSync(
    new URL('../../games/samples/mini-siege/runs/fortify-played.hashes.json', import.meta.url),
    'utf8',
  ),
) as { hashes: unknown };

describe("per-kit rules in the mini siege's rounds", () => {
  it('fails fortify-played with towerdefense:win-on-clear off (the run guards it)', async () => {
    const played = await playRun(ROOT, FORTIFY, { disableRules: ['towerdefense:win-on-clear'] });
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    expect(played.value.disabledRules).toEqual(['towerdefense:win-on-clear']);
    expect(played.value.disabledRulesByKit).toEqual({
      rts: [],
      topdown: [],
      towerdefense: ['win-on-clear'],
    });
    expect(played.value.failures).not.toEqual([]);
  });

  it('plays fortify-played unchanged with a top-down rule off: no top-down round is hosted', async () => {
    const played = await playRun(ROOT, FORTIFY, { disableRules: ['topdown:walls-block-movement'] });
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    expect(played.value.failures).toEqual([]);
    expect(played.value.hashMismatch).toBeNull();
    expect(played.value.hashes).toEqual(golden.hashes);
  });
});
