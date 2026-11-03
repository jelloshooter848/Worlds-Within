import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validate } from '@engine/core/content/validate';
import { presentFrameSchema, type PresentEntity } from '@engine/core/present';
import { BeamBurst, SwordBeam } from './beam';
import { Bat, Knight, Projectile, Rock, Spitter } from './enemies';
import { Chest, FloorSwitch, Pickup, Poof, PushBlock, TdEntity, Torch } from './entity';
import { Bomb, Boomerang, Explosion } from './items';
import { TdPerson } from './person';
import { presentWorld, TD_DEPTH, TdPresentState } from './present';
import { buildDungeon } from './room';
import { typeNameOf } from './type-names';
import { TdWalker } from './walker';
import { TopDownWorld } from './world';

const ROOM = [
  '################',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#......@.......#',
  '#..............#',
  '#..............#',
  '#..............#',
  '#..............#',
  '################',
];

function world(dark = false, hero?: (x: number, y: number) => TdWalker): TopDownWorld {
  const d = buildDungeon([{ id: 'r', at: [0, 0], map: ROOM, ...(dark ? { dark: true } : {}) }]);
  return new TopDownWorld(d, { seed: 3, ...(hero ? { hero } : {}) });
}

/** One of each class the kit draws, and the kind it is presented as. */
const FACTORIES: Record<string, { make: () => TdEntity; kind: string }> = {
  Poof: { make: () => new Poof(32, 32), kind: 'poof' },
  Pickup: { make: () => new Pickup(32, 32, 'heart'), kind: 'pickup:heart' },
  Chest: { make: () => new Chest(32, 32, 'key'), kind: 'chest' },
  PushBlock: { make: () => new PushBlock(32, 32), kind: 'push-block' },
  FloorSwitch: { make: () => new FloorSwitch(32, 32, 'plate'), kind: 'switch' },
  Torch: { make: () => new Torch(32, 32, true), kind: 'torch' },
  Projectile: { make: () => new Projectile(32, 32, 1, 0, 'right'), kind: 'Projectile' },
  Rock: { make: () => new Rock(32, 32, 'right'), kind: 'rock' },
  Bat: { make: () => new Bat(32, 32), kind: 'bat' },
  Knight: { make: () => new Knight(32, 32), kind: 'knight' },
  Spitter: { make: () => new Spitter(32, 32), kind: 'spitter' },
  Boomerang: { make: () => new Boomerang(32, 32, 'right'), kind: 'boomerang' },
  Explosion: { make: () => new Explosion(40, 40), kind: 'explosion' },
  Bomb: { make: () => new Bomb(32, 32), kind: 'bomb' },
  SwordBeam: { make: () => new SwordBeam(32, 32, 'up'), kind: 'sword-beam' },
  BeamBurst: { make: () => new BeamBurst(40, 40), kind: 'beam-shard' },
  TdPerson: {
    make: () => new TdPerson(32, 32, { id: 'g', name: 'G', frames: 'guard' }),
    kind: 'person:guard',
  },
};

/** The kit's abstract entity bases: never placed themselves, so never presented. */
const ABSTRACT = new Set(['TdEnemy', 'Walker']);

/** Every concrete TdEntity class the kit's modules export (tests left out). */
async function entityClasses(): Promise<string[]> {
  const dir = new URL('./', import.meta.url);
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
    const mod = (await import(new URL(file, dir).href)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (typeof value !== 'function' || !(value.prototype instanceof TdEntity)) continue;
      if (!ABSTRACT.has(value.name)) names.add(value.name);
    }
  }
  return [...names].sort();
}

