import { describe, expect, it } from 'vitest';
import { layoutHud, type HudFrameSize, type PresentEntity, type PresentMap, type SkinFile } from '../present';
import { buildFont, type FontLookup } from './font';
import { SkinHud, hudValueText, type SkinHudInput } from './hud';
import type { UiDraw } from './paint';
import { barFill, barRatio, CounterRoll, minimapDraws, minimapScale } from './widgets';

/** Every glyph of the test font is a 2x3 block on a 2x4 cell, baseline 3. */
const DIGITS = '0123456789x';
const FONT = buildFont('small', {
  cell: { w: 2, h: 4 },
  baseline: 3,
  glyphs: Object.fromEntries([...`${DIGITS}HPp`].map((c) => [c, { rows: ['##', '##', '##', '..'] }])),
});
const FONTS: FontLookup = (id) => (id === 'small' ? FONT : null);

/** `ui` has a 9x9 panel and an 8x8 coin; nothing else. */
const SIZES: HudFrameSize = (sheet, _palette, frame) =>
  sheet === 'ui' && frame === 'panel'
    ? { w: 9, h: 9 }
    : sheet === 'ui' && frame === 'coin'
      ? { w: 8, h: 8 }
      : null;

function input(status: SkinHudInput['status'], more: Partial<SkinHudInput> = {}): SkinHudInput {
  return { status, frameSize: SIZES, map: null, entities: [], clock: 0, ...more };
}

function skin(hud: SkinFile['hud']): SkinFile {
  return { backend: 'canvas2d', sheets: { sheet: 'ui' }, kinds: {}, ...(hud !== undefined && { hud }) };
}

describe('widget value mapping (Engine 0.16 T6)', () => {
  it('maps a value to a bar fill, never empty above 0 nor full below max', () => {
    expect(barRatio(5, 10)).toBe(0.5);
    expect(barRatio(12, 10)).toBe(1);
    expect(barRatio(-1, 10)).toBe(0);
    expect(barRatio(3, 0)).toBe(0);
    expect(barFill(5, 10, 40)).toBe(20);
    expect(barFill(0, 10, 40)).toBe(0);
    expect(barFill(0.01, 10, 40)).toBe(1);
    expect(barFill(9.99, 10, 40)).toBe(39);
    expect(barFill(10, 10, 40)).toBe(40);
  });

  it('rolls a counter to a new value over its ticks, first value at once', () => {
    const roll = new CounterRoll({ ticks: 10, ease: 'linear' });
    expect(roll.shown(3, 0)).toBe(3);
    expect(roll.rolling(0)).toBe(false);
    expect(roll.shown(13, 5)).toBe(3);
    expect(roll.shown(13, 10)).toBe(8);
    expect(roll.rolling(10)).toBe(true);
    expect(roll.shown(13, 15)).toBe(13);
    expect(roll.rolling(15)).toBe(false);
    // A new target mid-roll starts from the number shown.
    roll.shown(23, 20);
    expect(roll.shown(33, 25)).toBe(18);
    expect(roll.shown(33, 30)).toBe(26);
  });

  it('writes a value padded and formatted', () => {
    expect(hudValueText({ digits: 3 }, 7)).toBe('007');
    expect(hudValueText({ digits: 2 }, -4)).toBe('-04');
    expect(hudValueText({ format: 'x{value}' }, 3)).toBe('x3');
    expect(hudValueText({ format: 'Hi' }, undefined)).toBe('Hi');
  });

  it('draws a minimap from the tiles, merging runs, with entity dots inside the box', () => {
    const map: PresentMap = { id: 'm', version: 1, tileSize: 16, cols: 4, rows: 2, tiles: ['##.=', '####'] };
    const runner: PresentEntity = {
      id: 'p',
      kind: 'runner',
      x: 0,
      y: 0,
      w: 16,
      h: 16,
      facing: 'right',
      anim: { state: 'idle', t: 0 },
      tags: [],
    };
    const boss = { ...runner, id: 'b', kind: 'beetle', x: 48, y: 16, tags: ['boss'] };
    const draws = minimapDraws(
      {
        box: { x: 100, y: 10, w: 8, h: 4 },
        tiles: { '#': '#0a0', '=': '#fc0' },
        back: '#000',
        dots: [
          { kind: 'runner', color: '#fff' },
          { tag: 'boss', color: '#f00', size: 1 },
        ],
      },
      map,
      [runner, boss],
    );
    expect(minimapScale(map, { w: 8, h: 4 })).toBe(2);
    expect(draws).toEqual([
      { kind: 'fill', x: 100, y: 10, w: 8, h: 4, color: '#000' },
      { kind: 'fill', x: 100, y: 10, w: 4, h: 2, color: '#0a0' },
      { kind: 'fill', x: 106, y: 10, w: 2, h: 2, color: '#fc0' },
      { kind: 'fill', x: 100, y: 12, w: 8, h: 2, color: '#0a0' },
      { kind: 'fill', x: 100, y: 10, w: 2, h: 2, color: '#fff' },
      { kind: 'fill', x: 107, y: 13, w: 1, h: 1, color: '#f00' },
    ]);
    // Half a px per tile: tiles that share a px show once.
    const small = minimapDraws(
      { box: { x: 0, y: 0, w: 2, h: 1 }, tiles: { '#': '#0a0' }, dots: [], scale: 0.5 },
      map,
      [],
    );
    expect(small).toEqual([{ kind: 'fill', x: 0, y: 0, w: 2, h: 1, color: '#0a0' }]);
  });
});

