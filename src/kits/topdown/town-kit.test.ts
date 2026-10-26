import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/input/actions';
import { NullRenderer, type Renderer } from '@engine/gfx/renderer';
import type { SpriteSheet } from '@engine/gfx/spritesheet';
import { ScriptedInput } from '@engine/input/scripted-input';
import { buildDungeon, type RoomDef } from './room';
import { TopDownWorld, type TdEvent } from './world';
import { TdWalker, WALK_STEPS, RUN_STEPS } from './walker';
import { TdPerson, talkTarget } from './person';
import { ROOM_H, ROOM_W, TILE } from './geometry';
import { DEFAULT_SHEETS, type TdView } from './view';
import { renderWorld } from './render';

// 0.4.41 (Kakariko Village): what the top-down kit gained for a town. Outdoor screens with open
// edges (`wall: 0`), an art layer (each cell's pictures), building doors inside a room
// (`entrances`, paired by id, with an optional `needs` lock), the eight-way walker (Jason's
// walk, moved into the kit) and a townsperson to talk to.

const GRASS = '................';
const TREES = '################';

/** An outdoor screen: grass, trees along the rows given. */
function outdoor(id: string, at: [number, number], rows: Partial<Record<number, string>> = {}): RoomDef {
  return {
    id,
    at,
    wall: 0,
    map: Array.from({ length: 11 }, (_, r) => rows[r] ?? GRASS),
  };
}

const walled = (id: string, at: [number, number], rows: Partial<Record<number, string>> = {}): RoomDef => ({
  id,
  at,
  map: [TREES, ...Array.from({ length: 9 }, (_, i) => rows[i + 1] ?? '#..............#'), rows[10] ?? TREES],
});

function input(): ScriptedInput {
  return new ScriptedInput({ steps: [] });
}

/** Runs `n` frames holding `held`; returns every event. */
function run(w: TopDownWorld, held: Action[], n: number): TdEvent[] {
  const inp = input();
  inp.setHeld(held);
  const out: TdEvent[] = [];
  for (let i = 0; i < n; i++) {
    inp.next();
    w.update(inp);
    out.push(...w.events.splice(0));
  }
  return out;
}

const walker = (x: number, y: number) => new TdWalker(x, y);

describe('TdWalker: eight ways at the kit pace, faster on RUN', () => {
  it('walks 1.5 px a frame, 2 with RUN, and diagonally on both axes at once', () => {
    expect(WALK_STEPS.reduce((a, b) => a + b, 0) / WALK_STEPS.length).toBe(1.5);
    expect(RUN_STEPS.reduce((a, b) => a + b, 0) / RUN_STEPS.length).toBe(2);
    const d = buildDungeon([{ ...outdoor('a', [0, 0], { 5: '.......@........' }) }]);
    const w = new TopDownWorld(d, { hero: walker });
    const x0 = w.hero.x;
    run(w, ['right'], 20);
    expect(w.hero.x - x0).toBe(30);
    expect(w.hero.facing).toBe('right');
    const x1 = w.hero.x;
    run(w, ['right', 'run'], 20);
    expect(w.hero.x - x1).toBe(40);
    const { x, y } = w.hero;
    run(w, ['left', 'up'], 10);
    expect([x - w.hero.x, y - w.hero.y]).toEqual([15, 15]);
  });

  it('slides along a wall when walking into it at an angle, and round a corner into a gap', () => {
    const d = buildDungeon([
      outdoor('a', [0, 0], {
        3: '#######.########',
        5: '.......@........',
      }),
    ]);
    const w = new TopDownWorld(d, { hero: walker });
    // Up and right at once into the trees: the up axis stops, the right one goes on.
    w.hero.y = 4 * TILE;
    const x0 = w.hero.x;
    run(w, ['up', 'right'], 6);
    expect(w.hero.x).toBeGreaterThan(x0);
    // Straight up a few px off the gap (column 7): nudged sideways into it, then through.
    w.hero.x = 7 * TILE + 5;
    w.hero.y = 4 * TILE + 4;
    run(w, ['up'], 40);
    expect(w.hero.y).toBeLessThan(3 * TILE);
  });
});

