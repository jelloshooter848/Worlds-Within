import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { validate } from '../content/validate';
import type { Facing } from './types';
import {
  DEFAULT_BACKGROUND,
  DEFAULT_CAMERA3D,
  DEFAULT_FALLBACK_COLOR,
  resolveCamera3d,
  parseEventKey,
  resolveMeshParts,
  resolveSkinEvent,
  resolveSkinFrame,
  resolveSkinKind,
  skinBackground,
  skinSchema,
  skinTagIndex,
  skinTagMatches,
  type SkinFile,
} from './skin';

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

  it('checks the sheets, palettes and frames of byTag looks', () => {
    const s = fixture();
    s.kinds['bat']!.byTag = [
      { tag: 'burnt', sheet: 'hero', frames: { fly: 'hurt' } },
      { tag: 'used', frames: { fly: 'z' }, palette: 'grey' },
      { tag: 'gone', sheet: 'nope' },
    ];
    const r = loadContent(files(s), engineContentKinds(), { root: 'games/g/' });
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([
      ['kinds.bat.byTag.1.palette', 'missing_ref'],
      ['kinds.bat.byTag.1.frames.fly', 'missing_frame'],
      ['kinds.bat.byTag.2.sheet', 'missing_ref'],
    ]);
  });

  it('checks the sounds of field-matched event keys too', () => {
    const s = fixture();
    s.events = { ...s.events, 'end:pass': { sound: 'tune' }, 'end:fail': { sound: 'sad' } };
    const r = loadContent(files(s), engineContentKinds(), { root: 'games/g/' });
    expect(r.errors.map((e) => [e.path, e.code])).toEqual([['events["end:fail"].sound', 'missing_ref']]);
  });
});

