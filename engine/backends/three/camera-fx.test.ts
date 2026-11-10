import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import type { Rasterized } from '@engine/core/gfx/pixelart';
import { freezeFrame, type PresentFrame, type PresentMap, type SkinFile } from '@engine/core/present';
import { PARALLAX_DEPTH_STEP } from './parallax';
import { ThreeScene } from './scene';

// Camera effects and parallax in the 3D scene (Engine 0.16 T4): trauma shake on both axes, zoom
// punches, flashes on the overlay, reduced flashing, the shake setting, hit-pause requests, and
// parallax planes placed where the Canvas2D presenter draws the same layers.

/** One 8 x 8 frame of one colour (inline fixture). */
const HILLS: Rasterized = {
  width: 8,
  height: 8,
  frames: new Map([['hills', { x: 0, y: 0, w: 8, h: 8 }]]),
  data: new Uint8ClampedArray(8 * 8 * 4).fill(200),
};
const pixels: PixelSheetLookup = (id) => (id === 'bg' ? HILLS : null);

const SKIN: SkinFile = {
  backend: 'three',
  sheets: { sheet: 'bg' },
  kinds: { hero: { mesh: 'box', color: '#d82800' } },
  tiles: { '#': { mesh: 'box', color: '#c84c0c' } },
  events: {
    stomp: { shake: { amount: 6, ticks: 8 }, hitPause: { ticks: 3 } },
    hurt: { flash: { color: '#d82800', alpha: 0.8, ticks: 4 } },
    door: { zoom: { to: 2, ticks: 2, hold: 2 } },
  },
  camera: { follow: 'hero' },
  camera3d: { fov: 40, tilt: 0, layerDepth: 16 },
  parallax: [
    { gradient: ['#3cbcfc', '#a4e4fc'], bands: 2, factor: 0 },
    { frame: 'hills', factor: { x: 0.5, y: 0 }, y: 30 },
  ],
};

const LEVEL: PresentMap = {
  id: 'l',
  version: 0,
  tileSize: 16,
  cols: 20,
  rows: 6,
  tiles: Array(6).fill('#'.repeat(20)),
};

function frame(
  n: number,
  events: PresentFrame['events'] = [],
  x = 100,
): ReturnType<typeof freezeFrame<PresentFrame>> {
  return freezeFrame({
    frame: n,
    size: { width: 64, height: 48 },
    entities: [
      {
        id: 'p',
        kind: 'hero',
        x,
        y: 40,
        w: 16,
        h: 16,
        facing: 'right',
        anim: { state: 'idle', t: 0 },
        tags: [],
      },
    ],
    map: n === 0 ? LEVEL : { id: 'l', version: 0 },
    events,
    status: {},
  });
}

/** Where a world point (y down, on the z = 0 plane) lands on the 64 x 48 picture. */
function picture(s: ThreeScene, x: number, y: number, z = 0): [number, number] {
  const v = new Vector3(x, -y, z).project(s.camera);
  return [((v.x + 1) / 2) * 64, ((1 - v.y) / 2) * 48];
}

