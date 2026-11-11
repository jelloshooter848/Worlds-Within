import { CLOCK_STATUS } from '../clock';
import {
  DEFAULT_HUD_FONT,
  HUD_CLOCK_FORMAT,
  HUD_CLOCK_TOKENS,
  HUD_VALUE_TOKEN,
  hudGlyphs,
  hudItemShown,
  isClassicHudType,
  layoutHud,
  type DeepReadonly,
  type HudDraw,
  type HudFrameSize,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
  type SkinHudItem,
} from '../present';
import type { Font, FontLookup } from './font';
import { sliceInsets, type Box } from './nine-slice';
import { DEFAULT_TEXT_COLOR, panelDraws, textDraws, type TextStyle, type UiDraw, type UiFill } from './paint';
import { barFill, barRatio, CounterRoll, dayBarDraws, minimapDraws } from './widgets';

/**
 * The skin's HUD through the UI kit (Engine 0.16 T6): every `hud` item of a skin as `UiDraw`
 * items, in order. The classic items (`hearts`, `icon`, and `number` / `text` in a sprite font)
 * come from `layoutHud` unchanged; text in a `font` content file, and the widgets `bar`,
 * `counter`, `panel`, `minimap` and (Engine 0.16 F4) `clock`, are laid out here. One per presenter: a counter's roll is its
 * state (presentation only, never in a frame or a hash).
 *
 * A backend whose skin has no UI item (`usesUi` false) keeps drawing `layoutHud`'s items itself,
 * exactly as before.
 */

/** What the HUD reads each frame. */
export interface SkinHudInput {
  status: DeepReadonly<PresentFrame['status']>;
  /** The size of a sprite frame (the backend's own lookup), or null when it is missing. */
  frameSize: HudFrameSize;
  /** The map the presenter shows (for a minimap), or null. */
  map: DeepReadonly<PresentMap> | null;
  entities: readonly DeepReadonly<PresentEntity>[];
  /** The presenter's display-frame count (it only goes up): a counter rolls on it. */
  clock: number;
}

export interface SkinHudOptions {
  /** The game's fonts (`contentFonts`). Without it no item uses a font file. */
  fonts?: FontLookup;
  /** The font a number or text item uses when it names none (default `DEFAULT_HUD_FONT`). */
  font?: string;
}

/** A bar's fill colour when the item gives none. */
export const DEFAULT_BAR_COLOR = '#00a800';

/** Px between a counter's icon and its number when the item gives none. */
export const DEFAULT_COUNTER_GAP = 2;

/** Fields only the UI kit draws: an item with any of them is laid out here. */
const UI_FIELDS = ['color', 'shadow', 'outline', 'align', 'format', 'digits', 'w'] as const;

/** A status value as HUD text: a number padded to `digits`, then put into `format`. */
export function hudValueText(item: Pick<SkinHudItem, 'digits' | 'format'>, value: unknown): string {
  let text = value === undefined ? '' : String(value);
  if (typeof value === 'number' && item.digits !== undefined) {
    const digits = String(Math.abs(Math.trunc(value))).padStart(item.digits, '0');
    text = value < 0 ? `-${digits}` : digits;
  }
  return item.format === undefined ? text : item.format.split(HUD_VALUE_TOKEN).join(text);
}

/** The day bar's height when a `clock` item gives none. */
export const DEFAULT_DAY_BAR_HEIGHT = 3;

/**
 * A `clock` item's text (Engine 0.16 F4): its `format` (default `Day {day} {time}`) with each
 * token (`{day}`, `{time}`, `{phase}`, `{text}`, and `{value}` for the text) replaced by the clock
 * status field under `prefix`; null when the status has no clock (`<prefix>.text` missing).
 */
