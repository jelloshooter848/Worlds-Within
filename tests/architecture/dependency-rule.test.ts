import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { checkImport, checkSpecifier, packageName, placeOf, resolveSpecifier } from '../../config/deps.js';
import { EXCEPTIONS, FORBIDDEN_CORE, LAYERS, PACKAGES } from '../../config/layers.js';

// The dependency rule (docs/DESIGN.md, "The dependency rule"): every import arrow must be one the
// layer table in config/layers.js allows.

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SCANNED = ['engine', 'kits', 'games', 'tests', 'build'];
const SOURCE = /\.(ts|tsx|js|mjs)$/;

/** Every source file under `dir`, as repo paths. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (SOURCE.test(entry.name)) out.push(path);
  }
  return out;
}

/** Import, export-from, side-effect and literal `import()` specifiers, as the TypeScript scanner sees them. */
function specifiersOf(text: string): string[] {
  return ts.preProcessFile(text, true, true).importedFiles.map((f) => f.fileName);
}

describe('dependency rule: the repo', () => {
  const files = SCANNED.flatMap(sourceFiles);

  it('finds the source tree', () => {
    expect(files.filter((f) => f.startsWith('engine/core/')).length).toBeGreaterThan(10);
    expect(files.some((f) => f.startsWith('kits/topdown/'))).toBe(true);
    expect(files.some((f) => f.startsWith('games/samples/dungeon/'))).toBe(true);
  });

  it('has no import that points the wrong way', () => {
    const violations: string[] = [];
    let arrows = 0;
    for (const file of files) {
      for (const spec of specifiersOf(readFileSync(join(ROOT, file), 'utf8'))) {
        arrows++;
        const result = checkSpecifier(file, spec);
        if (!result.ok) violations.push(`${file} imports '${spec}': ${result.reason}`);
      }
    }
    expect(arrows).toBeGreaterThan(100);
    expect(violations).toEqual([]);
  });
});

describe('dependency rule: the scanner', () => {
  it('sees every kind of import and skips comments and strings', () => {
    const text = [
      "import a from 'pkg';",
      "import type { B } from '@kits/b';",
      "export * from './c';",
      "export { d } from '../d';",
      "import './side-effect';",
      "const e = await import('../../games/samples/dungeon/main.ts');",
      "// import z from 'commented-out';",
    ].join('\n');
    expect(specifiersOf(text)).toEqual([
      'pkg',
      '@kits/b',
      './c',
      '../d',
      './side-effect',
      '../../games/samples/dungeon/main.ts',
    ]);
  });
});

describe('dependency rule: the layer table', () => {
  it('names each layer once and only allows layers it defines', () => {
    const names = LAYERS.map((l) => l.name);
    expect(new Set(names).size).toBe(names.length);
    for (const layer of LAYERS) {
      expect(layer.allowed).toContain(layer.name);
      for (const to of layer.allowed) expect(names).toContain(to);
    }
  });

  it('lets nothing in engine/ or kits/ import games', () => {
    for (const layer of LAYERS) {
      if (layer.name !== 'games') expect(layer.allowed).not.toContain('games');
    }
  });

  it('has the test-file exception for the null backend', () => {
    expect(EXCEPTIONS.some((e) => e.target === 'engine/backends/null' && e.from.test('x.test.ts'))).toBe(
      true,
    );
  });

  it('keeps kits off the drawing side of the core, naming only core files that exist', () => {
    const kits = FORBIDDEN_CORE.filter((f) => f.layer === 'kits').flatMap((f) => f.targets);
    for (const t of [
      'engine/core/gfx/renderer.ts',
      'engine/core/gfx/spritesheet.ts',
      'engine/core/assets/**',
    ])
      expect(kits).toContain(t);
    // Presentation effects (Engine 0.16): presenters only, never kits or the sim.
    expect(kits).toContain('engine/core/fx/**');
    expect(FORBIDDEN_CORE.filter((f) => f.layer === 'engine/sim').flatMap((f) => f.targets)).toContain(
      'engine/core/fx/**',
    );
    // The skinned presenter walk the 2D backends share (Engine 0.16 T13b) draws: backends only.
    expect(kits).toContain('engine/core/draw/**');
    expect(FORBIDDEN_CORE.filter((f) => f.layer === 'engine/sim').flatMap((f) => f.targets)).toContain(
      'engine/core/draw/**',
    );
    for (const rule of FORBIDDEN_CORE) {
      expect(LAYERS.map((l) => l.name)).toContain(rule.layer);
      for (const t of rule.targets) {
        expect(t.startsWith('engine/core/'), t).toBe(true);
        expect(existsSync(join(ROOT, t.replace(/\/\*\*$/, ''))), t).toBe(true);
      }
    }
  });

  it('names an owner for each external package it restricts, and the owners exist', () => {
    const three = PACKAGES.find((p) => p.name === 'three');
    expect(three?.owners).toEqual(['engine/backends/three']);
    const pixi = PACKAGES.find((p) => p.name === 'pixi.js');
    expect(pixi?.owners).toEqual(['engine/backends/pixi']);
    for (const pkg of PACKAGES) {
      expect(pkg.owners.length, pkg.name).toBeGreaterThan(0);
      for (const dir of pkg.owners) expect(existsSync(join(ROOT, dir)), dir).toBe(true);
    }
  });

  it.each([
    ['three', 'three'],
    ['three/addons/controls/OrbitControls.js', 'three'],
    ['pixi.js', 'pixi.js'],
    ['@types/three', '@types/three'],
    ['@scope/pkg/sub/path', '@scope/pkg'],
    ['node:fs', 'node:fs'],
  ])('reads the package name of %s as %s', (spec, name) => {
    expect(packageName(spec)).toBe(name);
  });

  it('places files in their layer and unit', () => {
    expect(placeOf('games/samples/dungeon/main.ts')?.unit).toBe('games/samples/dungeon');
    expect(placeOf('games/samples/siege/main.ts')?.unit).toBe('games/samples/siege');
    expect(placeOf('engine/backends/null/index.ts')?.unit).toBe('engine/backends/null');
    expect(placeOf('engine/core/gfx/screen.ts')?.layer.name).toBe('engine/core');
    expect(placeOf('tests/build/pages.test.ts')).toBeNull();
  });
});

