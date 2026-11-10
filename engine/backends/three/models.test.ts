import { describe, expect, it } from 'vitest';
import { Box3, InstancedMesh, Mesh, Vector3, type Group } from 'three';
import { base64, encodeGlb, encodeGltfEmbedded, lowPolyModel } from '@engine/core/content/gltf';
import { assetDataUrl } from '@engine/core/content/png';
import {
  freezeFrame,
  skinSchema,
  type PresentEntity,
  type PresentFrame,
  type SkinFile,
  type SkinModel,
} from '@engine/core/present';
import { ModelInstance, ModelLibrary } from './models';
import { ThreeScene } from './scene';

/**
 * A tiny original model (inline fixture): a 2 x 1 x 1 body standing on y = 0 and a head on it,
 * with two clips: `bob` lifts the head, `grow` scales the body.
 */
const MODEL = lowPolyModel(
  [
    { name: 'body', shape: 'box', size: { x: 2, y: 1, z: 1 }, at: { x: 0, y: 0.5, z: 0 }, color: '#806040' },
    {
      name: 'head',
      shape: 'octahedron',
      size: { x: 1, y: 1, z: 1 },
      at: { x: 0, y: 1.5, z: 0 },
      color: '#f8b800',
    },
  ],
  [
    {
      name: 'bob',
      tracks: [
        {
          node: 'head',
          path: 'translation',
          times: [0, 1],
          values: [
            [0, 1.5, 0],
            [0, 2.5, 0],
          ],
        },
      ],
    },
    {
      name: 'grow',
      tracks: [
        {
          node: 'body',
          path: 'scale',
          times: [0, 1],
          values: [
            [1, 1, 1],
            [3, 3, 3],
          ],
        },
      ],
    },
  ],
);
const GLB = 'assets/pack/thing.glb';
const GLTF = 'assets/pack/thing.gltf';
const ASSETS = {
  [GLB]: assetDataUrl(GLB, base64(encodeGlb(MODEL.json, MODEL.bin))),
  [GLTF]: assetDataUrl(GLTF, base64(new TextEncoder().encode(encodeGltfEmbedded(MODEL.json, MODEL.bin)))),
  'assets/pack/broken.glb': assetDataUrl('broken.glb', base64(new TextEncoder().encode('not a model'))),
};

const spec = (over: Partial<SkinModel> = {}): SkinModel => ({
  model: GLB,
  scale: 8,
  anchor: 'bottom',
  rotate: { x: 0, y: 0, z: 0 },
  castShadow: false,
  clip: null,
  time: 0,
  hold: false,
  offset: { x: 0, y: 0, z: 0 },
  stretch: { x: 1, y: 1, z: 1 },
  tint: null,
  ...over,
});

/** The world-space bounds of an object (its parents' transforms applied). */
const bounds = (o: Group) => {
  o.updateMatrixWorld(true);
  return new Box3().setFromObject(o, true);
};

async function library(): Promise<ModelLibrary> {
  const lib = new ModelLibrary(ASSETS);
  await lib.load(GLB);
  return lib;
}

describe('ModelLibrary (Engine 0.16 T11)', () => {
  it('parses a GLB and an embedded .gltf in Node, without WebGL, each once', async () => {
    const lib = new ModelLibrary(ASSETS);
    expect(lib.status(GLB)).toBe('loading');
    expect(lib.get(GLB)).toBeNull(); // starts loading
    const glb = await lib.load(GLB);
    const gltf = await lib.load(GLTF);
    expect(glb?.clips.map((c) => c.name)).toEqual(['bob', 'grow']);
    expect(gltf?.clips.map((c) => c.name)).toEqual(['bob', 'grow']);
    expect(lib.get(GLB)).toBe(glb);
    expect(await lib.load(GLB)).toBe(glb);
    expect(lib.status(GLB)).toBe('ready');
    const meshes: Mesh[] = [];
    glb!.scene.traverse((o) => {
      if (o instanceof Mesh) meshes.push(o);
    });
    expect(meshes.map((m) => m.name)).toEqual(['body', 'head']);
  });

  it('gives null for a missing or broken file and says why', async () => {
    const lib = new ModelLibrary(ASSETS);
    expect(await lib.load('assets/pack/none.glb')).toBeNull();
    expect(lib.status('assets/pack/none.glb')).toBe('missing');
    expect(await lib.load('assets/pack/broken.glb')).toBeNull();
    expect(lib.status('assets/pack/broken.glb')).toBe('failed');
    expect(lib.error('assets/pack/broken.glb')).toBeTruthy();
  });

  it('preloads every model a skin names', async () => {
    const skin = skinSchema.parse({
      backend: 'three',
      kinds: { a: { mesh: 'box', color: '#000', model: GLB } },
      tiles: { '#': { mesh: 'box', color: '#000', model: GLTF } },
    });
    const lib = new ModelLibrary(ASSETS);
    await lib.preload([skin]);
    expect([lib.status(GLB), lib.status(GLTF)]).toEqual(['ready', 'ready']);
  });
});

