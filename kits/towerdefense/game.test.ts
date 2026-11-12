import { describe, expect, it } from 'vitest';
import { canonicalJson, type HeadlessGame } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { fixtureContent, fixtureRound } from './__fixtures__/game';
import { TdBot, type TdBotStep } from './bot';
import { tdGame, tdRound, type TdGame } from './game';

const WIN: TdBotStep[] = [
  { do: 'place', tower: 'arrow', col: 1, row: 1 },
  { do: 'place', tower: 'arrow', col: 3, row: 1 },
  { do: 'wave' },
  { do: 'clear' },
  { do: 'wave' },
  { do: 'clear' },
];

/** Plays a bot's plan to the round's end (or `max` steps); every step's snapshot hash. */
function play(plan: TdBotStep[], seed = 3, disabledRules?: string[], max = 600) {
  const game = tdGame({ ...fixtureRound(), seed, disabledRules });
  const bot = new TdBot(plan);
  const input = new ScriptedInput({ steps: [] });
  const hashes: string[] = [];
  while (game.world.outcome === 'playing' && game.world.tick < max) {
    input.setHeld(bot.next(game));
    input.next();
    game.step(input);
    hashes.push(canonicalJson(game.snapshot()));
  }
  return { game, hashes };
}

describe('tdGame', () => {
  it('is a HeadlessGame with no recorded orders (frame input only)', () => {
    const g: HeadlessGame = tdGame({ ...fixtureRound(), seed: 1 });
    expect(typeof g.step).toBe('function');
    expect(g.order).toBeUndefined();
  });

  it('gives the round, the controls and a kit summary in its snapshot', () => {
    const g = tdGame({ ...fixtureRound(), seed: 1 });
    const snap = g.snapshot();
    expect(Object.keys(snap).sort()).toEqual(['controls', 'kit', 'round']);
    expect(snap.controls).toEqual({ col: 1, row: 1, tower: 'arrow', held: [0, 0, 0, 0] });
    expect(snap.kit).toEqual({
      outcome: 'playing',
      gold: 30,
      lives: 3,
      wave: 0,
      waves: 2,
      towers: 0,
      enemies: 0,
      killed: 0,
      leaked: 0,
      spent: 0,
      earned: 0,
    });
    expect(canonicalJson(snap)).toBe(canonicalJson(g.snapshot()));
  });

  it('gives kit.stars only when the map has a rating: 0 until won, then by the lives left (Engine 0.16 E4)', () => {
    expect(tdGame({ ...fixtureRound(), seed: 1 }).snapshot().kit).not.toHaveProperty('stars');
    const r = fixtureRound();
    const rated = (three: number, two: number) => {
      const game = tdGame({ ...r, map: { ...r.map, stars: { three, two } }, seed: 3 });
      expect((game.snapshot().kit as { stars?: number }).stars).toBe(0);
      const bot = new TdBot(WIN);
      const input = new ScriptedInput({ steps: [] });
      while (game.world.outcome === 'playing' && game.world.tick < 600) {
        input.setHeld(bot.next(game));
        input.next();
        game.step(input);
      }
      expect(game.world.outcome).toBe('won');
      return (game.snapshot().kit as { stars?: number }).stars;
    };
    expect(rated(3, 2)).toBe(3);
    expect(rated(3, 1)).toBe(3);
  });

  it('plays the bot to a won round and gives the same hashes on two runs from one seed', () => {
    const a = play(WIN);
    const b = play(WIN);
    expect(a.game.world.outcome).toBe('won');
    expect(a.game.snapshot().kit).toMatchObject({
      outcome: 'won',
      lives: 3,
      towers: 2,
      killed: 5,
      leaked: 0,
    });
    expect(a.hashes.length).toBeGreaterThan(20);
    expect(a.hashes).toEqual(b.hashes);
    expect(play(WIN, 4).hashes).not.toEqual(a.hashes);
  });

  it('loses the round with nothing built', () => {
    const { game } = play([{ do: 'wave' }, { do: 'wave' }]);
    expect(game.world.outcome).toBe('lost');
    expect(game.snapshot().kit).toMatchObject({ outcome: 'lost', lives: 0, leaked: 3 });
  });

  it('passes disabled rules to the round', () => {
    const { game } = play([{ do: 'place', tower: 'cannon', col: 1, row: 1 }], 1, ['build-costs-gold'], 12);
    expect(game.world.towers.length).toBe(1);
    expect(game.world.gold).toBe(30);
    expect(() => tdGame({ ...fixtureRound(), seed: 1, disabledRules: ['no-such-rule'] })).toThrow();
  });

  it('the bot sells and waits', () => {
    const { game } = play(
      [
        { do: 'place', tower: 'arrow', col: 1, row: 1 },
        { do: 'wait', ticks: 3 },
        { do: 'sell', col: 1, row: 1 },
      ],
      1,
      undefined,
      30,
    );
    expect(game.world.towers).toEqual([]);
    expect(game.world.gold).toBe(25);
  });

  it('keeps the last step events for a frame stream', () => {
    const g: TdGame = tdGame({ ...fixtureRound(), seed: 1 });
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['jump'] }] });
    input.next();
    g.step(input);
    expect(g.events).toEqual([{ type: 'placed', tower: 1, towerType: 'arrow', col: 1, row: 1, cost: 10 }]);
  });
});

describe('upgrades (Engine 0.16 E3)', () => {
  it('the bot upgrades a tower with jump, and the snapshot shows its level', () => {
    const r = fixtureRound();
    const arrow = { ...r.towers.arrow!, levels: [{ cost: 5, damage: 2 }] };
    const game = tdGame({ ...r, towers: { ...r.towers, arrow }, seed: 1 });
    const bot = new TdBot([
      { do: 'place', tower: 'arrow', col: 1, row: 1 },
      { do: 'upgrade', col: 1, row: 1 },
    ]);
    const input = new ScriptedInput({ steps: [] });
    for (let i = 0; i < 6; i++) {
      input.setHeld(bot.next(game));
      input.next();
      game.step(input);
    }
    expect(bot.done).toBe(true);
    expect(game.world.gold).toBe(15);
    expect(game.snapshot()).toMatchObject({ round: { towers: [{ id: 1, level: 2 }] }, kit: { spent: 15 } });
  });
});

describe('tdRound', () => {
  it('reads the map, the tower table and the map wave list from the content', () => {
    const r = tdRound(fixtureContent());
    expect(r.map.id).toBe('tiny');
    expect(Object.keys(r.towers)).toEqual(['arrow', 'cannon']);
    expect(r.waves.id).toBe('tiny');
    expect(tdRound(fixtureContent(), 'tiny').map.id).toBe('tiny');
    expect(() => tdRound(fixtureContent(), 'nope')).toThrow('no td-map "nope"');
  });
});
