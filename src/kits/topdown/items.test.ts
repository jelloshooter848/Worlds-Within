import { describe, expect, it } from 'vitest';
import type { Action } from '@engine/input/actions';
import { NullRenderer, type Renderer } from '@engine/gfx/renderer';
import type { SpriteSheet } from '@engine/gfx/spritesheet';
import { ScriptedInput } from '@engine/input/scripted-input';
import { buildDungeon, parseRoom, type RoomDef } from './room';
import { TopDownWorld, type TdEvent } from './world';
import { Chest, Pickup } from './entity';
import { Projectile, Rock, type Knight } from './enemies';
import {
  BLAST_RADIUS,
  BOMB_FUSE,
  BOOMERANG_RANGE,
  Bomb,
  Boomerang,
  DEFAULT_ITEMS,
  Explosion,
  Inventory,
  STUN_FRAMES,
} from './items';
import { HOLD_FRAMES, TdHero } from './hero';
import { TILE } from './geometry';
import { drawTdHud, hudData } from './hud';
import { DEFAULT_SHEETS, type TdView } from './view';

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

/** EMPTY with [col, row, char] replaced. */
function map(at: [number, number, string][], base = EMPTY): string[] {
  const rows = base.map((r) => r.split(''));
  for (const [c, r, ch] of at) (rows[r] as string[])[c] = ch;
  return rows.map((r) => r.join(''));
}

function world(defs: RoomDef[], opts: { noDamage?: () => boolean } = {}) {
  const w = new TopDownWorld(buildDungeon(defs), { seed: 1, ...opts });
  w.events.length = 0;
  const input = new ScriptedInput({ steps: [] });
  const step = (held: Action[] = [], n = 1): TdEvent[] => {
    const out: TdEvent[] = [];
    for (let i = 0; i < n; i++) {
      input.setHeld(held);
      input.next();
      w.update(input);
      out.push(...w.events.splice(0));
    }
    return out;
  };
  const tap = (a: Action): TdEvent[] => [...step([a]), ...step()];
  return { w, hero: w.hero, step, tap };
}

const one = (at: [number, number, string][], extra: Partial<RoomDef> = {}) =>
  world([{ id: 'r', at: [0, 0], map: map([[7, 5, '@'], ...at]), ...extra }]);

/** A knight that stands still (only knockback and stuns move or stop it). */
function stillKnight(w: TopDownWorld, x: number, y: number): Knight {
  const k = w.enemies().find((e) => e.kind === 'knight') as Knight;
  k.x = x;
  k.y = y;
  Object.assign(k, { think: () => undefined });
  return k;
}

describe('top-down kit: the item slot', () => {
  it('owns items in the order found, cycles the slot, and caps ammo', () => {
    const inv = new Inventory(DEFAULT_ITEMS);
    expect(inv.current).toBeNull();
    expect(inv.cycle()).toBe(false);
    inv.give('boomerang');
    expect(inv.current?.id).toBe('boomerang');
    expect(inv.give('boomerang')).toBe(false);
    inv.give('bomb');
    expect(inv.current?.id).toBe('boomerang'); // the slot stays put
    expect(inv.count('bomb')).toBe(4);
    expect(inv.cycle()).toBe(true);
    expect(inv.current?.id).toBe('bomb');
    inv.addAmmo('bomb', 99);
    expect(inv.count('bomb')).toBe(8);
    expect(inv.withAmmo().map((i) => i.id)).toEqual(['bomb']);
  });

  it('SPECIAL uses the item in the slot and SELECT moves it; nothing happens with none', () => {
    const { w, hero, tap } = one([]);
    expect(tap('special')).toEqual([]);
    expect(hero.useT).toBe(0);
    w.grant('boomerang');
    w.grant('bomb');
    expect(tap('select')).toContainEqual({ type: 'item-select', id: 'bomb' });
    expect(tap('select')).toContainEqual({ type: 'item-select', id: 'boomerang' });
  });
});

