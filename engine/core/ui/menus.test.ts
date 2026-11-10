import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { buildFont, type FontLookup } from './font';
import {
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

/** Every glyph a 3x4 block on a 3x5 cell (inline fixture). */
const CHARS = `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?.,'()<>/${KEY_NAME_GLYPHS}`;
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
});
