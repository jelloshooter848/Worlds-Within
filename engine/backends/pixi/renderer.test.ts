import { describe, expect, it } from 'vitest';
import type { Container } from 'pixi.js';
import { Graphics, Sprite, Text, Texture } from 'pixi.js';
import { blended, clipped, glowing, transformed, translucent } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { glowHalo, GRADIENT_SIZE, HALO_SIZE, PixiRenderer, radialTexture } from './renderer';

// pixi.js imports and builds display objects in Node with no DOM adapter: nothing here renders.

const sheet: SpriteSheet = {
  id: 'test',
  image: null,
  frames: new Map([
    ['f', { x: 8, y: 0, w: 8, h: 4 }],
    ['A', { x: 0, y: 8, w: 8, h: 8 }],
    ['B', { x: 8, y: 8, w: 8, h: 8 }],
  ]),
};

const size = { width: 256, height: 240 };

function renderer(): PixiRenderer {
  return new PixiRenderer({ size });
}

/** Where a sprite's texel (u, v) centre lands in its parent's space. */
function texel(s: Sprite, u: number, v: number): [number, number] {
  s.updateLocalTransform();
  const p = s.localTransform.apply({
    x: u + 0.5 - s.anchor.x * s.texture.frame.width,
    y: v + 0.5 - s.anchor.y * s.texture.frame.height,
  });
  return [Math.round(p.x * 2) / 2, Math.round(p.y * 2) / 2];
}

function only<T>(list: readonly unknown[], type: new (...a: never[]) => T): T[] {
  return list.filter((c): c is T => c instanceof type);
}

describe('PixiRenderer boxes, lines and text', () => {
  it('clears to a picture-sized white sprite tinted the colour, dropping what was drawn', () => {
    const r = renderer();
    r.rect(1, 2, 3, 4, '#ff0000');
    r.clear('#102030');
    expect(r.stage.children).toHaveLength(1);
    const bg = r.stage.children[0] as Sprite;
    expect(bg.texture).toBe(Texture.WHITE);
    expect(bg.tint).toBe(0x102030);
    expect([bg.x, bg.y, bg.scale.x, bg.scale.y]).toEqual([0, 0, 256, 240]);
  });

  it('draws a rect as a tinted white sprite in whole pixels, its colour alpha as alpha', () => {
    const r = renderer();
    r.rect(10.7, 20.2, 5.9, 3, 'rgba(0, 255, 0, 0.5)');
    const s = r.stage.children[0] as Sprite;
    expect([s.x, s.y, s.scale.x, s.scale.y]).toEqual([10, 20, 5, 3]);
    expect(s.tint).toBe(0x00ff00);
    expect(s.alpha).toBe(0.5);
  });

  it('draws a line from pixel centre to pixel centre, 1 px wide', () => {
    const r = renderer();
    r.line(0, 0, 10, 0, '#fff');
    r.line(5, 5, 5, 15, '#fff');
    const [h, v] = r.stage.children as Sprite[];
    expect([h?.x, h?.y, h?.scale.x, h?.scale.y, h?.rotation]).toEqual([0.5, 0.5, 10, 1, 0]);
    expect([v?.x, v?.y, v?.scale.x]).toEqual([5.5, 5.5, 10]);
    expect(v?.rotation).toBeCloseTo(Math.PI / 2);
    expect(h?.anchor.y).toBe(0.5);
  });

  it('draws bitmap text one sprite per glyph, 8 px apart, skipping spaces', () => {
    const r = renderer();
    r.text(sheet, 'A B', 4, 6);
    const glyphs = r.stage.children as Sprite[];
    expect(glyphs).toHaveLength(2);
    expect(glyphs.map((g) => texel(g, 0, 0))).toEqual([
      [4.5, 6.5],
      [20.5, 6.5],
    ]);
  });

  it('draws debug text as a pooled PixiJS Text in its colour', () => {
    const r = renderer();
    r.debugText('fps 60', 2, 10, '#ff0');
    const [t] = only(r.stage.children, Text);
    expect(t?.text).toBe('fps 60');
    expect(t?.style.fill).toBe(0xffff00);
    expect([t?.x, t?.y]).toEqual([2, 3]);
  });
});

