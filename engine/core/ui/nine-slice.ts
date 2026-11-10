/**
 * Nine-slice panels (Engine 0.16 T6): a sprite frame cut into corners, edges and a centre by four
 * insets, laid over a box of any size. Corners keep their size, edges stretch (or tile) along
 * their side and the centre fills the rest. Pure maths in whole pixels; drawing is a backend's.
 */

/** Px from each side of the frame that stays fixed. */
export interface Insets {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How edges and the centre fill their span: scaled (`stretch`) or repeated at size (`tile`). */
export type SliceFill = 'stretch' | 'tile';

/** A box in px. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One piece to draw: the part of the frame (`sx`, `sy`, `sw`, `sh`, from its top-left) and where it goes. */
export interface SlicePiece {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One number for every side, or the four insets as given. */
export function sliceInsets(slice: number | Insets): Insets {
  return typeof slice === 'number' ? { left: slice, top: slice, right: slice, bottom: slice } : { ...slice };
}

/** One axis: the source span and the destination span of each of the three bands. */
interface Band {
  s: number;
  sl: number;
  d: number;
  dl: number;
}

/**
 * The three bands of one axis. The fixed ends keep their size unless the box is too small for
 * both, when each gets what fits (the first end its start, the last its end); the middle band is
 * what is left of the source and of the box.
 */
function bands(size: number, start: number, end: number, box: number): Band[] {
  const a = Math.min(start, size);
  const b = Math.min(end, size - a);
  let da = a;
  let db = b;
  if (a + b > box) {
    da = Math.min(a, Math.floor((box * a) / Math.max(1, a + b)));
    db = Math.min(b, box - da);
  }
  return [
    { s: 0, sl: da, d: 0, dl: da },
    { s: a, sl: size - a - b, d: da, dl: box - da - db },
    { s: size - db, sl: db, d: box - db, dl: db },
  ];
}

/** A middle band repeated at its source size along its span, the last copy cut short. */
function tiles(band: Band): Band[] {
  if (band.sl <= 0) return [];
  const out: Band[] = [];
  for (let d = 0; d < band.dl; d += band.sl)
    out.push({
      s: band.s,
      sl: Math.min(band.sl, band.dl - d),
      d: band.d + d,
      dl: Math.min(band.sl, band.dl - d),
    });
  return out;
}

/**
 * The pieces of a frame `frame.w` x `frame.h` cut by `insets` and laid over `box`: up to nine,
 * row by row (corners, edges, centre), more where `fill` is `tile`. Pieces with nothing to show
 * (an empty source or destination) are left out.
 */
export function nineSlice(
  frame: { w: number; h: number },
  insets: Insets,
  box: Box,
  fill: SliceFill = 'stretch',
): SlicePiece[] {
  const cols = bands(frame.w, insets.left, insets.right, box.w);
  const rows = bands(frame.h, insets.top, insets.bottom, box.h);
  const out: SlicePiece[] = [];
  rows.forEach((row, ri) => {
    cols.forEach((col, ci) => {
      const ys = fill === 'tile' && ri === 1 ? tiles(row) : [row];
      const xs = fill === 'tile' && ci === 1 ? tiles(col) : [col];
      for (const r of ys) {
        for (const c of xs) {
          if (r.sl <= 0 || c.sl <= 0 || r.dl <= 0 || c.dl <= 0) continue;
          out.push({
            sx: c.s,
            sy: r.s,
            sw: c.sl,
            sh: r.sl,
            x: box.x + c.d,
            y: box.y + r.d,
            w: c.dl,
            h: r.dl,
          });
        }
      }
    });
  });
  return out;
}
