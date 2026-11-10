import type { Box } from './nine-slice';
import type { UiDraw } from './paint';
import { measureLine } from './text';
import { inBox, type UiEvent, type UiInput, type UiPoint } from './ui-input';
import type { UiMenuItemSpec } from './ui-schema';
import { ItemTweens, lookPanel, lookText, panelContent, panelExtra, tweenDraws, type UiLook } from './look';

/**
 * Menus and buttons (Engine 0.16 T7): a list of items laid out vertically or horizontally, each a
 * button, a slider or a toggle, with one focused item. Focus moves by commands (keyboard and
 * gamepad through the actions), by the hovering mouse and by taps; it skips disabled items and
 * wraps at the ends unless told not to. A slider steps with left and right (up and down in a
 * horizontal menu) or jumps to where its track is tapped; a toggle flips on confirm, sideways or a
 * tap. Focus and press play the style's tweens on the item. Everything is presentation state,
 * stepped once per display frame: nothing here reaches a kit, a frame or a hash. Pure.
 */

export type MenuDirection = 'vertical' | 'horizontal';

export interface MenuOptions {
  /** The widget id events carry. */
  id: string;
  items: readonly UiMenuItemSpec[];
  direction?: MenuDirection;
  /** Focus wraps from one end to the other (default true). */
  wrap?: boolean;
  /** Drawn on a panel (default true). */
  panel?: boolean;
}

/** Px of a slider's track when the item has room. */
export const SLIDER_TRACK = 32;
/** Px between an item's label and its value part. */
const VALUE_GAP = 6;

type Value = number | boolean;

function sliderRange(item: Extract<UiMenuItemSpec, { type: 'slider' }>) {
  const min = item.min ?? 0;
  const max = Math.max(min, item.max ?? 10);
  return { min, max, step: item.step ?? 1 };
}

/** What a slider shows for `v`: its word from `labels` (by step from `min`), else the number. */
export function sliderText(item: Extract<UiMenuItemSpec, { type: 'slider' }>, v: number): string {
  if (item.labels === undefined) return String(v);
  const { min, step } = sliderRange(item);
  const i = Math.round((v - min) / step);
  return item.labels[Math.min(item.labels.length - 1, Math.max(0, i))] ?? String(v);
}

/** A slider word as a choice shows it: `< Auto >`. */
function choiceText(word: string): string {
  return `< ${word} >`;
}

/** `v` clamped into the slider's range and snapped to its steps from `min`. */
export function sliderValue(item: Extract<UiMenuItemSpec, { type: 'slider' }>, v: number): number {
  const { min, max, step } = sliderRange(item);
  const snapped = min + Math.round((v - min) / step) * step;
  // Rounded to the step's decimals, so 0.1 steps do not drift.
  const places = (String(step).split('.')[1] ?? '').length;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(places))));
}

export class Menu {
  readonly id: string;
  readonly direction: MenuDirection;
  readonly wrap: boolean;
  readonly panel: boolean;
  /** The menu's whole box on the picture (set by `place`). */
  box: Box = { x: 0, y: 0, w: 0, h: 0 };
  private focusIndex: number;
  private readonly values = new Map<string, Value>();
  private readonly tweens: ItemTweens[];
  private lastPointer: UiPoint | null = null;

  constructor(
    private readonly opts: MenuOptions,
    private readonly look: UiLook,
  ) {
    this.id = opts.id;
    this.direction = opts.direction ?? 'vertical';
    this.wrap = opts.wrap ?? true;
    this.panel = opts.panel ?? true;
    for (const item of opts.items) {
      if (item.type === 'slider')
        this.values.set(item.id, sliderValue(item, item.value ?? sliderRange(item).min));
      if (item.type === 'toggle') this.values.set(item.id, item.value ?? false);
    }
    this.tweens = opts.items.map(() => new ItemTweens());
    this.focusIndex = opts.items.findIndex((i) => i.disabled !== true);
  }

  get items(): readonly UiMenuItemSpec[] {
    return this.opts.items;
  }

  /** The focused item's id, or null when every item is disabled. */
  get focused(): string | null {
    return this.opts.items[this.focusIndex]?.id ?? null;
  }

  /** A slider's or toggle's value (undefined for a button or an unknown id). */
  value(id: string): Value | undefined {
    return this.values.get(id);
  }