describe('open edges: outdoor screens slide into each other', () => {
  const twoScreens = () =>
    buildDungeon([outdoor('w', [0, 0], { 5: '.......@........' }), outdoor('e', [1, 0])]);

  it('walking off the east edge slides to the next screen, the hero on its west edge', () => {
    const w = new TopDownWorld(twoScreens(), { hero: walker });
    let ev: TdEvent[] = [];
    for (let i = 0; i < 200 && w.room.id === 'w'; i++) ev = run(w, ['right'], 1);
    expect(ev.some((e) => e.type === 'room' && e.id === 'e')).toBe(true);
    expect(w.transition?.side).toBe('e');
    expect(w.hero.x).toBe(0);
  });

  it("sliding down along an edge (not walking off it) keeps the screen; the slide speed is the world's", () => {
    const w = new TopDownWorld(twoScreens(), { hero: walker, slideSpeed: 8 });
    w.hero.x = 240;
    w.hero.y = 3 * TILE;
    w.hero.facing = 'down';
    run(w, ['down'], 30);
    expect(w.room.id).toBe('w');
    w.hero.x = 245;
    run(w, ['right'], 1);
    expect(w.room.id).toBe('e');
    expect(w.transition?.frames).toBe(ROOM_W / 8);
  });

  it('a solid edge cell stops the hero at the edge', () => {
    const d = buildDungeon([
      outdoor('w', [0, 0], { 5: '.......@.......#' }),
      outdoor('e', [1, 0], { 5: '#...............' }),
    ]);
    const w = new TopDownWorld(d, { hero: walker });
    run(w, ['right'], 200);
    expect(w.room.id).toBe('w');
    expect(w.hero.x + 13).toBeLessThanOrEqual(15 * TILE);
  });

  it('an edge with no screen past it is the way out: one `leave` event with its side', () => {
    const d = buildDungeon([outdoor('a', [0, 0], { 5: '.......@........' })]);
    const w = new TopDownWorld(d, { hero: walker });
    const ev = run(w, ['down'], 200);
    expect(ev.filter((e) => e.type === 'leave')).toEqual([{ type: 'leave', side: 's' }]);
    expect(w.left).toBe('s');
    expect(w.hero.y).toBeGreaterThan(ROOM_H - 16);
  });

  it('an open screen may not have doorways on its border; a walled one still checks its own', () => {
    expect(() =>
      buildDungeon([{ ...outdoor('a', [0, 0], { 0: '.......O........', 5: '@...............' }) }]),
    ).toThrow();
  });
});

