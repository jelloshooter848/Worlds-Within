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
import type { WorldBox } from './selection';
import { facingOfDir, isFinished, type RtsUnitView, type RtsView } from './snapshot';

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
 * nodes, buildings, selection rings, units, bars, the placing ghost, the selection box.
 */

/** The depth (`layer`) of each thing the kit presents, drawn low to high. */
export const RTS_DEPTH = Object.freeze({
  resource: 5,
  building: 8,
  ring: 9,
  unit: 10,
  bar: 20,
  ghost: 30,
  box: 40,
});

/** The tile size when the options give none (world px per cell). */
export const RTS_TILE_SIZE = 16;

/** Bars are drawn in eighths: `hp-0` .. `hp-8`, `p-0` .. `p-8`. */
const BAR_STEPS = 8;

/** One stream's presentation state: the map tracker and when each entity's animation began. */
export class RtsPresentState {
  readonly maps = new MapTracker();
  private readonly anims = new Map<string, { state: string; since: number }>();

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
  /** This frame's events, passed through. */
  events?: PresentEvent[];
  /** The stream's state (map tracker, animation starts); without it the map is always sent and `t` is the tick. */
  state?: RtsPresentState;
}

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

/** The terrain as a present map: tile ids are the terrain type indexes; tags `type:<i>:<name>`. */
export function presentMap(view: RtsView, tileSize = RTS_TILE_SIZE): PresentMap | null {
  const t = view.terrain;
  if (t === null) return null;
  const tiles: number[][] = [];
  for (let y = 0; y < t.height; y++) tiles.push(t.cells.slice(y * t.width, (y + 1) * t.width));
  return {
    id: 'rts',
    version: terrainVersion(view),
    tileSize,
    cols: t.width,
    rows: t.height,
    tiles,
    tags: t.types.map((ty, i) => `type:${i}:${ty.name}${ty.passable ? '' : ':blocked'}`),
  };
}

/** A unit's animation state: `walk`, `attack`, `build`, `gather` or `idle`. */
export function unitAnim(u: RtsUnitView): string {
  if (u.moveWait > 0) return 'walk';
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

  for (const r of view.resources) {
    entities.push({
      id: `resource-${r.id}`,
      kind: `resource:${r.item}`,
      ...box(r.x, r.y, 1, 1),
      facing: 'down',
      anim: { state: r.amount > 0 ? 'idle' : 'empty', t: 0 },
      tags: [`amount:${r.amount}`],
      layer: RTS_DEPTH.resource,
    });
  }

  for (const b of view.buildings) {
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
    const where = box(b.x, b.y, b.w, b.h);
    if (selected.has(b.id)) ring(`${id}/ring`, [s, 'building'], where);
    entities.push({
      id,
      kind: `building:${b.kind}`,
      ...where,
      facing: 'down',
      anim: { state: anim, t: t(id, anim) },
      tags,
      layer: RTS_DEPTH.building,
    });
    if (b.construction !== null && !b.construction.done) {
      bar(`${id}/progress`, 'progress-bar', 'p', b.construction.progress, b.construction.work, b.x, b.y, b.w);
    } else if (selected.has(b.id) || b.hp < b.maxHp) {
      bar(`${id}/hp`, 'health-bar', 'hp', b.hp, b.maxHp, b.x, b.y, b.w);
    }
  }

  for (const u of view.units) {
    const id = `unit-${u.id}`;
    const s = side(u.faction, player);
    const anim = unitAnim(u);
    const tags = [s, ...(u.faction === null ? [] : [`faction:${u.faction}`])];
    if (u.role !== null && u.role !== 'regular') tags.push(u.role);
    if (u.carry > 0) tags.push('carrying');
    if (selected.has(u.id)) tags.push('selected');
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

  const map = presentMap(view, ts);
  const frame: PresentFrame = {
    frame: tick,
    size: { width: opts.size.width, height: opts.size.height },
    entities,
    events: opts.events ? [...opts.events] : [],
    status: presentStatus(view, player, [...selected], opts.placing ?? null),
  };
  if (map !== null) frame.map = state ? state.maps.next(map) : map;
  if (opts.camera) frame.camera = { ...opts.camera };
  else if (view.terrain !== null)
    frame.camera = { x: (view.terrain.width * ts) / 2, y: (view.terrain.height * ts) / 2 };
  return frame;
}

/**
 * The HUD values: `faction`, `tick`, `stock.<item>` (the player's stockpile), `units` and
 * `enemyUnits` (living counts), `heroes`, `selected` (how many), `selection` (the one type or
 * building kind selected, `mixed`, or ''), `selectedHp` / `selectedMaxHp` (one thing selected),
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