describe('ModelInstance', () => {
  it('scales the model and stands its bounds on the box bottom centre (anchor bottom)', async () => {
    const m = new ModelInstance((await library()).get(GLB)!, spec(), { w: 16, h: 16 });
    const b = bounds(m.object);
    expect(b.min.y).toBeCloseTo(0);
    expect(b.max.y).toBeCloseTo(16); // two units tall at 8 px a unit
    expect(b.min.x).toBeCloseTo(-8);
    expect(b.max.x).toBeCloseTo(8);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(0);
  });

  it('places by centre, origin or a model point, turns before anchoring, and moves by the offset', async () => {
    const lib = await library();
    const box = { w: 16, h: 24 };
    const centre = bounds(new ModelInstance(lib.get(GLB)!, spec({ anchor: 'center' }), box).object);
    expect((centre.min.y + centre.max.y) / 2).toBeCloseTo(12);
    const origin = bounds(new ModelInstance(lib.get(GLB)!, spec({ anchor: 'origin' }), box).object);
    expect(origin.min.y).toBeCloseTo(0);
    const point = bounds(
      new ModelInstance(lib.get(GLB)!, spec({ anchor: { x: 0, y: 1, z: 0 } }), box).object,
    );
    expect(point.min.y).toBeCloseTo(-8); // the body's top (1 unit up) on the box bottom
    const turned = bounds(
      new ModelInstance(lib.get(GLB)!, spec({ rotate: { x: 0, y: 90, z: 0 } }), box).object,
    );
    expect(turned.max.x - turned.min.x).toBeCloseTo(8); // the 2-unit width now runs along z
    expect(turned.max.z - turned.min.z).toBeCloseTo(16);
    const moved = bounds(
      new ModelInstance(lib.get(GLB)!, spec({ offset: { x: 2, y: -3, z: 4 } }), box).object,
    );
    expect(
      [moved.min.x, moved.min.y, (moved.min.z + moved.max.z) / 2].map((v) => Math.round(v * 1e4) / 1e4),
    ).toEqual([-6, 3, 4]);
  });

  it('poses a clip by name at an exact time, looped, and the rest pose without one', async () => {
    const m = new ModelInstance((await library()).get(GLB)!, spec({ anchor: 'origin', scale: 1 }), {
      w: 1,
      h: 1,
    });
    const head = m.object.getObjectByName('head')!;
    const at = () => Math.round(head.position.y * 1e4) / 1e4;
    expect(at()).toBe(1.5);
    m.pose('bob', 0.5);
    expect(m.playing).toBe('bob');
    expect(at()).toBe(2);
    m.pose('bob', 0.25);
    expect(at()).toBe(1.75); // set, not added: the same time always shows the same pose
    m.pose('bob', 0.5);
    expect(at()).toBe(2);
    m.pose('grow', 0.5);
    expect(at()).toBe(1.5); // the other clip's track is let go
    expect(m.object.getObjectByName('body')!.scale.x).toBeCloseTo(2);
    m.pose(null, 0.5);
    expect(m.playing).toBeNull();
    expect(m.object.getObjectByName('body')!.scale.x).toBeCloseTo(1);
    m.pose('no-such-clip', 0.5);
    expect(m.playing).toBeNull();
  });

  it('holds a clip on its last pose instead of looping (clipHold, Engine 0.16 part B)', async () => {
    const m = new ModelInstance((await library()).get(GLB)!, spec({ anchor: 'origin', scale: 1 }), {
      w: 1,
      h: 1,
    });
    const head = m.object.getObjectByName('head')!;
    m.pose('bob', 1.25);
    expect(head.position.y).toBeCloseTo(1.75); // looped: a quarter into the second play
    m.pose('bob', 1.25, true);
    expect(head.position.y).toBeCloseTo(2.5, 2); // held at the end
    m.pose('bob', 0.5, true);
    expect(head.position.y).toBeCloseTo(2);
  });

  it('owns its materials (so alpha on one leaves another alone) and shares the geometry', async () => {
    const lib = await library();
    const a = new ModelInstance(lib.get(GLB)!, spec({ castShadow: true }), { w: 16, h: 16 });
    const b = new ModelInstance(lib.get(GLB)!, spec(), { w: 16, h: 16 });
    expect(a.materials).toHaveLength(2);
    expect(a.materials[0]).not.toBe(b.materials[0]);
    expect(a.meshes()[0]!.geometry).toBe(b.meshes()[0]!.geometry);
    expect(a.meshes().every((m) => m.castShadow)).toBe(true);
    expect(b.meshes().some((m) => m.castShadow)).toBe(false);
  });
});

