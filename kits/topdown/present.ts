import { DEFAULT_SCREEN, type ScreenSize } from '@engine/core/gfx/screen';
import type { JsonValue } from '@engine/core/headless';
import {
  MapTracker,
  type CameraHint,
  type Facing,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type PresentMap,
  type PresentMapRef,
  type PresentStatusValue,
} from '@engine/core/present';
import { DIR_VEC, HUD_H, ROOM_COLS, ROOM_H, ROOM_ROWS, ROOM_W, SIDE_DIR, TILE, type Side } from './geometry';
import { ATTACK_FRAMES, HOLD_FRAMES, KNOCK_FRAMES, SPIN_FRAMES, USE_FRAMES, swordAt } from './hero';
import { Chest, FloorSwitch, Pickup, Poof, PushBlock, TdEnemy, Torch, type TdEntity } from './entity';
import { Bat, Projectile, Rock, Spitter, Walker } from './enemies';
import { BOMB_FUSE, Bomb, Boomerang, Explosion } from './items';
import { BeamBurst, SwordBeam } from './beam';
import { TdPerson } from './person';
import { sideOf, tileAt, type Room, type TileKind } from './room';
import type { TopDownWorld } from './world';

/**
 * The top-down kit's side of the presentation contract (`@engine/core/present`, Engine 0.4): it
 * describes the world as a `PresentFrame` and never draws. A backend draws the frame through a
 * skin. Presenting only reads the world: it never touches its RNG, its rooms' memory or anything a
 * snapshot (`snapshot.ts`) reads, so state hashes are the same with or without it.
 *
 * Coordinates are world pixels: the room on screen has its top-left tile at (0, 0). During a room
 * slide the map holds both rooms side by side (see `presentMap`) and the new room sits at its
 * offset in it. Where the room goes on the picture (under the 64-px HUD band) is only a `camera`
 * hint, never baked into positions.
 */

/**
 * The characters of a presented map (the kit's tile contract; a skin maps each to a frame). The
 * room text's `LEGEND` (room.ts) says what a room is made of; these say how each cell looks now.
 */
export const PRESENT_TILES = {
  wall: '#',
  floor: '.',
  'floor-alt': ':',
  block: 'B',
  statue: 'S',
  water: '~',
  stairs: '=',
  exit: 'E',
  /** A doorway the hero can walk through. */
  'door-open': 'O',
  'door-locked': 'L',
  /** A shutter door that is closed. */
  'door-shut': 'X',
  /** A cracked wall, on the border (a walled-up doorway) or inside the room. */
  cracked: 'C',
  /** A cracked doorway a blast opened. */
  'wall-hole': 'H',
  /** A building door whose lock's secret is not found (TdEntrance.needs). */
  'door-boarded': 'D',
  /** A building door that is shut (TdEntrance.shut). */
  'door-closed': 'd',
} as const;

/** How a doorway looks: open, locked, shut (shutters), cracked (walled up) or a blasted hole. */
export type DoorLook = 'open' | 'locked' | 'shut' | 'cracked' | 'hole';

/** How a doorway of the room on screen looks right now. */
export function liveDoorLook(world: TopDownWorld, side: Side): DoorLook {
  const kind = world.room.doors[side];
  if (kind === 'cracked') return world.doorOpen(side) ? 'hole' : 'cracked';
  if (kind === 'locked' && !world.doorOpen(side)) return 'locked';
  if (kind === 'shutter' && !world.doorOpen(side)) return 'shut';
  return 'open';
}

/**
 * How a doorway of a room being slid away from looks (its memory; shutters as last seen). `left`
 * is the edge the hero left by.
 */
export function pastDoorLook(world: TopDownWorld, room: Room, side: Side, left: Side): DoorLook {
  const kind = room.doors[side];
  const st = world.state(room.id);
  if (kind === 'cracked') return st.blasted.has(side) ? 'hole' : 'cracked';
  if (kind === 'locked' && !st.unlocked.has(side)) return 'locked';
  if (kind === 'shutter' && side !== left && room.def.shutters && !st.met.has(room.def.shutters))
    return 'shut';
  return 'open';
}

