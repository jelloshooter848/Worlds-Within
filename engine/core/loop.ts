export interface Stepper {
  step(): void;
  render(): void;
}

/** How a `FixedLoop` runs. */
export interface FixedLoopOptions {
  /**
   * Manual mode (Engine 0.14 T8, gap G31): `start()` does not run the loop on
   * `requestAnimationFrame`; the steps happen only when `advance(n)` is called (the browser
   * shell's step hook, `shell/debug.ts`). Off by default.
   */
  manual?: boolean;
}

/**
 * Fixed 60 Hz stepper driven by requestAnimationFrame. No interpolation: the game is
 * rendered at integer pixel positions after the last step, like the NES would. In manual mode
 * (`{ manual: true }`) nothing runs by itself: `advance(n)` takes exactly n steps, then one render.
 */
export class FixedLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  private running = false;
  /** 1 = normal, 2 = half speed (one step every other frame), etc. Used by the assist "time scale". */
  stepDivider = 1;
  private frameCounter = 0;
  readonly stepMs: number;
  /** True when the loop only steps through `advance(n)` (`FixedLoopOptions.manual`). */
  readonly manual: boolean;
  /** Steps taken, through `advance` or on `requestAnimationFrame` (manual mode's clock: `steps * stepMs` ms). */
  steps = 0;

  constructor(
    private readonly target: Stepper,
    hz = 60,
    private readonly maxCatchUp = 4,
    opts: FixedLoopOptions = {},
  ) {
    this.stepMs = 1000 / hz;
    this.manual = opts.manual ?? false;
  }

  /** Runs the loop on `requestAnimationFrame`; does nothing in manual mode. */
  start(): void {
    if (this.running || this.manual) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /**
   * Exactly `n` steps (each one `target.step()`, whatever the time or `stepDivider`), then one
   * render. Meant for manual mode; returns the steps taken so far.
   */
  advance(n = 1): number {
    for (let i = 0; i < n; i++) {
      this.target.step();
      this.steps++;
    }
    this.target.render();
    return this.steps;
  }

  /** Exposed for tests. */
  frame(now: number): void {
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = 250; // tab was hidden: don't spiral
    this.acc += dt;
    let steps = 0;
    while (this.acc >= this.stepMs && steps < this.maxCatchUp) {
      this.acc -= this.stepMs;
      this.frameCounter++;
      if (this.frameCounter % this.stepDivider === 0) {
        this.target.step();
        this.steps++;
      }
      steps++;
    }
    if (steps === this.maxCatchUp) this.acc = 0;
    this.target.render();
  }
}
