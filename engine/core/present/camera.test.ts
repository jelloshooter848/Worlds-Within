import { describe, expect, it } from 'vitest';
import {
  cameraArea,
  cameraShake,
  cameraView,
  cameraZoom,
  CameraFollower,
  facingVector,
  zoomAbout,
  type CameraMap,
} from './camera';
import { freezeFrame } from './freeze';
import type { CameraHint, PresentEntity, PresentFrame } from './types';

const SIZE = { width: 100, height: 80 };
/** A 40 x 20 tile map of 16 px tiles: 640 x 320 world pixels. */
const MAP: CameraMap = { id: 'm1', cols: 40, rows: 20, tileSize: 16 };

function ent(id: string, kind: string, x: number, y: number): PresentEntity {
  return { id, kind, x, y, w: 10, h: 20, facing: 'right', anim: { state: 'idle', t: 0 }, tags: [] };
}

function frame(n: number, entities: PresentEntity[], camera?: CameraHint) {
  const f: PresentFrame = { frame: n, size: SIZE, entities, events: [], status: {} };
  if (camera) f.camera = camera;
  return freezeFrame(f);
}

describe('CameraFollower', () => {
  it('follows the hint entity by id (its box centre)', () => {
    const cam = new CameraFollower();
    const f = frame(0, [ent('a', 'hero', 195, 150), ent('b', 'hero', 400, 150)], { x: 0, y: 0, follow: 'a' });
    // Centre (200, 160) minus half the picture (50, 40).
    expect(cam.update(f, undefined, SIZE, MAP)).toEqual({ x: 150, y: 120 });
  });

  it("uses the hint's x/y when the followed entity is absent", () => {
    const cam = new CameraFollower();
    const f = frame(0, [ent('a', 'hero', 195, 150)], { x: 300, y: 100, follow: 'gone' });
    expect(cam.update(f, undefined, SIZE, MAP)).toEqual({ x: 250, y: 60 });
  });

  it("follows the skin's follow by id, else by kind", () => {
    const byId = new CameraFollower();
    const ents = [ent('p', 'hero', 195, 150), ent('q', 'slime', 295, 150)];
    expect(byId.update(frame(0, ents), { follow: 'q' }, SIZE, MAP)).toEqual({ x: 250, y: 120 });
    const byKind = new CameraFollower();
    expect(byKind.update(frame(0, ents), { follow: 'slime' }, SIZE, MAP)).toEqual({ x: 250, y: 120 });
  });

  it('with no target sits at the top-left of the map', () => {
    const cam = new CameraFollower();
    expect(cam.update(frame(0, []), undefined, SIZE, MAP)).toEqual({ x: 0, y: 0 });
  });

  it('does not scroll while the target stays inside the deadzone, then keeps it on the edge', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', deadzone: { w: 20, h: 10 } };
    expect(cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP)).toEqual({ x: 150, y: 120 });
    // 8 px right: still inside the 10 px half-width.
    expect(cam.update(frame(1, [ent('p', 'hero', 203, 150)]), skin, SIZE, MAP)).toEqual({ x: 150, y: 120 });
    // 15 px right: the camera moves 5 px, putting the target on the deadzone's right edge.
    expect(cam.update(frame(2, [ent('p', 'hero', 210, 150)]), skin, SIZE, MAP)).toEqual({ x: 155, y: 120 });
  });

  it('lerps in 1/256 fixed point, at least 1 px a frame, and arrives', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lerp: 0.25 };
    expect(cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP)).toEqual({ x: 150, y: 120 });
    // The target jumps 100 px right: a quarter of the gap (25 px) the first frame.
    const far = [ent('p', 'hero', 295, 150)];
    expect(cam.update(frame(1, far), skin, SIZE, MAP).x).toBe(175);
    // trunc(75 * 64 / 256) = 18.
    expect(cam.update(frame(2, far), skin, SIZE, MAP).x).toBe(193);
    let x = 0;
    let n = 3;
    for (; n < 40; n++) {
      x = cam.update(frame(n, far), skin, SIZE, MAP).x;
      if (x === 250) break;
    }
    expect(x).toBe(250);
    // Small gaps still move 1 px (trunc would give 0), so it got there in a few frames.
    expect(n).toBeLessThan(20);
  });

  it("the hint's lerp and deadzone beat the skin's", () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lerp: 0.25 };
    cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP);
    const hint = { x: 0, y: 0, follow: 'p', lerp: 1 };
    expect(cam.update(frame(1, [ent('p', 'hero', 295, 150)], hint), skin, SIZE, MAP).x).toBe(250);
  });

  it('clamps to the map', () => {
    const cam = new CameraFollower();
    expect(cam.update(frame(0, [ent('p', 'hero', 0, 0)]), { follow: 'hero' }, SIZE, MAP)).toEqual({
      x: 0,
      y: 0,
    });
    const cam2 = new CameraFollower();
    const corner = [ent('p', 'hero', 630, 310)];
    expect(cam2.update(frame(0, corner), { follow: 'hero' }, SIZE, MAP)).toEqual({ x: 540, y: 240 });
  });

  it('frames and clamps the zoomed view (the picture over the zoom, in world pixels)', () => {
    const corner = [ent('p', 'hero', 630, 310)];
    // Zoom 2: a 100 x 80 picture shows 50 x 40 world pixels, clamped inside 640 x 320.
    expect(cameraView(SIZE, 2)).toEqual({ width: 50, height: 40 });
    expect(
      new CameraFollower().update(frame(0, corner), { follow: 'hero' }, cameraView(SIZE, 2), MAP),
    ).toEqual({
      x: 590,
      y: 280,
    });
    // Zoom 0.5: 200 x 160 world pixels.
    expect(
      new CameraFollower().update(frame(0, corner), { follow: 'hero' }, cameraView(SIZE, 0.5), MAP),
    ).toEqual({
      x: 440,
      y: 160,
    });
    // A map smaller than the zoomed-out view is centred in it.
    const small: CameraMap = { id: 's', cols: 5, rows: 5, tileSize: 16 };
    expect(
      new CameraFollower().update(frame(0, corner), { follow: 'hero' }, cameraView(SIZE, 0.5), small),
    ).toEqual({
      x: -60,
      y: -40,
    });
  });

  it('takes the zoom from the hint, else the skin, else 1', () => {
    expect(cameraZoom(frame(0, [], { x: 0, y: 0, zoom: 2 }), { zoom: 0.5 })).toBe(2);
    expect(cameraZoom(frame(0, []), { zoom: 0.5 })).toBe(0.5);
    expect(cameraZoom(frame(0, []), undefined)).toBe(1);
  });

  it("clamps to the hint's bounds instead of the map", () => {
    const cam = new CameraFollower();
    const hint = { x: 0, y: 0, follow: 'p', bounds: { x: 100, y: 50, w: 200, h: 120 } };
    expect(cam.update(frame(0, [ent('p', 'hero', 5, 5)], hint), undefined, SIZE, MAP)).toEqual({
      x: 100,
      y: 50,
    });
  });

  it('does not clamp when clamp is false', () => {
    const cam = new CameraFollower({ clamp: false });
    expect(cam.update(frame(0, [ent('p', 'hero', 5, 0)]), { follow: 'hero' }, SIZE, MAP)).toEqual({
      x: -40,
      y: -30,
    });
  });

  it('centres an area smaller than the picture', () => {
    const cam = new CameraFollower();
    const small: CameraMap = { id: 'tiny', cols: 4, rows: 3, tileSize: 16 }; // 64 x 48
    expect(cam.update(frame(0, [ent('p', 'hero', 50, 30)]), { follow: 'hero' }, SIZE, small)).toEqual({
      x: -18,
      y: -16,
    });
  });

  it('snaps on a new map id instead of lerping', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lerp: 0.25 };
    cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP);
    const far = [ent('p', 'hero', 395, 150)];
    expect(cam.update(frame(1, far), skin, SIZE, MAP).x).toBe(200);
    expect(cam.update(frame(2, far), skin, SIZE, { ...MAP, id: 'm2' }).x).toBe(350);
  });

  it('does not move on a repeated frame number', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lerp: 0.25 };
    cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP);
    const far = [ent('p', 'hero', 295, 150)];
    expect(cam.update(frame(1, far), skin, SIZE, MAP).x).toBe(175);
    expect(cam.update(frame(1, far), skin, SIZE, MAP).x).toBe(175);
    expect(cam.update(frame(2, far), skin, SIZE, MAP).x).toBe(193);
  });

  it('reset makes the next frame snap', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lerp: 0.25 };
    cam.update(frame(0, [ent('p', 'hero', 195, 150)]), skin, SIZE, MAP);
    cam.reset();
    expect(cam.update(frame(1, [ent('p', 'hero', 295, 150)]), skin, SIZE, MAP).x).toBe(250);
  });
});

