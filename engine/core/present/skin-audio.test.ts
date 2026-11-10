import { describe, expect, it } from 'vitest';
import { loadContent } from '../content/bundle';
import { engineContentKinds } from '../content/engine-kinds';
import { skinSchema, skinSoundCue, type SkinFile } from './skin';

// The skin's audio fields (Engine 0.16 T8): an event's `pitch`, `volume`, `cooldown` and `duck`,
// and the `music` section of layered songs, checked by the schema and across files.

const manifest = {
  id: 'g',
  kit: 'topdown',
  content: { skin: ['skins/*.json'], song: ['songs/*.json'], sfx: ['sfx/*.json'] },
  start: { seed: 1 },
  headless: 'headless.ts',
};

const song = (id: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, bpm: 120, loop: true, pulse1: 'l4 c d e f', ...extra });

function skin(): SkinFile {
  return {
    backend: 'three',
    kinds: { hero: { mesh: 'box', color: '#fff' } },
    events: {
      step: { sound: 'step', pitch: [-2, 1.5], volume: [0.5, 1], cooldown: 4 },
      hit: { sound: 'step', duck: { amount: 0.6, attack: 2, hold: 8, release: 20 } },
    },
    music: {
      theme: {
        layers: { calm: 'calm', danger: 'danger' },
        fade: 20,
        mix: [
          { when: { status: 'near', gte: 0, lt: 48 }, layers: { danger: 1, calm: 0.3 }, fade: 8 },
          { layers: { calm: 1, danger: 0 } },
        ],
      },
    },
  } as SkinFile;
}

function load(s: unknown, songs: Record<string, string> = {}) {
  return loadContent(
    {
      'game.json': JSON.stringify(manifest),
      'skins/three.json': JSON.stringify(s),
      'songs/calm.json': song('calm'),
      'songs/danger.json': song('danger', { pulse1: undefined, noise: 'l4 k h k h' }),
      'sfx/step.json': JSON.stringify({ id: 'step', noise: 'k' }),
      ...songs,
    },
    engineContentKinds(),
  );
}
const errors = (r: ReturnType<typeof load>) => r.errors.map((e) => [e.path, e.code]);

describe('skin audio fields (Engine 0.16 T8)', () => {
  it('a skin with sound variation, ducks and layered music validates', () => {
    expect(load(skin()).errors).toEqual([]);
  });

  it('a layer naming no song of the game is missing_ref at its field; an sfx is not a song', () => {
    const s = skin();
    s.music!['theme']!.layers['danger'] = 'nope';
    s.music!['theme']!.layers['calm'] = 'step';
    expect(errors(load(s))).toEqual([
      ['music.theme.layers.calm', 'missing_ref'],
      ['music.theme.layers.danger', 'missing_ref'],
    ]);
  });

  it("a mix rule's layer the entry lacks is missing_ref", () => {
    const s = skin();
    s.music!['theme']!.mix![0]!.layers['drums'] = 1;
    expect(errors(load(s))).toEqual([['music.theme.mix.0.layers.drums', 'missing_ref']]);
  });

  it('layers out of step (another tempo or length) are bad_layers', () => {
    expect(errors(load(skin(), { 'songs/danger.json': song('danger', { bpm: 140 }) }))).toEqual([
      ['music.theme.layers', 'bad_layers'],
    ]);
    expect(errors(load(skin(), { 'songs/danger.json': song('danger', { pulse1: 'l4 c d e' }) }))).toEqual([
      ['music.theme.layers', 'bad_layers'],
    ]);
  });

  it('bad fields are reported at their path', () => {
    const s = skin() as unknown as { events: Record<string, Record<string, unknown>>; music: unknown };
    s.events['step']!['pitch'] = [2, -2];
    s.events['step']!['volume'] = [0, 1.5];
    s.events['step']!['cooldown'] = -1;
    s.events['hit']!['duck'] = { amount: 2 };
    const r = load(s);
    expect(errors(r)).toEqual(
      expect.arrayContaining([
        ['events.step.pitch', 'bad_range'],
        ['events.step.volume.1', 'too_big'],
        ['events.step.cooldown', 'too_small'],
        ['events.hit.duck.amount', 'too_big'],
      ]),
    );
    const noLayers = skin() as unknown as { music: Record<string, Record<string, unknown>> };
    noLayers.music['theme']!['layers'] = {};
    noLayers.music['theme']!['mix'] = [{ when: { status: 'near', below: 3 }, layers: {} }];
    expect(skinSchema.safeParse(noLayers).success).toBe(false);
  });

  it('skinSoundCue: the frame and the entry fields, duck defaults filled', () => {
    const s = skinSchema.parse(skin());
    expect(skinSoundCue(s.events!['step']!, 12)).toEqual({
      frame: 12,
      pitch: [-2, 1.5],
      volume: [0.5, 1],
      cooldown: 4,
    });
    expect(skinSoundCue(s.events!['hit']!, 3)).toEqual({
      frame: 3,
      duck: { amount: 0.6, attack: 2, hold: 8, release: 20 },
    });
    expect(skinSoundCue({}, 5)).toEqual({ frame: 5 });
  });
});
