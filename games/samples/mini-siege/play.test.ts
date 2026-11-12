import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NullPresenter } from '@engine/backends/null';
import { mustLoad } from '@engine/core/content/game-content';
import { canonicalJson } from '@engine/core/headless';
import type { InputFrame } from '@engine/core/input/input-manager';
import { ScriptedInput, type InputScript } from '@engine/core/input/scripted-input';
import { readGameFiles } from '@engine/core/node/game-files';
import { isFullMap, MINI_GAME_STATUS, skinSet, type PresentFrame } from '@engine/core/present';
import { SceneStack } from '@engine/core/scene';
import type { Renderer } from '@engine/core/gfx/renderer';
import { screenAtCell } from '@kits/towerdefense';
import { campaignOrder, entryId } from '@engine/core/campaign';
import { loadMiniSiege, siegeCampaign, siegeMissions, siegeTypes } from './content';
import { siegePicture } from './picture';
import { SiegePlay } from './play';

// The page's glue played headless (Engine 0.11 T9): `SiegePlay` and its `HostScene` on a real
// `SceneStack`, as `main.ts` boots them, driven through the launch button, then play (the recorded
// round of `played.run.json` fed as the page's keys) or delegate. Each path reaches a committed
// result, and with the launch at world tick 40, as in the run files, the same state hash at world
// tick 260 as the run file's last one: the page plays the game the tools play. Engine 0.12 T7:
// the same for the preparation phase, `fortify` launched at world tick 10 and played (the recorded
// round of `fortify-played.run.json`) or delegated. Engine 0.12 T8: pointer taps in the walls' round
// place and sell towers through the round's camera, and the round's frames go to its own skin.
// Engine 0.13 T8: the campaign. The siege ends at world tick 260 with its result and the save code
// the run files pin; Continue builds the dawn from it (the captain on the map, or held with the
// captive choices in the bar); a typed save code resumes the dawn with the same tick-0 hash as the
// run files, a refused code keeps its reason; the save is kept in browser storage.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const NONE: InputFrame = new ScriptedInput({ steps: [] });
const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);
const goldenHashes = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.hashes.json`, import.meta.url), 'utf8')) as {
      hashes: { tick: number; hash: string }[];
    }
  ).hashes;
const lastHash = (name: string) => goldenHashes(name).at(-1)!.hash;
const firstHash = (name: string) => goldenHashes(name)[0]!.hash;
/** The save code a run file pins at its last tick. */
const pinnedCode = (name: string) =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
      codes: { tick: number; code: string }[];
    }
  ).codes.at(-1)!.code;
const recordedRound = (name = 'played') =>
  (
    JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as {
      missions: { action: string; input?: InputScript }[];
    }
  ).missions.find((m) => m.action === 'play')!.input!;

/** A loop step's frame with one pointer tap at picture point (x, y) and nothing held. */
function tap(x: number, y: number, button?: 'primary' | 'secondary'): ScriptedInput {
  const input = new ScriptedInput({ steps: [], taps: [{ frame: 0, x, y, ...(button && { button }) }] });
  input.next();
  return input;
}

/** The page: the scene stack with `SiegePlay`'s scene, drawing every step into the null backend. */
function page(hold = false) {
  const play = new SiegePlay({
    content,
    seed: content.manifest.start.seed,
    pointer: null,
    stepsPerTick: 1,
    hold,
  });
  const stack = new SceneStack();
  const presenter = new NullPresenter({ validate: true, freeze: true });
  stack.push(play.scene(stack, () => siegePicture(presenter, content, play.ui)));
  const frames: PresentFrame[] = [];
  const step = (input: InputFrame = NONE) => {
    stack.update([input]);
    stack.render({} as Renderer);
    frames.push(presenter.last as PresentFrame);
  };
  return { play, stack, step, frames };
}

/** Steps the battle to world tick 40, where the launch button offers the sabotage. */
function toLaunch(p: ReturnType<typeof page>): void {
  expect(p.play.launch.launchButtons()).toEqual([]);
  while (p.play.tick < 40) p.step();
  expect(p.play.launch.launchButtons()).toEqual(['sabotage']);
  p.play.launch.press({ kind: 'launch', mission: 'sabotage' });
  p.step();
  expect(p.play.launch.choice()).toBe('sabotage');
  expect(p.play.launch.launchButtons()).toEqual([]);
  // Nothing steps while the choice is shown.
  p.step();
  expect(p.play.tick).toBe(40);
}

/** Steps the battle to world tick 10 and launches the fortify mission (the preparation phase). */
function toFortify(p: ReturnType<typeof page>): void {
  while (p.play.tick < 10) p.step();
  expect(p.play.launch.launchButtons()).toEqual(['fortify']);
  p.play.launch.press({ kind: 'launch', mission: 'fortify' });
  p.step();
  expect(p.play.launch.choice()).toBe('fortify');
  p.step();
  expect(p.play.tick).toBe(10);
}

/** Steps on until world tick 260. */
function toEnd(p: ReturnType<typeof page>): void {
  while (p.play.tick < 260) p.step();
}

describe('the page glue, headless', () => {
  it('delegates: the battle freezes, the world draws ram-burnt at the commit tick', () => {
    const p = page();
    toLaunch(p);
    p.play.launch.press({ kind: 'delegate' });
    p.step();
    expect(p.play.launch.choice()).toBeNull();
    expect(p.play.game.miniGame()).toBeNull();
    while (p.play.launch.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.launch.records()[0]).toMatchObject({
      outcome: 'ram-burnt',
      resolution: 'delegated',
      commitTick: 160,
    });
    expect(p.frames.some((f) => f.events.some((e) => e.type === 'mission-open'))).toBe(true);
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'sabotage', outcome: 'ram-burnt', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('delegated'));
  });

  it('plays: the round is pushed over the battle, then both engines burn at the commit tick', () => {
    const p = page();
    toLaunch(p);
    const keys = new ScriptedInput(recordedRound());
    // Engine 0.14 T9 (gap M19): the round is recorded as the page plays it (`?record` on the page).
    p.play.game.recordRounds(true);
    p.play.launch.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('mission-room');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Burn the siege engines');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(406);
    expect(p.play.tick).toBe(40);
    // The recorder gives back the run file's committed input, at the run file's play tick.
    expect(p.play.game.roundRecordings()).toEqual([
      { mission: 'sabotage', tick: 40, ticks: 406, done: true, input: recordedRound() },
    ]);
    // The round's scene popped itself on the tick it ended: that frame is the battle's again.
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('');
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      mission: 'sabotage',
      game: 'mission-room',
      result: 'pass',
    });
    while (p.play.launch.records().length === 0) p.step();
    expect(p.play.tick).toBe(160);
    expect(p.play.launch.records()[0]).toMatchObject({
      outcome: 'both-burnt',
      resolution: 'played',
      commitTick: 160,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('played'));
  });

  it('refuses a launch once the window has closed, and keeps the reason', () => {
    const p = page();
    while (p.play.tick < 200) p.step();
    expect(p.play.launch.launchButtons()).toEqual([]);
    p.play.launch.press({ kind: 'launch', mission: 'sabotage' });
    p.step();
    expect(p.play.launch.choice()).toBeNull();
    expect(p.play.launch.message).toMatch(/^not_offered: /);
  });

  it('delegates the preparation phase: overrun lands at the commit tick, 30 after the launch', () => {
    const p = page();
    toFortify(p);
    p.play.launch.press({ kind: 'delegate' });
    p.step();
    while (p.play.launch.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.launch.records()[0]).toMatchObject({
      mission: 'fortify',
      outcome: 'overrun',
      commitTick: 40,
    });
    expect(p.frames.at(-1)!.events).toEqual([
      { type: 'mission-commit', mission: 'fortify', outcome: 'overrun', resolution: 'delegated' },
    ]);
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-delegated'));
  });

  it('plays the preparation phase: the walls round is pushed, then held-cheap lands at the commit', () => {
    const p = page();
    toFortify(p);
    const keys = new ScriptedInput(recordedRound('fortify-played'));
    p.play.game.recordRounds(true);
    p.play.launch.press({ kind: 'play' });
    let roundTicks = 0;
    do {
      keys.next();
      p.step(keys);
      roundTicks++;
      if (roundTicks === 1) {
        expect(p.stack.depth).toBe(2);
        expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('td-defence');
        expect(p.frames.at(-1)!.status['host:mission']).toBe('Man the walls');
      }
    } while (p.play.game.miniGame() !== null);
    expect(roundTicks).toBe(116);
    expect(p.play.tick).toBe(10);
    expect(p.play.game.roundRecordings()).toEqual([
      { mission: 'fortify', tick: 10, ticks: 116, done: true, input: recordedRound('fortify-played') },
    ]);
    expect(p.stack.depth).toBe(1);
    expect(p.frames.at(-1)!.events).toContainEqual({
      type: 'mini-game-end',
      mission: 'fortify',
      game: 'td-defence',
      result: 'pass',
    });
    while (p.play.launch.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.launch.records()[0]).toMatchObject({
      outcome: 'held-cheap',
      resolution: 'played',
      commitTick: 40,
    });
    toEnd(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('fortify-played'));
  });

  it('places and sells towers in the walls round by pointer taps (frame input), then quits to overrun', () => {
    const p = page();
    toFortify(p);
    p.play.launch.press({ kind: 'play' });
    p.step();
    const kit = () => p.play.game.miniGame()!.snapshot()['kit'] as Record<string, unknown>;
    const cursor = () => p.play.game.miniGame()!.snapshot()['controls'] as Record<string, unknown>;
    expect(kit()).toMatchObject({ gold: 100, towers: 0 });
    // The 16x7 map is centred on the 320x180 picture (Engine 0.16 F6): its top-left at picture
    // (32, 34). The north tower's cell (11, 1) has its centre at picture (216, 58), the kit's
    // `screenAtCell`.
    expect(
      screenAtCell({ col: 11, row: 1 }, { size: content.manifest.screen }, { cols: 16, rows: 7 }),
    ).toEqual({
      x: 216,
      y: 58,
    });
    p.step(tap(216, 58));
    expect(cursor()).toMatchObject({ col: 11, row: 1 });
    expect(kit()['towers']).toBe(0);
    p.step(tap(216, 58));
    expect(kit()).toMatchObject({ gold: 80, towers: 1 });
    const tower = p.frames.at(-1)!.entities.find((e) => e.kind === 'tower:archers');
    expect(tower).toMatchObject({ x: 176, y: 16 });
    expect(p.frames.at(-1)!.status[MINI_GAME_STATUS]).toBe('td-defence');
    // A tap off the map does nothing; a secondary tap sells (half the cost back).
    p.step(tap(10, 10));
    expect(kit()['towers']).toBe(1);
    p.step(tap(216, 58, 'secondary'));
    expect(kit()).toMatchObject({ gold: 90, towers: 0 });
    // Select gives up: the mission's onQuit outcome lands at the commit tick.
    const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
    quit.next();
    p.step(quit);
    expect(p.play.game.miniGame()).toBeNull();
    while (p.play.launch.records().length === 0) p.step();
    expect(p.play.tick).toBe(40);
    expect(p.play.launch.records()[0]).toMatchObject({
      mission: 'fortify',
      outcome: 'overrun',
      resolution: 'quit',
    });
  });

  it('records the taps of a walls round played by tapping (gap D1)', () => {
    const p = page();
    p.play.game.recordRounds(true);
    toFortify(p);
    p.play.launch.press({ kind: 'play' });
    p.step();
    p.step(tap(184, 88));
    p.step(tap(184, 88, 'secondary'));
    const recorded = p.play.game.roundRecordings()[0]!;
    expect(recorded.input.taps).toEqual([
      { frame: 1, x: 184, y: 88 },
      { frame: 2, x: 184, y: 88, button: 'secondary' },
    ]);
  });

  it('ignores taps in the battle (the kit reads gestures there, not frame taps)', () => {
    const p = page();
    p.step(tap(184, 88));
    expect(p.play.tick).toBe(1);
    expect(p.play.game.miniGame()).toBeNull();
  });

  it('draws the walls round with its own skin: every kind, tile and sound the round shows', () => {
    const p = page();
    toFortify(p);
    const keys = new ScriptedInput(recordedRound('fortify-played'));
    p.play.launch.press({ kind: 'play' });
    do {
      keys.next();
      p.step(keys);
    } while (p.play.game.miniGame() !== null);
    const { main, rounds } = skinSet(content, 'canvas2d');
    const skin = rounds['td-defence']!;
    expect(skin).toBeDefined();
    const round = p.frames.filter((f) => f.status[MINI_GAME_STATUS] === 'td-defence');
    // 116 round ticks: the last one ends the round, and its frame is the battle's again.
    expect(round.length).toBe(115);
    const kinds = new Set(round.flatMap((f) => f.entities.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual([
      'cursor',
      'enemy:raider',
      'ghost:archers',
      'shot:archers',
      'tower:archers',
    ]);
    for (const k of kinds) expect(skin.kinds[k], k).toBeDefined();
    const tiles = new Set(round.flatMap((f) => (f.map && isFullMap(f.map) ? f.map.tiles.join('') : '')));
    expect(tiles.size).toBeGreaterThan(0);
    for (const t of [...tiles].join('')) expect(skin.tiles?.[t], `tile ${t}`).toBeDefined();
    const events = new Set(round.flatMap((f) => f.events.map((e) => e.type)));
    for (const e of ['td-place', 'td-wave-start', 'td-shot', 'td-kill']) expect(events.has(e), e).toBe(true);
    // The battle's skin sounds every fortify outcome's commit.
    const fortify = siegeMissions(content).find((m) => m.id === 'fortify')!;
    for (const o of fortify.outcomes)
      expect(main!.events?.[`mission-commit:outcome=${o.id}`], o.id).toBeDefined();
  });

  it('gives every unit type and building kind a 2D look drawn from the sheet (Engine 0.16 polish Q, Q10)', () => {
    // The walls and wall towers had none, so the 2D page drew them as magenta fallback boxes.
    const main = skinSet(content, 'canvas2d').main!;
    const art = readFileSync(new URL('./content/sprites/siege.txt', import.meta.url), 'utf8');
    const frames = new Set([...art.matchAll(/^frame (\S+)$/gm)].map((m) => m[1]));
    const types = siegeTypes(content);
    const kinds = [
      ...Object.keys(types.units).map((t) => `unit:${t}`),
      ...Object.keys(types.buildings).map((b) => `building:${b}`),
    ];
    for (const kind of kinds) {
      const idle = (main.kinds[kind] as { frames?: { idle?: unknown } } | undefined)?.frames?.idle;
      expect(idle, kind).toBeDefined();
      const named = [...JSON.stringify(idle).matchAll(/"([a-z][a-z0-9-]*-\d|[a-z][a-z-]*)"/g)]
        .map((m) => m[1]!)
        .filter((f) => !['down', 'up', 'right', 'left'].includes(f));
      expect(named.length, kind).toBeGreaterThan(0);
      for (const f of named) expect(frames.has(f), `${kind}: ${f}`).toBe(true);
    }
  });

  it('draws both rounds in 2D on the 3D page with the round packs and their feel (Engine 0.16 F8)', () => {
    const three = skinSet(content, 'three');
    const flat = skinSet(content, 'canvas2d');
    // The 3D page's layer draws the rounds through the 2D skins; no 3D round skin is left.
    expect(three.main!.rounds2d).toEqual(['mission-room', 'td-defence']);
    expect(Object.keys(three.rounds)).toEqual([]);
    expect(content.manifest.transitions?.mission).toMatchObject({ kind: 'iris' });
    const room = flat.rounds['mission-room']!;
    const walls = flat.rounds['td-defence']!;
    expect(room.images?.['dungeon']?.image).toBe('assets/dungeon-tileset-ii/tileset.png');
    expect(Object.values(walls.images ?? {}).map((i) => i.image)).toEqual([
      'assets/kenney-tower-defense/tilesheet-16.png',
      'assets/kenney-tower-defense/tilesheet-24.png',
      'assets/kenney-tower-defense/tilesheet-32.png',
    ]);
    // The rooms: hit flashes, hit-pause, shake and particles on the kit's hits, kills and hurts.
    expect(room.kinds['knight']!.hitFlash).toMatchObject({ tag: 'flashing' });
    expect(room.kinds['hero']!.hitFlash).toMatchObject({ tag: 'flashing' });
    for (const e of ['hit', 'kill', 'hurt']) {
      expect(room.events?.[e]?.hitPause, e).toBeDefined();
      expect(room.events?.[e]?.shake, e).toBeDefined();
    }
    expect(room.events?.['sword']?.emit).toBeDefined();
    // The walls: range while placing, towers turned to their target, health bars, impacts.
    expect(walls.kinds['ghost:archers']!.ring?.radius).toBe(40);
    expect(walls.kinds['ghost:ballista']!.ring?.radius).toBe(56);
    expect(walls.kinds['tower:archers']!.turnToFacing).toBe('up');
    expect(walls.labels?.['enemy:raider']).toMatchObject({ as: 'bar', from: { tag: 'hp:' } });
    for (const e of ['td-shot', 'td-kill']) expect(walls.events?.[e]?.emit, e).toBeDefined();
  });
});

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

/** Plays the sabotage at 40 and gives up at once: `driven-off`, the captain captured. */
function quitSiege(p: ReturnType<typeof page>): void {
  toLaunch(p);
  p.play.launch.press({ kind: 'play' });
  const quit = new ScriptedInput({ steps: [{ frame: 0, hold: ['select'] }] });
  quit.next();
  p.step(quit);
  expect(p.play.game.miniGame()).toBeNull();
  toEnd(p);
}

/** Steps the dawn to world tick `tick`, launches `mission` there and delegates (decides) it. */
function decide(p: ReturnType<typeof page>, mission: string, tick = 5): void {
  while (p.play.tick < tick) p.step();
  p.play.launch.press({ kind: 'launch', mission });
  p.step();
  expect(p.play.launch.choice()).toBe(mission);
  p.play.launch.press({ kind: 'delegate' });
  p.step();
  expect(p.play.launch.choice()).toBeNull();
}

describe('the campaign on the page (Engine 0.13 T8)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('ends the siege at 260 with its save code, then continues to the dawn with the captain on the map', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const p = page();
    expect(p.play.scenario).toBe('village');
    expect(p.play.launch.entryTitle()).toBe('The siege');
    toLaunch(p);
    p.play.launch.press({ kind: 'delegate' });
    toEnd(p);
    const end = p.play.launch.ended()!;
    expect(p.play.tick).toBe(260);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('delegated'));
    expect(end).toMatchObject({
      entry: 'village',
      title: 'The siege',
      code: pinnedCode('delegated'),
      stored: true,
      done: false,
      next: 'The dawn assault',
      verdict: 'the hall still stands',
    });
    expect(end.outcomes).toEqual([p.play.launch.outcomeTitle('sabotage', 'ram-burnt')]);
    expect(end.people).toEqual(['Captain Hale: active, 110/120 hp']);
    // Nothing steps once the entry has ended, and nothing is offered.
    p.step();
    expect(p.play.tick).toBe(260);
    expect(p.play.launch.launchButtons()).toEqual([]);
    // The save is in storage: a later visit offers to carry on.
    expect(new SiegePlay({ content, seed: 11, pointer: null }).launch.storedSave()).toEqual(end.save);

    p.play.launch.press({ kind: 'continue' });
    p.step();
    expect(p.play.scenario).toBe('dawn');
    expect(p.play.launch.ended()).toBeNull();
    expect(p.play.game.named()['captain']).toMatchObject({ alive: true, hp: 110, x: 12, y: 15 });
    expect(p.play.launch.launchButtons()).toEqual([]);
    expect(p.frames.at(-1)!.status['captives']).toBe(0);
    // The sergeant (role `hero`) is drawn with her own frames: the skin's look for the tag `hero`.
    p.step();
    const sergeant = p.frames
      .at(-1)!
      .entities.find((e) => e.kind === 'unit:soldier' && e.tags.includes('hero'));
    expect(sergeant).toBeDefined();
    const soldier = skinSet(content, 'canvas2d').main!.kinds['unit:soldier'] as { byTag?: { tag: string }[] };
    expect(soldier.byTag?.[0]?.tag).toBe('hero');
    while (p.play.launch.ended() === null) p.step();
    expect(p.play.tick).toBe(200);
    // Every entry after the dawn (Engine 0.14 T12: a scenario added with data files only, gap M37)
    // is played to its end the same way, read from the campaign file, never named here.
    const order = campaignOrder(siegeCampaign(content));
    const afterDawn = order.slice(order.findIndex((e) => entryId(e) === 'dawn') + 1);
    expect(p.play.launch.ended()).toMatchObject({
      entry: 'dawn',
      done: afterDawn.length === 0,
      next: afterDawn[0]?.title ?? null,
    });
    for (const [i, entry] of afterDawn.entries()) {
      p.play.launch.press({ kind: 'continue' });
      p.step();
      expect(p.play.scenario).toBe(entryId(entry));
      while (p.play.launch.ended() === null) p.step();
      expect(p.play.launch.ended()).toMatchObject({
        entry: entryId(entry),
        done: i === afterDawn.length - 1,
        next: afterDawn[i + 1]?.title ?? null,
      });
    }
    // The campaign is over: a later visit has nothing to carry on, and Continue starts over.
    expect(new SiegePlay({ content, seed: 11, pointer: null }).launch.storedSave()).toBeNull();
    p.play.launch.press({ kind: 'continue' });
    p.step();
    expect(p.play.scenario).toBe('village');
  });

  it('carries a captured captain into the dawn: the captive choices, Decide, the same world as the runs', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const p = page();
    quitSiege(p);
    const end = p.play.launch.ended()!;
    expect(hash(p.play.game.snapshot())).toBe(lastHash('quit'));
    expect(end.code).toBe(pinnedCode('quit'));
    expect(end.people).toEqual(['Captain Hale: captured, 90/120 hp']);
    expect(end.outcomes).toEqual([p.play.launch.outcomeTitle('sabotage', 'driven-off')]);
    p.play.launch.press({ kind: 'continue' });
    p.step();
    expect(p.play.scenario).toBe('dawn');
    expect(p.play.tick).toBe(0);
    expect(hash(p.play.game.snapshot())).toBe(firstHash('dawn-captured'));
    expect(p.play.launch.launchButtons().sort()).toEqual([
      'exchange-captain',
      'leave-captain',
      'rescue-captain',
    ]);
    // The captive marker: the HUD names the captain while the raiders hold him.
    expect(p.frames.at(-1)!.status).toMatchObject({ captives: 1, captive: 'Captain Hale' });
    expect(p.play.launch.canPlay('rescue-captain')).toBe(true);
    expect(p.play.launch.canPlay('exchange-captain')).toBe(false);
    decide(p, 'exchange-captain');
    while (p.play.launch.ended() === null) p.step();
    expect(hash(p.play.game.snapshot())).toBe(lastHash('dawn-exchange'));
    expect(p.play.launch.ended()!.outcomes).toEqual([p.play.launch.outcomeTitle('exchange-captain', 'paid')]);
    // Freed at 15 for 80 gold, he falls defending the village (as in the run): a dead record.
    expect(p.play.game.named()['captain']).toMatchObject({ alive: false, fate: 'dead' });
    expect(p.play.launch.ended()!.people[0]).toBe('Captain Hale: dead');
    const main = skinSet(content, 'canvas2d').main!;
    for (const id of ['freed', 'paid', 'failed', 'left'])
      expect(main.events?.[`mission-commit:outcome=${id}`], id).toBeDefined();
  });

  it('resumes from a save code, and refuses a bad one with its reason', () => {
    const p = page();
    p.step();
    p.play.launch.press({ kind: 'code', text: 'NOT-A-USABLE-CODE' });
    p.step();
    expect(p.play.launch.message).toMatch(/^code_typo: /);
    expect(p.play.scenario).toBe('village');
    const code = pinnedCode('quit');
    const typo = code.slice(0, 8) + (code[8] === '0' ? '1' : '0') + code.slice(9);
    p.play.launch.press({ kind: 'code', text: typo });
    p.step();
    expect(p.play.launch.message).toMatch(/^code_typo: /);
    p.play.launch.press({ kind: 'code', text: pinnedCode('quit').toLowerCase() });
    p.step();
    expect(p.play.launch.message).toBe('');
    expect(p.play.scenario).toBe('dawn');
    expect(hash(p.play.game.snapshot())).toBe(firstHash('dawn-captured'));
    decide(p, 'leave-captain');
    while (p.play.launch.ended() === null) p.step();
    expect(hash(p.play.game.snapshot())).toBe(lastHash('dawn-leave'));
  });

  it('carries on from the save this browser stored', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const first = page();
    quitSiege(first);
    const later = page();
    expect(later.play.launch.storedSave()).toEqual(first.play.launch.ended()!.save);
    later.play.launch.press({ kind: 'stored' });
    later.step();
    expect(later.play.scenario).toBe('dawn');
    expect(hash(later.play.game.snapshot())).toBe(firstHash('dawn-captured'));
  });

  it('ends the campaign once the hall has fallen (its data, gap M31), and starts over on Continue', () => {
    const p = page();
    toFortify(p);
    p.play.launch.press({ kind: 'delegate' });
    toEnd(p);
    expect(p.play.launch.ended()).toMatchObject({
      save: { position: 1, carried: null, ended: { entry: 0, reason: { gone: 'hall' } } },
      done: true,
      next: null,
      verdict: 'the hall has fallen',
    });
    expect(p.play.launch.ended()!.code).not.toBeNull();
    p.play.launch.press({ kind: 'continue' });
    p.step();
    expect(p.play.scenario).toBe('village');
    expect(p.play.tick).toBe(0);
  });
});

describe('every campaign entry held at tick 0 until begun (Engine 0.15 T10, gap M34)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds the siege and the dawn at tick 0 with their briefings, and plays the same world once begun', () => {
    vi.stubGlobal('localStorage', memoryStorage());
    const p = page(true);
    const entries = campaignOrder(siegeCampaign(content));
    for (let i = 0; i < 30; i++) p.step();
    expect(p.play.tick).toBe(0);
    expect(p.play.launch.held()).toBe(true);
    expect(p.play.launch.briefing()).toEqual({ title: 'The siege', text: entries[0]!.text });
    expect(p.play.launch.status()).toContain('press Begin');
    // Nothing is offered or launched while held.
    expect(p.play.launch.launchButtons()).toEqual([]);
    p.play.launch.press({ kind: 'begin' });
    p.step();
    expect(p.play.launch.held()).toBe(false);
    expect(p.play.launch.briefing()).toBeNull();
    expect(p.play.tick).toBe(1);
    // The quit siege: Continue builds the dawn, held at its tick 0 with the captive choices waiting.
    quitSiege(p);
    expect(hash(p.play.game.snapshot())).toBe(lastHash('quit'));
    p.play.launch.press({ kind: 'continue' });
    for (let i = 0; i < 30; i++) p.step();
    expect(p.play.scenario).toBe('dawn');
    expect(p.play.tick).toBe(0);
    expect(p.play.launch.held()).toBe(true);
    expect(p.play.launch.briefing()?.title).toBe('The dawn assault');
    expect(p.play.launch.launchButtons()).toEqual([]);
    expect(hash(p.play.game.snapshot())).toBe(firstHash('dawn-captured'));
    p.play.launch.press({ kind: 'begin' });
    p.step();
    expect(p.play.launch.launchButtons().sort()).toEqual([
      'exchange-captain',
      'leave-captain',
      'rescue-captain',
    ]);
    // A code typed in resumes held too.
    p.play.launch.press({ kind: 'code', text: pinnedCode('quit') });
    p.step();
    expect(p.play.tick).toBe(0);
    expect(p.play.launch.held()).toBe(true);
  });

  it("shows the round's key hint from the mini game's controls, with the player's key names (lesson D14)", () => {
    const p = page();
    toLaunch(p);
    p.play.launch.press({ kind: 'play' });
    p.step();
    expect(
      p.play.launch.status({ left: '←', right: '→', up: '↑', down: '↓', attack: 'X', select: 'BACKSPACE' }),
    ).toBe('←→↑↓: move, X: strike, BACKSPACE: give up');
  });
});
