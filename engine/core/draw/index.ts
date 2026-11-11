/**
 * The drawing side of the core shared by the 2D backends (Engine 0.16 T13b): the skinned presenter
 * walk on any `Renderer`, its UI painter and the skin-set presenter. Backends only: kits and the
 * sim may not import it (FORBIDDEN_CORE in config/layers.js).
 */
export type { DrawSurface, GlyphSurface, MapSurface, SurfaceFactory } from './surface';
export { RendererUiPainter, type GlyphTint, type RendererUiPainterOptions } from './ui-painter';
export { SkinnedPresenter, type SkinnedPresenterOptions } from './skinned-presenter';
export {
  skinSetPresenter,
  type SkinPresenterFactory,
  type SkinSetPresenter,
  type SkinSetPresenterOptions,
} from './skin-set';
