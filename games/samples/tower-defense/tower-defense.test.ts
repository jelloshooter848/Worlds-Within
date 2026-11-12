import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullRenderer } from '@engine/backends/null';
import { withContentImages } from '@engine/core/assets/content-images';
import type { ContentBundle } from '@engine/core/content/bundle';
import { dataUrlBytes, readPngSize } from '@engine/core/content/png';
import type { Renderer } from '@engine/core/gfx/renderer';
import { compileSong, parseMml } from '@engine/core/audio/mml';
import { contentSfx, contentSongs, mustLoad } from '@engine/core/content/game-content';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import {
  resolveSkinEvent,
  resolveSkinFrame,
  resolveSkinKind,
  type DeepReadonly,
  type PresentEntity,
  type PresentFrame,
} from '@engine/core/present';
import { LayerMix, mixWhenHolds } from '@engine/core/audio/mix';
import { contentFonts, endScreen, type EndTrigger, type MenuBuildContext } from '@engine/core/ui';
import { TD_EVENT_TYPES, TD_TILE_SIZE, TdBot, TOWERDEFENSE_RULES, type TdBotStep } from '@kits/towerdefense';
import { LOST_PLAN, WIN_PLAN } from './plans';
import { loadTowerDefense, sampleRound } from './content';
import { createGame } from './headless';
import { tdLook } from './picture';
import { createView } from './view';
import { ROAD_FRAMES } from './tools/road-art';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
/**
 * The bundle with its skin's PNG sheets (Kenney's CC0 Tower Defense, Engine 0.16 E7) "decoded"
 * for Node: each image's size from its header and no pixels (the recording renderers here never
 * look at them), as `withContentImages` gives the page and the screenshot tool the real ones.
 */
const content: ContentBundle = await withContentImages(
  mustLoad(loadTowerDefense(readGameFiles(ROOT))),
  async (url) => {
    const size = readPngSize(dataUrlBytes(url)!)!;
    return { image: null, width: size.width, height: size.height, data: null };
  },
);
const SEED = content.manifest.start.seed;

interface Check {
  tick: number;
  path: string;
  op: string;
  value: unknown;
}

interface RunFile {
  ticks: number;
  input: InputScript;
  assertions: Check[];
  guards?: string[];
}

const RUNS = readdirSync(new URL('./runs/', import.meta.url))
  .filter((f) => f.endsWith('.run.json'))
  .map((f) => f.replace(/\.run\.json$/, ''))
  .sort();

function runFile(name: string): RunFile {
  return JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as RunFile;
}

/** A dotted path into a snapshot, as run files read it. */
function at(snap: JsonObject, path: string): unknown {
  return path.split('.').reduce<unknown>((v, k) => (v as Record<string, unknown>)?.[k], snap);
}

/** Plays a run file's input headless as `pnpm cli run` does; every tick's snapshot (tick 0 first). */
function play(name: string, disabledRules: string[] = []): JsonObject[] {
  const run = runFile(name);
  const game = createGame(content, SEED, { disabledRules });
  const input = new ScriptedInput(run.input);
  const snaps = [game.snapshot()];
  for (let t = 0; t < run.ticks; t++) {
    input.next();
    game.step(input);
    snaps.push(game.snapshot());
  }
  return snaps;
}

/** The checks of a run file that fail on `snaps`. */
function failing(name: string, snaps: JsonObject[]): Check[] {
  return runFile(name).assertions.filter((c) => {
    const v = at(snaps[c.tick]!, c.path);
    const same = (x: unknown) => canonicalJson(x as JsonObject) === canonicalJson(c.value as JsonObject);
    if (c.op === 'contains') return !(v as unknown[]).some(same);
    if (c.op === 'eq') return !same(v);
    throw new Error(`${name}: this test reads only eq and contains assertions, not ${c.op}`);
  });
}

