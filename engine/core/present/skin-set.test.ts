import { describe, expect, it } from 'vitest';
import type { ContentBundle, ContentEntry } from '../content/bundle';
import { MINI_GAME_STATUS, presenterBySkinSet, skinSet } from './skin-set';
import type { SkinFile } from './skin';
import type { DeepReadonly, PresentFrame } from './types';

const skin = (backend: string, fallbackColor: string): SkinFile =>
  ({ backend, sheets: { fallbackColor }, kinds: {} }) as SkinFile;

/** A bundle holding only skin files, by file name. */
function bundle(skins: Record<string, SkinFile>): ContentBundle {
  const entries: ContentEntry[] = Object.entries(skins).map(([name, value]) => ({
    kind: 'skin',
    name,
    file: `content/skins/${name}.json`,
    value,
  }));
  return { manifest: {} as ContentBundle['manifest'], entries };
}

describe('skinSet', () => {
  it("takes <backend>.json as the game's skin and <backend>-<id>.json as mini game <id>'s", () => {
    const level = skin('three', '#111111');
    const vault = skin('three', '#222222');
    const set = skinSet(
      bundle({ canvas2d: skin('canvas2d', '#000000'), 'three-vault': vault, three: level }),
      'three',
    );
    expect(set.main).toBe(level);
    expect(set.rounds).toEqual({ vault });
  });

  it("falls back to a skin of that backend that is no mini game's, and to null", () => {
    const only = skin('three', '#111111');
    expect(skinSet(bundle({ 'lab-3d': only }), 'three').main).toBe(only);
    const set = skinSet(bundle({ 'three-vault': skin('three', '#222222') }), 'three');
    expect(set.main).toBeNull();
    expect(Object.keys(set.rounds)).toEqual(['vault']);
    expect(skinSet(bundle({}), 'three')).toEqual({ main: null, rounds: {} });
  });
});

describe('presenterBySkinSet', () => {
  it('hands frames by the mini game status', () => {
    const seen: string[] = [];
    const p = presenterBySkinSet(
      { present: (f: DeepReadonly<PresentFrame>) => void seen.push(`main ${f.frame}`) },
      { vault: { present: (f) => void seen.push(`vault ${f.frame}`) } },
    );
    const at = (frame: number, id: string): PresentFrame => ({
      frame,
      size: { width: 16, height: 16 },
      entities: [],
      events: [],
      status: { [MINI_GAME_STATUS]: id },
    });
    p.present(at(1, ''));
    p.present(at(2, 'vault'));
    expect(seen).toEqual(['main 1', 'vault 2']);
  });
});
