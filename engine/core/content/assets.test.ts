import { describe, expect, it } from 'vitest';
import { imageSheetSchema } from '../gfx/image-sheet';
import { assetPacks, checkCredits, checkSkinImages, isCc0, parseCredits } from './assets';
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
