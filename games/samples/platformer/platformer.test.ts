import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '@engine/core/headless';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { NullRenderer } from '@engine/backends/null';
import type { Renderer } from '@engine/core/gfx/renderer';
import type { SpriteSheet } from '@engine/core/gfx/spritesheet';
import { isFullMap, parseEventKey, resolveSkinEvent, type SkinFile } from '@engine/core/present';
import { SceneStack } from '@engine/core/scene';
import { contentSfx, mustLoad } from '@engine/core/content/game-content';
import { loadTest, testRooms, testStages } from './content';
import { testLook } from './picture';
import { testLook3d } from './picture3d';
import { HostScene } from '@engine/core/shell/host-scene';
import { createView } from './view';
import { testMiniGames } from './minigames';
import { ACTOR_ANIMS, LEVEL_PAUSE, PRESENT_TILES, RUNNER_ANIMS } from '@kits/platformer';
import { createGame, type TestSnapshot } from './headless';
import type { RoomChallenge } from '@kits/topdown';

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const FILES = readGameFiles(ROOT);
const content = mustLoad(loadTest(FILES));
const CAMPAIGN = 'content/campaigns/main.campaign.json';

/** Every `PlatformerEvent` type (`kits/platformer/world.ts`). */
const PLATFORMER_EVENTS = [
  'jump',
  'land',
  'bump',
  'block',
  'break',
  'coin',
  'spawn',
  'stomp',
  'kick',
  'defeat',
  'hurt',
  'died',
  'respawn',
  'cleared',
  'mini-game',
  'mini-game-end',
];

/** Snapshots of `ticks` steps holding right from seed 1, tick 0 included. */
function play(ticks: number): string[] {
  const game = createGame(content, 1);
  const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
  const out = [canonicalJson(game.snapshot())];
  for (let i = 0; i < ticks; i++) {
    input.next();
    game.step(input);
    out.push(canonicalJson(game.snapshot()));
  }
  return out;
}

describe('platformer test content', () => {
  it('loads every file with no errors', () => {
    const result = loadTest(FILES);
    expect(result.errors).toEqual([]);
    expect(Object.keys(FILES)).toContain('content/levels/level-1.map.txt');
  });

  it("plays its levels in its campaign file's order, each with its own profile", () => {
    const stages = testStages(content);
    expect(stages.map((s) => s.level.id)).toEqual(['level-1', 'level-2', 'level-3', 'level-4']);
    expect(stages.every((s) => s.profile.id === 'hopper')).toBe(true);
  });

  it('plays the levels in a new order when the campaign file changes (Engine 0.10, gap G2)', () => {
    const campaign = JSON.parse(FILES[CAMPAIGN]!) as { entries: object[] };
    const reordered = { ...campaign, entries: [...campaign.entries].reverse() };
    const files = { ...FILES, [CAMPAIGN]: JSON.stringify(reordered) };
    const order = ['level-4', 'level-3', 'level-2', 'level-1'];
    expect(testStages(mustLoad(loadTest(files))).map((s) => s.level.id)).toEqual(order);
    const game = createGame(mustLoad(loadTest(files)), 1);
    expect(game.snapshot().level).toBe('level-4');
  });

  it('names the file and field of a campaign entry naming a missing level', () => {
    const campaign = JSON.parse(FILES[CAMPAIGN]!) as { entries: object[] };
    const broken = { ...campaign, entries: [...campaign.entries, { level: 'level-9' }] };
    const result = loadTest({ ...FILES, [CAMPAIGN]: JSON.stringify(broken) });
    expect(result.errors.map((e) => [e.file, e.path, e.code])).toEqual([
      ['games/samples/platformer/content/campaigns/main.campaign.json', 'entries.4.level', 'missing_level'],
    ]);
  });

  it('orders level-10 after level-9 without a campaign file', () => {
    const extra = (id: string) => ({
      [`content/levels/${id}.json`]: FILES['content/levels/level-1.json']!.replace('"level-1"', `"${id}"`),
      [`content/levels/${id}.map.txt`]: FILES['content/levels/level-1.map.txt']!,
    });
    const { [CAMPAIGN]: _campaign, ...withoutCampaign } = FILES;
    const manifest = JSON.parse(FILES['game.json']!) as { content: Record<string, string[]> };
    delete manifest.content['campaign'];
    const files = { ...withoutCampaign, 'game.json': JSON.stringify(manifest) };
    const more = mustLoad(loadTest({ ...files, ...extra('level-10'), ...extra('level-9') }));
    expect(testStages(more).map((s) => s.level.id)).toEqual([
      'level-1',
      'level-2',
      'level-3',
      'level-4',
      'level-9',
      'level-10',
    ]);
  });

  it('reports a broken level field with the file and the field', () => {
    const header = JSON.parse(FILES['content/levels/level-1.json']!) as Record<string, unknown>;
    header['scroll'] = 'sideways';
    const result = loadTest({ ...FILES, 'content/levels/level-1.json': JSON.stringify(header) });
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => [e.file, e.path])).toContainEqual([
      'games/samples/platformer/content/levels/level-1.json',
      'scroll',
    ]);
  });
});

