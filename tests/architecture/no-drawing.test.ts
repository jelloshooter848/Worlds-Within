import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Kits never draw (docs/DESIGN.md, docs/ROADMAP.md 0.4): a kit describes each frame
// (`engine/core/present`) and a backend draws it through a skin. The dependency rule keeps kits off
// the core Renderer and every backend (FORBIDDEN_CORE in config/layers.js); this test also scans
// the code of every kit file that is not a test for drawing calls, so none can come back by
// another route (a renderer passed in as a plain object, a canvas context).

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SOURCE = /\.(ts|tsx|js|mjs)$/;
const TEST = /\.test\.(ts|tsx|js|mjs)$/;

/** Calls and names that only drawing code has: the Renderer's methods and the canvas's own. */
export const DRAWING = [
  /\.(sprite|rect|text|debugText|line)\s*\(/,
  /\.(fillRect|strokeRect|fillText|strokeText|drawImage|putImageData)\s*\(/,
  /\bCanvasRenderingContext2D\b/,
  /\bgetContext\s*\(/,
];

/** Every non-test source file under `dir` (repo paths). */
function kitFiles(dir: string): string[] {
  if (!existsSync(join(ROOT, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...kitFiles(path));
    } else if (SOURCE.test(entry.name) && !TEST.test(entry.name)) out.push(path);
  }
  return out;
}

/** The code with comments blanked out, so prose about drawing does not count. */
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' ')).replace(/\/\/.*$/gm, '');
}

/** `file:line: text` for each line of `text` with a drawing call. */
export function drawingCalls(file: string, text: string): string[] {
  const hits: string[] = [];
  codeOf(text)
    .split('\n')
    .forEach((line, i) => {
      if (DRAWING.some((re) => re.test(line))) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  return hits;
}

describe('kits never draw', () => {
  const files = kitFiles('kits');

  it('finds the kits', () => {
    expect(files.some((f) => f.startsWith('kits/topdown/'))).toBe(true);
  });

  it('has no drawing call in any kit file', () => {
    const hits = files.flatMap((f) => drawingCalls(f, readFileSync(join(ROOT, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it.each([
    ['r.sprite(sheet, f, x, y);'],
    ['r.rect(0, 0, 16, 16, "#000000");'],
    ['r.text(font, "LIFE", 8, 8);'],
    ['r.debugText("x", 0, 0);'],
    ['r.line(0, 0, 8, 8, "#fff");'],
    ['ctx.fillRect(0, 0, 1, 1);'],
    ['const ctx = canvas.getContext("2d");'],
    ['let c: CanvasRenderingContext2D;'],
  ])('fails on a planted drawing call: %s', (line) => {
    expect(drawingCalls('kits/x/planted.ts', `export const a = 1;\n${line}\n`)).toEqual([
      `kits/x/planted.ts:2: ${line}`,
    ]);
  });

  it('ignores drawing named only in comments', () => {
    const text =
      '// the old code called r.sprite(...)\n/* and r.rect(...)\n getContext() */\nexport const a = 1;\n';
    expect(drawingCalls('kits/x/ok.ts', text)).toEqual([]);
  });
});