const DOOR_CHAR: Record<DoorLook, string> = {
  open: PRESENT_TILES['door-open'],
  locked: PRESENT_TILES['door-locked'],
  shut: PRESENT_TILES['door-shut'],
  cracked: PRESENT_TILES.cracked,
  hole: PRESENT_TILES['wall-hole'],
};

/**
 * A room's cells as rows of `PRESENT_TILES` characters. `door` says how each doorway looks,
 * `blasted` whether an inner cracked wall was blown open (it is floor then) and `entrance` how a
 * building door's cell looks (null: as its tile).
 */
function roomRows(
  room: Room,
  door: (side: Side) => DoorLook,
  blasted: (cell: string) => boolean,
  entrance: (col: number, row: number) => string | null,
): string[] {
  const rows: string[] = [];
  for (let row = 0; row < ROOM_ROWS; row++) {
    let line = '';
    for (let col = 0; col < ROOM_COLS; col++) {
      const shut = entrance(col, row);
      if (shut !== null) {
        line += shut;
        continue;
      }
      const t = tileAt(room, col, row) as TileKind;
      if (t === 'door') line += DOOR_CHAR[door(sideOf(col, row, room.wall) as Side)];
      else if (t === 'cracked')
        line += blasted(`${col},${row}`) ? PRESENT_TILES.floor : PRESENT_TILES.cracked;
      else line += PRESENT_TILES[t];
    }
    rows.push(line);
  }
  return rows;
}

/** The room on screen's cells as they look now. */
function liveRows(world: TopDownWorld): string[] {
  const st = world.state();
  return roomRows(
    world.room,
    (s) => liveDoorLook(world, s),
    (c) => st.blasted.has(c),
    (col, row) => {
      const e = world.entranceAt(col, row);
      if (!e || world.entranceOpen(e)) return null;
      return e.shut ? PRESENT_TILES['door-closed'] : PRESENT_TILES['door-boarded'];
    },
  );
}

/** A room's tags on the map: `dark` (RoomDef.dark) and `wall:<n>` (its wall band's thickness). */
function roomTags(room: Room, prefix = ''): string[] {
  const tags = [`${prefix}wall:${room.wall}`];
  if (room.def.dark) tags.push(`${prefix}dark`);
  return tags;
}

