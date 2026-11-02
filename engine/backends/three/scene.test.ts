import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BoxGeometry, InstancedMesh, Matrix4, Mesh, Vector3, type MeshLambertMaterial } from 'three';
import {
  CameraFollower,
  DEFAULT_FALLBACK_COLOR,
  freezeFrame,
  skinSchema,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
} from '@engine/core/present';
import { ThreeScene } from './scene';

/** A fixture `three` skin (inline: backends never import kits or games). */
const SKIN: SkinFile = {
  backend: 'three',
  meshes: {
    hero: [
      { shape: 'box', size: { w: 16, h: 10, d: 8 }, at: { x: 0, y: 6, z: 0 } },
      { shape: 'sphere', size: { w: 8, h: 6, d: 8 }, at: { x: 8, y: 0, z: 2 }, color: '#fcbcb0' },
    ],
  },
  kinds: {
    hero: { mesh: 'hero', color: '#d82800' },
    coin: { mesh: 'cylinder', color: '#fcfc00', depth: 4 },
  },
  tiles: {
    '#': { mesh: 'box', color: '#c84c0c' },
    '/': { mesh: 'wedge', color: '#00a800', depth: 8 },
    '~': { mesh: 'plane', color: '#3cbcfc' },
  },
  events: {
    jumped: { sound: 'jump' },
    hit: { sound: 'hurt', effect: { kind: 'flash', color: '#fcfcfc', ticks: 2 } },
    bump: { effect: { kind: 'shake', size: 3, ticks: 4 } },
  },
  camera: { follow: 'hero' },
  camera3d: { fov: 40, tilt: 0, layerDepth: 16, lights: { ambient: 0.5, directional: 0.9 } },
};

const MAP: PresentMap = {
  id: 'level',
  version: 0,
  tileSize: 16,
  cols: 4,
  rows: 3,
  tiles: ['....', '.#/.', '####'],
  layers: [{ name: 'back', tiles: ['~...', '....', '....'] }],
};

type EntityIn = PresentEntity;

const hero = (over: Partial<EntityIn> = {}): EntityIn => ({
  id: 'p1',
  kind: 'hero',
  x: 16,
  y: 8,
  w: 16,
  h: 16,
  facing: 'right',
  anim: { state: 'idle', t: 0 },
  tags: [],
  ...over,
});

/** A frame on the fixture map; `noMap` leaves the map out. */
function frame(over: Partial<PresentFrame> & { noMap?: boolean } = {}): PresentFrame {
  const { noMap, ...rest } = over;
  const f: PresentFrame = {
    frame: 0,
    size: { width: 64, height: 48 },
    entities: [],
    map: MAP,
    events: [],
    status: {},
    ...rest,
  };
  if (noMap) delete f.map;
  return f;
}

const ref = (version = 0) => ({ id: MAP.id, version });

/** The world-space centres of an instanced mesh's blocks. */
function blockCentres(mesh: InstancedMesh): [number, number, number][] {
  const m = new Matrix4();
  const v = new Vector3();
  const out: [number, number, number][] = [];
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    v.setFromMatrixPosition(m);
    out.push([v.x, v.y, v.z]);
  }
  return out;
}

function tileMeshes(s: ThreeScene): InstancedMesh[] {
  return (s.map?.children ?? []).filter((c): c is InstancedMesh => c instanceof InstancedMesh);
}

function meshesOf(s: ThreeScene, id: string): Mesh[] {
  return (s.entity(id)?.children ?? []).filter((c): c is Mesh => c instanceof Mesh);
}

function colorOf(mesh: Mesh): string {
  return `#${(mesh.material as MeshLambertMaterial).color.getHexString()}`;
}

describe('ThreeScene: the fixture skin', () => {
  it('is a valid three skin', () => {
    expect(skinSchema.safeParse(SKIN).success).toBe(true);
  });
});