describe('platformer test headless game', () => {
  it("starts on level-1, stage 0, with the profile's lives and hit points", () => {
    const s = createGame(content, 1).snapshot() as TestSnapshot;
    expect(s).toMatchObject({ level: 'level-1', stage: 0, pause: 0, outcome: 'playing', lives: 3 });
    expect(s.player.hp).toBe(2);
  });

  it('gives equal snapshots on two runs from the same seed', () => {
    expect(play(300)).toEqual(play(300));
  });

  it("plays its first three levels start to goal, in order, with the level-3 run file's input", () => {
    const runFile = JSON.parse(readFileSync(new URL('./runs/level-3.run.json', import.meta.url), 'utf8')) as {
      ticks: number;
      input: InputScript;
    };
    const game = createGame(content, 1);
    const input = new ScriptedInput(runFile.input);
    const cleared: string[] = [];
    for (let t = 0; t < runFile.ticks; t++) {
      input.next();
      game.step(input);
      if (game.events.some((e) => e.type === 'cleared')) cleared.push(game.world.level.id);
    }
    expect(cleared).toEqual(['level-1', 'level-2', 'level-3']);
  });

  it('starts the failed level afresh after LEVEL_PAUSE ticks', () => {
    const game = createGame(content, 1);
    game.world.lives = 1;
    const input = new ScriptedInput({ steps: [{ frame: 0, hold: ['right'] }] });
    let ticks = 0;
    while (game.world.outcome === 'playing' && ticks++ < 1000) {
      input.next();
      game.step(input);
    }
    expect(game.world.outcome).toBe('failed');
    const failed = game.world;
    for (let i = 0; i < LEVEL_PAUSE; i++) {
      input.next();
      game.step(input);
    }
    expect(game.world).not.toBe(failed);
    expect(game.snapshot()).toMatchObject({ level: 'level-1', stage: 0, pause: 0, outcome: 'playing' });
  });

  it("plays the door level's round, failed and then passed, with the level-4 run file's input", () => {
    const runFile = JSON.parse(readFileSync(new URL('./runs/level-4.run.json', import.meta.url), 'utf8')) as {
      ticks: number;
      input: InputScript;
    };
    const game = createGame(content, 1);
    const input = new ScriptedInput(runFile.input);
    const results: string[] = [];
    const cleared: string[] = [];
    for (let t = 0; t < runFile.ticks; t++) {
      input.next();
      game.step(input);
      for (const e of game.events) if (e.type === 'mini-game-end') results.push(e.result);
      if (game.events.some((e) => e.type === 'cleared')) cleared.push(game.world.level.id);
    }
    expect(results).toEqual(['fail', 'pass']);
    expect(cleared).toEqual(['level-1', 'level-2', 'level-3', 'level-4']);
  });
});

