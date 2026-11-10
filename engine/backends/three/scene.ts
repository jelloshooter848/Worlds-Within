import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import { CameraFx, SkinParticles, type CameraFxSettings, type ParticleView } from '@engine/core/fx';
import type { ScreenSize } from '@engine/core/gfx/screen';
import {
  cameraArea,
  cameraShake,
  cameraTarget,
  cameraView,
  cameraZoom,
  CameraFollower,
  DEFAULT_FALLBACK_COLOR,
  FrameEventClock,
  facesLeft,
  isFullMap,
  resolveCamera3d,
  resolveMeshParts,
  resolveSkinKind,
  resolveSkinMesh,
  resolveSkinModel,
  resolveTileModel,
  skinBackground,
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
  zoomAbout,
  skinSoundCue,
  type SoundCue,
} from '@engine/core/present';
import { GeometryCache } from './geometry';
import type { FontLookup } from '@engine/core/ui';
import { HudLayer } from './hud';
import { ModelInstance, type ModelLibrary } from './models';
import { ParallaxPlanes } from './parallax';

type Skin = DeepReadonly<SkinFile>;
type Frame = DeepReadonly<PresentFrame>;
type Entity = DeepReadonly<PresentEntity>;
type Effect = NonNullable<NonNullable<SkinFile['events']>[string]['effect']>;

export interface ThreeSceneOptions {
  /** The picture size to frame the camera in; the frame's own `size` when left out. */
  size?: ScreenSize;
  /** Called once for each event this frame whose skin entry names a sound (wire it to the audio). */
  onSound?: (id: string, cue?: SoundCue) => void;
  /** The scene's background colour when it is not the skin's (default the skin's `background`, else `#000`). */
  background?: string;
  /** Keep the camera inside the map or the hint's `bounds` (default: the skin's `camera.clamp`, else true). */
  clamp?: boolean;
  /**
   * The player's reduced-flashing setting: skip `flash` effects and event `flash`es, and draw
   * additive (bright) particles with normal blending, half as strong.
   */
  reduceFlashing?: boolean;
  /** The player's screen-shake setting, 0 (no shake) to 1 (full, the default). */
  shakeScale?: number;
  /** Keep trauma-shake offsets fractional (default false: whole picture px). */
  subPixelShake?: boolean;
  /** Called once for each event whose skin entry asks for a `hitPause`, with its ticks (Engine 0.16 T4). */
  onHitPause?: (ticks: number) => void;
  /** The seed particles and shake noise draw from (`fxRng`; default 0). */
  seed?: number;
  /**
   * The game's sprite sheets as decoded pixels (`contentPixelSheets`), for the HUD's sprite frames
   * and font glyphs (gap G33). Without it a heart or icon is a flat box and text draws nothing.
   */
  sheets?: PixelSheetLookup;
  /** The game's `font` content files (`contentFonts`, Engine 0.16 T6), for HUD text and widgets. */
  fonts?: FontLookup;
  /**
   * The game's glTF/GLB models (Engine 0.16 T11), `new ModelLibrary(content.assets)`: a kind or
   * tile with a `model` shows it once loaded, and its text `mesh` until then. Without it every
   * entry shows its text mesh.
   */
  models?: ModelLibrary;
}

/** Ticks an effect lasts when the skin gives none (the same as the Canvas2D presenter). */
const EFFECT_TICKS: Record<Effect['kind'], number> = { flash: 2, particles: 12, shake: 8, tint: 6 };

/** Direction the one directional light shines from (toward the origin): up, left and in front. */
const SUN_FROM = new Vector3(-1, 2, 3);

/** Draw order of the full-screen effect overlay: after everything else. */
const OVERLAY_ORDER = 1_000_000;

/** The most particles shown at once (each blend's buffer size, and the particle system's cap). */
export const PARTICLE_POOL = 1024;

/** How far in front of the z = 0 plane particles are drawn (world px), so blocks do not hide them. */
export const PARTICLE_Z = 12;

