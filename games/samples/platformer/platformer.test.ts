import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import { isFullMap, type SkinFile } from '@engine/core/present';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { compileSong } from '@engine/core/audio/mml';
import { ACTOR_ANIMS, PRESENT_TILES, RUNNER_ANIMS } from '@kits/platformer';
import { loadHopper, PLATFORMER_MUSIC, hopperStages } from './content';
import { hopperLook } from './picture';
import { hopperLook3d } from './picture3d';
import { createView } from './view';
import { createGame, type HopperSnapshot } from './headless';

// Hopper's Way, the flagship platformer (Engine 0.16 part B, T5): the skeleton the later tasks
// fill. Its content loads, its campaign lists the flagship's stages, its tuned profile uses the
// kit's movement-feel fields, its screen is 16:9, and its skins draw every frame of its run files
// in 2D and 3D from the art, never a fallback box. The old five levels and two doors are
// `games/platformer-classic` (their run files, hashes and tests moved with them).

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const content = mustLoad(loadHopper(FILES));

interface Run {
  ticks: number;
  input: InputScript;
  start?: { stage: number };
}
const RUNS = readdirSync(new URL('./runs/', import.meta.url))
  .filter((f) => f.endsWith('.run.json'))
  .sort();
const runOf = (name: string) =>
  JSON.parse(readFileSync(new URL(`./runs/${name}`, import.meta.url), 'utf8')) as Run;

describe("Hopper's Way: content", () => {
  it('loads every file with no errors', () => {
    expect(loadHopper(FILES).errors).toEqual([]);
  });

  it("plays the flagship's stages in the campaign's order: three levels, then the boss's arena", () => {
    const stages = hopperStages(content);
    expect(stages.map((s) => s.level.id)).toEqual(['level-1', 'level-2', 'level-3', 'boss']);
    expect(stages.every((s) => s.profile.id === 'hoppers-way')).toBe(true);
  });

  it('has a 16:9 screen, 320x180 (6x is 1920x1080)', () => {
    expect(content.manifest.screen).toEqual({ width: 320, height: 180 });
    expect(content.manifest.screen.width * 9).toBe(content.manifest.screen.height * 16);
  });

  it('tunes its profile as data: coyote time, jump buffer, jump cut, run accel, fall speeds', () => {
    const { player } = hopperStages(content)[0]!.profile;
    expect(player).toMatchObject({
      coyote: 6,
      jumpBuffer: 6,
      jumpCut: 8192,
      runAccel: 256,
      maxFall: 17408,
      fallReset: 16384,
    });
    expect(player.jumps).toHaveLength(3);
    // Variable jump: holding jump rises on a lighter gravity than letting go.
    for (const tier of player.jumps) expect(tier.holdGravity).toBeLessThan(tier.gravity);
  });

  it('draws level-1 around a checkpoint, coins, a bump block and two walkers', () => {
    const map = FILES['content/levels/level-1.map.txt']!;
    const count = (ch: string) => [...map].filter((c) => c === ch).length;
    expect([count('K'), count('?'), count('w'), count('@'), count('G')]).toEqual([1, 1, 2, 1, 1]);
    expect(count('o')).toBeGreaterThanOrEqual(10);
  });

  it('keeps its content as text: pixel art, palettes, fonts, skins and MML only', () => {
    // The CC0 packs in assets/ are the one exception (Engine 0.16 part B, T4): assets.test.ts.
    const allowed =
      /^(game\.json|content\/[a-z]+\/[a-z0-9-]+(\.profile|\.campaign)?\.(json|txt)|content\/levels\/[a-z0-9-]+\.map\.txt)$/;
    const files = Object.keys(FILES).filter((f) => !f.startsWith('assets/'));
    expect(files.filter((f) => !allowed.test(f))).toEqual([]);
  });
});

describe("Hopper's Way: headless game", () => {
  it("starts on level-1, stage 0, with the profile's lives and hit points", () => {
    const s = createGame(content, 1).snapshot() as HopperSnapshot;
    expect(s).toMatchObject({ level: 'level-1', stage: 0, pause: 0, outcome: 'playing', lives: 3 });
    expect(s.player.hp).toBe(2);
  });

  it("scrolls and wakes actors over the screen's 320 px, not the kit's default 256", () => {
    expect(createGame(content, 1).world.viewWidth).toBe(320);
  });

  it('gives equal snapshots on two runs from the same seed', () => {
    const play = () => {
      const game = createGame(content, 1);
      const input = new ScriptedInput(runOf('level-1.run.json').input);
      const out = [canonicalJson(game.snapshot())];
      for (let i = 0; i < 300; i++) {
        input.next();
        game.step(input);
        out.push(canonicalJson(game.snapshot()));
      }
      return out;
    };
    expect(play()).toEqual(play());
  });
});

/** What the frames of every run file show. */
interface Shown {
  states: Map<string, Set<string>>;
  tiles: Set<string>;
  events: Set<string>;
  status: Set<string>;
}

