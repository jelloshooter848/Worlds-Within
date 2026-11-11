import { describe, expect, it } from 'vitest';
import { imageSheetSchema } from '../gfx/image-sheet';
import { skinSchema, type SkinFile } from '../present/skin';
import {
  assetPacks,
  checkCredits,
  checkGameAssets,
  checkSkinImages,
  checkSkinModels,
  isCc0,
  parseCredits,
} from './assets';
import { base64, encodeGlb, encodeGltfEmbedded, lowPolyModel } from './gltf';
import { assetDataUrl, encodePng } from './png';

const at = (p: string) => `games/g/${p}`;
const PNG = assetDataUrl('a.png', Buffer.from(encodePng(4, 2, new Uint8Array(32))).toString('base64'));
const credits = (body: string) => `# Credits\n\n${body}`;
const CC0_PACK = '## pack\n\n- Source: https://example.org/pack\n- Author: Someone\n- Licence: CC0 1.0\n';

describe('CREDITS.md', () => {
  it('reads each pack section and its fields', () => {
    const c = parseCredits(
      credits(
        '## `tiles`\nSource: https://a.example\nauthor: A\n- License: CC-BY 4.0\n- Owner decision: item 400\n\n## other\n',
      ),
    );
    expect(c.get('tiles')).toEqual({
      pack: 'tiles',
      source: 'https://a.example',
      author: 'A',
      licence: 'CC-BY 4.0',
      ownerDecision: 'item 400',
    });
    expect(c.get('other')).toEqual({ pack: 'other' });
    expect(isCc0('CC0 1.0 Universal')).toBe(true);
    expect(isCc0('CC-BY 4.0')).toBe(false);
    expect(assetPacks(['assets/CREDITS.md', 'assets/b/x.png', 'assets/a/y/z.png'])).toEqual(['a', 'b']);
  });

  it('passes a game without assets, and one with every pack credited as CC0', () => {
    expect(checkCredits({}, at)).toEqual([]);
    expect(checkCredits({ 'assets/CREDITS.md': credits(CC0_PACK), 'assets/pack/a.png': PNG }, at)).toEqual(
      [],
    );
  });

  it('needs a CREDITS.md once there is an assets/ folder (missing_credits)', () => {
    expect(checkCredits({ 'assets/pack/a.png': PNG }, at)).toEqual([
      expect.objectContaining({ file: 'games/g/assets/CREDITS.md', path: '', code: 'missing_credits' }),
    ]);
  });

  it('names a pack folder the credits leave out, and each missing field (missing_credits)', () => {
    const errors = checkCredits(
      {
        'assets/CREDITS.md': credits(`${CC0_PACK}\n## half\n- Author: B\n`),
        'assets/pack/a.png': PNG,
        'assets/half/b.png': PNG,
        'assets/new-pack/c.png': PNG,
      },
      at,
    );
    expect(errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/assets/CREDITS.md', 'half.source', 'missing_credits'],
      ['games/g/assets/CREDITS.md', 'half.licence', 'missing_credits'],
      ['games/g/assets/CREDITS.md', '["new-pack"]', 'missing_credits'],
    ]);
  });

  it('allows CC0 only, unless an owner decision is cited (bad_licence)', () => {
    const files = (licence: string) => ({
      'assets/CREDITS.md': credits(
        `## pack\n- Source: https://x.example\n- Author: A\n- Licence: ${licence}\n`,
      ),
      'assets/pack/a.png': PNG,
    });
    expect(checkCredits(files('CC-BY 4.0'), at)).toEqual([
      expect.objectContaining({ path: 'pack.licence', code: 'bad_licence' }),
    ]);
    expect(checkCredits(files('CC-BY 4.0\n- Owner decision: item 999'), at)).toEqual([]);
  });
});

