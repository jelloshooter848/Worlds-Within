import { Color, SRGBColorSpace, WebGLRenderer } from 'three';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, PresentFrame, Presenter, SkinFile } from '@engine/core/present';
import { webglRendererInfo, type WebglRendererInfo } from './renderer-info';
import { ThreeScene } from './scene';

type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;

export interface ThreePresenterOptions {
  /** The picture size to draw at (the canvas buffer's size); the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string) => void;
  /** The clear and background colour (default `#000`). */
  background?: string;
  /** Keep the camera inside the map or the hint's `bounds` (default true). */
  clamp?: boolean;
  /** Skip `flash` effects (the player's reduced-flashing setting). */
  reduceFlashing?: boolean;
}

/**
 * The 3D backend's `Presenter`: each `present(frame)` syncs a {@link ThreeScene} and draws it
 * with a `WebGLRenderer` on the given canvas. The renderer is set up so that a paused frame draws
 * the same every time on one machine: no antialiasing, pixel ratio 1 (the buffer is the picture
 * size; CSS scales it, see `fitCanvas`), sRGB output, a fixed clear colour, and the drawing buffer
 * kept for screenshots. Browser only: Node has no WebGL, so this is checked in a browser.
 */
export class ThreePresenter implements Presenter {
  /** The scene graph this presenter draws (read it for tests and debugging). */
  readonly scene: ThreeScene;
  readonly renderer: WebGLRenderer;
  private size: ScreenSize | undefined;
  /** The buffer size last given to the renderer. */
  private drawn: ScreenSize | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, skin: Skin, opts: ThreePresenterOptions = {}) {
    const background = opts.background ?? '#000';
    this.size = opts.size;
    this.scene = new ThreeScene(skin, {
      background,
      ...(opts.size !== undefined && { size: opts.size }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.clamp !== undefined && { clamp: opts.clamp }),
      ...(opts.reduceFlashing !== undefined && { reduceFlashing: opts.reduceFlashing }),
    });
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(1);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color(background), 1);
    this.renderer.shadowMap.enabled = false;
    if (opts.size) this.setBuffer(opts.size);
  }

  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
    this.scene.resize(this.size);
  }

  present(frame: Frame): void {
    this.setBuffer(this.size ?? frame.size);
    this.scene.sync(frame);
    this.renderer.render(this.scene.scene, this.scene.camera);
  }

  /** The WebGL vendor and renderer this presenter draws with (see `isSoftwareRenderer`). */
  rendererInfo(): WebglRendererInfo {
    return webglRendererInfo(this.renderer.getContext());
  }

  /** Frees the scene's geometries and materials and the renderer's GPU resources. */
  dispose(): void {
    this.scene.dispose();
    this.renderer.dispose();
  }

  /** Sizes the drawing buffer to the picture (CSS size untouched: the page letterboxes it). */
  private setBuffer(size: ScreenSize): void {
    if (this.drawn?.width === size.width && this.drawn.height === size.height) return;
    this.drawn = { width: size.width, height: size.height };
    this.renderer.setSize(size.width, size.height, false);
  }
}
