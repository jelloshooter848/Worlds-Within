import { contentSfx } from '@engine/core/content/game-content';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { mustLoadFxLab } from './content';
import { createGame } from './headless';
import { fxLook, fxPicture } from './picture';
import { fxLook3d } from './picture3d';
import gameFiles from 'virtual:game-files';

/**
 * Boots the fx lab in the browser with the engine's `bootBrowserGame`: Canvas2D by default, the
 * Three.js backend with `?backend=three` (imported only then). Sounds come from the skins: the
 * kit's events and the frame events of Pip's animation cycles (footsteps on the walk and run
 * frames) both reach the shell's `onSound`, which plays the game's sfx. Every sound id played is
 * also kept in `window.wwFxLab.sounds`, so a browser test can check the frame events' sounds
 * (`tests/browser/fx-lab.test.ts`). Skin events' `hitPause` (a stomp's freeze frames) reach the
 * shell's `hitPause`, which holds the game's ticks while the picture keeps drawing. Arrows (or the
 * touch pad) move, Z jumps, X runs.
 */
const content = mustLoadFxLab(gameFiles);
const look = fxLook(content);

/** Every sound id the page played, in order (for tests; presentation only). */
const sounds: string[] = [];
(window as { wwFxLab?: { sounds: string[] } }).wwFxLab = { sounds };
const heard = (onSound: (id: string) => void) => (id: string) => {
  sounds.push(id);
  onSound(id);
};

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  transitions: content.manifest.transitions,
  audio: { sfx: contentSfx(content) },
  displays: {
    canvas2d: (canvas, { onSound, hitPause }) =>
      canvasDisplay(canvas, { ...look, onSound: heard(onSound), onHitPause: hitPause }),
    three: async (canvas, { onSound, hitPause }) =>
      (await import('@engine/backends/three')).threeDisplay(canvas, {
        ...fxLook3d(content),
        onSound: heard(onSound),
        onHitPause: hitPause,
      }),
  },
  scene: (stack, display) =>
    new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => fxPicture(display.presenter, look.screen),
    }),
});
