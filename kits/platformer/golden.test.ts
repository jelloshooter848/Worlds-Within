import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { levelSchema } from './level';
import { profileSchema, type ProfileDef } from './profile';
import { PlatformerWorld } from './world';

/**
 * Golden traces: the kit against SMBC REMIX, tick by tick. Each trace in `__fixtures__/golden/`
 * was recorded from SMBC's headless runner on the same test map (its provenance and generator are
 * in that folder's README); here the kit replays each script on `flat.map.txt` with the fixture
 * profile and must give the same body x, y (top-left, sub-pixels) and vx, vy (1/4096 px per tick)
 * after every tick. Only committed JSON is read: SMBC is not needed to run this test.
 */

const read = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(read('runner.profile.json')));
const LEVEL = levelSchema.parse({
  ...JSON.parse(read('golden/flat.json')),
  map: read('golden/flat.map.txt').trimEnd().split('\n'),
});

/** The recorded scripts, in the order the README lists them. */
const SCRIPTS = ['walk-right', 'run-skid-release', 'tap-jump', 'hold-jump', 'run-jump-wall', 'jump-ceiling'];
const FIELDS = ['x', 'y', 'vx', 'vy'] as const;

interface Trace {
  script: string;
  /** SMBC's tiles (`#` solid, `.` empty): the kit's map without its `@` start and `G` goal. */
  map: string[];
  fields: string[];
  ticks: number;
  steps: { frame: number; hold: Action[] }[];
  trace: number[][];
}

const TRACES: Trace[] = SCRIPTS.map((name) => JSON.parse(read(`golden/${name}.trace.json`)) as Trace);

/** The kit's body after each tick of a trace's script, as rows of {@link FIELDS}. */
function replay(t: Trace, profile: ProfileDef): number[][] {
  const world = new PlatformerWorld(LEVEL, profile);
  const input = new ScriptedInput({ steps: t.steps });
  const out: number[][] = [];
  for (let i = 0; i < t.ticks; i++) {
    input.next();
    world.update(input);
    const b = world.player.body;
    out.push([b.x, b.y, b.vx, b.vy]);
  }
  return out;
}

/** The first tick where the kit differs from the trace, said in words; null when every tick matches. */
function firstDifference(t: Trace, kit: number[][]): string | null {
  for (let tick = 0; tick < t.trace.length; tick++) {
    const want = t.trace[tick] as number[];
    const got = kit[tick] as number[];
    const i = FIELDS.findIndex((_, f) => want[f] !== got[f]);
    if (i < 0) continue;
    const show = (row: number[]) => FIELDS.map((f, j) => `${f}=${row[j]}`).join(' ');
    return `${t.script}: first differs at tick ${tick} (${FIELDS[i]}): SMBC ${show(want)}, kit ${show(got)}`;
  }
  return null;
}

describe('golden traces against SMBC', () => {
  it('reads every recorded script, with the fields and length it says', () => {
    expect(TRACES.map((t) => t.script)).toEqual(SCRIPTS);
    for (const t of TRACES) {
      expect(t.fields).toEqual([...FIELDS]);
      expect(LEVEL.map.map((row) => row.replace(/[@G]/g, '.'))).toEqual(t.map);
      expect(t.trace).toHaveLength(t.ticks);
    }
  });

  for (const t of TRACES)
    it(`${t.script}: the kit matches SMBC at every tick`, () => {
      expect(firstDifference(t, replay(t, PROFILE))).toBeNull();
    });

  it('names the script and the first differing tick when a profile number changes', () => {
    const walk = TRACES[0] as Trace;
    const slower = { ...PROFILE, player: { ...PROFILE.player, walkAccel: PROFILE.player.walkAccel - 1 } };
    // Tick 0 starts at minWalk; tick 1 is the first to add walkAccel, tick 2 the first to move by it.
    expect(firstDifference(walk, replay(walk, slower))).toMatch(
      /^walk-right: first differs at tick 1 \(vx\)/,
    );
    // The running tier's take-off speed is first used by the jump pressed on tick 120.
    const run = TRACES[4] as Trace;
    const tiers = PROFILE.player.jumps.map((j, i, all) =>
      i === all.length - 1 ? { ...j, speed: j.speed + 16 } : j,
    );
    const higher = { ...PROFILE, player: { ...PROFILE.player, jumps: tiers } };
    expect(firstDifference(run, replay(run, higher))).toMatch(
      /^run-jump-wall: first differs at tick 120 \(y\)/,
    );
  });
});
