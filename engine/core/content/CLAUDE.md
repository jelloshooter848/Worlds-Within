# engine/core/content

The content core: a pure, typed way to read and check content files (songs, sprites, and later
rooms and missions). It never touches the file system: every function takes a file name and a
string or an already-parsed object, so the CLI, tests and the browser all share it.

- `validate.ts`: `validate(fileName, data, schema)` runs a Zod schema and returns
  `{ ok: true, value }` or `{ ok: false, errors }`. Each `ContentError` is
  `{ file, path, pointer, message, code }`, plus `row`/`col` for text grids (and `col` for the
  position in an MML string) and `line` for `.txt` files. `path` is dotted (`frames.idle.2`,
  `legend["#"]`); `pointer` is the same field as a JSON pointer (`/frames/idle/2`). Unknown keys
  are reported one per key at the key itself. A union where every option but one failed only on
  the value's type (a string option given an object) reports that option's errors, at their field. `formatErrors` prints one line per error.
- `text-grid.ts`: `parseTextGrid(rows | text, legend)` for content drawn as rows of characters.
  It rejects ragged rows (`ragged_row`), characters missing from the legend (`unknown_char`) and
  empty grids (`empty_grid`), each with a 0-based `row` and `col`. `addGridIssues` does the same
  check inside a Zod `superRefine`, so a schema reports grid problems at `<field>.<row>`.
