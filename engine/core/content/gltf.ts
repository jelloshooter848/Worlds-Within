import { dataUrlBytes } from './png';

/**
 * glTF 2.0 model helpers (Engine 0.16 T11): reading a model's header and JSON for `validate`, and
 * writing a GLB for a game's script that makes an original model. A model reaches the content
 * loader like every binary asset, as a base64 `data:` URL (`.gltf` and `.glb` alike; `png.ts`).
 * Pure: no Node or DOM APIs.
 *
 * - `.glb`: a 12-byte header (`glTF` magic, version 2, total length), then chunks (length, type,
 *   data): the first is the JSON (`JSON`), an optional second the binary buffer (`BIN\0`).
 * - `.gltf`: the JSON as UTF-8 text, its buffers embedded as `data:` URIs.
 */

/** `glTF` read as a little-endian uint32: the first four bytes of every GLB. */
export const GLB_MAGIC = 0x46546c67;
/** The GLB container version this engine reads and writes. */
export const GLB_VERSION = 2;
/** Chunk types: `JSON` and `BIN\0`, little-endian. */
export const GLB_CHUNK_JSON = 0x4e4f534a;
export const GLB_CHUNK_BIN = 0x004e4942;

/** What `validate` reads of a model: its JSON (asset, animations...), or why it could not. */
export type GltfRead = { ok: true; json: GltfJson } | { ok: false; message: string };

/** The few glTF JSON fields the engine reads (everything else passes through untouched). */
export interface GltfJson {
  asset: { version: string; generator?: string };
  animations?: { name?: string }[];
  [key: string]: unknown;
}

/** Whether a path names a glTF model the engine reads (`.gltf` or `.glb`). */
export function isModelPath(path: string): boolean {
  return /\.(gltf|glb)$/i.test(path);
}

function u32(bytes: Uint8Array, at: number): number {
  return (bytes[at]! | (bytes[at + 1]! << 8) | (bytes[at + 2]! << 16) | (bytes[at + 3]! << 24)) >>> 0;
}

function utf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The JSON of a model once found: an object whose `asset.version` is 2.x. */
function checkJson(text: string, what: string): GltfRead {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, message: `${what} is not JSON` };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json))
    return { ok: false, message: `${what} is not a glTF object` };
  const asset = (json as { asset?: { version?: unknown } }).asset;
  if (typeof asset?.version !== 'string')
    return { ok: false, message: `${what} has no "asset.version" (glTF 2.0 needs one)` };
  if (!/^2\.\d+$/.test(asset.version))
    return { ok: false, message: `${what} is glTF ${asset.version}; only glTF 2.x is read` };
  return { ok: true, json: json as GltfJson };
}

/**
 * A GLB's JSON from its bytes: the magic (`glTF`), version 2, a length that matches the file, and a
 * first chunk of type `JSON` inside it; else why not.
 */
export function readGlb(bytes: Uint8Array): GltfRead {
  if (bytes.length < 20 || u32(bytes, 0) !== GLB_MAGIC)
    return { ok: false, message: 'not a GLB (it does not start with "glTF")' };
  const version = u32(bytes, 4);
  if (version !== GLB_VERSION)
    return { ok: false, message: `GLB version ${version}; only version 2 is read` };
  const length = u32(bytes, 8);
  if (length !== bytes.length)
    return { ok: false, message: `the GLB header says ${length} bytes, the file has ${bytes.length}` };
  const jsonLength = u32(bytes, 12);
  if (u32(bytes, 16) !== GLB_CHUNK_JSON || 20 + jsonLength > bytes.length)
    return { ok: false, message: 'the first GLB chunk is not a JSON chunk inside the file' };
  const text = utf8(bytes.subarray(20, 20 + jsonLength));
  if (text === null) return { ok: false, message: "the GLB's JSON chunk is not UTF-8" };
  return checkJson(text, "the GLB's JSON chunk");
}

/** A `.gltf` file's JSON from its bytes (UTF-8 text). */
export function readGltfText(bytes: Uint8Array): GltfRead {
  const text = utf8(bytes);
  return text === null ? { ok: false, message: 'not UTF-8 text' } : checkJson(text, 'the file');
}

/**
 * A model asset's JSON from the string the loader holds for it (a base64 `data:` URL, or for
 * safety plain text), read as `.glb` or `.gltf` by its path's extension.
 */
