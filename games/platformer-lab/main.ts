import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { loadLab, mustLoad } from './content';
import { LAB_FILES } from './files';
import { labLook, labPicture } from './picture';
import { labLook3d } from './picture3d';
import { createGame } from './headless';

/**
 * Boots the lab in the browser with the engine's `bootBrowserGame` (keyboard, gamepad, the touch
 * pad, the scene stack and the fixed loop): Canvas2D by default, the Three.js backend with
 * `?backend=three` (imported only then, so the 2D page loads no Three.js). Either way the scene
 * draws the same frames (`labPicture`) onto the display's presenter. No audio: the lab has no
 * sounds yet. The scene is the engine's `HostScene` over the headless game itself (`createGame`,
 * every level in turn; gap G37, fixed in 0.10), which pushes the core `miniGameScene` when a
 * trigger starts a round. Arrows (or the touch pad) move, Z jumps, X runs; in the mini game X
 * (attack) stops the bar.
 */
const content = mustLoad(loadLab(LAB_FILES));
const screen = content.manifest.screen;

void bootBrowserGame({
  screen,
  displays: {
    canvas2d: (canvas) => canvasDisplay(canvas, labLook(content)),
    three: async (canvas) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, labLook3d(content)),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => labPicture(display.presenter, screen),
    }),
});
