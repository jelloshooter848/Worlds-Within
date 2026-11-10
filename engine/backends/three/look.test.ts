import { describe, expect, it } from 'vitest';
import type { Color, MeshLambertMaterial } from 'three';
import { Box3, Fog, InstancedMesh, Mesh, type Group, type Material } from 'three';
import { base64, encodeGlb, lowPolyModel } from '@engine/core/content/gltf';
import { assetDataUrl } from '@engine/core/content/png';
import {
  freezeFrame,
  skinSchema,
  type PresentEntity,
  type PresentEvent,
  type PresentFrame,
  type SkinFile,
} from '@engine/core/present';
import { ModelLibrary } from './models';
import { ThreeScene } from './scene';

// Engine 0.16 part B, T10 (the 2.5D view of Hopper's Way): tweens in 3D (item 340), per-map
// looks (`themes`), a tile's `join` picking another tile entry, scenery rows, and a tag look's
// own model with a tint and a stretch. Inline fixtures only.

/** A 1 x 1 x 1 cube standing on y = 0 (an original inline model). */
const CUBE = lowPolyModel(
  [{ name: 'cube', shape: 'box', size: { x: 1, y: 1, z: 1 }, at: { x: 0, y: 0.5, z: 0 }, color: '#80c080' }],
  [],
);
const CUBE_GLB = 'assets/pack/cube.glb';
const TREE_GLB = 'assets/pack/tree.glb';
const ASSETS = {
  [CUBE_GLB]: assetDataUrl(CUBE_GLB, base64(encodeGlb(CUBE.json, CUBE.bin))),
  [TREE_GLB]: assetDataUrl(TREE_GLB, base64(encodeGlb(CUBE.json, CUBE.bin))),
};

const SKIN = skinSchema.parse({
  backend: 'three',
  background: '#5c94fc',
  kinds: {
    hero: {
      mesh: 'box',
      color: '#d82800',
      spawnTween: { prop: 'alpha', from: 0, to: 1, frames: 4 },
    },
    flag: {
      mesh: 'box',
      color: '#808080',
      model: CUBE_GLB,
      scale: 8,
      stretch: { z: 2 },
      byTag: [{ tag: 'active', model: TREE_GLB, scale: 16, tint: '#ff0000' }],
    },
  },
  tiles: {
    '#': { mesh: 'box', color: '#804000', join: { frames: { top: 'grass' } } },
    grass: { mesh: 'box', color: '#00a800' },
  },
  events: {
    land: {
      tween: [
        { prop: 'scaleY', from: 0.5, to: 1, frames: 10 },
        { prop: 'y', from: 4, to: 0, frames: 10 },
      ],
    },
    hit: { tween: { prop: 'color', from: '#ffffff', to: '#ffffff', frames: 6, amount: 1 } },
  },
  scenery: [{ model: TREE_GLB, scale: 4, every: 32, z: -40, jitter: { x: 4, scale: 0.25, turn: 30 } }],
  parallax: [{ gradient: ['#5c94fc', '#a4e4fc'], factor: 0 }],
  themes: {
    night: {
      background: '#101830',
      parallax: [{ gradient: ['#101830', '#302050'], factor: 0 }],
      tiles: { grass: { mesh: 'box', color: '#c080c0' } },
      scene3d: {
        hemisphere: { sky: '#203060', ground: '#100810', intensity: 0.4 },
        fog: { kind: 'linear', color: '#101830', near: 10, far: 300 },
      },
      scenery: [],
    },
  },
}) as SkinFile;

const hero = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  id: 'h',
  kind: 'hero',
  x: 16,
  y: 16,
  w: 16,
  h: 16,
  facing: 'right',
  anim: { state: 'idle', t: 0 },
  tags: [],
  ...over,
});

const frame = (n: number, entities: PresentEntity[], events: PresentEvent[] = [], map = 'day') =>
  freezeFrame<PresentFrame>({
    frame: n,
    size: { width: 64, height: 48 },
    entities,
    map: { id: map, version: 0, tileSize: 16, cols: 8, rows: 3, tiles: ['........', '........', '###..###'] },
    events,
    status: {},
  });

