import { Color, SRGBColorSpace, WebGLRenderer } from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { FontLookup } from '@engine/core/ui';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  skinBackground,
  type DeepReadonly,
  type PresentFrame,
  type Presenter,
  type SkinFile,
  type SoundCue,
} from '@engine/core/present';
import { transitionShape, type CameraFxSettings, type TransitionView } from '@engine/core/fx';
import { webglRendererInfo, type WebglRendererInfo } from './renderer-info';
import { ThreeScene } from './scene';
import { TransitionLayer } from './transition';

type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;

export interface ThreePresenterOptions {
  /** The picture size to draw at (the canvas buffer's size); the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string, cue?: SoundCue) => void;
  /** The clear and background colour when it is not the skin's (default the skin's `background`, else `#000`). */
  background?: string;
  /** Keep the camera inside the map or the hint's `bounds` (default: the skin's `camera.clamp`, else true). */
  clamp?: boolean;
  /** Skip `flash` effects and event `flash`es (the player's reduced-flashing setting). */
  reduceFlashing?: boolean;
  /** The player's screen-shake setting, 0 (no shake) to 1 (full, the default). */
  shakeScale?: number;
  /** Keep trauma-shake offsets fractional (default false: whole picture px). */
  subPixelShake?: boolean;
  /** Called with the ticks of each event whose skin entry asks for a `hitPause` (Engine 0.16 T4). */
  onHitPause?: (ticks: number) => void;
  /** The game's sprite sheets as decoded pixels, for the HUD (`contentPixelSheets`; gap G33). */
  sheets?: PixelSheetLookup;
  /** The game's `font` content files (`contentFonts`, Engine 0.16 T6), for HUD text and widgets. */
  fonts?: FontLookup;
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
  /** The scenes of the presenters `withSkin` made, freed with this one. */
  private readonly others: ThreeScene[] = [];
  /** The screen transition pass (Engine 0.16 T5), drawn over the picture and the HUD. */
  readonly transitionLayer = new TransitionLayer();
  private transitionView: TransitionView | null = null;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, skin: Skin, opts: ThreePresenterOptions = {}) {
    const background = opts.background ?? skinBackground(skin);
    this.size = opts.size;
    this.scene = new ThreeScene(skin, {
      background,
      ...(opts.size !== undefined && { size: opts.size }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.clamp !== undefined && { clamp: opts.clamp }),
      ...sceneEffects(opts),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
      ...(opts.fonts !== undefined && { fonts: opts.fonts }),
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

  /** Changes the player's flashing and shake settings, on this presenter's scenes, from the next frame. */
  effectSettings(settings: CameraFxSettings): void {
    this.scene.effectSettings(settings);
    for (const scene of this.others) scene.effectSettings(settings);
  }

  present(frame: Frame): void {
    this.draw(this.scene, frame);
  }

  /**
   * The screen transition to draw over every frame from now on, or null (Engine 0.16 T5; the
   * shell hands it to `threeDisplay`'s `transition`). An iris closes on the drawn scene's `focus()`.
   */
  transition(view: TransitionView | null): void {
    this.transitionView = view;
  }

  /**
   * Another presenter on this one's canvas and renderer, with its own skin and `ThreeScene`
   * (camera, map and entities): for a second frame source in one stream, such as a mini game's
   * frames in another kit's skin (Engine 0.7 T8, gap G32). One WebGL context draws both, whichever
   * gets the frame. `opts` are the scene's (`size` defaults to this presenter's); `.scene` for
   * read-outs. `dispose()` on this presenter frees its scene too.
   */
  withSkin(skin: Skin, opts: Omit<ThreePresenterOptions, 'size'> = {}): Presenter & { scene: ThreeScene } {
    const scene = new ThreeScene(skin, {
      ...(this.size !== undefined && { size: this.size }),
      ...(opts.background !== undefined && { background: opts.background }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.clamp !== undefined && { clamp: opts.clamp }),
      ...sceneEffects(opts),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
      ...(opts.fonts !== undefined && { fonts: opts.fonts }),
    });
    this.others.push(scene);
    return {
      scene,
      present: (frame) => this.draw(scene, frame),
      resize: (size) => scene.resize({ width: size.width, height: size.height }),
    };
  }

  /** The WebGL vendor and renderer this presenter draws with (see `isSoftwareRenderer`). */
  rendererInfo(): WebglRendererInfo {
    return webglRendererInfo(this.renderer.getContext());
  }

  /** Frees the scene's geometries and materials and the renderer's GPU resources. */
  dispose(): void {
    this.scene.dispose();
    for (const scene of this.others.splice(0)) scene.dispose();
    this.transitionLayer.dispose();
    this.renderer.dispose();
  }

  /**
   * Syncs `scene` with `frame` and draws it on this presenter's canvas: the 3D picture, then the
   * HUD pass (`scene.hud`, gap G33) over it without clearing, when it shows anything.
   */
  private draw(scene: ThreeScene, frame: Frame): void {
    this.setBuffer(this.size ?? frame.size);
    scene.sync(frame);
    const r = this.renderer;
    r.render(scene.scene, scene.camera);
    const size = this.size ?? frame.size;
    const view = this.transitionView;
    const shape = view === null ? null : transitionShape(view, size, scene.focus());
    this.transitionLayer.sync(shape, size);
    const hud = scene.hud.quads().length > 0;
    if (!hud && shape === null) return;
    r.autoClear = false;
    try {
      r.clearDepth();
      if (hud) r.render(scene.hud.scene, scene.hud.camera);
      if (shape !== null) r.render(this.transitionLayer.scene, this.transitionLayer.camera);
    } finally {
      r.autoClear = true;
    }
  }

  /** Sizes the drawing buffer to the picture (CSS size untouched: the page letterboxes it). */
  private setBuffer(size: ScreenSize): void {
    if (this.drawn?.width === size.width && this.drawn.height === size.height) return;
    this.drawn = { width: size.width, height: size.height };
    this.renderer.setSize(size.width, size.height, false);
  }
}

/** The presenter options a `ThreeScene` takes for events and camera effects. */
function sceneEffects(opts: Omit<ThreePresenterOptions, 'size'>) {
  return {
    ...(opts.reduceFlashing !== undefined && { reduceFlashing: opts.reduceFlashing }),
    ...(opts.shakeScale !== undefined && { shakeScale: opts.shakeScale }),
    ...(opts.subPixelShake !== undefined && { subPixelShake: opts.subPixelShake }),
    ...(opts.onHitPause !== undefined && { onHitPause: opts.onHitPause }),
  };
}
