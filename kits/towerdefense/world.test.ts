import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@engine/core/headless';
import { Rng } from '@engine/core/rng';
import { TOWERDEFENSE_RULES } from './rules';
import { CELL_SUB, tdMapSchema, type EnemyGroup, type TdWaves, type TowerTable } from './schema';
import { TdWorld, type TdEvent, type TdRoundDef, type TdWorldOptions } from './world';

// A straight path along row 0 (7 cells, so the exit is 6 cells on: progress 96) with build cells
// at columns 1, 3 and 5 of row 1.
const ROWS = ['S#####X', '.B.B.B.'];
const END = 6 * CELL_SUB;

const TOWERS: TowerTable = {
  arrow: { cost: 10, range: 1, damage: 1, cooldown: 3 },
  long: { cost: 20, range: 9, damage: 1, cooldown: 1, sell: 15 },
};

const GRUNT: EnemyGroup = { kind: 'grunt', count: 1, spacing: 4, hp: 3, speed: 4, bounty: 5 };

interface Setup {
  gold?: number;
  lives?: number;
  groups?: EnemyGroup[][];
  timer?: number;
}

function def(s: Setup = {}): TdRoundDef {
  const map = tdMapSchema.parse({
    id: 'line',
    start: { gold: s.gold ?? 30, lives: s.lives ?? 3 },
    towers: ['arrow', 'long'],
    waves: 'line',
    map: ROWS,
  });
  const waves: TdWaves = { id: 'line', waves: (s.groups ?? [[GRUNT]]).map((groups) => ({ groups })) };
  if (s.timer !== undefined) waves.timer = s.timer;
  return { map, towers: TOWERS, waves };
}

function world(s: Setup = {}, opts: TdWorldOptions = {}): TdWorld {
  return new TdWorld(def(s), opts);
}

/** Steps `n` times, returning every event with the tick it happened on. */
function steps(w: TdWorld, n: number): (TdEvent & { at: number })[] {
  const out: (TdEvent & { at: number })[] = [];
  for (let i = 0; i < n; i++) {
    const at = w.tick;
    for (const e of w.step()) out.push({ ...e, at });
  }
  return out;
}

const off = (rule: string): TdWorldOptions => ({ disabledRules: [rule] });

describe('placing and paying', () => {
  it('places a tower on a free build cell and pays its cost', () => {
    const w = world();
    w.place('arrow', 1, 1);
    expect(w.step()).toEqual([{ type: 'placed', tower: 1, towerType: 'arrow', col: 1, row: 1, cost: 10 }]);
    expect(w.gold).toBe(20);
    expect(w.snapshot().towers).toEqual([{ id: 1, type: 'arrow', col: 1, row: 1, cooldown: 0 }]);
    expect(w.stats.spent).toBe(10);
  });

  it('refuses a tower it cannot pay for, off a build cell, off the map, on a tower or not on the map', () => {
    const w = world({ gold: 25 });
    w.place('arrow', 1, 1);
    w.place('long', 3, 1);
    w.place('arrow', 0, 1);
    w.place('arrow', 2, 0);
    w.place('arrow', 9, 9);
    w.place('arrow', 1, 1);
    w.place('cannon', 5, 1);
    expect(w.step().map((e) => (e.type === 'refused' ? e.code : e.type))).toEqual([
      'placed',
      'too_poor',
      'not_build_cell',
      'not_build_cell',
      'off_map',
      'occupied',
      'unknown_tower',
    ]);
    expect(w.gold).toBe(15);
    expect(w.towers).toHaveLength(1);
    expect(w.placeRefusal('arrow', 3, 1)).toBeNull();
    expect(w.placeRefusal('long', 3, 1)).toBe('too_poor');
  });

  it('sells a tower for half its cost, or its sell value', () => {
    const w = world({ gold: 40 });
    w.place('arrow', 1, 1);
    w.place('long', 3, 1);
    w.step();
    w.sell(1, 1);
    w.sell(3, 1);
    w.sell(5, 1);
    expect(w.step()).toEqual([
      { type: 'sold', tower: 1, towerType: 'arrow', col: 1, row: 1, refund: 5 },
      { type: 'sold', tower: 2, towerType: 'long', col: 3, row: 1, refund: 15 },
      { type: 'refused', command: 'sell', code: 'no_tower' },
    ]);
    expect(w.gold).toBe(30);
    expect(w.towers).toEqual([]);
  });
});

