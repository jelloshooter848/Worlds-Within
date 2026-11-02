import { AudioManager } from '@engine/core/audio/audio-manager';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame } from '@engine/core/shell';
import { loadTest, mustLoad, testSfx } from './content';
import { TEST_FILES } from './files';
import { testCanvasPresenter, testLook, testPicture } from './picture';
import { testScene } from './scene';

/**
 * Boots the stacking test in the browser with the engine's `bootBrowserGame` (keyboard, gamepad,
 * the touch pad, the scene stack and the fixed loop) on Canvas2D. The scene draws one stream of
 * frames onto the display's presenter for the levels and a round presenter for the door's round
 * (`testCanvasPresenter`). Sounds: the skins' event sounds go to an `AudioManager` with the
 * game's sfx; the shell has no audio yet, so the unlock on the first gesture is here (gap G27).
 */
const content = mustLoad(loadTest(TEST_FILES));
const look = testLook(content);
const audio = new AudioManager();
audio.registerSfx(testSfx(content));
const unlock = () => audio.unlock();
for (const ev of ['keydown', 'pointerdown', 'pointerup', 'touchend', 'click'])
  window.addEventListener(ev, unlock, { passive: true });
const onSound = (id: string) => audio.sfx(id);

void bootBrowserGame({
  screen: look.screen,
  displays: { canvas2d: (canvas) => canvasDisplay(canvas, { ...look, onSound }) },
  scene: (stack, display) =>
    testScene(content, stack, (r) =>
      testPicture(testCanvasPresenter(r, look, { level: display.presenter, onSound }), look.screen),
    ),
});