/** A 32-bit FNV-1a hash of the map's look, as a whole number (the map's `version`). */
function versionOf(rows: readonly string[], tags: readonly string[]): number {
  let h = 0x811c9dc5;
  const text = `${rows.join('\n')}|${tags.join(',')}`;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The map and where the room on screen sits in it (its origin, in map pixels). */
export interface TdPresentedMap {
  map: PresentMap;
  origin: { x: number; y: number };
  /** The map pixel at the picture's top-left of the play area (the slide's scroll). */
  view: { x: number; y: number };
}

/**
 * The map as it looks now. Normally the room on screen (id = the room's id, 16x11 tiles). During a
 * room slide, both rooms in one map (id `<from>><to>`, 32x11 or 16x22) with the old room where the
 * hero left it and the new one beyond the edge, tagged `slide`, `slide:<side>` and the old room's
 * tags with a `from-` prefix. `version` is a hash of the tiles and tags, so it changes whenever a
 * door opens, a shutter shuts, a wall is blasted or a building door opens.
 */
export function presentMap(world: TopDownWorld): TdPresentedMap {
  const room = world.room;
  const tr = world.transition;
  if (!tr) {
    const tiles = liveRows(world);
    const tags = roomTags(room);
    const map: PresentMap = {
      id: room.id,
      version: versionOf(tiles, tags),
      tileSize: TILE,
      cols: ROOM_COLS,
      rows: ROOM_ROWS,
      tiles,
      tags,
    };
    return { map, origin: { x: 0, y: 0 }, view: { x: 0, y: 0 } };
  }
  const v = DIR_VEC[SIDE_DIR[tr.side]];
  const fromSt = world.state(tr.from.id);
  const old = roomRows(
    tr.from,
    (s) => pastDoorLook(world, tr.from, s, tr.side),
    (c) => fromSt.blasted.has(c),
    () => null,
  );
  const now = liveRows(world);
  // The room further along the slide comes second (right or below).
  const forward = v.dx > 0 || v.dy > 0;
  const [first, second] = forward ? [old, now] : [now, old];
  const across = v.dx !== 0;
  const tiles = across ? first.map((row, i) => row + (second[i] ?? '')) : [...first, ...second];
  const tags = ['slide', `slide:${tr.side}`, ...roomTags(room), ...roomTags(tr.from, 'from-')];
  const span = across ? ROOM_W : ROOM_H;
  const shift = Math.round((tr.t / tr.frames) * span);
  const step = { x: across ? ROOM_W : 0, y: across ? 0 : ROOM_H };
  const fromAt = forward ? { x: 0, y: 0 } : step;
  const origin = forward ? step : { x: 0, y: 0 };
  const map: PresentMap = {
    id: `${tr.from.id}>${room.id}`,
    version: versionOf(tiles, tags),
    tileSize: TILE,
    cols: across ? ROOM_COLS * 2 : ROOM_COLS,
    rows: across ? ROOM_ROWS : ROOM_ROWS * 2,
    tiles,
    tags,
  };
  return { map, origin, view: { x: fromAt.x + v.dx * shift, y: fromAt.y + v.dy * shift } };
}

/**
 * Stable presentation ids for the world's entities, without the RNG and without touching the world.
 * A thing placed by the room text is `<room>/<kind>@<col,row>` (the same each visit); anything
 * else (a shot, a drop) gets `<kind>#<n>` the first time it is seen, counting from 1 per state.
 */
export class TdPresentIds {
  private readonly seen = new WeakMap<object, string>();
  private n = 0;

  of(e: TdEntity, room: string): string {
    const kind = presentKind(e);
    if (e.key !== null) return `${room}/${kind}@${e.key}`;
    let id = this.seen.get(e);
    if (id === undefined) {
      id = `${kind}#${++this.n}`;
      this.seen.set(e, id);
    }
    return id;
  }
}

/**
 * What a stream of frames remembers: the map last sent (`maps`) and entity ids (`ids`). Keep one
 * per presenter; it lives outside the world, so presenting never changes the world's state.
 */
export class TdPresentState {
  readonly maps = new MapTracker();
  readonly ids = new TdPresentIds();
}

/**
 * An entity's presented kind (what a skin maps to a look). The kit's own classes have fixed names
 * (`chest`, `torch`, `boomerang`, ...; see `kits/topdown/CLAUDE.md`), pickups are
 * `pickup:<kind>`, townsfolk `person:<frames>`, floor switches `switch`; anything else (an enemy,
 * a game's own entity) is its own `kind`, or its class name when it has none.
 */
export function presentKind(e: TdEntity): string {
  if (e instanceof Pickup) return `pickup:${e.kind}`;
  if (e instanceof TdPerson) return `person:${e.frames ?? 'none'}`;
  if (e instanceof FloorSwitch) return 'switch';
  if (e instanceof Poof) return 'poof';
  if (e instanceof Chest) return 'chest';
  if (e instanceof PushBlock) return 'push-block';
  if (e instanceof Torch) return 'torch';
  if (e instanceof Boomerang) return 'boomerang';
  if (e instanceof Bomb) return 'bomb';
  if (e instanceof Explosion) return 'explosion';
  if (e instanceof SwordBeam) return 'sword-beam';
  if (e instanceof BeamBurst) return 'beam-burst';
  const kind = (e as { kind?: unknown }).kind;
  if (typeof kind === 'string') return kind;
  if (e instanceof Rock) return 'rock';
  return e.constructor.name;
}

/**
 * Depth layers (`PresentEntity.layer`), drawn low to high, in the old `renderWorld` order: an
 * entity's kit `layer` 0..3 times ten (floor things, actors, shots, effects; other layers were
 * never drawn and are not listed), with the actors' extras between: stun stars over the actors, then townsfolk (`ySort`) whose feet are not below
 * the hero's, the prize he holds up, his sword, the hero, and the townsfolk in front of him.
 */
export const TD_DEPTH = {
  floor: 0,
  actors: 10,
  stun: 11,
  folkBehind: 12,
  held: 13,
  sword: 14,
  hero: 15,
  folkFront: 16,
  shots: 20,
  effects: 30,
} as const;

export interface TdPresentOptions {
  /** The game picture's size (`game.json`'s `screen`); DEFAULT_SCREEN when left out. */
  size?: ScreenSize;
  /** The picture's y where the play area starts (under the HUD band); HUD_H by default. */
  top?: number;
  /** Tag a hurt hero `calm` instead of `flashing` (the reduce-flashing setting). */
  reduceFlashing?: boolean;
  /**
   * The stream's memory (TdPresentState): with it the full map is sent only when the room or its
   * tiles change, and ids stay stable for things not placed by the room text. Without it every
   * frame carries the full map.
   */
  state?: TdPresentState;
}

/**
 * The hero as a presented entity, or null once he is gone. `anim.state`: `walk` (`t` the walk
 * counter, advancing only while he moves), `attack`, `throw`, `hold`, `hurt` (knocked back),
 * `dying` (the spin) and `poof` (after it), `t` counting ticks in the state. Tags: `invuln` while
 * he can't be hurt, then `flashing` or (reduce flashing) `calm`; `holding:<frame>` for a prize
 * held up. The prize itself is `hero/held` (kind `held`, `anim.state` its frame) and the blade
 * while stabbing `hero/sword`; both are drawn under him (TD_DEPTH).
 */
function presentHero(
  world: TopDownWorld,
  at: { x: number; y: number },
  calm: boolean,
  dark: boolean,
): PresentEntity[] {
  const h = world.hero;
  if (h.dead) return [];
  let state = 'walk';
  let t = h.walkT;
  if (h.dying >= SPIN_FRAMES) [state, t] = ['poof', h.dying - SPIN_FRAMES];
  else if (h.dying > 0) [state, t] = ['dying', h.dying - 1];
  else if (h.attacking) [state, t] = ['attack', ATTACK_FRAMES - h.attackT];
  else if (h.holdT > 0) [state, t] = ['hold', HOLD_FRAMES - h.holdT];
  else if (h.kbT > 0) [state, t] = ['hurt', KNOCK_FRAMES - h.kbT];
  else if (h.useT > 0) [state, t] = ['throw', USE_FRAMES - h.useT];
  const tags: string[] = [];
  if (h.invuln > 0 || (h.dying > 0 && h.dying < SPIN_FRAMES)) {
    if (h.invuln > 0) tags.push('invuln');
    tags.push(calm ? 'calm' : 'flashing');
  }
  if (h.holding) tags.push(`holding:${h.holding}`);
  const out: PresentEntity[] = [];
  if (h.holding) {
    // The prize held over his head (a tile-sheet frame; its art is centred on him, 16 px up).
    out.push({
      id: 'hero/held',
      kind: 'held',
      x: at.x + h.x,
      y: at.y + h.y - 16,
      w: 16,
      h: 16,
      facing: 'down',
      anim: { state: h.holding, t: Math.max(0, HOLD_FRAMES - h.holdT) },
      tags: dark ? ['dark'] : [],
      layer: TD_DEPTH.held,
    });
  }
  if (h.attacking) {
    const b = swordAt(h.x, h.y, h.facing);
    out.push({
      id: 'hero/sword',
      kind: 'sword',
      x: at.x + b.x,
      y: at.y + b.y,
      w: b.w,
      h: b.h,
      facing: h.facing,
      anim: { state: 'stab', t: ATTACK_FRAMES - h.attackT },
      tags: [],
      layer: TD_DEPTH.sword,
    });
  }
  out.push({
    id: 'hero',
    kind: 'hero',
    x: at.x + h.x,
    y: at.y + h.y,
    w: 16,
    h: 16,
    facing: h.facing,
    anim: { state, t: Math.max(0, t) },
    tags,
    layer: TD_DEPTH.hero,
  });
  return out;
}

/** What presenting one entity needs: the world, its offset in the map, the stream's ids and flags. */
interface EntityCtx {
  world: TopDownWorld;
  at: { x: number; y: number };
  ids: TdPresentIds;
  calm: boolean;
  /** The room on screen is dark (things drawn from the tile sheet take its dark palette). */
  dark: boolean;
}

/** Tags for something that blinks or flickers: `flashing`, or `calm` with reduce flashing. */
function flicker(ctx: EntityCtx): string {
  return ctx.calm ? 'calm' : 'flashing';
}

/** A ticking counter for something that only flickers: the frame, or 0 with reduce flashing. */
function flickerT(ctx: EntityCtx): number {
  return ctx.calm ? 0 : ctx.world.frame;
}

/** Things drawn from the tile sheet (they take a dark room's palette): tagged `dark` there. */
function tileTags(ctx: EntityCtx, tags: string[] = []): string[] {
  return ctx.dark ? [...tags, 'dark'] : tags;
}

/** How an entity looks now: its animation state and `t`, facing and tags (see CLAUDE.md's table). */
function lookOf(e: TdEntity, ctx: EntityCtx): { state: string; t: number; facing: Facing; tags: string[] } {
  const frame = ctx.world.frame;
  const look = (state: string, t = 0, tags: string[] = [], facing: Facing = 'down') => ({
    state,
    t: Math.max(0, t),
    facing,
    tags,
  });
  if (e instanceof TdEnemy) {
    const tags: string[] = [];
    if (e.invuln > 0) tags.push('invuln', flicker(ctx));
    if (e.kbT > 0) tags.push('knockback');
    if (e.stunT > 0) tags.push('stunned');
    if (e instanceof Bat) return look(e.resting ? 'rest' : 'fly', e.resting ? 0 : frame, tags, e.facing);
    if (e instanceof Spitter && e.stopT > 0) return look('spit', e.stopT - 1, tags, e.facing);
    if (e instanceof Walker) return look('walk', e.anim, tags, e.facing);
    return look('idle', frame, tags, e.facing);
  }
  if (e instanceof Pickup) return look('idle', 0, tileTags(ctx));
  if (e instanceof Chest) return look(e.open ? 'open' : 'closed', 0, tileTags(ctx));
  if (e instanceof PushBlock)
    return look(e.moving ? 'slide' : 'idle', 0, tileTags(ctx, e.fixed ? ['fixed'] : []));
  if (e instanceof FloorSwitch) return look(e.pressed ? 'down' : 'up', 0, tileTags(ctx, [e.kind]));
  if (e instanceof Torch) return look(e.lit ? 'lit' : 'off', e.lit ? flickerT(ctx) : 0, tileTags(ctx));
  if (e instanceof Poof) return look('poof', e.t);
  if (e instanceof Boomerang) return look('spin', e.t, e.out ? [] : ['returning'], e.dir);
  if (e instanceof Bomb)
    return look(e.fuse < BOMB_FUSE / 3 ? 'fuse-short' : 'fuse', flickerT(ctx), [flicker(ctx)]);
  if (e instanceof Explosion) return look('blast', e.t);
  if (e instanceof SwordBeam) return look('fly', flickerT(ctx), [flicker(ctx)], e.dir);
  if (e instanceof TdPerson) {
    const tags = e.sheet ? [`sheet:${e.sheet}`] : [];
    if (e.palette) tags.push(`palette:${e.palette}`);
    return look('idle', e.t, tags, e.facing);
  }
  if (e instanceof Projectile) return look('fly', frame, e.hostile ? ['hostile'] : [], e.dir ?? 'down');
  return look('idle', frame);
}

/**
 * One entity as presented entities (most are one; a beam's burst is its four shards, a boomerang
 * brings what rides on it). Nothing is listed for what the old renderer did not draw: a hidden
 * pickup, a hidden townsperson or one with no picture (a sign).
 */
function presentOne(e: TdEntity, layer: number, ctx: EntityCtx): PresentEntity[] {
  if (e instanceof Pickup && e.hidden) return [];
  if (e instanceof TdPerson && (e.hidden || e.frames === null)) return [];
  const id = ctx.ids.of(e, ctx.world.room.id);
  const { x, y } = ctx.at;
  if (e instanceof BeamBurst) {
    return e.pieces().map((p, i) => ({
      id: `${id}/${i}`,
      kind: 'beam-shard',
      x: Math.round(x + e.cx + p.dx - 4),
      y: Math.round(y + e.cy + p.dy - 4),
      w: 8,
      h: 8,
      facing: 'down',
      anim: { state: 'fly', t: e.t },
      // The shard art points up-left; each piece is flipped to point the way it flies.
      tags: [...(p.dx > 0 ? ['flip-x'] : []), ...(p.dy > 0 ? ['flip-y'] : []), flicker(ctx)],
      layer,
    }));
  }
  const look = lookOf(e, ctx);
  const out: PresentEntity[] = [
    {
      id,
      kind: presentKind(e),
      x: x + e.x,
      y: y + e.y,
      w: e.w,
      h: e.h,
      facing: look.facing,
      anim: { state: look.state, t: look.t },
      tags: look.tags,
      layer,
    },
  ];
  if (e instanceof Boomerang) {
    // What it carries rides on it, centred (presenting never moves the pickups themselves).
    for (const p of e.carried)
      for (const one of presentOne(p, layer, ctx))
        out.push({
          ...one,
          x: x + e.x + 4 - (p.w >> 1),
          y: y + e.y + 4 - (p.h >> 1),
          tags: [...one.tags, 'carried'],
        });
  }
  return out;
}

/** Two little stars over a stunned monster's head (`<id>/stun`, kind `stun`, anim `spin`). */
function presentStun(e: TdEnemy, ctx: EntityCtx): PresentEntity {
  return {
    id: `${ctx.ids.of(e, ctx.world.room.id)}/stun`,
    kind: 'stun',
    x: ctx.at.x + e.x + e.w / 2 - 8,
    y: ctx.at.y + e.y - 6,
    w: 16,
    h: 6,
    facing: 'down',
    anim: { state: 'spin', t: flickerT(ctx) },
    tags: [flicker(ctx)],
    layer: TD_DEPTH.stun,
  };
}

/**
 * The room's entities and the hero, in the old `renderWorld` order and with depths (TD_DEPTH) that
 * say the same: kit layer 0 (floor), the layer-1 actors, stun stars, townsfolk behind the hero (by
 * their y, the hero's own included), the hero, townsfolk in front, layer 2 (shots) and 3 (effects).
 */
function presentEntities(world: TopDownWorld, ctx: EntityCtx): PresentEntity[] {
  const out: PresentEntity[] = [];
  const living = world.entities.filter((e) => !e.dead);
  const byLayer = (l: number) => living.filter((e) => e.layer === l);
  const add = (es: readonly TdEntity[], depth: number) => {
    for (const e of es) out.push(...presentOne(e, depth, ctx));
  };
  add(byLayer(0), TD_DEPTH.floor);
  const sorted = (e: TdEntity) => 'ySort' in e && e.ySort === true;
  const actors = byLayer(1);
  add(
    actors.filter((e) => !sorted(e)),
    TD_DEPTH.actors,
  );
  for (const e of world.enemies()) if (e.stunT > 0) out.push(presentStun(e, ctx));
  const folk = actors.filter(sorted).sort((a, b) => a.y - b.y);
  const heroY = world.hero.y;
  add(
    folk.filter((e) => e.y <= heroY),
    TD_DEPTH.folkBehind,
  );
  out.push(...presentHero(world, ctx.at, ctx.calm, ctx.dark));
  add(
    folk.filter((e) => e.y > heroY),
    TD_DEPTH.folkFront,
  );
  add(byLayer(2), TD_DEPTH.shots);
  add(byLayer(3), TD_DEPTH.effects);
  return out;
}

/**
 * The HUD values: `hp`, `maxHp` (half hearts), `keys`, `item` (the item in the slot, '' for none),
 * `ammo.<id>` for every item with ammo (0 until found), `room` (its id), `mapX`/`mapY` (its map
 * cell), `mapCols`/`mapRows`, `visited` (the cells seen, `gx,gy` joined by spaces, sorted),
 * `hasMap`/`hasCompass`, `goalX`/`goalY` once the compass is found, and `top` (the play area's
 * y on the picture, a layout hint).
 */
function presentStatus(world: TopDownWorld, top: number): Record<string, PresentStatusValue> {
  const d = world.dungeon;
  const status: Record<string, PresentStatusValue> = {
    hp: world.hero.hp,
    maxHp: world.hero.maxHp,
    keys: world.keys,
    item: world.inv.current?.id ?? '',
  };
  for (const it of Object.values(world.items)) if (it.ammo) status[`ammo.${it.id}`] = world.inv.count(it.id);
  const cells = world
    .visited()
    .map((id) => d.rooms.get(id))
    .filter((r) => r !== undefined)
    .map((r) => `${r.gx},${r.gy}`)
    .sort();
  Object.assign(status, {
    room: world.room.id,
    mapX: world.room.gx,
    mapY: world.room.gy,
    mapCols: d.cols,
    mapRows: d.rows,
    visited: cells.join(' '),
    hasMap: world.found.has('map'),
    hasCompass: world.found.has('compass'),
    top,
  });
  if (world.found.has('compass')) {
    for (const r of d.rooms.values())
      if (r.def.goal) {
        status['goalX'] = r.gx;
        status['goalY'] = r.gy;
        break;
      }
  }
  return status;
}

/** Events about the hero, placed at his centre with `entity: 'hero'`. */
const HERO_EVENTS = new Set([
  'sword',
  'beam',
  'hurt',
  'dying',
  'dead',
  'push',
  'pickup',
  'item',
  'item-select',
  'chest',
  'bomb',
  'exit',
]);

/**
 * The world's events (TdEvents) as presented events: their JSON-safe fields copied, hero events
 * at the hero's centre (`entity: 'hero'`), `unlock` at the middle of its doorway. Events whose
 * place the world does not report (`hit`, `kill`, `room`, ...) carry no position.
 */
function presentEvents(
  world: TopDownWorld,
  events: readonly object[],
  at: { x: number; y: number },
): PresentEvent[] {
  const h = world.hero;
  return events.map((e) => {
    const out: PresentEvent = { type: 'event' };
    for (const [k, v] of Object.entries(e)) {
      if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) {
        if (typeof v === 'number' && !Number.isFinite(v)) continue;
        out[k] = v as JsonValue;
      }
    }
    if (HERO_EVENTS.has(out.type)) {
      out.x = at.x + h.x + 8;
      out.y = at.y + h.y + 8;
      out.entity = 'hero';
    } else if (out.type === 'unlock' && typeof out['side'] === 'string') {
      const side = out['side'] as Side;
      const cells = world.room.doorCells[side] ?? [];
      if (cells.length > 0) {
        const mid = (((cells[0] as number) + cells.length / 2) * TILE) | 0;
        const x = side === 'w' ? TILE / 2 : side === 'e' ? ROOM_W - TILE / 2 : mid;
        const y = side === 'n' ? TILE / 2 : side === 's' ? ROOM_H - TILE / 2 : mid;
        out.x = at.x + x;
        out.y = at.y + y;
      }
    }
    return out;
  });
}

