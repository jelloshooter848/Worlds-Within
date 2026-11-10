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
import { LayerMix } from '@engine/core/audio/mix';
import { Mixer, type MixerAudio } from '@engine/core/audio/mixer';
import { resolveSkinEvent, skinSoundCue } from '@engine/core/present';
import { ACTOR_ANIMS, BOSS_ANIMS, PRESENT_TILES, RUNNER_ANIMS } from '@kits/platformer';
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
    // A boss type (T8's Burrlock) has the kit's boss states, every other type the actor states.
    for (const [type, def] of Object.entries(hopperStages(content)[0]!.profile.actors))
      expect(states(type), type).toEqual([...(def.boss ? BOSS_ANIMS : ACTOR_ANIMS)].sort());
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

  it.each(RUNS)(
    'draws every tick of %s from the art in 2D, never a fallback box',
    (name) => {
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
    },
    30_000,
  ); // the full game is 3650 ticks drawn one by one
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

  it.each(RUNS)(
    '%s: drawing every tick asks for its hit-pauses and changes no state hash',
    (name) => {
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
    },
    30_000,
  ); // the full game is 3650 ticks drawn one by one
});

// T8: the mini-boss's arena. Burrlock, the bramble beetle, is profile data on the kit's boss form
// (telegraphed attacks, a faster second phase, two projectiles); the arena has a checkpoint
// before it and clears at the end of the defeat sequence. Its 2D skin telegraphs each attack,
// flashes white on a hit, plays a defeat sequence and shows a boss bar; the game ends on the
// shell's end screen.
describe("Hopper's Way: the mini-boss's arena (T8)", () => {
  const stage = hopperStages(content)[3]!;
  const boss = stage.profile.actors['burrlock']!.boss!;
  const skin = hopperLook(imaged).skin;

  it('ends the campaign on the arena: a checkpoint, a wall the boss charges into, cleared by the boss', () => {
    expect(stage.level.id).toBe('boss');
    expect(stage.level.clear).toBe('boss');
    const rows = FILES['content/levels/boss.map.txt']!.trim().split('\n');
    const checkpoint = rows.findIndex((r) => r.includes('K'));
    const wall = rows[0]!.indexOf('#'); // the arena's left wall, hanging from the top
    expect(wall).toBe(19);
    expect(rows[checkpoint]!.indexOf('K')).toBeLessThan(wall);
    expect(rows.find((r) => r.includes('b'))!.indexOf('b')).toBeGreaterThan(wall);
    // The arena's floor-level wall stops a charge and a thorn; the way in is over it.
    expect(rows[9]![wall]).toBe('#');
    expect(rows[6]![wall]).toBe('.');
  });

  it('telegraphs every attack, and its second phase is faster', () => {
    const patterns = [boss.pattern, ...(boss.phases ?? []).map((p) => p.pattern)];
    for (const pattern of patterns)
      pattern.forEach((step, i) => {
        if (step.do === 'idle' || step.do === 'telegraph') return;
        const before = pattern[i - 1]!;
        expect(before.do, `${step.do} at ${i}`).toBe('telegraph');
        expect((before as { attack: string }).attack).toBe(step.do);
      });
    const ticks = (p: readonly { do: string; ticks?: number }[]) =>
      Math.max(...p.filter((s) => s.do === 'telegraph').map((s) => s.ticks ?? 0));
    expect(boss.phases).toHaveLength(1);
    expect(boss.phases![0]!.hp).toBe(boss.hp / 2);
    expect(ticks(boss.phases![0]!.pattern)).toBeLessThan(ticks(boss.pattern));
    const attacks = new Set(
      patterns
        .flat()
        .filter((s) => s.do === 'telegraph')
        .map((s) => (s as { attack: string }).attack),
    );
    expect([...attacks].sort()).toEqual(['charge', 'drop', 'leap', 'shoot']);
    expect(stage.profile.actors['thorn']!.projectile).toBe('flies');
    expect(stage.profile.actors['acorn']!.projectile).toBe('falls');
  });

  it('draws each telegraph its own way, an angry second phase, a white hit flash and a defeat sequence', () => {
    const entry = skin.kinds['burrlock']!;
    const tags = (entry.byTag ?? []).map((l) => l.tag ?? `${l.prefix}${l.min}`);
    expect(tags).toEqual([
      'phase:1',
      'telegraph:shoot',
      'telegraph:charge',
      'telegraph:leap',
      'telegraph:drop',
    ]);
    const hurt = entry.frames!['hurt'] as { right: { frames: string[] } };
    expect(hurt.right.frames[0]).toBe('white');
    const defeated = entry.frames!['defeated'] as {
      right: { frames: string[]; loop: boolean; events: Record<string, string> };
    };
    expect(defeated.right.loop).toBe(false);
    for (const type of new Set(Object.values(defeated.right.events)))
      expect(skin.events?.[type], type).toBeDefined();
    for (const type of ['boss-hit', 'boss-defeat']) {
      expect(skin.events?.[type]?.hitPause, type).toBeDefined();
      expect(skin.events?.[type]?.flash, type).toBeDefined();
      expect(skin.events?.[type]?.shake, type).toBeDefined();
    }
    for (const attack of ['shoot', 'charge', 'leap', 'drop'])
      expect(skin.events?.[`boss-telegraph:attack=${attack}`]?.emit, attack).toBeDefined();
    // The boss bar and name plate show only where the frame has the boss's status.
    expect(skin.hud?.filter((h) => h.status?.startsWith('boss')).map((h) => h.as)).toEqual(['icon', 'bar']);
  });

  it('has a level-clear banner and an end screen with stats and the way back to the title', () => {
    const menus = content.manifest.menus!;
    expect(menus.clear?.lines?.map((l) => l.status)).toEqual(['coins', 'time', 'deaths']);
    expect(menus.end?.items).toEqual(['title', 'levels']);
    expect(menus.end?.lines?.map((l) => l.status)).toEqual(['coins', 'time', 'deaths']);
  });
});

