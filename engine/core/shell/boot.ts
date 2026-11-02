import type { ScreenSize } from '../gfx/screen';
import { GamepadSource } from '../input/gamepad';
import { InputManager } from '../input/input-manager';
import { KeyboardSource } from '../input/keyboard';
import { PointerSource } from '../input/pointer';
import type { PointerOptions } from '../input/pointer-logic';
import { TouchSource } from '../input/touch';
import { layoutScreen } from '../input/touch-layout';
import { FixedLoop } from '../loop';
import { SceneStack, type Scene } from '../scene';
import { backendFromQuery, otherBackendLink, type PageBackend } from './backend-choice';
import type { BrowserDisplay, DisplayResult } from './display';

/**
 * The browser boot every game page needs (Engine 0.7, moved from `games/platformer-lab/main.ts`):
 * the backend the page asks for (`?backend=three`), the toggle link to the other one, keyboard,
 * gamepad and the touch pad (shown on touch devices, laid out clear of the picture with
 * `layoutScreen`), the game's first scene on a `SceneStack`, stepped by a `FixedLoop`. The picture
 * comes from a display factory per backend the game hands in, so the core imports no backend and
 * a game can `import()` Three.js only in 3D. Browser only (DOM, clock): not on `PURE_CORE`.
 */

/** Builds a display on the page's canvas (may load its backend first). */
export type DisplayFactory = (canvas: HTMLCanvasElement) => DisplayResult | Promise<DisplayResult>;

export interface BrowserBootOptions {
  /** The game's picture size (`content.manifest.screen`). */
  screen: ScreenSize;
  /** A display per backend; a game without `three` always shows Canvas2D and hides the toggle. */
  displays: { canvas2d: DisplayFactory; three?: DisplayFactory };
  /**
   * The game's first scene, given the stack (to push mini games), the display and the page's
   * extra inputs (`page.pointer`, when `pointer` is on).
   */
  scene(stack: SceneStack, display: BrowserDisplay, page: BootPage): Scene;
  /**
   * Pointer gestures on the canvas (Engine 0.9): true (or the recogniser's options, all but
   * `screen`) makes a `PointerSource`, stepped with the input frame; its scenes read
   * `page.pointer.gestures()` in `update`. Off by default, so existing games are unchanged.
   */
  pointer?: boolean | Omit<PointerOptions, 'screen'>;
  /** The on-screen touch pad (default true). An RTS page that plays by pointer turns it off. */
  touchPad?: boolean;
  /** The canvas element's id (default `screen`). */
  canvasId?: string;
  /** The toggle link's id (default `backend`); a page without one has no toggle. */
  toggleId?: string;
  /** The URL query to read the backend from (default `location.search`). */
  search?: string;
}

/** The page's inputs beyond the `InputFrame`, for a game's scenes. */
export interface BootPage {
  /** Pointer gestures on the canvas, or null when the game did not ask for them. */
  pointer: PointerSource | null;
}

/** What a booted page holds, for a game that wants to reach in (audio, debugging). */
export interface BootedGame extends BootPage {
  backend: PageBackend;
  display: BrowserDisplay;
  scenes: SceneStack;
  input: InputManager;
  loop: FixedLoop;
}

/**
 * Boots a game page and starts its loop. Sets `body[data-backend]` to the backend once running
 * (`none` when the display could not start: then the page shows why, with a link to 2D, and this
 * returns null).
 */
export async function bootBrowserGame(opts: BrowserBootOptions): Promise<BootedGame | null> {
  const canvas = document.getElementById(opts.canvasId ?? 'screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error(`#${opts.canvasId ?? 'screen'} canvas missing`);

  const asked = backendFromQuery(opts.search ?? window.location.search);
  const backend: PageBackend = asked === 'three' && opts.displays.three ? 'three' : 'canvas2d';
  showBackendToggle(opts.displays.three ? backend : null, opts.toggleId ?? 'backend');
  const make = backend === 'three' ? opts.displays.three! : opts.displays.canvas2d;
  const display = await make(canvas);
  if (typeof display === 'string') {
    showDisplayMessage(canvas, display);
    return null;
  }

  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());
  const touch = opts.touchPad === false ? null : new TouchSource(document.body);
  if (touch) {
    input.addSource('touch', touch);
    touch.show(TouchSource.likelyTouchDevice());
  }
  const pointer = opts.pointer ? pointerSource(canvas, display, opts) : null;

  // The picture and the touch controls never overlap (engine/core/input/touch-layout.ts).
  const relayout = () => {
    const layout = layoutScreen({
      width: window.innerWidth,
      height: window.innerHeight,
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      dpr: window.devicePixelRatio || 1,
      integerScale: false,
      touch: touch?.shown ?? false,
      touchScale: 1,
      screen: opts.screen,
    });
    display.fit(layout);
    touch?.applyLayout(layout);
  };
  relayout();
  window.addEventListener('resize', relayout);

  const scenes = new SceneStack();
  scenes.push(opts.scene(scenes, display, { pointer }));

  const loop = new FixedLoop({
    step() {
      input.beginFrame();
      pointer?.beginFrame(performance.now());
      scenes.update([input.player(0)]);
    },
    render() {
      scenes.render(display.renderer);
      display.present();
    },
  });
  loop.start();
  document.body.dataset.backend = backend;
  return { backend, display, scenes, input, loop, pointer };
}

/** The pointer source on the canvas, in picture pixels through the display (else the canvas box). */
function pointerSource(
  canvas: HTMLCanvasElement,
  display: BrowserDisplay,
  opts: BrowserBootOptions,
): PointerSource {
  const { screen } = opts;
  const toScreen =
    display.toScreen?.bind(display) ??
    ((clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / (rect.width || 1)) * screen.width,
        y: ((clientY - rect.top) / (rect.height || 1)) * screen.height,
      };
    });
  const options = typeof opts.pointer === 'object' ? opts.pointer : {};
  return new PointerSource(canvas, toScreen, { ...options, screen });
}

/** Sets the toggle link (`#backend`) to the other backend, or hides it (`backend` null). */
export function showBackendToggle(backend: PageBackend | null, id = 'backend'): void {
  const link = document.getElementById(id) as HTMLAnchorElement | null;
  if (!link) return;
  if (backend === null) {
    link.hidden = true;
    return;
  }
  const other = otherBackendLink(backend);
  link.textContent = other.label;
  link.href = other.href;
  link.title = other.title;
}

/** Shows why the picture cannot start (no WebGL), with a way back to 2D, instead of a blank page. */
export function showDisplayMessage(canvas: HTMLCanvasElement, text: string): void {
  canvas.hidden = true;
  const box = document.createElement('div');
  box.id = 'message';
  box.setAttribute('role', 'alert');
  const line = document.createElement('p');
  line.textContent = text;
  const back = document.createElement('a');
  back.href = otherBackendLink('three').href;
  back.textContent = 'Play in 2D instead';
  box.append(line, back);
  document.body.append(box);
  document.body.dataset.backend = 'none';
}
