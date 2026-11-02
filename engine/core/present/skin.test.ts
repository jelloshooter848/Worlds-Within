import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { validate } from '../content/validate';
import type { Facing } from './types';
import { DEFAULT_FALLBACK_COLOR, resolveSkinFrame, skinSchema, type SkinFile } from './skin';

/** A fixture skin using every field. */
function fixture(): SkinFile {
  return {
    backend: 'canvas2d',
    sheets: { sheet: 'hero', palette: 'hero', fallbackColor: '#00a800' },
    kinds: {
      hero: {
        frames: {
          idle: { down: 'down-0', right: 'side-0', up: 'up-0' },
          walk: { down: { frames: ['down-0', 'down-1'], ticks: 4 }, right: { frames: ['side-0', 'side-1'] } },
          hurt: 'hurt',
          die: { frames: ['down-0', 'hurt'], ticks: 2, loop: false },
        },
        flipFacing: true,
        size: { w: 16, h: 16 },
        offset: { x: 0, y: -2 },
      },
      bat: { sheet: 'bat', palette: 'hero', frames: { fly: { frames: ['a', 'b'] } }, fallbackColor: '#f00' },
      coin: { sheet: 'bat', frames: { idle: 'a' }, flipFacing: true },
    },
    tiles: { '#': { frame: 'down-0', fallbackColor: '#7c7c7c' }, '.': { sheet: 'bat', frame: 'a' } },
    events: {
      hit: { sound: 'hurt', effect: { kind: 'flash', color: '#fff', ticks: 4 } },
      coin: { sound: 'tune' },
    },
    hud: [
      { status: 'health', as: 'hearts', x: 8, y: 8, frame: 'hurt' },
      { status: 'score', as: 'number', x: 200, y: 8, font: 'nes' },
    ],
    camera: { zoom: 1, follow: 'hero', deadzone: { w: 32, h: 24 }, lerp: 0.5 },
  };
}

const errorsOf = (data: unknown) =>
  validate('skin.json', data, skinSchema).errors.map((e) => [e.path, e.code]);

describe('skinSchema', () => {
  it('accepts the fixture skin', () => {
    expect(validate('skin.json', fixture(), skinSchema).errors).toEqual([]);
  });

  it('names the field of a bad value, inside unions too', () => {
    const s = fixture() as unknown as { kinds: Record<string, Record<string, unknown>> };
    s.kinds['hero']!['frames'] = { walk: { frames: ['a'], ticks: 0 }, idle: { down: { frames: [] } } };
    s.kinds['bat']!['colour'] = 'red';
    expect(errorsOf(s)).toEqual([
      ['kinds.hero.frames.walk.ticks', 'too_small'],
      ['kinds.hero.frames.idle.down.frames', 'too_small'],
      ['kinds.bat.colour', 'unrecognized_keys'],
    ]);
  });

  it('keeps 2D and 3D entries apart by backend', () => {
    const s = fixture() as unknown as { kinds: Record<string, Record<string, unknown>> };
    s.kinds['bat']!['mesh'] = 'box';
    expect(errorsOf(s)).toEqual([['kinds.bat.mesh', 'wrong_backend_field']]);
    const three = {
      backend: 'three',
      kinds: { hero: { mesh: 'box', color: '#fff', scale: 2 }, bat: { sheet: 'x' } },
    };
    expect(errorsOf(three)).toEqual([
      ['kinds.bat.sheet', 'wrong_backend_field'],
      ['kinds.bat.mesh', 'missing_field'],
      ['kinds.bat.color', 'missing_field'],
    ]);
  });

  it('needs a sheet and a fallback colour, from the entry or from sheets', () => {
    const s = {
      backend: 'canvas2d',
      kinds: { bat: { frames: { idle: 'a' } } },
      tiles: { '#': { sheet: 'w' } },
    };
    expect(errorsOf(s)).toEqual([
      ['kinds.bat.sheet', 'missing_field'],
      ['kinds.bat.fallbackColor', 'missing_field'],
      ['tiles["#"].frame', 'missing_field'],
      ['tiles["#"].fallbackColor', 'missing_field'],
    ]);
  });

  it('rejects a state with both a cycle and facings, and hearts without a frame', () => {
    const s = fixture() as unknown as {
      kinds: { hero: { frames: Record<string, unknown> } };
      hud: unknown[];
    };
    s.kinds.hero.frames['walk'] = { frames: ['a'], up: 'b' };
    s.kinds.hero.frames['idle'] = { ticks: 3, down: 'a' };
    s.hud = [{ status: 'health', as: 'icon', x: 0, y: 0 }];
    expect(errorsOf(s)).toEqual([
      ['kinds.hero.frames.idle.ticks', 'custom'],
      ['kinds.hero.frames.walk.up', 'custom'],
      ['hud.0.frame', 'custom'],
    ]);
  });
});

