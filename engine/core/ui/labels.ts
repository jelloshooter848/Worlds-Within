import {
  HUD_VALUE_TOKEN,
  labelBar,
  labelValue,
  timerText,
  type DeepReadonly,
  type PresentEntity,
  type PresentFrame,
  type SkinLabel,
} from '../present';
import type { FontLookup } from './font';
import { DEFAULT_BAR_COLOR, borderDraws } from './hud';
import type { Box } from './nine-slice';
import { DEFAULT_TEXT_COLOR, textDraws, type UiDraw } from './paint';
import { measureLine } from './text';
import { barFill } from './widgets';

/**
 * World-anchored labels (Engine 0.16 T12): names, health bars and timers over entities, laid out
 * with the UI kit in picture px once a backend has projected the entity's anchor onto the picture.
 * Pure; the 3D backend draws the items on its HUD layer.
 */

/** A bar label's size when the skin gives none. */
export const DEFAULT_LABEL_BAR = { w: 16, h: 3 } as const;

/** Picture px from the anchor to a label when the skin gives no `offset` (just above the box). */
export const DEFAULT_LABEL_OFFSET = { x: 0, y: -2 } as const;

/** Px between labels stacked on one anchor. */
export const LABEL_GAP = 1;

/** One label as laid out: what it shows and its box in picture px. */
export interface LabelView {
  entity: string;
  kind: string;
  as: SkinLabel['as'];
  /** The text shown (text and timer labels). */
  text?: string;
  /** The bar's value and full value (bar labels). */
  bar?: { value: number; max: number };
  /** The box the label covers, picture px. */
  box: Box;
}

/** Where a label anchor of an entity lands on the picture (px), or null when it is off screen or behind the camera. */
export type LabelProject = (anchor: NonNullable<SkinLabel['anchor']>) => { x: number; y: number } | null;

/**
 * The draw items and views of an entity's labels: each label with a value (a text label with a
 * `format` needs none) is placed centred on its anchor's projected point plus its `offset`; labels
 * on one anchor stack in list order, away from the box (`top` upward, `bottom` downward, `center`
 * upward from the centre). A label whose anchor `project` hides is skipped, and so is one with no
 * font for its text. Positions are whole picture px so pixel fonts stay crisp.
 */
export function layoutLabels(
  labels: readonly DeepReadonly<SkinLabel>[],
  entity: DeepReadonly<PresentEntity>,
  status: DeepReadonly<PresentFrame['status']>,
  project: LabelProject,
  fonts?: FontLookup,
): { draws: UiDraw[]; views: LabelView[] } {
  const draws: UiDraw[] = [];
  const views: LabelView[] = [];
  const stacked = new Map<string, number>();
  for (const label of labels) {
    const anchor = label.anchor ?? 'top';
    const point = project(anchor);
    if (point === null) continue;
    const value = labelValue(label, entity, status);
    const item = labelItem(label, value, status, fonts);
    if (item === null) continue;
    const offset = label.offset ?? DEFAULT_LABEL_OFFSET;
    const used = stacked.get(anchor) ?? 0;
    stacked.set(anchor, used + item.h + LABEL_GAP);
    const x = Math.round(point.x + offset.x - item.w / 2);
    const cy = Math.round(point.y + offset.y);
    const y =
      anchor === 'bottom'
        ? cy + used
        : anchor === 'center'
          ? cy - Math.round(item.h / 2) - used
          : cy - item.h - used;
    const box = { x, y, w: item.w, h: item.h };
    draws.push(...item.draw(box));
    views.push({
      entity: entity.id,
      kind: entity.kind,
      as: label.as,
      ...(item.text !== undefined && { text: item.text }),
      ...(item.bar !== undefined && { bar: item.bar }),
      box,
    });
  }
  return { draws, views };
}

interface LabelItem {
  w: number;
  h: number;
  text?: string;
  bar?: { value: number; max: number };
  draw: (box: Box) => UiDraw[];
}

/** A label's size and painter, or null when it has nothing to show. */
function labelItem(
  label: DeepReadonly<SkinLabel>,
  value: string | number | boolean | undefined,
  status: DeepReadonly<PresentFrame['status']>,
  fonts: FontLookup | undefined,
): LabelItem | null {
  if (label.as === 'bar') {
    const bar = labelBar(label, value, status);
    if (bar === null) return null;
    const w = label.w ?? DEFAULT_LABEL_BAR.w;
    const h = label.h ?? DEFAULT_LABEL_BAR.h;
    return {
      w,
      h,
      bar,
      draw: (box) => {
        const out: UiDraw[] = [];
        let inner = box;
        if (label.border !== undefined) {
          out.push(...borderDraws(box, label.border));
          inner = { x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 };
        }
        if (inner.w <= 0 || inner.h <= 0) return out;
        if (label.back !== undefined) out.push({ kind: 'fill', ...inner, color: label.back });
        const filled = barFill(bar.value, bar.max, inner.w);
        const color = label.color ?? DEFAULT_BAR_COLOR;
        if (filled > 0) out.push({ kind: 'fill', x: inner.x, y: inner.y, w: filled, h: inner.h, color });
        return out;
      },
    };
  }
  let shown: string;
  if (label.as === 'timer') {
    const ticks = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
    if (!Number.isFinite(ticks)) return null;
    shown = timerText(ticks);
  } else {
    if (value === undefined && label.format === undefined) return null;
    shown = value === undefined ? '' : String(value);
  }
  const text = label.format === undefined ? shown : label.format.split(HUD_VALUE_TOKEN).join(shown);
  const font = label.font === undefined ? null : (fonts?.(label.font) ?? null);
  if (font === null || text === '') return null;
  const style = {
    color: label.color ?? DEFAULT_TEXT_COLOR,
    ...(label.shadow !== undefined && { shadow: label.shadow }),
    ...(label.outline !== undefined && { outline: label.outline }),
  };
  return {
    w: measureLine(font, text),
    h: font.baseline,
    text,
    draw: (box) => textDraws(font, text, box.x, box.y, style),
  };
}
