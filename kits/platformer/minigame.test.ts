import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { tileToSub } from '@engine/core/math/units';
import type { MiniGameDef, MiniGameResult } from '@engine/core/minigame';
import { levelSchema } from './level';
import { profileSchema } from './profile';
import { MINI_GAME_RULES } from './rules';
import { platformerGame, type PlatformerSnapshot } from './snapshot';
import { PlatformerWorld } from './world';

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8');
const PROFILE = profileSchema.parse(JSON.parse(fixture('runner.profile.json')));

/**
 * A test-only mini game: passes after `params.ticks` ticks (3 by default) of holding attack,
 * fails on left and quits on select. Its snapshot holds its count and the seed it was given.
 */
const HOLD: MiniGameDef = {
  id: 'hold',
  title: 'HOLD ON',
  create(ctx, seed) {
    const need = typeof ctx.params['ticks'] === 'number' ? ctx.params['ticks'] : 3;
    let held = 0;
    let result: MiniGameResult | null = null;
    return {
      step(input) {
        if (input.held('left')) result = 'fail';
        else if (input.held('select')) result = 'quit';
        else if (input.held('attack') && ++held >= need) result = 'pass';
      },
      snapshot: () => ({ held, need, seed, attempt: ctx.attempt }),
      result: () => result,
    };
  },
};

/** A trigger two tiles right of the start; a wall at col 5 the pass opens; the goal behind it. */
const MAP = ['........', '.@.!.#.G', '########'];
const TRIGGER = {
  game: 'hold',
  params: { ticks: 5 },
  pass: ['coins:3', 'open:5:1'],
  fail: ['respawn'],
};
const TRIGGER_X = tileToSub(3) + tileToSub(1) / 2;

/**
 * Plays the level with `off` rules switched off. `hold(snapshot)` picks the held actions for each
 * tick from the snapshot before it (null before the first tick): the snapshot after each tick.
 */
function play(
  hold: (s: PlatformerSnapshot | null) => Action[],
  ticks: number,
  off: string[] = [],
  seed = 3,
): PlatformerSnapshot[] {
  const level = levelSchema.parse({ id: 'test', profile: 'runner', triggers: [TRIGGER], map: MAP });
  const world = new PlatformerWorld(level, PROFILE, { seed, disabledRules: off, miniGames: [HOLD] });
  const game = platformerGame(world);
  const input = new ScriptedInput({ steps: [] });
  const out: PlatformerSnapshot[] = [];
  for (let i = 0; i < ticks; i++) {
    input.setHeld(hold(out.at(-1) ?? null));
    input.next();
    game.step(input);
    out.push(game.snapshot() as PlatformerSnapshot);
  }
  return out;
}

const events = (snaps: PlatformerSnapshot[], type: string) =>
  snaps.flatMap((s) => s.events).filter((e) => e.type === type);
const startTick = (s: PlatformerSnapshot[]) => s.findIndex((x) => x.miniGame !== null);
const endTick = (s: PlatformerSnapshot[]) =>
  s.findIndex((x) => x.events.some((e) => e.type === 'mini-game-end'));

/** Right and attack (run) all along: the round passes after 5 ticks of attack. */
const RUN = () => ['right', 'attack'] as Action[];
/** Right, then left once the round is on: it fails. */
const FAIL = (s: PlatformerSnapshot | null) => (s?.miniGame ? ['left'] : ['right']) as Action[];
/** Right, then select once the round is on: the player quits. */
const QUIT = (s: PlatformerSnapshot | null) => (s?.miniGame ? ['select'] : ['right']) as Action[];

const CASES: { name: string; holds: (off: string[]) => boolean }[] = [
  {
    name: 'touching the trigger pauses the level for the round; a pass applies its outcome and the level goes on',
    holds: (off) => {
      const s = play(RUN, 120, off);
      const at = startTick(s);
      const end = endTick(s);
      if (at < 0 || end !== at + 5) return false;
      const paused = s.slice(at, end + 1);
      return (
        events(s, 'mini-game').length === 1 &&
        paused.every((x) => canonicalJson(x.player) === canonicalJson(s[at]!.player)) &&
        paused.every((x) => x.scrollX === s[at]!.scrollX) &&
        s[end - 1]!.miniGame?.state['held'] === 4 &&
        s[end]!.miniGame === null &&
        s[end]!.events.some((e) => e.type === 'mini-game-end' && e.result === 'pass') &&
        s[end]!.coins === 3 &&
        canonicalJson(s[end]!.tiles) ===
          canonicalJson([
            { col: 3, row: 1, cell: 'empty' },
            { col: 5, row: 1, cell: 'empty' },
          ]) &&
        s[end + 1]!.player.x !== s[end]!.player.x &&
        s.at(-1)!.outcome === 'cleared'
      );
    },
  },
  {
    name: 'a fail applies its own outcome: the player is back on the trigger and it waits to be left',
    holds: (off) => {
      const s = play(FAIL, 80, off);
      const end = endTick(s);
      return (
        end > 0 &&
        s[end]!.events.some((e) => e.type === 'mini-game-end' && e.result === 'fail') &&
        s[end]!.player.x === TRIGGER_X &&
        s[end]!.player.vx === 0 &&
        s[end]!.coins === 0 &&
        s[end]!.tiles.length === 0 &&
        s[end]!.triggers[0]!.armed === false &&
        events(s, 'mini-game').length === 1 &&
        s.at(-1)!.outcome === 'playing'
      );
    },
  },
];

