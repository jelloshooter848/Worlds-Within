import type { Renderer } from '@engine/gfx/renderer';
import { DIR_VEC, HUD_H, ROOM_COLS, ROOM_H, ROOM_ROWS, ROOM_W, SIDE_DIR, TILE, type Side } from './geometry';
import { isBorder, sideOf, tileAt, wallDepth, type Room, type TileKind } from './room';
import type { TdView } from './view';
import type { TdEnemy, TdEntity } from './entity';
import type { TopDownWorld } from './world';

/** Flat colours used when the tile art is missing. */
const PLACEHOLDER: Record<
  TileKind | 'door-open' | 'door-locked' | 'door-shut' | 'wall-cracked' | 'wall-hole',
  string
> = {
  floor: '#183c5c',
  'floor-alt': '#1c4870',
  wall: '#0c2440',
  cracked: '#24405c',
  'wall-cracked': '#24405c',
  'wall-hole': '#000000',
  block: '#4878a8',
  statue: '#7c7c7c',
  water: '#0058f8',
  stairs: '#404040',
  door: '#000000',
  exit: '#f8d878',
  'door-open': '#000000',
  'door-locked': '#ac7c00',
  'door-shut': '#5c5c5c',
};

type DoorLook = 'open' | 'locked' | 'shut' | 'cracked' | 'hole';

/** The frame of a doorway as it looks now (a cracked one is a wall frame, not a door). */
const DOOR_FRAME: Record<DoorLook, keyof typeof PLACEHOLDER> = {
  open: 'door-open',
  locked: 'door-locked',
  shut: 'door-shut',
  cracked: 'wall-cracked',
  hole: 'wall-hole',
};

/**
 * Draws one room's tiles with its top-left at (ox, oy). The wall band's row (or column) facing the
 * floor uses `wall-top` (north, flipped for south) and `wall-top-side` (west, flipped for east),
 * its inner corners `wall-corner`; the rest of a thick band plain `wall` (`wall-side` down the
 * east and west), as are inner walls. In a
 * room with one-tile walls doors are drawn for the north edge and flipped for the south; east and
 * west use the `-side` frames (made by rotation, frames.ts), and a two-cell doorway (and exit)
 * draws one 16-px door centred across its cells, from the `-l` / `-r` halves (frames.ts). Through
 * a thicker wall a doorway is one 32×32 `<frame>-thick` (Zelda's doors) over the band, centred on
 * its cells.
 */
