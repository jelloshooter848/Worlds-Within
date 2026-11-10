import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { gameFiles } from './build/game-files.ts';
import { GAME_LIST_MARKER, discoverGames, gameListHtml, pageInputs } from './build/pages.ts';

// VITE_BASE lets every page work under a sub-path (e.g. /Worlds-Within/ on GitHub Pages).
const base = process.env.VITE_BASE ?? '/';
const alias = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));
const root = alias('./');

/** Fills the root launcher page with a link to every game found under games/ and games/samples/. */
function gameIndex(): Plugin {
  return {
    name: 'worlds-within:game-index',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!html.includes(GAME_LIST_MARKER)) return html;
        if (ctx.filename !== alias('./index.html')) return html;
        return html.replace(GAME_LIST_MARKER, gameListHtml(discoverGames(root)));
      },
    },
  };
}

export default defineConfig({
  base,
  // gameFiles(): `virtual:game-files`, a game page's data files (build/game-files.ts).
  plugins: [gameIndex(), gameFiles()],
  resolve: {
    alias: {
      '@engine': alias('./engine'),
      '@kits': alias('./kits'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The 3D pages' own chunk holds Three.js (~575 kB, loaded only with ?backend=three).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // The launcher plus every games/*/index.html and games/samples/*/index.html.
      input: pageInputs(root),
    },
  },
  // Open the launcher on `pnpm dev`, except in CI where there is no browser.
  server: { port: 5173, open: process.env.CI ? false : '/' },
  test: {
    environment: 'node',
    // The whole suite keeps every core busy for minutes (from Engine 0.16 part B, T10 it also
    // draws every run in 3D with its models), so a test that takes 1 s alone can pass vitest's
    // default 5 s: allow 30 s before calling one hung.
    testTimeout: 30_000,
    include: [
      'engine/**/*.test.ts',
      'kits/**/*.test.ts',
      'games/**/*.test.ts',
      'tests/**/*.test.ts',
      'build/**/*.test.ts',
    ],
  },
});
