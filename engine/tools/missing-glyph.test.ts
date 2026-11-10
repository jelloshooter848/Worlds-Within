import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT } from './exit-codes';
import { main } from './main';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SKIN = 'games/fx-lab/content/skins/canvas2d.json';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('validate: fonts cover the HUD text (Engine 0.16 T6)', () => {
  it('reports a character the font lacks as missing_glyph, naming the skin file and field', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'ww-glyph-'));
    temps.push(cwd);
    cpSync(join(ROOT, 'games/fx-lab'), join(cwd, 'games/fx-lab'), { recursive: true });
    const skin = JSON.parse(readFileSync(join(cwd, SKIN), 'utf8')) as { hud: { format?: string }[] };
    const i = skin.hud.findIndex((item) => item.format?.startsWith('Stomp'));
    skin.hud[i]!.format = 'Stomp ~ beetles {value} ^';
    writeFileSync(join(cwd, SKIN), JSON.stringify(skin));
    let stdout = '';
    const io = { stdout: (t: string) => void (stdout += t), stderr: () => {}, cwd, outDir: '.ww-out' };
    const code = await main(['validate', 'games/fx-lab', '--json'], io);
    expect(code).toBe(EXIT.invalidContent);
    const out = JSON.parse(stdout) as {
      errors: { file: string; path: string; code: string; message: string }[];
    };
    expect(out.errors).toEqual([
      expect.objectContaining({
        file: SKIN,
        path: `hud.${i}.format`,
        code: 'missing_glyph',
        message: 'font "fx-small" has no glyph for "~", "^" (used in this format)',
      }),
    ]);
  });
});
