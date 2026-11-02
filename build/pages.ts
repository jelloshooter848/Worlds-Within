// Finds the game pages that Vite builds, so a new game is picked up with no config edit.
// A game is any folder `games/<name>/` or `games/samples/<name>/` that has an `index.html`.
// Node-only build tooling: used by vite.config.ts and tests, never by the engine, kits or games.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface GamePage {
  /** Folder path from the repo root, with forward slashes, e.g. `games/demo`. */
  dir: string;
  /** Rollup input name, unique per page, e.g. `games-demo`. */
  name: string;
  /** The page's `<title>`, or its folder path when it has none. */
  title: string;
  /**
   * Extra launcher links to the same page with a query, from `<meta name="ww-alternate"
   * content="<label> <?query>">` tags in its `index.html` (the platformer lab's `3D ?backend=three`).
   * Left out when the page has none.
   */
  alternates?: GameAlternate[];
}

/** One extra launcher link to a game page: a short label and the query it opens the page with. */
export interface GameAlternate {
  label: string;
  /** Starts with `?`, e.g. `?backend=three`. */
  query: string;
}

/** Folders searched for games, relative to the repo root. */
export const GAME_ROOTS = ['games', 'games/samples'] as const;

/** Every game page under `root`, sorted by folder path. */
export function discoverGames(root: string): GamePage[] {
  const pages: GamePage[] = [];
  for (const parent of GAME_ROOTS) {
    const parentPath = join(root, parent);
    if (!existsSync(parentPath)) continue;
    for (const entry of readdirSync(parentPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      const html = join(root, dir, 'index.html');
      if (!existsSync(html)) continue;
      const text = readFileSync(html, 'utf8');
      const alternates = readAlternates(text);
      pages.push({
        dir,
        name: dir.replace(/\//g, '-'),
        title: readTitle(text) ?? dir,
        ...(alternates.length > 0 && { alternates }),
      });
    }
  }
  return pages.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** Rollup inputs: the root launcher page plus every game page. */
export function pageInputs(root: string): Record<string, string> {
  const inputs: Record<string, string> = { index: join(root, 'index.html') };
  for (const page of discoverGames(root)) inputs[page.name] = join(root, page.dir, 'index.html');
  return inputs;
}

/** The launcher's list of games as HTML. Links are relative, so they work under any base path. */
export function gameListHtml(pages: readonly GamePage[]): string {
  if (pages.length === 0) return '<p>No games found.</p>';
  const items = pages.map((page) => {
    const dir = escapeHtml(page.dir);
    const extra = (page.alternates ?? [])
      .map((alt) => ` <a href="${dir}/${escapeHtml(alt.query)}">${escapeHtml(alt.label)}</a>`)
      .join('');
    return `<li><a href="${dir}/">${dir}</a>${extra} <span>${escapeHtml(page.title)}</span></li>`;
  });
  return `<ul id="games">\n${items.join('\n')}\n</ul>`;
}

/** The marker in the root index.html that the list of games replaces. */
export const GAME_LIST_MARKER = '<!-- games -->';

function readTitle(html: string): string | undefined {
  const match = /<title>([^<]*)<\/title>/i.exec(html);
  const title = match?.[1]?.trim();
  return title ? title : undefined;
}

/** The page's `ww-alternate` meta tags: `content` is a label, a space, then a `?query`. */
function readAlternates(html: string): GameAlternate[] {
  const out: GameAlternate[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*"ww-alternate"/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*"([^"]*)"/i.exec(tag)?.[1]?.trim() ?? '';
    const match = /^(\S.*?)\s+(\?\S+)$/.exec(content);
    if (match) out.push({ label: match[1]!, query: match[2]! });
  }
  return out;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