describe("platformer test's mini games", () => {
  it('builds one room challenge per room file, named by the room id', () => {
    expect(testRooms(content).map((r) => r.id)).toEqual(['vault']);
    expect(testMiniGames(content).map((d) => [d.id, d.title])).toEqual([['vault', 'VAULT']]);
  });

  it("starts a vault round from the door's params, at the game's screen size", () => {
    const def = testMiniGames(content)[0]!;
    const round = def.create(
      { params: { goal: 'defeat-all', ticks: 600, hp: 4 }, attempt: 1 },
      5,
    ) as RoomChallenge;
    expect(round.snapshot()).toMatchObject({
      room: 'vault',
      enemies: 2,
      hero: { hp: 4 },
      round: { limit: 600 },
    });
    expect(round.present().size).toEqual({ width: 256, height: 240 });
  });

  it("switches a top-down rule off in the vault round only (gap G12: a run's `topdown:<id>`)", () => {
    const params = { params: { goal: 'defeat-all', ticks: 600, hp: 4 }, attempt: 1 };
    const plain = testMiniGames(content)[0]!.create(params, 5) as RoomChallenge;
    expect(plain.world.rules.disabled()).toEqual([]);
    const off = testMiniGames(content, ['walls-block-movement'])[0]!.create(params, 5) as RoomChallenge;
    expect(off.world.rules.disabled()).toEqual(['walls-block-movement']);
    // The game hands `disabledRulesByKit.topdown` to the rounds, never to the levels' worlds.
    const game = createGame(content, 1, { disabledRulesByKit: { topdown: ['walls-block-movement'] } });
    expect(game.world.rules.disabled()).toEqual([]);
  });
});

/** What the frames of every run file show, per frame source (`level`, or the mini game's id). */
interface Shown {
  states: Map<string, Set<string>>;
  tiles: Set<string>;
  events: Set<string>;
  status: Set<string>;
}

let shownCache: Map<string, Shown> | null = null;
function shownByRuns(): Map<string, Shown> {
  if (shownCache) return shownCache;
  const out = (shownCache = new Map<string, Shown>());
  const runs = readdirSync(new URL('./runs/', import.meta.url)).filter((f) => f.endsWith('.run.json'));
  expect(runs.length).toBeGreaterThanOrEqual(4);
  for (const name of runs) {
    const run = JSON.parse(readFileSync(new URL(`./runs/${name}`, import.meta.url), 'utf8')) as {
      ticks: number;
      input: InputScript;
    };
    const view = createView(content, 1);
    const input = new ScriptedInput(run.input);
    for (let t = 0; t <= run.ticks; t++) {
      if (t > 0) {
        input.next();
        view.step(input);
      }
      const frame = view.frame!();
      const source = String(frame.status['miniGame'] || 'level');
      let s = out.get(source);
      if (!s)
        out.set(source, (s = { states: new Map(), tiles: new Set(), events: new Set(), status: new Set() }));
      for (const e of frame.entities) {
        if (!s.states.has(e.kind)) s.states.set(e.kind, new Set());
        s.states.get(e.kind)!.add(e.anim.state);
      }
      if (frame.map && isFullMap(frame.map))
        for (const row of frame.map.tiles) for (const c of row) s.tiles.add(String(c));
      for (const e of frame.events) s.events.add(e.type);
      for (const key of Object.keys(frame.status)) s.status.add(key);
    }
  }
  return out;
}

