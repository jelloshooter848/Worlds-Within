import { describe, expect, it } from 'vitest';
import { Box3, Color, InstancedMesh, Matrix4, Mesh, type Object3D } from 'three';
import { base64, encodeGlb, lowPolyModel } from '@engine/core/content/gltf';
import { assetDataUrl } from '@engine/core/content/png';
import {
  freezeFrame,
  placeDecor,
  skinSchema,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
  type SkinModel,
} from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { ModelInstance, ModelLibrary, modelMeshParts } from './models';
import { ThreeScene } from './scene';

// Engine 0.16 F3: model tiles as InstancedMeshes, per-cell variation, decor and places, render scale.

/** A tree: a trunk and a crown (two meshes), standing on y = 0. */
const TREE = lowPolyModel([
  {
    name: 'trunk',
    shape: 'box',
    size: { x: 0.2, y: 0.6, z: 0.2 },
    at: { x: 0, y: 0.3, z: 0 },
    color: '#503000',
  },
  {
    name: 'crown',
    shape: 'octahedron',
    size: { x: 1, y: 1, z: 1 },
    at: { x: 0, y: 1.1, z: 0 },
    color: '#00a800',
  },
]);
/** A rock: one mesh. */
const ROCK = lowPolyModel([
  {
    name: 'rock',
    shape: 'octahedron',
    size: { x: 1, y: 0.6, z: 1 },
    at: { x: 0, y: 0.3, z: 0 },
    color: '#7c7c7c',
  },
]);
const TREE_GLB = 'assets/pack/tree.glb';
const ROCK_GLB = 'assets/pack/rock.glb';
const ASSETS = {
  [TREE_GLB]: assetDataUrl(TREE_GLB, base64(encodeGlb(TREE.json, TREE.bin))),
  [ROCK_GLB]: assetDataUrl(ROCK_GLB, base64(encodeGlb(ROCK.json, ROCK.bin))),
};

const FONT = buildFont('f', {
  cell: { w: 2, h: 3 },
  baseline: 3,
  glyphs: Object.fromEntries([...'THEALW'].map((c) => [c, { rows: ['##', '##', '##'] }])),
  space: 2,
});
const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);

/** A 48 x 32 map: every cell grass (`.`), trees (`T`) and rocks (`o`) in a pattern. */
const ROWS = Array.from({ length: 32 }, (_, r) =>
  Array.from({ length: 48 }, (_, c) =>
    (r * 48 + c) % 7 === 0 ? 'T' : (r * 48 + c) % 11 === 0 ? 'o' : '.',
  ).join(''),
);
const MAP: PresentMap = { id: 'field', version: 0, tileSize: 16, cols: 48, rows: 32, tiles: ROWS };

const skin = (over: Record<string, unknown> = {}, camera3d: Record<string, unknown> = {}) =>
  skinSchema.parse({
    backend: 'three',
    kinds: {},
    camera3d: { view: 'ground', pitch: 60, ...camera3d },
    tiles: {
      '.': { mesh: 'box', color: '#00a800', depth: 2 },
      T: { mesh: 'box', color: '#005800', model: TREE_GLB, scale: 12, castShadow: true, receiveShadow: true },
      o: {
        mesh: 'box',
        color: '#7c7c7c',
        model: ROCK_GLB,
        scale: 8,
        vary: { turn: true, height: 0.2, tint: 0.2 },
      },
    },
    ...over,
  }) as SkinFile;

const frame = (n: number, map: PresentMap = MAP) =>
  freezeFrame<PresentFrame>({
    frame: n,
    size: { width: 320, height: 180 },
    entities: [],
    map,
    events: [],
    status: {},
    camera: { x: 24 * 16, y: 16 * 16 },
  });

async function library(): Promise<ModelLibrary> {
  const models = new ModelLibrary(ASSETS);
  await Promise.all([models.load(TREE_GLB), models.load(ROCK_GLB)]);
  return models;
}

/** Every drawable object under `root` (a mesh or an instanced mesh: one draw each per material). */
function drawables(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) out.push(o);
  });
  return out;
}

