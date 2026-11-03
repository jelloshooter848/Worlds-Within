import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverGames, gameListHtml, pageInputs } from '../../build/pages.ts';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

describe('game page discovery', () => {
  it('finds games/samples/dungeon and games/platformer-lab in the repo', () => {
    const dirs = discoverGames(repoRoot).map((page) => page.dir);
    expect(dirs).toContain('games/samples/dungeon');
    expect(dirs).toContain('games/platformer-lab');
  });

  it('finds the RTS skirmish sample under games/samples (Engine 0.9 T12)', () => {
    const rts = discoverGames(repoRoot).find((page) => page.dir === 'games/samples/rts-skirmish');
    expect(rts).toEqual({
      dir: 'games/samples/rts-skirmish',
      name: 'games-samples-rts-skirmish',
      title: 'RTS skirmish',
    });
    expect(gameListHtml(rts ? [rts] : [])).toContain(
      '<a href="games/samples/rts-skirmish/">games/samples/rts-skirmish</a> <span>RTS skirmish</span>',
    );
    expect(pageInputs(repoRoot)['games-samples-rts-skirmish']).toBe(
      join(repoRoot, 'games/samples/rts-skirmish/index.html'),
    );
  });

  it('finds the mini siege sample under games/samples (Engine 0.11 T9)', () => {
    const siege = discoverGames(repoRoot).find((page) => page.dir === 'games/samples/mini-siege');
    expect(siege).toEqual({
      dir: 'games/samples/mini-siege',
      name: 'games-samples-mini-siege',
      title: 'The mini siege',
    });
    expect(gameListHtml(siege ? [siege] : [])).toContain(
      '<a href="games/samples/mini-siege/">games/samples/mini-siege</a> <span>The mini siege</span>',
    );
    expect(pageInputs(repoRoot)['games-samples-mini-siege']).toBe(
      join(repoRoot, 'games/samples/mini-siege/index.html'),
    );
  });

  it('finds the tower-defense sample under games/samples (Engine 0.12 T5)', () => {
    const td = discoverGames(repoRoot).find((page) => page.dir === 'games/samples/tower-defense');
    expect(td).toEqual({
      dir: 'games/samples/tower-defense',
      name: 'games-samples-tower-defense',
      title: 'Tower defense',
    });
    expect(gameListHtml(td ? [td] : [])).toContain(
      '<a href="games/samples/tower-defense/">games/samples/tower-defense</a> <span>Tower defense</span>',
    );
    expect(pageInputs(repoRoot)['games-samples-tower-defense']).toBe(
      join(repoRoot, 'games/samples/tower-defense/index.html'),
    );
  });

  it("reads the platformer lab's 3D link from its ww-alternate meta tag", () => {
    const lab = discoverGames(repoRoot).find((page) => page.dir === 'games/platformer-lab');
    expect(lab?.alternates).toEqual([{ label: '3D', query: '?backend=three' }]);
    expect(gameListHtml(lab ? [lab] : [])).toContain(
      '<a href="games/platformer-lab/">games/platformer-lab</a> <a href="games/platformer-lab/?backend=three">3D</a>',
    );
  });

  it('passes the launcher and every game to the build', () => {
    const inputs = pageInputs(repoRoot);
    expect(inputs.index).toBe(join(repoRoot, 'index.html'));
    expect(inputs['games-samples-dungeon']).toBe(join(repoRoot, 'games/samples/dungeon/index.html'));
    expect(inputs['games-platformer-lab']).toBe(join(repoRoot, 'games/platformer-lab/index.html'));
  });

  it('finds games and samples with an index.html, and skips folders without one', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-pages-'));
    try {
      const page = (dir: string, html: string) => {
        mkdirSync(join(root, dir), { recursive: true });
        writeFileSync(join(root, dir, 'index.html'), html);
      };
      page(
        'games/zeta',
        '<title>Zeta</title><meta name="ww-alternate" content="Big view ?zoom=2" /><meta name="ww-alternate" content="broken" />',
      );
      page('games/alpha', '<html></html>');
      page('games/samples/dungeon', '<title> Dungeon </title>');
      mkdirSync(join(root, 'games/notes'), { recursive: true });
      writeFileSync(join(root, 'games/readme.md'), 'not a game');

      expect(discoverGames(root)).toEqual([
        { dir: 'games/alpha', name: 'games-alpha', title: 'games/alpha' },
        { dir: 'games/samples/dungeon', name: 'games-samples-dungeon', title: 'Dungeon' },
        {
          dir: 'games/zeta',
          name: 'games-zeta',
          title: 'Zeta',
          alternates: [{ label: 'Big view', query: '?zoom=2' }],
        },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the tools-only screenshot and debugger pages out of the build', () => {
    const inputs = Object.values(pageInputs(repoRoot));
    expect(inputs).not.toContain(join(repoRoot, 'engine/tools/screenshot/index.html'));
    expect(inputs).not.toContain(join(repoRoot, 'engine/tools/debugger/index.html'));
    expect(inputs.filter((path) => path.startsWith(join(repoRoot, 'engine')))).toEqual([]);
  });

  it('copes with a repo that has no games folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'ww-pages-'));
    try {
      expect(discoverGames(root)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('launcher list', () => {
  it('links each game by a relative path so it works under any base', () => {
    const html = gameListHtml([
      { dir: 'games/samples/dungeon', name: 'games-samples-dungeon', title: 'A <b> & "c"' },
    ]);
    expect(html).toContain('<a href="games/samples/dungeon/">games/samples/dungeon</a>');
    expect(html).toContain('A &lt;b&gt; &amp; &quot;c&quot;');
  });

  it('says so when there are no games', () => {
    expect(gameListHtml([])).toContain('No games found');
  });
});
