import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenLayout } from '@engine/core/input/touch-layout';
import type { MakeLabDrawer } from './scene';

/**
 * Which backend the lab's page draws with, read from its URL: `?backend=three` shows the lab in
 * 3D through the Three.js backend (`main3d.ts`); anything else (no query, `?backend=canvas2d`, a
 * typo) keeps the Canvas2D default. Pure, so it is tested in Node (`lab.test.ts`).
 */

export type LabBackend = 'canvas2d' | 'three';

/** The query that opens the lab in 3D (the root launcher's 3D link uses the same). */
export const THREE_QUERY = '?backend=three';

/** The backend a page URL's query string (`location.search`) asks for. */
export function labBackend(search: string): LabBackend {
  return new URLSearchParams(search).get('backend') === 'three' ? 'three' : 'canvas2d';
}

/**
 * The page's toggle to the other backend: its label and a relative link (`./` for 2D, so the
 * link works under any base path).
 */
export function otherBackendLink(backend: LabBackend): { label: string; href: string; title: string } {
  return backend === 'three'
    ? { label: '2D', href: './', title: 'Play in 2D (Canvas2D backend)' }
    : { label: '3D', href: `./${THREE_QUERY}`, title: 'Play in 3D (Three.js backend)' };
}

/**
 * How the page shows the lab, the one part of the boot that differs between backends: the
 * renderer the scene stack draws through, the scene's drawer, how the picture is fitted to the
 * screen layout, and what to do after the scenes drew. `main.ts` builds the Canvas2D one and
 * `main3d.ts` (loaded only for `?backend=three`) the Three.js one.
 */
export interface LabDisplay {
  /** Handed to `SceneStack.render` (the 3D display's draws nothing: its drawer has a presenter). */
  renderer: Renderer;
  picture: MakeLabDrawer;
  /** Places the picture clear of the touch controls (`layoutScreen`'s `fit`). */
  fit(layout: ScreenLayout): void;
  /** After the scenes drew: put the picture on the page. */
  present(): void;
}
