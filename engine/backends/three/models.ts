import {
  AnimationMixer,
  Box3,
  Euler,
  Group,
  Mesh,
  Vector3,
  type AnimationAction,
  type AnimationClip,
  type Material,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneObject } from 'three/addons/utils/SkeletonUtils.js';
import { gltfToGlb, readGltfText } from '@engine/core/content/gltf';
import { dataUrlBytes } from '@engine/core/content/png';
import { skinModelUses, type DeepReadonly, type SkinFile, type SkinModel } from '@engine/core/present';

/** A parsed glTF model: its scene (never shown itself; instances are clones) and its clips. */
export interface LoadedModel {
  scene: Group;
  clips: AnimationClip[];
}

/** Where a model stands in the library. */
export type ModelStatus = 'missing' | 'loading' | 'ready' | 'failed';

/**
 * The glTF/GLB models of a game (Engine 0.16 T11), loaded with three's `GLTFLoader` from the game's
 * asset files (`content.assets`: the `{ path: data URL }` pairs the content loader keeps), each
 * parsed once and cached. A `.gltf` (its buffers embedded as `data:` URIs) is packed into a GLB
 * first (`gltfToGlb`), so no loader fetches anything and it parses in Node as in a browser (no
 * WebGL, no DOM). `get(path)` starts loading on first ask and gives null until the model is
 * there: the scene shows the entry's text mesh meanwhile. `preload(skins)` loads every model the
 * skins name; a page or the screenshot tool awaits it before the first frame.
 */
export class ModelLibrary {
  private readonly loader = new GLTFLoader();
  private readonly models = new Map<string, LoadedModel>();
  private readonly errors = new Map<string, string>();
  private readonly pending = new Map<string, Promise<LoadedModel | null>>();

  constructor(private readonly assets: Readonly<Record<string, string>> = {}) {}

  /** The model at `path` when loaded, else null (and it starts loading, unless it failed or is missing). */
  get(path: string): LoadedModel | null {
    const model = this.models.get(path);
    if (model) return model;
    void this.load(path);
    return null;
  }

  status(path: string): ModelStatus {
    if (this.models.has(path)) return 'ready';
    if (this.errors.has(path)) return this.assets[path] === undefined ? 'missing' : 'failed';
    return this.pending.has(path) ? 'loading' : this.assets[path] === undefined ? 'missing' : 'loading';
  }

  /** Why the model at `path` could not be loaded, or undefined. */
  error(path: string): string | undefined {
    return this.errors.get(path);
  }

  /** Loads the model at `path` (once); resolves to it, or to null when it is missing or broken. */
  load(path: string): Promise<LoadedModel | null> {
    const model = this.models.get(path);
    if (model) return Promise.resolve(model);
    if (this.errors.has(path)) return Promise.resolve(null);
    let pending = this.pending.get(path);
    if (!pending) {
      pending = this.parse(path).then(
        (loaded) => {
          this.models.set(path, loaded);
          this.pending.delete(path);
          return loaded;
        },
        (error: unknown) => {
          this.errors.set(path, error instanceof Error ? error.message : String(error));
          this.pending.delete(path);
          return null;
        },
      );
      this.pending.set(path, pending);
    }
    return pending;
  }

  /** Loads every model the skins name (kinds' and tiles'); resolves when all are loaded or failed. */
  async preload(skins: readonly DeepReadonly<SkinFile>[]): Promise<void> {
    const paths = new Set(skins.flatMap((s) => skinModelUses(s).map((u) => u.model)));
    await Promise.all([...paths].map((p) => this.load(p)));
  }

  /** Frees the cached models' geometries and materials (instances made from them must be gone). */
  dispose(): void {
    for (const model of this.models.values()) {
      model.scene.traverse((o) => {
        if (!(o instanceof Mesh)) return;
        o.geometry.dispose();
        for (const m of materialList(o.material)) m.dispose();
      });
    }
    this.models.clear();
  }