export function readModelAsset(path: string, data: string): GltfRead {
  const bytes = data.startsWith('data:') ? dataUrlBytes(data) : new TextEncoder().encode(data);
  if (bytes === null) return { ok: false, message: 'not a base64 data: URL' };
  return /\.glb$/i.test(path) ? readGlb(bytes) : readGltfText(bytes);
}

/** The names of a model's animation clips, in file order (unnamed ones left out). */
export function gltfClipNames(json: GltfJson): string[] {
  return (json.animations ?? []).flatMap((a) => (typeof a.name === 'string' ? [a.name] : []));
}

// ---- Writing (asset tooling: a game's script that makes an original model) ----

/** `json` as UTF-8 bytes padded with spaces to a multiple of four, as GLB chunks need. */
function jsonChunkData(json: unknown): Uint8Array {
  const raw = new TextEncoder().encode(JSON.stringify(json));
  const out = new Uint8Array(Math.ceil(raw.length / 4) * 4).fill(0x20);
  out.set(raw);
  return out;
}

/**
 * A GLB of a glTF JSON object and its one binary buffer (`buffers[0]`, which must have no `uri`
 * and a `byteLength` of `bin.length`). The same bytes for the same input on every machine.
 */
export function encodeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  const jsonData = jsonChunkData(json);
  const binData = new Uint8Array(Math.ceil(bin.length / 4) * 4);
  binData.set(bin);
  const length = 12 + 8 + jsonData.length + (bin.length > 0 ? 8 + binData.length : 0);
  const out = new Uint8Array(length);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, length, true);
  view.setUint32(12, jsonData.length, true);
  view.setUint32(16, GLB_CHUNK_JSON, true);
  out.set(jsonData, 20);
  if (bin.length > 0) {
    const at = 20 + jsonData.length;
    view.setUint32(at, binData.length, true);
    view.setUint32(at + 4, GLB_CHUNK_BIN, true);
    out.set(binData, at + 8);
  }
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** `bytes` as base64 text (with `=` padding). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!;
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '=';
    out += i + 2 < bytes.length ? B64[n & 63]! : '=';
  }
  return out;
}

/** The text of a self-contained `.gltf`: `json` with `buffers[0]` embedding `bin` as a `data:` URI. */
export function encodeGltfEmbedded(json: GltfJson, bin: Uint8Array): string {
  const buffers = [{ byteLength: bin.length, uri: `data:application/octet-stream;base64,${base64(bin)}` }];
  return JSON.stringify({ ...json, buffers });
}

// ---- Building a small low-poly model (for a game's script and for tests) ----

/** The shapes {@link lowPolyModel} builds, flat-shaded, centred on the part's `at`. */
export type ModelShape = 'box' | 'frustum' | 'octahedron';

/** One part of a low-poly model: a node holding one flat-shaded shape in one colour. */
export interface ModelPart {
  /** The node's name (animation tracks name it). */
  name: string;
  shape: ModelShape;
  /** Its size: x, y (up) and z (toward the viewer), in model units. */
  size: { x: number; y: number; z: number };
  /** Its centre, from its parent's origin (the model's for a part without `parent`). */
  at: { x: number; y: number; z: number };
  /** A `frustum`'s top face as a share of its bottom (0: a pyramid, 1: a box; default 0.5). */
  top?: number;
  /** `#rrggbb`, stored as the material's base colour. */
  color: string;
  /** The name of an earlier part this one hangs from (moves with it). */
  parent?: string;
  /** Lit from within: the material's emissive colour is its base colour (a flame, a lamp). */
  glow?: boolean;
}

/** One keyframed property of a part in a clip (LINEAR; `values` one per time). */
export interface ModelTrack {
  node: string;
  path: 'translation' | 'rotation' | 'scale';
  /** Seconds, rising. */
  times: number[];
  /** A `[x, y, z]` per time (translation, scale) or a `[x, y, z, w]` quaternion (rotation). */
  values: number[][];
}

/** A named animation clip. */
export interface ModelClip {
  name: string;
  tracks: ModelTrack[];
}

