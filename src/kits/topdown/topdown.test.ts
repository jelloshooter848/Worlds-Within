import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/input/actions';
import { NullRenderer, type Renderer } from '@engine/gfx/renderer';
import type { SpriteSheet } from '@engine/gfx/spritesheet';
import { ScriptedInput } from '@engine/input/scripted-input';
import { buildDungeon, parseRoom, type RoomDef } from './room';
import { TopDownWorld, type TdEvent } from './world';
import { Pickup, PushBlock, ENEMY_INVULN, FloorSwitch, Torch } from './entity';
import { Rock, SPIT_WINDUP, ROCK_SPEED, type Bat, type Knight, type Spitter } from './enemies';
import {
  ATTACK_FRAMES,
  DEATH_FRAMES,
  HERO_INVULN,
  KNOCK_FRAMES,
  KNOCK_PX,
  SWORD_FIRST,
  SWORD_LAST,
  swordReach,
  swordAt,
} from './hero';
import { ROOM_H, ROOM_W, TILE, boxesOverlap } from './geometry';
import { SIDE_FRAMES, THICK_SIDE_FRAMES, rotateCcw, withSideFrames } from './frames';
import { drawTdHud, hudData } from './hud';
import { DEFAULT_SHEETS, type TdView } from './view';
import { drawRoomTiles } from './render';

/** A room def from rows (16×11), at a map cell. */
function room(id: string, at: [number, number], map: string[], extra: Partial<RoomDef> = {}): RoomDef {
  return { id, at, map, ...extra };
}

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
function map(at: [number, number, string][], base = EMPTY): string[] {
  const rows = base.map((r) => r.split(''));
  for (const [c, r, ch] of at) (rows[r] as string[])[c] = ch;
  return rows.map((r) => r.join(''));
}

/** A west room (start) and an east room joined by a doorway of `door` on row 5. */
function twoRooms(
  door: 'O' | 'L' | 'X',
  westExtra: [number, number, string][] = [],
  opts: Partial<RoomDef> = {},
) {
  const west = room('west', [0, 0], map([[7, 5, '@'], [15, 5, door], ...westExtra]), opts);
  const east = room('east', [1, 0], map([[0, 5, door === 'X' ? 'O' : door]]));
  return buildDungeon([west, east]);
}

class Pad {
  readonly input = new ScriptedInput({ steps: [] });
  constructor(readonly world: TopDownWorld) {}
  step(held: Action[] = [], n = 1): TdEvent[] {
    const out: TdEvent[] = [];
    for (let i = 0; i < n; i++) {
      this.input.setHeld(held);
      this.input.next();
      this.world.update(this.input);
      out.push(...this.world.events.splice(0));
    }
    return out;
  }
  /** Holds until `until` or `max` frames. */
  until(held: Action[], until: () => boolean, max = 600): number {
    for (let i = 0; i < max; i++) {
      if (until()) return i;
      this.step(held);
    }
    throw new Error('timed out');
  }
  stab(): TdEvent[] {
    const e = this.step(['attack']);
    e.push(...this.step([], ATTACK_FRAMES));
    return e;
  }
}

function setup(d = twoRooms('O'), seed = 1) {
  const world = new TopDownWorld(d, { seed });
  world.events.length = 0;
  return { world, pad: new Pad(world), hero: world.hero };
}

describe('top-down kit: rooms from text', () => {
  it('parses tiles, doors, spawns and the start', () => {
    const r = parseRoom(
      room(
        'r',
        [2, 1],
        map([
          [7, 0, 'X'],
          [8, 0, 'X'],
          [0, 5, 'L'],
          [3, 3, 'B'],
          [4, 4, '~'],
          [5, 5, 'b'],
          [6, 6, 'P'],
          [7, 7, '@'],
        ]),
        { shutters: 'clear' },
      ),
    );
    expect(r.gx).toBe(2);
    expect(r.gy).toBe(1);
    expect(r.doors).toEqual({ n: 'shutter', w: 'locked' });
    expect(r.doorCells).toEqual({ n: [7, 8], w: [5] });
    expect(r.tiles[3 * 16 + 3]).toBe('block');
    expect(r.tiles[4 * 16 + 4]).toBe('water');
    expect(r.tiles[5 * 16 + 5]).toBe('floor'); // a bat stands on floor
    expect(r.spawns.map((s) => [s.kind, s.x, s.y])).toEqual([
      ['bat', 80, 80],
      ['push-block', 96, 96],
    ]);
    expect(r.start).toEqual({ x: 112, y: 112 });
  });

  it.each([
    ['a short row', EMPTY.map((l, i) => (i === 3 ? l.slice(1) : l)), /row 3: 15 columns/],
    ['too few rows', EMPTY.slice(1), /10 rows/],
    ['an unknown character', map([[3, 3, '?']]), /row 3 col 3: unknown character "\?"/],
    ['a door inside', map([[3, 3, 'O']]), /must be on an edge/],
    ['a door on a corner', map([[0, 0, 'O']]), /must be on an edge/],
    [
      'a doorway of two kinds',
      map([
        [7, 0, 'O'],
        [8, 0, 'L'],
      ]),
      /mixes open and locked/,
    ],
    ['a hole in the border', map([[0, 4, '.']]), /border must be wall/],
    ['shutters with no condition', map([[0, 4, 'X']]), /need a `shutters` condition/],
  ])('rejects %s', (_name, rows, msg) => {
    expect(() => parseRoom(room('bad', [0, 0], rows))).toThrow(msg);
  });

  it('checks a dungeon: one start, doors that lead somewhere and line up', () => {
    const a = room(
      'a',
      [0, 0],
      map([
        [7, 5, '@'],
        [15, 5, 'O'],
      ]),
    );
    expect(() => buildDungeon([a])).toThrow(/east|e door leads nowhere/);
    const wall = room('b', [1, 0], EMPTY);
    expect(() => buildDungeon([a, wall])).toThrow(/meets a wall/);
    const off = room('b', [1, 0], map([[0, 4, 'O']]));
    expect(() => buildDungeon([a, off])).toThrow(/does not line up/);
    expect(() => buildDungeon([room('x', [0, 0], EMPTY)])).toThrow(/no room has a player start/);
    const ok = buildDungeon([a, room('b', [1, 0], map([[0, 5, 'O']]))]);
    expect(ok.roomAt(1, 0)?.id).toBe('b');
    expect([ok.cols, ok.rows]).toEqual([2, 1]);
  });
});