describe('model tiles as InstancedMeshes (Engine 0.16 F3)', () => {
  it('draws a 48 x 32 map as one InstancedMesh per tile key and model mesh (in first-cell order), not a clone per cell', async () => {
    const models = await library();
    const scene = new ThreeScene(skin(), { models });
    scene.sync(frame(0));
    const trees = ROWS.join('')
      .split('')
      .filter((c) => c === 'T').length;
    const rocks = ROWS.join('')
      .split('')
      .filter((c) => c === 'o').length;
    expect(trees).toBeGreaterThan(200);
    const draws = drawables(scene.map!);
    expect(draws.map((d) => [d.name, (d as InstancedMesh).count])).toEqual([
      ['tile:T:model:0', trees],
      ['tile:T:model:1', trees],
      ['tile:.:0', 48 * 32 - trees - rocks],
      ['tile:o:model:0', rocks],
    ]);
    expect(draws.every((d) => d instanceof InstancedMesh)).toBe(true);
    // The tree meshes share the library's geometry, cast and receive shadows.
    const trunk = scene.map!.getObjectByName('tile:T:model:0') as InstancedMesh;
    expect(trunk.castShadow).toBe(true);
    expect(trunk.receiveShadow).toBe(true);
    expect(trunk.userData).toMatchObject({ tile: 'T', model: TREE_GLB, shared: true });
    scene.dispose();
    // Freeing the scene leaves the library's model whole for the next scene.
    const again = new ThreeScene(skin(), { models });
    again.sync(frame(0));
    expect(drawables(again.map!).length).toBe(4);
  });

  it('places each instance where a ModelInstance would show it (no vary: to float32 precision)', async () => {
    const models = await library();
    const scene = new ThreeScene(skin(), { models });
    scene.sync(frame(0));
    const crown = scene.map!.getObjectByName('tile:T:model:1') as InstancedMesh;
    const spec: SkinModel = {
      model: TREE_GLB,
      scale: 12,
      anchor: 'bottom',
      rotate: { x: 0, y: 0, z: 0 },
      castShadow: true,
      clip: null,
      time: 0,
      offset: { x: 0, y: 0, z: 0 },
      materials: {},
      tint: null,
    };
    const copy = new ModelInstance(models.get(TREE_GLB)!, spec, { w: 16, h: 16 });
    // The first tree is cell 0 (col 0, row 0): its centre on the floor.
    copy.object.position.set(8, 0, 8);
    copy.object.updateMatrixWorld(true);
    const want = copy.object.getObjectByName('crown')!.matrixWorld;
    const got = new Matrix4();
    crown.getMatrixAt(0, got);
    got.elements.forEach((v, i) => expect(v).toBeCloseTo(want.elements[i]!, 5));
    // modelMeshParts is the same placement without a copy.
    const parts = modelMeshParts(models.get(TREE_GLB)!, spec, { w: 16, h: 16 })!;
    expect(parts.map((p) => p.name)).toEqual(['trunk', 'crown']);
  });

  it('varies cells by the presentation RNG (turn, height, tint), the same each build and seed', async () => {
    const models = await library();
    const read = (seed: number) => {
      const scene = new ThreeScene(skin(), { models, seed });
      scene.sync(frame(0));
      const rock = scene.map!.getObjectByName('tile:o:model:0') as InstancedMesh;
      const m = new Matrix4();
      const c = new Color();
      return Array.from({ length: 12 }, (_, i) => {
        rock.getMatrixAt(i, m);
        rock.getColorAt(i, c);
        return [...m.elements.map((v) => Math.round(v * 1e6)), Math.round(c.r * 1e6)];
      });
    };
    const a = read(1);
    expect(read(1)).toEqual(a);
    expect(read(2)).not.toEqual(a);
    // Some rocks turned (their x axis is not +x), tints differ between cells.
    expect(a.some((m) => m[0] !== a[0]![0])).toBe(true);
    expect(new Set(a.map((m) => m[16])).size).toBeGreaterThan(1);
    // A tile without `vary` has no instance colours.
    const scene = new ThreeScene(skin(), { models });
    scene.sync(frame(0));
    expect((scene.map!.getObjectByName('tile:T:model:0') as InstancedMesh).instanceColor).toBeNull();
  });
});

