import type { Sfx, Song } from '../audio/mml';
import type { PaletteTable } from '../gfx/palette';
import type { SpriteDef } from '../gfx/pixelart';
import type { KitDef, KitManifest } from '../kit';
import { contentOf, type ContentBundle } from './bundle';
import { engineContentKinds, PALETTE_KIND, SFX_KIND, SONG_KIND, SPRITE_KIND } from './engine-kinds';
import type { ContentKinds } from './kinds';
import { MANIFEST_FILE } from './manifest';
import { formatErrors, type ContentResult } from './validate';

/**
 * The few lines of content glue every game wrote for itself (Engine 0.7 T9, gap G4 in
 * docs/reports/stacking-test.md): its content kinds from its kits' hooks, its art and sounds out
 * of the loaded bundle, and a loader result turned into a bundle or one error listing every
 * problem. Pure.
 */

/**
 * The content kinds a game on `kits` reads: the engine's own plus each kit hook's `kinds()` (the
 * kit's `kit` export, `kits/<name>/kit.ts`), in order: `game.json`'s `kit`, then its `uses`. The
 * same set the tools build from the manifest (`gameKinds` in `engine/tools/game-check.ts`), so a
 * page loads exactly what `validate` checks. `manifest` (Engine 0.15, gap G17) is the game's
 * `game.json` (or `manifestOptions(files)`), whose `kitOptions` each kit reads. Throws when two
 * kits add a kind of the same name.
 */
export function kitContentKinds(kits: readonly KitDef[], manifest?: KitManifest): ContentKinds {
  const kinds = engineContentKinds();
  for (const kit of kits) for (const kind of kit.kinds(manifest)) kinds.register(kind);
  return kinds;
}

/**
 * The kit options of a game's `game.json` among its files (`{ path: text }`, as a page's
 * `virtual:game-files` gives them, `./game.json` or `game.json`), for `kitContentKinds`: `{}` when there is no manifest, it is
 * not JSON or has no `kitOptions` (`loadContent` reports a broken manifest).
 */
export function manifestOptions(files: Readonly<Record<string, string>>): KitManifest {
  const text = files[MANIFEST_FILE] ?? files[`./${MANIFEST_FILE}`];
  if (text === undefined) return {};
  try {
    const data = JSON.parse(text) as { kitOptions?: unknown } | null;
    const opts = data?.kitOptions;
    return typeof opts === 'object' && opts !== null && !Array.isArray(opts)
      ? { kitOptions: opts as KitManifest['kitOptions'] }
      : {};
  } catch {
    return {};
  }
}

/** Sprite sheets by id (the sprite file's name) and palettes by id, for the asset registry. */
export function contentArt(content: ContentBundle): {
  sprites: Record<string, SpriteDef>;
  palettes: PaletteTable;
} {
  const sprites: Record<string, SpriteDef> = {};
  for (const e of contentOf(content, SPRITE_KIND)) sprites[e.name] = e.value;
  const palettes: PaletteTable = {};
  for (const e of contentOf(content, PALETTE_KIND)) palettes[e.value.id] = e.value.colors;
  return { sprites, palettes };
}

/** Every sound effect (MML text), for the audio manager: the sounds the skins name. */
export function contentSfx(content: ContentBundle): Sfx[] {
  return contentOf(content, SFX_KIND).map((e) => e.value);
}

/** Every song (MML text), for the audio manager: the music a game plays (Engine 0.11, gap G27). */
export function contentSongs(content: ContentBundle): Song[] {
  return contentOf(content, SONG_KIND).map((e) => e.value);
}

/**
 * The bundle, or an error with every problem, one per line (`who` names the game): for entry
 * points, where bad content is a build mistake.
 */
export function mustLoad(result: ContentResult<ContentBundle>, who = 'the game'): ContentBundle {
  if (result.ok) return result.value;
  throw new Error(`${who}'s content has errors:\n${formatErrors(result.errors)}`);
}