describe('top-down kit: movement and collision', () => {
  it('walks 1.5 px a frame and stops flush against walls on both axes', () => {
    const { pad, hero } = setup();
    expect([hero.x, hero.y]).toEqual([112, 80]);
    pad.step(['left'], 10);
    expect(hero.x).toBe(112 - 15);
    pad.step(['left'], 200);
    expect(hero.x).toBe(TILE - 1); // feet box (x+1) flush with the wall's right edge
    pad.step(['up'], 200);
    expect(hero.y).toBe(TILE - 8); // feet (lower half) against the top wall; the head overlaps it
    pad.step(['down'], 300);
    expect(hero.y).toBe(160 - 16);
    expect(hero.facing).toBe('down');
  });

  it('slides onto the half-tile grid before turning (doorways line up)', () => {
    const { pad, hero } = setup();
    pad.step(['down'], 1); // 1 px: off the 8-px grid
    expect(hero.y % 8).not.toBe(0);
    const y = hero.y;
    pad.step(['right'], 1);
    expect(hero.x).toBe(112); // first back onto the grid...
    expect(hero.y).toBe(Math.round(y / 8) * 8);
    pad.step(['right'], 2);
    expect(hero.x).toBeGreaterThan(112); // ...then on along the new direction
  });

  it('the most recently pressed of two directions wins', () => {
    const { pad, hero } = setup();
    pad.step(['up']);
    pad.step(['up', 'right'], 4);
    expect(hero.facing).toBe('right');
  });

  it('water, blocks and statues stop the hero and walkers; bats fly over them, shots over water', () => {
    const d = twoRooms('O', [
      [8, 4, '~'],
      [8, 5, '~'],
      [8, 6, '~'],
      [6, 4, 'B'],
      [6, 5, 'B'],
      [6, 6, 'B'],
      [7, 4, 'S'],
    ]);
    const { world, pad, hero } = setup(d);
    pad.step(['right'], 20);
    expect(hero.x).toBe(112 + 1); // into the water tile's edge only (feet box x+1..x+15)
    pad.step(['left'], 20);
    expect(hero.x).toBe(96 + 16 - 1);
    pad.step(['up'], 20);
    expect(hero.y).toBe(64 + 16 - 8);
    const water = { x: 128, y: 80, w: 16, h: 16 };
    expect(world.blocked(water, 'walk')).toBe(true);
    expect(world.blocked(water, 'fly')).toBe(false);
    expect(world.blocked(water, 'shot')).toBe(false);
    expect(world.blocked({ x: 96, y: 80, w: 16, h: 16 }, 'fly')).toBe(false);
    expect(world.blocked({ x: 0, y: 32, w: 16, h: 16 }, 'fly')).toBe(true);
  });
});

describe('top-down kit: doors, keys and shutters', () => {
  it('a two-cell doorway is one 16-px door in the middle: its jambs are solid, and the hero rounds the corner into it', () => {
    const d = buildDungeon([
      room(
        'south',
        [0, 1],
        map([
          [7, 0, 'O'],
          [8, 0, 'O'],
          [7, 8, '@'],
        ]),
      ),
      room(
        'north',
        [0, 0],
        map([
          [7, 10, 'O'],
          [8, 10, 'O'],
        ]),
      ),
    ]);
    const { world, pad, hero } = setup(d);
    expect(hero.x).toBe(112); // half a tile left of the door's middle
    expect(world.blocked(hero.feet(112, 0), 'hero')).toBe(true); // in the left jamb
    expect(world.blocked(hero.feet(120, 0), 'hero')).toBe(false);
    pad.until(['up'], () => world.room.id === 'north');
    expect(hero.x).toBe(120);
  });

  it('an open doorway slides the view to the next room and lands the hero in its doorway', () => {
    const { world, pad, hero } = setup();
    const events = pad.step(['right'], 90);
    expect(world.transition).not.toBeNull();
    expect(world.room.id).toBe('east');
    expect(events).toContainEqual({ type: 'room', id: 'east', first: true });
    expect(world.transition?.frames).toBe(ROOM_W / 4);
    const x = hero.x;
    pad.step(['right'], 10); // nothing moves during the slide
    expect(hero.x).toBe(x);
    pad.step([], 64);
    expect(world.transition).toBeNull();
    pad.step(['right'], 10);
    expect(hero.x).toBeGreaterThan(x);
    expect(world.visited().sort()).toEqual(['east', 'west']);
  });

  it('a locked door stops the hero without a key and opens with one (both sides, key used)', () => {
    const { world, pad, hero } = setup(twoRooms('L'));
    pad.step(['right'], 120);
    expect(world.room.id).toBe('west');
    expect(hero.x).toBe(ROOM_W - TILE - 15); // feet flush against the door
    world.keys = 1;
    const events = pad.step(['right'], 30);
    expect(events).toContainEqual({ type: 'unlock', side: 'e' });
    expect(world.keys).toBe(0);
    expect(world.state('west').unlocked.has('e')).toBe(true);
    expect(world.state('east').unlocked.has('w')).toBe(true);
    pad.until(['right'], () => world.room.id === 'east');
  });

  it("shutters stay open until the hero steps in, then close until the room's condition is met", () => {
    const d = buildDungeon([
      room(
        'west',
        [0, 0],
        map([
          [7, 5, '@'],
          [15, 5, 'O'],
        ]),
      ),
      room(
        'east',
        [1, 0],
        map([
          [0, 5, 'X'],
          [10, 5, 'n'],
        ]),
        { shutters: 'clear' },
      ),
    ]);
    const { world, pad, hero } = setup(d);
    pad.until(['right'], () => world.room.id === 'east' && !world.transition);
    expect(world.doorOpen('w')).toBe(true); // still in the doorway
    const events = pad.step(['right'], 16);
    expect(world.sealed).toBe(true);
    expect(world.doorOpen('w')).toBe(false);
    expect(events).toContainEqual({ type: 'shutters', open: false });
    // Walking back into the shut door goes nowhere.
    pad.step(['left'], 30);
    expect(hero.x).toBeGreaterThanOrEqual(TILE - 1);
    expect(world.room.id).toBe('east');
    // Kill the knight: the shutters open, for good.
    for (const k of world.enemies()) k.hurt(world, 9, 'right');
    const after = pad.step([], 2);
    expect(after).toContainEqual({ type: 'met', cond: 'clear' });
    expect(after).toContainEqual({ type: 'shutters', open: true });
    expect(world.doorOpen('w')).toBe(true);
  });
});