const DECOR_ROWS = ROWS.map((row, r) =>
  [...row]
    .map((_, c) => (r === 4 && c < 10 ? 'b' : r === 6 && c === 3 ? 'r' : r === 8 && c === 5 ? 'x' : '.'))
    .join(''),
);
const DECOR = {
  field: {
    grid: 'field',
    legend: {
      b: { model: [TREE_GLB, ROCK_GLB], scale: [6, 9], yaw: 'random', jitter: 3, castShadow: true },
      r: { model: ROCK_GLB, scale: 10, yaw: 90, offset: { x: 2, y: 0, z: 0 }, instanced: false },
    },
  },
};
const PLACES = {
  field: [
    { text: 'THE HALL', x: 24 * 16, y: 16 * 16, font: 'f', color: '#f8b800', outline: '#000000' },
    { text: 'THE WALL', x: 0, y: 40 * 16, font: 'f' },
  ],
};

describe('decor and places (Engine 0.16 F3)', () => {
  it('places the skin decor for the map from its grid, instanced per char and model, deterministically', async () => {
    const models = await library();
    const s = skin({ decor: DECOR });
    const build = () => {
      const scene = new ThreeScene(s, { models, decor: { field: DECOR_ROWS }, seed: 3 });
      scene.sync(frame(0));
      return scene;
    };
    const scene = build();
    const placed = placeDecor(s.decor!['field']!, DECOR_ROWS, 'field', 3);
    // 10 `b` cells, one `r`; the `x` has no legend entry and places nothing.
    expect(placed.map((p) => p.char).join('')).toBe('bbbbbbbbbbr');
    const decor = drawables(scene.map!).filter((d) => d.name.startsWith('decor:'));
    // Batches in the order each model first shows: a tree is two meshes, a rock one.
    const order = [...new Set(placed.filter((p) => p.char === 'b').map((p) => p.model))];
    const count = (m: string) => placed.filter((p) => p.char === 'b' && p.model === m).length;
    const want = order.flatMap((m) =>
      (m === TREE_GLB ? [0, 1] : [0]).map((i) => [`decor:b:${m}:${i}`, count(m)]),
    );
    expect(
      decor.filter((d) => d instanceof InstancedMesh).map((d) => [d.name, (d as InstancedMesh).count]),
    ).toEqual(want);
    expect(decor.find((d) => d instanceof InstancedMesh)!.castShadow).toBe(true);
    // `instanced: false`: one copy, its yaw a quarter turn clockwise from above, at its cell plus offset.
    const copy = scene.map!.getObjectByName('decor:r')!;
    expect(copy.userData).toMatchObject({ decor: 'r', model: ROCK_GLB, col: 3, row: 6 });
    expect(copy.position.toArray()).toEqual([3 * 16 + 8 + 2, 0, 6 * 16 + 8]);
    expect(copy.rotation.y).toBeCloseTo(-Math.PI / 2, 9);
    const b = new Box3().setFromObject(copy);
    expect(b.max.y - b.min.y).toBeCloseTo(6, 6); // 0.6 units x 10 px
    // The same seed builds the same scene.
    const again = build();
    const mats = (sc: ThreeScene) =>
      drawables(sc.map!)
        .filter((d) => d instanceof InstancedMesh && d.name.startsWith('decor:'))
        .map((d) => Array.from((d as InstancedMesh).instanceMatrix.array));
    expect(mats(again)).toEqual(mats(scene));
  });

  it('shows no decor without the grid lookup or for another map', async () => {
    const models = await library();
    const plain = new ThreeScene(skin({ decor: DECOR }), { models });
    plain.sync(frame(0));
    expect(drawables(plain.map!).some((d) => d.name.startsWith('decor:'))).toBe(false);
    const other = new ThreeScene(skin({ decor: DECOR }), { models, decor: { field: DECOR_ROWS } });
    other.sync(frame(0, { ...MAP, id: 'elsewhere' }));
    expect(drawables(other.map!).some((d) => d.name.startsWith('decor:'))).toBe(false);
  });

  it("draws the map's places on the label layer at their projected world points, hiding those off the picture", () => {
    const scene = new ThreeScene(skin({ places: PLACES }), { fonts });
    scene.sync(frame(0));
    const views = scene.labelViews();
    expect(views.map((v) => [v.entity, v.kind, v.text])).toEqual([['place:0', 'place', 'THE HALL']]);
    // Centred on the projected point (the camera looks at it: the picture's centre).
    const p = scene.groundProjection!.worldToScreen(24 * 16, 16 * 16, 0)!;
    const box = views[0]!.box;
    expect(Math.abs(box.x + box.w / 2 - p.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.h / 2 - p.y)).toBeLessThanOrEqual(1);
    expect(scene.labels.quads().length).toBeGreaterThan(0);
    // Another map shows no places.
    scene.sync(frame(1, { ...MAP, id: 'elsewhere' }));
    expect(scene.labelViews()).toEqual([]);
  });

  it('draws places in side view too', () => {
    const side = skinSchema.parse({ backend: 'three', kinds: {}, places: PLACES }) as SkinFile;
    const scene = new ThreeScene(side, { fonts });
    scene.sync(frame(0));
    expect(scene.labelViews().map((v) => v.text)).toEqual(['THE HALL']);
  });
});

