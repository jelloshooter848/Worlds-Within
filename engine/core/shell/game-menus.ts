import type { TransitionRequest } from './transitions';
import type { Action } from '../input/actions';
import type { Renderer } from '../gfx/renderer';
import type { SceneStack } from '../scene';
import {
  clearScreen,
  controlsScreen,
  DEFAULT_STAT_LINES,
  endScreen,
  levelItemStage,
  levelsScreen,
  pauseScreen,
  settingsScreen,
  titleScreen,
  UiScreen,
  type FontLookup,
  type LevelChoice,
  type StatValues,
  type UiDraw,
  type MenuBuildContext,
  type MenuSettingsValues,
  type MenusSpec,
  type UiEvent,
  type UiFrameSize,
  type UiPainter,
  type UiPoint,
  type UiScreenFile,
} from '../ui';
import { UiScene } from './ui-scene';

/**
 * A game's title screen, pause menu, settings and controls screens (Engine 0.16 T9), built from
 * `game.json`'s `menus` (`engine/core/ui/menus.ts`) and run as `UiScene`s on the page's scene
 * stack. The title sits over the game's first scene, which does not step until Start (its picture
 * at tick 0 is the title's background); the pause menu sits over whatever plays, so the game's
 * ticks are held while it shows (the stack steps only its top scene). Settings and controls take
 * the place of the menu they were opened from and give it back on Back. Menu scenes play no
 * screen transition when pushed or popped (`transitionSlot: null`); Start and Back to title cover
 * the change with the game's `default` transition. Everything here is the page's presentation
 * state: no kit, frame or hash ever sees it. Pure (on `PURE_CORE`): the boot hands it the DOM's
 * side as callbacks.
 *
 * Engine 0.16 part B (T3): the level select (the title's `levels` item, `menus.levels`: the
 * page's levels by name with cleared and locked marks; choosing one starts the game at that stage
 * under the `default` transition, through `startAt`), the level-clear banner (`menus.clear`: drawn
 * over the game, never on the stack, while a frame's status says `cleared` on a level that is not
 * the last, so the kit's pause between levels goes on under it) and the end screen (`menus.end`:
 * pushed once a frame says the last level is cleared, holding the game, with the stats summed over
 * the levels cleared since the game started). {@link GameMenus.frameStatus} reads every presented
 * frame's status; nothing it does reaches the game.
 */

/** What the menus show now: the title (or a screen opened from it), the pause menu, the end screen, or nothing. */
export type MenusState = 'title' | 'pause' | 'end' | 'play';

/** The page side of the settings screen: the values it opens with and where changes go. */
export interface MenuSettingsHost {
  values(): MenuSettingsValues;
  /** A slider or toggle changed (`master`, `music`, `sfx`, `shake` in tenths; toggles as booleans). */
  change(item: string, value: number | boolean): void;
}

export interface GameMenusOptions {
  spec: MenusSpec;
  stack: SceneStack;
  screen: { width: number; height: number };
  fonts: FontLookup;
  frameSize: UiFrameSize;
  /** The backend's UI painter for a renderer (`BrowserDisplay.uiPainter`). */
  painter(r: Renderer): UiPainter;
  /** The hovering mouse (the boot's pointer), or null. */
  pointer?: { cursor(): UiPoint | null } | null;
  /** The player's key names by action, for the hints and the controls screen. */
  keys(): Partial<Record<Action, string>>;
  settings: MenuSettingsHost;
  /** The colour modes' names when the game has them (the settings screen's `colour` item). */
  colourModes?: readonly string[];
  /** Whether a save or campaign code exists (the title's `continue` item shows only then). */
  canContinue?(): boolean;
  /** Continue was chosen: the game resumes its save (called before the title closes). */
  onContinue?(): void;
  /** A UI sound (the mixer's ui bus). */
  onSound?(id: string): void;
  /** Plays a transition, running `covered` once the picture is covered (at once when none plays). */
  transition(what: TransitionRequest, covered: () => void): boolean;
  /** The title's music starts (`id`), or the game's comes back (null). */
  music?(id: string | null): void;
  /** Back to title: the game starts over, then the title shows again (the boot rebuilds the scene). */
  restart(): void;
  /**
   * The game's levels in play order with the player's progress (Engine 0.16 part B): the level
   * select lists them, and the last one's clear opens the end screen. None: no level select.
   */
  levels?(): readonly LevelChoice[];
  /** A level was chosen in the level select: the game starts over at that stage (under the `default` transition). */
  startAt?(stage: number): void;
  /** A frame said a level was cleared (its id): the page keeps the progress. */
  onCleared?(level: string): void;
}

type Screen = 'title' | 'pause' | 'settings' | 'controls' | 'levels' | 'end';
type Base = 'title' | 'pause' | 'end';

