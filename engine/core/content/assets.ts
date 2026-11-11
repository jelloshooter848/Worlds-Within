import { frameOutside, imageSheetFrameList, type ImageSheetSpec } from '../gfx/image-sheet';
import { skinModelUses, type SkinFile } from '../present/skin';
import { gltfClipNames, gltfExternalRefs, readModelAsset } from './gltf';
import { contentError, type ContentError } from './validate';
import { ASSETS_DIR, CREDITS_FILE, dataUrlBytes, readPngSize } from './png';

/**
 * The checks on a game's `assets/` folder (Engine 0.16 T10; docs/DESIGN.md, item 322), run by
 * `loadContent` with the cross-file checks, so `pnpm cli validate` reports them:
 *
 * - **Credits.** A game with any file in `assets/` needs `assets/CREDITS.md` (`missing_credits`
 *   at that file), with a `## <pack>` section for every pack folder (`assets/<pack>/...`;
 *   `missing_credits` at `<pack>`) giving `Source:`, `Author:` and `Licence:` lines
 *   (`missing_credits` at `<pack>.source` and so on). The licence must be CC0, unless the section
 *   cites an owner decision (`Owner decision: item 123`); otherwise `bad_licence` at
 *   `<pack>.licence`.
 * - **Skin images.** Each skin's `images` entry: its PNG must be there (`missing_file` at
 *   `images.<id>.image`), be a PNG (`bad_image`, its header read for the size) and hold every
 *   frame (`frame_outside_image` at `images.<id>.grid` or `images.<id>.frames.<name>`).
 * - **Skin models** (Engine 0.16 T11). Each 3D kind or tile `model`: its file must be there
 *   (`missing_file` at `kinds.<kind>.model`), be a glTF 2.0 model (`bad_model`: a GLB's magic,
 *   version 2, length and JSON chunk, or a `.gltf`'s JSON and `asset.version`; no buffer or image
 *   in another file) and have every clip the entry names (`missing_clip` at `kinds.<kind>.clip` or
 *   `kinds.<kind>.clip.<state>`).
 *
 * Pure: the files are the `{ path: text }` strings the loader gets (binary ones as `data:` URLs).
 */

/** One pack's section of `CREDITS.md`. */
export interface CreditsEntry {
  pack: string;
  source?: string;
  author?: string;
  licence?: string;
  ownerDecision?: string;
}

const FIELD = /^\s*(?:[-*]\s*)?(source|author|licen[cs]e|owner decision)\s*:\s*(.*?)\s*$/i;