describe('decor lights and emitters (Engine 0.16 F6)', () => {
  const lit = () =>
    skin({
      emitters: {
        smoke: { rate: 1, life: [20, 20], speed: [0.2, 0.2], angle: [270, 270], size: 2, color: '#7c7c7c' },
      },
      decor: {
        field: {
          grid: 'field',
          legend: {
            b: { model: TREE_GLB, scale: 6 },
            r: {
              model: ROCK_GLB,
              scale: 8,
              light: {
                kind: 'point',
                color: '#ffa040',
                intensity: 30,
                distance: 80,
                offset: { x: 0, y: -6, z: 0 },
                flicker: 0.4,
              },
              emit: 'smoke',
            },
          },
        },
      },
    });

  it('puts a flickering point light on each lit cell and runs its emitters there, the same every build', async () => {
    const models = await library();
    const build = () => {
      const scene = new ThreeScene(lit(), { models, decor: { field: DECOR_ROWS }, seed: 5 });
      const seen: number[] = [];
      for (let f = 0; f < 12; f++) {
        scene.sync(frame(f));
        seen.push(scene.decorLights()[0]!.light.intensity);
      }
      return { scene, seen };
    };
    const { scene, seen } = build();
    // One `r` cell (col 3, row 6): its light 6 px over the cell's centre on the floor.
    const lights = scene.decorLights();
    expect(lights.map((l) => l.id)).toEqual(['decor:field:3,6']);
    const light = lights[0]!.light;
    expect(light.name).toBe('light:decor:field:3,6');
    light.updateMatrixWorld(true);
    expect([light.position.x, light.position.y, light.position.z]).toEqual([3 * 16 + 8, 6, 6 * 16 + 8]);
    expect(Math.max(...seen)).toBeLessThanOrEqual(30);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(30 * 0.6);
    expect(new Set(seen).size).toBeGreaterThan(1);
    expect(build().seen).toEqual(seen);
    // Its smoke rises from the cell (no entity carries it).
    const smoke = scene.particleViews().filter((p) => p.emitter === 'smoke');
    expect(smoke.length).toBeGreaterThan(5);
    for (const p of smoke) expect(Math.abs(p.x - (3 * 16 + 8))).toBeLessThan(2);
    // A hidden map lights and smokes nothing.
    scene.sync({ ...frame(12), map: undefined } as unknown as PresentFrame);
    expect(scene.decorLights()).toEqual([]);
  });

  it("checks a decor entry's emitters name the skin's", () => {
    const bad = skinSchema.safeParse({
      backend: 'three',
      kinds: {},
      decor: { field: { grid: 'field', legend: { r: { model: ROCK_GLB, emit: 'none' } } } },
    });
    expect(bad.success).toBe(false);
    expect(JSON.stringify(bad.error?.issues)).toContain('no emitter');
  });
});

