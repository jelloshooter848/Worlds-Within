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
import {
  loadProgress,
  loadSettings,
  loadVolumes,
  storeProgress,
  storeSettings,
  storeVolumes,
  TOUCH_MODES,
  type StoredSettings,
} from '../save/settings';
import type { SheetLookup } from '../assets/sheet-lookup';
import { keyHintMap } from '../input/key-hints';
import { levelChoices, paintUi, type FontLookup, type MenusSpec, type UiFrameSize } from '../ui';
import type { RunStart } from '../headless';
import { GameMenus, type MenuSettingsHost } from './game-menus';
import { SceneStack, type Scene } from '../scene';
import { backendFromQuery, otherBackendLink, type PageBackend } from './backend-choice';
import { PageDebugHook, type MenusView, type PageDebug } from './debug';
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

/** The query value that shows (`title=show`) or skips (`title=skip`) the title screen. */
export const TITLE_QUERY = 'title';

/**
 * Whether a page opens on its title screen (Engine 0.16 T9): yes, unless the page is in
 * manual-loop mode (`?debug=step`) or recording (`?record`), so run files, replays and the
 * browser tests start straight in play; `?title=skip` skips it too and `?title=show` shows it
 * even in manual-loop mode (the menus' own browser tests).
 */
export function titleFromQuery(search: string): boolean {
  const asked = new URLSearchParams(search).get(TITLE_QUERY);
  if (asked === 'show') return true;
  if (asked === 'skip') return false;
  return !manualFromQuery(search) && !recordFromQuery(search);
}

/** The keyboard keys that pause (`KeyboardEvent.code`); gamepad Start (button 9) and the button too. */
export const PAUSE_CODES: readonly string[] = ['Escape', 'KeyP'];
/** The standard gamepad's Start button. */
const PAD_START = 9;

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

/**
 * The game's menus (Engine 0.16 T9): `content.manifest.menus` with the fonts and sprite sheets
 * they draw from, and the game's own hooks for Continue, colour modes and going back to the title.
 */