const bounds = (o: Group) => new Box3().setFromObject(o, true);
const lambert = (o: Group) =>
  (o.children.find((c) => c instanceof Mesh) as Mesh<never, MeshLambertMaterial> | undefined)!.material;

describe('3D tweens (item 340)', () => {
  it("plays an event's squash and offset about the bottom centre, then rests", () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame(0, [hero()]));
    scene.sync(frame(10, [hero()], [{ type: 'land', entity: 'h' }]));
    const root = scene.entity('h')!;
    expect(root.scale.y).toBeCloseTo(0.5);
    expect(root.position.y).toBeCloseTo(-(16 + 4 + 16));
    scene.sync(frame(15, [hero()]));
    expect(root.scale.y).toBeCloseTo(0.75);
    expect(scene.tweenState('h', 15).y).toBeCloseTo(2);
    scene.sync(frame(20, [hero()]));
    expect(root.scale.toArray()).toEqual([1, 1, 1]);
    expect(root.position.y).toBe(-32);
  });

  it("fades in on a kind's spawnTween, again after a new level", () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame(0, [hero()]));
    const m = lambert(scene.entity('h')!);
    expect(m.opacity).toBe(0);
    expect(m.transparent).toBe(true);
    scene.sync(frame(2, [hero()]));
    expect(m.opacity).toBeCloseTo(0.5);
    scene.sync(frame(4, [hero()]));
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
    scene.sync(frame(0, [hero()]));
    expect(lambert(scene.entity('h')!).opacity).toBe(0);
  });

  it("flashes a colour tween as the materials' emissive colour and gives the own colour back", () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame(0, [hero()]));
    scene.sync(frame(8, [hero()], [{ type: 'hit', entity: 'h' }]));
    const m = lambert(scene.entity('h')!);
    expect(m.emissive.getHexString()).toBe('ffffff');
    scene.sync(frame(14, [hero()]));
    expect(m.emissive.getHexString()).toBe('000000');
    expect(m.userData['ownEmissive']).toBeUndefined();
  });

  it('ignores tweens for entities it does not show and changes nothing in a frozen frame', () => {
    const scene = new ThreeScene(SKIN);
    const f = frame(3, [hero()], [{ type: 'land', entity: 'gone' }]);
    expect(() => scene.sync(f)).not.toThrow();
    expect(scene.tweenState('gone', 3).scaleY).toBe(1);
  });
});

describe('per-map looks in 3D (themes)', () => {
  it("takes the map's sky, parallax, lights, fog and tiles, and the skin's own elsewhere", () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(frame(0, []));
    expect((scene.scene.background as Color).getHexString()).toBe('5c94fc');
    expect(scene.hemisphere).toBeNull();
    expect(scene.scene.fog).toBeNull();
    expect(scene.parallax.draws()[0]).toMatchObject({ kind: 'box', color: '#5c94fc' });
    const grassOf = () =>
      (scene.map!.children.find((c) => c.name === 'tile:grass:0') as InstancedMesh)
        .material as MeshLambertMaterial;
    expect(grassOf().color.getHexString()).toBe('00a800');

    scene.sync(frame(0, [], [], 'night'));
    expect((scene.scene.background as Color).getHexString()).toBe('101830');
    expect(scene.hemisphere?.color.getHexString()).toBe('203060');
    expect(scene.look.fog).toMatchObject({ color: '#101830', far: 300 });
    expect(scene.scene.fog).toBeInstanceOf(Fog);
    expect(scene.parallax.draws()[0]).toMatchObject({ kind: 'box', color: '#101830' });
    expect(grassOf().color.getHexString()).toBe('c080c0');

    scene.sync(frame(0, [], [], 'day'));
    expect((scene.scene.background as Color).getHexString()).toBe('5c94fc');
    expect(scene.hemisphere).toBeNull();
    expect(scene.scene.fog).toBeNull();
  });

  it("joins tiles in 3D: a cell with an open top shows the join's tile entry", () => {
    const scene = new ThreeScene(SKIN);
    scene.sync(
      freezeFrame<PresentFrame>({
        frame: 0,
        size: { width: 64, height: 48 },
        entities: [],
        events: [],
        status: {},
        map: { id: 'day', version: 0, tileSize: 16, cols: 4, rows: 3, tiles: ['....', '###.', '###.'] },
      }),
    );
    const counts = Object.fromEntries(
      scene
        .map!.children.filter((c) => c instanceof InstancedMesh)
        .map((c) => [c.name, (c as InstancedMesh).count]),
    );
    // The first two cells of the top row have only their top open ("top"); the third's right is
    // open too ("top right", not in `frames`), so it keeps `#`, as does every cell below.
    expect(counts).toEqual({ 'tile:grass:0': 2, 'tile:#:0': 4 });
  });
});

