import { describe, expect, it } from 'vitest';
import { anchorPoint, keyframeAt, PARTICLE_CATCH_UP, ParticleSystem } from './particles';
import { emitterSchema, type EmitterDef } from './schema';
import { lerpColor } from './color';

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

const SPARKS: EmitterDef = {
  burst: 12,
  life: [6, 14],
  speed: [0.5, 2],
  angle: [180, 360],
  gravity: 0.1,
  drag: 0.05,
  shape: { circle: 3 },
  size: [2, 1],
  color: ['#ffffff', '#f8b800', '#d82800'],
  alpha: [
    { at: 0, value: 1 },
    { at: 0.7, value: 1 },
    { at: 1, value: 0 },
  ],
  blend: 'add',
};

/** Steps a system through `frames` with one burst of `def` at frame 0, recording each frame's particles. */
function play(seed: number, def: EmitterDef, frames: number, step = 1) {
  const sys = new ParticleSystem({ seed });
  sys.emit('sparks', def, { x: 50, y: 40 }, 0);
  const out: unknown[] = [];
  for (let f = 0; f < frames; f += step) {
    sys.update(f);
    out.push(sys.particles());
  }
  return out;
}

describe('ParticleSystem', () => {
  it('gives identical particles for the same seed and frames, and others for another seed', () => {
    expect(play(7, SPARKS, 20)).toEqual(play(7, SPARKS, 20));
    expect(play(8, SPARKS, 20)).not.toEqual(play(7, SPARKS, 20));
  });

  it('lands in the same place stepping frame by frame or skipping frames', () => {
    const a = new ParticleSystem({ seed: 3 });
    const b = new ParticleSystem({ seed: 3 });
    a.emit('sparks', SPARKS, { x: 0, y: 0 }, 0);
    b.emit('sparks', SPARKS, { x: 0, y: 0 }, 0);
    for (let f = 0; f <= 5; f++) a.update(f);
    b.update(0);
    b.update(5);
    expect(b.particles()).toEqual(a.particles());
    // A frame shown twice changes nothing.
    b.update(5);
    expect(b.particles()).toEqual(a.particles());
  });

  it('moves particles by speed, drag and gravity as a closed form of their age', () => {
    const sys = new ParticleSystem();
    const def: EmitterDef = { burst: 1, life: 100, speed: 2, angle: 0, gravity: 0.5 };
    sys.emit('one', def, { x: 10, y: 20 }, 0);
    sys.update(0);
    expect(sys.particles()[0]).toMatchObject({ x: 10, y: 20, age: 0 });
    sys.update(3);
    // x: 2 px a frame; y: gravity 0.5 added to the speed each frame, then moved: 0.5 + 1 + 1.5.
    expect(sys.particles()[0]!.x).toBeCloseTo(16);
    expect(sys.particles()[0]!.y).toBeCloseTo(23);
    const slow = new ParticleSystem();
    slow.emit('drag', { burst: 1, life: 100, speed: 4, angle: 0, drag: 0.5 }, { x: 0, y: 0 }, 0);
    slow.update(2);
    // 4 * 0.5 + 4 * 0.25
    expect(slow.particles()[0]!.x).toBeCloseTo(3);
  });

  it('removes particles at the end of their life and the emitter after its last particle', () => {
    const sys = new ParticleSystem();
    sys.emit('p', { burst: 3, life: 4 }, { x: 0, y: 0 }, 10);
    sys.update(10);
    expect(sys.count).toBe(3);
    sys.update(13);
    expect(sys.count).toBe(3);
    sys.update(14);
    expect(sys.count).toBe(0);
    expect(sys.emitterCount).toBe(0);
  });

  it('runs a rate for its duration, carrying fractions', () => {
    const sys = new ParticleSystem();
    sys.emit('r', { rate: 0.5, duration: 10, life: 100 }, { x: 0, y: 0 }, 0);
    for (let f = 0; f < 30; f++) sys.update(f);
    expect(sys.count).toBe(5);
  });

  it('holds the count caps: per emitter `max` and the system max', () => {
    const sys = new ParticleSystem({ max: 50 });
    sys.emit('a', { burst: 500, life: 100, max: 30 }, { x: 0, y: 0 }, 0);
    sys.update(0);
    expect(sys.count).toBe(30);
    sys.emit('b', { rate: 10, duration: 100, life: 100 }, { x: 0, y: 0 }, 1);
    for (let f = 1; f < 40; f++) {
      sys.update(f);
      expect(sys.count).toBeLessThanOrEqual(50);
    }
    expect(sys.count).toBe(50);
  });

  it('spreads an even burst exactly round the ring', () => {
    const sys = new ParticleSystem();
    sys.emit('ring', { burst: 4, life: 10, speed: 1, angle: [0, 360], even: true }, { x: 0, y: 0 }, 0);
    sys.update(2);
    expect(sys.particles().map((p) => [Math.round(p.x) + 0, Math.round(p.y) + 0])).toEqual([
      [2, 0],
      [0, 2],
      [-2, 0],
      [0, -2],
    ]);
  });

  it('keeps an attached emitter on its entity and stops it when the entity goes', () => {
    const sys = new ParticleSystem({ seed: 1 });
    const def: EmitterDef = { rate: 1, life: 3, anchor: 'feet' };
    let box = { x: 0, y: 0, w: 10, h: 10 };
    for (let f = 0; f < 3; f++) {
      sys.attach('torch', 'smoke', def, box, f);
      sys.update(f, (id) => (id === 'torch' ? box : undefined));
    }
    expect(sys.particles().map((p) => [p.x, p.y])).toEqual([
      [5, 10],
      [5, 10],
      [5, 10],
    ]);
    // It moved: new particles are born where it is now; old ones stay where they were born.
    box = { x: 100, y: 0, w: 10, h: 10 };
    sys.attach('torch', 'smoke', def, box, 3);
    sys.update(3, () => box);
    expect(sys.particles().map((p) => p.x)).toEqual([5, 5, 105]);
    expect(sys.emitterCount).toBe(1);
    // Gone: nothing new, the last particles finish, then the emitter is dropped.
    for (let f = 4; f < 10; f++) sys.update(f);
    expect(sys.count).toBe(0);
    expect(sys.emitterCount).toBe(0);
  });

  it('follows the entity with an event emitter that says `follow`', () => {
    const sys = new ParticleSystem();
    let box = { x: 0, y: 0, w: 4, h: 4 };
    sys.emit('trail', { rate: 1, duration: 5, life: 1, follow: true }, { x: 2, y: 2 }, 0, 'hero');
    sys.update(0, () => box);
    box = { x: 20, y: 0, w: 4, h: 4 };
    sys.update(1, () => box);
    expect(sys.particles().map((p) => p.x)).toEqual([22]);
  });

  it('clears when the frame number goes back (a new level) and caps a long catch-up', () => {
    const sys = new ParticleSystem();
    sys.emit('p', { burst: 2, life: 1000 }, { x: 0, y: 0 }, 50);
    sys.update(50);
    sys.update(10);
    expect(sys.count).toBe(0);
    sys.emit('r', { rate: 1, duration: 10_000, life: 10_000, max: 10_000 }, { x: 0, y: 0 }, 11);
    sys.update(11);
    sys.update(5000);
    expect(sys.count).toBe(PARTICLE_CATCH_UP + 1);
    expect(() => sys.update(1.5)).toThrow(/whole number/);
  });

  it('draws size, colour and alpha from keyframes over the life', () => {
    const sys = new ParticleSystem();
    sys.emit(
      'k',
      {
        burst: 1,
        life: 5,
        size: [4, 0],
        color: ['#000000', '#ffffff'],
        alpha: [
          { at: 0.5, value: 1 },
          { at: 1, value: 0 },
        ],
      },
      { x: 0, y: 0 },
      0,
    );
    const seen: [number, string, number][] = [];
    for (let f = 0; f < 5; f++) {
      sys.update(f);
      const p = sys.particles()[0]!;
      seen.push([p.size, p.color, p.alpha]);
    }
    expect(seen).toEqual([
      [4, '#000000', 1],
      [3, '#404040', 1],
      [2, '#808080', 1],
      [1, '#bfbfbf', 0.5],
      [0, '#ffffff', 0],
    ]);
  });
});

