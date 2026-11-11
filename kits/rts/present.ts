import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  MapTracker,
  type CameraHint,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type PresentMap,
  type PresentStatusValue,
} from '@engine/core/present';
import { RTS_MARKER_MAX, RTS_MARKER_TICKS, type RtsOrderFeedback, type RtsOrderMarker } from './feedback';
import { fogView, RtsFogMemory } from './fog';
import type { WorldBox } from './selection';
import {
  facingOfDir,
  isFinished,
  type RtsBuildingView,
  type RtsResourceView,
  type RtsUnitView,
  type RtsView,
} from './snapshot';

/**
 * The RTS kit's presentation (Engine 0.9, the RTS view): a world snapshot read by `readWorld`
 * described as a `PresentFrame` (`@engine/core/present`), without drawing. A backend draws it
 * through the game's skin. It reads the view and the player's interface state (selection, the box
 * being dragged, a building being placed, the camera) and changes nothing; `RtsPresentState`
 * (one per stream of frames) only keeps the map tracker and when each animation began.
 *
 * Positions are world pixels: cell (x, y) is the box `x * tileSize, y * tileSize` of
 * `tileSize` x `tileSize`. Ids are `unit-<id>`, `building-<id>` and `resource-<id>` (world entity
 * ids), with parts `<id>/ring`, `<id>/hp` and `<id>/progress`. Depths (`RTS_DEPTH`): resource
 * nodes, buildings, selection rings, units, bars, offered-mission markers, the placing ghost, the
 * selection box.
 *
 * Missions (Engine 0.11, decision 4, item 175): members of a frozen event get the tag `frozen`; an
 * offered mission gets a `mission-offer` marker over its target; the HUD shows the offer and the
 * open mission (`offer`, `offers`, `mission`, `missionCommit`, `missionLeft`), each key only while
 * there is one, so a world without missions gives the same frames as before. A unit or finished
 * building below its full hp gets the tag `damaged` (Engine 0.11 T9), for a skin's `byTag` look
 * (the mini siege's burnt siege engines). From Engine 0.16 F6 one whose health bar shows (selected,
 * or below its full hp) also gets `hp:<hp>/<max>`, the bar's numbers for a 3D skin's label, and
 * `mapId` names the map (default `rts`), so a 3D skin dresses each scenario's map its own way.
 *
 * Fog of war and feedback (Engine 0.16 part D, D5; presentation only, no hash moves): with `fog`
 * the frame carries the player's `fog` grid and shows only what the player knows (`fogView`,
 * `fog.ts`): other sides' units on cells seen now, other buildings and resource nodes as last seen
 * (tag `last-seen`, no bars) in explored cells, and the HUD's enemy counts from what is seen; the
 * memory lives in `RtsPresentState`. Accepted orders leave a fading `order-marker` at their target
 * and a `bark` event (`RtsPresentState.accept`, from `RtsControls.feedback`); a selected own unit
 * with a way to walk shows `path-dot`s; an own building training shows a `train` progress bar under
 * it, tagged with the queue's length (`queue:<n>`).
 */

/** The depth (`layer`) of each thing the kit presents, drawn low to high. */
export const RTS_DEPTH = Object.freeze({
  resource: 5,
  path: 6,
  building: 8,
  ring: 9,
  unit: 10,
  bar: 20,
  marker: 24,
  offer: 25,
  ghost: 30,
  box: 40,
});

/** The tile size when the options give none (world px per cell). */
export const RTS_TILE_SIZE = 16;

/** Bars are drawn in eighths: `hp-0` .. `hp-8`, `p-0` .. `p-8`. */
const BAR_STEPS = 8;

/** A selected unit shows at most this many path dots. */
const PATH_DOTS_MAX = 32;

/** A marker the state keeps: the order's target and the tick it was accepted at. */
interface KeptMarker {
  n: number;
  marker: RtsOrderMarker;
  since: number;
}

/**
 * One stream's presentation state: the map tracker, when each entity's animation began, and
 * (Engine 0.16 part D) the player's fog memory (`fog`), the order markers and the barks waiting
 * for the next frame. Never part of a snapshot.
 */
export class RtsPresentState {
  readonly maps = new MapTracker();
  /** The player's explored cells and last-seen buildings and nodes (with `presentWorld`'s `fog`). */
  readonly fog = new RtsFogMemory();
  private readonly anims = new Map<string, { state: string; since: number }>();
  private markerList: KeptMarker[] = [];
  private markerCount = 0;
  private pending: PresentEvent[] = [];