/** A presented frame, as the view gives it (read-only). */
type Frame = ReturnType<NonNullable<ReturnType<typeof createView>['frame']>>;

/** Every frame of a run file, as the screenshot tool and a page see them. */
function eachFrame(name: string, see: (frame: Frame, tick: number) => void): void {
  const run = runOf(name);
  const view = createView(content, 1, run.start ? { start: run.start } : {});
  const input = new ScriptedInput(run.input);
  for (let t = 0; t <= run.ticks; t++) {
    if (t > 0) {
      input.next();
      view.step(input);
    }
    see(view.frame!(), t);
  }
}

describe("Hopper's Way: music and sound (T9)", () => {
  const look = hopperLook(imaged);
  const look3d = hopperLook3d(content);
  const skins = { canvas2d: look.skin, three: look3d.skin } as Record<string, SkinFile>;
  const sfx = new Set(contentSfx(content).map((s) => s.id));
  const songs = new Map(contentSongs(content).map((s) => [s.id, s]));
  const music = look.skin.music![PLATFORMER_MUSIC]!;

  /** Every distinct kit event the run files show (one per type and the fields a skin keys on). */
  const kitEvents = new Map<string, { type: string } & Record<string, unknown>>();
  for (const name of RUNS)
    eachFrame(name, (frame) => {
      for (const e of frame.events) {
        const ev = e as { type: string } & Record<string, unknown>;
        kitEvents.set(JSON.stringify([ev.type, ev['tier'], ev['attack'], ev['content']]), ev);
      }
    });

  /**
   * Every event the platformer kit can send in this game (no mini games): the runs show most;
   * a brick, a shell, a block's actor and a life are the kit's too, so they have their sounds.
   */
  const KIT_EVENTS: ({ type: string } & Record<string, unknown>)[] = [
    ...[0, 1, 2].map((tier) => ({ type: 'jump', tier })),
    ...['land', 'bump', 'break', 'coin', 'spawn', 'stomp', 'kick', 'defeat', 'hurt', 'died'].map((type) => ({
      type,
    })),
    ...['respawn', 'checkpoint', 'cleared', 'boss-hit', 'boss-defeat'].map((type) => ({ type })),
    ...['coin', 'coins', 'life'].map((content) => ({ type: 'block', content })),
    ...['shoot', 'charge', 'leap', 'drop'].flatMap((attack) => [
      { type: 'boss-telegraph', attack },
      { type: 'boss-attack', attack },
    ]),
  ];

  /** Frame events a skin's cycles name that play no sound of their own. */
  const SILENT_FRAME_EVENTS = new Set(['dying']); // the remains appear on the `died` event's tick

  it('names only sounds the game has, and every song compiles', () => {
    for (const skin of Object.values(skins))
      for (const [key, entry] of Object.entries(skin.events ?? {}))
        if (entry.sound !== undefined) expect(sfx, `${skin.backend} ${key}`).toContain(entry.sound);
    for (const song of songs.values()) expect(compileSong(song).length, song.id).toBeGreaterThan(0);
  });

  it('has a sound for every kit event the runs show, in the 2D and 3D skins', () => {
    expect(kitEvents.size).toBeGreaterThan(20);
    const silent: string[] = [];
    for (const [backend, skin] of Object.entries(skins))
      for (const [key, ev] of kitEvents)
        if (resolveSkinEvent(skin.events, ev)?.sound === undefined) silent.push(`${backend} ${key}`);
    expect(silent).toEqual([]);
  });

  it('has a sound for every event the kit can send here, a jump per tier and a telegraph per attack', () => {
    const sound = (skin: SkinFile, ev: { type: string } & Record<string, unknown>) =>
      resolveSkinEvent(skin.events, ev)?.sound;
    for (const [backend, skin] of Object.entries(skins)) {
      for (const ev of KIT_EVENTS) expect(sound(skin, ev), `${backend} ${JSON.stringify(ev)}`).toBeDefined();
      expect(new Set([0, 1, 2].map((tier) => sound(skin, { type: 'jump', tier }))).size).toBe(3);
      const attacks = ['shoot', 'charge', 'leap', 'drop'];
      expect(new Set(attacks.map((attack) => sound(skin, { type: 'boss-telegraph', attack }))).size).toBe(4);
      expect(new Set(attacks.map((attack) => sound(skin, { type: 'boss-attack', attack }))).size).toBe(4);
      expect(sound(skin, { type: 'block', content: 'life' })).not.toBe(
        sound(skin, { type: 'block', content: 'coin' }),
      );
    }
  });

  it("has a sound for every skin frame event (footsteps, the skid, the puff, the boss's defeat)", () => {
    const named = new Set<string>();
    const walk = (o: unknown, inCycle: boolean): void => {
      if (Array.isArray(o)) o.forEach((v) => walk(v, inCycle));
      else if (o !== null && typeof o === 'object')
        for (const [k, v] of Object.entries(o)) {
          if (k === 'events' && inCycle)
            Object.values(v as Record<string, string>).forEach((t) => named.add(t));
          else walk(v, inCycle || k === 'kinds');
        }
    };
    for (const skin of Object.values(skins)) walk(skin.kinds, true);
    expect([...named].sort()).toEqual(
      ['boss-blast', 'boss-crack', 'boss-pop', 'dying', 'footstep', 'poof', 'skid-dust'].sort(),
    );
    for (const [backend, skin] of Object.entries(skins))
      for (const type of named)
        if (!SILENT_FRAME_EVENTS.has(type))
          expect(skin.events?.[type]?.sound, `${backend} ${type}`).toBeDefined();
  });

  it('varies the sounds heard over and over: jumps, steps, landings, coins, stomps and bumps', () => {
    for (const skin of Object.values(skins))
      for (const key of [
        'jump:tier=0',
        'jump:tier=1',
        'footstep',
        'land',
        'coin',
        'stomp',
        'bump',
        'boss-pop',
      ]) {
        const e = skin.events![key]!;
        expect(e.pitch ?? e.volume, `${skin.backend} ${key}`).toBeDefined();
      }
  });

  it('plays a sound for every UI move, its own title song and an end fanfare', () => {
    const menus = content.manifest.menus!;
    const ui = menus.style!.sounds!;
    for (const id of [ui.move, ui.select, ui.back]) expect(sfx).toContain(id);
    expect(new Set([ui.move, ui.select, ui.back]).size).toBe(3);
    expect(songs.get(menus.title.music!)?.loop).toBe(true);
    expect(songs.get(menus.end!.music!)?.loop).toBe(false);
  });

  it('mixes one layered song, the same in both skins: a calm and a drive layer per level, two for the boss', () => {
    expect(look3d.skin.music).toEqual(look.skin.music);
    expect(Object.keys(look.skin.music ?? {})).toEqual([PLATFORMER_MUSIC]);
    expect(Object.keys(music.layers).sort()).toEqual(
      [
        'autumn',
        'autumn-drive',
        'boss',
        'boss-rage',
        'meadow',
        'meadow-drive',
        'night',
        'night-drive',
      ].sort(),
    );
    for (const song of Object.values(music.layers)) expect(songs.has(song), song).toBe(true);
  });

  /** The layer levels at every tick of a run, as the page's mixer sets them from each frame. */
  const mixOf = (name: string) => {
    const mix = new LayerMix(music);
    const out: { tick: number; status: Frame['status']; gains: Record<string, number> }[] = [];
    eachFrame(name, (frame, tick) =>
      out.push({ tick, status: frame.status, gains: mix.update(frame.status) }),
    );
    return out;
  };
  const LEVEL_LAYERS: Record<string, [string, string]> = {
    'level-1': ['meadow', 'meadow-drive'],
    'level-2': ['autumn', 'autumn-drive'],
    'level-3': ['night', 'night-drive'],
    boss: ['boss', 'boss-rage'],
  };

  it.each(['level-1', 'level-2', 'level-3'])(
    "plays %s's own layers: the drive comes up near an enemy and drops away, and stops at the clear",
    (level) => {
      const seen = mixOf(`${level}.run.json`);
      const [calm, drive] = LEVEL_LAYERS[level]!;
      const playing = seen.filter((s) => s.status['outcome'] === 'playing');
      // Only this level's layers sound while it is played.
      for (const s of playing)
        for (const [layer, gain] of Object.entries(s.gains))
          if (layer !== calm && layer !== drive) expect(gain, `${layer} at ${s.tick}`).toBeLessThan(0.05);
      expect(playing.some((s) => s.gains[calm] === 1)).toBe(true);
      const drives = playing.map((s) => s.gains[drive]!);
      expect(Math.max(...drives)).toBe(1); // an enemy near
      expect(Math.min(...drives)).toBeLessThan(0.2); // none near
      const near = playing.find((s) => s.gains[drive] === 1)!;
      const status = near.status['nearestActor'] as number;
      expect(status).toBeGreaterThanOrEqual(0);
      expect(status).toBeLessThan(96);
      // Cleared: every layer fades out under the clear jingle.
      const last = seen[seen.length - 1]!;
      expect(last.status['outcome']).toBe('cleared');
      expect(Math.max(...Object.values(last.gains))).toBe(0);
    },
  );

  it("plays the boss's fight layer, adds the rage layer in its second phase, and falls silent at its defeat", () => {
    const seen = mixOf('boss.run.json');
    const at = (when: (s: (typeof seen)[number]) => boolean) => seen.filter(when);
    const asleep = at((s) => s.status['bossState'] === 'asleep');
    expect(asleep.length).toBeGreaterThan(0);
    expect(asleep.every((s) => s.gains['boss']! < 0.5 && s.gains['boss-rage'] === 0)).toBe(true);
    const phase2 = at((s) => s.status['bossPhase'] === 1 && s.status['bossState'] !== 'defeated');
    expect(phase2.length).toBeGreaterThan(0);
    expect(phase2.some((s) => s.gains['boss'] === 1 && s.gains['boss-rage'] === 1)).toBe(true);
    const phase1 = at((s) => s.status['bossPhase'] === 0 && s.status['bossState'] !== 'asleep');
    expect(phase1.some((s) => s.gains['boss'] === 1 && s.gains['boss-rage']! < 0.5)).toBe(true);
    const last = seen[seen.length - 1]!;
    expect(Math.max(...Object.values(last.gains))).toBe(0);
    for (const s of seen)
      for (const layer of ['meadow', 'autumn', 'night', 'meadow-drive', 'autumn-drive', 'night-drive'])
        expect(s.gains[layer], `${layer} at ${s.tick}`).toBeLessThan(0.05);
  });

  it('ducks the music under the big hits: a hurt, a death, a boss hit and its defeat', () => {
    for (const skin of Object.values(skins))
      for (const key of ['hurt', 'died', 'boss-hit', 'boss-defeat', 'boss-blast'])
        expect(skin.events![key]!.duck?.amount, `${skin.backend} ${key}`).toBeGreaterThanOrEqual(0.5);
    // Through the shell's mixer, as the page plays the boss run: the music dips on each boss hit.
    const ducks: number[] = [];
    const audio: MixerAudio = {
      playMusic: () => {},
      sfx: () => {},
      setLayerGains: () => {},
      setDuck: (f) => void ducks.push(f),
      volumeLevels: { master: 1, music: 1, sfx: 1, muted: false },
    };
    const mixer = new Mixer({ audio, music: look.skin.music!, seed: 1 });
    mixer.play(PLATFORMER_MUSIC);
    const hits: number[] = [];
    eachFrame('boss.run.json', (frame, tick) => {
      mixer.frameStatus(frame.status);
      for (const ev of frame.events) {
        const entry = resolveSkinEvent(look.skin.events, ev as { type: string });
        if (entry?.sound !== undefined) mixer.sound(entry.sound, skinSoundCue(entry, frame.frame));
        if (ev.type === 'boss-hit') hits.push(tick);
      }
      mixer.tick();
    });
    expect(hits.length).toBe(4);
    for (const tick of hits) expect(Math.min(...ducks.slice(tick, tick + 6))).toBeLessThan(0.6);
    expect(ducks.slice(hits[0]!, hits[1]!)).toContain(1); // back up between hits
  });
});