describe('PixiRenderer sprites', () => {
  it('cuts each frame once as a sub-rectangle texture of one source per sheet', () => {
    const r = renderer();
    r.sprite(sheet, 'f', 0, 0);
    r.sprite(sheet, 'f', 10, 0);
    r.sprite(sheet, 'A', 20, 0);
    const [a, b, c] = r.stage.children as Sprite[];
    expect(a?.texture).toBe(b?.texture);
    expect(a?.texture.frame).toMatchObject({ x: 8, y: 0, width: 8, height: 4 });
    expect(c?.texture.source).toBe(a?.texture.source);
    r.sprite(sheet, 'missing', 0, 0);
    expect(r.stage.children).toHaveLength(3);
  });

  it('turns an 8x4 frame clockwise inside the 4x8 box at (x, y), as the canvas renderer', () => {
    const cases: [0 | 90 | 180 | 270, [number, number], [number, number]][] = [
      // The same table as canvas2d/renderer.test.ts: texel (0,0) and (7,3) centres.
      [0, [10.5, 20.5], [17.5, 23.5]],
      [90, [13.5, 20.5], [10.5, 27.5]],
      [180, [17.5, 23.5], [10.5, 20.5]],
      [270, [10.5, 27.5], [13.5, 20.5]],
    ];
    for (const [rot, first, last] of cases) {
      const r = renderer();
      r.sprite(sheet, 'f', 10, 20, false, false, rot);
      const s = r.stage.children[0] as Sprite;
      expect([texel(s, 0, 0), texel(s, 7, 3)], `rotate ${rot}`).toEqual([first, last]);
    }
  });

  it('flips before turning, and flips in place unturned', () => {
    const r = renderer();
    r.sprite(sheet, 'f', 10, 20, true, false, 90);
    r.sprite(sheet, 'f', 10, 20, false, true);
    const [turned, flipped] = r.stage.children as Sprite[];
    expect(texel(turned as Sprite, 0, 0)).toEqual([13.5, 27.5]);
    expect(texel(flipped as Sprite, 0, 0)).toEqual([10.5, 23.5]);
  });

  it('scales an unrotated frame to whole pixels, at least one', () => {
    const r = renderer();
    r.sprite(sheet, 'f', 0, 0, false, false, 0, 2);
    r.sprite(sheet, 'f', 0, 0, true, false, 0, 0.5);
    const [big, small] = r.stage.children as Sprite[];
    expect([big?.scale.x, big?.scale.y, big?.x, big?.y]).toEqual([2, 2, 8, 4]);
    expect([small?.scale.x, small?.scale.y]).toEqual([-0.5, 0.5]);
  });

  it('takes the sheet source from the factory given', () => {
    const made: string[] = [];
    const r = new PixiRenderer({
      size,
      sheetSource: (s) => {
        made.push(s.id);
        return Texture.WHITE.source;
      },
    });
    r.sprite(sheet, 'A', 0, 0);
    r.sprite(sheet, 'B', 0, 0);
    expect(made).toEqual(['test']);
  });
});

