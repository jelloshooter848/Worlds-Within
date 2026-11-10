import type { ScreenSize } from '../gfx/screen';
import type { SkinFile } from '../present/skin';
import type { DeepReadonly } from '../present/types';
import { lerpColor } from './color';
import { PARALLAX_DEFAULT_BANDS, type ParallaxLayer } from './schema';

/**
 * Parallax layers laid out once for every backend (docs/ROADMAP.md, Engine 0.16 part A, T4), as
 * `layoutHud` is for the HUD: a skin's `parallax` list, back to front, turned into flat draws in
 * picture pixels for a camera position. Canvas2D draws them behind the map; the 3D backend places
 * one quad per draw on a plane at the layer's `depth`. Pure.
 *
 * A layer's origin on the picture is `x - cam.x * factor.x`, `y - cam.y * factor.y` (rounded to
 * whole px), with `cam` the camera's top-left in picture px (zoom and shake included): factor 0
 * stays put, 1 moves with the world, between scrolls slower (further away).
 * - A `frame` layer is that sprite frame at the origin, repeated across the picture for `repeat`
 *   `x` (the default), down for `y`, both for `xy`, once for `none`. A frame its sheet lacks (the
 *   `frameSize` lookup gives null) draws nothing.
 * - A `gradient` layer is `bands` flat boxes (default {@link PARALLAX_DEFAULT_BANDS}) across the
 *   whole picture width from the origin's y, `height` px tall in all (default the picture's), each
 *   band's colour taken evenly along the colour list (first band the first colour, last the last).
 */

/** One parallax draw in picture px. */
export type ParallaxDraw =
  | { kind: 'sprite'; layer: number; sheet: string; palette?: string; frame: string; x: number; y: number }
  | { kind: 'box'; layer: number; x: number; y: number; w: number; h: number; color: string };

/** A frame's size in its sheet (with the palette), or null when the sheet or frame is missing. */
export type ParallaxFrameSize = (
  sheet: string,
  palette: string | undefined,
  frame: string,
) => { w: number; h: number } | null;

type Skin = DeepReadonly<Pick<SkinFile, 'parallax' | 'sheets'>>;

/** A layer's scroll factors on each axis. */
export function parallaxFactor(layer: DeepReadonly<ParallaxLayer>): { x: number; y: number } {
  const f = layer.factor;
  return typeof f === 'number' ? { x: f, y: f } : { x: f.x, y: f.y };
}

/** A layer's origin on the picture (whole px) for a camera top-left `cam` in picture px. */
export function parallaxOrigin(
  layer: DeepReadonly<ParallaxLayer>,
  cam: { x: number; y: number },
): { x: number; y: number } {
  const f = parallaxFactor(layer);
  // `+ 0` turns a rounded -0 into 0.
  return {
    x: Math.round((layer.x ?? 0) - cam.x * f.x) + 0,
    y: Math.round((layer.y ?? 0) - cam.y * f.y) + 0,
  };
}

/** The colour bands of a gradient `height` px tall: `{ y, h, color }` from the top, no gaps. */
export function gradientBands(
  colors: readonly string[],
  bands: number,
  height: number,
): { y: number; h: number; color: string }[] {
  const out: { y: number; h: number; color: string }[] = [];
  for (let i = 0; i < bands; i++) {
    const y0 = Math.round((i * height) / bands);
    const y1 = Math.round(((i + 1) * height) / bands);
    if (y1 <= y0) continue;
    out.push({ y: y0, h: y1 - y0, color: colorAlong(colors, bands === 1 ? 0 : i / (bands - 1)) });
  }
  return out;
}

/** The colour `t` (0 to 1) of the way along a list of colours, each stretch blended evenly. */
function colorAlong(colors: readonly string[], t: number): string {
  if (colors.length === 1) return colors[0]!;
  const at = t * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(at));
  return lerpColor(colors[i]!, colors[i + 1]!, at - i);
}

/** The starts of the copies of a `span`-long tile from `origin` that cover `[0, extent)`. */
function repeats(origin: number, span: number, extent: number, repeat: boolean): number[] {
  if (!repeat) return [origin];
  const first = origin - Math.ceil(origin / span) * span;
  const out: number[] = [];
  for (let at = first; at < extent; at += span) out.push(at + 0);
  return out;
}

/** The draws of a skin's `parallax` layers, back to front, for a camera top-left `cam` (picture px). */
export function layoutParallax(
  skin: Skin,
  cam: { x: number; y: number },
  size: ScreenSize,
  frameSize: ParallaxFrameSize,
): ParallaxDraw[] {
  const draws: ParallaxDraw[] = [];
  (skin.parallax ?? []).forEach((layer, index) => {
    const origin = parallaxOrigin(layer, cam);
    if (layer.gradient !== undefined) {
      const bands = gradientBands(
        layer.gradient,
        layer.bands ?? PARALLAX_DEFAULT_BANDS,
        layer.height ?? size.height,
      );
      for (const b of bands)
        draws.push({
          kind: 'box',
          layer: index,
          x: 0,
          y: origin.y + b.y,
          w: size.width,
          h: b.h,
          color: b.color,
        });
      return;
    }
    const sheet = layer.sheet ?? skin.sheets?.sheet;
    if (layer.frame === undefined || sheet === undefined) return;
    const palette = skin.sheets?.palette;
    const rect = frameSize(sheet, palette, layer.frame);
    if (!rect || rect.w <= 0 || rect.h <= 0) return;
    const repeat = layer.repeat ?? 'x';
    const xs = repeats(origin.x, rect.w, size.width, repeat === 'x' || repeat === 'xy');
    const ys = repeats(origin.y, rect.h, size.height, repeat === 'y' || repeat === 'xy');
    for (const y of ys)
      for (const x of xs)
        draws.push({
          kind: 'sprite',
          layer: index,
          sheet,
          ...(palette !== undefined && { palette }),
          frame: layer.frame,
          x,
          y,
        });
  });
  return draws;
}