describe('presentWorld: every entity the kit has', () => {
  it('has a presented kind for every concrete TdEntity class', async () => {
    expect(await entityClasses()).toEqual(Object.keys(FACTORIES).sort());
    for (const [name, { make, kind }] of Object.entries(FACTORIES)) {
      const w = world();
      w.add(make());
      const frame = presentWorld(w);
      expect(validate('frame.json', frame, presentFrameSchema).errors, name).toEqual([]);
      const kinds = frame.entities.map((e) => e.kind);
      expect(kinds, name).toContain(kind);
      expect(kinds, name).toContain('hero');
    }
  });

  it('names every kit class the same in a minified build (typeNameOf, Engine 0.15 T12)', () => {
    for (const [name, { make }] of Object.entries(FACTORIES)) {
      const e = make();
      expect(typeNameOf(e), name).toBe(name);
      // A minifier renames the class: the snapshot's name for it must not follow.
      const cls = e.constructor;
      const was = Object.getOwnPropertyDescriptor(cls, 'name')!;
      Object.defineProperty(cls, 'name', { value: 'a', configurable: true });
      try {
        expect(typeNameOf(e), name).toBe(name);
      } finally {
        Object.defineProperty(cls, 'name', was);
      }
    }
    // A game's own class (not in the kit's table) keeps its class name.
    class Boss extends Chest {}
    expect(typeNameOf(new Boss(0, 0, 'key'))).toBe('Boss');
  });

  it('presents the walking hero (TdWalker) as the hero too', () => {
    const w = world(false, (x, y) => new TdWalker(x, y));
    expect(presentWorld(w).entities.map((e) => e.kind)).toEqual(['hero']);
  });

  it('replaces kit-chosen frame names with an animation state and t', () => {
    const w = world(true);
    const boom = new Boomerang(32, 32, 'right');
    boom.t = 9;
    const bomb = new Bomb(64, 64);
    bomb.fuse = 10;
    const chest = new Chest(96, 32, 'key', true);
    const sign = new TdPerson(16, 16, { id: 's', name: 'S', frames: null });
    const hidden = new Pickup(16, 32, 'key');
    hidden.hidden = true;
    for (const e of [boom, bomb, chest, sign, hidden]) w.add(e);
    w.frame = 21;
    const look = (kind: string, calm = false) =>
      presentWorld(w, [], { reduceFlashing: calm }).entities.find((e) => e.kind === kind);
    expect(look('boomerang')).toMatchObject({ anim: { state: 'spin', t: 9 }, facing: 'right', tags: [] });
    expect(look('bomb')).toMatchObject({ anim: { state: 'fuse-short', t: 21 }, tags: ['flashing'] });
    expect(look('bomb', true)).toMatchObject({ anim: { state: 'fuse-short', t: 0 }, tags: ['calm'] });
    expect(look('chest')).toMatchObject({ anim: { state: 'open', t: 0 }, tags: ['dark'] });
    // Not drawn before, so not presented: a sign (no picture) and a hidden pickup.
    expect(look('person:none')).toBeUndefined();
    expect(look('pickup:key')).toBeUndefined();
  });

  it('tags a stunned or hurt enemy and puts stun stars over it', () => {
    const w = world();
    const knight = new Knight(48, 48);
    knight.stunT = 30;
    knight.invuln = 5;
    w.add(knight);
    const es = presentWorld(w, [], { state: new TdPresentState() }).entities;
    const k = es.find((e) => e.kind === 'knight')!;
    expect(k.tags).toEqual(['invuln', 'flashing', 'stunned']);
    expect(k.anim).toEqual({ state: 'walk', t: 0 });
    expect(es.find((e) => e.kind === 'stun')).toMatchObject({
      id: `${k.id}/stun`,
      x: 48,
      y: 42,
      layer: TD_DEPTH.stun,
    });
  });

  it('presents a burst as four shards, flipped the way each flies', () => {
    const w = world();
    w.add(new BeamBurst(40, 40));
    const shards = presentWorld(w).entities.filter((e) => e.kind === 'beam-shard');
    expect(shards.map((s) => [s.x, s.y, s.tags])).toEqual([
      [35, 35, ['flashing']],
      [37, 35, ['flip-x', 'flashing']],
      [35, 37, ['flip-y', 'flashing']],
      [37, 37, ['flip-x', 'flip-y', 'flashing']],
    ]);
  });

  it('rides what a boomerang carries on it without moving it', () => {
    const w = world();
    const boom = new Boomerang(64, 40, 'right');
    const heart = new Pickup(0, 0, 'heart');
    heart.dead = true;
    boom.carried.push(heart);
    w.add(boom);
    const es = presentWorld(w).entities;
    expect(es.find((e) => e.kind === 'pickup:heart')).toMatchObject({
      x: 64,
      y: 40,
      tags: ['carried'],
      layer: TD_DEPTH.shots,
    });
    expect([heart.x, heart.y]).toEqual([0, 0]);
    // Listed after the boomerang at the same layer, so it draws on top of it.
    const kinds = es.map((e) => e.kind);
    expect(kinds.indexOf('pickup:heart')).toBeGreaterThan(kinds.indexOf('boomerang'));
  });
});

describe('presentWorld: depth matches the old render order', () => {
  /** A room with something on every layer, townsfolk on both sides of the hero and a stun. */
  function busy(): TopDownWorld {
    const w = world();
    const boom = new Boomerang(150, 40, 'left');
    boom.carried.push(new Pickup(0, 0, 'key'));
    const stunned = new Bat(40, 120);
    stunned.stunT = 20;
    const entities: TdEntity[] = [
      new Poof(200, 100),
      new FloorSwitch(16, 16, 'latch'),
      new TdPerson(112, 112, { id: 'front', name: 'F', frames: 'woman' }),
      new Knight(48, 48),
      new TdPerson(140, 60, { id: 'back', name: 'B', frames: 'guard' }),
      stunned,
      new Pickup(32, 16, 'heart'),
      boom,
      new Rock(90, 90, 'down'),
      new TdPerson(60, 80, { id: 'level', name: 'L', frames: 'guard' }),
      new BeamBurst(180, 40),
      new Chest(200, 16, 'map'),
    ];
    for (const e of entities) w.add(e);
    w.hero.holdUp('map');
    return w;
  }

  it('lists entities in draw order with depths that never go down', () => {
    const w = busy();
    const es = presentWorld(w).entities;
    const layers = es.map((e) => e.layer ?? 0);
    expect(layers).toEqual([...layers].sort((a, b) => a - b));
    const at = (pred: (e: PresentEntity) => boolean) => es.findIndex(pred);
    const id = (s: string) => (e: PresentEntity) => e.id === s;
    expect(es.map((e) => e.kind)).toEqual([
      'switch',
      'pickup:heart',
      'chest',
      'knight',
      'bat',
      'stun',
      'person:guard', // y 60
      'person:guard', // y 80, level with the hero: behind him
      'held',
      'hero',
      'person:woman',
      'boomerang',
      'pickup:key',
      'rock',
      'poof',
      'beam-shard',
      'beam-shard',
      'beam-shard',
      'beam-shard',
    ]);
    expect(at(id('hero'))).toBeGreaterThan(at(id('hero/held')));
    expect(es.find(id('hero'))!.layer).toBe(TD_DEPTH.hero);
    expect(es.filter((e) => e.kind.startsWith('person:')).map((e) => e.layer)).toEqual([
      TD_DEPTH.folkBehind,
      TD_DEPTH.folkBehind,
      TD_DEPTH.folkFront,
    ]);
  });
});