describe('the mini game hook', () => {
  for (const c of CASES) it(c.name, () => expect(c.holds([])).toBe(true));

  it('a quit with no outcome changes nothing, and the round can start again once the trigger is left', () => {
    const s = play(QUIT, 60);
    const end = endTick(s);
    expect(s[end]!.events).toContainEqual({
      type: 'mini-game-end',
      trigger: 0,
      game: 'hold',
      result: 'quit',
    });
    expect(s[end]!.player.x).toBe(s[end - 1]!.player.x);
    expect(s[end]!.coins).toBe(0);
    expect(s.at(-1)!.triggers[0]).toMatchObject({ armed: true, attempts: 1 });

    // Walk back onto it after leaving: a second round, attempt 2.
    const back = play((x) => {
      if (x?.miniGame) return x.miniGame.state['attempt'] === 1 ? ['select'] : ['attack'];
      return (x?.triggers[0]?.armed ?? true) ? ['right'] : ['left'];
    }, 200);
    const starts = events(back, 'mini-game');
    expect(starts.map((e) => e.attempt)).toEqual([1, 2]);
    expect(back.at(-1)!.coins).toBe(3);
  });

  it('snapshots during the round hold its state and are the same on two runs', () => {
    const a = play(RUN, 120);
    const b = play(RUN, 120);
    expect(a.map((x) => canonicalJson(x))).toEqual(b.map((x) => canonicalJson(x)));
    const during = a[startTick(a)]!;
    expect(during.miniGame).toMatchObject({ trigger: 0, game: 'hold', state: { held: 0, need: 5 } });
    expect(typeof during.miniGame!.state['seed']).toBe('number');
    // Another seed gives the round another seed (drawn from the world's RNG).
    const c = play(RUN, 120, [], 4);
    expect(c[startTick(c)]!.miniGame!.state['seed']).not.toBe(during.miniGame!.state['seed']);
  });

  it('with mini-games off the trigger does nothing', () => {
    const s = play(RUN, 120, ['mini-games']);
    expect(events(s, 'mini-game')).toEqual([]);
    expect(s.every((x) => x.miniGame === null)).toBe(true);
    expect(s.at(-1)!.outcome).toBe('playing');
    expect(s.at(-1)!.coins).toBe(0);
  });

  it('every mini game rule, switched off, fails at least one case', () => {
    for (const rule of MINI_GAME_RULES) {
      const failing = CASES.filter((c) => !c.holds([rule.id]));
      expect(failing.length, `switching off "${rule.id}" fails no case`).toBeGreaterThan(0);
    }
  });

  it('throws when a trigger names a mini game the game did not supply', () => {
    const level = levelSchema.parse({ id: 'test', profile: 'runner', triggers: [TRIGGER], map: MAP });
    expect(() => new PlatformerWorld(level, PROFILE)).toThrow('names mini game "hold" (given: none)');
  });
});

describe('level triggers', () => {
  const codes = (header: Record<string, unknown>, map = MAP) => {
    const r = levelSchema.safeParse({ id: 'test', profile: 'runner', ...header, map });
    return r.success
      ? []
      : r.error.issues.map((i) => ({
          path: i.path,
          code: (i as { params?: { code?: string } }).params?.code,
        }));
  };

  it('takes one entry per trigger, with outcomes that default to nothing', () => {
    const level = levelSchema.parse({
      id: 'test',
      profile: 'runner',
      triggers: [{ game: 'hold' }],
      map: MAP,
    });
    expect(level.triggers).toEqual([{ game: 'hold', params: {}, pass: [], fail: [], quit: [] }]);
  });

  it('flags a trigger count that does not match and an open outside the map', () => {
    expect(codes({})).toEqual([{ path: ['triggers'], code: 'wrong_trigger_count' }]);
    expect(codes({ triggers: [{ ...TRIGGER, fail: ['open:8:1'] }] })).toEqual([
      { path: ['triggers', 0, 'fail', 0], code: 'bad_outcome' },
    ]);
    expect(codes({ triggers: [{ ...TRIGGER, quit: ['teleport'] }] }).map((c) => c.path)).toEqual([
      ['triggers', 0, 'quit', 0],
    ]);
  });
});
