import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';

/** Sheet ids the kit draws with (the art contract); a game may point them elsewhere. */
export interface TdSheets {
  tiles: string;
  /** Palette for the tiles in rooms marked `dark` (falls back to the sheet's own). */
  tilesDark: string | null;
  hero: string;
  enemies: string;
}

export const DEFAULT_SHEETS: TdSheets = {
  tiles: 'dungeon',
  tilesDark: 'dungeon-dark',
  hero: 'link-td',
  enemies: 'dungeon-enemies',
};

/** What drawing needs: the frame counter, the flashing preference and sheet lookup. */
export interface TdView {
  readonly frame: number;
  readonly reduceFlashing: boolean;
  readonly sheets: TdSheets;
  /** The tile palette of the room being drawn (a dark room's), for things drawn from the tile sheet. */
  readonly tilePalette?: string | undefined;
  /** A sheet (optionally recoloured), or null when it is not registered (headless tests, missing art). */
  sheet(id: string, palette?: string): SpriteSheet | null;
}

const EMPTY_FONT: SpriteSheet = { id: 'missing-font', image: null, frames: new Map() };

/** The bitmap font, or an empty stand-in so text calls still happen (and tests can read them). */
export function fontOf(view: TdView): SpriteSheet {
  return view.sheet('font') ?? EMPTY_FONT;
}

/**
 * Draws a frame, or a flat box in `color` when the sheet or frame is missing, so a room stays
 * readable before its art exists.
 */
export function drawFrame(
  r: Renderer,
  sheet: SpriteSheet | null,
  frame: string,
  x: number,
  y: number,
  color: string,
  size: { w: number; h: number } = { w: 16, h: 16 },
  flipX = false,
  flipY = false,
): void {
  if (sheet?.frames.has(frame)) r.sprite(sheet, frame, x, y, flipX, flipY);
  else r.rect(x, y, size.w, size.h, color);
}
