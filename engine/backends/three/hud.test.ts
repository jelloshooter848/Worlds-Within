import { describe, expect, it } from 'vitest';
import { Mesh, type MeshBasicMaterial } from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { Rasterized } from '@engine/core/gfx/pixelart';
import { freezeFrame, type PresentFrame, type SkinFile } from '@engine/core/present';
import { threeScenePresenter } from './display';
import { PARTICLE_POOL, ThreeScene } from './scene';

/** A sheet of frames side by side, each `w` x `h`, filled with one colour (inline fixture). */
function sheet(frames: Record<string, [number, number, [number, number, number]]>): Rasterized {
  const names = Object.keys(frames);
  const width = names.reduce((s, n) => s + frames[n]![0], 0);
  const height = Math.max(...names.map((n) => frames[n]![1]));
  const data = new Uint8ClampedArray(width * height * 4);
  const rects = new Map<string, { x: number; y: number; w: number; h: number }>();
  let x = 0;
  for (const n of names) {
    const [w, h, rgb] = frames[n]!;
    rects.set(n, { x, y: 0, w, h });
    for (let row = 0; row < h; row++)
      for (let col = 0; col < w; col++) {
        const o = (row * width + x + col) * 4;
        // The top row's blue is 99, so a test can see the rows were flipped for GL.
        data.set([rgb[0], rgb[1], row === 0 ? 99 : rgb[2], 255], o);
      }
    x += w;
  }
  return { width, height, frames: rects, data };
}

const SHEETS: Record<string, Rasterized> = {
  icons: sheet({ heart: [7, 6, [216, 40, 0]], coin: [8, 8, [248, 216, 0]] }),
  digits: sheet({ '1': [8, 8, [252, 252, 252]], '2': [8, 8, [252, 252, 252]] }),
};
const pixels: PixelSheetLookup = (id) => SHEETS[id] ?? null;

const SKIN: SkinFile = {
  backend: 'three',
  sheets: { sheet: 'icons', fallbackColor: '#00a800' },
  kinds: {},
  events: {
    burst: { effect: { kind: 'particles', color: '#f8d800', count: 4, size: 2, ticks: 3 } },
  },
  hud: [
    { status: 'hp', as: 'hearts', x: 8, y: 8, frame: 'heart' },
    { status: 'coins', as: 'icon', x: 40, y: 8, frame: 'coin' },
    { status: 'coins', as: 'number', x: 50, y: 8, font: 'digits' },
    { status: 'lost', as: 'icon', x: 100, y: 8, frame: 'missing' },
  ],
};

function frame(over: Partial<PresentFrame> = {}): PresentFrame {
  return { frame: 0, size: { width: 128, height: 96 }, entities: [], events: [], status: {}, ...over };
}

