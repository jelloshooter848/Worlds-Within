/**
 * Hit-pause (freeze frames; docs/ROADMAP.md, Engine 0.16 part A, T4): how many display frames the
 * browser shell still holds the game's ticks for. A presenter that plays a skin event's
 * `hitPause { ticks }` asks for it (`request`); the shell's loop asks `hold()` before each step
 * and skips the step while it says true, and the presenters keep drawing the held frame. Pure: a
 * counter, no clock. Requests do not add up: a new one only lengthens a pause that has fewer
 * frames left, so two stomps on one frame freeze once. Headless runs never make one, so the tick
 * sequence and every hash are the same with or without it.
 */
export class HitPause {
  private left = 0;

  /** Holds the game at least `ticks` more display frames (whole frames; 0 or less does nothing). */
  request(ticks: number): void {
    const n = Math.floor(ticks);
    if (n > this.left) this.left = n;
  }

  /** True (and one frame used) while a pause is running: skip this step. */
  hold(): boolean {
    if (this.left <= 0) return false;
    this.left--;
    return true;
  }

  /** Display frames still to hold. */
  get remaining(): number {
    return this.left;
  }

  clear(): void {
    this.left = 0;
  }
}
