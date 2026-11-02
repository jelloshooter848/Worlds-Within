import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson, type JsonValue } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { px, tileToSub } from '@engine/core/math/units';
import { levelSchema } from './level';
import { profileSchema } from './profile';
import { PLATFORMER_RULES } from './rules';
import { platformerGame, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld } from './world';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(fixture('runner.profile.json')));
const P = PROFILE.player;
const HALF_W = px(P.box.w) >> 1;

/** A level of the given rows, played with the fixture profile. */
function level(map: string[]) {
  return levelSchema.parse({ id: 'test', profile: 'runner', map });
}

type Script = { frame: number; hold: Action[] }[];

/** Plays `ticks` ticks of `script` on `map` with `disabled` rules off: the snapshot after each. */
function play(map: string[], script: Script, ticks: number, disabled: string[] = []): PlatformerSnapshot[] {
  const world = new PlatformerWorld(level(map), PROFILE, { seed: 7, disabledRules: disabled });
  const game = platformerGame(world);
  const input = new ScriptedInput({ steps: script });
  const out: PlatformerSnapshot[] = [];
  for (let i = 0; i < ticks; i++) {
    input.next();
    game.step(input);
    out.push(game.snapshot() as PlatformerSnapshot);
  }
  return out;
}

const last = <T>(a: T[]): T => a.at(-1) as T;
const minY = (snaps: PlatformerSnapshot[]) => Math.min(...snaps.map((s) => s.player.y));
const maxBy = (snaps: PlatformerSnapshot[], f: (s: PlatformerSnapshot) => number) =>
  Math.max(...snaps.map(f));
const events = (snaps: PlatformerSnapshot[], type: string) =>
  snaps.flatMap((s) => s.events).filter((e) => e.type === type);

/** A long flat floor, the start near the left edge (col 1, row 3; the floor top is at row 4). */
const FLAT = ['.'.repeat(60), '.'.repeat(60), '.'.repeat(60), `.@${'.'.repeat(56)}G.`, '#'.repeat(60)];
const FLOOR = tileToSub(4);
/** The start (col 1, row 1) over 12 rows of open air, then a floor (its top at row 14). */
const DROP = ['........', '.@.....G', ...Array.from({ length: 12 }, () => '........'), '########'];
/** The start in the air over a one-way platform (its top at row 4), with a floor below that. */
const LEDGE = ['........', '.@.....G', '........', '........', '========', '........', '########'];
/** The start under a one-way platform three tiles up (its top at row 1), floor top at row 4. */
const UNDER = ['........', '=======G', '........', '.@......', '########'];
/** A ceiling two tiles over the start's head (its underside at row 2), floor top at row 4. */
const LOW = ['........', '########', '........', '.@.....G', '########'];
/** A wall at col 6, four tiles right of the start. */
const WALL = ['......#.', '......#.', '......#G', '.@....#.', '########'];

const RIGHT: Script = [{ frame: 0, hold: ['right'] }];
const RUN_RIGHT: Script = [{ frame: 0, hold: ['right', 'run'] }];
/** A jump pressed on tick `at` and held for `hold` ticks. */
const jump = (hold: number, at = 1, also: Action[] = []): Script => [
  { frame: 0, hold: also },
  { frame: at, hold: [...also, 'jump'] },
  { frame: at + hold, hold: also },
];

/**
 * The kit tests, each a check that holds with every rule on. The mutant test below switches each
 * named rule off in turn and requires at least one of these to fail without it.
 */