describe('the tower-defense content', () => {
  it('has one 16:9 map (30 x 16 cells across the 480x270 picture, room for the HUD) and its ten waves', () => {
    const round = sampleRound(content);
    expect(content.manifest.screen).toEqual({ width: 480, height: 270 });
    // A whole divisor of 1920x1080 (4x).
    expect([1920 / 480, 1080 / 270]).toEqual([4, 4]);
    expect(round.map.id).toBe('road');
    expect(round.map.start).toEqual({ gold: 60, lives: 20 });
    expect(round.map.map).toHaveLength(16);
    for (const row of round.map.map) expect(row.length * TD_TILE_SIZE).toBe(content.manifest.screen.width);
    // The map is 256 px high: the camera centres it, 7 px of grass above and below for the HUD.
    expect(content.manifest.screen.height - round.map.map.length * TD_TILE_SIZE).toBe(14);
    expect(round.waves.id).toBe(round.map.waves);
    expect(round.waves.timer).toBe(500);
    expect(round.waves.waves).toHaveLength(10);
    // Every wave is bigger or tougher than the one two before it, and both kinds come.
    const kinds = new Set(round.waves.waves.flatMap((w) => w.groups.map((g) => g.kind)));
    expect([...kinds].sort()).toEqual(['brute', 'runner']);
    const hp = round.waves.waves.map((w) => Math.max(...w.groups.map((g) => g.hp)));
    expect(hp.at(-1)).toBeGreaterThan(hp[0]! * 10);
  });

  it('has three tower types with two upgrades each: the arrow, the splashing cannon, the slowing frost', () => {
    const round = sampleRound(content);
    expect(round.map.towers).toEqual(['arrow', 'cannon', 'frost']);
    expect(Object.keys(round.towers).sort()).toEqual(['arrow', 'cannon', 'frost']);
    for (const type of Object.values(round.towers)) expect(type.levels).toHaveLength(2);
    expect(round.towers['cannon']!.splash).toEqual({ radius: 1, damage: 1 });
    expect(round.towers['cannon']!.levels!.map((l) => l.splash?.damage)).toEqual([2, 4]);
    expect(round.towers['frost']!.slow).toEqual({ factor: 60, ticks: 20 });
    expect(round.towers['frost']!.levels!.map((l) => l.slow?.factor)).toEqual([50, 40]);
  });

  it('rates a win by the lives left: three stars from 18, two from 10', () => {
    expect(sampleRound(content).map.stars).toEqual({ three: 18, two: 10 });
  });
});

