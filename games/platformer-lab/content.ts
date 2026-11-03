import { loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import { mustLoad as mustLoadContent } from '@engine/core/content/game-content';
import type { ContentKinds } from '@engine/core/content/kinds';
import type { ContentResult } from '@engine/core/content/validate';
import { mustSkinSet, type SkinFile } from '@engine/core/present';
import { contentStages, levelKind, profileKind, type LevelStage } from '@kits/platformer';

/**
 * Glue between the lab's data files (`game.json` and `content/`) and the engine: the content
 * kinds it uses, and the loaded bundle turned into what the game needs. No content lives here.
 */

const LEVEL = levelKind();
const PROFILE = profileKind();

/** The level every run starts on: the kit's fixture level, copied byte for byte. */
export const FIRST_LEVEL = 'tiny';

/** The engine's kinds (sprite, palette, skin...) plus the platformer kit's levels and profiles. */
export function labKinds(): ContentKinds {
  return engineContentKinds().register(LEVEL).register(PROFILE);
}

/** The lab's checked content, from `{ path: text }` pairs relative to `games/platformer-lab`. */
export function loadLab(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, labKinds(), { root: 'games/platformer-lab/' });
}

/** A level and the physics profile it names (the kit's `LevelStage`). */
export type LabStage = LevelStage;

/**
 * The lab's levels in the order they are played: the order of its campaign file
 * (`content/campaigns/main.campaign.json`: the fixture level, `FIRST_LEVEL`, first, then the lab's
 * own levels, `lab-1-...`, `lab-2-...`), each with its profile (the kit's `contentStages`, gap G2,
 * fixed in 0.10).
 */
export function labStages(content: ContentBundle): LabStage[] {
  return contentStages(content, { who: 'the lab' });
}

/**
 * The skin the Canvas2D backend draws the lab with (`content/skins/canvas2d.json`): every kind,
 * tile, event and HUD value the platformer kit (and the lab's mini game) presents.
 */
export function labSkin(content: ContentBundle): SkinFile {
  return skinFor(content, 'canvas2d');
}

/**
 * The skin the Three.js backend shows the lab with (`content/skins/three.json`): a low-poly mesh
 * for every kind and a block for every solid tile the kit (and the lab's mini game) presents, the
 * 3D camera defaults, and the same follow, deadzone and lerp as the Canvas2D skin.
 */
export function labSkin3d(content: ContentBundle): SkinFile {
  return skinFor(content, 'three');
}

function skinFor(content: ContentBundle, backend: string): SkinFile {
  return mustSkinSet(content, backend, 'the lab').main;
}

/** Throws with every error, one per line: the engine's `mustLoad`, naming the lab. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  return mustLoadContent(result, 'the lab');
}