describe('top-down kit: push blocks and switches', () => {
  /** A plate two tiles right of a loose block; a shutter north opens on 'plates'. */
  const blockRooms = () =>
    buildDungeon([
      room(
        'puzzle',
        [0, 1],
        map([
          [7, 0, 'X'],
          [8, 0, 'X'],
          [15, 5, 'O'],
          [5, 5, 'P'],
          [7, 5, 'o'],
          [3, 8, '@'],
        ]),
        { shutters: 'plates' },
      ),
      room(
        'north',
        [0, 0],
        map([
          [7, 10, 'O'],
          [8, 10, 'O'],
        ]),
      ),
      room('east', [1, 1], map([[0, 5, 'O']])),
    ]);

  it('leaning on the loose block pushes it a tile at a time; on the plate the shutter opens', () => {
    const { world, pad, hero } = setup(blockRooms());
    hero.x = 4 * TILE;
    hero.y = 5 * TILE;
    pad.step(['up']); // step in (seal)
    hero.y = 5 * TILE;
    const block = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    pad.step(['right'], 8);
    expect(block.x).toBe(5 * TILE); // not yet: lean a moment first
    pad.until(['right'], () => block.x === 6 * TILE && !block.moving);
    expect(world.doorOpen('n')).toBe(false);
    const events: TdEvent[] = [];
    for (let i = 0; i < 200 && !(block.x === 7 * TILE && !block.moving); i++)
      events.push(...pad.step(['right']));
    events.push(...pad.step([], 2));
    expect(events.map((e) => e.type)).toEqual(expect.arrayContaining(['push', 'met', 'shutters']));
    expect(world.doorOpen('n')).toBe(true);
    expect(block.fixed).toBe(true); // stays on its plate
    pad.step(['right'], 60);
    expect(block.x).toBe(7 * TILE);
  });

  it('leaning on the block from half a tile off slides onto its column and the push takes', () => {
    const { world, pad, hero } = setup(blockRooms());
    const block = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    hero.x = 5 * TILE + 8; // half over the block's column
    hero.y = 3 * TILE;
    pad.until(['down'], () => block.y === 6 * TILE && !block.moving, 200);
    expect(hero.x).toBe(5 * TILE);
  });

  it('a block pushed into a corner comes back when the room is left and re-entered', () => {
    const { world, pad, hero } = setup(blockRooms());
    hero.x = 6 * TILE;
    hero.y = 5 * TILE;
    // Push it left into the west wall: it can't be pulled back.
    let block = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    pad.until(['left'], () => block.x === TILE && !block.moving, 400);
    expect(world.met('plates')).toBe(false);
    // Out the east door and back in.
    hero.x = 13 * TILE;
    hero.y = 5 * TILE;
    pad.until(['right'], () => world.room.id === 'east');
    pad.until(['left'], () => world.room.id === 'puzzle' && !world.transition);
    block = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    expect([block.x, block.y]).toEqual([5 * TILE, 5 * TILE]);
    expect(block.fixed).toBe(false);
  });

  it('once solved, the room remembers: the block stays on the plate and the door stays open', () => {
    const { world, pad, hero } = setup(blockRooms());
    world.warpTo('puzzle', 4 * TILE, 5 * TILE);
    const block = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    pad.until(['right'], () => block.x === 7 * TILE && !block.moving, 400);
    pad.step([], 2);
    hero.x = 13 * TILE;
    pad.until(['right'], () => world.room.id === 'east');
    pad.until(['left'], () => world.room.id === 'puzzle' && !world.transition);
    pad.step(['left'], 30); // step in: seal
    const again = world.entities.find((e) => e instanceof PushBlock) as PushBlock;
    expect([again.x, again.fixed]).toEqual([7 * TILE, true]);
    expect(world.doorOpen('n')).toBe(true);
  });

  it('a floor switch latches when stepped on; torches light from the sword', () => {
    const d = buildDungeon([
      room(
        'r',
        [0, 0],
        map([
          [7, 5, '@'],
          [9, 5, '_'],
          [7, 3, 't'],
        ]),
      ),
    ]);
    const { world, pad } = setup(d);
    const sw = world.entities.find((e) => e instanceof FloorSwitch) as FloorSwitch;
    const events = pad.step(['right'], 24);
    expect(sw.pressed).toBe(true);
    expect(events).toContainEqual({ type: 'switch' });
    pad.step(['left'], 40);
    expect(sw.pressed).toBe(true);
    expect(world.met('switches')).toBe(true);
    const torch = world.entities.find((e) => e instanceof Torch) as Torch;
    world.hero.x = 7 * TILE;
    world.hero.y = 4 * TILE + 8;
    pad.step(['up']);
    world.hero.y = 4 * TILE + 8;
    pad.stab();
    expect(torch.lit).toBe(true);
    expect(world.met('torches')).toBe(true);
  });
});

