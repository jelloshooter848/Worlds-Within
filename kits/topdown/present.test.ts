import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/core/input/actions';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { validate } from '@engine/core/content/validate';
import {
  freezeFrame,
  isFullMap,
  presentFrameSchema,
  type PresentFrame,
  type PresentMap,
} from '@engine/core/present';
import { ROOM_COLS, ROOM_ROWS, ROOM_W, TILE } from './geometry';
import { HERO_INVULN } from './hero';
import { presentMap, presentWorld, TdPresentIds, TdPresentState, PRESENT_TILES } from './present';
import { buildDungeon, type RoomDef } from './room';
import { snapshotWorld } from './snapshot';
import { TopDownWorld, type TdEvent } from './world';

const EMPTY = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

/** Replaces characters of EMPTY: `at` is a list of [col, row, char]. */
function grid(at: [number, number, string][]): string[] {
  const rows = EMPTY.map((r) => r.split(''));
  for (const [c, r, ch] of at) (rows[r] as string[])[c] = ch;
  return rows.map((r) => r.join(''));
}

/**
 * A demo-like dungeon: a hall (start) with a locked door east, a bat, a key and water; a dark
 * east room with a cracked wall and a heart, back through the locked door.
 */
function dungeon(door: 'L' | 'O' = 'L') {
  const hall: RoomDef = {
    id: 'hall',
    at: [0, 0],
    map: grid([
      [7, 5, '@'],
      [15, 5, door],
      [3, 3, 'b'],
      [10, 7, 'k'],
      [4, 8, '~'],
    ]),
  };
  const east: RoomDef = {
    id: 'east',
    at: [1, 0],
    dark: true,
    map: grid([
      [0, 5, door],
      [8, 3, 'C'],
      [12, 7, 'h'],
    ]),
  };
  return buildDungeon([hall, east]);
}

function setup(door: 'L' | 'O' = 'L', seed = 7) {
  const world = new TopDownWorld(dungeon(door), { seed });
  const input = new ScriptedInput({ steps: [] });
  const step = (held: Action[] = [], n = 1): TdEvent[] => {
    const out: TdEvent[] = [];
    for (let i = 0; i < n; i++) {
      input.setHeld(held);
      input.next();
      world.update(input);
      out.push(...world.events.splice(0));
    }
    return out;
  };
  return { world, step };
}

function valid(frame: PresentFrame): void {
  const r = validate('frame.json', frame, presentFrameSchema);
  expect(r.errors).toEqual([]);
  expect(JSON.parse(JSON.stringify(frame))).toEqual(frame);
  expect(() => canonicalJson(frame)).not.toThrow();
}

