import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@engine/core/headless';
import {
  FrameStream,
  isFullMap,
  presentFrameSchema,
  type DeepReadonly,
  type PresentFrame,
} from '@engine/core/present';
import { fixtureRound } from './__fixtures__/game';
import { CELL_SUB } from './schema';
import {
  enemyPlace,
  facingToward,
  presentWorld,
  TD_EVENT_TYPES,
  TD_NEAR_GATE_CELLS,
  TD_TILES,
  tdFrames,
  TdPresentState,
} from './present';
import { TdWorld } from './world';

const SIZE = { width: 256, height: 240 };
const world = (seed = 3) => new TdWorld(fixtureRound(), { seed });
const cursor = (col: number, row: number, tower = 'arrow') => ({ col, row, tower });

function valid(frame: DeepReadonly<PresentFrame>): void {
  const r = presentFrameSchema.safeParse(frame);
  expect(r.success ? [] : r.error.issues).toEqual([]);
  expect(Object.isFrozen(frame)).toBe(true);
  expect(Object.isFrozen(frame.entities)).toBe(true);
  expect(Object.isFrozen(frame.status)).toBe(true);
}

const byId = (frame: DeepReadonly<PresentFrame>, id: string) => frame.entities.find((e) => e.id === id);

/** Steps the round until `until` holds (at most `max` steps), returning the last step's frame. */
function stepUntil(w: TdWorld, until: (w: TdWorld) => boolean, max = 200): void {
  for (let i = 0; i < max && !until(w); i++) w.step();
}

