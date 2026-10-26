export interface FrameRect {
  x: number;
  y: number;
  w: number;
  h: number;
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
