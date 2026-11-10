import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { buildFont, type FontLookup } from './font';
import { anchorBox, UiScreen } from './screen';
import type { UiCommand, UiEvent, UiInput } from './ui-input';
import type { UiScreenFile } from './ui-schema';

/** Every glyph a 3x4 block on a 3x5 cell (advance 4, line 7). */
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,>';
const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries([...CHARS].map((c) => [c, { rows: ['###', '###', '###', '###', '...'] }])),
});
const FONTS: FontLookup = (id) => (id === 't' ? FONT : null);
const SCREEN = { width: 256, height: 240 };

const FILE: UiScreenFile = {
  style: {
    font: 't',
    cursor: '>',
    rate: 1,
    sounds: { move: 'tick', select: 'pick', back: 'back', type: 'blip' },
  },
  focus: 'main',
  widgets: [
    { type: 'panel', anchor: 'top', y: 8, w: 100, h: 20 },
    { type: 'text', anchor: 'top', y: 14, text: 'Title' },
    {
      id: 'main',
      type: 'menu',
      anchor: 'center',
      items: [
        { id: 'start', label: 'Start' },
        { id: 'options', label: 'Options', opens: 'opts' },
        { id: 'talk', label: 'Talk', opens: 'intro' },
      ],
    },
    {
      id: 'opts',
      type: 'menu',
      anchor: 'right',
      x: 8,
      hidden: true,
      items: [
        { type: 'slider', id: 'vol', label: 'Vol', value: 3 },
        { type: 'toggle', id: 'shake', label: 'Shake', value: true },
      ],
    },
    {
      id: 'intro',
      type: 'dialog',
      hidden: true,
      speaker: 'Pip',
      pages: ['Hello', 'Ready?'],
      choices: [
        { id: 'yes', label: 'Yes', next: 'main' },
        { id: 'no', label: 'No' },
      ],
    },
    { id: 'ok', type: 'button', anchor: 'bottom-right', x: 4, y: 4, label: 'Ok' },
  ],
};

function screen(file: UiScreenFile = FILE, sounds: string[] = []): UiScreen {
  return new UiScreen(file, { screen: SCREEN, fonts: FONTS, onSound: (id) => sounds.push(id) });
}

const press = (s: UiScreen, ...commands: UiCommand[]): UiEvent[] => s.update({ commands });
const centre = (b: { x: number; y: number; w: number; h: number }) => ({
  x: b.x + Math.floor(b.w / 2),
  y: b.y + Math.floor(b.h / 2),
});

