import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { ContentError } from '@engine/core/content/validate';
import { EXIT } from '@engine/tools/exit-codes';
import { main } from '@engine/tools/main';

// `pnpm cli validate` over the tower-defense kit's fixture games (Engine 0.12 T2): the kit is found
// through the generated kit list, its kinds check the files, and a broken map is named by file and
// field. It lives here, outside the kit, because kits may not import engine/tools.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

async function validate(game: string): Promise<{ code: number; result: Record<string, unknown> }> {
  let stdout = '';
  const io = { stdout: (t: string) => void (stdout += t), stderr: () => undefined, cwd: ROOT, outDir: ROOT };
  const code = await main(['validate', game, '--json'], io);
  return { code, result: JSON.parse(stdout) as Record<string, unknown> };
}

describe('validate on the tower-defense fixtures', () => {
  it('accepts the fixture game', async () => {
    const run = await validate('kits/towerdefense/__fixtures__/game');
    expect(run.code).toBe(EXIT.ok);
    expect(run.result).toMatchObject({ errorCount: 0, fileCount: 5 });
  });

  it('rejects the broken one, naming each file and field', async () => {
    const run = await validate('kits/towerdefense/__fixtures__/bad');
    expect(run.code).toBe(EXIT.invalidContent);
    const errors = (run.result.errors as ContentError[]).map((e) => ({
      file: e.file,
      path: e.path,
      code: e.code,
    }));
    expect(errors).toEqual([
      {
        file: 'kits/towerdefense/__fixtures__/bad/content/maps/tiny.json',
        path: 'start.lives',
        code: 'too_small',
      },
      {
        file: 'kits/towerdefense/__fixtures__/bad/content/maps/tiny.map.txt',
        path: 'map.2',
        code: 'path_broken',
      },
    ]);
  });
});
