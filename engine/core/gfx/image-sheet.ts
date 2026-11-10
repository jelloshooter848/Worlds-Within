import { z } from 'zod';
import type { FrameAnchor, FrameRect } from './spritesheet';

/**
 * PNG sprite sheets in skins (Engine 0.16 T10). A skin's `images` map names image sheets: a PNG
 * file in the game's `assets/<pack>/` folder with its frames, sizes and anchors written in text.
 *
 *   "images": {
 *     "lab-torch": {
 *       "image": "assets/fx-lab-png/torch.png",
 *       "frameSize": { "w": 16, "h": 24 },
 *       "grid": { "cols": 4, "rows": 1, "margin": 1, "spacing": 2 },
 *       "names": ["torch-0", "torch-1", "torch-2", "torch-3"],
 *       "frames": { "torch-unlit": { "x": 1, "y": 27, "w": 16, "h": 24 } },
 *       "anchor": "bottom"
 *     }
 *   }
 *
 * Grid frames are cut left to right, top to bottom: cell (c, r) is at `margin + c * (w + spacing)`,
 * `margin + r * (h + spacing)`, named by `names` in order (else "0", "1", ...). Named `frames` add
 * rectangles of their own. Kind, tile, HUD, parallax and emitter entries then name the image's id as
 * their `sheet` and its frames like a text sprite's. Pure: schema and maths only; loading the PNG
 * is the browser's (`engine/core/assets/content-images.ts`) and checking it the content loader's.
 */

const whole = (what: string) => z.number().int().min(0).describe(what);
const size = (what: string) => z.number().int().min(1).describe(what);

export const frameAnchorSchema = z
  .union([
    z.enum(['top-left', 'center', 'bottom']),
    z.strictObject({ x: whole("pixels from the frame's left"), y: whole('pixels from its top') }),
  ])
  .describe(
    "where a frame sits on the entity box: `top-left` (the default, as text sprites), `center`, `bottom` (bottom centre on the box's), or `{ x, y }`, a pixel of the frame put on the box's bottom centre",
  );

const frameRectSchema = z.strictObject({
  x: whole('left edge in the image, px'),
  y: whole('top edge in the image, px'),
  w: size('width, px'),
  h: size('height, px'),
  anchor: frameAnchorSchema.exactOptional(),
});

export const imageSheetSchema = z
  .strictObject({
    image: z
      .string()
      .regex(/^assets\/[^/]+\/[^/]+(?:\/[^/]+)*\.png$/i, {
        message: 'a PNG in a pack folder of the game\'s assets: "assets/<pack>/<file>.png"',
      })
      .describe('the PNG file, `assets/<pack>/<file>.png` relative to the game folder'),
    frameSize: z
      .strictObject({ w: size('frame width, px'), h: size('frame height, px') })
      .exactOptional()
      .describe("a grid cell's size (needed with `grid`)"),
    grid: z
      .strictObject({
        cols: size('cells across'),
        rows: size('cells down'),
        margin: whole('px round the whole grid (default 0)').exactOptional(),
        spacing: whole('px between cells (default 0)').exactOptional(),
      })
      .exactOptional()
      .describe('frames cut as a grid of `frameSize` cells, left to right, top to bottom'),
    names: z
      .array(z.string().min(1))
      .exactOptional()
      .describe('names for the grid cells in order (default "0", "1", ...); at most one per cell'),
    frames: z
      .record(z.string().min(1), frameRectSchema)
      .exactOptional()
      .describe('named frames `{ x, y, w, h, anchor? }` in image px'),
    anchor: frameAnchorSchema.exactOptional(),
  })
  .superRefine((spec, ctx) => {
    if (spec.grid === undefined && spec.frames === undefined)
      ctx.addIssue({ code: 'custom', message: 'give a "grid" (with "frameSize") or named "frames"' });
    if (spec.grid !== undefined && spec.frameSize === undefined)
      ctx.addIssue({ code: 'custom', path: ['frameSize'], message: 'a "grid" needs "frameSize"' });
    if (spec.names !== undefined) {
      if (spec.grid === undefined)
        ctx.addIssue({ code: 'custom', path: ['names'], message: '"names" go with a "grid"' });
      else if (spec.names.length > spec.grid.cols * spec.grid.rows)
        ctx.addIssue({
          code: 'custom',
          path: ['names'],
          message: `${spec.names.length} names for ${spec.grid.cols * spec.grid.rows} grid cells`,
        });
      const seen = new Set<string>();
      spec.names.forEach((n, i) => {
        if (seen.has(n) || Object.hasOwn(spec.frames ?? {}, n))
          ctx.addIssue({ code: 'custom', path: ['names', i], message: `frame "${n}" is named twice` });
        seen.add(n);
      });
    }
  });

export type ImageSheetSpec = z.output<typeof imageSheetSchema>;

/** One frame of an image sheet, with where it came from in the spec (for errors). */
export interface ImageSheetFrame extends FrameRect {
  name: string;
  /** The spec field the frame comes from: `['grid']` or `['frames', name]`. */
  path: (string | number)[];
}

/** Every frame of an image sheet, grid cells first (row by row), then the named frames. */
export function imageSheetFrameList(spec: ImageSheetSpec): ImageSheetFrame[] {
  const out: ImageSheetFrame[] = [];
  const withAnchor = (anchor: FrameAnchor | undefined) => (anchor === undefined ? {} : { anchor });
  if (spec.grid !== undefined && spec.frameSize !== undefined) {
    const { cols, rows, margin = 0, spacing = 0 } = spec.grid;
    const { w, h } = spec.frameSize;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        const name = spec.names?.[i] ?? (spec.names === undefined ? String(i) : undefined);
        if (name === undefined) continue;
        const x = margin + c * (w + spacing);
        const y = margin + r * (h + spacing);
        out.push({ name, x, y, w, h, path: ['grid'], ...withAnchor(spec.anchor) });
      }
    }
  }
  for (const [name, f] of Object.entries(spec.frames ?? {})) {
    out.push({
      name,
      x: f.x,
      y: f.y,
      w: f.w,
      h: f.h,
      path: ['frames', name],
      ...withAnchor(f.anchor ?? spec.anchor),
    });
  }
  return out;
}

/** An image sheet's frames by name, as a `SpriteSheet`'s `frames` map. */
export function imageSheetFrames(spec: ImageSheetSpec): Map<string, FrameRect> {
  return new Map(imageSheetFrameList(spec).map(({ name, path: _path, ...rect }) => [name, rect] as const));
}

/** Whether a frame rectangle reaches past an image of this size. */
export function frameOutside(rect: FrameRect, image: { width: number; height: number }): boolean {
  return rect.x + rect.w > image.width || rect.y + rect.h > image.height;
}