const CASES: { name: string; holds: (off: string[]) => boolean }[] = [
  {
    name: 'standing still on the floor stays put',
    holds: (off) =>
      play(FLAT, [], 60, off).every(
        (s) => s.player.x === tileToSub(1) + tileToSub(1) / 2 && s.player.y === FLOOR && s.player.onGround,
      ),
  },
  {
    name: 'holding right accelerates from minWalk to the walk cap and stays there',
    holds: (off) => {
      const s = play(FLAT, RIGHT, 90, off);
      const vx = s.map((x) => x.player.vx);
      return vx[0] === P.minWalk && vx.every((v, i) => i === 0 || v >= vx[i - 1]!) && last(vx) === P.maxWalk;
    },
  },
  {
    name: 'holding right and run accelerates past the walk cap to the run cap',
    holds: (off) => {
      const s = play(FLAT, RUN_RIGHT, 90, off);
      return maxBy(s, (x) => x.player.vx) === P.maxRun && last(s).player.vx === P.maxRun;
    },
  },
  {
    name: 'the run cap lasts runHold ticks after run is let go, then slows to the walk cap',
    holds: (off) => {
      const s = play(FLAT, [...RUN_RIGHT, { frame: 80, hold: ['right'] }], 130, off);
      return s[80 + P.runHold - 2]!.player.vx === P.maxRun && last(s).player.vx === P.maxWalk;
    },
  },
  {
    name: 'letting go on the ground slows the player to a stop',
    holds: (off) => {
      const s = play(FLAT, [...RIGHT, { frame: 60, hold: [] }], 120, off);
      return (
        s[59]!.player.vx === P.maxWalk && last(s).player.vx === 0 && s[100]!.player.x === last(s).player.x
      );
    },
  },
  {
    name: 'holding the other way skids, then turns round at minWalk',
    holds: (off) => {
      const s = play(FLAT, [...RIGHT, { frame: 60, hold: ['left'] }], 90, off);
      const turn = s.findIndex((x) => x.player.vx < 0);
      return (
        s[60]!.player.skidding &&
        s[60]!.player.vx === P.maxWalk - P.skid &&
        turn > 60 &&
        s[turn]!.player.vx === -P.minWalk
      );
    },
  },
  {
    name: 'a tapped jump leaves the floor and lands back on it',
    holds: (off) => {
      const s = play(FLAT, jump(1), 80, off);
      return (
        events(s, 'jump').length === 1 &&
        s[1]!.player.vy < 0 &&
        minY(s) < FLOOR - tileToSub(1) &&
        events(s, 'land').length === 1 &&
        last(s).player.y === FLOOR
      );
    },
  },
  {
    name: 'a held jump goes higher than a tapped jump',
    holds: (off) => minY(play(FLAT, jump(40), 80, off)) < minY(play(FLAT, jump(1), 80, off)),
  },
  {
    name: 'a running jump takes off faster, on the last tier, and goes higher',
    holds: (off) => {
      const run = play(FLAT, [...RUN_RIGHT, { frame: 60, hold: ['right', 'run', 'jump'] }], 120, off);
      const stand = play(FLAT, jump(60), 120, off);
      const lift = (s: PlatformerSnapshot[]) => FLOOR - minY(s);
      return (
        events(run, 'jump')[0]?.tier === P.jumps.length - 1 &&
        run[60]!.player.vy === -P.jumps.at(-1)!.speed + P.jumps.at(-1)!.holdGravity &&
        lift(run) > lift(stand)
      );
    },
  },
  {
    name: 'the player steers in the air',
    holds: (off) => {
      const s = play(FLAT, [...jump(30), { frame: 3, hold: ['jump', 'right'] }], 20, off);
      return !last(s).player.onGround && last(s).player.x > s[1]!.player.x;
    },
  },
  {
    name: 'falling lands on a solid floor, never faster than the fall cap',
    holds: (off) => {
      const s = play(DROP, [], 80, off);
      return (
        last(s).player.onGround &&
        last(s).player.y === tileToSub(14) &&
        events(s, 'land').length === 1 &&
        maxBy(s, (x) => x.player.vy) <= P.maxFall
      );
    },
  },
  {
    name: 'falling onto a one-way platform lands on it',
    holds: (off) => {
      const s = play(LEDGE, [], 60, off);
      return last(s).player.onGround && last(s).player.y === tileToSub(4);
    },
  },
  {
    name: 'a jump passes up through a one-way platform and lands on top of it',
    holds: (off) => {
      const s = play(UNDER, jump(40), 80, off);
      return events(s, 'bump').length === 0 && last(s).player.onGround && last(s).player.y === tileToSub(1);
    },
  },
  {
    name: 'a head bump on a ceiling stops the rise at once',
    holds: (off) => {
      const s = play(LOW, jump(40), 60, off);
      const at = s.findIndex((x) => x.events.some((e) => e.type === 'bump'));
      return (
        at > 0 &&
        s[at]!.player.y - px(P.box.h) === tileToSub(2) &&
        s[at]!.player.vy > 0 &&
        last(s).player.y === tileToSub(4)
      );
    },
  },
  {
    name: 'walking into a wall stops against it',
    holds: (off) => {
      const s = play(WALL, RIGHT, 90, off);
      return last(s).player.x === tileToSub(6) - HALF_W && last(s).player.vx === 0 && last(s).player.onGround;
    },
  },
  {
    name: "the level's left edge holds the player in",
    holds: (off) => {
      const s = play(FLAT, [{ frame: 0, hold: ['left'] }], 60, off);
      return s.every((x) => x.player.x >= HALF_W) && last(s).player.x === HALF_W;
    },
  },
  {
    name: "the level's right edge holds the player in",
    holds: (off) => {
      const s = play(['.@..G.', '######'], RUN_RIGHT, 60, off);
      return last(s).player.x === tileToSub(6) - HALF_W && last(s).player.vx === 0;
    },
  },
];

