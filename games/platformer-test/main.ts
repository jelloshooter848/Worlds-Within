import { AudioManager } from '@engine/core/audio/audio-manager';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { backendFromQuery, bootBrowserGame } from '@engine/core/shell';
import { loadTest, mustLoad, testSfx } from './content';
import { TEST_FILES } from './files';
import { testCanvasPresenter, testLook, testPicture } from './picture';
import { testLook3d } from './picture3d';
import { testScene } from './scene';

/**
 * Boots the stacking test in the browser with the engine's `bootBrowserGame` (keyboard, gamepad,
 * the touch pad, the scene stack, the fixed loop and the 2D/3D toggle): Canvas2D by default, the
 * Three.js backend with `?backend=three` (imported only then, so the 2D page loads no Three.js).
 * The scene draws one stream of frames: in 2D onto the display's presenter for the levels and a
 * round presenter for the door's round (`testCanvasPresenter`); in 3D onto the display's
 * presenter, which already hands the round's frames to the round's `three-vault` skin. Sounds:
 * the skins' event sounds go to an `AudioManager` with the game's sfx; the shell has no audio
 * yet, so the unlock on the first gesture is here (gap G27).
 */
const content = mustLoad(loadTest(TEST_FILES));
const look = testLook(content);
const audio = new AudioManager();
audio.registerSfx(testSfx(content));
const unlock = () => audio.unlock();
for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'])
  window.addEventListener(ev, unlock, { passive: true });
const onSound = (id: string) => audio.sfx(id);
const in3d = backendFromQuery(window.location.search) === 'three';

void bootBrowserGame({
  screen: look.screen,
  displays: {
    canvas2d: (canvas) => canvasDisplay(canvas, { ...look, onSound }),
    three: async (canvas) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, { ...testLook3d(content), onSound }),
  },
  scene: (stack, display) =>
    testScene(content, stack, (r) =>
      testPicture(
        in3d ? display.presenter : testCanvasPresenter(r, look, { level: display.presenter, onSound }),
        look.screen,
      ),
    ),
});
