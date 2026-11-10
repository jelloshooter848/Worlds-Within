import { describe, expect, it } from 'vitest';
import type { Vector2 } from 'three';
import { Color } from 'three';
import { transitionAt, transitionShape } from '@engine/core/fx';
import { freezeFrame, type PresentFrame, type SkinFile } from '@engine/core/present';
import { ThreeScene } from './scene';
import { TransitionLayer } from './transition';

// The 3D screen transition pass (Engine 0.16 T5): its uniforms from the core shape, and the scene's
// focus (where an iris closes) projected onto the picture. Node only: no WebGL, uniforms only.

const SIZE = { width: 64, height: 48 };

describe('TransitionLayer (Engine 0.16 T5)', () => {
  it('is hidden with no shape and spans the picture with one', () => {
    const layer = new TransitionLayer();
    layer.sync(null, SIZE);
    expect(layer.scene.children[0]!.visible).toBe(false);
    const shape = transitionShape(transitionAt({ kind: 'fade', ticks: 4, color: '#ff0000' }, 1)!, SIZE)!;
    layer.sync(shape, SIZE);
    const mesh = layer.scene.children[0]!;
    expect(mesh.visible).toBe(true);
    expect([mesh.scale.x, mesh.scale.y]).toEqual([64, 48]);
    expect([mesh.position.x, mesh.position.y]).toEqual([32, -24]);
    expect([layer.camera.right, layer.camera.bottom]).toEqual([64, -48]);
    const u = layer.material.uniforms;
    expect(u['uKind']!.value).toBe(0);
    expect(u['uAlpha']!.value).toBe(0.5);
    expect((u['uColor']!.value as Color).equals(new Color('#ff0000'))).toBe(true);
    expect(layer.shown).toEqual(shape);
  });

  it("sets a wipe's band and an iris's circle as the 2D shapes give them", () => {
    const layer = new TransitionLayer();
    const wipe = transitionShape(
      transitionAt({ kind: 'wipe', ticks: 4, direction: 'up', edge: 6 }, 5)!,
      SIZE,
    )!;
    layer.sync(wipe, SIZE);
    const u = layer.material.uniforms;
    expect(u['uKind']!.value).toBe(1);
    expect(u['uDir']!.value).toBe(3);
    expect(wipe.kind === 'wipe' && [u['uLead']!.value, u['uTrail']!.value, u['uEdge']!.value]).toEqual([
      wipe.kind === 'wipe' && wipe.lead,
      wipe.kind === 'wipe' && wipe.trail,
      6,
    ]);
    const iris = transitionShape(transitionAt({ kind: 'iris', ticks: 4 }, 2)!, SIZE, { x: 10, y: 20 })!;
    layer.sync(iris, SIZE);
    expect(u['uKind']!.value).toBe(2);
    expect((u['uCentre']!.value as Vector2).toArray()).toEqual([10, 20]);
    expect(u['uRadius']!.value).toBe(iris.kind === 'iris' && iris.radius);
  });
});

describe('ThreeScene focus (Engine 0.16 T5)', () => {
  const skin: SkinFile = {
    backend: 'three',
    kinds: { hero: { mesh: 'box', color: '#d82800' } },
    camera: { follow: 'hero', lerp: 1 },
    camera3d: { fov: 40, tilt: 0, layerDepth: 16 },
  };
  const frame = (x: number): ReturnType<typeof freezeFrame<PresentFrame>> =>
    freezeFrame({
      frame: 0,
      size: SIZE,
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
      map: { id: 'l', version: 0, tileSize: 16, cols: 20, rows: 6, tiles: Array(6).fill('.'.repeat(20)) },
      events: [],
      status: {},
    });

  it('is the followed entity on the picture: centred when the camera can, off-centre at the map edge', () => {
    const s = new ThreeScene(skin);
    expect(s.focus()).toBeNull();
    s.sync(frame(100));
    const mid = s.focus()!;
    expect(mid.x).toBeCloseTo(32, 4);
    expect(mid.y).toBeCloseTo(24, 4);
    const edge = new ThreeScene(skin);
    edge.sync(frame(0));
    expect(edge.focus()!.x).toBeCloseTo(8, 4);
    expect(edge.focus()!.y).toBeCloseTo(24, 4);
  });
});
