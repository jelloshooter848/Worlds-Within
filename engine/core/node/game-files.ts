import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE } from '../content/manifest';
import { ASSETS_DIR, assetDataUrl, isTextAsset } from '../content/png';

/**
 * Node only: a game folder's content files as `{ path: text }` pairs for `loadContent`
 * (`content/bundle.ts`): its `game.json` and every file under `content/`, with paths relative to the
 * folder and forward slashes, sorted. From Engine 0.16 T10 also every file under `assets/`: text
 * files (`.md`, `.txt`, `.json`) as text, binary ones (PNG) as base64 `data:` URLs
 * (`content/png.ts`). The browser gets the same files from
 * `virtual:game-files` (`build/game-files.ts`), keyed with a leading `./`.
 */
export function readGameFiles(gameDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const manifest = join(gameDir, MANIFEST_FILE);
  if (existsSync(manifest)) out[MANIFEST_FILE] = readFileSync(manifest, 'utf8');
  const walk = (rel: string): void => {
    const entries = readdirSync(join(gameDir, rel), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out[path] = readGameFile(gameDir, path);
    }
  };
  if (existsSync(join(gameDir, 'content'))) walk('content');
  if (existsSync(join(gameDir, ASSETS_DIR))) walk(ASSETS_DIR);
  return out;
}

/** One game file as the loader takes it: text, or a binary asset as a base64 `data:` URL. */
function readGameFile(gameDir: string, path: string): string {
  if (!path.startsWith(`${ASSETS_DIR}/`) || isTextAsset(path))
    return readFileSync(join(gameDir, path), 'utf8');
  return assetDataUrl(path, readFileSync(join(gameDir, path)).toString('base64'));
}
