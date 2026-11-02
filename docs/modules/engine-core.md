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
- `rules.ts`: named rules for mutant checks (`defineRules`, `RuleSwitch` with `isOn(id)`,
  `unknownRules`). Pure.
- `gfx/renderer.ts`: the presentation contract (`Renderer`, `Rotation`, `transformed`,
  `translucent`, `clipped`, `OffsetRenderer`). Backends implement it.
- `gfx/`: `palette.ts` (the `NES` colour names), `spritesheet.ts`, `pixelart.ts`, `animation.ts`,
  `screen.ts` (`SCREEN_W`, `SCREEN_H`, `fitGame`).
- `input/`: actions, bindings, `input-manager.ts`, `scripted-input.ts` (`ScriptedInput` for repeatable
  runs) and the browser sources (keyboard, gamepad, touch).
- `audio/`: `mml.ts` (MML compiler), `sequencer.ts`, `apu.ts`, `audio-manager.ts`.
- `audio/song-schema.ts`, `gfx/sprite-schema.ts`: the song, sound-effect and sprite file schemas.
- `content/`: reading and checking content files; see [engine/core/content](engine-core-content.md).
- `save/`, `assets/`, `a11y/`, `math/`, `platform.ts`.

## Imports allowed

- Other files in `engine/core` (relative paths) and npm packages.
- Never `engine/backends`, `engine/sim`, `engine/tools`, kits or games.
- Files on `PURE_CORE` in `config/layers.js` must stay pure: no `Math.random`, `Date.now`,
  `performance.now` or DOM globals.

## How to test

Tests sit next to the code as `*.test.ts` and run in Node with `pnpm test`, using fakes for canvas,
audio and DOM. `tests/architecture/purity.test.ts` and `no-content.test.ts` guard purity and the
no-content rule.
