import { z } from 'zod';
import { MAX_PALETTE_INDEX } from './sprite-schema';

/**
 * Palette files: a named list of colours a sprite's indices pick from (index 0 is the first).
 *
 *   { "id": "hero", "colors": ["#000000", "#00a800", "#fca044"] }
 *
 * Colours are `#rgb` or `#rrggbb`. A palette has 1 to 36 colours (sprite indices 0-35).
 */

export interface PaletteFile {
  id: string;
  colors: string[];
}

const color = z.string().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
  message: 'a colour is "#rgb" or "#rrggbb"',
});

export const paletteSchema: z.ZodType<PaletteFile> = z.strictObject({
  id: z.string().min(1),
  colors: z
    .array(color)
    .min(1)
    .max(MAX_PALETTE_INDEX + 1),
});
