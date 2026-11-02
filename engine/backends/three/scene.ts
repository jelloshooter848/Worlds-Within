import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  Vector3,
  type Material,
} from 'three';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  cameraShake,
  cameraView,
  cameraZoom,
  CameraFollower,
  DEFAULT_FALLBACK_COLOR,
  facesLeft,
  isFullMap,
  resolveCamera3d,
  resolveMeshParts,
  resolveSkinKind,
  skinTagIndex,
  resolveSkinEvent,
  type DeepReadonly,
  type MeshPart,
  type PresentBox,
  type PresentEntity,
  type PresentFrame,
  type PresentMap,
  type PresentMapLayer,
  type SkinFile,
} from '@engine/core/present';
import { GeometryCache } from './geometry';

type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;
type Entity = DeepReadonly<PresentEntity>;
type Effect = NonNullable<NonNullable<SkinFile['events']>[string]['effect']>;

export interface ThreeSceneOptions {
  /** The picture size to frame the camera in; the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string) => void;
  /** The scene's background colour (default `#000`). */
  background?: string;
  /** Keep the camera inside the map or the hint's `bounds` (default: the skin's `camera.clamp`, else true). */
  clamp?: boolean;
  /** Skip `flash` effects (the player's reduced-flashing setting). */
  reduceFlashing?: boolean;
}

/** Ticks an effect lasts when the skin gives none (the same as the Canvas2D presenter). */
const EFFECT_TICKS: Record<Effect['kind'], number> = { flash: 2, particles: 12, shake: 8, tint: 6 };

/** Direction the one directional light shines from (toward the origin): up, left and in front. */
const SUN_FROM = new Vector3(-1, 2, 3);

/** Draw order of the full-screen effect overlay: after everything else. */
const OVERLAY_ORDER = 1_000_000;

/** One event effect still showing and the frame it began on. */
interface ActiveEffect {
  effect: DeepReadonly<Effect>;
  start: number;
}

/** The meshes kept for one entity id, and what they were built from. */
interface EntityNode {
  /** At the entity box's bottom centre; squash, mirror and turns apply about it. */
  root: Group;
  kind: string;
  w: number;
  h: number;
  /** The `byTag` look it was built with (-1: the kind's own). */
  look: number;
  materials: MeshLambertMaterial[];
}

/** The map being shown, its built blocks, and whether this frame shows it. */
interface ShownMap {
  map: DeepReadonly<PresentMap>;
  group: Group;
}

/**
 * The Three.js scene for the presentation contract: `sync(frame)` turns any read-only
 * `PresentFrame` and a `three` skin into a scene graph (`scene`) and a side-on perspective camera
 * (`camera`). It needs no WebGL, so it runs and is tested in Node; a renderer (`ThreePresenter`,
 * later) only draws what it holds.
 *
 * Axes: world px with x right, y flipped (Three's y is up, so `-y`), z toward the camera.
 *
 * - Map: blocks from the skin's `tiles` (`resolveMeshParts`), built once per map id and version
 *   (an `InstancedMesh` per tile key and mesh part) and reused for `{ id, version }` refs. Tiles
 *   the skin does not list stay empty. `map.tiles` sit at z = 0; extra `layers` behind them, layer
 *   `i` at z = -(i + 1) * `camera3d.layerDepth` (background scenery). A frame with no `map` hides it.
 * - Entities: one `Group` per entity id (made on first sight, updated, removed when gone; rebuilt
 *   when its kind or box size changes) at its box's bottom centre, at z = `layer` *
 *   `camera3d.layerDepth`. Facing left (or a left-hand diagonal, which
 *   maps to its horizontal cardinal) mirrors x; `fx` squash and stretch scale about the bottom
 *   centre, `rotate` turns clockwise on screen, `alpha` sets the materials' opacity. A kind the skin
 *   does not list (or whose entry gives no mesh) is a fallback box of its box size, as deep as it
 *   is wide, in `sheets.fallbackColor`, else `DEFAULT_FALLBACK_COLOR`.
 * - Camera: framing is `CameraFollower` (`@engine/core/present`), shared with the 2D backend.
 *   The view is the picture size divided by `zoom` (the hint's, else the skin's `camera.zoom`,
 *   else 1); the camera sits on the view's centre at the distance where the z = 0 plane shows
 *   exactly that view at the skin's `camera3d.fov`, so 2D and 3D frame the same world box. A
 *   `tilt` raises it and looks down at the same centre. Shake is added each frame, never stored.
 * - Lights: one ambient and one directional light (`camera3d.lights`), no shadows.
 * - Events: each listed event calls `onSound(sound)` once (a frame shown twice does not replay).
 *   Effects: `flash` and `tint` show as a full-screen overlay in front of the camera, `shake`
 *   wobbles the camera, `particles` are not drawn (a known gap).
 * - HUD: not drawn in Engine 0.6 (a known gap).
 *
 * It never changes the frame or the skin, and uses no clock or unseeded randomness (Three's own
 * object UUIDs never reach any state).
 */
