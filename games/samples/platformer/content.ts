import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { kitContentKinds, manifestOptions } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import { mustSkinSet, type SkinFile } from '@engine/core/present';
import { contentStages, type LevelStage } from '@kits/platformer';
import { kit as platformer } from '@kits/platformer/kit';

/**
 * Glue between Hopper's Way's data files (`game.json` and `content/`) and the engine: which kit's
 * content it reads, and the loaded bundle as the levels in play order and the skins. No content
 * lives here: the kinds, art, sounds and `mustLoad` are the engine's
 * (`@engine/core/content/game-content`), the level order the campaign file's, played by the
 * platformer kit's `contentStages`.
 */

/**
 * The music the page plays once a level starts (T9): the skins' layered `music` entry, a calm and a
 * drive layer per level and the boss's fight and rage layers (`content/songs/hopper-*.json`),
 * mixed from each frame's status. The title plays `hopper-title`, the end screen `hopper-fanfare`
 * (`game.json`'s `menus`).
 */
export const PLATFORMER_MUSIC = 'hoppers-way';

/** The game's checked content, from `{ path: text }` pairs relative to `games/samples/platformer`. */
export function loadHopper(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, kitContentKinds([platformer], manifestOptions(files)), {
    root: 'games/samples/platformer/',
  });
}

/**
 * The stages in the order they are played: the campaign file's
 * (`content/campaigns/main.campaign.json`), each with the profile it names (the kit's
 * `contentStages`).
 */
export function hopperStages(content: ContentBundle): LevelStage[] {
  return contentStages(content, { who: 'the platformer sample' });
}

/**
 * The skins one backend draws the game with (the engine's `skinSet`): `level`, the skin named
 * after the backend (`content/skins/canvas2d.json`, `three.json`), and `rounds`, empty (the game
 * has no mini games). Throws when the backend has no skin.
 */
export function hopperSkins(
  content: ContentBundle,
  backend: string,
): { level: SkinFile; rounds: Record<string, SkinFile> } {
  const { main, rounds } = mustSkinSet(content, backend, 'the platformer sample');
  return { level: main, rounds };
}
