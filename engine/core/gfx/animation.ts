export interface AnimDef {
  frames: readonly string[];
  /** Frames (ticks) each sprite frame is shown. */
  rate: number;
  loop?: boolean;
}

export class Animator {
  private name = '';
  private def: AnimDef | null = null;
  private tick = 0;
  private index = 0;
  done = false;

  constructor(private readonly anims: Record<string, AnimDef>) {}

  get current(): string {
    return this.name;
  }

  play(name: string, restart = false): void {
    if (this.name === name && !restart) return;
    const def = this.anims[name];
    if (!def) return;
    this.name = name;
    this.def = def;
    this.tick = 0;
    this.index = 0;
    this.done = false;
  }

  /** Advance by one game frame. `rate` can be overridden per call (walk speed scaling). */
  update(rate?: number): void {
    const d = this.def;
    if (!d || this.done) return;
    this.tick++;
    const r = rate ?? d.rate;
    if (this.tick >= r) {
      this.tick = 0;
      this.index++;
      if (this.index >= d.frames.length) {
        if (d.loop === false) {
          this.index = d.frames.length - 1;
          this.done = true;
        } else this.index = 0;
      }
    }
  }

  get frame(): string {
    return this.def?.frames[this.index] ?? '';
  }
}
