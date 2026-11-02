/*
 * The pure part of pointer input (Engine 0.9, the RTS view): it turns raw pointer samples (mouse,
 * pen and touch, in picture pixels, with a time in milliseconds) into gestures a game can act on:
 * a tap or click (primary, or secondary from the right button or a touch long-press), a box drag,
 * a pan (middle-button drag, two-finger drag, edge scroll) and a zoom (mouse wheel, pinch). No DOM
 * and no clock: `PointerSource` in pointer.ts feeds it from the page, and tests feed it scripted
 * samples. Same samples in, same gestures out.
 */

/** What made a pointer: a pen counts as a mouse (it has buttons and can hover). */
export type PointerKind = 'mouse' | 'touch' | 'pen';

/** The mouse button a pointer went down with (DOM `button`): 0 primary, 1 middle, 2 secondary. */
export type PointerButton = 0 | 1 | 2;

/** One raw pointer sample. `x`/`y` are picture pixels; `t` is milliseconds on any one clock. */
export type PointerSample =
  | { type: 'down'; id: number; kind: PointerKind; button: PointerButton; x: number; y: number; t: number }
  /** A move of a pointer that is down, or (mouse and pen) of the hovering cursor. */
  | { type: 'move'; id: number; kind: PointerKind; x: number; y: number; t: number }
  | { type: 'up'; id: number; kind: PointerKind; x: number; y: number; t: number }
  /** The browser took the pointer away (a system gesture, a lost capture): nothing completes. */
  | { type: 'cancel'; id: number; t: number }
  /** The hovering cursor left the picture: edge scroll stops. */
  | { type: 'leave'; t: number }
  /** A wheel turn at (x, y); `deltaY` in pixels, positive away from the user (zoom out). */
  | { type: 'wheel'; x: number; y: number; deltaY: number; t: number };

/** A recognised gesture. Coordinates are picture pixels. */
export type PointerGesture =
  /** A click or tap that did not move past the slop: `secondary` is the right button or a long-press. */
  | { type: 'tap'; button: 'primary' | 'secondary'; x: number; y: number; kind: PointerKind }
  /**
   * A primary drag past the slop, from (x0, y0) where it went down to (x1, y1) now: `move` while
   * it is held (to draw the box), `end` when it lifts (select), `cancel` when it is abandoned (a
   * second finger came down, the browser cancelled it).
   */
  | {
      type: 'box';
      phase: 'move' | 'end' | 'cancel';
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      kind: PointerKind;
    }
  /**
   * The picture's content moved by (dx, dy) picture pixels, the way a dragged map follows the
   * hand: a drag right gives dx > 0, so the camera moves left. Edge scroll at the left edge also
   * gives dx > 0 (the camera moves towards that edge).
   */
  | { type: 'pan'; dx: number; dy: number; source: 'drag' | 'edge' }
  /** Zoom by `factor` (> 1 zooms in) keeping the world point under (x, y) where it is. */
  | { type: 'zoom'; factor: number; x: number; y: number; source: 'wheel' | 'pinch' };

export interface PointerOptions {
  /** The picture size, for edge scroll (picture pixels). */
  screen: { width: number; height: number };
  /** A pointer that moves this far (picture px) from where it went down is a drag, not a tap. */
  slop?: number;
  /** A touch held still this long (ms) is a secondary tap (a long-press). */
  longPressMs?: number;
  /** The hovering cursor this close to a picture edge (px) scrolls; 0 turns edge scroll off. */
  edgeMargin?: number;
  /** Edge scroll speed in picture px per `tick`. */
  edgeSpeed?: number;
  /** Wheel pixels (`deltaY`) that halve or double the zoom. */
  wheelPerDouble?: number;
}

export const POINTER_DEFAULTS = {
  slop: 4,
  longPressMs: 500,
  edgeMargin: 4,
  edgeSpeed: 4,
  wheelPerDouble: 500,
} as const;

/** What one pointer that is down is doing. */
type Mode =
  /** Down and still inside the slop: a tap (or long-press) so far. */
  | 'pending'
  /** A primary drag past the slop. */
  | 'box'
  /** A middle-button drag. */
  | 'pan'
  /** Part of a two-finger gesture. */
  | 'multi'
  /** Used up (a long-press fired, a secondary drag, a finger left over from a pinch): ignored until it lifts. */
  | 'none';

interface Down {
  id: number;
  kind: PointerKind;
  button: PointerButton;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  mode: Mode;
}

