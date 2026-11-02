import { describe, expect, it } from 'vitest';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import type { Action } from '@engine/core/input/actions';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { miniGameTable } from '@engine/core/minigame';
import { TopDownBot } from './bot';
import { challengeParams, roomChallenge, type ChallengeSnapshot, type RoomChallenge } from './challenge';
import type { RoomDef } from './room';

/**
 * A 16x11 test room: walls round the edge, the hero at (2,2), an exit tile at (13,2) and one
 * knight at (8,7) (or none).
 */
function arena(knight = true): RoomDef {
  const rows = Array.from({ length: 11 }, (_, r) =>
    r === 0 || r === 10 ? '#'.repeat(16) : `#${'.'.repeat(14)}#`,
  ).map((row) => row.split(''));
  rows[2]![2] = '@';
  rows[2]![13] = 'E';
  if (knight) rows[7]![8] = 'n';
  return { id: 'arena', at: [0, 0], map: rows.map((r) => r.join('')) };
}

/** Ticks into the bot's fight in which the knight has taken one hit but stands. */
const HIT_TICKS = 190;

const DEF = roomChallenge({ id: 'arena', title: 'ARENA', room: arena() });

/**
 * Plays one round: `hold(round)` picks the actions held each tick. Returns the snapshot after
 * each tick, up to and including the one the round ends on (or `max` ticks).
 */
function play(
  params: JsonObject,
  hold: (round: RoomChallenge) => Action[],
  seed = 7,
  max = 3000,
  def = DEF,
): { round: RoomChallenge; snaps: ChallengeSnapshot[] } {
  const round = def.create({ params, attempt: 1 }, seed) as RoomChallenge;
  const input = new ScriptedInput({ steps: [] });
  const snaps: ChallengeSnapshot[] = [];
  for (let i = 0; i < max && round.result() === null; i++) {
    input.setHeld(hold(round));
    input.next();
    round.step(input);
    snaps.push(round.snapshot());
  }
  return { round, snaps };
}