export class ThreeScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;
  /** The full-screen flash and tint overlay, a child of the camera; hidden when no effect shows. */
  readonly overlay: Mesh<PlaneGeometry, MeshBasicMaterial>;

  private readonly skin: Skin;
  private readonly opts: ThreeSceneOptions;
  private readonly cam3d: ReturnType<typeof resolveCamera3d>;
  private readonly geometries = new GeometryCache();
  private readonly follower: CameraFollower;
  private readonly nodes = new Map<string, EntityNode>();
  private size: ScreenSize | undefined;
  private shown: ShownMap | null = null;
  private mapVisible = false;
  private builds = 0;
  private effects: ActiveEffect[] = [];
  private lastEvents: number | null = null;
  private framed: PresentBox | null = null;

  constructor(skin: Skin, opts: ThreeSceneOptions = {}) {
    this.skin = skin;
    this.opts = opts;
    this.size = opts.size;
    this.cam3d = resolveCamera3d(skin);
    this.follower = new CameraFollower({ clamp: (opts.clamp ?? skin.camera?.clamp) !== false });
    this.scene.background = new Color(opts.background ?? '#000');

    this.ambient = new AmbientLight(0xffffff, this.cam3d.lights.ambient);
    this.sun = new DirectionalLight(0xffffff, this.cam3d.lights.directional);
    this.sun.position.copy(SUN_FROM);
    this.sun.castShadow = false;
    this.scene.add(this.ambient, this.sun);

    const overlayMaterial = new MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this.overlay = new Mesh(new PlaneGeometry(1, 1), overlayMaterial);
    this.overlay.renderOrder = OVERLAY_ORDER;
    this.overlay.frustumCulled = false;
    this.overlay.visible = false;
    this.camera.add(this.overlay);
    this.scene.add(this.camera);
  }

  /** The picture size changed. */
  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }

  /** Brings the scene and camera up to `frame`. Reads the frame and the skin; changes neither. */
  sync(frame: Frame): void {
    const size = this.size ?? frame.size;
    this.takeEvents(frame);
    this.updateMap(frame);
    this.updateEntities(frame);
    this.updateCamera(frame, size);
    this.updateOverlay(frame.frame);
  }

  // ---- What tests and the presenter read ----

  /** The root `Group` of an entity's meshes, by entity id. */
  entity(id: string): Group | undefined {
    return this.nodes.get(id)?.root;
  }

  /** The ids of the entities in the scene. */
  entityIds(): string[] {
    return [...this.nodes.keys()];
  }

  /** The map's blocks, or null when no map has been built (it may be hidden this frame). */
  get map(): Group | null {
    return this.shown?.group ?? null;
  }

  /** How many times a map has been built (once per new map id and version). */
  get mapBuilds(): number {
    return this.builds;
  }

  /** The world box (px, y down) the camera framed on the z = 0 plane last frame, without shake. */
  get view(): PresentBox | null {
    return this.framed === null ? null : { ...this.framed };
  }

  /** Frees every geometry and material this scene made. */
  dispose(): void {
    if (this.shown) disposeMap(this.shown.group);
    this.shown = null;
    for (const node of this.nodes.values()) disposeNode(node);
    this.nodes.clear();
    this.geometries.dispose();
    this.overlay.geometry.dispose();
    this.overlay.material.dispose();
  }

  // ---- Events ----

  private takeEvents(frame: Frame): void {
    this.effects = this.effects.filter((a) => {
      const age = frame.frame - a.start;
      return age >= 0 && age < (a.effect.ticks ?? EFFECT_TICKS[a.effect.kind]);
    });
    if (this.lastEvents === frame.frame) return;
    this.lastEvents = frame.frame;
    for (const ev of frame.events) {
      const entry = resolveSkinEvent(this.skin.events, ev);
      if (entry === undefined) continue;
      if (entry.sound !== undefined) this.opts.onSound?.(entry.sound);
      if (entry.effect !== undefined) this.effects.push({ effect: entry.effect, start: frame.frame });
    }
  }

  /** Flash and tint as a full-screen overlay; the last one listed wins. */
  private updateOverlay(tick: number): void {
    let shown: { color: string; opacity: number } | null = null;
    for (const a of this.effects) {
      const { effect } = a;
      const color = effect.color ?? '#fcfcfc';
      if (effect.kind === 'flash' && !this.opts.reduceFlashing) shown = { color, opacity: 1 };
      else if (effect.kind === 'tint') {
        const ticks = effect.ticks ?? EFFECT_TICKS.tint;
        shown = { color, opacity: 0.4 * (1 - (tick - a.start) / ticks) };
      }
    }
    this.overlay.visible = shown !== null && shown.opacity > 0;
    if (shown) {
      this.overlay.material.color.set(shown.color);
      this.overlay.material.opacity = shown.opacity;
    }
  }

  // ---- Map ----

  private updateMap(frame: Frame): void {
    const map = frame.map;
    this.mapVisible = map !== undefined;
    if (map !== undefined) {
      const same = this.shown && this.shown.map.id === map.id && this.shown.map.version === map.version;
      if (!same) {
        if (this.shown) {
          this.scene.remove(this.shown.group);
          disposeMap(this.shown.group);
          this.shown = null;
        }
        // A reference to a map never sent shows nothing until it comes.
        if (isFullMap(map)) {
          this.shown = { map, group: this.buildMap(map) };
          this.scene.add(this.shown.group);
          this.builds++;
        }
      }
    }
    if (this.shown) this.shown.group.visible = this.mapVisible;
  }

  /** One `InstancedMesh` per tile key and mesh part, for `tiles` and then each layer. */
  private buildMap(map: DeepReadonly<PresentMap>): Group {
    const group = new Group();
    group.name = `map:${map.id}@${map.version}`;
    const ts = map.tileSize;
    const tiles = this.skin.tiles ?? {};
    const materials = new Map<string, MeshLambertMaterial>();
    const material = (color: string) => {
      let m = materials.get(color);
      if (!m) materials.set(color, (m = new MeshLambertMaterial({ color })));
      return m;
    };
    const grids: { tiles: DeepReadonly<PresentMapLayer['tiles']>; z: number; layer: string }[] = [
      { tiles: map.tiles, z: 0, layer: 'tiles' },
      ...(map.layers ?? []).map((l, i) => ({
        tiles: l.tiles,
        z: -(i + 1) * this.cam3d.layerDepth,
        layer: l.name,
      })),
    ];
    const matrix = new Matrix4();
    const at = new Vector3();
    const turn = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    for (const grid of grids) {
      const cells = new Map<string, [number, number][]>();
      for (let row = 0; row < grid.tiles.length; row++) {
        const line = grid.tiles[row]!;
        for (let col = 0; col < line.length; col++) {
          const key = String(line[col]);
          if (!Object.hasOwn(tiles, key)) continue;
          let list = cells.get(key);
          if (!list) cells.set(key, (list = []));
          list.push([col, row]);
        }
      }
      for (const [key, list] of cells) {
        const parts = resolveMeshParts(this.skin, tiles[key]!, { w: ts, h: ts });
        parts.forEach((part, p) => {
          const blocks = new InstancedMesh(
            this.geometries.get(part.shape, part.size),
            material(part.color),
            list.length,
          );
          blocks.name = `tile:${key}:${p}`;
          blocks.userData = { tile: key, part: p, layer: grid.layer };
          turn.setFromAxisAngle(up, (part.rotate * Math.PI) / 2);
          list.forEach(([col, row], i) => {
            at.set(
              col * ts + part.at.x + part.size.w / 2,
              -(row * ts + part.at.y + part.size.h / 2),
              grid.z + part.at.z,
            );
            blocks.setMatrixAt(i, matrix.compose(at, turn, one));
          });
          blocks.instanceMatrix.needsUpdate = true;
          blocks.computeBoundingSphere();
          group.add(blocks);
        });
      }
    }
    return group;
  }

  // ---- Entities ----

  private updateEntities(frame: Frame): void {
    const seen = new Set<string>();
    for (const e of frame.entities) {
      seen.add(e.id);
      let node = this.nodes.get(e.id);
      if (
        node &&
        (node.kind !== e.kind || node.w !== e.w || node.h !== e.h || node.look !== this.lookOf(e))
      ) {
        this.scene.remove(node.root);
        disposeNode(node);
        node = undefined;
      }
      if (!node) {
        node = this.buildEntity(e);
        this.nodes.set(e.id, node);
        this.scene.add(node.root);
      }
      this.place(node, e);
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      this.scene.remove(node.root);
      disposeNode(node);
      this.nodes.delete(id);
    }
  }

  /** The `byTag` look an entity takes (-1: its kind's own), so a new tag look rebuilds it. */
  private lookOf(e: Entity): number {
    const kinds = this.skin.kinds;
    return skinTagIndex(Object.hasOwn(kinds, e.kind) ? kinds[e.kind] : undefined, e.tags);
  }

  /** The meshes for an entity's kind (or its tag's look) and box, under a root at the box's bottom centre. */
  private buildEntity(e: Entity): EntityNode {
    const entry = resolveSkinKind(this.skin, e);
    const box = { w: e.w, h: e.h };
    let parts: MeshPart[] = entry ? resolveMeshParts(this.skin, entry, box) : [];
    const fallback = parts.length === 0;
    if (fallback) {
      const color = this.skin.sheets?.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
      parts = [
        { shape: 'box', size: { w: e.w, h: e.h, d: e.w }, at: { x: 0, y: 0, z: 0 }, color, rotate: 0 },
      ];
    }
    const root = new Group();
    root.name = `entity:${e.id}`;
    root.userData = { id: e.id, kind: e.kind, fallback };
    const materials: MeshLambertMaterial[] = [];
    for (const part of parts) {
      const material = new MeshLambertMaterial({ color: part.color });
      materials.push(material);
      const mesh = new Mesh(this.geometries.get(part.shape, part.size), material);
      // Parts are placed from the box's top-left (y down); the root is its bottom centre (y up).
      mesh.position.set(
        part.at.x + part.size.w / 2 - box.w / 2,
        box.h - part.at.y - part.size.h / 2,
        part.at.z,
      );
      mesh.rotation.y = (part.rotate * Math.PI) / 2;
      root.add(mesh);
    }
    return { root, kind: e.kind, w: e.w, h: e.h, look: this.lookOf(e), materials };
  }

  private place(node: EntityNode, e: Entity): void {
    const fx = e.fx;
    const mirror = facesLeft(e.facing) ? -1 : 1;
    node.root.position.set(e.x + e.w / 2, -(e.y + e.h), (e.layer ?? 0) * this.cam3d.layerDepth);
    node.root.scale.set(mirror * (fx?.squashX ?? 1), fx?.squashY ?? 1, 1);
    // `rotate` is clockwise on screen; with y up that is a negative turn about z.
    node.root.rotation.z = (-(fx?.rotate ?? 0) * Math.PI) / 180;
    const alpha = Math.min(1, Math.max(0, fx?.alpha ?? 1));
    for (const m of node.materials) {
      const transparent = alpha < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = alpha;
    }
  }

  // ---- Camera ----

  private updateCamera(frame: Frame, size: ScreenSize): void {
    const zoom = cameraZoom(frame, this.skin.camera);
    const view = cameraView(size, zoom);
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const top = this.follower.update(frame, this.skin.camera, view, map);
    this.framed = { x: top.x, y: top.y, w: view.width, h: view.height };

    const shakes = this.effects.filter((a) => a.effect.kind === 'shake').map((a) => a.effect.size ?? 2);
    const shake = cameraShake(frame, shakes) / zoom;
    const { fov, tilt } = this.cam3d;
    const distance = view.height / (2 * Math.tan((fov * Math.PI) / 360));
    const pitch = (tilt * Math.PI) / 180;
    const cx = top.x + view.width / 2 + shake;
    const cy = -(top.y + view.height / 2);

    const cam = this.camera;
    cam.fov = fov;
    cam.aspect = size.width / size.height;
    cam.near = Math.max(0.1, distance / 100);
    cam.far = distance * 10 + 1000;
    cam.position.set(cx, cy + distance * Math.sin(pitch), distance * Math.cos(pitch));
    cam.lookAt(cx, cy, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();

    // The overlay just past the near plane, filling the view.
    const at = cam.near * 2;
    const h = 2 * at * Math.tan((fov * Math.PI) / 360);
    this.overlay.position.set(0, 0, -at);
    this.overlay.scale.set(h * cam.aspect * 1.01, h * 1.01, 1);
  }
}

function disposeMap(group: Group): void {
  const materials = new Set<Material>();
  for (const child of group.children) {
    if (child instanceof InstancedMesh) {
      materials.add(child.material as Material);
      child.dispose();
    }
  }
  for (const m of materials) m.dispose();
}

function disposeNode(node: EntityNode): void {
  for (const m of node.materials) m.dispose();
}
