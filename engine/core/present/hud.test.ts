import { describe, expect, it } from 'vitest';
import {
  boxesOverlap,
  hudGlyphs,
  hudItemShown,
  hudPanelBoxes,
  HUD_HIDDEN_STATUS,
  layoutHud,
  type HudFrameSize,
} from './hud';
import type { SkinFile } from './skin';

/** A fixture skin's HUD (inline: core never imports a game). */
const SKIN: SkinFile = {
  backend: 'canvas2d',
  sheets: { sheet: 'hero', palette: 'warm', fallbackColor: '#00a800' },
  kinds: {},
  hud: [
    { status: 'health', as: 'hearts', x: 8, y: 8, frame: 'heart' },
    { status: 'key', as: 'icon', x: 60, y: 8, sheet: 'items', frame: 'key' },
    { status: 'score', as: 'number', x: 200, y: 8 },
    { status: 'name', as: 'text', x: 100, y: 20, font: 'big' },
    { status: 'lost', as: 'hearts', x: 8, y: 30, frame: 'gone' },
  ],
};

/** `hero` has a 7 px heart; `items` a 10 px key; nothing else. */
const SIZES: HudFrameSize = (sheet, _palette, frame) =>
  sheet === 'hero' && frame === 'heart'
    ? { w: 7, h: 7 }
    : sheet === 'items' && frame === 'key'
      ? { w: 10, h: 8 }
      : null;

describe('layoutHud (G33)', () => {
  it('lays out hearts, icons, numbers and text as the Canvas2D presenter drew them', () => {
    const asked: string[] = [];
    const sizes: HudFrameSize = (sheet, palette, frame) => {
      asked.push(`${sheet}@${palette ?? ''}#${frame}`);
      return SIZES(sheet, palette, frame);
    };
    const items = layoutHud(SKIN, { health: 3, key: true, score: 120, name: 'A B', lost: 2 }, sizes);
    expect(items).toEqual([
      { kind: 'sprite', sheet: 'hero', palette: 'warm', frame: 'heart', x: 8, y: 8 },
      { kind: 'sprite', sheet: 'hero', palette: 'warm', frame: 'heart', x: 16, y: 8 },
      { kind: 'sprite', sheet: 'hero', palette: 'warm', frame: 'heart', x: 24, y: 8 },
      { kind: 'sprite', sheet: 'items', palette: 'warm', frame: 'key', x: 60, y: 8 },
      { kind: 'text', font: 'font', text: '120', x: 200, y: 8 },
      { kind: 'text', font: 'big', text: 'A B', x: 100, y: 20 },
      { kind: 'box', x: 8, y: 30, w: 8, h: 8, color: '#00a800' },
      { kind: 'box', x: 17, y: 30, w: 8, h: 8, color: '#00a800' },
    ]);
    expect(asked).toContain('hero@warm#heart');
  });

  it('draws nothing for a missing status, a false icon or a non-number of hearts; the font option is the default', () => {
    expect(layoutHud(SKIN, {}, SIZES)).toEqual([]);
    expect(layoutHud(SKIN, { key: false, health: 'many', lost: -1 }, SIZES)).toEqual([]);
    expect(layoutHud(SKIN, { health: 1.9 }, SIZES)).toHaveLength(1);
    expect(layoutHud(SKIN, { score: 7 }, SIZES, { font: 'small' })).toEqual([
      { kind: 'text', font: 'small', text: '7', x: 200, y: 8 },
    ]);
    const plain: SkinFile = {
      backend: 'three',
      kinds: {},
      hud: [{ status: 'k', as: 'icon', x: 1, y: 2, frame: 'k' }],
    };
    expect(layoutHud(plain, { k: 1 }, SIZES)).toEqual([
      { kind: 'box', x: 1, y: 2, w: 8, h: 8, color: '#ff00ff' },
    ]);
  });

  it('splits text into glyphs 8 px apart, skipping spaces', () => {
    expect(hudGlyphs({ kind: 'text', font: 'f', text: '1 2', x: 10, y: 4 })).toEqual([
      { kind: 'sprite', sheet: 'f', frame: '1', x: 10, y: 4 },
      { kind: 'sprite', sheet: 'f', frame: '2', x: 26, y: 4 },
    ]);
  });
});

describe('hiding the HUD and its panel boxes (Engine 0.16 F9)', () => {
  const skin = {
    backend: 'canvas2d',
    hud: [
      { as: 'panel', x: 2, y: 2, w: 40, h: 10 },
      { as: 'panel', x: 50, y: 2, w: 20, h: 10, when: { status: 'open', eq: 1 } },
      { as: 'minimap', x: 0, y: 140, w: 40, h: 40 },
      { as: 'text', status: 'score', x: 4, y: 4 },
    ],
  } as unknown as SkinFile;

  it('shows no item while the status hides the HUD', () => {
    expect(hudItemShown({}, {})).toBe(true);
    expect(hudItemShown({}, { [HUD_HIDDEN_STATUS]: 1 })).toBe(false);
    expect(hudItemShown({}, { [HUD_HIDDEN_STATUS]: 0 })).toBe(true);
    expect(layoutHud(skin, { score: 3, [HUD_HIDDEN_STATUS]: 1 }, () => null)).toEqual([]);
  });

  it('lists the boxes of the shown panels and minimaps', () => {
    expect(hudPanelBoxes(skin, {})).toEqual([
      { x: 2, y: 2, w: 40, h: 10 },
      { x: 0, y: 140, w: 40, h: 40 },
    ]);
    expect(hudPanelBoxes(skin, { open: 1 })).toHaveLength(3);
    expect(hudPanelBoxes(skin, { [HUD_HIDDEN_STATUS]: 1 })).toEqual([]);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 9, w: 5, h: 5 })).toBe(true);
    expect(boxesOverlap({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 5, h: 5 })).toBe(false);
  });
});
