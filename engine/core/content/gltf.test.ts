import { describe, expect, it } from 'vitest';
import {
  base64,
  encodeGlb,
  encodeGltfEmbedded,
  GLB_MAGIC,
  gltfClipNames,
  gltfExternalRefs,
  gltfToGlb,
  isModelPath,
  lowPolyModel,
  readGlb,
  readGltfText,
  readModelAsset,
  type GltfJson,
} from './gltf';
import { assetDataUrl } from './png';

/** A one-box model with one clip, `bob`. */
const MODEL = lowPolyModel(
  [{ name: 'box', shape: 'box', size: { x: 1, y: 1, z: 1 }, at: { x: 0, y: 0.5, z: 0 }, color: '#ff0000' }],
  [
    {
      name: 'bob',
      tracks: [
        {
          node: 'box',
          path: 'translation',
          times: [0, 1],
          values: [
            [0, 0.5, 0],
            [0, 1, 0],
          ],
        },
      ],
    },
  ],
);
const glb = () => encodeGlb(MODEL.json, MODEL.bin);
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getUint32(at, true);
const bytes = (text: string) => new TextEncoder().encode(text);

describe('glTF headers (Engine 0.16 T11)', () => {
  it('writes a GLB: magic, version 2, its length, a JSON chunk then a BIN chunk', () => {
    const b = glb();
    expect(u32(b, 0)).toBe(GLB_MAGIC);
    expect(String.fromCharCode(...b.subarray(0, 4))).toBe('glTF');
    expect(u32(b, 4)).toBe(2);
    expect(u32(b, 8)).toBe(b.length);
    expect(b.length % 4).toBe(0);
    expect(glb()).toEqual(b); // the same bytes every time
    const read = readGlb(b);
    expect(read.ok && read.json.asset.version).toBe('2.0');
    expect(read.ok && gltfClipNames(read.json)).toEqual(['bob']);
  });

  it('refuses bytes that are not a GLB 2 of the right length', () => {
    const b = glb();
    expect(readGlb(bytes('not a model at all, honestly'))).toEqual({
      ok: false,
      message: 'not a GLB (it does not start with "glTF")',
    });
    const v1 = b.slice();
    v1[4] = 1;
    expect(readGlb(v1)).toMatchObject({ ok: false, message: 'GLB version 1; only version 2 is read' });
    expect(readGlb(b.subarray(0, b.length - 4))).toMatchObject({
      ok: false,
      message: expect.stringContaining('header says'),
    });
    const noJson = b.slice();
    noJson[16] = 0x42;
    expect(readGlb(noJson)).toMatchObject({
      ok: false,
      message: expect.stringContaining('not a JSON chunk'),
    });
  });

  it('reads a .gltf: JSON with asset.version 2.x', () => {
    const text = encodeGltfEmbedded(MODEL.json, MODEL.bin);
    const read = readGltfText(bytes(text));
    expect(read.ok && gltfClipNames(read.json)).toEqual(['bob']);
    expect(readGltfText(bytes('{ nope'))).toEqual({ ok: false, message: 'the file is not JSON' });
    expect(readGltfText(bytes('[]'))).toMatchObject({ ok: false, message: 'the file is not a glTF object' });
    expect(readGltfText(bytes('{"asset":{"version":"1.0"}}'))).toMatchObject({
      ok: false,
      message: 'the file is glTF 1.0; only glTF 2.x is read',
    });
    expect(readGltfText(bytes('{}'))).toMatchObject({
      ok: false,
      message: expect.stringContaining('asset.version'),
    });
  });

  it('reads either form from the data: URL the loader holds, by extension', () => {
    const glbUrl = assetDataUrl('m.glb', base64(glb()));
    const gltfUrl = assetDataUrl('m.gltf', base64(bytes(encodeGltfEmbedded(MODEL.json, MODEL.bin))));
    expect(readModelAsset('assets/p/m.glb', glbUrl).ok).toBe(true);
    expect(readModelAsset('assets/p/m.gltf', gltfUrl).ok).toBe(true);
    expect(readModelAsset('assets/p/m.glb', gltfUrl).ok).toBe(false);
    expect(isModelPath('assets/p/m.GLB')).toBe(true);
    expect(isModelPath('assets/p/m.png')).toBe(false);
  });

  it('packs an embedded .gltf into the same model as a GLB, and names external files', () => {
    const json = JSON.parse(encodeGltfEmbedded(MODEL.json, MODEL.bin)) as GltfJson;
    expect(gltfExternalRefs(json)).toBeNull();
    const packed = readGlb(gltfToGlb(json));
    expect(packed.ok && packed.json['bufferViews']).toEqual(MODEL.json['bufferViews']);
    expect(packed.ok && packed.json['buffers']).toEqual([{ byteLength: MODEL.bin.length }]);
    const external = { ...json, buffers: [{ byteLength: 4, uri: 'model.bin' }] };
    expect(gltfExternalRefs(external)).toContain('buffers[0] names the file "model.bin"');
    expect(() => gltfToGlb(external)).toThrow('not embedded');
  });

  it('builds flat-shaded parts with bounds, a material per colour and glow, and clips by node', () => {
    const m = lowPolyModel(
      [
        {
          name: 'a',
          shape: 'frustum',
          size: { x: 2, y: 1, z: 2 },
          at: { x: 0, y: 0, z: 0 },
          color: '#00ff00',
        },
        {
          name: 'b',
          shape: 'octahedron',
          size: { x: 1, y: 1, z: 1 },
          at: { x: 0, y: 1, z: 0 },
          color: '#00ff00',
          glow: true,
          parent: 'a',
        },
      ],
      [],
    );
    const accessors = m.json['accessors'] as { min?: number[]; max?: number[] }[];
    expect(accessors[0]).toMatchObject({ min: [-1, -0.5, -1], max: [1, 0.5, 1] });
    expect(m.json['materials']).toHaveLength(2);
    expect((m.json['nodes'] as { children?: number[] }[])[1]!.children).toEqual([2]);
    expect(m.json.animations).toBeUndefined();
    expect(() =>
      lowPolyModel([
        {
          name: 'x',
          shape: 'box',
          size: { x: 1, y: 1, z: 1 },
          at: { x: 0, y: 0, z: 0 },
          color: '#000000',
          parent: 'y',
        },
      ]),
    ).toThrow('hangs from "y"');
  });
});
