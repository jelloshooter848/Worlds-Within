export interface Stepper {
  step(): void;
  render(): void;
}

/**
 * Fixed 60 Hz stepper driven by requestAnimationFrame. No interpolation: the game is
 * rendered at integer pixel positions after the last step, like the NES would.
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

  constructor(
    private readonly target: Stepper,
    hz = 60,
    private readonly maxCatchUp = 4,
  ) {
    this.stepMs = 1000 / hz;
  }

  start(): void {
    if (this.running) return;
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
      if (this.frameCounter % this.stepDivider === 0) this.target.step();
      steps++;
    }
    if (steps === this.maxCatchUp) this.acc = 0;
    this.target.render();
  }
}