describe('top-down kit: sword and damage', () => {
  function withKnight() {
    const d = buildDungeon([
      room(
        'r',
        [0, 0],
        map([
          [7, 5, '@'],
          [9, 5, 'n'],
        ]),
      ),
    ]);
    const s = setup(d);
    const k = s.world.enemies()[0] as Knight;
    return { ...s, k };
  }

  it('a stab hits what is in front: one hit, knockback along the stab, a short invulnerability', () => {
    const { world, pad, hero, k } = withKnight();
    k.x = 128;
    k.y = 80;
    k.update = () => undefined; // hold still for the test (no AI)
    hero.facing = 'right';
    const events = pad.step(['attack']);
    expect(hero.attacking).toBe(true);
    events.push(...pad.step([], SWORD_FIRST + 1));
    expect(events).toContainEqual({ type: 'sword' });
    expect(events).toContainEqual({ type: 'hit', kind: 'knight' });
    expect(k.hp).toBe(1);
    expect(k.invuln).toBeGreaterThan(0);
    expect(k.kbDir).toBe('right');
    expect(k.kbT).toBeGreaterThan(0);
    // The same stab doesn't hit twice.
    pad.step([], ATTACK_FRAMES);
    expect(k.hp).toBe(1);
    expect(ENEMY_INVULN).toBeLessThan(ATTACK_FRAMES + 4);
    expect(world.enemies()).toHaveLength(1);
  });

  it('a knight knocked back slides 16 px, stops at walls, and dies on the second hit', () => {
    const { world, pad, hero, k } = withKnight();
    Object.assign(k, { think: () => undefined }); // no walking: only the knockback moves it
    k.x = 128;
    k.y = 80;
    hero.facing = 'right';
    pad.step(['attack']);
    pad.step([], SWORD_FIRST + 1);
    pad.step([], 4);
    expect(k.x).toBe(128 + 16);
    // Against the east wall it stops flush.
    k.invuln = 0;
    k.x = 13 * TILE + 8;
    k.hurt(world, 0, 'right');
    pad.step([], 4);
    expect(k.x).toBe(14 * TILE);
    pad.step([], ATTACK_FRAMES); // the first stab is over
    k.invuln = 0;
    k.x = 128;
    k.y = 80;
    const events = pad.stab();
    expect(k.dead).toBe(true);
    expect(events).toContainEqual({ type: 'kill', kind: 'knight' });
    expect(world.enemies()).toHaveLength(0);
  });

  it('the stab only reaches in front: nothing behind is hit, and one stab runs at a time', () => {
    const { pad, hero, k } = withKnight();
    k.x = 80;
    k.y = 80;
    k.update = () => undefined;
    hero.facing = 'right';
    pad.stab();
    expect(k.hp).toBe(2);
    pad.step(['attack']);
    const t = hero.attackT;
    pad.step([]);
    pad.step(['attack']); // mashing doesn't restart it
    expect(hero.attackT).toBe(t - 2);
    expect(boxesOverlap(swordAt(0, 0, 'up'), { x: 0, y: -12, w: 16, h: 4 })).toBe(true);
  });

  it('a monster coming in at an angle walks into the stab: it is hit and knocked back, the hero is not', () => {
    const { pad, hero, k } = withKnight();
    // Down and to the left, toward the hero's upper right: past the old thin blade's reach.
    k.x = 130;
    k.y = 56;
    Object.assign(k, {
      think: () => {
        k.x -= 1;
        k.y += 1;
      },
    });
    hero.facing = 'right';
    const events: TdEvent[] = [];
    for (let i = 0; i < 40; i++) events.push(...pad.step(hero.attacking || i % 2 ? [] : ['attack']));
    expect(events).toContainEqual({ type: 'hit', kind: 'knight' });
    expect(k.hp).toBeLessThan(2);
    expect(hero.hp).toBe(6);
    expect(events.some((e) => e.type === 'hurt')).toBe(false);
  });

  it('the blade wins ties: a monster touching the hero and the blade on the same frame does no harm', () => {
    const { pad, hero, k } = withKnight();
    k.update = () => undefined;
    hero.facing = 'right';
    pad.step(['attack']);
    pad.step([], SWORD_FIRST);
    // Now on the hero's shoulder and in the blade at once.
    k.x = hero.x + 10;
    k.y = hero.y - 6;
    const events = pad.step([]);
    expect(events).toContainEqual({ type: 'hit', kind: 'knight' });
    expect(hero.hp).toBe(6);
  });

  it('the stab covers the whole tile in front plus a little to each side, and stays out longer', () => {
    for (const d of ['up', 'down', 'left', 'right'] as const) {
      const reach = swordReach(0, 0, d);
      const v = { up: [0, -16], down: [0, 16], left: [-16, 0], right: [16, 0] }[d] as [number, number];
      const tile = { x: v[0], y: v[1], w: 16, h: 16 };
      // The tile in front is inside it, with room to spare across the stab.
      expect(reach.x).toBeLessThanOrEqual(tile.x - (v[0] === 0 ? 3 : 0));
      expect(reach.y).toBeLessThanOrEqual(tile.y - (v[1] === 0 ? 3 : 0));
      expect(reach.x + reach.w).toBeGreaterThanOrEqual(tile.x + 16 + (v[0] === 0 ? 3 : 0));
      expect(reach.y + reach.h).toBeGreaterThanOrEqual(tile.y + 16 + (v[1] === 0 ? 3 : 0));
    }
    expect(SWORD_LAST - SWORD_FIRST).toBeGreaterThan(8);
  });

  it('touching an enemy costs half a heart, knocks the hero back and makes him invulnerable', () => {
    const { world, pad, hero, k } = withKnight();
    k.update = () => undefined;
    k.x = hero.x + 10;
    k.y = hero.y;
    const events = pad.step([]);
    expect(hero.hp).toBe(5);
    expect(events).toContainEqual({ type: 'hurt', hp: 5 });
    expect(hero.invuln).toBe(HERO_INVULN);
    expect(hero.kbDir).toBe('left');
    pad.step([], KNOCK_FRAMES);
    expect(hero.x).toBe(112 - KNOCK_FRAMES * KNOCK_PX);
    k.x = hero.x + 10;
    pad.step([], 5);
    expect(hero.hp).toBe(5); // still invulnerable
    expect(world.hero.dying).toBe(0);
  });

  it('a rock hurts from the front, from the side and while stabbing (no shield)', () => {
    const d = buildDungeon([room('r', [0, 0], map([[7, 5, '@']]))]);
    const { world, pad, hero } = setup(d);
    hero.facing = 'right';
    world.add(new Rock(hero.x + 40, hero.y + 4, 'left'));
    let events = pad.step([], 30);
    expect(events).not.toContainEqual({ type: 'block' });
    expect(hero.hp).toBe(5);
    // From above, while facing right.
    hero.invuln = 0;
    world.add(new Rock(hero.x + 4, hero.y - 40, 'down'));
    events = pad.step([], 30);
    expect(events).toContainEqual({ type: 'hurt', hp: 4 });
    // From the front, mid-stab.
    hero.invuln = 0;
    hero.facing = 'right';
    hero.x = 112;
    hero.y = 80;
    world.add(new Rock(hero.x + 24, hero.y + 4, 'left'));
    pad.step(['attack']);
    expect(pad.step([], 12)).toContainEqual({ type: 'hurt', hp: 3 });
    expect(hero.hp).toBe(3);
    expect(ROCK_SPEED).toBeGreaterThan(1);
  });

  it('half-heart damage down to nothing: a death spin, a puff, then dead', () => {
    const d = buildDungeon([room('r', [0, 0], map([[7, 5, '@']]))]);
    const { world, pad, hero } = setup(d);
    hero.hp = 1;
    hero.hurt(world, 1, 'down');
    expect(hero.hp).toBe(0);
    expect(hero.dying).toBe(1);
    const facings = new Set<string>();
    const events: TdEvent[] = [];
    for (let i = 0; i < DEATH_FRAMES + 5; i++) {
      events.push(...pad.step(['right', 'attack']));
      facings.add(hero.facing);
    }
    expect(facings.size).toBe(4); // he spins
    expect(hero.dead).toBe(true);
    expect(events.filter((e) => e.type === 'dead')).toHaveLength(1);
    expect(hero.x).toBe(112); // and nothing moves him
  });

  it('dead monsters sometimes leave a heart (seeded); a heart gives a heart back', () => {
    const d = buildDungeon([
      room(
        'r',
        [0, 0],
        map([
          [7, 5, '@'],
          [3, 3, 'b'],
        ]),
      ),
    ]);
    let drops = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { world } = setup(d, seed);
      (world.enemies()[0] as Bat).die(world);
      if (world.entities.some((e) => e instanceof Pickup && e.kind === 'heart')) drops++;
    }
    expect(drops).toBeGreaterThan(4);
    expect(drops).toBeLessThan(25);
    // A heart dropped over a statue lands on the nearest walkable tile.
    const s = setup(
      buildDungeon([
        room(
          'r',
          [0, 0],
          map([
            [7, 5, '@'],
            [3, 3, 'S'],
            [5, 5, 'b'],
          ]),
        ),
      ]),
      7,
    );
    const bat = s.world.enemies()[0] as Bat;
    bat.dropChance = 1;
    bat.x = 3 * TILE;
    bat.y = 3 * TILE;
    bat.die(s.world);
    const heart = s.world.entities.find((e) => e instanceof Pickup) as Pickup;
    expect(s.world.blocked(heart.hurtbox(), 'hero')).toBe(false);
    expect(Math.abs(heart.x - 3 * TILE) + Math.abs(heart.y - 3 * TILE)).toBeLessThanOrEqual(2 * TILE);
    const { world, pad, hero } = setup(d);
    hero.hp = 2;
    world.add(new Pickup(hero.x + 4, hero.y + 4, 'heart'));
    const events = pad.step([]);
    expect(hero.hp).toBe(4);
    expect(events).toContainEqual({ type: 'pickup', kind: 'heart' });
  });
});

