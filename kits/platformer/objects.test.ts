import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { px, tileToSub } from '@engine/core/math/units';
import { CELL_COLLISION, LEGEND } from './legend';
import { levelSchema } from './level';
import { profileSchema, type ProfileDef } from './profile';
import { BOSS_RULES, MINI_GAME_RULES, MOVEMENT_RULES, OBJECT_RULES, PLATFORMER_RULES } from './rules';
import { platformerGame, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld } from './world';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(fixture('runner.profile.json')));
const P = PROFILE.player;
const HALF_W = px(P.box.w) >> 1;

/** The fixture profile with some player numbers or actor types changed. */
function profileWith(player: Partial<ProfileDef['player']>, actors: ProfileDef['actors'] = {}): ProfileDef {
  return { ...PROFILE, player: { ...P, ...player }, actors: { ...PROFILE.actors, ...actors } };
}

type Script = { frame: number; hold: Action[] }[];

interface Setup {
  map: string[];
  script?: Script;
  ticks: number;
  header?: Record<string, unknown>;
  profile?: ProfileDef;
}

/** Plays a setup with `off` rules switched off: the snapshot after each tick. */
function play(s: Setup, off: string[] = []): PlatformerSnapshot[] {
  const level = levelSchema.parse({ id: 'test', profile: 'runner', ...s.header, map: s.map });
  const world = new PlatformerWorld(level, s.profile ?? PROFILE, { seed: 3, disabledRules: off });
  const game = platformerGame(world);
  const input = new ScriptedInput({ steps: s.script ?? [] });
  const out: PlatformerSnapshot[] = [];
  for (let i = 0; i < s.ticks; i++) {
    input.next();
    game.step(input);
    out.push(game.snapshot() as PlatformerSnapshot);
  }
  return out;
}

const last = <T>(a: T[]): T => a.at(-1) as T;
const events = (snaps: PlatformerSnapshot[], type: string) =>
  snaps.flatMap((s) => s.events).filter((e) => e.type === type);

const RIGHT: Script = [{ frame: 0, hold: ['right'] }];
const RUN_RIGHT: Script = [{ frame: 0, hold: ['right', 'run'] }];
/** A held jump from tick 2 (the first tick the player can jump on). */
const JUMP: Script = [
  { frame: 2, hold: ['jump'] },
  { frame: 30, hold: [] },
];
const W = { w: { actor: 'walker' } };

/** A coin two tiles right of the start, on the player's row. */
const COIN = { map: ['.......G', '.@.o....', '########'], script: RIGHT, ticks: 40 };
/** A bump block two tiles over the player's head; jumped at twice. */
const BLOCK = {
  map: ['.......G', '.?......', '........', '.@......', '########'],
  script: [...JUMP, { frame: 60, hold: ['jump'] }, { frame: 80, hold: [] }] as Script,
  ticks: 120,
};
const BRICK = { ...BLOCK, map: ['.......G', '.B......', '........', '.@......', '########'] };
const HAZARD = { map: ['.......G', '.@..^...', '########'], script: RIGHT, ticks: 60 };
const PIT = { map: ['.......G', '.@......', '###..###'], script: RIGHT, ticks: 80 };
const GOAL = { map: ['........', '.@..G...', '########'], script: RIGHT, ticks: 60 };
/** A checkpoint two tiles right of the start, then a hazard: two lives, so the death respawns. */
const CHECKPOINT = {
  map: ['.........G', '.@.K..^...', '##########'],
  script: [...RIGHT, { frame: 70, hold: [] }] as Script,
  ticks: 90,
  profile: profileWith({ lives: 2 }),
};
/** A long level, scrolling right: run right, then walk back left. */
const LONG = {
  map: ['.'.repeat(60), `.@${'.'.repeat(57)}G`, '#'.repeat(60)],
  script: [...RUN_RIGHT, { frame: 90, hold: ['left'] }] as Script,
  ticks: 240,
};
/** A walker 40 tiles away from a player who stands still. */
const FAR = {
  map: ['.'.repeat(50), `.@G${'.'.repeat(37)}w${'.'.repeat(9)}`, '#'.repeat(50)],
  header: { spawns: W },
  ticks: 60,
};
/** A walker between two walls, walking left, the player far away behind the right wall. */
const PEN = { map: ['#.....#.....', '#..w..#..@.G', '############'], header: { spawns: W }, ticks: 150 };
/** A walker that turns at ledges, on an island between two pits. */
const LEDGE = {
  map: ['............', '.....w...@.G', '...####..###'],
  header: { spawns: W },
  profile: profileWith({}, { walker: { ...PROFILE.actors['walker']!, turnAt: 'ledges' } }),
  ticks: 150,
};
/** The player falls from high up onto a shell-walker under the start. */
const STOMP = {
  map: ['.......G', '.@......', '........', '........', '........', '.k......', '########'],
  header: { spawns: { k: { actor: 'shell-walker' } } },
  ticks: 40,
};
/** A still shell two tiles right of the start and a walker coming the other way. */
const KICK = {
  map: ['..............G', '.@..s.......w..', '###############'],
  header: { spawns: { s: { actor: 'shell' }, ...W } },
  script: RIGHT,
  ticks: 90,
};
/** A walker coming at a player who stands still. */
const TOUCH = { map: ['.......G', '.@...w..', '########'], header: { spawns: W }, ticks: 200 };

