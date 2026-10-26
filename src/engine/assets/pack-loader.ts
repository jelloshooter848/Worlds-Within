import type { AssetRegistry } from './registry';
import type { FrameRect, SpriteSheet } from '../gfx/spritesheet';
import { validateManifest, type PackManifest } from './manifest';
import { packStore, type StoredPack } from './idb';

export interface LoadedPack {
  name: string;
  manifest: PackManifest;
  sheets: Map<string, SpriteSheet>;
  /** Decoded audio by song/sfx id (filled by the audio side). */
  audio: Map<string, Blob>;
  warnings: string[];
}

/** Read a pack from a set of files (a folder picked in the browser). */
export async function readPackFiles(
  files: File[],
): Promise<{ manifest: PackManifest; files: Record<string, Blob> }> {
  const byName = new Map<string, File>();
  for (const f of files) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/');
    byName.set(parts.slice(1).join('/') || f.name, f);
    byName.set(f.name, f);
  }
  const mf = byName.get('manifest.json');
  if (!mf) throw new Error('manifest.json not found in the selected files');
  const manifest: unknown = JSON.parse(await mf.text());
  if (!validateManifest(manifest)) throw new Error('manifest.json is not a valid pack manifest');
  const out: Record<string, Blob> = {};
  const want = new Set<string>();
  for (const s of Object.values(manifest.sprites ?? {})) want.add(s.image);
  for (const f of Object.values(manifest.music ?? {})) want.add(f);
  for (const f of Object.values(manifest.sfx ?? {})) want.add(f);
  for (const path of want) {
    const f = byName.get(path);
    if (!f) throw new Error(`pack file "${path}" is missing`);
    out[path] = f;
  }
  return { manifest, files: out };
}

/** Build sprite sheets and audio blobs from a stored pack, using built-in frame layouts when the pack omits them. */
export async function buildPack(stored: StoredPack, registry: AssetRegistry): Promise<LoadedPack> {
  const manifest = stored.manifest as PackManifest;
  const pack: LoadedPack = { name: stored.name, manifest, sheets: new Map(), audio: new Map(), warnings: [] };
  for (const [id, spec] of Object.entries(manifest.sprites ?? {})) {
    const blob = stored.files[spec.image];
    if (!blob) {
      pack.warnings.push(`sprite "${id}": file ${spec.image} missing`);
      continue;
    }
    let image: CanvasImageSource;
    try {
      image = await createImageBitmap(blob);
    } catch {
      pack.warnings.push(`sprite "${id}": ${spec.image} is not a readable image`);
      continue;
    }
    let frames: Map<string, FrameRect>;
    if (spec.frames) {
      frames = new Map(Object.entries(spec.frames).map(([k, [x, y, w, h]]) => [k, { x, y, w, h }]));
    } else if (registry.has(id)) {
      frames = new Map(registry.sheet(id).frames);
    } else {
      pack.warnings.push(`sprite "${id}": unknown built-in sheet and no frames given`);
      continue;
    }
    pack.sheets.set(id, { id: `${id}@pack:${stored.name}`, image, frames });
  }
  for (const [sid, file] of Object.entries({ ...(manifest.music ?? {}), ...(manifest.sfx ?? {}) })) {
    const blob = stored.files[file];
    if (blob) pack.audio.set(sid, blob);
    else pack.warnings.push(`audio "${sid}": file ${file} missing`);
  }
  return pack;
}

/** Apply a pack's sheets as overrides (later packs win). Palette-only overrides re-rasterize built-ins. */
export function applyPack(pack: LoadedPack, registry: AssetRegistry): void {
  for (const [id, sheet] of pack.sheets) {
    registry.override(id, sheet);
    // A pack image replaces every palette variant of that sheet too, but not the whole-palette
    // effects ('knight@rival~silhouette'): those stay the built-in art recoloured, so a pack can't
    // unhide a locked hero's silhouette or a captive's trance.
    for (const key of registry.sheetKeys())
      if (key.startsWith(`${id}@`) && !key.includes('~')) registry.override(key, sheet);
  }
  for (const [name, colors] of Object.entries(pack.manifest.palettes ?? {}))
    registry.overridePalette(name, colors);
}

/** Store a pack picked from files, returning its name. */
export async function importPackFiles(files: File[]): Promise<string> {
  const { manifest, files: blobs } = await readPackFiles(files);
  await packStore.put({ name: manifest.name, manifest, files: blobs, addedAt: Date.now() });
  return manifest.name;
}

/** Load every enabled stored pack in order and apply it. */
export async function loadEnabledPacks(names: string[], registry: AssetRegistry): Promise<LoadedPack[]> {
  registry.clearOverrides();
  const loaded: LoadedPack[] = [];
  for (const name of names) {
    const stored = await packStore.get(name);
    if (!stored) continue;
    const pack = await buildPack(stored, registry);
    applyPack(pack, registry);
    loaded.push(pack);
  }
  return loaded;
}

/** Fetch `user-packs/index.json` in dev builds and import the listed folders (served by Vite). */
export async function importDevPacks(base = '/user-packs/'): Promise<string[]> {
  try {
    const res = await fetch(`${base}index.json`);
    if (!res.ok) return [];
    const index = (await res.json()) as { packs?: string[] };
    const names: string[] = [];
    for (const folder of index.packs ?? []) {
      const mres = await fetch(`${base}${folder}/manifest.json`);
      if (!mres.ok) continue;
      const manifest: unknown = await mres.json();
      if (!validateManifest(manifest)) continue;
      const files: Record<string, Blob> = {};
      const paths = new Set<string>();
      for (const s of Object.values(manifest.sprites ?? {})) paths.add(s.image);
      for (const f of Object.values(manifest.music ?? {})) paths.add(f);
      for (const f of Object.values(manifest.sfx ?? {})) paths.add(f);
      for (const p of paths) {
        const r = await fetch(`${base}${folder}/${p}`);
        if (r.ok) files[p] = await r.blob();
      }
      await packStore.put({ name: manifest.name, manifest, files, addedAt: Date.now() });
      names.push(manifest.name);
    }
    return names;
  } catch {
    return [];
  }
}

/**
 * Export the built-in sheets as PNG templates plus a manifest, so pack authors can repaint them
 * keeping the frame layout. Triggers one download per file.
 */
export async function exportTemplate(registry: AssetRegistry, sheetIds: string[]): Promise<void> {
  const manifest: PackManifest = { schema: 1, name: 'my-pack', sprites: {} };
  for (const id of sheetIds) {
    const sheet = registry.sheet(id);
    const img = sheet.image;
    if (!img) continue;
    const canvas = document.createElement('canvas');
    const w = (img as HTMLCanvasElement).width;
    const h = (img as HTMLCanvasElement).height;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) continue;
    download(`${id}.png`, blob);
    (manifest.sprites as NonNullable<PackManifest['sprites']>)[id] = { image: `${id}.png` };
    // A frames.json beside it documents the layout for editors that want explicit rects.
    const rects: Record<string, [number, number, number, number]> = {};
    for (const [k, f] of sheet.frames) rects[k] = [f.x, f.y, f.w, f.h];
    download(`${id}.frames.json`, new Blob([JSON.stringify(rects, null, 2)], { type: 'application/json' }));
  }
  download('manifest.json', new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }));
}

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