describe('platformer test 2D skins', () => {
  const look = testLook(content);
  const shown = shownByRuns();
  const skinFor = (source: string): SkinFile => (source === 'level' ? look.skin : look.rounds[source]!);

  it('has a level skin and one round skin, for the vault', () => {
    expect(Object.keys(look.rounds)).toEqual(['vault']);
    expect([...shown.keys()].sort()).toEqual(['level', 'vault']);
  });

  it('the level skin maps every tile, kind, state and event the platformer kit presents', () => {
    const skin = look.skin;
    const states = (kind: string) => Object.keys(skin.kinds[kind]?.frames ?? {}).sort();
    expect(Object.keys(skin.tiles ?? {}).sort()).toEqual(Object.values(PRESENT_TILES).sort());
    expect(states('runner')).toEqual([...RUNNER_ANIMS].sort());
    for (const type of Object.keys(testStages(content)[0]!.profile.actors))
      expect(states(type), type).toEqual([...ACTOR_ANIMS].sort());
    // A field key (`mini-game-end:pass`, gap G28) is still its type's entry.
    const types = new Set(Object.keys(skin.events ?? {}).map((k) => parseEventKey(k)?.type));
    expect([...types].sort()).toEqual([...PLATFORMER_EVENTS].sort());
  });

  it.each(['level', 'vault'])(
    'the %s skin covers every kind, state, tile, event and HUD value its frames show in every run',
    (source) => {
      const skin = skinFor(source);
      const s = shown.get(source)!;
      const missing: string[] = [];
      for (const [kind, states] of s.states)
        for (const state of states)
          if (skin.kinds[kind]?.frames?.[state] === undefined) missing.push(`${kind} ${state}`);
      for (const t of s.tiles) if (skin.tiles?.[t] === undefined) missing.push(`tile ${t}`);
      for (const e of s.events) if (skin.events?.[e] === undefined) missing.push(`event ${e}`);
      for (const item of skin.hud ?? []) if (!s.status.has(item.status)) missing.push(`hud ${item.status}`);
      expect(missing).toEqual([]);
    },
  );

  it('the vault skin also covers what a round can show beyond the runs: the hero hurt and dying', () => {
    const states = Object.keys(look.rounds['vault']!.kinds['hero']?.frames ?? {}).sort();
    expect(states).toEqual(['attack', 'dying', 'hurt', 'poof', 'walk']);
    for (const e of ['hurt', 'dying', 'dead']) expect(look.rounds['vault']!.events).toHaveProperty(e);
  });

  it('names only sounds the game has (MML sfx files)', () => {
    const sfx = new Set(contentSfx(content).map((s) => s.id));
    for (const skin of [look.skin, ...Object.values(look.rounds)])
      for (const entry of Object.values(skin.events ?? {}))
        if (entry.sound !== undefined) expect(sfx, entry.sound).toContain(entry.sound);
    expect([...sfx].sort()).toEqual(['coin', 'door', 'fail', 'hurt', 'jump', 'pass', 'stomp', 'sword']);
  });

  it("gives the round's end a sound per result in both level skins, the door for a quit (G28)", () => {
    for (const skin of [look.skin, testLook3d(content).skin]) {
      const sound = (result: string) =>
        resolveSkinEvent(skin.events, { type: 'mini-game-end', result })?.sound;
      expect(['pass', 'fail', 'quit'].map(sound)).toEqual(['pass', 'fail', 'door']);
    }
  });

  it('keeps its assets as text: pixel art, palettes, skins and MML only', () => {
    const allowed =
      /^(game\.json|content\/[a-z]+\/[a-z0-9-]+(\.profile|\.campaign)?\.(json|txt)|content\/levels\/[a-z0-9-]+\.map\.txt|content\/rooms\/[a-z0-9-]+\.map\.txt)$/;
    expect(Object.keys(FILES).filter((f) => !allowed.test(f))).toEqual([]);
  });

  it('draws a level with the level sheet and font, and the round with the vault sheet', () => {
    const sheets = new Map<string, number>();
    const count = (sheet: SpriteSheet) => sheets.set(sheet.id, (sheets.get(sheet.id) ?? 0) + 1);
    const r: Renderer = Object.assign(new NullRenderer(), { sprite: count, text: count });
    const run = JSON.parse(readFileSync(new URL('./runs/level-4.run.json', import.meta.url), 'utf8')) as {
      input: InputScript;
    };
    const view = createView(content, 1);
    const input = new ScriptedInput(run.input);
    const vaultAt = new Map<number, number>();
    for (let t = 1; t <= 2400; t++) {
      input.next();
      view.step(input);
      if (t === 2200 || t === 2400) {
        view.render(r);
        vaultAt.set(t, sheets.get('vault') ?? 0);
      }
    }
    expect(sheets.get('hopper') ?? 0).toBeGreaterThan(10);
    expect(sheets.get('hopper-font') ?? 0).toBeGreaterThan(0);
    expect(vaultAt.get(2200)).toBe(0);
    expect(vaultAt.get(2400) ?? 0).toBeGreaterThan(100);
  });
});