/** The flat-shaded triangles of a shape of size 1 x 1 x 1 about the origin: positions, 3 per vertex. */
function shapeTriangles(shape: ModelShape, top: number): number[][][] {
  const h = 0.5;
  if (shape === 'octahedron') {
    const tip = [0, h, 0];
    const foot = [0, -h, 0];
    const ring = [
      [h, 0, 0],
      [0, 0, h],
      [-h, 0, 0],
      [0, 0, -h],
    ];
    const tris: number[][][] = [];
    for (let i = 0; i < 4; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % 4]!;
      tris.push([a, b, tip], [b, a, foot]);
    }
    return tris;
  }
  const t = shape === 'box' ? 1 : top;
  // Bottom corners (y = -h) and top corners (y = +h, scaled by t), counter-clockwise from above.
  const corner = (y: number, s: number) => [
    [-h * s, y, h * s],
    [h * s, y, h * s],
    [h * s, y, -h * s],
    [-h * s, y, -h * s],
  ];
  const lo = corner(-h, 1);
  const hi = corner(h, t);
  const tris: number[][][] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tris.push([a, b, c], [a, c, d]);
  };
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(lo[i]!, lo[j]!, hi[j]!, hi[i]!);
  }
  if (t > 0) quad(hi[0]!, hi[1]!, hi[2]!, hi[3]!);
  quad(lo[3]!, lo[2]!, lo[1]!, lo[0]!);
  return tris.filter(([a, b, c]) => {
    // A pyramid's top quad collapses to a point: drop degenerate triangles.
    const key = (p: number[]) => p.join(',');
    return key(a!) !== key(b!) && key(b!) !== key(c!) && key(a!) !== key(c!);
  });
}

/** Rounded to six decimals, so a model's bytes do not hang on the last bit of a float function. */
function round6(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

/** `#rrggbb` as a linear RGBA base colour factor (glTF stores linear colours). */
function linearColor(hex: string): number[] {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const s = c / 255;
    const v = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    return round6(v);
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), 1];
}

/**
 * A small flat-shaded glTF 2.0 model from parts and clips: its JSON (one scene, a `root` node over
 * the top-level parts, one mesh and node per part, one PBR material per colour (and glow), metallic
 * 0, roughness 1) and its binary buffer, ready for {@link encodeGlb} or {@link encodeGltfEmbedded}.
 * Deterministic: the same parts give the same bytes.
 */
export function lowPolyModel(
  parts: readonly ModelPart[],
  clips: readonly ModelClip[] = [],
  generator = 'Worlds Within lowPolyModel',
): { json: GltfJson; bin: Uint8Array } {
  const floats: number[] = [];
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];
  /** Adds float data as its own buffer view and accessor; returns the accessor index. */
  const add = (data: number[], type: 'SCALAR' | 'VEC3' | 'VEC4', target?: number, minmax = false) => {
    const width = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
    bufferViews.push({
      buffer: 0,
      byteOffset: floats.length * 4,
      byteLength: data.length * 4,
      ...(target !== undefined && { target }),
    });
    const accessor: Record<string, unknown> = {
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: data.length / width,
      type,
    };
    if (minmax) {
      const min = Array.from({ length: width }, () => Infinity);
      const max = Array.from({ length: width }, () => -Infinity);
      for (let i = 0; i < data.length; i++) {
        const k = i % width;
        min[k] = Math.min(min[k]!, data[i]!);
        max[k] = Math.max(max[k]!, data[i]!);
      }
      accessor['min'] = min;
      accessor['max'] = max;
    }
    accessors.push(accessor);
    floats.push(...data);
    return accessors.length - 1;
  };

  const look = (p: ModelPart) => `${p.color.toLowerCase()}${p.glow === true ? ':glow' : ''}`;
  const looks = [...new Set(parts.map(look))];
  const materials = looks.map((key) => {
    const [c, glow] = key.split(':') as [string, string | undefined];
    const base = linearColor(c);
    return {
      name: key,
      pbrMetallicRoughness: { baseColorFactor: base, metallicFactor: 0, roughnessFactor: 1 },
      ...(glow !== undefined && { emissiveFactor: base.slice(0, 3) }),
    };
  });
  const index = new Map<string, number>();
  const nodes: Record<string, unknown>[] = [{ name: 'root', children: [] as number[] }];
  const meshes: Record<string, unknown>[] = [];
  for (const part of parts) {
    if (index.has(part.name)) throw new Error(`two parts named "${part.name}"`);
    const positions: number[] = [];
    const normals: number[] = [];
    for (const tri of shapeTriangles(part.shape, part.top ?? 0.5)) {
      const [a, b, c] = tri.map((p) => [p[0]! * part.size.x, p[1]! * part.size.y, p[2]! * part.size.z]);
      const u = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
      const v = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      for (const p of [a!, b!, c!]) {
        positions.push(...p.map(round6));
        normals.push(round6(n[0]! / len), round6(n[1]! / len), round6(n[2]! / len));
      }
    }
    const position = add(positions, 'VEC3', 34962, true);
    const normal = add(normals, 'VEC3', 34962);
    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes: { POSITION: position, NORMAL: normal },
          material: looks.indexOf(look(part)),
        },
      ],
    });
    nodes.push({ name: part.name, mesh: meshes.length - 1, translation: [part.at.x, part.at.y, part.at.z] });
    index.set(part.name, nodes.length - 1);
    const parent = part.parent === undefined ? 0 : index.get(part.parent);
    if (parent === undefined)
      throw new Error(`part "${part.name}" hangs from "${part.parent}", which comes later or is missing`);
    const owner = nodes[parent]!;
    owner['children'] = [...((owner['children'] as number[] | undefined) ?? []), nodes.length - 1];
  }
  const animations = clips.map((clip) => {
    const samplers: Record<string, unknown>[] = [];
    const channels: Record<string, unknown>[] = [];
    for (const track of clip.tracks) {
      const node = index.get(track.node);
      if (node === undefined) throw new Error(`clip "${clip.name}" names no part "${track.node}"`);
      const input = add(track.times, 'SCALAR', undefined, true);
      const output = add(track.values.flat(), track.path === 'rotation' ? 'VEC4' : 'VEC3');
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node, path: track.path } });
    }
    return { name: clip.name, samplers, channels };
  });
  const bin = new Uint8Array(new Float32Array(floats).buffer);
  const json: GltfJson = {
    asset: { version: '2.0', generator },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes,
    meshes,
    materials,
    ...(animations.length > 0 && { animations }),
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return { json, bin };
}