export class GameMenus {
  /** The menu scenes on the stack, bottom first, with the screen each shows. */
  private readonly open: { scene: UiScene; screen: Screen }[] = [];
  /** The screen settings, controls or the level select were opened from, to go back to. */
  private from: Base = 'title';
  /** The level-clear banner while it shows (never on the stack), or null. */
  private banner: UiScreen | null = null;
  /** The level and outcome of the last frame read, for the edge to `cleared`. */
  private last: { level: string; outcome: string } | null = null;
  /** The status values summed over the levels cleared since the game started (the end screen's). */
  private sums: Record<string, number> = {};
  /** The last cleared frame's status, for keys not summed (an `of`). */
  private lastCleared: StatValues = {};
  /** The last level was cleared: the end screen opens on the next step. */
  private endDue = false;
  /** Every event of every menu, in order (for tests and page hooks). */
  readonly events: { screen: Screen; event: UiEvent }[] = [];
  private busy = false;

  constructor(private readonly opts: GameMenusOptions) {}

  get spec(): MenusSpec {
    return this.opts.spec;
  }

  /** What shows now. */
  get state(): MenusState {
    const bottom = this.open[0];
    if (bottom === undefined) return 'play';
    return bottom.screen === 'title' || bottom.screen === 'pause' || bottom.screen === 'end'
      ? bottom.screen
      : this.from;
  }

  /** The screen on top (`title`, `pause`, `settings`, `controls`), or null in play. */
  get screen(): Screen | null {
    return this.open[this.open.length - 1]?.screen ?? null;
  }

  /** The UI screen on top, or null in play. */
  get ui(): UiScreen | null {
    return this.open[this.open.length - 1]?.scene.ui ?? null;
  }

  private context(): MenuBuildContext {
    return {
      screen: this.opts.screen,
      fonts: this.opts.fonts,
      frameSize: this.opts.frameSize,
      keys: this.opts.keys(),
    };
  }

  private file(screen: Screen): UiScreenFile {
    const { spec } = this.opts;
    const ctx = this.context();
    switch (screen) {
      case 'title':
        return titleScreen(spec, ctx, {
          canContinue: this.opts.canContinue?.() ?? false,
          hasLevels: (this.opts.levels?.().length ?? 0) > 0,
        });
      case 'levels':
        return levelsScreen(spec, ctx, this.opts.levels?.() ?? []);
      case 'end':
        return endScreen(spec, ctx, this.endStatus());
      case 'pause':
        return pauseScreen(spec, ctx);
      case 'settings':
        return settingsScreen(spec, ctx, this.opts.settings.values(), {
          ...(this.opts.colourModes !== undefined && { colourModes: this.opts.colourModes }),
        });
      case 'controls':
        return controlsScreen(spec, ctx);
    }
  }

  private push(screen: Screen, focus?: string): void {
    const ui = new UiScreen(this.file(screen), {
      screen: this.opts.screen,
      fonts: this.opts.fonts,
      frameSize: this.opts.frameSize,
      ...(this.opts.onSound !== undefined && { onSound: this.opts.onSound }),
    });
    if (focus !== undefined) ui.menu('main')?.focus(focus);
    const scene = new UiScene({
      ui,
      painter: (r) => this.opts.painter(r),
      pointer: this.opts.pointer ?? null,
      transitionSlot: null,
      onEvent: (event, s) => {
        if (this.open[this.open.length - 1]?.scene !== s) return;
        this.events.push({ screen, event });
        this.handle(screen, event);
      },
    });
    this.opts.stack.push(scene);
    this.open.push({ scene, screen });
  }

  private pop(): void {
    const top = this.open.pop();
    if (top !== undefined && this.opts.stack.top === top.scene) this.opts.stack.pop();
  }

  private closeAll(): void {
    while (this.open.length > 0) this.pop();
  }

  /** Puts the title over the game's first scene (its music too). */
  showTitle(): void {
    this.closeAll();
    this.newGame();
    this.from = 'title';
    this.push('title');
    if (this.opts.spec.title.music !== undefined) this.opts.music?.(this.opts.spec.title.music);
  }

  /** Opens the pause menu over the game; false on the title or when already paused. */
  pause(): boolean {
    if (this.open.length > 0 || this.busy) return false;
    this.from = 'pause';
    this.push('pause');
    return true;
  }

  /** Closes the pause menu or the end screen (and any screen opened from it): the game steps again. */
  resume(): void {
    if (this.state !== 'pause' && this.state !== 'end') return;
    this.closeAll();
  }

  /**
   * The pause key (Escape, P, gamepad Start, the on-screen button): in play it pauses; on a
   * settings or controls screen it goes back; on the pause menu it resumes; on the title it does
   * nothing more. Returns whether it did anything.
   */
  pauseKey(): boolean {
    if (this.busy) return false;
    const top = this.screen;
    if (top === null) return this.pause();
    if (top === 'settings' || top === 'controls' || top === 'levels') {
      this.back(top);
      return true;
    }
    if (top === 'pause') {
      this.resume();
      return true;
    }
    return false;
  }

  /** Starts the game from the title (the title closes under the `default` transition). */
  start(): void {
    if (this.state !== 'title' || this.busy) return;
    this.busy = true;
    this.opts.transition('default', () => {
      this.busy = false;
      this.closeAll();
      if (this.opts.spec.title.music !== undefined) this.opts.music?.(null);
    });
  }

