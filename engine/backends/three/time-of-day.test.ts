import { describe, expect, it } from 'vitest';
import type { Color, Fog } from 'three';
import { HemisphereLight } from 'three';
import { clockStatus, worldClock } from '@engine/core/clock';
import { freezeFrame, skinSchema, type PresentFrame, type SkinFile } from '@engine/core/present';
import { ThreeScene } from './scene';

// Engine 0.16 F4: a skin's `scene3d.timeOfDay` moves the sun, ambient, hemisphere, fog, sky and
// exposure with the frame's world clock, and a jump in world time eases over the skin's tween.

const BASE: SkinFile = {
  backend: 'three',
  background: '#a4e4fc',
  kinds: { hero: { mesh: 'box', color: '#d82800' } },
  camera3d: { fov: 40, tilt: 0, layerDepth: 16, lights: { ambient: 0.5, directional: 0.9 } },
  scene3d: {
    sun: { color: '#ffffff', intensity: 1.5, direction: { x: 0, y: 3, z: 1 } },
    ambient: { color: '#ffffff', intensity: 0.4 },
    fog: { kind: 'linear', color: '#a4e4fc', near: 40, far: 600 },
    toneMapping: { kind: 'aces', exposure: 1.2 },
  },
};

const DAY: SkinFile = {
  ...BASE,
  scene3d: {
    ...BASE.scene3d,
    timeOfDay: {
      tween: 10,
      ease: 'linear',
      keys: [
        {
          hour: 6,
          sun: { color: '#ff8040', intensity: 0.6, direction: { x: -4, y: 1, z: 1 } },
          hemisphere: { sky: '#f0b890', ground: '#403020', intensity: 0.3 },
          fog: { color: '#f0b890' },
          background: '#f0b890',
        },
        {
          hour: 12,
          sun: { intensity: 1.8 },
          hemisphere: { sky: '#a4e4fc', ground: '#504020', intensity: 0.6 },
        },
        {
          hour: 20,
          sun: { color: '#4060a0', intensity: 0.2, direction: { x: 4, y: 1, z: 1 } },
          ambient: { color: '#6070a0', intensity: 0.15 },
          hemisphere: { sky: '#203050', ground: '#101010', intensity: 0.2 },
          fog: { color: '#182030', near: 20, far: 300 },
          background: '#101828',
          exposure: 0.8,
        },
      ],
    },
  },
};

const frame = (status: PresentFrame['status'], n = 0) =>
  freezeFrame<PresentFrame>({
    frame: n,
    size: { width: 128, height: 64 },
    entities: [],
    events: [],
    status,
    camera: { x: 0, y: 0 },
  });

const at = (day: number, hour: number, minute = 0) => clockStatus(worldClock({ day, hour, minute }, 0));

const hex = (c: Color) => `#${c.getHexString()}`;

const looks = (scene: ThreeScene) => ({
  sun: [hex(scene.sun.color), scene.sun.intensity],
  ambient: [hex(scene.ambient.color), scene.ambient.intensity],
  hemisphere: [hex(scene.hemisphere!.color), hex(scene.hemisphere!.groundColor), scene.hemisphere!.intensity],
  fog: hex((scene.scene.fog as Fog).color),
  sky: hex(scene.scene.background as Color),
  exposure: scene.exposure,
});