describe('PixiRenderer scopes', () => {
  it("multiplies alpha into each object's own alpha, nested scopes too, with no container", () => {
    const r = renderer();
    translucent(r, 0.25, () => {
      r.rect(0, 0, 1, 1, '#fff');
      translucent(r, 0.5, () => r.rect(0, 0, 1, 1, '#ffffff80'));
    });
    r.rect(0, 0, 1, 1, '#fff');
    expect(only(r.stage.children, Sprite)).toHaveLength(3);
    const [a, b, after] = r.stage.children as Sprite[];
    expect(a?.alpha).toBe(0.25);
    expect(b?.alpha).toBeCloseTo(0.125 * 0.5, 2);
    expect(after?.alpha).toBe(1);
  });

  it("sets PixiJS's add blend mode on each object drawn in an add scope, with no container", () => {
    const r = renderer();
    blended(r, 'add', () => {
      r.rect(0, 0, 2, 2, '#f00');
      r.sprite(sheet, 'A', 0, 0);
      r.blend('normal', () => r.rect(0, 0, 1, 1, '#fff'));
    });
    r.rect(0, 0, 1, 1, '#fff');
    expect(r.stage.children.map((c) => [c instanceof Sprite, c.blendMode])).toEqual([
      [true, 'add'],
      [true, 'add'],
      [true, 'normal'],
      [true, 'normal'],
    ]);
  });

  it('gives a glow halo the scope alpha and blend mode of its shape', () => {
    const r = renderer();
    blended(r, 'add', () =>
      glowing(r, '#ff0000', 2, () => translucent(r, 0.5, () => r.rect(4, 4, 2, 2, '#fff'))),
    );
    const [halo, box] = r.stage.children as Sprite[];
    expect(halo?.texture).toBe(glowHalo());
    expect([halo?.blendMode, box?.blendMode]).toEqual(['add', 'add']);
    expect(box?.alpha).toBe(0.5);
  });

  it('puts a tinted halo sprite behind each glowing shape, grown by the radius', () => {
    const r = renderer();
    glowing(r, '#ffcc00', 4, () => {
      r.rect(10, 10, 8, 8, '#fff');
      r.sprite(sheet, 'f', 30, 10);
    });
    r.rect(0, 0, 1, 1, '#fff');
    const kids = r.stage.children as Sprite[];
    expect(kids).toHaveLength(5);
    const [halo1, box, halo2, spr, plain] = kids;
    expect(halo1?.texture).toBe(glowHalo());
    expect(halo1?.tint).toBe(0xffcc00);
    expect([halo1?.x, halo1?.y]).toEqual([6, 6]);
    expect([halo1?.scale.x, halo1?.scale.y]).toEqual([16 / HALO_SIZE, 16 / HALO_SIZE]);
    expect(box?.texture).toBe(Texture.WHITE);
    expect([halo2?.x, halo2?.y, (halo2?.scale.x ?? 0) * HALO_SIZE]).toEqual([26, 6, 16]);
    expect(spr?.texture.frame.width).toBe(8);
    expect(plain?.texture).toBe(Texture.WHITE);
  });

  it('makes the halo texture once, soft: opaque in the middle, clear at the edge', () => {
    const halo = glowHalo();
    expect(glowHalo()).toBe(halo);
    expect(halo.frame.width).toBe(HALO_SIZE);
    const px = (halo.source as unknown as { resource: Uint8Array }).resource;
    const at = (x: number, y: number) => px[(y * HALO_SIZE + x) * 4 + 3] ?? -1;
    expect(at(HALO_SIZE / 2, HALO_SIZE / 2)).toBeGreaterThan(200);
    expect(at(0, 0)).toBe(0);
  });

  it('clips with a container masked by a pooled rectangle in whole pixels', () => {
    const r = renderer();
    clipped(r, 4.5, 6, 10, 12, () => r.rect(0, 0, 50, 50, '#fff'));
    const [c] = r.stage.children as Container[];
    const mask = c?.mask as Graphics;
    expect(mask).toBeInstanceOf(Graphics);
    expect(mask.parent).toBe(c);
    expect(mask.bounds).toMatchObject({ minX: 4, minY: 6, maxX: 14, maxY: 18 });
    expect(only(c?.children ?? [], Sprite)).toHaveLength(1);
  });

  it('nests a transform: moved, turned and scaled, drawing about (0, 0)', () => {
    const r = renderer();
    transformed(r, 40, 50, Math.PI / 2, 2, 3, (local) => {
      expect(local).toBe(r);
      local.rect(-1, -1, 2, 2, '#fff');
      translucent(local, 0.5, () => local.line(0, 0, 4, 0, '#fff'));
    });
    const [c] = r.stage.children as Container[];
    expect([c?.x, c?.y, c?.rotation, c?.scale.x, c?.scale.y]).toEqual([40, 50, Math.PI / 2, 2, 3]);
    const [box, line] = c?.children ?? [];
    expect([box?.x, box?.y]).toEqual([-1, -1]);
    expect(line?.alpha).toBe(0.5);
    expect(c?.children).toHaveLength(2);
  });

  it('adds a clear inside a scope as a box there, keeping the frame', () => {
    const r = renderer();
    r.rect(0, 0, 1, 1, '#fff');
    r.alpha(0.5, () => r.clear('#000'));
    expect(r.stage.children).toHaveLength(2);
  });
});

