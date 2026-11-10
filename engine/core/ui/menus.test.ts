import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { buildFont, type FontLookup } from './font';
import {
  clearScreen,
  endScreen,
  formatTicks,
  levelChoices,
  levelItemStage,
  levelsScreen,
  statText,
  controlRows,
  controlsScreen,
  KEY_NAME_GLYPHS,
  menuHint,
  menusSchema,
  pauseScreen,
  settingsScreen,
  titleScreen,
  type MenuBuildContext,
  type MenuSettingsValues,
  type MenusSpec,
} from './menus';
import { UiScreen } from './screen';
import { layoutText } from './text';

/** Every glyph a 3x4 block on a 3x5 cell (inline fixture). */
const CHARS = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,'()<>/:${KEY_NAME_GLYPHS}`;
const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries(
    [...new Set(CHARS)].map((c) => [c, { rows: ['###', '###', '###', '###', '...'] }]),
  ),
});
const FONTS: FontLookup = (id) => (id === 't' ? FONT : null);
const KEYS = { left: '←', right: '→', up: '↑', down: '↓', jump: 'Z', attack: 'X', start: 'ENTER' } as const;
const CTX: MenuBuildContext = {
  screen: { width: 256, height: 240 },
  fonts: FONTS,
  frameSize: (sheet, _p, frame) => (sheet === 'art' && frame === 'hero' ? { w: 16, h: 16 } : null),
  keys: KEYS,
};
const VALUES: MenuSettingsValues = {
  master: 0.4,
  music: 1,
  sfx: 0.5,
  muted: false,
  shake: 1,
  reduceFlashing: true,
  colour: 0,
  touch: 2,
};

const SPEC: MenusSpec = menusSchema.parse({
  font: 't',
  title: {
    name: 'Hop',
    subtitle: 'A test',
    art: [{ sheet: 'art', frame: 'hero', scale: 2, anchor: 'left', x: 8 }],
    items: ['start', 'continue', 'controls', 'settings'],
  },
  pause: { items: ['resume', 'controls', 'settings', 'title'] },
  labels: { start: 'New game' },
  controls: [
    { actions: ['left', 'right'], label: 'Walk' },
    { actions: ['jump', 'attack'], label: 'Act' },
    { label: 'Point', tap: 'a tap' },
  ],
});

const items = (file: ReturnType<typeof titleScreen>) =>
  file.widgets.flatMap((w) => (w.type === 'menu' ? w.items.map((i) => i.id) : []));