const stompTick = (s: PlatformerSnapshot[]) => s.findIndex((x) => x.events.some((e) => e.type === 'stomp'));

/**
 * The level object and enemy tests, each a check that holds with every rule on. The mutant test
 * below switches each object rule off in turn and requires at least one of these to fail without
 * it (`world.test.ts` does the same for the movement rules).
 */
const CASES: { name: string; holds: (off: string[]) => boolean }[] = [
  {
    name: 'walking through a coin takes it and counts it',
    holds: (off) => {
      const s = play(COIN, off);
      return (
        last(s).coins === 1 &&
        events(s, 'coin').length === 1 &&
        canonicalJson(last(s).tiles) === canonicalJson([{ col: 3, row: 1, cell: 'empty' }])
      );
    },
  },
  {
    name: 'a bump block gives its coin once and is used',
    holds: (off) => {
      const s = play(BLOCK, off);
      return (
        events(s, 'bump').length === 2 &&
        events(s, 'block').length === 1 &&
        last(s).coins === 1 &&
        canonicalJson(last(s).tiles) === canonicalJson([{ col: 1, row: 1, cell: 'used' }])
      );
    },
  },
  {
    name: 'a player with breakBricksAt hit points breaks a brick, and jumps through its place',
    holds: (off) => {
      const s = play(BRICK, off);
      return events(s, 'break').length === 1 && events(s, 'bump').length === 1 && last(s).tiles.length === 1;
    },
  },
  {
    name: 'walking into a hazard kills',
    holds: (off) => {
      const s = play(HAZARD, off);
      return last(s).outcome === 'failed' && events(s, 'died')[0]?.cause === 'hazard';
    },
  },
  {
    name: 'falling into a gap kills',
    holds: (off) => {
      const s = play(PIT, off);
      return last(s).outcome === 'failed' && events(s, 'died')[0]?.cause === 'pit';
    },
  },
  {
    name: 'reaching the goal clears the level, and the world stops there',
    holds: (off) => {
      const s = play(GOAL, off);
      const at = s.findIndex((x) => x.outcome === 'cleared');
      return at > 0 && events(s, 'cleared').length === 1 && last(s).player.x === s[at]!.player.x;
    },
  },
  {
    name: 'scrolling right, the view never goes back and its left edge holds the player in',
    holds: (off) => {
      const s = play(LONG, off);
      return (
        last(s).scrollX > 0 &&
        s.every((x, i) => i === 0 || x.scrollX >= s[i - 1]!.scrollX) &&
        last(s).player.x === last(s).scrollX + HALF_W
      );
    },
  },
  {
    name: 'an actor far from the view waits',
    holds: (off) => {
      const s = play(FAR, off);
      return s.every((x) => !x.actors[0]!.active && x.actors[0]!.x === s[0]!.actors[0]!.x);
    },
  },
  {
    name: 'a walker turns round at a wall',
    holds: (off) => {
      const s = play(PEN, off);
      return s.some((x) => x.actors[0]!.dir === 1) && last(s).actors[0]!.vx !== 0;
    },
  },
  {
    name: 'a walker that turns at ledges stays out of the pit',
    holds: (off) => {
      const s = play(LEDGE, off);
      return last(s).actors.length === 1 && s.some((x) => x.actors[0]?.dir === 1);
    },
  },
  {
    name: 'a stomp turns a shell-walker into a still shell',
    holds: (off) => {
      const s = play(STOMP, off);
      const at = stompTick(s);
      const a = s[at]?.actors[0];
      return (
        at > 0 &&
        s[at]!.events.some((e) => e.type === 'stomp' && e.into === 'shell') &&
        a?.type === 'shell' &&
        a.speed === 0 &&
        events(s, 'hurt').length === 0
      );
    },
  },
  {
    name: 'a stomp bounces the player up',
    holds: (off) => {
      const s = play(STOMP, off);
      const at = stompTick(s);
      return at > 0 && s[at]!.player.vy === -P.stompBounce && !s[at]!.player.onGround;
    },
  },
  {
    name: 'touching a still shell kicks it away at its kickSpeed',
    holds: (off) => {
      const s = play({ ...KICK, ticks: 50 }, off);
      const shell = last(s).actors.find((a) => a.type === 'shell');
      return (
        events(s, 'kick').length === 1 &&
        shell?.speed === PROFILE.actors['shell']!.kickSpeed &&
        shell?.dir === 1 &&
        events(s, 'hurt').length === 0
      );
    },
  },
  {
    name: 'a kicked shell defeats a walker it hits',
    holds: (off) => {
      const s = play(KICK, off);
      return (
        events(s, 'defeat').length === 1 && last(s).actors.length === 1 && last(s).actors[0]!.type === 'shell'
      );
    },
  },
  {
    name: 'a walker that touches the player takes a hit point, once',
    holds: (off) => {
      const s = play(TOUCH, off);
      return events(s, 'hurt').length === 1 && last(s).player.hp === P.hp - 1;
    },
  },
  {
    name: 'a death after touching a checkpoint respawns the player on it',
    holds: (off) => {
      const s = play(CHECKPOINT, off);
      const at = s.findIndex((x) => x.events.some((e) => e.type === 'respawn'));
      return (
        events(s, 'checkpoint').length === 1 &&
        at > 0 &&
        s[at]!.player.x === tileToSub(3) + tileToSub(1) / 2 &&
        s[at]!.checkpoint?.col === 3
      );
    },
  },
  {
    name: 'after a hit the player is invulnerable and survives the touch',
    holds: (off) => {
      const s = play(TOUCH, off);
      const at = s.findIndex((x) => x.events.some((e) => e.type === 'hurt'));
      return at > 0 && s[at]!.player.invuln === P.invulnTicks && last(s).outcome === 'playing';
    },
  },
];

