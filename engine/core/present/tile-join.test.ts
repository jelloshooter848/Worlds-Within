import { describe, expect, it } from 'vitest';
import { checkSkinRefs, skinSchema } from './skin';
import { resolveTileFrame, tileJoinKeyProblem, tileJoinKeys, type TileJoin } from './tile-join';

// Neighbour-based tile frames (Engine 0.16 part B, T6): a tile entry's `join` picks its frame by
// which neighbours it joins, so one map character draws grass tops, edges and corners.

const JOIN: TileJoin = {
  frames: {
    top: 'top',
    'top left': 'top-left',
    'top right': 'top-right',
    left: 'left',
    right: 'right',
    'inner-top-left': 'notch-top-left',
  },
};
const entry = { frame: 'fill', join: JOIN };

/** The frame each cell of `grid` shows (`.` for a cell that is not `#`). */
const frames = (grid: string[], join: TileJoin = JOIN) =>
  grid.map((line, row) =>
    [...line].map((c, col) => (c === '#' ? resolveTileFrame({ ...entry, join }, '#', grid, col, row) : '.')),
  );

describe('tile join keys', () => {
  it('lists the open sides, then the open inner corners, in key order', () => {
    const grid = ['....', '.##.', '.##.'];
    expect(tileJoinKeys({}, '#', grid, 1, 1)).toEqual(['top left']);
    expect(tileJoinKeys({}, '#', grid, 2, 1)).toEqual(['top right']);
    // The map's bottom edge counts as joined by default, as `open` when asked.
    expect(tileJoinKeys({}, '#', grid, 1, 2)).toEqual(['left']);
    expect(tileJoinKeys({ edge: 'open' }, '#', grid, 1, 2)).toEqual(['bottom left']);
  });

  it('opens an inner corner only when both its sides join and the diagonal does not', () => {
    const grid = ['.#', '##'];
    expect(tileJoinKeys({}, '#', grid, 1, 1)).toEqual(['inner-top-left']);
    // With a side open too, the corner key comes first, then the sides alone.
    const step = ['..#', '.##', '###'];
    expect(tileJoinKeys({}, '#', step, 1, 2)).toEqual(['inner-top-left']);
    expect(tileJoinKeys({}, '#', step, 1, 1)).toEqual(['top left']);
    const notch = ['...', '.#.', '##.', '...'];
    expect(tileJoinKeys({ edge: 'open' }, '#', notch, 1, 2)).toEqual([
      'right bottom inner-top-left',
      'right bottom',
    ]);
  });

  it('joins the tile keys `with` lists, and reads id grids', () => {
    const grid = ['.?', '##'];
    expect(tileJoinKeys({}, '#', grid, 1, 1)).toEqual(['top']);
    expect(tileJoinKeys({ with: ['#', '?'] }, '#', grid, 1, 1)).toEqual(['inner-top-left']);
    expect(
      tileJoinKeys(
        {},
        '7',
        [
          [0, 0],
          [7, 7],
        ],
        0,
        1,
      ),
    ).toEqual(['top']);
  });
});

describe('resolveTileFrame', () => {
  it('draws a block with grass on top, edges at its sides and fill inside', () => {
    expect(frames(['.....', '.###.', '.###.'])).toEqual([
      ['.', '.', '.', '.', '.'],
      ['.', 'top-left', 'top', 'top-right', '.'],
      ['.', 'left', 'fill', 'right', '.'],
    ]);
  });

  it('falls back from the full key to the open sides, then to `frame`', () => {
    // A step: the ground under its left foot has an open inner corner it has a frame for.
    expect(frames(['..##', '####'])[1]).toEqual(['top', 'top', 'notch-top-left', 'fill']);
    // Without a frame for it, the plain fill.
    const { 'inner-top-left': _, ...rest } = JOIN.frames;
    expect(frames(['..##', '####'], { frames: rest })[1]).toEqual(['top', 'top', 'fill', 'fill']);
    // A one-wide column (top left right) has no key and no sides-only key: `frame`.
    expect(frames(['.#.', '.#.'])[0]).toEqual(['.', 'fill', '.']);
  });

  it('is the plain frame without `join`', () => {
    expect(resolveTileFrame({ frame: 'wall' }, '#', ['.#.'], 1, 0)).toBe('wall');
  });
});

describe('join in skins', () => {
  const sprites = [{ name: 'ground', value: { frames: { fill: [], top: [] } } }];
  const others = (kind: string) => (kind === 'sprite' ? sprites : []);
  const skin = (join: unknown, backend = 'canvas2d') =>
    skinSchema.safeParse({
      backend,
      kinds: {},
      tiles: { '#': { sheet: 'ground', frame: 'fill', fallbackColor: '#000', join } },
    });

  it('checks each key and names the order it wants', () => {
    expect(tileJoinKeyProblem('top left')).toBeNull();
    expect(tileJoinKeyProblem('left top')).toMatch(/"top left"/);
    expect(tileJoinKeyProblem('top top')).toMatch(/once/);
    expect(tileJoinKeyProblem('up')).toMatch(/not a side/);
    expect(tileJoinKeyProblem('top inner-top-left')).toMatch(/never be open/);
    const bad = skin({ frames: { 'left top': 'top' } });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({
      path: ['tiles', '#', 'join', 'frames', 'left top'],
      params: { code: 'bad_join_key' },
    });
  });

  it('in a 3D skin picks another tile entry by key (Engine 0.16 part B, T10)', () => {
    const three = (frames: Record<string, string>) =>
      skinSchema.safeParse({
        backend: 'three',
        kinds: {},
        tiles: {
          '#': { mesh: 'box', color: '#000', join: { frames } },
          top: { mesh: 'box', color: '#0f0' },
        },
        themes: {
          night: { tiles: { '#': { mesh: 'box', color: '#000', join: { frames: { left: 'nope' } } } } },
        },
      });
    const bad = three({ top: 'top', left: 'side' });
    expect(bad.success).toBe(false);
    expect(
      bad.error?.issues.map((i) => [i.path.join('.'), (i as { params?: { code?: string } }).params?.code]),
    ).toEqual([
      ['tiles.#.join.frames.left', 'missing_ref'],
      ['themes.night.tiles.#.join.frames.left', 'missing_ref'],
    ]);
    expect(three({ top: 'top' }).error?.issues.map((i) => i.path.join('.'))).toEqual([
      'themes.night.tiles.#.join.frames.left',
    ]);
  });

  it('checks the join frames against the sheet', () => {
    const parsed = skin({ frames: { top: 'top', left: 'side' } });
    expect(parsed.success).toBe(true);
    expect(checkSkinRefs('canvas2d', parsed.data!, others)).toEqual([
      expect.objectContaining({
        path: ['tiles', '#', 'join', 'frames', 'left'],
        code: 'missing_frame',
        message: 'sprite "ground" has no frame "side"',
      }),
    ]);
  });
});
