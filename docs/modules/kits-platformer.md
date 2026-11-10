# kits/platformer

Folder: `kits/platformer`. Detailed rules: [`kits/platformer/CLAUDE.md`](../../kits/platformer/CLAUDE.md).

## Purpose

Gameplay rules for a side-scrolling platformer (Engine 0.5), extracted from SMBC as rules only,
with generic names and no SMBC content. Today it holds the kit's content kinds: `level` (a JSON
header plus a `.map.txt` text grid of the kit legend) and `profile` (physics numbers in whole
sub-pixel and 1/4096 px per tick units, and actor types such as `walker` and `shell` whose
behaviour is set by data), and a headless world (`PlatformerWorld`) that moves the player over a
level with SMBC-style whole-number physics and named, switchable movement rules, and plays a whole level: coins, bump blocks
and bricks, hazards and pits, data-set walker and shell enemies (stomps, kicks, harm), hit points
with invulnerability, lives, the scroll lock and a `cleared` or `failed` outcome, with a JSON-safe
snapshot and `platformerGame(world)` for the headless contract. Movement feel is data too (Engine 0.16 T1): the profile's optional `coyote` (ticks after
walking off a ledge in which a jump still takes off; rule `coyote-time`) and `jumpCut` (the upward
speed cap when jump is let go while rising; under `variable-jump`) sit beside `jumpBuffer` and the
tiers' `holdGravity`, all off when left out. The legend's `K` is a checkpoint (rule
`checkpoints`): touching it makes it current (`checkpoint` event; the snapshot's `checkpoint`
`{ col, row }` or null, only in a level that has one), and a death with lives left respawns there
instead of at the start (coins, used blocks, broken bricks and actors stay as they are);
`checkLevel` reports a checkpoint with no ground under it (`checkpoint_no_ground`). Its mini game hook: a level's `!`
trigger starts a mini game the game supplies by id (`engine/core/minigame.ts`), the level pauses
while it runs (the round sees the input through the engine's `RoundInput`: a button held into the
trigger is ignored until released, and the def's `inputMap` applies; it is handed the level's HUD
values its def's `hostStatus` names; Engine 0.11, gaps G18 and G19), its snapshot sits in the level's, and the trigger's data-set outcome for its
`pass`, `fail` or `quit` applies (coins, a life, clear, respawn on the trigger, open a tile); an
optional `look` on the entry (Engine 0.11, gap G13) is presented as the tag `look:<id>` on the
trigger, for a skin's `byTag`. On
the tick a round ends the snapshot keeps it as `endedRound` (its result, final state with its last
events, and report; Engine 0.10, gap G20), so a run file can check a round's last tick.
The kit's hook lists each trigger's `game` and `params` (`miniGameUses`, Engine 0.10), so
`pnpm cli validate` checks them against the mini games a game's headless entry exports.
Its presentation (`presentWorld`) describes each tick as a read-only `PresentFrame` (terrain map
sent through a `MapTracker`, runner, actors, coins, goals, checkpoints (the current one tagged
`active`), triggers, block bounces and remains,
placed events, HUD status and a camera hint carrying the scroll lock) for a backend to draw.
Its level sequence (`LevelSequence`, Engine 0.7) plays a game's levels one after another as the
headless contract: a pause after `cleared` or `failed`, then the next level or the same one
afresh, each a new world with the run's seed, switched-off rules and mini games (from Engine 0.14,
gap G9, it can start at a later stage: a run file's `start: { "stage": n }`, through
`startStage` and `stageStarts`); its snapshot is
the world's plus `stage` and `pause`, and it is a `HostedGame` (`miniGame()`, Engine 0.10 gap
G37), so the shell's `HostScene` takes it as it is. It never draws and holds no content beyond tiny test fixtures.

## Public API entry points

`index.ts`, imported as `@kits/platformer`, re-exports `legend` (`LEGEND`, the level text format),
`level` (`levelSchema`, `LevelDef`, `LevelTrigger`, `TRIGGER_OUTCOMES`, `levelCells`, `levelSize`, `checkLevel`), `profile`
(`profileSchema`, `ProfileDef`, `profileKind`, `SUB`, `VEL`), `schema` (`levelKind`), `rules`
(`PLATFORMER_RULES`, `MOVEMENT_RULES`, `OBJECT_RULES`, `MINI_GAME_RULES`), `tiles` (`TileGrid`), `body` (`Body`, `moveX`, `moveY`), `player`
(`Player`), `actor` (`Actor`), `world` (`PlatformerWorld` with its `miniGames` option, `PlatformerEvent`, `Outcome`, `TriggerState`, `MiniGameRun`, `EndedRound`) and `snapshot` (`snapshotWorld`,
`platformerGame`, `snapshotEndedRound`, `EndedRoundSnapshot`) and `present` (`presentWorld`, `PlatformerPresentState`, `platformerFrames` (the `FrameSource` for
the engine's `FrameStream`), `presentMap`,
`presentStatus`, `cameraHint`, `PRESENT_TILES`, `PF_DEPTH`) and `sequence` (`LevelSequence`,
`LevelSequenceOptions`, `LevelStage`, `levelStages`, `levelsInPlayOrder`, `contentStages`
(a bundle's levels in play order with their profiles, Engine 0.7 T9: the order of the game's
`campaign` file when it has one, Engine 0.10, else by id), `LEVEL_PAUSE`, `SequenceSnapshot`). `kit.ts` exports `kit`, the kit's hook for the tools (name `platformer`,
kinds `level` and `profile`, its named rules, `strictMutants: true`); `engine/tools/kits.ts` finds
it by the `kit` name in `game.json`.

## Imports allowed

- `kits/platformer` itself and `@engine/core/*` except its drawing and output side
  (`FORBIDDEN_CORE` in `config/layers.js`).
- Tests may also use `@engine/backends/null`.
- Never other backends, `engine/sim`, `engine/tools`, other kits or games. No drawing calls, no
  `Math.random`, wall-clock time or DOM globals, no content outside `__fixtures__/`.

## How to test

`pnpm test kits/platformer` runs the schema tests and loads the fixture level and profile
(`kits/platformer/__fixtures__/`) through the kit's hook; `world.test.ts` covers the movement rules (each switched off must fail a
case), determinism and whole-number snapshots; `objects.test.ts` covers the level objects and
enemies the same way and plays the fixture level from start to goal; `minigame.test.ts` covers the
mini game hook with a test-only mini game (pass, fail, quit, determinism, the rule off);
`sequence.test.ts` covers the level sequence (cleared -> next,
failed -> same, wrap-around, the pause ignoring input, rules given to every world);
`present.test.ts` checks that presenting every tick leaves the state hashes alone, that every
frame of the fixture playthrough passes `presentFrameSchema` and survives `freezeFrame`, when the
map is sent in full, and the animation states, tags, remains, camera and mini-game frames; `golden.test.ts` replays six scripted inputs and
must match SMBC's recorded player positions and velocities at every tick (the traces and their
provenance are in `kits/platformer/__fixtures__/golden/`; SMBC is not needed to run it). `pnpm docs:gen` keeps the kinds in
`docs/reference/schemas.md`; the architecture tests (`tests/architecture/`) check its imports,
drawing calls, content and agent docs.