export interface BootMenus {
  /** `content.manifest.menus`; nothing is shown when it is undefined. */
  spec: MenusSpec | undefined;
  /** The game's font files (`contentFonts(content)`). */
  fonts: FontLookup;
  /** The game's sprite sheets (frame sizes for a logo, art and panels). */
  sheets: SheetLookup;
  /** Whether a save or campaign code exists (the title's Continue shows only then). */
  canContinue?(): boolean;
  /** Continue was chosen: resume the save (the title then closes). */
  onContinue?(): void;
  /** The game's colour modes' names (the settings screen's `colour` item; none: hidden). */
  colourModes?: readonly string[];
  /** The player chose colour mode `index` (also called at boot with the stored one). */
  onColourMode?(index: number): void;
  /**
   * How Back to title starts the game over: `scene` (default) builds the game's first scene again
   * with the boot's `scene` factory; `reload` reloads the page (for a page whose DOM holds on to
   * its first scene).
   */
  restart?: 'scene' | 'reload';
  /**
   * The game's levels in play order (Engine 0.16 part B): `{ id, name }` each (the level header's
   * name, else its id; the platformer kit's `contentStages`). With them the title's `levels` item
   * opens the level select (cleared and locked marks from the player's stored progress,
   * `ww:<game>:progress`), a level chosen starts the scene again with `page.start` at its stage,
   * and the last one's clear opens the end screen. Left out: none of these.
   */
  levels?: readonly { id: string; name: string }[];
}

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
  /**
   * The title screen, pause menu, settings and controls screens (Engine 0.16 T9) from
   * `game.json`'s `menus`, drawn with the display's `uiPainter`. The page opens on the title
   * (unless `titleFromQuery` says to skip it); Escape, P, gamepad Start and the on-screen
   * `#ww-pause` button pause. Left out (or with a display that cannot draw UI), the page plays
   * at once as before.
   */
  menus?: BootMenus;
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
  /**
   * Where the game starts (Engine 0.16 part B): a level chosen in the level select, `{ stage }`
   * (the same start a run file's `start` gives `HeadlessOptions.start`), or null for the game's
   * own start. The scene factory reads it each time it builds the first scene.
   */
  start: RunStart | null;
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
  /** The title, pause and settings menus (Engine 0.16 T9), or null without `menus`. */
  menus: GameMenus | null;
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
  // The menus read every presented frame's status (the level-clear banner and the end screen).
  let menus: GameMenus | null = null;
  const shown: BrowserDisplay = {
    ...display,
    presenter: statusPresenter(
      mixedPresenter(
        transitions.presenter(display.presenter, (view) => display.transition?.(view)),
        mixer,
      ),
      (status) => menus?.frameStatus(status),
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

  // The player's stored presentation settings (Engine 0.16 T9): shake, flashing, colour, touch.
  const settings: StoredSettings = loadSettings(opts.game);
  display.effectSettings?.({ shakeScale: settings.shake, reduceFlashing: settings.reduceFlashing });
  if (settings.colour !== 0) opts.menus?.onColourMode?.(settings.colour);

  const input = new InputManager(1);
  input.addSource('keyboard', new KeyboardSource());
  if (GamepadSource.available()) input.addSource('gamepad', new GamepadSource());
  const touch = opts.touchPad === false ? null : new TouchSource(document.body);
  if (touch) {
    input.addSource('touch', touch);
    touch.show(TouchSource.likelyTouchDevice());
    if (settings.touch !== 'auto') touch.setMode(settings.touch);
  }
  const pointer = opts.pointer ? pointerSource(canvas, display, opts) : null;
  // The menus take taps and the hover even on a page that did not ask for the pointer (Engine 0.16
  // T9); such a page's game never sees them: its taps reach the frame only while a menu shows.
  const menusWanted = opts.menus?.spec !== undefined && display.uiPainter !== undefined;
  const menuPointer = pointer === null && menusWanted ? pointerSource(canvas, display, opts) : null;
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
  const page: BootPage = { pointer, uiSound, start: null };
  scenes.push(opts.scene(scenes, shown, page));

  // The menus (Engine 0.16 T9): the title over the first scene, the pause menu on the pause keys.
  const menuSpec = opts.menus?.spec;
  const uiPainter = display.uiPainter?.bind(display);
  let pauseAsked = false;
  let pauseButton: HTMLButtonElement | null = null;
  if (opts.menus !== undefined && menuSpec !== undefined && uiPainter !== undefined) {
    const boot = opts.menus;
    const save = () => {
      if (opts.game !== undefined) storeSettings(opts.game, settings);
    };
    const host: MenuSettingsHost = {
      values: () => {
        const v = volume?.volumes() ?? loadVolumes(opts.game, opts.audio?.volumes);
        return {
          master: v.master,
          music: v.music,
          sfx: v.sfx,
          muted: v.muted,
          shake: settings.shake,
          reduceFlashing: settings.reduceFlashing,
          colour: settings.colour,
          touch: Math.max(0, TOUCH_MODES.indexOf(settings.touch)),
        };
      },
      change: (item, value) => {
        const tenth = typeof value === 'number' ? value / 10 : 0;
        const sound = (v: Partial<Volumes> & { muted?: boolean }) => {
          if (volume) volume.set(v);
          else {
            const next = { ...loadVolumes(opts.game, opts.audio?.volumes), ...v };
            audio?.setVolumes(next);
            if (opts.game !== undefined) storeVolumes(opts.game, next);
          }
        };
        if (item === 'master') sound({ master: tenth, muted: false });
        else if (item === 'music') sound({ music: tenth });
        else if (item === 'sfx') sound({ sfx: tenth });
        else if (item === 'mute' && typeof value === 'boolean') sound({ muted: value });
        else if (item === 'shake') {
          settings.shake = tenth;
          display.effectSettings?.({ shakeScale: tenth });
        } else if (item === 'flashing' && typeof value === 'boolean') {
          settings.reduceFlashing = value;
          display.effectSettings?.({ reduceFlashing: value });
        } else if (item === 'colour' && typeof value === 'number') {
          settings.colour = value;
          boot.onColourMode?.(value);
        } else if (item === 'touch' && typeof value === 'number') {
          settings.touch = TOUCH_MODES[value] ?? 'auto';
          touch?.setMode(settings.touch);
          relayout();
        } else return;
        save();
      },
    };
    menus = new GameMenus({
      spec: menuSpec,
      stack: scenes,
      screen: opts.screen,
      fonts: boot.fonts,
      frameSize: sheetFrameSize(boot.sheets),
      painter: () => uiPainter(),
      pointer: pointer ?? menuPointer,
      keys: () => keyHintMap(input.bindings[0]?.keyboard),
      settings: host,
      ...(boot.colourModes !== undefined && { colourModes: boot.colourModes }),
      ...(boot.canContinue !== undefined && { canContinue: () => boot.canContinue!() }),
      ...(boot.onContinue !== undefined && { onContinue: () => boot.onContinue!() }),
      onSound: uiSound,
      transition: (what, covered) => transitions.start(what, covered),
      music: (id) => {
        const song = id ?? opts.audio?.music;
        if (song !== undefined) mixer?.play(song);
      },
      restart: () => {
        if (boot.restart === 'reload') {
          window.location.reload();
          return;
        }
        page.start = null;
        scenes.clear();
        scenes.push(opts.scene(scenes, shown, page));
        menus?.showTitle();
      },
      ...(boot.levels !== undefined &&
        boot.levels.length > 0 && {
          levels: () => {
            const cleared = new Set(loadProgress(opts.game).cleared);
            return levelChoices(menuSpec, boot.levels!, cleared);
          },
          startAt: (stage: number) => {
            page.start = { stage };
            scenes.clear();
            scenes.push(opts.scene(scenes, shown, page));
          },
          onCleared: (level: string) => {
            if (opts.game === undefined || !boot.levels!.some((l) => l.id === level)) return;
            const progress = loadProgress(opts.game);
            if (progress.cleared.includes(level)) return;
            storeProgress(opts.game, { cleared: [...progress.cleared, level] });
          },
        }),
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat || !PAUSE_CODES.includes(e.code)) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      pauseAsked = true;
    });
    pauseButton = mountPauseButton(() => (pauseAsked = true));
    if (titleFromQuery(search)) menus.showTitle();
  }
  let padStart = false;
  /** Whether gamepad Start went down since the last step (any pad). */
  const padStartPressed = (): boolean => {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const down = [...pads].some((p) => p?.buttons[PAD_START]?.pressed === true);
    const edge = down && !padStart;
    padStart = down;
    return edge;
  };
  let shownMenu = '';
  const showMenuState = () => {
    const state = menus?.state ?? 'play';
    if (state === shownMenu) return;
    shownMenu = state;
    document.body.dataset.menu = state;
    if (pauseButton) pauseButton.hidden = state !== 'play';
  };
  showMenuState();

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
        const now = manual ? loop.steps * loop.stepMs : performance.now();
        pointer?.beginFrame(now);
        menuPointer?.beginFrame(now);
        const frame = input.player(0);
        if (pointer) frame.addTaps(tapsOf(pointer.gestures()));
        if (menuPointer) {
          const taps = tapsOf(menuPointer.gestures());
          if (menus !== null && menus.state !== 'play') frame.addTaps(taps);
        }
        // The pause key (Escape, P, gamepad Start, the button) takes this step: the scenes do not
        // see its press (Escape is also `start`, which would confirm a menu item).
        if (menus !== null && (padStartPressed() || pauseAsked)) {
          pauseAsked = false;
          menus.pauseKey();
          showMenuState();
          return;
        }
        // A due end screen opens before the scenes step (the game is held under it).
        if (menus?.step()) {
          showMenuState();
          return;
        }
        scenes.update([hook ? hook.frame(frame) : frame]);
        showMenuState();
        mixer?.dialog(scenes.find((s) => s instanceof UiScene && s.dialogShown()) !== undefined);
        transitions.scenes(before, { top: scenes.top, depth: scenes.depth });
      },
      render() {
        display.transition?.(transitions.view());
        // No HUD on the picture under the title or a screen opened from it (Engine 0.16 part C T1).
        display.showHud?.(menus?.hudShown ?? true);
        scenes.render(display.renderer);
        // The level-clear banner (Engine 0.16 part B) over the game, under no scene.
        const banner = menus?.bannerDraws() ?? [];
        if (banner.length > 0 && uiPainter !== undefined) paintUi(banner, uiPainter());
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
      menus: () => (menus === null ? null : menusView(menus)),
    });
    if (record) hook.api.record(true);
    (window as DebugWindow).__ww = hook.api;
  }
  if (manual)
    loop.advance(0); // the first picture, before any step
  else loop.start();
  document.body.dataset.backend = backend;
  return {
    get start() {
      return page.start;
    },
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
    menus,
  };
}

