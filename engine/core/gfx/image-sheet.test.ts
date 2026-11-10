import { describe, expect, it } from 'vitest';
import { frameOutside, imageSheetFrameList, imageSheetFrames, imageSheetSchema } from './image-sheet';
import { anchorOffset } from './spritesheet';

const parse = (spec: unknown) => imageSheetSchema.parse(spec);

describe('image sheet frames: grids', () => {
  it('cuts a grid left to right, top to bottom, with margin and spacing', () => {
    const spec = parse({
      image: 'assets/pack/a.png',
      frameSize: { w: 16, h: 24 },
      grid: { cols: 3, rows: 2, margin: 1, spacing: 2 },
    });
    const frames = imageSheetFrames(spec);
    expect([...frames.keys()]).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(frames.get('0')).toEqual({ x: 1, y: 1, w: 16, h: 24 });
    expect(frames.get('2')).toEqual({ x: 37, y: 1, w: 16, h: 24 });
    expect(frames.get('4')).toEqual({ x: 19, y: 27, w: 16, h: 24 });
  });

  it('names cells in order and leaves unnamed ones out', () => {
    const spec = parse({
      image: 'assets/pack/a.png',
      frameSize: { w: 8, h: 8 },
      grid: { cols: 2, rows: 2 },
      names: ['a', 'b', 'c'],
      anchor: 'bottom',
    });
    const frames = imageSheetFrames(spec);
    expect([...frames.keys()]).toEqual(['a', 'b', 'c']);
    expect(frames.get('c')).toEqual({ x: 0, y: 8, w: 8, h: 8, anchor: 'bottom' });
  });

  it("adds named frames, each with its own anchor or the sheet's", () => {
    const spec = parse({
      image: 'assets/pack/a.png',
      frames: {
        hero: { x: 2, y: 3, w: 10, h: 12, anchor: { x: 5, y: 11 } },
        gem: { x: 0, y: 0, w: 4, h: 4 },
      },
      anchor: 'center',
    });
    expect(imageSheetFrameList(spec)).toEqual([
      { name: 'hero', x: 2, y: 3, w: 10, h: 12, anchor: { x: 5, y: 11 }, path: ['frames', 'hero'] },
      { name: 'gem', x: 0, y: 0, w: 4, h: 4, anchor: 'center', path: ['frames', 'gem'] },
    ]);
  });

  it('knows a frame past the image edge', () => {
    expect(frameOutside({ x: 56, y: 1, w: 16, h: 24 }, { width: 72, height: 52 })).toBe(false);
    expect(frameOutside({ x: 57, y: 1, w: 16, h: 24 }, { width: 72, height: 52 })).toBe(true);
    expect(frameOutside({ x: 0, y: 29, w: 16, h: 24 }, { width: 72, height: 52 })).toBe(true);
  });

  it('refuses a sheet without frames, a grid without a size, too many names and bad paths', () => {
    const issues = (spec: unknown) =>
      imageSheetSchema.safeParse(spec).error?.issues.map((i) => i.path.join('.')) ?? [];
    expect(issues({ image: 'assets/p/a.png' })).toEqual(['']);
    expect(issues({ image: 'assets/p/a.png', grid: { cols: 1, rows: 1 } })).toEqual(['frameSize']);
    expect(
      issues({
        image: 'assets/p/a.png',
        frameSize: { w: 1, h: 1 },
        grid: { cols: 1, rows: 1 },
        names: ['a', 'b'],
      }),
    ).toEqual(['names']);
    expect(
      issues({
        image: 'assets/p/a.png',
        frameSize: { w: 1, h: 1 },
        grid: { cols: 2, rows: 1 },
        names: ['a', 'a'],
      }),
    ).toEqual(['names.1']);
    expect(issues({ image: 'content/a.png', frames: { a: { x: 0, y: 0, w: 1, h: 1 } } })).toEqual(['image']);
    expect(issues({ image: 'assets/a.png', frames: { a: { x: 0, y: 0, w: 1, h: 1 } } })).toEqual(['image']);
  });
});

describe('frame anchors', () => {
  const box = { w: 16, h: 16 };
  it('leaves text sprites where they were: no anchor or top-left is the box corner', () => {
    expect(anchorOffset(undefined, { w: 16, h: 24 }, box)).toEqual({ x: 0, y: 0 });
    expect(anchorOffset('top-left', { w: 16, h: 24 }, box)).toEqual({ x: 0, y: 0 });
  });

  it('puts a frame on the box bottom centre or centre', () => {
    expect(anchorOffset('bottom', { w: 16, h: 24 }, box)).toEqual({ x: 0, y: -8 });
    expect(anchorOffset('bottom', { w: 10, h: 12 }, { w: 12, h: 16 })).toEqual({ x: 1, y: 4 });
    expect(anchorOffset('center', { w: 24, h: 24 }, box)).toEqual({ x: -4, y: -4 });
  });

  it('puts a pixel anchor on the bottom centre, mirrored when flipped', () => {
    expect(anchorOffset({ x: 5, y: 20 }, { w: 16, h: 24 }, box)).toEqual({ x: 3, y: -4 });
    expect(anchorOffset({ x: 5, y: 20 }, { w: 16, h: 24 }, box, true)).toEqual({ x: -3, y: -4 });
  });
});
