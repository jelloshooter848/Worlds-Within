import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ContentBundle } from './content/bundle';
import type { MiniGameDef } from './minigame';
import { miniGameParamErrors, missionMiniGameUses, type MiniGameUse } from './minigame-params';

const HOLD: MiniGameDef = {
  id: 'hold',
  title: 'HOLD ON',
  paramsSchema: z.strictObject({ ticks: z.int().min(1) }),
  create: () => {
    throw new Error('never started by a check');
  },
};
const FREE: MiniGameDef = { ...HOLD, id: 'free', paramsSchema: undefined } as unknown as MiniGameDef;

function use(game: string, params: Record<string, unknown>): MiniGameUse {
  return {
    file: 'content/levels/a.json',
    game,
    gameAt: ['triggers', 1, 'game'],
    params: params as MiniGameUse['params'],
    paramsAt: ['triggers', 1, 'params'],
  };
}

describe('miniGameParamErrors', () => {
  it('passes good params and a def without a schema, starting no round', () => {
    expect(
      miniGameParamErrors([use('hold', { ticks: 5 }), use('free', { any: 'thing' })], [HOLD, FREE]),
    ).toEqual([]);
  });

  it('names the file and the field under the params, with Zod codes', () => {
    const errors = miniGameParamErrors([use('hold', { ticks: 0, extra: 1 })], [HOLD], 'games/x/');
    expect(errors).toEqual([
      expect.objectContaining({
        file: 'games/x/content/levels/a.json',
        path: 'triggers.1.params.ticks',
        code: 'too_small',
      }),
      expect.objectContaining({ path: 'triggers.1.params.extra', code: 'unrecognized_keys' }),
    ]);
  });

  it('reports an unknown mini game at its id, listing the known ones', () => {
    expect(miniGameParamErrors([use('hodl', {})], [HOLD, FREE])).toEqual([
      expect.objectContaining({
        path: 'triggers.1.game',
        code: 'unknown_mini_game',
        message: 'unknown mini game "hodl" (the game has: "hold", "free")',
      }),
    ]);
    expect(miniGameParamErrors([use('hold', {})], [])[0]!.message).toContain('(the game has: none)');
  });
});

describe('missionMiniGameUses', () => {
  it("lists each mission's play and params ({} when none)", () => {
    const content = {
      manifest: {},
      entries: [
        {
          kind: 'mission',
          name: 'a',
          file: 'content/a.mission.json',
          value: { play: 'hold', params: { ticks: 2 } },
        },
        { kind: 'mission', name: 'b', file: 'content/b.mission.json', value: { play: 'free' } },
        { kind: 'level', name: 'c', file: 'content/c.json', value: {} },
      ],
    } as unknown as ContentBundle;
    expect(missionMiniGameUses(content)).toEqual([
      {
        file: 'content/a.mission.json',
        game: 'hold',
        gameAt: ['play'],
        params: { ticks: 2 },
        paramsAt: ['params'],
      },
      { file: 'content/b.mission.json', game: 'free', gameAt: ['play'], params: {}, paramsAt: ['params'] },
    ]);
  });
});