describe('ThreeScene: map', () => {
  it('turns listed tiles into blocks, one InstancedMesh per tile key and part, and leaves the rest empty', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame());
    const meshes = tileMeshes(s);
    const byTile = Object.fromEntries(meshes.map((m) => [m.userData.tile as string, m]));
    expect(Object.keys(byTile).sort()).toEqual(['#', '/', '~']);
    expect(byTile['#']!.count).toBe(5);
    expect(byTile['/']!.count).toBe(1);
    // Tile (1,1) is a 16 px cube: centre x 24, y -(16 + 8), z 0.
    expect(blockCentres(byTile['#']!)).toContainEqual([24, -24, 0]);
    expect(blockCentres(byTile['#']!)).toContainEqual([56, -40, 0]);
    expect(blockCentres(byTile['/']!)).toEqual([[40, -24, 0]]);
    expect(byTile['#']!.geometry.type).toBe('BoxGeometry');
    expect(byTile['/']!.geometry.type).toBe('ExtrudeGeometry');
  });

  it('places map layers behind the main tiles, at their own depth', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame());
    const back = tileMeshes(s).find((m) => m.userData.layer === 'back')!;
    expect(back.userData.tile).toBe('~');
    expect(blockCentres(back)).toEqual([[8, -8, -16]]);
  });

  it('builds the map once per id and version and reuses it for refs', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame());
    const first = s.map;
    s.sync(frame({ frame: 1, map: ref() }));
    s.sync(frame({ frame: 2, map: ref() }));
    expect(s.mapBuilds).toBe(1);
    expect(s.map).toBe(first);

    const changed: PresentMap = { ...MAP, version: 1, tiles: ['....', '....', '####'] };
    s.sync(frame({ frame: 3, map: changed }));
    expect(s.mapBuilds).toBe(2);
    expect(s.map).not.toBe(first);
    expect(s.scene.children).not.toContain(first);
    expect(tileMeshes(s).find((m) => m.userData.tile === '#')!.count).toBe(4);

    s.sync(frame({ frame: 4, map: { ...MAP, id: 'other' } }));
    expect(s.mapBuilds).toBe(3);
  });

  it('hides the map on a frame with none, and shows nothing for a ref to a map never sent', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame());
    s.sync(frame({ frame: 1, noMap: true }));
    expect(s.map?.visible).toBe(false);
    s.sync(frame({ frame: 2, map: ref() }));
    expect(s.map?.visible).toBe(true);
    expect(s.mapBuilds).toBe(1);

    const fresh = new ThreeScene(SKIN);
    fresh.sync(frame({ map: ref() }));
    expect(fresh.map).toBeNull();
    expect(fresh.mapBuilds).toBe(0);
  });
});

