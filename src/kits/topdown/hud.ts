import type { Renderer } from '@engine/gfx/renderer';
import { HUD_H } from './geometry';
import { drawFrame, fontOf, type TdView } from './view';
import type { TopDownWorld } from './world';

export interface TdHudData {
  /** Over the minimap (a dungeon's level, "LEVEL-1"). */
  title: string;
  /** Half hearts. */
  hp: number;
  maxHp: number;
  keys: number;
  /** Ammo counts under the keys (bombs): the item's icon and how many. */
  counters: readonly { frame: string; count: number }[];
  map: {
    cols: number;
    rows: number;
    visited: readonly (readonly [number, number])[];
    /** Every room, once the dungeon's map is found (else none). */
    known: readonly (readonly [number, number])[];
    here: readonly [number, number];
    /** The goal room, once the compass is found (else null). */
    goal: readonly [number, number] | null;
  };
  /** The item boxes, left to right: each with its letter over it and its icon (tile sheet) or empty. */
  boxes: readonly { label: string; frame: string | null }[];
}

/**
 * The HUD for a world: visited rooms on the map, the hero's hearts, keys and ammo, and the item
 * boxes the game names (Zelda's B box for the item in the slot, then the A box for the sword).
 * Every item with ammo the world has gets its count from the start (0 until it is found), as
 * Zelda's bomb count does.
 */
export function hudData(world: TopDownWorld, title: string, boxes: TdHudData['boxes']): TdHudData {
  const d = world.dungeon;
  const visited = world
    .visited()
    .map((id) => d.rooms.get(id))
    .filter((r) => r !== undefined)
    .map((r) => [r.gx, r.gy] as const);
  return {
    title,
    hp: world.hero.hp,
    maxHp: world.hero.maxHp,
    keys: world.keys,
    counters: Object.values(world.items)
      .filter((it) => it.ammo)
      .map((it) => ({ frame: it.icon, count: world.inv.count(it.id) })),
    map: {
      cols: d.cols,
      rows: d.rows,
      visited,
      known: world.found.has('map') ? [...d.rooms.values()].map((r) => [r.gx, r.gy] as const) : [],
      here: [world.room.gx, world.room.gy],
      goal: world.found.has('compass') ? goalOf(world) : null,
    },
    boxes,
  };
}

function goalOf(world: TopDownWorld): readonly [number, number] | null {
  for (const r of world.dungeon.rooms.values()) if (r.def.goal) return [r.gx, r.gy];
  return null;
}

/* Zelda 1's dungeon HUD laid on the 64-px band: the level over the map at the left, the counts
   column, the B and A boxes, and -LIFE- over the hearts at the right (x as Zelda's). */
export const MAP_X = 16;
export const MAP_Y = 20;
/** Zelda's map: an 8×8 grid of 8×4 cells, each room a 7×3 block; the dungeon centred in it. */
const MAP_CELLS = 8;
const CELL_W = 8;
const CELL_H = 4;
/** The counts column (keys, then ammo), the right-hand item box, and the life meter. */
export const COUNTERS_X = 88;
const COUNTERS_Y = 20;
export const LAST_BOX_X = 144;
const BOX_STEP = 24;
export const BOX_Y = 20;
const BOX_W = 16;
const BOX_H = 28;
export const HEARTS_X = 176;
/** The row of the first eight hearts; the next eight go on the row above it, as in Zelda. */
export const HEARTS_Y = 44;
/** Zelda's HUD blue: box outlines and the rooms on the map. */
const HUD_BLUE = '#2038ec';
/** The font recoloured red for -LIFE- (content/sprites/font.ts). */
export const LIFE_FONT = 'font-red';

/**
 * A Zelda-style HUD in the top 64 px: the level ("LEVEL-1") over a small map (rooms seen in
 * blue, the current one with a green mark), the keys held and ammo counts in a column, the item
 * boxes with their letters set into the top of each outline, and -LIFE- in red over the hearts
 * (whole, half and empty; eight to a row, the first row at the bottom).
 */
export function drawTdHud(r: Renderer, view: TdView, hud: TdHudData): void {
  const font = fontOf(view);
  const tiles = view.sheet(view.sheets.tiles);
  r.rect(0, 0, 256, HUD_H, '#000000');
  // Level and map: the rooms (all of them once the map is found), the compass's goal in red,
  // the hero's room in green.
  r.text(font, hud.title, MAP_X, 8);
  const m = hud.map;
  const left = MAP_X + Math.floor((MAP_CELLS - Math.min(MAP_CELLS, m.cols)) / 2) * CELL_W;
  const top = MAP_Y + Math.floor((MAP_CELLS - Math.min(MAP_CELLS, m.rows)) / 2) * CELL_H;
  const drawn = new Set<string>();
  for (const [gx, gy] of [...m.known, ...m.visited]) {
    if (drawn.has(`${gx},${gy}`)) continue;
    drawn.add(`${gx},${gy}`);
    r.rect(left + gx * CELL_W, top + gy * CELL_H, CELL_W - 1, CELL_H - 1, HUD_BLUE);
  }
  const dot = ([gx, gy]: readonly [number, number], color: string) =>
    r.rect(left + gx * CELL_W + 2, top + gy * CELL_H, 3, CELL_H - 1, color);
  // The goal blinks slowly, as Zelda's does (steady with reduce flashing).
  const blinkOn = view.reduceFlashing || ((view.frame >> 4) & 1) === 0;
  if (m.goal && blinkOn && !(m.goal[0] === m.here[0] && m.goal[1] === m.here[1])) dot(m.goal, '#f83800');
  dot(m.here, '#00e800');
  // Keys, then ammo.
  const counters = [{ frame: 'key', count: hud.keys }, ...hud.counters];
  counters.forEach((c, i) => {
    const y = COUNTERS_Y + i * 16;
    drawFrame(r, tiles, c.frame, COUNTERS_X, y, c.frame === 'key' ? '#f8b800' : HUD_BLUE, { w: 8, h: 16 });
    r.text(font, `×${c.count}`, COUNTERS_X + 10, y + 4);
  });
  // Item boxes: a blue outline, the letter set into its top edge, the icon inside.
  hud.boxes.forEach((box, i) => {
    const bx = LAST_BOX_X - (hud.boxes.length - 1 - i) * BOX_STEP;
    r.rect(bx, BOX_Y, BOX_W, BOX_H, HUD_BLUE);
    r.rect(bx + 2, BOX_Y + 2, BOX_W - 4, BOX_H - 4, '#000000');
    const lx = bx + (BOX_W - box.label.length * 8) / 2;
    r.rect(lx - 1, BOX_Y - 4, box.label.length * 8 + 1, 8, '#000000');
    r.text(font, box.label, lx, BOX_Y - 4);
    if (box.frame) drawFrame(r, tiles, box.frame, bx + 4, BOX_Y + 6, '#fcfcfc', { w: 8, h: 16 });
  });
  // Life.
  r.text(view.sheet('font', LIFE_FONT) ?? font, '-LIFE-', HEARTS_X + 8, BOX_Y - 4);
  const hearts = Math.ceil(hud.maxHp / 2);
  for (let i = 0; i < hearts; i++) {
    const left = hud.hp - i * 2;
    const frame = left >= 2 ? 'heart' : left === 1 ? 'heart-half' : 'heart-empty';
    const x = HEARTS_X + (i % 8) * 8;
    const y = HEARTS_Y - Math.floor(i / 8) * 8;
    const color = left >= 2 ? '#f83800' : left === 1 ? '#a81000' : '#404040';
    drawFrame(r, tiles, frame, x, y, color, { w: 7, h: 7 });
  }
}