describe('top-down kit: enemies', () => {
  const open = (ch: string, seed = 3) =>
    setup(
      buildDungeon([
        room(
          'r',
          [0, 0],
          map([
            [1, 9, '@'],
            [7, 5, ch],
          ]),
        ),
      ]),
      seed,
    );

  it('a bat flutters about in all directions, rests now and then, and stays in the room', () => {
    const { world, pad } = open('b');
    const bat = world.enemies()[0] as Bat;
    const seenDx = new Set<number>();
    const seenDy = new Set<number>();
    let rested = 0;
    let px = bat.x;
    let py = bat.y;
    world.hero.invuln = 100000;
    for (let i = 0; i < 1200; i++) {
      pad.step([]);
      seenDx.add(Math.sign(bat.x - px));
      seenDy.add(Math.sign(bat.y - py));
      if (bat.resting) rested++;
      px = bat.x;
      py = bat.y;
      expect(bat.x).toBeGreaterThanOrEqual(TILE);
      expect(bat.y).toBeGreaterThanOrEqual(TILE);
      expect(bat.x).toBeLessThanOrEqual(ROOM_W - 2 * TILE);
    }
    expect([...seenDx].sort()).toEqual([-1, 0, 1]);
    expect([...seenDy].sort()).toEqual([-1, 0, 1]);
    expect(rested).toBeGreaterThan(30);
    expect(bat.hp).toBe(1);
  });

  it('a knight walks the tile grid and turns only on a tile; two hits', () => {
    const { world, pad } = open('n');
    const k = world.enemies()[0] as Knight;
    world.hero.invuln = 100000;
    const facings = new Set<string>();
    let last = k.facing;
    for (let i = 0; i < 900; i++) {
      const at = [k.x % TILE, k.y % TILE];
      pad.step([]);
      if (k.facing !== last) {
        expect(at).toEqual([0, 0]); // it turned standing on a tile
        last = k.facing;
      }
      facings.add(k.facing);
    }
    expect(facings.size).toBeGreaterThanOrEqual(3);
    expect(k.hp).toBe(2);
  });

  it('a spitter stops, faces its way and spits a rock straight along it', () => {
    const { world, pad } = open('r');
    const s = world.enemies()[0] as Spitter;
    world.hero.invuln = 100000;
    pad.until([], () => s.stopT > 0, 400);
    const x = s.x;
    const y = s.y;
    const events = pad.step([], SPIT_WINDUP);
    expect([s.x, s.y]).toEqual([x, y]);
    expect(events).toContainEqual({ type: 'spit' });
    const rock = world.entities.find((e) => e instanceof Rock) as Rock;
    expect(rock.dir).toBe(s.facing);
    const rx = rock.x;
    const ry = rock.y;
    pad.step([], 3);
    if (rock.dead) return; // it was facing a wall
    expect(Math.sign(rock.x - rx) + Math.sign(rock.y - ry)).not.toBe(0);
    expect(rock.x === rx || rock.y === ry).toBe(true);
  });
});

