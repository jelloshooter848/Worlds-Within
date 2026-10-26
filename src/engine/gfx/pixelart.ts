import { charIndex, hexToRgb, type Palette } from './palette';
import type { FrameRect, SpriteSheet } from './spritesheet';

/**
 * A sprite definition is text: one string per pixel row, one char per pixel.
 * '.' is transparent; '0'-'9' and 'a'-'z' index the palette. Example:
 *
 *   frames: { idle: ['..11..', '.1221.', '..11..'] }
 *
 * This keeps art diffable, hand-editable and legally clean (everything is drawn here).
 */
export interface SpriteDef {
  /** Palette name (see src/content/palettes.ts). */
  palette: string;
  frames: Record<string, readonly string[]>;
}

export interface Rasterized {
  width: number;
  height: number;
  frames: Map<string, FrameRect>;
  /** RGBA pixels, row-major. */
  data: Uint8ClampedArray;
}

const MAX_SHEET_WIDTH = 1024;

/** Lay frames out left-to-right, wrapping rows, and paint them into an RGBA buffer. */
export function rasterizeToBuffer(def: SpriteDef, palette: Palette): Rasterized {
  const names = Object.keys(def.frames);
  const rects = new Map<string, FrameRect>();
  let x = 0;
  let y = 0;
  let rowH = 0;
  let width = 0;
  for (const name of names) {
    const rows = def.frames[name] as readonly string[];
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
    const h = rows.length;
    if (x + w > MAX_SHEET_WIDTH && x > 0) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    rects.set(name, { x, y, w, h });
    x += w;
    rowH = Math.max(rowH, h);
    width = Math.max(width, x);
  }
  const height = y + rowH;
  const data = new Uint8ClampedArray(Math.max(1, width) * Math.max(1, height) * 4);
  const rgb = palette.map(hexToRgb);
  for (const name of names) {
    const rect = rects.get(name) as FrameRect;
    const rows = def.frames[name] as readonly string[];
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) {
        const idx = charIndex(row[rx] as string);
        if (idx < 0) continue;
        const c = rgb[idx];
        if (!c) throw new Error(`frame "${name}": palette "${def.palette}" has no colour ${idx}`);
        const o = ((rect.y + ry) * width + rect.x + rx) * 4;
        data[o] = c[0];
        data[o + 1] = c[1];
        data[o + 2] = c[2];
        data[o + 3] = 255;
      }
    });
  }
  return { width: Math.max(1, width), height: Math.max(1, height), frames: rects, data };
}

/** Rasterize into a canvas-backed SpriteSheet. In environments without canvas (tests) the image is null. */
export function rasterize(id: string, def: SpriteDef, palette: Palette): SpriteSheet {
  const r = rasterizeToBuffer(def, palette);
  let image: CanvasImageSource | null = null;
  // Prefer a DOM canvas: universally supported as a drawImage source (OffscreenCanvas is not on older Safari).
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = r.width;
    canvas.height = r.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(r.width, r.height);
      img.data.set(r.data);
      ctx.putImageData(img, 0, 0);
      image = canvas;
    }
  } else if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(r.width, r.height);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const img = ctx.createImageData(r.width, r.height);
      img.data.set(r.data);
      ctx.putImageData(img, 0, 0);
      image = canvas;
    }
  }
  return { id, image, frames: r.frames };
}

/* Helpers for authoring definitions. */

/** Mirror rows horizontally. */
export function flipH(rows: readonly string[]): string[] {
  const w = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => r.padEnd(w, '.').split('').reverse().join(''));
}

/** Stack two frames vertically (top above bottom). */
export function stack(top: readonly string[], bottom: readonly string[]): string[] {
  return [...top, ...bottom];
}

/** Replace palette chars (e.g. recolour a frame in place: swap('1', '3')). */
export function swapColors(rows: readonly string[], map: Record<string, string>): string[] {
  return rows.map((r) => r.replace(/./g, (c) => map[c] ?? c));
}

/** Validate that every row has the same width and only uses legal chars. Throws with a useful message. */
export function validateDef(name: string, def: SpriteDef): void {
  for (const [frame, rows] of Object.entries(def.frames)) {
    const w = rows[0]?.length ?? 0;
    rows.forEach((row, i) => {
      if (row.length !== w)
        throw new Error(`${name}.${frame}: row ${i} is ${row.length} wide, expected ${w}`);
      if (!/^[.0-9a-z]*$/.test(row)) throw new Error(`${name}.${frame}: row ${i} has an illegal char`);
    });
  }
}