describe('the tower-defense headless', () => {
  it("starts with the map's gold and lives, no wave and the cursor on the first build cell", () => {
    const snap = createGame(content, SEED).snapshot();
    expect(snap['kit']).toMatchObject({
      outcome: 'playing',
      gold: 60,
      lives: 20,
      wave: 0,
      waves: 10,
      towers: 0,
      stars: 0,
    });
    expect(snap['controls']).toEqual({ col: 3, row: 2, tower: 'arrow', held: [0, 0, 0, 0] });
  });

  it('finds the ten run files', () => {
    expect(RUNS).toEqual([
      'build',
      'leak',
      'lost',
      'slow',
      'sped-up',
      'splash',
      'target',
      'timer',
      'upgrade',
      'win',
    ]);
  });

  it.each(RUNS)('plays %s to the same snapshots twice and passes its assertions', (name) => {
    const a = play(name);
    expect(a.map((s) => canonicalJson(s))).toEqual(play(name).map((s) => canonicalJson(s)));
    expect(failing(name, a)).toEqual([]);
  });

  it('wins all ten waves with three stars with a good defence, and loses with a thin one (Engine 0.16 E9)', () => {
    const win = play('win').at(-1)!;
    expect(win['kit']).toMatchObject({
      outcome: 'won',
      lives: 18,
      leaked: 2,
      wave: 10,
      towers: 13,
      killed: 138,
      stars: 3,
    });
    const lost = play('lost').at(-1)!;
    expect(lost['kit']).toMatchObject({
      outcome: 'lost',
      lives: 0,
      leaked: 20,
      wave: 6,
      towers: 2,
      stars: 0,
    });
  });

  it('keeps three stars hard: the 0.16 E8 defence (twelve towers) wins the tuned waves with two', () => {
    const plan = WIN_PLAN.filter(
      (s) => !(s.do === 'place' || s.do === 'upgrade') || s.col !== 24 || s.row !== 4,
    );
    expect(plan).toHaveLength(WIN_PLAN.length - 2);
    const game = createGame(content, SEED);
    const bot = new TdBot(plan);
    const input = new ScriptedInput({ steps: [] });
    while (game.world.outcome === 'playing' && game.world.tick < 4000) {
      input.setHeld(bot.next(game));
      input.next();
      game.step(input);
    }
    expect(game.snapshot()['kit']).toMatchObject({ outcome: 'won', towers: 12, stars: 2 });
  });

  it('gives the sped-up run the golden hashes of the win at every hashed tick (Engine 0.16 E9)', () => {
    const golden = (name: string) =>
      (
        JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
          hashes: { tick: number; hash: string }[];
        }
      ).hashes;
    expect(runFile('sped-up').ticks).toBe(runFile('win').ticks);
    expect(golden('sped-up')).toEqual(golden('win'));
    expect(golden('sped-up').length).toBeGreaterThan(30);
  });

  it('passes the rules switched off to the kit: each run fails without a rule it guards', () => {
    for (const name of RUNS)
      for (const rule of runFile(name).guards ?? []) {
        expect(TOWERDEFENSE_RULES.map((r) => r.id)).toContain(rule);
        expect(failing(name, play(name, [rule])), `${name} without ${rule}`).not.toEqual([]);
      }
  });

  it.each([
    ['win', WIN_PLAN],
    ['lost', LOST_PLAN],
  ] as const)("plays the %s run file exactly as the kit's bot plays its plan", (name, plan) => {
    const run = runFile(name);
    const game = createGame(content, SEED);
    const bot = new TdBot(plan as readonly TdBotStep[]);
    const input = new ScriptedInput({ steps: [] });
    const snaps = [canonicalJson(game.snapshot())];
    for (let t = 0; t < run.ticks; t++) {
      input.setHeld(bot.next(game));
      input.next();
      game.step(input);
      snaps.push(canonicalJson(game.snapshot()));
    }
    expect(snaps).toEqual(play(name).map((s) => canonicalJson(s)));
  });
});