  /** Keeps an order marker from world tick `tick` (it fades over `RTS_MARKER_TICKS`). */
  mark(marker: RtsOrderMarker, tick: number): void {
    this.markerList.push({ n: ++this.markerCount, marker: { ...marker }, since: tick });
    if (this.markerList.length > RTS_MARKER_MAX) this.markerList.shift();
  }

  /** An accepted order's feedback (`RtsControls.feedback`): its marker kept, its barks sent with the next frame. */
  accept(feedback: RtsOrderFeedback, tick: number): void {
    if (feedback.marker !== null) this.mark(feedback.marker, tick);
    this.pending.push(...feedback.events);
  }

  /** The markers still shown at `tick`, oldest first, with their number and age (ticks); older ones are dropped. */
  markers(tick: number): { n: number; marker: RtsOrderMarker; age: number }[] {
    this.markerList = this.markerList.filter((m) => m.since <= tick && tick - m.since < RTS_MARKER_TICKS);
    return this.markerList.map((m) => ({ n: m.n, marker: m.marker, age: tick - m.since }));
  }

  /** The barks waiting for the next frame (taken: the next call gives none). */
  takeEvents(): PresentEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** Ticks `id` has been in `state` at `tick` (0 on a change of state). */
  ticksIn(id: string, state: string, tick: number): number {
    const a = this.anims.get(id);
    if (a === undefined || a.state !== state || a.since > tick) {
      this.anims.set(id, { state, since: tick });
      return 0;
    }
    return tick - a.since;
  }
}

/** A building being placed: its type and size (cells) with its north-west corner on `cell`. */
export interface RtsPlacing {
  building: string;
  cell: { x: number; y: number };
  w: number;
  h: number;
}

/**
 * What the presentation needs of a mission (a `MissionDef` from the game's content fits): its
 * title for the HUD, its event to find the offer marker's target, and an optional `marker` that
 * overrides it: an entity id, or (Engine 0.15 T7, gap M25) a scenario key, the mission file's
 * `marker`, resolved through the options' `keys`.
 */
export interface RtsMissionInfo {
  readonly id: string;
  readonly title: string;
  readonly event?: string;
  readonly marker?: number | string;
}

/** A mission definition as the RTS presentation reads it: id, title, event and `marker` (gap M25). */
export function rtsMissionInfo(def: RtsMissionInfo): RtsMissionInfo {
  return {
    id: def.id,
    title: def.title,
    ...(def.event !== undefined && { event: def.event }),
    ...(def.marker !== undefined && { marker: def.marker }),
  };
}

export interface RtsPresentOptions {
  /** The player's faction: whose units are `own`, whose stockpile the HUD shows. */
  faction: string;
  /** The picture size. */
  size: ScreenSize;
  /** World px per cell (default `RTS_TILE_SIZE`, 16). */
  tileSize?: number;
  /** The selected entity ids. */
  selection?: readonly number[];
  /** The selection box being dragged, in world px, or null. */
  box?: WorldBox | null;
  /** A building being placed, or null. */
  placing?: RtsPlacing | null;
  /** The camera hint (`RtsCamera.hint()`); the map's centre when left out. */
  camera?: CameraHint;
  /** The game's missions (titles, events, marker targets) for the offer markers and the HUD. */
  missions?: readonly RtsMissionInfo[];
  /**
   * The world's key table (scenario key to entity id; Engine 0.15 T7, gap M25), for a mission's
   * `marker` given as a key. Left out, a key marker is ignored.
   */
  keys?: Readonly<Record<string, number>>;
  /** This frame's events, passed through. */
  events?: PresentEvent[];
  /** The stream's state (map tracker, animation starts); without it the map is always sent and `t` is the tick. */
  state?: RtsPresentState;
  /**
   * The map's id (default `RTS_MAP_ID`, `rts`; Engine 0.16 F6): a game with several scenarios
   * names each, so a 3D skin's `decor` and `places` (keyed by map id) dress each one its own way.
   */
  mapId?: string;
  /**
   * Fog of war for `faction` (Engine 0.16 part D, D5; default off): the frame's `fog` grid, other
   * sides' units only where seen now, other buildings and nodes as last seen (with `state`, which
   * keeps the memory), and the HUD's enemy counts from what is seen.
   */
  fog?: boolean;
}