/**
 * Turns pointer samples into gestures. `feed(sample)` returns what that sample completes (a tap,
 * a box step, a pan, a zoom); `tick(t)`, called once per game step, returns what time alone makes
 * (a touch long-press, edge scroll). One instance per picture.
 *
 * - Mouse and pen: left click is a primary tap, right click a secondary tap, a left drag past the
 *   slop is a box, a middle drag pans, the wheel zooms about the cursor and the hovering cursor at
 *   an edge scrolls (not while a button is down).
 * - Touch: a tap is primary, a hold of `longPressMs` without moving is secondary, a one-finger
 *   drag is a box, and two fingers pan (their midpoint) and pinch-zoom (their distance, about the
 *   midpoint). A second finger cancels the first's box; fingers left over after a pinch do
 *   nothing until they lift.
 */
export class PointerGestures {
  private readonly opts: Required<PointerOptions>;
  private readonly downs = new Map<number, Down>();
  private hover: { x: number; y: number } | null = null;
  /** The two-finger baseline: the midpoint and distance of the first two touches. */
  private pinch: { cx: number; cy: number; dist: number } | null = null;

  constructor(opts: PointerOptions) {
    this.opts = { ...POINTER_DEFAULTS, ...opts };
  }

  /** The hovering mouse or pen cursor (picture px), or null when it is outside or a touch is in use. */
  cursor(): { x: number; y: number } | null {
    return this.hover ? { ...this.hover } : null;
  }

  /** True while any pointer is down. */
  active(): boolean {
    return this.downs.size > 0;
  }

  /** Changes the picture size (edge scroll). */
  resize(screen: { width: number; height: number }): void {
    this.opts.screen = { width: screen.width, height: screen.height };
  }

  feed(s: PointerSample): PointerGesture[] {
    switch (s.type) {
      case 'down':
        return this.down(s);
      case 'move':
        return this.move(s);
      case 'up':
        return this.up(s);
      case 'cancel':
        return this.cancel(s.id);
      case 'leave':
        this.hover = null;
        return [];
      case 'wheel':
        if (s.deltaY === 0) return [];
        return [
          {
            type: 'zoom',
            factor: 2 ** (-s.deltaY / this.opts.wheelPerDouble),
            x: s.x,
            y: s.y,
            source: 'wheel',
          },
        ];
    }
  }

  /** Gestures time makes at `t` (ms, the samples' clock): touch long-presses, then edge scroll. */
  tick(t: number): PointerGesture[] {
    const out: PointerGesture[] = [];
    for (const d of this.downs.values()) {
      if (d.kind === 'touch' && d.mode === 'pending' && t - d.t0 >= this.opts.longPressMs) {
        d.mode = 'none';
        out.push({ type: 'tap', button: 'secondary', x: d.x0, y: d.y0, kind: d.kind });
      }
    }
    const edge = this.edge();
    if (edge) out.push(edge);
    return out;
  }

  private down(s: Extract<PointerSample, { type: 'down' }>): PointerGesture[] {
    const out: PointerGesture[] = [];
    const d: Down = {
      id: s.id,
      kind: s.kind,
      button: s.button,
      x0: s.x,
      y0: s.y,
      x: s.x,
      y: s.y,
      t0: s.t,
      mode: 'pending',
    };
    if (s.kind !== 'touch') {
      this.hover = { x: s.x, y: s.y };
      if (s.button === 1) d.mode = 'pan';
      this.downs.set(s.id, d);
      return out;
    }
    this.hover = null;
    const touches = this.touches();
    this.downs.set(s.id, d);
    if (touches.length === 0) return out;
    // A second (or later) finger: whatever the first was doing becomes a two-finger gesture.
    for (const other of touches) {
      if (other.mode === 'box') out.push(boxGesture(other, 'cancel'));
    }
    for (const other of this.touches()) other.mode = 'multi';
    this.pinch = this.pinchNow();
    return out;
  }

