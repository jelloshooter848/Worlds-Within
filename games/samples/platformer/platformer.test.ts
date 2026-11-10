import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import { isFullMap, resolveSkinAnimation, resolveTileFrame, type SkinFile } from '@engine/core/present';
import { skinSetCanvasPresenter } from '@engine/backends/canvas2d';
import { withContentImages } from '@engine/core/assets/content-images';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';
import type { ContentBundle } from '@engine/core/content/bundle';
import { stateHash } from '@engine/core/state-hash';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { compileSong } from '@engine/core/audio/mml';
import { ACTOR_ANIMS, PRESENT_TILES, RUNNER_ANIMS } from '@kits/platformer';
import { loadHopper, PLATFORMER_MUSIC, hopperStages } from './content';
import { hopperLook, hopperPicture } from './picture';
import { hopperLook3d } from './picture3d';
import { createView } from './view';
import { createGame, type HopperSnapshot } from './headless';

// Hopper's Way, the flagship platformer (Engine 0.16 part B, T5): the skeleton the later tasks
// fill. Its content loads, its campaign lists the flagship's stages, its tuned profile uses the
// kit's movement-feel fields, its screen is 16:9, and its skins draw every frame of its run files
// in 2D and 3D from the art, never a fallback box. The old five levels and two doors are
// `games/platformer-classic` (their run files, hashes and tests moved with them). T6, the art and
// feel pass: the 2D skin draws from the CC0 PNG packs (tiles joined by their neighbours, the
// frog's states from one PNG per animation), with parallax, squash and stretch, dust, hit flashes
// and hit-pauses, all presentation: drawing never changes a state hash.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const content = mustLoad(loadHopper(FILES));

/**
 * The bundle with its skins' PNG sheets "decoded" for Node: each image's size from its header and
 * no pixels (the recording renderers below never look at them), as `withContentImages` gives the
 * page and the screenshot tool the real ones.
 */
const imaged: ContentBundle = await withContentImages(content, async (url) => {
  const size = readPngSize(dataUrlBytes(url)!)!;
  return { image: null, width: size.width, height: size.height, data: null };
});

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

describe("Hopper's Way: skins (the art and feel pass, T6)", () => {
  const look = hopperLook(imaged);
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
    // Every state the kit sends, and the skin's own: `breathe` after a landing's crouch, and the
    // dying puff's `vanish` and `gone`.
    expect(states('runner')).toEqual([...RUNNER_ANIMS, 'breathe', 'vanish', 'gone'].sort());
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
    const view = createView(imaged, 1, run.start ? { start: run.start } : {});
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

describe("Hopper's Way: the 2D art and feel (T6)", () => {
  const look = hopperLook(imaged);
  const skin = look.skin;

  it('joins the ground tiles by their neighbours: grass on top, edges, corners and notches', () => {
    const view = createView(imaged, 1);
    const map = view.frame!().map!;
    if (!isFullMap(map)) throw new Error('the first frame sends the full map');
    const grid = map.tiles as readonly string[];
    const at = (col: number, row: number) => resolveTileFrame(skin.tiles!['#']!, '#', grid, col, row);
    expect(at(0, 10)).toBe('grass-top'); // the map's edge counts as joined
    expect(at(0, 11)).toBe('dirt');
    expect(at(15, 10)).toBe('grass-top-right'); // the first gap
    expect(at(18, 11)).toBe('dirt-left');
    expect(at(30, 8)).toBe('grass-top-left'); // the 2-high step
    expect(at(30, 10)).toBe('notch-top-left'); // the ground under it
    expect(at(31, 10)).toBe('notch-top-right');
    expect(at(47, 9)).toBe('dirt-right'); // the ledge's right side over the pit
  });

  it("draws the frog's states from one PNG per animation, with a crouch on landing and a dying puff", () => {
    const frog = (state: string, t = 0) =>
      resolveSkinAnimation(skin, { kind: 'runner', facing: 'right', anim: { state, t }, tags: [] });
    expect(frog('run')).toMatchObject({ sheet: 'frog-run', frame: 'run-0' });
    expect(frog('jump')).toMatchObject({ sheet: 'frog-jump' });
    expect(frog('fall')).toMatchObject({ sheet: 'frog-fall' });
    expect(frog('idle', 0)).toMatchObject({ state: 'idle', frame: 'run-4' }); // the landing crouch
    expect(frog('idle', 5)).toMatchObject({ state: 'breathe', sheet: 'frog-idle' });
    // The hurt cycle opens on the pack's two white frames: the hit flash.
    expect(frog('hurt', 0)).toMatchObject({ sheet: 'frog-hit', frame: 'hit-0' });
    expect(frog('dead', 22)).toMatchObject({ state: 'vanish', sheet: 'puff' });
    expect(frog('dead', 59)).toMatchObject({ state: 'gone', frame: 'blank' });
    // The checkpoint raises its flag from the tick it is touched, then waves it.
    const flag = (t: number) =>
      resolveSkinAnimation(skin, {
        kind: 'checkpoint',
        facing: 'right',
        anim: { state: 'active', t },
        tags: ['active'],
      });
    expect(flag(0)).toMatchObject({ sheet: 'flag', frame: 'raise-0' });
    expect(flag(60)).toMatchObject({ state: 'waving', sheet: 'flag-wave' });
  });

  it('plays squash and stretch, dust, run particles, shakes, flashes and hit-pauses on their events', () => {
    const ev = skin.events!;
    const tweens = (type: string) => [ev[type]!.tween ?? []].flat();
    expect(tweens('jump').find((t) => t.prop === 'scaleY')).toMatchObject({ from: expect.any(Number) });
    expect((tweens('jump').find((t) => t.prop === 'scaleY')!.from as number) > 1).toBe(true); // stretch
    expect((tweens('land').find((t) => t.prop === 'scaleY')!.from as number) < 1).toBe(true); // squash
    expect(ev['jump']!.emit).toBe('jump-dust');
    expect(ev['land']!.emit).toBe('land-dust');
    expect(ev['footstep']!.emit).toBe('run-dust');
    expect(ev['skid-dust']!.emit).toBe('skid-dust');
    expect(ev['stomp']).toMatchObject({ hitPause: { ticks: 4 }, shake: { amount: expect.any(Number) } });
    expect(ev['hurt']).toMatchObject({ hitPause: { ticks: 6 }, flash: { color: '#ffffff' } });
    const run = skin.kinds['runner']!.frames!['run'] as { right: { events: Record<string, string> } };
    expect(Object.values(run.right.events)).toEqual(['footstep', 'footstep']);
  });

  it.each(RUNS)('%s: drawing every tick asks for its hit-pauses and changes no state hash', (name) => {
    const run = runOf(name);
    const opts = run.start ? { start: run.start } : {};
    const pauses: number[] = [];
    let tick = 0;
    const view = createView(imaged, 1, opts);
    const game = createGame(content, 1, opts);
    const picture = hopperPicture(
      skinSetCanvasPresenter(new NullRenderer(), { ...look, onHitPause: () => pauses.push(tick) }),
      look.screen,
    );
    const a = new ScriptedInput(run.input);
    const b = new ScriptedInput(run.input);
    for (tick = 0; tick <= run.ticks; tick++) {
      if (tick > 0) {
        a.next();
        b.next();
        view.step(a);
        game.step(b);
      }
      picture.draw(game.world, game.events);
      expect(stateHash(view.snapshot() as never), `tick ${tick}`).toBe(stateHash(game.snapshot() as never));
    }
    expect(pauses.length).toBeGreaterThan(0);
  });
});
