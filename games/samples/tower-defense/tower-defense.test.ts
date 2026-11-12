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
  type PresentEntity,
} from '@engine/core/present';
import { TD_EVENT_TYPES, TD_TILE_SIZE, TdBot, TOWERDEFENSE_RULES, type TdBotStep } from '@kits/towerdefense';
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
  it('has one map that fills the 256x240 picture, its two tower types and three waves', () => {
    const round = sampleRound(content);
    expect(round.map.id).toBe('road');
    expect(round.map.towers).toEqual(['arrow', 'cannon']);
    expect(round.map.start).toEqual({ gold: 40, lives: 5 });
    expect(round.map.map.length * TD_TILE_SIZE).toBe(content.manifest.screen.height);
    for (const row of round.map.map) expect(row.length * TD_TILE_SIZE).toBe(content.manifest.screen.width);
    expect(Object.keys(round.towers).sort()).toEqual(['arrow', 'cannon']);
    expect(round.waves.id).toBe(round.map.waves);
    expect(round.waves.waves).toHaveLength(3);
  });
});

describe('the tower-defense headless', () => {
  it("starts with the map's gold and lives, no wave and the cursor on the first build cell", () => {
    const snap = createGame(content, SEED).snapshot();
    expect(snap['kit']).toMatchObject({
      outcome: 'playing',
      gold: 40,
      lives: 5,
      wave: 0,
      waves: 3,
      towers: 0,
    });
    expect(snap['controls']).toEqual({ col: 1, row: 2, tower: 'arrow', held: [0, 0, 0, 0] });
  });

  it('finds the seven run files', () => {
    expect(RUNS).toEqual(['build', 'leaked', 'shells', 'tapped', 'target', 'upgrade', 'won']);
  });

  it.each(RUNS)('plays %s to the same snapshots twice and passes its assertions', (name) => {
    const a = play(name);
    expect(a.map((s) => canonicalJson(s))).toEqual(play(name).map((s) => canonicalJson(s)));
    expect(failing(name, a)).toEqual([]);
  });

  it('wins with every wave held, and loses to a thin defence', () => {
    const won = play('won').at(-1)!;
    expect(won['kit']).toMatchObject({ outcome: 'won', lives: 5, leaked: 0, wave: 3, towers: 5 });
    const leaked = play('leaked').at(-1)!;
    expect(leaked['kit']).toMatchObject({ outcome: 'lost', lives: 0, leaked: 5, towers: 2 });
  });

  it('passes the rules switched off to the kit: each run fails without a rule it guards', () => {
    for (const name of RUNS)
      for (const rule of runFile(name).guards ?? []) {
        expect(TOWERDEFENSE_RULES.map((r) => r.id)).toContain(rule);
        expect(failing(name, play(name, [rule])), `${name} without ${rule}`).not.toEqual([]);
      }
  });

  it("plays the won run file exactly as the kit's bot plays its plan", () => {
    const plan: TdBotStep[] = [
      { do: 'place', tower: 'arrow', col: 5, row: 4 },
      { do: 'place', tower: 'arrow', col: 3, row: 2 },
      { do: 'wave' },
      { do: 'clear' },
      { do: 'place', tower: 'cannon', col: 11, row: 10 },
      { do: 'wave' },
      { do: 'clear' },
      { do: 'place', tower: 'arrow', col: 8, row: 10 },
      { do: 'place', tower: 'arrow', col: 13, row: 10 },
      { do: 'wave' },
      { do: 'clear' },
    ];
    const run = runFile('won');
    const game = createGame(content, SEED);
    const bot = new TdBot(plan);
    const input = new ScriptedInput({ steps: [] });
    const snaps = [canonicalJson(game.snapshot())];
    for (let t = 0; t < run.ticks; t++) {
      input.setHeld(bot.next(game));
      input.next();
      game.step(input);
      snaps.push(canonicalJson(game.snapshot()));
    }
    expect(snaps).toEqual(play('won').map((s) => canonicalJson(s)));
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

  it('has one song with channels of one length, and an sfx for every sound the skin names', () => {
    const songs = contentSongs(content);
    expect(songs.map((s) => s.id)).toEqual(['road']);
    const song = songs[0]!;
    expect(compileSong(song).length).toBeGreaterThan(0);
    const lengths = (['pulse1', 'pulse2', 'triangle', 'noise'] as const).map(
      (ch) => parseMml(song[ch]!, ch.startsWith('pulse') ? 'pulse' : (ch as 'triangle' | 'noise')).length,
    );
    expect(new Set(lengths).size).toBe(1);
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

  // Engine 0.16 E7: the three tower types (arrow, cannon and the frost tower E8's map adds) at
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