  private move(s: Extract<PointerSample, { type: 'move' }>): PointerGesture[] {
    const d = this.downs.get(s.id);
    if (s.kind !== 'touch' && (!d || d.kind !== 'touch')) this.hover = { x: s.x, y: s.y };
    if (!d) return [];
    const dx = s.x - d.x;
    const dy = s.y - d.y;
    d.x = s.x;
    d.y = s.y;
    switch (d.mode) {
      case 'pending':
        if (Math.hypot(d.x - d.x0, d.y - d.y0) <= this.opts.slop) return [];
        if (d.button !== 0) {
          d.mode = 'none';
          return [];
        }
        d.mode = 'box';
        return [boxGesture(d, 'move')];
      case 'box':
        return dx === 0 && dy === 0 ? [] : [boxGesture(d, 'move')];
      case 'pan':
        return dx === 0 && dy === 0 ? [] : [{ type: 'pan', dx, dy, source: 'drag' }];
      case 'multi':
        return this.pinchMove();
      case 'none':
        return [];
    }
  }

  private up(s: Extract<PointerSample, { type: 'up' }>): PointerGesture[] {
    const d = this.downs.get(s.id);
    if (!d) return [];
    const moved = this.move({ type: 'move', id: s.id, kind: s.kind, x: s.x, y: s.y, t: s.t });
    this.downs.delete(s.id);
    const out: PointerGesture[] = moved.filter((g) => g.type !== 'box');
    if (d.mode === 'pending') {
      const longPress = d.kind === 'touch' && s.t - d.t0 >= this.opts.longPressMs;
      const secondary = d.button === 2 || longPress;
      out.push({ type: 'tap', button: secondary ? 'secondary' : 'primary', x: d.x0, y: d.y0, kind: d.kind });
    } else if (d.mode === 'box') {
      out.push(boxGesture(d, 'end'));
    } else if (d.mode === 'multi') {
      this.endPinch();
    }
    return out;
  }

  private cancel(id: number): PointerGesture[] {
    const d = this.downs.get(id);
    if (!d) return [];
    this.downs.delete(id);
    if (d.mode === 'box') return [boxGesture(d, 'cancel')];
    if (d.mode === 'multi') this.endPinch();
    return [];
  }

  /** A finger of a two-finger gesture lifted: the rest wait to lift, unless two are still down. */
  private endPinch(): void {
    const left = this.touches().filter((d) => d.mode === 'multi');
    if (left.length >= 2) {
      this.pinch = this.pinchNow();
      return;
    }
    for (const d of left) d.mode = 'none';
    this.pinch = null;
  }

  private pinchMove(): PointerGesture[] {
    const before = this.pinch;
    const now = this.pinchNow();
    if (!before || !now) return [];
    this.pinch = now;
    const out: PointerGesture[] = [];
    const dx = now.cx - before.cx;
    const dy = now.cy - before.cy;
    if (dx !== 0 || dy !== 0) out.push({ type: 'pan', dx, dy, source: 'drag' });
    if (before.dist > 0 && now.dist > 0 && now.dist !== before.dist) {
      out.push({ type: 'zoom', factor: now.dist / before.dist, x: now.cx, y: now.cy, source: 'pinch' });
    }
    return out;
  }

  /** The midpoint and distance of the first two fingers of a two-finger gesture (by id). */
  private pinchNow(): { cx: number; cy: number; dist: number } | null {
    const two = this.touches()
      .filter((d) => d.mode === 'multi')
      .sort((a, b) => a.id - b.id)
      .slice(0, 2);
    if (two.length < 2) return null;
    const [a, b] = two as [Down, Down];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, dist: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  private touches(): Down[] {
    return [...this.downs.values()].filter((d) => d.kind === 'touch');
  }

  /** Edge scroll for the hovering cursor (none while a button is down). */
  private edge(): PointerGesture | null {
    const { edgeMargin: m, edgeSpeed: v, screen } = this.opts;
    if (m <= 0 || !this.hover || this.downs.size > 0) return null;
    const { x, y } = this.hover;
    const dx = x < m ? v : x >= screen.width - m ? -v : 0;
    const dy = y < m ? v : y >= screen.height - m ? -v : 0;
    return dx === 0 && dy === 0 ? null : { type: 'pan', dx, dy, source: 'edge' };
  }
}

function boxGesture(d: Down, phase: 'move' | 'end' | 'cancel'): PointerGesture {
  return { type: 'box', phase, x0: d.x0, y0: d.y0, x1: d.x, y1: d.y, kind: d.kind };
}

/** A box gesture's corners as a top-left box with a non-negative size (picture px). */
export function boxRect(g: { x0: number; y0: number; x1: number; y1: number }): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  return {
    x: Math.min(g.x0, g.x1),
    y: Math.min(g.y0, g.y1),
    w: Math.abs(g.x1 - g.x0),
    h: Math.abs(g.y1 - g.y0),
  };
}