describe('cameraShake', () => {
  it('adds the hint and extra strengths, alternating sides by frame, and is 0 with none', () => {
    expect(cameraShake(frame(0, []))).toBe(0);
    expect(cameraShake(frame(2, [], { x: 0, y: 0, shake: 1.6 }), [2])).toBe(4);
    expect(cameraShake(frame(3, [], { x: 0, y: 0, shake: 1 }))).toBe(-1);
    expect(cameraShake(frame(3, []), [2, 1])).toBe(-3);
  });
});

describe('look-ahead and zoom punches (Engine 0.16 T4)', () => {
  const facing = (e: PresentEntity, f: PresentEntity['facing']): PresentEntity => ({ ...e, facing: f });

  it('frames a followed entity ahead in its facing, gliding to a new facing at the lerp', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lookAhead: { x: 24, lerp: 0.25 } };
    const hero = ent('p', 'hero', 195, 150);
    // The first frame snaps to the point 24 px ahead (right): centre 200 + 24 - 50.
    expect(cam.update(frame(0, [hero]), skin, SIZE, MAP)).toEqual({ x: 174, y: 120 });
    expect(cam.lookAhead).toEqual({ x: 24, y: 0 });
    // Turning left: the look-ahead closes a quarter of its gap a frame (truncated: 12, 9, 6, 5).
    const xs: number[] = [];
    for (let n = 1; n <= 4; n++) xs.push(cam.update(frame(n, [facing(hero, 'left')]), skin, SIZE, MAP).x);
    expect(xs).toEqual([162, 153, 147, 142]);
    for (let n = 5; n < 60; n++) cam.update(frame(n, [facing(hero, 'left')]), skin, SIZE, MAP);
    expect(cam.lookAhead).toEqual({ x: -24, y: 0 });
    expect(cam.update(frame(60, [facing(hero, 'left')]), skin, SIZE, MAP)).toEqual({ x: 126, y: 120 });
  });

  it('looks ahead vertically for up and down facings, and the vertical deadzone holds the camera', () => {
    const cam = new CameraFollower();
    const skin = { follow: 'hero', lookAhead: { x: 10, y: 8, lerp: 1 }, deadzone: { w: 0, h: 20 } };
    expect(cam.update(frame(0, [facing(ent('p', 'hero', 195, 150), 'down-left')]), skin, SIZE, MAP)).toEqual({
      x: 140,
      y: 128,
    });
    // Moving 9 px down keeps the point ahead inside the 20 px tall deadzone: no vertical scroll.
    expect(cam.update(frame(1, [facing(ent('p', 'hero', 195, 159), 'down-left')]), skin, SIZE, MAP).y).toBe(
      128,
    );
    // 15 px down: out by 5, so the camera moves 5.
    expect(cam.update(frame(2, [facing(ent('p', 'hero', 195, 165), 'down-left')]), skin, SIZE, MAP).y).toBe(
      133,
    );
  });

  it('needs a followed entity: a hint x/y, or no look-ahead in the skin, frames as before', () => {
    const cam = new CameraFollower();
    const f = frame(0, [ent('p', 'hero', 195, 150)], { x: 300, y: 100 });
    expect(cam.update(f, { lookAhead: { x: 30 } }, SIZE, MAP)).toEqual({ x: 250, y: 60 });
    expect(cam.lookAhead).toEqual({ x: 0, y: 0 });
  });

  it('facingVector gives each facing as a direction', () => {
    expect(facingVector('left')).toEqual({ x: -1, y: 0 });
    expect(facingVector('right')).toEqual({ x: 1, y: 0 });
    expect(facingVector('up')).toEqual({ x: 0, y: -1 });
    expect(facingVector('down-right')).toEqual({ x: 1, y: 1 });
    expect(facingVector('up-left')).toEqual({ x: -1, y: -1 });
  });

  it('zoomAbout zooms about the view centre and keeps a punch out inside the area', () => {
    const view = { width: 100, height: 80 };
    expect(zoomAbout({ x: 150, y: 120 }, view, 2, null)).toEqual({
      cam: { x: 175, y: 140 },
      view: { width: 50, height: 40 },
    });
    expect(zoomAbout({ x: 150, y: 120 }, view, 1, null).cam).toEqual({ x: 150, y: 120 });
    // Out to 0.5 at the map's top-left corner: 200 x 160 clamped inside the 640 x 320 map.
    const area = cameraArea(frame(0, []), MAP);
    expect(area).toEqual({ x: 0, y: 0, w: 640, h: 320 });
    expect(zoomAbout({ x: 0, y: 0 }, view, 0.5, area)).toEqual({
      cam: { x: 0, y: 0 },
      view: { width: 200, height: 160 },
    });
    expect(cameraArea(frame(0, []), MAP, false)).toBeNull();
    // About a focus a quarter in from the left and top: that point stays put on the picture.
    const punched = zoomAbout({ x: 100, y: 100 }, view, 2, null, { x: 125, y: 120 });
    expect(punched.cam).toEqual({ x: 112.5, y: 110 });
    expect((125 - punched.cam.x) / punched.view.width).toBe((125 - 100) / view.width);
    // A focus outside the view is held at its edge.
    expect(zoomAbout({ x: 100, y: 100 }, view, 2, null, { x: 500, y: 0 }).cam).toEqual({ x: 150, y: 100 });
  });
});
