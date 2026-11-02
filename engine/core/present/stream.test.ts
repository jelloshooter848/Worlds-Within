import { describe, expect, it } from 'vitest';
import { FramePicture, FrameStream, PendingEvents, type FrameSource } from './stream';
import type { DeepReadonly, PresentFrame } from './types';

/** A test world: a name and a tick; each `{}` is a new world, as a new level is. */
interface World {
  name: string;
  tick: number;
}

/** A source whose state counts the frames shown of one world. */
const SOURCE: FrameSource<World, string, { shown: number; of: string }> = {
  start: (world) => ({ shown: 0, of: world.name }),
  present: (world, events, state) => ({
    frame: world.tick,
    size: { width: 16, height: 16 },
    entities: [],
    events: events.map((type) => ({ type })),
    status: { shown: ++state.shown, of: state.of },
  }),
};

describe('FrameStream', () => {
  it('keeps one state per world and starts afresh on a new world', () => {
    const stream = new FrameStream(SOURCE);
    const a = { name: 'a', tick: 0 };
    expect(stream.next(a, []).status).toEqual({ shown: 1, of: 'a' });
    a.tick = 1;
    expect(stream.next(a, ['jump']).status).toEqual({ shown: 2, of: 'a' });
    const b = { name: 'b', tick: 0 };
    expect(stream.next(b, []).status).toEqual({ shown: 1, of: 'b' });
    // Back to `a`: a world shown again after another is a new stream too.
    expect(stream.next(a, []).status).toEqual({ shown: 1, of: 'a' });
  });

  it('freezes every frame and passes the events through', () => {
    const frame = new FrameStream(SOURCE).next({ name: 'a', tick: 3 }, ['coin', 'land']);
    expect(Object.isFrozen(frame)).toBe(true);
    expect(Object.isFrozen(frame.events[0])).toBe(true);
    expect(frame.events.map((e) => e.type)).toEqual(['coin', 'land']);
    expect(frame.frame).toBe(3);
  });
});

describe('PendingEvents', () => {
  it('keeps the events of several steps until taken, then empties', () => {
    const w = { name: 'a', tick: 0 };
    const pending = new PendingEvents<World, string>(w, ['start']);
    pending.add(w, ['jump']);
    pending.add(w, []);
    pending.add(w, ['coin', 'land']);
    expect(pending.take()).toEqual(['start', 'jump', 'coin', 'land']);
    expect(pending.take()).toEqual([]);
  });

  it('drops the events of an older world when the world changes', () => {
    const a = { name: 'a', tick: 0 };
    const b = { name: 'b', tick: 0 };
    const pending = new PendingEvents<World, string>(a);
    pending.add(a, ['goal']);
    pending.add(b, ['spawn']);
    pending.add(b, ['walk']);
    expect(pending.take()).toEqual(['spawn', 'walk']);
  });
});

describe('FramePicture', () => {
  it('presents each frame of its stream and returns it', () => {
    const shown: DeepReadonly<PresentFrame>[] = [];
    const picture = new FramePicture(new FrameStream(SOURCE), { present: (f) => void shown.push(f) });
    const w = { name: 'a', tick: 7 };
    const frame = picture.draw(w, ['hit']);
    expect(shown).toEqual([frame]);
    expect(frame.frame).toBe(7);
    expect(picture.draw(w, []).status['shown']).toBe(2);
  });
});