describe('ThreeScene: the HUD pass (G33)', () => {
  it('draws one quad per HUD item of frame.status, in picture pixels, as the 2D HUD lays it out', () => {
    const scene = new ThreeScene(SKIN, { sheets: pixels });
    scene.sync(freezeFrame(frame({ status: { hp: 2, coins: 12, lost: true } })));
    expect(scene.hud.quads()).toEqual([
      { kind: 'sprite', sheet: 'icons', frame: 'heart', x: 8, y: 8, w: 7, h: 6 },
      { kind: 'sprite', sheet: 'icons', frame: 'heart', x: 16, y: 8, w: 7, h: 6 },
      { kind: 'sprite', sheet: 'icons', frame: 'coin', x: 40, y: 8, w: 8, h: 8 },
      { kind: 'sprite', sheet: 'digits', frame: '1', x: 50, y: 8, w: 8, h: 8 },
      { kind: 'sprite', sheet: 'digits', frame: '2', x: 58, y: 8, w: 8, h: 8 },
      { kind: 'box', x: 100, y: 8, w: 8, h: 8, color: '#00a800' },
    ]);
    // The orthographic camera spans the picture, y down as negative y.
    const cam = scene.hud.camera;
    expect([cam.left, cam.right, cam.top, cam.bottom]).toEqual([0, 128, 0, -96]);
    const meshes = scene.hud.scene.children.filter((c): c is Mesh => c instanceof Mesh && c.visible);
    expect(meshes).toHaveLength(6);
    const first = meshes[0]!;
    expect([first.position.x, first.position.y, first.scale.x, first.scale.y]).toEqual([11.5, -11, 7, 6]);
    const image = (first.material as MeshBasicMaterial).map!.image as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    expect([image.width, image.height]).toEqual([7, 6]);
    // GL's first row is the bottom: the sheet's top row is the texture's last.
    const data = image.data;
    expect([...data.subarray(0, 4)]).toEqual([216, 40, 0, 255]);
    expect([...data.subarray(5 * 7 * 4, 5 * 7 * 4 + 4)]).toEqual([216, 40, 99, 255]);
    expect((meshes[5]!.material as MeshBasicMaterial).map).toBeNull();
  });

  it('follows the status each frame: fewer hearts hide quads, a missing value draws nothing', () => {
    const scene = new ThreeScene(SKIN, { sheets: pixels });
    scene.sync(frame({ status: { hp: 3, coins: 1 } }));
    expect(scene.hud.quads()).toHaveLength(5);
    scene.sync(frame({ frame: 1, status: { hp: 1 } }));
    expect(scene.hud.quads().map((q) => q.frame)).toEqual(['heart']);
    expect(scene.hud.scene.children.filter((c) => c.visible)).toHaveLength(1);
    scene.sync(frame({ frame: 2 }));
    expect(scene.hud.quads()).toEqual([]);
    scene.dispose();
  });

  it('without sheets, hearts and icons are boxes and text draws nothing', () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame({ status: { hp: 1, coins: 3 } }));
    expect(scene.hud.quads().map((q) => q.kind)).toEqual(['box', 'box']);
  });

  it('threeScenePresenter hands the sheets to every scene, and the round skins draw their own HUD', () => {
    const round: SkinFile = { ...SKIN, hud: [{ status: 'hp', as: 'hearts', x: 0, y: 0, frame: 'heart' }] };
    const p = threeScenePresenter(SKIN, {
      screen: { width: 128, height: 96 },
      rounds: { r: round },
      sheets: pixels,
    });
    p.present(frame({ status: { hp: 2, coins: 21 } }));
    expect(p.scene.hud.quads()).toHaveLength(5);
    p.present(frame({ frame: 1, status: { hp: 2, coins: 21, miniGame: 'r' } }));
    expect(p.shown).toBe(p.rounds['r']);
    expect(p.rounds['r']!.hud.quads().map((q) => [q.x, q.y])).toEqual([
      [0, 0],
      [8, 0],
    ]);
  });
});

describe('ThreeScene: particles (G33)', () => {
  it('shows particles effects as boxes flying out from the event, for their ticks', () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame({ events: [{ type: 'burst', x: 40, y: 20 }] }));
    const shown = () => scene.particles.children.filter((c) => c.visible) as Mesh[];
    expect(shown()).toHaveLength(4);
    expect(shown().map((b) => [b.position.x, b.position.y, b.scale.x])).toEqual([
      [40, -20, 2],
      [40, -20, 2],
      [40, -20, 2],
      [40, -20, 2],
    ]);
    scene.sync(frame({ frame: 2 }));
    const at = shown().map((b) => [Math.round(b.position.x), Math.round(b.position.y)]);
    expect(at).toEqual([
      [42, -20],
      [40, -22],
      [38, -20],
      [40, -18],
    ]);
    expect((shown()[0]!.material as MeshBasicMaterial).color.getHexString()).toBe('f8d800');
    scene.sync(frame({ frame: 3 }));
    expect(shown()).toHaveLength(0);
  });

  it("starts at an event's entity centre and keeps the pool at most PARTICLE_POOL boxes", () => {
    const scene = new ThreeScene(SKIN);
    const box = {
      id: 'e',
      kind: 'x',
      x: 10,
      y: 10,
      w: 8,
      h: 4,
      facing: 'right' as const,
      anim: { state: 'idle', t: 0 },
      tags: [],
    };
    scene.sync(frame({ entities: [box], events: [{ type: 'burst', entity: 'e' }] }));
    const first = scene.particles.children[0]!;
    expect([first.position.x, first.position.y]).toEqual([14, -12]);
    const many = Array.from({ length: 100 }, () => ({ type: 'burst', x: 0, y: 0 }));
    scene.sync(frame({ frame: 1, events: many }));
    expect(scene.particles.children.length).toBe(PARTICLE_POOL);
    scene.dispose();
  });
});