describe('waves and the path', () => {
  it('spawns a wave on the button and walks its enemies along the path in sub-cell units', () => {
    const w = world();
    w.startWave();
    expect(w.step()).toEqual([
      { type: 'wave', wave: 1, by: 'button' },
      { type: 'spawn', enemy: 1, kind: 'grunt', wave: 1 },
    ]);
    expect(w.snapshot().enemies).toEqual([
      { id: 1, kind: 'grunt', wave: 1, hp: 3, progress: 4, col: 0, row: 0 },
    ]);
    steps(w, 2);
    expect(w.snapshot().enemies[0]).toMatchObject({ progress: 12, col: 1, row: 0 });
    w.startWave();
    expect(w.step()).toEqual([{ type: 'refused', command: 'start-wave', code: 'no_more_waves' }]);
  });

  it("spaces a group's enemies and queues a wave started early behind the one coming", () => {
    const w = world({
      groups: [[{ ...GRUNT, count: 3 }], [{ ...GRUNT, kind: 'brute', count: 1, spacing: 2 }]],
    });
    w.startWave();
    w.startWave();
    const spawns = steps(w, 12).filter((e) => e.type === 'spawn');
    expect(spawns.map((e) => [e.at, e.type === 'spawn' ? e.kind : ''])).toEqual([
      [0, 'grunt'],
      [4, 'grunt'],
      [8, 'grunt'],
      [10, 'brute'],
    ]);
  });

  it("starts the next wave by itself on the wave list's timer", () => {
    const w = world({ timer: 10, groups: [[GRUNT], [GRUNT]] });
    const waves = steps(w, 25).filter((e) => e.type === 'wave');
    expect(waves.map((e) => e.at)).toEqual([10, 20]);
    expect(waves.every((e) => e.type === 'wave' && e.by === 'timer')).toBe(true);
  });

  it('draws spacing jitter from the RNG it is given, and only when a group has jitter', () => {
    const rng = new Rng(7);
    const before = rng.state();
    const plain = world({ groups: [[{ ...GRUNT, count: 3 }]] }, { rng });
    plain.startWave();
    steps(plain, 3);
    expect(rng.state()).toBe(before);
    const jittered = world({ groups: [[{ ...GRUNT, count: 3, jitter: 5 }]] }, { rng });
    jittered.startWave();
    jittered.step();
    expect(rng.state()).not.toBe(before);
  });
});

describe('towers', () => {
  /** A world with enemies placed by hand at these progresses (ids 1, 2, ...), walking off. */
  function withEnemies(progress: number[], opts: TdWorldOptions = {}): TdWorld {
    const w = world({}, { ...opts, disabledRules: [...(opts.disabledRules ?? []), 'enemies-walk'] });
    progress.forEach((p, i) =>
      w.enemies.push({ id: i + 1, kind: 'grunt', wave: 1, hp: 3, speed: 4, bounty: 5, progress: p }),
    );
    return w;
  }

  it('targets the enemy furthest along the path, ties to the lowest id', () => {
    const w = withEnemies([40, 52, 52]);
    w.place('arrow', 3, 1);
    w.step();
    const tower = w.towers[0]!;
    expect(w.enemies.map((e) => w.enemyCell(e))).toEqual([
      { col: 3, row: 0 },
      { col: 3, row: 0 },
      { col: 3, row: 0 },
    ]);
    expect(w.targetOf(tower)?.id).toBe(2);
    expect(withEnemies([40, 8]).targetOf(tower)?.id).toBe(1);
  });

  it('only reaches enemies within its range, squared cell distance', () => {
    const w = withEnemies([0, 16, 48]);
    w.place('arrow', 1, 1);
    w.step();
    // (1,1) to (0,0) is 2, to (1,0) 1, to (3,0) 5; the range is 1.
    expect(w.targetOf(w.towers[0]!)?.id).toBe(2);
    w.enemies.splice(1, 1);
    expect(w.targetOf(w.towers[0]!)).toBeUndefined();
  });

  it('fires on its cooldown, kills at 0 hp and pays the bounty', () => {
    const w = withEnemies([16]);
    w.place('arrow', 1, 1);
    const events = steps(w, 7);
    expect(events.filter((e) => e.type === 'fire').map((e) => e.at)).toEqual([0, 3, 6]);
    expect(events.find((e) => e.type === 'kill')).toEqual({
      type: 'kill',
      enemy: 1,
      kind: 'grunt',
      tower: 1,
      bounty: 5,
      at: 6,
    });
    expect(w.gold).toBe(25);
    expect(w.stats).toMatchObject({ killed: 1, earned: 5 });
    expect(w.enemies).toEqual([]);
  });
});