/** What the step hook's `menus()` reads. */
function menusView(menus: GameMenus): MenusView {
  const menu = menus.ui?.menu('main');
  return {
    state: menus.state,
    screen: menus.screen,
    banner: menus.bannerShown,
    focused: menu?.focused ?? null,
    items: (menu?.items ?? []).map((item) => ({
      id: item.id,
      value: menu!.value(item.id) ?? null,
      ...menu!.itemBox(item.id)!,
    })),
  };
}

/** Sprite frame sizes from the game's sheets (a logo, title art, a nine-slice panel). */
function sheetFrameSize(sheets: SheetLookup): UiFrameSize {
  return (sheet, palette, frame) => {
    const rect = sheets(sheet, palette)?.frames.get(frame);
    return rect === undefined ? null : { w: rect.w, h: rect.h };
  };
}

/** The pause button's id: the on-screen way to pause (touch, mouse). */
export const PAUSE_BUTTON_ID = 'ww-pause';

const PAUSE_STYLE = `
#ww-pause { position: fixed; top: 40px; right: 4px; z-index: 20; min-width: 44px; min-height: 32px;
  padding: 0 8px; border: 1px solid #666; border-radius: 4px; background: rgba(0, 0, 0, 0.55);
  color: #fff; font: bold 14px/1 system-ui, sans-serif; letter-spacing: 1px; touch-action: manipulation; }
#ww-pause[hidden] { display: none; }
`;

/**
 * The on-screen pause button (fixed at the top right, under the volume control), shown in play
 * only; it never keeps the focus.
 */
function mountPauseButton(onPress: () => void): HTMLButtonElement {
  const style = document.createElement('style');
  style.textContent = PAUSE_STYLE;
  document.head.append(style);
  const button = document.createElement('button');
  button.type = 'button';
  button.id = PAUSE_BUTTON_ID;
  button.textContent = 'II';
  button.title = 'Pause (Esc, P)';
  button.setAttribute('aria-label', 'Pause');
  button.addEventListener('pointerdown', (e) => e.preventDefault());
  button.addEventListener('click', () => {
    onPress();
    button.blur();
  });
  document.body.append(button);
  return button;
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

/** The presenter with every frame's status handed to `read` first (the menus' banner and end screen). */
function statusPresenter(
  presenter: Presenter,
  read: (status: DeepReadonly<Record<string, string | number | boolean>>) => void,
): Presenter {
  return {
    present(frame) {
      read(frame.status);
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
