import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';

// Shared by the browser tests (`tests/browser/*.test.ts`): starting headless Chromium, telling why
// it cannot start here (so a test skips cleanly where none is installed, never in CI), and serving
// a Vite build of the repo as static files under a base path, as `pnpm build && pnpm preview` does.

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** SwiftShader is Chromium's WebGL when there is no GPU (newer Chromium wants it asked for). */
const CHROMIUM_ARGS = ['--enable-unsafe-swiftshader'];

export async function launch(): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({ args: CHROMIUM_ARGS });
}

/** Why Chromium does not start here, or null (in CI a missing browser fails the test instead). */
export async function browserMissing(): Promise<string | null> {
  try {
    await (await launch()).close();
    return null;
  } catch (error) {
    if (process.env.CI) return null;
    return error instanceof Error ? (error.message.split('\n')[0] ?? 'no Chromium') : String(error);
  }
}

/** Starts `server` on a free local port and returns its origin. */
export async function listen(server: Server): Promise<string> {
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => done());
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
};

/** The repo built with `base` into `outDir`, served as static files; `url` is origin + base. */
export async function serveBuilt(
  base: string,
  outDir: string,
): Promise<{ url: string; close(): Promise<void> }> {
  const vite = await import('vite');
  await vite.build({
    configFile: join(ROOT, 'vite.config.ts'),
    root: ROOT,
    base,
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
  const http = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    let file = path.startsWith(base) ? normalize(join(outDir, path.slice(base.length))) : '';
    if (file && existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!file.startsWith(outDir) || !existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  const origin = await listen(http);
  return {
    url: `${origin}${base}`,
    close: () => new Promise<void>((done) => http.close(() => done())),
  };
}
