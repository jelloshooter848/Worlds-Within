import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { SkinnedPresenter, type SkinnedPresenterOptions } from '@engine/core/draw';
import type { DeepReadonly, SkinFile } from '@engine/core/present';
import type { PixiRenderer } from './renderer';
import { PixiSurfaces } from './surface';

export interface PixiPresenterOptions extends SkinnedPresenterOptions {
  /**
   * The surfaces the map and glyph strips are drawn on (default a new `PixiSurfaces` on the
   * renderer). A display shares one between its presenters and UI painter and flushes it.
   */
  surfaces?: PixiSurfaces;
}

/**
 * The PixiJS backend's `Presenter` (Engine 0.16 T13b-3): the core `SkinnedPresenter`
 * (`@engine/core/draw`, the walk Canvas2D's `SkinnedCanvasPresenter` draws through) on a
 * `PixiRenderer`, so every 0.16 part A feature draws through the same code. Its surfaces are
 * PixiJS `RenderTexture`s (`PixiSurfaces`): the map is drawn once per id and version onto one and
 * copied as a sprite each frame, and each HUD font is drawn once in white and tinted per colour
 * (sprite tint) instead of a strip per colour. The skin's `lighting` (Engine 0.16 part C T4,
 * merged in part D, D1) draws its darkness on a live surface (`PixiSurfaces.makeLive`, rendered
 * every frame) with `PixiRenderer.gradient`'s radial sprites. Every other option and method
 * (`size`/`resize`, `onSound`, `background`, `fonts`/`font`, `clamp`, `reduceFlashing`, `seed`,
 * `shakeScale`, `subPixelShake`, `onHitPause`, `maxParticles`, `particleCount`, `focus()`,
 * `effectSettings`, `showHud`) is the core presenter's.
 */
export class PixiPresenter extends SkinnedPresenter {
  /** Where the map and glyph strips wait to be rendered into their textures. */
  readonly surfaces: PixiSurfaces;

  constructor(
    renderer: PixiRenderer,
    skin: DeepReadonly<SkinFile>,
    sheet: SheetLookup,
    opts: PixiPresenterOptions = {},
  ) {
    const { surfaces = new PixiSurfaces(renderer), ...rest } = opts;
    super(renderer, skin, sheet, {
      ...rest,
      mapSurface: rest.mapSurface ?? surfaces.make,
      glyphSurface: rest.glyphSurface ?? surfaces.make,
      lightSurface: rest.lightSurface ?? surfaces.makeLive,
      tintGlyphs: rest.tintGlyphs ?? surfaces.tint,
    });
    this.surfaces = surfaces;
  }
}
