import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CanvasRenderer, SkinnedCanvasPresenter } from '@engine/backends/canvas2d';
import { contentSfx, contentSongs } from '@engine/core/content/game-content';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import {
  presenterBySkinSet,
  skinSet,
  type DeepReadonly,
  type Presenter,
  type PresentFrame,
} from '@engine/core/present';
import { bootBrowserGame, HostScene, isLayerRound } from '@engine/core/shell';
import { contentFonts, type UiPainter } from '@engine/core/ui';
import { missionOf, orderOf, playRun, stateHash, type TickHash } from '../../engine/tools/headless-run';
import { sheetLevels } from '../../engine/tools/sheet-overlay';
import { SWITCH_SETS, withEffects } from './effects';
import { pageThree, type PageThree } from './three-page';
import { loadRun, viewMaker } from './view-play';

// The final presentation invariance proof (docs/ROADMAP.md, 0.16 part A, Done when; Engine 0.16
// T14): every game's run files played through the browser shell's own loop (`bootBrowserGame`
// on a fake page, stepped by `requestAnimationFrame` with a fake clock, not the manual step hook)
// with every effect switched on at once (`./effects.ts`): both presenters fed every frame (the
// Canvas2D `SkinnedCanvasPresenter` on a stub context and the Three.js scene presenter), the
// shell's mixer (layered music, varied and ducking sounds, unlocked by a key), hit-pause (the 2D
// presenter's `onHitPause` is the shell's, and every event asks for 3 frames), screen transitions
// (`game.json`'s, or an iris on every level change, and a fade on demand every 90 display
// frames, both holding ticks while they close) and the pause menu (opened every 150 frames and
// resumed 12 frames later, the ticks held under it). From Engine 0.16 part B also the respawn
// transition (`game.json`'s, or a fade on every respawn event, holding ticks while it closes), the
// level-clear banner and the end screen (the game's levels handed to the menus; the end screen
// holds the game until the test closes it). The run's input drives the game in place of
// the keyboard, one tick per step the loop takes. Every tick's state hash is the headless run's
// (the golden hashes) and the final state is `pnpm cli run`'s, while the loop draws more frames
// than it takes ticks. Engine 0.16 F9: a game with a `three` skin is presented in 3D as its 3D
// page presents it (`three-page.ts`: models, decor, and its `rounds2d` rounds on the 2D round
// layer), the mini siege's rounds checked to reach that layer.

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

