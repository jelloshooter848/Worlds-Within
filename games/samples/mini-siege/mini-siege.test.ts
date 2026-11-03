import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mustLoad } from '@engine/core/content/game-content';
import { readGameFiles } from '@engine/core/node/game-files';
import { canonicalJson, type JsonObject } from '@engine/core/headless';
import { ScriptedInput } from '@engine/core/input/scripted-input';
import { miniGameParamErrors, missionMiniGameUses } from '@engine/core/minigame-params';
import { missionPort, missionsOf } from '@engine/sim/index';
import {
  loadMiniSiege,
  siegeDefenceMaps,
  siegeEnemy,
  siegeMissions,
  siegeRooms,
  siegeScenario,
  siegeTowers,
  siegeTypes,
} from './content';
import { createGame, miniGames, type MiniSiegeGame, type NamedSummary } from './headless';

// The mini siege headless (Engine 0.11 T8): the content, the launch through the kit, and the two
// paths of decision 12 checked across a whole run (the run files check them at chosen ticks).
// Engine 0.12 T7 adds the preparation phase: the walls, the `fortify` mission played as a
// tower-defense round on them (`td-defence`), and its played and delegated runs.

const ROOT = fileURLToPath(new URL('./', import.meta.url));
const content = mustLoad(loadMiniSiege(readGameFiles(ROOT)));
const NO_INPUT = new ScriptedInput({ steps: [] });
const SEED = 11;
const OPEN = 40;
const COMMIT = 160;
/** The fortify mission's open and commit ticks (`fortify-*.run.json`: opened at 10, cost 30). */
const FORTIFY_OPEN = 10;
const FORTIFY_COMMIT = 40;
const WALLS = ['north-wall', 'north-tower', 'south-wall', 'south-tower'];

const hash = (v: unknown) => createHash('sha256').update(canonicalJson(v)).digest('hex').slice(0, 16);

interface RunFile {
  seed: number;
  ticks: number;
  missions: (JsonObject & { tick: number })[];
}
const runFile = (name: string) =>
  JSON.parse(readFileSync(new URL(`./runs/${name}.run.json`, import.meta.url), 'utf8')) as RunFile;

/** Plays a run file's mission steps as `pnpm cli run` does; `each` sees the game after each tick's steps. */
function play(name: string, each?: (game: MiniSiegeGame) => void): MiniSiegeGame {
  const run = runFile(name);
  const game = createGame(content, run.seed);
  for (let t = 0; t < run.ticks; t++) {
    for (const { tick, ...step } of run.missions)
      if (tick === t) expect(game.mission(step as JsonObject)).toBeNull();
    each?.(game);
    game.step(NO_INPUT);
  }
  return game;
}

/** The battle's units (every keyed unit's place and hp), by world tick, up to `until` (the commit). */
function battleByWorldTick(name: string, until = COMMIT): Map<number, Record<string, NamedSummary>> {
  const out = new Map<number, Record<string, NamedSummary>>();
  play(name, (game) => {
    if (game.miniGame() !== null || game.world.tick > until) return;
    out.set(game.world.tick, game.named());
  });
  return out;
}