describe('the time of day in the 3D scene (Engine 0.16 F4)', () => {
  it('the skin validates', () => {
    expect(skinSchema.safeParse(DAY).success).toBe(true);
  });

  it('a skin without timeOfDay looks as before, clock or not', () => {
    const plain = new ThreeScene(BASE);
    plain.sync(frame({}));
    const before = {
      sun: [hex(plain.sun.color), plain.sun.intensity],
      sky: hex(plain.scene.background as Color),
    };
    plain.sync(frame(at(2, 20), 1));
    expect({
      sun: [hex(plain.sun.color), plain.sun.intensity],
      sky: hex(plain.scene.background as Color),
    }).toEqual(before);
    expect(plain.hemisphere).toBeNull();
    expect(plain.exposure).toBe(1.2);
    expect(plain.dayHour).toBeNull();
  });

  it("shows the skin's own look on frames without a clock", () => {
    const scene = new ThreeScene(DAY);
    scene.sync(frame({ hp: 3 }));
    expect(scene.dayHour).toBeNull();
    // The hemisphere light the keys bring in is there at strength 0.
    expect(scene.hemisphere).toBeInstanceOf(HemisphereLight);
    expect(looks(scene)).toEqual({
      sun: ['#ffffff', 1.5],
      ambient: ['#ffffff', 0.4],
      hemisphere: ['#ffffff', '#ffffff', 0],
      fog: '#a4e4fc',
      sky: '#a4e4fc',
      exposure: 1.2,
    });
  });

  it('changes the sun, ambient, hemisphere, fog, sky and exposure with the clock', () => {
    const scene = new ThreeScene(DAY);
    scene.sync(frame(at(2, 6)));
    const dawn = looks(scene);
    expect(dawn.sun).toEqual(['#ff8040', 0.6]);
    expect(dawn.sky).toBe('#f0b890');
    expect(dawn.fog).toBe('#f0b890');
    expect(scene.sun.position.clone().normalize().x).toBeLessThan(0);

    const night = new ThreeScene(DAY);
    night.sync(frame(at(2, 20)));
    expect(looks(night)).toEqual({
      sun: ['#4060a0', 0.2],
      ambient: ['#6070a0', 0.15],
      hemisphere: ['#203050', '#101010', 0.2],
      fog: '#182030',
      sky: '#101828',
      exposure: 0.8,
    });
    expect(night.sun.position.clone().normalize().x).toBeGreaterThan(0);
    expect(night.dayLook.fog).toMatchObject({ near: 20, far: 300 });

    // In between: half way from noon to 20:00.
    const four = new ThreeScene(DAY);
    four.sync(frame(at(2, 16)));
    expect(four.sun.intensity).toBeCloseTo(1);
    expect(four.exposure).toBeCloseTo(1);
  });

  it('follows a steady clock and eases a jump in world time over the tween', () => {
    const scene = new ThreeScene(DAY);
    const start = worldClock({ day: 2, hour: 12 }, 0);
    scene.sync(frame(clockStatus(start)));
    expect(scene.dayHour).toBeCloseTo(36);
    scene.sync(frame(clockStatus(worldClock({ day: 2, hour: 12 }, 1)), 1));
    expect(scene.dayHour).toBeCloseTo(36 + 1 / 60);
    // A mission's commit: 120 ticks (two hours) at once.
    const later = clockStatus(worldClock({ day: 2, hour: 12 }, 121));
    const shown: number[] = [];
    const sun: number[] = [];
    for (let n = 0; n < 10; n++) {
      scene.sync(frame(later, 2 + n));
      shown.push(scene.dayHour!);
      sun.push(scene.sun.intensity);
    }
    expect(shown[0]).toBeGreaterThan(36);
    expect(shown[0]).toBeLessThan(38);
    for (let i = 1; i < shown.length; i++) expect(shown[i]).toBeGreaterThan(shown[i - 1]!);
    expect(shown[9]).toBeCloseTo(38 + 1 / 60);
    for (let i = 1; i < sun.length; i++) expect(sun[i]).toBeLessThan(sun[i - 1]!);
  });

  it('draws the same for the same frames (deterministic)', () => {
    const run = () => {
      const scene = new ThreeScene(DAY);
      const out: unknown[] = [];
      for (const tick of [0, 1, 2, 122, 122, 122, 123]) {
        scene.sync(frame(clockStatus(worldClock({ day: 1, hour: 17 }, tick)), tick));
        out.push(looks(scene));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