/**
 * A `.gltf`'s JSON with its embedded buffers (`data:` URIs) packed into one GLB, so a model is
 * parsed the same way from either form with no loader fetching anything (the 3D backend's model
 * library does this; Node has no `ProgressEvent`, which three's file loader needs). The buffers are
 * joined in order, each padded to four bytes, and every buffer view moved onto the joined one.
 * Throws on a buffer that is not embedded (an external file this engine never fetches).
 */
export function gltfToGlb(json: GltfJson): Uint8Array {
  const buffers = (json['buffers'] as { byteLength: number; uri?: string }[] | undefined) ?? [];
  const starts: number[] = [];
  const parts: Uint8Array[] = [];
  let length = 0;
  buffers.forEach((b, i) => {
    const bytes = b.uri === undefined ? null : dataUrlBytes(b.uri);
    if (bytes === null) throw new Error(`buffer ${i} is not embedded as a base64 data: URI`);
    starts.push(length);
    parts.push(bytes);
    length += Math.ceil(bytes.length / 4) * 4;
  });
  const bin = new Uint8Array(length);
  parts.forEach((p, i) => bin.set(p, starts[i]!));
  const views = (json['bufferViews'] as { buffer: number; byteOffset?: number }[] | undefined) ?? [];
  const packed: GltfJson = {
    ...json,
    bufferViews: views.map((v) => ({ ...v, buffer: 0, byteOffset: (v.byteOffset ?? 0) + starts[v.buffer]! })),
    buffers: buffers.length === 0 ? [] : [{ byteLength: bin.length }],
  };
  if (buffers.length === 0) delete packed['buffers'];
  return encodeGlb(packed, bin);
}

/** Why a model's buffers or images cannot be read without fetching another file, or null. */
export function gltfExternalRefs(json: GltfJson): string | null {
  for (const key of ['buffers', 'images'] as const) {
    const list = (json[key] as { uri?: unknown }[] | undefined) ?? [];
    const i = list.findIndex((b) => typeof b.uri === 'string' && !b.uri.startsWith('data:'));
    if (i >= 0)
      return `${key}[${i}] names the file "${String(list[i]!.uri)}": embed it (a data: URI) or use a .glb`;
  }
  return null;
}
