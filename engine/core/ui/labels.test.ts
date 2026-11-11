import { describe, expect, it } from 'vitest';
import type { PresentEntity, SkinLabel } from '../present';
import { buildFont, type FontLookup } from './font';
import { DEFAULT_LABEL_BAR, layoutLabels, type LabelProject } from './labels';
import { LABEL_EDGE_MARGIN } from '../present';

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
    // A format reading a tag the entity lacks shows nothing (Engine 0.16 F7).
    const tagged: SkinLabel = { from: { tag: 'progress:' }, as: 'text', format: 'Pip {value}', font: 'f' };
    expect(layoutLabels([tagged], e, {}, at, fonts).views).toEqual([]);
    expect(layoutLabels([tagged], { ...e, tags: ['progress:12'] }, {}, at, fonts).views[0]!.text).toBe(
      'Pip 12',
    );
  });
});

describe('layoutLabels inside the picture (Engine 0.16 polish P6, gap M45)', () => {
  const labels: SkinLabel[] = [
    { from: { tag: 'name:' }, as: 'text', font: 'f' },
    { from: { tag: 'hp:' }, as: 'bar', max: 4, w: 16, h: 3, color: '#00ff00' },
  ];
  const near =
    (x: number, y: number): LabelProject =>
    () => ({ x, y });
  const boxes = (project: LabelProject, picture?: { width: number; height: number }) =>
    layoutLabels(labels, e, {}, project, fonts, picture).views.map((v) => v.box);

  it('moves a name and its bar as one box, keeping their stacking', () => {
    // Anchor 3 px from the left edge, 6 down: unclamped, the name starts at x -2 and the bar
    // stacked over it at x -5, y -4.
    expect(boxes(near(3, 6))).toEqual([
      { x: -2, y: 0, w: 11, h: 4 },
      { x: -5, y: -4, w: 16, h: 3 },
    ]);
    // Clamped: the union (x -5..11, y -4..4) moves right 7 and down 6.
    expect(boxes(near(3, 6), { width: 100, height: 60 })).toEqual([
      { x: 5, y: 6, w: 11, h: 4 },
      { x: 2, y: 2, w: 16, h: 3 },
    ]);
  });

  it('moves labels in from the right and bottom edges too, and leaves ones inside alone', () => {
    const pic = { width: 100, height: 60 };
    const right = boxes(near(97, 30), pic);
    expect(Math.max(...right.map((b) => b.x + b.w))).toBe(100 - LABEL_EDGE_MARGIN);
    const bottom = layoutLabels(
      [{ from: { tag: 'name:' }, as: 'text', font: 'f', anchor: 'bottom', offset: { x: 0, y: 2 } }],
      e,
      {},
      near(50, 57),
      fonts,
      pic,
    ).views[0]!.box;
    expect(bottom.y + bottom.h).toBe(60 - LABEL_EDGE_MARGIN);
    expect(boxes(near(50, 30), pic)).toEqual(boxes(near(50, 30)));
  });

  it('draws the moved boxes, and still shows nothing for a hidden anchor', () => {
    const { draws } = layoutLabels([labels[1]!], e, {}, near(3, 30), fonts, { width: 100, height: 60 });
    expect(draws).toEqual([{ kind: 'fill', x: 2, y: 25, w: 8, h: 3, color: '#00ff00' }]);
    expect(layoutLabels(labels, e, {}, () => null, fonts, { width: 100, height: 60 })).toEqual({
      draws: [],
      views: [],
    });
  });
});
