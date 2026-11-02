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
    presenter.scene.dispose();
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
