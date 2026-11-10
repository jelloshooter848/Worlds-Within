import { describe, expect, it } from 'vitest';
import {
  AmbientLight,
  DirectionalLight,
  Fog,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  PerspectiveCamera,
  PointLight,
  type Object3D,
} from 'three';
import {
  DEFAULT_SHADOW,
  freezeFrame,
  skinSchema,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type SkinFile,
} from '@engine/core/present';
import { buildFont, type FontLookup } from '@engine/core/ui';
import { POINT_LIGHT_DECAY, ThreeScene } from './scene';

// Engine 0.16 T12: lights, shadows, fog, tone mapping and world-anchored labels in the 3D scene.

/** A plain `three` skin with no `scene3d` (lit as every skin was before T12). */
const PLAIN: SkinFile = {
  backend: 'three',
  kinds: {
    hero: { mesh: 'box', color: '#d82800' },
    torch: { mesh: 'cylinder', color: '#503000' },
  },
  tiles: { '#': { mesh: 'box', color: '#c84c0c' } },
  camera3d: { fov: 40, tilt: 0, layerDepth: 16, lights: { ambient: 0.5, directional: 0.9 } },
};

/** The same skin opting in to everything T12 adds. */
const LIT: SkinFile = {
  ...PLAIN,
  kinds: {
    hero: { mesh: 'box', color: '#d82800', castShadow: true, receiveShadow: true },
    torch: {
      mesh: 'cylinder',
      color: '#503000',
      light: {
        kind: 'point',
        color: '#f8b800',
        intensity: 40,
        distance: 64,
        offset: { x: 0, y: -10, z: 4 },
        flicker: 0.5,
      },
    },
  },
  tiles: { '#': { mesh: 'box', color: '#c84c0c', castShadow: true, receiveShadow: true } },
  scene3d: {
    sun: {
      color: '#fff4d8',
      intensity: 1.5,
      direction: { x: -2, y: 3, z: 2 },
      shadow: { mapSize: 512, radius: 3 },
    },
    ambient: { color: '#b8c8ff', intensity: 0.3 },
    hemisphere: { sky: '#a4e4fc', ground: '#503000', intensity: 0.6 },
    fog: { kind: 'linear', color: '#a4e4fc', near: 40, far: 600 },
    toneMapping: { kind: 'aces', exposure: 1.2 },
    colorSpace: 'srgb',
  },
  labels: {
    hero: [
      { from: { tag: 'name:' }, as: 'text', font: 'f', color: '#fcfcfc' },
      { from: { tag: 'hp:' }, as: 'bar', max: 'maxHp', w: 10, h: 2, back: '#000000' },
    ],
    torch: { from: { status: 'left' }, as: 'timer', font: 'f', anchor: 'bottom', offset: { x: 0, y: 2 } },
  },
};

/** A tiny font: every glyph a 2x3 block, advance 3. */
const FONT = buildFont('f', {
  cell: { w: 2, h: 3 },
  baseline: 3,
  glyphs: Object.fromEntries([...'Pip0123456789:'].map((c) => [c, { rows: ['##', '##', '##'] }])),
});
const fonts: FontLookup = (id) => (id === 'f' ? FONT : null);

const MAP: PresentMap = {
  id: 'm',
  version: 0,
  tileSize: 16,
  cols: 8,
  rows: 4,
  tiles: ['........', '........', '........', '########'],
};

const hero = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  id: 'p1',
  kind: 'hero',
  x: 40,
  y: 32,
  w: 16,
  h: 16,
  facing: 'right',
  anim: { state: 'idle', t: 0 },
  tags: ['name:Pip', 'hp:3'],
  ...over,
});
const torch = (over: Partial<PresentEntity> = {}): PresentEntity => ({
  ...hero(),
  id: 't1',
  kind: 'torch',
  x: 80,
  tags: [],
  ...over,
});

function frame(over: Partial<PresentFrame> = {}): PresentFrame {
  return {
    frame: 0,
    size: { width: 128, height: 64 },
    entities: [hero(), torch()],
    map: MAP,
    events: [],
    status: { maxHp: 4, left: 125 },
    camera: { x: 0, y: 0 },
    ...over,
  };
}

const all = (root: Object3D): Object3D[] => {
  const out: Object3D[] = [];
  root.traverse((o) => out.push(o));
  return out;
};

