import { lerpColor } from '../fx/color';
import type { TweenSpec } from '../fx/schema';
import { TweenSet, tweenList, type TweenState } from '../fx/tween';
import type { Font, FontLookup } from './font';
import { sliceInsets, type Box } from './nine-slice';
import { panelDraws, textDraws, type TextStyle, type UiDraw } from './paint';
import { UI_STYLE_DEFAULTS, type UiStyle } from './ui-schema';
import type { TweensSpec } from '../fx/schema';

/**
 * What every interactive widget draws with (Engine 0.16 T7): a screen's style with its defaults
 * filled, its font, and the backend-neutral frame lookup a nine-slice panel or a portrait needs.
 * Also the focus and press tweens, laid on a widget's draw items. Pure.
 */

/** The size of a sprite frame, or null when the game lacks it (the backend's or the glue's lookup). */
export type UiFrameSize = (
  sheet: string,
  palette: string | undefined,
  frame: string,
) => { w: number; h: number } | null;

/** The default focus tween: the item slides 3 px into place. */
export const DEFAULT_FOCUS_TWEEN: TweenSpec = { prop: 'x', from: 3, to: 0, frames: 6, ease: 'cubicOut' };
/** The default press tween: the item dips a px and flashes white. */
export const DEFAULT_PRESS_TWEEN: readonly TweenSpec[] = [
  { prop: 'y', from: 1, to: 0, frames: 8 },
  { prop: 'color', from: '#fcfcfc', to: '#fcfcfc', frames: 6, amount: 0.7 },
];

export interface UiLook {
  style: UiStyle;
  font: Font;
  fonts: FontLookup;
  frameSize: UiFrameSize;
  text: string;
  focusText: string;
  disabledText: string;
  back: string;
  focusBack: string;
  border: string;
  track: string;
  fill: string;
  padding: number;
  gap: number;
  rate: number;
  typeEvery: number;
  focusTween: readonly TweenSpec[];
  pressTween: readonly TweenSpec[];
}

/** A style's look; throws when its font is not one of `fonts` (validate reports it first). */
export function uiLook(style: UiStyle, fonts: FontLookup, frameSize: UiFrameSize): UiLook {
  const font = fonts(style.font);
  if (font === null) throw new Error(`ui: no font "${style.font}"`);
  const d = UI_STYLE_DEFAULTS;
  const specs = (s: TweensSpec | undefined, dflt: TweenSpec | readonly TweenSpec[]) =>
    tweenList(s ?? (dflt as TweensSpec));
  return {
    style,
    font,
    fonts,
    frameSize,
    text: style.text ?? d.text,
    focusText: style.focusText ?? d.focusText,
    disabledText: style.disabledText ?? d.disabledText,
    back: style.back ?? d.back,
    focusBack: style.focusBack ?? d.focusBack,
    border: style.border ?? d.border,
    track: style.track ?? d.track,
    fill: style.fill ?? d.fill,
    padding: style.padding ?? d.padding,
    gap: style.gap ?? d.gap,
    rate: style.rate ?? d.rate,
    typeEvery: style.typeEvery ?? d.typeEvery,
    focusTween: specs(style.focusTween, DEFAULT_FOCUS_TWEEN),
    pressTween: specs(style.pressTween, DEFAULT_PRESS_TWEEN),
  };
}

/** Text in the look's font and a colour, with the style's shadow. */
export function lookText(look: UiLook, text: string, x: number, y: number, color: string, font = look.font) {
  const style: TextStyle = { color, ...(look.style.shadow !== undefined && { shadow: look.style.shadow }) };
  return textDraws(font, text, x, y, style);
}

/** Px a panel's frame takes on each side (its slice), 1 for a frameless panel's border. */
export function panelInset(look: UiLook): { left: number; top: number; right: number; bottom: number } {
  const panel = look.style.panel;
  if (panel === undefined) return { left: 1, top: 1, right: 1, bottom: 1 };
  return sliceInsets(panel.slice);
}

/** A panel over `box`: the style's nine-slice frame, or a filled box with a one-px border. */
export function lookPanel(look: UiLook, box: Box): UiDraw[] {
  const panel = look.style.panel;
  if (panel !== undefined) {
    const size = look.frameSize(panel.sheet, panel.palette, panel.frame);
    if (size !== null) return panelDraws(panel, size, sliceInsets(panel.slice), box);
  }
  return [
    { kind: 'fill', ...box, color: look.border },
    { kind: 'fill', x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2, color: look.back },
  ];
}

/** The box inside a panel: its frame's insets and the padding taken off. */
export function panelContent(look: UiLook, box: Box): Box {
  const i = panelInset(look);
  const p = look.padding;
  return {
    x: box.x + i.left + p,
    y: box.y + i.top + p,
    w: Math.max(0, box.w - i.left - i.right - 2 * p),
    h: Math.max(0, box.h - i.top - i.bottom - 2 * p),
  };
}

/** Width and height a content box needs to become a panel's whole box. */
export function panelExtra(look: UiLook): { w: number; h: number } {
  const i = panelInset(look);
  return { w: i.left + i.right + 2 * look.padding, h: i.top + i.bottom + 2 * look.padding };
}

/**
 * A widget item's tweens (focus and press): `TweenSet`s run on the screen's display frames, and
 * laid on the item's draws by `tweenDraws`. Presentation state only.
 */
export class ItemTweens {
  private readonly set = new TweenSet();

  play(specs: readonly TweenSpec[], frame: number): void {
    this.set.add(specs, frame);
  }

  state(frame: number): TweenState {
    this.set.update(frame);
    return this.set.state(frame);
  }
}

/**
 * Draw items moved by a tween state's `x` and `y` (whole px), their colours overlaid with its
 * `color` by `colorAmount`, and fills' alpha multiplied by its `alpha`. Scale and turn do not
 * apply to UI items (pixel text stays on the grid).
 */
export function tweenDraws(draws: readonly UiDraw[], s: TweenState): UiDraw[] {
  const dx = Math.round(s.x);
  const dy = Math.round(s.y);
  const tint = (c: string) =>
    s.color === null || s.colorAmount <= 0 ? c : lerpColor(c, s.color, s.colorAmount);
  return draws.map((d) => {
    const moved = { ...d, x: d.x + dx, y: d.y + dy };
    if (moved.kind === 'fill') {
      const alpha = (moved.alpha ?? 1) * s.alpha;
      return { ...moved, color: tint(moved.color), ...(alpha < 1 && { alpha }) };
    }
    if (moved.kind === 'glyph') return { ...moved, color: tint(moved.color) };
    return moved;
  });
}