describe('the platformer world: level objects and enemies', () => {
  for (const c of CASES) it(c.name, () => expect(c.holds([])).toBe(true));

  it('fails at least one kit test with each object rule switched off', () => {
    const weak = OBJECT_RULES.map((r) => r.id).filter((id) => CASES.every((c) => c.holds([id])));
    expect(weak).toEqual([]);
  });

  it('names every kit rule once: movement rules, then object rules, then mini game rules, then boss rules', () => {
    expect(PLATFORMER_RULES.map((r) => r.id)).toEqual(
      [...MOVEMENT_RULES, ...OBJECT_RULES, ...MINI_GAME_RULES, ...BOSS_RULES].map((r) => r.id),
    );
  });

  it('gives every cell kind the collision the legend gives it', () => {
    for (const e of Object.values(LEGEND)) expect(CELL_COLLISION[e.cell]).toBe(e.collision);
  });

  it('breaks no brick for a player under breakBricksAt hit points', () => {
    const s = play({ ...BRICK, profile: profileWith({ hp: 1 }) });
    expect(events(s, 'bump')).toHaveLength(2);
    expect(events(s, 'break')).toEqual([]);
    expect(last(s).tiles).toEqual([]);
  });

  it('gives a power-up (up to maxHp), a life, an actor or ten coins from a bump block', () => {
    const blocks = (b: string, profile = PROFILE) => play({ ...BLOCK, header: { blocks: [b] }, profile });
    expect(last(blocks('powerup', profileWith({ hp: 1 }))).player.hp).toBe(2);
    expect(last(blocks('powerup')).player.hp).toBe(2);
    expect(last(blocks('life')).lives).toBe(P.lives + 1);
    const spawned = blocks('actor:walker');
    expect(events(spawned, 'spawn')).toEqual([{ type: 'spawn', actor: 1, actorType: 'walker' }]);
    const many = { ...BLOCK, header: { blocks: ['coins'] }, ticks: 600 };
    many.script = Array.from({ length: 12 }, (_, i) => [
      { frame: 2 + i * 45, hold: ['jump'] as Action[] },
      { frame: 22 + i * 45, hold: [] },
    ]).flat();
    const s = play(many);
    expect(events(s, 'block')).toHaveLength(10);
    expect(last(s).coins).toBe(10);
    expect(last(s).tiles).toEqual([{ col: 1, row: 1, cell: 'used' }]);
  });

  it('starts the player again at the start after a death with lives left', () => {
    const s = play({ ...PIT, profile: profileWith({ lives: 2 }) });
    const at = s.findIndex((x) => x.events.some((e) => e.type === 'respawn'));
    expect(events(s, 'died')).toEqual([{ type: 'died', cause: 'pit', lives: 1 }]);
    expect(at).toBeGreaterThan(0);
    expect(s[at]!.player).toMatchObject({ x: tileToSub(1) + tileToSub(1) / 2, hp: P.hp });
    expect(s[at]!.outcome).toBe('playing');
  });

  it('records the checkpoint touched last, once per touch, and keeps coins and tiles on a respawn', () => {
    const map = ['...........G', '.@K.o.K.^...', '############'];
    const s = play({ ...CHECKPOINT, map, ticks: 120 });
    expect(events(s, 'checkpoint')).toEqual([
      { type: 'checkpoint', col: 2, row: 1 },
      { type: 'checkpoint', col: 6, row: 1 },
    ]);
    const at = s.findIndex((x) => x.events.some((e) => e.type === 'respawn'));
    expect(s[at]!.checkpoint).toEqual({ col: 6, row: 1 });
    expect(s[at]!.player).toMatchObject({ x: tileToSub(6) + tileToSub(1) / 2, y: tileToSub(2) });
    expect(s[at]).toMatchObject({ coins: 1, lives: 1, tiles: [{ col: 4, row: 1, cell: 'empty' }] });
    // Standing on the checkpoint it respawned on is no new touch.
    expect(
      s
        .slice(at)
        .flatMap((x) => x.events)
        .filter((e) => e.type === 'checkpoint'),
    ).toEqual([]);
  });

  it('snapshots the checkpoint only in a level that has one', () => {
    expect(play(CHECKPOINT)[0]).toHaveProperty('checkpoint', null);
    expect(play(GOAL)[0]).not.toHaveProperty('checkpoint');
  });

  it('dies of a harm at no hit points left', () => {
    const s = play({ ...TOUCH, profile: profileWith({ hp: 1 }) });
    expect(events(s, 'died')).toEqual([{ type: 'died', cause: 'hurt', lives: 0 }]);
    expect(last(s).outcome).toBe('failed');
  });

  it('scrolls both ways when the scroll mode is free, and never with none', () => {
    const free = play({ ...LONG, header: { scroll: 'free' } });
    expect(Math.max(...free.map((x) => x.scrollX))).toBeGreaterThan(last(free).scrollX);
    expect(last(free).player.x).toBeLessThan(last(free).scrollX + HALF_W + px(128));
    expect(play({ ...LONG, header: { scroll: 'none' } }).every((x) => x.scrollX === 0)).toBe(true);
  });
});