describe('the tower-defense assets (Engine 0.15 T14 audit)', () => {
  const { skin } = tdLook(content);
  const FALLBACK = skin.sheets?.fallbackColor;

  it('names no placeholder look: no kind, tag look or tile has its own fallback colour', () => {
    expect(FALLBACK).toBe('#ff00ff');
    for (const [kind, entry] of Object.entries(skin.kinds)) {
      expect(entry.fallbackColor, kind).toBeUndefined();
      for (const tagged of entry.byTag ?? []) expect(tagged.fallbackColor, kind).toBeUndefined();
    }
    for (const [tile, entry] of Object.entries(skin.tiles ?? {}))
      expect(entry.fallbackColor, tile).toBeUndefined();
  });

  it.each(RUNS)('draws every tick of %s from the art, never a fallback box', (name) => {
    const run = runFile(name);
    const view = createView(content, SEED);
    const input = new ScriptedInput(run.input);
    let sprites = 0;
    const fallbacks: number[] = [];
    let tick = 0;
    const r: Renderer = Object.assign(new NullRenderer(), {
      sprite() {
        sprites++;
      },
      rect(_x: number, _y: number, _w: number, _h: number, color: string) {
        if (color === FALLBACK) fallbacks.push(tick);
      },
    });
    for (tick = 0; tick <= run.ticks; tick++) {
      if (tick > 0) {
        input.next();
        view.step(input);
      }
      view.render(r);
    }
    expect(sprites).toBeGreaterThan(0);
    expect(fallbacks.slice(0, 5)).toEqual([]);
  });

  it('has its songs with channels of one length, the danger layer in step with the calm one, and an sfx for every sound the skin names', () => {
    const songs = contentSongs(content);
    // The looping `road` and its danger layer (Engine 0.16 E9), and the end screen's jingles.
    expect(songs.map((s) => s.id).sort()).toEqual(['road', 'road-danger', 'road-lost', 'road-won']);
    for (const song of songs) {
      expect(compileSong(song).length, song.id).toBeGreaterThan(0);
      const lengths = (['pulse1', 'pulse2', 'triangle', 'noise'] as const).map(
        (ch) => parseMml(song[ch]!, ch.startsWith('pulse') ? 'pulse' : (ch as 'triangle' | 'noise')).length,
      );
      expect(new Set(lengths).size, song.id).toBe(1);
    }
    const byId = (id: string) => songs.find((s) => s.id === id)!;
    expect(byId('road-danger')).toMatchObject({ bpm: byId('road').bpm, loop: true });
    expect([byId('road-won').loop, byId('road-lost').loop]).toEqual([false, false]);
    expect(skin.music?.['road']?.layers).toEqual({ calm: 'road', danger: 'road-danger' });
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    // An event's own sound and (Engine 0.16 E7) its projectile's impact sound.
    const sounds = Object.values(skin.events ?? {}).flatMap((e) => [
      ...(e.sound ? [e.sound] : []),
      ...(e.projectile?.impact?.sound ? [e.projectile.impact.sound] : []),
    ]);
    // The skin's sounds and (Engine 0.16 T9) the menus' (`game.json`'s `menus.style.sounds`).
    const menus = Object.values(content.manifest.menus?.style?.sounds ?? {});
    expect(new Set([...sounds, ...menus])).toEqual(sfx);
  });

  // Engine 0.16 E7: the map's three tower types (arrow, cannon and, from E8, frost) at
  // every level, the enemies, ghosts, health bars and every event, from the CC0 pack.
  const entity = (kind: string, state: string, tags: string[]): PresentEntity => ({
    id: kind,
    kind,
    x: 0,
    y: 0,
    w: 16,
    h: 16,
    facing: 'right',
    anim: { state, t: 0 },
    tags,
  });

  it.each(['arrow', 'cannon', 'frost'])(
    'draws the %s tower at levels 1-3, idle and firing, turned to its target',
    (type) => {
      for (const level of [1, 2, 3]) {
        const tags = [`type:${type}`, `level:${level}`, `range:2`];
        expect(resolveSkinFrame(skin, entity(`tower:${type}`, 'idle', tags))).toMatchObject({
          sheet: 'road',
          frame: `${type}-${level}`,
        });
        expect(resolveSkinFrame(skin, entity(`tower:${type}`, 'fire', tags)).frame).toBe(
          `${type}-${level}-fire`,
        );
      }
      expect(skin.kinds[`tower:${type}`]!.turnToFacing).toBe('up');
      expect(resolveSkinFrame(skin, entity(`shot:${type}`, 'idle', [])).frame).toBe('blank');
      // The ghost: its own frame, a ring from the range tag, red when blocked, the upgrade mark on a
      // selected tower.
      const ghost = (tags: string[]) => resolveSkinFrame(skin, entity(`ghost:${type}`, 'ok', tags));
      expect(ghost(['ok', 'range:2'])).toMatchObject({ sheet: 'road', frame: `ghost-${type}` });
      expect(ghost(['blocked', 'why:too_poor', 'range:2']).palette).toBe('#f83800');
      expect(ghost(['blocked', 'why:occupied', 'selected', 'range:3'])).toMatchObject({
        sheet: 'td16',
        frame: '16',
      });
      expect(resolveSkinKind(skin, entity(`ghost:${type}`, 'ok', ['ok']))!.ring).toMatchObject({
        tag: 'range:',
      });
      expect(resolveSkinEvent(skin.events, { type: 'td-shot', tower: type })?.projectile).toBeDefined();
    },
  );

  it.each(['runner', 'brute'])(
    'walks the %s in two steps, ice blue while slowed, with a hit flash and a health bar',
    (kind) => {
      const at = (t: number, tags: string[] = []) =>
        resolveSkinFrame(skin, { ...entity(`enemy:${kind}`, 'walk', tags), anim: { state: 'walk', t } });
      expect(new Set([0, 4, 8, 12].map((t) => at(t).frame))).toEqual(new Set([`${kind}-0`, `${kind}-1`]));
      expect(at(0, ['slow']).frame).toBe(`${kind}-slow-0`);
      const entry = skin.kinds[`enemy:${kind}`]!;
      expect(entry.turnToFacing).toBe(true);
      expect(entry.hitFlash).toMatchObject({ tag: 'hit' });
      expect(skin.labels?.[`enemy:${kind}`]).toMatchObject({
        from: { tag: 'hp:' },
        as: 'bar',
        max: { tag: 'maxhp:' },
      });
    },
  );

  it("names a frame of the pack's sheets for every road look, and a sound for every kit event", () => {
    for (const entry of Object.values(skin.kinds))
      for (const look of [entry, ...(entry.byTag ?? [])])
        for (const spec of Object.values(look.frames ?? {})) {
          const names = typeof spec === 'string' ? [spec] : 'frames' in spec ? (spec.frames as string[]) : [];
          const sheet = look.sheet ?? entry.sheet ?? skin.sheets?.sheet;
          if (sheet === 'road') for (const n of names) expect(ROAD_FRAMES[n], n).toBeDefined();
        }
    for (const type of TD_EVENT_TYPES) {
      const ev = type === 'td-end' ? { type, result: 'won' } : { type };
      expect(resolveSkinEvent(skin.events, ev)?.sound, type).toEqual(expect.any(String));
    }
  });
});

