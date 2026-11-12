import type { ImageRecolor } from '../draw/recolor';

/**
 * The browser's `ImageRecolor` (Engine 0.16 part D, D4: outlines and team colours): the image
 * copied onto an offscreen canvas (else a page canvas), its pixels read, edited and written back,
 * and the canvas returned as the new sheet image. Null where there is no canvas (Node) or the image
 * cannot be drawn or read (a GPU texture, a tainted image), so the walk draws without it. Both 2D
 * backends pass it to the shared walk (a PixiJS sheet image may be any canvas image).
 */
export const canvasRecolor: ImageRecolor = (image, edit) => {
  const size = image as { width?: unknown; height?: unknown };
  const width = typeof size.width === 'number' ? size.width : 0;
  const height = typeof size.height === 'number' ? size.height : 0;
  if (width <= 0 || height <= 0) return null;
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(width, height);
  else if (typeof document !== 'undefined') {
    canvas = Object.assign(document.createElement('canvas'), { width, height });
  } else return null;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) return null;
  try {
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    edit(pixels.data, width, height);
    ctx.putImageData(pixels, 0, 0);
  } catch {
    return null;
  }
  return canvas;
};