describe('the skin content kind', () => {
  const manifest = {
    id: 'g',
    kit: 'topdown',
    content: {
      skin: ['skins/*.json'],
      sprite: ['sprites/*.json'],
      palette: ['palettes/*.json'],
      song: ['songs/*.json'],
      sfx: ['sfx/*.json'],
    },
    start: { seed: 1 },
    headless: 'headless.ts',
  };
  const sprite = (frames: string[]) =>
    JSON.stringify({ palette: 'hero', frames: Object.fromEntries(frames.map((f) => [f, ['0']])) });
  const files = (skin: SkinFile) => ({
    'game.json': JSON.stringify(manifest),
    'skins/canvas2d.json': JSON.stringify(skin),
    'sprites/hero.json': sprite(['down-0', 'down-1', 'side-0', 'side-1', 'up-0', 'hurt']),
    'sprites/bat.json': sprite(['a', 'b']),
    'palettes/hero.json': JSON.stringify({ id: 'hero', colors: ['#000'] }),
    'songs/tune.json': JSON.stringify({ id: 'tune', bpm: 120, loop: false, pulse1: 'c' }),
    'sfx/hurt.json': JSON.stringify({ id: 'hurt', pulse: 'c' }),
  });

  it('is an engine kind, and the fixture passes the cross-file checks', () => {
    const r = loadContent(files(fixture()), engineContentKinds());
    expect(r.errors).toEqual([]);
  });

  it('reports a missing sheet, palette, sound or frame at the skin file and field', () => {
    const s = fixture();
    s.kinds['bat']!.sheet = 'nope';
    s.kinds['bat']!.palette = 'grey';
    s.events!['hit']!.sound = 'boom';
    s.tiles!['#']!.frame = 'wall';
    s.kinds['hero']!.frames!['walk'] = { down: { frames: ['down-0', 'down-9'] } };
    const r = loadContent(files(s), engineContentKinds(), { root: 'games/g/' });
    expect(r.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/g/skins/canvas2d.json', 'kinds.hero.frames.walk.down.frames.1', 'missing_frame'],
      ['games/g/skins/canvas2d.json', 'kinds.bat.palette', 'missing_ref'],
      ['games/g/skins/canvas2d.json', 'kinds.bat.sheet', 'missing_ref'],
      ['games/g/skins/canvas2d.json', 'tiles["#"].frame', 'missing_frame'],
      ['games/g/skins/canvas2d.json', 'events.hit.sound', 'missing_ref'],
    ]);
  });
});

describe('resolveSkinFrame', () => {
  const skin = fixture();
  const at = (kind: string, state: string, t = 0, facing: Facing = 'down') =>
    resolveSkinFrame(skin, { kind, facing, anim: { state, t } });

  it('picks the frame of the animation state, with the entry and sheet defaults', () => {
    expect(at('hero', 'hurt')).toEqual({
      sheet: 'hero',
      frame: 'hurt',
      flipX: false,
      palette: 'hero',
      fallbackColor: '#00a800',
      size: { w: 16, h: 16 },
      offset: { x: 0, y: -2 },
    });
    expect(at('bat', 'fly')).toMatchObject({ sheet: 'bat', frame: 'a', fallbackColor: '#f00' });
  });

  it('uses idle for a state not listed, else the first state', () => {
    expect(at('hero', 'swim').frame).toBe('down-0');
    expect(at('bat', 'sleep').frame).toBe('a');
  });

  it('cycles frames by anim t, looping or holding the last', () => {
    expect([0, 3, 4, 7, 8, 12].map((t) => at('hero', 'walk', t).frame)).toEqual([
      'down-0',
      'down-0',
      'down-1',
      'down-1',
      'down-0',
      'down-1',
    ]);
    // Default 8 ticks a frame.
    expect([0, 7, 8, 16].map((t) => at('bat', 'fly', t).frame)).toEqual(['a', 'a', 'b', 'a']);
    expect([0, 2, 4, 100].map((t) => at('hero', 'die', t).frame)).toEqual(['down-0', 'hurt', 'hurt', 'hurt']);
  });

  it('picks per-facing frames, mirroring right for left with flipFacing', () => {
    expect(at('hero', 'idle', 0, 'up')).toMatchObject({ frame: 'up-0', flipX: false });
    expect(at('hero', 'idle', 0, 'right')).toMatchObject({ frame: 'side-0', flipX: false });
    expect(at('hero', 'idle', 0, 'left')).toMatchObject({ frame: 'side-0', flipX: true });
    expect(at('hero', 'walk', 8, 'left')).toMatchObject({ frame: 'side-1', flipX: true });
    // No `up` in walk: falls back to `down`.
    expect(at('hero', 'walk', 4, 'up')).toMatchObject({ frame: 'down-1', flipX: false });
    // A plain frame is mirrored for left when the entry flips.
    expect(at('coin', 'idle', 0, 'left')).toMatchObject({ frame: 'a', flipX: true });
    expect(at('bat', 'fly', 0, 'left')).toMatchObject({ frame: 'a', flipX: false });
  });

  it('without flipFacing, a left-facing entity with no left frame uses down', () => {
    const s = fixture();
    delete s.kinds['hero']!.flipFacing;
    const r = resolveSkinFrame(s, { kind: 'hero', facing: 'left', anim: { state: 'idle', t: 0 } });
    expect(r).toMatchObject({ frame: 'down-0', flipX: false });
  });

  it('gives a fallback box for an unknown kind or a mesh entry', () => {
    expect(at('dragon', 'idle')).toEqual({
      sheet: 'hero',
      frame: null,
      flipX: false,
      fallbackColor: '#00a800',
    });
    const bare: SkinFile = { backend: 'canvas2d', kinds: {} };
    expect(resolveSkinFrame(bare, { kind: 'x', facing: 'down', anim: { state: 'idle', t: 0 } })).toEqual({
      sheet: null,
      frame: null,
      flipX: false,
      fallbackColor: DEFAULT_FALLBACK_COLOR,
    });
    const three: SkinFile = { backend: 'three', kinds: { hero: { mesh: 'box', color: '#123456' } } };
    expect(
      resolveSkinFrame(three, { kind: 'hero', facing: 'down', anim: { state: 'idle', t: 0 } }),
    ).toMatchObject({
      frame: null,
      fallbackColor: '#123456',
    });
  });
});
