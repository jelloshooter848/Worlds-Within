# engine/core/present

The presentation contract (docs/DESIGN.md, section 6; docs/ROADMAP.md, Engine 0.4): the read-only
snapshot a backend gets each frame. A kit describes what is there; a backend decides how it looks,
from the frame and a skin. Types and small pure helpers only: no drawing, no kit or backend code.

- `types.ts`: `PresentFrame` `{ frame, size, entities, map?, events, status, camera?, fog? }`
  (`fog`, Engine 0.16 part D, D3: `PresentFog`, see `fog.ts` below).
  - `PresentEntity` `{ id, kind, x, y, w, h, facing, anim: { state, t }, tags, layer?, fx? }`:
    `id` is stable across frames; `x`/`y`/`w`/`h` are the box in world pixels (top-left); `facing`
    is one of `FACINGS`: `up | down | left | right` or (Engine 0.9, owner answer 128 to item 48)
    a diagonal `up-left | up-right | down-left | down-right`; `anim.t` is ticks since the state
    began. Four-way kits (topdown, platformer) keep emitting cardinals only.
  - Facing helpers (pure): `cardinalFacing(f)` (a diagonal's horizontal part: `up-right` gives
    `right`), `mirrorFacing(f)` (left to right: `up-left` gives `up-right`) and `facesLeft(f)`
    (`left`, `up-left`, `down-left`).
  - `map` is either the full `PresentMap` `{ id, version, tileSize, cols, rows, tiles, layers?, tags? }`
    (`tiles` as text rows or a grid of tile ids; `tags?` free labels such as `dark`) or only a `PresentMapRef` `{ id, version }`.
    `isFullMap(map)` tells them apart. Bump `version` whenever any tile changes. From Engine 0.16
    part C T4 a full map may list `parts` (`PresentMapPart` `{ id, col, row, cols, rows, tags? }`,
    in tiles): the maps it is made of, each at its place (the top-down kit's room slide lists its
    two rooms), so a skin's per-map looks (lighting's placed lights and darkness) follow each part.
  - `PresentEvent` `{ type, x?, y?, entity?, ...any JSON-safe fields }`: this frame's events, for
    a skin's sounds and effects.
  - `status`: HUD values, `Record<string, number | string | boolean>`.
  - Extension points, all optional and all ignorable by a backend: `camera` (`CameraHint`
    `{ x, y, zoom?, follow?, shake?, deadzone?, lerp?, bounds? }`: `deadzone`, `lerp` and `bounds`
    override the skin's camera defaults for one frame; `bounds` is a world box the view stays
    inside, for a kit-side scroll lock), `layer` (depth, drawn low to high), `fx` (`PresentFx`
    `{ squashX?, squashY?, rotate?, alpha?, tint? }`) and the map's `layers`.
  - `DeepReadonly<T>` and the `Presenter` interface: `present(frame: DeepReadonly<PresentFrame>)`
    and optional `resize(size)`, and from Engine 0.16 part C T1 optional `showHud(shown)`
    (whether the skin's HUD is drawn from the next frame: the shell hides it under its title;
    both backends' presenters have it). Backends implement `Presenter`.
- `fog.ts` (Engine 0.16 part D, D3): fog of war as presentation. A frame's optional `fog`
  (`PresentFog` `{ cols, rows, cells }`, in `types.ts`): `rows` strings of `cols` characters, one
  per map tile, `0` unexplored, `1` explored (seen before), `2` visible (`FOG_CELLS`,
  `FOG_CELL_CHARS`); `presentFrameSchema` checks the characters and the grid's size (each field
  `.describe`d). Plain string rows, not run-length: a 64 x 64 map is 4 KB a frame, and a kit
  diffing it is not worth the reader's trouble. A skin's top-level `fog` (`fogLookSchema`, on any
  backend; only the 2D walk and the minimap draw it): `{ unexplored?: { color?, alpha? }, explored?:
{ color?, alpha? }, edge? (0-FOG_EDGE_MAX 16 world px) }`; a bad field is a schema error at its
  path (`fog.explored.alpha`). `resolveFogLook(look)` fills `DEFAULT_FOG_LOOK` (unexplored
  `#000000` at 1, explored `#000000` at 0.5, no edge), so a frame with `fog` and a skin without
  one still shows it. `fogState(fog, col, row)` (outside the grid or another character:
  `visible`), `fogShade(look, state)` and `fogBoxes(fog, look, tileSize)`: the boxes to lay over
  the picture in world px, each row's run of one state merged; with an `edge` (cut to half a
  tile) a cell beside a lighter one (four sides; outside the grid counts as the same) is nine
  boxes that never overlap: the middle at its alpha, each strip toward a lighter neighbour at the
  alpha halfway to it, corners at the lower of their two strips'. Alpha 0 boxes are left out.
  The 2D walk (`engine/core/draw`) draws them; nothing here draws. A `minimap` HUD item's `fog`
  (boolean), `teams` (tag -> colour) and `view` (a colour) are schema fields of `skin.ts`
  (`bad_field` on another item); the UI kit draws them. Tested in `fog.test.ts`.
