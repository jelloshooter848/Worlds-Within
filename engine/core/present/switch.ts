import type { ScreenSize } from '../gfx/screen';
import type { DeepReadonly, Presenter, PresentFrame } from './types';

/**
 * One presenter per frame source (Engine 0.7, gap G14 in docs/reports/stacking-test.md). A game
 * that stacks kits shows two kinds of frame in one stream: its own kit's and, while a mini game
 * runs, the mini game's (another kit's tiles, kinds, camera and HUD). Their tile characters and
 * kinds may clash in one skin, so each source gets its own presenter (its own skin, camera and
 * map cache), picked per frame by a status value the host kit sets (the platformer kit's
 * `status.miniGame`: the running mini game's id, '' when none). Pure: no clock, no DOM.
 */

/**
 * A presenter that hands each frame to `presenters[frame.status[status]]` when the value is a key
 * of `presenters`, else to `otherwise`. `resize` goes to every one of them.
 *
 *   presenterByStatus('miniGame', { vault: vaultPresenter }, levelPresenter)
 */
export function presenterByStatus(
  status: string,
  presenters: Readonly<Record<string, Presenter>>,
  otherwise: Presenter,
): Presenter {
  const pick = (frame: DeepReadonly<PresentFrame>): Presenter => {
    const key = frame.status[status];
    return typeof key === 'string' && Object.hasOwn(presenters, key) ? presenters[key]! : otherwise;
  };
  return {
    present: (frame) => pick(frame).present(frame),
    resize(size: ScreenSize) {
      for (const p of [otherwise, ...Object.values(presenters)]) p.resize?.(size);
    },
  };
}