describe('ThreeScene: entities', () => {
  it('adds, moves and removes entities by id', () => {
    const s = new ThreeScene(SKIN);
    const coin = hero({ id: 'c1', kind: 'coin', x: 40, y: 0, w: 8, h: 8 });
    s.sync(frame({ entities: [hero(), coin] }));
    expect(s.entityIds().sort()).toEqual(['c1', 'p1']);
    const p1 = s.entity('p1')!;
    // The root sits on the box's bottom centre, y flipped: (16 + 8, -(8 + 16)).
    expect(p1.position.toArray()).toEqual([24, -24, 0]);

    s.sync(frame({ frame: 1, entities: [hero({ x: 20, y: 4 })] }));
    expect(s.entity('p1')).toBe(p1);
    expect(p1.position.toArray()).toEqual([28, -20, 0]);
    expect(s.entityIds()).toEqual(['p1']);
    expect(s.scene.children.filter((c) => c.name === 'entity:c1')).toEqual([]);

    s.sync(frame({ frame: 2, entities: [] }));
    expect(s.entityIds()).toEqual([]);
    expect(s.scene.children).not.toContain(p1);
  });

  it('builds meshes from the skin: compound parts placed from the box, primitives filling it', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero(), hero({ id: 'c1', kind: 'coin', w: 8, h: 8 })] }));
    const [body, head] = meshesOf(s, 'p1');
    // Body: 16x10 at (0, 6) in a 16x16 box -> centre x 0, y 16 - 6 - 5 = 5 above the feet.
    expect(body!.position.toArray()).toEqual([0, 5, 0]);
    expect(colorOf(body!)).toBe('#d82800');
    // Head: 8x6 at (8, 0, z 2) -> centre x 8 + 4 - 8 = 4, y 16 - 0 - 3 = 13.
    expect(head!.position.toArray()).toEqual([4, 13, 2]);
    expect(colorOf(head!)).toBe('#fcbcb0');
    const [coin] = meshesOf(s, 'c1');
    expect(coin!.geometry.type).toBe('CylinderGeometry');
    expect(coin!.position.toArray()).toEqual([0, 4, 0]);
    expect(s.entity('c1')!.userData.fallback).toBe(false);
  });

  it('maps layer to z through camera3d.layerDepth', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero({ layer: 2 }), hero({ id: 'p2', layer: -1 })] }));
    expect(s.entity('p1')!.position.z).toBe(32);
    expect(s.entity('p2')!.position.z).toBe(-16);
  });

  it('mirrors x when facing left', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero({ facing: 'left' })] }));
    expect(s.entity('p1')!.scale.toArray()).toEqual([-1, 1, 1]);
    s.sync(frame({ frame: 1, entities: [hero({ facing: 'right' })] }));
    expect(s.entity('p1')!.scale.toArray()).toEqual([1, 1, 1]);
  });

  it('applies squash and stretch about the bottom centre, rotate and alpha', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero({ facing: 'left', fx: { squashX: 1.25, squashY: 0.5, alpha: 0.5 } })] }));
    const root = s.entity('p1')!;
    expect(root.scale.toArray()).toEqual([-1.25, 0.5, 1]);
    // The pivot is the root, at the box's bottom centre: feet stay put.
    expect(root.position.toArray()).toEqual([24, -24, 0]);
    for (const m of meshesOf(s, 'p1')) {
      const material = m.material as MeshLambertMaterial;
      expect(material.opacity).toBe(0.5);
      expect(material.transparent).toBe(true);
    }
    // Squash scales the world box about the bottom centre: the head's top moves down.
    root.updateMatrixWorld(true);
    const head = meshesOf(s, 'p1')[1]!;
    const headCentre = head.getWorldPosition(new Vector3());
    expect(headCentre.y).toBeCloseTo(-24 + 13 * 0.5);

    // `rotate` is clockwise on screen, which is a negative turn about z with y up.
    s.sync(frame({ frame: 1, entities: [hero({ fx: { rotate: 90 } })] }));
    expect(root.rotation.z).toBeCloseTo(-Math.PI / 2);

    s.sync(frame({ frame: 2, entities: [hero()] }));
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.rotation.z).toBeCloseTo(0);
    expect((meshesOf(s, 'p1')[0]!.material as MeshLambertMaterial).transparent).toBe(false);
  });

  it('draws a fallback box for a kind the skin does not list', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero({ id: 'g', kind: 'ghost', w: 8, h: 12 })] }));
    const root = s.entity('g')!;
    expect(root.userData.fallback).toBe(true);
    const [box] = meshesOf(s, 'g');
    expect(box!.geometry).toBeInstanceOf(BoxGeometry);
    expect((box!.geometry as BoxGeometry).parameters).toMatchObject({ width: 8, height: 12, depth: 8 });
    expect(colorOf(box!)).toBe(DEFAULT_FALLBACK_COLOR);
    expect(box!.position.toArray()).toEqual([0, 6, 0]);
  });

  it('rebuilds an entity whose kind or size changes', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ entities: [hero()] }));
    const before = s.entity('p1');
    s.sync(frame({ frame: 1, entities: [hero({ h: 24 })] }));
    expect(s.entity('p1')).not.toBe(before);
    expect(s.scene.children).not.toContain(before);
  });
});