/**
 * The world as a presentation frame: the map (or only its id and version when `opts.state`'s
 * tracker sent it already), the hero, HUD status values, this frame's `events` and a camera hint
 * that puts the play area `opts.top` (HUD_H) pixels down the picture. Pure: it only reads the
 * world (the same world gives the same frame) and keeps its memory in `opts.state`. Entities
 * come in draw order with their depths (presentEntities); without `opts.state`, ids of things the
 * room text did not place count from 1 in each frame.
 */
export function presentWorld(
  world: TopDownWorld,
  events: readonly object[] = [],
  opts: TdPresentOptions = {},
): PresentFrame {
  const size = opts.size ?? DEFAULT_SCREEN;
  const top = opts.top ?? HUD_H;
  const { map, origin, view } = presentMap(world);
  const sent: PresentMap | PresentMapRef = opts.state ? opts.state.maps.next(map) : map;
  const camera: CameraHint = { x: view.x + size.width / 2, y: view.y + size.height / 2 - top };
  return {
    frame: world.frame,
    size: { width: size.width, height: size.height },
    entities: presentEntities(world, {
      world,
      at: origin,
      ids: opts.state?.ids ?? new TdPresentIds(),
      calm: opts.reduceFlashing ?? false,
      dark: world.room.def.dark === true,
    }),
    map: sent,
    events: presentEvents(world, events, origin),
    status: presentStatus(world, top),
    camera,
  };
}
