import type { Font } from './font';
import { nineSlice, type Box, type Insets, type SliceFill } from './nine-slice';
import { layoutText, type TextLayoutOptions } from './text';

/**
 * What the UI draws, as plain items in picture pixels (Engine 0.16 T6), and the small interface a
 * backend implements to draw them. The layout (text, panels, widgets) is pure and shared; each
 * backend only paints these three kinds of item: the Canvas2D backend with its renderer, the 3D
 * backend as quads of its HUD pass.
 */

/** A flat box, at `alpha` (default 1). */
export interface UiFill {
  kind: 'fill';
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alpha?: number;
  /** A box standing in for a sprite frame the game lacks (a classic HUD item's fallback). */
  missing?: true;
}

/** A part of a sprite frame (`sx`, `sy`, `sw`, `sh` from the frame's top-left) scaled into a box. */
export interface UiImage {
  kind: 'image';
  sheet: string;
  palette?: string;
  frame: string;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One glyph of a font, its top-left at (`x`, `y`), in one colour. */
export interface UiGlyph {
  kind: 'glyph';
  font: string;
  ch: string;
  x: number;
  y: number;
  color: string;
}

export type UiDraw = UiFill | UiImage | UiGlyph;

/** What a backend implements to draw UI items. */
export interface UiPainter {
  fill(d: UiFill): void;
  image(d: UiImage): void;
  glyph(d: UiGlyph): void;
}

/** Draws `draws` in order through `painter`. */
export function paintUi(draws: readonly UiDraw[], painter: UiPainter): void {
  for (const d of draws) {
    if (d.kind === 'fill') painter.fill(d);
    else if (d.kind === 'image') painter.image(d);
    else painter.glyph(d);
  }
}

/** How text looks: its colour, and an optional one-pixel drop shadow and outline. */
export interface TextStyle {
  color: string;
  /** A copy one px down and right in this colour, under the text. */
  shadow?: string;
  /** Copies one px away in all eight directions in this colour, under the text. */
  outline?: string;
}

/** The colour text draws in when a skin gives none. */
export const DEFAULT_TEXT_COLOR = '#fcfcfc';

const AROUND: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

/**
 * The glyph draws of `text` in `font` with its top-left at (`x`, `y`): the shadow first (all
 * glyphs), then the outline, then the text itself, so neither covers a neighbouring glyph's ink.
 */
export function textDraws(
  font: Font,
  text: string,
  x: number,
  y: number,
  style: TextStyle,
  opts: TextLayoutOptions = {},
): UiGlyph[] {
  const { glyphs } = layoutText(font, text, opts);
  const out: UiGlyph[] = [];
  const copy = (dx: number, dy: number, color: string) => {
    for (const g of glyphs)
      out.push({ kind: 'glyph', font: font.id, ch: g.ch, x: x + g.x + dx, y: y + g.y + dy, color });
  };
  if (style.shadow !== undefined) copy(1, 1, style.shadow);
  if (style.outline !== undefined) for (const [dx, dy] of AROUND) copy(dx, dy, style.outline);
  copy(0, 0, style.color);
  return out;
}

/** A nine-slice panel of a sprite frame (`frameSize` its size) over `box`, as image draws. */
export function panelDraws(
  sprite: { sheet: string; palette?: string; frame: string },
  frameSize: { w: number; h: number },
  insets: Insets,
  box: Box,
  fill: SliceFill = 'stretch',
): UiImage[] {
  return nineSlice(frameSize, insets, box, fill).map((p) => ({
    kind: 'image',
    sheet: sprite.sheet,
    ...(sprite.palette !== undefined && { palette: sprite.palette }),
    frame: sprite.frame,
    ...p,
  }));
}
