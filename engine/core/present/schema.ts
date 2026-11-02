import { z } from 'zod';
import type { JsonValue } from '../headless';
import { SCREEN_MAX, SCREEN_MIN } from '../gfx/screen';
import { FACINGS, type Facing, type PresentFrame } from './types';

/**
 * A Zod schema for `PresentFrame`, for tests and tools (a backend never runs it per frame). It
 * checks the shape, that numbers are finite, that a full map's tiles match `cols` x `rows`, and
 * that event fields are JSON-safe. Unknown fields are errors, except on events.
 */

const finite = z.number().finite();
const whole = z.number().int().min(0);

const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.null(), z.boolean(), finite, z.string(), z.array(jsonValue), z.record(z.string(), jsonValue)]),
);

const facing = z.enum(FACINGS as [Facing, ...Facing[]]);

const fx = z.strictObject({
  squashX: finite.exactOptional(),
  squashY: finite.exactOptional(),
  rotate: finite.exactOptional(),
  alpha: z.number().min(0).max(1).exactOptional(),
  tint: z.string().exactOptional(),
});

const entity = z.strictObject({
  id: z.string().min(1),
  kind: z.string().min(1),
  x: finite,
  y: finite,
  w: finite.min(0),
  h: finite.min(0),
  facing,
  anim: z.strictObject({ state: z.string().min(1), t: whole }),
  tags: z.array(z.string()),
  layer: z.number().int().exactOptional(),
  fx: fx.exactOptional(),
});

const tiles = z.union([z.array(z.string()), z.array(z.array(z.number().int()))]);

const mapRef = z.strictObject({ id: z.string().min(1), version: whole });

/** Problems when `grid` is not `rows` rows of `cols` tiles. */
function checkGrid(
  grid: string[] | number[][],
  cols: number,
  rows: number,
  path: (string | number)[],
  ctx: z.RefinementCtx,
): void {
  if (grid.length !== rows) {
    ctx.addIssue({ code: 'custom', path, message: `has ${grid.length} rows, expected ${rows}` });
  }
  grid.forEach((row, i) => {
    if (row.length !== cols) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, i],
        message: `has ${row.length} tiles, expected ${cols}`,
      });
    }
  });
}

const fullMap = z
  .strictObject({
    id: z.string().min(1),
    version: whole,
    tileSize: z.number().int().min(1),
    cols: z.number().int().min(1),
    rows: z.number().int().min(1),
    tiles,
    layers: z.array(z.strictObject({ name: z.string().min(1), tiles })).exactOptional(),
    tags: z.array(z.string()).exactOptional(),
  })
  .superRefine((m, ctx) => {
    checkGrid(m.tiles, m.cols, m.rows, ['tiles'], ctx);
    m.layers?.forEach((layer, i) => checkGrid(layer.tiles, m.cols, m.rows, ['layers', i, 'tiles'], ctx));
  });

const event = z
  .object({
    type: z.string().min(1),
    x: finite.exactOptional(),
    y: finite.exactOptional(),
    entity: z.string().exactOptional(),
  })
  .catchall(jsonValue);

const camera = z.strictObject({
  x: finite,
  y: finite,
  zoom: finite.positive().exactOptional(),
  follow: z.string().exactOptional(),
  shake: finite.min(0).exactOptional(),
  deadzone: z.strictObject({ w: whole, h: whole }).exactOptional(),
  lerp: z.number().min(0).max(1).exactOptional(),
  bounds: z.strictObject({ x: finite, y: finite, w: finite.min(0), h: finite.min(0) }).exactOptional(),
});

const side = z.number().int().min(SCREEN_MIN).max(SCREEN_MAX);

export const presentFrameSchema: z.ZodType<PresentFrame> = z.strictObject({
  frame: whole,
  size: z.strictObject({ width: side, height: side }),
  entities: z.array(entity),
  map: z.union([fullMap, mapRef]).exactOptional(),
  events: z.array(event),
  status: z.record(z.string(), z.union([finite, z.string(), z.boolean()])),
  camera: camera.exactOptional(),
});
