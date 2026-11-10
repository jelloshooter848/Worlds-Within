/**
 * The PixiJS v8 2D backend (Engine 0.16 T13b): the Renderer contract over a pooled display list,
 * the shared skinned presenter on it and the page's display. No side effects at import, so a page
 * can load it with `import('@engine/backends/pixi')` only when it draws with PixiJS.
 */
export {
  glowHalo,
  HALO_SIZE,
  PixiRenderer,
  sheetSource,
  TintedImage,
  type PixiRendererOptions,
  type PoolCounts,
  type SheetSourceFactory,
} from './renderer';
export { PixiSurfaces, type PendingSurface, type SurfaceTarget } from './surface';
export { PixiPresenter, type PixiPresenterOptions } from './presenter';
export { PixiUiPainter } from './ui-painter';
export { skinSetPixiPresenter } from './skin-set';
export { drawTransition } from './transition';
export {
  pixiDisplay,
  pixiDisplayOn,
  type DisplayGpu,
  type PixiDisplay,
  type PixiDisplayOptions,
} from './display';