- `kinds.ts`: a content-file kind is `{ name, description, schema, readText?, writeText?, gridParts?, checkAll? }`
  (`writeText` writes checked data back in the `.txt` form, for the CLI's editing verbs). Give every
  schema field a `.describe('...')`: it is the field's line in the generated schema reference
  (`docs/reference/schemas.md`, `pnpm docs:gen`), and a new kind needs an example in
  `docs/reference/examples/`. `parseContent`
  reads `.json` with `JSON.parse`, or `.txt` with the kind's `readText`, then validates. A
  `.txt` reader returns a map of JSON pointers to lines, so errors also carry the line.
  `ContentKinds` is a registry by name. `gridParts` (field -> suffix, such as
  `{ map: '.map.txt' }`) keeps a field of a `.json` file in a sibling text grid; `parseContent`
  takes those parts' texts, and an error in the field names the part file and its line.
  `checkAll(entries)` checks across every file of the kind (the top-down rooms' doors and player
  start, a skin's sheets and sounds): its second argument, `others(kind)`, gives the game's
  checked entries of any other kind, for references across kinds (`others(ANY_KIND)`, Engine 0.13:
  every entry of every kind, for a check that finds content by its shape, such as a campaign's
  world scenarios). It returns `KindIssue`s (`{ name, path, code, message, row?, col? }`, `name` being the
  entry's file name), and `loadContent` runs it only when the game has no other error, turning
  each into a `ContentError` at that entry's file, or its part file and line (`checkAll: false`
  in `loadContent`'s options leaves it out; the editing verbs report those problems apart).
- `manifest.ts`: `gameManifestSchema`, the shape of a game's `game.json`: `id`, `title?`, `kit`,
  `uses?` (more kits whose content kinds the game also holds, beside `kit`'s: a platformer game
  with `"uses": ["topdown"]` holds `room` files; kinds only, the rules stay `kit`'s; the tools
  merge the kinds, see `engine/tools/game-check.ts`), `content` (kind -> paths or globs relative to the game folder), `start` (`{ seed }`), `screen`
  (`{ width, height }`, whole numbers 64..1920, default 256x240: the game picture's size) and
  `headless` (the module that boots the game headless) and `view?` (the module that draws it, for
  `screenshot`; `engine/core/view.ts`).
- `bundle.ts`: `loadContent(files, kinds, { root })` turns `{ path: text }` pairs (from Vite's
  `import.meta.glob` in the browser, `../node/game-files.ts` in Node) into a `ContentBundle`
  (`{ manifest, entries }`); `contentOf(bundle, kind)` and `contentNamed` give typed entries. An
  entry's name is its file name up to the first dot; an `id` field must match it.
- `engine-kinds.ts`: `engineContentKinds()`, a registry with the engine's own kinds: `song` and
  `sfx` (`audio/song-schema.ts`), `palette` (`gfx/palette-schema.ts`), `sprite`
  (`gfx/sprite-schema.ts`, JSON or `.txt`), `skin` (`present/skin.ts`) and `mission`
  (`missions.ts`, `*.mission.json`, Engine 0.10: a game claims them under `content.mission`) and
  `campaign` (`campaign.ts`, `*.campaign.json`, Engine 0.10 T10, gap G2: the order a game plays its
  levels or missions in; claimed under `content.campaign`), each also exported (`SONG_KIND`, ...,
  `SKIN_KIND`, `MISSION_KIND`, `CAMPAIGN_KIND`) for `contentOf`.
- `game-content.ts` (Engine 0.7 T9, gap G4 in `docs/reports/stacking-test.md`): the content glue
  every game wrote for itself. `kitContentKinds(kits)`: the engine's kinds plus each kit hook's
  `kinds()` (`import { kit } from '@kits/<name>/kit'`, `game.json`'s `kit` then `uses`; throws on a
  clash), the same set the tools build from the manifest. `contentArt(content)` (sprites and
  palettes by id, for the asset registry), `contentSfx(content)`, `contentSongs(content)` (Engine 0.11, for the shell's `audio` option) and `mustLoad(result, who?)`
  (the bundle, or one error listing every problem).

The schemas for engine data live next to the code that uses the data, not here:
`audio/song-schema.ts` (the `Song` and `Sfx` shapes, and every channel must compile as MML) and
`gfx/sprite-schema.ts` (text-grid pixel art with a palette legend, read into a `SpriteDef`; its
file formats are described at the top of that file).

## Rules

- Pure: this folder is `engine/core/content/**` in `PURE_CORE` (`config/layers.js`), as are the
  three schema files. No file IO, no DOM, no clock, no `Math.random`. Import only `zod` and other
  pure core files (`tests/architecture/purity.test.ts` checks the closure). Reading a game folder
  from disk is `engine/core/node/game-files.ts` (`readGameFiles`), which is Node only and not pure.
- Bad content never throws: every problem is a `ContentError`. Throw only for programming errors
  (a legend key longer than one character passed by code, a kind registered twice).
- Error codes are part of the contract: tools and tests match on them. Keep Zod's codes as they
  are and add content codes in `snake_case`. When you add a code, document it here.
  Content codes so far: `ragged_row`, `unknown_char`, `empty_grid`, `invalid_mml`, `no_channels`,
  `no_frames`, `bad_legend_key`, `invalid_json`, `unsupported_extension`, `unknown_kind`, and the
  sprite `.txt` reader's `row_outside_frame`, `unknown_directive`, `duplicate_frame`,
  `duplicate_legend`; the parts' `duplicate_field`; the loader's `missing_file`, `no_match`,
  `claimed_twice`, `unclaimed_file`, `duplicate_name` and `id_mismatch`; the CLI loader's
  `unknown_kit`, `duplicate_kit` and `kind_clash` (at `kit` or `uses.<i>` in `game.json`:
  `engine/tools/game-check.ts`); the editing verbs' `not_writable` and
  `multiline_row` (`engine/tools/content-file.ts`); and the top-down kit's room codes `wrong_size`
  and `invalid_room` (`kits/topdown/schema.ts`); the platformer kit's level codes `bad_spawn_key`, `size_mismatch`,
  `wrong_block_count`, `no_start`, `two_starts`, `no_goal`, `missing_profile` and `unknown_actor`
  (`kits/platformer/level.ts`) and profile codes `bad_jump_tiers`, `bad_speed_caps`,
  `unknown_actor` and `missing_field` (`kits/platformer/profile.ts`); the RTS kit's `unknown_type` (a plan naming a type no types table has, `kits/rts/schema.ts`); the tower-defense kit's map codes `bad_legend_char`, `duplicate_tower`, `no_entry`, `two_entries`, `no_exit`, `two_exits`, `path_broken`, `path_branch` and `path_off_walk`, and from its `checkAll` `unknown_tower`, `unknown_waves` and `duplicate_tower` (a tower type in two `td-towers` files) (`kits/towerdefense/schema.ts`); the skin's `wrong_backend_field`, `missing_field`,
  `missing_ref`, `missing_frame` and `bad_event_key` (an `events` key not of the form `type`,
  `type:value` or `type:field=value`, Engine 0.11) (`present/skin.ts`); the mission's `duplicate_outcome` (an
  outcome id, or a `playable` id, given twice), `unknown_outcome` (`onQuit` or a `playable` id that
  is not a declared outcome) and `bad_effect` (an `opportunity` effect without exactly one of
  `open` and `close`) (`missions.ts`); the campaign's `bad_entry` (an entry without exactly one of
  `level`, `mission` and `scenario`, or `ticks` on anything but a scenario entry or missing on one),
  `duplicate_entry`, `unknown_entry` and `ambiguous_start` (a `start` that names no entry, or
  entries of two kinds), and from its `checkAll` `missing_level`, `missing_mission`,
  `missing_scenario` and `bad_from` (a follow-up scenario whose `from` is not the scenario entry
  before it) (`campaign.ts`, Engine 0.13 for the scenario codes); and `unknown_mini_game` (a level trigger's `game` or a
  mission's `play` that names no mini game the game's headless entry exports;
  `engine/core/minigame-params.ts`, run by `validate`).
- Games add kinds for their own content (rooms, missions) with `ContentKinds.register`; the
  engine's kinds stay generic. Content itself (real songs, sprites) never lives here.
- Use `z.strictObject` for file shapes, so a misspelled field is an error, and `exactOptional()`
  for optional fields, so the output matches the engine types under `exactOptionalPropertyTypes`.

## Testing

Each schema has tests next to it with good and broken inputs that check the file name, the exact
`path` and the `code`: `validate.test.ts`, `text-grid.test.ts`, `kinds.test.ts`, `bundle.test.ts`,
`gfx/palette-schema.test.ts`, `missions.test.ts`, `campaign.test.ts`,
`audio/song-schema.test.ts`, `gfx/sprite-schema.test.ts`. Run them with `pnpm test`.