describe('skin images against the asset files', () => {
  const images = (spec: unknown) => ({ sheet: imageSheetSchema.parse(spec) });
  const file = 'games/g/content/skins/canvas2d.json';

  it('passes frames inside the image', () => {
    const spec = images({ image: 'assets/p/a.png', frameSize: { w: 2, h: 2 }, grid: { cols: 2, rows: 1 } });
    expect(checkSkinImages(file, spec, { 'assets/p/a.png': PNG })).toEqual([]);
  });

  it('reports a missing file (missing_file) and a file that is not a PNG (bad_image)', () => {
    const spec = images({ image: 'assets/p/a.png', frames: { a: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(checkSkinImages(file, spec, {})).toEqual([
      expect.objectContaining({ file, path: 'images.sheet.image', code: 'missing_file' }),
    ]);
    const text = assetDataUrl('a.png', Buffer.from('hello, not a png at all!!').toString('base64'));
    expect(checkSkinImages(file, spec, { 'assets/p/a.png': text })).toEqual([
      expect.objectContaining({ file, path: 'images.sheet.image', code: 'bad_image' }),
    ]);
  });

  it('reports a grid or a named frame past the image (frame_outside_image), once each', () => {
    const spec = images({
      image: 'assets/p/a.png',
      frameSize: { w: 2, h: 2 },
      grid: { cols: 4, rows: 1 },
      frames: { ok: { x: 0, y: 0, w: 4, h: 2 }, wide: { x: 1, y: 0, w: 4, h: 2 } },
    });
    const errors = checkSkinImages(file, spec, { 'assets/p/a.png': PNG });
    expect(errors.map((e) => [e.file, e.path, e.code])).toEqual([
      [file, 'images.sheet.grid', 'frame_outside_image'],
      [file, 'images.sheet.frames.wide', 'frame_outside_image'],
    ]);
    expect(errors[0]!.message).toMatch(/frame "2" \(4, 0, 2x2\) reaches past the 4x2 image/);
  });
});

describe('skin models (Engine 0.16 T11)', () => {
  const file = 'games/g/content/skins/three.json';
  const model = lowPolyModel(
    [
      {
        name: 'body',
        shape: 'box',
        size: { x: 1, y: 1, z: 1 },
        at: { x: 0, y: 0.5, z: 0 },
        color: '#808080',
      },
    ],
    [
      {
        name: 'spin',
        tracks: [
          {
            node: 'body',
            path: 'scale',
            times: [0, 1],
            values: [
              [1, 1, 1],
              [2, 2, 2],
            ],
          },
        ],
      },
    ],
  );
  const GLB = assetDataUrl('m.glb', base64(encodeGlb(model.json, model.bin)));
  const GLTF = assetDataUrl(
    'm.gltf',
    base64(new TextEncoder().encode(encodeGltfEmbedded(model.json, model.bin))),
  );
  const skin = (kind: Record<string, unknown>, tiles?: Record<string, unknown>): SkinFile =>
    skinSchema.parse({
      backend: 'three',
      kinds: { torch: { mesh: 'box', color: '#808080', ...kind } },
      ...(tiles && { tiles: { '#': { mesh: 'box', color: '#808080', ...tiles } } }),
    });

  it('passes a GLB and a .gltf whose clips are there', () => {
    const s = skin(
      { model: 'assets/p/m.glb', clip: { idle: 'spin', walk: 'spin' } },
      { model: 'assets/p/m.gltf', clip: 'spin' },
    );
    expect(checkSkinModels(file, s, { 'assets/p/m.glb': GLB, 'assets/p/m.gltf': GLTF })).toEqual([]);
  });

  it("reports a missing model file at the entry's model field (missing_file)", () => {
    const s = skin({ model: 'assets/p/gone.glb' }, { model: 'assets/p/gone.gltf' });
    expect(checkSkinModels(file, s, {}).map((e) => [e.file, e.path, e.code])).toEqual([
      [file, 'kinds.torch.model', 'missing_file'],
      [file, 'tiles["#"].model', 'missing_file'],
    ]);
  });

  it('reports a file that is not a glTF 2 model, or one naming an outside file (bad_model)', () => {
    const s = skin({ model: 'assets/p/m.glb' });
    const png = { 'assets/p/m.glb': PNG };
    expect(checkSkinModels(file, s, png)).toEqual([
      expect.objectContaining({
        file,
        path: 'kinds.torch.model',
        code: 'bad_model',
        message: expect.stringContaining('not a GLB'),
      }),
    ]);
    const external = { ...model.json, buffers: [{ byteLength: model.bin.length, uri: 'm.bin' }] };
    const t = skin({ model: 'assets/p/m.gltf' });
    const url = assetDataUrl('m.gltf', base64(new TextEncoder().encode(JSON.stringify(external))));
    expect(checkSkinModels(file, t, { 'assets/p/m.gltf': url })).toEqual([
      expect.objectContaining({
        path: 'kinds.torch.model',
        code: 'bad_model',
        message: expect.stringContaining('m.bin'),
      }),
    ]);
  });

  it('reports a clip the model lacks at its state (missing_clip), naming the clips it has', () => {
    const s = skin(
      { model: 'assets/p/m.glb', clip: { idle: 'spin', walk: 'stride' } },
      { model: 'assets/p/m.glb', clip: 'wave' },
    );
    const errors = checkSkinModels(file, s, { 'assets/p/m.glb': GLB });
    expect(errors.map((e) => [e.file, e.path, e.code])).toEqual([
      [file, 'kinds.torch.clip.walk', 'missing_clip'],
      [file, 'tiles["#"].clip', 'missing_clip'],
    ]);
    expect(errors[0]!.message).toBe('"assets/p/m.glb" has no clip "stride" (its clips: spin)');
  });

  it('reports a bad model shared by two entries at each, and reads it once', () => {
    const s = skin({ model: 'assets/p/m.glb' }, { model: 'assets/p/m.glb' });
    const errors = checkSkinModels(file, s, { 'assets/p/m.glb': PNG });
    expect(errors.map((e) => [e.path, e.code])).toEqual([
      ['kinds.torch.model', 'bad_model'],
      ['tiles["#"].model', 'bad_model'],
    ]);
    expect(errors[1]!.message).toBe(errors[0]!.message);
  });

  it('runs with the credits: a model pack needs its CREDITS.md section like any pack', () => {
    const s = skin({ model: 'assets/models/m.glb' });
    const errors = checkGameAssets(
      { 'assets/CREDITS.md': credits(CC0_PACK), 'assets/models/m.glb': GLB },
      [{ kind: 'skin', file: 'content/skins/three.json', value: s }],
      at,
    );
    expect(errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/assets/CREDITS.md', 'models', 'missing_credits'],
    ]);
  });
});
