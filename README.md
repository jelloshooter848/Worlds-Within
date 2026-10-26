# Worlds Within

A small TypeScript game engine built for LLM coding assistants, and Worlds Within, the multi-genre game
it is being built for: one persistent world where any mission can be delegated or played in its own
genre, with consequences that stay.

The engine comes first: Worlds Within itself starts at 0.8. See:

- [docs/DESIGN.md](docs/DESIGN.md): what the game is and the decisions so far
- [docs/ROADMAP.md](docs/ROADMAP.md): the planned releases
- [docs/design/conversation.md](docs/design/conversation.md): the original design conversation
- [docs/research/prior-art.md](docs/research/prior-art.md): other LLM-first engines and tools, and what to borrow

## Run it

```sh
pnpm install
pnpm dev          # http://localhost:5173
```

The current build is an engine demo: three top-down rooms with placeholder art and an original
song. Arrows move, **Z** / **X** use the sword, **C** uses the selected item.

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Layout

The repo moves to its target layout in 0.2 (see [docs/ROADMAP.md](docs/ROADMAP.md)).

| Now                | Target (from 0.2)                                   | What it is                                                             |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------------------------- |
| `src/engine`       | `engine/core`                                       | Loop, scenes, input, chiptune audio, save, RNG (no game rules)         |
| `src/engine/gfx`   | `engine/backends/canvas2d`, `engine/backends/null`  | Drawing (2D now; Three.js 2.5D/3D from 0.6), and the headless renderer |
| (none)             | `engine/tools`                                      | The CLI for LLMs and people: validate, run, dump, screenshot (0.3)     |
| (none)             | `engine/sim`                                        | The optional world simulation (0.8)                                    |
| `src/kits/topdown` | `kits/topdown`, later `kits/platformer`, `kits/rts` | Gameplay rules: rooms, doors, heroes, enemies. Kits never draw         |
| `src/game/demo`    | `games/demo`                                        | The current demo: content, skins and a thin entry point                |
| (none)             | `games/platformer-test`, `games/worlds-within`      | The stacking-test game (0.7) and Worlds Within itself (0.9+)           |

Games depend on the engine; the engine never imports from games.

## Origin

`src/engine` and `src/kits/topdown` started as copies of the engine and top-down kit from
[SMBC REMIX](https://github.com/jelloshooter848/SMBC) v0.4.73, by the same author, under the MIT
license. Nothing else from SMBC (its levels, characters, art or music) is part of this project.

## License

MIT