describe('top-down kit: drawing helpers', () => {
  it("the 32-px door frames are derived only for a sheet that draws them (one-tile-wall sheets don't)", () => {
    expect(SIDE_FRAMES).not.toContain('door-open-thick');
    expect(THICK_SIDE_FRAMES).toContain('door-open-thick');
    const thin = withSideFrames({ palette: 'p', frames: { wall: ['12'], 'door-open': ['11'] } });
    expect(thin.frames['door-open-side']).toBeDefined();
    expect(thin.frames['wall-side']).toBeDefined();
    expect(thin.frames['door-open-thick-side']).toBeUndefined();
    const thick = withSideFrames({ palette: 'p', frames: { 'door-open-thick': ['12', '34'] } });
    expect(thick.frames['door-open-thick-side']).toEqual(['24', '13']);
  });

  it('rotates a north frame to face west (top edge becomes the left edge)', () => {
    expect(rotateCcw(['12', '34'])).toEqual(['24', '13']);
    const def = withSideFrames({
      palette: 'p',
      frames: { 'door-open': ['11', '..'], 'wall-top-side': ['x'] },
    });
    expect(def.frames['door-open-side']).toEqual(['1.', '1.']);
    expect(def.frames['wall-top-side']).toEqual(['x']); // a drawn one is kept
    const split = withSideFrames({
      palette: 'p',
      frames: { 'wall-top': ['1111', '2222'], 'exit-0': ['abcd', 'efgh'] },
    });
    expect(split.frames['exit-0-l']).toEqual(['11ab', '22ef']);
    expect(split.frames['exit-0-r']).toEqual(['cd11', 'gh22']);
  });

  it('the HUD shows the title, the item by its ability name, whole, half and empty hearts, and keys', () => {
    const frames: string[] = [];
    const texts: string[] = [];
    const sheet: SpriteSheet = {
      id: 's',
      image: null,
      frames: new Map(
        ['heart', 'heart-half', 'heart-empty', 'key', 'sword-icon'].map((f) => [
          f,
          { x: 0, y: 0, w: 8, h: 8 },
        ]),
      ),
    };
    const none = new NullRenderer();
    const r: Renderer = {
      ...none,
      clear: none.clear,
      rect: none.rect,
      line: none.line,
      debugText: none.debugText,
      sprite: (_s, f) => void frames.push(f),
      text: (_f, t) => void texts.push(t),
    };
    const view: TdView = { frame: 0, reduceFlashing: true, sheets: DEFAULT_SHEETS, sheet: () => sheet };
    const { world } = setup();
    world.hero.hp = 3;
    world.keys = 2;
    drawTdHud(r, view, hudData(world, 'TEST KEEP', [{ label: 'SWORD', frame: 'sword-icon' }]));
    expect(texts).toEqual(expect.arrayContaining(['TEST KEEP', 'SWORD', '-LIFE-', '×2']));
    expect(frames.filter((f) => f.startsWith('heart'))).toEqual(['heart', 'heart-half', 'heart-empty']);
  });
});

