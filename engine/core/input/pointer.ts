import {
  PointerGestures,
  type PointerButton,
  type PointerGesture,
  type PointerKind,
  type PointerOptions,
} from './pointer-logic';

/** Converts a client (CSS px) point to picture pixels (a display's `toScreen`). */
export type ClientToScreen = (clientX: number, clientY: number) => { x: number; y: number };

/**
 * Mouse, pen and touch on the game's canvas (Engine 0.9, the RTS view): pointer events and the
 * wheel, in picture pixels, fed to a `PointerGestures` (pointer-logic.ts, where the rules are).
 * Gestures from events are queued; `beginFrame(now)` (once per game step, as `InputManager`'s)
 * makes them, plus the time-made ones (long-press, edge scroll), this step's `gestures()`. Those
 * not read in that step are dropped. Browser only: not on `PURE_CORE`.
 *
 * It sets `touch-action: none` on the canvas (the browser must not scroll or zoom the page for
 * these touches), captures each pointer that goes down on it (a drag keeps going outside), and
 * stops the context menu and page scroll on it.
 */
export class PointerSource {
  private readonly logic: PointerGestures;
  private queued: PointerGesture[] = [];
  private frame: readonly PointerGesture[] = [];
  private readonly off: (() => void)[] = [];

  constructor(
    target: HTMLElement,
    private readonly toScreen: ClientToScreen,
    opts: PointerOptions,
  ) {
    this.logic = new PointerGestures(opts);
    target.style.touchAction = 'none';
    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, fn, options);
      this.off.push(() => target.removeEventListener(type, fn, options));
    };
    on('pointerdown', (e) => {
      if (e.button > 2) return;
      target.setPointerCapture?.(e.pointerId);
      this.feedPointer('down', e);
      e.preventDefault();
    });
    on('pointermove', (e) => this.feedPointer('move', e));
    on('pointerup', (e) => this.feedPointer('up', e));
    on('pointercancel', (e) =>
      this.add(this.logic.feed({ type: 'cancel', id: e.pointerId, t: e.timeStamp })),
    );
    on('pointerleave', (e) => {
      if (e.pointerType !== 'touch') this.add(this.logic.feed({ type: 'leave', t: e.timeStamp }));
    });
    on(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = this.toScreen(e.clientX, e.clientY);
        // deltaMode 1 is lines, 2 is pages: turn both into pixels.
        const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
        this.add(
          this.logic.feed({ type: 'wheel', x: p.x, y: p.y, deltaY: e.deltaY * scale, t: e.timeStamp }),
        );
      },
      { passive: false },
    );
    on('contextmenu', (e) => e.preventDefault());
  }

  /** Once per game step: this step's gestures are those queued since the last, then time's at `now` (ms, `performance.now()`). */
  beginFrame(now: number): void {
    this.frame = [...this.queued, ...this.logic.tick(now)];
    this.queued = [];
  }

  /** This step's gestures, in the order they happened. */
  gestures(): readonly PointerGesture[] {
    return this.frame;
  }

  /** The hovering mouse or pen cursor in picture pixels, or null. */
  cursor(): { x: number; y: number } | null {
    return this.logic.cursor();
  }

  /** The picture changed size (edge scroll). */
  resize(screen: { width: number; height: number }): void {
    this.logic.resize(screen);
  }

  /** Removes every listener. */
  dispose(): void {
    for (const off of this.off.splice(0)) off();
  }

  private feedPointer(type: 'down' | 'move' | 'up', e: PointerEvent): void {
    const p = this.toScreen(e.clientX, e.clientY);
    const kind: PointerKind = e.pointerType === 'touch' ? 'touch' : e.pointerType === 'pen' ? 'pen' : 'mouse';
    const t = e.timeStamp;
    if (type === 'down') {
      const button = (e.button === 1 || e.button === 2 ? e.button : 0) as PointerButton;
      this.add(this.logic.feed({ type, id: e.pointerId, kind, button, x: p.x, y: p.y, t }));
    } else {
      this.add(this.logic.feed({ type, id: e.pointerId, kind, x: p.x, y: p.y, t }));
    }
  }

  private add(gestures: PointerGesture[]): void {
    this.queued.push(...gestures);
  }
}