describe('scenery rows and tag-look models', () => {
  it('places a seeded row of copies along the map behind the blocks, the same each time', async () => {
    const models = new ModelLibrary(ASSETS);
    const place = (seed: number) => {
      const scene = new ThreeScene(SKIN, { models, seed });
      scene.sync(frame(0, []));
      return scene.sceneryObjects().map((o) => [o.position.x, o.position.y, o.position.z, o.rotation.y]);
    };
    expect(place(1)).toEqual([]); // still loading
    await models.preload([SKIN]);
    const a = place(1);
    // From -72 (the row's depth plus a step past the map's start) to the map's end plus the same.
    expect(a).toHaveLength(Math.floor((128 + 72) / 32) - Math.ceil(-72 / 32) + 1);
    for (const [x, y, z, turn] of a) {
      const step = Math.round(x! / 32) * 32;
      expect(Math.abs(x! - step)).toBeLessThanOrEqual(4);
      expect(y).toBe(-48);
      expect(z).toBe(-40);
      expect(Math.abs(turn!)).toBeLessThanOrEqual(Math.PI / 6);
    }
    expect(place(1)).toEqual(a);
    expect(place(2)).not.toEqual(a);
  });

  it('rebuilds the map once a scenery model has loaded, and a theme without scenery shows none', async () => {
    const models = new ModelLibrary(ASSETS);
    const scene = new ThreeScene(SKIN, { models });
    scene.sync(frame(0, []));
    expect(scene.sceneryObjects()).toEqual([]);
    await models.preload([SKIN]);
    scene.sync(frame(1, []));
    expect(scene.mapBuilds).toBe(2);
    expect(scene.sceneryObjects().length).toBeGreaterThan(0);
    scene.sync(frame(0, [], [], 'night'));
    expect(scene.sceneryObjects()).toEqual([]);
  });

  it("builds a tag look's own model with its tint, and the kind's stretch", async () => {
    const models = new ModelLibrary(ASSETS);
    await models.preload([SKIN]);
    const scene = new ThreeScene(SKIN, { models });
    const flag = (tags: string[]) => hero({ id: 'f', kind: 'flag', tags });
    scene.sync(frame(0, [flag([])]));
    const plain = scene.entity('f')!;
    expect(plain.userData['model']).toBe(CUBE_GLB);
    const b = bounds(plain);
    expect(b.max.x - b.min.x).toBeCloseTo(8);
    expect(b.max.z - b.min.z).toBeCloseTo(16);
    scene.sync(frame(1, [flag(['active'])]));
    const active = scene.entity('f')!;
    expect(active).not.toBe(plain);
    expect(active.userData['model']).toBe(TREE_GLB);
    expect(bounds(active).max.y - bounds(active).min.y).toBeCloseTo(16);
    const colours: string[] = [];
    active.traverse((o) => {
      if (o instanceof Mesh) colours.push((o.material as Material & { color: Color }).color.getHexString());
    });
    // The cube's #80c080, red-tinted: only the red channel is kept (in linear terms).
    expect(colours.every((c) => c.endsWith('0000'))).toBe(true);
  });
});
