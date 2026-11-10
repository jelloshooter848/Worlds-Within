import { describe, expect, it } from 'vitest';
import type { Action } from '../input/actions';
import { buildFont, type FontLookup } from './font';
import { uiLook } from './look';
import { Button, Menu, sliderValue } from './menu';
import type { UiDraw } from './paint';
import { UI_REPEAT_DELAY, UI_REPEAT_EVERY, UiNav, type UiCommand, type UiInput } from './ui-input';
import type { UiMenuItemSpec } from './ui-schema';

/** Every glyph of the test font is a 3x4 block on a 3x5 cell (advance 4, line 7). */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789>!?.,';
const TEST_FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries([...CHARS].map((c) => [c, { rows: ['###', '###', '###', '###', '...'] }])),
});
const TEST_FONTS: FontLookup = (id) => (id === 't' ? TEST_FONT : null);
const LOOK = uiLook({ font: 't', cursor: '>' }, TEST_FONTS, () => null);

const ITEMS: UiMenuItemSpec[] = [
  { id: 'start', label: 'Start' },
  { type: 'slider', id: 'vol', label: 'Volume', min: 0, max: 10, value: 5 },
  { type: 'toggle', id: 'shake', label: 'Shake' },
  { id: 'credits', label: 'Credits', disabled: true },
  { id: 'quit', label: 'Quit' },
];

function menu(more: Partial<ConstructorParameters<typeof Menu>[0]> = {}): Menu {
  const m = new Menu({ id: 'main', items: ITEMS, ...more }, LOOK);
  const size = m.size();
  m.place({ x: 10, y: 20, ...size });
  return m;
}

const cmds = (...commands: UiCommand[]): UiInput => ({ commands });
const centre = (b: { x: number; y: number; w: number; h: number }) => ({
  x: b.x + Math.floor(b.w / 2),
  y: b.y + Math.floor(b.h / 2),
});

describe('menus driven by actions (Engine 0.16 T7)', () => {
  it('moves the focus with up and down, skipping disabled items and wrapping', () => {
    const m = menu();
    expect(m.focused).toBe('start');
    const seen: (string | null)[] = [];
    for (let f = 1; f <= 5; f++) {
      m.update(cmds('down'), f);
      seen.push(m.focused);
    }
    expect(seen).toEqual(['vol', 'shake', 'quit', 'start', 'vol']);
    m.update(cmds('up'), 6);
    m.update(cmds('up'), 7);
    expect(m.focused).toBe('quit');
    expect(m.update(cmds('up'), 8)).toEqual([{ type: 'focus', widget: 'main', item: 'shake' }]);
  });

  it('stops at the ends without wrap', () => {
    const m = menu({ wrap: false });
    m.update(cmds('up'), 1);
    expect(m.focused).toBe('start');
    for (let f = 2; f < 10; f++) m.update(cmds('down'), f);
    expect(m.focused).toBe('quit');
  });

  it('steps a slider with left and right, clamped to its range, and flips a toggle', () => {
    const m = menu();
    m.update(cmds('down'), 1);
    expect(m.update(cmds('right'), 2)).toEqual([{ type: 'change', widget: 'main', item: 'vol', value: 6 }]);
    m.update(cmds('left', 'left', 'left'), 3);
    expect(m.value('vol')).toBe(3);
    for (let f = 4; f < 20; f++) m.update(cmds('right'), f);
    expect(m.value('vol')).toBe(10);
    // A slider at its end changes nothing and says nothing.
    expect(m.update(cmds('right'), 20)).toEqual([]);
    m.update(cmds('down'), 21);
    expect(m.value('shake')).toBe(false);
    expect(m.update(cmds('confirm'), 22)).toEqual([
      { type: 'change', widget: 'main', item: 'shake', value: true },
    ]);
    m.update(cmds('left'), 23);
    expect(m.value('shake')).toBe(false);
  });

  it('activates a button on confirm and reports back', () => {
    const m = menu();
    expect(m.update(cmds('confirm'), 1)).toEqual([{ type: 'activate', widget: 'main', item: 'start' }]);
    expect(m.update(cmds('back'), 2)).toEqual([{ type: 'back', widget: 'main' }]);
  });

  it('lays out a horizontal menu: left and right move, up and down change', () => {
    const m = menu({ direction: 'horizontal' });
    const boxes = m.itemBoxes();
    expect(boxes.every((b) => b.y === boxes[0]!.y)).toBe(true);
    expect(boxes[1]!.x).toBeGreaterThan(boxes[0]!.x + boxes[0]!.w - 1);
    m.update(cmds('right'), 1);
    expect(m.focused).toBe('vol');
    m.update(cmds('up'), 2);
    expect(m.value('vol')).toBe(6);
    m.update(cmds('down', 'down'), 3);
    expect(m.value('vol')).toBe(4);
  });

  it('snaps and clamps slider values to the steps', () => {
    const item = { type: 'slider', id: 's', label: 's', min: 0, max: 1, step: 0.1 } as const;
    expect(sliderValue(item, 0.34)).toBe(0.3);
    expect(sliderValue(item, 2)).toBe(1);
    expect(sliderValue(item, -1)).toBe(0);
    const m = new Menu({ id: 'm', items: [{ ...item, value: 0.7 }] }, LOOK);
    m.update(cmds('right', 'right'), 1);
    expect(m.value('s')).toBe(0.9);
    expect(m.setValue('s', 0.25)).toBe(true);
    expect(m.value('s')).toBe(0.3);
    expect(m.setValue('s', true)).toBe(false);
  });
});

