import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  freezeFrame,
  MapTracker,
  type CameraHint,
  type DeepReadonly,
  type Facing,
  type FrameSource,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type PresentMap,
  type PresentStatusValue,
} from '@engine/core/present';
import type { Cell, CellKind } from './map';
import { CELL_SUB } from './schema';
import { sellValue, upgradeCost, type EnemyState, type TdEvent, type TdWorld } from './world';

/**
 * The tower-defense kit's side of the presentation contract (`@engine/core/present`): a round
 * (`TdWorld`) described as a `PresentFrame`, never drawn; a backend draws it through a skin.
 * Presenting only reads the round (no RNG draws, nothing `snapshot()` reads is touched), so
 * hashes are the same with or without it. What a stream of frames remembers (the map last sent,
 * animation clocks, the last enemy boxes, the waves already cleared) is a `TdPresentState`.
 *
 * Positions are world pixels: cell (col, row) is the box `col * tileSize, row * tileSize`. An
 * enemy's box slides along the path by its progress (whole pixels, floored). Ids: `tower-<id>`,
 * `enemy-<id>`, `shot-<tower id>` (a shot shown on the frame its tower fired), `cursor` and
 * `ghost`. Depths are `TD_DEPTH`.
 *
 * Events: each round event since the last frame becomes one present event (`TD_EVENT_TYPES`):
 * `td-place`, `td-sell`, `td-upgrade` (`level`, `cost`), `td-refused` (`code`), `td-wave-start` (`wave`, `by`), `td-spawn`,
 * `td-shot` (at the target, with `from`, `fromX`/`fromY`, `damage`, `hp`), `td-kill` (`bounty`),
 * `td-leak` (at the exit, `lives`), then `td-wave-clear` (`wave`; once per wave and stream, so only
 * with a `TdPresentState`) and `td-end` (`result`: `won` or `lost`, so a skin keys `td-end:won`).
 */

/** The depth (`layer`) of each thing presented, drawn low to high. */
export const TD_DEPTH = Object.freeze({
  tower: 5,
  enemy: 10,
  shot: 15,
  ghost: 20,
  cursor: 25,
});

/** World px per cell when the options give none. */
export const TD_TILE_SIZE = 16;

/**
 * The characters of a presented map, one per cell kind (the kit legend's own; a map header's
 * extra characters are shown as the kind they mean). A skin maps each to a tile frame.
 */
export const TD_TILES: Readonly<Record<CellKind, string>> = Object.freeze({
  blocked: '.',
  path: '#',
  build: 'B',
  entry: 'S',
  exit: 'X',
});

/** The presented event types (`PresentEvent.type`), for a skin's `events` keys. */
export const TD_EVENT_TYPES = [
  'td-place',
  'td-sell',
  'td-upgrade',
  'td-refused',
  'td-wave-start',
  'td-spawn',
  'td-shot',
  'td-kill',
  'td-leak',
  'td-wave-clear',
  'td-end',
] as const;

/** One stream's memory: the map tracker, animation clocks, the last enemy boxes, cleared waves. */
export class TdPresentState {
  readonly maps = new MapTracker();
  private readonly anims = new Map<string, { state: string; since: number }>();
  /** The last frame's enemy boxes by id, to place a kill or leak of an enemy already gone. */
  last = new Map<number, { x: number; y: number }>();
  /** Waves (1-based) already reported as cleared. */
  readonly cleared = new Set<number>();

