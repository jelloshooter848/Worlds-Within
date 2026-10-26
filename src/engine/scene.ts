import type { InputFrame } from './input/input-manager';
import type { Renderer } from './gfx/renderer';
import type { TouchLabels } from './input/touch';
import type { DpadZoneId } from './input/touch-logic';

export interface Scene {
  enter?(): void;
  exit?(): void;
  /** `input` is player 1; `inputs` carries every player's frame for scenes that need them. */
  update(input: InputFrame, inputs: InputFrame[]): void;
  render(r: Renderer): void;
  /** When true the scene below keeps rendering (pause menu over the level). */
  readonly translucent?: boolean;
  /**
   * What the on-screen touch buttons say while this scene is on top (null hides a button). Keys
   * left out keep the menu defaults (main.ts, MENU_TOUCH_LABELS). Touch drives player 1 only.
   */
  touchLabels?(): TouchLabels;
  /** Which zones the touch d-pad reads while this scene is on top; absent: 'default'. */
  touchDpad?(): DpadZoneId;
  /**
   * The confirm action that must run inside the player's own input event (sharing, the
   * clipboard: iOS allows them only there), while the cursor sits on it; null or absent: none.
   * The input handlers run it in the event (engine/input/gesture.ts); the scene's frame then
   * skips the same press when GestureGate.take() says it was handled.
   */
  gesture?(): (() => void) | null;
  /**
   * Called as the scene is pushed, with the scene it goes over (undefined on an empty stack),
   * before enter(): a page can take its look from the page it opens over (the Classic pause's
   * boxes, MenuScene.pushedOver).
   */
  pushedOver?(below: Scene | undefined): void;
}

export class SceneStack {
  private readonly stack: Scene[] = [];

  get top(): Scene | undefined {
    return this.stack[this.stack.length - 1];
  }
  get depth(): number {
    return this.stack.length;
  }

  push(s: Scene): void {
    const below = this.top;
    this.stack.push(s);
    s.pushedOver?.(below);
    s.enter?.();
  }
  pop(): Scene | undefined {
    const s = this.stack.pop();
    s?.exit?.();
    return s;
  }
  replace(s: Scene): void {
    this.pop();
    this.push(s);
  }
  clear(): void {
    while (this.stack.length) this.pop();
  }

  /** The topmost scene `pred` accepts, or undefined. */
  find(pred: (s: Scene) => boolean): Scene | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const s = this.stack[i] as Scene;
      if (pred(s)) return s;
    }
    return undefined;
  }

  update(inputs: InputFrame[]): void {
    const first = inputs[0];
    if (first) this.top?.update(first, inputs);
  }

  /** Draws the nearest opaque scene, then only the topmost overlay (stacked menus don't bleed through). */
  render(r: Renderer): void {
    const top = this.stack.length - 1;
    let base = top;
    while (base > 0 && this.stack[base]?.translucent) base--;
    this.stack[base]?.render(r);
    if (top !== base) this.stack[top]?.render(r);
  }
}