describe('dependency rule: resolving specifiers', () => {
  it.each([
    ['kits/topdown/hero.ts', '@engine/core/rng', 'engine/core/rng'],
    ['games/samples/dungeon/scene.ts', '@kits/topdown', 'kits/topdown'],
    ['kits/topdown/hero.ts', './room', 'kits/topdown/room'],
    ['kits/topdown/hero.ts', '../../games/samples/dungeon/rooms.ts', 'games/samples/dungeon/rooms.ts'],
    ['engine/core/audio/mml.ts', '../save/settings?raw', 'engine/core/save/settings'],
    ['games/samples/dungeon/main.ts', '/engine/core/loop', 'engine/core/loop'],
    ['kits/topdown/hero.ts', '../../../outside', '../outside'],
    ['kits/topdown/hero.ts', 'vitest', null],
    ['kits/topdown/hero.ts', 'node:fs', null],
    ['kits/topdown/hero.ts', '@engineering/x', null],
    ['kits/topdown/hero.ts', 'games/samples/dungeon/rooms', 'games/samples/dungeon/rooms'],
    ['engine/sim/world.ts', 'engine/backends/canvas2d', 'engine/backends/canvas2d'],
    ['kits/topdown/hero.ts', 'gamesx/y', null],
  ])('%s: %s -> %s', (from, spec, expected) => {
    expect(resolveSpecifier(from, spec)).toBe(expected);
  });
});