/** Particles as screen-facing squares: `pSize` world px wide at any depth, `pColor`, `pAlpha`. */
const PARTICLE_VERTEX = /* glsl */ `
attribute float pSize;
attribute float pAlpha;
attribute vec3 pColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = pColor;
  vAlpha = pAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, pSize * uScale / -mv.z);
}
`;
const PARTICLE_FRAGMENT = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vColor, vAlpha);
  #include <colorspace_fragment>
}
`;

/** One blend's particles: a `Points` over fixed-size buffers, drawn up to `geometry.drawRange.count`. */
type ParticlePoints = Points<BufferGeometry, ShaderMaterial>;

/** One event effect still showing: where it is (world px, y down) and the frame it began on. */
interface ActiveEffect {
  effect: DeepReadonly<Effect>;
  x: number;
  y: number;
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
  /** What it was built from: `model:<path>` (a loaded model), else `mesh:<name>` (its `poses` frame or `mesh`). */
  shape: string;
  /** The model instance it shows, or null (text meshes). */
  model: ModelInstance | null;
  materials: Material[];
}

/** The map being shown, its built blocks, and whether this frame shows it. */
interface ShownMap {
  map: DeepReadonly<PresentMap>;
  group: Group;
  /** Tile cells shown as a model, each posed on the frame clock (the tile entry's `clip`). */
  models: { instance: ModelInstance; tile: string }[];
  /** Model paths that were still loading when it was built: it is rebuilt once they are there. */
  waiting: string[];
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
 *   wobbles the camera, `particles` are small unlit boxes from a pool (`particles`, at most
 *   `PARTICLE_POOL`), flying out from the event as the 2D ones do (Engine 0.15, gap G33).
 * - HUD (Engine 0.15, gap G33): `hud`, a `HudLayer` (the core `layoutHud` drawn as an orthographic
 *   pass of textured quads, picture pixels), which the presenter draws after `scene`.
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
  /** The HUD pass: its own `scene` and orthographic `camera`, drawn over this one. */
  readonly hud: HudLayer;
  /**
   * The particles: two `Points` (`particles:normal` and `particles:add`, additive blending), each
   * drawing its first `geometry.drawRange.count` points.
   */
  readonly particles = new Group();
  /** The skin's `parallax` layers as distant planes on the camera (Engine 0.16 T4). */
  readonly parallax: ParallaxPlanes;

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
  /** Frame events of the skin's `poses` cycles, scene state only. */
  private readonly frameEvents = new FrameEventClock();
  private framed: PresentBox | null = null;
  /** The camera's target projected onto the picture last frame (picture px), or null. */
  private focusPoint: { x: number; y: number } | null = null;
  private readonly skinParticles: SkinParticles;
  private readonly points: Record<'normal' | 'add', ParticlePoints>;
  private readonly tmpColor = new Color();
  private readonly cameraFx: CameraFx;
  private settings: CameraFxSettings;
  /** The camera effects' clock: one tick per `sync`, as the Canvas2D presenter's. */
  private fxClock = -1;

  constructor(skin: Skin, opts: ThreeSceneOptions = {}) {
    this.skin = skin;
    this.opts = opts;
    this.size = opts.size;
    this.cam3d = resolveCamera3d(skin);
    this.follower = new CameraFollower({ clamp: (opts.clamp ?? skin.camera?.clamp) !== false });
    this.scene.background = new Color(opts.background ?? skinBackground(skin));

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
    this.particles.name = 'particles';
    this.skinParticles = new SkinParticles(skin, {
      max: PARTICLE_POOL,
      ...(opts.seed !== undefined && { seed: opts.seed }),
    });
    this.points = { normal: makePoints('normal'), add: makePoints('add') };
    this.particles.add(this.points.normal, this.points.add);
    this.scene.add(this.particles);
    this.hud = new HudLayer(skin, opts.sheets, opts.fonts);
    this.parallax = new ParallaxPlanes(skin, opts.sheets);
    this.camera.add(this.parallax.group);
    this.cameraFx = new CameraFx({
      ...(opts.seed !== undefined && { seed: opts.seed }),
      ...(opts.subPixelShake !== undefined && { subPixel: opts.subPixelShake }),
    });
    this.settings = {
      ...(opts.reduceFlashing !== undefined && { reduceFlashing: opts.reduceFlashing }),
      ...(opts.shakeScale !== undefined && { shakeScale: opts.shakeScale }),
    };
  }

  /** The picture size changed. */
  resize(size: ScreenSize): void {
    this.size = { width: size.width, height: size.height };
  }

  /** Changes the player's flashing and shake settings from the next frame (fields left out are kept). */
  effectSettings(settings: CameraFxSettings): void {
    this.settings = { ...this.settings, ...settings };
  }

  /** Brings the scene and camera up to `frame`. Reads the frame and the skin; changes neither. */
  sync(frame: Frame): void {
    const size = this.size ?? frame.size;
    this.fxClock++;
    this.takeEvents(frame);
    this.updateMap(frame);
    this.poseTileModels(frame.frame);
    this.updateEntities(frame);
    this.cameraFx.update(this.fxClock);
    this.updateCamera(frame, size);
    this.updateOverlay(frame.frame);
    this.skinParticles.update(frame.frame, frame.entities);
    this.updateParticles(size);
    this.hud.sync(frame, size, this.mapVisible ? (this.shown?.map ?? null) : null);
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

  /**
   * The camera's target (the followed entity's centre, else the hint's point) on the z = 0 plane,
   * projected onto the picture last frame, in picture px (Engine 0.16 T5: where an iris closes),
   * or null.
   */
  focus(): { x: number; y: number } | null {
    return this.focusPoint === null ? null : { ...this.focusPoint };
  }

  /** The world box (px, y down) the camera framed on the z = 0 plane last frame, without shake. */
  get view(): PresentBox | null {
    return this.framed === null ? null : { ...this.framed };
  }

  /** Frees every geometry and material this scene made. */
  dispose(): void {
    if (this.shown) disposeMap(this.shown);
    this.shown = null;
    for (const node of this.nodes.values()) disposeNode(node);
    this.nodes.clear();
    this.geometries.dispose();
    this.overlay.geometry.dispose();
    this.overlay.material.dispose();
    for (const p of Object.values(this.points)) {
      p.geometry.dispose();
      p.material.dispose();
    }
    this.hud.dispose();
    this.parallax.dispose();
  }

  // ---- Events ----

  private takeEvents(frame: Frame): void {
    this.effects = this.effects.filter((a) => {
      const age = frame.frame - a.start;
      return age >= 0 && age < (a.effect.ticks ?? EFFECT_TICKS[a.effect.kind]);
    });
    if (this.lastEvents === frame.frame) return;
    this.lastEvents = frame.frame;
    // The frame's events, then the skin's frame events (a footstep on a run cycle's frame),
    // which run through the same `events` entries but never go into the frame.
    for (const ev of [...frame.events, ...this.frameEvents.next(this.skin, frame.entities)]) {
      const entry = resolveSkinEvent(this.skin.events, ev);
      if (entry === undefined) continue;
      if (entry.sound !== undefined) this.opts.onSound?.(entry.sound, skinSoundCue(entry, frame.frame));
      if (entry.hitPause !== undefined) this.opts.onHitPause?.(entry.hitPause.ticks);
      this.skinParticles.event(entry, ev, frame.entities, frame.frame);
      this.cameraFx.event(entry, this.fxClock);
      if (entry.effect === undefined || entry.effect.kind === 'particles') continue;
      const at = ev.entity === undefined ? undefined : frame.entities.find((e) => e.id === ev.entity);
      const x = ev.x ?? (at ? at.x + at.w / 2 : 0);
      const y = ev.y ?? (at ? at.y + at.h / 2 : 0);
      this.effects.push({ effect: entry.effect, x, y, start: frame.frame });
    }
  }

  /** The particles shown now (the scene's own reading of its particle system, for tests). */
  particleViews(): ParticleView[] {
    return this.skinParticles.particles(this.settings.reduceFlashing ? { reduceFlashing: true } : {});
  }

  /**
   * Writes the live particles (world px, y flipped, {@link PARTICLE_Z} in front of the z = 0
   * plane) into the two `Points` buffers by blend, at most {@link PARTICLE_POOL} each. Colours
   * are converted to the renderer's working space; a sprite `frame` shows as a square in its
   * colour (3D draws no particle sprites).
   */
  private updateParticles(size: ScreenSize): void {
    const filled = { normal: 0, add: 0 };
    const fov = this.cam3d.fov;
    const scale = size.height / (2 * Math.tan((fov * Math.PI) / 360));
    for (const p of this.particleViews()) {
      if (p.size <= 0 || p.alpha <= 0) continue;
      const points = this.points[p.blend];
      const i = filled[p.blend];
      if (i >= PARTICLE_POOL) continue;
      filled[p.blend] = i + 1;
      const g = points.geometry;
      (g.attributes['position'] as BufferAttribute).setXYZ(i, p.x, -p.y, PARTICLE_Z);
      (g.attributes['pSize'] as BufferAttribute).setX(i, p.size);
      (g.attributes['pAlpha'] as BufferAttribute).setX(i, p.alpha);
      this.tmpColor.set(p.color);
      (g.attributes['pColor'] as BufferAttribute).setXYZ(
        i,
        this.tmpColor.r,
        this.tmpColor.g,
        this.tmpColor.b,
      );
    }
    for (const blend of ['normal', 'add'] as const) {
      const points = this.points[blend];
      const g = points.geometry;
      g.setDrawRange(0, filled[blend]);
      points.visible = filled[blend] > 0;
      points.material.uniforms['uScale']!.value = scale;
      for (const name of ['position', 'pSize', 'pAlpha', 'pColor']) {
        (g.attributes[name] as BufferAttribute).needsUpdate = true;
      }
    }
  }

  /**
   * Flash and tint effects, then event `flash`es (Engine 0.16 T4), as a full-screen overlay; the
   * last one wins.
   */
  private updateOverlay(tick: number): void {
    let shown: { color: string; opacity: number } | null = null;
    for (const a of this.effects) {
      const { effect } = a;
      const color = effect.color ?? '#fcfcfc';
      if (effect.kind === 'flash' && !this.settings.reduceFlashing) shown = { color, opacity: 1 };
      else if (effect.kind === 'tint') {
        const ticks = effect.ticks ?? EFFECT_TICKS.tint;
        shown = { color, opacity: 0.4 * (1 - (tick - a.start) / ticks) };
      }
    }
    for (const f of this.cameraFx.state(this.fxClock, this.settings).flashes)
      shown = { color: f.color, opacity: f.alpha };
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
      // A tile model that was loading when the map was built is shown once it is there.
      const loaded = same && this.shown!.waiting.some((path) => this.opts.models?.get(path));
      if (!same || loaded) {
        const full = this.shown && same ? this.shown.map : map;
        if (this.shown) {
          this.scene.remove(this.shown.group);
          disposeMap(this.shown);
          this.shown = null;
        }
        // A reference to a map never sent shows nothing until it comes.
        if (isFullMap(full)) {
          this.shown = this.buildMap(full);
          this.scene.add(this.shown.group);
          this.builds++;
        }
      }
    }
    if (this.shown) this.shown.group.visible = this.mapVisible;
  }

  /** Poses every tile model on the frame clock (its entry's `clip`, `frame` / 60 seconds). */
  private poseTileModels(frame: number): void {
    const tiles = this.skin.tiles ?? {};
    for (const { instance, tile } of this.shown?.models ?? []) {
      const spec = resolveTileModel(tiles[tile]!, frame);
      instance.pose(spec?.clip ?? null, spec?.time ?? 0);
    }
  }

  /**
   * One `InstancedMesh` per tile key and mesh part, for `tiles` and then each layer; a tile whose
   * entry has a loaded `model` is one model instance per cell instead (Engine 0.16 T11).
   */
  private buildMap(map: DeepReadonly<PresentMap>): ShownMap {
    const group = new Group();
    const models: ShownMap['models'] = [];
    const waiting = new Set<string>();
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
        const spec = resolveTileModel(tiles[key]!);
        const loaded = spec && this.opts.models ? this.opts.models.get(spec.model) : null;
        if (spec && loaded) {
          for (const [col, row] of list) {
            const instance = new ModelInstance(loaded, spec, { w: ts, h: ts });
            instance.object.name = `tile:${key}:model`;
            instance.object.userData = { tile: key, layer: grid.layer, model: spec.model };
            instance.object.position.set(col * ts + ts / 2, -(row + 1) * ts, grid.z);
            group.add(instance.object);
            models.push({ instance, tile: key });
          }
          continue;
        }
        if (spec && this.opts.models) waiting.add(spec.model);
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
    return { map, group, models, waiting: [...waiting] };
  }

  // ---- Entities ----

  private updateEntities(frame: Frame): void {
    const seen = new Set<string>();
    for (const e of frame.entities) {
      seen.add(e.id);
      let node = this.nodes.get(e.id);
      if (
        node &&
        (node.kind !== e.kind ||
          node.w !== e.w ||
          node.h !== e.h ||
          node.look !== this.lookOf(e) ||
          node.shape !== this.shapeOf(e))
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

  /**
   * What an entity is built from now: `model:<path>` when its entry's model is loaded (asking the
   * library starts the load), else `mesh:<name>` (its `poses` frame or `mesh`). A model's clips
   * play on it without a rebuild.
   */
  private shapeOf(e: Entity): string {
    const model = resolveSkinModel(this.skin, e);
    if (model && this.opts.models?.get(model.model)) return `model:${model.model}`;
    return `mesh:${resolveSkinMesh(this.skin, e) ?? ''}`;
  }

  /** The meshes for an entity's kind (or its tag's look) and box, under a root at the box's bottom centre. */
  private buildEntity(e: Entity): EntityNode {
    const entry = resolveSkinKind(this.skin, e);
    const box = { w: e.w, h: e.h };
    const shape = this.shapeOf(e);
    const spec = resolveSkinModel(this.skin, e);
    const loaded = spec && this.opts.models ? this.opts.models.get(spec.model) : null;
    if (spec && loaded) {
      // A glTF model (Engine 0.16 T11), placed by its anchor on the box's bottom centre.
      const instance = new ModelInstance(loaded, spec, box);
      const root = new Group();
      root.name = `entity:${e.id}`;
      root.userData = { id: e.id, kind: e.kind, fallback: false, model: spec.model };
      root.add(instance.object);
      const look = this.lookOf(e);
      return {
        root,
        kind: e.kind,
        w: e.w,
        h: e.h,
        look,
        shape,
        model: instance,
        materials: instance.materials,
      };
    }
    // A `poses` cycle swaps the mesh by animation state and frame (Engine 0.16 T2).
    const mesh = resolveSkinMesh(this.skin, e);
    const shown = entry && mesh !== undefined ? { ...entry, mesh } : entry;
    let parts: MeshPart[] = shown ? resolveMeshParts(this.skin, shown, box) : [];
    const fallback = parts.length === 0;
    if (fallback) {
      const color = this.skin.sheets?.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
      parts = [
        { shape: 'box', size: { w: e.w, h: e.h, d: e.w }, at: { x: 0, y: 0, z: 0 }, color, rotate: 0 },
      ];
    }
    const root = new Group();
    root.name = `entity:${e.id}`;
    // While its model loads (or without a model library) an entry shows its text mesh.
    root.userData = { id: e.id, kind: e.kind, fallback, ...(spec && { model: spec.model, loading: true }) };
    const materials: Material[] = [];
    for (const part of parts) {
      const material = new MeshLambertMaterial({ color: part.color });
      materials.push(material);
      const mesh = new Mesh(this.geometries.get(part.shape, part.size), material);
      if (entry?.castShadow === true) mesh.castShadow = true;
      // Parts are placed from the box's top-left (y down); the root is its bottom centre (y up).
      mesh.position.set(
        part.at.x + part.size.w / 2 - box.w / 2,
        box.h - part.at.y - part.size.h / 2,
        part.at.z,
      );
      mesh.rotation.y = (part.rotate * Math.PI) / 2;
      root.add(mesh);
    }
    return { root, kind: e.kind, w: e.w, h: e.h, look: this.lookOf(e), shape, model: null, materials };
  }

  private place(node: EntityNode, e: Entity): void {
    const fx = e.fx;
    const mirror = facesLeft(e.facing) ? -1 : 1;
    node.root.position.set(e.x + e.w / 2, -(e.y + e.h), (e.layer ?? 0) * this.cam3d.layerDepth);
    node.root.scale.set(mirror * (fx?.squashX ?? 1), fx?.squashY ?? 1, 1);
    // `rotate` is clockwise on screen; with y up that is a negative turn about z.
    node.root.rotation.z = (-(fx?.rotate ?? 0) * Math.PI) / 180;
    if (node.model) {
      const spec = resolveSkinModel(this.skin, e);
      node.model.pose(spec?.clip ?? null, spec?.time ?? 0);
    }
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
    const base = cameraZoom(frame, this.skin.camera);
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const framedTop = this.follower.update(frame, this.skin.camera, cameraView(size, base), map);
    // A zoom punch zooms the framed view about its centre, as the Canvas2D presenter does.
    const fx = this.cameraFx.state(this.fxClock, this.settings);
    const area = cameraArea(frame, map, (this.opts.clamp ?? this.skin.camera?.clamp) !== false);
    const focus = cameraTarget(frame, this.skin.camera);
    const { cam: top, view } = zoomAbout(framedTop, cameraView(size, base), fx.zoom, area, focus);
    const zoom = base * fx.zoom;
    this.framed = { x: top.x, y: top.y, w: view.width, h: view.height };

    // Shake in picture px (old `shake` effects and the hint's, scaled; then trauma), in world px.
    const shakes = this.effects.filter((a) => a.effect.kind === 'shake').map((a) => a.effect.size ?? 2);
    const scale = Math.min(1, Math.max(0, this.settings.shakeScale ?? 1));
    const shakeX = Math.round(cameraShake(frame, shakes) * scale) + fx.shakeX;
    const shakeY = fx.shakeY;
    const { fov, tilt } = this.cam3d;
    const distance = view.height / (2 * Math.tan((fov * Math.PI) / 360));
    const pitch = (tilt * Math.PI) / 180;
    const cx = top.x + view.width / 2 + shakeX / zoom;
    const cy = -(top.y + view.height / 2 + shakeY / zoom);

    const cam = this.camera;
    cam.fov = fov;
    cam.aspect = size.width / size.height;
    cam.near = Math.max(0.1, distance / 100);
    cam.far = distance * 10 + 1000;
    cam.position.set(cx, cy + distance * Math.sin(pitch), distance * Math.cos(pitch));
    cam.lookAt(cx, cy, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (focus === null) this.focusPoint = null;
    else {
      const p = new Vector3(focus.x, -focus.y, 0).project(cam);
      this.focusPoint = { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
    }

    // The overlay just past the near plane, filling the view.
    const at = cam.near * 2;
    const h = 2 * at * Math.tan((fov * Math.PI) / 360);
    this.overlay.position.set(0, 0, -at);
    this.overlay.scale.set(h * cam.aspect * 1.01, h * 1.01, 1);

    // Parallax planes scroll against the camera's top-left in picture px, as in 2D.
    const picture = { x: Math.round(top.x * zoom) + shakeX, y: Math.round(top.y * zoom) + shakeY };
    this.parallax.sync(picture, size, cam, distance);
  }
}

/** One blend's particle buffers, {@link PARTICLE_POOL} points, drawn as screen-facing squares. */
function makePoints(blend: 'normal' | 'add'): ParticlePoints {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(PARTICLE_POOL * 3), 3));
  g.setAttribute('pColor', new BufferAttribute(new Float32Array(PARTICLE_POOL * 3), 3));
  g.setAttribute('pSize', new BufferAttribute(new Float32Array(PARTICLE_POOL), 1));
  g.setAttribute('pAlpha', new BufferAttribute(new Float32Array(PARTICLE_POOL), 1));
  g.setDrawRange(0, 0);
  const material = new ShaderMaterial({
    uniforms: { uScale: { value: 1 } },
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: blend === 'add' ? AdditiveBlending : NormalBlending,
  });
  const points = new Points(g, material);
  points.name = `particles:${blend}`;
  points.frustumCulled = false;
  points.visible = false;
  // After the scene's opaque meshes, normal before additive.
  points.renderOrder = blend === 'add' ? 2 : 1;
  return points;
}

function disposeMap(shown: ShownMap): void {
  const materials = new Set<Material>();
  for (const { instance } of shown.models) instance.dispose();
  for (const child of shown.group.children) {
    if (child instanceof InstancedMesh) {
      materials.add(child.material as Material);
      child.dispose();
    }
  }
  for (const m of materials) m.dispose();
}

function disposeNode(node: EntityNode): void {
  if (node.model) node.model.dispose();
  else for (const m of node.materials) m.dispose();
}