describe('ThreeScene camera effects (Engine 0.16 T4)', () => {
  it('shakes the camera on both axes from a stomp, decaying, the same each run', () => {
    const run = () => {
      const s = new ThreeScene(SKIN, { seed: 2 });
      s.sync(frame(0));
      const still = s.camera.position.clone();
      const offsets: [number, number][] = [];
      for (let n = 1; n <= 10; n++) {
        s.sync(frame(n, n === 1 ? [{ type: 'stomp' }] : []));
        offsets.push([s.camera.position.x - still.x, s.camera.position.y - still.y]);
      }
      return offsets;
    };
    const offsets = run();
    expect(offsets.slice(0, 8).some(([dx]) => dx !== 0)).toBe(true);
    expect(offsets.slice(0, 8).some(([, dy]) => dy !== 0)).toBe(true);
    expect(offsets.flat().every((v) => Math.abs(v) <= 6)).toBe(true);
    expect(offsets.slice(8)).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(run()).toEqual(offsets);
  });

  it('asks for a hit-pause once per event, and the shake setting turns shaking off', () => {
    const asked: number[] = [];
    const s = new ThreeScene(SKIN, { shakeScale: 0, onHitPause: (t) => asked.push(t) });
    s.sync(frame(0));
    const still = s.camera.position.clone();
    s.sync(frame(1, [{ type: 'stomp' }]));
    s.sync(frame(1, [{ type: 'stomp' }]));
    s.sync(frame(2));
    expect(asked).toEqual([3]);
    expect(s.camera.position.equals(still)).toBe(true);
  });

  it('punches the zoom: the view shrinks about its centre and comes back', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame(0));
    const base = s.view!;
    const widths: number[] = [];
    for (let n = 1; n <= 7; n++) {
      s.sync(frame(n, n === 1 ? [{ type: 'door' }] : []));
      widths.push(s.view!.w);
    }
    expect(widths).toEqual([64, 64 / 1.5, 32, 32, 32, 64 / 1.5, 64]);
    s.sync(frame(8));
    s.sync(frame(9, [{ type: 'door' }]));
    s.sync(frame(11));
    const v = s.view!;
    expect(v.x + v.w / 2).toBeCloseTo(base.x + base.w / 2);
    // The punched view's corners land on the picture's corners.
    expect(picture(s, v.x, v.y)[0]).toBeCloseTo(0);
    expect(picture(s, v.x + v.w, v.y + v.h)[1]).toBeCloseTo(48);
  });

  it('shows a flash on the overlay, fading, and reduced flashing skips it', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame(0));
    s.sync(frame(1, [{ type: 'hurt' }]));
    expect(s.overlay.visible).toBe(true);
    expect(s.overlay.material.opacity).toBeCloseTo(0.8);
    expect(`#${s.overlay.material.color.getHexString()}`).not.toBe('#ffffff');
    s.sync(frame(2));
    s.sync(frame(3));
    expect(s.overlay.material.opacity).toBeCloseTo(0.4);
    s.sync(frame(4));
    s.sync(frame(5));
    expect(s.overlay.visible).toBe(false);
    const calm = new ThreeScene(SKIN, { reduceFlashing: true });
    calm.sync(frame(0));
    calm.sync(frame(1, [{ type: 'hurt' }]));
    expect(calm.overlay.visible).toBe(false);
    // A settings screen can turn it on later.
    calm.effectSettings({ reduceFlashing: false });
    calm.sync(frame(2, [{ type: 'hurt' }]));
    expect(calm.overlay.visible).toBe(true);
  });
});

describe('ThreeScene parallax planes (Engine 0.16 T4)', () => {
  /** The picture px of each visible parallax quad's top-left corner, back to front. */
  function quads(s: ThreeScene): [number, number][] {
    s.scene.updateMatrixWorld(true);
    return s.parallax.meshes().map((m) => {
      // The quad's top-left corner: its centre minus half its size, on its plane.
      const corner = new Vector3(-0.5, 0.5, 0).applyMatrix4(m.matrixWorld).project(s.camera);
      return [
        Math.round(((corner.x + 1) / 2) * 64 * 100) / 100,
        Math.round(((1 - corner.y) / 2) * 48 * 100) / 100,
      ];
    });
  }

  it('places the core layout on planes behind everything, where 2D draws it', () => {
    const s = new ThreeScene(SKIN, { sheets: pixels });
    s.sync(frame(0));
    const draws = s.parallax.draws();
    expect(draws.map((d) => d.kind)).toEqual(['box', 'box', ...Array(draws.length - 2).fill('sprite')]);
    const at = quads(s);
    expect(at).toHaveLength(draws.length);
    for (const [i, d] of draws.entries()) {
      expect(at[i]![0], `draw ${i} x`).toBeCloseTo(d.x, 1);
      expect(at[i]![1], `draw ${i} y`).toBeCloseTo(d.y, 1);
    }
    // On the camera, far behind the blocks, drawn first and never hidden by depth.
    const meshes = s.parallax.meshes();
    expect(s.parallax.group.parent).toBe(s.camera);
    expect(meshes[0]!.position.z).toBeLessThan(-s.camera.position.z - PARALLAX_DEPTH_STEP);
    expect(meshes.every((m) => m.renderOrder < 0 && !m.material.depthTest)).toBe(true);
  });

  it('moves each layer at its own rate as the camera moves', () => {
    const s = new ThreeScene(SKIN, { sheets: pixels });
    s.sync(frame(0, [], 100));
    const before = s.parallax.draws();
    s.sync(frame(1, [], 110));
    const after = s.parallax.draws();
    // The camera moved 10 px: the sky stays, the hills move 5.
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    const hx = (ds: typeof before) => ds.filter((d) => d.layer === 1).map((d) => d.x);
    // Whole 8 px tiles: the first copy moved 5 left, modulo the tile width.
    const moved = hx(after)[0]! - hx(before)[0]!;
    expect((((moved + 5) % 8) + 8) % 8).toBe(0);
    expect(hx(after).every((x, k, xs) => k === 0 || x - xs[k - 1]! === 8)).toBe(true);
  });

  it('shows only gradients without sheets, and nothing for a skin with no parallax', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame(0));
    expect(s.parallax.draws().every((d) => d.kind === 'box')).toBe(true);
    const plain = new ThreeScene({ ...SKIN, parallax: undefined } as unknown as SkinFile);
    plain.sync(frame(0));
    expect(plain.parallax.meshes()).toEqual([]);
  });
});
