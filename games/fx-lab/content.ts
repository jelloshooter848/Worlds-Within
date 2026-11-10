import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { kitContentKinds, manifestOptions, mustLoad } from '@engine/core/content/game-content';
import type { ContentResult } from '@engine/core/content/validate';
import { mustSkinSet, type SkinFile } from '@engine/core/present';
import { contentStages, type LevelStage } from '@kits/platformer';
import { kit as platformer } from '@kits/platformer/kit';

/**
 * Glue between the fx lab's data files (`game.json` and `content/`) and the engine: the content
 * kinds it reads (the engine's and the platformer kit's), its levels in play order and its skins.
 * No content lives here: the art, animation sets, frame events and sounds are all in `content/`.
 */

/** The fx lab's checked content, from `{ path: text }` pairs relative to `games/fx-lab`. */
export function loadFxLab(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, kitContentKinds([platformer], manifestOptions(files)), { root: 'games/fx-lab/' });
}

/** The loaded content, or a throw naming every error (the engine's `mustLoad`). */
export function mustLoadFxLab(files: Readonly<Record<string, string>>): ContentBundle {
  return mustLoad(loadFxLab(files), 'the fx lab');
}

/**
 * The levels in the order they are played: the campaign file's (`content/campaigns/main.campaign.json`),
 * each with the profile it names (the kit's `contentStages`).
 */
export function fxStages(content: ContentBundle): LevelStage[] {
  return contentStages(content, { who: 'the fx lab' });
}

/** One backend's skin (`content/skins/canvas2d.json` or `three.json`); throws when there is none. */
export function fxSkin(content: ContentBundle, backend: 'canvas2d' | 'three'): SkinFile {
  return mustSkinSet(content, backend, 'the fx lab').main;
}
