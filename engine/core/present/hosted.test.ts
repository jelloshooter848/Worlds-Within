import { describe, expect, it } from 'vitest';
import { hostedSource } from './hosted';
import { FrameStream, type FrameSource } from './stream';
import type { PresentEvent, PresentFrame, PresentMap } from './types';

// The core's round picture (Engine 0.15 T6, gap M6): the game's own frames, or the hosted round's.

const MAP: PresentMap = { id: 'room', version: 1, tileSize: 8, cols: 1, rows: 1, tiles: ['.'] };

const frame = (status: Record<string, string>, map?: PresentMap): PresentFrame => ({
  frame: 0,
  size: { width: 8, height: 8 },
  entities: [],
  events: [],
  status,
  ...(map ? { map } : {}),
});

interface Game {
  round: boolean;
}

const MAIN: FrameSource<Game, unknown, { frames: number }> = {
  start: () => ({ frames: 0 }),
  present: (_game, _events, state) => frame({ main: String(++state.frames) }),
};

const missionOnly = (events: readonly unknown[]): PresentEvent[] =>
  events.filter((e): e is PresentEvent => (e as PresentEvent).type.startsWith('mission-'));

describe('hostedSource', () => {
  it("shows the game's own frame with miniGame '' or the round's, sending the round's map once per round", () => {
    const game: Game = { round: false };
    const stream = new FrameStream(
      hostedSource(MAIN, {
        round: (g) => (g.round ? frame({ miniGame: 'room' }, MAP) : null),
        events: missionOnly,
      }),
    );
    expect(stream.next(game, []).status).toEqual({ main: '1', miniGame: '' });
    game.round = true;
    expect(stream.next(game, []).map).toEqual(MAP);
    expect(stream.next(game, []).map).toEqual({ id: 'room', version: 1 });
    expect(stream.next(game, []).status).toEqual({ miniGame: 'room' });
    game.round = false;
    const back = stream.next(game, [{ type: 'mission-commit', outcome: 'won' }, { type: 'kit' }]);
    expect(back.status).toEqual({ main: '2', miniGame: '' });
    expect(back.events).toEqual([{ type: 'mission-commit', outcome: 'won' }]);
    game.round = true;
    expect(stream.next(game, []).map).toEqual(MAP);
  });

  it('adds no events without the option', () => {
    const stream = new FrameStream(hostedSource(MAIN, { round: () => null }));
    expect(stream.next({ round: false }, [{ type: 'mission-open' }]).events).toEqual([]);
  });

  it("adds the game's own status (the world clock, Engine 0.16 F4) to its frames and the round's", () => {
    const game: Game = { round: false };
    const stream = new FrameStream(
      hostedSource(MAIN, {
        round: (g) => (g.round ? frame({ miniGame: 'room' }) : null),
        status: () => ({ 'clock.day': 2, 'clock.phase': 'evening' }),
      }),
    );
    expect(stream.next(game, []).status).toEqual({
      main: '1',
      miniGame: '',
      'clock.day': 2,
      'clock.phase': 'evening',
    });
    game.round = true;
    expect(stream.next(game, []).status).toEqual({
      miniGame: 'room',
      'clock.day': 2,
      'clock.phase': 'evening',
    });
    const none = new FrameStream(hostedSource(MAIN, { round: () => null, status: () => null }));
    expect(none.next(game, []).status).toEqual({ main: '1', miniGame: '' });
  });
});
