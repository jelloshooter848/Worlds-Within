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
import { LevelSequence, type SequenceSnapshot } from './sequence';
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

/** The round starts in this snapshot's tick (the `mini-game` event). */
const starting = (s: PlatformerSnapshot | null) => s?.events.some((e) => e.type === 'mini-game') ?? false;
/**
 * Right and attack (run) all along, letting go for the round's first tick (attack held into the
 * round is ignored until released, gap G18): the round passes after 5 more ticks of attack.
 */
const RUN = (s: PlatformerSnapshot | null) => (starting(s) ? [] : ['right', 'attack']) as Action[];
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
      if (at < 0 || end !== at + 6) return false;
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

  it('keeps the ended round in the snapshot of the tick it ends, and drops it the next (gap G20)', () => {
    const s = play(RUN, 120);
    const end = endTick(s);
    expect(s.slice(0, end).every((x) => !('endedRound' in x))).toBe(true);
    expect(s[end]!.miniGame).toBeNull();
    expect(s[end]!.endedRound).toEqual({
      trigger: 0,
      game: 'hold',
      result: 'pass',
      state: { held: 5, need: 5, seed: s[end - 1]!.miniGame!.state['seed']!, attempt: 1 },
    });
    expect(s.slice(end + 1).every((x) => !('endedRound' in x))).toBe(true);
  });

  it("puts the round's report in the ended round when it has one", () => {
    const reported: MiniGameDef = {
      ...HOLD,
      create: (ctx, seed) => {
        const round = HOLD.create(ctx, seed);
        return { ...round, report: () => ({ result: round.result() }) };
      },
    };
    const level = levelSchema.parse({ id: 'test', profile: 'runner', triggers: [TRIGGER], map: MAP });
    const game = platformerGame(new PlatformerWorld(level, PROFILE, { seed: 3, miniGames: [reported] }));
    const input = new ScriptedInput({ steps: [] });
    let ended: PlatformerSnapshot['endedRound'];
    let last: PlatformerSnapshot | null = null;
    for (let i = 0; i < 120 && !ended; i++) {
      input.setHeld(RUN(last));
      input.next();
      game.step(input);
      last = game.snapshot() as PlatformerSnapshot;
      ended = last.endedRound;
    }
    expect(ended?.report).toEqual({ result: 'pass' });
  });

  it('a level sequence keeps the round that cleared the level only for that tick, and hosts the round', () => {
    const level = levelSchema.parse({
      id: 'test',
      profile: 'runner',
      triggers: [{ ...TRIGGER, pass: ['clear'] }],
      map: MAP,
    });
    const seq = new LevelSequence([{ level, profile: PROFILE }], { seed: 3, miniGames: [HOLD], pause: 5 });
    const input = new ScriptedInput({ steps: [] });
    const snaps: SequenceSnapshot[] = [];
    const hosted: boolean[] = [];
    for (let i = 0; i < 60; i++) {
      input.setHeld(RUN(snaps.at(-1) ?? null));
      input.next();
      seq.step(input);
      snaps.push(seq.snapshot());
      hosted.push(seq.miniGame() !== null);
    }
    const end = snaps.findIndex((x) => x.endedRound !== undefined);
    expect(snaps[end]).toMatchObject({ outcome: 'cleared', pause: 0, endedRound: { result: 'pass' } });
    expect(snaps.filter((x) => x.endedRound !== undefined)).toHaveLength(1);
    expect(snaps[end + 1]!.pause).toBe(1);
    expect(hosted.slice(0, end).some(Boolean)).toBe(true);
    expect(hosted[end]).toBe(false);
  });

  it('ignores a button held into the round until it is released (gap G18)', () => {
    // Attack held from the start, through the trigger and on: the round never counts it.
    const held = play(() => ['right', 'attack'], 60);
    expect(startTick(held)).toBeGreaterThan(0);
    expect(endTick(held)).toBe(-1);
    expect(held.at(-1)!.miniGame?.state['held']).toBe(0);
    // Let go for one tick and hold it again: now it counts, from the press on.
    const s = play(RUN, 120);
    const at = startTick(s);
    expect(s[at + 1]!.miniGame?.state['held']).toBe(0);
    expect(s[at + 2]!.miniGame?.state['held']).toBe(1);
    // A button pressed on the round's first tick (not held into it) counts at once.
    const fresh = play((x) => (starting(x) ? ['attack'] : ['right']), 60);
    const f = startTick(fresh);
    expect(fresh[f + 1]!.miniGame?.state['held']).toBe(1);
  });

  it("steps the round with its def's input map (gap G18)", () => {
    // The round's attack is the host's jump; the host's own attack is dropped.
    const mapped: MiniGameDef = { ...HOLD, inputMap: { jump: 'attack', attack: null } };
    const level = levelSchema.parse({ id: 'test', profile: 'runner', triggers: [TRIGGER], map: MAP });
    const run = (hold: Action[]) => {
      const game = platformerGame(new PlatformerWorld(level, PROFILE, { seed: 3, miniGames: [mapped] }));
      const input = new ScriptedInput({ steps: [] });
      let last: PlatformerSnapshot | null = null;
      for (let i = 0; i < 80 && !last?.endedRound; i++) {
        input.setHeld(last?.miniGame ? (starting(last) ? [] : hold) : ['right']);
        input.next();
        game.step(input);
        last = game.snapshot() as PlatformerSnapshot;
      }
      return last!;
    };
    expect(run(['jump']).endedRound).toMatchObject({ result: 'pass' });
    expect(run(['attack']).endedRound).toBeUndefined();
  });

  it("hands a round the level's HUD values its def asks for, and none to one that asks for none (gap G19)", () => {
    const given: Record<string, unknown>[] = [];
    const asking: MiniGameDef = {
      ...HOLD,
      hostStatus: ['lives', 'coins', 'score'],
      create: (ctx, seed) => {
        given.push({ ...ctx });
        return HOLD.create(ctx, seed);
      },
    };
    const level = levelSchema.parse({ id: 'test', profile: 'runner', triggers: [TRIGGER], map: MAP });
    for (const def of [asking, { ...asking, hostStatus: undefined }] as MiniGameDef[]) {
      const game = platformerGame(new PlatformerWorld(level, PROFILE, { seed: 3, miniGames: [def] }));
      const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
      for (let i = 0; i < 60 && given.length < 2; i++) {
        input.next();
        game.step(input);
        if ((game.snapshot() as PlatformerSnapshot).miniGame) break;
      }
    }
    expect(given[0]).toEqual({ params: { ticks: 5 }, attempt: 1, hostStatus: { lives: 1, coins: 0 } });
    expect(given[1]).toEqual({ params: { ticks: 5 }, attempt: 1 });
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
