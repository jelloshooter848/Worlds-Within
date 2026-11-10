import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { RendererUiPainter, type GlyphSurface } from '@engine/core/draw';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { FontLookup } from '@engine/core/ui';
import { canvasSurface } from './surface';

export type { GlyphSurface };

export interface CanvasUiPainterOptions {
  /**
   * Makes a surface for a font's glyphs in one colour, or null to draw each glyph's ink runs as
   * boxes every frame. The default is an offscreen canvas where the browser has one, null in Node.
   */
  glyphSurface?: (width: number, height: number) => GlyphSurface | null;
}

/**
 * The Canvas2D backend's `UiPainter` (`@engine/core/ui`, Engine 0.16 T6): the core
 * `RendererUiPainter` (`@engine/core/draw`, shared with the PixiJS backend from Engine 0.16 T13b)
 * with an offscreen canvas as its default glyph surface. A fill is `rect` (inside `translucent`
 * below alpha 1); an image is `sprite` of the frame's part, scaled with `transformed` when its box
 * is another size (nearest neighbour: the canvas has smoothing off); a glyph is a copy from a strip
 * of the font's glyphs in that colour, drawn once (`glyphSurface`), or, without a surface (Node),
 * its ink runs as boxes.
 */
export class CanvasUiPainter extends RendererUiPainter {
  constructor(
    r: Renderer,
    sheets: SheetLookup,
    fonts: FontLookup | undefined,
    opts: CanvasUiPainterOptions = {},
  ) {
    super(r, sheets, fonts, { glyphSurface: opts.glyphSurface ?? canvasSurface });
  }
}
