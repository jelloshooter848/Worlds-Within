/**
 * Which backend a game's page draws with, read from its URL (Engine 0.7, moved from
 * `games/platformer-lab/backend.ts`): `?backend=three` shows the game in 3D through the Three.js
 * backend; anything else (no query, `?backend=canvas2d`, a typo) keeps the Canvas2D default. Names
 * only: nothing here imports a backend. Pure.
 */

/** The backends a page can show a game with. */
export type PageBackend = 'canvas2d' | 'three';

/** The query that opens a game's page in 3D (the root launcher's `ww-alternate` link uses the same). */
export const THREE_QUERY = '?backend=three';

/** The backend a page URL's query string (`location.search`) asks for. */
export function backendFromQuery(search: string): PageBackend {
  return new URLSearchParams(search).get('backend') === 'three' ? 'three' : 'canvas2d';
}

/** A link to the page in another backend: its label, relative href and tooltip. */
export interface BackendLink {
  label: string;
  href: string;
  title: string;
}

/**
 * The page's toggle to the other backend: its label and a relative link (`./` for 2D, so the
 * link works under any base path).
 */
export function otherBackendLink(backend: PageBackend): BackendLink {
  return backend === 'three'
    ? { label: '2D', href: './', title: 'Play in 2D (Canvas2D backend)' }
    : { label: '3D', href: `./${THREE_QUERY}`, title: 'Play in 3D (Three.js backend)' };
}
