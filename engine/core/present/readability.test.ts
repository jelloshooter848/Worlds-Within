import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import {
  screenScaleAt,
  screenScalePivot,
  skinOutlineColor,
  skinTeamColor,
  type ReadableEntry,
} from './readability';
import { resolveSkinKind, skinSchema, type SkinFile } from './skin';

// Readable at every zoom (Engine 0.16 part D, D4): the skin fields `outline`, `team` and
// `screenScale`, their checks and their pure readings. Drawing is tested on Canvas2D
// (`engine/backends/canvas2d/readability.test.ts`) and on both 2D backends in the browser
// (`tests/browser/readability-parity.test.ts`).

const errorsOf = (data: unknown) =>
  validate('skin.json', data, skinSchema).errors.map((e) => [e.path, e.code]);

function skin(): SkinFile {
  return {
    backend: 'canvas2d',
    sheets: { sheet: 'units', fallbackColor: '#00a800' },
    kinds: {
      soldier: {
        frames: { idle: 'soldier' },
        outline: 'team',
        team: { colors: { blue: '#3c7cfc', red: '#f83800' }, hue: { min: 330, max: 30 } },
        byTag: [{ tag: 'selected', outline: '#fcfcfc' }],
      },
      knight: {
        frames: { idle: 'knight' },
        outline: '#000000',
        team: { prefix: 'side:', colors: { a: '#00f' }, mask: '#ff00ff' },
      },
      'health-bar': { frames: { idle: 'hp' }, screenScale: { min: 1, max: 1 } },
      'selection-ring': { frames: { idle: 'ring' }, screenScale: { min: 0.75, anchor: 'bottom' } },
    },
  };
}

describe('outline, team and screenScale in the skin schema', () => {
  it('accepts every field on a 2D skin', () => {
    expect(errorsOf(skin())).toEqual([]);
  });

  it('refuses them on a 3D skin', () => {
    const s = {
      backend: 'three',
      kinds: {
        unit: {
          mesh: 'box',
          color: '#fff',
          outline: '#000',
          team: { colors: { a: '#00f' } },
          screenScale: { min: 1 },
        },
        hero: { mesh: 'box', color: '#fff', byTag: [{ tag: 'x', outline: '#000' }] },
      },
    };
    expect(errorsOf(s)).toEqual([
      ['kinds.unit.outline', 'wrong_backend_field'],
      ['kinds.unit.team', 'wrong_backend_field'],
      ['kinds.unit.screenScale', 'wrong_backend_field'],
      ['kinds.hero.byTag.0.outline', 'wrong_backend_field'],
    ]);
  });

  it('names a bad value at its field', () => {
    const s = skin() as unknown as { kinds: Record<string, Record<string, unknown>> };
    s.kinds['soldier']!['team'] = { colors: { blue: '#3c7cfc' }, mask: '#ff00ff', hue: { min: 0, max: 30 } };
    s.kinds['knight']!['outline'] = 'black';
    s.kinds['health-bar']!['screenScale'] = { min: 2, max: 1 };
    s.kinds['selection-ring']!['screenScale'] = { min: 0, anchor: 'left' };
    expect(errorsOf(s)).toEqual([
      ['kinds.soldier.team.hue', 'bad_team'],
      ['kinds.knight.outline', 'invalid_format'],
      ['kinds["health-bar"].screenScale.max', 'bad_range'],
      ['kinds["selection-ring"].screenScale.min', 'too_small'],
      ['kinds["selection-ring"].screenScale.anchor', 'invalid_value'],
    ]);
  });

  it('refuses a team outline on a kind without team colours, and empty colours', () => {
    const s = skin() as unknown as { kinds: Record<string, Record<string, unknown>> };
    delete s.kinds['soldier']!['team'];
    s.kinds['soldier']!['byTag'] = [{ tag: 'selected', outline: 'team' }];
    s.kinds['knight']!['team'] = { colors: {} };
    expect(errorsOf(s)).toEqual([
      ['kinds.knight.team.colors', 'custom'],
      ['kinds.soldier.outline', 'missing_field'],
      ['kinds.soldier.byTag.0.outline', 'missing_field'],
    ]);
  });
});

describe('the readings', () => {
  const kinds = skin().kinds;

  it('picks the team colour by the tag prefix, null without a match', () => {
    expect(skinTeamColor(kinds['soldier'], ['own', 'faction:red'])).toBe('#f83800');
    expect(skinTeamColor(kinds['soldier'], ['faction:green'])).toBeNull();
    expect(skinTeamColor(kinds['knight'], ['faction:a', 'side:a'])).toBe('#00f');
    expect(skinTeamColor(kinds['health-bar'], ['faction:red'])).toBeNull();
    expect(skinTeamColor(kinds['soldier'], undefined)).toBeNull();
    // An empty prefix reads whole tags (the RTS kit's `own` and `enemy`).
    expect(skinTeamColor({ team: { prefix: '', colors: { enemy: '#f00' } } }, ['unit', 'enemy'])).toBe(
      '#f00',
    );
  });

  it("reads an outline as a colour, the team's colour, or none", () => {
    expect(skinOutlineColor(kinds['soldier'], ['faction:blue'])).toBe('#3c7cfc');
    expect(skinOutlineColor(kinds['soldier'], [])).toBeNull();
    expect(skinOutlineColor(kinds['knight'], [])).toBe('#000000');
    expect(skinOutlineColor(kinds['health-bar'], [])).toBeNull();
    // A tag look's outline replaces the kind's (through `resolveSkinKind`).
    const look = resolveSkinKind(skin(), { kind: 'soldier', tags: ['selected', 'faction:red'] });
    expect(skinOutlineColor(look, ['selected', 'faction:red'])).toBe('#fcfcfc');
  });

  it('holds the zoom inside the range', () => {
    const stable: ReadableEntry['screenScale'] = { min: 1, max: 1 };
    expect([0.5, 1, 2].map((z) => screenScaleAt(stable, z))).toEqual([1, 1, 1]);
    expect([0.5, 1, 2].map((z) => screenScaleAt({ min: 0.75 }, z))).toEqual([0.75, 1, 2]);
    expect([0.5, 1, 2].map((z) => screenScaleAt({ max: 1.5 }, z))).toEqual([0.5, 1, 1.5]);
    expect([0.5, 1, 2].map((z) => screenScaleAt(undefined, z))).toEqual([0.5, 1, 2]);
  });

  it('pivots on the box centre, top or bottom', () => {
    const box = { x: 10, y: 20, w: 16, h: 4 };
    expect(screenScalePivot(undefined, box)).toEqual({ x: 18, y: 22 });
    expect(screenScalePivot('top', box)).toEqual({ x: 18, y: 20 });
    expect(screenScalePivot('bottom', box)).toEqual({ x: 18, y: 24 });
  });
});
