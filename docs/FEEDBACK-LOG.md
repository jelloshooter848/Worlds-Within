# Feedback log

Whenever Claude needs the owner's feedback or a decision, each item gets a unique number. Numbers
continue across conversations and are never reused, so the owner can answer by number. Every item and
its outcome is recorded here (see `CLAUDE.md`).

**Next unused number: 45.** (Last used: 44.)

| #   | Item                                                  | Answer                                                                          |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| 8   | Mini siege at Engine 0.11                             | Accepted                                                                        |
| 9   | 0.15 sample set release                               | Accepted                                                                        |
| 10  | Tower defense split                                   | Accepted                                                                        |
| 11  | Civilization/hero split; RTS hero unit decided at 0.9 | Accepted                                                                        |
| 12  | Mini siege mission                                    | Answered by 23                                                                  |
| 13  | All four kit samples required for 1.0                 | Yes                                                                             |
| 14  | Stacking-test game and demo grow into samples         | Yes                                                                             |
| 15  | Samples' art style                                    | Answered by 22                                                                  |
| 16  | Engine 1.0 API public or internal                     | Internal                                                                        |
| 17  | Approve roadmap and merge to master                   | Owner still revising                                                            |
| 18  | Add numbering rule to CLAUDE.md                       | Yes (done)                                                                      |
| 19  | Tower-defense prep phase in the mini siege at 0.12    | Accepted                                                                        |
| 20  | Tag names and PixiJS timing                           | Accepted; tags are always three-part, e.g. engine-v0.5.0, so patch releases fit |
| 21  | Branch for the autonomous build                       | One build branch, engine/build-0.15; nothing merged to master                   |
| 22  | Art, music and 3D style                               | NES-style pixel art as text, MML chiptune, procedural low-poly meshes           |
| 23  | Mini siege mission (answers 12)                       | Sabotaging siege engines                                                        |
| 24  | Publishing during the build                           | No publishing and no tags during the build                                      |

Items 1–7 came from an earlier review list (decisions such as the stacking-test scope, the split base
layer, the PixiJS timing and the sim location). All were accepted except item 4, which was a question
about the world simulation that has since been answered.

## Build decisions to review

Choices the autonomous build made that the owner should check. Answer by number.

**Engine 0.2**

- **25.** The root `CLAUDE.md` was changed by the build: the "code is in `src/`" line now describes
  `engine/`, `kits/` and `games/`, and a new line describes the dependency table. Keep this wording?
- **26.** Stricter than the roadmap: a game, kit or backend may not import a sibling in the same layer
  (DESIGN.md already said "never other games/kits"). Keep?
- **27.** One exception to the layer table: any `*.test.ts` may import `engine/backends/null`, so kit
  and game tests run headless. Keep, or should those tests use a local no-op renderer?
- **28.** Only part of `engine/core` is pure (the list `PURE_CORE` in `config/layers.js`); audio output,
  saving, browser input, `touch-logic.ts` and `save/settings.ts` are not. `new Date()` is not banned,
  only `Date.now`. OK?
- **29.** New top-level tooling folders `build/` (page discovery, launcher) and `config/` (layer table,
  checker, ESLint plugin, plain JS with `@ts-check`; `tsconfig.json` gained `allowJs`). OK?
- **30.** The kit still draws (`render.ts`, `hud.ts`, `draw` methods), recorded as debt in
  `kits/topdown/CLAUDE.md`. Which release should remove it?
- **31.** The NES colour-name table stays in `engine/core/gfx/palette.ts` as engine data, though some
  names are themed (`mushroomRed`, `greenPipe`). Rename them later, or keep?

**Engine 0.3**

- **32.** The demo gained an original hero sprite sheet and a palette (with a new `palette` content
  kind), so the sprite kind is used by real content; the roadmap only said to move existing sprites.
  Keep?
- **33.** The CLI keeps the name `pnpm cli` (the roadmap said the name could change). Agents use
  `pnpm -s cli ... --json` so pnpm's banner stays off stdout. Keep the name?
- **34.** Beyond the roadmap's command list, the CLI has `help` and `mutants`, and `game.json` gained
  an optional `view` entry (the module `screenshot` draws with). OK?
- **35.** `.claude/skills/` is committed while the rest of `.claude/` stays git-ignored. OK?
- **36.** The scaffold skill covers only the top-down kit, the only kit so far. Should each new kit
  add its own section to the one skill, or get its own scaffold skill?
- **37.** The hand-check game (`games/hand-check`) was deleted after the check rather than kept as
  a fixture, since the demo covers every file it had. OK, or keep a minimal game as a scaffold
  fixture with its own test?
- **38.** CI installs Chromium (`playwright install --with-deps chromium` in the workflow) and the
  screenshot test is required there; locally it skips without a browser. OK?
- **39.** Each `AGENTS.md` is a one-line pointer to the folder's `CLAUDE.md`, not a copy, so the
  text lives in one place. OK?
- **40.** The demo's screenshot includes debug text in a system font, so PNGs match on one machine
  but may differ between machines; no golden PNG hash is committed (state hashes are still checked).
  OK, or remove the debug text from screenshots?
- **41.** `mutants` reports weak rules but still exits 0 (only a run that fails as it is exits 4).
  The demo's run guards only `doors-change-room`. Make weak rules fail from Engine 0.5?
- **42.** `set` only changes a value that exists; new keys need `add`, so a typo in a path is an
  error instead of a new field. OK?
- **43.** Added an `sfx` content kind (not asked for) so sound effects can move into data files.
  Songs and sfx are JSON only, with no `.txt` form for MML yet. OK?
- **44.** The tools learn each kit's content kinds and rules from a table in `engine/tools/kits.ts`
  that knows only the top-down kit's default room legend. Replace it with a hook each kit provides
  when the next kit arrives (0.5)?
