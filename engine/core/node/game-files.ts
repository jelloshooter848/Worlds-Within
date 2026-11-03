import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE } from '../content/manifest';

/**
 * Node only: a game folder's content files as `{ path: text }` pairs for `loadContent`
 * (`content/bundle.ts`): its `game.json` and every file under `content/`, with paths relative to the
 * folder and forward slashes, sorted. The browser gets the same files from
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
      else if (e.isFile()) out[path] = readFileSync(join(gameDir, path), 'utf8');
    }
  };
  if (existsSync(join(gameDir, 'content'))) walk('content');
  return out;
}