export function drawRoomTiles(
  r: Renderer,
  view: TdView,
  room: Room,
  door: (side: Side) => DoorLook,
  ox: number,
  oy: number,
  blasted: (cell: string) => boolean = () => false,
): void {
  const pal = room.def.dark && view.sheets.tilesDark ? view.sheets.tilesDark : undefined;
  const sheet = view.sheet(view.sheets.tiles, pal);
  const put = (
    frame: string,
    x: number,
    y: number,
    fallback: string,
    fx = false,
    fy = false,
    size = TILE,
  ) => {
    if (sheet?.frames.has(frame)) r.sprite(sheet, frame, x, y, fx, fy);
    else r.rect(x, y, size, size, fallback);
  };
  const wall = room.wall;
  const thick = wall > 1;
  /** A cell of the wall band, as plain wall would draw it. */
  const band = (col: number, row: number, x: number, y: number) => {
    const side = sideOf(col, row, wall);
    if (!side) {
      const dx = col < wall ? col : ROOM_COLS - 1 - col;
      const dy = row < wall ? row : ROOM_ROWS - 1 - row;
      const right = col >= ROOM_COLS - wall;
      const bottom = row >= ROOM_ROWS - wall;
      if (dx === wall - 1 && dy === wall - 1) put('wall-corner', x, y, PLACEHOLDER.wall, right, bottom);
      else put('wall', x, y, PLACEHOLDER.wall);
    } else if (wallDepth(col, row, side) < wall - 1) {
      if (side === 'n' || side === 's') put('wall', x, y, PLACEHOLDER.wall);
      else put('wall-side', x, y, PLACEHOLDER.wall, side === 'e');
    } else if (side === 'n' || side === 's') put('wall-top', x, y, PLACEHOLDER.wall, false, side === 's');
    else put('wall-top-side', x, y, PLACEHOLDER.wall, side === 'e');
  };
  const exitLook = () => (view.reduceFlashing ? 'exit-0' : `exit-${(view.frame >> 4) & 1}`);
  for (let row = 0; row < ROOM_ROWS; row++)
    for (let col = 0; col < ROOM_COLS; col++) {
      const x = ox + col * TILE;
      const y = oy + row * TILE;
      if (x <= -TILE || x >= ROOM_W || y <= -TILE || y >= 240) continue;
      // The art layer (0.4.41): the cell's own pictures, bottom to top.
      const art = room.def.art?.[row * ROOM_COLS + col];
      if (art) {
        for (const f of art) put(f, x, y, PLACEHOLDER.floor);
        continue;
      }
      const t = tileAt(room, col, row) as TileKind;
      const side = sideOf(col, row, wall);
      switch (t) {
        case 'wall':
          if (isBorder(col, row, wall)) band(col, row, x, y);
          else put('wall', x, y, PLACEHOLDER.wall);
          break;
        case 'door': {
          if (thick) {
            band(col, row, x, y); // the door is drawn over the band below
            break;
          }
          const s = side as Side;
          const name = DOOR_FRAME[door(s)];
          const cells = room.doorCells[s] ?? [];
          if (s === 'e' || s === 'w') put(`${name}-side`, x, y, PLACEHOLDER[name], s === 'e');
          else if (cells.length === 2)
            put(`${name}-${col === cells[0] ? 'l' : 'r'}`, x, y, PLACEHOLDER[name], false, s === 's');
          else put(name, x, y, PLACEHOLDER[name], false, s === 's');
          break;
        }
        case 'exit': {
          if (thick) {
            band(col, row, x, y);
            break;
          }
          const f = exitLook();
          const pair =
            tileAt(room, col - 1, row) === 'exit' ? 'r' : tileAt(room, col + 1, row) === 'exit' ? 'l' : null;
          put(pair ? `${f}-${pair}` : f, x, y, PLACEHOLDER.exit, false, side === 's');
          break;
        }
        case 'cracked':
          // An inner cracked wall: the crack until a blast, then floor.
          if (blasted(`${col},${row}`)) put('floor', x, y, PLACEHOLDER.floor);
          else put('wall-cracked', x, y, PLACEHOLDER.cracked);
          break;
        default:
          put(t, x, y, PLACEHOLDER[t]);
      }
    }
  if (!thick) return;
  const span = wall * TILE;
  for (const s of Object.keys(room.doorCells) as Side[]) {
    const cells = room.doorCells[s] ?? [];
    const first = (cells[0] ?? 0) * TILE;
    const mid = first + (cells.length * TILE) / 2;
    const name = DOOR_FRAME[door(s)];
    const frame = `${name}-thick${s === 'e' || s === 'w' ? '-side' : ''}`;
    const x = s === 'w' ? 0 : s === 'e' ? ROOM_W - span : mid - span / 2;
    const y = s === 'n' ? 0 : s === 's' ? ROOM_H - span : mid - span / 2;
    put(frame, ox + x, oy + y, PLACEHOLDER[name], s === 'e', s === 's', span);
  }
  // A thick-walled room's exit: one glowing 32×32 doorway on the north or south band.
  const exits: number[] = [];
  for (let col = 0; col < ROOM_COLS; col++) if (tileAt(room, col, 0) === 'exit') exits.push(col);
  const south: number[] = [];
  for (let col = 0; col < ROOM_COLS; col++) if (tileAt(room, col, ROOM_ROWS - 1) === 'exit') south.push(col);
  for (const [cols, s] of [
    [exits, 'n'],
    [south, 's'],
  ] as const) {
    if (cols.length === 0) continue;
    const mid = ((cols[0] as number) + cols.length / 2) * TILE;
    const y = s === 'n' ? 0 : ROOM_H - span;
    put(`${exitLook()}-thick`, ox + mid - span / 2, oy + y, PLACEHOLDER.exit, false, s === 's', span);
  }
}

/**
 * A shut building door (TdEntrance) drawn over its cell: `door-boarded` while its lock's secret
 * is not found (`needs`), else `door-closed` (a building not open yet).
 */
function drawShutEntrances(r: Renderer, view: TdView, world: TopDownWorld, ox: number, oy: number): void {
  const sheet = view.sheet(view.sheets.tiles, view.tilePalette);
  for (const e of world.room.entrances) {
    if (world.entranceOpen(e)) continue;
    const frame = e.shut ? 'door-closed' : 'door-boarded';
    const x = ox + e.col * TILE;
    const y = oy + e.row * TILE;
    if (sheet?.frames.has(frame)) r.sprite(sheet, frame, x, y);
    else r.rect(x + 2, y, TILE - 4, TILE, '#7c4c18');
  }
}