describe('scene3d skins (Engine 0.16 T12)', () => {
  it('both fixture skins validate', () => {
    expect(skinSchema.safeParse(PLAIN).success).toBe(true);
    expect(skinSchema.safeParse(LIT).success).toBe(true);
  });

  it('a skin without scene3d keeps the lights and objects it had: no fog, shadows, point lights or tone mapping', () => {
    const scene = new ThreeScene(PLAIN);
    scene.sync(freezeFrame(frame()));
    const top = scene.scene.children.map((c) => c.constructor.name);
    expect(top.slice(0, 4)).toEqual([
      AmbientLight.name,
      DirectionalLight.name,
      PerspectiveCamera.name,
      'Group',
    ]);
    expect(scene.scene.children.filter((c) => c instanceof HemisphereLight)).toEqual([]);
    expect(scene.scene.fog).toBeNull();
    expect(scene.ambient.intensity).toBe(0.5);
    expect(scene.ambient.color.getHexString()).toBe('ffffff');
    expect(scene.sun.intensity).toBe(0.9);
    expect(scene.sun.position.toArray()).toEqual([-1, 2, 3]);
    expect(scene.sun.castShadow).toBe(false);
    expect(scene.hemisphere).toBeNull();
    const objects = all(scene.scene);
    expect(objects.some((o) => o instanceof PointLight)).toBe(false);
    expect(objects.some((o) => (o as Mesh).castShadow || (o as Mesh).receiveShadow)).toBe(false);
    expect(scene.look.toneMapping).toEqual({ kind: 'none', exposure: 1 });
    expect(scene.look.colorSpace).toBe('srgb');
    expect(scene.labels.quads()).toEqual([]);
    expect(scene.labelViews()).toEqual([]);
  });

  it('configures the sun, ambient, hemisphere, shadows, fog and tone mapping from the skin', () => {
    const scene = new ThreeScene(LIT, { fonts });
    scene.sync(freezeFrame(frame()));
    expect(scene.ambient.color.getHexString()).toBe('b8c8ff');
    expect(scene.ambient.intensity).toBe(0.3);
    expect(scene.sun.color.getHexString()).toBe('fff4d8');
    expect(scene.sun.intensity).toBe(1.5);
    expect(scene.sun.castShadow).toBe(true);
    expect(scene.sun.shadow.mapSize.toArray()).toEqual([512, 512]);
    expect(scene.sun.shadow.radius).toBe(3);
    expect(scene.sun.shadow.bias).toBe(DEFAULT_SHADOW.bias);
    // The sun shines from its direction onto the view's centre, its shadow camera round the view.
    const target = scene.sun.target.position;
    const view = scene.view!;
    expect(target.x).toBeCloseTo(view.x + view.w / 2);
    expect(target.y).toBeCloseTo(-(view.y + view.h / 2));
    const d = scene.sun.position.clone().sub(target).normalize();
    const want = { x: -2, y: 3, z: 2 };
    const len = Math.hypot(want.x, want.y, want.z);
    expect(d.x).toBeCloseTo(want.x / len);
    expect(d.y).toBeCloseTo(want.y / len);
    expect(d.z).toBeCloseTo(want.z / len);
    const cam = scene.sun.shadow.camera;
    expect(cam.right - cam.left).toBeGreaterThan(Math.hypot(view.w, view.h));
    expect(scene.hemisphere).toBeInstanceOf(HemisphereLight);
    expect(scene.hemisphere!.color.getHexString()).toBe('a4e4fc');
    expect(scene.hemisphere!.groundColor.getHexString()).toBe('503000');
    expect(scene.hemisphere!.intensity).toBe(0.6);
    // Linear fog is given behind the z = 0 plane; Three measures it from the camera.
    const fog = scene.scene.fog as Fog;
    expect(fog).toBeInstanceOf(Fog);
    expect(fog.color.getHexString()).toBe('a4e4fc');
    const distance = scene.camera.position.z;
    expect(fog.near).toBeCloseTo(distance + 40);
    expect(fog.far).toBeCloseTo(distance + 600);
    expect(scene.look.toneMapping).toEqual({ kind: 'aces', exposure: 1.2 });
    // The HUD layers are drawn as written, never tone mapped.
    expect(scene.overlay.material.toneMapped).toBe(false);
  });

  it('exp2 fog and the AgX and linear output options', () => {
    const scene = new ThreeScene({
      ...PLAIN,
      scene3d: {
        fog: { kind: 'exp2', color: '#000000', density: 0.002 },
        toneMapping: { kind: 'agx' },
        colorSpace: 'linear',
      },
    });
    expect(scene.scene.fog).toBeInstanceOf(FogExp2);
    expect((scene.scene.fog as FogExp2).density).toBe(0.002);
    expect(scene.look.toneMapping).toEqual({ kind: 'agx', exposure: 1 });
    expect(scene.look.colorSpace).toBe('linear');
    // Without `sun` and `ambient` the camera3d intensities still light it.
    expect(scene.sun.intensity).toBe(0.9);
    expect(scene.ambient.intensity).toBe(0.5);
  });

  it('casts and receives shadows on the kinds and tiles that ask', () => {
    const scene = new ThreeScene(LIT, { fonts });
    scene.sync(freezeFrame(frame()));
    const heroMeshes = all(scene.entity('p1')!).filter((o): o is Mesh => o instanceof Mesh);
    expect(heroMeshes.length).toBeGreaterThan(0);
    for (const m of heroMeshes) expect([m.castShadow, m.receiveShadow]).toEqual([true, true]);
    const torchMeshes = all(scene.entity('t1')!).filter((o): o is Mesh => o instanceof Mesh);
    for (const m of torchMeshes) expect([m.castShadow, m.receiveShadow]).toEqual([false, false]);
    const blocks = scene.map!.children.filter((c): c is InstancedMesh => c instanceof InstancedMesh);
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect([b.castShadow, b.receiveShadow]).toEqual([true, true]);
  });

  it("a kind's point light sits on each entity, flickering the same each run", () => {
    const run = (seed: number) => {
      const scene = new ThreeScene(LIT, { fonts, seed });
      const out: number[] = [];
      for (let f = 0; f < 6; f++) {
        scene.sync(freezeFrame(frame({ frame: f })));
        out.push(scene.pointLights()[0]!.light.intensity);
      }
      return { scene, out };
    };
    const { scene, out } = run(7);
    const lights = scene.pointLights();
    expect(lights.map((l) => l.id)).toEqual(['t1']);
    const light = lights[0]!.light;
    expect(light.parent).toBe(scene.entity('t1'));
    expect(light.color.getHexString()).toBe('f8b800');
    expect(light.distance).toBe(64);
    expect(light.decay).toBe(POINT_LIGHT_DECAY);
    // At the box's centre (8 px above its bottom) plus the offset (y down, so 10 px higher).
    expect(light.position.toArray()).toEqual([0, 8 + 10, 4]);
    for (const v of out) {
      expect(v).toBeGreaterThan(40 * 0.5 - 1e-9);
      expect(v).toBeLessThanOrEqual(40);
    }
    expect(new Set(out).size).toBeGreaterThan(1);
    expect(run(7).out).toEqual(out);
    expect(run(8).out).not.toEqual(out);
    // The light goes with its entity.
    scene.sync(freezeFrame(frame({ frame: 9, entities: [hero()] })));
    expect(scene.pointLights()).toEqual([]);
    expect(all(scene.scene).some((o) => o instanceof PointLight)).toBe(false);
  });
});

