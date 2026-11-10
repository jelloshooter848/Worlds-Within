import {
  AdditiveBlending,
  AmbientLight,
  BufferAttribute,
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
import {
  CameraFx,
  fxRng,
  REST_STATE,
  SkinParticles,
  TweenSet,
  type CameraFxSettings,
  type ParticleView,
  type TweenState,
} from '@engine/core/fx';
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
  resolveScene3d,
  skinLabels,
  type Scene3dLook,
  type SkinKindLight,
  type SkinLabel,
  resolveSkinKind,
  resolveSkinMesh,
  resolveSkinModel,
  resolveTileModel,
  resolveTileFrame,
  sceneryModel,
  skinBackground,
  themedSkin,
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
import { layoutLabels, type FontLookup, type LabelView, type UiDraw } from '@engine/core/ui';
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
}

/** The map being shown, its built blocks, and whether this frame shows it. */
interface ShownMap {
  map: DeepReadonly<PresentMap>;
  group: Group;
  /** Tile cells shown as a model, each posed on the frame clock (the tile entry's `clip`). */
  models: { instance: ModelInstance; tile: string }[];
  /** Scenery copies (Engine 0.16 part B, T10). */
  scenery: ModelInstance[];
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
 * It never changes the frame or the skin, and uses no clock or unseeded randomness (Three's own
 * object UUIDs never reach any state).
 */
export class ThreeScene {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly ambient: AmbientLight;
  readonly sun: DirectionalLight;
  /** The skin's `scene3d.hemisphere` light (the shown map's theme's), or null (Engine 0.16 T12). */
  hemisphere: HemisphereLight | null;
  /**
   * The scene look with defaults filled (lights, shadows, fog, tone mapping, colour space): the
   * skin's, or from Engine 0.16 part B the shown map's `themes` entry's `scene3d`.
   */
  look: Scene3dLook;
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
  /** The skin as the shown map's theme lays it (Engine 0.16 part B, T10): tiles, sky, parallax, look, scenery. */
  private themed: Skin;
  /** The map id the theme was taken for (undefined: none yet or no map). */
  private themeFor: string | undefined;
  /** Running tweens by entity id (skin `events.<type>.tween`, `kinds.<kind>.spawnTween`; Engine 0.16 part B). */
  private readonly tweens = new Map<string, TweenSet>();
  /** The entity ids the last frame showed, so a new one gets its kind's `spawnTween`. */
  private seen = new Set<string>();
  /** The last frame number synced: a lower one is a new level (tweens start over). */
  private lastFrame: number | null = null;

