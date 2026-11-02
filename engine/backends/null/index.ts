import type { Renderer } from '@engine/core/gfx/renderer';

/** The headless renderer: draws nothing (tests, the headless sim, CI). */
export class NullRenderer implements Renderer {
  clear(): void {}
  rect(): void {}
  sprite(): void {}
  text(): void {}
  debugText(): void {}
  line(): void {}
}