  private async parse(path: string): Promise<LoadedModel> {
    const data = this.assets[path];
    if (data === undefined) throw new Error(`no asset file "${path}"`);
    let bytes = dataUrlBytes(data) ?? new TextEncoder().encode(data);
    if (/\.gltf$/i.test(path)) {
      const read = readGltfText(bytes);
      if (!read.ok) throw new Error(`${path}: ${read.message}`);
      bytes = gltfToGlb(read.json);
    }
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await this.loader.parseAsync(buffer, '');
    gltf.scene.name = `model:${path}`;
    gltf.scene.updateMatrixWorld(true);
    return { scene: gltf.scene, clips: gltf.animations };
  }
}

function materialList(m: Material | Material[]): Material[] {
  return Array.isArray(m) ? m : [m];
}

/**
 * One entity's (or tile cell's) copy of a loaded model: a clone (skinned meshes keep their own
 * bones) under `object`, turned by the entry's `rotate`, scaled by its `scale` and placed by its
 * `anchor` on the box's bottom centre (the parent's origin), then moved by its `offset` and `z`.
 * Geometries are the library's; materials are its own (so `fx.alpha` on one entity leaves the
 * others alone). `pose(clip, time)` plays a clip by name at a time in seconds (looped), with an
 * `AnimationMixer` set to exactly that time each call: the same frame always shows the same pose.
 */
export class ModelInstance {
  /** The instance, at the box's bottom centre (add it to the entity root). */
  readonly object = new Group();
  /** Its own materials (one per mesh material of the model). */
  readonly materials: Material[] = [];
  private readonly mixer: AnimationMixer;
  private readonly clips: AnimationClip[];
  private action: AnimationAction | null = null;
  private clip: string | null = null;

  constructor(model: LoadedModel, spec: DeepReadonly<SkinModel>, box: { w: number; h: number }) {
    const inner = cloneObject(model.scene);
    this.clips = model.clips;
    const own = new Map<Material, Material>();
    inner.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const copy = (m: Material) => {
        let c = own.get(m);
        if (!c) {
          own.set(m, (c = m.clone()));
          this.materials.push(c);
        }
        return c;
      };
      o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material);
      o.castShadow = spec.castShadow;
    });
    const deg = Math.PI / 180;
    const turn = new Euler(spec.rotate.x * deg, spec.rotate.y * deg, spec.rotate.z * deg, 'XYZ');
    inner.rotation.copy(turn);
    inner.scale.setScalar(spec.scale);
    inner.position.set(0, 0, 0);
    this.object.add(inner);
    this.object.updateMatrixWorld(true);
    // The model point that goes on the box: from its rest-pose bounds, or a point in model units.
    const point = new Vector3();
    const target = new Vector3();
    const anchor = spec.anchor;
    if (typeof anchor === 'string') {
      if (anchor !== 'origin') {
        const bounds = new Box3().setFromObject(inner, true);
        if (!bounds.isEmpty()) {
          bounds.getCenter(point);
          if (anchor === 'bottom') point.y = bounds.min.y;
          else target.y = box.h / 2;
        }
      }
    } else point.set(anchor.x, anchor.y, anchor.z).applyEuler(turn).multiplyScalar(spec.scale);
    inner.position.copy(target.sub(point)).add(new Vector3(spec.offset.x, -spec.offset.y, spec.offset.z));
    this.object.name = 'model';
    this.mixer = new AnimationMixer(inner);
  }

  /** The clip playing now (null: the rest pose). */
  get playing(): string | null {
    return this.clip;
  }

  /** Shows `clip` (by name; null or a name the model lacks: the rest pose) at `time` seconds, looped. */
  pose(clip: string | null, time: number): void {
    const found = clip === null ? undefined : this.clips.find((c) => c.name === clip);
    const name = found ? found.name : null;
    if (name !== this.clip) {
      this.mixer.stopAllAction();
      this.action = found ? this.mixer.clipAction(found) : null;
      this.action?.play();
      this.clip = name;
    }
    if (this.action) this.mixer.setTime(time);
  }

  /** Every mesh of the instance (for tests and shadow settings). */
  meshes(): Mesh[] {
    const out: Mesh[] = [];
    this.object.traverse((o: Object3D) => {
      if (o instanceof Mesh) out.push(o);
    });
    return out;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
    for (const m of this.materials) m.dispose();
  }
}