/** A 3D skin with a model kind (`thing`), a text-mesh kind (`crate`) and a model tile. */
const SKIN = skinSchema.parse({
  backend: 'three',
  kinds: {
    thing: { mesh: 'box', color: '#d82800', model: GLB, scale: 8, clip: { walk: 'bob', jump: 'grow' } },
    crate: { mesh: 'box', color: '#806040' },
  },
  tiles: {
    '#': { mesh: 'box', color: '#c84c0c', model: GLTF, scale: 8, clip: 'bob' },
    '=': { mesh: 'box', color: '#00a800' },
  },
}) as SkinFile;

const thing = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  id: 't1',
  kind: 'thing',
  x: 32,
  y: 16,
  w: 16,
  h: 16,
  facing: 'right',
  anim: { state: 'idle', t: 0 },
  tags: [],
  ...over,
});
const crate: PresentEntity = { ...thing(), id: 'c1', kind: 'crate', x: 0 };

const frame = (n: number, entities: PresentEntity[]) =>
  freezeFrame<PresentFrame>({
    frame: n,
    size: { width: 64, height: 48 },
    entities,
    map: { id: 'm', version: 0, tileSize: 16, cols: 3, rows: 3, tiles: ['...', '...', '#=#'] },
    events: [],
    status: {},
  });

const meshNames = (root: Group) => {
  const out: string[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o.name || o.geometry.type);
  });
  return out;
};

