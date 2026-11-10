import { describe, expect, it } from 'vitest';
import type { PresentEntity, SkinLabel } from '../present';
import { buildFont, type FontLookup } from './font';
import { DEFAULT_LABEL_BAR, layoutLabels, type LabelProject } from './labels';

// World-anchored labels (Engine 0.16 T12): laid out in picture px around a projected anchor.

const FONT = buildFont('f', {
  cell: { w: 3, h: 4 },
  baseline: 4,
  glyphs: Object.fromEntries([...'Pip0123456789:'].map((c) => [c, { rows: ['###', '###', '###', '###'] }])),
});
const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);

const e: PresentEntity = {
  id: 'p1',
  kind: 'hero',
  x: 0,
  y: 0,
  w: 16,
  h: 16,
  facing: 'right',
  anim: { state: 'idle', t: 0 },
  tags: ['name:Pip', 'hp:2'],
};

const at: LabelProject = (anchor) => ({ x: 50, y: anchor === 'top' ? 20 : anchor === 'center' ? 28 : 36 });

describe('layoutLabels', () => {
  it('centres a label on its anchor, 2 px above it by default, and stacks the next one above', () => {
    const labels: SkinLabel[] = [
      { from: { tag: 'name:' }, as: 'text', font: 'f', shadow: '#000000' },
      { from: { tag: 'hp:' }, as: 'bar', max: 4, back: '#000000', border: '#fcfcfc', w: 10, h: 4 },
    ];
    const { draws, views } = layoutLabels(labels, e, {}, at, fonts);
    // 'Pip' is three 3-px glyphs with 1 px spacing: 11 px wide.
    expect(views[0]).toEqual({
      entity: 'p1',
      kind: 'hero',
      as: 'text',
      text: 'Pip',
      box: { x: 45, y: 14, w: 11, h: 4 },
    });
    expect(views[1]).toEqual({
      entity: 'p1',
      kind: 'hero',
      as: 'bar',
      bar: { value: 2, max: 4 },
      box: { x: 45, y: 9, w: 10, h: 4 },
    });
    // Shadow glyphs, then the text, then the bar's border (4), back and fill (half of 8 inner px).
    expect(draws.filter((d) => d.kind === 'glyph')).toHaveLength(6);
    const fills = draws.filter((d) => d.kind === 'fill');
    expect(fills).toHaveLength(6);
    expect(fills.at(-1)).toMatchObject({ x: 46, y: 10, w: 4, h: 2 });
  });

  it('hangs bottom labels below, centres center labels and applies the offset', () => {
    const { views } = layoutLabels(
      [
        { as: 'bar', from: { tag: 'hp:' }, anchor: 'bottom' },
        { as: 'bar', from: { tag: 'hp:' }, anchor: 'bottom', offset: { x: 3, y: 0 } },
        { as: 'bar', from: { tag: 'hp:' }, anchor: 'center', offset: { x: 0, y: 0 } },
      ],
      e,
      {},
      at,
      fonts,
    );
    const { w, h } = DEFAULT_LABEL_BAR;
    expect(views.map((v) => v.box)).toEqual([
      { x: 50 - w / 2, y: 36 - 2, w, h },
      { x: 53 - w / 2, y: 36 + h + 1, w, h },
      { x: 50 - w / 2, y: 28 - 2, w, h },
    ]);
  });

  it('shows a timer as m:ss in its format, and skips hidden anchors, missing values and fonts', () => {
    const timer: SkinLabel = { from: { status: 'left' }, as: 'timer', font: 'f', format: '{value}' };
    expect(layoutLabels([timer], e, { left: 125 }, at, fonts).views[0]!.text).toBe('0:03');
    expect(layoutLabels([timer], e, {}, at, fonts).views).toEqual([]);
    expect(layoutLabels([timer], e, { left: 125 }, () => null, fonts)).toEqual({ draws: [], views: [] });
    expect(layoutLabels([timer], e, { left: 125 }, at).views).toEqual([]);
    const fixed: SkinLabel = { as: 'text', format: 'Pip', font: 'f' };
    expect(layoutLabels([fixed], e, {}, at, fonts).views[0]!.text).toBe('Pip');
  });
});
