import type { Renderer } from '@engine/core/gfx/renderer';
import { skinSetPresenter, type SkinSetPresenter, type SkinSetPresenterOptions } from '@engine/core/draw';
import { SkinnedCanvasPresenter } from './presenter';

/**
 * A game's Canvas2D skins (a `SkinSet` from `@engine/core/present`), its sheets and picture size:
 * the core `SkinSetPresenterOptions` (`@engine/core/draw`).
 */
export type CanvasSkinSetOptions = SkinSetPresenterOptions;

/**
 * One Canvas2D presenter for a game that stacks kits (Engine 0.7 T9, gaps G29 and G34 in
 * docs/reports/stacking-test.md): the core `skinSetPresenter` (`@engine/core/draw`, shared with the
 * PixiJS backend from Engine 0.16 T13b) with a `SkinnedCanvasPresenter` per skin, all on `r`. The
 * game's skin draws its own frames and each mini game's skin the frames whose `status.miniGame`
 * names it (`presenterBySkinSet`). How each skin frames its map (`camera.clamp`) is the skin's, so
 * the 2D page, the view and the tests need no per-round options; the Three.js backend's
 * `threeDisplay` takes the same `rounds`.
 */
export function skinSetCanvasPresenter(r: Renderer, opts: CanvasSkinSetOptions): SkinSetPresenter {
  return skinSetPresenter(opts, (skin, sheet, o) => new SkinnedCanvasPresenter(r, skin, sheet, o));
}
