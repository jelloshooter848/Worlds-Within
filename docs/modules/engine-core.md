# engine/core

Folder: `engine/core`. Detailed rules: [`engine/core/CLAUDE.md`](../../engine/core/CLAUDE.md).

## Purpose

The engine's core, shared by every backend, kit and game: the fixed-step loop, scenes, input,
chiptune audio and MML, save and settings, the seeded RNG, maths, asset packs, accessibility,
platform detection and graphics data (palettes, sprite sheets, text pixel art, animation, screen
size and fit maths). It holds no game rules and no game content.

## Public API entry points

There is no `index.ts`; import the file you need as `@engine/core/<path>`.

- `loop.ts`: `FixedLoop`, `Stepper` (the fixed-step loop).
- `scene.ts`: `Scene`, `SceneStack`.
- `rng.ts`: `Rng`, the seeded RNG. All randomness in kits and the sim goes through it.
- `headless.ts`: the headless game contract (`HeadlessGame`: `step(input)`, `snapshot()`;
  `HeadlessEntry`: `createGame(content, seed, opts?)`, `HeadlessOptions` with `disabledRules`),
  `JsonValue` and `canonicalJson` (sorted keys, the text state hashes are made from).
- `view.ts`: the view contract for screenshots (`ViewGame`: a `HeadlessGame` plus `screen`, the
  picture size from the manifest, and `render(r)`;
  `ViewEntry`: `createView(content, seed, opts?)`), named by `view` in `game.json`.
- `rules.ts`: named rules for mutant checks (`defineRules`, `RuleSwitch` with `isOn(id)`,
  `unknownRules`). Pure.
- `kit.ts`: the kit hook (`KitDef`: `name`, `kinds()`, `rules`, `strictMutants?`; `defineKit`
  checks it). Each kit exports one as `kit` from `kits/<name>/kit.ts`. Pure.
- `gfx/renderer.ts`: the drawing interface (`Renderer`, `Rotation`, `transformed`,
  `translucent`, `clipped`, `OffsetRenderer`). Backends implement it.
- `gfx/`: `palette.ts` (the `NES` colour names), `spritesheet.ts`, `pixelart.ts`, `animation.ts`,
  `screen.ts` (`ScreenSize`, `DEFAULT_SCREEN` 256x240, `SCREEN_MIN` / `SCREEN_MAX`, `fitGame(size, ...)`).
- `input/`: actions, bindings, `input-manager.ts`, `scripted-input.ts` (`ScriptedInput` for repeatable
  runs) and the browser sources (keyboard, gamepad, touch).
- `audio/`: `mml.ts` (MML compiler), `sequencer.ts`, `apu.ts`, `audio-manager.ts`.
- `audio/song-schema.ts`, `gfx/sprite-schema.ts`: the song, sound-effect and sprite file schemas.
- `content/`: reading and checking content files; see [engine/core/content](engine-core-content.md).
- `present/`: the presentation contract, the read-only frame a backend draws from; see
  [engine/core/present](engine-core-present.md).
- `assets/`: the sprite sheet registry (`registry.ts`), asset packs, and `sheet-lookup.ts`
  (`sheetLookup(assets)`, a `SheetLookup` that returns null instead of throwing for a missing sheet
  or palette; backends and games use it).
- `save/`, `a11y/`, `math/`, `platform.ts`.

## Imports allowed

- Other files in `engine/core` (relative paths) and npm packages.
- Never `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- Files on `PURE_CORE` in `config/layers.js` must stay pure: no `Math.random`, `Date.now`,
  `performance.now` or DOM globals.

## How to test

Tests sit next to the code as `*.test.ts` and run in Node with `pnpm test`, using fakes for canvas,
audio and DOM. `tests/architecture/purity.test.ts` and `no-content.test.ts` guard purity and the
no-content rule.