describe('the mini siege content', () => {
  it("has one map, one types table, one plan, the two missions, the room and the walls' map", () => {
    expect(Object.keys(siegeTypes(content).units).sort()).toEqual([
      'captain',
      'catapult',
      'raider',
      'ram',
      'soldier',
      'worker',
    ]);
    expect(siegeEnemy(content).faction).toBe('raiders');
    expect(Object.keys(siegeTypes(content).buildings).sort()).toEqual([
      'hall',
      'wall',
      'wall-tower',
      'watchtower',
    ]);
    expect(siegeMissions(content).map((m) => [m.id, m.play, m.worldTimeCost])).toEqual([
      ['fortify', 'td-defence', 30],
      ['sabotage', 'mission-room', 120],
    ]);
    expect(siegeRooms(content).map((r) => r.id)).toEqual(['engine-camp']);
    expect(siegeDefenceMaps(content).map((m) => [m.id, m.towers])).toEqual([
      ['walls', ['archers', 'ballista']],
    ]);
    expect(Object.keys(siegeTowers(content))).toEqual(['archers', 'ballista']);
  });

  it("stands four walls off the raiders' road, each with its type's hp", () => {
    const types = siegeTypes(content);
    const scenario = siegeScenario(content, SEED);
    const walls = scenario.entities.filter((e) => WALLS.includes(e.key ?? ''));
    expect(walls.map((w) => w.key)).toEqual(WALLS);
    for (const w of walls) {
      const building = w.components['Building'] as { kind: string };
      const hp = types.buildings[building.kind]!.health;
      expect(w.components['Health']).toEqual({ hp, max: hp });
      // North of row 13 or south of row 15 by more than the road: never the nearest building.
      const y = (w.components['Position'] as { y: number }).y;
      expect(y < 10 || y > 20).toBe(true);
    }
  });

  it('starts every unit with the numbers of its type', () => {
    const types = siegeTypes(content);
    const scenario = siegeScenario(content, SEED);
    const all = [
      ...scenario.entities.map((e) => e.components),
      ...scenario.squads.flatMap((s) =>
        ((s['members'] ?? []) as { components: JsonObject }[]).map((m) => m.components),
      ),
    ] as Record<string, Record<string, unknown>>[];
    let units = 0;
    for (const c of all) {
      const unit = c['Unit'] as { type: string } | undefined;
      if (!unit) continue;
      const t = types.units[unit.type]!;
      expect(unit).toMatchObject({ speed: t.speed, attack: t.attack, range: t.range, cooldown: t.cooldown });
      expect(c['Health']).toEqual({ hp: t.health, max: t.health });
      units++;
    }
    expect(units).toBe(16);
  });

  it("checks the mission's params against the room and its outcomes (validate)", () => {
    const defs = miniGames(content);
    expect(miniGameParamErrors(missionMiniGameUses(content), defs)).toEqual([]);
    const entry = content.entries.find((e) => e.kind === 'mission' && e.name === 'sabotage')!;
    const mission = entry.value as JsonObject & { params: JsonObject };
    const broken = {
      ...mission,
      params: {
        ...mission.params,
        room: 'nowhere',
        outcomes: [{ outcome: 'all-burnt', when: { minDestroyed: 2 } }, { outcome: 'driven-off' }],
      },
    };
    const errors = miniGameParamErrors(
      missionMiniGameUses({ ...content, entries: [{ ...entry, value: broken }] }),
      defs,
    );
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ['bad_mini_game_use', 'params.room'],
      ['bad_mini_game_use', 'params.outcomes.0.outcome'],
    ]);
  });

  it("checks the fortify mission's params against the walls' map and its outcomes (validate)", () => {
    const defs = miniGames(content);
    const entry = content.entries.find((e) => e.kind === 'mission' && e.name === 'fortify')!;
    const mission = entry.value as JsonObject & { params: JsonObject };
    const broken = {
      ...mission,
      params: {
        ...mission.params,
        map: 'nowhere',
        outcomes: [{ outcome: 'all-held', when: { leaksAtMost: 0 } }, { outcome: 'overrun' }],
      },
    };
    const errors = miniGameParamErrors(
      missionMiniGameUses({ ...content, entries: [{ ...entry, value: broken }] }),
      defs,
    );
    expect(errors.map((e) => [e.code, e.path])).toEqual([
      ['bad_mini_game_use', 'params.map'],
      ['bad_mini_game_use', 'params.outcomes.0.outcome'],
    ]);
  });
});

describe('launching the mission', () => {
  it('is refused by the kit until the opportunity is offered, and by the sim once it is open', () => {
    const game = createGame(content, SEED);
    expect(game.mission({ mission: 'sabotage', action: 'open' })).toMatchObject({ code: 'not_offered' });
    while (game.world.tick < 20) game.step(NO_INPUT);
    expect(game.rts.view().missions.offered.map((o) => o.mission)).toEqual(['fortify', 'sabotage']);
    expect(game.mission({ mission: 'sabotage', action: 'open' })).toBeNull();
    expect(game.rts.view().missions.frozen).toEqual(['siege']);
    expect(game.mission({ mission: 'sabotage', action: 'open' })).toMatchObject({ code: 'not_offered' });
    expect(game.mission({ mission: 'sabotage', action: 'delegate' })).toBeNull();
    expect(game.mission({ mission: 'sabotage', action: 'play' })).toMatchObject({ code: 'mission_resolved' });
  });

  it('refuses orders while the round is played', () => {
    const game = createGame(content, SEED);
    while (game.world.tick < OPEN) game.step(NO_INPUT);
    game.mission({ mission: 'sabotage', action: 'open' });
    game.mission({ mission: 'sabotage', action: 'play' });
    expect(game.miniGame()).not.toBeNull();
    expect(game.order({ id: 1, faction: 'village', type: 'stop', units: [10] })).toMatch(/^round_hosted/);
  });
});