/** The pack sections of a `CREDITS.md` text (`## <pack>` headings, backticks dropped). */
export function parseCredits(text: string): Map<string, CreditsEntry> {
  const out = new Map<string, CreditsEntry>();
  let entry: CreditsEntry | null = null;
  for (const line of text.split(/\r?\n/)) {
    const head = /^##\s+(.+?)\s*$/.exec(line);
    if (head) {
      const pack = head[1]!.replace(/`/g, '').trim();
      entry = { pack };
      out.set(pack, entry);
      continue;
    }
    if (/^#\s/.test(line)) entry = null;
    const field = entry ? FIELD.exec(line) : null;
    if (!entry || !field || field[2] === '') continue;
    const key = field[1]!.toLowerCase();
    const value = field[2]!;
    if (key === 'source') entry.source = value;
    else if (key === 'author') entry.author = value;
    else if (key === 'owner decision') entry.ownerDecision = value;
    else entry.licence = value;
  }
  return out;
}

/** Whether a licence line names CC0 (`CC0`, `CC0 1.0`, `CC0 1.0 Universal`, ...). */
export function isCc0(licence: string): boolean {
  return /^\s*(?:\[)?CC0\b/i.test(licence) || /creative commons zero/i.test(licence);
}

/** The pack folders under `assets/` that hold files (`assets/<pack>/...`), sorted. */
export function assetPacks(paths: readonly string[]): string[] {
  const packs = new Set<string>();
  for (const p of paths) {
    const parts = p.split('/');
    if (parts[0] === ASSETS_DIR && parts.length > 2) packs.add(parts[1]!);
  }
  return [...packs].sort();
}

/** Problems with the credits for the given asset files (paths relative to the game folder). */
export function checkCredits(
  assets: Readonly<Record<string, string>>,
  at: (path: string) => string,
): ContentError[] {
  const paths = Object.keys(assets);
  if (paths.length === 0) return [];
  const file = at(CREDITS_FILE);
  const text = assets[CREDITS_FILE];
  if (text === undefined) {
    const msg = `the game has an ${ASSETS_DIR}/ folder but no ${CREDITS_FILE}: credit every pack (source URL, author, licence)`;
    return [contentError(file, [], 'missing_credits', msg)];
  }
  const credits = parseCredits(text);
  const errors: ContentError[] = [];
  for (const pack of assetPacks(paths)) {
    const entry = credits.get(pack);
    if (!entry) {
      const msg = `pack folder "${ASSETS_DIR}/${pack}/" has no "## ${pack}" section`;
      errors.push(contentError(file, [pack], 'missing_credits', msg));
      continue;
    }
    for (const [field, label] of [
      ['source', 'Source'],
      ['author', 'Author'],
      ['licence', 'Licence'],
    ] as const) {
      if (entry[field] === undefined) {
        const msg = `pack "${pack}" needs a "${label}: ..." line`;
        errors.push(contentError(file, [pack, field], 'missing_credits', msg));
      }
    }
    if (entry.licence !== undefined && !isCc0(entry.licence) && entry.ownerDecision === undefined) {
      const msg = `pack "${pack}" is "${entry.licence}": only CC0 is allowed unless an owner decision is cited ("Owner decision: item N")`;
      errors.push(contentError(file, [pack, 'licence'], 'bad_licence', msg));
    }
  }
  return errors;
}

/** Problems with one skin's `images` against the game's asset files. */
export function checkSkinImages(
  file: string,
  images: Readonly<Record<string, ImageSheetSpec>>,
  assets: Readonly<Record<string, string>>,
): ContentError[] {
  const errors: ContentError[] = [];
  for (const [id, spec] of Object.entries(images)) {
    const at = ['images', id];
    const data = assets[spec.image];
    if (data === undefined) {
      const msg = `no file "${spec.image}" in the game folder`;
      errors.push(contentError(file, [...at, 'image'], 'missing_file', msg));
      continue;
    }
    const bytes = dataUrlBytes(data);
    const size = bytes === null ? null : readPngSize(bytes);
    if (size === null) {
      errors.push(contentError(file, [...at, 'image'], 'bad_image', `"${spec.image}" is not a PNG`));
      continue;
    }
    const reported = new Set<string>();
    for (const frame of imageSheetFrameList(spec)) {
      if (!frameOutside(frame, size)) continue;
      const key = frame.path.join('.');
      if (reported.has(key)) continue;
      reported.add(key);
      const msg = `frame "${frame.name}" (${frame.x}, ${frame.y}, ${frame.w}x${frame.h}) reaches past the ${size.width}x${size.height} image "${spec.image}"`;
      errors.push(contentError(file, [...at, ...frame.path], 'frame_outside_image', msg));
    }
  }
  return errors;
}

/** Problems with one skin's glTF models (kinds' and tiles' `model` and `clip`) against the asset files. */
export function checkSkinModels(
  file: string,
  skin: SkinFile,
  assets: Readonly<Record<string, string>>,
): ContentError[] {
  const errors: ContentError[] = [];
  for (const use of skinModelUses(skin)) {
    const data = assets[use.model];
    const at = use.field ?? [...use.path, 'model'];
    if (data === undefined) {
      errors.push(contentError(file, at, 'missing_file', `no file "${use.model}" in the game folder`));
      continue;
    }
    const read = readModelAsset(use.model, data);
    if (!read.ok) {
      errors.push(contentError(file, at, 'bad_model', `"${use.model}": ${read.message}`));
      continue;
    }
    const external = gltfExternalRefs(read.json);
    if (external !== null) {
      errors.push(contentError(file, at, 'bad_model', `"${use.model}": ${external}`));
      continue;
    }
    const names = gltfClipNames(read.json);
    for (const { path, clip } of use.clips) {
      if (names.includes(clip)) continue;
      const has = names.length === 0 ? 'it has no clips' : `its clips: ${names.join(', ')}`;
      errors.push(
        contentError(file, [...path], 'missing_clip', `"${use.model}" has no clip "${clip}" (${has})`),
      );
    }
  }
  return errors;
}

/** Every asset problem of a game: its credits, then each skin's images and models in entry order. */
export function checkGameAssets(
  assets: Readonly<Record<string, string>>,
  entries: readonly { kind: string; file: string; value: unknown }[],
  at: (path: string) => string,
): ContentError[] {
  const errors = checkCredits(assets, at);
  for (const e of entries) {
    if (e.kind !== 'skin') continue;
    const images = (e.value as { images?: Record<string, ImageSheetSpec> }).images;
    if (images !== undefined) errors.push(...checkSkinImages(at(e.file), images, assets));
    errors.push(...checkSkinModels(at(e.file), e.value as SkinFile, assets));
  }
  return errors;
}