describe('dependency rule: the checker', () => {
  // [importing file, specifier, why it must be rejected]
  const bad: [string, string, string][] = [
    ['kits/topdown/world.ts', '../../games/samples/dungeon/rooms', 'kit -> game'],
    ['kits/topdown/world.ts', '/games/samples/dungeon/rooms.ts', 'kit -> game by a rooted path'],
    ['kits/topdown/world.ts', 'games/samples/dungeon/rooms', 'kit -> game by a bare repo path'],
    ['engine/sim/world.ts', 'engine/backends/canvas2d', 'sim -> backend by a bare repo path'],
    ['kits/topdown/world.ts', '../../games/samples/dungeon/main.ts?raw', 'kit -> game with a query'],
    ['engine/sim/world.ts', '@engine/backends/null', 'sim -> backend'],
    ['engine/sim/world.ts', '@engine/backends/canvas2d', 'sim -> backend'],
    ['engine/sim/world.ts', '@kits/topdown', 'sim -> kit'],
    ['engine/core/loop.ts', '@kits/topdown', 'core -> kit'],
    ['engine/core/loop.ts', '@engine/sim/world', 'core -> sim'],
    ['engine/core/loop.ts', '@engine/backends/canvas2d', 'core -> backend'],
    ['engine/core/loop.ts', '@engine/tools/cli', 'core -> tools'],
    ['engine/backends/canvas2d/renderer.ts', '../../../games/samples/dungeon/scene', 'backend -> game'],
    ['engine/backends/canvas2d/renderer.ts', '@kits/topdown', 'backend -> kit'],
    ['engine/backends/canvas2d/renderer.ts', '../null', 'backend -> another backend'],
    ['engine/backends/canvas2d/renderer.ts', '@engine/sim/world', 'backend -> sim'],
    ['kits/topdown/world.ts', '@engine/backends/null', 'non-test kit file -> null backend'],
    ['kits/topdown/world.ts', '@engine/backends/canvas2d', 'kit -> backend'],
    ['kits/topdown/world.test.ts', '@engine/backends/canvas2d', 'test file -> a backend other than null'],
    ['kits/topdown/world.ts', '@kits/platformer', 'kit -> another kit'],
    ['kits/topdown/world.ts', '@engine/core/gfx/renderer', 'kit -> the core Renderer'],
    ['kits/topdown/world.ts', '../../engine/core/gfx/renderer.ts', 'kit -> the core Renderer (relative)'],
    ['kits/topdown/world.ts', '@engine/core/gfx/spritesheet', 'kit -> sprite sheets'],
    ['kits/topdown/world.ts', '@engine/core/assets/sheet-lookup', 'kit -> asset loading'],
    ['kits/topdown/world.ts', '@engine/core/assets', 'kit -> the assets folder'],
    ['kits/topdown/world.ts', '@engine/core/audio/audio-manager', 'kit -> audio output'],
    ['kits/topdown/world.test.ts', '@engine/core/gfx/renderer', 'kit test -> the core Renderer'],
    ['kits/topdown/world.ts', '@engine/sim/world', 'kit -> sim'],
    ['engine/tools/cli.ts', '../../games/samples/dungeon/main.ts', 'tools -> game by a static path'],
    ['games/samples/dungeon/main.ts', '../mini-siege/main', 'game -> another game'],
    ['games/samples/siege/main.ts', '../../demo/rooms', 'sample game -> another game'],
    ['games/samples/dungeon/main.ts', '../../../tests/helpers', 'game -> unlayered folder'],
    ['kits/topdown/world.ts', '../../build/pages.ts', 'kit -> unlayered folder'],
    ['games/samples/dungeon/main.ts', '../../../../elsewhere', 'outside the repo'],
    ['kits/platformer/world.ts', 'three', 'kit -> three'],
    ['kits/platformer/world.test.ts', 'three', 'kit test -> three'],
    ['engine/core/present/camera.ts', 'three', 'core -> three'],
    ['engine/core/gfx/renderer.ts', 'three/src/math/Vector3.js', 'core -> a three subpath'],
    ['games/platformer-lab/view.ts', 'three', 'game -> three'],
    ['games/samples/siege/main.ts', 'three', 'sample game -> three'],
    ['engine/backends/canvas2d/renderer.ts', 'three', 'another backend -> three'],
    ['engine/sim/world.ts', 'three', 'sim -> three'],
    ['engine/tools/cli.ts', 'three', 'tools -> three'],
    ['kits/rts/world.ts', 'pixi.js', 'kit -> pixi.js'],
    ['engine/core/gfx/renderer.ts', 'pixi.js', 'core -> pixi.js'],
    ['games/samples/tower-defense/main.ts', 'pixi.js', 'sample game -> pixi.js'],
    ['engine/backends/canvas2d/renderer.ts', 'pixi.js', 'another backend -> pixi.js'],
    ['engine/backends/three/scene.ts', 'pixi.js', 'the 3D backend -> pixi.js'],
    ['engine/backends/pixi/renderer.ts', 'three', 'the PixiJS backend -> three'],
    ['engine/sim/world.ts', 'pixi.js', 'sim -> pixi.js'],
    ['engine/tools/cli.ts', 'pixi.js', 'tools -> pixi.js'],
  ];

  it.each(bad)('rejects %s importing %s (%s)', (from, spec) => {
    const result = checkSpecifier(from, spec);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe('');
  });

  // [importing file, specifier, the arrow]
  const good: [string, string, string][] = [
    ['games/samples/dungeon/main.ts', '@kits/topdown', 'game -> kit'],
    ['games/samples/platformer/headless.ts', '@kits/platformer', 'a game on two kits -> its kit'],
    ['games/samples/platformer/headless.ts', '@kits/topdown', 'a game on two kits -> the kit it uses'],
    [
      'games/samples/platformer/minigame.ts',
      '../../../kits/topdown/world',
      'a game on two kits -> a kit file',
    ],
    ['games/samples/dungeon/main.ts', '@engine/sim/world', 'game -> sim'],
    ['games/samples/dungeon/main.ts', '@engine/backends/canvas2d', 'game -> backend'],
    ['games/samples/dungeon/main.ts', '@engine/core/loop', 'game -> core'],
    ['games/samples/dungeon/main.ts', './scene', 'inside one game'],
    ['games/samples/siege/main.ts', './rooms', 'inside one sample game'],
    ['kits/topdown/world.ts', '@engine/core/rng', 'kit -> core'],
    ['kits/topdown/world.ts', './room', 'inside one kit'],
    ['kits/topdown/world.ts', '@engine/core/present', 'kit -> the presentation contract'],
    ['kits/topdown/world.ts', '@engine/core/gfx/screen', 'kit -> screen sizes'],
    ['kits/topdown/world.ts', '@engine/core/audio/mml', 'kit -> MML (text, not output)'],
    ['games/samples/dungeon/main.ts', '@engine/core/gfx/renderer', 'game -> the core Renderer'],
    ['kits/topdown/world.test.ts', '@engine/backends/null', 'test file -> null backend'],
    ['engine/core/gfx/screen.test.ts', '@engine/backends/null', 'core test -> null backend'],
    ['engine/backends/null/index.ts', '@engine/core/gfx/renderer', 'backend -> core'],
    ['engine/backends/canvas2d/index.ts', './renderer', 'inside one backend'],
    ['engine/sim/world.ts', '@engine/core/rng', 'sim -> core'],
    ['engine/sim/world.ts', './entity', 'inside sim'],
    ['engine/core/audio/mml.ts', '../save/settings', 'inside core'],
    ['engine/tools/cli.ts', '@engine/sim/world', 'tools -> sim'],
    ['engine/tools/cli.ts', '@engine/backends/null', 'tools -> backend'],
    ['engine/tools/cli.ts', '@engine/core/loop', 'tools -> core'],
    ['engine/tools/cli.ts', '@kits/topdown', 'tools -> kit'],
    ['engine/core/loop.ts', 'node:fs', 'external package'],
    ['kits/topdown/world.ts', 'vitest', 'external package'],
    ['tests/build/pages.test.ts', '../../build/pages.ts', 'unlayered tooling'],
    ['tests/architecture/x.test.ts', '../../games/samples/dungeon/rooms', 'unlayered tooling -> game'],
    ['engine/backends/three/scene.ts', 'three', 'the 3D backend -> three'],
    ['engine/backends/three/scene.test.ts', 'three', 'the 3D backend test -> three'],
    ['engine/backends/three/geometry.ts', 'three/src/math/Vector3.js', 'the 3D backend -> a three subpath'],
    ['engine/backends/pixi/renderer.ts', 'pixi.js', 'the PixiJS backend -> pixi.js'],
    ['engine/backends/pixi/renderer.test.ts', 'pixi.js', 'the PixiJS backend test -> pixi.js'],
    ['engine/core/loop.ts', 'zod', 'an unrestricted package'],
    ['tests/architecture/x.test.ts', 'three', 'unlayered tooling -> three'],
  ];

  it.each(good)('accepts %s importing %s (%s)', (from, spec) => {
    expect(checkSpecifier(from, spec)).toEqual({ ok: true });
  });

  it('flags a literal dynamic import of a game from a kit, found by the scanner', () => {
    const [spec] = specifiersOf(
      "export async function load() { return import('../../games/samples/dungeon/main.ts'); }",
    );
    expect(spec).toBeDefined();
    expect(checkSpecifier('kits/topdown/loader.ts', spec ?? '').ok).toBe(false);
  });

  it('names the owner when a package is imported from outside it', () => {
    const result = checkSpecifier('kits/platformer/world.ts', 'three');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('three may only be imported from engine/backends/three');
  });

  it('gives each rejection a reason that names the arrow', () => {
    const result = checkImport('engine/sim/world.ts', 'engine/backends/null/index.ts');
    expect(result).toEqual({
      ok: false,
      reason: 'engine/sim may not import engine/backends (allowed: engine/sim, engine/core)',
    });
  });
});
