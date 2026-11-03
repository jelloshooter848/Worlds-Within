import { MapTracker } from './map-tracker';
import { MINI_GAME_STATUS } from './skin-set';
import type { FrameSource } from './stream';
import { isFullMap, type PresentEvent, type PresentFrame } from './types';

/**
 * One round picture for every hosted mission (Engine 0.15 T6, gap M6; docs/BUILD-LOG.md, Engine
 * 0.15, decision 7): the switch a game hosting rounds over its own world wrote by hand. While the
 * host has a round, the frame is the round's own (`MissionHost.roundFrame()`, which already
 * carries `status.miniGame`, gap D9), its map sent through a map tracker of its own (reset when
 * the round ends, so the next round sends its map again); otherwise it is the game's own source's
 * frame with `status.miniGame` set to '' (so a skin set draws it with the main skin). The host's
 * events for the frame (`events`, e.g. `missionHostEvents` for a `MissionHost`'s mission events,
 * gap M21) are added to whichever frame is shown. Pure: no clock, no DOM, no kit code.
 *
 *   const source = hostedSource(rtsSource, { round: (g) => g.roundFrame(), events: missionHostEvents });
 */

/** What `hostedSource` reads besides the game's own source. */
export interface HostedSourceOptions<W, E> {
  /** The hosted round's frame now (with `status.miniGame` set), or null while none is hosted. */
  round(world: W): PresentFrame | null;
  /** The events since the last frame that the host adds to it (none when left out). */
  events?(events: readonly E[]): readonly PresentEvent[];
}

/** The stream state of a hosted source: the game's own, and the round's map tracker. */
export interface HostedPresentState<S> {
  readonly main: S;
  readonly roundMaps: MapTracker;
  /** Whether the last frame was a round's. */
  inRound: boolean;
}

/** The game's frames from `main`, or the hosted round's while one is hosted (see the file comment). */
export function hostedSource<W, E, S>(
  main: FrameSource<W, E, S>,
  opts: HostedSourceOptions<W, E>,
): FrameSource<W, E, HostedPresentState<S>> {
  return {
    start: (world) => ({ main: main.start(world), roundMaps: new MapTracker(), inRound: false }),
    present(world, events, state) {
      const round = opts.round(world);
      let frame: PresentFrame;
      if (round !== null) {
        frame = round;
        if (frame.map && isFullMap(frame.map)) frame.map = state.roundMaps.next(frame.map);
        state.inRound = true;
      } else {
        if (state.inRound) state.roundMaps.reset();
        state.inRound = false;
        frame = main.present(world, events, state.main);
        frame.status[MINI_GAME_STATUS] = '';
      }
      const added = opts.events?.(events) ?? [];
      if (added.length > 0) frame.events.push(...added);
      return frame;
    },
  };
}