describe('top-down kit: the boomerang', () => {
  it('flies about five tiles along the facing, comes back and is caught; one in flight', () => {
    const { w, hero, step, tap } = one([]);
    w.grant('boomerang');
    hero.x = 2 * TILE;
    hero.facing = 'right';
    const events = tap('special');
    expect(events).toContainEqual({ type: 'item', id: 'boomerang' });
    expect(events).toContainEqual({ type: 'whirr' });
    const b = w.entities.find((e) => e instanceof Boomerang) as Boomerang;
    expect(b).toBeDefined();
    expect(w.itemUsable()).toBe(false);
    tap('special'); // a second throw while it is out: nothing
    expect(w.entities.filter((e) => e instanceof Boomerang)).toHaveLength(1);
    let far = 0;
    for (let i = 0; i < 200 && !b.dead; i++) {
      step();
      far = Math.max(far, b.x - hero.x);
    }
    expect(b.dead).toBe(true);
    expect(far).toBeGreaterThanOrEqual(BOOMERANG_RANGE - TILE);
    expect(far).toBeLessThanOrEqual(BOOMERANG_RANGE + TILE);
    expect(w.itemUsable()).toBe(true);
  });

  it('stuns a monster for about three seconds (it stops) and turns back at once', () => {
    const { w, hero, step, tap } = one([[10, 5, 'n']]);
    w.grant('boomerang');
    const k = w.enemies()[0] as Knight;
    k.x = 10 * TILE;
    k.y = 5 * TILE;
    hero.facing = 'right';
    tap('special');
    const b = w.entities.find((e) => e instanceof Boomerang) as Boomerang;
    const events: TdEvent[] = [];
    for (let i = 0; i < 30 && k.stunT === 0; i++) events.push(...step());
    expect(events).toContainEqual({ type: 'stun', kind: 'knight' });
    expect(k.stunT).toBeGreaterThan(STUN_FRAMES - 30);
    expect(b.out).toBe(false);
    expect(k.hp).toBe(2); // a stun, not a hit
    const at = { x: k.x, y: k.y };
    step([], 120);
    expect({ x: k.x, y: k.y }).toEqual(at);
    expect(k.stunT).toBeGreaterThan(0);
    step([], STUN_FRAMES);
    expect(k.stunT).toBe(0);
  });

  it('brings back hearts and keys it touches', () => {
    const { w, hero, step, tap } = one([[11, 5, 'k']]);
    w.grant('boomerang');
    hero.hp = 3;
    w.add(new Pickup(9 * TILE, 5 * TILE + 4, 'heart'));
    hero.facing = 'right';
    tap('special');
    const events = step([], 120);
    expect(w.keys).toBe(1);
    expect(hero.hp).toBe(5);
    expect(events).toContainEqual({ type: 'pickup', kind: 'key' });
    expect(w.state().taken.has('11,5')).toBe(true);
  });
});

describe('top-down kit: the boomerang carries what it takes (0.4.43)', () => {
  it("a heart it touches rides back on it, drawn there, and is the hero's only on the catch", () => {
    const { w, hero, step, tap } = one([]);
    w.grant('boomerang');
    hero.hp = 3;
    w.add(new Pickup(10 * TILE, 5 * TILE + 4, 'heart'));
    hero.facing = 'right';
    tap('special');
    let carried = false;
    for (let i = 0; i < 120; i++) {
      step();
      const b = w.entities.find((e): e is Boomerang => e instanceof Boomerang && !e.dead);
      if (b && b.carried.length) {
        carried = true;
        expect(hero.hp).toBe(3);
        expect(w.entities.some((e) => e instanceof Pickup && !e.dead)).toBe(false);
        // Drawn: the boomerang, then the heart on it (as rects without art).
        const drawn: { x: number; y: number }[] = [];
        const r: Renderer = Object.assign(new NullRenderer(), {
          rect(x: number, y: number): void {
            drawn.push({ x, y });
          },
        });
        const view = { sheet: () => null, sheets: DEFAULT_SHEETS } as unknown as TdView;
        b.render(r, view, 0, 0);
        expect(drawn.length).toBeGreaterThan(1);
        const heart = drawn.at(-1) as { x: number; y: number };
        expect(Math.abs(heart.x - b.x)).toBeLessThanOrEqual(8);
        expect(Math.abs(heart.y - b.y)).toBeLessThanOrEqual(8);
      }
    }
    expect(carried).toBe(true);
    expect(hero.hp).toBe(5);
  });
});