describe('the full game: the end screen, the music, the HUD (Engine 0.16 E9)', () => {
  const menus = content.manifest.menus!;
  const { skin } = tdLook(content);

  /** Every presented frame of a run file through `view.ts` (the cursor and HUD status included). */
  function eachFrame(name: string, fn: (frame: DeepReadonly<PresentFrame>) => void): void {
    const run = runFile(name);
    const view = createView(content, SEED);
    const input = new ScriptedInput(run.input);
    fn(view.frame!() as DeepReadonly<PresentFrame>);
    for (let t = 0; t < run.ticks; t++) {
      input.next();
      view.step(input);
      fn(view.frame!() as DeepReadonly<PresentFrame>);
    }
  }

  /** The first end trigger that fires on a run's frames, with the status it fired on. */
  function ending(name: string) {
    let hit: { trigger: EndTrigger; status: Record<string, string | number | boolean> } | null = null;
    eachFrame(name, (frame) => {
      const trigger = menus.triggers?.end?.find((t) => mixWhenHolds(t.when, frame.status));
      if (hit === null && trigger !== undefined) hit = { trigger, status: { ...frame.status } };
    });
    return hit as { trigger: EndTrigger; status: Record<string, string | number | boolean> } | null;
  }

  const ctx: MenuBuildContext = {
    screen: content.manifest.screen,
    fonts: contentFonts(content),
    frameSize: () => ({ w: 16, h: 16 }),
    keys: {},
  };

  it('ends the win on the end screen with three stars, the waves held, lives, gold and kills, and a jingle', () => {
    const won = ending('win')!;
    expect(won.trigger).toMatchObject({ heading: 'The road is held!', music: 'road-won' });
    expect(won.status).toMatchObject({ outcome: 'won', stars: 3, wavesHeld: 10, waveCount: 10, lives: 18 });
    const file = endScreen(menus, ctx, won.status, won.trigger);
    const stars = file.widgets.flatMap((w) =>
      w.type === 'image' && w.id?.startsWith('star-') ? [w.frame] : [],
    );
    expect(stars).toEqual(['star-on', 'star-on', 'star-on']);
    const texts = file.widgets.flatMap((w) => (w.type === 'text' ? [w.text] : []));
    expect(texts).toEqual(
      expect.arrayContaining([
        'The road is held!',
        'Waves held',
        '10/10',
        'Lives left',
        '18',
        'Enemies stopped',
        '138',
      ]),
    );
    expect(contentSongs(content).find((s) => s.id === 'road-won')?.loop).toBe(false);
  });

  it('ends the loss on the end screen with no stars, the waves held and its own jingle', () => {
    const lost = ending('lost')!;
    expect(lost.trigger).toMatchObject({ heading: 'The gate has fallen', music: 'road-lost', stars: false });
    // Waves 1 to 5 went by (wave 4 and 5 with leaks); wave 6 broke through.
    expect(lost.status).toMatchObject({ outcome: 'lost', lives: 0, wavesHeld: 5, waveNumber: 6 });
    const file = endScreen(menus, ctx, lost.status, lost.trigger);
    expect(file.widgets.some((w) => w.id?.startsWith('star-'))).toBe(false);
    expect(file.widgets.flatMap((w) => (w.type === 'text' ? [w.text] : []))).toContain('5/10');
  });

  it('mixes the danger layer in while enemies near the gate and in the late waves, calm otherwise', () => {
    const mix = new LayerMix(skin.music!['road']!);
    const seen: { near: number; wave: number; enemies: number; danger: number }[] = [];
    let last: DeepReadonly<PresentFrame>['status'] = {};
    eachFrame('win', (frame) => {
      last = frame.status;
      const gains = mix.update(frame.status);
      seen.push({
        near: Number(frame.status['nearGate']),
        wave: Number(frame.status['waveNumber']),
        enemies: Number(frame.status['enemies']),
        danger: gains['danger']!,
      });
    });
    expect(seen[0]!.danger).toBe(0);
    // Calm through the early waves held far from the gate.
    expect(seen.filter((s) => s.wave <= 3).every((s) => s.near > 0 || s.danger < 1)).toBe(true);
    expect(seen.some((s) => s.near > 0 && s.danger === 1)).toBe(true);
    expect(seen.some((s) => s.wave >= 8 && s.enemies > 0 && s.near === 0 && s.danger === 0.6)).toBe(true);
    // Won: the danger fades out (20 ticks).
    for (let i = 0; i < 20; i++) mix.update(last);
    expect(mix.update(last)['danger']).toBe(0);
  });

  it('shows the wave preview, the selected tower’s upgrade and sell, and the speed in the HUD', () => {
    const hud = skin.hud ?? [];
    const item = (status: string, as: string) => hud.find((h) => h.status === status && h.as === as);
    expect(item('nextWaveGroups', 'preview')).toMatchObject({
      sheet: 'td',
      frames: { runner: 'icon-runner', brute: 'icon-brute' },
    });
    expect(item('upgradeCost', 'number')).toBeDefined();
    expect(item('sellValue', 'text')?.format).toBe('sell {value}');
    // The labels show only with their value (E10: no bare "next" after the last wave, no bare "sell").
    expect(item('sellValue', 'text')?.when).toBe('sellValue');
    expect(item('nextWaveGroups', 'text')?.when).toBe('nextWaveGroups');
    expect(item('speed', 'text')?.when).toEqual({ status: 'speed', gt: 1 });
    // On the win's frames: the preview's groups before each wave, a tower selected with its prices.
    const statuses: DeepReadonly<PresentFrame>['status'][] = [];
    eachFrame('win', (frame) => statuses.push(frame.status));
    expect(statuses[0]).toMatchObject({ nextWaveGroups: 'runner:8' });
    expect(statuses.some((s) => s['nextWaveGroups'] === 'brute:8,runner:16')).toBe(true);
    expect(
      statuses.some((s) => typeof s['upgradeCost'] === 'number' && typeof s['sellValue'] === 'number'),
    ).toBe(true);
  });
});
