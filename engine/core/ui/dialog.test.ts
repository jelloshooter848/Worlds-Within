import { describe, expect, it } from 'vitest';
import { DialogBox, type DialogOptions } from './dialog';
import { buildFont, type FontLookup } from './font';
import { uiLook } from './look';
import { measureLine } from './text';
import type { UiEvent, UiInput } from './ui-input';

/** Every glyph a 3x4 block on a 3x5 cell (advance 4, line 7). */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,';
const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries([...CHARS].map((c) => [c, { rows: ['###', '###', '###', '###', '...'] }])),
});
const FONTS: FontLookup = (id) => (id === 't' ? FONT : null);
const LOOK = uiLook({ font: 't', rate: 2, typeEvery: 3 }, FONTS, (sheet, _p, frame) =>
  sheet === 'faces' && frame === 'pip' ? { w: 8, h: 8 } : null,
);

function dialog(opts: Partial<DialogOptions> = {}, box = { x: 8, y: 160, w: 120, h: 40 }): DialogBox {
  const d = new DialogBox({ id: 'talk', pages: ['Hi there'], ...opts }, LOOK);
  d.place(box);
  return d;
}

/** Steps `n` display frames with no input, gathering events. */
function run(d: DialogBox, n: number, input: UiInput = {}, start = 1): UiEvent[] {
  const out: UiEvent[] = [];
  for (let f = start; f < start + n; f++) out.push(...d.update(input, f));
  return out;
}

describe('dialog boxes: the typewriter (Engine 0.16 T7)', () => {
  it('types one character every `rate` frames, with a type event every `typeEvery`', () => {
    const d = dialog();
    expect(d.shown).toBe(0);
    const events = run(d, 6);
    expect(d.shown).toBe(3);
    expect(events).toEqual([{ type: 'type', widget: 'talk' }]);
    run(d, 100, {}, 7);
    expect(d.shown).toBe(7); // "Hi there": 7 glyphs, the space is not typed
    expect(d.typed).toBe(true);
    const glyphs = d.draws(200).filter((g) => g.kind === 'glyph');
    expect(glyphs).toHaveLength(7);
  });

  it('skips to the whole page on confirm, then is done on the next', () => {
    const d = dialog();
    run(d, 2);
    expect(d.update({ commands: ['confirm'] }, 3)).toEqual([{ type: 'skip', widget: 'talk' }]);
    expect(d.typed).toBe(true);
    expect(d.update({ commands: ['confirm'] }, 4)).toEqual([{ type: 'done', widget: 'talk' }]);
    expect(d.done).toBe(true);
    expect(d.update({ commands: ['confirm'] }, 5)).toEqual([]);
  });

  it('shows a page at once with rate 0', () => {
    const d = dialog({ rate: 0 });
    expect(d.typed).toBe(true);
  });

  it('breaks long text into pages at whole lines and turns them', () => {
    // 120 - 2 border - 8 padding = 110 px of text (27 characters a line), 30 px high: 4 lines.
    const words =
      'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen';
    const long = `${words} ${words}`;
    const d = dialog({ pages: [long, 'Bye'] });
    expect(d.textBox()).toEqual({ x: 13, y: 165, w: 110, h: 30 });
    expect(d.pageCount).toBe(3);
    const first = d.pageText().split('\n');
    expect(first.length).toBe(4);
    expect(first.every((l) => measureLine(FONT, l) <= 110)).toBe(true);
    d.advance();
    expect(d.update({ commands: ['confirm'] }, 1)).toEqual([{ type: 'page', widget: 'talk', page: 1 }]);
    expect(d.shown).toBe(0);
    d.advance();
    d.advance();
    expect(d.page).toBe(2);
    expect(d.pageText()).toBe('Bye');
  });

  it('skips and turns on a tap on the box, not on one outside it', () => {
    const d = dialog();
    expect(d.update({ taps: [{ x: 0, y: 0 }] }, 1)).toEqual([]);
    expect(d.update({ taps: [{ x: 20, y: 170 }] }, 2)).toEqual([{ type: 'skip', widget: 'talk' }]);
    expect(d.update({ taps: [{ x: 20, y: 170 }] }, 3)).toEqual([{ type: 'done', widget: 'talk' }]);
  });

  it('draws the speaker tab, the portrait in its frame and the more mark', () => {
    const d = dialog({ speaker: 'Pip', portrait: { sheet: 'faces', frame: 'pip' }, pages: ['A', 'B'] });
    // The portrait is a square the inner height (30), the text right of it.
    expect(d.portraitBox()).toEqual({ x: 13, y: 165, w: 30, h: 30 });
    expect(d.textBox().x).toBe(13 + 30 + 4);
    run(d, 4);
    const draws = d.draws(0);
    const image = draws.find((x) => x.kind === 'image');
    expect(image).toMatchObject({ sheet: 'faces', frame: 'pip', w: 24, h: 24, x: 16, y: 168 });
    // The tab's name sits above the box.
    const tabGlyph = draws.find((g) => g.kind === 'glyph' && g.ch === 'P')!;
    expect(tabGlyph.y).toBeLessThan(160);
    // The more mark blinks while the whole page waits.
    const marks = (frame: number) =>
      d.draws(frame).filter((x) => x.kind === 'fill' && x.w === 5 && x.h === 1);
    expect(marks(0)).toHaveLength(1);
    expect(marks(20)).toHaveLength(0);
  });
});

describe('dialog boxes: choices (Engine 0.16 T7)', () => {
  const choices = [
    { id: 'yes', label: 'Sure' },
    { id: 'no', label: 'Not now' },
  ];

  it('shows the choice list after the last page and takes a choice by actions', () => {
    const d = dialog({ choices });
    expect(d.choosing).toBe(false);
    d.advance();
    expect(d.choosing).toBe(true);
    // Confirm while choosing goes to the list, not the dialog.
    expect(d.advance()).toEqual([]);
    expect(d.update({ commands: ['down'] }, 1)).toEqual([{ type: 'focus', widget: 'talk', item: 'no' }]);
    expect(d.update({ commands: ['confirm'] }, 2)).toEqual([{ type: 'choice', widget: 'talk', item: 'no' }]);
    expect(d.done).toBe(true);
    // The list sits over the box's right edge.
    const list = d.choiceMenu!.box;
    expect(list.x + list.w).toBe(128);
    expect(list.y + list.h).toBeLessThan(160);
  });

  it('takes a tapped choice', () => {
    const d = dialog({ choices });
    d.advance();
    const box = d.choiceMenu!.itemBox('yes')!;
    const events = d.update({ taps: [{ x: box.x + 2, y: box.y + 2 }] }, 1);
    expect(events.at(-1)).toEqual({ type: 'choice', widget: 'talk', item: 'yes' });
  });

  it('starts again from the first page and choice on restart', () => {
    const d = dialog({ choices });
    d.advance();
    d.update({ commands: ['down', 'confirm'] }, 1);
    d.restart();
    expect(d.done).toBe(false);
    expect(d.shown).toBe(0);
    expect(d.choiceMenu!.focused).toBe('yes');
  });
});
