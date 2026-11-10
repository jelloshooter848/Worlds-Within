import { skinSetPresenter, type SkinSetPresenter, type SkinSetPresenterOptions } from '@engine/core/draw';
import { PixiPresenter } from './presenter';
import type { PixiRenderer } from './renderer';
import { PixiSurfaces } from './surface';

/**
 * One PixiJS presenter for a game that stacks kits (the core `skinSetPresenter`, as Canvas2D's
 * `skinSetCanvasPresenter`): a `PixiPresenter` per skin, all on `r` and sharing `surfaces`
 * (default a new `PixiSurfaces` on `r`), picked by `status.miniGame`.
 */
export function skinSetPixiPresenter(
  r: PixiRenderer,
  opts: SkinSetPresenterOptions,
  surfaces: PixiSurfaces = new PixiSurfaces(r),
): SkinSetPresenter {
  return skinSetPresenter(opts, (skin, sheet, o) => new PixiPresenter(r, skin, sheet, { ...o, surfaces }));
}
