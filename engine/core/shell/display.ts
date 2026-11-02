import type { Renderer } from '../gfx/renderer';
import type { ScreenLayout } from '../input/touch-layout';
import type { Presenter } from '../present';

/**
 * How a page shows a game: the one part of the browser boot (`boot.ts`) that differs between
 * backends. A backend builds it (`canvasDisplay` in `engine/backends/canvas2d`, `threeDisplay` in
 * `engine/backends/three`), and the game hands `bootBrowserGame` a factory per backend, so the
 * core never imports a backend and a game can load Three.js only when the page asks for 3D.
 * Types only.
 */
export interface BrowserDisplay {
  /**
   * What the scene stack draws through each frame. A display that shows frames only (3D) gives
   * one that draws nothing: its scenes draw through `presenter`.
   */
  readonly renderer: Renderer;
  /** Shows frozen `PresentFrame`s through the game's skin on this display's picture. */
  readonly presenter: Presenter;
  /** Places the picture clear of the touch controls (`layoutScreen`'s `fit`). */
  fit(layout: ScreenLayout): void;
  /** After the scenes drew: put the picture on the page. */
  present(): void;
  /**
   * A client (CSS px) point in picture pixels, for pointer input (Engine 0.9). Optional: without
   * it the boot maps the canvas's own box onto the picture, right for a canvas sized to the
   * picture (3D); a display that letterboxes inside its canvas (Canvas2D) gives its own.
   */
  toScreen?(clientX: number, clientY: number): { x: number; y: number };
}

/** A display, or a sentence saying why it cannot start (no WebGL 2), shown on the page instead. */
export type DisplayResult = BrowserDisplay | string;
