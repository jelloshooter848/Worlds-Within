import { describe, expect, it } from 'vitest';
import { hudGlyphs, hudItemShown, layoutHud, type HudFrameSize } from './hud';
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

  it('counts halves with a `half` frame: a frame per two points, then the half (Engine 0.16 part C T3)', () => {
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'hero' },
      kinds: {},
      hud: [{ status: 'hp', as: 'hearts', x: 4, y: 2, frame: 'heart', half: 'half' }],
    };
    const sizes: HudFrameSize = (_s, _p, frame) =>
      frame === 'heart' || frame === 'half' ? { w: 7, h: 7 } : null;
    const at = (hp: number) =>
      layoutHud(skin, { hp }, sizes).map((d) => (d.kind === 'sprite' ? `${d.frame}@${d.x}` : d.kind));
    expect(at(5)).toEqual(['heart@4', 'heart@12', 'half@20']);
    expect(at(4)).toEqual(['heart@4', 'heart@12']);
    expect(at(1)).toEqual(['half@4']);
    expect(at(0)).toEqual([]);
  });

  it('shows an item with `when` only while that status is truthy (Engine 0.16 part C T3)', () => {
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'hero' },
      kinds: {},
      hud: [{ status: 'bombs', as: 'number', x: 1, y: 2, when: 'item' }],
    };
    expect(layoutHud(skin, { bombs: 0, item: '' }, SIZES)).toEqual([]);
    expect(layoutHud(skin, { bombs: 0 }, SIZES)).toEqual([]);
    expect(layoutHud(skin, { bombs: 3, item: 'bomb' }, SIZES)).toEqual([
      { kind: 'text', font: 'font', text: '3', x: 1, y: 2 },
    ]);
    expect(hudItemShown({}, {})).toBe(true);
  });

  it("picks an icon's frame by the status value with `frames`, else `frame` (Engine 0.16 part C T9)", () => {
    const skin: SkinFile = {
      backend: 'canvas2d',
      sheets: { sheet: 'items' },
      kinds: {},
      hud: [{ status: 'item', as: 'icon', x: 3, y: 4, frame: 'key', frames: { dash: 'boots' } }],
    };
    const sizes: HudFrameSize = (_s, _p, frame) =>
      frame === 'key' || frame === 'boots' ? { w: 8, h: 8 } : null;
    expect(layoutHud(skin, { item: 'dash' }, sizes)).toEqual([
      { kind: 'sprite', sheet: 'items', frame: 'boots', x: 3, y: 4 },
    ]);
    expect(layoutHud(skin, { item: 'bomb' }, sizes)).toEqual([
      { kind: 'sprite', sheet: 'items', frame: 'key', x: 3, y: 4 },
    ]);
    expect(layoutHud(skin, { item: '' }, sizes)).toEqual([]);
  });

  it('splits text into glyphs 8 px apart, skipping spaces', () => {
    expect(hudGlyphs({ kind: 'text', font: 'f', text: '1 2', x: 10, y: 4 })).toEqual([
      { kind: 'sprite', sheet: 'f', frame: '1', x: 10, y: 4 },
      { kind: 'sprite', sheet: 'f', frame: '2', x: 26, y: 4 },
    ]);
  });
});
