import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const base = process.env.VITE_BASE ?? '/';
const alias = (dir: string) => fileURLToPath(new URL(dir, import.meta.url));

export default defineConfig({
  base,
  resolve: {
    alias: {
      '@engine': alias('./engine'),
      '@kits': alias('./src/kits'),
    },
  },
  build: { target: 'es2022', sourcemap: true },
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['engine/**/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
});
