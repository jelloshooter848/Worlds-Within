import { HUD_CLASSIC_TYPES, type SkinFile } from './skin';
import type { DeepReadonly, PresentFrame } from './types';

/**
 * The HUD laid out once for every backend (Engine 0.15, gap G33, decision 4, item 281): what a
 * skin's `hud` list shows for a frame's `status`, as draw items in picture pixels and in order.
 * The Canvas2D presenter draws them with its renderer; the 3D scene draws them as an orthographic
 * pass of textured quads. Pure: it reads frame sizes through a callback and draws nothing.
 */

/** One thing the HUD draws, in picture pixels (top-left), in draw order. */
export type HudDraw =
  | {
      kind: 'sprite';
      /** The sprite file. */
      sheet: string;
      /** The palette it is recoloured with (the skin's `sheets.palette`), when there is one. */
      palette?: string;
      frame: string;
      x: number;
      y: number;
    }
  /** Bitmap-font text: one frame of `font` per character, `HUD_GLYPH_ADVANCE` px apart. */
  | { kind: 'text'; font: string; text: string; x: number; y: number }
  /** A flat box where a heart or icon's sheet or frame is missing. */
  | { kind: 'box'; x: number; y: number; w: number; h: number; color: string };

/** A sprite draw item (a heart, an icon or a font glyph). */
export type HudSprite = Extract<HudDraw, { kind: 'sprite' }>;

/** A text draw item. */
export type HudText = Extract<HudDraw, { kind: 'text' }>;

/** The size of a frame of a sheet (recoloured with `palette`), or null when the sheet or frame is missing. */
export type HudFrameSize = (
  sheet: string,
  palette: string | undefined,
  frame: string,
) => { w: number; h: number } | null;

/** The font a number or text item uses when neither it nor the backend names one. */
export const DEFAULT_HUD_FONT = 'font';

/** Pixels from one font glyph to the next (the bitmap font is 8 px wide, as `Renderer.text` draws it). */
export const HUD_GLYPH_ADVANCE = 8;

/** The side of the box drawn for a heart or icon whose frame is missing, and the step between such boxes less 1. */
export const HUD_FALLBACK_SIZE = 8;

/** The colour of that box when the skin gives no `sheets.fallbackColor`. */
export const HUD_FALLBACK_COLOR = '#ff00ff';

/**
 * The HUD's draw items for `status` through `skin.hud`, in the skin's order. A key the status
 * lacks draws nothing. `number` and `text` are one `text` item in `item.font`, else `opts.font`,
 * else `DEFAULT_HUD_FONT`. `hearts` repeat their frame once per whole point (a non-number draws
 * none; with `half` the value counts halves: a `frame` per two points and `half` for one left
 * over), `icon` draws it once when the value is truthy; each copy is the frame's width plus 1 px
 * right of the last, from the item's `sheet` (else `sheets.sheet`) in `sheets.palette`. Where the
 * sheet or frame is missing (`frameSize` gives null) each copy is an 8 x 8 box in
 * `sheets.fallbackColor`, else `HUD_FALLBACK_COLOR`, 9 px apart.
 */
export function layoutHud(
  skin: DeepReadonly<SkinFile>,
  status: DeepReadonly<PresentFrame['status']>,
  frameSize: HudFrameSize,
  opts: { font?: string } = {},
): HudDraw[] {
  const out: HudDraw[] = [];
  const defaults = skin.sheets;
  for (const item of skin.hud ?? []) {
    // Engine 0.16 T6's widgets (`bar`, `counter`, `panel`, `minimap`) are `engine/core/ui`'s.
    if (!isClassicHudType(item.as) || item.status === undefined) continue;
    if (!Object.hasOwn(status, item.status) || !hudItemShown(item, status)) continue;
    const value = status[item.status]!;
    if (item.as === 'number' || item.as === 'text') {
      const font = item.font ?? opts.font ?? DEFAULT_HUD_FONT;
      out.push({ kind: 'text', font, text: String(value), x: item.x, y: item.y });
      continue;
    }
    // With `half` (Engine 0.16 part C T3) a hearts value counts halves: a `frame` per two points,
    // then `half` for one left over.
    const halves = item.as === 'hearts' && item.half !== undefined;
    const points =
      item.as === 'hearts' ? (typeof value === 'number' ? Math.max(0, Math.floor(value)) : 0) : value ? 1 : 0;
    const frames: string[] = [];
    const whole = halves ? Math.floor(points / 2) : points;
    for (let i = 0; i < whole; i++) if (item.frame !== undefined) frames.push(item.frame);
    if (halves && points % 2 === 1) frames.push(item.half!);
    const sheet = item.sheet ?? defaults?.sheet;
    const palette = defaults?.palette;
    const sizeOf = (frame: string | undefined) =>
      sheet === undefined || frame === undefined ? null : frameSize(sheet, palette, frame);
    const size = sizeOf(item.frame);
    const step = (size?.w ?? HUD_FALLBACK_SIZE) + 1;
    frames.forEach((frame, i) => {
      const x = item.x + i * step;
      if (sizeOf(frame) && sheet !== undefined) {
        out.push({ kind: 'sprite', sheet, ...(palette !== undefined && { palette }), frame, x, y: item.y });
      } else {
        const color = defaults?.fallbackColor ?? HUD_FALLBACK_COLOR;
        out.push({ kind: 'box', x, y: item.y, w: HUD_FALLBACK_SIZE, h: HUD_FALLBACK_SIZE, color });
      }
    });
  }
  return out;
}

/**
 * A text item as one sprite per character of its font (no palette), `HUD_GLYPH_ADVANCE` px
 * apart, spaces skipped: what `Renderer.text` draws, for a backend that draws sprites only.
 */
export function hudGlyphs(item: HudText): HudSprite[] {
  const out: HudSprite[] = [];
  let x = item.x;
  for (const ch of item.text) {
    if (ch !== ' ') out.push({ kind: 'sprite', sheet: item.font, frame: ch, x, y: item.y });
    x += HUD_GLYPH_ADVANCE;
  }
  return out;
}

/**
 * Whether a HUD item shows for `status`: always, unless it names a `when` status key whose value
 * is falsy (missing, 0, false or '') (Engine 0.16 part C T3).
 */
export function hudItemShown(
  item: { readonly when?: string | undefined },
  status: DeepReadonly<PresentFrame['status']>,
): boolean {
  return item.when === undefined || Boolean(status[item.when]);
}

/** Whether a HUD item type is one `layoutHud` draws (the types before Engine 0.16 T6's widgets). */
export function isClassicHudType(as: string): as is (typeof HUD_CLASSIC_TYPES)[number] {
  return (HUD_CLASSIC_TYPES as readonly string[]).includes(as);
}
