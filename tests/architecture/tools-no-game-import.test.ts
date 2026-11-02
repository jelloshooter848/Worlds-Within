import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { resolveSpecifier } from '../../config/deps.js';

// The tools load a game by its folder path at run time (engine/tools/game-loader.ts), never by a static import.
// dependency-rule.test.ts checks every layer; this names the rule for the tools.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(`${dir}/${e.name}`) : /\.(ts|js)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
  );
}

describe('engine/tools', () => {
  it('imports nothing from games/', () => {
    const bad: string[] = [];
    for (const file of files('engine/tools')) {
      for (const f of ts.preProcessFile(readFileSync(join(ROOT, file), 'utf8'), true, true).importedFiles) {
        const target = resolveSpecifier(file, f.fileName);
        if (target !== null && (target === 'games' || target.startsWith('games/')))
          bad.push(`${file}: ${f.fileName}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