describe('PixiRenderer pools', () => {
  function drawFrame(r: PixiRenderer): void {
    r.clear('#000');
    blended(r, 'add', () => glowing(r, '#0ff', 3, () => r.rect(1, 1, 2, 2, '#fff')));
    clipped(r, 0, 0, 10, 10, () => r.sprite(sheet, 'A', 0, 0));
    transformed(r, 5, 5, 0, 1, 1, (l) => l.line(0, 0, 3, 3, '#fff'));
    r.debugText('x', 0, 8);
  }

  it('reuses the same display objects frame after frame', () => {
    const r = renderer();
    drawFrame(r);
    const first = r.pools();
    const objects = [...r.stage.children];
    for (let i = 0; i < 5; i++) drawFrame(r);
    expect(r.pools()).toEqual(first);
    expect(first.used).toEqual({ sprites: 5, containers: 2, masks: 1, texts: 1 });
    expect(r.stage.children).toEqual(objects);
  });

  it('resets a reused container: no stale alpha, blend, mask or transform', () => {
    const r = renderer();
    r.clear('#000');
    r.transform(3, 4, 1, 2, 2, () => {
      const c = r.stage.children[1] as Container;
      c.alpha = 0.2;
      c.blendMode = 'add';
      r.clip(0, 0, 1, 1, () => undefined);
    });
    r.beginFrame();
    r.transform(0, 0, 0, 1, 1, () => r.rect(0, 0, 1, 1, '#fff'));
    const [c] = r.stage.children as Container[];
    expect([c?.x, c?.y, c?.rotation, c?.scale.x, c?.alpha, c?.blendMode]).toEqual([0, 0, 0, 1, 1, 'inherit']);
    expect(c?.mask).toBeFalsy();
    expect(c?.children).toHaveLength(1);
  });

  it('keeps a reused mask hidden when the scope order changes between frames', () => {
    const r = renderer();
    // Frame 1: the clip is the second container, so its mask is held by container 1.
    r.transform(0, 0, 0, 1, 1, () => r.clip(0, 0, 4, 4, () => r.rect(0, 0, 8, 8, '#fff')));
    // Frame 2: the clip takes container 0 (and mask 0); the transform then reuses container 1.
    r.beginFrame();
    r.clip(0, 0, 4, 4, () => r.rect(0, 0, 8, 8, '#fff'));
    r.transform(0, 0, 0, 1, 1, () => r.rect(0, 0, 1, 1, '#fff'));
    const mask = (r.stage.children[0] as Container).mask as Graphics;
    expect(mask).toBeInstanceOf(Graphics);
    expect([mask.includeInBuild, mask.measurable]).toEqual([false, false]);
  });

  it('starts each frame opaque and normal, even after a scope that threw', () => {
    const r = renderer();
    expect(() =>
      r.alpha(0.5, () =>
        r.blend('add', () =>
          r.glow('#f00', 2, () => {
            throw new Error('boom');
          }),
        ),
      ),
    ).toThrow('boom');
    r.beginFrame();
    r.rect(0, 0, 1, 1, '#fff');
    const [s] = r.stage.children as Sprite[];
    expect([r.stage.children.length, s?.alpha, s?.blendMode]).toEqual([1, 1, 'normal']);
  });
});

describe('PixiRenderer backdrop (T13b-7)', () => {
  it('turns a top-level opaque clear into the backdrop colour, adding no sprite', () => {
    const r = new PixiRenderer({ size, backdrop: true });
    r.rect(1, 1, 1, 1, '#fff');
    r.clear('#102030');
    expect([r.backdrop, r.stage.children.length]).toEqual([0x102030, 0]);
    r.alpha(0.5, () => r.clear('#000'));
    expect(r.stage.children).toHaveLength(1);
    expect(r.backdrop).toBe(0x102030);
    r.clear('rgba(0, 0, 0, 0.5)');
    expect([r.backdrop, r.stage.children.length]).toEqual([null, 1]);
    r.beginFrame();
    expect(r.backdrop).toBeNull();
  });

  it('keeps the box without the option', () => {
    const r = renderer();
    r.clear('#102030');
    expect([r.backdrop, r.stage.children.length]).toEqual([null, 1]);
  });
});

