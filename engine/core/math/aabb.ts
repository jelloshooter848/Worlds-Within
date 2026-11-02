/** Axis-aligned box in subpixels (x, y top-left; w, h in subpixels). */
export interface AABB {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function overlaps(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export interface Overlap {
  /** Signed penetration on each axis (positive = b is to the right/below a). */
  dx: number;
  dy: number;
}

/** Penetration vector of a into b, or null when they don't overlap. */
export function overlap(a: AABB, b: AABB): Overlap | null {
  if (!overlaps(a, b)) return null;
  const ax = a.x + a.w / 2;
  const bx = b.x + b.w / 2;
  const ay = a.y + a.h / 2;
  const by = b.y + b.h / 2;
  const dx = ax < bx ? a.x + a.w - b.x : -(b.x + b.w - a.x);
  const dy = ay < by ? a.y + a.h - b.y : -(b.y + b.h - a.y);
  return { dx, dy };
}

export function containsPoint(a: AABB, x: number, y: number): boolean {
  return x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
}