describe('top-down kit: bombs and cracked walls', () => {
  it('a bomb goes down in front, blows up after its fuse, hurts monsters 2 and the hero half a heart', () => {
    const { w, hero, step, tap } = one([[10, 5, 'n']]);
    w.grant('bomb');
    hero.facing = 'right';
    const k = stillKnight(w, hero.x + 24, hero.y);
    let events = tap('special');
    expect(events).toContainEqual({ type: 'bomb' });
    expect(w.inv.count('bomb')).toBe(3);
    const bomb = w.entities.find((e) => e instanceof Bomb) as Bomb;
    expect(bomb.x).toBeGreaterThan(hero.x);
    tap('special'); // one at a time
    expect(w.inv.count('bomb')).toBe(3);
    events = step([], BOMB_FUSE - 8); // the taps took four frames
    expect(events).toContainEqual({ type: 'fuse' });
    expect(w.entities.some((e) => e instanceof Explosion)).toBe(false);
    events = step([], 4);
    expect(events).toContainEqual({ type: 'blast' });
    expect(k.dead).toBe(true); // two hits' worth
    expect(hero.hp).toBe(5); // too close: half a heart
    expect(w.entities.some((e) => e instanceof Explosion)).toBe(true);
  });

  it('standing clear of the blast keeps the hero whole; no bombs left, no bomb', () => {
    const { w, hero, step, tap } = one([]);
    w.grant('bomb');
    w.inv.addAmmo('bomb', -3);
    hero.facing = 'right';
    tap('special');
    expect(w.inv.count('bomb')).toBe(0);
    step(['left'], 40);
    expect(hero.x + 8).toBeLessThan(w.entities.find((e) => e instanceof Bomb)!.x + 8 - BLAST_RADIUS - 8);
    step([], BOMB_FUSE);
    expect(hero.hp).toBe(6);
    expect(tap('special')).toEqual([]);
  });

  it('a cracked wall is a wall to the sword, the boomerang and walking; a blast opens it for good', () => {
    // A column of cracked wall across the room (one alone, the hero would walk round it).
    const { w, hero, step, tap } = one(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => [10, r, 'C'] as [number, number, string]),
    );
    w.grant('boomerang');
    w.grant('bomb');
    hero.x = 9 * TILE;
    hero.facing = 'right';
    const solid = () => w.blocked(hero.feet(10 * TILE, 5 * TILE), 'hero');
    expect(solid()).toBe(true);
    step(['attack']);
    step([], 14);
    tap('special');
    step([], 60);
    step(['right'], 20);
    expect(hero.x).toBeLessThan(10 * TILE - 13); // flush against it
    expect(solid()).toBe(true);
    w.inv.select('bomb');
    tap('special');
    step(['left'], 40);
    const events = step([], BOMB_FUSE);
    expect(events.filter((e) => e.type === 'secret')).toHaveLength(1);
    expect(solid()).toBe(false);
    expect(w.state().blasted.has('10,5')).toBe(true);
  });

  it('a cracked doorway on the border opens on both sides to a blast and leads on', () => {
    const west: RoomDef = {
      id: 'west',
      at: [0, 0],
      map: map([
        [7, 5, '@'],
        [15, 5, 'C'],
      ]),
    };
    const east: RoomDef = { id: 'east', at: [1, 0], map: map([[0, 5, 'C']]) };
    expect(parseRoom(west).doors.e).toBe('cracked');
    const { w, hero, step, tap } = world([west, east]);
    expect(w.doorOpen('e')).toBe(false);
    hero.x = 14 * TILE;
    step(['right'], 20);
    expect(w.room.id).toBe('west');
    w.grant('bomb');
    hero.facing = 'right';
    tap('special');
    step(['left'], 30);
    step([], BOMB_FUSE);
    expect(w.doorOpen('e')).toBe(true);
    expect(w.state('east').blasted.has('w')).toBe(true);
    step(['right'], 120);
    expect(w.room.id).toBe('east');
    expect(w.doorOpen('w')).toBe(true);
  });
});

