import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advanceCampaign, campaignSchema, newCampaignSave } from '@engine/core/campaign';
import { decodeSaveCode, encodeSaveCode, saveCodeContext } from '@engine/core/campaign-code';
import { canonicalJson } from '@engine/core/headless';
import {
  carriedRecord,
  commitMission,
  openMission,
  playMission,
  scenarioKeys,
  worldFromScenario,
  type MissionDef,
  type World,
} from '@engine/sim/index';
import { stateHash } from './headless-run';

// Engine 0.13 T6 (decisions 6 and 7): a save code taken at the end of the first scenario restores
// the same world: the follow-up's start world built from the code's carried record has the same
// state hash as the one built from the first world's carried record directly. The sim's captive
// fixtures, as a two-scenario campaign.

const DIR = new URL('../sim/__fixtures__/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, DIR), 'utf8')) as unknown;
const FIRST = read('captive.world.json');
const SECOND = read('captive-after.world.json') as { from: unknown } & Record<string, unknown>;
const MISSIONS = ['ambush', 'rescue-captain', 'exchange-captain', 'leave-captain', 'ransom-captain'];
const CAMPAIGN = campaignSchema.parse({
  version: 1,
  id: 'captive',
  entries: [
    { scenario: 'captive', ticks: 12 },
    { scenario: 'captive-after', ticks: 30 },
  ],
});
const CONTEXT = saveCodeContext({
  manifest: { id: 'captive-game' } as never,
  entries: [
    { kind: 'rts-map', name: 'captive', file: 'a', value: FIRST },
    { kind: 'rts-map', name: 'captive-after', file: 'b', value: SECOND },
    { kind: 'campaign', name: 'captive', file: 'c', value: CAMPAIGN },
    ...MISSIONS.map((m) => ({ kind: 'mission', name: m, file: m, value: read(`${m}.mission.json`) })),
  ],
});

/** The captive world at its end (tick 12) after `ambush` resolved: `taken` captures the captain. */
function firstEnd(outcome: 'taken' | 'held'): World {
  const world = worldFromScenario(FIRST);
  world.step();
  world.step();
  const opened = openMission(world, read('ambush.mission.json') as MissionDef, { refs: scenarioKeys(FIRST) });
  if (!opened.ok) throw new Error(opened.error);
  const played = playMission(world, 'ambush', outcome);
  if (!played.ok) throw new Error(played.error);
  if (!commitMission(world, 'ambush').ok) throw new Error('commit');
  return world;
}

function code(world: World, outcome: string): string {
  const carried = carriedRecord(world, SECOND.from, scenarioKeys(FIRST));
  const save = advanceCampaign(
    CAMPAIGN,
    newCampaignSave({ game: 'captive-game', campaign: 'captive', seed: 3 }),
    {
      missions: [{ mission: 'ambush', outcome, resolution: 'played' }],
      carried,
    },
  );
  if (!save.ok) throw new Error(save.error);
  const packed = encodeSaveCode(save.save, CONTEXT);
  if (!packed.ok) throw new Error(packed.error);
  return packed.code;
}

describe('a save code restores the same world', () => {
  for (const outcome of ['taken', 'held'] as const)
    it(`gives the follow-up's start world the same hash as the carried record (${outcome})`, () => {
      const end = firstEnd(outcome);
      const direct = worldFromScenario(SECOND, {
        carried: carriedRecord(end, SECOND.from, scenarioKeys(FIRST)),
      });
      const decoded = decodeSaveCode(code(end, outcome), CONTEXT);
      if (!decoded.ok) throw new Error(decoded.error);
      expect(decoded.save.position).toBe(1);
      const restored = worldFromScenario(SECOND, { carried: decoded.save.carried });
      expect(stateHash(restored.snapshot())).toBe(stateHash(direct.snapshot()));
      for (let t = 0; t < 30; t++) {
        direct.step();
        restored.step();
      }
      expect(canonicalJson(restored.snapshot())).toBe(canonicalJson(direct.snapshot()));
    });

  it("gives different codes when only the captain's fate differs, each restoring its own world", () => {
    const taken = code(firstEnd('taken'), 'taken');
    const held = code(firstEnd('held'), 'held');
    expect(taken).not.toBe(held);
    const start = (c: string) => {
      const d = decodeSaveCode(c, CONTEXT);
      if (!d.ok) throw new Error(d.error);
      return stateHash(worldFromScenario(SECOND, { carried: d.save.carried }).snapshot());
    };
    expect(start(taken)).not.toBe(start(held));
  });
});