export function clockHudText(
  format: string | undefined,
  status: DeepReadonly<PresentFrame['status']>,
  prefix: string = CLOCK_STATUS,
): string | null {
  if (!Object.hasOwn(status, `${prefix}.text`)) return null;
  const field = (name: string) => {
    const v = status[`${prefix}.${name}`];
    return v === undefined ? '' : String(v);
  };
  let text = format ?? HUD_CLOCK_FORMAT;
  for (const [token, name] of Object.entries(HUD_CLOCK_TOKENS)) text = text.split(token).join(field(name));
  return text.split(HUD_VALUE_TOKEN).join(field('text'));
}

export class SkinHud {
  /** Whether any item is the UI kit's (else the backend draws `layoutHud` as before). */
  readonly usesUi: boolean;
  private readonly rolls = new Map<number, CounterRoll>();

  constructor(
    private readonly skin: DeepReadonly<SkinFile>,
    private readonly opts: SkinHudOptions = {},
  ) {
    this.usesUi = (skin.hud ?? []).some((item) => this.isUiItem(item));
  }

  /** The HUD's draw items for this frame, in the skin's order. */
  layout(input: SkinHudInput): UiDraw[] {
    const out: UiDraw[] = [];
    (this.skin.hud ?? []).forEach((item, i) => {
      if (!hudItemShown(item, input.status)) return;
      if (!this.isUiItem(item)) out.push(...this.classic(item, input));
      else out.push(...this.widget(item, i, input));
    });
    return out;
  }

  /** The font file an item's text uses, or null (a sprite font or none). */
  private fontOf(item: DeepReadonly<SkinHudItem>): Font | null {
    return this.opts.fonts?.(item.font ?? this.opts.font ?? DEFAULT_HUD_FONT) ?? null;
  }

  private isUiItem(item: DeepReadonly<SkinHudItem>): boolean {
    if (!isClassicHudType(item.as)) return true;
    if (UI_FIELDS.some((f) => item[f] !== undefined)) return true;
    return (item.as === 'number' || item.as === 'text') && this.fontOf(item) !== null;
  }

  /** A classic item through `layoutHud`, as UI items (the same pixels). */
  private classic(item: DeepReadonly<SkinHudItem>, input: SkinHudInput): UiDraw[] {
    const one = { ...this.skin, hud: [item] } as DeepReadonly<SkinFile>;
    const opts = this.opts.font !== undefined ? { font: this.opts.font } : {};
    const draws: HudDraw[] = layoutHud(one, input.status, input.frameSize, opts);
    const out: UiDraw[] = [];
    for (const d of draws.flatMap((d) => (d.kind === 'text' ? hudGlyphs(d) : [d]))) {
      if (d.kind === 'box') {
        out.push({ kind: 'fill', x: d.x, y: d.y, w: d.w, h: d.h, color: d.color, missing: true });
        continue;
      }
      const size = input.frameSize(d.sheet, d.palette, d.frame);
      if (size === null) continue;
      out.push({
        kind: 'image',
        sheet: d.sheet,
        ...(d.palette !== undefined && { palette: d.palette }),
        frame: d.frame,
        sx: 0,
        sy: 0,
        sw: size.w,
        sh: size.h,
        x: d.x,
        y: d.y,
        w: size.w,
        h: size.h,
      });
    }
    return out;
  }

  private widget(item: DeepReadonly<SkinHudItem>, index: number, input: SkinHudInput): UiDraw[] {
    const { status } = input;
    const has = item.status !== undefined && Object.hasOwn(status, item.status);
    const value = has ? status[item.status!] : undefined;
    const box: Box = { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 };
    switch (item.as) {
      case 'clock':
        return this.clock(item, box, input);
      case 'panel':
        return this.panel(item, box, input);
      case 'minimap':
        return [
          ...minimapDraws(
            {
              box,
              tiles: (item.tiles ?? {}) as Readonly<Record<string, string>>,
              ...(item.back !== undefined && { back: item.back }),
              dots: item.dots ?? [],
              ...(item.scale !== undefined && { scale: item.scale }),
            },
            input.map,
            input.entities,
          ),
          ...(item.border !== undefined ? borderDraws(box, item.border) : []),
        ];
      case 'bar':
        return has ? this.bar(item, box, value, input) : [];
      case 'counter':
        return has ? this.counter(item, index, value, input) : [];
      case 'number':
      case 'text': {
        if (!has && !(item.as === 'text' && item.format !== undefined)) return [];
        return this.text(item, hudValueText(item, value), item.x, item.y, this.style(item));
      }
      default:
        // hearts and icons with a UI-only field: drawn as before.
        return has ? this.classic(item, input) : [];
    }
  }