function shownByRuns(): Shown {
  const s: Shown = { states: new Map(), tiles: new Set(), events: new Set(), status: new Set() };
  expect(RUNS.length).toBeGreaterThanOrEqual(2);
  for (const name of RUNS) {
    const run = runOf(name);
    const view = createView(content, 1, run.start ? { start: run.start } : {});
    const input = new ScriptedInput(run.input);
    for (let t = 0; t <= run.ticks; t++) {
      if (t > 0) {
        input.next();
        view.step(input);
      }
      const frame = view.frame!();
      for (const e of frame.entities) {
        if (!s.states.has(e.kind)) s.states.set(e.kind, new Set());
        s.states.get(e.kind)!.add(e.anim.state);
        for (const tag of e.tags ?? []) s.states.get(e.kind)!.add(`tag:${tag}`);
      }
      if (frame.map && isFullMap(frame.map))
        for (const row of frame.map.tiles) for (const c of row) s.tiles.add(String(c));
      for (const e of frame.events) s.events.add(e.type);
      for (const key of Object.keys(frame.status)) s.status.add(key);
    }
  }
  return s;
}

describe("Hopper's Way: skins (placeholders until the art pass, T6)", () => {
  const look = hopperLook(content);
  const look3d = hopperLook3d(content);
  const shown = shownByRuns();

  it('has one level skin per backend and no round skins', () => {
    expect(look.skin.backend).toBe('canvas2d');
    expect(look3d.skin.backend).toBe('three');
    expect(look.rounds).toEqual({});
  });

  it("the 2D skin maps every tile, the runner's states and every actor type of the profile", () => {
    const skin = look.skin;
    const states = (kind: string) => Object.keys(skin.kinds[kind]?.frames ?? {}).sort();
    expect(Object.keys(skin.tiles ?? {}).sort()).toEqual(Object.values(PRESENT_TILES).sort());
    expect(states('runner')).toEqual([...RUNNER_ANIMS].sort());
    for (const type of Object.keys(hopperStages(content)[0]!.profile.actors))
      expect(states(type), type).toEqual([...ACTOR_ANIMS].sort());
  });

  it('the 2D skin covers every kind, state, tag, tile, event and HUD value the runs show', () => {
    const skin = look.skin;
    const missing: string[] = [];
    for (const [kind, states] of shown.states)
      for (const state of states) {
        const entry = skin.kinds[kind];
        if (state.startsWith('tag:')) {
          const tag = state.slice(4);
          if (kind === 'checkpoint' && !entry?.byTag?.some((t) => t.tag === tag))
            missing.push(`${kind} ${state}`);
        } else if (entry?.frames?.[state] === undefined) missing.push(`${kind} ${state}`);
      }
    for (const t of shown.tiles) if (skin.tiles?.[t] === undefined) missing.push(`tile ${t}`);
    for (const e of shown.events) if (skin.events?.[e] === undefined) missing.push(`event ${e}`);
    for (const item of skin.hud ?? [])
      if (item.status !== undefined && !shown.status.has(item.status)) missing.push(`hud ${item.status}`);
    expect(missing).toEqual([]);
    expect(shown.states.get('checkpoint')).toContain('tag:active');
  });

  it('the 3D skin has a mesh for every kind and tile the 2D skin maps, and the same events and HUD', () => {
    const noMesh = Object.keys(look.skin.kinds).filter((k) => look3d.skin.kinds[k]?.mesh === undefined);
    const tiles = Object.keys(look.skin.tiles ?? {}).filter((t) => t !== PRESENT_TILES.empty);
    const noBlock = tiles.filter((t) => look3d.skin.tiles?.[t]?.mesh === undefined);
    expect([...noMesh, ...noBlock]).toEqual([]);
    expect(Object.keys(look3d.skin.events ?? {}).sort()).toEqual(Object.keys(look.skin.events ?? {}).sort());
    expect(look3d.skin.hud).toEqual(look.skin.hud);
    expect(look3d.skin.camera).toEqual(look.skin.camera);
  });

  it('names only sounds the game has, and one song that compiles, the one the page plays', () => {
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    for (const skin of [look.skin, look3d.skin] as SkinFile[])
      for (const entry of Object.values(skin.events ?? {}))
        if (entry.sound !== undefined) expect(sfx, entry.sound).toContain(entry.sound);
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id)).toEqual([PLATFORMER_MUSIC]);
    expect(compileSong(songs[0]!).length).toBeGreaterThan(0);
  });

  it.each(RUNS)('draws every tick of %s from the art in 2D, never a fallback box', (name) => {
    const run = runOf(name);
    let sprites = 0;
    const fallbacks: number[] = [];
    let tick = 0;
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite() {
        sprites++;
      },
      rect(_x: number, _y: number, _w: number, _h: number, color: string) {
        if (color === '#ff00ff') fallbacks.push(tick);
      },
    });
    const view = createView(content, 1, run.start ? { start: run.start } : {});
    const input = new ScriptedInput(run.input);
    for (tick = 0; tick <= run.ticks; tick++) {
      if (tick > 0) {
        input.next();
        view.step(input);
      }
      view.render(r);
    }
    expect(sprites).toBeGreaterThan(run.ticks);
    expect(fallbacks.slice(0, 5)).toEqual([]);
  });
});
