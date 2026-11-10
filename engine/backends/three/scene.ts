import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
  Box3,
  BufferGeometry,
  Color,
  DirectionalLight,
  Fog,
  FogExp2,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NormalBlending,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  Points,
  Quaternion,
  Scene,
  ShaderMaterial,
  Vector3,
  type Material,
} from 'three';
import type { PixelSheetLookup } from '@engine/core/assets/content-sheets';
import { CameraFx, fxRng, SkinParticles, type CameraFxSettings, type ParticleView } from '@engine/core/fx';
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
  facingVector,
  groundFacingTurn,
  groundProjection,
  pointsBox,
  skinGroundCamera,
  type GroundCamera,
  type GroundProjection,
  isFullMap,
  resolveCamera3d,
  resolveMeshParts,
  resolveScene3d,
  skinLabels,
  type Scene3dLook,
  type SkinKindLight,
  type SkinLabel,
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
  placeDecor,
  tileVariation,
  type DecorLookup,
  type SkinModel,
} from '@engine/core/present';
import { GeometryCache } from './geometry';
import { layoutLabels, type FontLookup, type LabelView, type UiDraw } from '@engine/core/ui';
import { HudLayer } from './hud';
import {
  ModelInstance,
  modelMeshParts,
  type LoadedModel,
  type ModelLibrary,
  type ModelMeshPart,
} from './models';
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
  /**
   * The game's decor grids (`contentDecor(content)`, Engine 0.16 F3): the skin's `decor` for the
   * map shown places their models. Without it no decor shows.
   */
  decor?: DecorLookup;
  /**
   * Drawing-buffer px per picture px (Engine 0.16 F3; default the skin's `scene3d.renderScale`,
   * else 1): what the presenter draws at. The scene lays out in picture px either way; only the
   * particles' point size (buffer px) reads it.
   */
  renderScale?: number;
}

/** Ticks an effect lasts when the skin gives none (the same as the Canvas2D presenter). */
const EFFECT_TICKS: Record<Effect['kind'], number> = { flash: 2, particles: 12, shake: 8, tint: 6 };

/** Default point light decay (Three's physically based falloff exponent). */
export const POINT_LIGHT_DECAY = 1;

/** Extra world px round the view the sun's shadow camera covers, so casters just outside still shade. */
export const SHADOW_MARGIN = 64;

/** Draw order of the full-screen effect overlay: after everything else. */
const OVERLAY_ORDER = 1_000_000;

/** The most particles shown at once (each blend's buffer size, and the particle system's cap). */
export const PARTICLE_POOL = 1024;

/** How far in front of the z = 0 plane particles are drawn (world px), so blocks do not hide them. */
export const PARTICLE_Z = 12;

/** Ground view (Engine 0.16 F2): how high over the ground particles fly (world px). */
export const GROUND_PARTICLE_HEIGHT = 8;

/** Ground view: how far each entity `layer` lifts it (world px), so flat marks on the floor never flicker. */
export const GROUND_LAYER_LIFT = 0.05;

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
  /** The kind's point light (Engine 0.16 T12), or null. */
  light: { light: PointLight; spec: DeepReadonly<SkinKindLight> } | null;
  /** Ground view: the top of its meshes over the ground (world px), where a `top` label goes. */
  height: number;
}

