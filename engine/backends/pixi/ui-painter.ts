import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { RendererUiPainter } from '@engine/core/draw';
import type { FontLookup } from '@engine/core/ui';
import type { PixiRenderer } from './renderer';
import { PixiSurfaces } from './surface';

/**
 * The PixiJS backend's `UiPainter` (`@engine/core/ui`; Engine 0.16 T13b-3): the core
 * `RendererUiPainter` on a `PixiRenderer`, with each font's glyphs drawn once in white on a
 * `RenderTexture` (`surfaces`, default a new `PixiSurfaces` on `r`) and tinted per colour. Fills
 * are tinted white sprites, images sheet sprites (scaled in a transform container).
 */
export class PixiUiPainter extends RendererUiPainter {
  constructor(
    r: PixiRenderer,
    sheets: SheetLookup,
    fonts: FontLookup | undefined,
    readonly surfaces: PixiSurfaces = new PixiSurfaces(r),
  ) {
    super(r, sheets, fonts, { glyphSurface: surfaces.make, tintGlyphs: surfaces.tint });
  }
}
