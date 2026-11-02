import { describe, expect, it } from 'vitest';
import { presenterByStatus } from './switch';
import type { DeepReadonly, Presenter, PresentFrame } from './types';

/** A presenter that records the frame numbers it was handed and the sizes it was given. */
function recording(): Presenter & { frames: number[]; sizes: number[] } {
  const p = {
    frames: [] as number[],
    sizes: [] as number[],
    present: (f: DeepReadonly<PresentFrame>) => void p.frames.push(f.frame),
    resize: (s: { width: number }) => void p.sizes.push(s.width),
  };
  return p;
}

const frame = (n: number, miniGame: string | number): PresentFrame => ({
  frame: n,
  size: { width: 16, height: 16 },
  entities: [],
  events: [],
  status: { miniGame },
});

describe('presenterByStatus', () => {
  it("hands each frame to the presenter its status value names, else to 'otherwise'", () => {
    const level = recording();
    const vault = recording();
    const p = presenterByStatus('miniGame', { vault }, level);
    p.present(frame(1, ''));
    p.present(frame(2, 'vault'));
    p.present(frame(3, 'other'));
    p.present(frame(4, 7));
    p.present({ ...frame(5, ''), status: {} });
    expect(level.frames).toEqual([1, 3, 4, 5]);
    expect(vault.frames).toEqual([2]);
  });

  it('does not take inherited keys for presenters', () => {
    const level = recording();
    presenterByStatus('miniGame', {}, level).present(frame(1, 'toString'));
    expect(level.frames).toEqual([1]);
  });

  it('resizes every presenter', () => {
    const level = recording();
    const vault = recording();
    presenterByStatus('miniGame', { vault }, level).resize!({ width: 320, height: 240 });
    expect([level.sizes, vault.sizes]).toEqual([[320], [320]]);
  });
});