  /** Sets a slider (clamped and snapped) or a toggle; false for a button or an unknown id. */
  setValue(id: string, v: Value): boolean {
    const item = this.opts.items.find((i) => i.id === id);
    if (item?.type === 'slider' && typeof v === 'number') this.values.set(id, sliderValue(item, v));
    else if (item?.type === 'toggle' && typeof v === 'boolean') this.values.set(id, v);
    else return false;
    return true;
  }

  /** Moves the focus to an enabled item by id (false when there is none). */
  focus(id: string, frame = 0): boolean {
    const i = this.opts.items.findIndex((it) => it.id === id);
    if (i < 0 || this.opts.items[i]!.disabled === true) return false;
    if (i !== this.focusIndex) this.tweens[i]!.play(this.look.focusTween, frame);
    this.focusIndex = i;
    return true;
  }

  // ---- Layout ----

  private rowHeight(): number {
    return this.look.font.cell.h + 2;
  }

  private cursorWidth(): number {
    const c = this.look.style.cursor;
    return c === undefined ? 0 : measureLine(this.look.font, c) + 2;
  }

  private valueWidth(item: UiMenuItemSpec): number {
    const font = this.look.font;
    if (item.type === 'slider') {
      if (item.labels !== undefined)
        return Math.max(...item.labels.map((t) => measureLine(font, choiceText(t))));
      const { min, max } = sliderRange(item);
      return SLIDER_TRACK + 3 + Math.max(measureLine(font, String(min)), measureLine(font, String(max)));
    }
    if (item.type === 'toggle') return this.toggleBox() + 3 + measureLine(font, 'Off');
    return 0;
  }

  private toggleBox(): number {
    return Math.max(3, this.look.font.cell.h - 2);
  }

  private itemWidth(item: UiMenuItemSpec): number {
    const value = this.valueWidth(item);
    return (
      this.cursorWidth() + measureLine(this.look.font, item.label) + (value > 0 ? VALUE_GAP + value : 0) + 2
    );
  }

  /** The size the menu wants: its items, the gaps and (on a panel) the frame and padding. */
  size(): { w: number; h: number } {
    const items = this.opts.items;
    const gap = this.look.gap;
    const extra = this.panel ? panelExtra(this.look) : { w: 0, h: 0 };
    if (this.direction === 'vertical') {
      const w = Math.max(...items.map((i) => this.itemWidth(i)));
      return { w: w + extra.w, h: items.length * this.rowHeight() + (items.length - 1) * gap + extra.h };
    }
    const w = items.reduce((sum, i) => sum + this.itemWidth(i), 0) + (items.length - 1) * gap;
    return { w: w + extra.w, h: this.rowHeight() + extra.h };
  }

  /** Puts the menu at `box` (its whole box, panel included). */
  place(box: Box): void {
    this.box = { ...box };
  }

  /** The box items are laid out in. */
  content(): Box {
    return this.panel ? panelContent(this.look, this.box) : { ...this.box };
  }

  /** Each item's box on the picture, in item order. */
  itemBoxes(): Box[] {
    const c = this.content();
    const gap = this.look.gap;
    const rh = this.rowHeight();
    if (this.direction === 'vertical')
      return this.opts.items.map((_, i) => ({ x: c.x, y: c.y + i * (rh + gap), w: c.w, h: rh }));
    let x = c.x;
    return this.opts.items.map((item) => {
      const w = this.itemWidth(item);
      const box = { x, y: c.y, w, h: rh };
      x += w + gap;
      return box;
    });
  }

  /** An item's box by id (undefined for an unknown id). */
  itemBox(id: string): Box | undefined {
    const i = this.opts.items.findIndex((it) => it.id === id);
    return i < 0 ? undefined : this.itemBoxes()[i];
  }

  /** A slider's track inside its item box. */
  private trackBox(item: UiMenuItemSpec, box: Box): Box {
    const value = this.valueWidth(item);
    const x = box.x + box.w - 1 - value;
    const h = 4;
    return { x, y: box.y + Math.floor((box.h - h) / 2), w: SLIDER_TRACK, h };
  }

  // ---- Input ----

