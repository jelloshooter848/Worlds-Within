import { AudioManager, type Volumes } from '../audio/audio-manager';
import type { Sfx, Song } from '../audio/mml';
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
import { PageDebugHook, type PageDebug } from './debug';
import type { BrowserDisplay, DisplayResult } from './display';

/**
 * The browser boot every game page needs (Engine 0.7, moved from `games/platformer-lab/main.ts`):
 * the backend the page asks for (`?backend=three`), the toggle link to the other one, keyboard,
 * gamepad and the touch pad (shown on touch devices, laid out clear of the picture with
 * `layoutScreen`), the game's first scene on a `SceneStack`, stepped by a `FixedLoop`. The picture
 * comes from a display factory per backend the game hands in, so the core imports no backend and
 * a game can `import()` Three.js only in 3D. With `audio` (Engine 0.11, gap G27) it also makes the
 * game's `AudioManager`, unlocked on the first key, tap or click, and hands the displays its
 * `onSound`. With `manual` or `?debug=step` (Engine 0.14 T8, gap G31) the loop does not run by
 * itself and `window.__ww` steps it (`debug.ts`); with `?record` (Engine 0.14 T9, gap M19)
 * `window.__ww` is there too, recording every hosted round's input (the loop runs as usual unless
 * `debug=step` is also asked). Browser only (DOM, clock): not on `PURE_CORE`.
 */

/** The query value that boots a page in manual-loop mode: `?debug=step`. */
export const DEBUG_STEP_QUERY = 'debug=step';

/** True when a page URL's query (`location.search`) asks for manual-loop mode (`?debug=step`). */
export function manualFromQuery(search: string): boolean {
  return new URLSearchParams(search).get('debug') === 'step';
}

/** The query flag that boots a page recording its hosted rounds' input: `?record`. */
export const RECORD_QUERY = 'record';

/** True when a page URL's query asks for recording (`?record`, any value but `0`). */
export function recordFromQuery(search: string): boolean {
  const value = new URLSearchParams(search).get(RECORD_QUERY);
  return value !== null && value !== '0';
}

/** The page's step hook, on `window` in manual-loop mode or when recording. */
export interface DebugWindow {
  __ww?: PageDebug;
}

/** What the shell gives a display factory besides the canvas. */
export interface DisplayShell {
  /**
   * Plays a skin's event sound (pass it as the display's `onSound`): the shell's `AudioManager`
   * with the game's sfx when the boot has `audio`, else it does nothing.
   */
  onSound(id: string): void;
}

/** Builds a display on the page's canvas (may load its backend first). */
export type DisplayFactory = (
  canvas: HTMLCanvasElement,
  shell: DisplayShell,
) => DisplayResult | Promise<DisplayResult>;

/**
 * The page's sound (Engine 0.11, gap G27): the game's songs and sound effects (`contentSongs`,
 * `contentSfx` from `@engine/core/content/game-content`), a song to start, and the player's volumes.
 */
export interface BootAudio {
  /** The sound effects the skins name (`sfx` content). */
  sfx?: readonly Sfx[];
  /** The songs (`song` content). */
  songs?: readonly Song[];
  /** A song id to play once audio is unlocked (it waits for the first gesture). */
  music?: string;
  /** The player's settings (master, music and sfx volume, mute); the manager's defaults otherwise. */
  volumes?: Partial<Volumes>;
}

/** The DOM events that count as the first gesture: browsers allow sound only after one. */
export const AUDIO_UNLOCK_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

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
  /**
   * Music and sound (Engine 0.11, gap G27): an `AudioManager` with these songs and sfx, unlocked on
   * every key, tap or click (the first starts it; later ones recover a context the browser
   * suspended), `music` played once unlocked, and `onSound` for the display factories. Without it
   * the page is silent, as before.
   */
  audio?: BootAudio;
  /**
   * Manual-loop mode (Engine 0.14 T8, gap G31): the `FixedLoop` never runs on
   * `requestAnimationFrame`, and `window.__ww` (`PageDebug`, `debug.ts`) steps it exactly n 60 Hz
   * steps, reads the game's snapshot and state hash, and replays a run file. Also on when the
   * page's query has `debug=step`. Off by default: the page plays as before.
   */
  manual?: boolean;
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
  /** The page's audio (change volumes, play another song), or null without the `audio` option. */
  audio: AudioManager | null;
  /** The step hook (also `window.__ww`) in manual-loop mode or with `?record`, else null. */
  debug: PageDebug | null;
}

/**
 * Boots a game page and starts its loop. Sets `body[data-backend]` to the backend once running
 * (`none` when the display could not start: then the page shows why, with a link to 2D, and this
 * returns null).
 */
export async function bootBrowserGame(opts: BrowserBootOptions): Promise<BootedGame | null> {
  const canvas = document.getElementById(opts.canvasId ?? 'screen') as HTMLCanvasElement | null;
  if (!canvas) throw new Error(`#${opts.canvasId ?? 'screen'} canvas missing`);

  const search = opts.search ?? window.location.search;
  const asked = backendFromQuery(search);
  const manual = opts.manual === true || manualFromQuery(search);
  const record = recordFromQuery(search);
  const backend: PageBackend = asked === 'three' && opts.displays.three ? 'three' : 'canvas2d';
  showBackendToggle(opts.displays.three ? backend : null, opts.toggleId ?? 'backend');
  const make = backend === 'three' ? opts.displays.three! : opts.displays.canvas2d;
  const audio = opts.audio ? shellAudio(opts.audio) : null;
  const display = await make(canvas, { onSound: (id) => audio?.sfx(id) });
  if (typeof display === 'string') {
    showDisplayMessage(canvas, display);
    return null;
  }
  if (audio) {
    const unlock = () => audio.unlock();
    for (const ev of AUDIO_UNLOCK_EVENTS) window.addEventListener(ev, unlock, { passive: true });
    // Back from the background (a phone's home screen): resume now if allowed, redo the unlock
    // on the next gesture otherwise (`AudioManager.wake`).
    window.addEventListener('pageshow', () => audio.wake());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') audio.wake();
    });
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

  // In manual-loop mode the clock is the steps taken (a pointer's long press counts game steps).
  let hook: PageDebugHook | null = null;
  const loop: FixedLoop = new FixedLoop(
    {
      step() {
        input.beginFrame();
        pointer?.beginFrame(manual ? loop.steps * loop.stepMs : performance.now());
        const frame = input.player(0);
        scenes.update([hook ? hook.frame(frame) : frame]);
      },
      render() {
        scenes.render(display.renderer);
        display.present();
      },
    },
    60,
    4,
    { manual },
  );
  if (manual || record) {
    hook = new PageDebugHook({
      advance: (n) => loop.advance(n),
      steps: () => loop.steps,
      game: () => scenes.find((s) => (s.headless?.() ?? null) !== null)?.headless?.() ?? null,
    });
    if (record) hook.api.record(true);
    (window as DebugWindow).__ww = hook.api;
  }
  if (manual)
    loop.advance(0); // the first picture, before any step
  else loop.start();
  document.body.dataset.backend = backend;
  return { backend, display, scenes, input, loop, pointer, audio, debug: hook?.api ?? null };
}

/** The boot's `AudioManager`: the songs and sfx registered, the volumes set, the music waiting. */
function shellAudio(opts: BootAudio): AudioManager {
  const audio = new AudioManager();
  audio.registerSongs([...(opts.songs ?? [])]);
  audio.registerSfx([...(opts.sfx ?? [])]);
  if (opts.volumes) audio.setVolumes(opts.volumes);
  if (opts.music !== undefined) audio.playMusic(opts.music);
  return audio;
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
