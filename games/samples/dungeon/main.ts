import type { AudioManager } from '@engine/core/audio/audio-manager';
import { canvasDisplay } from '@engine/backends/canvas2d';
import { bootBrowserGame } from '@engine/core/shell';
import { DUNGEON_MUSIC, dungeonSfx, dungeonSongs, loadDungeon, mustLoad } from './content';
import { dungeonLook } from './picture';
import { DungeonScene } from './scene';
import gameFiles from 'virtual:game-files';

/**
 * Boots the dungeon sample in the browser with the engine's `bootBrowserGame`: keyboard,
 * gamepad, the touch pad, the scene stack, the fixed loop, the Canvas2D display, audio with the
 * sample's songs and sfx (the `crypt` song starts on the first key, tap or click), the shell's volume control
 * (stored under `ww:dungeon:volumes`, gap M1) and the step hook with `?debug=step`. The scene
 * draws through its own `DungeonPicture` on the display's renderer, with the shell's `onSound`.
 */
const content = mustLoad(loadDungeon(gameFiles));
const look = dungeonLook(content);
let onSound: (id: string) => void = () => {};
let audio: AudioManager | null = null;

void bootBrowserGame({
  screen: look.screen,
  game: content.manifest.id,
  audio: { songs: dungeonSongs(content), sfx: dungeonSfx(content), music: DUNGEON_MUSIC },
  displays: {
    canvas2d: (canvas, shell) => {
      onSound = (id) => shell.onSound(id);
      return canvasDisplay(canvas, { ...look, onSound: shell.onSound });
    },
  },
  scene: () =>
    new DungeonScene(content, look, { onSound: (id) => onSound(id), music: (id) => audio?.playMusic(id) }),
}).then((booted) => {
  audio = booted?.audio ?? null;
});
