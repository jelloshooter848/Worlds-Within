import { describe, expect, it } from 'vitest';
import {
  Matrix4,
  Vector3,
  type BufferGeometry,
  type Fog,
  type InstancedMesh,
  type Mesh,
  type Points,
} from 'three';
import {
  freezeFrame,
  groundFacingTurn,
  facingVector,
  RtsCamera,
  skinGroundCamera,
  skinSchema,
  type Facing,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
} from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { GROUND_LAYER_LIFT, GROUND_PARTICLE_HEIGHT, ThreeScene } from './scene';

// Engine 0.16 F2: the ground view (`camera3d.view: "ground"`): the map on the floor, entities
// upright and turned to their facing, and one camera shared with RtsCamera's picking.

const SKIN: SkinFile = {
  backend: 'three',
  meshes: {
    soldier: [
      { shape: 'box', size: { w: 8, h: 6, d: 10 }, at: { x: 4, y: 5, z: 0 } },
      { shape: 'sphere', size: { w: 6, h: 6, d: 6 }, at: { x: 5, y: 5, z: 10 }, color: '#fcbcb0' },
    ],
  },
  kinds: {
    soldier: { mesh: 'soldier', color: '#d82800', castShadow: true },
    mark: { mesh: 'plane', color: '#fcfc00' },
  },
  tiles: {
    '.': { mesh: 'box', color: '#00a800', depth: 2, receiveShadow: true },
    '~': { mesh: 'plane', color: '#3cbcfc' },
  },
  events: { burst: { effect: { kind: 'particles', color: '#f8d800', count: 4, size: 2, ticks: 3 } } },
  scene3d: {
    sun: { direction: { x: -2, y: 3, z: 2 }, shadow: { mapSize: 512 } },
    fog: { kind: 'linear', color: '#a4e4fc', near: 40, far: 600 },
  },
  labels: { soldier: { from: { tag: 'name:' }, as: 'text', font: 'f', color: '#fcfcfc' } },
  camera3d: { fov: 40, view: 'ground', pitch: 55, yaw: 20 },
};

const FONT = buildFont('f', {
  cell: { w: 2, h: 3 },
  baseline: 3,
  glyphs: Object.fromEntries([...'Ada'].map((c) => [c, { rows: ['##', '##', '##'] }])),
});
const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);

const MAP: PresentMap = {
  id: 'field',
  version: 0,
  tileSize: 16,
  cols: 16,
  rows: 12,
  tiles: Array.from({ length: 12 }, (_, r) => (r === 0 ? '~' + '.'.repeat(15) : '.'.repeat(16))),
};
const AREA = { x: 0, y: 0, w: 256, h: 192 };
const SIZE = { width: 160, height: 120 };

const soldier = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  id: 's1',
  kind: 'soldier',
  x: 96,
  y: 80,
  w: 16,
  h: 16,
  facing: 'down',
  anim: { state: 'idle', t: 0 },
  tags: ['name:Ada'],
  ...over,
});

function setup(over: { yaw?: number; zoom?: number } = {}) {
  const skin: SkinFile = { ...SKIN, camera3d: { ...SKIN.camera3d, yaw: over.yaw ?? 20 } };
  const camera = new RtsCamera({
    view: SIZE,
    area: AREA,
    zoom: over.zoom ?? 1,
    centre: { x: 104, y: 88 },
    ground: skinGroundCamera(skin),
  });
  const scene = new ThreeScene(skin, { size: SIZE, fonts });
  const frame = (f: Partial<PresentFrame> = {}): PresentFrame => ({
    frame: 0,
    size: SIZE,
    entities: [soldier()],
    map: MAP,
    events: [],
    status: {},
    camera: camera.hint(),
    ...f,
  });
  return { skin, camera, scene, frame };
}

/** Picture px of a Three point through the scene's camera. */
function drawnAt(scene: ThreeScene, x: number, h: number, y: number): { x: number; y: number } {
  const p = new Vector3(x, h, y).project(scene.camera);
  return { x: ((p.x + 1) / 2) * SIZE.width, y: ((1 - p.y) / 2) * SIZE.height };
}

