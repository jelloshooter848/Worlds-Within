import { AudioManager, type Volumes } from '../audio/audio-manager';
import type { MusicEntry, SoundCue } from '../audio/mix';
import { Mixer } from '../audio/mixer';
import { HitPause } from '../fx/hit-pause';
import type { TransitionsSpec } from '../fx/transition';
import type { DeepReadonly, Presenter } from '../present/types';
import type { Sfx, Song } from '../audio/mml';
import type { ScreenSize } from '../gfx/screen';
import { GamepadSource } from '../input/gamepad';
import { InputManager } from '../input/input-manager';
import type { FrameTap } from '../input/input-manager';
import { KeyboardSource } from '../input/keyboard';
import { PointerSource } from '../input/pointer';
import type { PointerGesture, PointerOptions } from '../input/pointer-logic';
import { TouchSource } from '../input/touch';
import { layoutScreen } from '../input/touch-layout';
import { FixedLoop } from '../loop';
import { loadVolumes } from '../save/settings';
import { SceneStack, type Scene } from '../scene';
import { backendFromQuery, otherBackendLink, type PageBackend } from './backend-choice';
import { PageDebugHook, type PageDebug } from './debug';
import { ShellTransitions, type TransitionRequest } from './transitions';
import { UiScene } from './ui-scene';
import { mountVolumeControl, type VolumeControl } from './volume-control';
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
   * with the game's sfx when the boot has `audio`, else it does nothing. The presenters' `cue`
   * (Engine 0.16 T8: the frame and the skin entry's `pitch`, `volume`, `cooldown`, `duck`) goes
   * to the shell's `Mixer`, which varies, rests and ducks.
   */
  onSound(id: string, cue?: SoundCue): void;
  /**
   * Holds the game's ticks for `ticks` display frames while the picture keeps drawing (a skin
   * event's `hitPause`, Engine 0.16 T4; pass it as the display's `onHitPause`). The tick sequence
   * and every state hash stay the same; in manual-loop mode (`?debug=step`) it does nothing, so
   * the step hook stays tick-exact.
   */
  hitPause(ticks: number): void;
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
  /**
   * The volumes (master, music and sfx, mute) a player who stored none starts at; the manager's
   * defaults otherwise. From Engine 0.15 (gap M1) the player's stored volumes win.
   */
  volumes?: Partial<Volumes>;
  /**
   * Layered songs (Engine 0.16 T8): the skin's `music` section. `music` naming one of them plays
   * its layers together, mixed by its rules from each presented frame's status.
   */
  mix?: DeepReadonly<Record<string, MusicEntry>> | undefined;
  /** The seed sound variation draws from (`fxRng`; default 0): the game's start seed. */
  seed?: number;
}

/** The DOM events that count as the first gesture: browsers allow sound only after one. */
export const AUDIO_UNLOCK_EVENTS = ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'] as const;

export interface BrowserBootOptions {
  /** The game's picture size (`content.manifest.screen`). */
  screen: ScreenSize;
  /**
   * The game's id (`content.manifest.id`, Engine 0.15, gap M1): the key the player's volumes are
   * stored under (`save/settings.ts`). Left out, the volume control works but stores nothing.
   */
  game?: string;
  /**
   * The shell's mute button and volume slider (Engine 0.15, gap M1; `volume-control.ts`): on by
   * default on every page with `audio`, which then starts at the player's stored volumes and
   * stores every change. `false` leaves it out (the stored volumes still apply).
   */
  volumeControl?: boolean;
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
  /**
   * The game's screen transitions (`content.manifest.transitions`, Engine 0.16 T5): played on a
   * map id change (`level`), a scene push or pop (`scene`, `mission`) and on demand
   * (`booted.transition`). Left out, none play (an on-demand one with its own spec still does).
   */
  transitions?: DeepReadonly<TransitionsSpec> | undefined;
  /**
   * The player's reduced-motion setting: every transition becomes a short fade. Default: the
   * browser's `prefers-reduced-motion: reduce`.
   */
  reduceMotion?: boolean;
}