/** The map being shown, its built blocks, and whether this frame shows it. */
interface ShownMap {
  map: DeepReadonly<PresentMap>;
  group: Group;
  /** Tile cells shown as a model copy, each posed on the frame clock (the tile entry's `clip`; `tile` null: decor, never posed). */
  models: { instance: ModelInstance; tile: string | null }[];
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
 * - Lights (Engine 0.16 T12): an ambient and a directional sun (`camera3d.lights`, else the
 *   skin's `scene3d`), a hemisphere light, fog, soft sun shadows and per-kind point lights when
 *   the skin's `scene3d` and kinds ask; tone mapping and the output colour space are the
 *   presenter's (`look`). Without `scene3d` the scene is lit exactly as before.
 * - Labels (Engine 0.16 T12): `labels`, a `HudLayer` of the skin's world-anchored labels,
 *   projected each frame, which the presenter draws between the scene and the HUD.
 * - Events: each listed event calls `onSound(sound)` once (a frame shown twice does not replay).
 *   Effects: `flash` and `tint` show as a full-screen overlay in front of the camera, `shake`
 *   wobbles the camera, `particles` are small unlit boxes from a pool (`particles`, at most
 *   `PARTICLE_POOL`), flying out from the event as the 2D ones do (Engine 0.15, gap G33).
 * - HUD (Engine 0.15, gap G33): `hud`, a `HudLayer` (the core `layoutHud` drawn as an orthographic
 *   pass of textured quads, picture pixels), which the presenter draws after `scene`.
 *
 * Ground view (Engine 0.16 F2, the skin's `camera3d.view` `ground`): world (x, y) lies on the
 * floor, Three's (x, height, y), seen through `groundProjection` (`@engine/core/present`, the
 * camera `RtsCamera` picks through) at the skin's `pitch` and `yaw`, at the distance the zoom
 * gives, looking at the framed view's centre (`CameraFollower` with no clamp: `RtsCamera` keeps
 * the ground footprint over the map). Tiles lie on the floor (a part's x, y are its place on the
 * cell, its z the height of its bottom, its `d` its height; a `plane` lies flat), all layers at
 * height 0; an entity's root is its box's centre on the ground (lifted `layer` x
 * {@link GROUND_LAYER_LIFT}), its parts placed the same way, models upright, and its facing turns
 * it about the vertical (`groundFacingTurn`: `down`, toward the camera at yaw 0, is the model's
 * front, +z) instead of mirroring; `rotate` turns it clockwise seen from above, squash scales the
 * width and depth by `squashX` and the height by `squashY`. Labels anchor at the meshes' top,
 * middle or the ground, particles fly {@link GROUND_PARTICLE_HEIGHT} px over the ground, the
 * sun's shadow camera covers the ground footprint of the picture (`footprint()`), linear fog is
 * measured from the camera's distance to the centre as in side view, and shake moves the centre
 * along the picture's axes on the ground. A side-view skin builds exactly what it did before.
 *
 * It never changes the frame or the skin, and uses no clock or unseeded randomness (Three's own
 * object UUIDs never reach any state).
 */
export class ThreeScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;
  /** The skin's `scene3d.hemisphere` light, or null (Engine 0.16 T12). */
  readonly hemisphere: HemisphereLight | null;
  /** The skin's scene look with defaults filled (lights, shadows, fog, tone mapping, colour space). */
  readonly look: Scene3dLook;
  /** Drawing-buffer px per picture px: the option, else the skin's `scene3d.renderScale`, else 1 (Engine 0.16 F3). */
  readonly renderScale: number;
  /** The world-anchored labels, drawn on the HUD layer between the scene and the HUD (Engine 0.16 T12). */
  readonly labels: HudLayer;
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
  /** The ground view's camera (Engine 0.16 F2), or null in side view. */
  private readonly groundCam: GroundCamera | null;
  /** The ground view's projection last frame, without shake (what `RtsCamera` picks through). */
  private groundShown: GroundProjection | null = null;
  /** The same with this frame's shake: the camera the picture is drawn with. */
  private groundCamera: GroundProjection | null = null;
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
  private labelShown: LabelView[] = [];
  private readonly sunFrom: Vector3;

