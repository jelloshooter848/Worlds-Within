import { canvasRecolor } from '@engine/core/assets/canvas-recolor';
import type { SheetLookup } from '@engine/core/assets/sheet-lookup';
import { SkinnedPresenter, type SkinnedPresenterOptions } from '@engine/core/draw';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { DeepReadonly, SkinFile } from '@engine/core/present';
import { CanvasRenderer } from './renderer';
import { canvasSurface } from './surface';

export type { MapSurface, SkinnedPresenterOptions } from '@engine/core/draw';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function isRenderer(target: Renderer | Ctx): target is Renderer {
  return typeof (target as Partial<Renderer>).sprite === 'function';
}

/**
 * The Canvas2D backend's `Presenter`: the core `SkinnedPresenter` (`@engine/core/draw`, the skinned
 * presenter walk the 2D backends share from Engine 0.16 T13b) on a `CanvasRenderer` (or any
 * `Renderer` given), with offscreen canvases as its default `mapSurface` (the cached map) and
 * `glyphSurface` (UI font strips) and `lightSurface` (the skin's lighting's light map, Engine 0.16
 * part C T4); none in Node, where the map's tiles and glyphs' ink runs are
 * drawn every frame. Its default `recolor` is `canvasRecolor` (Engine 0.16 part D, D4: outline
 * silhouettes and team colours, null in Node). Every option and method is the core presenter's.
 */
export class SkinnedCanvasPresenter extends SkinnedPresenter {
  constructor(
    target: Renderer | Ctx,
    skin: DeepReadonly<SkinFile>,
    sheet: SheetLookup,
    opts: SkinnedPresenterOptions = {},
  ) {
    super(isRenderer(target) ? target : new CanvasRenderer(target), skin, sheet, {
      ...opts,
      mapSurface: opts.mapSurface ?? canvasSurface,
      glyphSurface: opts.glyphSurface ?? canvasSurface,
      lightSurface: opts.lightSurface ?? canvasSurface,
      recolor: opts.recolor ?? canvasRecolor,
    });
  }
}