describe('roomChallenge', () => {
  it('is a well-formed mini game def', () => {
    expect(miniGameTable([DEF]).get('arena')?.title).toBe('ARENA');
  });

  it("takes its title from the room's title, else the id in capitals (gap G15)", () => {
    expect(roomChallenge({ id: 'arena', room: { ...arena(), title: 'THE ARENA' } }).title).toBe('THE ARENA');
    expect(roomChallenge({ id: 'big-arena', room: arena() }).title).toBe('BIG ARENA');
    expect(
      roomChallenge({ id: 'arena', title: 'MINE', room: { ...arena(), title: 'THE ARENA' } }).title,
    ).toBe('MINE');
  });

  it('passes on reach once the hero walks onto the exit tile', () => {
    const { round, snaps } = play({ goal: 'reach', ticks: 600 }, () => ['right']);
    expect(round.result()).toBe('pass');
    const last = snaps.at(-1)!;
    expect(last.exited).toBe(true);
    expect(last.events).toContainEqual({ type: 'exit' });
    expect(last.round).toMatchObject({ goal: 'reach', result: 'pass', limit: 600, attempt: 1 });
    expect(last.round.ticks).toBe(snaps.length);
  });

  it('passes on defeat-all once the last enemy is beaten', () => {
    const bot = new TopDownBot({ arena: [{ do: 'fight' }] });
    const { round, snaps } = play({ goal: 'defeat-all', ticks: 3000 }, (r) => bot.next(r.world));
    expect(round.result()).toBe('pass');
    expect(snaps.at(-1)!.enemies).toBe(0);
    expect(snaps.flatMap((s) => s.events)).toContainEqual({ type: 'kill', kind: 'knight' });
  });

  it('fails when the hero dies (after his death spin)', () => {
    // Half a heart, standing still: the knight's first touch kills him.
    const { round, snaps } = play({ goal: 'defeat-all', ticks: 3000, hp: 1 }, () => []);
    expect(round.result()).toBe('fail');
    const last = snaps.at(-1)!;
    expect(last.hero.dead).toBe(true);
    expect(last.events).toContainEqual({ type: 'dead' });
    expect(last.round.ticks).toBeLessThan(3000);
    expect(snaps.flatMap((s) => s.events)).toContainEqual({ type: 'dying' });
  });

  it('fails when time runs out', () => {
    const quiet = roomChallenge({ id: 'quiet', title: 'QUIET', room: arena(false) });
    const { round, snaps } = play({ goal: 'reach', ticks: 40 }, () => [], 7, 3000, quiet);
    expect(round.result()).toBe('fail');
    expect(snaps).toHaveLength(40);
    expect(snaps.at(-1)!.hero.dead).toBe(false);
    expect(snaps.at(-1)!.round).toMatchObject({ ticks: 40, result: 'fail' });
  });

  it('quits on a press of select, which the world never sees', () => {
    const { round, snaps } = play({ goal: 'reach' }, (r) =>
      r.snapshot().round.ticks < 5 ? ['right'] : ['select'],
    );
    expect(round.result()).toBe('quit');
    expect(snaps.at(-1)!.round.ticks).toBe(5);
    expect(snaps.at(-1)!.frame).toBe(5);
    // Once ended, it stays ended and stepping does nothing.
    const input = new ScriptedInput({ steps: [] });
    input.setHeld(['right']);
    input.next();
    round.step(input);
    expect(round.result()).toBe('quit');
    expect(round.snapshot().frame).toBe(5);
  });

  it('plays the same round from the same seed, and another from another seed', () => {
    const walk = () => ['down', 'right'] as Action[];
    const a = play({ goal: 'reach', ticks: 200 }, walk, 11).snaps.map((s) => canonicalJson(s));
    const b = play({ goal: 'reach', ticks: 200 }, walk, 11).snaps.map((s) => canonicalJson(s));
    const c = play({ goal: 'reach', ticks: 200 }, walk, 12).snaps.map((s) => canonicalJson(s));
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
  });

  it('presents the kit frame with the time left and the goal', () => {
    const def = roomChallenge({
      id: 'arena',
      title: 'ARENA',
      room: arena(),
      size: { width: 320, height: 240 },
    });
    const round = def.create({ params: { goal: 'reach', ticks: 100 }, attempt: 2 }, 3);
    const frame = round.present!();
    expect(frame.size).toEqual({ width: 320, height: 240 });
    expect(frame.status).toMatchObject({ goal: 'reach', timeLeft: 100 });
    expect(frame.entities.map((e) => e.kind)).toContain('hero');
    expect(frame.entities.map((e) => e.kind)).toContain('knight');
    expect(canonicalJson(round.snapshot())).toBe(canonicalJson(round.snapshot()));
  });

  it('reports what was beaten, what was hit and what the hero lost, as plain JSON (Engine 0.10 T7)', () => {
    const bot = new TopDownBot({ arena: [{ do: 'fight' }] });
    const fresh = DEF.create({ params: { goal: 'defeat-all', ticks: 3000 }, attempt: 1 }, 7) as RoomChallenge;
    expect(fresh.report()).toEqual({
      result: null,
      goal: 'defeat-all',
      ticks: 0,
      limit: 3000,
      hero: { hp: 6, maxHp: 6, lost: 0, dead: false },
      foes: [{ key: '8,7', kind: 'knight', hp: 2, startHp: 2, defeated: false }],
      defeated: [],
      hurt: [],
    });
    const { round, snaps } = play({ goal: 'defeat-all', ticks: 3000 }, (r) => bot.next(r.world));
    const report = round.report();
    expect(report).toMatchObject({ result: 'pass', ticks: snaps.length, defeated: ['8,7'], hurt: [] });
    expect(report.foes[0]).toMatchObject({ key: '8,7', defeated: true });
    expect(JSON.parse(canonicalJson(report))).toEqual(report);
    // Hit once, still standing when time runs out: hurt, not defeated.
    const hitBot = new TopDownBot({ arena: [{ do: 'fight' }] });
    const hit = play({ goal: 'defeat-all', ticks: HIT_TICKS }, (r) => hitBot.next(r.world)).round.report();
    expect(hit).toMatchObject({ result: 'fail', defeated: [], hurt: ['8,7'] });
    expect(hit.foes[0]).toMatchObject({ hp: 1, startHp: 2, defeated: false });
    // The hero's loss when the knight kills him.
    const dead = play({ goal: 'defeat-all', ticks: 3000, hp: 1 }, () => []).round.report();
    expect(dead).toMatchObject({
      result: 'fail',
      hero: { hp: 0, maxHp: 1, lost: 1, dead: true },
      defeated: [],
    });
  });

  it('gives the same snapshots whether or not its report is read', () => {
    const bot = () => new TopDownBot({ arena: [{ do: 'fight' }] });
    const plain = play(
      { goal: 'defeat-all', ticks: 3000 },
      (
        (b) => (r: RoomChallenge) =>
          b.next(r.world)
      )(bot()),
    );
    const b = bot();
    const read = play({ goal: 'defeat-all', ticks: 3000 }, (r) => {
      r.report();
      return b.next(r.world);
    });
    expect(read.snaps.map((s) => canonicalJson(s))).toEqual(plain.snaps.map((s) => canonicalJson(s)));
  });

  it('checks its params and its room', () => {
    expect(challengeParams({ goal: 'reach' })).toEqual({ goal: 'reach', ticks: 1800 });
    expect(() => challengeParams({})).toThrow(/goal/);
    expect(() => challengeParams({ goal: 'reach', ticks: 0 })).toThrow(/ticks/);
    expect(() => challengeParams({ goal: 'reach', lives: 3 })).toThrow(/unknown param "lives"/);
    const quiet = roomChallenge({ id: 'quiet', title: 'QUIET', room: arena(false) });
    expect(() => quiet.create({ params: { goal: 'defeat-all' }, attempt: 1 }, 1)).toThrow(/no enemies/);
    const noStart = { ...arena(), map: arena().map.map((r) => r.replace('@', '.')) };
    expect(() => roomChallenge({ id: 'bad', title: 'BAD', room: noStart })).toThrow();
  });
});
