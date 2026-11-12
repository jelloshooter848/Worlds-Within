import { describe, expect, it } from 'vitest';
import { layoutHud, type HudFrameSize, type PresentEntity, type PresentMap, type SkinFile } from '../present';
import { buildFont, type FontLookup } from './font';
import { clockStatus, worldClock } from '../clock';
import { clockHudText, previewGroups, SkinHud, hudValueText, skinMinimap, type SkinHudInput } from './hud';
import type { UiDraw } from './paint';
import {
  barFill,
  barRatio,
  CounterRoll,
  dayBarDraws,
  dayBarX,
  minimapDraws,
  minimapPointToWorld,
  minimapScale,
} from './widgets';

/** Every glyph of the test font is a 2x3 block on a 2x4 cell, baseline 3. */
const DIGITS = '0123456789x';
const FONT = buildFont('small', {
  cell: { w: 2, h: 4 },
  baseline: 3,
  glyphs: Object.fromEntries([...`${DIGITS}HPpDay:`].map((c) => [c, { rows: ['##', '##', '##', '..'] }])),
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

describe('the fuller minimap: fog, team dots, the camera view (Engine 0.16 part D, D3)', () => {
  // A 4x2 map at 2 px per tile in an 8x4 box at (100, 10).
  const map: PresentMap = { id: 'm', version: 1, tileSize: 16, cols: 4, rows: 2, tiles: ['####', '####'] };
  const unit: PresentEntity = {
    id: 'u1',
    kind: 'unit',
    x: 0,
    y: 0,
    w: 16,
    h: 16,
    facing: 'down',
    anim: { state: 'idle', t: 0 },
    tags: ['own'],
  };
  const foe = { ...unit, id: 'u2', x: 48, y: 16, tags: ['enemy', 'faction:blue'] };
  const plain = { ...unit, id: 'u3', x: 16, tags: [] };
  const base = {
    box: { x: 100, y: 10, w: 8, h: 4 },
    tiles: { '#': '#0a0' },
    dots: [{ kind: 'unit', color: '#fff' }],
  };

  it('draws exactly as before without the new fields, whatever the extras', () => {
    const fog = { cols: 4, rows: 2, cells: ['0000', '0000'] };
    const view = { x: 0, y: 0, w: 32, h: 16 };
    expect(minimapDraws(base, map, [unit, foe], { fog, view })).toEqual(minimapDraws(base, map, [unit, foe]));
  });

  it('lays the fog over the tiles in runs, under the dots', () => {
    const look = {
      unexplored: { color: '#000000', alpha: 1 },
      explored: { color: '#101010', alpha: 0.5 },
      edge: 3,
    };
    const fog = { cols: 4, rows: 2, cells: ['0012', '2222'] };
    const draws = minimapDraws({ ...base, fog: look }, map, [unit], { fog });
    expect(draws).toEqual([
      { kind: 'fill', x: 100, y: 10, w: 8, h: 2, color: '#0a0' },
      { kind: 'fill', x: 100, y: 12, w: 8, h: 2, color: '#0a0' },
      { kind: 'fill', x: 100, y: 10, w: 4, h: 2, color: '#000000' },
      { kind: 'fill', x: 104, y: 10, w: 2, h: 2, color: '#101010', alpha: 0.5 },
      { kind: 'fill', x: 100, y: 10, w: 2, h: 2, color: '#fff' },
    ]);
    // A frame without fog draws none.
    expect(minimapDraws({ ...base, fog: look }, map, [unit], { fog: null })).toEqual(
      minimapDraws(base, map, [unit]),
    );
  });

  it('colours dots by the first team tag in the table, else the dot entry', () => {
    const teams = { enemy: '#f00', own: '#00f' };
    const dots = minimapDraws({ ...base, teams }, map, [unit, foe, plain]).slice(2);
    expect(dots.map((d) => (d.kind === 'fill' ? d.color : ''))).toEqual(['#00f', '#f00', '#fff']);
  });

  it("outlines the camera's view one px wide, cut to the box", () => {
    // The world box (16, 0) 32x16 is minimap (2, 0) 4x2.
    const draws = minimapDraws({ ...base, dots: [], view: '#ff0' }, map, [], {
      view: { x: 16, y: 0, w: 32, h: 16 },
    });
    expect(draws.slice(2)).toEqual([
      { kind: 'fill', x: 102, y: 10, w: 4, h: 1, color: '#ff0' },
      { kind: 'fill', x: 102, y: 11, w: 4, h: 1, color: '#ff0' },
    ]);
    const big = minimapDraws({ ...base, dots: [], view: '#ff0' }, map, [], {
      view: { x: -40, y: -40, w: 400, h: 400 },
    });
    expect(big.slice(2)).toEqual([
      { kind: 'fill', x: 100, y: 10, w: 8, h: 1, color: '#ff0' },
      { kind: 'fill', x: 100, y: 13, w: 8, h: 1, color: '#ff0' },
      { kind: 'fill', x: 100, y: 11, w: 1, h: 2, color: '#ff0' },
      { kind: 'fill', x: 107, y: 11, w: 1, h: 2, color: '#ff0' },
    ]);
    // Without a view to show, no outline.
    expect(minimapDraws({ ...base, dots: [], view: '#ff0' }, map, [])).toHaveLength(2);
  });

  it('maps a minimap point back to the world, null off the box or the map', () => {
    expect(minimapPointToWorld(base, map, 100, 10)).toEqual({ x: 0, y: 0 });
    expect(minimapPointToWorld(base, map, 105, 13)).toEqual({ x: 40, y: 24 });
    expect(minimapPointToWorld(base, map, 105.5, 11)).toEqual({ x: 44, y: 8 });
    expect(minimapPointToWorld(base, map, 99, 10)).toBeNull();
    expect(minimapPointToWorld(base, map, 108, 10)).toBeNull();
    // A map smaller than the box: a point past its drawn tiles is off the map.
    const box = { box: { x: 0, y: 0, w: 20, h: 20 }, scale: 2 };
    expect(minimapPointToWorld(box, map, 7.9, 3.9)).toEqual({ x: 63.2, y: 31.2 });
    expect(minimapPointToWorld(box, map, 8, 0)).toBeNull();
    // Each tile's minimap px maps back into that tile.
    for (let c = 0; c < 4; c++) {
      const p = minimapPointToWorld(base, map, 100 + c * 2 + 1, 10)!;
      expect(Math.floor(p.x / 16)).toBe(c);
    }
  });

  it("lays a skin's minimap out with the skin's fog look, teams and view, and finds it for pages", () => {
    const s: SkinFile = {
      ...skin([
        { status: 'hp', as: 'number', x: 0, y: 0 },
        {
          as: 'minimap',
          x: 100,
          y: 10,
          w: 8,
          h: 4,
          tiles: { '#': '#0a0' },
          dots: [{ kind: 'unit', color: '#fff' }],
          fog: true,
          teams: { own: '#00f' },
          view: '#ff0',
        },
      ]),
      fog: { unexplored: { color: '#222222', alpha: 0.75 } },
    };
    const draws = new SkinHud(s).layout(
      input(
        {},
        {
          map,
          entities: [unit],
          fog: { cols: 4, rows: 2, cells: ['0222', '2222'] },
          view: { x: 0, y: 0, w: 16, h: 16 },
        },
      ),
    );
    expect(draws).toContainEqual({ kind: 'fill', x: 100, y: 10, w: 2, h: 2, color: '#222222', alpha: 0.75 });
    expect(draws).toContainEqual({ kind: 'fill', x: 100, y: 10, w: 2, h: 2, color: '#00f' });
    expect(draws.at(-1)).toEqual({ kind: 'fill', x: 100, y: 11, w: 2, h: 1, color: '#ff0' });
    expect(skinMinimap(s)).toEqual({ box: { x: 100, y: 10, w: 8, h: 4 } });
    expect(skinMinimap(skin([]))).toBeNull();
  });
});

describe('flat panels and shown-when tests (Engine 0.16 F7)', () => {
  it('draws a panel with a colour and no frame as a box at its alpha, then its border', () => {
    const hud = new SkinHud(
      skin([{ as: 'panel', x: 2, y: 3, w: 10, h: 6, color: '#123', alpha: 0.5, border: '#fff' }]),
      { fonts: FONTS },
    );
    expect(hud.usesUi).toBe(true);
    const draws = hud.layout(input({}));
    expect(draws[0]).toEqual({ kind: 'fill', x: 2, y: 3, w: 10, h: 6, color: '#123', alpha: 0.5 });
    expect(draws.slice(1)).toHaveLength(4);
    expect(draws.slice(1).every((d) => d.kind === 'fill' && d.color === '#fff')).toBe(true);
    // Opaque without an alpha, and no border without one.
    const plain = new SkinHud(skin([{ as: 'panel', x: 0, y: 0, w: 4, h: 4, color: '#123' }]), {
      fonts: FONTS,
    });
    expect(plain.layout(input({}))).toEqual([{ kind: 'fill', x: 0, y: 0, w: 4, h: 4, color: '#123' }]);
  });

  it('draws an item only while its `when` holds, a classic one too; a missing key never holds', () => {
    const items: SkinFile['hud'] = [
      { as: 'panel', x: 0, y: 0, w: 4, h: 4, color: '#0f0', when: { status: 'alive', eq: 1 } },
      { as: 'panel', x: 0, y: 0, w: 4, h: 4, color: '#f00', when: { status: 'fate', eq: 'captured' } },
      { as: 'text', x: 0, y: 8, font: 'small', format: 'Hp', when: { status: 'hp', gte: 0 } },
    ];
    const hud = new SkinHud(skin(items), { fonts: FONTS });
    const colours = (status: SkinHudInput['status']) =>
      hud.layout(input(status)).map((d) => (d.kind === 'fill' ? d.color : d.kind));
    expect(colours({ alive: 1, hp: 3 })).toEqual(['#0f0', 'glyph', 'glyph']);
    expect(colours({ alive: 1, fate: 'captured' })).toEqual(['#0f0', '#f00']);
    expect(colours({ alive: 0 })).toEqual([]);
    const classic = skin([
      { status: 'coins', as: 'icon', x: 1, y: 2, frame: 'coin', when: { status: 'coins', gt: 2 } },
    ]);
    expect(layoutHud(classic, { coins: 1 }, SIZES)).toEqual([]);
    expect(layoutHud(classic, { coins: 3 }, SIZES)).toHaveLength(1);
  });
});

describe('the clock widget (Engine 0.16 F4)', () => {
  const clock = (day: number, hour: number, minute = 0) => clockStatus(worldClock({ day, hour, minute }, 0));

  it("writes the clock's text through its format", () => {
    const status = clock(2, 15, 4);
    expect(clockHudText(undefined, status)).toBe('Day 2 15:04');
    expect(clockHudText('{phase}, day {day} ({time})', status)).toBe('late afternoon, day 2 (15:04)');
    expect(clockHudText('{text} / {value}', status)).toBe('Day 2 15:04 / Day 2 15:04');
    expect(clockHudText(undefined, {})).toBeNull();
    expect(clockHudText('{day}', clockStatus(worldClock({ day: 3, hour: 1 }, 0), 'sky'), 'sky')).toBe('3');
  });

  it('places the marker along the day bar, bands from their hours, tick marks', () => {
    expect([0, 6, 12, 18, 23.99].map((h) => dayBarX(h, 49))).toEqual([0, 12, 24, 36, 48]);
    const draws = dayBarDraws(
      {
        back: '#000',
        bands: [
          { hour: 6, color: '#f80' },
          { hour: 8, color: '#8cf' },
          { hour: 19, color: '#448' },
        ],
        marks: [12],
        marker: '#fff',
      },
      { x: 10, y: 20, w: 49, h: 3 },
      0.5,
    );
    expect(draws).toEqual([
      { kind: 'fill', x: 10, y: 20, w: 49, h: 3, color: '#000' },
      { kind: 'fill', x: 22, y: 20, w: 4, h: 3, color: '#f80' },
      { kind: 'fill', x: 26, y: 20, w: 22, h: 3, color: '#8cf' },
      { kind: 'fill', x: 48, y: 20, w: 11, h: 3, color: '#448' },
      { kind: 'fill', x: 34, y: 20, w: 1, h: 3, color: '#000000' },
      { kind: 'fill', x: 34, y: 19, w: 1, h: 5, color: '#fff' },
    ]);
    expect(dayBarDraws({}, { x: 0, y: 0, w: 10, h: 2 }, null)).toEqual([
      { kind: 'fill', x: 0, y: 0, w: 10, h: 2, color: '#203050' },
    ]);
  });

  it('draws the text centred on top and the day bar along the bottom, moving with the clock', () => {
    const hud = new SkinHud(
      skin([
        { as: 'clock', x: 4, y: 2, w: 49, h: 10, font: 'small', format: '{day} {time}', dayBar: { h: 2 } },
      ]),
      { fonts: FONTS },
    );
    expect(hud.usesUi).toBe(true);
    expect(hud.layout(input({ hp: 3 }))).toEqual([]);
    const draws = hud.layout(input(clock(2, 6)));
    const glyphs = draws.filter((d) => d.kind === 'glyph') as { ch: string; x: number; y: number }[];
    expect(glyphs.map((g) => g.ch).join('')).toBe('206:00');
    // `2 06:00` is 18 px (six 2-px glyphs a px apart, a 1-px space), centred in 49 px.
    expect(glyphs[0]).toMatchObject({ x: 4 + Math.floor((49 - 18) / 2), y: 2 });
    const fills = draws.filter((d) => d.kind === 'fill');
    expect(fills[0]).toEqual({ kind: 'fill', x: 4, y: 10, w: 49, h: 2, color: '#203050' });
    expect(fills.at(-1)).toEqual({ kind: 'fill', x: 4 + 12, y: 9, w: 1, h: 4, color: '#fcfcfc' });
    const evening = hud.layout(input(clock(2, 18))).filter((d) => d.kind === 'fill');
    expect(evening.at(-1)).toMatchObject({ x: 4 + 36 });
  });
});

describe('the wave preview (Engine 0.16 E6)', () => {
  it('reads a kind:count list in order, skipping what is not one', () => {
    expect(previewGroups('runner:6,brute:1')).toEqual([
      { kind: 'runner', count: 6 },
      { kind: 'brute', count: 1 },
    ]);
    expect(previewGroups('runner, ,boss:0,bat:x,:3,imp')).toEqual([
      { kind: 'runner', count: 1 },
      { kind: 'imp', count: 1 },
    ]);
    expect(previewGroups(3)).toEqual([]);
  });

  it("draws each group's icon by kind and its count, left to right", () => {
    const hud = new SkinHud(
      skin([
        {
          status: 'nextWaveGroups',
          as: 'preview',
          x: 4,
          y: 2,
          frames: { runner: 'coin' },
          font: 'small',
          format: 'x{value}',
          spacing: 5,
        },
      ]),
      { fonts: FONTS },
    );
    expect(hud.usesUi).toBe(true);
    const draws = hud.layout(input({ nextWaveGroups: 'runner:6,brute:12' }));
    const icons = draws.filter((d) => d.kind !== 'glyph');
    const glyphs = draws.filter((d) => d.kind === 'glyph') as { ch: string; x: number; y: number }[];
    // The runner's 8 px icon, 2 px, "x6" (two 2 px glyphs, 1 px apart), 5 px, then the brute's
    // stand-in box (no frame for it, and no item `frame`).
    expect(icons).toEqual([
      { kind: 'image', sheet: 'ui', frame: 'coin', sx: 0, sy: 0, sw: 8, sh: 8, x: 4, y: 2, w: 8, h: 8 },
      { kind: 'fill', x: 24, y: 2, w: 8, h: 8, color: '#ff00ff', missing: true },
    ]);
    expect(glyphs.map((g) => [g.ch, g.x, g.y])).toEqual([
      ['x', 14, 4],
      ['6', 17, 4],
      ['x', 34, 4],
      ['1', 37, 4],
      ['2', 40, 4],
    ]);
    expect(hud.layout(input({}))).toEqual([]);
    expect(hud.layout(input({ nextWaveGroups: '' }))).toEqual([]);
  });

  it("uses the item's frame for a kind it does not list, and draws icons only without a font", () => {
    const hud = new SkinHud(skin([{ status: 'q', as: 'preview', x: 0, y: 0, frame: 'coin', gap: 3 }]));
    const draws = hud.layout(input({ q: 'a:1,b:2' }));
    expect(draws.map((d) => [d.kind, (d as { x: number }).x])).toEqual([
      ['image', 0],
      ['image', 12],
    ]);
  });
});