describe('UI screens from text (Engine 0.16 T7)', () => {
  it('places widgets by their anchors', () => {
    const size = { w: 40, h: 20 };
    expect(anchorBox('top-left', { x: 3, y: 4 }, size, SCREEN)).toEqual({ x: 3, y: 4, ...size });
    expect(anchorBox('bottom-right', { x: 3, y: 4 }, size, SCREEN)).toEqual({ x: 213, y: 216, ...size });
    expect(anchorBox('center', { x: 0, y: -10 }, size, SCREEN)).toEqual({ x: 108, y: 100, ...size });
    expect(anchorBox('top', { x: 0, y: 2 }, size, SCREEN)).toEqual({ x: 108, y: 2, ...size });
    expect(anchorBox('right', { x: 8, y: 0 }, size, SCREEN)).toEqual({ x: 208, y: 110, ...size });
    const s = screen();
    expect(s.box('ok')).toMatchObject({ x: 256 - 4 - s.box('ok')!.w, y: 240 - 4 - s.box('ok')!.h });
    // A dialog without `w` spans the picture less its margins, at the bottom.
    expect(s.box('intro')).toMatchObject({ x: 8, w: 240 });
    expect(s.box('intro')!.y + s.box('intro')!.h).toBe(232);
  });

  it('focuses the `focus` widget and drives it by commands, with sounds', () => {
    const sounds: string[] = [];
    const s = screen(FILE, sounds);
    expect(s.focused).toBe('main');
    expect(press(s, 'down')).toEqual([{ type: 'focus', widget: 'main', item: 'options' }]);
    expect(sounds).toEqual(['tick']);
  });

  it('opens a widget from an item, edits it, and goes back on `back`', () => {
    const s = screen();
    press(s, 'down');
    expect(press(s, 'confirm')).toEqual([
      { type: 'activate', widget: 'main', item: 'options' },
      { type: 'open', widget: 'opts' },
    ]);
    expect(s.focused).toBe('opts');
    press(s, 'right');
    expect(s.value('opts', 'vol')).toBe(4);
    press(s, 'down');
    press(s, 'confirm');
    expect(s.value('opts', 'shake')).toBe(false);
    expect(press(s, 'back')).toEqual([
      { type: 'back', widget: 'opts' },
      { type: 'close', widget: 'opts' },
    ]);
    expect(s.focused).toBe('main');
    expect(s.visible('opts')).toBe(false);
    // `back` on the first widget only reports it.
    expect(press(s, 'back')).toEqual([{ type: 'back', widget: 'main' }]);
  });

  it('plays a dialog to its choice, typed by frames, and follows the choice', () => {
    const sounds: string[] = [];
    const s = screen(FILE, sounds);
    press(s, 'down', 'down');
    press(s, 'confirm');
    expect(s.focused).toBe('intro');
    // rate 1: five frames type "Hello".
    for (let i = 0; i < 5; i++) s.update({});
    expect(s.dialog('intro')!.typed).toBe(true);
    expect(sounds).toContain('blip');
    press(s, 'confirm'); // next page
    press(s, 'confirm'); // skip
    expect(s.dialog('intro')!.choosing).toBe(true);
    press(s, 'confirm'); // "yes"
    expect(s.visible('intro')).toBe(false);
    expect(s.focused).toBe('main');
  });

  it('gives the focus back when a dialog ends without a next', () => {
    const s = screen();
    press(s, 'down', 'down');
    press(s, 'confirm');
    press(s, 'confirm');
    press(s, 'confirm');
    press(s, 'confirm');
    press(s, 'down');
    const events = press(s, 'confirm');
    expect(events).toContainEqual({ type: 'choice', widget: 'intro', item: 'no' });
    expect(events).toContainEqual({ type: 'close', widget: 'intro' });
    expect(s.focused).toBe('main');
  });

  it('routes taps to the widget under them and hover to menus', () => {
    const s = screen();
    // The mouse over "Talk" focuses it; a click on the Ok button takes that button.
    expect(s.update({ pointer: centre(s.itemBox('main', 'talk')!) })).toEqual([
      { type: 'focus', widget: 'main', item: 'talk' },
    ]);
    const ok = s.update({ taps: [centre(s.box('ok')!)] });
    expect(ok).toContainEqual({ type: 'activate', widget: 'ok', item: 'ok' });
    expect(s.focused).toBe('ok');
    // A tap on "Talk" opens the dialog; while it is open, taps elsewhere do nothing.
    s.update({ taps: [centre(s.itemBox('main', 'talk')!)] });
    expect(s.focused).toBe('intro');
    expect(s.update({ taps: [centre(s.box('ok')!)] })).toEqual([]);
    expect(s.update({ taps: [centre(s.box('intro')!)] })).toEqual([{ type: 'skip', widget: 'intro' }]);
  });

  it('draws only the shown widgets, in file order', () => {
    const s = screen();
    const before = s.draws();
    expect(before.length).toBeGreaterThan(0);
    s.open('intro');
    for (let i = 0; i < 5; i++) s.update({});
    const after = s.draws();
    expect(after.length).toBeGreaterThan(before.length);
    // The dialog's glyphs come after the menu's.
    const firstDialogGlyph = after.findIndex((d) => d.kind === 'glyph' && d.ch === 'H');
    const menuGlyphs = after.map((d, i) => (d.kind === 'glyph' && d.ch === 'T' && d.y < 140 ? i : -1));
    const lastMenuGlyph = Math.max(...menuGlyphs);
    expect(firstDialogGlyph).toBeGreaterThan(lastMenuGlyph);
  });

  it('refuses a screen with a bad widget reference', () => {
    expect(() => screen({ ...FILE, focus: 'nope' })).toThrow(/focus: no widget "nope"/);
  });

  it('is the same picture for the same input (frames, not clocks)', () => {
    const script: UiInput[] = [
      { commands: ['down'] },
      {},
      { commands: ['confirm'] },
      {},
      {},
      { taps: [{ x: 1, y: 1 }] },
    ];
    const play = () => {
      const s = screen();
      for (const i of script) s.update(i);
      return JSON.stringify(s.draws());
    };
    expect(play()).toBe(play());
  });
});

