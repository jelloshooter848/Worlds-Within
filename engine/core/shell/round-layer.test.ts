import { describe, expect, it } from 'vitest';
import { freezeFrame, type PresentFrame } from '../present';
import type { BrowserDisplay } from './display';
import { isLayerRound, roundLayerDisplay } from './round-layer';

// Hosted rounds drawn in 2D on a 3D page (Engine 0.16 F8): one display over the world's (3D) and a
// round display (2D, on a canvas layered over it), switched by each frame's `status.miniGame`.

function fake(name: string, log: string[], extra: Partial<BrowserDisplay> = {}): BrowserDisplay {
  return {
    renderer: { clear() {}, rect() {}, sprite() {}, text() {}, debugText() {}, line() {} },
    presenter: { present: (f) => void log.push(`${name} present ${f.frame}`) },
    fit: () => void log.push(`${name} fit`),
    present: () => void log.push(`${name} show`),
    transition: (v) =>
      void log.push(`${name} transition ${v === null ? 'none' : (v as unknown as { slot: string }).slot}`),
    effectSettings: () => void log.push(`${name} settings`),
    uiPainter: () => ({ fill: () => log.push(`${name} fill`), image() {}, glyph() {} }),
    ...extra,
  };
}

const frame = (n: number, miniGame?: string): PresentFrame => ({
  frame: n,
  size: { width: 32, height: 18 },
  entities: [],
  events: [],
  status: miniGame === undefined ? {} : { miniGame },
});

describe('roundLayerDisplay (Engine 0.16 F8)', () => {
  it("sends a listed round's frames to the 2D display and shows its layer, the rest to the world", () => {
    const log: string[] = [];
    const shown: boolean[] = [];
    const d = roundLayerDisplay({
      world: fake('world', log),
      round: fake('round', log),
      ids: ['room', 'walls'],
      show: (round) => void shown.push(round),
    });
    expect(shown).toEqual([false]);
    d.presenter.present(freezeFrame(frame(1)));
    d.present();
    expect(d.showing).toBe('world');
    d.presenter.present(freezeFrame(frame(2, 'room')));
    d.present();
    d.uiPainter!().fill({ kind: 'fill', x: 0, y: 0, w: 1, h: 1, color: '#000' });
    expect(d.showing).toBe('round');
    // A round the layer does not list stays in 3D (its own `three-<id>` skin).
    d.presenter.present(freezeFrame(frame(3, 'duel')));
    d.present();
    expect(log).toEqual([
      'world present 1',
      'world show',
      'round present 2',
      'round show',
      'round fill',
      'world present 3',
      'world show',
    ]);
    expect(shown).toEqual([false, true, false]);
  });

  it('fits, transitions and sets effects on both, and maps taps through the display shown', () => {
    const log: string[] = [];
    const d = roundLayerDisplay({
      world: fake('world', log),
      round: fake('round', log, {
        toScreen: (x, y) => ({ x: x / 2, y: y / 2 }),
        toClient: (x, y) => ({ x: x * 2, y: y * 2 }),
      }),
      ids: ['room'],
      show: () => {},
      worldBox: {
        toScreen: (x, y) => ({ x: x / 4, y: y / 4 }),
        toClient: (x, y) => ({ x: x * 4, y: y * 4 }),
      },
    });
    d.fit({ fit: {} } as never);
    d.transition!({ slot: 'mission' } as never);
    d.effectSettings!({ shakeScale: 0 });
    expect(log).toEqual([
      'world fit',
      'round fit',
      'world transition mission',
      'round transition mission',
      'world settings',
      'round settings',
    ]);
    expect(d.toScreen!(8, 8)).toEqual({ x: 2, y: 2 });
    expect(d.toClient!(1, 1)).toEqual({ x: 4, y: 4 });
    d.presenter.present(freezeFrame(frame(1, 'room')));
    expect(d.toScreen!(8, 8)).toEqual({ x: 4, y: 4 });
    expect(d.toClient!(1, 1)).toEqual({ x: 2, y: 2 });
  });

  it('tells a layer round by its status', () => {
    expect(isLayerRound(freezeFrame(frame(0, 'room')), ['room'])).toBe(true);
    expect(isLayerRound(freezeFrame(frame(0, '')), ['room'])).toBe(false);
    expect(isLayerRound(freezeFrame(frame(0)), ['room'])).toBe(false);
  });
});