describe('the two paths (decision 12)', () => {
  it('holds the battle frozen from the open tick to the commit, the same in every path', () => {
    const paths = ['played', 'delegated', 'quit'].map((n) => battleByWorldTick(n));
    for (const battle of paths) {
      const atOpen = battle.get(OPEN + 1)!;
      for (let w = OPEN + 1; w < COMMIT; w++) {
        const now = battle.get(w)!;
        for (const key of [
          'ram',
          'catapult',
          'captain',
          'guard-1',
          'raider-1',
          'raider-4',
          'soldier-1',
          'soldier-4',
        ])
          expect(now[key], `${key} at world tick ${w}`).toEqual(atOpen[key]);
      }
    }
    // Before the commit the three paths' battles are the same at every world tick.
    for (let w = 0; w < COMMIT; w++) {
      expect(paths[1]!.get(w)).toEqual(paths[0]!.get(w));
      expect(paths[2]!.get(w)).toEqual(paths[0]!.get(w));
    }
  });

  it('commits at the open tick plus the cost however long the round took', () => {
    const played = play('played');
    const quit = play('quit');
    const delegated = play('delegated');
    expect(played.missionExperience()).toEqual([{ mission: 'sabotage', ticks: 406 }]);
    expect(quit.missionExperience()).toEqual([{ mission: 'sabotage', ticks: 1 }]);
    expect(delegated.missionExperience()).toEqual([]);
    for (const game of [played, quit, delegated])
      expect(missionsOf(game.world).record('sabotage')).toMatchObject({ openTick: OPEN, commitTick: COMMIT });
    expect(missionsOf(played.world).record('sabotage')).toMatchObject({
      outcome: 'both-burnt',
      resolution: 'played',
    });
    expect(missionsOf(delegated.world).record('sabotage')).toMatchObject({
      outcome: 'ram-burnt',
      resolution: 'delegated',
    });
    expect(missionsOf(quit.world).record('sabotage')).toMatchObject({
      outcome: 'driven-off',
      resolution: 'quit',
    });
    // The hall at the end: untouched with both engines burnt, battered with both alive.
    const hall = (g: MiniSiegeGame) => g.named()['hall']!.hp!;
    expect(hall(played)).toBe(400);
    expect(hall(quit)).toBeLessThan(hall(delegated));
    expect(hall(delegated)).toBeLessThan(hall(played));
  });

  it('steps the world after the round as a world that resolved the same result at the open tick (decision 3)', () => {
    const played = play('played');
    const report = missionsOf(played.world).record('sabotage')!.report!;
    // A fresh game given the played round's result through the world's port at the open tick,
    // with no round in between: the raiders' plan reads only the world, so from there the two
    // worlds must step alike to the end.
    const fresh = createGame(content, SEED);
    while (fresh.world.tick < OPEN) fresh.step(NO_INPUT);
    expect(fresh.mission({ mission: 'sabotage', action: 'open' })).toBeNull();
    const port = missionPort(fresh.world, { refs: fresh.keys });
    expect(
      port.play('sabotage', { mission: 'sabotage', outcome: report.outcome, effects: [], report }).ok,
    ).toBe(true);
    while (fresh.world.tick < played.world.tick) fresh.step(NO_INPUT);
    expect(hash(fresh.world.snapshot())).toBe(hash(played.world.snapshot()));
  });

  it('gives the same hashes on every run', () => {
    for (const name of ['played', 'delegated']) {
      const a = play(name);
      const b = play(name);
      expect(hash(b.snapshot())).toBe(hash(a.snapshot()));
    }
  });
});