describe('the fixture level', () => {
  const tiny = () => {
    const header = JSON.parse(fixture('tiny.json'));
    return levelSchema.parse({ ...header, map: fixture('tiny.map.txt').trim().split('\n') });
  };
  /**
   * Walks right, jumps into the bump block, jumps the gap (the walker has walked into it), jumps
   * onto the step for the coin and walks on to the goal.
   */
  const SCRIPT: Script = [
    { frame: 0, hold: ['right'] },
    { frame: 72, hold: ['right', 'jump'] },
    { frame: 90, hold: ['right'] },
    { frame: 96, hold: ['right', 'jump'] },
    { frame: 125, hold: ['right'] },
    { frame: 160, hold: ['right', 'jump'] },
    { frame: 175, hold: ['right'] },
  ];
  function run(): { hashes: string[]; snaps: PlatformerSnapshot[] } {
    const game = platformerGame(new PlatformerWorld(tiny(), PROFILE, { seed: 1 }));
    const input = new ScriptedInput({ steps: SCRIPT });
    const snaps: PlatformerSnapshot[] = [];
    for (let i = 0; i < 400 && snaps.at(-1)?.outcome !== 'cleared'; i++) {
      input.next();
      game.step(input);
      snaps.push(game.snapshot() as PlatformerSnapshot);
    }
    return { hashes: snaps.map((s) => canonicalJson(s)), snaps };
  }

  it('is played from start to goal with a scripted input: cleared, with both coins', () => {
    const { snaps } = run();
    expect(last(snaps).outcome).toBe('cleared');
    expect(last(snaps).coins).toBe(2);
    expect(events(snaps, 'block')).toEqual([{ type: 'block', col: 7, row: 3, content: 'coin' }]);
    expect(events(snaps, 'hurt')).toEqual([]);
  });

  it('gives the same snapshots on two runs', () => {
    expect(run().hashes).toEqual(run().hashes);
  });
});
