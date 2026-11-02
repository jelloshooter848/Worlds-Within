import { formatErrors, validate } from '@engine/core/content/validate';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  freezeFrame,
  presentFrameSchema,
  type DeepReadonly,
  type PresentFrame,
  type Presenter,
} from '@engine/core/present';

/** The headless renderer: draws nothing (tests, the headless sim, CI). */
export class NullRenderer implements Renderer {
  clear(): void {}
  rect(): void {}
  sprite(): void {}
  text(): void {}
  debugText(): void {}
  line(): void {}
}

export interface NullPresenterOptions {
  /** Deep-freeze each frame it is given, so a later change to it by anyone throws (tests). */
  freeze?: boolean;
  /** Check each frame against `presentFrameSchema` and throw, naming the fields, when it is wrong. */
  validate?: boolean;
}

/**
 * The headless `Presenter`: takes every frame and draws nothing. It counts frames and keeps the
 * last one, so a test can read what a kit presented; `freeze` and `validate` check frames in tests.
 */
export class NullPresenter implements Presenter {
  /** Frames presented so far. */
  frames = 0;
  /** The last frame presented, or null. */
  last: DeepReadonly<PresentFrame> | null = null;
  /** The last size given to `resize`, or null. */
  size: ScreenSize | null = null;

  constructor(private readonly opts: NullPresenterOptions = {}) {}

  present(frame: DeepReadonly<PresentFrame>): void {
    if (this.opts.validate) {
      const result = validate(`frame ${frame.frame}`, frame, presentFrameSchema);
      if (!result.ok) {
        throw new Error(`bad presentation frame:\n${formatErrors(result.errors)}`);
      }
    }
    if (this.opts.freeze) freezeFrame(frame);
    this.frames++;
    this.last = frame;
  }

  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }
}
