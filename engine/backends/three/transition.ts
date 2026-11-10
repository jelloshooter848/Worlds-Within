import { Color, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2 } from 'three';
import { WIPE_DIRECTIONS, type TransitionShape } from '@engine/core/fx';
import type { ScreenSize } from '@engine/core/gfx/screen';

const KIND = { fade: 0, wipe: 1, iris: 2 } as const;

const VERTEX = /* glsl */ `
uniform vec2 uSize;
varying vec2 vPos;
void main() {
  // Picture px, y down, as the 2D shapes are written.
  vPos = vec2((position.x + 0.5) * uSize.x, (0.5 - position.y) * uSize.y);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The same opacity as `transitionAlphaAt` in @engine/core/fx, per fragment (a pixel's centre).
const FRAGMENT = /* glsl */ `
uniform int uKind;
uniform vec3 uColor;
uniform float uAlpha;
uniform int uDir;
uniform vec2 uSize;
uniform float uLead;
uniform float uTrail;
uniform float uEdge;
uniform vec2 uCentre;
uniform float uRadius;
varying vec2 vPos;
float ramp(float d) {
  if (uEdge > 0.0) return clamp(d / uEdge, 0.0, 1.0);
  return d >= 0.0 ? 1.0 : 0.0;
}
void main() {
  float a = uAlpha;
  if (uKind == 1) {
    float s = uDir == 0 ? vPos.x : uDir == 1 ? uSize.x - vPos.x : uDir == 2 ? vPos.y : uSize.y - vPos.y;
    a = min(ramp(uLead - s), ramp(s - uTrail));
  } else if (uKind == 2) {
    a = distance(vPos, uCentre) >= uRadius ? 1.0 : 0.0;
  }
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`;

/**
 * The 3D backend's screen transition (Engine 0.16 T5): a pass of its own over the picture and the
 * HUD, one full-picture quad under an `OrthographicCamera` spanning the picture in picture px (as
 * the HUD's), with a small `ShaderMaterial` that works out each pixel's cover from the core
 * `TransitionShape` exactly as the 2D one does (`transitionAlphaAt`): a fade's alpha, a wipe's
 * soft-edged band along its travel, an iris's hole. Needs no WebGL: `sync` only sets uniforms, so
 * it runs in Node; `ThreePresenter` draws it last.
 */
export class TransitionLayer {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(0, 1, 0, -1, -10, 10);
  readonly material: ShaderMaterial;
  private readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private shape: TransitionShape | null = null;

  constructor() {
    this.material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uKind: { value: 0 },
        uColor: { value: new Color('#000000') },
        uAlpha: { value: 0 },
        uDir: { value: 0 },
        uSize: { value: new Vector2(1, 1) },
        uLead: { value: 0 },
        uTrail: { value: 0 },
        uEdge: { value: 0 },
        uCentre: { value: new Vector2(0, 0) },
        uRadius: { value: 0 },
      },
    });
    this.mesh = new Mesh(new PlaneGeometry(1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.scene.add(this.mesh);
  }

  /** Shows `shape` over a `size` picture from the next draw (null hides the pass). */
  sync(shape: TransitionShape | null, size: ScreenSize): void {
    this.shape = shape;
    this.mesh.visible = shape !== null;
    if (shape === null) return;
    const cam = this.camera;
    if (cam.right !== size.width || cam.bottom !== -size.height) {
      cam.right = size.width;
      cam.bottom = -size.height;
      cam.updateProjectionMatrix();
    }
    this.mesh.scale.set(size.width, size.height, 1);
    this.mesh.position.set(size.width / 2, -size.height / 2, 0);
    this.mesh.updateMatrixWorld();
    const u = this.material.uniforms;
    u['uKind']!.value = KIND[shape.kind];
    (u['uColor']!.value as Color).set(shape.color);
    (u['uSize']!.value as Vector2).set(size.width, size.height);
    u['uAlpha']!.value = shape.kind === 'fade' ? shape.alpha : 1;
    if (shape.kind === 'wipe') {
      u['uDir']!.value = WIPE_DIRECTIONS.indexOf(shape.direction);
      u['uLead']!.value = shape.lead;
      u['uTrail']!.value = shape.trail;
      u['uEdge']!.value = shape.edge;
    }
    if (shape.kind === 'iris') {
      (u['uCentre']!.value as Vector2).set(shape.x, shape.y);
      u['uRadius']!.value = shape.radius;
    }
  }

  /** The shape shown (after the last `sync`), or null. */
  get shown(): TransitionShape | null {
    return this.shape;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
