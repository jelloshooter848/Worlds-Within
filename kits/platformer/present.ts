import { DEFAULT_SCREEN, type ScreenSize } from '@engine/core/gfx/screen';
import type { JsonValue } from '@engine/core/headless';
import { TILE, toPx } from '@engine/core/math/units';
import {
  MapTracker,
  type CameraHint,
  type FrameSource,
  type PresentBox,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type PresentMap,
  type PresentMapRef,
  type PresentStatusValue,
} from '@engine/core/present';
import type { Actor } from './actor';
import type { Body } from './body';
import type { CellKind } from './legend';
import type { PlatformerEvent, PlatformerWorld } from './world';

/**
 * The platformer kit's side of the presentation contract (`@engine/core/present`): it describes
 * the world as a `PresentFrame` and never draws; a backend draws the frame through a skin.
 * Presenting only reads the world: no RNG draws, nothing a snapshot (`snapshot.ts`) reads is
 * touched, so state hashes are the same with or without it. What a stream of frames remembers
 * (the map last sent, animation clocks, short effects) lives in a `PlatformerPresentState`.
 *
 * Coordinates are world pixels (the level's top-left tile at 0, 0), boxes in whole pixels (a
 * body's sub-pixel position floored). The view is only a `camera` hint, never baked in.
 */

/**
 * The characters of a presented map (the kit's tile contract; a skin maps each to a frame). Only
 * the terrain is in the map: coins, goals and mini-game triggers are entities, so taking a coin
 * does not send the map again. Start cells are open air.
 */
export const PRESENT_TILES = {
  empty: '.',
  solid: '#',
  brick: 'B',
  /** A bump block that still holds something. */
  bump: '?',
  /** A bump block that has given what it held. */
  used: 'u',
  'one-way': '=',
  hazard: '^',
} as const;

const CELL_CHAR: Readonly<Record<CellKind, string>> = {
  empty: PRESENT_TILES.empty,
  solid: PRESENT_TILES.solid,
  brick: PRESENT_TILES.brick,
  bump: PRESENT_TILES.bump,
  used: PRESENT_TILES.used,
  'one-way': PRESENT_TILES['one-way'],
  hazard: PRESENT_TILES.hazard,
  coin: PRESENT_TILES.empty,
  start: PRESENT_TILES.empty,
  goal: PRESENT_TILES.empty,
  trigger: PRESENT_TILES.empty,
};

/** Depth layers (`PresentEntity.layer`), drawn low to high. */
export const PF_DEPTH = {
  /** Coins, goals and mini-game triggers. */
  objects: 0,
  /** A bump block bouncing over its tile, a coin popping out of a block. */
  blocks: 5,
  /** Actors and their remains. */
  actors: 10,
  /** The runner (and its remains after a death). */
  runner: 20,
} as const;

/** Ticks a bumped block bounces, and how many pixels it is raised on each (SMBC-like). */
export const BUMP_RISE: readonly number[] = [2, 4, 6, 8, 6, 4, 2, 1];
/** Ticks a coin from a bump block is shown popping up. */
export const COIN_POP_TICKS = 30;
/** Ticks a stomped (`stomped`) or shell-hit (`dead`) actor's remains are shown. */
export const REMAINS_TICKS = 30;
/** Ticks the runner's remains are shown after a death with lives left (the world respawns at once). */
export const RUNNER_DEAD_TICKS = 60;
/** Ticks at the start of invulnerability the runner shows `hurt`. */
export const HURT_TICKS = 12;

/** The runner's animation states, and the ones actors and remains use. */
export const RUNNER_ANIMS = ['idle', 'walk', 'run', 'skid', 'jump', 'fall', 'hurt', 'dead'] as const;
export const ACTOR_ANIMS = ['idle', 'walk', 'run', 'fall', 'stomped', 'dead'] as const;

/** A presentation-only entity a few ticks long (a bounce, a popped coin, remains). */
interface Effect {
  entity: Omit<PresentEntity, 'anim'>;
  state: string;
  since: number;
  ticks: number;
  /** Pixels to raise the box by on each tick, for a bounce. */
  rise?: readonly number[];
}

/**
 * What a stream of frames remembers, outside the world: the map last sent (`maps`), when each
 * entity's animation state began, the last frame's runner and actor boxes (for events about
 * something already gone) and the short effects. Keep one per presenter. Without one a frame
 * still describes the world, but every `anim.t` of a runner or an actor is 0 and there are no
 * effects (bounces, popped coins, remains).
 */
