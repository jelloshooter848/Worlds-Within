/**
 * Keeping world labels inside the picture (Engine 0.16 polish P6, gap M45). A world-anchored
 * label (a name, a health or progress bar, a timer, a place name) whose anchor is in the picture
 * but whose box runs past an edge is moved inside the picture instead of being cut off. Pure
 * picture-px maths, shared by the 3D backend's label layer and the 2D backends' labels (through
 * the UI kit's `layoutLabels`).
 */

/** A box in picture px. */
export interface PictureBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Picture px kept clear between a clamped label and the picture's edge. */
export const LABEL_EDGE_MARGIN = 2;

/**
 * The box shifted the least so it sits inside the picture with `margin` px clear of each edge;
 * its size never changes. A box already inside comes back unchanged (a new object). On an axis
 * where it is bigger than the picture less the margins its start sits on the start margin (left
 * or top), so the beginning of a text shows.
 */
export function clampBoxInside(
  box: Readonly<PictureBox>,
  picture: Readonly<{ width: number; height: number }>,
  margin: number = LABEL_EDGE_MARGIN,
): PictureBox {
  const along = (start: number, size: number, extent: number) =>
    Math.max(margin, Math.min(start, extent - margin - size));
  return {
    x: along(box.x, box.w, picture.width),
    y: along(box.y, box.h, picture.height),
    w: box.w,
    h: box.h,
  };
}

/** The smallest box holding all of `boxes`, or null for none. */
export function unionBox(boxes: readonly Readonly<PictureBox>[]): PictureBox | null {
  if (boxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