describe('entrances: building doors inside a room', () => {
  const town = (needs?: string) =>
    buildDungeon([
      {
        ...outdoor('out', [0, 0], {
          2: '.....#####......',
          3: '.....##D##......',
          6: '.......@........',
        }),
        entrances: [
          { id: 'house', col: 7, row: 3, enter: 'up', to: 'house-in', ...(needs ? { needs } : {}) },
        ],
      },
      {
        ...walled('in', [5, 5], { 10: '#######D########' }),
        entrances: [{ id: 'house-in', col: 7, row: 10, enter: 'down', to: 'house' }],
      },
    ]);

  it('walking up into the door raises `enter`; going through puts the hero inside, one step in', () => {
    const w = new TopDownWorld(town(), { hero: walker });
    const ev = run(w, ['up'], 80);
    expect(ev.filter((e) => e.type === 'enter')).toEqual([{ type: 'enter', id: 'house', to: 'house-in' }]);
    expect(w.entering?.id).toBe('house');
    // Frozen until the game goes through (after its fade).
    const at = { x: w.hero.x, y: w.hero.y };
    run(w, ['up'], 10);
    expect({ x: w.hero.x, y: w.hero.y }).toEqual(at);
    w.goThrough();
    expect(w.room.id).toBe('in');
    expect(w.entering).toBeNull();
    expect(w.hero.facing).toBe('up');
    expect([w.hero.x, w.hero.y]).toEqual([7 * TILE, 9 * TILE]);
    // And back out: walking down onto the inside door, out onto the doorstep facing down.
    const back = run(w, ['down'], 60);
    expect(back.filter((e) => e.type === 'enter')).toEqual([{ type: 'enter', id: 'house-in', to: 'house' }]);
    w.goThrough();
    expect(w.room.id).toBe('out');
    expect(w.hero.facing).toBe('down');
    expect([w.hero.x, w.hero.y]).toEqual([7 * TILE, 4 * TILE]);
  });

  it("a door to something that is not a room (`@...`) is the game's to handle; arriveAt puts the hero back on its step", () => {
    const d = buildDungeon([
      {
        ...outdoor('out', [0, 0], { 2: '.....#####......', 3: '.....##D##......', 6: '.......@........' }),
        entrances: [{ id: 'secret', col: 7, row: 3, enter: 'up', to: '@level' }],
      },
    ]);
    const w = new TopDownWorld(d, { hero: walker });
    expect(run(w, ['up'], 80).find((e) => e.type === 'enter')).toEqual({
      type: 'enter',
      id: 'secret',
      to: '@level',
    });
    w.hero.x = 0;
    w.arriveAt('secret');
    expect(w.entering).toBeNull();
    expect([w.hero.x, w.hero.y, w.hero.facing]).toEqual([7 * TILE, 4 * TILE, 'down']);
  });

  it('the door lock: `needs` a secret the game says is not found keeps it shut (solid, one bump event a push)', () => {
    let found = false;
    const w = new TopDownWorld(town('moved-log'), { hero: walker, has: (s) => found && s === 'moved-log' });
    expect(w.entranceOpen(w.room.entrances[0]!)).toBe(false);
    const ev = run(w, ['up'], 80);
    expect(ev.filter((e) => e.type === 'enter')).toEqual([]);
    expect(ev.filter((e) => e.type === 'door-shut')).toEqual([
      { type: 'door-shut', id: 'house', needs: 'moved-log' },
    ]);
    expect(w.hero.y).toBeGreaterThanOrEqual(4 * TILE - 8);
    // Found: the same door opens.
    found = true;
    expect(w.entranceOpen(w.room.entrances[0]!)).toBe(true);
    expect(run(w, ['up'], 40).filter((e) => e.type === 'enter')).toHaveLength(1);
  });

  it('the dungeon checks its doors: paired both ways, ids unique, inside a room, on a walkable cell', () => {
    const one = (to: string) =>
      buildDungeon([
        {
          ...outdoor('out', [0, 0], { 3: '.......D........', 6: '.......@........' }),
          entrances: [{ id: 'a', col: 7, row: 3, enter: 'up', to }],
        },
        { ...walled('in', [5, 5]), entrances: [{ id: 'b', col: 7, row: 9, enter: 'down', to: 'a' }] },
      ]);
    expect(() => one('b')).not.toThrow();
    expect(() => one('nowhere')).toThrow(/leads to "nowhere"/);
    expect(() =>
      buildDungeon([
        {
          ...outdoor('out', [0, 0], { 3: '.......#........', 6: '.......@........' }),
          entrances: [{ id: 'a', col: 7, row: 3, enter: 'up', to: '@x' }],
        },
      ]),
    ).toThrow(/walkable/);
  });
});