describe('presentWorld', () => {
  it('gives a schema-valid frozen frame of the map, the HUD and the cursor before the round starts', () => {
    const w = world();
    const frame = presentWorld(w, { size: SIZE, cursor: cursor(1, 1) });
    valid(frame);
    expect(frame.frame).toBe(0);
    expect(frame.map && isFullMap(frame.map)).toBe(true);
    expect(frame.map).toMatchObject({
      id: 'td:tiny',
      version: 1,
      tileSize: 16,
      cols: 6,
      rows: 4,
      tiles: ['S##...', '.B#B..', '..###X', '..B...'],
    });
    expect(Object.values(TD_TILES)).toEqual(['.', '#', 'B', 'S', 'X']);
    expect(frame.status).toEqual({
      gold: 30,
      lives: 3,
      wave: '0/2',
      waveNumber: 0,
      waveCount: 2,
      enemies: 0,
      outcome: 'playing',
      killed: 0,
      wavesHeld: 0,
      nearGate: 0,
      nextWave: 40,
      nextWaveKinds: 'runner',
      nextWaveGroups: 'runner:2',
      tower: 'arrow',
      towerCost: 10,
    });
    expect(byId(frame, 'cursor')).toMatchObject({
      kind: 'cursor',
      x: 16,
      y: 16,
      w: 16,
      h: 16,
      tags: ['cell:build'],
    });
    expect(byId(frame, 'ghost')).toMatchObject({
      kind: 'ghost:arrow',
      x: 16,
      y: 16,
      tags: ['ok', 'range:1'],
      anim: { state: 'ok' },
    });
    expect(frame.camera).toEqual({ x: 48, y: 32, bounds: { x: 0, y: 0, w: 96, h: 64 } });
    expect(frame.events).toEqual([]);
  });

  it('tags the ghost blocked with the reason: a path cell, an occupied cell, too little gold', () => {
    const w = world();
    const ghost = (c: { col: number; row: number; tower: string }) =>
      byId(presentWorld(w, { size: SIZE, cursor: c }), 'ghost')?.tags;
    expect(ghost(cursor(2, 0))).toEqual(['blocked', 'why:not_build_cell', 'range:1']);
    w.place('arrow', 1, 1);
    w.step();
    // On a tower (selected, Engine 0.16 E7): that tower's range, whatever tower is chosen.
    expect(ghost(cursor(1, 1))).toEqual(['blocked', 'why:occupied', 'selected', 'range:1']);
    expect(ghost(cursor(1, 1, 'cannon'))).toEqual(['blocked', 'why:occupied', 'selected', 'range:1']);
    expect(ghost(cursor(3, 1, 'cannon'))).toEqual(['blocked', 'why:too_poor', 'range:2']);
    expect(ghost(cursor(3, 1))).toEqual(['ok', 'range:1']);
  });

  it('leaves the cursor, ghost and tower status out without a cursor, and the ghost once the round is over', () => {
    const w = world();
    const plain = presentWorld(w, { size: SIZE });
    expect(plain.entities).toEqual([]);
    expect(plain.status.tower).toBeUndefined();
    w.startWave();
    stepUntil(w, (x) => x.outcome !== 'playing', 1000);
    expect(w.outcome).toBe('lost');
    const over = presentWorld(w, { size: SIZE, cursor: cursor(1, 1) });
    expect(byId(over, 'ghost')).toBeUndefined();
    expect(byId(over, 'cursor')).toBeDefined();
    expect(over.status.outcome).toBe('lost');
    expect(over.status.nextWave).toBeUndefined();
  });

  it('shows towers by type, enemies with facing and hp, and the shots fired this step', () => {
    const w = world();
    w.place('arrow', 1, 1);
    w.place('cannon', 3, 1);
    w.gold = 100;
    w.startWave();
    stepUntil(w, (x) => x.events.some((e) => e.type === 'fire'));
    const frame = presentWorld(w, { size: SIZE });
    valid(frame);
    const fire = w.events.find((e) => e.type === 'fire')!;
    if (fire.type !== 'fire') throw new Error('no fire');
    const tower = byId(frame, `tower-${fire.tower}`)!;
    expect(tower.kind).toMatch(/^tower:(arrow|cannon)$/);
    expect(tower.anim.state).toBe('fire');
    expect(tower.tags).toContain('cooling');
    const enemy = byId(frame, `enemy-${fire.enemy}`);
    if (fire.hp > 0) {
      expect(enemy?.tags).toEqual(expect.arrayContaining([`hp:${fire.hp}`, 'hit', 'wave:1']));
      expect(enemy?.fx).toEqual({ tint: 'hit' });
    }
    expect(byId(frame, `shot-${fire.tower}`)).toMatchObject({
      tags: [`from:tower-${fire.tower}`, `target:enemy-${fire.enemy}`],
    });
    expect(frame.events.find((e) => e.type === 'td-shot')).toMatchObject({
      entity: `enemy-${fire.enemy}`,
      from: `tower-${fire.tower}`,
      damage: fire.damage,
      hp: fire.hp,
    });
    for (const e of frame.entities.filter((x) => x.kind.startsWith('enemy:'))) {
      expect(['right', 'down']).toContain(e.facing);
      expect(Number.isInteger(e.x) && Number.isInteger(e.y)).toBe(true);
    }
  });

  it('slides an enemy along the path in whole pixels and faces the way it walks', () => {
    const w = world();
    expect(enemyPlace(w, { progress: 0 })).toEqual({ x: 0, y: 0, facing: 'right' });
    expect(enemyPlace(w, { progress: CELL_SUB / 2 })).toEqual({ x: 8, y: 0, facing: 'right' });
    expect(enemyPlace(w, { progress: 2 * CELL_SUB + 4 })).toEqual({ x: 32, y: 4, facing: 'down' });
    expect(enemyPlace(w, { progress: 7 * CELL_SUB })).toEqual({ x: 80, y: 32, facing: 'right' });
    expect(enemyPlace(w, { progress: 3 }, 8)).toEqual({ x: 1, y: 0, facing: 'right' });
  });

  it('faces towers one of eight ways toward a target', () => {
    expect(facingToward(5, 0)).toBe('right');
    expect(facingToward(-5, 1)).toBe('left');
    expect(facingToward(0, -3)).toBe('up');
    expect(facingToward(1, 4)).toBe('down');
    expect(facingToward(3, 3)).toBe('down-right');
    expect(facingToward(-2, -3)).toBe('up-left');
    expect(facingToward(0, 0)).toBe('down');
  });

  it('changes nothing in the round: hashes are the same with or without presenting', () => {
    const run = (present: boolean) => {
      const w = world();
      w.place('arrow', 1, 1);
      w.startWave();
      const hashes: string[] = [];
      for (let i = 0; i < 120; i++) {
        w.step();
        if (present) presentWorld(w, { size: SIZE, cursor: cursor(3, 1) });
        hashes.push(canonicalJson(w.snapshot()));
      }
      return hashes;
    };
    expect(run(true)).toEqual(run(false));
  });
});