describe('ThreeScene: camera', () => {
  /** Where a world-px point (y down) lands in normalised device coordinates. */
  function ndc(s: ThreeScene, x: number, y: number): [number, number] {
    const v = new Vector3(x, -y, 0).project(s.camera);
    return [v.x, v.y];
  }

  it('frames the same world box as the core CameraFollower', () => {
    const level: PresentMap = { ...MAP, cols: 20, rows: 6, tiles: Array(6).fill('.'.repeat(20)) };
    delete level.layers;
    const frames = [0, 1, 2].map((i) =>
      frame({ frame: i, map: i === 0 ? level : ref(), entities: [hero({ x: 100 + i * 20, y: 40 })] }),
    );
    const follower = new CameraFollower();
    const s = new ThreeScene(SKIN);
    for (const f of frames) {
      s.sync(f);
      const top = follower.update(f, SKIN.camera, f.size, level);
      expect(s.view).toEqual({ x: top.x, y: top.y, w: 64, h: 48 });
      // The z = 0 plane shows exactly that box: its corners land on the picture's corners.
      const [lx, ty] = ndc(s, top.x, top.y);
      const [rx, by] = ndc(s, top.x + 64, top.y + 48);
      expect(lx).toBeCloseTo(-1);
      expect(ty).toBeCloseTo(1);
      expect(rx).toBeCloseTo(1);
      expect(by).toBeCloseTo(-1);
    }
    expect(s.camera.fov).toBe(40);
    expect(s.camera.aspect).toBeCloseTo(64 / 48);
    expect(s.camera.position.z).toBeCloseTo(48 / (2 * Math.tan((40 * Math.PI) / 360)));
  });

  it('honours the hint: follow, bounds, deadzone and lerp go through the shared follower', () => {
    const level: PresentMap = { ...MAP, cols: 20, rows: 6, tiles: Array(6).fill('.'.repeat(20)) };
    const hint = {
      x: 0,
      y: 0,
      follow: 'p1',
      deadzone: { w: 16, h: 8 },
      lerp: 0.5,
      bounds: { x: 0, y: 0, w: 200, h: 96 },
    };
    const follower = new CameraFollower();
    const s = new ThreeScene(SKIN);
    for (let i = 0; i < 4; i++) {
      const f = frame({
        frame: i,
        map: i === 0 ? level : ref(),
        camera: hint,
        entities: [hero({ x: 60 + i * 30 })],
      });
      s.sync(f);
      const top = follower.update(f, SKIN.camera, f.size, level);
      expect(s.view).toMatchObject({ x: top.x, y: top.y });
    }
  });

  it('honours zoom by distance: zoom 2 shows half the world box', () => {
    const s = new ThreeScene(SKIN);
    s.sync(frame({ camera: { x: 32, y: 24, zoom: 2 } }));
    expect(s.view).toMatchObject({ w: 32, h: 24 });
    expect(s.camera.position.z).toBeCloseTo(24 / (2 * Math.tan((40 * Math.PI) / 360)));
  });

  it('tilts down a little while still looking at the same centre', () => {
    const s = new ThreeScene({ ...SKIN, camera3d: { ...SKIN.camera3d, tilt: 10 } });
    s.sync(frame({ entities: [hero()] }));
    const v = s.view!;
    const [cx, cy] = ndc(s, v.x + v.w / 2, v.y + v.h / 2);
    expect(cx).toBeCloseTo(0);
    expect(cy).toBeCloseTo(0);
    expect(s.camera.position.y).toBeGreaterThan(-(v.y + v.h / 2));
  });

  it('adds shake to the camera each frame without storing it', () => {
    const s = new ThreeScene(SKIN);
    const level: PresentMap = { ...MAP, cols: 20, rows: 6, tiles: Array(6).fill('.'.repeat(20)) };
    s.sync(frame({ map: level, entities: [hero({ x: 100 })] }));
    const still = s.camera.position.x;
    s.sync(frame({ frame: 1, map: ref(), entities: [hero({ x: 100 })], events: [{ type: 'bump' }] }));
    expect(s.camera.position.x).toBe(still - 3);
    expect(s.view!.x + s.view!.w / 2).toBe(still);
    s.sync(frame({ frame: 2, map: ref(), entities: [hero({ x: 100 })] }));
    expect(s.camera.position.x).toBe(still + 3);
    s.sync(frame({ frame: 9, map: ref(), entities: [hero({ x: 100 })] }));
    expect(s.camera.position.x).toBe(still);
  });
});

