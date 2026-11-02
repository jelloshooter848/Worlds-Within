import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const base = process.env.VITE_BASE ?? '/';
const alias = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@engine': alias('./engine'),
      '@kits': alias('./kits'),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: alias('./index.html'),
        demo: alias('./games/demo/index.html'),
      },
    },
  },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts', 'kits/**/*.test.ts', 'games/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
