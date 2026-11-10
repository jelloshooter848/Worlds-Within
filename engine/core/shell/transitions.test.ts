import { describe, expect, it } from 'vitest';
import type { PresentFrame } from '../present/types';
import type { Scene } from '../scene';
import { ShellTransitions } from './transitions';

const scene = (slot?: Scene['transitionSlot']): Scene => ({
  update() {},
  render() {},
  ...(slot !== undefined && { transitionSlot: slot }),
});

const frame = (tick: number, map: string, full = false, events: string[] = []) =>
  ({
    frame: tick,
    size: { width: 64, height: 40 },
    entities: [],
    map: full ? { id: map, version: 0, tileSize: 8, tiles: [] } : { id: map, version: 0 },
    events: events.map((type) => ({ type })),
    status: {},
  }) as unknown as PresentFrame;

describe('ShellTransitions (Engine 0.16 T5)', () => {
  it("plays the slot a pushed scene names, or the popped one's, falling back as the game says", () => {
    const t = new ShellTransitions({
      specs: { scene: { kind: 'wipe', ticks: 2 }, mission: { kind: 'iris', ticks: 2 } },
    });
    const host = scene();
    const round = scene('mission');
    t.scenes({ top: host, depth: 1 }, { top: host, depth: 1 });
    expect(t.running).toBe(false);
    t.scenes({ top: host, depth: 1 }, { top: round, depth: 2 });
    expect(t.view()?.spec.kind).toBe('iris');
    for (let i = 0; i < 4; i++) t.step();
    expect(t.running).toBe(false);
    t.scenes({ top: round, depth: 2 }, { top: host, depth: 1 });
    expect(t.view()?.spec.kind).toBe('iris');
    t.clear();
    t.scenes({ top: host, depth: 1 }, { top: scene(), depth: 2 });
    expect(t.view()?.spec.kind).toBe('wipe');
  });

  it('turns every transition into a short fade under reduced motion', () => {
    const t = new ShellTransitions({ specs: { level: { kind: 'iris', ticks: 30 } }, reduceMotion: true });
    expect(t.resolve('level')).toEqual({ kind: 'fade', ticks: 8 });
    expect(t.resolve({ kind: 'wipe', ticks: 4 })).toEqual({ kind: 'fade', ticks: 4 });
    t.reduceMotion = false;
    expect(t.resolve('level')).toEqual({ kind: 'iris', ticks: 30 });
    expect(t.resolve('scene')).toBeNull();
  });

  it('holds the old picture while closing, then shows the new map and its events in order', () => {
    const t = new ShellTransitions({ specs: { level: { kind: 'fade', ticks: 2 } } });
    const shown: string[] = [];
    const views: (string | null)[] = [];
    const p = t.presenter(
      {
        present: (f) =>
          shown.push(`${f.map?.id}@${f.frame}${f.events.length ? ' ' + f.events[0]!.type : ''}`),
      },
      (v) => views.push(v && `${v.phase} ${v.coverage}`),
    );
    p.present(frame(1, 'a', true));
    p.present(frame(2, 'a'));
    p.present(frame(3, 'b', true, ['start'])); // the level changes: held
    t.step();
    p.present(frame(3, 'b'));
    t.step();
    p.present(frame(3, 'b')); // opening: the held frame first, then this one
    t.step();
    p.present(frame(4, 'b'));
    expect(shown).toEqual(['a@1', 'a@2', 'a@2', 'a@2', 'b@3 start', 'b@3', 'b@4']);
    expect(views).toEqual([null, null, 'out 0.5', 'out 1', 'in 0.5', 'in 0']);
  });

  it('starts nothing on the first map, a reference to the same map or while one runs', () => {
    const t = new ShellTransitions({ specs: { default: { kind: 'fade', ticks: 3 } } });
    const p = t.presenter({ present() {} }, () => {});
    p.present(frame(1, 'a', true));
    p.present(frame(2, 'a'));
    expect(t.running).toBe(false);
    expect(t.start()).toBe(true);
    let covered = false;
    expect(t.start('level', () => (covered = true))).toBe(false);
    expect(covered).toBe(true);
  });

  it('plays the respawn slot on a respawn event after showing its frame, and only when given', () => {
    const t = new ShellTransitions({
      specs: { respawn: { kind: 'fade', ticks: 2 }, default: { kind: 'wipe', ticks: 3 } },
    });
    const shown: string[] = [];
    const p = t.presenter(
      {
        present: (f) =>
          shown.push(`${f.frame}${f.events.length ? ' ' + f.events.map((e) => e.type).join('+') : ''}`),
      },
      () => {},
    );
    p.present(frame(1, 'a', true));
    p.present(frame(2, 'a', false, ['died', 'respawn']));
    expect(t.view()?.spec.kind).toBe('fade');
    expect(t.closing).toBe(true);
    t.step();
    p.present(frame(3, 'a', false, ['land'])); // held while it closes: the respawn frame stays
    t.step();
    t.step();
    p.present(frame(3, 'a'));
    expect(shown).toEqual(['1', '2 died+respawn', '2 died+respawn', '3 land', '3']);
    // Without a respawn spec (only `default`) a respawn plays nothing.
    const none = new ShellTransitions({ specs: { default: { kind: 'fade', ticks: 2 } } });
    none.presenter({ present() {} }, () => {}).present(frame(1, 'a', true, ['respawn']));
    expect(none.running).toBe(false);
  });

  it("plays the slot the game's events map names for any event", () => {
    const t = new ShellTransitions({
      specs: {
        default: { kind: 'wipe', ticks: 3 },
        respawn: { kind: 'fade', ticks: 2 },
        events: { died: 'default' },
      },
    });
    expect(t.eventSlot(frame(1, 'a', false, ['respawn']))).toBeNull();
    t.presenter({ present() {} }, () => {}).present(frame(1, 'a', true, ['died']));
    expect(t.view()?.spec.kind).toBe('wipe');
  });
});