describe('platformer test 3D skins', () => {
  const look = testLook(content);
  const look3d = testLook3d(content);
  const shown = shownByRuns();

  it('has a three skin for the levels and one for the vault round', () => {
    expect(look3d.skin.backend).toBe('three');
    expect(Object.keys(look3d.rounds)).toEqual(['vault']);
    expect(look3d.rounds['vault']!.backend).toBe('three');
  });

  it.each([
    ['level', () => look.skin, () => look3d.skin],
    ['vault', () => look.rounds['vault']!, () => look3d.rounds['vault']!],
  ])('the %s three skin has a mesh for every kind and tile its 2D skin maps', (source, flat, deep) => {
    const skin2d = flat();
    const skin3d = deep();
    const noMesh = Object.keys(skin2d.kinds).filter((k) => skin3d.kinds[k]?.mesh === undefined);
    // Open air on a level (`.`) is the sky behind the blocks: no block. A room's floor is one.
    const tiles = Object.keys(skin2d.tiles ?? {}).filter(
      (t) => source !== 'level' || t !== PRESENT_TILES.empty,
    );
    const noBlock = tiles.filter((t) => skin3d.tiles?.[t]?.mesh === undefined);
    expect([...noMesh, ...noBlock]).toEqual([]);
    expect(Object.keys(skin3d.events ?? {}).sort()).toEqual(Object.keys(skin2d.events ?? {}).sort());
    for (const [type, entry] of Object.entries(skin3d.events ?? {}))
      expect(entry.sound, type).toBe(skin2d.events?.[type]?.sound);
    // The same framing but for `clamp`: the 2D round keeps the room under its HUD band (`false`),
    // the 3D round, with no HUD (gap G33), centres it (`true`), each said in its skin (gap G29).
    const { clamp: clamp2d, ...camera2d } = skin2d.camera ?? {};
    const { clamp: clamp3d, ...camera3d } = skin3d.camera ?? {};
    expect(camera3d).toEqual(camera2d);
    expect([clamp2d, clamp3d]).toEqual(source === 'vault' ? [false, true] : [undefined, undefined]);
  });

  it.each(['level', 'vault'])(
    'the %s three skin has a mesh for every kind and tile its frames show',
    (source) => {
      const skin = source === 'level' ? look3d.skin : look3d.rounds[source]!;
      const s = shown.get(source)!;
      const missing = [...s.states.keys()].filter((k) => skin.kinds[k]?.mesh === undefined);
      for (const t of s.tiles)
        if (!(source === 'level' && t === PRESENT_TILES.empty) && skin.tiles?.[t]?.mesh === undefined)
          missing.push(`tile ${t}`);
      expect(missing).toEqual([]);
      expect(s.states.size).toBeGreaterThan(2);
    },
  );
});

describe('platformer test page scene', () => {
  it('pushes the vault round over the level and pops it on the result', () => {
    const stack = new SceneStack();
    const drawn: string[] = [];
    const scene = new HostScene({
      stack,
      game: createGame(content, content.manifest.start.seed),
      picture: () => ({ draw: (world) => drawn.push(world.level.id) }),
    });
    stack.push(scene);
    const run = JSON.parse(readFileSync(new URL('./runs/level-4.run.json', import.meta.url), 'utf8')) as {
      input: InputScript;
    };
    const input = new ScriptedInput(run.input);
    const depths = new Set<number>();
    for (let t = 1; t <= 2900; t++) {
      input.next();
      stack.update([input]);
      depths.add(stack.depth);
    }
    stack.render(new NullRenderer());
    expect([...depths].sort()).toEqual([1, 2]);
    expect(stack.depth).toBe(1);
    expect(drawn).toEqual(['level-4']);
  });
});