describe('leaks, lives and the end of the round', () => {
  it('an enemy reaching the exit leaves and costs a life; the round is won once all is clear', () => {
    const w = world();
    w.startWave();
    const events = steps(w, END / GRUNT.speed);
    expect(events.slice(-2)).toEqual([
      { type: 'leak', enemy: 1, kind: 'grunt', lives: 2, at: 23 },
      { type: 'won', at: 23 },
    ]);
    expect(w.snapshot()).toMatchObject({ outcome: 'won', lives: 2, stats: { leaked: 1 } });
  });

  it('is lost at 0 lives, and refuses every command after', () => {
    const w = world({ lives: 1 });
    w.startWave();
    const events = steps(w, 24);
    expect(events.at(-1)).toEqual({ type: 'lost', at: 23 });
    expect(w.outcome).toBe('lost');
    w.place('arrow', 1, 1);
    expect(w.step()).toEqual([{ type: 'refused', command: 'place', code: 'round_over' }]);
    expect(w.tick).toBe(25);
  });

  it('is won when every enemy of every wave is killed', () => {
    const w = world({ groups: [[{ ...GRUNT, count: 2 }]] });
    w.place('long', 1, 1);
    w.startWave();
    steps(w, 30);
    expect(w.snapshot()).toMatchObject({
      outcome: 'won',
      lives: 3,
      gold: 20,
      stats: { killed: 2, leaked: 0 },
    });
  });
});

/**
 * One case per named rule: a short round and the value it gives. Each case must give a different
 * value with its rule switched off.
 */
