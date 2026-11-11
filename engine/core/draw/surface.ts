import type { Renderer } from '../gfx/renderer';
import type { SpriteSheet } from '../gfx/spritesheet';

/**
 * A surface something is drawn onto once and then copied from each frame (the cached map, a
 * font's glyphs in one colour): `renderer` draws onto it, and `image` is the opaque handle the
 * main renderer copies from, put in a `SpriteSheet` (an offscreen canvas for Canvas2D; null in
 * tests, where the copy is still a recorded `sprite` call).
 */
export interface DrawSurface {
  /** Draws onto the surface. */
  renderer: Renderer;
  /** What the main renderer copies from, as a sheet's `image`. */
  image: SpriteSheet['image'];
}

/** A surface the map is drawn onto once per version, then copied to the screen each frame. */
export type MapSurface = DrawSurface;

/** A surface glyphs are drawn onto once per font and colour, then copied (as the map is). */
export type GlyphSurface = DrawSurface;

/** Makes a surface `width` x `height` picture px, or null where there is none. */
export type SurfaceFactory = (width: number, height: number) => DrawSurface | null;
