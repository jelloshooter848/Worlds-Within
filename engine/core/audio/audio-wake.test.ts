import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioManager } from './audio-manager';

// Sound from the Home Screen (0.4.44): iOS suspends ("interrupts") the AudioContext when the app
// goes to the background, and can leave it reporting "running" but silent when it comes back.
// wake() (main.ts: visibilitychange, pageshow, focus) tries to resume straight away, and makes
// the next tap or key redo the whole unlock: resume, the silent buffer and the media-session kick.

/** Absorbs any Web Audio call: every property is itself, every call and `new` returns it. */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : anything),
  set: () => true,
  apply: () => anything,
  construct: () => anything as object,
});

class FakeContext {
  static last: FakeContext | null = null;
  state = 'running';
  resumes = 0;
  buffers = 0;
  /** Resume does nothing outside a gesture on iOS: the state stays. */
  resumeWorks = true;
  sampleRate = 48000;
  currentTime = 0;
  constructor() {
    FakeContext.last = this;
    return new Proxy(this, { get: (t, k) => (k in t ? t[k as keyof FakeContext] : anything) });
  }
  resume() {
    this.resumes++;
    if (this.resumeWorks) this.state = 'running';
    return Promise.resolve();
  }
  suspend() {
    this.state = 'suspended';
    return Promise.resolve();
  }
  createBuffer() {
    this.buffers++;
    return anything;
  }
}

let plays = 0;
beforeEach(() => {
  plays = 0;
  FakeContext.last = null;
  const listeners = new Map<string, () => void>();
  vi.stubGlobal('window', { AudioContext: FakeContext });
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: (t: string, fn: () => void) => listeners.set(t, fn),
    createElement: () => ({
      setAttribute() {},
      play: () => {
        plays++;
        return Promise.resolve();
      },
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());

function unlocked() {
  const audio = new AudioManager();
  audio.unlock();
  const ctx = FakeContext.last as FakeContext;
  expect(ctx).not.toBeNull();
  return { audio, ctx };
}

describe('audio after the app comes back from the background', () => {
  it('a running context is left alone by later taps (nothing to redo)', () => {
    const { audio, ctx } = unlocked();
    const before = { resumes: ctx.resumes, buffers: ctx.buffers, plays };
    audio.unlock();
    expect({ resumes: ctx.resumes, buffers: ctx.buffers, plays }).toEqual(before);
  });

  it('wake() resumes an interrupted context at once when it can', () => {
    const { audio, ctx } = unlocked();
    ctx.state = 'interrupted';
    const resumes = ctx.resumes;
    audio.wake();
    expect(ctx.resumes).toBe(resumes + 1);
    expect(audio.state).toBe('running');
  });

  it('when it cannot (no gesture yet), the next tap redoes the whole unlock', () => {
    const { audio, ctx } = unlocked();
    ctx.state = 'interrupted';
    ctx.resumeWorks = false;
    audio.wake();
    expect(audio.state).toBe('interrupted');
    ctx.resumeWorks = true; // inside the gesture
    const before = { resumes: ctx.resumes, buffers: ctx.buffers, plays };
    audio.unlock();
    expect(audio.state).toBe('running');
    expect(ctx.resumes).toBe(before.resumes + 1);
    expect(ctx.buffers).toBe(before.buffers + 1);
    expect(plays).toBe(before.plays + 1);
  });

  it('a context that says "running" but came back from the background is kicked again on the next tap', () => {
    const { audio, ctx } = unlocked();
    audio.wake();
    const before = { buffers: ctx.buffers, plays };
    audio.unlock();
    expect(ctx.buffers).toBe(before.buffers + 1);
    expect(plays).toBe(before.plays + 1);
    // Once is enough.
    audio.unlock();
    expect(ctx.buffers).toBe(before.buffers + 1);
  });

  it('a game paused on purpose (pause menu) stays paused through wake()', () => {
    const { audio, ctx } = unlocked();
    audio.pause();
    const resumes = ctx.resumes;
    audio.wake();
    expect(ctx.resumes).toBe(resumes);
    expect(audio.state).toBe('suspended');
  });

  it('wake() before the first unlock does nothing', () => {
    const audio = new AudioManager();
    audio.wake();
    expect(FakeContext.last).toBeNull();
  });
});
