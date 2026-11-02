/** The 3D backend (Engine 0.6): builds a Three.js scene from presentation frames and a `three` skin. */
export { ThreeScene, type ThreeSceneOptions } from './scene';
export { ThreePresenter, type ThreePresenterOptions } from './presenter';
export {
  isSoftwareRenderer,
  webglRendererInfo,
  type GlInfoSource,
  type WebglRendererInfo,
} from './renderer-info';
export { applyCanvasBox, canvasToScreen, fitCanvas, type CanvasBox } from './fit';
export { GeometryCache, primitiveGeometry, type PartSize } from './geometry';
export { threeDisplay, threeScenePresenter, webgl2Available, type ThreeDisplayOptions } from './display';