describe('keyframeAt', () => {
  it('reads one value, evenly spaced lists and stops', () => {
    expect(keyframeAt(3, 0.7, lerp)).toBe(3);
    expect(keyframeAt([0, 10, 20], 0.25, lerp)).toBe(5);
    expect(keyframeAt([0, 10, 20], 1, lerp)).toBe(20);
    expect(keyframeAt([7], 0.5, lerp)).toBe(7);
    const stops = [
      { at: 0.2, value: 1 },
      { at: 0.6, value: 3 },
    ];
    expect(keyframeAt(stops, 0, lerp)).toBe(1);
    expect(keyframeAt(stops, 0.4, lerp)).toBeCloseTo(2);
    expect(keyframeAt(stops, 0.9, lerp)).toBe(3);
    expect(keyframeAt(['#000', '#ffffff'], 0.5, lerpColor)).toBe('#808080');
    expect(keyframeAt([1, 2], -1, lerp)).toBe(1);
    expect(keyframeAt([1, 2], 2, lerp)).toBe(2);
  });
});

describe('anchorPoint', () => {
  it('is the centre, the feet or the top of a box', () => {
    const box = { x: 10, y: 20, w: 8, h: 16 };
    expect(anchorPoint(box, undefined)).toEqual({ x: 14, y: 28 });
    expect(anchorPoint(box, 'feet')).toEqual({ x: 14, y: 36 });
    expect(anchorPoint(box, 'top')).toEqual({ x: 14, y: 20 });
  });
});

describe('emitterSchema', () => {
  it('takes a full emitter and names bad fields', () => {
    expect(emitterSchema.safeParse(SPARKS).success).toBe(true);
    const bad = (v: unknown) => emitterSchema.safeParse(v).error?.issues.map((i) => i.path.join('.'));
    expect(bad({ life: [9, 3] })).toEqual(['life']);
    expect(bad({ color: ['#fff', 'red'] })).toEqual(['color.1']);
    expect(
      bad({
        alpha: [
          { at: 0.8, value: 1 },
          { at: 0.2, value: 0 },
        ],
      }),
    ).toEqual(['alpha']);
    expect(bad({ blend: 'screen' })).toEqual(['blend']);
    expect(bad({ drag: 2 })).toEqual(['drag']);
    expect(bad({ shape: { ring: 3 } })).toEqual(['shape']);
    expect(bad({ sparkle: true })).toEqual(['']);
  });
});