  constructor(skin: Skin, opts: ThreeSceneOptions = {}) {
    this.skin = skin;
    this.opts = opts;
    this.size = opts.size;
    this.cam3d = resolveCamera3d(skin);
    this.groundCam = skinGroundCamera(skin);
    // A ground view is not a 2D box, so the follower does not clamp it (RtsCamera keeps it over the map).
    const clamp = this.groundCam === null && (opts.clamp ?? skin.camera?.clamp) !== false;
    this.follower = new CameraFollower({ clamp });
    this.scene.background = new Color(opts.background ?? skinBackground(skin));

    const look = (this.look = resolveScene3d(skin.scene3d, this.cam3d.lights));
    this.renderScale = opts.renderScale ?? look.renderScale;
    this.ambient = new AmbientLight(look.ambient.color, look.ambient.intensity);
    this.sun = new DirectionalLight(look.sun.color, look.sun.intensity);
    this.sunFrom = new Vector3(look.sun.direction.x, look.sun.direction.y, look.sun.direction.z);
    this.sun.position.copy(this.sunFrom);
    this.sun.castShadow = look.sun.shadow !== null;
    if (look.sun.shadow !== null) {
      const { mapSize, bias, radius } = look.sun.shadow;
      this.sun.shadow.mapSize.set(mapSize, mapSize);
      this.sun.shadow.bias = bias;
      this.sun.shadow.normalBias = 0.5;
      this.sun.shadow.radius = radius;
    }
    this.scene.add(this.ambient, this.sun);
    this.hemisphere = null;
    if (look.hemisphere !== null) {
      const { sky, ground, intensity } = look.hemisphere;
      this.hemisphere = new HemisphereLight(sky, ground, intensity);
      this.scene.add(this.hemisphere);
    }
    if (look.fog !== null) {
      this.scene.fog =
        look.fog.kind === 'linear'
          ? new Fog(look.fog.color, look.fog.near, look.fog.far)
          : new FogExp2(look.fog.color, look.fog.density);
    }

    const overlayMaterial = new MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
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
    this.labels = new HudLayer(skin, opts.sheets, opts.fonts);
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
    this.updateLights(frame.frame);
    this.updateLabels(frame, size);
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

  /**
   * The ground view's projection last frame, without shake (Engine 0.16 F2), or null in side
   * view: the same numbers `RtsCamera.projection()` gives for the same centre and zoom.
   */
  get groundProjection(): GroundProjection | null {
    return this.groundShown;
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
    this.labels.dispose();
    this.parallax.dispose();
  }

  /** The labels shown last frame, in draw order (picture px), for tests. */
  labelViews(): LabelView[] {
    return this.labelShown.map((v) => ({ ...v, box: { ...v.box } }));
  }

  /** The point lights on entities, by entity id (Engine 0.16 T12), for tests. */
  pointLights(): { id: string; light: PointLight }[] {
    const out: { id: string; light: PointLight }[] = [];
    for (const [id, node] of this.nodes) if (node.light) out.push({ id, light: node.light.light });
    return out;
  }

  // ---- Lights and labels (Engine 0.16 T12) ----

  /** Each entity's point light: its intensity, flickering by the presentation RNG when its spec asks. */
  private updateLights(frame: number): void {
    for (const [id, node] of this.nodes) {
      if (!node.light) continue;
      const { light, spec } = node.light;
      const flicker = spec.flicker ?? 0;
      const amount = flicker > 0 ? fxRng(this.opts.seed ?? 0, frame, `light:${id}`).float() : 0;
      light.intensity = spec.intensity * (1 - flicker * amount);
    }
  }

  /**
   * Lays the skin's `labels` out over the entities: each label's anchor on the entity box, at
   * its layer's depth, projected through the camera to picture px; a point behind the camera or
   * off the picture hides that label. Drawn by the `labels` layer's quads.
   */
  private updateLabels(frame: Frame, size: ScreenSize): void {
    const draws: UiDraw[] = [];
    const views: LabelView[] = [];
    this.layoutPlaces(frame, size, draws, views);
    if (this.skin.labels !== undefined) {
      const cam = this.camera;
      const p = new Vector3();
      for (const e of frame.entities) {
        const list = skinLabels(this.skin.labels, e.kind);
        if (list.length === 0) continue;
        const z = (e.layer ?? 0) * this.cam3d.layerDepth;
        const ground = this.groundCamera;
        const project = (anchor: NonNullable<SkinLabel['anchor']>) => {
          if (ground !== null) return this.groundLabelPoint(ground, e, anchor, size);
          const y = anchor === 'top' ? e.y : anchor === 'center' ? e.y + e.h / 2 : e.y + e.h;
          p.set(e.x + e.w / 2, -y, z).applyMatrix4(cam.matrixWorldInverse);
          if (p.z > -cam.near) return null;
          p.applyMatrix4(cam.projectionMatrix);
          const x = ((p.x + 1) / 2) * size.width;
          const sy = ((1 - p.y) / 2) * size.height;
          if (x < 0 || x >= size.width || sy < 0 || sy >= size.height) return null;
          return { x, y: sy };
        };
        const out = layoutLabels(list, e, frame.status, project, this.opts.fonts);
        draws.push(...out.draws);
        views.push(...out.views);
      }
    }
    this.labelShown = views;
    this.labels.syncDraws(draws, size);
  }

  /**
   * The skin's `places` for the map shown (Engine 0.16 F3): each name centred on its world point
   * (in ground view `height` px over the floor; in side view at z = `height`) projected through
   * this frame's camera, laid out as a text label (`layoutLabels`, so it draws like one), under
   * the entities' labels. A point off the picture or behind the camera hides its name. Its
   * `LabelView` has entity `place:<i>` and kind `place`.
   */
  private layoutPlaces(frame: Frame, size: ScreenSize, draws: UiDraw[], views: LabelView[]): void {
    const map = this.shown?.map;
    const list = map === undefined || !this.mapVisible ? undefined : this.skin.places?.[map.id];
    if (list === undefined) return;
    const cam = this.camera;
    const p = new Vector3();
    list.forEach((place, i) => {
      const project = () => {
        const ground = this.groundCamera;
        let x: number;
        let y: number;
        if (ground !== null) {
          const at = ground.worldToScreen(place.x, place.y, place.height ?? 0);
          if (at === null) return null;
          ({ x, y } = at);
        } else {
          p.set(place.x, -place.y, place.height ?? 0).applyMatrix4(cam.matrixWorldInverse);
          if (p.z > -cam.near) return null;
          p.applyMatrix4(cam.projectionMatrix);
          x = ((p.x + 1) / 2) * size.width;
          y = ((1 - p.y) / 2) * size.height;
        }
        if (x < 0 || x >= size.width || y < 0 || y >= size.height) return null;
        return { x, y };
      };
      const label: SkinLabel = {
        as: 'text',
        format: place.text,
        font: place.font,
        anchor: 'center',
        offset: place.offset ?? { x: 0, y: 0 },
        ...(place.color !== undefined && { color: place.color }),
        ...(place.shadow !== undefined && { shadow: place.shadow }),
        ...(place.outline !== undefined && { outline: place.outline }),
      };
      const entity: PresentEntity = {
        id: `place:${i}`,
        kind: 'place',
        x: place.x,
        y: place.y,
        w: 0,
        h: 0,
        facing: 'down',
        anim: { state: 'idle', t: 0 },
        tags: [],
      };
      const out = layoutLabels([label], entity, frame.status, project, this.opts.fonts);
      draws.push(...out.draws);
      views.push(...out.views);
    });
  }

  /**
   * Ground view: a label's anchor over the entity's box centre at the top of its meshes, half
   * way up or on the ground, projected through this frame's camera (shake included, as the
   * picture is), or null when it is behind the camera or off the picture.
   */
  private groundLabelPoint(
    ground: GroundProjection,
    e: Entity,
    anchor: NonNullable<SkinLabel['anchor']>,
    size: ScreenSize,
  ): { x: number; y: number } | null {
    const top = this.nodes.get(e.id)?.height ?? e.h;
    const h = anchor === 'top' ? top : anchor === 'center' ? top / 2 : 0;
    const lift = (e.layer ?? 0) * GROUND_LAYER_LIFT;
    const p = ground.worldToScreen(e.x + e.w / 2, e.y + e.h / 2, h + lift);
    if (p === null) return null;
    const { x, y } = p;
    if (x < 0 || x >= size.width || y < 0 || y >= size.height) return null;
    return { x, y };
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
   * plane; in ground view at (x, y) on the ground, {@link GROUND_PARTICLE_HEIGHT} up) into the
   * two `Points` buffers by blend, at most {@link PARTICLE_POOL} each. Colours
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
      if (this.groundCam)
        (g.attributes['position'] as BufferAttribute).setXYZ(i, p.x, GROUND_PARTICLE_HEIGHT, p.y);
      else (g.attributes['position'] as BufferAttribute).setXYZ(i, p.x, -p.y, PARTICLE_Z);
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
      points.material.uniforms['uScale']!.value = scale * this.renderScale;
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
      if (tile === null) continue;
      const spec = resolveTileModel(tiles[tile]!, frame);
      instance.pose(spec?.clip ?? null, spec?.time ?? 0);
    }
  }

  /**
   * One `InstancedMesh` per tile key and mesh part, for `tiles` and then each layer. A tile whose
   * entry has a loaded `model` is one `InstancedMesh` per tile key and model mesh (Engine 0.16 F3;
   * a model with a `clip` or skinned meshes is one model copy per cell instead, as in T11), each
   * cell turned, stretched and tinted by the entry's `vary`. Then the skin's `decor` for the map.
   */
  private buildMap(map: DeepReadonly<PresentMap>): ShownMap {
    const group = new Group();
    const models: ShownMap['models'] = [];
    const waiting = new Set<string>();
    group.name = `map:${map.id}@${map.version}`;
    const ts = map.tileSize;
    const tiles = this.skin.tiles ?? {};
    const seed = this.opts.seed ?? 0;
    const materials = new Map<string, MeshLambertMaterial>();
    const material = (color: string) => {
      let m = materials.get(color);
      if (!m) materials.set(color, (m = new MeshLambertMaterial({ color })));
      return m;
    };
    const ground = this.groundCam !== null;
    // Side view: layers behind the tiles. Ground view: every layer on the floor (height 0).
    const grids: { tiles: DeepReadonly<PresentMapLayer['tiles']>; z: number; layer: string }[] = [
      { tiles: map.tiles, z: 0, layer: 'tiles' },
      ...(map.layers ?? []).map((l, i) => ({
        tiles: l.tiles,
        z: ground ? 0 : -(i + 1) * this.cam3d.layerDepth,
        layer: l.name,
      })),
    ];
    const matrix = new Matrix4();
    const at = new Vector3();
    const turn = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    /** A model's anchor point for a cell: its bottom centre (side view) or centre on the floor (ground view). */
    const cellPoint = (col: number, row: number, z: number) =>
      ground
        ? new Vector3(col * ts + ts / 2, z, row * ts + ts / 2)
        : new Vector3(col * ts + ts / 2, -(row + 1) * ts, z);
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
        const entry = tiles[key]!;
        const spec = resolveTileModel(entry);
        const loaded = spec && this.opts.models ? this.opts.models.get(spec.model) : null;
        if (spec && loaded) {
          const vary = list.map(([col, row]) =>
            tileVariation(entry.vary, seed, map.id, grid.layer, col, row),
          );
          const parts = entry.clip === undefined ? modelMeshParts(loaded, spec, { w: ts, h: ts }) : null;
          if (parts) {
            const cellMatrices = list.map(([col, row], i) =>
              new Matrix4().compose(
                cellPoint(col, row, grid.z),
                new Quaternion().setFromAxisAngle(up, (vary[i]!.turns * Math.PI) / 2),
                new Vector3(1, vary[i]!.height, 1),
              ),
            );
            const tints = entry.vary?.tint ? vary.map((v) => v.tint) : null;
            addInstanced(group, parts, cellMatrices, tints, {
              name: `tile:${key}:model`,
              userData: { tile: key, layer: grid.layer, model: spec.model },
              castShadow: spec.castShadow,
              receiveShadow: entry.receiveShadow === true,
            });
            continue;
          }
          list.forEach(([col, row], i) => {
            const instance = new ModelInstance(loaded, spec, { w: ts, h: ts });
            instance.object.name = `tile:${key}:model`;
            instance.object.userData = { tile: key, layer: grid.layer, model: spec.model };
            instance.object.position.copy(cellPoint(col, row, grid.z));
            instance.object.rotation.y = (vary[i]!.turns * Math.PI) / 2;
            instance.object.scale.y = vary[i]!.height;
            if (vary[i]!.tint !== 1) tintMaterials(instance.materials, vary[i]!.tint);
            if (entry.receiveShadow === true) for (const m of instance.meshes()) m.receiveShadow = true;
            group.add(instance.object);
            models.push({ instance, tile: key });
          });
          continue;
        }
        if (spec && this.opts.models) waiting.add(spec.model);
        const parts = resolveMeshParts(this.skin, entry, { w: ts, h: ts });
        parts.forEach((part, p) => {
          const blocks = new InstancedMesh(
            this.geometries.get(part.shape, ground ? groundSize(part) : part.size),
            material(part.color),
            list.length,
          );
          blocks.name = `tile:${key}:${p}`;
          if (entry.castShadow === true) blocks.castShadow = true;
          if (entry.receiveShadow === true) blocks.receiveShadow = true;
          blocks.userData = { tile: key, part: p, layer: grid.layer };
          turn.setFromAxisAngle(up, (part.rotate * Math.PI) / 2);
          if (ground && part.shape === 'plane') turn.multiply(flat);
          list.forEach(([col, row], i) => {
            if (ground) {
              const off = groundOffset(part, { w: 0, h: 0 });
              at.set(col * ts + off.x, grid.z + off.y, row * ts + off.z);
            } else
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
    this.buildDecor(map, group, models, waiting, cellPoint);
    return { map, group, models, waiting: [...waiting] };
  }

  /**
   * The skin's `decor` for this map (Engine 0.16 F3): each placement (`placeDecor`, from the
   * presentation RNG) at its cell's model point plus its offset, turned by its yaw (clockwise seen
   * from above) and scaled; one `InstancedMesh` per legend character, model and mesh
   * (`decor:<char>:<model>:<i>`), or a model copy per cell for `instanced: false` or a skinned
   * model (`decor:<char>`). A model still loading shows nothing until it is there (then the map is
   * rebuilt); a grid the `decor` option lacks shows nothing.
   */
  private buildDecor(
    map: DeepReadonly<PresentMap>,
    group: Group,
    models: ShownMap['models'],
    waiting: Set<string>,
    cellPoint: (col: number, row: number, z: number) => Vector3,
  ): void {
    const entry = this.skin.decor?.[map.id];
    const rows = entry === undefined ? undefined : this.opts.decor?.[entry.grid];
    const library = this.opts.models;
    if (entry === undefined || rows === undefined || library === undefined) return;
    const ground = this.groundCam !== null;
    const placed = placeDecor(entry, rows, map.id, this.opts.seed ?? 0, { cols: map.cols, rows: map.rows });
    const deg = Math.PI / 180;
    const up = new Vector3(0, 1, 0);
    const batches = new Map<
      string,
      {
        spec: SkinModel;
        loaded: LoadedModel;
        cells: Matrix4[];
        char: string;
        cast: boolean;
        receive: boolean;
      }
    >();
    for (const p of placed) {
      const loaded = library.get(p.model);
      if (loaded === null) {
        if (library.status(p.model) === 'loading') waiting.add(p.model);
        continue;
      }
      const point = cellPoint(p.col, p.row, 0).add(
        ground
          ? new Vector3(p.offset.x, p.offset.z, p.offset.y)
          : new Vector3(p.offset.x, -p.offset.y, p.offset.z),
      );
      const yaw = new Quaternion().setFromAxisAngle(up, -p.yaw * deg);
      const spec: SkinModel = {
        model: p.model,
        scale: 1,
        anchor: p.anchor ?? 'bottom',
        rotate: p.rotate,
        castShadow: p.castShadow,
        clip: null,
        time: 0,
        offset: { x: 0, y: 0, z: 0 },
      };
      if (!p.instanced) {
        const instance = new ModelInstance(loaded, { ...spec, scale: p.scale }, { w: 0, h: 0 });
        instance.object.name = `decor:${p.char}`;
        instance.object.userData = { decor: p.char, model: p.model, col: p.col, row: p.row };
        instance.object.position.copy(point);
        instance.object.quaternion.copy(yaw);
        if (p.receiveShadow) for (const m of instance.meshes()) m.receiveShadow = true;
        group.add(instance.object);
        models.push({ instance, tile: null });
        continue;
      }
      const key = `${p.char}\u0000${p.model}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { spec, loaded, cells: [], char: p.char, cast: p.castShadow, receive: p.receiveShadow };
        batches.set(key, batch);
      }
      batch.cells.push(new Matrix4().compose(point, yaw, new Vector3(p.scale, p.scale, p.scale)));
    }
    for (const b of batches.values()) {
      const parts = modelMeshParts(b.loaded, b.spec, { w: 0, h: 0 });
      const userData = { decor: b.char, model: b.spec.model };
      if (parts) {
        addInstanced(group, parts, b.cells, null, {
          name: `decor:${b.char}:${b.spec.model}`,
          userData,
          castShadow: b.cast,
          receiveShadow: b.receive,
        });
        continue;
      }
      // A skinned model cannot be instanced: a copy per cell, scaled by its cell matrix.
      for (const cell of b.cells) {
        const instance = new ModelInstance(b.loaded, b.spec, { w: 0, h: 0 });
        instance.object.name = `decor:${b.char}`;
        instance.object.userData = userData;
        cell.decompose(instance.object.position, instance.object.quaternion, instance.object.scale);
        if (b.receive) for (const m of instance.meshes()) m.receiveShadow = true;
        group.add(instance.object);
        models.push({ instance, tile: null });
      }
    }
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
      if (entry?.receiveShadow === true) for (const m of instance.meshes()) m.receiveShadow = true;
      const look = this.lookOf(e);
      const bounds = this.groundCam ? new Box3().setFromObject(instance.object, true) : null;
      return {
        root,
        kind: e.kind,
        w: e.w,
        h: e.h,
        look,
        shape,
        model: instance,
        materials: instance.materials,
        light: this.lightFor(root, e),
        height: bounds === null || bounds.isEmpty() ? e.h : bounds.max.y,
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
    const ground = this.groundCam !== null;
    let height = 0;
    for (const part of parts) {
      const material = new MeshLambertMaterial({ color: part.color });
      materials.push(material);
      const mesh = new Mesh(this.geometries.get(part.shape, ground ? groundSize(part) : part.size), material);
      if (entry?.castShadow === true) mesh.castShadow = true;
      if (entry?.receiveShadow === true) mesh.receiveShadow = true;
      if (ground) {
        // Ground view: x, y on the box's footprint about its centre, z the height of the bottom.
        const off = groundOffset(part, box);
        mesh.position.set(off.x, off.y, off.z);
        mesh.rotation.set(part.shape === 'plane' ? -Math.PI / 2 : 0, (part.rotate * Math.PI) / 2, 0, 'YXZ');
        height = Math.max(height, part.at.z + (part.shape === 'plane' ? 0 : part.size.d));
      } else {
        // Parts are placed from the box's top-left (y down); the root is its bottom centre (y up).
        mesh.position.set(
          part.at.x + part.size.w / 2 - box.w / 2,
          box.h - part.at.y - part.size.h / 2,
          part.at.z,
        );
        mesh.rotation.y = (part.rotate * Math.PI) / 2;
      }
      root.add(mesh);
    }
    return {
      root,
      kind: e.kind,
      w: e.w,
      h: e.h,
      look: this.lookOf(e),
      shape,
      model: null,
      materials,
      light: this.lightFor(root, e),
      height: ground ? height : e.h,
    };
  }

  /**
   * The kind's `light` (Engine 0.16 T12) as a `PointLight` on the root, at the box's centre plus
   * its `offset` (mesh space: y down), or null. No shadows from point lights.
   */
  private lightFor(root: Group, e: Entity): EntityNode['light'] {
    const kinds = this.skin.kinds;
    const spec = Object.hasOwn(kinds, e.kind) ? kinds[e.kind]!.light : undefined;
    if (spec === undefined) return null;
    const light = new PointLight(spec.color, spec.intensity, spec.distance, spec.decay ?? POINT_LIGHT_DECAY);
    light.name = `light:${e.id}`;
    const at = spec.offset ?? { x: 0, y: 0, z: 0 };
    light.position.set(at.x, e.h / 2 - at.y, at.z);
    root.add(light);
    return { light, spec };
  }

  private place(node: EntityNode, e: Entity): void {
    const fx = e.fx;
    if (this.groundCam) this.placeOnGround(node, e);
    else this.placeSide(node, e);
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

  /** Ground view: the root on the box's centre on the floor, turned to its facing about the vertical. */
  private placeOnGround(node: EntityNode, e: Entity): void {
    const fx = e.fx;
    node.root.position.set(e.x + e.w / 2, (e.layer ?? 0) * GROUND_LAYER_LIFT, e.y + e.h / 2);
    const across = fx?.squashX ?? 1;
    node.root.scale.set(across, fx?.squashY ?? 1, across);
    // `rotate` is clockwise seen from above: a negative turn about the vertical.
    node.root.rotation.set(
      0,
      groundFacingTurn(facingVector(e.facing)) - ((fx?.rotate ?? 0) * Math.PI) / 180,
      0,
    );
  }

  private placeSide(node: EntityNode, e: Entity): void {
    const fx = e.fx;
    const mirror = facesLeft(e.facing) ? -1 : 1;
    node.root.position.set(e.x + e.w / 2, -(e.y + e.h), (e.layer ?? 0) * this.cam3d.layerDepth);
    node.root.scale.set(mirror * (fx?.squashX ?? 1), fx?.squashY ?? 1, 1);
    // `rotate` is clockwise on screen; with y up that is a negative turn about z.
    node.root.rotation.z = (-(fx?.rotate ?? 0) * Math.PI) / 180;
  }

  // ---- Camera ----

  /**
   * With shadows on, the sun follows the view: it shines from its direction onto the view's
   * centre (on the z = 0 plane) and its shadow camera covers the view and a margin. Without
   * shadows it stays where it was set (only its direction matters).
   */
  private updateSun(cx: number, cy: number, view: { width: number; height: number }, distance: number): void {
    if (this.look.sun.shadow === null) return;
    const half = Math.hypot(view.width, view.height) / 2 + SHADOW_MARGIN;
    const reach = half * 2 + distance;
    SUN_DIR.copy(this.sunFrom).normalize();
    this.sun.target.position.set(cx, cy, 0);
    this.sun.position.set(cx + SUN_DIR.x * reach, cy + SUN_DIR.y * reach, SUN_DIR.z * reach);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -half;
    shadowCam.right = half;
    shadowCam.top = half;
    shadowCam.bottom = -half;
    shadowCam.near = 1;
    shadowCam.far = reach * 2;
    shadowCam.updateProjectionMatrix();
  }

  /**
   * Ground view (Engine 0.16 F2): the camera from `groundProjection` at the framed view's centre
   * (shake moves it along the picture's axes on the ground), the overlay, the sun's shadow camera
   * over the ground footprint, linear fog from the camera's distance, and the parallax planes.
   */
  private updateGroundCamera(
    size: ScreenSize,
    zoom: number,
    top: { x: number; y: number },
    view: ScreenSize,
    shakeX: number,
    shakeY: number,
    focus: { x: number; y: number } | null,
  ): void {
    const camera = this.groundCam!;
    const centre = { x: top.x + view.width / 2, y: top.y + view.height / 2 };
    this.groundShown = groundProjection(size, zoom, centre, camera);
    // Picture right and down along the ground (the camera's right, and its view flattened).
    const r = this.groundShown.right;
    const f = this.groundShown.forward;
    const flat = Math.hypot(f.x, f.y);
    const down =
      flat > 1e-9
        ? { x: -f.x / flat, y: -f.y / flat }
        : { x: -this.groundShown.up.x, y: -this.groundShown.up.y };
    const shaken = {
      x: centre.x + (r.x * shakeX + down.x * shakeY) / zoom,
      y: centre.y + (r.y * shakeX + down.y * shakeY) / zoom,
    };
    const g = (this.groundCamera =
      shakeX === 0 && shakeY === 0 ? this.groundShown : groundProjection(size, zoom, shaken, camera));
    const { fov } = this.cam3d;
    const distance = g.distance;
    const cam = this.camera;
    cam.fov = fov;
    cam.aspect = size.width / size.height;
    cam.near = Math.max(0.1, distance / 100);
    cam.far = distance * 10 + 1000;
    cam.position.set(g.eye.x, g.eye.h, g.eye.y);
    cam.rotation.set((-camera.pitch * Math.PI) / 180, (camera.yaw * Math.PI) / 180, 0, 'YXZ');
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    if (focus === null) this.focusPoint = null;
    else {
      const p = g.worldToScreen(focus.x, focus.y);
      this.focusPoint = p === null ? null : { x: p.x, y: p.y };
    }

    const at = cam.near * 2;
    const h = 2 * at * Math.tan((fov * Math.PI) / 360);
    this.overlay.position.set(0, 0, -at);
    this.overlay.scale.set(h * cam.aspect * 1.01, h * 1.01, 1);

    this.updateGroundSun(g);
    const fog = this.look.fog;
    if (fog !== null && fog.kind === 'linear' && this.scene.fog instanceof Fog) {
      this.scene.fog.near = distance + fog.near;
      this.scene.fog.far = distance + fog.far;
    }
    const picture = { x: Math.round(top.x * zoom) + shakeX, y: Math.round(top.y * zoom) + shakeY };
    this.parallax.sync(picture, size, cam, distance);
  }

  /**
   * Ground view: with shadows on, the sun shines from its direction onto the centre of the
   * picture's ground footprint (`footprint()`, far rays capped at `GROUND_REACH` distances) and
   * its shadow camera covers that footprint and a margin, whatever way the sun turns it.
   */
  private updateGroundSun(g: GroundProjection): void {
    if (this.look.sun.shadow === null) return;
    const box = pointsBox(g.footprint());
    const cx = box.x + box.w / 2;
    const cz = box.y + box.h / 2;
    const half = Math.hypot(box.w, box.h) / 2 + SHADOW_MARGIN;
    const reach = half * 2 + g.distance;
    SUN_DIR.copy(this.sunFrom).normalize();
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + SUN_DIR.x * reach, SUN_DIR.y * reach, cz + SUN_DIR.z * reach);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    const shadowCam = this.sun.shadow.camera;
    shadowCam.left = -half;
    shadowCam.right = half;
    shadowCam.top = half;
    shadowCam.bottom = -half;
    shadowCam.near = 1;
    shadowCam.far = reach * 2;
    shadowCam.updateProjectionMatrix();
  }

  private updateCamera(frame: Frame, size: ScreenSize): void {
    const base = cameraZoom(frame, this.skin.camera);
    const map = this.mapVisible ? (this.shown?.map ?? null) : null;
    const framedTop = this.follower.update(frame, this.skin.camera, cameraView(size, base), map);
    // A zoom punch zooms the framed view about its centre, as the Canvas2D presenter does.
    const fx = this.cameraFx.state(this.fxClock, this.settings);
    const area = cameraArea(
      frame,
      map,
      this.groundCam === null && (this.opts.clamp ?? this.skin.camera?.clamp) !== false,
    );
    const focus = cameraTarget(frame, this.skin.camera);
    const { cam: top, view } = zoomAbout(framedTop, cameraView(size, base), fx.zoom, area, focus);
    const zoom = base * fx.zoom;
    this.framed = { x: top.x, y: top.y, w: view.width, h: view.height };

    // Shake in picture px (old `shake` effects and the hint's, scaled; then trauma), in world px.
    const shakes = this.effects.filter((a) => a.effect.kind === 'shake').map((a) => a.effect.size ?? 2);
    const scale = Math.min(1, Math.max(0, this.settings.shakeScale ?? 1));
    const shakeX = Math.round(cameraShake(frame, shakes) * scale) + fx.shakeX;
    const shakeY = fx.shakeY;
    if (this.groundCam) {
      this.updateGroundCamera(size, zoom, top, view, shakeX, shakeY, focus);
      return;
    }
    this.groundShown = null;
    this.groundCamera = null;
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

    this.updateSun(cx, cy, view, distance);
    // Linear fog is measured from the camera; the skin gives it behind the z = 0 plane.
    const fog = this.look.fog;
    if (fog !== null && fog.kind === 'linear' && this.scene.fog instanceof Fog) {
      this.scene.fog.near = distance + fog.near;
      this.scene.fog.far = distance + fog.far;
    }

    // Parallax planes scroll against the camera's top-left in picture px, as in 2D.
    const picture = { x: Math.round(top.x * zoom) + shakeX, y: Math.round(top.y * zoom) + shakeY };
    this.parallax.sync(picture, size, cam, distance);
  }
}

/** Scratch vector for the sun's direction (one scene updates at a time). */
const SUN_DIR = new Vector3();

/**
 * Ground view: a part's geometry size in Three's axes. Its `d` is its height (Three's y) and its
 * `h` its depth along the map (Three's z), so round shapes stay upright; a `plane` keeps `w` x `h`
 * and is laid flat by its turn.
 */
function groundSize(part: MeshPart): { w: number; h: number; d: number } {
  if (part.shape === 'plane') return part.size;
  return { w: part.size.w, h: part.size.d, d: part.size.h };
}

/**
 * Ground view: a part's centre from the centre of `box` on the floor (Three's axes): `at.x` and
 * `at.y` place its footprint from the box's top-left, `at.z` is the height of its bottom.
 */
function groundOffset(part: MeshPart, box: { w: number; h: number }): { x: number; y: number; z: number } {
  const up = part.shape === 'plane' ? 0 : part.size.d / 2;
  return {
    x: part.at.x + part.size.w / 2 - box.w / 2,
    y: part.at.z + up,
    z: part.at.y + part.size.h / 2 - box.h / 2,
  };
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

/**
 * One `InstancedMesh` per model mesh (Engine 0.16 F3), named `<name>:<i>`, with one instance per
 * cell matrix (the cell's place, turn and scale times the mesh's own placement), each tinted by
 * `tints` when given (a brightness factor, `setColorAt`). Geometries and materials are the model
 * library's: `userData.shared` keeps `disposeMap` off them.
 */
function addInstanced(
  group: Group,
  parts: readonly ModelMeshPart[],
  cells: readonly Matrix4[],
  tints: readonly number[] | null,
  opts: { name: string; userData: Record<string, unknown>; castShadow: boolean; receiveShadow: boolean },
): void {
  const m = new Matrix4();
  const tint = new Color();
  parts.forEach((part, p) => {
    const mesh = new InstancedMesh(part.geometry, part.material, cells.length);
    mesh.name = `${opts.name}:${p}`;
    mesh.userData = { ...opts.userData, part: p, shared: true };
    mesh.castShadow = opts.castShadow;
    mesh.receiveShadow = opts.receiveShadow;
    cells.forEach((cell, i) => {
      mesh.setMatrixAt(i, m.multiplyMatrices(cell, part.matrix));
      if (tints) mesh.setColorAt(i, tint.setScalar(tints[i]!));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
}

/** Multiplies each material's colour by `factor` (a model copy's own materials: a `vary.tint`). */
function tintMaterials(materials: readonly Material[], factor: number): void {
  for (const m of materials) {
    const c = (m as Material & { color?: Color }).color;
    if (c instanceof Color) c.multiplyScalar(factor);
  }
}

function disposeMap(shown: ShownMap): void {
  const materials = new Set<Material>();
  for (const { instance } of shown.models) instance.dispose();
  for (const child of shown.group.children) {
    if (child instanceof InstancedMesh) {
      // A model's instanced meshes share the library's geometry and materials (Engine 0.16 F3).
      if (child.userData['shared'] !== true) materials.add(child.material as Material);
      child.dispose();
    }
  }
  for (const m of materials) m.dispose();
}

function disposeNode(node: EntityNode): void {
  if (node.model) node.model.dispose();
  else for (const m of node.materials) m.dispose();
}
