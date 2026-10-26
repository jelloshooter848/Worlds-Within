# Worlds Within

One persistent world, played through many genres: a living RTS simulation where any mission can be
delegated or played personally, in its own genre, with consequences that stay.

This repo is both the game and the platform it is built on. See:

- [docs/DESIGN.md](docs/DESIGN.md): what the game is and the decisions so far
- [docs/ROADMAP.md](docs/ROADMAP.md): the planned releases
- [docs/design/conversation.md](docs/design/conversation.md): the original design conversation

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

| Path               | What it is                                                               |
| ------------------ | ------------------------------------------------------------------------ |
| `src/engine`       | Loop, scenes, renderer, input, chiptune audio, save, RNG (no game rules) |
| `src/kits/topdown` | Top-down action kit: rooms from text, doors, sword hero, items, enemies  |
| `src/sim`          | The world simulation (from 0.2)                                          |
| `src/game`         | Worlds Within itself (the demo for now)                                  |

## Origin

`src/engine` and `src/kits/topdown` started as copies of the engine and top-down kit from
[SMBC REMIX](https://github.com/jelloshooter848/SMBC) v0.4.73, by the same author, under the MIT
license. Nothing else from SMBC (its levels, characters, art or music) is part of this project.

## License

MIT
