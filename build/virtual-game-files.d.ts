/**
 * The `virtual:game-files` module (build/game-files.ts): the importing game's data files as
 * `{ path: text }` pairs, keyed `./game.json` and `./content/...`.
 */
declare module 'virtual:game-files' {
  const files: Readonly<Record<string, string>>;
  export default files;
}
