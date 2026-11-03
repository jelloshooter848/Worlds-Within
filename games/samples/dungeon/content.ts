import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds, SKIN_KIND, SONG_KIND } from '@engine/core/content/engine-kinds';
import { contentSfx, mustLoad as mustLoadContent } from '@engine/core/content/game-content';
import type { ContentKinds } from '@engine/core/content/kinds';
import type { ContentResult } from '@engine/core/content/validate';
import type { Sfx, Song } from '@engine/core/audio/mml';
import type { SkinFile } from '@engine/core/present';
import { buildDungeon, roomKind, type Dungeon } from '@kits/topdown';

/**
 * Glue between the demo's data files (`game.json` and `content/`) and the engine: the content
 * kinds it uses, and the loaded bundle turned into what the scene needs. No content lives here.
 */

const ROOM = roomKind();

/** The engine's kinds (song, sprite, palette...) plus the top-down kit's rooms. */
export function demoKinds(): ContentKinds {
  return engineContentKinds().register(ROOM);
}

/** The demo's checked content, from `{ path: text }` pairs relative to `games/samples/dungeon`. */
export function loadDemo(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, demoKinds(), { root: 'games/samples/dungeon/' });
}

/** The dungeon the demo's room files make. */
export function demoDungeon(content: ContentBundle): Dungeon {
  return buildDungeon(contentOf(content, ROOM).map((e) => e.value));
}

/** Every song, for the audio manager. */
export function demoSongs(content: ContentBundle): Song[] {
  return contentOf(content, SONG_KIND).map((e) => e.value);
}

/** Every sound effect, for the audio manager (the skin's event sounds): the engine's `contentSfx`. */
export function demoSfx(content: ContentBundle): Sfx[] {
  return contentSfx(content);
}

/**
 * The skin the Canvas2D backend draws the demo with (`content/skins/canvas2d.json`): every kind,
 * tile, event and HUD value the top-down kit presents, mapped to the demo's sheets and sounds.
 */
export function demoSkin(content: ContentBundle): SkinFile {
  const skin = contentOf(content, SKIN_KIND).find((e) => e.value.backend === 'canvas2d');
  if (!skin) throw new Error('the demo has no canvas2d skin (content/skins/canvas2d.json)');
  return skin.value;
}

/** Throws with every error, one per line: the engine's `mustLoad`, naming the demo. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  return mustLoadContent(result, 'the demo');
}