  /**
   * One display frame: the hovering pointer (when it moved) focuses the item under it, each tap
   * on an enabled item focuses and takes it, then the commands move, change or take. Returns
   * what happened, in order.
   */
  update(input: UiInput, frame: number): UiEvent[] {
    const out: UiEvent[] = [];
    const p = input.pointer ?? null;
    const moved =
      p !== null && (this.lastPointer === null || p.x !== this.lastPointer.x || p.y !== this.lastPointer.y);
    this.lastPointer = p;
    if (moved) {
      const i = this.itemAt(p);
      if (i >= 0 && i !== this.focusIndex) this.moveTo(i, frame, out);
    }
    for (const tap of input.taps ?? []) this.tap(tap, frame, out);
    for (const cmd of input.commands ?? []) this.command(cmd, frame, out);
    return out;
  }

  /** The index of the enabled item at `p`, or -1. */
  itemAt(p: UiPoint): number {
    const boxes = this.itemBoxes();
    return this.opts.items.findIndex((it, i) => it.disabled !== true && inBox(boxes[i]!, p));
  }

  private moveTo(i: number, frame: number, out: UiEvent[]): void {
    this.focusIndex = i;
    this.tweens[i]!.play(this.look.focusTween, frame);
    out.push({ type: 'focus', widget: this.id, item: this.opts.items[i]!.id });
  }

  private tap(p: UiPoint, frame: number, out: UiEvent[]): void {
    const i = this.itemAt(p);
    if (i < 0) return;
    if (i !== this.focusIndex) this.moveTo(i, frame, out);
    const item = this.opts.items[i]!;
    if (item.type === 'slider' && item.labels !== undefined) {
      this.cycle(item, out);
      return;
    }
    if (item.type === 'slider') {
      const track = this.trackBox(item, this.itemBoxes()[i]!);
      if (p.x < track.x - 1 || p.x > track.x + track.w) return;
      const { min, max } = sliderRange(item);
      const t = Math.min(1, Math.max(0, (p.x - track.x) / Math.max(1, track.w - 1)));
      this.change(item.id, sliderValue(item, min + t * (max - min)), out);
      return;
    }
    this.take(frame, out);
  }

  /** Moves the focus `step` items on, skipping disabled ones, wrapping or stopping at the ends. */
  private step(step: 1 | -1, frame: number, out: UiEvent[]): void {
    const n = this.opts.items.length;
    let i = this.focusIndex;
    for (let k = 0; k < n; k++) {
      i += step;
      if (i < 0 || i >= n) {
        if (!this.wrap) return;
        i = (i + n) % n;
      }
      if (this.opts.items[i]!.disabled !== true) break;
    }
    if (i !== this.focusIndex && this.opts.items[i]!.disabled !== true) this.moveTo(i, frame, out);
  }

  /** A slider with words steps on, back to `min` after `max` (a tap or confirm on it). */
  private cycle(item: Extract<UiMenuItemSpec, { type: 'slider' }>, out: UiEvent[]): void {
    const { min, max, step } = sliderRange(item);
    const v = this.values.get(item.id) as number;
    this.change(item.id, v + step > max ? min : sliderValue(item, v + step), out);
  }

  private change(id: string, value: Value, out: UiEvent[]): void {
    if (this.values.get(id) === value) return;
    this.values.set(id, value);
    out.push({ type: 'change', widget: this.id, item: id, value });
  }

  /** Steps the focused slider by `dir` steps or flips the focused toggle; false for a button. */
  private adjust(dir: 1 | -1, out: UiEvent[]): boolean {
    const item = this.opts.items[this.focusIndex];
    if (item?.type === 'slider') {
      const v = this.values.get(item.id) as number;
      this.change(item.id, sliderValue(item, v + dir * sliderRange(item).step), out);
      return true;
    }
    if (item?.type === 'toggle') {
      this.change(item.id, !(this.values.get(item.id) as boolean), out);
      return true;
    }
    return false;
  }

  /** Takes the focused item: a button activates, a toggle flips (a slider does nothing). */
  private take(frame: number, out: UiEvent[]): void {
    const item = this.opts.items[this.focusIndex];
    if (item === undefined || item.disabled === true) return;
    this.tweens[this.focusIndex]!.play(this.look.pressTween, frame);
    if (item.type === 'toggle') this.adjust(1, out);
    else if (item.type === 'slider' && item.labels !== undefined) this.cycle(item, out);
    else if (item.type !== 'slider') out.push({ type: 'activate', widget: this.id, item: item.id });
  }