  private style(item: DeepReadonly<SkinHudItem>, color?: string): TextStyle {
    return {
      color: color ?? item.color ?? DEFAULT_TEXT_COLOR,
      ...(item.shadow !== undefined && { shadow: item.shadow }),
      ...(item.outline !== undefined && { outline: item.outline }),
    };
  }

  private text(
    item: DeepReadonly<SkinHudItem>,
    text: string,
    x: number,
    y: number,
    style: TextStyle,
  ): UiDraw[] {
    const font = this.fontOf(item);
    if (font === null) return [];
    return textDraws(font, text, x, y, style, {
      ...(item.w !== undefined && { width: item.w }),
      ...(item.align !== undefined && { align: item.align }),
    });
  }

  private sprite(item: {
    sheet?: string | undefined;
    frame: string;
  }): { sheet: string; palette?: string; frame: string } | null {
    const sheet = item.sheet ?? this.skin.sheets?.sheet;
    if (sheet === undefined) return null;
    const palette = this.skin.sheets?.palette;
    return { sheet, ...(palette !== undefined && { palette }), frame: item.frame };
  }

  private panel(item: DeepReadonly<SkinHudItem>, box: Box, input: SkinHudInput): UiDraw[] {
    if (item.frame === undefined && item.color !== undefined) {
      // A flat panel (Engine 0.16 F7): a box in its colour (at its `alpha`), then its border.
      const fill: UiFill = { kind: 'fill', ...box, color: item.color };
      if (item.alpha !== undefined && item.alpha < 1) fill.alpha = item.alpha;
      return [fill, ...(item.border !== undefined ? borderDraws(box, item.border) : [])];
    }
    if (item.frame === undefined || item.slice === undefined) return [];
    const sprite = this.sprite({ sheet: item.sheet, frame: item.frame });
    const size = sprite && input.frameSize(sprite.sheet, sprite.palette, sprite.frame);
    if (!sprite || !size) return [];
    return panelDraws(sprite, size, sliceInsets(item.slice), box, item.fill ?? 'stretch');
  }

  /**
   * The world clock (Engine 0.16 F4): its text (`clockHudText`) at the top of the box, centred
   * unless `align` says otherwise, and the day bar along the bottom with the marker at
   * `<status>.fraction`. Nothing without the clock in the status.
   */
  private clock(item: DeepReadonly<SkinHudItem>, box: Box, input: SkinHudInput): UiDraw[] {
    const prefix = item.status ?? CLOCK_STATUS;
    const text = clockHudText(item.format, input.status, prefix);
    if (text === null) return [];
    const font = this.fontOf(item);
    const out: UiDraw[] =
      font === null
        ? []
        : textDraws(font, text, box.x, box.y, this.style(item), {
            width: box.w,
            align: item.align ?? 'center',
          });
    const spec = item.dayBar ?? {};
    const h = Math.min(box.h, spec.h ?? DEFAULT_DAY_BAR_HEIGHT);
    const fraction = input.status[`${prefix}.fraction`];
    out.push(
      ...dayBarDraws(
        spec,
        { x: box.x, y: box.y + box.h - h, w: box.w, h },
        typeof fraction === 'number' ? fraction : null,
      ),
    );
    return out;
  }