/** How a doorway of the room on screen looks right now. */
function liveDoor(world: TopDownWorld, side: Side): DoorLook {
  const kind = world.room.doors[side];
  if (kind === 'cracked') return world.doorOpen(side) ? 'hole' : 'cracked';
  if (kind === 'locked' && !world.doorOpen(side)) return 'locked';
  if (kind === 'shutter' && !world.doorOpen(side)) return 'shut';
  return 'open';
}

/** How a doorway of a room being slid away from looks (its memory; shutters as last seen). */
function pastDoor(world: TopDownWorld, room: Room, side: Side, left: Side): DoorLook {
  const kind = room.doors[side];
  const st = world.state(room.id);
  if (kind === 'cracked') return st.blasted.has(side) ? 'hole' : 'cracked';
  if (kind === 'locked' && !st.unlocked.has(side)) return 'locked';
  if (kind === 'shutter' && side !== left && room.def.shutters && !st.met.has(room.def.shutters))
    return 'shut';
  return 'open';
}

/**
 * Draws the play area (y from `top` down: HUD_H under the kit's HUD band; Kakariko Village's room
 * sits lower, its HUD drawn over the screen): the room, its entities and the hero; during a slide,
 * the room left behind and the new one moving in together, the hero riding with the new one.
 */
export function renderWorld(r: Renderer, base: TdView, world: TopDownWorld, top = HUD_H): void {
  const dark = world.room.def.dark && base.sheets.tilesDark ? base.sheets.tilesDark : undefined;
  const view: TdView = {
    frame: base.frame,
    reduceFlashing: base.reduceFlashing,
    sheets: base.sheets,
    sheet: base.sheet,
    tilePalette: dark,
  };
  let ox = 0;
  let oy = top;
  const tr = world.transition;
  if (tr) {
    const v = DIR_VEC[SIDE_DIR[tr.side]];
    const span = v.dx !== 0 ? ROOM_W : ROOM_H;
    const shift = Math.round((tr.t / tr.frames) * span);
    drawRoomTiles(
      r,
      view,
      tr.from,
      (s) => pastDoor(world, tr.from, s, tr.side),
      -v.dx * shift,
      top - v.dy * shift,
      (c) => world.state(tr.from.id).blasted.has(c),
    );
    ox = v.dx * (span - shift);
    oy = top + v.dy * (span - shift);
  }
  drawRoomTiles(
    r,
    view,
    world.room,
    (s) => liveDoor(world, s),
    ox,
    oy,
    (c) => world.state().blasted.has(c),
  );
  drawShutEntrances(r, view, world, ox, oy);
  const byLayer = (l: number) => world.entities.filter((e) => e.layer === l && !e.dead);
  for (const e of byLayer(0)) e.render(r, view, ox, oy);
  // Townsfolk (`ySort`) are drawn with the hero, whoever's feet are lower in front (0.4.41).
  const sorted = (e: TdEntity) => 'ySort' in e && e.ySort === true;
  const actors = byLayer(1);
  for (const e of actors) if (!sorted(e)) e.render(r, view, ox, oy);
  for (const e of world.enemies()) if (e.stunT > 0) drawStunned(r, view, e, ox, oy);
  const folk = actors.filter(sorted).sort((a, b) => a.y - b.y);
  const heroY = world.hero.y;
  for (const e of folk) if (e.y <= heroY) e.render(r, view, ox, oy);
  world.hero.render(r, view, ox, oy);
  for (const e of folk) if (e.y > heroY) e.render(r, view, ox, oy);
  for (const e of byLayer(2)) e.render(r, view, ox, oy);
  for (const e of byLayer(3)) e.render(r, view, ox, oy);
}

/**
 * Two little stars circling over a stunned monster's head (standing still with reduce
 * flashing), so a stun reads at a glance.
 */
export function drawStunned(r: Renderer, view: TdView, e: TdEnemy, ox: number, oy: number): void {
  const cx = ox + e.x + e.w / 2;
  const cy = oy + e.y - 3;
  const a = view.reduceFlashing ? 0 : (view.frame / 8) % (2 * Math.PI);
  for (const k of [0, Math.PI]) {
    const x = Math.round(cx + Math.cos(a + k) * 6) - 1;
    const y = Math.round(cy + Math.sin(a + k) * 2) - 1;
    r.rect(x, y, 3, 1, '#f8d878');
    r.rect(x + 1, y - 1, 1, 3, '#f8d878');
  }
}