describe("top-down kit: Zelda's rooms (2-tile walls, a 12×7 floor)", () => {
  const THICK = [
    '################',
    '################',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '##............##',
    '################',
    '################',
  ];
  const thick = (at: [number, number, string][]) => map(at, THICK);
  /** Both cells of a doorway through the wall (n/s: two columns × two rows; e/w: one row × two). */
  const door = (side: 'n' | 's' | 'e' | 'w', ch: string): [number, number, string][] =>
    side === 'n'
      ? [
          [7, 0, ch],
          [8, 0, ch],
          [7, 1, ch],
          [8, 1, ch],
        ]
      : side === 's'
        ? [
            [7, 9, ch],
            [8, 9, ch],
            [7, 10, ch],
            [8, 10, ch],
          ]
        : side === 'w'
          ? [
              [0, 5, ch],
              [1, 5, ch],
            ]
          : [
              [14, 5, ch],
              [15, 5, ch],
            ];
  const opts = { wall: 2 };

  it('parses a room with walls two tiles thick: doors run through both, a 12×7 floor inside', () => {
    const r = parseRoom(
      room('r', [0, 0], thick([...door('n', 'X'), ...door('w', 'L'), [2, 2, 'b'], [7, 6, '@']]), {
        shutters: 'clear',
      }),
      {},
      2,
    );
    expect(r.wall).toBe(2);
    expect(r.doors).toEqual({ n: 'shutter', w: 'locked' });
    expect(r.doorCells).toEqual({ n: [7, 8], w: [5] });
    expect(r.tiles.filter((t) => t === 'floor').length).toBe(12 * 7);
    expect(r.spawns.map((s) => [s.kind, s.x, s.y])).toEqual([['bat', 32, 32]]);
  });

  it.each([
    [
      'a door only through the outer row',
      thick([
        [7, 0, 'O'],
        [8, 0, 'O'],
      ]),
      /through the whole wall/,
    ],
    ['a hole in the inner wall row', thick([[5, 1, '.']]), /border must be wall/],
    ['a door in the corner', thick([[1, 1, 'O']]), /must be on an edge/],
  ])('rejects %s', (_name, rows, msg) => {
    expect(() => parseRoom(room('bad', [0, 0], rows), {}, 2)).toThrow(msg);
  });

  function thickRooms(
    westDoor: string,
    eastDoor: string,
    eastOpts: Partial<RoomDef> = {},
    east: [number, number, string][] = [],
  ) {
    return buildDungeon(
      [
        room('west', [0, 0], thick([[7, 5, '@'], ...door('e', westDoor)])),
        room('east', [1, 0], thick([...door('w', eastDoor), ...east]), eastOpts),
      ],
      {},
      opts,
    );
  }

  it('the hero stops flush against the inner wall row on every side', () => {
    const { pad, hero } = setup(thickRooms('O', 'O'));
    pad.step(['left'], 200);
    expect(hero.x).toBe(2 * TILE - 1);
    pad.step(['up'], 200);
    expect(hero.y).toBe(2 * TILE - 8);
    pad.step(['down'], 300);
    expect(hero.y).toBe(ROOM_H - 2 * TILE - 16);
  });

  it('through a doorway: the screen scrolls, then Link walks himself in past the wall before he answers the pad', () => {
    const { world, pad, hero } = setup(thickRooms('O', 'O'));
    pad.until(['right'], () => world.room.id === 'east');
    pad.until([], () => !world.transition);
    expect(hero.x).toBeLessThan(2 * TILE); // still in the doorway
    expect(world.walkingIn).toBe(true);
    pad.step(['left'], 4); // ignored: he keeps walking in
    expect(hero.facing).toBe('right');
    pad.until([], () => !world.walkingIn, 60);
    expect(hero.x).toBe(2 * TILE);
    expect(hero.y).toBe(5 * TILE);
    pad.step(['left'], 4);
    expect(hero.x).toBeLessThan(2 * TILE);
  });

  it("a knockback never throws him out through a doorway: he stops at the floor's edge", () => {
    const { world, pad, hero } = setup(thickRooms('O', 'O'));
    hero.x = ROOM_W - 4 * TILE; // two tiles short of the east doorway, in line with it
    hero.y = 5 * TILE;
    hero.hurt(world, 1, 'right');
    pad.step([], 20);
    expect(world.room.id).toBe('west');
    expect(world.transition).toBeNull();
    expect(hero.x).toBe(ROOM_W - 3 * TILE + 1); // feet flush with the floor's edge
  });

  it('a hit while he is still walking in from the doorway never sends him back to the room he left', () => {
    const { world, pad, hero } = setup(thickRooms('O', 'O'));
    pad.until(['right'], () => world.room.id === 'east');
    pad.until([], () => !world.transition);
    pad.until([], () => hero.x >= TILE, 60); // the last 16 px of the walk in
    expect(world.onFloor(hero.feet())).toBe(false);
    hero.hurt(world, 1, 'left'); // knocked back toward the doorway he came through
    pad.step([], 30);
    expect(world.room.id).toBe('east');
    expect(world.transition).toBeNull();
    expect(hero.x).toBeGreaterThanOrEqual(TILE);
  });

  it('the shutters slam behind him once he has walked in', () => {
    const { world, pad } = setup(thickRooms('O', 'X', { shutters: 'clear' }, [[10, 5, 'n']]));
    const events: TdEvent[] = [];
    for (let i = 0; i < 400 && (world.room.id !== 'east' || world.transition || world.walkingIn); i++)
      events.push(...pad.step(['right']));
    events.push(...pad.step([], 1));
    expect(world.sealed).toBe(true);
    expect(events).toContainEqual({ type: 'shutters', open: false });
  });

  it('draws the wall band as brick with a ledge row facing the floor, mitred corners and 32-px doors', () => {
    const calls: [string, number, number][] = [];
    const frames = new Map<string, { x: number; y: number; w: number; h: number }>();
    for (const f of [
      'wall',
      'wall-side',
      'wall-top',
      'wall-top-side',
      'wall-corner',
      'floor',
      'door-open-thick',
      'door-locked-thick-side',
    ])
      frames.set(f, { x: 0, y: 0, w: 16, h: 16 });
    const sheet: SpriteSheet = { id: 's', image: null, frames };
    const none = new NullRenderer();
    const r: Renderer = {
      ...none,
      clear: none.clear,
      rect: none.rect,
      line: none.line,
      debugText: none.debugText,
      text: none.text,
      sprite: (_s, f, x, y) => void calls.push([f, x, y]),
    };
    const view: TdView = { frame: 0, reduceFlashing: true, sheets: DEFAULT_SHEETS, sheet: () => sheet };
    const rm = parseRoom(room('r', [0, 0], thick([...door('n', 'O'), ...door('w', 'L')])), {}, 2);
    drawRoomTiles(r, view, rm, (s) => (s === 'w' ? 'locked' : 'open'), 0, 64);
    const at = (x: number, y: number) => calls.filter((c) => c[1] === x && c[2] === y).map((c) => c[0]);
    expect(at(48, 64)).toEqual(['wall']); // outer row
    expect(at(48, 80)).toEqual(['wall-top']); // the row facing the floor
    expect(at(16, 80)).toEqual(['wall-corner']);
    expect(at(0, 64)).toEqual(['wall']);
    expect(at(16, 96)).toEqual(['wall-top-side']);
    expect(at(0, 96)).toEqual(['wall-side']); // the side band's bricks run the same way throughout
    expect(at(240, 96)).toEqual(['wall-side']);
    expect(at(112, 64)).toContain('door-open-thick'); // one 32×32 door over the doorway
    expect(at(0, 64 + 72)).toContain('door-locked-thick-side'); // centred on row 5
    expect(calls.filter((c) => c[0] === 'door-open-thick').length).toBe(1);
  });
});

