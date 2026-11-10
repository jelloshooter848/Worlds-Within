/**
 * Where a frame sits on the entity box it is drawn for (Engine 0.16 T10, PNG sheets): `top-left`
 * (the frame's top-left on the box's, as every text sprite is drawn), `center` (centre on
 * centre), `bottom` (the frame's bottom centre on the box's: feet on the ground), or `{ x, y }`, a
 * pixel of the frame put on the box's bottom centre.
 */
export type FrameAnchor = 'top-left' | 'center' | 'bottom' | { readonly x: number; readonly y: number };

export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Where the frame sits on the entity box (a PNG sheet's frames); none is `top-left`. */
  anchor?: FrameAnchor;
}

/** A rasterized image plus a name → rect map. Built from pixel-art definitions or loaded from a pack. */
export interface SpriteSheet {
  readonly id: string;
  readonly image: CanvasImageSource | null; // null in headless mode
  readonly frames: ReadonlyMap<string, FrameRect>;
}

export function frameSize(sheet: SpriteSheet, frame: string): { w: number; h: number } {
  const f = sheet.frames.get(frame);
  return f ? { w: f.w, h: f.h } : { w: 0, h: 0 };
}

/**
 * Where to draw a `w` x `h` frame's top-left, relative to the top-left of a `box` (world px), so
 * its `anchor` sits where it says. `flipX` mirrors a pixel anchor's `x` (the frame is drawn
 * flipped). No anchor or `top-left` is (0, 0): text sprites draw exactly as before. Pure.
 */
export function anchorOffset(
  anchor: FrameAnchor | undefined,
  frame: { w: number; h: number },
  box: { w: number; h: number },
  flipX = false,
): { x: number; y: number } {
  if (anchor === undefined || anchor === 'top-left') return { x: 0, y: 0 };
  if (anchor === 'center') {
    return { x: Math.round((box.w - frame.w) / 2), y: Math.round((box.h - frame.h) / 2) };
  }
  if (anchor === 'bottom') return { x: Math.round((box.w - frame.w) / 2), y: box.h - frame.h };
  const ax = flipX ? frame.w - anchor.x : anchor.x;
  return { x: Math.round(box.w / 2 - ax), y: box.h - anchor.y };
}
