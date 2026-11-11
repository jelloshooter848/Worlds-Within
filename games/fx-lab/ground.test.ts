import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ModelLibrary, ThreeScene } from '@engine/backends/three';
import {
  contentDecor,
  freezeFrame,
  groundFacingTurn,
  facingVector,
  skinGroundCamera,
} from '@engine/core/present';
import { readGameFiles } from '@engine/core/node/game-files';
import { contentFonts } from '@engine/core/ui';
import { mustLoadFxLab, fxSkin } from './content';
import { groundCamera, groundFrame, groundSkin } from './ground';

// Engine 0.16 F2: the lab's ground-view example (`ground.ts`, `content/skins/ground.json`).

/** An InstancedMesh read without importing three (only the 3D backend may). */
type Instanced = { name: string; count: number; instanceMatrix: { array: ArrayLike<number> } };
const isInstanced = (o: object): o is Instanced =>
  (o as { isInstancedMesh?: boolean }).isInstancedMesh === true;

const ROOT = fileURLToPath(new URL('./', import.meta.url));

describe('the fx lab ground view (Engine 0.16 F2)', () => {
  const content = mustLoadFxLab(readGameFiles(ROOT));
  const skin = groundSkin(content);
  const screen = content.manifest.screen;

  it('is a three skin in ground view, and the lab keeps its side-view three skin', () => {
    expect(skin.backend).toBe('three');
    expect(skinGroundCamera(skin)).toEqual({ pitch: 52, yaw: -25, fov: 40 });
    expect(skinGroundCamera(fxSkin(content, 'three'))).toBeNull();
  });

  it('shows the meadow on the floor, Pip turned to his facing, labels, the light and particles', async () => {
    const models = new ModelLibrary(content.assets);
    await models.preload([skin]);
    const camera = groundCamera(skin, screen);
    const scene = new ThreeScene(skin, { size: screen, fonts: contentFonts(content), models });
    // Frame 70: Pip faces right (he turns every 30 frames) and frame 60's coin burst still flies.
    for (let n = 0; n <= 70; n++) scene.sync(freezeFrame(groundFrame(n, camera, screen)));
    const pip = scene.entity('pip')!;
    expect(pip.position.toArray()).toEqual([12 * 16 + 8, 0, 9 * 16 + 8]);
    expect(pip.rotation.y).toBeCloseTo(groundFacingTurn(facingVector('right')), 12);
    expect(scene.entity('t1')!.userData['model']).toBe('assets/fx-lab-glb/brazier.glb');
    expect(scene.pointLights().map((l) => l.id)).toEqual(['t1', 't2']);
    // Pip's name and bar, and the door's EXIT, all on the picture.
    expect(scene.labelViews().filter((v) => v.kind !== 'place').length).toBe(3);
    expect(scene.particleViews().some((p) => p.emitter === 'coin-burst')).toBe(true);
    expect(scene.particleViews().some((p) => p.emitter === 'torch-flame')).toBe(true);
    // The camera is the RtsCamera's: the meadow's centre cell picks back to itself.
    const at = camera.worldToScreen(12.5 * 16, 9.5 * 16);
    expect(camera.screenToWorld(at.x, at.y).x).toBeCloseTo(200, 6);
    expect(scene.groundProjection!.centre).toEqual(camera.centre());
    scene.dispose();
  });

  it('dresses the meadow with its decor grid and names its places (Engine 0.16 F3)', async () => {
    const models = new ModelLibrary(content.assets);
    await models.preload([skin]);
    const camera = groundCamera(skin, screen);
    const decor = contentDecor(content);
    expect(decor['meadow']!.length).toBe(18);
    const build = () => {
      const scene = new ThreeScene(skin, { size: screen, fonts: contentFonts(content), models, decor });
      scene.sync(freezeFrame(groundFrame(0, camera, screen)));
      return scene;
    };
    const scene = build();
    const instanced = scene.map!.children.filter((c) => c.name.startsWith('decor:')).filter(isInstanced);
    // Pines, bushes and flowers instanced (one draw per char, model and mesh); stones one copy each.
    expect(new Set(instanced.map((c) => c.name.split(':')[1]))).toEqual(new Set(['p', 'b', 'f']));
    const cells = decor['meadow']!.join('');
    const count = (ch: string) => cells.split('').filter((c) => c === ch).length;
    expect(instanced.filter((c) => c.name.startsWith('decor:p:') && c.name.endsWith(':0'))[0]!.count).toBe(
      count('p'),
    );
    expect(scene.map!.children.filter((c) => c.name === 'decor:s').length).toBe(count('s'));
    // The same seed dresses it the same way.
    const again = build();
    const matrices = (s: ThreeScene) =>
      s
        .map!.children.filter((c) => isInstanced(c))
        .map((c) => Array.from((c as Instanced).instanceMatrix.array));
    expect(matrices(again)).toEqual(matrices(scene));
    // The places on the picture, beside Pip's and the door's labels (the old wall is off it).
    expect(
      scene
        .labelViews()
        .filter((v) => v.kind === 'place')
        .map((v) => v.text),
    ).toEqual(['THE POND', 'THE PATH']);
    scene.dispose();
    again.dispose();
  });
});