export class PlatformerPresentState {
  readonly maps = new MapTracker();
  private clocks = new Map<string, { state: string; since: number }>();
  private seen = new Map<string, { state: string; since: number }>();
  /** The last presented frame's runner and actors, by id. */
  last = new Map<string, PresentEntity>();
  readonly effects = new Map<string, Effect>();

  /** Ticks `id` has been in `state` (0 when it has just entered it). */
  clock(id: string, state: string, frame: number): number {
    const c = this.clocks.get(id);
    const since = c && c.state === state && c.since <= frame ? c.since : frame;
    this.seen.set(id, { state, since });
    return frame - since;
  }

  /** Ends a frame: clocks of entities not seen in it are forgotten. */
  endFrame(): void {
    this.clocks = this.seen;
    this.seen = new Map();
  }
}

/** A 32-bit FNV-1a hash of the map's look, as a whole number (the map's `version`). */
function versionOf(rows: readonly string[]): number {
  let h = 0x811c9dc5;
  const text = rows.join('\n');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The level's terrain as rows of `PRESENT_TILES` characters: id the level's id, tag
 * `scroll:<mode>`. `version` is a hash of the tiles, so it changes when a bump block is used, a
 * brick breaks or a gate opens, and not when a coin is taken.
 */
export function presentMap(world: PlatformerWorld): PresentMap {
  const t = world.tiles;
  const tiles: string[] = [];
  for (let row = 0; row < t.rows; row++) {
    let line = '';
    for (let col = 0; col < t.cols; col++) line += CELL_CHAR[t.cellAt(col, row)];
    tiles.push(line);
  }
  return {
    id: world.level.id,
    version: versionOf(tiles),
    tileSize: TILE,
    cols: t.cols,
    rows: t.rows,
    tiles,
    tags: [`scroll:${world.level.scroll}`],
  };
}

/** A body's box in whole world pixels. */
function boxOf(b: Body): PresentBox {
  return { x: toPx(b.x), y: toPx(b.y), w: toPx(b.w), h: toPx(b.h) };
}

const facingOf = (dir: number): 'left' | 'right' => (dir < 0 ? 'left' : 'right');

/** The runner's animation state now. */
export function runnerState(world: PlatformerWorld): (typeof RUNNER_ANIMS)[number] {
  const p = world.player;
  const b = p.body;
  const pp = world.profile.player;
  if (world.outcome === 'failed') return 'dead';
  if (p.invuln > 0 && p.invuln > pp.invulnTicks - HURT_TICKS) return 'hurt';
  if (!b.onGround) return b.vy < 0 ? 'jump' : 'fall';
  if (p.skidding) return 'skid';
  if (b.vx === 0) return 'idle';
  return Math.abs(b.vx) > pp.maxWalk ? 'run' : 'walk';
}

/** An actor's animation state now. */
export function actorState(a: Actor): (typeof ACTOR_ANIMS)[number] {
  if (!a.active || a.speed === 0) return a.body.onGround || !a.active ? 'idle' : 'fall';
  if (!a.body.onGround) return 'fall';
  return a.speed > a.def.speed ? 'run' : 'walk';
}

/** An actor's presented id: `actor#<n>`, its number in the level (kept when a stomp changes it). */
export const actorId = (a: { id: number }): string => `actor#${a.id}`;

interface Ctx {
  world: PlatformerWorld;
  state: PlatformerPresentState | undefined;
}

const clock = (ctx: Ctx, id: string, state: string): number =>
  ctx.state ? ctx.state.clock(id, state, ctx.world.frame) : 0;

/** The runner: id `runner`, its body's box, facing, state and tags `invuln`, `hp:<n>`. */
function presentRunner(ctx: Ctx): PresentEntity {
  const p = ctx.world.player;
  const state = runnerState(ctx.world);
  const tags = [`hp:${p.hp}`];
  if (p.invuln > 0) tags.unshift('invuln');
  return {
    id: 'runner',
    kind: 'runner',
    ...boxOf(p.body),
    facing: facingOf(p.facing),
    anim: { state, t: clock(ctx, 'runner', state) },
    tags,
    layer: PF_DEPTH.runner,
  };
}

/** An actor: kind its type's name, tags `asleep` (not yet woken) and `kicked` (a moving shell). */
function presentActor(a: Actor, ctx: Ctx): PresentEntity {
  const id = actorId(a);
  const state = actorState(a);
  const tags: string[] = [];
  if (!a.active) tags.push('asleep');
  if (a.isMovingShell) tags.push('kicked');
  return {
    id,
    kind: a.type,
    ...boxOf(a.body),
    facing: facingOf(a.dir),
    anim: { state, t: clock(ctx, id, state) },
    tags,
    layer: PF_DEPTH.actors,
  };
}

/**
 * Coins (`coin`), goals (`goal`) and mini-game triggers (`trigger`, tags `armed`, `running` and
 * `look:<id>` when its level entry gives a `look`)
 * from the tiles, in reading order: one 16x16 entity per cell, id `<kind>@<col>,<row>`, anim
 * `idle` with `t` the world's frame (they idle from the level's start).
 */
function presentObjects(ctx: Ctx): PresentEntity[] {
  const w = ctx.world;
  const out: PresentEntity[] = [];
  const triggers = new Map(w.triggers.map((t) => [`${t.col},${t.row}`, t]));
  const running = w.miniGame?.trigger;
  for (let row = 0; row < w.tiles.rows; row++) {
    for (let col = 0; col < w.tiles.cols; col++) {
      const cell = w.tiles.cellAt(col, row);
      if (cell !== 'coin' && cell !== 'goal' && cell !== 'trigger') continue;
      const tags: string[] = [];
      if (cell === 'trigger') {
        const t = triggers.get(`${col},${row}`);
        if (t?.armed) tags.push('armed');
        if (t && t === running) tags.push('running');
        if (t?.def.look !== undefined) tags.push(`look:${t.def.look}`);
      }
      out.push({
        id: `${cell}@${col},${row}`,
        kind: cell,
        x: col * TILE,
        y: row * TILE,
        w: TILE,
        h: TILE,
        facing: 'right',
        anim: { state: 'idle', t: w.frame },
        tags,
        layer: PF_DEPTH.objects,
      });
    }
  }
  return out;
}

const tileCentre = (col: number, row: number) => ({ x: col * TILE + TILE / 2, y: row * TILE + TILE / 2 });
const centreOf = (e: PresentBox) => ({ x: e.x + (e.w >> 1), y: e.y + (e.h >> 1) });

/** Events about the runner, placed at its centre with `entity: 'runner'`. */
const RUNNER_EVENTS = new Set(['jump', 'land', 'hurt', 'died', 'respawn', 'cleared']);
/** Events about an actor (its `actor` field), placed at its centre with `entity: 'actor#<n>'`. */
const ACTOR_EVENTS = new Set(['spawn', 'stomp', 'kick', 'defeat']);

/**
 * The world's events as presented events: their fields copied, placed (see the kit's
 * CLAUDE.md, Presentation frames). `last` is the previous frame's runner and actors, for an
 * event about something that is already gone (a stomped actor, the runner before a respawn).
 */
function presentEvents(
  world: PlatformerWorld,
  events: readonly PlatformerEvent[],
  last: ReadonlyMap<string, PresentEntity>,
): PresentEvent[] {
  const runnerNow = boxOf(world.player.body);
  return events.map((e) => {
    const out: PresentEvent = { type: e.type };
    for (const [k, v] of Object.entries(e)) out[k] = v as JsonValue;
    let at: { x: number; y: number } | null = null;
    if (RUNNER_EVENTS.has(e.type)) {
      // A death respawns at once: the runner died where the last frame showed it.
      const box = e.type === 'died' ? (last.get('runner') ?? runnerNow) : runnerNow;
      at = centreOf(box);
      out.entity = 'runner';
    } else if (ACTOR_EVENTS.has(e.type) && 'actor' in e) {
      const id = `actor#${e.actor}`;
      const now = world.actors.find((a) => a.id === e.actor);
      const box = now ? boxOf(now.body) : last.get(id);
      if (box) at = centreOf(box);
      out.entity = id;
    } else if ('col' in e && 'row' in e) {
      at = tileCentre(e.col, e.row);
    } else if ('trigger' in e) {
      const t = world.triggers[e.trigger];
      if (t) at = tileCentre(t.col, t.row);
    }
    if (at) {
      out.x = at.x;
      out.y = at.y;
    }
    return out;
  });
}

/** Starts the effects this frame's events call for (needs a state). */
function startEffects(
  world: PlatformerWorld,
  events: readonly PlatformerEvent[],
  st: PlatformerPresentState,
): void {
  const f = world.frame;
  const add = (id: string, fx: Omit<Effect, 'entity'> & { entity: Omit<PresentEntity, 'anim' | 'id'> }) =>
    st.effects.set(id, { ...fx, entity: { id, ...fx.entity } });
  for (const e of events) {
    if (e.type === 'bump') {
      const cell = world.tiles.cellAt(e.col, e.row);
      if (cell !== 'bump' && cell !== 'used' && cell !== 'brick') continue; // a broken brick does not bounce
      add(`bump-block@${e.col},${e.row}`, {
        entity: {
          kind: 'bump-block',
          x: e.col * TILE,
          y: e.row * TILE,
          w: TILE,
          h: TILE,
          facing: 'right',
          tags: [cell],
          layer: PF_DEPTH.blocks,
        },
        state: 'bump',
        since: f,
        ticks: BUMP_RISE.length,
        rise: BUMP_RISE,
      });
    } else if (e.type === 'block' && (e.content === 'coin' || e.content === 'coins')) {
      add(`coin-pop@${e.col},${e.row}`, {
        entity: {
          kind: 'coin',
          x: e.col * TILE,
          y: (e.row - 1) * TILE,
          w: TILE,
          h: TILE,
          facing: 'right',
          tags: ['popped'],
          layer: PF_DEPTH.blocks,
        },
        state: 'pop',
        since: f,
        ticks: COIN_POP_TICKS,
      });
    } else if ((e.type === 'stomp' && e.into === null) || e.type === 'defeat') {
      const id = `actor#${e.actor}`;
      const was = st.last.get(id);
      if (!was) continue;
      add(id, {
        entity: { ...was, tags: [], layer: PF_DEPTH.actors },
        state: e.type === 'stomp' ? 'stomped' : 'dead',
        since: f,
        ticks: REMAINS_TICKS,
      });
    } else if (e.type === 'died' && e.lives > 0) {
      const was = st.last.get('runner');
      if (!was) continue;
      add('runner/dead', {
        entity: { ...was, kind: 'runner', tags: [], layer: PF_DEPTH.runner },
        state: 'dead',
        since: f,
        ticks: RUNNER_DEAD_TICKS,
      });
    }
  }
}

/** The effects still running, as entities (expired ones are dropped). */
function presentEffects(world: PlatformerWorld, st: PlatformerPresentState): PresentEntity[] {
  const out: PresentEntity[] = [];
  for (const [id, fx] of st.effects) {
    const t = world.frame - fx.since;
    if (t < 0 || t >= fx.ticks) {
      st.effects.delete(id);
      continue;
    }
    const rise = fx.rise?.[t] ?? 0;
    out.push({
      ...fx.entity,
      tags: [...fx.entity.tags],
      y: fx.entity.y - rise,
      anim: { state: fx.state, t },
    });
  }
  return out;
}

/**
 * The HUD values: `coins`, `hp`, `maxHp`, `lives`, `outcome` (`playing`, `cleared`, `failed`),
 * `level` (its id) and `miniGame` (the id of the mini game being played, '' when none).
 */
export function presentStatus(world: PlatformerWorld): Record<string, PresentStatusValue> {
  const pp = world.profile.player;
  return {
    coins: world.coins,
    hp: world.player.hp,
    maxHp: pp.maxHp ?? pp.hp,
    lives: world.lives,
    outcome: world.outcome,
    level: world.level.id,
    miniGame: world.miniGame?.def.id ?? '',
  };
}

/**
 * The camera hint: follow the runner (`follow: 'runner'`), with `x`/`y` the centre of the
 * world's view (`scrollX`, `viewWidth` wide, the level's height) as the fallback. `bounds` holds
 * the scroll lock: scrolling `right` with `scroll-lock` on, the view may not go left of
 * `scrollX`; `none` keeps it on the level's first `viewWidth` pixels; `free` has no bounds (the map).
 */
export function cameraHint(world: PlatformerWorld): CameraHint {
  const levelW = world.tiles.cols * TILE;
  const levelH = world.tiles.rows * TILE;
  const left = toPx(world.scrollX);
  const hint: CameraHint = {
    x: left + Math.floor(Math.min(world.viewWidth, levelW) / 2),
    y: Math.floor(levelH / 2),
    follow: 'runner',
  };
  const scroll = world.level.scroll;
  if (scroll === 'right' && world.rules.isOn('scroll-lock'))
    hint.bounds = { x: left, y: 0, w: Math.max(0, levelW - left), h: levelH };
  else if (scroll === 'none') hint.bounds = { x: 0, y: 0, w: Math.min(world.viewWidth, levelW), h: levelH };
  return hint;
}

export interface PlatformerPresentOptions {
  /** The picture's size (`DEFAULT_SCREEN` when left out). */
  size?: ScreenSize;
  /** What the stream of frames remembers; one per presenter (see `PlatformerPresentState`). */
  state?: PlatformerPresentState;
  /**
   * While a mini game with its own `present()` runs, show its frame (true, the default) or the
   * paused level with `status.miniGame` set (false).
   */
  miniGameFrames?: boolean;
}

/** A mini game's own frame, copied, with the world's frame number and `status.miniGame` set. */
function miniGameFrame(
  world: PlatformerWorld,
  own: PresentFrame,
  size: ScreenSize,
  st: PlatformerPresentState | undefined,
): PresentFrame {
  const copy = JSON.parse(JSON.stringify(own)) as PresentFrame;
  const frame: PresentFrame = {
    ...copy,
    frame: world.frame,
    size: { width: size.width, height: size.height },
    status: { ...copy.status, miniGame: world.miniGame?.def.id ?? '' },
  };
  if (copy.map === undefined) delete frame.map;
  else if (st && 'tiles' in copy.map) frame.map = st.maps.next(copy.map);
  return frame;
}

/**
 * The world as a presentation frame: the map (or only its id and version when `opts.state`'s
 * tracker sent it already), entities in draw order (coins, goals and triggers; block effects;
 * actors and their remains; the runner), this step's `events` placed in the world, HUD status
 * values and a camera hint that follows the runner inside the scroll lock. While a mini game
 * runs, its own frame (when it has `present()`) or the paused level, with `status.miniGame` set.
 * It only reads the world and keeps its memory in `opts.state`.
 */
export function presentWorld(
  world: PlatformerWorld,
  events: readonly PlatformerEvent[] = [],
  opts: PlatformerPresentOptions = {},
): PresentFrame {
  const size = opts.size ?? DEFAULT_SCREEN;
  const st = opts.state;
  const run = world.miniGame;
  if (run?.game.present && opts.miniGameFrames !== false) {
    const frame = miniGameFrame(world, run.game.present(), size, st);
    // Started this tick: the events that started it belong to the level, so keep them too.
    frame.events = [...presentEvents(world, events, st?.last ?? new Map()), ...frame.events];
    return frame;
  }
  const ctx: Ctx = { world, state: st };
  const map = presentMap(world);
  const sent: PresentMap | PresentMapRef = st ? st.maps.next(map) : map;
  const presentedEvents = presentEvents(world, events, st?.last ?? new Map());
  if (st) startEffects(world, events, st);
  const actors = world.actors.map((a) => presentActor(a, ctx));
  const runner = presentRunner(ctx);
  const effects = st ? presentEffects(world, st) : [];
  const entities = [
    ...presentObjects(ctx),
    ...effects.filter((e) => e.layer === PF_DEPTH.blocks),
    ...effects.filter((e) => e.layer === PF_DEPTH.actors),
    ...actors,
    ...effects.filter((e) => e.layer === PF_DEPTH.runner),
    runner,
  ];
  if (st) {
    st.last = new Map([...actors, runner].map((e) => [e.id, e]));
    st.endFrame();
  }
  return {
    frame: world.frame,
    size: { width: size.width, height: size.height },
    entities,
    map: sent,
    events: presentedEvents,
    status: presentStatus(world),
    camera: cameraHint(world),
  };
}

/**
 * The kit's `FrameSource` (`@engine/core/present`, `FrameStream`): a fresh
 * `PlatformerPresentState` per world and `presentWorld` at the picture `size`. A game's stream of
 * frames is `new FrameStream(platformerFrames(screen))`: a new level starts afresh.
 */
export function platformerFrames(
  size?: ScreenSize,
): FrameSource<PlatformerWorld, PlatformerEvent, PlatformerPresentState> {
  return {
    start: () => new PlatformerPresentState(),
    present: (world, events, state) => presentWorld(world, events, size ? { state, size } : { state }),
  };
}
