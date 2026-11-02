/**
 * Which WebGL renderer a context runs on, and whether it is a software one. Pure: it reads a
 * WebGL context through the small {@link GlInfoSource} shape, so it needs no `three` import and
 * is tested in Node with a fake context. Screenshots use it to refuse a silent fall-back to
 * software rendering (Engine 0.6).
 */

/** `WEBGL_debug_renderer_info` constants (the extension object carries the same values). */
export const UNMASKED_VENDOR_WEBGL = 0x9245;
export const UNMASKED_RENDERER_WEBGL = 0x9246;
/** The core `gl.VENDOR` and `gl.RENDERER` parameters. */
export const GL_VENDOR = 0x1f00;
export const GL_RENDERER = 0x1f01;

/** The part of a `WebGLRenderingContext` / `WebGL2RenderingContext` this module reads. */
export interface GlInfoSource {
  getParameter(pname: number): unknown;
  getExtension(name: string): unknown;
}

/** The WebGL vendor and renderer strings, and whether they are the unmasked ones. */
export interface WebglRendererInfo {
  vendor: string;
  renderer: string;
  /** True when read through `WEBGL_debug_renderer_info` (the real GPU names). */
  unmasked: boolean;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the renderer through `WEBGL_debug_renderer_info` (UNMASKED_VENDOR / UNMASKED_RENDERER),
 * falling back to the core `VENDOR` / `RENDERER` when the extension is missing or gives nothing.
 */
export function webglRendererInfo(gl: GlInfoSource): WebglRendererInfo {
  const ext = gl.getExtension('WEBGL_debug_renderer_info') as {
    UNMASKED_VENDOR_WEBGL?: number;
    UNMASKED_RENDERER_WEBGL?: number;
  } | null;
  if (ext) {
    const renderer = asString(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL ?? UNMASKED_RENDERER_WEBGL));
    const vendor = asString(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL ?? UNMASKED_VENDOR_WEBGL));
    if (renderer !== '') return { vendor, renderer, unmasked: true };
  }
  return {
    vendor: asString(gl.getParameter(GL_VENDOR)),
    renderer: asString(gl.getParameter(GL_RENDERER)),
    unmasked: false,
  };
}

/** Names of software rasterisers, as they show up in WebGL renderer strings. */
const SOFTWARE_RENDERERS: readonly RegExp[] = [
  /swiftshader/i,
  /llvmpipe/i,
  /softpipe/i,
  /\bsoftware\b/i,
  /microsoft basic render/i,
];

/**
 * True when a WebGL renderer string names a software rasteriser (SwiftShader, llvmpipe,
 * softpipe, "Software", Microsoft Basic Render Driver), including inside an ANGLE string.
 */
export function isSoftwareRenderer(name: string): boolean {
  return SOFTWARE_RENDERERS.some((re) => re.test(name));
}