const RULE_CASES: Record<string, (opts: TdWorldOptions) => unknown> = {
  'build-on-build-cells': (o) => {
    const w = world({}, o);
    w.place('arrow', 0, 1);
    w.step();
    return w.towers.length;
  },
  'build-costs-gold': (o) => {
    const w = world({ gold: 5 }, o);
    w.place('arrow', 1, 1);
    w.step();
    return [w.towers.length, w.gold];
  },
  'sell-refunds': (o) => {
    const w = world({}, o);
    w.place('arrow', 1, 1);
    w.step();
    w.sell(1, 1);
    w.step();
    return w.gold;
  },
  'wave-timer': (o) => {
    const w = world({ timer: 5 }, o);
    steps(w, 6);
    return w.wavesStarted;
  },
  'spawn-spacing': (o) => {
    const w = world({ groups: [[{ ...GRUNT, count: 3 }]] }, o);
    w.startWave();
    w.step();
    return w.enemies.length;
  },
  'enemies-walk': (o) => {
    const w = world({}, o);
    w.startWave();
    steps(w, 5);
    return w.snapshot().enemies.map((e) => e.progress);
  },
  'towers-fire': (o) => {
    const w = world({}, o);
    w.place('long', 1, 1);
    w.startWave();
    steps(w, 2);
    return w.snapshot().enemies.map((e) => e.hp);
  },
  'target-first': (o) => {
    // The second, faster enemy overtakes the first.
    const slow = { ...GRUNT, hp: 9, speed: 1 };
    const w = world({ groups: [[slow, { ...slow, speed: 8, spacing: 1 }]] }, o);
    w.startWave();
    steps(w, 5);
    w.place('long', 1, 1);
    w.step();
    return w.snapshot().enemies.map((e) => e.hp);
  },
  'tower-range': (o) => {
    const w = world({}, o);
    w.place('arrow', 5, 1);
    w.startWave();
    w.step();
    return w.snapshot().enemies.map((e) => e.hp);
  },
  'tower-cooldown': (o) => {
    const w = world({ groups: [[{ ...GRUNT, hp: 9, speed: 1 }]] }, o);
    w.place('arrow', 1, 1);
    w.startWave();
    return steps(w, 12).filter((e) => e.type === 'fire').length;
  },
  'kill-bounty': (o) => {
    const w = world({}, o);
    w.place('long', 1, 1);
    w.startWave();
    steps(w, 5);
    return w.gold;
  },
  'leak-costs-life': (o) => {
    const w = world({}, o);
    w.startWave();
    steps(w, 30);
    return w.lives;
  },
  'win-on-clear': (o) => {
    const w = world({}, o);
    w.startWave();
    steps(w, 30);
    return w.outcome;
  },
  'lose-at-zero-lives': (o) => {
    const w = world({ lives: 1 }, o);
    w.startWave();
    steps(w, 30);
    return w.outcome;
  },
};

describe('the named rules', () => {
  it('has a case for every rule', () => {
    expect(Object.keys(RULE_CASES).sort()).toEqual(TOWERDEFENSE_RULES.map((r) => r.id).sort());
  });

  for (const rule of TOWERDEFENSE_RULES) {
    it(`switching off ${rule.id} changes the round`, () => {
      const play = RULE_CASES[rule.id]!;
      expect(play(off(rule.id))).not.toEqual(play({}));
    });
  }

  it('throws on an unknown rule id', () => {
    expect(() => world({}, off('no-such-rule'))).toThrow(/unknown rule/);
  });
});

describe('determinism', () => {
  /** A round with jittered spacing, towers placed and sold, played to its end; the snapshots. */
  function play(seed: number): string[] {
    const w = world(
      {
        gold: 40,
        timer: 30,
        groups: [
          [{ ...GRUNT, count: 4, jitter: 6 }],
          [{ ...GRUNT, kind: 'brute', count: 3, hp: 6, jitter: 3 }],
        ],
      },
      { seed },
    );
    const out: string[] = [];
    for (let i = 0; i < 200 && w.outcome === 'playing'; i++) {
      if (i === 0) w.place('arrow', 1, 1);
      if (i === 2) w.startWave();
      if (i === 12) w.place('long', 3, 1);
      if (i === 40) w.sell(1, 1);
      w.step();
      out.push(canonicalJson(w.snapshot()));
    }
    return out;
  }

  it('gives the same snapshots from the same seed twice, and others from another seed', () => {
    const a = play(5);
    expect(play(5)).toEqual(a);
    expect(play(6)).not.toEqual(a);
    expect(JSON.parse(a.at(-1)!)).toMatchObject({ outcome: 'won' });
  });

  it('keeps whole numbers only in the snapshot', () => {
    const numbers = (v: unknown): number[] =>
      typeof v === 'number'
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(numbers)
          : v !== null && typeof v === 'object'
            ? Object.values(v).flatMap(numbers)
            : [];
    expect(
      play(5)
        .flatMap((s) => numbers(JSON.parse(s)))
        .every(Number.isInteger),
    ).toBe(true);
  });

  it('throws on a round whose content does not fit', () => {
    const d = def();
    expect(() => new TdWorld({ ...d, towers: { arrow: TOWERS.arrow! } })).toThrow(/no tower type "long"/);
    expect(() => new TdWorld({ ...d, waves: { ...d.waves, id: 'other' } })).toThrow(/plays waves "line"/);
  });
});