describe('ThreeScene: lights, events and effects', () => {
  it('has one ambient and one directional light from camera3d, with no shadows', () => {
    const s = new ThreeScene(SKIN);
    const lights = s.scene.children.filter((c) => 'isLight' in c);
    expect(lights).toHaveLength(2);
    expect(s.ambient.intensity).toBe(0.5);
    expect(s.sun.intensity).toBe(0.9);
    expect(s.sun.castShadow).toBe(false);
  });

  it('calls onSound once per event, and not again for a frame shown twice', () => {
    const sounds: string[] = [];
    const s = new ThreeScene(SKIN, { onSound: (id) => sounds.push(id) });
    const f = frame({ frame: 3, events: [{ type: 'jumped' }, { type: 'unknown' }, { type: 'jumped' }] });
    s.sync(f);
    s.sync(f);
    expect(sounds).toEqual(['jump', 'jump']);
  });

  it('shows a flash as a full-screen overlay for its ticks, unless flashing is reduced', () => {
    const s = new ThreeScene(SKIN, { onSound: () => {} });
    s.sync(frame({ frame: 0, events: [{ type: 'hit' }] }));
    expect(s.overlay.visible).toBe(true);
    expect(s.overlay.material.opacity).toBe(1);
    expect(s.overlay.parent).toBe(s.camera);
    s.sync(frame({ frame: 2 }));
    expect(s.overlay.visible).toBe(false);

    const calm = new ThreeScene(SKIN, { reduceFlashing: true });
    calm.sync(frame({ events: [{ type: 'hit' }] }));
    expect(calm.overlay.visible).toBe(false);
  });
});

describe('ThreeScene: read-only inputs and determinism', () => {
  it('never changes a frozen frame or skin', () => {
    const skin = freezeFrame(structuredClone(SKIN));
    const s = new ThreeScene(skin, { onSound: () => {} });
    const entities = [hero({ fx: { squashX: 1.2, alpha: 0.5 }, layer: 1 }), hero({ id: 'g', kind: 'ghost' })];
    const frames = [
      frame({ entities, events: [{ type: 'hit' }, { type: 'bump' }], camera: { x: 0, y: 0, follow: 'p1' } }),
      frame({ frame: 1, map: ref(), entities: [hero({ x: 40, facing: 'left' })] }),
      frame({ frame: 2, noMap: true }),
    ].map((f) => freezeFrame(structuredClone(f)));
    const copies = frames.map((f) => JSON.stringify(f));
    expect(() => frames.forEach((f) => s.sync(f))).not.toThrow();
    expect(frames.map((f) => JSON.stringify(f))).toEqual(copies);
    expect(JSON.stringify(skin)).toBe(JSON.stringify(SKIN));
  });

  it('builds the same scene from the same frames', () => {
    const run = () => {
      const s = new ThreeScene(SKIN);
      s.sync(frame({ entities: [hero(), hero({ id: 'c1', kind: 'coin', x: 40 })] }));
      s.sync(frame({ frame: 1, map: ref(), entities: [hero({ x: 30, fx: { squashY: 0.8 } })] }));
      return {
        view: s.view,
        cam: s.camera.position.toArray(),
        entities: s
          .entityIds()
          .map((id) => [id, s.entity(id)!.position.toArray(), s.entity(id)!.scale.toArray()]),
        tiles: tileMeshes(s).map((m) => [m.name, blockCentres(m)]),
      };
    };
    expect(run()).toEqual(run());
  });

  it('uses no wall clock or unseeded randomness in its own code', () => {
    const dir = fileURLToPath(new URL('.', import.meta.url));
    for (const name of readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const code = readFileSync(`${dir}/${name}`, 'utf8');
      expect(code, name).not.toMatch(/Math\.random|Date\.now|performance\.now|new Date\(/);
    }
  });
});
