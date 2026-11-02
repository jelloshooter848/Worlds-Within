import { contentOf, loadContent, type ContentBundle } from '@engine/core/content/bundle';
import { engineContentKinds, PALETTE_KIND, SKIN_KIND, SPRITE_KIND } from '@engine/core/content/engine-kinds';
import type { ContentKinds } from '@engine/core/content/kinds';
import { formatErrors, type ContentResult } from '@engine/core/content/validate';
import type { PaletteTable } from '@engine/core/gfx/palette';
import type { SpriteDef } from '@engine/core/gfx/pixelart';
import type { SkinFile } from '@engine/core/present';
import { levelKind, profileKind, type LevelDef, type ProfileDef } from '@kits/platformer';

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

/** A level and the physics profile it names. */
export interface LabStage {
  level: LevelDef;
  profile: ProfileDef;
}

/**
 * The lab's levels in the order they are played: the fixture level (`FIRST_LEVEL`) first, then
 * the lab's own levels by id (`lab-1-...`, `lab-2-...`), each with its profile.
 */
export function labStages(content: ContentBundle): LabStage[] {
  const profiles = new Map(contentOf(content, PROFILE).map((e) => [e.value.id, e.value]));
  const levels = contentOf(content, LEVEL)
    .map((e) => e.value)
    .sort((a, b) =>
      a.id === b.id ? 0 : a.id === FIRST_LEVEL ? -1 : b.id === FIRST_LEVEL ? 1 : a.id < b.id ? -1 : 1,
    );
  if (levels[0]?.id !== FIRST_LEVEL) throw new Error(`the lab has no level "${FIRST_LEVEL}"`);
  return levels.map((level) => {
    const profile = profiles.get(level.profile);
    if (!profile)
      throw new Error(`level "${level.id}" names profile "${level.profile}", which the lab lacks`);
    return { level, profile };
  });
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
  const skin = contentOf(content, SKIN_KIND).find((e) => e.value.backend === backend);
  if (!skin) throw new Error(`the lab has no ${backend} skin (content/skins/${backend}.json)`);
  return skin.value;
}

/** Sprite sheets by id (the file name) and palettes by id, for the asset registry. */
export function labArt(content: ContentBundle): {
  sprites: Record<string, SpriteDef>;
  palettes: PaletteTable;
} {
  const sprites: Record<string, SpriteDef> = {};
  for (const e of contentOf(content, SPRITE_KIND)) sprites[e.name] = e.value;
  const palettes: PaletteTable = {};
  for (const e of contentOf(content, PALETTE_KIND)) palettes[e.value.id] = e.value.colors;
  return { sprites, palettes };
}

/** Throws with every error, one per line: for entry points, where bad content is a build mistake. */
export function mustLoad(result: ContentResult<ContentBundle>): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`the lab's content has errors:\n${formatErrors(result.errors)}`);
}
