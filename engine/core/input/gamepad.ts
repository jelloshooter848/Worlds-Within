import type { Code } from './bindings';
import type { InputSource } from './input-manager';

const DEADZONE = 0.5;

/** Polls navigator.getGamepads() each frame. Codes: pad:<button>, pad:axis<n>+ / pad:axis<n>-. */
export class GamepadSource implements InputSource {
  private readonly down = new Set<Code>();
  private prev = new Set<Code>();
  private justPressed: Code[] = [];
  onAnyPress: ((code: Code) => void) | null = null;
  /** Restrict to one gamepad index (per-player); null = union of all pads. */
  index: number | null;

  constructor(index: number | null = null) {
    this.index = index;
  }

  static available(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
  }

  poll(): ReadonlySet<Code> {
    this.prev = new Set(this.down);
    this.down.clear();
    if (!GamepadSource.available()) return this.down;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      if (!pad || (this.index !== null && pad.index !== this.index)) continue;
      pad.buttons.forEach((b, bi) => {
        if (b.pressed || b.value > 0.5) this.down.add(`pad:${bi}`);
      });
      pad.axes.forEach((v, ai) => {
        if (v <= -DEADZONE) this.down.add(`pad:axis${ai}-`);
        if (v >= DEADZONE) this.down.add(`pad:axis${ai}+`);
      });
    }
    for (const c of this.down) {
      if (!this.prev.has(c)) {
        this.justPressed.push(c);
        this.onAnyPress?.(c);
      }
    }
    return this.down;
  }

  takeJustPressed(): Code[] {
    const out = this.justPressed;
    this.justPressed = [];
    return out;
  }
}
