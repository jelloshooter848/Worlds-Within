import { describe, expect, it } from 'vitest';
import {
  AdditiveBlending,
  Mesh,
  type BufferGeometry,
  type MeshBasicMaterial,
  type Points,
  type ShaderMaterial,
} from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { Rasterized } from '@engine/core/gfx/pixelart';
import { freezeFrame, type PresentFrame, type SkinFile } from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { threeScenePresenter } from './display';
import { PARTICLE_POOL, PARTICLE_Z, ThreeScene } from './scene';

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

describe('ThreeScene: the UI kit HUD (Engine 0.16 T6)', () => {
  /** One 2x2 glyph, an L of three pixels. */
  const FONT = buildFont('f', { cell: { w: 2, h: 2 }, baseline: 2, glyphs: { L: { rows: ['#.', '##'] } } });
  const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);
  const UI: SkinFile = {
    backend: 'three',
    sheets: { sheet: 'icons' },
    kinds: {},
    hud: [
      { as: 'panel', x: 0, y: 0, w: 12, h: 6, frame: 'coin', slice: 2 },
      { status: 'hp', as: 'bar', x: 20, y: 0, w: 10, h: 2, max: 4, back: '#000' },
      { as: 'text', x: 40, y: 0, font: 'f', format: 'L', color: '#ff0000' },
      { as: 'minimap', x: 60, y: 0, w: 4, h: 2, tiles: { '#': '#00a800' } },
    ],
  };

  it('places panel pieces, fills, glyphs and the minimap as quads in order', () => {
    const scene = new ThreeScene(UI, { sheets: pixels, fonts });
    const map = { id: 'm', version: 1, tileSize: 16, cols: 2, rows: 1, tiles: ['#.'] };
    scene.sync(freezeFrame(frame({ status: { hp: 2 }, map })));
    const quads = scene.hud.quads();
    expect(quads.slice(0, 9).every((q) => q.kind === 'sprite' && q.frame === 'coin')).toBe(true);
    expect(quads[0]).toMatchObject({ x: 0, y: 0, w: 2, h: 2, part: { x: 0, y: 0, w: 2, h: 2 } });
    expect(quads[4]).toMatchObject({ x: 2, y: 2, w: 8, h: 2, part: { x: 2, y: 2, w: 4, h: 4 } });
    expect(quads.slice(9)).toEqual([
      { kind: 'fill', x: 20, y: 0, w: 10, h: 2, color: '#000' },
      { kind: 'fill', x: 20, y: 0, w: 5, h: 2, color: '#00a800' },
      { kind: 'glyph', x: 40, y: 0, w: 2, h: 2, font: 'f', ch: 'L', color: '#ff0000' },
      { kind: 'fill', x: 60, y: 0, w: 2, h: 2, color: '#00a800' },
    ]);
    const meshes = scene.hud.scene.children.filter((c): c is Mesh => c instanceof Mesh && c.visible);
    // Every HUD material is transparent, so draw order alone stacks them (a fill over a panel).
    expect(meshes.every((m) => (m.material as MeshBasicMaterial).transparent)).toBe(true);
    expect(meshes.map((m) => m.renderOrder)).toEqual(meshes.map((_, i) => i));
    // The glyph's texture: its ink in its colour, rows flipped for GL.
    const glyph = (meshes[11]!.material as MeshBasicMaterial).map!.image as { data: Uint8Array };
    expect([...glyph.data]).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 0]);
    scene.dispose();
  });

  it('keeps a skin with only classic items on the old layout', () => {
    const scene = new ThreeScene(SKIN, { sheets: pixels, fonts });
    scene.sync(frame({ status: { hp: 1 } }));
    expect(scene.hud.quads()).toEqual([
      { kind: 'sprite', sheet: 'icons', frame: 'heart', x: 8, y: 8, w: 7, h: 6 },
    ]);
  });
});