describe('the art layer', () => {
  it('each cell draws its own pictures, bottom to top, from the tile sheet; a cell without art draws its tile', () => {
    const art = Array.from({ length: 176 }, (_, i) =>
      i === 0 ? ['grass', 'flower'] : i === 1 ? null : ['grass'],
    );
    const d = buildDungeon([{ ...outdoor('a', [0, 0], { 5: '.......@........' }), art }]);
    const w = new TopDownWorld(d, { hero: walker });
    const drawn: { frame: string; x: number; y: number }[] = [];
    const sheet: SpriteSheet = {
      id: 'town',
      image: null,
      frames: new Map(['grass', 'flower', 'floor'].map((f) => [f, { x: 0, y: 0, w: 16, h: 16 }])),
    };
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite(_s: SpriteSheet, frame: string, x: number, y: number) {
        drawn.push({ frame, x, y });
      },
    });
    const view: TdView = {
      frame: 0,
      reduceFlashing: true,
      sheets: { ...DEFAULT_SHEETS, tiles: 'town' },
      sheet: () => sheet,
    };
    renderWorld(r, view, w);
    const at = (x: number, y: number) => drawn.filter((s) => s.x === x && s.y === y).map((s) => s.frame);
    expect(at(0, 64)).toEqual(['grass', 'flower']);
    expect(at(16, 64)).toEqual(['floor']);
    expect(at(32, 64)).toEqual(['grass']);
  });
});

describe('TdPerson: someone to talk to', () => {
  const square = () => buildDungeon([{ ...outdoor('a', [0, 0], { 5: '.......@........' }) }]);

  it('is solid, and is the talk target only when the hero faces them from close by', () => {
    const w = new TopDownWorld(square(), { hero: walker });
    const p = new TdPerson(7 * TILE, 3 * TILE, { id: 'guard', name: 'GUARD', frames: 'guard' });
    w.add(p);
    expect(talkTarget(w)).toBeNull(); // a tile between them
    run(w, ['up'], 30);
    expect(w.hero.y).toBeGreaterThan(3 * TILE + 4); // stopped by the guard
    expect(talkTarget(w)).toBe(p);
    w.hero.facing = 'down';
    expect(talkTarget(w)).toBeNull();
    w.hero.facing = 'up';
    w.hero.y = 8 * TILE;
    expect(talkTarget(w)).toBeNull();
  });

  it('faces the hero while talking, then turns back; draws its idle frames, side frames mirrored', () => {
    const w = new TopDownWorld(square(), { hero: walker });
    const p = new TdPerson(4 * TILE, 5 * TILE, { id: 'woman', name: 'WOMAN', frames: 'woman' });
    w.add(p);
    w.hero.x = 6 * TILE;
    w.hero.y = 5 * TILE;
    p.faceToward(w.hero.feet());
    expect(p.facing).toBe('right');
    const drawn: { frame: string; flip: boolean }[] = [];
    const sheet: SpriteSheet = {
      id: 'folk',
      image: null,
      frames: new Map(['woman-0', 'woman-1', 'woman-side'].map((f) => [f, { x: 0, y: 0, w: 16, h: 16 }])),
    };
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite(_s: SpriteSheet, frame: string, _x: number, _y: number, flip = false) {
        drawn.push({ frame, flip });
      },
    });
    const view: TdView = { frame: 0, reduceFlashing: true, sheets: DEFAULT_SHEETS, sheet: () => sheet };
    p.render(r, view, 0, 0);
    expect(drawn.at(-1)).toEqual({ frame: 'woman-side', flip: false });
    p.facing = 'left';
    p.render(r, view, 0, 0);
    expect(drawn.at(-1)).toEqual({ frame: 'woman-side', flip: true });
    p.rest();
    expect(p.facing).toBe('down');
    for (let i = 0; i < 40; i++) p.update(w);
    p.render(r, view, 0, 0);
    expect(drawn.at(-1)?.frame).toBe('woman-1');
  });

  it('a sign is a person with no picture and no body (the tile under it is solid)', () => {
    const w = new TopDownWorld(square(), { hero: walker });
    const s = new TdPerson(7 * TILE, 3 * TILE, { id: 'sign', name: 'SIGN', frames: null, verb: 'READ' });
    expect(s.solid).toBe(false);
    w.add(s);
    w.hero.y = 4 * TILE;
    expect(talkTarget(w)?.verb).toBe('READ');
    expect(ROOM_W).toBe(256);
  });
});