describe('top-down kit: chests, the white sword and heart containers', () => {
  it('walking into a chest opens it once: the prize is held up while the room waits, and it stays open', () => {
    const west: RoomDef = {
      id: 'west',
      at: [0, 0],
      map: map([
        [7, 5, '@'],
        [9, 5, 'c'],
        [3, 3, 'n'],
        [15, 5, 'O'],
      ]),
      chests: ['boomerang'],
    };
    const east: RoomDef = { id: 'east', at: [1, 0], map: map([[0, 5, 'O']]) };
    expect(() => buildDungeon([{ ...west, chests: [] }, east])).toThrow(/chests/);
    const { w, hero, step } = world([west, east]);
    const chest = () => w.entities.find((e) => e instanceof Chest) as Chest;
    const knight = w.enemies()[0] as Knight;
    let events = step(['right'], 30);
    expect(events).toContainEqual({ type: 'chest', item: 'boomerang' });
    expect(events).toContainEqual({ type: 'pickup', kind: 'boomerang' });
    expect(w.inv.has('boomerang')).toBe(true);
    expect(hero.holding).toBe('boomerang-icon');
    const at = { x: knight.x, y: knight.y };
    step([], HOLD_FRAMES - 30);
    expect({ x: knight.x, y: knight.y }).toEqual(at);
    step([], 40);
    expect(hero.holding).toBeNull();
    expect(chest().open).toBe(true);
    // Out and back: still open, nothing more inside.
    w.warpTo('east', TILE, 5 * TILE);
    w.warpTo('west', 7 * TILE, 5 * TILE);
    expect(chest().open).toBe(true);
    events = step(['right'], 30);
    expect(events.some((e) => e.type === 'chest')).toBe(false);
    expect(w.inv.owned).toEqual(['boomerang']);
  });

  it('rocks and angled shots hit from the front and the side (there is no shield)', () => {
    const { w, hero, step } = world([{ id: 'r', at: [0, 0], map: map([[7, 5, '@']]) }]);
    hero.facing = 'right';
    w.add(new Rock(hero.x + 40, hero.y + 4, 'left'));
    expect(step([], 30)).toContainEqual({ type: 'hurt', hp: 5 });
    hero.invuln = 0;
    hero.x = 112;
    hero.facing = 'right';
    w.add(new Rock(hero.x + 4, hero.y - 40, 'down'));
    expect(step([], 30)).toContainEqual({ type: 'hurt', hp: 4 });
    hero.invuln = 0;
    hero.x = 112;
    hero.y = 80;
    hero.facing = 'up';
    w.add(new Projectile(hero.x + 10, hero.y - 40, -0.4, 1.5, null));
    expect(step([], 40)).toContainEqual({ type: 'hurt', hp: 3 });
  });

  it('the white sword turns the sword beam on', () => {
    const { w } = one([]);
    expect(w.swordBeam).toBe(false);
    w.grant('white-sword');
    expect(w.swordBeam).toBe(true);
  });

  it('a heart container adds a heart and fills them all; a refill only fills', () => {
    const { w, hero } = one([]);
    hero.hp = 1;
    w.grant('refill');
    expect([hero.hp, hero.maxHp]).toEqual([6, 6]);
    hero.hp = 1;
    w.grant('heart-container');
    expect([hero.hp, hero.maxHp]).toEqual([8, 8]);
  });

  it('with bombs owned, monsters sometimes leave bombs instead of nothing (seeded)', () => {
    let bombs = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const w = new TopDownWorld(
        buildDungeon([
          {
            id: 'r',
            at: [0, 0],
            map: map([
              [7, 5, '@'],
              [3, 3, 'b'],
            ]),
          },
        ]),
        {
          seed,
        },
      );
      w.grant('bomb');
      w.enemies()[0]?.die(w);
      if (w.entities.some((e) => e instanceof Pickup && e.kind === 'bombs')) bombs++;
    }
    expect(bombs).toBeGreaterThan(2);
    expect(bombs).toBeLessThan(20);
  });

  it('the no-damage assist keeps every heart (asked each time), but the knockback stays', () => {
    let on = true;
    const { w, hero } = world([{ id: 'r', at: [0, 0], map: map([[7, 5, '@']]) }], { noDamage: () => on });
    expect(hero.hurt(w, 2, 'left')).toBe(true);
    expect(hero.hp).toBe(6);
    expect(hero.kbT).toBeGreaterThan(0);
    hero.invuln = 0;
    on = false;
    hero.hurt(w, 2, 'left');
    expect(hero.hp).toBe(4);
  });
});

describe('top-down kit: a game of its own hero and harmless blasts', () => {
  it("a world option builds the game's own hero (a TdHero subclass) at the start", () => {
    class Gunner extends TdHero {}
    const w = new TopDownWorld(buildDungeon([{ id: 'r', at: [0, 0], map: map([[7, 5, '@']]) }]), {
      hero: (x, y, maxHp) => new Gunner(x, y, maxHp),
      maxHp: 8,
    });
    expect(w.hero).toBeInstanceOf(Gunner);
    expect([w.hero.x, w.hero.y, w.hero.maxHp, w.hero.hp]).toEqual([7 * TILE, 5 * TILE, 8, 8]);
  });

  it('a blast with no self damage never touches the hero (no knockback, no blink)', () => {
    const { w, hero } = one([[9, 5, 'n']]);
    const knight = stillKnight(w, 8 * TILE, 5 * TILE);
    w.blast(hero.x + 8, hero.y + 8, BLAST_RADIUS, 2, 0);
    expect(hero.invuln).toBe(0);
    expect(hero.kbT).toBe(0);
    expect(hero.hp).toBe(hero.maxHp);
    expect(knight.dead).toBe(true);
  });
});

describe('top-down kit: the HUD with items', () => {
  it('shows the item boxes by name with their icons, and the bomb count beside the keys', () => {
    const frames: string[] = [];
    const texts: string[] = [];
    const sheet: SpriteSheet = {
      id: 's',
      image: null,
      frames: new Map(
        ['heart', 'key', 'sword-icon', 'bomb-icon', 'boomerang-icon'].map((f) => [
          f,
          { x: 0, y: 0, w: 8, h: 16 },
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
    const { w } = one([]);
    w.grant('boomerang');
    w.grant('bomb');
    w.inv.addAmmo('bomb', 1);
    const boxes = [
      { label: 'ITEM', frame: w.inv.current?.icon ?? null },
      { label: 'SWORD', frame: 'sword-icon' },
    ];
    drawTdHud(r, view, hudData(w, 'KEEP', boxes));
    expect(texts).toEqual(expect.arrayContaining(['ITEM', 'SWORD', '×0', '×5']));
    expect(frames).toEqual(expect.arrayContaining(['boomerang-icon', 'sword-icon', 'bomb-icon', 'key']));
  });
});