  private command(cmd: string, frame: number, out: UiEvent[]): void {
    const vertical = this.direction === 'vertical';
    const [prev, next, less, more] = vertical
      ? ['up', 'down', 'left', 'right']
      : ['left', 'right', 'down', 'up'];
    if (cmd === prev) this.step(-1, frame, out);
    else if (cmd === next) this.step(1, frame, out);
    else if (cmd === less) this.adjust(-1, out);
    else if (cmd === more) this.adjust(1, out);
    else if (cmd === 'confirm') this.take(frame, out);
    else if (cmd === 'back') out.push({ type: 'back', widget: this.id });
  }

  // ---- Drawing ----

  /** The menu's draw items at `frame`; `active` draws the focus (an inactive menu shows none). */
  draws(frame: number, active = true): UiDraw[] {
    const look = this.look;
    const out: UiDraw[] = this.panel ? lookPanel(look, this.box) : [];
    const boxes = this.itemBoxes();
    this.opts.items.forEach((item, i) => {
      const box = boxes[i]!;
      const focused = active && i === this.focusIndex;
      const color = item.disabled === true ? look.disabledText : focused ? look.focusText : look.text;
      const own: UiDraw[] = [];
      if (focused) own.push({ kind: 'fill', ...box, color: look.focusBack });
      const cursor = look.style.cursor;
      if (focused && cursor !== undefined) own.push(...lookText(look, cursor, box.x + 1, box.y + 1, color));
      own.push(...lookText(look, item.label, box.x + 1 + this.cursorWidth(), box.y + 1, color));
      if (item.type === 'slider') own.push(...this.sliderDraws(item, box, color));
      if (item.type === 'toggle') own.push(...this.toggleDraws(item.id, box, color));
      out.push(...tweenDraws(own, this.tweens[i]!.state(frame)));
    });
    return out;
  }

  private sliderDraws(item: Extract<UiMenuItemSpec, { type: 'slider' }>, box: Box, color: string): UiDraw[] {
    const look = this.look;
    const v = this.values.get(item.id) as number;
    if (item.labels !== undefined) {
      // A slider with words is a choice: `< Auto >`, no track.
      const text = choiceText(sliderText(item, v));
      return lookText(look, text, box.x + box.w - 1 - measureLine(look.font, text), box.y + 1, color);
    }
    const track = this.trackBox(item, box);
    const { min, max } = sliderRange(item);
    const filled = max > min ? Math.round(((v - min) / (max - min)) * track.w) : track.w;
    const text = sliderText(item, v);
    const tx = box.x + box.w - 1 - measureLine(look.font, text);
    return [
      { kind: 'fill', ...track, color: look.track },
      { kind: 'fill', x: track.x, y: track.y, w: filled, h: track.h, color: look.fill },
      {
        kind: 'fill',
        x: track.x + Math.min(track.w - 1, filled),
        y: track.y - 1,
        w: 1,
        h: track.h + 2,
        color,
      },
      ...lookText(look, text, tx, box.y + 1, color),
    ];
  }

  private toggleDraws(id: string, box: Box, color: string): UiDraw[] {
    const look = this.look;
    const on = this.values.get(id) === true;
    const s = this.toggleBox();
    const x = box.x + box.w - 1 - (s + 3 + measureLine(look.font, 'Off'));
    const y = box.y + Math.floor((box.h - s) / 2);
    const out: UiDraw[] = [
      { kind: 'fill', x, y, w: s, h: s, color },
      { kind: 'fill', x: x + 1, y: y + 1, w: s - 2, h: s - 2, color: on ? look.fill : look.back },
    ];
    out.push(...lookText(look, on ? 'On' : 'Off', x + s + 3, box.y + 1, color));
    return out;
  }
}

/** A single button: a menu of one button item on its own panel (its events carry the button id as `item`). */
export class Button extends Menu {
  constructor(id: string, label: string, look: UiLook, disabled = false) {
    super({ id, items: [{ id, label, ...(disabled && { disabled }) }], panel: true }, look);
  }
}