describe('presentWorld', () => {
  it('describes the room, the hero, the HUD values and a camera hint', () => {
    const { world } = setup();
    const frame = presentWorld(world, world.events.splice(0));
    valid(frame);
    expect(frame.frame).toBe(0);
    expect(frame.size).toEqual({ width: 256, height: 240 });
    const map = frame.map as PresentMap;
    expect(isFullMap(map)).toBe(true);
    expect(map).toMatchObject({
      id: 'hall',
      tileSize: TILE,
      cols: ROOM_COLS,
      rows: ROOM_ROWS,
      tags: ['wall:1'],
    });
    expect(map.tiles[5]).toBe('#..............L');
    expect(map.tiles[8]).toBe('#...~..........#');
    expect(frame.entities).toEqual([
      expect.objectContaining({ id: 'hero', kind: 'hero', x: 112, y: 80, w: 16, h: 16, facing: 'up' }),
    ]);
    expect(frame.entities[0]!.anim).toEqual({ state: 'walk', t: 0 });
    expect(frame.status).toMatchObject({
      hp: 6,
      maxHp: 6,
      keys: 0,
      item: '',
      'ammo.bomb': 0,
      room: 'hall',
      mapX: 0,
      mapY: 0,
      mapCols: 2,
      mapRows: 1,
      visited: '0,0',
      hasMap: false,
      top: 64,
    });
    // The room's top-left lands 64 px down the picture: the picture's centre is world (128, 56).
    expect(frame.camera).toEqual({ x: 128, y: 56 });
    expect(frame.events).toEqual([{ type: 'room', id: 'hall', first: true }]);
  });

  it('follows the picture size and the HUD offset it is given', () => {
    const { world } = setup();
    const frame = presentWorld(world, [], { size: { width: 320, height: 200 }, top: 24 });
    valid(frame);
    expect(frame.size).toEqual({ width: 320, height: 200 });
    expect(frame.camera).toEqual({ x: 160, y: 76 });
    expect(frame.status['top']).toBe(24);
  });

  it('does not change the world: a run presenting every tick gives the same snapshots', () => {
    const play = (present: boolean): string[] => {
      const { world, step } = setup('O');
      const state = new TdPresentState();
      const out: string[] = [];
      const script: Action[][] = [['right'], ['attack'], [], ['down'], ['right'], ['right']];
      for (let i = 0; i < 240; i++) {
        const events = step(script[Math.floor(i / 40)] ?? []);
        if (present) {
          valid(presentWorld(world, events, { state }));
          presentWorld(world, events);
        }
        out.push(canonicalJson(snapshotWorld(world, events)));
      }
      return out;
    };
    expect(play(true)).toEqual(play(false));
  });

  it('sends the map again only when the room or its tiles change', () => {
    const { world, step } = setup();
    const state = new TdPresentState();
    const sent = () => isFullMap(presentWorld(world, [], { state }).map!);
    expect(sent()).toBe(true);
    expect(sent()).toBe(false);
    step(['left'], 5);
    expect(sent()).toBe(false);
    // Open the locked door: the tiles change, so the version does and the map is sent again.
    const before = presentMap(world).map.version;
    world.keys = 1;
    let events: TdEvent[] = [];
    for (let i = 0; i < 120 && !events.some((e) => e.type === 'unlock'); i++) {
      events = step(['right']);
      if (!events.some((e) => e.type === 'unlock')) expect(sent()).toBe(false);
    }
    expect(world.room.id).toBe('hall');
    const opened = presentWorld(world, events, { state });
    expect(isFullMap(opened.map!)).toBe(true);
    expect(opened.map!.version).not.toBe(before);
    expect(sent()).toBe(false);
  });

  it('bumps the version when a door opens and only then', () => {
    const { world } = setup();
    const a = presentMap(world).map;
    expect(presentMap(world).map.version).toBe(a.version);
    world.state().unlocked.add('e');
    const b = presentMap(world).map;
    expect(b.version).not.toBe(a.version);
    expect(b.tiles[5]).toBe(`#..............${PRESENT_TILES['door-open']}`);
    expect(Number.isInteger(b.version) && b.version >= 0).toBe(true);
  });

  it('presents a room slide as both rooms in one map, with the camera scrolling across', () => {
    const { world, step } = setup('O');
    const state = new TdPresentState();
    let frame = presentWorld(world, [], { state });
    for (let i = 0; i < 200 && !world.transition; i++)
      frame = presentWorld(world, step(['right']), { state });
    expect(world.transition).not.toBeNull();
    valid(frame);
    expect(frame.events).toContainEqual({ type: 'room', id: 'east', first: true });
    const map = frame.map as PresentMap;
    expect(isFullMap(map)).toBe(true);
    expect(map).toMatchObject({ id: 'hall>east', cols: 32, rows: 11 });
    expect(map.tags).toEqual(['slide', 'slide:e', 'wall:1', 'dark', 'from-wall:1']);
    expect(map.tiles[5]).toBe('#..............OO..............#');
    // The hero rides in the east room, which sits at x 256 in the map.
    expect(frame.entities[0]!.x).toBe(ROOM_W + world.hero.x);
    expect(frame.camera).toEqual({ x: 128, y: 56 }); // the slide's first frame: still on the hall
    step();
    frame = presentWorld(world, [], { state });
    expect(frame.map).toEqual({ id: 'hall>east', version: map.version }); // only the camera moved
    const tr = world.transition!;
    const shift = Math.round((tr.t / tr.frames) * ROOM_W);
    expect(frame.camera).toEqual({ x: shift + 128, y: 56 });
    step([], 70);
    expect(world.transition).toBeNull();
    const after = presentWorld(world, [], { state });
    expect(after.map).toMatchObject({ id: 'east', tags: ['wall:1', 'dark'] });
    expect(isFullMap(after.map!)).toBe(true);
    expect((after.map as PresentMap).tiles[3]).toBe('#.......C......#');
    expect(after.status).toMatchObject({ room: 'east', mapX: 1, visited: '0,0 1,0' });
  });

  it('gives the hero his animation state and tags, flashing only without reduce flashing', () => {
    const { world, step } = setup();
    step(['attack']);
    let hero = presentWorld(world).entities;
    expect(hero.map((e) => e.id)).toEqual(['hero', 'hero/sword']);
    expect(hero[0]!.anim).toEqual({ state: 'attack', t: 0 });
    step();
    expect(presentWorld(world).entities[0]!.anim).toEqual({ state: 'attack', t: 1 });
    world.hero.attackT = 0;
    world.hero.invuln = HERO_INVULN;
    world.hero.kbT = 4;
    hero = presentWorld(world).entities;
    expect(hero[0]!.anim.state).toBe('hurt');
    expect(hero[0]!.tags).toEqual(['invuln', 'flashing']);
    expect(presentWorld(world, [], { reduceFlashing: true }).entities[0]!.tags).toEqual(['invuln', 'calm']);
    world.hero.kbT = 0;
    world.hero.invuln = 0;
    world.hero.holdUp('heart');
    hero = presentWorld(world).entities;
    expect(hero[0]!.anim).toEqual({ state: 'hold', t: 0 });
    expect(hero[0]!.tags).toEqual(['holding:heart']);
    world.hero.holdT = 0;
    world.hero.holding = null;
    world.hero.dying = 10;
    expect(presentWorld(world).entities[0]!.anim).toEqual({ state: 'dying', t: 9 });
    world.hero.dead = true;
    expect(presentWorld(world).entities).toEqual([]);
  });

  it('places hero events at the hero and an unlock at its doorway', () => {
    const { world, step } = setup();
    world.keys = 1;
    let events: TdEvent[] = [];
    for (let i = 0; i < 120 && !events.some((e) => e.type === 'unlock'); i++) events = step(['right']);
    const frame = presentWorld(world, events);
    valid(frame);
    const unlock = frame.events.find((e) => e.type === 'unlock');
    expect(unlock).toEqual({ type: 'unlock', side: 'e', x: ROOM_W - 8, y: 88 });
    const { world: w2, step: s2 } = setup();
    const sword = presentWorld(w2, s2(['attack'])).events.find((e) => e.type === 'sword');
    expect(sword).toEqual({ type: 'sword', entity: 'hero', x: 120, y: 88 });
  });

  it('gives a frame a backend can read but not change', () => {
    const { world } = setup();
    const frame = freezeFrame(presentWorld(world));
    expect(frame.entities[0]!.id).toBe('hero');
    expect(Object.isFrozen(frame.map)).toBe(true);
  });
});

describe('TdPresentIds', () => {
  it('names room-text things by room and cell, and others in order first seen', () => {
    const { world } = setup();
    const ids = new TdPresentIds();
    expect(world.entities.map((e) => ids.of(e, world.room.id))).toEqual(['hall/bat@3,3', 'hall/key@10,7']);
    const bat = world.entities[0]!;
    const loose = Object.assign(Object.create(Object.getPrototypeOf(bat) as object) as typeof bat, bat, {
      key: null,
    });
    const other = Object.assign(Object.create(Object.getPrototypeOf(bat) as object) as typeof bat, bat, {
      key: null,
    });
    expect(ids.of(loose, 'hall')).toBe('bat#1');
    expect(ids.of(other, 'hall')).toBe('bat#2');
    expect(ids.of(loose, 'hall')).toBe('bat#1');
  });
});