describe('the platformer world', () => {
  for (const c of CASES) it(c.name, () => expect(c.holds([])).toBe(true));

  it('fails at least one kit test with each named rule switched off', () => {
    const weak = PLATFORMER_RULES.map((r) => r.id).filter((id) => CASES.every((c) => c.holds([id])));
    expect(weak).toEqual([]);
  });

  it('reports a fall into a pit and stops there', () => {
    const s = play(['.@..G', '#...#'], RIGHT, 80);
    expect(events(s, 'fell')).toHaveLength(1);
    expect(last(s).fell).toBe(true);
    expect(last(s).player).toEqual(s[s.findIndex((x) => x.fell)]!.player);
  });

  it('refuses a level that does not check, or a profile it is not played with', () => {
    expect(() => new PlatformerWorld(level(['.@..', '####']), PROFILE)).toThrow('no_goal');
    const other = { ...PROFILE, id: 'floaty' };
    expect(() => new PlatformerWorld(level(['.@.G', '####']), other)).toThrow('profile "runner"');
    expect(
      () => new PlatformerWorld(level(['.@.G', '####']), PROFILE, { disabledRules: ['flying'] }),
    ).toThrow('unknown rule');
  });
});

describe('platformerGame', () => {
  const tiny = () => {
    const header = JSON.parse(fixture('tiny.json'));
    return levelSchema.parse({ ...header, map: fixture('tiny.map.txt').trim().split('\n') });
  };
  /** Runs, walks, jumps and lets go on the fixture level: the canonical snapshot of every tick. */
  function trace(seed: number): string[] {
    const game = platformerGame(new PlatformerWorld(tiny(), PROFILE, { seed }));
    const input = new ScriptedInput({
      steps: [
        { frame: 0, hold: ['right'] },
        { frame: 20, hold: ['right', 'run'] },
        { frame: 50, hold: ['right', 'run', 'jump'] },
        { frame: 70, hold: ['right'] },
        { frame: 90, hold: ['left'] },
        { frame: 110, hold: ['jump'] },
        { frame: 120, hold: [] },
      ],
    });
    const out = [canonicalJson(game.snapshot())];
    for (let i = 0; i < 200; i++) {
      input.next();
      game.step(input);
      out.push(canonicalJson(game.snapshot()));
    }
    return out;
  }

  it('gives identical snapshots tick by tick for the same input and seed', () => {
    const a = trace(5);
    expect(a).toEqual(trace(5));
    expect(new Set(a).size).toBeGreaterThan(100); // the run really moves
  });

  it('keeps every number in the snapshot whole, positions and velocities included', () => {
    const numbers = (v: JsonValue): number[] =>
      typeof v === 'number'
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(numbers)
          : v !== null && typeof v === 'object'
            ? Object.values(v).flatMap(numbers)
            : [];
    for (const text of trace(5)) {
      const snap = JSON.parse(text) as PlatformerSnapshot;
      for (const k of ['x', 'y', 'vx', 'vy'] as const) expect(Number.isInteger(snap.player[k])).toBe(true);
      expect(numbers(snap).every(Number.isInteger)).toBe(true);
    }
  });

  it("lists each step's own events and starts with none", () => {
    const game = platformerGame(new PlatformerWorld(tiny(), PROFILE));
    expect(game.snapshot()).toMatchObject({ frame: 0, level: 'tiny', fell: false, events: [] });
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['jump'] }] });
    input.next();
    game.step(input);
    expect(game.snapshot().events).toEqual([{ type: 'jump', tier: 0 }]);
    input.next();
    game.step(input);
    expect(game.snapshot().events).toEqual([]);
  });
});