describe('world-anchored labels (Engine 0.16 T12)', () => {
  it('projects each label to the entity on the picture: a name above a health bar, a timer below', () => {
    const scene = new ThreeScene(LIT, { fonts });
    scene.sync(freezeFrame(frame()));
    const view = scene.view!;
    // Tilt 0 at zoom 1: a world point on the z = 0 plane lands at (x - view.x, y - view.y).
    const sx = (wx: number) => wx - view.x;
    const sy = (wy: number) => wy - view.y;
    const views = scene.labelViews();
    expect(views.map((v) => [v.entity, v.as, v.text ?? v.bar])).toEqual([
      ['p1', 'text', 'Pip'],
      ['p1', 'bar', { value: 3, max: 4 }],
      ['t1', 'timer', '0:03'],
    ]);
    const [name, bar, timer] = views;
    // The name: centred on the box's top centre, its bottom 2 px above it.
    expect(name!.box.w).toBe(8);
    expect(name!.box.x).toBe(Math.round(sx(48) - 4));
    expect(name!.box.y + name!.box.h).toBe(Math.round(sy(32) - 2));
    // The bar is stacked above it (1 px apart).
    expect(bar!.box).toEqual({ x: Math.round(sx(48) - 5), y: name!.box.y - 1 - 2, w: 10, h: 2 });
    // The timer hangs from the torch's bottom, 2 px down.
    expect(timer!.box.y).toBe(Math.round(sy(48) + 2));
    expect(timer!.box.x).toBe(Math.round(sx(88) - timer!.box.w / 2));
    // Quads on the labels layer: the name's glyphs, the bar's back and fill, the timer's glyphs.
    const quads = scene.labels.quads();
    expect(quads.filter((q) => q.kind === 'glyph')).toHaveLength(3 + 4);
    expect(quads.filter((q) => q.kind === 'fill')).toHaveLength(2);
  });

  it('hides a label whose anchor is off the picture or behind the camera, and follows the entity', () => {
    const scene = new ThreeScene(LIT, { fonts });
    scene.sync(freezeFrame(frame({ entities: [hero({ x: 400 }), torch({ layer: 1000 })] })));
    expect(scene.labelViews()).toEqual([]);
    expect(scene.labels.quads()).toEqual([]);
    scene.sync(freezeFrame(frame({ frame: 1, entities: [hero({ x: 20 })] })));
    const moved = scene.labelViews();
    expect(moved).toHaveLength(2);
    expect(moved[0]!.box.x).toBe(Math.round(28 - scene.view!.x - 4));
  });

  it('skips a label without a value or a font, and never changes the frame or the skin', () => {
    const skin = structuredClone(LIT);
    const scene = new ThreeScene(Object.freeze(skin), {});
    scene.sync(freezeFrame(frame({ entities: [hero({ tags: [] })] })));
    // No font: no text; no `hp:` tag: no bar.
    expect(scene.labelViews()).toEqual([]);
    expect(skin).toEqual(LIT);
  });
});