describe('menus (Engine 0.16 T9)', () => {
  it('builds a title screen: the name, the art, the menu with its labels, Continue only with a save', () => {
    const file = titleScreen(SPEC, CTX, { canContinue: false });
    expect(items(file)).toEqual(['start', 'controls', 'settings']);
    expect(items(titleScreen(SPEC, CTX, { canContinue: true }))).toEqual([
      'start',
      'continue',
      'controls',
      'settings',
    ]);
    const texts = file.widgets.flatMap((w) => (w.type === 'text' ? [w.text] : []));
    expect(texts).toEqual(['Hop', 'A test', '↑↓ choose   Z select']);
    expect(file.widgets.find((w) => w.type === 'image')).toMatchObject({
      sheet: 'art',
      frame: 'hero',
      scale: 2,
    });
    const ui = new UiScreen(file, { screen: CTX.screen, fonts: FONTS, frameSize: CTX.frameSize });
    expect(ui.focused).toBe('main');
    expect(ui.menu('main')!.items[0]!.label).toBe('New game');
    expect(ui.box('#3')).toEqual({ x: 8, y: 104, w: 32, h: 32 }); // the art, twice its 16 px
    expect(ui.draws().some((d) => d.kind === 'image' && d.frame === 'hero' && d.w === 32)).toBe(true);
  });

  it('builds the pause, settings and controls screens', () => {
    const pause = new UiScreen(pauseScreen(SPEC, CTX), { screen: CTX.screen, fonts: FONTS });
    expect(pause.menu('main')!.items.map((i) => i.label)).toEqual([
      'Resume',
      'Controls',
      'Settings',
      'Back to title',
    ]);
    const settings = new UiScreen(settingsScreen(SPEC, CTX, VALUES), { screen: CTX.screen, fonts: FONTS });
    const menu = settings.menu('main')!;
    expect(menu.items.map((i) => i.id)).toEqual([
      'master',
      'music',
      'sfx',
      'mute',
      'shake',
      'flashing',
      'touch',
      'back',
    ]);
    expect([menu.value('master'), menu.value('sfx'), menu.value('flashing'), menu.value('touch')]).toEqual([
      4,
      5,
      true,
      2,
    ]);
    // The colour item shows only with the game's modes.
    const coloured = settingsScreen(
      { ...SPEC, settings: { items: ['colour', 'mute'] } },
      CTX,
      { ...VALUES, colour: 1 },
      { colourModes: ['Default', 'Deuteranopia'] },
    );
    expect(items(coloured)).toEqual(['colour', 'mute', 'back']);
    expect(items(settingsScreen({ ...SPEC, settings: { items: ['colour', 'mute'] } }, CTX, VALUES))).toEqual([
      'mute',
      'back',
    ]);
    const controls = controlsScreen(SPEC, CTX);
    expect(controls.widgets.flatMap((w) => (w.type === 'text' ? [w.text] : []))).toContain('ESC / P');
    expect(items(controls)).toEqual(['back']);
  });

  it('writes the controls with the player keys and the hints', () => {
    expect(controlRows(SPEC.controls!, KEYS)).toEqual([
      { label: 'Walk', keys: '←→' },
      { label: 'Act', keys: 'Z / X' },
      { label: 'Point', keys: 'a tap' },
      { label: 'Pause', keys: 'ESC / P' },
    ]);
    expect(menuHint(KEYS, true)).toBe('↑↓ choose   ←→ change   Z select   X back');
  });

  it('refuses unknown items, a title without a name or logo, and a control without actions or tap', () => {
    const bad = menusSchema.safeParse({
      font: 't',
      title: { items: ['start', 'quit', 'start'] },
      pause: { items: ['resume'] },
      labels: { begin: 'Go' },
      controls: [{ label: 'Nothing' }],
    });
    expect(bad.success).toBe(false);
    const issues = bad.error!.issues.map((i) => [
      i.path.join('.'),
      (i as { params?: { code?: string } }).params?.code,
    ]);
    expect(issues).toEqual(
      expect.arrayContaining([
        ['title.items.1', 'unknown_menu_item'],
        ['title.items.2', 'unknown_menu_item'],
        ['title.name', 'missing_field'],
        ['labels.begin', 'unknown_menu_item'],
        ['controls.0.actions', 'missing_field'],
      ]),
    );
  });
});

