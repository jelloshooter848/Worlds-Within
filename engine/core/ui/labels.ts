import {
  clampBoxInside,
  HUD_VALUE_TOKEN,
  labelBar,
  labelValue,
  timerText,
  unionBox,
  type DeepReadonly,
  type PresentEntity,
  type PresentFrame,
  type SkinLabel,
} from '../present';
import type { FontLookup } from './font';
import { DEFAULT_BAR_COLOR, barBorder } from './hud';
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
 * `format` and no `from` needs none; one whose `from` is missing shows nothing) is placed centred on its anchor's projected point plus its `offset`; labels
 * on one anchor stack in list order, away from the box (`top` upward, `bottom` downward, `center`
 * upward from the centre). A label whose anchor `project` hides is skipped, and so is one with no
 * font for its text. Positions are whole picture px so pixel fonts stay crisp.
 *
 * With a `picture` size (Engine 0.16 polish P6, gap M45) the entity's labels are kept inside it:
 * their boxes together (a name with its health or progress bar) are moved as one box by
 * `clampBoxInside`, `LABEL_EDGE_MARGIN` px clear of the edges, so a label whose anchor is in the
 * picture is never cut at its edge.
 */
export function layoutLabels(
  labels: readonly DeepReadonly<SkinLabel>[],
  entity: DeepReadonly<PresentEntity>,
  status: DeepReadonly<PresentFrame['status']>,
  project: LabelProject,
  fonts?: FontLookup,
  picture?: Readonly<{ width: number; height: number }>,
): { draws: UiDraw[]; views: LabelView[] } {
  const placed: { label: DeepReadonly<SkinLabel>; item: LabelItem; box: Box }[] = [];
  const stacked = new Map<string, number>();
  for (const label of labels) {
    const anchor = label.anchor ?? 'top';
    const point = project(anchor);
    if (point === null) continue;
    const value = labelValue(label, entity, status);
    const item = labelItem(label, value, status, fonts, entity);
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
    placed.push({ label, item, box: { x, y, w: item.w, h: item.h } });
  }
  let dx = 0;
  let dy = 0;
  const all = picture === undefined ? null : unionBox(placed.map((p) => p.box));
  if (all !== null && picture !== undefined) {
    const inside = clampBoxInside(all, picture);
    dx = inside.x - all.x;
    dy = inside.y - all.y;
  }
  const draws: UiDraw[] = [];
  const views: LabelView[] = [];
  for (const { label, item, box: at } of placed) {
    const box = { x: at.x + dx, y: at.y + dy, w: at.w, h: at.h };
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
  entity: DeepReadonly<PresentEntity>,
): LabelItem | null {
  if (label.as === 'bar') {
    const bar = labelBar(label, value, status, entity);
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
          const framed = barBorder(box, label.border);
          out.push(...framed.draws);
          inner = framed.inner;
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
    // A label reading a value the entity or frame lacks shows nothing, `format` or not (Engine
    // 0.16 F7: a built watchtower's `progress:` label went away with its tag).
    if (value === undefined && (label.format === undefined || label.from !== undefined)) return null;
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