/** The id of the map `presentWorld` sends when its options name none. */
export const RTS_MAP_ID = 'rts';

/** A 32-bit FNV-1a hash of the terrain cells and size: the map's version. */
function terrainVersion(view: RtsView): number {
  const t = view.terrain;
  if (t === null) return 0;
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= (n >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(t.width);
  mix(t.height);
  for (const c of t.cells) mix(c);
  for (const ty of t.types) for (const ch of ty.name) mix(ch.charCodeAt(0));
  return h;
}

/** The terrain as a present map (id `id`): tile ids are the terrain type indexes; tags `type:<i>:<name>`. */
export function presentMap(view: RtsView, tileSize = RTS_TILE_SIZE, id = RTS_MAP_ID): PresentMap | null {
  const t = view.terrain;
  if (t === null) return null;
  const tiles: number[][] = [];
  for (let y = 0; y < t.height; y++) tiles.push(t.cells.slice(y * t.width, (y + 1) * t.width));
  return {
    id,
    version: terrainVersion(view),
    tileSize,
    cols: t.width,
    rows: t.height,
    tiles,
    tags: t.types.map((ty, i) => `type:${i}:${ty.name}${ty.passable ? '' : ':blocked'}`),
  };
}

/**
 * A unit's animation state: `walk`, `attack`, `build`, `gather` or `idle`. A step's wait shows as
 * `walk` only while the unit has a task: a stopped unit finishing its last step stands.
 */
export function unitAnim(u: RtsUnitView): string {
  if (u.moveWait > 0 && u.task !== null) return 'walk';
  if (u.target !== null) return 'attack';
  if (u.task === 'build') return 'build';
  if (u.task === 'gather') return 'gather';
  if (u.task === 'move' || u.task === 'attack') return 'walk';
  return 'idle';
}

/** Which side `faction` is on for the player. */
function side(faction: string | null, player: string): 'own' | 'enemy' | 'neutral' {
  if (faction === null) return 'neutral';
  return faction === player ? 'own' : 'enemy';
}

/** The eighths of a bar for `n` out of `of` (at least 1 while n > 0). */
function eighths(n: number, of: number): number {
  if (of <= 0 || n <= 0) return 0;
  return Math.max(1, Math.min(BAR_STEPS, Math.floor((n * BAR_STEPS) / of)));
}

/** Describes the world as one presentation frame (see the file comment). */
export function presentWorld(view: RtsView, opts: RtsPresentOptions): PresentFrame {
  const ts = opts.tileSize ?? RTS_TILE_SIZE;
  const player = opts.faction;
  const selected = new Set(opts.selection ?? []);
  const state = opts.state;
  const tick = view.tick;
  const t = (id: string, s: string) => (state ? state.ticksIn(id, s, tick) : tick);
  const entities: PresentEntity[] = [];
  const box = (x: number, y: number, w: number, h: number) => ({
    x: x * ts,
    y: y * ts,
    w: w * ts,
    h: h * ts,
  });
  const bar = (
    id: string,
    kind: string,
    prefix: string,
    n: number,
    of: number,
    x: number,
    y: number,
    w: number,
  ) =>
    entities.push({
      id,
      kind,
      x: x * ts,
      y: y * ts - 3,
      w: w * ts,
      h: 2,
      facing: 'down',
      anim: { state: `${prefix}-${eighths(n, of)}`, t: 0 },
      tags: [],
      layer: RTS_DEPTH.bar,
    });
  const ring = (id: string, tags: string[], b: { x: number; y: number; w: number; h: number }) =>
    entities.push({
      id,
      kind: 'selection-ring',
      ...b,
      facing: 'down',
      anim: { state: 'idle', t: 0 },
      tags,
      layer: RTS_DEPTH.ring,
    });

  // What the player is shown: everything, or under fog what they know (Engine 0.16 part D, D5).
  const known = opts.fog ? fogView(view, player, state?.fog ?? null) : null;
  const shownResources: { thing: RtsResourceView; remembered: boolean }[] =
    known?.resources ?? view.resources.map((thing) => ({ thing, remembered: false }));
  const shownBuildings: { thing: RtsBuildingView; remembered: boolean }[] =
    known?.buildings ?? view.buildings.map((thing) => ({ thing, remembered: false }));
  const shownUnits = known?.units ?? view.units;
  // The view the HUD reads: under fog, only the units seen and the buildings shown now.
  const seen: RtsView =
    known === null
      ? view
      : {
          ...view,
          units: shownUnits,
          buildings: shownBuildings.filter((b) => !b.remembered).map((b) => b.thing),
        };

  for (const { thing: r, remembered } of shownResources) {
    entities.push({
      id: `resource-${r.id}`,
      kind: `resource:${r.item}`,
      ...box(r.x, r.y, 1, 1),
      facing: 'down',
      anim: { state: r.amount > 0 ? 'idle' : 'empty', t: 0 },
      tags: [`amount:${r.amount}`, ...(remembered ? ['last-seen'] : [])],
      layer: RTS_DEPTH.resource,
    });
  }

  for (const { thing: b, remembered } of shownBuildings) {
    const id = `building-${b.id}`;
    const s = side(b.faction, player);
    const built = isFinished(b);
    const queue = b.producer?.queue ?? [];
    const anim = !built ? 'site' : queue.length > 0 ? 'train' : 'idle';
    const tags = [s, ...(b.faction === null ? [] : [`faction:${b.faction}`])];
    if (b.construction !== null && !b.construction.done) {
      tags.push('site', `progress:${Math.floor((b.construction.progress * 100) / b.construction.work)}`);
    }
    if (queue[0] !== undefined) tags.push(`training:${queue[0].unit}`);
    if (selected.has(b.id)) tags.push('selected');
    if (built && b.hp < b.maxHp) tags.push('damaged');
    if (b.frozen) tags.push('frozen');
    if (remembered) tags.push('last-seen');
    // The health a bar shows, as `hp:<hp>/<max>` (Engine 0.16 F6: a 3D skin's label reads it).
    if (built && !remembered && (selected.has(b.id) || b.hp < b.maxHp)) tags.push(`hp:${b.hp}/${b.maxHp}`);
    const where = box(b.x, b.y, b.w, b.h);
    if (selected.has(b.id) && !remembered) ring(`${id}/ring`, [s, 'building'], where);
    entities.push({
      id,
      kind: `building:${b.kind}`,
      ...where,
      facing: 'down',
      anim: { state: anim, t: t(id, anim) },
      tags,
      layer: RTS_DEPTH.building,
    });
    if (remembered) continue;
    if (b.construction !== null && !b.construction.done) {
      bar(`${id}/progress`, 'progress-bar', 'p', b.construction.progress, b.construction.work, b.x, b.y, b.w);
    } else if (selected.has(b.id) || b.hp < b.maxHp) {
      bar(`${id}/hp`, 'health-bar', 'hp', b.hp, b.maxHp, b.x, b.y, b.w);
    }
    // Training in the world (Engine 0.16 part D, D5): the own building's first unit's progress
    // under it, tagged with how many are queued (`queue:<n>`, a skin's label reads it).
    const head = queue[0];
    if (built && s === 'own' && head !== undefined && b.producer !== null) {
      entities.push({
        id: `${id}/train`,
        kind: 'progress-bar',
        x: b.x * ts,
        y: (b.y + b.h) * ts + 1,
        w: b.w * ts,
        h: 2,
        facing: 'down',
        anim: { state: `p-${eighths(b.producer.progress, head.ticks)}`, t: 0 },
        tags: ['train', `training:${head.unit}`, `queue:${queue.length}`],
        layer: RTS_DEPTH.bar,
      });
    }
  }

  for (const u of shownUnits) {
    const id = `unit-${u.id}`;
    const s = side(u.faction, player);
    const anim = unitAnim(u);
    const tags = [s, ...(u.faction === null ? [] : [`faction:${u.faction}`])];
    if (u.role !== null && u.role !== 'regular') tags.push(u.role);
    if (u.carry > 0) tags.push('carrying');
    if (selected.has(u.id)) tags.push('selected');
    if (u.hp < u.maxHp) tags.push('damaged');
    if (u.frozen) tags.push('frozen');
    if (selected.has(u.id) || u.hp < u.maxHp) tags.push(`hp:${u.hp}/${u.maxHp}`);
    const where = box(u.x, u.y, 1, 1);
    if (selected.has(u.id)) ring(`${id}/ring`, [s, ...(u.role === 'hero' ? ['hero'] : [])], where);
    entities.push({
      id,
      kind: u.type === null ? 'unit' : `unit:${u.type}`,
      ...where,
      facing: facingOfDir(u.dir),
      anim: { state: anim, t: t(id, anim) },
      tags,
      layer: RTS_DEPTH.unit,
    });
    if (selected.has(u.id) || u.hp < u.maxHp) bar(`${id}/hp`, 'health-bar', 'hp', u.hp, u.maxHp, u.x, u.y, 1);
    // Path dots (Engine 0.16 part D, D5): a selected own unit's way, from its task's path, else its goal.
    if (selected.has(u.id) && s === 'own') {
      const cells = (u.path ?? (u.goal !== undefined ? [u.goal] : [])).slice(0, PATH_DOTS_MAX);
      const dot = Math.max(2, Math.floor(ts / 4));
      cells.forEach((c, i) => {
        if (c.x === u.x && c.y === u.y) return;
        const last = i === cells.length - 1;
        entities.push({
          id: `${id}/path-${i}`,
          kind: 'path-dot',
          x: c.x * ts + Math.floor((ts - dot) / 2),
          y: c.y * ts + Math.floor((ts - dot) / 2),
          w: dot,
          h: dot,
          facing: 'down',
          anim: { state: last ? 'goal' : 'idle', t: 0 },
          tags: ['own', ...(last ? ['goal'] : [])],
          layer: RTS_DEPTH.path,
        });
      });
    }
  }

  // Order markers (Engine 0.16 part D, D5): each accepted command's target, fading in eighths; an
  // attack's or gather's follows its entity while it is shown.
  for (const { n, marker: m, age } of state?.markers(tick) ?? []) {
    const followed =
      m.entity === null
        ? null
        : (shownUnits.find((u) => u.id === m.entity) ??
          shownBuildings.find((b) => b.thing.id === m.entity)?.thing);
    const at =
      followed === undefined || followed === null
        ? m
        : 'w' in followed
          ? { x: followed.x, y: followed.y, w: followed.w, h: followed.h }
          : { x: followed.x, y: followed.y, w: 1, h: 1 };
    entities.push({
      id: `marker-${n}`,
      kind: 'order-marker',
      ...box(at.x, at.y, at.w, at.h),
      facing: 'down',
      anim: { state: m.kind, t: age },
      tags: [m.kind, `fade:${Math.ceil(((RTS_MARKER_TICKS - age) * BAR_STEPS) / RTS_MARKER_TICKS)}`],
      layer: RTS_DEPTH.marker,
    });
  }

  for (const offer of view.missions.offered) {
    const info = opts.missions?.find((m) => m.id === offer.mission);
    const target = info === undefined ? null : offerTarget(view, info, player, opts.keys);
    if (target === null) continue;
    const id = `offer-${offer.opportunity}`;
    entities.push({
      id,
      kind: 'mission-offer',
      ...box(target.x, target.y, target.w, target.h),
      facing: 'down',
      anim: { state: 'idle', t: t(id, 'idle') },
      tags: [`mission:${offer.mission}`, `opportunity:${offer.opportunity}`, `target:${target.id}`],
      layer: RTS_DEPTH.offer,
    });
  }

  if (opts.placing) {
    const p = opts.placing;
    entities.push({
      id: 'placing',
      kind: `ghost:${p.building}`,
      ...box(p.cell.x, p.cell.y, p.w, p.h),
      facing: 'down',
      anim: { state: 'idle', t: 0 },
      tags: ['ghost'],
      layer: RTS_DEPTH.ghost,
    });
  }
  if (opts.box) {
    const b = opts.box;
    entities.push({
      id: 'select-box',
      kind: 'selection-box',
      x: Math.min(b.x, b.x + b.w),
      y: Math.min(b.y, b.y + b.h),
      w: Math.abs(b.w),
      h: Math.abs(b.h),
      facing: 'down',
      anim: { state: 'idle', t: 0 },
      tags: [],
      layer: RTS_DEPTH.box,
    });
  }

  const map = presentMap(view, ts, opts.mapId);
  const frame: PresentFrame = {
    frame: tick,
    size: { width: opts.size.width, height: opts.size.height },
    entities,
    events: [...(opts.events ?? []), ...(state?.takeEvents() ?? [])],
    status: {
      ...presentStatus(seen, player, [...selected], opts.placing ?? null),
      ...missionStatus(view, opts.missions ?? []),
      ...keyStatus(view, opts.keys ?? {}),
      ...threatStatus(seen, player),
    },
  };
  if (known?.fog) frame.fog = known.fog;
  if (map !== null) frame.map = state ? state.maps.next(map) : map;
  if (opts.camera) frame.camera = { ...opts.camera };
  else if (view.terrain !== null)
    frame.camera = { x: (view.terrain.width * ts) / 2, y: (view.terrain.height * ts) / 2 };
  return frame;
}

/**
 * Where an offered mission's marker goes: the `marker` entity (an id, or a key `keys` gives an id,
 * gap M25) when it is in the view, else the lowest-id enemy unit in the mission's
 * event, else its lowest-id member (unit, then building); null when there is none (a mission
 * without an event or marker gets no marker).
 */
export function offerTarget(
  view: RtsView,
  info: RtsMissionInfo,
  player: string,
  keys: Readonly<Record<string, number>> = {},
): { id: number; x: number; y: number; w: number; h: number } | null {
  const unit = (u: RtsUnitView) => ({ id: u.id, x: u.x, y: u.y, w: 1, h: 1 });
  const marker =
    typeof info.marker === 'string'
      ? Object.hasOwn(keys, info.marker)
        ? keys[info.marker]
        : undefined
      : info.marker;
  if (marker !== undefined) {
    const u = view.units.find((x) => x.id === marker);
    if (u) return unit(u);
    const b = view.buildings.find((x) => x.id === marker);
    if (b) return { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h };
  }
  if (info.event === undefined) return null;
  const members = view.units.filter((u) => u.event === info.event);
  const pick = members.find((u) => u.faction !== null && u.faction !== player) ?? members[0];
  if (pick !== undefined) return unit(pick);
  const b = view.buildings.find((x) => x.event === info.event);
  return b ? { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h } : null;
}

/**
 * The mission HUD values, each only while it applies: `offers` (how many opportunities are offered)
 * and `offer` (the first one's mission title, else its id); while a mission is open (the first by
 * id), `mission` (its title), `missionCommit` (the world tick its result commits at) and
 * `missionLeft` (world ticks to it, at least 0).
 */
export function missionStatus(
  view: RtsView,
  missions: readonly RtsMissionInfo[],
): Record<string, PresentStatusValue> {
  const status: Record<string, PresentStatusValue> = {};
  const first = view.missions.offered[0];
  if (first !== undefined) {
    status['offers'] = view.missions.offered.length;
    status['offer'] = missions.find((m) => m.id === first.mission)?.title ?? first.mission;
  }
  const open = view.missions.open[0];
  if (open !== undefined) {
    status['mission'] = open.title;
    status['missionCommit'] = open.commitTick;
    status['missionLeft'] = Math.max(0, open.commitTick - view.tick);
  }
  return status;
}

/**
 * The HUD values of the world's keyed entities (Engine 0.16 F7: a HUD's objectives), for every
 * key of `keys` in key order: `key.<key>.alive` (1 while its entity is in the world and, for a
 * named person, not dead; else 0); while it is on the map, `key.<key>.hp` and `key.<key>.maxHp`,
 * and for a building with a construction, `key.<key>.progress` (0-100); for a named person,
 * `key.<key>.fate` (`active`, `injured`, `captured`, `freed`, `dead`) and `key.<key>.name`.
 * Presentation only, as every status value.
 */
export function keyStatus(
  view: RtsView,
  keys: Readonly<Record<string, number>>,
): Record<string, PresentStatusValue> {
  const status: Record<string, PresentStatusValue> = {};
  for (const key of Object.keys(keys).sort()) {
    const id = keys[key]!;
    const at = `key.${key}`;
    const unit = view.units.find((u) => u.id === id);
    const building = view.buildings.find((b) => b.id === id);
    const named = view.named.find((n) => n.id === id);
    const here = unit ?? building;
    if (here !== undefined) {
      status[`${at}.hp`] = here.hp;
      status[`${at}.maxHp`] = here.maxHp;
    }
    const c = building?.construction ?? null;
    if (c !== null) status[`${at}.progress`] = c.done ? 100 : Math.floor((c.progress * 100) / c.work);
    if (named !== undefined) {
      status[`${at}.fate`] = named.fate;
      status[`${at}.name`] = named.name;
    }
    const alive = named !== undefined ? named.fate !== 'dead' : here !== undefined;
    status[`${at}.alive`] = alive ? 1 : 0;
  }
  return status;
}

/**
 * How close the enemy is (Engine 0.16 F7: a music layer or a warning on the HUD):
 * `enemyNear`, the fewest cells (Chebyshev) from any enemy unit to any of the player's buildings,
 * left out when either side has none.
 */
export function threatStatus(view: RtsView, player: string): Record<string, PresentStatusValue> {
  const own = view.buildings.filter((b) => b.faction === player);
  const foes = view.units.filter((u) => u.faction !== null && u.faction !== player);
  let near = Infinity;
  for (const u of foes)
    for (const b of own) {
      const dx = Math.max(b.x - u.x, 0, u.x - (b.x + b.w - 1));
      const dy = Math.max(b.y - u.y, 0, u.y - (b.y + b.h - 1));
      near = Math.min(near, Math.max(dx, dy));
    }
  return near === Infinity ? {} : { enemyNear: near };
}

/**
 * The HUD values: `faction`, `tick`, `stock.<item>` (the player's stockpile), `units` and
 * `enemyUnits` (living counts), `heroes`, `captives` (the player's named people captured) and
 * `captive` (the first one's name, only while there is one; Engine 0.13 T8), `selected` (how many), `selection` (the one type or
 * building kind selected, `mixed`, or ''), `selectedHp` / `selectedMaxHp` (one thing selected;
 * from Engine 0.16 F7 also `selectedName`, a named person's name else its type or kind,
 * `selectedType` and `selectedRole`, a named person's role else ''),
 * `queue` (units queued at the selected own buildings), `training` (the first of them, or '') and
 * `trainingProgress` (0-100), `trainButtons` (the unit types the selection can train, space
 * separated) and `placing` (the building being placed, or '').
 */
export function presentStatus(
  view: RtsView,
  player: string,
  selection: readonly number[],
  placing: RtsPlacing | null,
): Record<string, PresentStatusValue> {
  const status: Record<string, PresentStatusValue> = { faction: player, tick: view.tick };
  for (const [item, n] of Object.entries(view.stock[player] ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    status[`stock.${item}`] = n;
  }
  status['units'] = view.units.filter((u) => u.faction === player).length;
  status['enemyUnits'] = view.units.filter((u) => u.faction !== null && u.faction !== player).length;
  status['heroes'] = view.units.filter((u) => u.faction === player && u.role === 'hero').length;
  // Engine 0.13 T8: the player's named people held by another side, for a captive marker.
  const captives = view.named.filter((n) => n.faction === player && n.fate === 'captured');
  status['captives'] = captives.length;
  if (captives[0] !== undefined) status['captive'] = captives[0].name;
  const sel = new Set(selection);
  const units = view.units.filter((u) => sel.has(u.id));
  const buildings = view.buildings.filter((b) => sel.has(b.id));
  const names = new Set([...units.map((u) => u.type ?? 'unit'), ...buildings.map((b) => b.kind)]);
  status['selected'] = units.length + buildings.length;
  status['selection'] = names.size === 0 ? '' : names.size === 1 ? [...names][0]! : 'mixed';
  const one = units.length + buildings.length === 1 ? (units[0] ?? buildings[0])! : null;
  if (one !== null) {
    status['selectedHp'] = one.hp;
    status['selectedMaxHp'] = one.maxHp;
    // Engine 0.16 F7: who it is, for a HUD's selected-unit panel (a named person's name and role,
    // else its type or building kind).
    const kind = units[0] !== undefined ? (units[0].type ?? 'unit') : buildings[0]!.kind;
    const named = view.named.find((n) => n.id === one.id);
    status['selectedName'] = named?.name ?? kind;
    status['selectedType'] = kind;
    status['selectedRole'] = named?.role ?? '';
  }
  const own = buildings.filter((b) => b.faction === player && b.producer !== null);
  const queued = own.flatMap((b) => b.producer!.queue);
  status['queue'] = queued.length;
  const first = own.find((b) => b.producer!.queue.length > 0);
  const head = first?.producer!.queue[0];
  status['training'] = head?.unit ?? '';
  status['trainingProgress'] =
    head !== undefined ? Math.min(100, Math.floor((first!.producer!.progress * 100) / head.ticks)) : 0;
  const buttons: string[] = [];
  for (const b of own)
    if (isFinished(b)) for (const u of b.producer!.trains) if (!buttons.includes(u)) buttons.push(u);
  status['trainButtons'] = buttons.join(' ');
  status['placing'] = placing?.building ?? '';
  return status;
}