  private bar(item: DeepReadonly<SkinHudItem>, box: Box, value: unknown, input: SkinHudInput): UiDraw[] {
    const out: UiDraw[] = [];
    const maxValue =
      typeof item.max === 'number' ? item.max : item.max !== undefined ? input.status[item.max] : undefined;
    const max = typeof maxValue === 'number' ? maxValue : 0;
    const v = typeof value === 'number' ? value : 0;
    let inner = box;
    const panel = item.panel;
    const sprite = panel && this.sprite({ sheet: panel.sheet, frame: panel.frame });
    const size = sprite && input.frameSize(sprite.sheet, sprite.palette, sprite.frame);
    if (panel && sprite && size) {
      const ins = sliceInsets(panel.slice);
      out.push(...panelDraws(sprite, size, ins, box, panel.fill ?? 'stretch'));
      inner = {
        x: box.x + ins.left,
        y: box.y + ins.top,
        w: box.w - ins.left - ins.right,
        h: box.h - ins.top - ins.bottom,
      };
    } else if (item.border !== undefined) {
      out.push(...borderDraws(box, item.border));
      inner = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
    }
    if (inner.w <= 0 || inner.h <= 0) return out;
    if (item.back !== undefined) out.push({ kind: 'fill', ...inner, color: item.back });
    const filled = barFill(v, max, inner.w);
    const low = item.low !== undefined && barRatio(v, max) <= item.low.below;
    const color = low ? item.low!.color : (item.color ?? DEFAULT_BAR_COLOR);
    if (filled > 0) out.push({ kind: 'fill', x: inner.x, y: inner.y, w: filled, h: inner.h, color });
    return out;
  }

  private counter(
    item: DeepReadonly<SkinHudItem>,
    index: number,
    value: unknown,
    input: SkinHudInput,
  ): UiDraw[] {
    const out: UiDraw[] = [];
    let x = item.x;
    let iconH = 0;
    const sprite = item.frame !== undefined ? this.sprite({ sheet: item.sheet, frame: item.frame }) : null;
    const size = sprite && input.frameSize(sprite.sheet, sprite.palette, sprite.frame);
    if (sprite && size) {
      out.push({
        kind: 'image',
        ...sprite,
        sx: 0,
        sy: 0,
        sw: size.w,
        sh: size.h,
        x,
        y: item.y,
        w: size.w,
        h: size.h,
      });
      x += size.w + (item.gap ?? DEFAULT_COUNTER_GAP);
      iconH = size.h;
    }
    const font = this.fontOf(item);
    if (font === null) return out;
    let shown = value;
    let rolling = false;
    if (typeof value === 'number' && item.tween !== undefined) {
      let roll = this.rolls.get(index);
      if (roll === undefined) this.rolls.set(index, (roll = new CounterRoll(item.tween)));
      shown = roll.shown(value, input.clock);
      rolling = roll.rolling(input.clock);
    }
    // The number's caps centred on the icon.
    const y = item.y + Math.max(0, Math.floor((iconH - font.baseline) / 2));
    const color = rolling ? item.tween?.color : undefined;
    out.push(...this.text(item, hudValueText(item, shown), x, y, this.style(item, color)));
    return out;
  }
}

/** A one-px frame round `box` in `color`: top, bottom, left and right. */
export function borderDraws(box: Box, color: string): UiFill[] {
  if (box.w <= 0 || box.h <= 0) return [];
  return [
    { kind: 'fill', x: box.x, y: box.y, w: box.w, h: 1, color },
    { kind: 'fill', x: box.x, y: box.y + box.h - 1, w: box.w, h: 1, color },
    { kind: 'fill', x: box.x, y: box.y + 1, w: 1, h: Math.max(0, box.h - 2), color },
    { kind: 'fill', x: box.x + box.w - 1, y: box.y + 1, w: 1, h: Math.max(0, box.h - 2), color },
  ];
}
