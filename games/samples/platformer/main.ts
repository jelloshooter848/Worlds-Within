import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { loadHopper, PLATFORMER_MUSIC } from './content';
import { hopperLook, hopperPicture } from './picture';
import { hopperLook3d } from './picture3d';
import { createGame } from './headless';
import gameFiles from 'virtual:game-files';

/**
 * Boots the platformer sample in the browser with the engine's `bootBrowserGame` (keyboard, gamepad,
 * the touch pad, the scene stack, the fixed loop and the 2D/3D toggle): Canvas2D by default, the
 * Three.js backend with `?backend=three` (imported only then, so the 2D page loads no Three.js).
 * Both displays take the level skin and a skin per mini game (`rounds`) and hand each frame to the
 * right one, so the scene draws one stream of frames onto `display.presenter` either way (gap G34,
 * fixed in 0.7 T9). Sounds: the shell's `audio` option makes the `AudioManager` with the game's
 * song and sfx, unlocks it on the first key, tap or click (the `meadow` song starts then) and
 * hands the displays its `onSound` (gap G27, fixed in 0.11); the skins give the round's end a
 * sound per result (`mini-game-end:pass`, G28). The shell draws its mute button and volume slider
 * (`#ww-volume`, the player's stored volumes, Engine 0.15 T5). Both backends draw the skins' HUD
 * (Engine 0.15, gap G33: in 3D from the sprite sheets as decoded pixels, `hopperLook3d`). The scene is
 * the engine's `HostScene` over the headless game itself (`createGame`, every level in turn; gap
 * G37, fixed in 0.10): it pushes the core `miniGameScene` when the door starts the vault round
 * (the level sequence still steps it, so the round's result acts on the level as headless).
 */
const content = mustLoad(loadHopper(gameFiles), 'the platformer sample');
const look = hopperLook(content);

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { songs: contentSongs(content), sfx: contentSfx(content), music: PLATFORMER_MUSIC },
  displays: {
    canvas2d: (canvas, { onSound }) => canvasDisplay(canvas, { ...look, onSound }),
    three: async (canvas, { onSound }) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, { ...hopperLook3d(content), onSound }),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => hopperPicture(display.presenter, look.screen),
    }),
});
