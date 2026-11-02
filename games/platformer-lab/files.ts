/**
 * Browser only: the lab's data files as `{ path: text }` pairs, bundled by Vite at build time
 * (`?raw` keeps every file as its text). Node tools read the same files with `readGameFiles`
 * (`engine/core/node/game-files.ts`).
 */
const raw = import.meta.glob(['./game.json', './content/**/*'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export const LAB_FILES: Readonly<Record<string, string>> = raw;