  /** Back to title: the game starts over (the boot rebuilds it) and the title shows. */
  toTitle(): void {
    if (this.busy) return;
    this.busy = true;
    this.opts.transition('default', () => {
      this.busy = false;
      this.open.length = 0;
      this.opts.restart();
    });
  }

  /** Starts the game over at a stage from the level select (the menus close under the `default` transition). */
  startAt(stage: number): void {
    if (this.busy || this.opts.startAt === undefined) return;
    this.busy = true;
    this.opts.transition('default', () => {
      this.busy = false;
      this.closeAll();
      this.newGame();
      if (this.opts.spec.title.music !== undefined || this.opts.spec.end?.music !== undefined)
        this.opts.music?.(null);
      this.opts.startAt!(stage);
    });
  }

  private sub(screen: 'settings' | 'controls' | 'levels'): void {
    const from = this.screen;
    if (from !== 'title' && from !== 'pause' && from !== 'end') return;
    this.from = from;
    this.pop();
    this.push(screen);
  }

  private back(screen: 'settings' | 'controls' | 'levels'): void {
    this.pop();
    this.push(this.from, screen);
  }

  /** Forgets the play's sums and the banner: a new game starts (the title, a level chosen). */
  private newGame(): void {
    this.sums = {};
    this.lastCleared = {};
    this.last = null;
    this.endDue = false;
    this.banner = null;
  }

  /** The end screen's values: the summed numbers over the last cleared frame's status. */
  private endStatus(): StatValues {
    return { ...this.lastCleared, ...this.sums };
  }

  /**
   * A presented frame's status (the boot calls it for every frame the scenes present): on the
   * frame a level turns `cleared`, its progress is kept (`onCleared`), the stat lines' numbers are
   * summed, and either the end screen is due (the page's last level, with `menus.end`) or the
   * level-clear banner shows (`menus.clear`) until a frame is no longer `cleared`.
   */
  frameStatus(status: StatValues): void {
    const level = String(status['level'] ?? '');
    const outcome = String(status['outcome'] ?? '');
    const was = this.last;
    this.last = { level, outcome };
    if (outcome !== 'cleared') {
      this.banner = null;
      return;
    }
    if (was !== null && was.outcome === 'cleared' && was.level === level) return;
    this.banner = null;
    this.opts.onCleared?.(level);
    const lines = this.opts.spec.end?.lines ?? DEFAULT_STAT_LINES;
    for (const line of lines) {
      const v = status[line.status];
      if (typeof v === 'number') this.sums[line.status] = (this.sums[line.status] ?? 0) + v;
    }
    this.lastCleared = { ...status };
    const levels = this.opts.levels?.() ?? [];
    const lastLevel = levels.length > 0 && levels[levels.length - 1]!.id === level;
    if (lastLevel && this.opts.spec.end !== undefined) {
      this.endDue = true;
      return;
    }
    if (this.opts.spec.clear !== undefined) {
      this.banner = new UiScreen(clearScreen(this.opts.spec, this.context(), status), {
        screen: this.opts.screen,
        fonts: this.opts.fonts,
        frameSize: this.opts.frameSize,
      });
    }
  }

  /**
   * One loop step, before the scenes update: the banner's clock goes on, and a due end screen
   * opens (in play only). Returns whether the end screen opened.
   */
  step(): boolean {
    this.banner?.update({ commands: [], taps: [], pointer: null });
    if (!this.endDue || this.open.length > 0 || this.busy) return false;
    this.endDue = false;
    this.banner = null;
    this.from = 'end';
    this.push('end');
    if (this.opts.spec.end?.music !== undefined) this.opts.music?.(this.opts.spec.end.music);
    return true;
  }

  /** The level-clear banner's draw items (empty unless it shows in play). */
  bannerDraws(): UiDraw[] {
    return this.banner === null || this.open.length > 0 ? [] : this.banner.draws();
  }

  /** Whether the level-clear banner shows. */
  get bannerShown(): boolean {
    return this.banner !== null && this.open.length === 0;
  }

  private handle(screen: Screen, e: UiEvent): void {
    if (screen === 'settings' && e.type === 'change' && typeof e.item === 'string')
      this.opts.settings.change(e.item, e.value);
    const item = e.type === 'activate' ? e.item : null;
    if (screen === 'title') {
      if (item === 'start') this.start();
      else if (item === 'continue') {
        this.opts.onContinue?.();
        this.start();
      } else if (item === 'settings' || item === 'controls' || item === 'levels') this.sub(item);
      return;
    }
    if (screen === 'end') {
      if (item === 'title') this.toTitle();
      else if (item === 'levels') this.sub('levels');
      return;
    }
    if (screen === 'levels') {
      const stage = levelItemStage(item);
      if (stage !== null) this.startAt(stage);
      else if (item === 'back' || e.type === 'back') this.back(screen);
      return;
    }
    if (screen === 'pause') {
      if (item === 'resume' || e.type === 'back') this.resume();
      else if (item === 'title') this.toTitle();
      else if (item === 'settings' || item === 'controls') this.sub(item);
      return;
    }
    if (item === 'back' || e.type === 'back') this.back(screen);
  }
}