describe('the preparation phase: the fortify mission on the walls (Engine 0.12 T7)', () => {
  it('is offered before the raid, and while it is open the siege is held for the sabotage too', () => {
    const game = createGame(content, SEED);
    while (game.world.tick < 5) game.step(NO_INPUT);
    expect(game.rts.view().missions.offered.map((o) => o.mission)).toEqual(['fortify']);
    expect(game.mission({ mission: 'fortify', action: 'open' })).toBeNull();
    expect(game.rts.view().missions.frozen).toEqual(['siege']);
    while (game.world.tick < 30) game.step(NO_INPUT);
    // The siege is the fortify mission's: the sabotage cannot open on it until fortify commits.
    expect(game.mission({ mission: 'sabotage', action: 'open' })).not.toBeNull();
    expect(game.mission({ mission: 'fortify', action: 'delegate' })).toBeNull();
    while (game.world.tick < 36) game.step(NO_INPUT);
    expect(game.rts.view().missions.offered.map((o) => o.mission)).toEqual(['sabotage']);
    expect(game.mission({ mission: 'sabotage', action: 'open' })).toBeNull();
  });

  it('holds the battle frozen from the open tick to the commit, played or delegated', () => {
    const paths = ['fortify-played', 'fortify-delegated'].map((n) => battleByWorldTick(n, FORTIFY_COMMIT));
    for (const battle of paths) {
      const atOpen = battle.get(FORTIFY_OPEN + 1)!;
      for (let w = FORTIFY_OPEN + 1; w < FORTIFY_COMMIT; w++) {
        const now = battle.get(w)!;
        for (const key of [
          'ram',
          'catapult',
          'captain',
          'guard-1',
          'raider-1',
          'raider-4',
          'soldier-1',
          ...WALLS,
        ])
          expect(now[key], `${key} at world tick ${w}`).toEqual(atOpen[key]);
      }
    }
    for (let w = 0; w < FORTIFY_COMMIT; w++) expect(paths[1]!.get(w)).toEqual(paths[0]!.get(w));
  });

  it('commits at the open tick plus the cost, writing back the gold and the losses', () => {
    const played = play('fortify-played');
    const delegated = play('fortify-delegated');
    expect(played.missionExperience()).toEqual([{ mission: 'fortify', ticks: 116 }]);
    expect(delegated.missionExperience()).toEqual([]);
    const played40 = missionsOf(played.world).record('fortify')!;
    expect(played40).toMatchObject({
      outcome: 'held-cheap',
      resolution: 'played',
      openTick: FORTIFY_OPEN,
      commitTick: FORTIFY_COMMIT,
    });
    // The round spent 40 on two archers; `held-cheap` declares 40, so the world loses the same.
    expect(played40.report?.stats).toMatchObject({ spent: 40, leaked: 0, placed: { archers: 2 } });
    expect(missionsOf(delegated.world).record('fortify')).toMatchObject({
      outcome: 'overrun',
      resolution: 'delegated',
      openTick: FORTIFY_OPEN,
      commitTick: FORTIFY_COMMIT,
    });
    // The world just after the commit: the outcome's effects, and nothing else changed.
    const atCommit = (name: string) => {
      let seen: { gold: number; named: Record<string, NamedSummary> } | null = null;
      play(name, (game) => {
        if (seen !== null || game.miniGame() !== null || game.world.tick !== FORTIFY_COMMIT) return;
        const stock = game.world.get(game.keys['hall']!, 'Inventory') as { gold: number };
        seen = { gold: stock.gold, named: game.named() };
      });
      return seen!;
    };
    const held = atCommit('fortify-played');
    expect(held.gold).toBe(150 - 40);
    for (const k of ['raider-1', 'raider-2', 'raider-3', 'raider-4'])
      expect(held.named[k]!.alive).toBe(false);
    for (const k of [...WALLS, 'guard-1', 'guard-2', 'ram', 'catapult'])
      expect(held.named[k]!.alive).toBe(true);
    const overrun = atCommit('fortify-delegated');
    expect(overrun.gold).toBe(150);
    expect(WALLS.map((k) => overrun.named[k]!.hp)).toEqual([null, 60, null, 60]);
    expect([overrun.named['soldier-1']!.hp, overrun.named['captain']!.hp]).toEqual([20, 90]);
    expect(overrun.named['raider-1']!.alive).toBe(true);
  });

  it('steps the world after the round as a world that resolved the same result at the open tick (decision 3)', () => {
    const played = play('fortify-played');
    const report = missionsOf(played.world).record('fortify')!.report!;
    const fresh = createGame(content, SEED);
    while (fresh.world.tick < FORTIFY_OPEN) fresh.step(NO_INPUT);
    expect(fresh.mission({ mission: 'fortify', action: 'open' })).toBeNull();
    const port = missionPort(fresh.world, { refs: fresh.keys });
    expect(
      port.play('fortify', { mission: 'fortify', outcome: report.outcome, effects: [], report }).ok,
    ).toBe(true);
    while (fresh.world.tick < played.world.tick) fresh.step(NO_INPUT);
    expect(hash(fresh.world.snapshot())).toBe(hash(played.world.snapshot()));
  });

  it('gives the same hashes on every run', () => {
    for (const name of ['fortify-played', 'fortify-delegated']) {
      const a = play(name);
      const b = play(name);
      expect(hash(b.snapshot())).toBe(hash(a.snapshot()));
    }
  });
});