/** A stub 2D context: every method a no-op, every property kept (`canvas` gives the size). */
function stubContext(width: number, height: number): CanvasRenderingContext2D {
  const props = new Map<PropertyKey, unknown>([['canvas', { width, height }]]);
  return new Proxy(
    {},
    {
      get: (_t, key) => (props.has(key) ? props.get(key) : typeof key === 'string' ? () => {} : undefined),
      set: (_t, key, value) => {
        props.set(key, value);
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

/** Absorbs any Web Audio call: every property is itself, every call and `new` returns it. */
const anything: unknown = new Proxy(function () {}, {
  get: (_t, k) => (k === 'then' ? undefined : k === Symbol.toPrimitive ? () => 0 : anything),
  set: () => true,
  apply: () => anything,
  construct: () => anything as object,
});

class FakeAudioContext {
  state = 'running';
  sampleRate = 48000;
  currentTime = 0;
  constructor() {
    return new Proxy(this, { get: (t, k) => (k in t ? t[k as keyof FakeAudioContext] : anything) });
  }
  resume() {
    return Promise.resolve();
  }
}

/** A fake page for a full boot: elements, window listeners, a clock and a captured frame callback. */
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
      play: () => Promise.resolve(),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 256, height: 240 }),
      // Offscreen surfaces a presenter makes (a map cache, a glow layer) draw on stubs too.
      getContext: () => stubContext(Number(el['width'] ?? 1), Number(el['height'] ?? 1)),
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
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  vi.stubGlobal('window', {
    location: { search: '?title=skip' },
    innerWidth: 256,
    innerHeight: 240,
    devicePixelRatio: 1,
    AudioContext: FakeAudioContext,
    addEventListener: (type: string, fn: (e: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
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
    key(type: string) {
      for (const fn of listeners.get(type) ?? []) fn({ code: 'KeyQ', repeat: false, preventDefault() {} });
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

/** What each run showed of Engine 0.16 part B's screens (read by the last test). */
const stats: {
  file: string;
  respawned: boolean;
  respawnFrames: number;
  bannerFrames: number;
  ends: number;
}[] = [];

/** A UI painter that keeps nothing (the menus lay out and paint; what they draw is not read). */
const DROP: UiPainter = { fill() {}, image() {}, glyph() {} };

describe('presentation invariance on the stepped shell: every effect on, the state never moves', () => {
  it('finds the samples and the labs', () => {
    for (const game of ['games/fx-lab', 'games/samples/dungeon', 'games/samples/mini-siege'])
      expect(runFiles.some((f) => f.startsWith(`${game}/runs/`))).toBe(true);
  });

  it.each(runFiles)('%s', async (file) => {
    const { content, run, golden, cut } = loadRun(ROOT, file);
    let respawned = false;
    const played = await playRun(ROOT, file, {
      ...(cut && { untilTick: run.ticks }),
      onTick: (_tick, snapshot) => {
        const events = (snapshot as { events?: unknown }).events;
        if (Array.isArray(events) && events.some((e) => (e as { type?: unknown }).type === 'respawn'))
          respawned = true;
      },
    });
    if (!played.ok) throw new Error(JSON.stringify(played.errors));
    const finalHash = stateHash(played.value.snapshot);

    const shown = withEffects(content, SWITCH_SETS.at(-1)!);
    const view = (await viewMaker(ROOT, file, shown, run))();
    const frame = view.frame?.bind(view);
    const screen = content.manifest.screen;
    const page = fakePage();
    const song = Object.keys(skinSet(shown, 'canvas2d').main?.music ?? {}).find((id) => id !== 'fx-mix');

    // The game, stepped by the run's input in place of the keyboard, one tick per loop step.
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

    // Both presenters, every effect on, fed every frame the shell presents.
    const ctx = stubContext(screen.width, screen.height);
    const renderer = new CanvasRenderer(ctx);
    const fonts = contentFonts(shown);
    let transitionFrames = 0;
    let respawnFrames = 0;
    let drawn = 0;
    let three: PageThree | null = null;
    const rounds2d = skinSet(shown, 'three').main?.rounds2d ?? [];
    let roundFrames = 0;
    const transitions = {
      level: { kind: 'iris', ticks: 16, hold: 4 },
      default: { kind: 'fade', ticks: 10 },
      respawn: { kind: 'fade', ticks: 8, hold: 2 },
      ...content.manifest.transitions,
    } as const;
    const booted = await bootBrowserGame({
      screen,
      touchPad: false,
      reduceMotion: false,
      game: content.manifest.id,
      transitions,
      audio: {
        sfx: contentSfx(shown),
        songs: contentSongs(shown),
        mix: skinSet(shown, 'canvas2d').main?.music,
        // The game's own layered song where it has one (the fx lab's `lab`); the effects' `fx-mix`
        // names songs no game has.
        ...(song !== undefined && { music: song }),
        ...(run.seed !== undefined && { seed: run.seed }),
      },
      menus: { spec: content.manifest.menus, fonts, sheets: () => null, levels: sheetLevels(content) },
      displays: {
        canvas2d: async (_canvas, shell) => {
          const skins2d = skinSet(shown, 'canvas2d');
          const skins3d = skinSet(shown, 'three');
          const presenters: Presenter[] = [];
          if (skins2d.main !== null) {
            const make2d = (skin: NonNullable<typeof skins2d.main>) =>
              new SkinnedCanvasPresenter(renderer, skin, () => null, {
                size: screen,
                fonts,
                mapSurface: () => null,
                onSound: shell.onSound,
                onHitPause: shell.hitPause,
              });
            const rounds = Object.fromEntries(
              Object.entries(skins2d.rounds).map(([id, s]) => [id, make2d(s)]),
            );
            presenters.push(presenterBySkinSet(make2d(skins2d.main), rounds));
          }
          // The 3D page's presenter (Engine 0.16 F9): models, decor, the `rounds2d` rounds in 2D.
          if (skins3d.main !== null) {
            three = await pageThree(shown, {
              screen,
              ctx: stubContext(screen.width, screen.height),
              onSound: shell.onSound,
            });
            presenters.push(three.presenter);
          }
          return {
            renderer,
            presenter: { present: (f) => presenters.forEach((p) => p.present(f)) },
            fit() {},
            present() {
              drawn++;
            },
            transition(v) {
              if (v !== null) transitionFrames++;
              if (v !== null && v.spec === transitions.respawn) respawnFrames++;
            },
            uiPainter: () => DROP,
            effectSettings() {},
          };
        },
      },
      scene: (stack, display) =>
        new HostScene<object, never>({
          stack,
          step,
          world: () => view,
          events: () => [],
          miniGame: () => null,
          picture: (r) => ({
            draw: () => {
              if (frame !== undefined) {
                const shown = frame() as DeepReadonly<PresentFrame>;
                if (isLayerRound(shown, rounds2d)) roundFrames++;
                display.presenter.present(shown);
              } else view.render(r);
            },
          }),
        }),
    });
    if (booted === null) throw new Error('the shell did not boot');
    page.key('keydown'); // the first gesture: the mixer's audio starts

    let frames = 0;
    let paused = 0;
    let ends = 0;
    let bannerFrames = 0;
    while ((tick < run.ticks || booted.transitions.running) && frames < run.ticks * 4 + 600) {
      frames++;
      if (booted.menus?.state === 'end') {
        ends++;
        booted.menus.resume();
      }
      if (booted.menus?.bannerShown) bannerFrames++;
      if (frames % 90 === 0) booted.transition('default');
      if (booted.menus !== null) {
        if (frames % 150 === 0 && booted.menus.pause()) paused++;
        if (frames % 150 === 12) booted.menus.resume();
      }
      page.frame();
    }

    expect(tick, 'every tick was played').toBe(run.ticks);
    expect(hashes).toEqual(golden);
    expect(stateHash(view.snapshot())).toBe(finalHash);
    // The loop held ticks (hit-pauses, transitions closing, the pause menu) and drew through them.
    expect(drawn).toBeGreaterThan(run.ticks);
    if (run.ticks >= 90) expect(transitionFrames, 'transitions showed').toBeGreaterThan(0);
    if (booted.menus !== null && run.ticks >= 150) expect(paused, 'the pause menu showed').toBeGreaterThan(0);
    // Display frames the loop took no tick on: hit-pauses, closing transitions, the pause menu.
    if (run.ticks >= 90) expect(frames - run.ticks, 'ticks were held').toBeGreaterThan(0);
    // Once the end screen opened, its own music (`menus.end.music`, a fanfare, or from Engine 0.16
    // E9 the ending trigger's jingle) is the last song.
    const endSongs = [
      shown.manifest.menus?.end?.music,
      ...(shown.manifest.menus?.triggers?.end ?? []).map((t) => t.music),
    ].filter((m) => m !== undefined);
    if (song !== undefined) {
      const last = booted.mixer?.state().song;
      if (ends > 0 && endSongs.length > 0) expect(endSongs, 'the end music played').toContain(last);
      else expect(last, 'the layered song played').toBe(song);
    }
    // Part B's screens and the respawn transition: what showed is checked over every run below
    // (a respawn that comes as a round's outcome plays under the round scene's own transition).
    // A round the 3D skin draws in 2D went to the page's round layer (Engine 0.16 F9).
    const page3d = three as PageThree | null;
    if (page3d !== null) {
      expect(page3d.layered() > 0, 'the 2D round layer drew the rounds').toBe(roundFrames > 0);
      page3d.dispose();
    }
    stats.push({ file, respawned, respawnFrames, bannerFrames, ends });
  });

  it('showed the respawn transition, the level-clear banner and the end screen somewhere', () => {
    expect(stats.some((s) => s.respawned && s.respawnFrames > 0)).toBe(true);
    expect(stats.some((s) => s.bannerFrames > 0)).toBe(true);
    expect(stats.some((s) => s.ends > 0)).toBe(true);
  });
});
