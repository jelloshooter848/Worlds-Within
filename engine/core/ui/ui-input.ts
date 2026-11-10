import type { Action } from '../input/actions';
import type { Box } from './nine-slice';

/**
 * Input for the UI kit from every device (Engine 0.16 T7). Keyboard and gamepad arrive as the
 * engine's actions (the player's bindings already applied), so the UI never reads a key; the
 * mouse and touch arrive as a hover point and taps, in picture pixels (the shell maps client
 * points through the display's `toScreen`, the inverse of `toClient`). Pure.
 */

/** What the UI does: move the focus, change a value, take an item, or back out. */
export const UI_COMMANDS = ['up', 'down', 'left', 'right', 'confirm', 'back'] as const;
export type UiCommand = (typeof UI_COMMANDS)[number];

/** The actions that give each command. */
export type UiKeys = Readonly<Record<UiCommand, readonly Action[]>>;

/**
 * The default: the arrows (d-pad, stick) move; `jump` (Z, Space, pad A) and `start` (Enter, pad
 * Start) take; `attack` (X, pad X) backs out.
 */
export const DEFAULT_UI_KEYS: UiKeys = {
  up: ['up'],
  down: ['down'],
  left: ['left'],
  right: ['right'],
  confirm: ['jump', 'start'],
  back: ['attack'],
};

/** The part of an `InputFrame` the UI reads. */
export interface UiActions {
  pressed(a: Action): boolean;
  held(a: Action): boolean;
}

/** A point on the picture (game pixels). */
export interface UiPoint {
  x: number;
  y: number;
}

/** One display frame's UI input: commands (from actions), and the pointer's hover and taps. */
export interface UiInput {
  /** This frame's commands, in `UI_COMMANDS` order (`UiNav.commands`). */
  commands?: readonly UiCommand[];
  /** Where the mouse hovers, or null (none, or a touch screen). */
  pointer?: UiPoint | null;
  /** Clicks and taps this frame, in order. */
  taps?: readonly UiPoint[];
}

/** Frames a held direction waits before it repeats, then frames between repeats. */
export const UI_REPEAT_DELAY = 18;
export const UI_REPEAT_EVERY = 5;

/**
 * Commands from actions, one call per display frame: a press gives its command once, and a
 * direction held repeats after `UI_REPEAT_DELAY` frames every `UI_REPEAT_EVERY` (a slider dragged
 * along by a held stick). `confirm` and `back` never repeat.
 */
export class UiNav {
  private readonly heldFor = new Map<UiCommand, number>();

  constructor(private readonly keys: UiKeys = DEFAULT_UI_KEYS) {}

  commands(actions: UiActions): UiCommand[] {
    const out: UiCommand[] = [];
    for (const cmd of UI_COMMANDS) {
      const acts = this.keys[cmd];
      if (acts.some((a) => actions.pressed(a))) {
        out.push(cmd);
        this.heldFor.set(cmd, 0);
        continue;
      }
      if (!acts.some((a) => actions.held(a))) {
        this.heldFor.delete(cmd);
        continue;
      }
      const n = (this.heldFor.get(cmd) ?? 0) + 1;
      this.heldFor.set(cmd, n);
      const repeats = cmd !== 'confirm' && cmd !== 'back';
      if (repeats && n >= UI_REPEAT_DELAY && (n - UI_REPEAT_DELAY) % UI_REPEAT_EVERY === 0) out.push(cmd);
    }
    return out;
  }
}

/** Whether `p` is inside `box` (left and top edges in, right and bottom out). */
export function inBox(box: Box, p: UiPoint): boolean {
  return p.x >= box.x && p.y >= box.y && p.x < box.x + box.w && p.y < box.y + box.h;
}

/**
 * What a widget reports (the shell plays the style's sounds for them and the game reacts):
 * `focus` (an item took the focus), `activate` (a button or item taken), `change` (a slider's or
 * toggle's new value), `choice` (a dialog choice taken), `page` (a dialog turned a page), `type`
 * (a dialog typed `typeEvery` more characters), `skip` (a dialog's page shown whole at once),
 * `done` (a dialog finished), `open` / `close` (a widget shown or hidden), `back`.
 */
export type UiEvent =
  | { type: 'focus'; widget: string; item?: string }
  | { type: 'activate'; widget: string; item?: string }
  | { type: 'change'; widget: string; item: string; value: number | boolean }
  | { type: 'choice'; widget: string; item: string }
  | { type: 'page'; widget: string; page: number }
  | { type: 'type'; widget: string }
  | { type: 'skip'; widget: string }
  | { type: 'done'; widget: string }
  | { type: 'open'; widget: string }
  | { type: 'close'; widget: string }
  | { type: 'back'; widget: string };
