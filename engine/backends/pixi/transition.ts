import type { Graphics } from 'pixi.js';
import type { ScreenSize } from '@engine/core/gfx/screen';
import { wipeAlpha, type TransitionShape } from '@engine/core/fx';

/**
 * Draws a screen transition's shape (`transitionShape` from `@engine/core/fx`, Engine 0.16 T5) on
 * `g` (cleared first), over a `screen`-sized picture, matching Canvas2D's `drawTransition`
 * (`transitionAlphaAt` per pixel): a fade is the colour at its alpha over the picture; a wipe is
 * one opaque box between its soft edges and a 1 px band per pixel of each edge at that pixel's
 * alpha (`wipeAlpha` at its centre: what the canvas's gradient gives, without a gradient
 * texture); an iris is the picture covered with the circle cut out (`cut()`, a hole).
 */
export function drawTransition(g: Graphics, shape: TransitionShape | null, screen: ScreenSize): void {
  g.clear();
  if (!shape) return;
  const { width, height } = screen;
  const color = shape.color;
  switch (shape.kind) {
    case 'fade':
      g.rect(0, 0, width, height).fill({ color, alpha: shape.alpha });
      break;
    case 'wipe': {
      const horizontal = shape.direction === 'right' || shape.direction === 'left';
      const across = horizontal ? height : width;
      // A band [s0, s1) along the travel, in picture px.
      const band = (s0: number, s1: number, alpha: number) => {
        const a = Math.max(0, s0);
        const b = Math.min(shape.length, s1);
        if (b <= a || alpha <= 0) return;
        const from = shape.direction === 'right' || shape.direction === 'down' ? a : shape.length - b;
        if (horizontal) g.rect(from, 0, b - a, across);
        else g.rect(0, from, across, b - a);
        g.fill({ color, alpha });
      };
      const start = Math.max(0, Math.floor(shape.trail));
      const end = Math.min(shape.length, Math.ceil(shape.lead));
      let s = start;
      while (s < end) {
        const alpha = wipeAlpha(shape, s + 0.5);
        if (alpha >= 1) {
          // The opaque run in one box.
          let t = s + 1;
          while (t < end && wipeAlpha(shape, t + 0.5) >= 1) t++;
          band(s, t, 1);
          s = t;
        } else {
          band(s, s + 1, alpha);
          s++;
        }
      }
      break;
    }
    case 'iris':
      g.rect(0, 0, width, height).fill({ color });
      if (shape.radius > 0) g.circle(shape.x, shape.y, shape.radius).cut();
      break;
  }
}