describe('level select, level clear and end screens (Engine 0.16 part B, T3)', () => {
  const B = menusSchema.parse({
    font: 't',
    title: { name: 'Hop', items: ['start', 'levels'] },
    pause: { items: ['resume'] },
    levels: { heading: 'Map', mark: '(ok)' },
    clear: { heading: 'Clear!', lines: [{ label: 'Flags', status: 'checkpoints', of: 'checkpointCount' }] },
    end: { credits: 'By us', items: ['title', 'levels'] },
  });
  const glyphs = (file: ReturnType<typeof titleScreen>) =>
    new UiScreen(file, { screen: CTX.screen, fonts: FONTS })
      .draws()
      .filter((d) => 'ch' in d)
      .map((d) => (d as { ch: string }).ch)
      .join('');

  it('formats stats: numbers, ticks as m:ss, an of key and a missing key', () => {
    expect(formatTicks(0)).toBe('0:00');
    expect(formatTicks(3725)).toBe('1:02');
    const status = { coins: 4, time: 600, checkpoints: 1, checkpointCount: 3 };
    expect(statText({ label: 'C', status: 'coins' }, status)).toBe('4');
    expect(statText({ label: 'T', status: 'time', format: 'time' }, status)).toBe('0:10');
    expect(statText({ label: 'K', status: 'checkpoints', of: 'checkpointCount' }, status)).toBe('1/3');
    expect(statText({ label: 'X', status: 'nope' }, status)).toBe('-');
  });

  it('locks a level until the one before it is cleared, unless lock is off', () => {
    const levels = [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C' },
    ];
    expect(levelChoices(B, levels, new Set(['a'])).map((l) => [l.cleared, l.locked])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    const open = menusSchema.parse({ ...B, levels: { lock: false } });
    expect(levelChoices(open, levels, new Set()).every((l) => !l.locked)).toBe(true);
    expect([levelItemStage('level-2'), levelItemStage('back'), levelItemStage(null)]).toEqual([
      2,
      null,
      null,
    ]);
  });

  it('builds the level select, the clear banner and the end screen from the spec', () => {
    const levels = levelsScreen(B, CTX, [
      { id: 'a', name: 'Meadow', cleared: true, locked: false },
      { id: 'b', name: 'Caves', cleared: false, locked: true },
    ]);
    const ui = new UiScreen(levels, { screen: CTX.screen, fonts: FONTS });
    expect(ui.menu('main')!.items.map((i) => [i.id, i.label, i.disabled ?? false])).toEqual([
      ['level-0', 'Meadow (ok)', false],
      ['level-1', 'Caves', true],
      ['back', 'Back', false],
    ]);
    expect(glyphs(levels)).toContain('Map');
    const clear = clearScreen(B, CTX, { checkpoints: 2, checkpointCount: 3 });
    expect(clear.focus).toBeUndefined();
    expect(clear.widgets.some((w) => w.type === 'menu')).toBe(false);
    expect(glyphs(clear)).toContain('Clear');
    expect(glyphs(clear)).toContain('2/3');
    const end = endScreen(B, CTX, { coins: 12, time: 7200, deaths: 1 });
    const endUi = new UiScreen(end, { screen: CTX.screen, fonts: FONTS });
    expect(endUi.menu('main')!.items.map((i) => i.id)).toEqual(['title', 'levels']);
    expect(glyphs(end)).toContain('By');
    expect(glyphs(end)).toContain('12');
    expect(glyphs(end)).toContain('2:00');
    // A title without levels from the page hides the item.
    const title = new UiScreen(titleScreen(B, CTX, { canContinue: false, hasLevels: false }), {
      screen: CTX.screen,
      fonts: FONTS,
    });
    expect(title.menu('main')!.items.map((i) => i.id)).toEqual(['start']);
  });

  it('widens a framed screen so a long heading stays inside its panel (part B, T11)', () => {
    const panelW = (file: ReturnType<typeof titleScreen>) =>
      file.widgets.find((w) => w.type === 'panel' && w.anchor === 'top')!.w!;
    const long = 'A heading far wider than the panel of the end screen';
    const headW = layoutText(FONT, long).width;
    expect(headW + 32).toBeGreaterThan(200);
    const wide = menusSchema.parse({ ...B, end: { heading: long }, clear: { heading: long } });
    expect(panelW(endScreen(B, CTX, {}))).toBe(200);
    expect(panelW(endScreen(wide, CTX, {}))).toBe(headW + 32);
    expect(panelW(clearScreen(wide, CTX, {}))).toBe(headW + 32);
    // Never wider than the picture less 8 px.
    const huge = menusSchema.parse({ ...B, end: { heading: long + long } });
    expect(panelW(endScreen(huge, CTX, {}))).toBe(CTX.screen.width - 8);
  });

  it('refuses an unknown end item and a bad stat format', () => {
    const bad = menusSchema.safeParse({
      ...B,
      end: { items: ['quit'] },
      clear: { lines: [{ label: 'X', status: 'x', format: 'hours' }] },
    });
    expect(bad.success).toBe(false);
    expect(bad.error!.issues.map((i) => i.path.join('.'))).toEqual(
      expect.arrayContaining(['end.items.0', 'clear.lines.0.format']),
    );
  });
});

describe("validate: game.json's menus (Engine 0.16 T9)", () => {
  /** A game with a font (A-Z, a-z and the key glyphs), a sprite and a song. */
  function game(menus: unknown): Record<string, string> {
    const glyph = (ch: string) => `glyph ${ch}\n#\n#\n`;
    return {
      'game.json': JSON.stringify({
        id: 'g',
        kit: 'topdown',
        content: {
          font: ['fonts/*.txt'],
          sprite: ['sprites/*.json'],
          palette: ['palettes/*.json'],
          song: ['songs/*.json'],
        },
        start: { seed: 1 },
        menus,
        headless: 'headless.ts',
      }),
      'fonts/small.txt': [
        'cell 1 2',
        'baseline 2',
        '',
        ...[
          ...new Set(`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789>()<${KEY_NAME_GLYPHS}`),
        ].map(glyph),
      ].join('\n'),
      'sprites/art.json': JSON.stringify({ palette: 'art', frames: { hero: ['0'] } }),
      'palettes/art.json': JSON.stringify({ id: 'art', colors: ['#000'] }),
      'songs/tune.json': JSON.stringify({ id: 'tune', bpm: 120, loop: true, pulse1: 'l4 c' }),
    };
  }
  const good = {
    font: 'small',
    title: {
      name: 'Hop',
      music: 'tune',
      art: [{ sheet: 'art', frame: 'hero' }],
      items: ['start', 'settings'],
    },
    pause: { items: ['resume', 'settings', 'title'] },
  };

  it("reports an end screen's music the game lacks (Engine 0.16 part B)", () => {
    // The test font has no ":" or "-" for the stat digits: only the music refs are looked at.
    const refs = (music: string) =>
      loadContent(
        game({ ...good, end: { heading: 'The end', items: ['title'], music } }),
        engineContentKinds(),
      )
        .errors.filter((e) => e.code === 'missing_ref')
        .map((e) => e.path);
    expect(refs('tune')).toEqual([]);
    expect(refs('jingle')).toEqual(['menus.end.music']);
  });

  it('passes a good menus block', () => {
    expect(loadContent(game(good), engineContentKinds()).errors).toEqual([]);
  });

  it('reports unknown items at their field', () => {
    const r = loadContent(game({ ...good, pause: { items: ['resume', 'quit'] } }), engineContentKinds(), {
      root: 'games/g/',
    });
    expect(r.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/game.json', 'menus.pause.items.1', 'unknown_menu_item'],
    ]);
  });

  it('reports missing fonts, glyphs, frames, songs and a controls item without controls', () => {
    const r = loadContent(
      game({
        ...good,
        titleFont: 'big',
        style: { sounds: { move: 'tick' } },
        title: {
          name: 'Hop!',
          music: 'song',
          art: [{ sheet: 'art', frame: 'villain' }],
          items: ['start', 'controls'],
        },
      }),
      engineContentKinds(),
    );
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['menus.titleFont', 'missing_ref'],
      ['menus.title.art.0.frame', 'missing_frame'],
      ['menus.title.music', 'missing_ref'],
      ['menus.style.sounds.move', 'missing_ref'],
      ['menus.controls', 'missing_field'],
    ]);
    const glyphs = loadContent(
      game({ ...good, title: { ...good.title, subtitle: 'Ünï' } }),
      engineContentKinds(),
    );
    expect(glyphs.errors.map((e) => [e.path, e.code, e.message])).toEqual([
      ['menus.title.subtitle', 'missing_glyph', 'font "small" has no glyph for "Ü", "ï"'],
    ]);
  });

  it('checks the glyphs of the level select, the clear banner and the end screen (Engine 0.16 part B)', () => {
    const r = loadContent(
      game({
        ...good,
        title: { ...good.title, items: ['start', 'levels'] },
        clear: { heading: 'Done!', lines: [{ label: 'Coins', status: 'coins' }] },
        end: { credits: 'Thanks for playing' },
      }),
      engineContentKinds(),
    );
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['menus.levels', 'missing_glyph'],
      ['menus.clear', 'missing_glyph'],
      ['menus.clear', 'missing_glyph'],
      ['menus.end', 'missing_glyph'],
    ]);
    expect(r.errors.map((e) => e.message)).toEqual([
      'font "small" has no glyph for "*"',
      'font "small" has no glyph for "!"',
      'font "small" has no glyph for ":", "-"',
      'font "small" has no glyph for ":", "-"',
    ]);
  });
});