describe('the ui content kind (Engine 0.16 T7)', () => {
  /** A game with one ui screen, a font with `A-Z`, `a-z` and `>` and one sfx. */
  function game(ui: unknown): Record<string, string> {
    const glyph = (ch: string) => `glyph ${ch}\n#\n#\n`;
    return {
      'game.json': JSON.stringify({
        id: 'g',
        kit: 'topdown',
        content: {
          ui: ['ui/*.json'],
          font: ['fonts/*.txt'],
          sfx: ['sfx/*.json'],
          sprite: ['sprites/*.json'],
          palette: ['palettes/*.json'],
        },
        start: { seed: 1 },
        headless: 'headless.ts',
      }),
      'ui/title.json': JSON.stringify(ui),
      'fonts/small.txt': [
        'cell 1 2',
        'baseline 2',
        '',
        ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789>'].map(glyph),
      ].join('\n'),
      'sfx/tick.json': JSON.stringify({ id: 'tick', pulse: 'l32 c' }),
      'sprites/ui.json': JSON.stringify({ palette: 'ui', frames: { panel: ['0'] } }),
      'palettes/ui.json': JSON.stringify({ id: 'ui', colors: ['#000'] }),
    };
  }

  const good = {
    style: {
      font: 'small',
      cursor: '>',
      sounds: { move: 'tick' },
      panel: { sheet: 'ui', frame: 'panel', slice: 0 },
    },
    focus: 'main',
    widgets: [
      { id: 'main', type: 'menu', anchor: 'center', items: [{ id: 'go', label: 'Go', opens: 'talk' }] },
      {
        id: 'talk',
        type: 'dialog',
        hidden: true,
        pages: ['Hi'],
        choices: [{ id: 'ok', label: 'Ok', next: 'main' }],
      },
    ],
  };

  it('validates a screen', () => {
    const r = loadContent(game(good), engineContentKinds());
    expect(r.errors).toEqual([]);
  });

  it('reports a bad widget reference with its path', () => {
    const bad = structuredClone(good) as typeof good & { widgets: { items?: { opens?: string }[] }[] };
    bad.focus = 'mian';
    bad.widgets[0]!.items![0]!.opens = 'tlak';
    (bad.widgets[1] as { choices: { next: string }[] }).choices[0]!.next = 'gone';
    const r = loadContent(game(bad), engineContentKinds(), { root: 'games/g/' });
    expect(r.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/ui/title.json', 'focus', 'unknown_widget'],
      ['games/g/ui/title.json', 'widgets.0.items.0.opens', 'unknown_widget'],
      ['games/g/ui/title.json', 'widgets.1.choices.0.next', 'unknown_widget'],
    ]);
    expect(r.errors[0]!.message).toBe('no widget "mian" in this screen (ids: "main", "talk")');
  });

  it('reports duplicate ids, missing fonts, glyphs, sounds and frames, and bad fields', () => {
    const bad = {
      style: { font: 'small', sounds: { move: 'tock' }, panel: { sheet: 'ui', frame: 'pane', slice: 1 } },
      widgets: [
        { id: 'a', type: 'text', text: 'Hi!', font: 'big' },
        { id: 'a', type: 'dialog', pages: ['Hey?'], portrait: { sheet: 'faces', frame: 'pip' } },
      ],
    };
    const r = loadContent(game(bad), engineContentKinds());
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['widgets.1.id', 'duplicate_widget'],
      ['widgets.0.font', 'missing_ref'],
      ['widgets.1.pages.0', 'missing_glyph'],
      ['style.sounds.move', 'missing_ref'],
      ['style.panel.frame', 'missing_frame'],
      ['widgets.1.portrait.sheet', 'missing_ref'],
    ]);
    const fields = loadContent(
      game({ style: { font: 'small' }, widgets: [{ type: 'menu', anchor: 'middle', items: [] }] }),
      engineContentKinds(),
    );
    expect(fields.errors.map((e) => e.path)).toEqual(['widgets.0.anchor', 'widgets.0.items']);
  });
});