- `readability.ts` (Engine 0.16 part D, D4: readable at every zoom): three 2D kind fields, all
  default off, in `SPRITE_FIELDS` (`wrong_backend_field` on a 3D skin), each `.describe`d:
  `outline` (`outlineSchema`: a colour or `"team"`, `OUTLINE_TEAM`; also on a `byTag` look,
  `TAG_SPRITE_FIELDS`), `team` (`teamSchema`: `{ prefix? (default `DEFAULT_TEAM_PREFIX`,
`faction:`; `""`reads whole tags such as`own`), colors: { <name>: colour } (at least one),
mask? | hue?: { min, max } (degrees, wrapping when min > max) }`; both `mask` and `hue` is
  `bad_team`) and `screenScale` (`screenScaleSchema`: `{ min?, max?, anchor? }`, `anchor` one of
  `SCREEN_SCALE_ANCHORS` `center` (default), `top`, `bottom`; `min` above `max` is `bad_range`).
  `skinSchema` adds `checkTeamOutlines`: `outline: "team"` on a kind (or look) whose kind has no
  `team` is `missing_field`. Pure readings: `skinTeamColor(entry, tags)` (the first of the
  entity's tags `<prefix><name>` with a colour, else null), `skinOutlineColor(entry, tags)`,
  `screenScaleAt(spec, zoom)` (the zoom held in `[min, max]`) and `screenScalePivot(anchor, box)`.
  The 2D walk (`engine/core/draw`) draws them; tested in `readability.test.ts`.
- `freeze.ts`: `freezeFrame(value)` deep-freezes a frame in place and returns it as
  `DeepReadonly`, so a backend that writes to it throws. Use it in tests and dev; it is not needed
  per frame in a release build.
- `map-tracker.ts`: `MapTracker.next(map)` returns the full map on the first frame and when the
  map's id or version changes, otherwise `{ id, version }`. `reset()` sends it again next time.
  Use one tracker per stream of frames.
- `schema.ts`: `presentFrameSchema`, a Zod schema for tests and tools (not run per frame). It
  checks finite numbers, that a full map's tiles (and layers) are `rows` x `cols`, and that event
  fields are JSON-safe. Unknown fields are errors everywhere except on events.
- `skin.ts`: skin files, the engine's `skin` content kind (`SKIN_KIND`, registered in
  `content/engine-kinds.ts`). One JSON file per backend: `{ backend, background?, sheets?, kinds,
tiles?, events?, hud?, camera?, meshes?, camera3d? }`. `background` (Engine 0.15, gap G36,
  decision 3) is the colour (`#rgb` or `#rrggbb`) the backend clears to before each frame it draws
  with that skin: `skinBackground(skin)` gives it, else `DEFAULT_BACKGROUND` (`#000`, the black
  every skin had before). Both backends clear through it (a presenter's own `background` option
  still wins, for a caller that must override it), and each skin of a skin set clears to its own,
  so a hosted round keeps its skin's (black by default). The platformer games' sky and the RTS,
  tower-defense and mini siege grass are their skins' `background`, no constant in glue. `sheets` gives defaults (`sheet`, `palette`, `fallbackColor`) for
  entries that leave them out. A kind entry is 2D (`sheet`, `palette?`, `frames`, `flipFacing?`,
  `size?`, `fallbackColor`, `offset?`) or 3D (`mesh`, `color`, `scale?`, `depth?`, `z?`,
  `offset?`), either with an optional `byTag` list (below); a tile entry 2D (`sheet?`, `frame`, `fallbackColor`) or 3D (`mesh`, `color`,
  `depth?`, `z?`). The backend picks which (`MESH_BACKENDS`, today `three`), and a field of the
  other shape (including the skin-level `meshes` and `camera3d` on a 2D skin) is a
  `wrong_backend_field` error, a needed one left out `missing_field`. `frames` maps an animation
  state to a frame name, a cycle `{ frames, ticks? (default 8), loop? }` or a per-facing map
  of names or cycles, keyed by any of the eight facings, all optional. `tiles` maps a tile character or id to
  `{ sheet?, frame, fallbackColor }`; `events` maps an event type to `{ sound?, effect? }`
  (`effect.kind`: `flash`, `particles`, `shake`, `tint`); a key may also match one of the event's
  fields (Engine 0.11, gap G28, item 180): `type:value` matches its `result` field
  (`EVENT_KEY_FIELD`; `mini-game-end:pass`), `type:field=value` any other
  (`mission-commit:outcome=both-burnt`); any other shape is `bad_event_key`; `hud` lists `{ status, as: hearts |
number | text | icon, x, y, sheet?, frame?, font? }`, and from Engine 0.16 T6 the UI kit's
  widgets (`as: bar | counter | panel | minimap`, and from F4 `clock`, `HUD_WIDGET_TYPES`; `HUD_CLASSIC_TYPES` are the
  four before) with their fields (`w`, `h`, `color`, `shadow`, `outline`, `align`, `format` with
  `{value}` (`HUD_VALUE_TOKEN`), `digits`, `gap`, `tween`, `max`, `back`, `border`, `low`,
  `panel`, `slice`, `fill`, `scale`, `tiles`, `dots`, and F4's `dayBar` `{ h?, back?, bands?, marks?,
markColor?, marker? }` (a `clock` item only, else `bad_field`); `status` optional for `panel`, `minimap`, `clock`
  (there the clock's status prefix, default `clock`) and a `text` with a `format`; a `clock` needs
  `w`, `h` and a `font`, and its `format` (default `HUD_CLOCK_FORMAT`, `Day {day} {time}`) takes
  the tokens `HUD_CLOCK_TOKENS` (`{day}`, `{time}`, `{phase}`, `{text}`; `{value}` is the text),
  checked for every glyph they can show; laid out by `engine/core/ui`'s `SkinHud`). Cross-file:
  `checkSkinRefs` checks a `panel`'s frame, and the HUD's fonts: a `format` character or (for a
  number or counter) a digit a font file lacks is `missing_glyph` at `hud.<i>.format` or
  `hud.<i>.font`, a counter's or styled text's font that is neither a font nor a sprite file
  `missing_ref`. `SkinHudItem` is one `hud` entry.
  - Animation states, timing and frame events (Engine 0.16 T2): a cycle (in `frames`, a state's
    own `{ frames, ... }` or a facing's) is `{ frames, ticks?, loop?, then?, events? }`. `ticks` is
    one number for every frame or a list, one per frame (`[6, 4, 6, 4]`); `loop: false` plays it
    once and holds the last frame, and with `then` (a state of the same table, one the kit never
    sends is fine: `breathe`) hands over to that state from the tick it finished; `events` maps a
    frame index to a presentation event type (`{ "1": "footstep" }`) sent when that frame starts.
    Old cycles (one `ticks` number, no `then`) read exactly as before. A 3D kind's `poses` (a
    `MESH_FIELDS` field; `wrong_backend_field` on a 2D skin) is the same table with mesh names (a
    primitive or a `meshes` key, else `missing_ref`), so a 3D skin swaps meshes by frame and has
    the same timing and frame events; without `poses` the entry's `mesh` shows. Checks in
    `checkSkinRefs` (kinds' `frames` and `poses` and looks' `frames`): a `ticks` list not one per
    frame `bad_frame_ticks`, an `events` key that is not a frame index of its cycle (`0`..n-1, no
    leading zeros) `bad_frame_event`, and a `then` on a looping cycle or naming no state of the
    table `bad_then`. Pure helpers: `cycleFrameTicks(c, i)`, `cycleLength(c)`,
    `cyclePosition(c, t)` (`{ index, done }`); `resolveSkinAnimation(skin, entity)` (`SkinAnimation`
    `{ state, frame, index, t, flipX }`: the state shown after any `then`, the frame or mesh name,
    its index, ticks into the shown state; undefined for an unlisted kind or no table), which
    `resolveSkinFrame` uses; `resolveSkinMesh(skin, entity)` (the pose's mesh, else `mesh`); and
    `frameEventsBetween(skin, entity, prevT, t)` (`SkinFrameEvent { type, state, index, t }` for
    every frame that started in `(prevT, t]`, across a loop's wraps and into a `then` state, at most
    `FRAME_EVENT_LIMIT`, 16). A `then` back to a state already played holds, so a chain ends.
    `frame-events.ts`: `FrameEventClock`, one per presenter: `next(skin, entities)` remembers each
    entity's state and tick and gives the frame events since the last call as synthetic
    `PresentEvent`s `{ type, entity, x, y (the entity's bottom centre), state, frame, source:
'frame' }`; a new entity, a new state or a tick that went back counts from just before its tick
    now (a state's first frame fires, nothing before it does); a skin with no frame events costs one
    cached lookup. Both presenters run these through the skin's `events` (sound, effect, tween) after
    the frame's own events, once per frame number, and never write them into the frame, a kit or a
    hash. `games/fx-lab` is the worked example.
  - Several sheets per kind (Engine 0.16 part B, T6): a cycle (a state's `{ frames, ... }` or a
    facing's) may name its own `sheet` (2D; a character pack ships one PNG per animation), so one
    kind draws its run from `frog-run` and its jump from `frog-jump`. `resolveSkinAnimation` gives
    it as `SkinAnimation.sheet` and `resolveSkinFrame` draws from it (else the entry's sheet, else
    `sheets.sheet`). `checkSkinRefs` checks the cycle's frames against its own sheet and reports a
    sheet the game lacks once, at `kinds.<kind>.frames.<state>[.<facing>].sheet` (`missing_ref`);
    a `sheet` on a 3D `poses` cycle is `wrong_backend_field`, one on a state without `frames`
    (a frame per facing) a schema error. Tested in `skin-images.test.ts`.
  - Neighbour-based tile frames (Engine 0.16 part B, T6; `tile-join.ts`): a 2D tile entry's
    `join` `{ with?, edge?, frames }` picks the frame by the neighbours the cell joins, so one map
    character draws grass tops, edges, outer corners and inner notches. A side is open when the
    cell beside it is not one of `with` (default the tile's own key); outside the map counts as
    joined (`edge: "join"`, the default) or open (`edge: "open"`); an inner corner is open when
    both its sides join and the diagonal does not. A `frames` key lists the open sides, then the
    open inner corners, space-separated in the order of `TILE_JOIN_WORDS` (`top right bottom left
inner-top-left inner-top-right inner-bottom-right inner-bottom-left`): `"top left"`,
    `"inner-top-right"`, `"right bottom inner-top-left"`. The frame is the full key's, else the
    sides-only key's, else the entry's `frame` (also with nothing open). A key out of order, with
    an unknown word or a word twice, or an inner corner beside its own open side is `bad_join_key`
    at `tiles.<tile>.join.frames.<key>` (`tileJoinKeyProblem` names the order wanted); on a 3D
    skin (from Engine 0.16 part B, T10) its frames name other tile entries (below); its 2D frames are checked against the tile's sheet
    (`missing_frame` at `tiles.<tile>.join.frames.<key>`). Pure: `tileJoinKeys(join, own, grid,
col, row)` (the keys looked up, most specific first) and `resolveTileFrame(entry, own, grid,
col, row)` (`TileGrid`: text rows or rows of ids). The Canvas2D presenter draws tiles through
    it (once per map version, into the map cache). Tested in `tile-join.test.ts`.
  - Floor variety (Engine 0.16 part C T3, `tile-join.ts`): a 2D tile entry's `vary` `{ frames,
weights?, period?: { cols, rows } }` (`tileVarySchema`; `bad_weights` when the weights are not one
    per frame; `wrong_backend_field` on a 3D skin) replaces the entry's own `frame` (shown when no
    `join` key matched) with one of `frames` picked by a hash of the cell's place
    (`variedTileFrame(vary, col, row)`: the same cell always the same frame, by the weights;
    `period` takes the place modulo it first, so a top-down room keeps its look beside another in
    a slide map). Its frames are checked against the tile's sheet (`missing_frame` at
    `tiles.<tile>.vary.frames.<i>`). Tested in `tile-join.test.ts`.
  - HUD halves and conditions (Engine 0.16 part C T3, `hud.ts`): a `hearts` item's `half` (a frame)
    makes the status count halves, a `frame` per two points and `half` for one left over (checked
    across files like `frame`; `half` on another type is an error); any item's `when` (a status
    key) shows it only while that value is truthy (`hudItemShown(item, status)`, used by
    `layoutHud` and the UI kit's `SkinHud`). From Engine 0.16 part C T9 an `icon`'s `frames`
    (status value -> frame, checked across files at `hud.<i>.frames.<value>`; on another type a
    schema error) picks its frame by the value (the selected item), else `frame`. Tested in
    `hud.test.ts`.
  - PNG sheets (Engine 0.16 T10, `engine/core/gfx/image-sheet.ts`): a top-level `images` map,
    image id -> `{ image: "assets/<pack>/<file>.png", frameSize?, grid?, names?, frames?, anchor? }`,
    on 2D and 3D skins. An entry naming the id as its `sheet` uses its frames like a text
    sprite's; `checkSkinRefs` checks them (`missing_frame`: `image "<id>" has no frame ...`) and
    refuses an id a sprite file has (`duplicate_name` at `images.<id>`). The file itself (present,
    a PNG, frames inside it) is checked by the content loader (`content/assets.ts`). A frame's
    `anchor` places it on the entity box (`anchorOffset`); text sprites have none.
  - glTF models (Engine 0.16 T11): a 3D (`MESH_FIELDS`) kind or tile entry may give `model`
    (`assets/<pack>/<file>.glb` or `.gltf`, else `invalid_format`), `scale` (on tiles too: px per
    model unit), `anchor` (`MODEL_ANCHORS`: `bottom`, the default, `center`, `origin`, or a model
    point `{ x, y, z }`), `rotate` (`{ x?, y?, z? }` degrees), `clip` (a kind: one clip name or
    animation state -> clip name; a tile: one name) and `castShadow`. `anchor`, `rotate` and
    `clip` without `model` are `missing_field`; all are `wrong_backend_field` on a 2D skin. The
    entry's `mesh` and `color` are still needed: the backend shows that text mesh while the
    model loads (or without a model library, or when it fails), at the box's size: a model
    entry's `scale` never grows it (`resolveMeshParts`). `modelClipFor(clip, state)` (the state's clip, else `idle`'s, else null),
    `resolveSkinModel(skin, entity)` (`SkinModel` `{ model, scale, anchor, rotate, castShadow,
clip, time, offset }`, `time` = `anim.t` / `MODEL_TICKS_PER_SECOND`, 60; the kind's or its
    tag look's model), `resolveTileModel(entry, frame)` and `skinModelUses(skin)` (every model
    with its clips' field paths, for `validate` and preloading). The file, its header and its
    clips are checked by the content loader (`content/assets.ts`: `missing_file`, `bad_model`,
    `missing_clip`). Tested in `skin-models.test.ts`.
  - The 2.5D view's model fields (Engine 0.16 part B, T10; Hopper's Way): a 3D kind or tile may
    give `tint` (a colour multiplied into the model's materials) and `stretch` (`{ x?, y?, z? }`
    factors on top of `scale`, model axes), a kind `clipHold` (animation states whose clip plays
    once and holds), all `missing_field` without `model`; a tag look may give `model`, `scale`,
    `anchor`, `rotate`, `clip`, `tint` and `stretch` (its own model for that look;
    `wrong_backend_field` on a 2D skin). `SkinModel` gains `stretch`, `tint` and `hold`. A 3D
    tile's `join` (no longer 2D only) picks another `tiles` entry by key: each `join.frames` value
    must be a tile key of the skin (in a theme, of the theme's or the skin's), else `missing_ref`
    (`checkJoinTiles`). A top-level `scenery` (3D, `MESH_SKIN_FIELDS`; `sceneryRowSchema`,
    `SkinSceneryRow`: `{ model, scale?, stretch?, rotate?, tint?, every, from?, z, y?, jitter?: {
x?, y?, z?, scale?, turn? }, castShadow?, receiveShadow? }`) lists rows of scenery models along
    a map; `sceneryModel(row)` is a row's `SkinModel`. `skinModelUses` now also lists tag looks'
    models (and clips), scenery rows and each theme's tiles and scenery, so `validate` checks and
    pages preload them. Tested in `skin-models.test.ts` (part B block) and `tile-join.test.ts`.
  - Audio (Engine 0.16 T8, `engine/core/audio/mix.ts`): an event entry's `pitch` and `volume`
    (`[min, max]`, `bad_range` when min is above max), `cooldown` (frames) and `duck { amount,
attack?, hold?, release? }`, and a top-level `music` section of layered songs (`skinMusicSchema`;
    `missing_ref` for a layer naming no song or a rule naming no layer, `bad_layers` for layers
    out of step). `skinSoundCue(entry, frame)` is the `SoundCue` both presenters hand `onSound`
    with the sound (`onSound(id, cue?)`); the shell's mixer varies, rests and ducks. On 2D and 3D
    skins alike. `SoundCue` is re-exported from `index.ts`.
  - Tweens (Engine 0.16 T1, `engine/core/fx`): an event entry's optional `tween` (one tween spec
    or a list, `tweensSchema`) is started on the event's `entity` (ignored for an event with none),
    and a kind entry's optional `spawnTween` on an entity the first frame a presenter shows it.
    Both are presentation only, allowed on 2D and 3D skins, applied by the Canvas2D presenter on
    top of the entity's `fx` (never written back to the frame), and from Engine 0.16 part B T10
    by the 3D backend too (item 340: offsets, factors, turn, alpha; a colour as the emissive colour). A bad ease, prop or colour is an error at that field (`events.hit.tween.ease`).
  - Particles (Engine 0.16 T3, `engine/core/fx`): a skin's top-level `emitters` maps names to
    emitter defs (`emitterSchema`, on 2D and 3D skins); an event entry's `emit` (a name or a
    list) starts them at the event (its `x`/`y`, else its entity; an emitter's `anchor` places it
    on the entity), and a kind entry's `emit` runs them while an entity of the kind shows,
    following it (torch smoke, a magic aura). An `emit` naming no emitter of the skin is
    `missing_ref` at that field (`events.hit.emit`, `kinds.torch.emit.1`); a 2D emitter's `frame`
    is checked against its sheet across files (`missing_frame`, `missing_ref`). The old
    `effect.kind: particles` keeps working as an implicit emitter (`particlesEffectEmitter(effect)`,
    `PARTICLES_EFFECT_DEFAULTS`: an even ring flying out 1 px a frame, as before). A kind entry's
    `blend` (`normal` | `add`) and `glow` (`{ color, radius }`) are 2D fields (`SPRITE_FIELDS`;
    `wrong_backend_field` on a 3D skin). `skinEmitNames(emit)` lists an `emit`'s names.
  - Camera effects and parallax (Engine 0.16 T4, `engine/core/fx`): an event entry's optional
    `shake` `{ amount, ticks }` (trauma shake), `zoom` `{ to, ticks, ease?, hold?, back? }` (a
    zoom punch there and back), `flash` `{ color?, alpha?, ticks }` (a full-screen flash, skipped
    with reduced flashing) and `hitPause` `{ ticks }` (the browser shell holds the game's ticks
    that many display frames; headless runs ignore it), on 2D and 3D skins alike; the skin
    camera's `lookAhead` `{ x?, y?, lerp? }` (below, `camera.ts`); and a top-level `parallax` list
    of background layers, back to front (`parallaxLayerSchema`: a sprite `frame` or a colour
    `gradient`, `factor`, `repeat`, `x`/`y`, `depth`), drawn behind the map in 2D and as planes
    in 3D. A parallax `frame` is checked across files like any frame (`missing_frame`,
    `missing_ref` for its `sheet`, `missing_field` at `parallax.<i>.sheet` when there is neither a
    `sheet` nor `sheets.sheet`), on both backends (3D cuts it from the decoded sheets). The old
    `effect` kinds `flash` and `shake` keep working as before (the shake scale applies to them).
  - Lighting (Engine 0.16 part C T4, `engine/core/fx`'s `lightingSchema`): a 2D skin's top-level
    `lighting` (darkness per map tag or id, lights per kind and state, tile, fixed place and event,
    flicker, a vignette, banded falloff and room-wide `particles`; format in `fx/CLAUDE.md`). It is
    a 2D field (`wrong_backend_field` on a 3D skin). Checked in the schema: its `kinds` and `tiles`
    keys must be the skin's (`missing_ref` at `lighting.kinds.<kind>`), its `events` keys read like
    `events`' (`bad_event_key`), its particles' `emit` must name emitters (`missing_ref` at
    `lighting.particles.<i>.emit`); and across files a placed light's `sprite` frames against its
    sheet (`missing_frame`, `missing_ref`, `missing_field` at `lighting.maps.<id>.lights.<i>.sprite`
    without a sheet). Tested in `fx/lighting.test.ts`.
  - Per-map looks (Engine 0.16 part B, T7): a skin-level `themes` map, map id -> `{ background?,
parallax?, tiles? }` (a platformer level's id is its map's), so one skin gives each level its
    own sky, background layers and ground. `themedSkin(skin, mapId)` (pure) lays the map's entry
    over the skin: `background` and `parallax` replace the skin's, `tiles` replace its entries key
    by key (a `#` with other join frames); another map (or none) gets the skin itself, and the
    skin is never changed. Checked like the skin's own fields: a theme's tiles by `checkShapes`
    (`wrong_backend_field`, `missing_field` at `themes.<map>.tiles.<key>...`) and across files
    (`missing_frame`, `missing_ref` at `themes.<map>.parallax.<i>...` and `.tiles.<key>...`). The
    Canvas2D presenter draws through it; from Engine 0.16 part B T10 the 3D backend too, and a
    theme may also give `scene3d` (that map's lights, fog and tone mapping) and `scenery` (its
    scenery rows), both replacing the skin's. Tested in
    `skin.test.ts` (`per-map looks`).
  - Hosted rounds and top-down looks (Engine 0.16 F8, the mini siege's rounds): a 3D skin's
    `rounds2d` (mini game ids; `wrong_backend_field` on a 2D skin) says a 3D page draws those
    rounds in 2D with the game's `canvas2d-<id>` skins (the shell's `rounds2d`, `roundLayerDisplay`
    in `engine/core/shell`; `pnpm cli screenshot --backend three` does the same); `labels` are
    allowed on 2D skins (the 2D presenter draws them: enemies' health bars); 2D kind fields
    (`SPRITE_FIELDS`) `turnToFacing` (`true` or the way the art faces: the frame turned to the
    entity's facing about the box centre), `ring` `{ radius, color, alpha?, edge? }` (a disc under
    the sprite: a tower's range while placing) and `hitFlash` `{ tag, color, blink? }` (the frame as a
    silhouette in the colour while the entity has the tag). A palette that is a colour (`#fff`,
    `isSilhouettePalette`) is never a palette file: `checkSkinRefs` accepts it and the 2D sheet
    lookup (`contentSheets`, `silhouetteSheet`) draws the sheet as a silhouette in it.
  - 3D (Engine 0.6; owner answer 22: procedural low-poly meshes written in the skin). A `mesh`
    is a primitive (`MESH_PRIMITIVES`: `box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`;
    round ones use `LOW_POLY_SEGMENTS`) that fills the entity box (or tile) and is `depth` px
    thick (default the box's width, so a tile is a one-tile block), or a key of `meshes`: a
    compound mesh, a list of parts `{ shape, size: { w, h, d }, at?: { x, y, z }, color?,
rotate? }` in world px (x right, y down, z toward the camera; `at` is the top-left corner in
    x/y and the centre in z; `rotate` is quarter turns about the upright axis). A `mesh` that is
    neither is `missing_ref` at that field; a `meshes` key may not be a primitive's name.
    `camera3d` `{ fov?, tilt?, layerDepth?, lights?: { ambient?, directional? } }` gives framing
    defaults (`DEFAULT_CAMERA3D`; `layerDepth` is z px per entity `layer`).
  - The 3D scene look (Engine 0.16 T12, `scene3d.ts`): a skin-level `scene3d` (`scene3dSchema`)
    `{ sun?: { color?, intensity?, direction? (px right, up, toward the camera; default
`DEFAULT_SUN_DIRECTION`), shadow?: { mapSize?, bias?, radius? } (`DEFAULT_SHADOW`) },
ambient?: { color?, intensity? }, hemisphere?: { sky, ground, intensity? }, fog?: { kind:
linear | exp2, color, near?, far? (px behind the z = 0 plane), density? }, toneMapping?: { kind:
aces | agx | none, exposure? }, colorSpace?: srgb | linear, timeOfDay? (Engine 0.16 F4,
`time-of-day.ts`) }`; a kind's `light`
    (`kindLightSchema`: `{ kind: point, color, intensity, distance, decay?, offset? { x, y, z } (y
down, from the box's centre), flicker? 0..1 }`) and `receiveShadow` on kinds and tiles (beside
    T11's `castShadow`); and a skin-level `labels` (`labelsSchema`: kind -> a label or a list,
    `labelSchema` `{ from?: id | kind | { tag: prefix } | { status: field }, as: text | bar |
timer, format?, max? (number or status field), font?, color?, shadow?, outline?, back?,
border?, w?, h?, anchor?: top | center | bottom, offset? }`). All are 3D fields
    (`wrong_backend_field` on a 2D skin). Cross-file (`checkLabelFonts` in `checkSkinRefs`): a
    label's font that is no font file is `missing_ref`, a `format` character it lacks
    `missing_glyph`, at `labels.<kind>[.<i>].font` / `.format`. Pure readings:
    `resolveScene3d(scene3d, camera3d lights)` (`Scene3dLook`, every default filled: without
    `scene3d` the old ambient and directional intensities, no shadow, fog or tone mapping, sRGB),
    `skinLabels(labels, kind)`, `labelValue(label, entity, status)`, `labelBar(label, value,
status)` (a number, a tag's `n/m`, or a number text; `max` the label's, a status field's, the
    tag's `m`, else 100) and `timerText(ticks)` (`m:ss`, seconds rounded up,
    `LABEL_TICKS_PER_SECOND` 60). The UI kit lays labels out (`engine/core/ui/labels.ts`); the 3D
    backend projects and draws them. Tested in `scene3d.test.ts`.
  - Decor, places and tile variation (Engine 0.16 F3, `decor.ts`): a `three` skin's `decor`
    (`decorSchema`: map id -> `{ grid, map?, size?, legend: { <char>: { model (a path or a list),
scale? (number or [min, max]), yaw? (degrees, random, quarter), jitter?, offset?, anchor?, rotate?,
castShadow?, receiveShadow?, instanced? } } }`; `bad_legend_key` for a key that is not one
    character or is `.` or space, the empty cells), `places` (`placesSchema`: map id -> `[{ text,
x, y, height?, font, color?, shadow?, outline?, offset? }]`) and a tile entry's `vary`
    (`tileVarySchema` `{ turn?, height?, tint? }`). The grid is a `decor` content file
    (`DECOR_KIND`, `.txt` rows or JSON `{ rows }`, registered with the engine kinds); its
    `checkAll` (`checkDecorGrids`) checks each grid against every skin entry naming it:
    `wrong_size` against the entry's `size`, else the content entry `map` names, else the one
    named like the map id (`contentMapSize` reads a `map` grid or a world scenario's
    `terrain.rows`), and `unknown_char` at the row and column. `checkDecorRefs` (in
    `checkSkinRefs`): a grid or `map` the game lacks is `missing_ref`, a place's font
    `missing_ref` or a character it lacks `missing_glyph`. Legend models go through
    `skinModelUses` (a list's model at `decor.<map>.legend.<char>.model.<i>`, `field`), so
    `validate` reports `missing_file` / `bad_model` and `ModelLibrary.preload` loads them.
    Pure placement: `placeDecor(entry, rows, map, seed, limit?)` (`DecorPlacement`s, picks from
    `fxRng(seed, 0, decorStream(map, col, row))` in a fixed order), `tileVariation(vary, seed,
map, layer, col, row)` and `contentDecor(content)` (grid name -> rows, the 3D backend's
    `decor` option). The model fields shared by kinds, tiles and the decor legend live in
    `model-fields.ts`. `scene3d.renderScale` (whole, 1 to `MAX_RENDER_SCALE` 8, default 1) is
    the 3D picture's supersampling (`Scene3dLook.renderScale`). Tested in `decor.test.ts`.
    Engine 0.16 F6: a legend entry's `stack` (`[{ model, height }]`, more models on its cells,
    placed after the cell's own with the same picks, `height` px higher grown with the cell's
    scale; its models in `skinModelUses` at `stack.<i>.model`), `materials` and `tint` (colours,
    as a kind's), `light` (a kind light's fields: a point light per cell) and `emit` (emitters
    run on each cell; `validate`'s `missing_ref` for one the skin lacks), each carried on the
    `DecorPlacement` (`materials`, `tint`, `light`, `emit`).
  - Model colours and tag-look models (Engine 0.16 F6, `skin.ts`): a kind's or tile's
    `materials` (material name -> colour) and `tint` (multiplies every colour) are model fields
    (`missing_field` without `model`, `wrong_backend_field` on a 2D skin) carried on `SkinModel`
    (`materials`, `tint`); a `byTag` look may give `model`, `scale`, `materials` and `tint`
    (merged by `resolveSkinKind`, so `resolveSkinModel` reads them), and `skinModelUses` lists a
    look's model at `kinds.<kind>.byTag.<i>` with the kind's clips.
  - `resolveMeshParts(skin, entry, box)` (pure, the one reading of mesh text shared by backends
    and tests): the `MeshPart[]` `{ shape, size, at, color, rotate }` for a kind or tile entry,
    with `box` the entity box or `{ w: tileSize, h: tileSize }`: a primitive is one part filling
    the box; parts default to the entry's colour; `scale` grows every part about the box's
    bottom centre; then `offset` and `z` move the mesh. A sprite entry or unknown mesh gives `[]`.
    `resolveCamera3d(skin)` fills `camera3d` from `DEFAULT_CAMERA3D`.
  - Cross-file (`SKIN_KIND.checkAll`, `checkSkinRefs`): every sheet, palette and sound must be a
    sprite, palette, song or sfx of the game (`missing_ref`), and every frame a frame of its
    sheet (`missing_frame`), each at the skin file and field.
  - `resolveSkinEvent(skin.events, event)` (pure, for backends; gap G28): the entry for one event:
    the first key of its type, in file order, whose field matches (a string, number or boolean
    whose text is the key's value), else the bare type's entry, else undefined. So
    `mini-game-end:pass`, `mini-game-end:fail` and a fallback `mini-game-end` sit side by side,
    and a skin with bare keys only reads as before. `parseEventKey(key)` reads a key
    (`{ type, match: { field, value } | null }`, null for a bad one). Both backends' presenters
    play sounds and start effects through it.
  - Looks by tag (Engine 0.11, gaps G13 and G30, item 181; prefixes and values Engine 0.15, gap
    M2, decision 3, item 280): a kind entry's `byTag` is a list of `{ tag | prefix, min?, max?,
sheet?, palette?, frames?, fallbackColor?, mesh?, color? }`. A look matches by exactly one of
    `tag` (the whole tag) or `prefix` (any tag starting with it, `progress:`), and with `min`
    and/or `max` (inclusive whole numbers, only with `prefix`) only a tag whose rest reads as a
    whole number (`-?\d+`) in that range: `progress:half` never matches a look with a range.
    `skinTagMatches(look, tag)` is that test. Both `tag` and `prefix`, neither, `min`/`max`
    without `prefix`, or `min` above `max` are `bad_tag_look`. **Order rules** for
    `resolveSkinKind`: looks are tried in file order and the first that matches any of the
    entity's tags wins (the entity's tag order does not matter), so a skin lists its stages from
    the most specific (`progress:` 75 and up, then 50-74, then plain `site`); a look for two tags
    at once is not built (moved to 1.0). For an entity with tags, the winning look lays its fields
    (never `tag`, `prefix`, `min` or `max`) over the kind's (`frames`
    replace the kind's frames whole; the fields it leaves out, `flipFacing`, `size`, `offset`,
    `depth`, `scale`, `z`, come from the kind); the state and facing are then picked inside it as
    usual. No match (or no tags) uses the kind as it is, so a skin without `byTag` draws as
    before. `resolveSkinKind(skin, entity)` gives that entry (undefined for an unlisted kind) and
    `skinTagIndex(entry, tags)` the look's index (-1: none); the Canvas2D presenter picks frames
    and the 3D scene builds meshes through them (and rebuilds an entity whose look changes). The
    other shape's fields in a look are `wrong_backend_field`, a look's unknown `mesh` is
    `missing_ref`, and its sheet, palette and frames are checked across files like the kind's.
    A tag is any of the entity's tags: `used`, `brick` (a bumped block), `look:<id>` (a platformer
    trigger's `look`), `site` (the RTS kit's building under construction); the mini siege uses it
    for its construction site and its burnt or damaged siege engines; the RTS skirmish's
    barracks site takes a half-built look from `progress:50` (a `prefix` look with `min`).
  - `resolveSkinFrame(skin, entity)` (pure, for backends): the `SkinFrame` `{ sheet, frame, flipX,
palette?, fallbackColor, size?, offset? }` for an entity's kind (its tag look, if any),
    `anim.state` (else `idle`,
    else the first state), `anim.t` (cycle frame; `loop: false` holds the last) and `facing`. A facing without its own
    frame falls back in turn: a left-hand facing uses its right-hand mirror flipped when
    `flipFacing` (`up-left` uses `up-right`, `left` uses `right`); a diagonal uses its horizontal
    part (`cardinalFacing`), then that part's own fallback; then `down`, then the first given (in
    `FACINGS` order). A single frame or cycle is flipped for any left-hand facing under
    `flipFacing`. An unknown kind or a mesh entry gives `frame: null`: draw a
    `fallbackColor` box (`DEFAULT_FALLBACK_COLOR` when the skin gives none).
- `camera.ts`: camera framing shared by every backend, so 2D and 3D frame the same world point.
  `CameraFollower` (`new CameraFollower({ clamp? })`, default clamp on; both presenters pass the
  skin's `camera.clamp` unless their own `clamp` option is set, Engine 0.7 T9) keeps one camera's state;
  `update(frame, skin.camera, view, map)` returns its top-left in whole world pixels (`map` is the
  shown map's `{ id, cols, rows, tileSize }`, or null). It works in zoomed units: `view` is the
  world box the picture shows, `cameraView(size, zoom)` (the picture size over the zoom), with
  `cameraZoom(frame, skin.camera)` the hint's `zoom`, else the skin's, else 1; so the deadzone
  is in world pixels and clamping keeps the zoomed picture inside the area. Both backends call it
  this way. Target: the hint's `follow` entity (by id,
  its box centre) when in the frame, else the hint's `x`/`y`, else the skin's `camera.follow`
  (entity id, then kind), else none (top-left 0, 0). `deadzone` and `lerp`: the hint's, else the
  skin's, else 0x0 and 1. Past the deadzone the camera moves just enough to put the target back on
  its edge. Lerp is 1/256 fixed point (`Math.trunc`, at least 1 px, so it always arrives); 1
  snaps, 0 holds. The first frame, a new map id, a frame with no target and a `reset()` snap; a
  repeated `frame` number does not move it. Clamp: the hint's `bounds`, else the map; an area
  smaller than the picture is centred. `cameraShake(frame, extra)` is the whole-pixel shake (the
  hint's `shake` plus `extra`, flipping side each frame), added by the backend and never stored.
  Engine 0.16 T4: the skin camera's `lookAhead` `{ x?, y?, lerp? }` frames a followed entity
  (`cameraFollowed(frame, skin.camera)`: the hint's `follow` by id, else the skin's `follow` by id
  then kind) `x` world px ahead in its facing's horizontal direction and `y` in its vertical one
  (`facingVector`), the offset gliding to a new facing at `lerp` (default
  `CAMERA_LOOK_AHEAD_LERP` 0.1, whole px, 1/256 fixed point) and snapping with the camera; the
  deadzone (its `h` is the vertical deadzone) then applies to the point ahead. `follower.lookAhead`
  reads the offset. `cameraArea(frame, map, clamp?)` is the box the view is kept in (the hint's
  `bounds`, else the map, else null). `zoomAbout(cam, view, factor, area, focus?)` is a zoom
  punch on a framed camera: the view zoomed by `factor` about `focus` (the camera's target, held
  inside the view, keeps its place on the picture; else the view's centre), a punch out clamped
  inside `area`. Both presenters frame at the base zoom, then punch.
  The follower lives in a presenter only: never in a kit, a frame or a hash.
- `ground.ts` (Engine 0.16 F2): the 3D backend's ground-view camera maths, pure numbers, shared
  by `ThreeScene` and `RtsCamera` so drawing and picking cannot drift. `groundProjection(size,
zoom, centre, { pitch, yaw, fov })` (degrees; pitch down from the horizon, yaw 0 looks north, 90
  looks west) gives `eye`, `forward`/`right`/`up`, `distance` (`focal / zoom`, so looking straight
  down the picture shows `height / zoom` world px as 2D does), `worldToScreen(x, y, h?)` (picture
  px, unrounded, or null behind the camera), `screenToGround(sx, sy, h?)` (the ray's hit on the
  plane at height h, or null), `groundAt(sx, sy)` (never null: a ray over the horizon lands
  `GROUND_REACH` distances out) and `footprint()` (the picture's corners on the ground).
  `clampGroundCentre(size, zoom, centre, camera, area)` keeps the footprint's bounds inside
  `area` (centred on an axis where they are wider), `pointsBox`, `inScreenBox(box, p)` and
  `groundFacingTurn(dir)` (the turn about the vertical for a `facingVector`). The skin's
  `camera3d` takes `view` (`side` | `ground`, `CAMERA3D_VIEWS`), `pitch` (10-90, default 55) and
  `yaw` (-180-180, default 0); `resolveCamera3d` fills them and `skinGroundCamera(skin)` gives the
  ground camera, or null for a side-view skin. `ground.test.ts`.
- `rts-camera.ts` (Engine 0.9 T5): `RtsCamera({ view, area, zoom?, minZoom?, maxZoom?, centre? })`,
  a scrolling, zoomable view over a map larger than the picture: its position (the top-left in
  world px, kept unrounded so slow pans add up) and zoom (`RTS_MIN_ZOOM` 0.5 to `RTS_MAX_ZOOM` 2 by
  default, shown in 1/64 steps so 0.5, 1 and 2 are exact). `panBy(dx, dy)` (picture px, as a `pan`
  gesture gives them), `zoomTo(z, at?)` / `zoomBy(factor, at?)` (keeping the world point under
  picture point `at` still), `centreOn`, `apply(gesture)` (pan and zoom gestures from
  `input/pointer-logic.ts`; false for taps and boxes), `resize(view)`. It clamps to `area` exactly as
  `CameraFollower` does (`clampCameraAxis`, exported from `camera.ts`; an area smaller than the
  view is centred). With `ground: GroundCamera` (Engine 0.16 F2, `skinGroundCamera(skin)`)
  it is the 3D ground view's camera: `projection()` is `groundProjection` at its `centre()` and
  zoom, `screenToWorld` is `groundAt`, `worldToScreen(x, y, h?)` the projected point (unrounded),
  `screenBoxToWorld` the bounds of the ground under the box, `inScreenBox(box, x, y, h?)` whether
  a world point is drawn inside a picture box, `panBy` moves the ground under the picture's
  centre with the drag, `zoomTo` keeps the ground point under `at`, and the clamp is
  `clampGroundCentre` (its `topLeft()` is only rounded). `topLeft()` is the whole-pixel top-left; `hint()` is the frame's `CameraHint`
  `{ x, y, zoom, deadzone: 0x0, lerp: 1, bounds: area }`, which makes the follower (both
  presenters) frame that same top-left whatever the skin's camera says. `worldToScreen(wx, wy)`
  is where the Canvas2D presenter draws a world point (`round(wx * zoom) - round(left * zoom)`,
  shake aside), `screenToWorld(sx, sy)` its inverse (unrounded world px) and
  `screenBoxToWorld(box)` a box gesture's `boxRect` in world px. Presentation only: it lives in the
  glue or a kit's presentation state, never in a world or a hash.
- `stream.ts` (Engine 0.7): the per-frame stream games had written by hand. `FrameSource<W, E, S>`
  `{ start(world), present(world, events, state) }` is how a kit presents its world (the
  platformer kit's `platformerFrames(size)`); `FrameStream(source).next(world, events)` gives the
  frozen frame with one stream state per world object (a new world, such as the next level,
  starts afresh); `PendingEvents(world, initial?)` keeps the events of several steps between two
  frames (`add(world, events)` drops those of an older world; `take()` empties it);
  `FramePicture(frames, presenter).draw(world, events)` presents a stream's frame and returns it.
- `switch.ts` (Engine 0.7, gap G14): `presenterByStatus(status, presenters, otherwise)`, a
  `Presenter` that hands each frame to `presenters[frame.status[status]]` when that value is one
  of its own keys (a string), else to `otherwise`; `resize` goes to all. A game that stacks kits
  gives each frame source its own presenter (own skin, camera and map cache): the platformer
  kit's `status.miniGame` is the running round's id, '' on the level.
- `hosted.ts` (Engine 0.15 T6, gap M6, decision 7, item 284): one round picture for every hosted
  mission. `hostedSource(main, { round, events?, status? })` is a `FrameSource` over a game's own source
  (`main`): while `round(world)` gives a frame (`MissionHost.roundFrame()`: the hosted round's own
  frame, `status.miniGame` already set by the host, gap D9) it is shown, its map through a
  `MapTracker` of its own that is reset when the round ends; otherwise `main`'s frame with
  `status.miniGame` set to ''. `events(events)` picks the host's events to add to whichever frame
  is shown (`missionHostEvents` for a `MissionHost`'s `mission-open`, `mini-game-end` and
  `mission-commit`, gap M21); left out, none. With a skin set (`presenterBySkinSet`) a page writes
  this one call instead of the battle-or-round switch. `HostedPresentState<S>` is its stream
  state (`main`, `roundMaps`, `inRound`). From Engine 0.16 F4 `status(world)` adds the game's own
  status to every frame, its own and a round's (the world clock, `clockStatus(...)` from
  `engine/core/clock.ts`); null or left out adds nothing.
- `time-of-day.ts` (Engine 0.16 F4): a `three` skin's `scene3d.timeOfDay` (`timeOfDaySchema`)
  `{ status? (the clock prefix, default `clock`), tween? (display frames a jump eases over,
default `DEFAULT_TIME_TWEEN`45; 0 snaps), ease? (default`DEFAULT_TIME_EASE` sineInOut), keys:
[{ hour (0 up to 24), sun?: { color?, intensity?, direction? }, ambient?: { color?, intensity? },
hemisphere?: { sky?, ground?, intensity? }, fog?: { color?, near?, far?, density? }, background?,
exposure? }] }`: keys in rising hour order (`bad_time_key`), a key's `fog` needs the skin's own
  `scene3d.fog` (`missing_field`), an unknown ease is `bad_ease`. A key's missing field is the
  skin's own value (`baseDayLook(look, background)`, `keyDayLook`); `TimeOfDayLook(spec,
base).at(hour)` interpolates between the keys round the 24-hour day (colours by channel,
  `lerpDayLook`) and `.base` is the skin's own look, shown on frames without the clock.
  `statusHours(status, prefix?)` reads `<prefix>.day` and `.fraction` as hours since day 1;
  `DayClockTween({ ticks?, ease? }).shown(hours)` follows a steady clock and eases a move larger
  than `TIME_JUMP_HOURS` (0.5) over its ticks (a mission's commit cost). Pure; the 3D backend
  applies it (`engine/backends/three`).
- `skin-set.ts` (Engine 0.7 T8, gap G32): `skinSet(content, backend)` gives one backend's skins
  for a game by file name: `main` (`content/skins/<backend>.json`, else the first skin of that
  backend that is not a mini game's; null when none) and `rounds` (`<backend>-<id>.json`, by the
  mini game id `<id>`). `MINI_GAME_STATUS` (`miniGame`) is the status a host kit sets to the
  running mini game's id; `presenterBySkinSet(main, rounds)` is `presenterByStatus` on it. The
  page, the view and `pnpm cli screenshot --backend three` all read the same set.
  `mustSkinSet(content, backend, who?)` (Engine 0.15 T15, the API review: every sample wrote the
  check) gives the set with `main` required (`FoundSkinSet`), or throws `<who> has no <backend>
skin (content/skins/<backend>.json)`.
- `hud.ts` (Engine 0.15, gap G33, decision 4, item 281): the HUD laid out once for every backend.
  `layoutHud(skin, status, frameSize, { font? })` gives `HudDraw` items in picture pixels, in the
  skin's `hud` order: `{ kind: 'sprite', sheet, palette?, frame, x, y }` (hearts, one per whole
  point, each the frame's width plus 1 px right of the last; an icon once when truthy; from the
  item's `sheet`, else `sheets.sheet`, in `sheets.palette`), `{ kind: 'text', font, text, x, y }`
  (`number` and `text`; the item's font, else the option, else `DEFAULT_HUD_FONT` `font`) and
  `{ kind: 'box', x, y, w: 8, h: 8, color }` where the frame is missing (`frameSize` gives null;
  `sheets.fallbackColor`, else `HUD_FALLBACK_COLOR`, 9 px apart). A status key the frame lacks
  draws nothing. `frameSize(sheet, palette, frame)` is the backend's own lookup. `hudGlyphs(text)`
  splits a text item into one sprite per character, `HUD_GLYPH_ADVANCE` (8) px apart, spaces
  skipped (what `Renderer.text` draws). The Canvas2D presenter draws the items with its renderer
  and the 3D backend as textured quads, so the HUD sits in the same place in both. From Engine
  0.16 T6 `layoutHud` skips the UI kit's widget types (`isClassicHudType`); a skin with any UI
  item is laid out whole by `engine/core/ui`'s `SkinHud` (which calls `layoutHud` for its
  classic items), one without draws exactly as before. Engine 0.16 F7: every `hud` item may have
  a `when` (`statusCompareSchema` from `../audio/mix`), and `hudItemShown(item, status)` is
  whether it holds (true without one); `layoutHud` and `SkinHud` skip an item that is not shown.
  A `panel` may be flat (`color`, optional `alpha` and `border`, no `frame` or `slice`).
  Engine 0.16 F9: `HUD_HIDDEN_STATUS` (`hudHidden(status)`): a frame whose status sets it to a
  truthy value shows no HUD item (`hudItemShown` is false for all; the 3D backend shows no labels
  either), for a page's title screen; `hudPanelBoxes(skin, status)` lists the shown `panel` and
  `minimap` boxes (what 3D labels keep out of) and `boxesOverlap(a, b)` tests two boxes.
- Tests for the audio fields: `skin-audio.test.ts` (Engine 0.16 T8).
- `index.ts`: re-exports all of the above; import from `@engine/core/present` (or `./present`).

## Rules

- Pure: `engine/core/present/**` is on `PURE_CORE` (`config/layers.js`). No clock, DOM or
  `Math.random`. Import only `zod` and pure core files (`../gfx/screen`, `../headless` types,
  `../content/bundle` for `skinSet`, `../fx/schema` for tween specs and emitters in skins, `../fx/ease` and `../ui/font` for the HUD's widgets and glyph check, `../audio/mix` and `../audio/mml` for the skin's sound fields and layered music; `import type` of `../input/pointer-logic` for `RtsCamera.apply`).
- Everything in a frame is plain JSON-safe data: no classes, functions, `Map`s or kit objects. A
  backend never sees kit internals.
- Frames are read-only to backends. Never add a field a backend would write back to.
- New presentation-only effects go in as optional fields (extension points) that a backend may
  ignore; keep `presentFrameSchema` and the types in step, and add a fixture field to the tests.
- No world rules here and no drawing: kits fill frames, backends draw them.

## Testing

`present.test.ts`: a fixture frame using every field passes the schema, wrong fields are reported
at their path, `freezeFrame` makes every write throw, and `MapTracker` sends the map on the first
frame and on a version (or id) change only. `present.test.ts` also checks all eight facings pass the schema and the facing helpers.
`tile-join.test.ts` (Engine 0.16 part B, T6): the join keys (open sides, inner corners, the map's
edge, `with`, id grids), `resolveTileFrame`'s fallbacks, `bad_join_key`, the 2D-only field and the
cross-file frame check; `skin-images.test.ts` also covers a cycle's own `sheet`.
`skin-anim.test.ts` (Engine 0.16 T2): cycle timing (per-frame ticks, wraps, one-shots done),
`resolveSkinAnimation` (per-frame timing, a one-shot held, `then` from the tick it finished, a
`then` loop that holds, old one-number cycles unchanged), `frameEventsBetween` (the window, wrapped
loops, a state's first frame, a one-shot once, into `then`, facings, the limit), `FrameEventClock`
(each event once, a new entity from its tick now, nothing without frame events), 3D `poses`
(`resolveSkinMesh`, `missing_ref`, `wrong_backend_field` on 2D) and the checks (`bad_frame_ticks`,
`bad_frame_event`, `bad_then`, in looks too).
`skin.test.ts`'s `skin emitters (Engine 0.16 T3)` block covers `emitters`, `emit` on events and
kinds, `blend` and `glow`, unknown names as `missing_ref` at their field, bad emitter fields, the
2D-only fields, `skinEmitNames` and `particlesEffectEmitter`; the cross-file frame check is in `the
skin content kind`.
`skin.test.ts`: its `looks by tag prefix and value (M2)` block covers `skinTagMatches` (whole
tag, prefix, ranges, non-numbers), file order picking the most specific stage first, the merged
entry without match fields, and the `bad_tag_look` refusals; `skin background (G36)` covers
`skinBackground` and the schema. A fixture skin passes, bad fields
are reported at their path (inside unions too), 2D and 3D fields are kept apart, missing sheets,
palettes, sounds and frames are cross-file errors (sounds of field-matched event keys too), event
keys are read and bad ones rejected, `resolveSkinEvent` tries field keys in file order then the
bare type, and `resolveSkinFrame` picks states, cycles
frames by `t`, handles facings and flips (a diagonal falling back to its cardinal, diagonal
frames, a mirrored left diagonal, all eight facings in the schema), and falls back for unknown kinds.
Its `frames by tag` block covers `byTag` (the first matching look in file order, the kind
otherwise, a skin without it unchanged, its 2D/3D fields kept apart, mesh refs, and the cross-file
sheet, palette and frame checks). Its 3D part covers a
`three` skin with primitives and compound meshes, unknown mesh ids (`missing_ref`), 2D/3D fields
on the wrong backend, the demo and platformer-lab canvas2d skins still validating,
`resolveMeshParts` (primitive, compound, scale) and `resolveCamera3d`. `stream.test.ts` covers `FrameStream`
(state per world, frozen frames), `PendingEvents` (kept across steps, dropped on a new world) and
`FramePicture`. `switch.test.ts` covers `presenterByStatus` (picking by value, inherited keys
ignored, resize to all). `hud.test.ts` covers `layoutHud` (hearts, icons, numbers and text where the Canvas2D presenter drew
them, a missing frame's boxes, missing and false values, the font option, the default colour) and
`hudGlyphs`. `skin-set.test.ts` covers `skinSet` (main and rounds by file name, the
fallbacks) and `presenterBySkinSet`. `camera.test.ts` covers
`CameraFollower` (follow by id and kind, hint `x`/`y`, deadzone, lerp, clamp to bounds and map,
small-area centring, the zoomed view at 0.5 and 2, snap on a new map id, repeated frames,
`reset`), `cameraZoom`, `cameraView` and `cameraShake`, and (Engine 0.16 T4) look-ahead gliding
to a new facing, vertical look-ahead with the vertical deadzone, no look-ahead without a followed
entity, `facingVector`, `zoomAbout` (about the centre, about a focus, a focus held inside, a
punch out clamped) and `cameraArea`. `rts-camera.test.ts` covers `RtsCamera`:
clamping at zoom 0.5, 1 and 2 (no stored overshoot), a small area centred, zoom limits, zooming
about a point, slow pans and pinches adding up, `apply`, round trips screen -> world -> screen at
zoom 0.5, 1, 1.5 and 2, boxes, and that `CameraFollower` frames its `hint()` to exactly its
`topLeft()` despite a skin deadzone and lerp. The agreement with the Canvas2D presenter's drawing
is checked in `engine/backends/canvas2d/rts-camera.test.ts`. `hosted.test.ts` covers `hostedSource` (the main frame with
`miniGame` '', the round's frame, its map sent once per round, the host's events added or none). Run with
`pnpm test`.
