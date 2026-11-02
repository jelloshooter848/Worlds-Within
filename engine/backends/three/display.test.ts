import { afterEach, describe, expect, it, vi } from 'vitest';
import { freezeFrame, type SkinFile } from '@engine/core/present';
import { threeDisplay, threeScenePresenter, webgl2Available } from './display';

const SKIN: SkinFile = { backend: 'three', kinds: { hero: { mesh: 'box', color: '#d82800' } } };
const SCREEN = { width: 256, height: 240 };

afterEach(() => vi.unstubAllGlobals());

describe('threeScenePresenter', () => {
  it('syncs the Node-side scene from each frame (no WebGL)', () => {
    const presenter = threeScenePresenter(SKIN, { screen: SCREEN, background: '#5c94fc' });
    presenter.present(
      freezeFrame({
        frame: 0,
        size: SCREEN,
        entities: [
          {
            id: 'p1',
            kind: 'hero',
            x: 16,
            y: 16,
            w: 16,
            h: 16,
            facing: 'right',
            anim: { state: 'idle', t: 0 },
            tags: [],
          },
        ],
        events: [],
        status: {},
      }),
    );
    expect(presenter.scene.entityIds()).toEqual(['p1']);
    expect(presenter.shown).toBe(presenter.scene);
    presenter.scene.dispose();
  });

  it("hands a mini game's frames to the scene of its round skin, and the rest to the main one", () => {
    const ROUND: SkinFile = { backend: 'three', kinds: { knight: { mesh: 'box', color: '#6844fc' } } };
    const presenter = threeScenePresenter(SKIN, { screen: SCREEN, rounds: { vault: ROUND } });
    const at = (frame: number, kind: string, miniGame: string) =>
      freezeFrame({
        frame,
        size: SCREEN,
        entities: [
          {
            id: kind,
            kind,
            x: 0,
            y: 0,
            w: 16,
            h: 16,
            facing: 'right' as const,
            anim: { state: 'idle', t: 0 },
            tags: [],
          },
        ],
        events: [],
        status: { miniGame },
      });
    presenter.present(at(0, 'hero', ''));
    presenter.present(at(1, 'knight', 'vault'));
    expect(presenter.shown).toBe(presenter.rounds['vault']);
    expect(presenter.rounds['vault']!.entityIds()).toEqual(['knight']);
    expect(presenter.rounds['vault']!.entity('knight')!.userData['fallback']).not.toBe(true);
    expect(presenter.scene.entityIds()).toEqual(['hero']);
    presenter.present(at(2, 'hero', 'other'));
    expect(presenter.shown).toBe(presenter.scene);
    presenter.scene.dispose();
    presenter.rounds['vault']!.dispose();
  });
});

describe('threeDisplay', () => {
  it('says why it cannot start where the browser gives no WebGL 2', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    expect(webgl2Available()).toBe(false);
    const result = threeDisplay({} as HTMLCanvasElement, { screen: SCREEN, skin: SKIN });
    expect(result).toMatch(/needs WebGL 2/);
  });

  it('treats a canvas that throws on getContext as no WebGL 2', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => {
          throw new Error('blocked');
        },
      }),
    });
    expect(webgl2Available()).toBe(false);
  });
});