describe('the frame stream and its events', () => {
  /** Plays the fixture round through a `FrameStream`, every frame checked; returns them all. */
  function play(towers: [string, number, number][]) {
    const w = world();
    for (const [t, c, r] of towers) w.place(t, c, r);
    w.startWave();
    const stream = new FrameStream(tdFrames(SIZE, () => cursor(2, 3)));
    const frames: DeepReadonly<PresentFrame>[] = [stream.next(w, [])];
    while (w.outcome === 'playing' && w.tick < 1000) frames.push(stream.next(w, w.step()));
    for (const f of frames) valid(f);
    return frames;
  }
  const keys = (frames: DeepReadonly<PresentFrame>[]) =>
    frames.flatMap((f) =>
      f.events.map((e) => (e.type === 'td-end' ? `${e.type}:${String(e.result)}` : e.type)),
    );

  it('sends the map once, then only its id and version', () => {
    const frames = play([]);
    expect(frames[0]!.map && isFullMap(frames[0]!.map)).toBe(true);
    expect(frames[1]!.map).toEqual({ id: 'td:tiny', version: 1 });
  });

  it('gives place, wave start, shot, kill, wave clear and won events, each wave cleared once', () => {
    const frames = play([
      ['arrow', 1, 1],
      ['arrow', 3, 1],
    ]);
    const seen = keys(frames);
    for (const k of [
      'td-place',
      'td-wave-start',
      'td-spawn',
      'td-shot',
      'td-kill',
      'td-wave-clear',
      'td-end:won',
    ])
      expect(seen).toContain(k);
    expect(seen).not.toContain('td-leak');
    const clears = frames.flatMap((f) => f.events.filter((e) => e.type === 'td-wave-clear'));
    expect(clears).toEqual([
      { type: 'td-wave-clear', wave: 1, waves: 2 },
      { type: 'td-wave-clear', wave: 2, waves: 2 },
    ]);
    expect(frames.at(-1)!.events.at(-1)).toEqual({ type: 'td-end', result: 'won' });
    const place = frames.flatMap((f) => f.events).find((e) => e.type === 'td-place');
    expect(place).toEqual({ type: 'td-place', x: 24, y: 24, entity: 'tower-1', tower: 'arrow', cost: 10 });
    const kill = frames.flatMap((f) => f.events).find((e) => e.type === 'td-kill');
    expect(kill).toMatchObject({ kind: 'runner', bounty: 3 });
    expect(typeof kill?.x).toBe('number');
    for (const t of new Set(frames.flatMap((f) => f.events.map((e) => e.type))))
      expect(TD_EVENT_TYPES as readonly string[]).toContain(t);
  });

  it('gives leak events at the exit and a lost end when nothing is built', () => {
    const frames = play([]);
    const leaks = frames.flatMap((f) => f.events.filter((e) => e.type === 'td-leak'));
    expect(leaks.length).toBe(3);
    expect(leaks[0]).toMatchObject({ x: 88, y: 40, lives: 2 });
    expect(keys(frames)).toContain('td-end:lost');
    expect(keys(frames)).not.toContain('td-end:won');
  });

  it('passes refusals and sales through', () => {
    const w = world();
    const state = new TdPresentState();
    w.place('arrow', 2, 0);
    w.place('arrow', 1, 1);
    w.step();
    const a = presentWorld(w, { size: SIZE, state });
    expect(a.events).toEqual([
      { type: 'td-refused', command: 'place', code: 'not_build_cell' },
      { type: 'td-place', x: 24, y: 24, entity: 'tower-1', tower: 'arrow', cost: 10 },
    ]);
    w.sell(1, 1);
    w.step();
    expect(presentWorld(w, { size: SIZE, state }).events).toEqual([
      { type: 'td-sell', x: 24, y: 24, entity: 'tower-1', tower: 'arrow', refund: 5 },
    ]);
  });

  it('does not report a wave cleared before the stream started', () => {
    const w = world();
    w.place('arrow', 1, 1);
    w.place('arrow', 3, 1);
    w.startWave();
    stepUntil(w, (x) => x.wavesStarted === 1 && x.waveLeft(1) === 0, 400);
    const stream = new FrameStream(tdFrames(SIZE));
    expect(stream.next(w, []).events).toEqual([]);
  });
});

