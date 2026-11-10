import { withContentImages } from '@engine/core/assets/content-images';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { stageNames } from '@kits/platformer';
import { hopperStages, loadHopper, PLATFORMER_MUSIC } from './content';
import { hopperLook, hopperPicture } from './picture';
import { hopperLook3d } from './picture3d';
import { createGame } from './headless';
import gameFiles from 'virtual:game-files';

/**
 * Boots Hopper's Way in the browser with the engine's `bootBrowserGame` (keyboard, gamepad, the
 * touch pad, the scene stack, the fixed loop, the menus and the 2D/3D toggle) at its 16:9 screen
 * (320x180, so 6x fills 1920x1080): Canvas2D by default, the Three.js backend with
 * `?backend=three` (imported only then, so the 2D page loads no Three.js). The 2D skin's PNG
 * sheets (the CC0 packs in `assets/`, T6) are decoded before the page boots. Sounds are the
 * shell's (`audio`: the game's songs and sfx; T9: the title's song, then the 2D skin's layered
 * `hoppers-way` music, the same in the 3D skin, mixed by the shell's mixer from each frame's status,
 * with every event's sound varied per the game's seed and big hits ducking it); skin events'
 * `hitPause` (a stomp's and a hurt's freeze frames) reach the shell, which holds the game's ticks
 * while the picture keeps drawing. The scene is the engine's `HostScene` over the headless game itself (`createGame`, every stage of the campaign in turn). The title's
 * Levels item opens the shell's level select (the levels by name, from the campaign); a level
 * chosen there starts as a run file's `start: { stage }` does.
 */
const content = await withContentImages(mustLoad(loadHopper(gameFiles), 'the platformer sample'));
const look = hopperLook(content);

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  transitions: content.manifest.transitions,
  audio: {
    songs: contentSongs(content),
    sfx: contentSfx(content),
    music: PLATFORMER_MUSIC,
    mix: look.skin.music,
    seed: content.manifest.start.seed,
  },
  menus: {
    spec: content.manifest.menus,
    fonts: look.fonts,
    sheets: look.sheet,
    levels: stageNames(hopperStages(content)),
  },
  displays: {
    canvas2d: (canvas, { onSound, hitPause }) =>
      canvasDisplay(canvas, { ...look, onSound, onHitPause: hitPause }),
    three: async (canvas, { onSound, hitPause }) => {
      const three = await import('@engine/backends/three');
      const look3d = hopperLook3d(content);
      // The 2.5D view's glTF models (T10: the CC0 Kenney and Quaternius packs), loaded before the first frame.
      const models = new three.ModelLibrary(content.assets ?? {});
      await models.preload([look3d.skin]);
      return three.threeDisplay(canvas, {
        ...look3d,
        models,
        fonts: look.fonts,
        onSound,
        onHitPause: hitPause,
      });
    },
  },
  scene: (stack, display, booted) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed, booted.start ? { start: booted.start } : {}),
      picture: () => hopperPicture(display.presenter, look.screen),
    }),
});
