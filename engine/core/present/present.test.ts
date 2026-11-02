import { describe, expect, it } from 'vitest';
import { validate } from '../content/validate';
import {
  freezeFrame,
  isFullMap,
  MapTracker,
  presentFrameSchema,
  type DeepReadonly,
  type PresentFrame,
  type PresentMap,
  type Presenter,
} from './index';

const MAP: PresentMap = {
  id: 'room-a',
  version: 0,
  tileSize: 16,
  cols: 4,
  rows: 3,
  tiles: ['####', '#..#', '####'],
  layers: [
    {
      name: 'deco',
      tiles: [
        [0, 0, 0, 0],
        [0, 1, 2, 0],
        [0, 0, 0, 0],
      ],
    },
  ],
  tags: ['dark'],
};

/** A fixture frame using every field, extension points included. */
function fixture(): PresentFrame {
  return {
    frame: 12,
    size: { width: 256, height: 240 },
    entities: [
      {
        id: 'hero',
        kind: 'hero',
        x: 16,
        y: 16,
        w: 16,
        h: 16,
        facing: 'left',
        anim: { state: 'walk', t: 3 },
        tags: ['player'],
        layer: 1,
        fx: { squashX: 1.2, squashY: 0.8 },
      },
      {
        id: 'bat-1',
        kind: 'bat',
        x: 40.5,
        y: 20,
        w: 8,
        h: 8,
        facing: 'down',
        anim: { state: 'fly', t: 0 },
        tags: [],
      },
    ],
    map: MAP,
    events: [{ type: 'hit', x: 18, y: 20, entity: 'hero', damage: 1, by: { kind: 'bat' } }],
    status: { health: 3, room: 'Hall', paused: false },
    camera: { x: 128, y: 120, zoom: 1, follow: 'hero' },
  };
}

describe('presentFrameSchema', () => {
  it('accepts the fixture frame', () => {
    const r = validate('frame.json', fixture(), presentFrameSchema);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('accepts a frame with only a map reference and no extension points', () => {
    const f = fixture();
    f.map = { id: 'room-a', version: 0 };
    delete f.camera;
    const r = validate('frame.json', f, presentFrameSchema);
    expect(r.errors).toEqual([]);
  });

  it('names the field when an entity is wrong', () => {
    const f = fixture() as unknown as { entities: Record<string, unknown>[] };
    f.entities[1]!['facing'] = 'north';
    f.entities[0]!['colour'] = 'red';
    const r = validate('frame.json', f, presentFrameSchema);
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['entities.0.colour', 'unrecognized_keys'],
      ['entities.1.facing', 'invalid_value'],
    ]);
  });

  it('rejects a map whose tiles do not match its size, and event fields that are not JSON-safe', () => {
    const f = fixture();
    f.map = { ...MAP, layers: [], tiles: ['####', '#..', '####'] };
    expect(validate('frame.json', f, presentFrameSchema).ok).toBe(false);
    const g = fixture() as unknown as { events: Record<string, unknown>[] };
    g.events[0]!['when'] = Number.NaN;
    expect(validate('frame.json', g, presentFrameSchema).errors.map((e) => e.path)).toEqual([
      'events.0.when',
    ]);
  });
});

describe('freezeFrame', () => {
  it('makes every change throw, all the way down', () => {
    const f = freezeFrame(fixture());
    const loose = f as unknown as PresentFrame;
    expect(() => {
      loose.frame = 13;
    }).toThrow(TypeError);
    expect(() => {
      loose.entities[0]!.x = 99;
    }).toThrow(TypeError);
    expect(() => {
      loose.entities[0]!.anim.t = 99;
    }).toThrow(TypeError);
    expect(() => loose.entities[0]!.tags.push('x')).toThrow(TypeError);
    expect(() => loose.events.pop()).toThrow(TypeError);
    expect(() => {
      loose.status['health'] = 0;
    }).toThrow(TypeError);
    expect(() => {
      (loose.map as PresentMap).layers![0]!.tiles[1] = [9, 9, 9, 9];
    }).toThrow(TypeError);
    expect(f.entities[0]!.x).toBe(16);
  });

  it('gives a frame a presenter can read but not write', () => {
    const seen: string[] = [];
    const presenter: Presenter = {
      present(frame) {
        // @ts-expect-error a presenter can't change the frame
        frame.frame = 1;
        seen.push(frame.entities.map((e) => e.id).join(','));
      },
    };
    const frame: DeepReadonly<PresentFrame> = freezeFrame(fixture());
    expect(() => presenter.present(frame)).toThrow(TypeError);
    expect(seen).toEqual([]);
  });
});

describe('MapTracker', () => {
  it('sends the full map on the first frame and on a version or id change only', () => {
    const t = new MapTracker();
    const sent = (m: PresentMap): boolean => isFullMap(t.next(m));
    expect(sent(MAP)).toBe(true);
    expect(t.next(MAP)).toEqual({ id: 'room-a', version: 0 });
    expect(sent({ ...MAP })).toBe(false);
    expect(sent({ ...MAP, version: 1 })).toBe(true);
    expect(sent({ ...MAP, version: 1 })).toBe(false);
    expect(sent({ ...MAP, id: 'room-b', version: 1 })).toBe(true);
    expect(sent({ ...MAP, id: 'room-b', version: 1 })).toBe(false);
  });

  it('sends it again after reset', () => {
    const t = new MapTracker();
    t.next(MAP);
    t.reset();
    expect(t.next(MAP)).toBe(MAP);
  });

  it('works with a frozen map', () => {
    const t = new MapTracker();
    const frozen = freezeFrame(structuredClone(MAP));
    expect(t.next(frozen)).toBe(frozen);
    expect(isFullMap(t.next(frozen))).toBe(false);
  });
});