describe('SkinHud (Engine 0.16 T6)', () => {
  it('leaves a skin of classic items to layoutHud, and lays them out the same when mixed', () => {
    const classic = skin([{ status: 'coins', as: 'icon', x: 1, y: 2, frame: 'coin' }]);
    expect(new SkinHud(classic, { fonts: FONTS }).usesUi).toBe(false);
    // A number in a font file is the UI kit's.
    expect(
      new SkinHud(skin([{ status: 'n', as: 'number', x: 0, y: 0, font: 'small' }]), { fonts: FONTS }).usesUi,
    ).toBe(true);
    // Mixed: the classic icon draws the same pixels as `layoutHud`'s sprite.
    const mixed = skin([
      { status: 'coins', as: 'icon', x: 1, y: 2, frame: 'coin' },
      { as: 'panel', x: 0, y: 0, w: 20, h: 12, frame: 'panel', slice: 3 },
    ]);
    const draws = new SkinHud(mixed, { fonts: FONTS }).layout(input({ coins: 1 }));
    expect(layoutHud(classic, { coins: 1 }, SIZES)).toEqual([
      { kind: 'sprite', sheet: 'ui', frame: 'coin', x: 1, y: 2 },
    ]);
    expect(draws[0]).toEqual({
      kind: 'image',
      sheet: 'ui',
      frame: 'coin',
      sx: 0,
      sy: 0,
      sw: 8,
      sh: 8,
      x: 1,
      y: 2,
      w: 8,
      h: 8,
    });
    expect(draws.slice(1)).toHaveLength(9);
  });

  it('draws text in a font file with its style, alignment and format', () => {
    const hud = new SkinHud(
      skin([{ as: 'text', x: 10, y: 5, w: 20, align: 'right', font: 'small', format: 'Hp', shadow: '#000' }]),
      { fonts: FONTS },
    );
    const draws = hud.layout(input({}));
    expect(draws).toEqual([
      { kind: 'glyph', font: 'small', ch: 'H', x: 26, y: 6, color: '#000' },
      { kind: 'glyph', font: 'small', ch: 'p', x: 29, y: 6, color: '#000' },
      { kind: 'glyph', font: 'small', ch: 'H', x: 25, y: 5, color: '#fcfcfc' },
      { kind: 'glyph', font: 'small', ch: 'p', x: 28, y: 5, color: '#fcfcfc' },
    ]);
  });

  it('maps a bar from status, its max from another key, the low colour and a frame', () => {
    const bar = (extra: object) =>
      new SkinHud(
        skin([{ status: 'hp', as: 'bar', x: 0, y: 0, w: 22, h: 6, max: 'maxHp', back: '#111', ...extra }]),
        { fonts: FONTS },
      );
    const plain = bar({ border: '#fff', low: { below: 0.25, color: '#f00' } });
    const half = plain.layout(input({ hp: 2, maxHp: 4 }));
    expect(half.slice(0, 4).every((d) => d.kind === 'fill' && d.color === '#fff')).toBe(true);
    expect(half.slice(4)).toEqual([
      { kind: 'fill', x: 1, y: 1, w: 20, h: 4, color: '#111' },
      { kind: 'fill', x: 1, y: 1, w: 10, h: 4, color: '#00a800' },
    ]);
    expect(plain.layout(input({ hp: 1, maxHp: 4 })).at(-1)).toMatchObject({ w: 5, color: '#f00' });
    expect(plain.layout(input({ maxHp: 4 }))).toEqual([]);
    const framed = bar({ panel: { frame: 'panel', slice: 2 } }).layout(input({ hp: 4, maxHp: 4 }));
    expect(framed.filter((d) => d.kind === 'image')).toHaveLength(9);
    expect(framed.at(-1)).toEqual({ kind: 'fill', x: 2, y: 2, w: 18, h: 2, color: '#00a800' });
  });

  it('draws a counter as its icon and a rolling number', () => {
    const hud = new SkinHud(
      skin([
        {
          status: 'coins',
          as: 'counter',
          x: 4,
          y: 4,
          frame: 'coin',
          font: 'small',
          digits: 2,
          tween: { ticks: 4, ease: 'linear', color: '#ff0' },
        },
      ]),
      { fonts: FONTS },
    );
    const at = (coins: number, clock: number) => hud.layout(input({ coins }, { clock }));
    const first = at(0, 0);
    expect(first[0]).toMatchObject({ kind: 'image', frame: 'coin', x: 4, y: 4 });
    // The number sits 2 px right of the 8 px icon, its caps centred on it.
    expect(first.slice(1)).toEqual([
      { kind: 'glyph', font: 'small', ch: '0', x: 14, y: 6, color: '#fcfcfc' },
      { kind: 'glyph', font: 'small', ch: '0', x: 17, y: 6, color: '#fcfcfc' },
    ]);
    const text = (d: UiDraw[]) =>
      d
        .filter((g) => g.kind === 'glyph')
        .map((g) => (g as { ch: string }).ch)
        .join('');
    at(8, 10);
    expect(text(at(8, 12))).toBe('04');
    expect(at(8, 12).at(-1)).toMatchObject({ color: '#ff0' });
    expect(text(at(8, 14))).toBe('08');
    expect(at(8, 14).at(-1)).toMatchObject({ color: '#fcfcfc' });
  });

  it('draws nothing for a missing status, and a panel and minimap without one', () => {
    const map: PresentMap = { id: 'm', version: 1, tileSize: 8, cols: 2, rows: 1, tiles: ['#.'] };
    const hud = new SkinHud(
      skin([
        { status: 'hp', as: 'bar', x: 0, y: 0, w: 5, h: 5, max: 3 },
        { status: 'n', as: 'counter', x: 0, y: 0, font: 'small' },
        { as: 'minimap', x: 0, y: 0, w: 4, h: 2, tiles: { '#': '#0a0' }, border: '#fff' },
      ]),
      { fonts: FONTS },
    );
    const draws = hud.layout(input({}, { map }));
    expect(draws[0]).toEqual({ kind: 'fill', x: 0, y: 0, w: 2, h: 2, color: '#0a0' });
    expect(draws).toHaveLength(5);
  });
});