describe('upgrades (Engine 0.16 E3)', () => {
  const leveled = () => {
    const r = fixtureRound();
    const arrow = { ...r.towers.arrow!, levels: [{ cost: 5, range: 2 }] };
    return new TdWorld({ ...r, towers: { ...r.towers, arrow } }, { seed: 3 });
  };

  it('tags towers with their level and range, and the selected tower in the status', () => {
    const w = leveled();
    w.gold = 100;
    w.place('arrow', 1, 1);
    w.place('cannon', 3, 1);
    w.step();
    let frame = presentWorld(w, { size: SIZE, cursor: cursor(1, 1) });
    valid(frame);
    expect(byId(frame, 'tower-1')?.tags).toEqual(expect.arrayContaining(['level:1', 'range:1']));
    expect(byId(frame, 'tower-2')?.tags).toEqual(expect.arrayContaining(['level:1', 'range:2']));
    expect(frame.status).toMatchObject({ selected: 'tower-1', sellValue: 5, upgradeCost: 5 });
    const state = new TdPresentState();
    w.upgrade(1, 1);
    w.step();
    frame = presentWorld(w, { size: SIZE, cursor: cursor(1, 1), state });
    expect(byId(frame, 'tower-1')?.tags).toEqual(expect.arrayContaining(['level:2', 'range:2']));
    expect(frame.status).toMatchObject({ selected: 'tower-1', sellValue: 7 });
    expect(frame.status.upgradeCost).toBeUndefined();
    expect(frame.events).toEqual([
      { type: 'td-upgrade', x: 24, y: 24, entity: 'tower-1', tower: 'arrow', level: 2, cost: 5 },
    ]);
    expect(TD_EVENT_TYPES).toContain('td-upgrade');
    const cannon = presentWorld(w, { size: SIZE, cursor: cursor(3, 1) }).status;
    expect(cannon).toMatchObject({ selected: 'tower-2', sellValue: 20 });
    expect(cannon.upgradeCost).toBeUndefined();
    const empty = presentWorld(w, { size: SIZE, cursor: cursor(2, 3) }).status;
    expect(empty.selected).toBeUndefined();
    expect(empty.sellValue).toBeUndefined();
  });
});

