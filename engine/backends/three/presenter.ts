import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  Color,
  LinearSRGBColorSpace,
  NoToneMapping,
  PCFShadowMap,
  SRGBColorSpace,
  WebGLRenderer,
  type ToneMapping,
} from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { FontLookup, UiDraw } from '@engine/core/ui';
import { HudLayer } from './hud';
import type { ModelLibrary } from './models';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  resolveScene3d,
  skinBackground,
  type DeepReadonly,
  type PresentFrame,
  type Presenter,
  type SkinFile,
  type SoundCue,
  type DecorLookup,
  MAX_RENDER_SCALE,
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
  /** The game's glTF models (`new ModelLibrary(content.assets)`, Engine 0.16 T11), for every scene. */
  models?: ModelLibrary;
  /** The game's decor grids (`contentDecor(content)`, Engine 0.16 F3), for every scene. */
  decor?: DecorLookup;
  /**
   * Drawing-buffer px per picture px, a whole number 1-8 (Engine 0.16 F3; default the skin's
   * `scene3d.renderScale`, else 1): the 3D picture is drawn at `size * renderScale` (supersampled),
   * and the HUD, labels, menus and transitions keep their picture-px layout and draw scaled
   * (nearest neighbour). Every scene of this presenter draws at it.
   */
  renderScale?: number;
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
  /** The picture size the buffer was last sized for (picture px; the buffer is this times `renderScale`). */
  private drawn: ScreenSize | null = null;
  /** Drawing-buffer px per picture px (Engine 0.16 F3). */
  readonly renderScale: number;
  /** The scenes of the presenters `withSkin` made, freed with this one. */
  private readonly others: ThreeScene[] = [];
  /** The screen transition pass (Engine 0.16 T5), drawn over the picture and the HUD. */
  readonly transitionLayer = new TransitionLayer();
  private transitionView: TransitionView | null = null;
  /** The UI overlay pass (Engine 0.16 T9: the shell's menus), drawn over the last frame. */
  readonly overlay: HudLayer;
  /** Whether a frame was drawn since the last overlay (so an overlay never draws over itself). */
  private drewFrame = false;
  /** Whether the HUD pass is drawn (`showHud`; the shell hides it under the title). */
  private hudShown = true;

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas, skin: Skin, opts: ThreePresenterOptions = {}) {
    const background = opts.background ?? skinBackground(skin);
    this.size = opts.size;
    this.renderScale = checkRenderScale(
      opts.renderScale ?? resolveScene3d(skin.scene3d, { ambient: 0, directional: 0 }).renderScale,
    );
    this.scene = new ThreeScene(skin, {
      renderScale: this.renderScale,
      ...(opts.decor !== undefined && { decor: opts.decor }),
      background,
      ...(opts.size !== undefined && { size: opts.size }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.clamp !== undefined && { clamp: opts.clamp }),
      ...sceneEffects(opts),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
      ...(opts.fonts !== undefined && { fonts: opts.fonts }),
      ...(opts.models !== undefined && { models: opts.models }),
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
    // PCF (not PCF soft): its filter honours each light's `shadow.radius` (Engine 0.16 T12).
    this.renderer.shadowMap.type = PCFShadowMap;
    if (opts.size) this.setBuffer(opts.size);
    this.overlay = new HudLayer(skin, opts.sheets, opts.fonts);
  }

  /**
   * Draws UI kit items over the frame drawn last (Engine 0.16 T9: the shell's title, pause and
   * settings screens; `threeDisplay`'s `uiPainter` collects them and hands them over on
   * `present`). Nothing is drawn when no frame was drawn since the last call, so a translucent
   * panel never darkens itself.
   */
  ui(draws: readonly UiDraw[]): void {
    const drew = this.drewFrame;
    this.drewFrame = false;
    if (draws.length === 0 || !drew || this.drawn === null) return;
    this.overlay.syncDraws(draws, this.drawn);
    const r = this.renderer;
    r.autoClear = false;
    try {
      r.clearDepth();
      r.render(this.overlay.scene, this.overlay.camera);
    } finally {
      r.autoClear = true;
    }
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
   * Whether the HUD pass is drawn from the next frame, on this presenter's scene and every
   * `withSkin` one (Engine 0.16 part C T1: the shell hides it under the title). The scene still
   * syncs its HUD, so a counter's roll goes on.
   */
  showHud(shown: boolean): void {
    this.hudShown = shown;
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
  withSkin(
    skin: Skin,
    opts: Omit<ThreePresenterOptions, 'size' | 'renderScale'> = {},
  ): Presenter & { scene: ThreeScene } {
    const scene = new ThreeScene(skin, {
      renderScale: this.renderScale,
      ...(opts.decor !== undefined && { decor: opts.decor }),
      ...(this.size !== undefined && { size: this.size }),
      ...(opts.background !== undefined && { background: opts.background }),
      ...(opts.onSound !== undefined && { onSound: opts.onSound }),
      ...(opts.clamp !== undefined && { clamp: opts.clamp }),
      ...sceneEffects(opts),
      ...(opts.sheets !== undefined && { sheets: opts.sheets }),
      ...(opts.fonts !== undefined && { fonts: opts.fonts }),
      ...(opts.models !== undefined && { models: opts.models }),
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
    this.overlay.dispose();
    this.renderer.dispose();
  }

  /**
   * Syncs `scene` with `frame` and draws it on this presenter's canvas: the 3D picture, then the
   * HUD pass (`scene.hud`, gap G33) over it without clearing, when it shows anything.
   */
  private draw(scene: ThreeScene, frame: Frame): void {
    this.setBuffer(this.size ?? frame.size);
    this.drewFrame = true;
    scene.sync(frame);
    const r = this.renderer;
    applyLook(r, scene);
    r.render(scene.scene, scene.camera);
    const size = this.size ?? frame.size;
    const view = this.transitionView;
    const shape = view === null ? null : transitionShape(view, size, scene.focus());
    this.transitionLayer.sync(shape, size);
    const labels = scene.labels.quads().length > 0;
    const hud = this.hudShown && scene.hud.quads().length > 0;
    if (!hud && !labels && shape === null) return;
    r.autoClear = false;
    try {
      r.clearDepth();
      if (labels) r.render(scene.labels.scene, scene.labels.camera);
      if (hud) r.render(scene.hud.scene, scene.hud.camera);
      if (shape !== null) r.render(this.transitionLayer.scene, this.transitionLayer.camera);
    } finally {
      r.autoClear = true;
    }
  }

  /**
   * Sizes the drawing buffer to the picture times `renderScale` (CSS size untouched: the page
   * letterboxes it). Every pass lays out in picture px; the viewport is the whole buffer, so the
   * 3D picture is supersampled and the HUD's nearest-filtered quads scale with it.
   */
  private setBuffer(size: ScreenSize): void {
    if (this.drawn?.width === size.width && this.drawn.height === size.height) return;
    this.drawn = { width: size.width, height: size.height };
    this.renderer.setSize(size.width * this.renderScale, size.height * this.renderScale, false);
  }
}

/** A render scale as given, or an error naming the range (a whole number 1-8). */
function checkRenderScale(scale: number): number {
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_RENDER_SCALE)
    throw new Error(`renderScale must be a whole number from 1 to ${MAX_RENDER_SCALE}, not ${scale}`);
  return scale;
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

const TONE_MAPPING: Record<ThreeScene['look']['toneMapping']['kind'], ToneMapping> = {
  none: NoToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
};

/**
 * Sets the renderer up for `scene`'s look (Engine 0.16 T12): shadows on when its sun casts them,
 * its tone mapping and exposure, and its output colour space. A skin without `scene3d` gets what
 * every frame had before: no shadows, no tone mapping, sRGB.
 */
function applyLook(r: WebGLRenderer, scene: ThreeScene): void {
  const look = scene.look;
  const shadows = look.sun.shadow !== null;
  if (r.shadowMap.enabled !== shadows) {
    r.shadowMap.enabled = shadows;
    r.shadowMap.needsUpdate = true;
  }
  r.toneMapping = TONE_MAPPING[look.toneMapping.kind];
  r.toneMappingExposure = scene.exposure;
  r.outputColorSpace = look.colorSpace === 'linear' ? LinearSRGBColorSpace : SRGBColorSpace;
}
