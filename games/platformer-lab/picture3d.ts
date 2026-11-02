import type { ContentBundle } from '@engine/core/content/bundle';
import type { ScreenSize } from '@engine/core/gfx/screen';
import type { DeepReadonly, Presenter, PresentFrame, SkinFile } from '@engine/core/present';
import { ThreeScene, type ThreeSceneOptions } from '@engine/backends/three';
import type { PlatformerEvent, PlatformerWorld } from '@kits/platformer';
import { labSkin3d } from './content';
import { LabFrames, SKY } from './picture';

/**
 * Glue between the platformer kit's presentation frames and the Three.js backend, as
 * `LabPicture` is for Canvas2D: no drawing or rules of its own. Each `draw` takes the same frozen
 * frame from a `LabFrames` stream and hands it to a presenter built with the lab's `three` skin:
 * the WebGL `ThreePresenter` in a browser, or (in Node, for tests) `labScenePresenter`, the
 * backend's `ThreeScene` scene builder, which needs no WebGL.
 */

/** What showing the lab in 3D needs from its content: the `three` skin and the picture size. */
export interface LabLook3d {
  skin: SkinFile;
  screen: ScreenSize;
}

/** The lab's `three` skin (`content/skins/three.json`) and picture size. */
export function labLook3d(content: ContentBundle): LabLook3d {
  return { skin: labSkin3d(content), screen: content.manifest.screen };
}

/** The options the lab gives a 3D presenter (`ThreePresenter` or `ThreeScene`): its size and sky. */
export function labOptions3d(look: LabLook3d): ThreeSceneOptions {
  return { size: look.screen, background: SKY };
}

/** A `Presenter` over the backend's Node-side scene builder: `present` is `ThreeScene.sync`. */
export function labScenePresenter(look: LabLook3d): Presenter & { scene: ThreeScene } {
  const scene = new ThreeScene(look.skin, labOptions3d(look));
  return { scene, present: (frame) => scene.sync(frame) };
}

/** One stream of lab frames onto one 3D presenter. */
export class LabPicture3d {
  private readonly frames: LabFrames;

  constructor(
    private readonly presenter: Presenter,
    look: LabLook3d,
  ) {
    this.frames = new LabFrames(look.screen);
  }

  /** Shows `world` now, with the events since the last draw; returns the frame it showed. */
  draw(world: PlatformerWorld, events: readonly PlatformerEvent[]): DeepReadonly<PresentFrame> {
    const frame = this.frames.next(world, events);
    this.presenter.present(frame);
    return frame;
  }
}
