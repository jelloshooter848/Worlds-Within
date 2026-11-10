import { describe, expect, it } from 'vitest';
import {
  clampGroundCentre,
  GROUND_REACH,
  groundFacingTurn,
  groundProjection,
  inScreenBox,
  pointsBox,
} from './ground';
import { facingVector } from './camera';
import { resolveCamera3d, skinGroundCamera, skinSchema, type SkinFile } from './skin';

const SIZE = { width: 320, height: 240 };
const CAM = { pitch: 55, yaw: 0, fov: 45 };

describe('groundProjection', () => {
  it('puts the centre at the picture centre, and straight down at zoom z shows z picture px per world px', () => {
    const top = groundProjection(SIZE, 2, { x: 100, y: 50 }, { ...CAM, pitch: 90 });
    const c = top.worldToScreen(100, 50)!;
    expect(c.x).toBeCloseTo(160, 9);
    expect(c.y).toBeCloseTo(120, 9);
    const east = top.worldToScreen(110, 50)!;
    expect(east.x - c.x).toBeCloseTo(20, 9);
    const south = top.worldToScreen(100, 60)!;
    expect(south.y - c.y).toBeCloseTo(20, 9);
    expect(top.distance).toBeCloseTo(top.focal / 2, 9);
  });

  it('round-trips picture points through the ground at any pitch, yaw and zoom', () => {
    for (const pitch of [20, 55, 90]) {
      for (const yaw of [-135, 0, 30, 90]) {
        for (const zoom of [0.5, 1, 2]) {
          const g = groundProjection(SIZE, zoom, { x: 300, y: 200 }, { pitch, yaw, fov: 40 });
          for (const [sx, sy] of [
            [160, 120],
            [10, 230],
            [300, 200],
            [200, 100],
          ] as const) {
            const w = g.screenToGround(sx, sy);
            if (w === null) continue;
            const back = g.worldToScreen(w.x, w.y)!;
            expect(back.x).toBeCloseTo(sx, 6);
            expect(back.y).toBeCloseTo(sy, 6);
          }
          const p = g.worldToScreen(320, 190, 12);
          if (p) {
            const w = g.screenToGround(p.x, p.y, 12)!;
            expect(w.x).toBeCloseTo(320, 6);
            expect(w.y).toBeCloseTo(190, 6);
          }
        }
      }
    }
  });

  it('looks north at yaw 0 (far is up the picture) and west at yaw 90', () => {
    const north = groundProjection(SIZE, 1, { x: 0, y: 0 }, CAM);
    expect(north.worldToScreen(0, -50)!.y).toBeLessThan(120);
    expect(north.worldToScreen(0, 50)!.y).toBeGreaterThan(120);
    expect(north.worldToScreen(50, 0)!.x).toBeGreaterThan(160);
    const west = groundProjection(SIZE, 1, { x: 0, y: 0 }, { ...CAM, yaw: 90 });
    expect(west.eye.x).toBeGreaterThan(0);
    expect(west.worldToScreen(-50, 0)!.y).toBeLessThan(120);
    // From the east looking west, north is on the right.
    expect(west.worldToScreen(0, -50)!.x).toBeGreaterThan(160);
  });

  it('a raised point draws higher than the ground under it; behind the camera is null', () => {
    const g = groundProjection(SIZE, 1, { x: 0, y: 0 }, CAM);
    expect(g.worldToScreen(0, 0, 20)!.y).toBeLessThan(g.worldToScreen(0, 0)!.y);
    expect(g.worldToScreen(g.eye.x, g.eye.y + 1000)).toBeNull();
  });

  it('a ray over the horizon misses the ground; groundAt lands it at the reach', () => {
    const g = groundProjection(SIZE, 1, { x: 0, y: 0 }, { pitch: 10, yaw: 0, fov: 60 });
    expect(g.screenToGround(160, 0)).toBeNull();
    const far = g.groundAt(160, 0);
    expect(Math.hypot(far.x - g.eye.x, far.y - g.eye.y)).toBeCloseTo(g.distance * GROUND_REACH, 6);
    expect(far.y).toBeLessThan(g.eye.y);
    expect(g.footprint()).toHaveLength(4);
  });
});

describe('clampGroundCentre', () => {
  const area = { x: 0, y: 0, w: 2048, h: 2048 };
  it('keeps the footprint inside the area, and centres it on an axis where it is wider', () => {
    const at = clampGroundCentre(SIZE, 1, { x: -500, y: 5000 }, CAM, area);
    const box = pointsBox(groundProjection(SIZE, 1, at, CAM).footprint());
    expect(box.x).toBeCloseTo(0, 6);
    expect(box.y + box.h).toBeCloseTo(2048, 6);
    expect(clampGroundCentre(SIZE, 1, { x: 900, y: 900 }, CAM, area)).toEqual({ x: 900, y: 900 });
    const small = { x: 0, y: 0, w: 64, h: 64 };
    const c = clampGroundCentre(SIZE, 1, { x: 0, y: 0 }, CAM, small);
    const b = pointsBox(groundProjection(SIZE, 1, c, CAM).footprint());
    expect(b.x + b.w / 2).toBeCloseTo(32, 6);
    expect(b.y + b.h / 2).toBeCloseTo(32, 6);
  });
});

describe('ground helpers', () => {
  it('inScreenBox takes any corners', () => {
    expect(inScreenBox({ x: 10, y: 10, w: -5, h: -5 }, { x: 7, y: 7 })).toBe(true);
    expect(inScreenBox({ x: 10, y: 10, w: 5, h: 5 }, { x: 7, y: 7 })).toBe(false);
  });

  it('turns a facing about the vertical: down 0, right a quarter, up a half, left minus a quarter', () => {
    const turn = (f: Parameters<typeof facingVector>[0]) => groundFacingTurn(facingVector(f));
    expect(turn('down')).toBe(0);
    expect(turn('right')).toBeCloseTo(Math.PI / 2, 12);
    expect(turn('up')).toBeCloseTo(Math.PI, 12);
    expect(turn('left')).toBeCloseTo(-Math.PI / 2, 12);
    expect(turn('down-right')).toBeCloseTo(Math.PI / 4, 12);
  });

  it('a skin opts in with camera3d.view ground; a skin without it stays side-on', () => {
    const side: SkinFile = { backend: 'three', kinds: {} };
    expect(resolveCamera3d(side).view).toBe('side');
    expect(skinGroundCamera(side)).toBeNull();
    const ground = skinSchema.parse({
      backend: 'three',
      kinds: {},
      camera3d: { view: 'ground', pitch: 60, yaw: 30, fov: 35 },
    });
    expect(skinGroundCamera(ground)).toEqual({ pitch: 60, yaw: 30, fov: 35 });
    expect(skinGroundCamera({ ...side, camera3d: { view: 'ground' } })).toEqual({
      pitch: 55,
      yaw: 0,
      fov: 45,
    });
    expect(skinSchema.safeParse({ backend: 'three', kinds: {}, camera3d: { pitch: 5 } }).success).toBe(false);
  });
});
