import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';

/** The id a game's browser code imports its data files from. */
export const GAME_FILES_ID = 'virtual:game-files';

/** The resolved id is this prefix plus the game folder's absolute path (`\0`: not a real file). */
const RESOLVED_PREFIX = `\0${GAME_FILES_ID}:`;

/** The file that marks a game folder. */
const MANIFEST = 'game.json';

/**
 * The nearest folder at or above `importer`'s folder that holds a `game.json`, or null when there
 * is none up to the file system's root. A query on the importer (`main.ts?v=1`) is ignored.
 */
export function findGameDir(importer: string): string | null {
  let dir = dirname(resolve(importer.replace(/[?#].*$/, '')));
  for (;;) {
    if (existsSync(join(dir, MANIFEST))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/**
 * A game folder's data files, as paths relative to the folder (`./game.json`,
 * `./content/rooms/hall.json`): its `game.json` and every file under `content/`, skipping hidden
 * files and folders, sorted. These are the keys `import.meta.glob(['./game.json',
 * './content/**\/*'])` gave each game's old `files.ts`.
 */
export function gameFilePaths(gameDir: string): string[] {
  const out: string[] = [];
  if (existsSync(join(gameDir, MANIFEST))) out.push(`./${MANIFEST}`);
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(gameDir, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const path = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(path);
      else if (e.isFile()) out.push(`./${path}`);
    }
  };
  if (existsSync(join(gameDir, 'content'))) walk('content');
  return out.sort();
}

/** The game's data files as `{ path: text }` pairs, keyed as {@link gameFilePaths}. */
export function readGameFolder(gameDir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const path of gameFilePaths(gameDir)) out[path] = readFileSync(join(gameDir, path), 'utf8');
  return out;
}

/** The source of the virtual module for one game folder. */
export function gameFilesModule(gameDir: string): string {
  return `export default ${JSON.stringify(readGameFolder(gameDir))};\n`;
}

/** The error for an importer outside every game folder. */
export function noGameError(importer: string): string {
  return (
    `${GAME_FILES_ID}: no ${MANIFEST} in the folder of ${importer} or any folder above it. ` +
    `Import ${GAME_FILES_ID} only from a game's own code (games/<name>/ or games/samples/<name>/).`
  );
}

/** Whether `file` (absolute) is one of `gameDir`'s data files: its game.json or under content/. */
function isDataFile(gameDir: string, file: string): boolean {
  const abs = resolve(file);
  return abs === join(gameDir, MANIFEST) || abs.startsWith(join(gameDir, 'content') + '/');
}

/** Reloads the page when a loaded game's data file is added, changed or removed (dev server). */
function watchDataFiles(server: ViteDevServer): void {
  const onFile = (file: string): void => {
    for (const mod of server.moduleGraph.idToModuleMap.values()) {
      if (!mod.id?.startsWith(RESOLVED_PREFIX)) continue;
      if (!isDataFile(mod.id.slice(RESOLVED_PREFIX.length), file)) continue;
      server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
    }
  };
  server.watcher.on('add', onFile);
  server.watcher.on('change', onFile);
  server.watcher.on('unlink', onFile);
}

/**
 * The `virtual:game-files` plugin (Engine 0.14 T2, gap G5): a game's browser code writes
 * `import files from 'virtual:game-files'` and gets its own folder's data files as `{ path: text }`
 * pairs, the folder found by walking up from the importer to the nearest `game.json`. Node tools
 * read the same files with `readGameFiles` (`engine/core/node/game-files.ts`).
 */
export function gameFiles(): Plugin {
  return {
    name: 'worlds-within:game-files',
    resolveId(id, importer) {
      if (id !== GAME_FILES_ID) return null;
      const dir = importer ? findGameDir(importer) : null;
      if (!dir) this.error(noGameError(importer ?? '(no importer)'));
      return RESOLVED_PREFIX + dir;
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) return null;
      const dir = id.slice(RESOLVED_PREFIX.length);
      // `vite build --watch` rebuilds when a data file changes or one is added under content/.
      for (const path of gameFilePaths(dir)) this.addWatchFile(join(dir, path));
      if (existsSync(join(dir, 'content'))) this.addWatchFile(join(dir, 'content'));
      return gameFilesModule(dir);
    },
    configureServer: watchDataFiles,
  };
}
