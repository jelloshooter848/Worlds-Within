import type { ScreenSize } from '@engine/core/gfx/screen';
import { wipeAlpha, type TransitionShape } from '@engine/core/fx';

/** The 2D context calls a transition draws with (a real canvas's, or a test's recorder). */
export type TransitionCtx = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'fillRect'
  | 'beginPath'
  | 'rect'
  | 'arc'
  | 'fill'
  | 'createLinearGradient'
  | 'globalAlpha'
  | 'fillStyle'
  | 'globalCompositeOperation'
>;

/**
 * Draws a screen transition's shape (`transitionShape` from `@engine/core/fx`, Engine 0.16 T5)
 * over everything on `ctx`, a `screen`-sized picture: a fade is the colour at its alpha over the
 * picture, a wipe a linear gradient along its travel (opaque between its soft edges, clear past
 * them), an iris the picture covered but for a circle (the even-odd rule cuts the hole). The
 * context's state is restored after.
 */
export function drawTransition(ctx: TransitionCtx, shape: TransitionShape, screen: ScreenSize): void {
  const { width, height } = screen;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  switch (shape.kind) {
    case 'fade':
      ctx.globalAlpha = shape.alpha;
      ctx.fillStyle = shape.color;
      ctx.fillRect(0, 0, width, height);
      break;
    case 'wipe': {
      // The travel coordinate s from `trail` to `lead`, in picture px.
      const along = (s: number): [number, number] => {
        switch (shape.direction) {
          case 'right':
            return [s, 0];
          case 'left':
            return [width - s, 0];
          case 'down':
            return [0, s];
          case 'up':
            return [0, height - s];
        }
      };
      const span = shape.lead - shape.trail;
      if (span <= 0) break;
      const [x0, y0] = along(shape.trail);
      const [x1, y1] = along(shape.lead);
      const gradient = ctx.createLinearGradient(x0, y0, x1, y1);
      const stops = [0, shape.edge / span, 1 - shape.edge / span, 1].map((t) => Math.min(1, Math.max(0, t)));
      const rgb = hexRgb(shape.color);
      for (const t of stops.sort((a, b) => a - b))
        gradient.addColorStop(t, `rgba(${rgb}, ${wipeAlpha(shape, shape.trail + t * span)})`);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case 'iris':
      ctx.fillStyle = shape.color;
      ctx.beginPath();
      ctx.rect(0, 0, width, height);
      if (shape.radius > 0) ctx.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
      ctx.fill('evenodd');
      break;
  }
  ctx.restore();
}

/** `#rgb` / `#rrggbb` as `r, g, b` for an `rgba()` colour. */
function hexRgb(color: string): string {
  let hex = color.slice(1);
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
}
