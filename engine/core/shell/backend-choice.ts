/**
 * Which backend a game's page draws with, read from its URL (Engine 0.7, moved from
 * `games/platformer-lab/backend.ts`; PixiJS added in Engine 0.16 T13b-4): `?backend=three` shows
 * the game in 3D through the Three.js backend, `?backend=pixi` in 2D through the PixiJS (WebGL)
 * backend and `?backend=canvas2d` in 2D through Canvas2D. Anything else (no query, a typo) is the
 * game's default, Canvas2D unless the caller names another. Names only: nothing here imports a
 * backend. Pure.
 */

/** The backends a page can show a game with. */
export type PageBackend = 'canvas2d' | 'pixi' | 'three';

/** The 2D backends a page can show a game with (a game's preferred one is its `default2d`). */
export type Page2dBackend = Exclude<PageBackend, 'three'>;

/** The query that opens a game's page in 3D (the root launcher's `ww-alternate` link uses the same). */
export const THREE_QUERY = '?backend=three';

/** The query that opens a game's page in 2D through PixiJS (WebGL). */
export const PIXI_QUERY = '?backend=pixi';

/** The query that opens a game's page in 2D through Canvas2D, whatever the game's default. */
export const CANVAS2D_QUERY = '?backend=canvas2d';

const NAMED: readonly PageBackend[] = ['canvas2d', 'pixi', 'three'];

/**
 * The backend a page URL's query string (`location.search`) asks for: `three`, `pixi` or
 * `canvas2d` when the query names one exactly, else `fallback` (the game's default 2D backend,
 * default `canvas2d`).
 */
export function backendFromQuery(search: string, fallback: PageBackend = 'canvas2d'): PageBackend {
  const named = new URLSearchParams(search).get('backend');
  return NAMED.find((b) => b === named) ?? fallback;
}

/** A link to the page in another backend: its label, relative href and tooltip. */
export interface BackendLink {
  label: string;
  href: string;
  title: string;
}

/**
 * Whether a page URL's query names the 3D backend itself (`?backend=three`), rather than getting
 * it as the game's default (Engine 0.16 F7).
 */
export function queryNamesThree(search: string): boolean {
  return new URLSearchParams(search).get('backend') === 'three';
}

/**
 * The page's toggle to the other backend: its label and a relative link (`./` for the game's
 * default, so the link works under any base path). Both 2D backends link to 3D. For a game that
 * opens in 3D by default (`default3d`, Engine 0.16 F7: the mini siege), 3D links to
 * `./?backend=canvas2d` and 2D to `./`.
 */
export function otherBackendLink(backend: PageBackend, default3d = false): BackendLink {
  if (default3d)
    return backend === 'three'
      ? { label: '2D', href: `./${CANVAS2D_QUERY}`, title: 'Play in 2D' }
      : { label: '3D', href: './', title: 'Play in 3D (Three.js backend)' };
  return backend === 'three'
    ? { label: '2D', href: './', title: 'Play in 2D' }
    : { label: '3D', href: `./${THREE_QUERY}`, title: 'Play in 3D (Three.js backend)' };
}