describe('PixiRenderer culling (T13b-7)', () => {
  it('drops boxes, sprites and lines wholly outside the picture, keeping those that touch it', () => {
    const r = renderer();
    r.rect(-4, 0, 4, 4, '#fff'); // ends at x 0: outside
    r.rect(-4, 0, 5, 4, '#fff'); // one column in
    r.rect(256, 0, 4, 4, '#fff'); // starts at the right edge: outside
    r.rect(0, 240, 4, 4, '#fff'); // below
    r.sprite(sheet, 'A', -8, -8); // ends at the corner: outside
    r.sprite(sheet, 'A', 250, 236); // partly in
    r.line(-10, -5, -2, -1, '#fff'); // outside
    r.line(-10, 5, 2, 5, '#fff'); // crosses in
    expect(r.stage.children).toHaveLength(3);
    expect(r.pools().used.sprites).toBe(3);
  });

  it('keeps a shape just outside whose glow reaches into the picture', () => {
    const r = renderer();
    glowing(r, '#f00', 3, () => {
      r.rect(-5, 0, 4, 4, '#fff'); // 1 px out: its halo reaches 2 px in
      r.rect(-8, 0, 4, 4, '#fff'); // 4 px out: its halo ends at 0
    });
    expect(r.stage.children).toHaveLength(2);
  });

  it('never culls inside a transform, where boxes are in local space', () => {
    const r = renderer();
    transformed(r, 300, 300, 0, 1, 1, () => r.rect(-400, -400, 4, 4, '#fff'));
    const [c] = r.stage.children as Container[];
    expect(c?.children).toHaveLength(1);
    r.rect(-400, -400, 4, 4, '#fff');
    expect(r.stage.children).toHaveLength(1);
  });
});

describe('PixiRenderer radial gradients (Engine 0.16 part D, D1: lighting)', () => {
  const stops = [
    { at: 0, alpha: 0.8 },
    { at: 1, alpha: 0 },
  ];

  it('draws one sprite over the circle, tinted, its peak as alpha, in the mode asked', () => {
    const r = renderer();
    r.gradient({ x: 50, y: 40, radius: 10, color: '#f8b800', stops, mode: 'add' });
    r.gradient({ x: 50, y: 40, radius: 10, color: '#000000', stops, mode: 'erase' });
    const [add, erase] = only(r.stage.children, Sprite);
    expect(add!.texture).toBe(radialTexture(stops));
    expect([add!.x, add!.y, add!.width, add!.height]).toEqual([40, 30, 20, 20]);
    expect(add!.tint).toBe(0xf8b800);
    expect(add!.alpha).toBeCloseTo(0.8);
    expect(add!.blendMode).toBe('add');
    expect(erase!.blendMode).toBe('erase');
  });

  it('shares one texture between lights of one shape at other strengths', () => {
    const half = stops.map((s) => ({ ...s, alpha: s.alpha / 2 }));
    expect(radialTexture(half)).toBe(radialTexture(stops));
    expect(
      radialTexture([
        { at: 0, alpha: 1 },
        { at: 0.5, alpha: 1 },
        { at: 1, alpha: 0 },
      ]),
    ).not.toBe(radialTexture(stops));
    expect(radialTexture(stops).width).toBe(GRADIENT_SIZE);
  });

  it('clips to a box inside the picture, never for one covering it, and skips one off the picture', () => {
    const r = renderer();
    const v = [
      { at: 0, alpha: 0 },
      { at: 1, alpha: 0.5 },
    ];
    r.gradient({
      x: 128,
      y: 120,
      radius: 177,
      color: '#000',
      stops: v,
      mode: 'normal',
      box: { x: 0, y: 0, w: 256, h: 240 },
    });
    expect(only(r.stage.children, Sprite)).toHaveLength(1);
    r.gradient({
      x: 20,
      y: 20,
      radius: 20,
      color: '#000',
      stops: v,
      mode: 'normal',
      box: { x: 10, y: 10, w: 5, h: 5 },
    });
    expect(r.stage.children.at(-1)!.mask).not.toBeNull();
    const before = r.stage.children.length;
    r.gradient({ x: -100, y: 20, radius: 20, color: '#000', stops: v, mode: 'add' });
    expect(r.stage.children).toHaveLength(before);
  });
});