describe('render scale (Engine 0.16 F3)', () => {
  it("is the option, else the skin's scene3d.renderScale, else 1, and scales particle point sizes", () => {
    expect(new ThreeScene(skin()).renderScale).toBe(1);
    expect(new ThreeScene(skin({ scene3d: { renderScale: 6 } })).renderScale).toBe(6);
    expect(new ThreeScene(skin({ scene3d: { renderScale: 6 } }), { renderScale: 2 }).renderScale).toBe(2);
    expect(() => skinSchema.parse({ backend: 'three', kinds: {}, scene3d: { renderScale: 1.5 } })).toThrow();
    expect(() => skinSchema.parse({ backend: 'three', kinds: {}, scene3d: { renderScale: 9 } })).toThrow();
    const uScale = (renderScale: number) => {
      const scene = new ThreeScene(skin(), { renderScale });
      scene.sync(frame(0));
      const points = scene.particles.children[0] as unknown as {
        material: { uniforms: { uScale: { value: number } } };
      };
      return points.material.uniforms.uScale.value;
    };
    expect(uScale(4)).toBeCloseTo(uScale(1) * 4, 9);
  });

  it('keeps the scene in picture px: the camera and labels do not move with the scale', () => {
    const at = (renderScale: number) => {
      const scene = new ThreeScene(skin({ places: PLACES }), { fonts, renderScale });
      scene.sync(frame(0));
      return {
        camera: scene.camera.position.toArray(),
        labels: scene.labelViews(),
        hud: scene.hud.camera.right,
      };
    };
    expect(at(6)).toEqual(at(1));
  });
});

describe('the whole campaign in 3D: skirt and labels clear of the HUD (Engine 0.16 F9)', () => {
  it('lays a skirt under a ground-view map, reaching its margin past every edge, lit and shadowed', () => {
    const scene = new ThreeScene(skin({ scene3d: { skirt: { color: '#497018', margin: 100 } } }));
    scene.sync(frame(0));
    const skirt = scene.map!.getObjectByName('skirt') as Mesh;
    expect(skirt).toBeInstanceOf(Mesh);
    expect(skirt.receiveShadow).toBe(true);
    expect(skirt.castShadow).toBe(false);
    const b = new Box3().setFromObject(skirt);
    expect([b.min.x, b.max.x, b.min.z, b.max.z]).toEqual([-100, 48 * 16 + 100, -100, 32 * 16 + 100]);
    expect(b.max.y).toBeLessThan(0); // under the floor
    // Without `skirt`, or in side view, there is none.
    const plain = new ThreeScene(skin());
    plain.sync(frame(0));
    expect(plain.map!.getObjectByName('skirt')).toBeUndefined();
    const side = new ThreeScene(
      skinSchema.parse({ backend: 'three', kinds: {}, scene3d: { skirt: { color: '#000000' } } }) as SkinFile,
    );
    side.sync(frame(0));
    expect(side.map!.getObjectByName('skirt')).toBeUndefined();
  });

  it('keeps labels out of the HUD panels and shows none while the frame hides the HUD', () => {
    const hud = (y: number) => [{ as: 'panel', x: 0, y, w: 320, h: 20, color: '#000000' }];
    const shown = (y: number, status: Record<string, number> = {}) => {
      const scene = new ThreeScene(skin({ places: PLACES, hud: hud(y) }), { fonts });
      scene.sync(freezeFrame<PresentFrame>({ ...(structuredClone(frame(0)) as PresentFrame), status }));
      return scene.labelViews().map((v) => v.text);
    };
    // THE HALL sits at the picture's centre (90 px down): a panel over it hides it.
    expect(shown(0)).toEqual(['THE HALL']);
    expect(shown(80)).toEqual([]);
    expect(shown(0, { hudHidden: 1 })).toEqual([]);
  });
});