describe('menus driven by the pointer and taps (Engine 0.16 T7)', () => {
  it('focuses the item the mouse moves onto (not a disabled one), once', () => {
    const m = menu();
    const quit = centre(m.itemBox('quit')!);
    expect(m.update({ pointer: quit }, 1)).toEqual([{ type: 'focus', widget: 'main', item: 'quit' }]);
    // The keyboard moves on; a mouse that stays still does not take the focus back.
    m.update({ pointer: quit, commands: ['up'] }, 2);
    expect(m.focused).toBe('shake');
    expect(m.update({ pointer: centre(m.itemBox('credits')!) }, 3)).toEqual([]);
    expect(m.focused).toBe('shake');
    expect(m.update({ pointer: { x: 0, y: 0 } }, 4)).toEqual([]);
  });

  it('takes a tapped button, ignores a disabled one and taps outside', () => {
    const m = menu();
    expect(m.update({ taps: [centre(m.itemBox('quit')!)] }, 1)).toEqual([
      { type: 'focus', widget: 'main', item: 'quit' },
      { type: 'activate', widget: 'main', item: 'quit' },
    ]);
    expect(m.update({ taps: [centre(m.itemBox('credits')!), { x: 500, y: 500 }] }, 2)).toEqual([]);
  });

  it('sets a slider where its track is tapped and flips a tapped toggle', () => {
    const m = menu();
    const row = m.itemBox('vol')!;
    // The track sits right of the label, before the value text: find its ends by tapping along.
    const values = new Set<number>();
    for (let x = row.x; x < row.x + row.w; x++) {
      m.update({ taps: [{ x, y: row.y + 2 }] }, x);
      values.add(m.value('vol') as number);
    }
    expect(values.has(0)).toBe(true);
    expect(values.has(10)).toBe(true);
    expect(m.focused).toBe('vol');
    m.update({ taps: [centre(m.itemBox('shake')!)] }, 999);
    expect(m.value('shake')).toBe(true);
  });
});

describe('UiNav: commands from actions (Engine 0.16 T7)', () => {
  function frame(pressed: Action[], held: Action[] = pressed) {
    return { pressed: (a: Action) => pressed.includes(a), held: (a: Action) => held.includes(a) };
  }

  it('maps presses to commands and repeats a held direction, never confirm', () => {
    const nav = new UiNav();
    expect(nav.commands(frame(['down', 'jump']))).toEqual(['down', 'confirm']);
    expect(nav.commands(frame(['start']))).toEqual(['confirm']);
    expect(nav.commands(frame(['attack']))).toEqual(['back']);
    const repeats: number[] = [];
    nav.commands(frame(['right', 'jump']));
    for (let f = 1; f <= UI_REPEAT_DELAY + 2 * UI_REPEAT_EVERY; f++) {
      const got = nav.commands(frame([], ['right', 'jump']));
      expect(got).not.toContain('confirm');
      if (got.includes('right')) repeats.push(f);
    }
    expect(repeats).toEqual([
      UI_REPEAT_DELAY,
      UI_REPEAT_DELAY + UI_REPEAT_EVERY,
      UI_REPEAT_DELAY + 2 * UI_REPEAT_EVERY,
    ]);
    // Released, the count starts again.
    nav.commands(frame([]));
    expect(nav.commands(frame([], ['right']))).toEqual([]);
  });
});

describe('menu drawing and tweens (Engine 0.16 T7)', () => {
  const fillsAt = (draws: UiDraw[], color: string) =>
    draws.filter((d) => d.kind === 'fill' && d.color === color);

  it('draws the focus bar, the cursor and the focus slide tween, then settles', () => {
    const m = menu();
    m.update(cmds('down'), 1);
    const bar = (frame: number) => fillsAt(m.draws(frame), LOOK.focusBack)[0]!;
    const box = m.itemBox('vol')!;
    expect(bar(1).x).toBe(box.x + 3);
    expect(bar(2).x).toBeGreaterThan(box.x);
    expect(bar(7).x).toBe(box.x);
    expect(m.draws(7).some((d) => d.kind === 'glyph' && d.ch === '>' && d.color === LOOK.focusText)).toBe(
      true,
    );
    // Unfocused (another widget holds the focus): no bar.
    expect(fillsAt(m.draws(7, false), LOOK.focusBack)).toEqual([]);
  });

  it('flashes and dips a pressed item, and greys a disabled one', () => {
    const m = menu();
    m.update(cmds('confirm'), 10);
    const glyphs = (f: number) => m.draws(f).filter((d) => d.kind === 'glyph' && d.ch === 'S');
    const pressed = glyphs(11)[0]!;
    const rest = glyphs(30)[0]!;
    expect(pressed.y).toBe(rest.y + 1);
    expect(pressed.kind === 'glyph' && pressed.color).not.toBe(LOOK.focusText);
    const credits = m.draws(30).filter((d) => d.kind === 'glyph' && d.ch === 'C')[0]!;
    expect(credits.kind === 'glyph' && credits.color).toBe(LOOK.disabledText);
  });

  it('makes a button a one-item menu on a panel', () => {
    const b = new Button('ok', 'Ok', LOOK);
    b.place({ x: 0, y: 0, ...b.size() });
    expect(b.update({ taps: [centre(b.itemBox('ok')!)] }, 1).at(-1)).toEqual({
      type: 'activate',
      widget: 'ok',
      item: 'ok',
    });
    const off = new Button('no', 'No', LOOK, true);
    off.place({ x: 0, y: 0, ...off.size() });
    expect(off.update(cmds('confirm'), 1)).toEqual([]);
  });
});