/** The page's inputs beyond the `InputFrame`, for a game's scenes. */
export interface BootPage {
  /** Pointer gestures on the canvas, or null when the game did not ask for them. */
  pointer: PointerSource | null;
  /**
   * Plays a UI sound (a menu's or dialog's, `UiScreen`'s `onSound`) on the mixer's ui bus
   * (Engine 0.16 T8); does nothing without `audio`.
   */
  uiSound(id: string): void;
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
  /**
   * The page's mixer (Engine 0.16 T8) over `audio`, or null without it: `mixer.play(id)` changes
   * the music (layered songs mixed from the frames' status), `mixer.state()` reads it.
   */
  mixer: Mixer | null;
  /** The step hook (also `window.__ww`) in manual-loop mode or with `?record`, else null. */
  debug: PageDebug | null;
  /** The mute button and volume slider (with `audio`, unless `volumeControl: false`), else null. */
  volume: VolumeControl | null;
  /** The hit-pause the loop honours (Engine 0.16 T4): display frames still held. */
  hitPause: HitPause;
  /** The page's screen transitions (Engine 0.16 T5). */
  transitions: ShellTransitions;
  /**
   * Plays a transition now (a slot of the game's, default `default`, or a spec), with `covered`
   * run once the picture is fully covered (swap the scene there). False when none could start
   * (then `covered` runs at once).
   */
  transition(what?: TransitionRequest, covered?: () => void): boolean;
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
  const audio = opts.audio ? new AudioManager() : null;
  const mixer = audio && opts.audio ? shellMixer(audio, opts.audio) : null;
  const hitPause = new HitPause();
  const display = await make(canvas, {
    onSound: (id, cue) => mixer?.sound(id, cue),
    hitPause: (ticks) => {
      if (!manual) hitPause.request(ticks);
    },
  });
  if (typeof display === 'string') {
    showDisplayMessage(canvas, display);
    return null;
  }
  const transitions = new ShellTransitions({
    ...(opts.transitions !== undefined && { specs: opts.transitions }),
    reduceMotion: opts.reduceMotion ?? prefersReducedMotion(),
  });
  // The scenes draw through the presenter the transitions wrap: it starts the level transition on
  // a new map id and holds the old picture while one closes.
  const shown: BrowserDisplay = {
    ...display,
    presenter: mixedPresenter(
      transitions.presenter(display.presenter, (view) => display.transition?.(view)),
      mixer,
    ),
  };
  let volume: VolumeControl | null = null;
  if (audio) {
    const start = opts.audio?.volumes;
    if (opts.volumeControl === false) audio.setVolumes(loadVolumes(opts.game, start));
    else volume = mountVolumeControl({ game: opts.game, start, audio });
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
  // Picture to client px (gap D13): a display without its own inverse (3D: the canvas is sized to
  // the picture) gets the canvas box's.
  shown.toClient = display.toClient ??= (x, y) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (x / opts.screen.width) * rect.width,
      y: rect.top + (y / opts.screen.height) * rect.height,
    };
  };

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
    shown.fit(layout);
    touch?.applyLayout(layout);
  };
  relayout();
  window.addEventListener('resize', relayout);

  const scenes = new SceneStack();
  const uiSound = (id: string) => mixer?.uiSound(id);
  scenes.push(opts.scene(scenes, shown, { pointer, uiSound }));

  // In manual-loop mode the clock is the steps taken (a pointer's long press counts game steps).
  let hook: PageDebugHook | null = null;
  const loop: FixedLoop = new FixedLoop(
    {
      step() {
        // The mixer runs every loop step, held ones too (a duck releases through a hit-pause).
        mixer?.tick();
        // A closing transition or a hit-pause holds this step: no input frame, no tick; the
        // render still draws the frame. In manual-loop mode transitions play but hold nothing.
        transitions.step();
        if (transitions.closing && !manual) return;
        if (hitPause.hold()) return;
        const before = { top: scenes.top, depth: scenes.depth };
        input.beginFrame();
        pointer?.beginFrame(manual ? loop.steps * loop.stepMs : performance.now());
        const frame = input.player(0);
        if (pointer) frame.addTaps(tapsOf(pointer.gestures()));
        scenes.update([hook ? hook.frame(frame) : frame]);
        mixer?.dialog(scenes.find((s) => s instanceof UiScene && s.dialogShown()) !== undefined);
        transitions.scenes(before, { top: scenes.top, depth: scenes.depth });
      },
      render() {
        display.transition?.(transitions.view());
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
      toClient: (x, y) => display.toClient!(x, y),
      transition: (what) => transitions.start(what),
      mix: () => mixer?.state() ?? null,
    });
    if (record) hook.api.record(true);
    (window as DebugWindow).__ww = hook.api;
  }
  if (manual)
    loop.advance(0); // the first picture, before any step
  else loop.start();
  document.body.dataset.backend = backend;
  return {
    backend,
    display: shown,
    scenes,
    input,
    loop,
    pointer,
    audio,
    mixer,
    uiSound,
    debug: hook?.api ?? null,
    volume,
    hitPause,
    transitions,
    transition: (what, covered) => transitions.start(what, covered),
  };
}

/** The browser's reduced-motion preference (false where it cannot be read). */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    return false;
  }
}

/**
 * The boot's `AudioManager` set up and its `Mixer`: the songs, sfx and layered songs registered,
 * the volumes set, the music waiting.
 */
function shellMixer(audio: AudioManager, opts: BootAudio): Mixer {
  audio.registerSongs([...(opts.songs ?? [])]);
  audio.registerSfx([...(opts.sfx ?? [])]);
  const music = (opts.mix ?? {}) as Readonly<Record<string, MusicEntry>>;
  audio.registerMusic(music);
  if (opts.volumes) audio.setVolumes(opts.volumes);
  const mixer = new Mixer({ audio, music, ...(opts.seed !== undefined && { seed: opts.seed }) });
  if (opts.music !== undefined) mixer.play(opts.music);
  return mixer;
}

/** The presenter with every frame's status handed to the mixer first (none without one). */
function mixedPresenter(presenter: Presenter, mixer: Mixer | null): Presenter {
  if (mixer === null) return presenter;
  return {
    present(frame) {
      mixer.frameStatus(frame.status);
      presenter.present(frame);
    },
    ...(presenter.resize !== undefined && { resize: (size) => presenter.resize!(size) }),
  };
}

/** A step's tap gestures as frame taps (Engine 0.15, gap D1): game screen pixels, the button. */
export function tapsOf(gestures: readonly PointerGesture[]): FrameTap[] {
  const taps: FrameTap[] = [];
  for (const g of gestures) if (g.type === 'tap') taps.push({ x: g.x, y: g.y, button: g.button });
  return taps;
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
