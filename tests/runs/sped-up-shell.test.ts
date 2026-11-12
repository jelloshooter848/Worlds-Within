import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullPresenter, NullRenderer } from '@engine/backends/null';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import type { DeepReadonly, PresentFrame } from '@engine/core/present';
import { bootBrowserGame, HostScene } from '@engine/core/shell';
import { contentFonts, type UiPainter } from '@engine/core/ui';
import { missionOf, orderOf, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { loadRun, viewMaker } from './view-play';

// The speed-up control never changes a hash (Engine 0.16 E5; docs/ROADMAP.md, 0.16 part E: "a
// sped-up run ... gives the same hashes as normal speed"): every game's run files played through
// the browser shell's own loop (`bootBrowserGame` on a fake page, stepped by
// `requestAnimationFrame` with a fake clock) with `speeds: [1, 2, 3]`, the speed changed every 40
// display frames (1x, 2x, 3x, 2x, ...), the game's own screen transitions on (holding ticks while
// they close) and the pause menu opened and closed now and then. The run's input drives the game,
// one tick per scene step the stack takes. Every tick's state hash is the golden one, the loop took
// fewer display frames than ticks, and the presented frames' status showed each speed.

vi.setConfig({ testTimeout: 180_000 });

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function gameDirs(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => `${dir}/${e.name}`)
    .filter((d) => existsSync(join(ROOT, d, 'game.json')) && existsSync(join(ROOT, d, 'runs')));
}
const runFiles = [...gameDirs('games'), ...gameDirs('games/samples')].sort().flatMap((dir) =>
  readdirSync(join(ROOT, dir, 'runs'))
    .filter((f) => f.endsWith('.run.json'))
    .sort()
    .map((f) => `${dir}/runs/${f}`),
);

/** A fake page for a full boot: elements, window listeners and a captured frame callback. */
function fakePage() {
  const make = (tag: string) => {
    const el: Record<string, unknown> = {
      tag,
      hidden: false,
      textContent: '',
      dataset: {},
      style: {},
      children: [] as unknown[],
      append(...kids: unknown[]) {
        (el['children'] as unknown[]).push(...kids);
      },
      setAttribute() {},
      addEventListener() {},
      blur() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 240 }),
    };
    return el;
  };
  const screen = make('canvas');
  vi.stubGlobal('document', {
    body: make('body'),
    head: make('head'),
    getElementById: (id: string) => (id === 'screen' ? screen : null),
    createElement: make,
    addEventListener: () => {},
  });
  vi.stubGlobal('window', {
    location: { search: '?title=skip' },
    innerWidth: 256,
    innerHeight: 240,
    devicePixelRatio: 1,
    addEventListener: () => {},
  });
  let onFrame: ((t: number) => void) | null = null;
  vi.stubGlobal('requestAnimationFrame', (fn: (t: number) => void) => {
    onFrame = fn;
    return 1;
  });
  let now = 0;
  vi.stubGlobal('performance', { now: () => now });
  return {
    /** One display frame of 1000/60 ms. */
    frame() {
      now += 1000 / 60;
      onFrame?.(now);
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

const DROP: UiPainter = { fill() {}, image() {}, glyph() {} };
const PATTERN = [1, 2, 3, 2, 3, 1, 3];

describe('the speed-up control on the stepped shell: sped-up runs give the golden hashes', () => {
  it('finds run files', () => {
    expect(runFiles.length).toBeGreaterThan(10);
  });

  it.each(runFiles)('%s', async (file) => {
    const { content, run, golden } = loadRun(ROOT, file);
    const view = (await viewMaker(ROOT, file, content, run))();
    const frame = view.frame?.bind(view);
    const page = fakePage();

    const input = new ScriptedInput(run.input);
    const hashes: TickHash[] = [];
    let tick = 0;
    const handOver = () => {
      if (tick % run.hashEvery === 0 || tick === run.ticks)
        hashes.push({ tick, hash: stateHash(view.snapshot()) });
      for (const entry of run.orders) if (entry.tick === tick) view.order?.(orderOf(entry));
      for (const step of run.missions) if (step.tick === tick) view.mission?.(missionOf(step));
    };
    handOver();
    const step = () => {
      if (tick >= run.ticks) return;
      tick++;
      input.next();
      view.step(input);
      handOver();
    };

    const presenter = new NullPresenter();
    const speedsShown = new Set<unknown>();
    const booted = await bootBrowserGame({
      screen: content.manifest.screen,
      touchPad: false,
      reduceMotion: false,
      speeds: [1, 2, 3],
      transitions: { level: { kind: 'iris', ticks: 16, hold: 4 }, ...content.manifest.transitions },
      menus: { spec: content.manifest.menus, fonts: contentFonts(content), sheets: () => null },
      displays: {
        canvas2d: () => ({
          renderer: new NullRenderer(),
          presenter,
          fit() {},
          present() {},
          uiPainter: () => DROP,
        }),
      },
      scene: (stack, display) =>
        new HostScene<object, never>({
          stack,
          step,
          world: () => view,
          events: () => [],
          miniGame: () => null,
          picture: () => ({
            draw: () => {
              if (frame === undefined) return;
              display.presenter.present(frame() as DeepReadonly<PresentFrame>);
              speedsShown.add(presenter.last?.status['speed']);
            },
          }),
        }),
    });
    if (booted === null) throw new Error('the shell did not boot');

    let frames = 0;
    while ((tick < run.ticks || booted.transitions.running) && frames < run.ticks * 4 + 600) {
      frames++;
      booted.speed!.set(PATTERN[Math.floor(frames / 40) % PATTERN.length]!);
      if (booted.menus?.state === 'end') booted.menus.resume();
      if (booted.menus !== null) {
        if (frames % 150 === 0) booted.menus.pause();
        if (frames % 150 === 8) booted.menus.resume();
      }
      page.frame();
    }

    expect(tick, 'every tick was played').toBe(run.ticks);
    expect(hashes).toEqual(golden);
    if (run.ticks >= 400) {
      expect(frames, 'sped up: fewer display frames than ticks').toBeLessThan(run.ticks);
      if (frame !== undefined) expect([...speedsShown].sort()).toEqual([1, 2, 3]);
    }
  });
});
