# engine/core/content

Folder: `engine/core/content` (part of `engine/core`). Detailed rules:
[`engine/core/content/CLAUDE.md`](../../engine/core/content/CLAUDE.md).

## Purpose

Read and check content files with typed schemas (Zod), so every problem names the file and the
exact field. Holds the text-grid parser (rows of characters plus a legend), the `validate` helper,
and the registry of content-file kinds. No file IO: functions take a file name and a string or an
object.

## Public API entry points

- `content/validate.ts`: `validate(fileName, data, schema)`, `ContentError`
  (`{ file, path, pointer, message, code, row?, col?, line? }`), `ContentResult`, `formatErrors`.
- `content/text-grid.ts`: `parseTextGrid(rows | text, legend)`, `gridProblems`, `gridRows`,
  `addGridIssues` (for schemas).
- `content/kinds.ts`: `ContentKind`, `ContentKinds` (register, get, list, parse), `parseContent`.
- `content/kinds.ts` also: `gridParts` on a kind keeps a field in a sibling text grid (`.map.txt`);
  `checkAll` checks across all of a kind's files (`KindIssue`s), run by `loadContent` last.
- `content/manifest.ts`: `gameManifestSchema`, the shape of a game's `game.json` (its `kit`, and
  `uses`: more kits whose content kinds it also holds).
- `content/bundle.ts`: `loadContent(files, kinds, { root })` -> `ContentBundle`, `contentOf`,
  `contentNamed`, `globToRegExp`.
- `content/engine-kinds.ts`: `engineContentKinds()` with the `song`, `sfx`, `palette`, `sprite`,
  `skin` and (Engine 0.10) `mission` and `campaign` kinds (also exported as `SONG_KIND`, `SFX_KIND`,
  `PALETTE_KIND`, `SPRITE_KIND`, `SKIN_KIND`, `MISSION_KIND`, `CAMPAIGN_KIND`), so any game's
  `*.mission.json` and `*.campaign.json` files validate (`missions.ts`, `campaign.ts`; a campaign's
  `checkAll` checks every level and mission it names is in the game).
- `content/game-content.ts` (Engine 0.7 T9): `kitContentKinds(kits)` (the engine's kinds plus each
  kit hook's), `contentArt(content)`, `contentSfx(content)`, `contentSongs(content)`, `mustLoad(result, who?)`: the content
  glue every game wrote for itself.
- `gfx/palette-schema.ts`: `paletteSchema` (`{ id, colors }`).
- `node/game-files.ts` (Node only): `readGameFiles(dir)`, a game's `game.json` and `content/**`.
- `audio/song-schema.ts`: `songSchema`, `sfxSchema` (every channel must compile as MML).
- `gfx/sprite-schema.ts`: `spriteSchema` (to `SpriteDef`), `readSpriteText` (the `.txt` form).

Example: `engineContentKinds().parse('song', 'games/demo/songs/theme.json', text)` returns
`{ ok: false, errors: [{ file: 'games/demo/songs/theme.json', path: 'noise', code: 'invalid_mml', ... }] }`
when the noise channel does not compile.

## Imports allowed

- `zod` and pure files in `engine/core`. Never backends, the sim, tools, kits or games.
- Pure: listed in `PURE_CORE` in `config/layers.js` (no clock, DOM or `Math.random`).

## How to test

Tests sit next to the code (`*.test.ts`) and run with `pnpm test`. Each schema is tested with good
and broken inputs, checking the file name, the exact `path` and the error `code`.
