import { describe, expect, it } from 'vitest';
import type { Action } from '../input/actions';
import { ActionState } from '../input/input-manager';
import { SceneStack, type Scene } from '../scene';
import { buildFont, KEY_NAME_GLYPHS, menusSchema, type MenuSettingsValues } from '../ui';
import { GameMenus, type GameMenusOptions } from './game-menus';
import { titleFromQuery } from './boot';
import { UiScene } from './ui-scene';

/** Every glyph a 3x4 block on a 3x5 cell (inline fixture). */
const FONT = buildFont('t', {
  cell: { w: 3, h: 5 },
  baseline: 4,
  glyphs: Object.fromEntries(
    [...new Set(`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789<>/'${KEY_NAME_GLYPHS}`)].map(
      (c) => [c, { rows: ['###', '###', '###', '###', '...'] }],
    ),
  ),
});

const SPEC = menusSchema.parse({
  font: 't',
  title: { name: 'Hop', music: 'title-song', items: ['start', 'continue', 'controls', 'settings'] },
  pause: { items: ['resume', 'controls', 'settings', 'title'] },
  controls: [{ actions: ['jump'], label: 'Jump' }],
});

/** The game's scene: counts its steps (the ticks it takes). */
class Game implements Scene {
  steps = 0;
  update(): void {
    this.steps++;
  }
  render(): void {}
}

function setup(opts: Partial<GameMenusOptions> = {}) {
  const stack = new SceneStack();
  const game = new Game();
  stack.push(game);
  const changes: [string, number | boolean][] = [];
  const music: (string | null)[] = [];
  const log: string[] = [];
  const values: MenuSettingsValues = {
    master: 0.4,
    music: 1,
    sfx: 1,
    muted: false,
    shake: 1,
    reduceFlashing: false,
    colour: 0,
    touch: 0,
  };
  const menus = new GameMenus({
    spec: SPEC,
    stack,
    screen: { width: 256, height: 240 },
    fonts: (id) => (id === 't' ? FONT : null),
    frameSize: () => null,
    painter: () => ({ fill() {}, image() {}, glyph() {} }),
    keys: () => ({ up: '↑', down: '↓', jump: 'Z', attack: 'X' }),
    settings: { values: () => values, change: (item, value) => changes.push([item, value]) },
    transition: (what, covered) => {
      log.push(`transition ${String(what)}`);
      covered();
      return true;
    },
    music: (id) => music.push(id),
    restart: () => {
      log.push('restart');
      stack.clear();
      stack.push(new Game());
      menus.showTitle();
    },
    ...opts,
  });
  /** One loop step with these actions pressed (the boot's `scenes.update`). */
  const press = (...actions: Action[]) => {
    const frame = new ActionState();
    frame.beginFrame(new Set(actions));
    stack.update([frame]);
    const none = new ActionState();
    none.beginFrame(new Set());
    stack.update([none]);
  };
  return { stack, game, menus, changes, music, log, press };
}

describe('GameMenus (Engine 0.16 T9)', () => {
  it('opens on the title over the waiting game and starts it under a transition', () => {
    const { stack, game, menus, music, log, press } = setup();
    menus.showTitle();
    expect([menus.state, menus.screen, stack.depth]).toEqual(['title', 'title', 2]);
    expect(stack.top).toBeInstanceOf(UiScene);
    expect(stack.top!.transitionSlot).toBeNull();
    expect(music).toEqual(['title-song']);
    // Continue shows only with a save.
    expect(menus.ui!.menu('main')!.items.map((i) => i.id)).toEqual(['start', 'controls', 'settings']);
    for (let i = 0; i < 20; i++) press();
    expect(game.steps).toBe(0); // the title holds the game's ticks
    press('jump'); // Start
    expect(log).toEqual(['transition default']);
    expect([menus.state, stack.top]).toEqual(['play', game]);
    expect(music).toEqual(['title-song', null]);
    expect(game.steps).toBe(1); // the step after Start is the game's first
    press();
    expect(game.steps).toBe(3);
  });

  it('offers Continue with a save and calls the game before starting', () => {
    let continued = 0;
    const { menus, press } = setup({ canContinue: () => true, onContinue: () => continued++ });
    menus.showTitle();
    expect(menus.ui!.menu('main')!.items.map((i) => i.id)).toEqual([
      'start',
      'continue',
      'controls',
      'settings',
    ]);
    press('down');
    press('jump');
    expect([continued, menus.state]).toEqual([1, 'play']);
  });

  it('pauses and resumes on the pause key, holding the ticks, and backs out of settings', () => {
    const { game, menus, changes, press } = setup();
    press();
    expect(game.steps).toBe(2);
    expect(menus.pauseKey()).toBe(true);
    expect([menus.state, menus.screen, menus.ui!.menu('main')!.focused]).toEqual([
      'pause',
      'pause',
      'resume',
    ]);
    for (let i = 0; i < 10; i++) press();
    expect(game.steps).toBe(2);
    // Settings takes the pause menu's place; a change goes to the page; the pause key backs out.
    press('down');
    press('down');
    press('jump');
    expect([menus.state, menus.screen]).toEqual(['pause', 'settings']);
    press('left'); // master 4 -> 3
    expect(changes).toEqual([['master', 3]]);
    expect(menus.pauseKey()).toBe(true);
    expect([menus.screen, menus.ui!.menu('main')!.focused]).toEqual(['pause', 'settings']);
    // Controls, then Back.
    press('up');
    press('jump');
    expect(menus.screen).toBe('controls');
    press('jump'); // its Back
    expect([menus.screen, menus.ui!.menu('main')!.focused]).toEqual(['pause', 'controls']);
    // Back (the attack key) on the pause menu resumes; so does the pause key.
    press('attack');
    expect(menus.state).toBe('play');
    expect(game.steps).toBe(3);
    menus.pauseKey();
    menus.pauseKey();
    expect(menus.state).toBe('play');
  });

  it('goes back to the title: the game starts over', () => {
    const { stack, game, menus, log, press } = setup();
    press();
    menus.pause();
    for (let i = 0; i < 3; i++) press('down');
    press('jump'); // Back to title
    expect(log).toEqual(['transition default', 'restart']);
    expect([menus.state, menus.screen]).toEqual(['title', 'title']);
    expect(stack.depth).toBe(2);
    expect(stack.find((s) => s === game)).toBeUndefined();
  });

  it('ignores the pause key on the title, and pause while a menu shows', () => {
    const { menus } = setup();
    menus.showTitle();
    expect(menus.pauseKey()).toBe(false);
    expect(menus.pause()).toBe(false);
    expect(menus.state).toBe('title');
  });
});

describe('titleFromQuery (Engine 0.16 T9)', () => {
  it('shows the title unless the page steps by hand, records or asks to skip it', () => {
    expect(titleFromQuery('')).toBe(true);
    expect(titleFromQuery('?backend=three')).toBe(true);
    expect(titleFromQuery('?debug=step')).toBe(false);
    expect(titleFromQuery('?record')).toBe(false);
    expect(titleFromQuery('?title=skip')).toBe(false);
    expect(titleFromQuery('?debug=step&title=show')).toBe(true);
  });
});