describe('ThreeScene with models (Engine 0.16 T11)', () => {
  it("shows the entry's text mesh while the model loads, then the model", async () => {
    const models = new ModelLibrary(ASSETS);
    const scene = new ThreeScene(SKIN, { models });
    scene.sync(frame(0, [thing(), crate]));
    const loading = scene.entity('t1')!;
    expect(loading.userData).toMatchObject({ model: GLB, loading: true, fallback: false });
    expect(meshNames(loading)).toEqual(['BoxGeometry']);
    await models.preload([SKIN]);
    scene.sync(frame(1, [thing(), crate]));
    const shown = scene.entity('t1')!;
    expect(shown).not.toBe(loading);
    expect(shown.userData).toEqual({ id: 't1', kind: 'thing', fallback: false, model: GLB });
    expect(meshNames(shown)).toEqual(['body', 'head']);
    // Its bounds stand on the box's bottom centre (x 40, y -32 in the scene), 16 px tall.
    const b = bounds(shown);
    expect(b.min.y).toBeCloseTo(-32);
    expect(b.max.y).toBeCloseTo(-16);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(40);
  });

  it('keeps text meshes as they were, and a scene without a library shows only text meshes', async () => {
    const models = new ModelLibrary(ASSETS);
    await models.preload([SKIN]);
    const withModels = new ThreeScene(SKIN, { models });
    const without = new ThreeScene(SKIN);
    for (const s of [withModels, without]) s.sync(frame(0, [thing(), crate]));
    expect(meshNames(withModels.entity('c1')!)).toEqual(meshNames(without.entity('c1')!));
    expect(withModels.entity('c1')!.children[0]!.position).toEqual(
      without.entity('c1')!.children[0]!.position,
    );
    expect(meshNames(without.entity('t1')!)).toEqual(['BoxGeometry']);
    // The stand-in is the box's size, not grown by the model's `scale` (px per model unit).
    const unscaled = new ThreeScene(
      skinSchema.parse({ backend: 'three', kinds: { thing: { mesh: 'box', color: '#d82800' } } }) as SkinFile,
    );
    unscaled.sync(frame(0, [thing()]));
    const stand = bounds(without.entity('t1')!);
    const plain = bounds(unscaled.entity('t1')!);
    expect(stand.min).toEqual(plain.min);
    expect(stand.max).toEqual(plain.max);
    expect(stand.max.y - stand.min.y).toBeCloseTo(16);
  });

  it("plays the clip mapped from the entity's anim state, at anim.t / 60 s, without a rebuild", async () => {
    const models = new ModelLibrary(ASSETS);
    await models.preload([SKIN]);
    const scene = new ThreeScene(SKIN, { models });
    scene.sync(frame(0, [thing()]));
    const root = scene.entity('t1')!;
    const head = () => root.getObjectByName('head')!.position.y;
    const rest = head();
    scene.sync(frame(1, [thing({ anim: { state: 'walk', t: 30 } })]));
    expect(scene.entity('t1')).toBe(root);
    expect(head() - rest).toBeCloseTo(0.5); // half of bob's one unit (scaled by the parent)
    scene.sync(frame(2, [thing({ anim: { state: 'jump', t: 30 } })]));
    expect(head()).toBeCloseTo(rest);
    expect(root.getObjectByName('body')!.scale.x).toBeCloseTo(2);
    scene.sync(frame(3, [thing({ anim: { state: 'idle', t: 30 } })]));
    expect(root.getObjectByName('body')!.scale.x).toBeCloseTo(1); // idle has no clip: the rest pose
  });

  it('builds tile models per cell once loaded (instanced text blocks until then), posed on the frame clock', async () => {
    const models = new ModelLibrary(ASSETS);
    const scene = new ThreeScene(SKIN, { models });
    scene.sync(frame(0, []));
    expect(scene.map!.children.filter((c) => c instanceof InstancedMesh).map((c) => c.name)).toEqual([
      'tile:#:0',
      'tile:=:0',
    ]);
    await models.preload([SKIN]);
    scene.sync(frame(30, []));
    expect(scene.mapBuilds).toBe(2);
    const cells = scene.map!.children.filter((c) => c.name === 'tile:#:model');
    expect(cells.map((c) => [c.position.x, c.position.y])).toEqual([
      [8, -48],
      [40, -48],
    ]);
    const head = cells[0]!.getObjectByName('head')!;
    const y30 = head.position.y;
    scene.sync(frame(45, []));
    expect(head.position.y).toBeGreaterThan(y30);
    scene.sync(frame(46, []));
    expect(scene.mapBuilds).toBe(2);
    expect(scene.map!.getObjectByName('tile:=:0')).toBeInstanceOf(InstancedMesh);
  });

  it('never changes the frozen frame or skin, and builds the same twice', async () => {
    const models = new ModelLibrary(ASSETS);
    await models.preload([SKIN]);
    const before = JSON.stringify(SKIN);
    const shots = [0, 1].map(() => {
      const scene = new ThreeScene(SKIN, { models });
      scene.sync(frame(5, [thing({ anim: { state: 'walk', t: 12 } })]));
      const b = bounds(scene.entity('t1')!);
      return [
        b.min.toArray(),
        b.max.toArray(),
        new Vector3().copy(scene.entity('t1')!.getObjectByName('head')!.position).toArray(),
      ];
    });
    expect(shots[0]).toEqual(shots[1]);
    expect(JSON.stringify(SKIN)).toBe(before);
  });
});
