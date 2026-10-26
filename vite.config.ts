import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const base = process.env.VITE_BASE ?? '/';
const alias = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@engine': alias('./src/engine'),
      '@kits': alias('./src/kits'),
      '@sim': alias('./src/sim'),
      '@game': alias('./src/game'),
    },
  },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