describe("top-down kit: the dungeon's map and compass", () => {
  /** West (start, a map and a compass on the floor), east, and a goal room north of east. */
  const threeRooms = () =>
    buildDungeon([
      room(
        'west',
        [0, 1],
        map([
          [7, 5, '@'],
          [15, 5, 'O'],
          [9, 5, 'm'],
          [9, 7, 'v'],
        ]),
      ),
      room(
        'east',
        [1, 1],
        map([
          [0, 5, 'O'],
          [7, 0, 'O'],
          [8, 0, 'O'],
        ]),
      ),
      room(
        'goal',
        [1, 0],
        map([
          [7, 10, 'O'],
          [8, 10, 'O'],
        ]),
        { goal: true },
      ),
    ]);

  it('without the map the minimap shows the rooms seen; the map shows them all; the compass marks the goal', () => {
    const { world, pad } = setup(threeRooms());
    let hud = hudData(world, 'L', []);
    expect(hud.map.visited).toEqual([[0, 1]]);
    expect(hud.map.goal).toBeNull();
    const at = (kind: string) => world.entities.find((e) => e instanceof Pickup && e.kind === kind) as Pickup;
    world.hero.x = at('map').x - 4;
    world.hero.y = at('map').y;
    const events = pad.step();
    expect(events).toContainEqual({ type: 'pickup', kind: 'map' });
    expect(world.found.has('map')).toBe(true);
    expect(world.inv.owned).toEqual([]); // not an item for the slot
    hud = hudData(world, 'L', []);
    expect(hud.map.visited.length).toBe(1);
    expect([...hud.map.known].sort()).toEqual([
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    world.hero.x = at('compass').x;
    world.hero.y = at('compass').y;
    pad.step();
    expect(hudData(world, 'L', []).map.goal).toEqual([1, 0]);
  });

  it('draws the map as Zelda does: small rooms on an 8×8 grid, the hero a green dot, the goal a red one', () => {
    const rects: [number, number, number, number, string][] = [];
    const none = new NullRenderer();
    const r: Renderer = {
      ...none,
      clear: none.clear,
      line: none.line,
      debugText: none.debugText,
      text: none.text,
      sprite: none.sprite,
      rect: (x, y, w, h, c) => void rects.push([x, y, w, h, c]),
    };
    const view: TdView = { frame: 0, reduceFlashing: true, sheets: DEFAULT_SHEETS, sheet: () => null };
    const { world } = setup(threeRooms());
    world.found.add('map');
    world.found.add('compass');
    drawTdHud(r, view, hudData(world, 'L', []));
    const blue = rects.filter((c) => c[4] === '#2038ec' && c[2] === 7 && c[3] === 3);
    expect(blue.length).toBe(3); // every room, 7×3 in an 8×4 cell
    expect(rects.some((c) => c[4] === '#00e800' && c[2] === 3)).toBe(true);
    expect(rects.some((c) => c[4] === '#f83800' && c[2] === 3)).toBe(true);
  });
});