describe('splash, slow, health bars, the wave preview and stars (Engine 0.16 E4)', () => {
  /** The fixture round with a splashing, slowing cannon and a star rating. */
  const shells = (stars = true) => {
    const r = fixtureRound();
    const cannon = { ...r.towers.cannon!, splash: { radius: 1, damage: 1 }, slow: { factor: 50, ticks: 6 } };
    const map = stars ? { ...r.map, stars: { three: 3, two: 2 } } : r.map;
    return new TdWorld({ ...r, map, towers: { ...r.towers, cannon } }, { seed: 3 });
  };

  it('tags enemies with their max hp and while slowed, and gives splash and slow events', () => {
    const w = shells();
    w.gold = 100;
    w.place('cannon', 3, 1);
    w.startWave();
    const stream = new FrameStream(tdFrames(SIZE, () => cursor(1, 1)));
    const frames: DeepReadonly<PresentFrame>[] = [stream.next(w, [])];
    while (w.outcome === 'playing' && w.tick < 1000) frames.push(stream.next(w, w.step()));
    for (const f of frames) valid(f);
    const enemies = frames.flatMap((f) => f.entities.filter((e) => e.id.startsWith('enemy-')));
    expect(enemies.length).toBeGreaterThan(0);
    for (const e of enemies) expect(e.tags).toContain(e.kind === 'enemy:brute' ? 'maxhp:6' : 'maxhp:2');
    expect(enemies.some((e) => e.tags.includes('slow'))).toBe(true);
    const tower = frames.at(-1)!.entities.find((e) => e.id === 'tower-1')!;
    expect(tower.tags).toEqual(expect.arrayContaining(['range:2', 'splash:1', 'slows']));
    const events = frames.flatMap((f) => f.events);
    const splash = events.find((e) => e.type === 'td-splash');
    expect(splash).toMatchObject({ from: 'tower-1', tower: 'cannon', damage: 1 });
    expect(splash).toHaveProperty('fromX');
    expect(events.find((e) => e.type === 'td-slow')).toMatchObject({ from: 'tower-1', factor: 50, ticks: 6 });
    const shots = events.filter((e) => e.type === 'td-shot');
    expect(shots.every((e) => typeof e.splash === 'number')).toBe(true);
    expect(shots.some((e) => (e.splash as number) > 0)).toBe(true);
    expect(TD_EVENT_TYPES).toEqual(expect.arrayContaining(['td-splash', 'td-slow']));
    expect(w.outcome).toBe('won');
    expect(frames.at(-1)!.status.stars).toBe(3);
    expect(frames[0]!.status.stars).toBe(0);
  });

  it('previews the next wave in the status until every wave has started', () => {
    const w = shells(false);
    let status = presentWorld(w, { size: SIZE }).status;
    expect(status).toMatchObject({ nextWaveKinds: 'runner', nextWaveGroups: 'runner:2' });
    expect(status.stars).toBeUndefined();
    w.startWave();
    w.step();
    status = presentWorld(w, { size: SIZE }).status;
    expect(status).toMatchObject({
      waveNumber: 1,
      nextWaveKinds: 'brute,runner',
      nextWaveGroups: 'brute:1,runner:2',
    });
    w.startWave();
    w.step();
    status = presentWorld(w, { size: SIZE }).status;
    expect(status.nextWaveKinds).toBeUndefined();
    expect(status.nextWaveGroups).toBeUndefined();
  });

  it('counts kills, waves held and enemies near the gate in the status (Engine 0.16 E9)', () => {
    const w = world();
    w.startWave();
    let nearSeen = 0;
    let status = presentWorld(w, { size: SIZE }).status;
    expect(status).toMatchObject({ killed: 0, wavesHeld: 0, nearGate: 0 });
    while (w.outcome === 'playing' && w.tick < 400) {
      w.step();
      status = presentWorld(w, { size: SIZE }).status;
      const near = w.enemies.filter((e) => e.progress >= w.pathEnd - TD_NEAR_GATE_CELLS * CELL_SUB);
      expect(status.nearGate).toBe(near.length);
      nearSeen = Math.max(nearSeen, near.length);
      expect(status.killed).toBe(w.stats.killed);
      if (w.waveLeft(1) > 0) expect(status.wavesHeld).toBe(0);
    }
    // No tower: the first wave walks to the gate (the whole tiny path is near it) and leaks.
    expect(nearSeen).toBeGreaterThan(0);
    expect(w.waveLeft(1)).toBe(0);
    const held = [1, 2].filter((n) => n <= w.wavesStarted && w.waveLeft(n) === 0).length;
    expect(held).toBeGreaterThan(0);
    expect(presentWorld(w, { size: SIZE }).status.wavesHeld).toBe(held);
  });

  it('changes nothing in a round with splash and slow: hashes are the same presented or not', () => {
    const run = (present: boolean) => {
      const w = shells();
      w.gold = 100;
      w.place('cannon', 3, 1);
      w.startWave();
      const hashes: string[] = [];
      for (let i = 0; i < 200; i++) {
        if (i === 40) w.startWave();
        w.step();
        if (present) presentWorld(w, { size: SIZE, cursor: cursor(3, 1) });
        hashes.push(canonicalJson(w.snapshot()));
      }
      return hashes;
    };
    expect(run(true)).toEqual(run(false));
  });
});