  /** A state for `world` shown from now: waves already cleared are not reported again. */
  static start(world: TdWorld): TdPresentState {
    const s = new TdPresentState();
    for (let w = 1; w <= world.wavesStarted; w++) if (world.waveLeft(w) === 0) s.cleared.add(w);
    return s;
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

/** The player's cursor and chosen tower type, as `TdControls` (`controls.ts`) gives them. */
export interface TdCursorView {
  col: number;
  row: number;
  /** The chosen tower type id. */
  tower: string;
}

export interface TdPresentOptions {
  /** The picture size. */
  size: ScreenSize;
  /** World px per cell (default `TD_TILE_SIZE`, 16). */
  tileSize?: number;
  /** The events since the last frame (default: the round's last step's). */
  events?: readonly TdEvent[];
  /** The cursor and chosen tower; no cursor, ghost or `tower` status when left out. */
  cursor?: TdCursorView | null;
  /** The camera zoom (default 1). */
  zoom?: number;
  /** The stream's memory; without it the map is always sent, `t` is the tick and nothing is remembered. */
  state?: TdPresentState;
}

/** The map as a present map: the kit's characters (`TD_TILES`); its id is `td:<map id>`. */
export function presentMap(world: TdWorld, tileSize = TD_TILE_SIZE): PresentMap {
  const tiles = world.kinds.map((row) => row.map((k) => TD_TILES[k]).join(''));
  return {
    id: `td:${world.map.id}`,
    version: 1,
    tileSize,
    cols: world.kinds[0]?.length ?? 0,
    rows: world.kinds.length,
    tiles,
  };
}

/** The cardinal from one cell to the next. */
function stepFacing(a: Cell, b: Cell): Facing {
  if (b.col > a.col) return 'right';
  if (b.col < a.col) return 'left';
  if (b.row < a.row) return 'up';
  return 'down';
}

/** The facing (one of eight) from a cell offset: diagonal unless one axis is at most half the other. */
export function facingToward(dc: number, dr: number): Facing {
  const ac = Math.abs(dc);
  const ar = Math.abs(dr);
  if (ac === 0 && ar === 0) return 'down';
  if (2 * ar <= ac) return dc > 0 ? 'right' : 'left';
  if (2 * ac <= ar) return dr > 0 ? 'down' : 'up';
  return `${dr > 0 ? 'down' : 'up'}-${dc > 0 ? 'right' : 'left'}` as Facing;
}

/** An enemy's top-left (world px) along the path by its progress, and the way it walks. */
export function enemyPlace(
  world: TdWorld,
  e: Pick<EnemyState, 'progress'>,
  tileSize = TD_TILE_SIZE,
): { x: number; y: number; facing: Facing } {
  const path = world.path;
  const i = Math.min(Math.floor(e.progress / CELL_SUB), path.length - 1);
  const f = e.progress - i * CELL_SUB;
  const a = path[i]!;
  const b = path[Math.min(i + 1, path.length - 1)]!;
  const facing = i + 1 < path.length ? stepFacing(a, b) : i > 0 ? stepFacing(path[i - 1]!, a) : 'down';
  const sub = (from: number, to: number) =>
    Math.floor(((from * CELL_SUB + (to - from) * f) * tileSize) / CELL_SUB);
  return { x: sub(a.col, b.col), y: sub(a.row, b.row), facing };
}

/**
 * The frame for the round now (not frozen; `presentWorld` freezes it), with the events since the
 * last frame turned into present events (`TD_EVENT_TYPES`). See the file comment.
 */
export function describeWorld(world: TdWorld, opts: TdPresentOptions): PresentFrame {
  const ts = opts.tileSize ?? TD_TILE_SIZE;
  const state = opts.state;
  const tick = world.tick;
  const t = (id: string, s: string) => (state ? state.ticksIn(id, s, tick) : tick);
  const events = opts.events ?? world.events;
  const cellBox = (col: number, row: number) => ({ x: col * ts, y: row * ts, w: ts, h: ts });
  const centre = (col: number, row: number) => ({ x: col * ts + ts / 2, y: row * ts + ts / 2 });
  const entities: PresentEntity[] = [];

  const fired = new Map<number, number>();
  const hit = new Set<number>();
  for (const e of events)
    if (e.type === 'fire') {
      fired.set(e.tower, e.enemy);
      hit.add(e.enemy);
    }

  const enemyBoxes = new Map<number, { x: number; y: number }>();
  for (const e of world.enemies) {
    const p = enemyPlace(world, e, ts);
    enemyBoxes.set(e.id, { x: p.x, y: p.y });
  }
  /** Where an enemy is (or was last seen), world px of its box's top-left. */
  const enemyAt = (id: number) => enemyBoxes.get(id) ?? state?.last.get(id) ?? null;

  for (const tw of world.towers) {
    const id = `tower-${tw.id}`;
    const targetId = fired.get(tw.id);
    const target =
      targetId !== undefined
        ? enemyAt(targetId)
        : (() => {
            const e = world.targetOf(tw);
            return e === undefined ? null : (enemyBoxes.get(e.id) ?? null);
          })();
    const facing = target === null ? 'down' : facingToward(target.x - tw.col * ts, target.y - tw.row * ts);
    const anim = targetId !== undefined ? 'fire' : 'idle';
    entities.push({
      id,
      kind: `tower:${tw.type}`,
      ...cellBox(tw.col, tw.row),
      facing,
      anim: { state: anim, t: t(id, anim) },
      tags: [
        `type:${tw.type}`,
        tw.cooldown > 0 ? 'cooling' : 'ready',
        `level:${tw.level}`,
        `range:${world.statsOf(tw).range}`,
      ],
      layer: TD_DEPTH.tower,
    });
  }

  for (const e of world.enemies) {
    const id = `enemy-${e.id}`;
    const p = enemyPlace(world, e, ts);
    const struck = hit.has(e.id);
    const ent: PresentEntity = {
      id,
      kind: `enemy:${e.kind}`,
      x: p.x,
      y: p.y,
      w: ts,
      h: ts,
      facing: p.facing,
      anim: { state: 'walk', t: t(id, 'walk') },
      tags: [`hp:${e.hp}`, `wave:${e.wave}`, ...(struck ? ['hit'] : [])],
      layer: TD_DEPTH.enemy,
    };
    if (struck) ent.fx = { tint: 'hit' };
    entities.push(ent);
  }

  for (const [towerId, enemyId] of fired) {
    const at = enemyAt(enemyId);
    const tw = world.towers.find((x) => x.id === towerId);
    if (at === null || tw === undefined) continue;
    entities.push({
      id: `shot-${towerId}`,
      kind: `shot:${tw.type}`,
      x: at.x,
      y: at.y,
      w: ts,
      h: ts,
      facing: facingToward(at.x - tw.col * ts, at.y - tw.row * ts),
      anim: { state: 'idle', t: 0 },
      tags: [`from:tower-${towerId}`, `target:enemy-${enemyId}`],
      layer: TD_DEPTH.shot,
    });
  }

  const cursor = opts.cursor ?? null;
  if (cursor !== null) {
    if (world.outcome === 'playing') {
      const why = world.placeRefusal(cursor.tower, cursor.col, cursor.row);
      entities.push({
        id: 'ghost',
        kind: `ghost:${cursor.tower}`,
        ...cellBox(cursor.col, cursor.row),
        facing: 'down',
        anim: { state: why === null ? 'ok' : 'blocked', t: 0 },
        tags: why === null ? ['ok'] : ['blocked', `why:${why}`],
        layer: TD_DEPTH.ghost,
      });
    }
    entities.push({
      id: 'cursor',
      kind: 'cursor',
      ...cellBox(cursor.col, cursor.row),
      facing: 'down',
      anim: { state: 'idle', t: t('cursor', 'idle') },
      tags: [`cell:${world.cellAt(cursor.col, cursor.row) ?? 'off'}`],
      layer: TD_DEPTH.cursor,
    });
  }

  const presented: PresentEvent[] = [];
  const exit = world.path[world.path.length - 1]!;
  for (const e of events) {
    switch (e.type) {
      case 'placed':
        presented.push({
          type: 'td-place',
          ...centre(e.col, e.row),
          entity: `tower-${e.tower}`,
          tower: e.towerType,
          cost: e.cost,
        });
        break;
      case 'sold':
        presented.push({
          type: 'td-sell',
          ...centre(e.col, e.row),
          entity: `tower-${e.tower}`,
          tower: e.towerType,
          refund: e.refund,
        });
        break;
      case 'upgraded':
        presented.push({
          type: 'td-upgrade',
          ...centre(e.col, e.row),
          entity: `tower-${e.tower}`,
          tower: e.towerType,
          level: e.level,
          cost: e.cost,
        });
        break;
      case 'refused':
        presented.push({ type: 'td-refused', command: e.command, code: e.code });
        break;
      case 'wave':
        presented.push({ type: 'td-wave-start', wave: e.wave, by: e.by, waves: world.waves.waves.length });
        break;
      case 'spawn': {
        const at = enemyAt(e.enemy);
        presented.push({
          type: 'td-spawn',
          ...(at ? { x: at.x + ts / 2, y: at.y + ts / 2 } : {}),
          entity: `enemy-${e.enemy}`,
          kind: e.kind,
          wave: e.wave,
        });
        break;
      }
      case 'fire': {
        const at = enemyAt(e.enemy);
        const tw = world.towers.find((x) => x.id === e.tower);
        const ev: PresentEvent = {
          type: 'td-shot',
          entity: `enemy-${e.enemy}`,
          from: `tower-${e.tower}`,
          damage: e.damage,
          hp: e.hp,
        };
        if (at) Object.assign(ev, { x: at.x + ts / 2, y: at.y + ts / 2 });
        if (tw)
          Object.assign(ev, { tower: tw.type, fromX: tw.col * ts + ts / 2, fromY: tw.row * ts + ts / 2 });
        presented.push(ev);
        break;
      }
      case 'kill': {
        const at = enemyAt(e.enemy);
        presented.push({
          type: 'td-kill',
          ...(at ? { x: at.x + ts / 2, y: at.y + ts / 2 } : {}),
          entity: `enemy-${e.enemy}`,
          kind: e.kind,
          bounty: e.bounty,
        });
        break;
      }
      case 'leak':
        presented.push({
          type: 'td-leak',
          ...centre(exit.col, exit.row),
          entity: `enemy-${e.enemy}`,
          kind: e.kind,
          lives: e.lives,
        });
        break;
      case 'won':
      case 'lost':
        break;
    }
  }
  // A wave is cleared once it has started and none of its enemies is still to come or on the path
  // (reported once per stream, so only with a state).
  if (state)
    for (let w = 1; w <= world.wavesStarted; w++) {
      if (world.waveLeft(w) > 0 || state.cleared.has(w)) continue;
      state.cleared.add(w);
      presented.push({ type: 'td-wave-clear', wave: w, waves: world.waves.waves.length });
    }
  for (const e of events)
    if (e.type === 'won' || e.type === 'lost') presented.push({ type: 'td-end', result: e.type });

  if (state) state.last = enemyBoxes;

  const map = presentMap(world, ts);
  const frame: PresentFrame = {
    frame: tick,
    size: { width: opts.size.width, height: opts.size.height },
    entities,
    map: state ? state.maps.next(map) : map,
    events: presented,
    status: presentStatus(world, cursor),
    camera: cameraHint(world, ts, opts.zoom),
  };
  return frame;
}

/** The frame for the round now, frozen (`freezeFrame`): see `describeWorld`. */
export function presentWorld(world: TdWorld, opts: TdPresentOptions): DeepReadonly<PresentFrame> {
  return freezeFrame(describeWorld(world, opts));
}

/** The camera hint: the map's centre, kept inside the map (`bounds`), at `zoom`. */
export function cameraHint(world: TdWorld, tileSize = TD_TILE_SIZE, zoom?: number): CameraHint {
  const w = (world.kinds[0]?.length ?? 0) * tileSize;
  const h = world.kinds.length * tileSize;
  const hint: CameraHint = { x: w / 2, y: h / 2, bounds: { x: 0, y: 0, w, h } };
  if (zoom !== undefined) hint.zoom = zoom;
  return hint;
}

/**
 * The HUD: `gold`, `lives`, `wave` (`n/m`: waves started of all), `waveNumber`, `waveCount`,
 * `enemies` (on the path), `outcome` (`playing`, `won`, `lost`), `nextWave` (ticks to the timer's
 * next wave, only with a timer and waves left), and with a cursor `tower` (the chosen type) and
 * `towerCost`; with the cursor on a tower (Engine 0.16 E3: that tower is selected) also
 * `selected` (its entity id, `tower-<id>`), `sellValue` (what selling it gives back now) and, while
 * it has a level above it, `upgradeCost`.
 */
export function presentStatus(
  world: TdWorld,
  cursor: TdCursorView | null = null,
): Record<string, PresentStatusValue> {
  const total = world.waves.waves.length;
  const status: Record<string, PresentStatusValue> = {
    gold: world.gold,
    lives: world.lives,
    wave: `${world.wavesStarted}/${total}`,
    waveNumber: world.wavesStarted,
    waveCount: total,
    enemies: world.enemies.length,
    outcome: world.outcome,
  };
  const timer = world.waves.timer;
  if (timer !== undefined && world.wavesStarted < total && world.outcome === 'playing')
    status.nextWave = Math.max(0, timer - world.sinceWave);
  if (cursor !== null) {
    status.tower = cursor.tower;
    status.towerCost = world.towerTypes[cursor.tower]?.cost ?? 0;
    const tw = world.towerAt(cursor.col, cursor.row);
    if (tw !== undefined) {
      const type = world.towerTypes[tw.type]!;
      status.selected = `tower-${tw.id}`;
      status.sellValue = world.rules.isOn('sell-refunds') ? sellValue(type, tw.level) : 0;
      const next = upgradeCost(type, tw.level);
      if (next !== null) status.upgradeCost = world.rules.isOn('upgrade-costs-gold') ? next : 0;
    }
  }
  return status;
}

/**
 * The kit's `FrameSource` (`@engine/core/present`, `FrameStream`): a fresh `TdPresentState` per
 * round and `describeWorld` at the picture `size`. `cursor` gives the cursor each frame (a
 * `TdControls`' `view()`), or null for none. A game's stream is `new FrameStream(tdFrames(screen,
 * () => controls.view()))`.
 */
export function tdFrames(
  size: ScreenSize,
  cursor: () => TdCursorView | null = () => null,
  opts: { tileSize?: number; zoom?: number } = {},
): FrameSource<TdWorld, TdEvent, TdPresentState> {
  return {
    start: (world) => TdPresentState.start(world),
    present: (world, events, state) =>
      describeWorld(world, { ...opts, size, events, state, cursor: cursor() }),
  };
}