describe('event keys with a field match (G28)', () => {
  it('reads a bare type, type:value (the result field) and type:field=value', () => {
    expect(parseEventKey('mini-game-end')).toEqual({ type: 'mini-game-end', match: null });
    expect(parseEventKey('mini-game-end:pass')).toEqual({
      type: 'mini-game-end',
      match: { field: 'result', value: 'pass' },
    });
    expect(parseEventKey('mission-commit:outcome=both-burnt')).toEqual({
      type: 'mission-commit',
      match: { field: 'outcome', value: 'both-burnt' },
    });
    for (const bad of [':pass', 'end:', 'end:=x', 'end:f=', 'a:b:c', 'a:b=c=d', 'a=b'])
      expect(parseEventKey(bad), bad).toBeNull();
  });

  it('rejects a bad key at its field', () => {
    const s = fixture();
    s.events = { ...s.events, 'end:pass': { sound: 'hurt' }, 'end:': {}, 'a:b:c': {} };
    expect(errorsOf(s)).toEqual([
      ['events["end:"]', 'bad_event_key'],
      ['events["a:b:c"]', 'bad_event_key'],
    ]);
  });

  it('tries the field keys in file order, then the bare type', () => {
    const events = {
      end: 'bare',
      'end:pass': 'pass',
      'end:result=pass': 'never: the first match wins',
      'end:level=2': 'level two',
      'end:won=true': 'won',
      'other:pass': 'other',
    };
    expect(resolveSkinEvent(events, { type: 'end', result: 'pass' })).toBe('pass');
    expect(resolveSkinEvent(events, { type: 'end', result: 'fail' })).toBe('bare');
    expect(resolveSkinEvent(events, { type: 'end', result: 'fail', level: 2 })).toBe('level two');
    expect(resolveSkinEvent(events, { type: 'end', won: true })).toBe('won');
    expect(resolveSkinEvent(events, { type: 'end', result: { pass: 1 } })).toBe('bare');
    expect(resolveSkinEvent(events, { type: 'other', result: 'fail' })).toBeUndefined();
    expect(resolveSkinEvent(events, { type: 'nope' })).toBeUndefined();
    expect(resolveSkinEvent(undefined, { type: 'end' })).toBeUndefined();
    // Order decides, not specificity of the field: a later key never beats an earlier match.
    const first = { 'end:level=2': 'level', 'end:pass': 'pass' };
    expect(resolveSkinEvent(first, { type: 'end', result: 'pass', level: 2 })).toBe('level');
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

  it('falls back from a diagonal to its horizontal cardinal frame (item 128)', () => {
    // No `up-right` in idle: `right`.
    expect(at('hero', 'idle', 0, 'up-right')).toMatchObject({ frame: 'side-0', flipX: false });
    expect(at('hero', 'walk', 8, 'down-right')).toMatchObject({ frame: 'side-1', flipX: false });
    // `down-left` falls to `left`, then to `right` mirrored under flipFacing.
    expect(at('hero', 'idle', 0, 'down-left')).toMatchObject({ frame: 'side-0', flipX: true });
    // A plain frame is mirrored for a left-hand diagonal too.
    expect(at('coin', 'idle', 0, 'up-left')).toMatchObject({ frame: 'a', flipX: true });
    expect(at('coin', 'idle', 0, 'up-right')).toMatchObject({ frame: 'a', flipX: false });
  });

  it('uses diagonal frames when given, mirroring the right-hand ones for the left diagonals', () => {
    const s = fixture();
    s.kinds['hero']!.frames!['idle'] = {
      down: 'down-0',
      'up-right': 'ur',
      'down-right': 'dr',
      'down-left': 'dl',
    };
    const r = (facing: Facing) =>
      resolveSkinFrame(s, { kind: 'hero', facing, anim: { state: 'idle', t: 0 } });
    expect(r('up-right')).toMatchObject({ frame: 'ur', flipX: false });
    expect(r('up-left')).toMatchObject({ frame: 'ur', flipX: true });
    // Its own frame beats the mirror.
    expect(r('down-left')).toMatchObject({ frame: 'dl', flipX: false });
    // A cardinal with no frame and no diagonal stand-in: `down`.
    expect(r('right')).toMatchObject({ frame: 'down-0', flipX: false });
    delete s.kinds['hero']!.flipFacing;
    // Without flipFacing, `up-left` has no own frame and no `left`: `down`.
    expect(r('up-left')).toMatchObject({ frame: 'down-0', flipX: false });
  });

  it('accepts a frame or cycle for each of the eight facings, all optional', () => {
    const s = fixture();
    s.kinds['hero']!.frames!['run'] = {
      'up-left': 'a',
      'up-right': { frames: ['a', 'b'] },
      'down-left': 'a',
      'down-right': 'b',
    };
    expect(skinSchema.safeParse(s).success).toBe(true);
    const bad = { ...s, kinds: { hero: { ...s.kinds['hero']!, frames: { run: { 'up-up': 'a' } } } } };
    expect(skinSchema.safeParse(bad).success).toBe(false);
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

describe('frames by tag (G13, G30)', () => {
  /** The fixture with tag looks on the bat: a burnt one in another sheet, a used one in its own. */
  function tagged(): SkinFile {
    const s = fixture();
    s.kinds['bat']!.byTag = [
      { tag: 'burnt', sheet: 'hero', frames: { fly: 'hurt' }, fallbackColor: '#000' },
      { tag: 'look:door', frames: { fly: { frames: ['b', 'a'] } } },
      { tag: 'grey', palette: 'hero' },
    ];
    return s;
  }
  const bat = (tags?: string[]) => ({
    kind: 'bat',
    facing: 'down' as Facing,
    anim: { state: 'fly', t: 0 },
    ...(tags ? { tags } : {}),
  });

  it('accepts byTag looks and keeps 2D and 3D fields apart in them', () => {
    expect(errorsOf(tagged())).toEqual([]);
    const s = tagged() as unknown as { kinds: { bat: { byTag: Record<string, unknown>[] } } };
    s.kinds.bat.byTag[0]!['mesh'] = 'box';
    s.kinds.bat.byTag[1]!['tag'] = 3;
    expect(errorsOf(s)).toEqual([['kinds.bat.byTag.1.tag', 'invalid_type']]);
    s.kinds.bat.byTag[1]!['tag'] = 'x';
    expect(errorsOf(s)).toEqual([['kinds.bat.byTag.0.mesh', 'wrong_backend_field']]);
  });

  it('draws the first look whose tag the entity has, and the kind otherwise', () => {
    const s = tagged();
    expect(resolveSkinFrame(s, bat())).toMatchObject({ sheet: 'bat', frame: 'a', fallbackColor: '#f00' });
    expect(resolveSkinFrame(s, bat(['armed']))).toMatchObject({ sheet: 'bat', frame: 'a' });
    expect(resolveSkinFrame(s, bat(['burnt']))).toMatchObject({
      sheet: 'hero',
      frame: 'hurt',
      palette: 'hero',
      fallbackColor: '#000',
    });
    // The state's cycle is the look's; the sheet and colour are the kind's.
    expect(resolveSkinFrame(s, { ...bat(['look:door']), anim: { state: 'fly', t: 8 } })).toMatchObject({
      sheet: 'bat',
      frame: 'a',
      fallbackColor: '#f00',
    });
    expect(resolveSkinFrame(s, bat(['look:door']))).toMatchObject({ frame: 'b' });
    // File order wins over the entity's tag order.
    expect(resolveSkinFrame(s, bat(['look:door', 'burnt']))).toMatchObject({ frame: 'hurt' });
    // A look with only a palette keeps the kind's frames.
    expect(resolveSkinFrame(s, bat(['grey']))).toMatchObject({ sheet: 'bat', frame: 'a', palette: 'hero' });
  });

  it('reads the same as before for a skin without byTag', () => {
    const s = fixture();
    for (const tags of [undefined, [], ['burnt']]) {
      expect(resolveSkinFrame(s, bat(tags))).toEqual(resolveSkinFrame(s, bat()));
    }
    expect(skinTagIndex(s.kinds['bat'], ['burnt'])).toBe(-1);
    expect(resolveSkinKind(s, { kind: 'bat', tags: ['burnt'] })).toBe(s.kinds['bat']);
    expect(resolveSkinKind(s, { kind: 'nope', tags: ['burnt'] })).toBeUndefined();
  });

  it('gives the look index and the merged entry', () => {
    const s = tagged();
    expect(skinTagIndex(s.kinds['bat'], ['grey', 'burnt'])).toBe(0);
    expect(skinTagIndex(s.kinds['bat'], ['grey'])).toBe(2);
    expect(skinTagIndex(s.kinds['bat'], undefined)).toBe(-1);
    expect(resolveSkinKind(s, { kind: 'bat', tags: ['burnt'] })).toMatchObject({
      sheet: 'hero',
      palette: 'hero',
      frames: { fly: 'hurt' },
    });
  });

  it('picks a look mesh and colour on a three skin, and checks its mesh id', () => {
    const s = threeFixture();
    s.kinds['coin']!.byTag = [
      { tag: 'burnt', mesh: 'runner', color: '#000' },
      { tag: 'spent', color: '#7c7c7c' },
    ];
    expect(errorsOf(s)).toEqual([]);
    expect(resolveSkinKind(s, { kind: 'coin', tags: ['burnt'] })).toMatchObject({
      mesh: 'runner',
      color: '#000',
      depth: 4,
    });
    expect(resolveSkinKind(s, { kind: 'coin', tags: ['spent'] })).toMatchObject({
      mesh: 'cylinder',
      color: '#7c7c7c',
    });
    s.kinds['coin']!.byTag[0]!.mesh = 'nope';
    (s.kinds['coin']!.byTag[1] as Record<string, unknown>)['frames'] = { idle: 'a' };
    expect(errorsOf(s)).toEqual([
      ['kinds.coin.byTag.0.mesh', 'missing_ref'],
      ['kinds.coin.byTag.1.frames', 'wrong_backend_field'],
    ]);
  });
});

describe('looks by tag prefix and value (M2)', () => {
  /** A building with construction looks: nearly built, half built, any other progress, a site. */
  function staged(): SkinFile {
    const s = fixture();
    s.kinds['bat']!.byTag = [
      { prefix: 'progress:', min: 75, frames: { fly: 'hurt' } },
      { prefix: 'progress:', min: 50, max: 74, frames: { fly: 'down-0' } },
      { prefix: 'progress:', palette: 'hero', frames: { fly: 'up-0' } },
      { tag: 'site', frames: { fly: 'side-0' } },
    ];
    return s;
  }
  const bat = (tags: string[]) => ({
    kind: 'bat',
    facing: 'down' as Facing,
    anim: { state: 'fly', t: 0 },
    tags,
  });

  it('matches a whole tag, a prefix, and a prefix with a whole-number range', () => {
    expect(skinTagMatches({ tag: 'site' }, 'site')).toBe(true);
    expect(skinTagMatches({ tag: 'site' }, 'sites')).toBe(false);
    expect(skinTagMatches({ prefix: 'progress:' }, 'progress:12')).toBe(true);
    expect(skinTagMatches({ prefix: 'progress:' }, 'progress:half')).toBe(true);
    expect(skinTagMatches({ prefix: 'progress:' }, 'training:worker')).toBe(false);
    const half = { prefix: 'progress:', min: 50, max: 74 };
    expect(
      ['progress:49', 'progress:50', 'progress:74', 'progress:75'].map((t) => skinTagMatches(half, t)),
    ).toEqual([false, true, true, false]);
    // With a range, the rest must be a whole number.
    for (const t of ['progress:', 'progress:half', 'progress:5.5', 'progress:60x'])
      expect(skinTagMatches(half, t)).toBe(false);
    expect(skinTagMatches({ prefix: 'hp:', max: 0 }, 'hp:-3')).toBe(true);
  });

  it('draws the first matching look in file order, so a skin lists its stages from the most specific', () => {
    const s = staged();
    expect(resolveSkinFrame(s, bat(['site', 'progress:90']))).toMatchObject({ frame: 'hurt' });
    expect(resolveSkinFrame(s, bat(['site', 'progress:75']))).toMatchObject({ frame: 'hurt' });
    expect(resolveSkinFrame(s, bat(['site', 'progress:60']))).toMatchObject({ frame: 'down-0' });
    expect(resolveSkinFrame(s, bat(['site', 'progress:10']))).toMatchObject({
      frame: 'up-0',
      palette: 'hero',
    });
    expect(resolveSkinFrame(s, bat(['site']))).toMatchObject({ frame: 'side-0' });
    expect(resolveSkinFrame(s, bat(['armed']))).toMatchObject({ frame: 'a' });
    expect(skinTagIndex(s.kinds['bat'], ['progress:50'])).toBe(1);
    // The merged entry carries the look's fields, not how it matches.
    const entry = resolveSkinKind(s, { kind: 'bat', tags: ['progress:80'] })!;
    for (const field of ['tag', 'prefix', 'min', 'max']) expect(entry).not.toHaveProperty(field);
    expect(entry).toMatchObject({ sheet: 'bat', frames: { fly: 'hurt' } });
  });

  it('refuses a look with both tag and prefix, neither, or a range without a prefix', () => {
    expect(errorsOf(staged())).toEqual([]);
    const s = staged() as unknown as { kinds: { bat: { byTag: Record<string, unknown>[] } } };
    s.kinds.bat.byTag[0]!['tag'] = 'site';
    delete s.kinds.bat.byTag[3]!['tag'];
    s.kinds.bat.byTag.push({ tag: 'x', min: 1 }, { prefix: 'p:', min: 5, max: 4 });
    expect(errorsOf(s)).toEqual([
      ['kinds.bat.byTag.0.prefix', 'bad_tag_look'],
      ['kinds.bat.byTag.3.tag', 'bad_tag_look'],
      ['kinds.bat.byTag.4.min', 'bad_tag_look'],
      ['kinds.bat.byTag.5.max', 'bad_tag_look'],
    ]);
  });
});

describe('skin background (G36)', () => {
  it('is an optional colour, black when left out', () => {
    const s = fixture();
    expect(skinBackground(s)).toBe(DEFAULT_BACKGROUND);
    expect(DEFAULT_BACKGROUND).toBe('#000');
    s.background = '#5c94fc';
    expect(errorsOf(s)).toEqual([]);
    expect(skinBackground(s)).toBe('#5c94fc');
    const t = threeFixture();
    t.background = '#5c94fc';
    expect(errorsOf(t)).toEqual([]);
    expect(errorsOf({ ...s, background: 'sky' })).toEqual([['background', 'invalid_format']]);
  });
});

describe('skin tweens (Engine 0.16 T1)', () => {
  it("takes an event's tween and a kind's spawnTween, on 2D and 3D skins", () => {
    const s = fixture();
    s.events!['hit'] = {
      sound: 'hurt',
      tween: [
        { prop: 'scale', from: 1.5, to: 1, frames: 8, ease: 'backOut' },
        { prop: 'color', to: '#d82800', frames: 6, yoyo: true, amount: 0.6 },
      ],
    };
    s.kinds['coin']!.spawnTween = { prop: 'y', from: -8, to: 0, frames: 6, ease: 'bounceOut' };
    expect(errorsOf(s)).toEqual([]);
    const t = threeFixture();
    t.kinds['coin']!.spawnTween = { prop: 'alpha', from: 0, to: 1, frames: 4 };
    expect(errorsOf(t)).toEqual([]);
  });

  it('names the field of a bad ease, property or colour', () => {
    const at = (tween: unknown) => errorsOf({ ...fixture(), events: { hit: { tween } } }).map(([p]) => p);
    expect(at({ prop: 'x', to: 1, frames: 4, ease: 'wobble' })).toEqual(['events.hit.tween.ease']);
    expect(at({ prop: 'size', to: 1, frames: 4 })).toEqual(['events.hit.tween.prop']);
    expect(at([{ prop: 'color', to: 'red', frames: 4 }])).toEqual(['events.hit.tween.0.to']);
    const s = fixture();
    (s.kinds['coin'] as Record<string, unknown>)['spawnTween'] = {
      prop: 'x',
      to: 1,
      frames: 4,
      ease: 'nope',
    };
    expect(errorsOf(s).map(([p]) => p)).toEqual(['kinds.coin.spawnTween.ease']);
  });
});

/** A 3D fixture skin: primitives, a compound mesh, depth, z and the camera3d block. */
function threeFixture(): SkinFile {
  return {
    backend: 'three',
    meshes: {
      runner: [
        { shape: 'box', size: { w: 12, h: 10, d: 8 }, at: { x: 2, y: 6, z: 0 } },
        { shape: 'sphere', size: { w: 10, h: 8, d: 8 }, at: { x: 3, y: 0, z: 0 }, color: '#fcbcb0' },
        { shape: 'cone', size: { w: 4, h: 4, d: 4 }, at: { x: 6, y: -4, z: 2 }, rotate: 1 },
      ],
    },
    kinds: {
      runner: { mesh: 'runner', color: '#d82800', scale: 2, offset: { x: 1, y: -1 }, z: 3 },
      coin: { mesh: 'cylinder', color: '#fcfc00', depth: 4 },
      ghost: { mesh: 'sphere', color: '#fff' },
    },
    tiles: {
      '#': { mesh: 'box', color: '#c84c0c' },
      '/': { mesh: 'wedge', color: '#00a800', depth: 32, z: -8 },
      '~': { mesh: 'plane', color: '#2038ec' },
      '|': { mesh: 'cone', color: '#005800' },
    },
    events: { coin: { sound: 'tune' } },
    camera: { follow: 'runner', lerp: 0.5 },
    camera3d: { fov: 40, tilt: 6, layerDepth: 12, lights: { ambient: 0.5, directional: 1 } },
  };
}

describe('3D skins', () => {
  it('accepts a three skin with primitives, compound meshes, depth and camera3d', () => {
    expect(validate('skin.json', threeFixture(), skinSchema).errors).toEqual([]);
  });

  it('reports a mesh id that is neither a primitive nor in meshes, at the field', () => {
    const s = threeFixture();
    s.kinds['coin']!.mesh = 'coin';
    s.tiles!['#']!.mesh = 'brick';
    expect(errorsOf(s)).toEqual([
      ['kinds.coin.mesh', 'missing_ref'],
      ['tiles["#"].mesh', 'missing_ref'],
    ]);
  });

  it('checks compound parts and camera3d fields, and a mesh may not shadow a primitive', () => {
    const s = threeFixture() as unknown as {
      meshes: Record<string, Record<string, unknown>[]>;
      camera3d: Record<string, unknown>;
    };
    s.meshes['runner']![0]!['shape'] = 'torus';
    s.meshes['runner']![1]!['rotate'] = 4;
    s.meshes['box'] = [{ shape: 'box', size: { w: 1, h: 1, d: 1 } }];
    s.camera3d['fov'] = 0;
    expect(errorsOf(s)).toEqual([
      ['meshes.runner.0.shape', 'invalid_value'],
      ['meshes.runner.1.rotate', 'too_big'],
      ['camera3d.fov', 'too_small'],
    ]);
    s.meshes['runner']![0]!['shape'] = 'box';
    s.meshes['runner']![1]!['rotate'] = 1;
    s.camera3d['fov'] = 40;
    expect(errorsOf(s)).toEqual([['meshes.box', 'custom']]);
  });

  it('flags sprite fields on a three skin and 3D fields on a canvas2d skin', () => {
    const three = threeFixture() as unknown as {
      kinds: Record<string, Record<string, unknown>>;
      tiles: Record<string, Record<string, unknown>>;
    };
    three.kinds['coin']!['frames'] = { idle: 'a' };
    three.tiles['#']!['frame'] = 'wall';
    expect(errorsOf(three)).toEqual([
      ['kinds.coin.frames', 'wrong_backend_field'],
      ['tiles["#"].frame', 'wrong_backend_field'],
    ]);

    const flat = fixture() as unknown as Record<string, unknown> & {
      kinds: Record<string, Record<string, unknown>>;
      tiles: Record<string, Record<string, unknown>>;
    };
    flat.kinds['bat']!['depth'] = 8;
    flat.kinds['hero']!['z'] = 2;
    flat.tiles['#']!['mesh'] = 'box';
    flat['meshes'] = { m: [{ shape: 'box', size: { w: 1, h: 1, d: 1 } }] };
    flat['camera3d'] = { fov: 40 };
    expect(errorsOf(flat)).toEqual([
      ['meshes', 'wrong_backend_field'],
      ['camera3d', 'wrong_backend_field'],
      ['kinds.hero.z', 'wrong_backend_field'],
      ['kinds.bat.depth', 'wrong_backend_field'],
      ['tiles["#"].mesh', 'wrong_backend_field'],
    ]);
  });

  it('leaves the dungeon sample and platformer-lab canvas2d skins valid', () => {
    for (const game of ['samples/dungeon', 'platformer-lab']) {
      const url = new URL(`../../../games/${game}/content/skins/canvas2d.json`, import.meta.url);
      const data: unknown = JSON.parse(readFileSync(url, 'utf8'));
      expect(validate(`${game}/skins/canvas2d.json`, data, skinSchema).errors).toEqual([]);
    }
  });
});

describe('resolveMeshParts', () => {
  const skin = threeFixture();

  it('reads a primitive as one part filling the box, as deep as it is wide by default', () => {
    expect(resolveMeshParts(skin, skin.tiles!['#']!, { w: 16, h: 16 })).toEqual([
      { shape: 'box', size: { w: 16, h: 16, d: 16 }, at: { x: 0, y: 0, z: 0 }, color: '#c84c0c', rotate: 0 },
    ]);
    expect(resolveMeshParts(skin, skin.kinds['coin']!, { w: 8, h: 12 })).toEqual([
      {
        shape: 'cylinder',
        size: { w: 8, h: 12, d: 4 },
        at: { x: 0, y: 0, z: 0 },
        color: '#fcfc00',
        rotate: 0,
      },
    ]);
    expect(resolveMeshParts(skin, skin.tiles!['/']!, { w: 16, h: 16 })).toEqual([
      {
        shape: 'wedge',
        size: { w: 16, h: 16, d: 32 },
        at: { x: 0, y: 0, z: -8 },
        color: '#00a800',
        rotate: 0,
      },
    ]);
  });

  it('reads a compound mesh as its parts, defaulting to the entry colour', () => {
    const entry = { mesh: 'runner', color: '#d82800' };
    expect(resolveMeshParts(skin, entry, { w: 16, h: 16 })).toEqual([
      { shape: 'box', size: { w: 12, h: 10, d: 8 }, at: { x: 2, y: 6, z: 0 }, color: '#d82800', rotate: 0 },
      { shape: 'sphere', size: { w: 10, h: 8, d: 8 }, at: { x: 3, y: 0, z: 0 }, color: '#fcbcb0', rotate: 0 },
      { shape: 'cone', size: { w: 4, h: 4, d: 4 }, at: { x: 6, y: -4, z: 2 }, color: '#d82800', rotate: 1 },
    ]);
  });

  it('scales about the bottom centre of the box, then applies offset and z', () => {
    // Box 16x16: the bottom centre is (8, 16). x' = 8 + (x - 8) * 2 + 1, y' = 16 + (y - 16) * 2 - 1.
    expect(resolveMeshParts(skin, skin.kinds['runner']!, { w: 16, h: 16 })).toEqual([
      {
        shape: 'box',
        size: { w: 24, h: 20, d: 16 },
        at: { x: -3, y: -5, z: 3 },
        color: '#d82800',
        rotate: 0,
      },
      {
        shape: 'sphere',
        size: { w: 20, h: 16, d: 16 },
        at: { x: -1, y: -17, z: 3 },
        color: '#fcbcb0',
        rotate: 0,
      },
      { shape: 'cone', size: { w: 8, h: 8, d: 8 }, at: { x: 5, y: -25, z: 7 }, color: '#d82800', rotate: 1 },
    ]);
    const big = { mesh: 'box', color: '#fff', scale: 0.5 };
    expect(resolveMeshParts(skin, big, { w: 16, h: 8 })).toEqual([
      { shape: 'box', size: { w: 8, h: 4, d: 8 }, at: { x: 4, y: 4, z: 0 }, color: '#fff', rotate: 0 },
    ]);
  });

  it('gives no parts for a sprite entry or an unknown mesh', () => {
    expect(resolveMeshParts(skin, { frames: { idle: 'a' } }, { w: 16, h: 16 })).toEqual([]);
    expect(resolveMeshParts(skin, { mesh: 'nope', color: '#fff' }, { w: 16, h: 16 })).toEqual([]);
  });
});

describe('resolveCamera3d', () => {
  it('fills the fields a skin leaves out with the defaults', () => {
    expect(resolveCamera3d({ backend: 'three', kinds: {} })).toEqual(DEFAULT_CAMERA3D);
    expect(
      resolveCamera3d({ backend: 'three', kinds: {}, camera3d: { fov: 30, lights: { ambient: 1 } } }),
    ).toEqual({ ...DEFAULT_CAMERA3D, fov: 30, lights: { ...DEFAULT_CAMERA3D.lights, ambient: 1 } });
  });
});
