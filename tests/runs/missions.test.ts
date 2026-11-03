import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { main } from '../../engine/tools/main';

// Engine 0.10's "Done when", through `pnpm cli run` on the mission fixtures in
// engine/sim/__fixtures__ (siege.world.json and its *.mission.json files): partial success,
// failure with no retry, an opportunity closing, construction finishing during a frozen battle,
// a delegated mission, and the fixed world-time cost (few or many experience ticks, played at once
// or at the last tick, give the same hashes from the commit tick on). Each passes twice with the
// same hashes, matching its golden <name>.hashes.json (also checked by run-files.test.ts).
//
// Engine 0.13 T3 adds the capture runs on captive.world.json (decision 2, item 221): a delegated
// `ambush` captures the captain and opens a rescue, an exchange and a leave-behind in one exclusive
// group; each run takes one (`capture-rescue`, `capture-exchange`, `capture-leave`), and
// `capture-rescue-failed` commits a failed rescue that opens a dearer ransom, never the rescue again.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DIR = 'engine/sim/__fixtures__';

interface Result {
  passed: boolean;
  hashes: { tick: number; hash: string }[];
  refusedMissions: { tick: number; mission: string; action: string; code: string }[];
  experience: { mission: string; ticks: number }[];
}

async function run(name: string): Promise<Result> {
  let stdout = '';
  const code = await main(['run', `${DIR}/${name}.run.json`, '--json'], {
    stdout: (t) => void (stdout += t),
    stderr: () => {},
    cwd: ROOT,
  });
  const result = JSON.parse(stdout) as Result;
  expect(code, stdout).toBe(0);
  return result;
}

const golden = (name: string) =>
  (JSON.parse(readFileSync(join(ROOT, DIR, `${name}.hashes.json`), 'utf8')) as Result).hashes;

const RUNS = [
  'raid-partial',
  'raid-failure',
  'opportunity-closing',
  'frozen-construction',
  'raid-delegated',
  'fixed-cost-few',
  'fixed-cost-many',
  'capture-rescue',
  'capture-rescue-failed',
  'capture-exchange',
  'capture-leave',
];

describe('Engine 0.10 done-when: mission run files', () => {
  it.each(RUNS)('%s passes twice with its golden hashes', async (name) => {
    const first = await run(name);
    const second = await run(name);
    expect(first.passed).toBe(true);
    expect(second.hashes).toEqual(first.hashes);
    expect(first.hashes).toEqual(golden(name));
  });

  it('failure has no retry: replaying, reopening and redelegating are refused', async () => {
    const { refusedMissions } = await run('raid-failure');
    expect(refusedMissions.map((r) => `${r.tick} ${r.action} ${r.mission} ${r.code}`)).toEqual([
      '10 play raid mission_resolved',
      '36 open raid mission_committed',
      '36 delegate raid mission_committed',
    ]);
  });

  it('an opportunity closes: taken by a rival mission, and by time', async () => {
    const { refusedMissions } = await run('opportunity-closing');
    expect(refusedMissions.map((r) => `${r.tick} ${r.mission} ${r.code}`)).toEqual([
      '13 convoy opportunity_closed',
      '30 scout opportunity_closed',
    ]);
  });

  it('a fixed world-time cost: few or many experience ticks give the same hashes from the commit on', async () => {
    const few = await run('fixed-cost-few');
    const many = await run('fixed-cost-many');
    expect(few.experience).toEqual([{ mission: 'raid', ticks: 1 }]);
    expect(many.experience).toEqual([{ mission: 'raid', ticks: 100_000 }]);
    const from = (r: Result, tick: number) => r.hashes.filter((h) => h.tick >= tick);
    const before = (r: Result) => r.hashes.filter((h) => h.tick > 5 && h.tick < 35);
    // Played at tick 5 or at tick 34, the commit lands at 35 (open tick 5 + worldTimeCost 30)...
    expect(from(many, 35)).toEqual(from(few, 35));
    expect(from(few, 35).length).toBeGreaterThan(1);
    // ...while the runs differ inside the mission (the outcome was chosen at different ticks).
    expect(before(many)).not.toEqual(before(few));
  });

  it('a capture: taking one follow-up closes the other two', async () => {
    const exchange = await run('capture-exchange');
    expect(exchange.refusedMissions.map((r) => `${r.tick} ${r.action} ${r.mission} ${r.code}`)).toEqual([
      '13 play exchange-captain not_playable',
      '13 quit exchange-captain not_playable',
      '13 open rescue-captain opportunity_closed',
      '14 open leave-captain opportunity_closed',
    ]);
    const leave = await run('capture-leave');
    expect(leave.refusedMissions.map((r) => `${r.tick} ${r.mission} ${r.code}`)).toEqual([
      '15 exchange-captain opportunity_closed',
      '15 rescue-captain opportunity_closed',
    ]);
    expect((await run('capture-rescue')).refusedMissions).toEqual([]);
  });

  it('a failed rescue is committed, never retried, and opens only the ransom it declares', async () => {
    const { refusedMissions } = await run('capture-rescue-failed');
    expect(refusedMissions.map((r) => `${r.tick} ${r.action} ${r.mission} ${r.code}`)).toEqual([
      '30 open rescue-captain mission_committed',
      '30 delegate rescue-captain mission_committed',
      '30 open exchange-captain opportunity_closed',
    ]);
  });

  it('the capture runs share their hashes up to the first follow-up', async () => {
    const runs = await Promise.all(
      ['capture-rescue', 'capture-rescue-failed', 'capture-exchange', 'capture-leave'].map(run),
    );
    const upTo = (r: Result) => r.hashes.filter((h) => h.tick <= 10);
    for (const r of runs) expect(upTo(r)).toEqual(upTo(runs[0] as Result));
  });
});