describe('ThreeScene: particles (G33, Engine 0.16 T3)', () => {
  /** The points a blend's buffer draws now: [x, y, z, size] each. */
  const drawn = (scene: ThreeScene, blend: 'normal' | 'add' = 'normal') => {
    const points = scene.particles.getObjectByName(`particles:${blend}`) as Points<BufferGeometry>;
    const g = points.geometry;
    const pos = g.attributes['position']!;
    const size = g.attributes['pSize']!;
    return Array.from({ length: g.drawRange.count }, (_, i) => [
      pos.getX(i),
      pos.getY(i),
      pos.getZ(i),
      size.getX(i),
    ]);
  };

  it('shows an old particles effect as points flying out from the event, for their ticks', () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame({ events: [{ type: 'burst', x: 40, y: 20 }] }));
    expect(drawn(scene)).toEqual([
      [40, -20, PARTICLE_Z, 2],
      [40, -20, PARTICLE_Z, 2],
      [40, -20, PARTICLE_Z, 2],
      [40, -20, PARTICLE_Z, 2],
    ]);
    scene.sync(frame({ frame: 2 }));
    expect(drawn(scene).map(([x, y]) => [Math.round(x!), Math.round(y!)])).toEqual([
      [42, -20],
      [40, -22],
      [38, -20],
      [40, -18],
    ]);
    expect(scene.particleViews()[0]!.color).toBe('#f8d800');
    scene.sync(frame({ frame: 3 }));
    expect(drawn(scene)).toEqual([]);
    expect(scene.particles.getObjectByName('particles:normal')!.visible).toBe(false);
  });

  it("starts at an event's entity centre and keeps each buffer at most PARTICLE_POOL points", () => {
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
    expect(drawn(scene)[0]!.slice(0, 2)).toEqual([14, -12]);
    const many = Array.from({ length: 400 }, () => ({ type: 'burst', x: 0, y: 0 }));
    scene.sync(frame({ frame: 1, events: many }));
    expect(drawn(scene)).toHaveLength(PARTICLE_POOL);
    scene.dispose();
  });

  it('draws additive emitters through the additive buffer, and kinds emit while shown', () => {
    const skin: SkinFile = {
      ...SKIN,
      kinds: { torch: { mesh: 'box', color: '#888', emit: 'flame' } },
      emitters: {
        flame: { rate: 1, life: 4, speed: 0.5, angle: 270, blend: 'add', color: ['#f8d800', '#d82800'] },
      },
    };
    const torch = {
      id: 't',
      kind: 'torch',
      x: 100,
      y: 50,
      w: 8,
      h: 8,
      facing: 'right' as const,
      anim: { state: 'idle', t: 0 },
      tags: [],
    };
    const scene = new ThreeScene(skin);
    for (let f = 0; f < 6; f++) scene.sync(frame({ frame: f, entities: [torch] }));
    expect(drawn(scene, 'add')).toHaveLength(4);
    expect(drawn(scene, 'normal')).toHaveLength(0);
    const add = scene.particles.getObjectByName('particles:add') as Points<BufferGeometry, ShaderMaterial>;
    expect(add.material.blending).toBe(AdditiveBlending);
    // Rising from the torch's centre.
    for (const [x, y] of drawn(scene, 'add')) {
      expect(x).toBeCloseTo(104);
      expect(y).toBeGreaterThanOrEqual(-54);
    }
    // With reduced flashing the same particles go through the normal buffer, dimmer.
    const calm = new ThreeScene(skin, { reduceFlashing: true });
    for (let f = 0; f < 6; f++) calm.sync(frame({ frame: f, entities: [torch] }));
    expect(drawn(calm, 'add')).toHaveLength(0);
    expect(drawn(calm, 'normal')).toHaveLength(4);
    // The torch gone: no new particles, the live ones finish.
    for (let f = 6; f < 12; f++) scene.sync(frame({ frame: f }));
    expect(drawn(scene, 'add')).toHaveLength(0);
  });
});
