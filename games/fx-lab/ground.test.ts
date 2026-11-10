import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { ModelLibrary, ThreeScene } from '@engine/backends/three';
import { freezeFrame, groundFacingTurn, facingVector, skinGroundCamera } from '@engine/core/present';
import { readGameFiles } from '@engine/core/node/game-files';
import { contentFonts } from '@engine/core/ui';
import { mustLoadFxLab, fxSkin } from './content';
import { groundCamera, groundFrame, groundSkin } from './ground';

// Engine 0.16 F2: the lab's ground-view example (`ground.ts`, `content/skins/ground.json`).

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
    expect(scene.labelViews().length).toBe(3);
    expect(scene.particleViews().some((p) => p.emitter === 'coin-burst')).toBe(true);
    expect(scene.particleViews().some((p) => p.emitter === 'torch-flame')).toBe(true);
    // The camera is the RtsCamera's: the meadow's centre cell picks back to itself.
    const at = camera.worldToScreen(12.5 * 16, 9.5 * 16);
    expect(camera.screenToWorld(at.x, at.y).x).toBeCloseTo(200, 6);
    expect(scene.groundProjection!.centre).toEqual(camera.centre());
    scene.dispose();
  });
});