describe('ThreeScene ground view (Engine 0.16 F2)', () => {
  it('the fixture skin validates', () => {
    expect(skinSchema.safeParse(SKIN).success).toBe(true);
  });

  it('lays the map on the floor: a box tile d high, a plane flat', () => {
    const { scene, frame } = setup();
    scene.sync(freezeFrame(frame()));
    const grass = scene.map!.getObjectByName('tile:.:0') as InstancedMesh;
    const m = new Matrix4();
    grass.getMatrixAt(0, m);
    // Row 0's first grass cell is column 1: centre (24, 1, 8).
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([24, 1, 8]);
    grass.geometry.computeBoundingBox();
    const b = grass.geometry.boundingBox!;
    expect([b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z]).toEqual([16, 2, 16]);
    const water = scene.map!.getObjectByName('tile:~:0') as InstancedMesh;
    water.getMatrixAt(0, m);
    const normal = new Vector3(0, 0, 1).transformDirection(m);
    expect(normal.y).toBeCloseTo(1, 9);
    expect(new Vector3().setFromMatrixPosition(m).toArray()).toEqual([8, 0, 8]);
  });

  it('stands entities on the box centre, parts upright with z as height, a layer lifting it a hair', () => {
    const { scene, frame } = setup();
    scene.sync(freezeFrame(frame({ entities: [soldier({ layer: 2 })] })));
    const root = scene.entity('s1')!;
    expect(root.position.toArray()).toEqual([104, 2 * GROUND_LAYER_LIFT, 88]);
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    const [body, head] = root.children as Mesh<BufferGeometry>[];
    // The body: footprint 8 x 6 from (4, 5) on the 16 x 16 box, 10 high from the ground.
    expect(body!.position.toArray()).toEqual([0, 5, 0]);
    body!.geometry.computeBoundingBox();
    const bb = body!.geometry.boundingBox!;
    expect([bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z]).toEqual([8, 10, 6]);
    expect(head!.position.toArray()).toEqual([0, 13, 0]);
    // A flat mark lies on the floor.
    scene.sync(freezeFrame(frame({ frame: 1, entities: [soldier({ id: 'm', kind: 'mark', tags: [] })] })));
    const mark = scene.entity('m')!.children[0] as Mesh;
    expect(new Vector3(0, 0, 1).applyEuler(mark.rotation).y).toBeCloseTo(1, 9);
  });

  it('turns an entity to its facing about the vertical instead of mirroring', () => {
    const { scene, frame } = setup();
    const facings: Facing[] = ['down', 'right', 'up', 'left', 'up-left', 'down-right'];
    facings.forEach((facing, i) => {
      scene.sync(freezeFrame(frame({ frame: i, entities: [soldier({ facing })] })));
      const root = scene.entity('s1')!;
      expect(root.scale.x).toBe(1);
      expect(root.rotation.y).toBeCloseTo(groundFacingTurn(facingVector(facing)), 12);
      // The model's front (+z) points along the facing on the map.
      const front = new Vector3(0, 0, 1).applyEuler(root.rotation);
      const want = facingVector(facing);
      const len = Math.hypot(want.x, want.y);
      expect(front.x).toBeCloseTo(want.x / len, 9);
      expect(front.z).toBeCloseTo(want.y / len, 9);
    });
  });

  it("projects points exactly as RtsCamera's shared ground projection (within 0.5 px)", () => {
    for (const yaw of [0, 20, -120]) {
      for (const zoom of [0.75, 1, 2]) {
        const { camera, scene, frame } = setup({ yaw, zoom });
        camera.panBy(13, -7);
        scene.sync(freezeFrame(frame()));
        expect(scene.groundProjection!.centre).toEqual(camera.centre());
        for (const [x, y, h] of [
          [104, 88, 0],
          [60, 40, 0],
          [150, 120, 12],
          [96, 100, 30],
        ] as const) {
          const core = camera.worldToScreen(x, y, h);
          const drawn = drawnAt(scene, x, h, y);
          expect(Math.abs(drawn.x - core.x)).toBeLessThan(0.5);
          expect(Math.abs(drawn.y - core.y)).toBeLessThan(0.5);
        }
        // And a picture point picks the ground point the scene draws there.
        const w = camera.screenToWorld(40, 90);
        const back = drawnAt(scene, w.x, 0, w.y);
        expect(Math.abs(back.x - 40)).toBeLessThan(0.5);
        expect(Math.abs(back.y - 90)).toBeLessThan(0.5);
      }
    }
  });

  it("anchors labels over the entity's meshes through the camera", () => {
    const { scene, frame } = setup();
    scene.sync(freezeFrame(frame()));
    const [view] = scene.labelViews();
    expect(view).toBeDefined();
    // The soldier's meshes reach 16 px up (the head's top); the label sits over that point.
    const head = drawnAt(scene, 104, 16, 88);
    expect(view!.box.x + view!.box.w / 2).toBeCloseTo(head.x, 0);
    expect(view!.box.y + view!.box.h).toBeLessThanOrEqual(head.y + 0.5);
    expect(view!.box.y + view!.box.h).toBeGreaterThan(head.y - 12);
  });

  it('flies particles over the ground at their world x, y', () => {
    const { scene, frame } = setup();
    scene.sync(freezeFrame(frame({ events: [{ type: 'burst', x: 100, y: 90 }] })));
    const points = scene.particles.getObjectByName('particles:normal') as Points<BufferGeometry>;
    const pos = points.geometry.attributes['position']!;
    expect(points.geometry.drawRange.count).toBe(4);
    expect([pos.getX(0), pos.getY(0), pos.getZ(0)]).toEqual([100, GROUND_PARTICLE_HEIGHT, 90]);
  });

  it("fits the sun's shadow camera to the picture's ground footprint, and measures fog from the camera", () => {
    const { scene, frame } = setup();
    scene.sync(freezeFrame(frame()));
    const g = scene.groundProjection!;
    const shadow = scene.sun.shadow.camera;
    // The renderer places the shadow camera on the light each frame; do what it does.
    scene.sun.shadow.updateMatrices(scene.sun);
    for (const corner of g.footprint()) {
      const p = new Vector3(corner.x, 0, corner.y).applyMatrix4(shadow.matrixWorldInverse);
      expect(p.x).toBeGreaterThanOrEqual(shadow.left);
      expect(p.x).toBeLessThanOrEqual(shadow.right);
      expect(p.y).toBeGreaterThanOrEqual(shadow.bottom);
      expect(p.y).toBeLessThanOrEqual(shadow.top);
      expect(-p.z).toBeGreaterThan(shadow.near);
      expect(-p.z).toBeLessThan(shadow.far);
    }
    const fog = scene.scene.fog as Fog;
    expect(fog.near).toBeCloseTo(g.distance + 40, 9);
    expect(fog.far).toBeCloseTo(g.distance + 600, 9);
  });

  it('camera shake moves the picture but not the reported projection', () => {
    const { camera, scene, frame } = setup();
    scene.sync(freezeFrame(frame({ camera: { ...camera.hint(), shake: 3 } })));
    const still = camera.worldToScreen(104, 88);
    const drawn = drawnAt(scene, 104, 0, 88);
    expect(scene.groundProjection!.centre).toEqual(camera.centre());
    expect(Math.abs(drawn.x - still.x)).toBeGreaterThan(1);
  });
});
