import type { Renderer } from '../gfx/renderer';
import { frameTaps, type InputFrame } from '../input/input-manager';
import type { Scene } from '../scene';
import type { TransitionSlot } from '../fx/transition';
import {
  paintUi,
  UiNav,
  type UiEvent,
  type UiKeys,
  type UiPainter,
  type UiPoint,
  type UiScreen,
} from '../ui';

/**
 * A UI screen as a scene (Engine 0.16 T7): the shell's side of the UI kit. Each loop step it
 * turns player 1's frame into the screen's input: commands from the actions (keyboard and gamepad
 * through the player's bindings, `UiNav`, held directions repeating), the frame's taps (mouse
 * clicks and touch taps, already in picture pixels: the boot's pointer maps them through the
 * display's `toScreen`, the inverse of `toClient`) and the mouse's hover (`pointer.cursor()`).
 * It draws the screen over the scene below (translucent by default) through the backend's
 * `UiPainter`. The screen's state lives here, in the page: never in a kit, a frame or a hash.
 * Pure (on `PURE_CORE`).
 */
export interface UiSceneOptions {
  ui: UiScreen;
  /** The backend's painter for a renderer (`new CanvasUiPainter(r, sheets, fonts)` in 2D), made once per renderer. */
  painter(r: Renderer): UiPainter;
  /** The hovering mouse (the boot's `page.pointer`), or null. */
  pointer?: { cursor(): UiPoint | null } | null;
  /** The actions per command (default `DEFAULT_UI_KEYS`). */
  keys?: UiKeys;
  /** Each event the screen reports, in order, with the scene (to pop it, or start the game). */
  onEvent?(event: UiEvent, scene: UiScene): void;
  /** Draws over the scene below (default true). */
  translucent?: boolean;
  transitionSlot?: TransitionSlot;
}

export class UiScene implements Scene {
  readonly translucent: boolean;
  readonly transitionSlot?: TransitionSlot;
  private readonly nav: UiNav;
  private painted: { r: Renderer; painter: UiPainter } | null = null;
  /** The events of the last step (for tests and page hooks). */
  last: UiEvent[] = [];

  constructor(private readonly opts: UiSceneOptions) {
    this.nav = new UiNav(opts.keys);
    this.translucent = opts.translucent ?? true;
    if (opts.transitionSlot !== undefined) this.transitionSlot = opts.transitionSlot;
  }

  get ui(): UiScreen {
    return this.opts.ui;
  }

  update(input: InputFrame): void {
    const commands = this.nav.commands(input);
    const taps = frameTaps(input).map((t) => ({ x: t.x, y: t.y }));
    const pointer = this.opts.pointer?.cursor() ?? null;
    this.last = this.opts.ui.update({ commands, taps, pointer });
    for (const e of this.last) this.opts.onEvent?.(e, this);
  }

  render(r: Renderer): void {
    if (this.painted?.r !== r) this.painted = { r, painter: this.opts.painter(r) };
    paintUi(this.opts.ui.draws(), this.painted.painter);
  }
}
