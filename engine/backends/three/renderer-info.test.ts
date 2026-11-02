import { describe, expect, it } from 'vitest';
import {
  GL_RENDERER,
  GL_VENDOR,
  isSoftwareRenderer,
  UNMASKED_RENDERER_WEBGL,
  UNMASKED_VENDOR_WEBGL,
  webglRendererInfo,
  type GlInfoSource,
} from './renderer-info';

/** A fake WebGL context: `params` answers getParameter, `debug` says whether the extension exists. */
function fakeGl(params: Record<number, unknown>, debug: boolean): GlInfoSource & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    getParameter: (pname) => params[pname] ?? null,
    getExtension: (name) => {
      asked.push(name);
      return debug && name === 'WEBGL_debug_renderer_info'
        ? { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL }
        : null;
    },
  };
}

describe('isSoftwareRenderer', () => {
  it.each([
    'Google SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'softpipe',
    'Software Rasterizer',
    'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
  ])('is true for %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(true);
  });

  it.each([
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 6800 XT (0x000073BF) Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)',
    'Apple M1',
    'NVIDIA GeForce GTX 1060 6GB/PCIe/SSE2',
    'AMD Radeon Pro 5500M OpenGL Engine',
    'Mesa Intel(R) Xe Graphics (TGL GT2)',
    'Adreno (TM) 650',
    'WebKit WebGL',
    '',
  ])('is false for %s', (name) => {
    expect(isSoftwareRenderer(name)).toBe(false);
  });
});

describe('webglRendererInfo', () => {
  const params = {
    [UNMASKED_VENDOR_WEBGL]: 'Google Inc. (NVIDIA)',
    [UNMASKED_RENDERER_WEBGL]: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    [GL_VENDOR]: 'WebKit',
    [GL_RENDERER]: 'WebKit WebGL',
  };

  it('reads the unmasked names through WEBGL_debug_renderer_info', () => {
    const gl = fakeGl(params, true);
    expect(webglRendererInfo(gl)).toEqual({
      vendor: 'Google Inc. (NVIDIA)',
      renderer: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      unmasked: true,
    });
    expect(gl.asked).toEqual(['WEBGL_debug_renderer_info']);
  });

  it('falls back to VENDOR and RENDERER without the extension', () => {
    expect(webglRendererInfo(fakeGl(params, false))).toEqual({
      vendor: 'WebKit',
      renderer: 'WebKit WebGL',
      unmasked: false,
    });
  });

  it('falls back when the extension gives no renderer', () => {
    const gl = fakeGl({ [GL_VENDOR]: 'Mesa', [GL_RENDERER]: 'llvmpipe (LLVM 15.0.7, 256 bits)' }, true);
    const info = webglRendererInfo(gl);
    expect(info).toEqual({ vendor: 'Mesa', renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)', unmasked: false });
    expect(isSoftwareRenderer(info.renderer)).toBe(true);
  });

  it('gives empty strings for a lost context', () => {
    expect(webglRendererInfo(fakeGl({}, false))).toEqual({ vendor: '', renderer: '', unmasked: false });
  });
});
