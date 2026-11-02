import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { formatErrors, type ContentResult } from '@engine/core/content/validate';
import { levelKind, profileKind, type LevelDef, type ProfileDef } from '@kits/platformer';

/**
 * Glue between the stacking test's data files (`game.json` and `content/`) and the engine: the
 * content kinds it uses, and the loaded bundle turned into the levels in play order. No content
 * lives here.
 */

const LEVEL = levelKind();
const PROFILE = profileKind();

/** The engine's kinds plus the platformer kit's levels and profiles. */
export function testKinds(): ContentKinds {
  return engineContentKinds().register(LEVEL).register(PROFILE);
}

/** The game's checked content, from `{ path: text }` pairs relative to `games/platformer-test`. */
export function loadTest(files: Readonly<Record<string, string>>): ContentResult<ContentBundle> {
  return loadContent(files, testKinds(), { root: 'games/platformer-test/' });
}

/** A level and the physics profile it names. */
export interface TestStage {
  level: LevelDef;
  profile: ProfileDef;
}

/**
 * The levels in the order they are played: by id with numbers compared as numbers (`level-1`,
 * `level-2`, ..., `level-10`), each with its profile.
 */
export function testStages(content: ContentBundle): TestStage[] {
  const profiles = new Map(contentOf(content, PROFILE).map((e) => [e.value.id, e.value]));
  const levels = contentOf(content, LEVEL)
    .map((e) => e.value)
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  if (levels.length === 0) throw new Error('the stacking test has no levels');
  return levels.map((level) => {
    const profile = profiles.get(level.profile);
    if (!profile)
      throw new Error(`level "${level.id}" names profile "${level.profile}", which the game lacks`);
    return { level, profile };
  });
}

/** Throws with every error, one per line: for entry points, where bad content is a build mistake. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`the stacking test's content has errors:\n${formatErrors(result.errors)}`);
}
