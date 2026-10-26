import { describe, expect, it } from 'vitest';
import { hitButton, releaseHidden, slideHeld, type ButtonTarget, type HeldButton } from './touch-logic';

// 0.5.0 (owner review of the first-tap fix): a thumb held on JUMP when a card opens. The card hides
// every button for its guard, then shows OK on the same spot. The held thumb must not re-take OK
// as a fresh press when it moves a pixel: a button hidden under it is let go until it lifts.

const A: ButtonTarget = { action: 'jump', cx: 300, cy: 600, r: 30 };
const B: ButtonTarget = { action: 'attack', cx: 240, cy: 640, r: 30 };

describe('a held thumb and buttons that hide and come back', () => {
  it('a held JUMP is let go when the card hides it, and moving 1-3 px over the returned OK takes nothing', () => {
    const thumb: HeldButton = { action: 'jump', slide: true };
    // The card opens: every button hides.
    expect(releaseHidden(thumb, ['jump', 'attack', 'special', 'start', 'select'])).toBe(true);
    expect(thumb).toEqual({ action: null, slide: false });
    // The guard is over: OK shows on A's spot; the thumb wobbles 1-3 px over it.
    for (const dx of [1, 2, 3]) {
      expect(slideHeld(thumb, hitButton(A.cx + dx, A.cy, [A, B]))).toBe(false);
      expect(thumb.action).toBeNull();
    }
  });

  it('a button that stays shown is kept, and a thumb not let go still rolls from B to A', () => {
    const thumb: HeldButton = { action: 'attack', slide: true };
    expect(releaseHidden(thumb, ['special'])).toBe(false);
    expect(thumb.action).toBe('attack');
    expect(slideHeld(thumb, hitButton(A.cx, A.cy, [A, B]))).toBe(true);
    expect(thumb.action).toBe('jump');
  });

  it('a pointer on a small button (no slide) never slides', () => {
    const thumb: HeldButton = { action: 'start', slide: false };
    expect(slideHeld(thumb, 'jump')).toBe(false);
    expect(thumb.action).toBe('start');
  });
});
