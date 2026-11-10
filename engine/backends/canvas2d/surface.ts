import type { DrawSurface } from '@engine/core/draw';
import { CanvasRenderer } from './renderer';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/**
 * Canvas2D's drawing surface for the shared presenter (the cached map) and UI painter (a font's
 * glyph strips): an offscreen canvas where there is one, else a page canvas, else none (Node).
 */
export function canvasSurface(width: number, height: number): DrawSurface | null {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined') {
    canvas = Object.assign(document.createElement('canvas'), { width, height });
  } else return null;
  const ctx = canvas.getContext('2d') as Ctx | null;
  return ctx ? { renderer: new CanvasRenderer(ctx), image: canvas } : null;
}