  constructor(skin: Skin, opts: ThreeSceneOptions = {}) {
    this.skin = skin;
    this.themed = skin;
    this.opts = opts;
    this.size = opts.size;
    this.cam3d = resolveCamera3d(skin);
    this.follower = new CameraFollower({ clamp: (opts.clamp ?? skin.camera?.clamp) !== false });
    this.scene.background = new Color(opts.background ?? skinBackground(skin));

    const look = (this.look = resolveScene3d(skin.scene3d, this.cam3d.lights));
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
    this.updateTheme(frame);
    this.restartOnNewLevel(frame);
    this.takeEvents(frame);
    this.updateMap(frame);
    this.poseTileModels(frame.frame);
    this.updateTweens(frame);
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
    if (this.skin.labels !== undefined) {
      const cam = this.camera;
      const p = new Vector3();
      for (const e of frame.entities) {
        const list = skinLabels(this.skin.labels, e.kind);
        if (list.length === 0) continue;
        const z = (e.layer ?? 0) * this.cam3d.layerDepth;
        const project = (anchor: NonNullable<SkinLabel['anchor']>) => {
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
      if (entry.tween !== undefined && ev.entity !== undefined)
        this.tweensOf(ev.entity).add(entry.tween, frame.frame);
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
    const tiles = this.themed.tiles ?? {};
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
    const tiles = this.themed.tiles ?? {};
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
          const own = String(line[col]);
          if (!Object.hasOwn(tiles, own)) continue;
          // A 3D `join` (Engine 0.16 part B, T10) picks another tile entry by the cell's neighbours.
          const joined = resolveTileFrame({ join: tiles[own]!.join }, own, grid.tiles, col, row);
          const key = joined !== undefined && Object.hasOwn(tiles, joined) ? joined : own;
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
            if (tiles[key]!.receiveShadow === true) for (const m of instance.meshes()) m.receiveShadow = true;
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
          if (tiles[key]!.castShadow === true) blocks.castShadow = true;
          if (tiles[key]!.receiveShadow === true) blocks.receiveShadow = true;
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
    const scenery = this.buildScenery(map, group, waiting);
    return { map, group, models, scenery, waiting: [...waiting] };
  }

  /**
   * The shown skin's `scenery` rows (Engine 0.16 part B, T10): copies of each row's model along the
   * map, `every` px apart from `from` and past both ends by the row's depth (a row far behind shows
   * beyond the map's edge), each nudged by its own `jitter` drawn from `fxRng(seed, row,
   * "scenery:<copy>")`, so the same seed always places them the same. A row whose model is not
   * loaded yet waits (the map is rebuilt once it is there).
   */
  private buildScenery(map: DeepReadonly<PresentMap>, group: Group, waiting: Set<string>): ModelInstance[] {
    const out: ModelInstance[] = [];
    const width = map.cols * map.tileSize;
    const bottom = map.rows * map.tileSize;
    (this.themed.scenery ?? []).forEach((row, r) => {
      const loaded = this.opts.models?.get(row.model) ?? null;
      if (!loaded) {
        if (this.opts.models) waiting.add(row.model);
        return;
      }
      const base = sceneryModel(row);
      const from = row.from ?? 0;
      const margin = Math.abs(row.z) + row.every;
      const first = Math.ceil((-margin - from) / row.every);
      const last = Math.floor((width + margin - from) / row.every);
      const j = row.jitter ?? {};
      for (let i = first; i <= last; i++) {
        const rng = fxRng(this.opts.seed ?? 0, r, `scenery:${i}`);
        const spread = (amount: number | undefined) => (rng.float() * 2 - 1) * (amount ?? 0);
        const dx = spread(j.x);
        const dy = spread(j.y);
        const dz = spread(j.z);
        const ds = spread(j.scale);
        const turn = spread(j.turn);
        const instance = new ModelInstance(loaded, { ...base, scale: base.scale * (1 + ds) }, { w: 0, h: 0 });
        instance.object.name = `scenery:${r}:${i}`;
        instance.object.userData = { scenery: r, model: row.model };
        instance.object.position.set(from + i * row.every + dx, -((row.y ?? bottom) + dy), row.z + dz);
        instance.object.rotation.y = (turn * Math.PI) / 180;
        if (row.receiveShadow === true) for (const m of instance.meshes()) m.receiveShadow = true;
        group.add(instance.object);
        out.push(instance);
      }
    });
    return out;
  }

  /** The scenery copies of the built map (Engine 0.16 part B, T10), for tests. */
  sceneryObjects(): Group[] {
    return (this.shown?.scenery ?? []).map((s) => s.object);
  }

  // ---- Per-map looks (Engine 0.16 part B, T10) ----

  /**
   * The shown map's `themes` entry (`themedSkin`), taken when the map id changes: the clear
   * colour (unless the `background` option is set), the parallax layers, the scene look (lights,
   * fog), and, through the map build, the tiles and scenery. A skin without `themes` keeps its own.
   */
  private updateTheme(frame: Frame): void {
    const id = frame.map?.id ?? this.shown?.map.id;
    if (id === this.themeFor) return;
    this.themeFor = id;
    const themed = themedSkin(this.skin, id);
    if (themed === this.themed) return;
    this.themed = themed;
    if (this.opts.background === undefined) (this.scene.background as Color).set(skinBackground(themed));
    this.parallax.setSkin(themed);
    this.applyLook(resolveScene3d(themed.scene3d, this.cam3d.lights));
  }

  /** Sets the lights and fog to `look` (a theme's scene look), keeping the light objects. */
  private applyLook(look: Scene3dLook): void {
    this.look = look;
    this.ambient.color.set(look.ambient.color);
    this.ambient.intensity = look.ambient.intensity;
    this.sun.color.set(look.sun.color);
    this.sun.intensity = look.sun.intensity;
    this.sunFrom.set(look.sun.direction.x, look.sun.direction.y, look.sun.direction.z);
    if (look.sun.shadow === null) this.sun.position.copy(this.sunFrom);
    this.sun.castShadow = look.sun.shadow !== null;
    if (look.sun.shadow !== null) {
      const { mapSize, bias, radius } = look.sun.shadow;
      if (this.sun.shadow.mapSize.x !== mapSize) {
        this.sun.shadow.mapSize.set(mapSize, mapSize);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
      this.sun.shadow.bias = bias;
      this.sun.shadow.normalBias = 0.5;
      this.sun.shadow.radius = radius;
    }
    if (look.hemisphere === null) {
      if (this.hemisphere) this.scene.remove(this.hemisphere);
      this.hemisphere = null;
    } else {
      const { sky, ground, intensity } = look.hemisphere;
      if (!this.hemisphere) {
        this.hemisphere = new HemisphereLight(sky, ground, intensity);
        this.scene.add(this.hemisphere);
      }
      this.hemisphere.color.set(sky);
      this.hemisphere.groundColor.set(ground);
      this.hemisphere.intensity = intensity;
    }
    const fog = look.fog;
    if (fog === null) this.scene.fog = null;
    else if (fog.kind === 'linear') this.scene.fog = new Fog(fog.color, fog.near, fog.far);
    else this.scene.fog = new FogExp2(fog.color, fog.density);
  }

  // ---- Tweens (Engine 0.16 part B, T10; item 340) ----

  /**
   * A frame number lower than the last one is a new level (a kit's world starts again at 0, often
   * with the same entity ids): tweens and the ids seen are dropped, as the Canvas2D presenter does.
   */
  private restartOnNewLevel(frame: Frame): void {
    if (this.lastFrame !== null && frame.frame < this.lastFrame) {
      this.tweens.clear();
      this.seen = new Set();
    }
    this.lastFrame = frame.frame;
  }

  private tweensOf(id: string): TweenSet {
    let set = this.tweens.get(id);
    if (set === undefined) this.tweens.set(id, (set = new TweenSet()));
    return set;
  }

  /** Starts `spawnTween` on entities new this frame and drops ended tweens and those of entities gone. */
  private updateTweens(frame: Frame): void {
    const ids = new Set<string>();
    for (const e of frame.entities) {
      ids.add(e.id);
      if (this.seen.has(e.id)) continue;
      const kinds = this.skin.kinds;
      const spawn = Object.hasOwn(kinds, e.kind) ? kinds[e.kind]!.spawnTween : undefined;
      if (spawn !== undefined) this.tweensOf(e.id).add(spawn, frame.frame);
    }
    this.seen = ids;
    for (const [id, set] of this.tweens) {
      set.update(frame.frame);
      if (set.size === 0 || !ids.has(id)) this.tweens.delete(id);
    }
  }

  /** The tween state an entity shows at `frame` (the rest state when none runs), for tests. */
  tweenState(id: string, frame: number): TweenState {
    return this.tweens.get(id)?.state(frame) ?? { ...REST_STATE };
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
      this.place(node, e, frame.frame);
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
      if (entry?.receiveShadow === true) mesh.receiveShadow = true;
      // Parts are placed from the box's top-left (y down); the root is its bottom centre (y up).
      mesh.position.set(
        part.at.x + part.size.w / 2 - box.w / 2,
        box.h - part.at.y - part.size.h / 2,
        part.at.z,
      );
      mesh.rotation.y = (part.rotate * Math.PI) / 2;
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

  /**
   * Places an entity's root from its box, facing and `fx`, with its tweens laid on top (Engine
   * 0.16 part B, T10, item 340: `x`/`y` world px added, `scaleX`/`scaleY` times the squash (the
   * depth follows `scaleX`, so a squash stays solid), `rotate` added to the turn, `alpha` times the
   * alpha, and a `color` tween as the materials' emissive colour at its `colorAmount`). Nothing is
   * written back to the frame.
   */
  private place(node: EntityNode, e: Entity, frame: number): void {
    const fx = e.fx;
    const tw = this.tweens.get(e.id)?.state(frame) ?? REST_STATE;
    const mirror = facesLeft(e.facing) ? -1 : 1;
    node.root.position.set(e.x + tw.x + e.w / 2, -(e.y + tw.y + e.h), (e.layer ?? 0) * this.cam3d.layerDepth);
    node.root.scale.set(mirror * (fx?.squashX ?? 1) * tw.scaleX, (fx?.squashY ?? 1) * tw.scaleY, tw.scaleX);
    // `rotate` is clockwise on screen; with y up that is a negative turn about z.
    node.root.rotation.z = (-((fx?.rotate ?? 0) + tw.rotate) * Math.PI) / 180;
    if (node.model) {
      const spec = resolveSkinModel(this.skin, e);
      node.model.pose(spec?.clip ?? null, spec?.time ?? 0, spec?.hold ?? false);
    }
    const alpha = Math.min(1, Math.max(0, (fx?.alpha ?? 1) * tw.alpha));
    for (const m of node.materials) {
      const transparent = alpha < 1;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = alpha;
      flashMaterial(m, tw);
    }
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

/**
 * A colour tween's flash on one material (Engine 0.16 part B, T10): its emissive colour becomes
 * the tween colour times its `colorAmount` (a white hit flash), and goes back to the material's
 * own emissive when no colour tween runs. Materials without an emissive colour are left alone.
 */
function flashMaterial(m: Material, tw: Readonly<TweenState>): void {
  const emissive = (m as Material & { emissive?: Color }).emissive;
  if (!(emissive instanceof Color)) return;
  const own = m.userData['ownEmissive'] as Color | undefined;
  if (tw.color !== null && tw.colorAmount > 0) {
    if (own === undefined) m.userData['ownEmissive'] = emissive.clone();
    emissive.set(tw.color).multiplyScalar(tw.colorAmount);
  } else if (own !== undefined) {
    emissive.copy(own);
    delete m.userData['ownEmissive'];
  }
}

/** Scratch vector for the sun's direction (one scene updates at a time). */
const SUN_DIR = new Vector3();

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
  for (const instance of shown.scenery) instance.dispose();
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
