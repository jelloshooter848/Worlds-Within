# engine/core/present

Folder: `engine/core/present` (part of `engine/core`). Detailed rules:
[`engine/core/present/CLAUDE.md`](../../engine/core/present/CLAUDE.md).

## Purpose

The presentation contract: the read-only snapshot a backend gets each frame. A kit describes what
is there (entities, the level map, this frame's events and HUD status); a backend decides how it
looks, from the frame and a skin, and can't change anything. Camera framing, depth layers and
squash and stretch are optional extension points a backend may ignore.

## Public API entry points

Import from `@engine/core/present` (`index.ts`).

- Types: `PresentFrame`, `PresentEntity`, `PresentAnim`, `PresentFx`, `Facing`, `PresentMap`,
  `PresentMapRef`, `PresentMapLayer`, `PresentMapPart` (Engine 0.16 part C T4: a full map's
  optional `parts`, the maps it is made of at their places, such as a room slide's two rooms),
  `PresentEvent`, `PresentStatusValue`, `CameraHint`,
  `PresentBox`, `DeepReadonly`.
- `Facing` (Engine 0.9, owner answer 128): `up`, `down`, `left`, `right` and the diagonals
  `up-left`, `up-right`, `down-left`, `down-right` (`FACINGS`). Helpers: `cardinalFacing(f)` (a
  diagonal's horizontal part), `mirrorFacing(f)` and `facesLeft(f)`. Four-way kits keep emitting
  cardinals.
- `CameraHint` (all optional past `x`/`y`, a backend may ignore them): `zoom`, `follow` (an
  entity id; beats `x`/`y`), `shake`, and overrides of the skin's camera defaults for this frame:
  `deadzone` (`{ w, h }` world pixels), `lerp` (0 to 1, 1 snaps) and `bounds` (a world box the
  view stays inside instead of the map, for a kit-side scroll lock). The hint wins over the skin
  field by field; the skin's `camera` gives the defaults.
- `Presenter`: what a backend implements, `present(frame: DeepReadonly<PresentFrame>)` and
  optional `resize(size)`.
- `freezeFrame(frame)`: deep-freezes a frame so writes throw (tests and dev).
- `MapTracker`: `next(map)` gives the full map on the first frame and when its id or version
  changes, else `{ id, version }`; `reset()`. `isFullMap(map)` tells the two apart.
- `presentFrameSchema`: Zod schema for a frame, for tests and tools.
- `hostedSource(main, { round, events? })` (`hosted.ts`, Engine 0.15 T6, gap M6): one round
  picture for any game hosting rounds: the game's own source's frames (`status.miniGame` '') or,
  while `round(world)` gives one, the hosted round's frame (`MissionHost.roundFrame()`, named by
  the host, gap D9), with the host's events added (`missionHostEvents`, gap M21).
- The HUD layout (`hud.ts`, Engine 0.15, gap G33): `layoutHud(skin, status, frameSize, { font? })`
  turns a skin's `hud` and a frame's `status` into `HudDraw` items (a sprite frame, bitmap-font
  text or a missing frame's box at a picture pixel, in order), and `hudGlyphs(text)` splits text
  into font glyphs; both backends draw these, so the HUD sits in the same place in 2D and 3D.
  From Engine 0.16 T6 a skin's `hud` also takes the UI kit's widgets (`bar`, `counter`, `panel`,
  `minimap`, styled text in a font file; `HUD_WIDGET_TYPES`), laid out by `@engine/core/ui`'s
  `SkinHud`; `layoutHud` skips them, and the skin check reports `missing_glyph` for HUD text a
  font file lacks. Engine 0.16 F7: any item's `when` (a status test, the mixer's
  `statusCompareSchema`) shows it only while the test holds (`hudItemShown`), and a `panel` may
  be a flat `color` box (`alpha`, `border`).
- Skins (`skin.ts`): `skinSchema` and the `skin` content kind (`SKIN_KIND`, one of the engine's
  kinds), a per-backend JSON file mapping each entity kind to a sprite (2D) or mesh (3D), each tile
  to a frame, each event to a sound and effect, and status values to HUD items. Its cross-file
  check reports sheets, palettes, sounds and frames the game lacks (`missing_ref`,
  `missing_frame`). Engine 0.16 T10: a top-level `images` map names PNG sprite sheets in the
  game's `assets/` (frames as a grid or named rectangles, with anchors); entries use an image id
  as their `sheet` (`skin-images.test.ts`); from Engine 0.16 part B (T6) a cycle may name its own
  `sheet`, so one kind draws each state from its own PNG. Also T6: a 2D tile entry's `join`
  (`tile-join.ts`: `{ with?, edge?, frames: { "top left": frame, "inner-top-right": frame, ... } }`)
  picks the tile's frame by the neighbours it joins (grass tops, edges, corners, notches);
  from T7 a skin's `themes` (map id -> `{ background?, parallax?, tiles? }`, laid over the skin by
  `themedSkin(skin, mapId)`) gives each level its own sky, parallax and ground;
  `resolveTileFrame`, `tileJoinKeys`, `TILE_JOIN_WORDS`, `bad_join_key` (`tile-join.test.ts`).
  Engine 0.16 part C T3: a 2D tile's `vary` (`{ frames, weights?, period? }`, `variedTileFrame`:
  floor variety by a hash of the cell's place, after any `join` key), a `hearts` HUD item's `half`
  (the status counts halves) and any HUD item's `when` (`hudItemShown`: shown only while that
  status is truthy).
  Engine 0.16 F8: a 3D skin's `rounds2d` (the rounds a 3D page draws in 2D), `labels` on 2D skins,
  2D kind fields `turnToFacing`, `ring` and `hitFlash`, and colour palettes (`#fff`,
  `isSilhouettePalette`: a silhouette, for hit flashes).
  Engine 0.16 E6 (`projectile.ts`): an event entry's `projectile` (`projectileSchema`: `{ frame?,
sheet?, palette?, color?, size?, ticks, arc?, ease?, turn?, impact?: { emit?, sound?, shake? } }`,
  2D only, `wrong_backend_field` on a 3D skin; `projectileFlight(ev)`, `projectilePlace(look,
from, to, age)`), a kind `ring`'s `tag` and `per` (the radius from a `range:` tag; `radius` or
  `tag` needed), a label's `max: { tag }` (`labelBar(label, value, status, entity?)`: each
  entity's own `maxhp:`) and the HUD widget `preview` (`frames` by kind, `spacing`). `validate`
  checks a projectile's frame, sheet, palette, impact sound and emitters and a preview's frames
  and font digits.
  Engine 0.16 F9: `HUD_HIDDEN_STATUS` (`hudHidden`): a frame whose status sets it shows no HUD
  item (and in 3D no label or place name), for a page's title screen; `hudPanelBoxes` (the shown
  `panel` and `minimap` boxes) and `boxesOverlap`; `scene3d.skirt` (`{ color, margin? }`,
  `DEFAULT_SKIRT_MARGIN`): a ground view's flat ground past the map's edges.
  Engine 0.16 polish P6 (gap M45): `clampBoxInside(box, picture, margin?)`, `LABEL_EDGE_MARGIN`
  (2), `unionBox`, `PictureBox`: a world label's box moved inside the picture, shared by every
  backend through `layoutLabels`.
  Engine 0.16 T11: a 3D kind or tile entry may name a
  glTF/GLB `model` in `assets/` with `scale`, `anchor`, `rotate`, `clip` (by animation state)
  and `castShadow`, keeping its text `mesh` as the stand-in while it loads;
  `resolveSkinModel`, `resolveTileModel`, `modelClipFor`, `skinModelUses`
  (`skin-models.test.ts`). Engine 0.16 T8: an event's sound may vary (`pitch`, `volume` ranges, a
  `cooldown`) and duck the music (`duck`), and a top-level `music` section names layered songs
  mixed from status values (`engine/core/audio/mix.ts`); a layer naming no song, or a rule naming
  no layer, is `missing_ref`, layers out of step `bad_layers`. `skinSoundCue(entry, frame)` is the
  `SoundCue` presenters hand `onSound(id, cue)`. `resolveSkinFrame(skin, entity)` gives the `SkinFrame` to draw (sheet, frame,
  flip, fallback colour) from the entity's kind, animation state and tick, and facing (a
  diagonal with no frame uses its horizontal part; `flipFacing` mirrors right-hand frames for the
  left-hand facings). A kind's `byTag` list (Engine 0.11, gaps G13 and G30) gives looks by
  entity tag, `{ tag | prefix, min?, max?, sheet?, palette?, frames?, fallbackColor?, mesh?,
color? }`: `tag` matches one whole tag; `prefix` (Engine 0.15, gap M2) any tag starting with
  it, and with `min`/`max` only one whose rest is a whole number in that inclusive range
  (`{ "prefix": "progress:", "min": 50 }`; `skinTagMatches(look, tag)`). Order rule: the first
  look in file order that matches any of the entity's tags replaces those fields of the kind's
  (`resolveSkinKind(skin, entity)`, used by both backends; `skinTagIndex`), so a skin lists its
  looks from the most specific; else the kind is used as it is, so a skin without it draws as
  before. A look with both or neither of `tag` and `prefix`, or `min`/`max` without `prefix`, is
  `bad_tag_look`. A skin's optional `background` (Engine 0.15, gap G36) is the colour both
  backends clear to before each frame drawn with it (`skinBackground(skin)`, else
  `DEFAULT_BACKGROUND`, black); each skin of a skin set clears to its own. An `events` key may also match a field (Engine 0.11, gap G28):
  `mini-game-end:pass` (the event's `result`) or `type:field=value`; `resolveSkinEvent(events,
event)` gives the entry, the first matching field key in file order, else the bare type's. From
  Engine 0.16 an event entry's `tween` and a kind entry's `spawnTween` (tween specs from
  [`engine/core/fx`](engine-core-fx.md)) animate the event's entity or a newly shown entity in the
  presenter, never in the frame. From Engine 0.16 T2 a cycle has per-frame `ticks` (one number or
  one per frame), `loop: false` one-shots with an optional `then` state, and frame `events`
  (`{ "1": "footstep" }`); a 3D kind's `poses` is the same table with mesh names.
  `resolveSkinAnimation`, `resolveSkinMesh` and `frameEventsBetween` are the pure readings, and
  `FrameEventClock` (`frame-events.ts`) turns them into presentation-only events that both
  presenters play through the skin's `events`; `checkSkinRefs` adds `bad_frame_ticks`,
  `bad_frame_event` and `bad_then`. From Engine 0.16 T3 a skin's `emitters` (particle emitters
  from `engine/core/fx`) are started by an event's `emit` and run by a kind's `emit` (following
  its entities); an unknown name is `missing_ref` at its field; an old `particles` effect is an
  implicit emitter (`particlesEffectEmitter`); a 2D kind may also take `blend: add` and
  `glow { color, radius }`. From Engine 0.16 T4 an event entry also takes `shake { amount, ticks }`,
  `zoom { to, ticks, ease?, hold?, back? }`, `flash { color?, alpha?, ticks }` and
  `hitPause { ticks }`, the skin camera `lookAhead { x?, y?, lerp? }` (the follower frames a
  followed entity ahead in its facing, gliding when it turns; `cameraFollowed`, `facingVector`),
  and the skin a top-level `parallax` list of background layers (a sprite `frame` or a colour
  `gradient`, `factor`, `repeat`, `x`/`y`, `depth`; frames checked across files). `zoomAbout`
  and `cameraArea` (`camera.ts`) are the zoom punch both presenters apply after framing.
  `games/fx-lab` is the worked example. From Engine 0.16 part C T4 a 2D skin may have a
  top-level `lighting` block (darkness per map tag or id, lights per kind and state, tile, place
  and event with flicker, a vignette and room-wide particles; `engine/core/fx`'s `SkinLighting`),
  its references checked (`missing_ref`, `bad_event_key`, a placed sprite's frames across files)
  and `wrong_backend_field` on a 3D skin. From Engine 0.16 part D (D3) a frame may carry `fog`
  (`PresentFog` `{ cols, rows, cells }`: one character per map tile, `0` unexplored, `1`
  explored, `2` visible, `FOG_CELLS`; presentation only) and a skin a `fog` look (`fogLookSchema`:
  `{ unexplored?: { color?, alpha? }, explored?: { color?, alpha? }, edge? }`, defaults
  `DEFAULT_FOG_LOOK`, `resolveFogLook`); `fogState`, `fogShade` and `fogBoxes(fog, look, tileSize)`
  (the translucent world boxes the 2D walk draws, a row's runs merged, a soft edge as nine boxes
  that never overlap) are in `fog.ts`. A `minimap` HUD item takes `fog: true`, `teams` (tag ->
  dot colour) and `view` (the camera view's outline colour); on another item they are
  `bad_field`. From Engine 0.16 part D (D4, readable at every zoom; `readability.ts`) a 2D kind
  may give `outline` (a colour or `"team"`: a one-pixel outline round the sprite's alpha, or a box
  one pixel larger; also on a `byTag` look), `team` (`{ prefix? (default `faction:`, `""` for whole
tags), colors: { <name>: colour }, mask? | hue?: { min, max } }`: the entity's `<prefix><name>`
  tag picks a colour that replaces the `mask` colour, or the hue range keeping lightness, or tints
  the whole sprite; a box is filled with it) and `screenScale` (`{ min?, max?, anchor?: center |
top | bottom }`: drawn at the zoom held in that range, `{ min: 1, max: 1 }` fully zoom-stable),
  all default off and `wrong_backend_field` on a 3D skin; `bad_team` (both `mask` and `hue`),
  `bad_range` (`min` above `max`) and `missing_field` (`outline: "team"` on a kind without
  `team`). Readings: `skinTeamColor`, `skinOutlineColor`, `screenScaleAt`, `screenScalePivot`.
  Example:

  ```json
  "unit:soldier": {
    "frames": { "idle": "soldier" },
    "outline": "team",
    "team": { "prefix": "", "colors": { "own": "#3c7cfc", "enemy": "#f83800" }, "mask": "#ff00ff" }
  },
  "health-bar": { "frames": { "hp-4": "hp-4" }, "screenScale": { "min": 1, "max": 1 } }
  ```

  The RTS skirmish's skin makes its health and progress bars zoom-stable. Field reference:
  `docs/reference/schemas.md`, section `skin`.

- 3D skins (`backend: "three"`): every kind and tile is a text-defined low-poly mesh, either a
  primitive (`MESH_PRIMITIVES`: `box`, `wedge`, `cylinder`, `cone`, `sphere`, `plane`) or a named
  compound mesh in the skin's `meshes` (a list of `{ shape, size, at?, color?, rotate? }` parts in
  world px), with `depth` (tiles default to one tile deep) and `z`. `camera3d` gives `fov`,
  `tilt`, `layerDepth` (z px per entity `layer`) and minimal `lights` (`DEFAULT_CAMERA3D`,
  `resolveCamera3d(skin)`). `resolveMeshParts(skin, entry, box)` turns an entry into the
  `MeshPart` list a 3D backend builds, so the backend and tests read the text the same way.
- Camera framing (`camera.ts`): `CameraFollower` (`new CameraFollower({ clamp? })`,
  `update(frame, skin.camera, view, map)` gives the camera's whole-pixel world top-left;
  `reset()`) is the one copy of the follow, deadzone, 1/256 fixed-point lerp and clamp maths, so
  the 2D and 3D backends frame the same point. It works in zoomed units: `view` is
  `cameraView(picture, cameraZoom(frame, skin.camera))`, the picture size over the zoom in world
  pixels, so clamping keeps the zoomed picture inside the map. `cameraShake(frame, extra)` is the shake offset,
  added on top and never stored; `cameraTarget(frame, skin.camera)` the point to keep in view.
  Each presenter owns its follower: camera state is never in a kit, a frame or a hash.
- Ground view camera (`ground.ts`, Engine 0.16 F2): `groundProjection(size, zoom, centre, {
pitch, yaw, fov })` with `worldToScreen(x, y, h?)`, `screenToGround(sx, sy, h?)` (ray-plane
  intersection), `groundAt` and `footprint()`; `clampGroundCentre`, `pointsBox`, `inScreenBox`,
  `groundFacingTurn`, `GROUND_REACH`; the skin's `camera3d.view` (`CAMERA3D_VIEWS`), `pitch` and
  `yaw`, read by `skinGroundCamera(skin)`. The one camera maths `ThreeScene` draws with and
  `RtsCamera` picks through.
- Decor and places (`decor.ts`, Engine 0.16 F3): a 3D skin's `decor` (map id -> a `decor`
  content grid and a legend of models with scale ranges, yaw, jitter, offset, shadows and
  `instanced`), `places` (world-anchored region names) and a tile's `vary`; the `decor` kind
  (`DECOR_KIND`, checked against the map: `wrong_size`, `unknown_char`), `checkDecorRefs`,
  `contentMapSize`, `placeDecor`, `tileVariation`, `contentDecor`. `scene3d.renderScale`
  (`MAX_RENDER_SCALE`) supersamples the 3D picture.
- RTS camera control (`rts-camera.ts`, Engine 0.9): `RtsCamera({ view, area, zoom?, minZoom?,
maxZoom?, centre? })`: position and zoom (0.5 to 2 by default) clamped to the map as the
  follower clamps (`clampCameraAxis`), `panBy`, `zoomBy(factor, at?)` about a picture point,
  `centreOn`, `apply(gesture)` for pan and zoom gestures (`@engine/core/input/pointer-logic`),
  `hint()` (the frame's `CameraHint` with `x`/`y`/`zoom`, no deadzone or lerp, `bounds` the area),
  and `screenToWorld` / `worldToScreen` / `screenBoxToWorld`, which agree with where the Canvas2D
  presenter draws at that zoom. Presentation state only, never in a world or a hash. From
  Engine 0.16 F2 an optional `ground` camera makes it the 3D ground view's: `projection()`,
  picking through `groundProjection`, `inScreenBox(box, x, y, h?)`, and a clamp that keeps the
  ground footprint over the area.

- Frame streams (`stream.ts`, Engine 0.7): `FrameSource` (a kit's `start(world)` and
  `present(world, events, state)`), `FrameStream` (`next(world, events)`: frozen frames, fresh
  state per world), `PendingEvents` (events between frames, dropped on a new world) and
  `FramePicture` (`draw(world, events)` onto a `Presenter`). Games and tools use them instead of
  their own per-frame glue.
- `presenterByStatus(status, presenters, otherwise)` (`switch.ts`, Engine 0.7): one presenter
  per frame source, picked per frame by a status value (`miniGame`), so a stacked mini game's
  frames get their own skin, camera and map cache.
- `skinSet(content, backend)`, `MINI_GAME_STATUS`, `presenterBySkinSet(main, rounds)`
  (`skin-set.ts`, Engine 0.7 T8): one backend's skins by file name (`<backend>.json` for the
  game, `<backend>-<id>.json` for mini game `<id>`'s frames), shared by pages, views and the
  screenshot tool; `mustSkinSet(content, backend, who?)` (Engine 0.15 T15, the API review) is the
  same set or an error naming the game and the missing `content/skins/<backend>.json`.

Example: a kit keeps `const maps = new MapTracker()` and each frame builds
`{ frame, size, entities, map: maps.next(roomMap), events, status }`; a test runs
`validate('frame', frame, presentFrameSchema)` and hands `freezeFrame(frame)` to a presenter.

- Engine 0.16 F6: the skin schema's model colours (`materials`, `tint` on kinds, tiles and decor
  legends; `SkinModel.materials` and `.tint`), tag looks with `model`, `scale`, `materials` and
  `tint`, and the decor legend's `stack`, `light` and `emit` (`DecorPlacement.light`, `.emit`,
  `.materials`, `.tint`; `validate` checks a legend's emitters name the skin's).

## Imports allowed

- `zod` and pure files in `engine/core`. Never backends, the sim, tools, kits or games.
- Pure: `engine/core/present/**` is on `PURE_CORE` in `config/layers.js`.

## How to test

`engine/core/present/present.test.ts`, run with `pnpm test`: a fixture frame passes the schema,
`freezeFrame` makes mutation throw, and `MapTracker` sends the map only when it must;
`engine/core/present/skin.test.ts` covers the skin schema (2D and 3D), its cross-file checks,
`resolveSkinFrame`, `resolveMeshParts` and `resolveCamera3d`; `engine/core/present/camera.test.ts`
covers `CameraFollower` and `cameraShake`; `engine/core/present/rts-camera.test.ts` covers
`RtsCamera` (clamping, zoom limits, round trips at zoom 0.5, 1, 1.5 and 2, its hint through the
follower) and `engine/backends/canvas2d/rts-camera.test.ts` its agreement with the presenter; `engine/core/present/stream.test.ts` the frame streams; `engine/core/present/fog.test.ts` (Engine 0.16 part D, D3) a frame's fog in the schema (bad cells and rows named), the skin's `fog` look (defaults, a bad field named at its path, the minimap fields on another item) and `fogBoxes` (runs, a soft edge covering every px once); `engine/core/present/readability.test.ts` (Engine 0.16 part D, D4) the `outline`, `team` and `screenScale` fields (accepted on 2D, refused on 3D, bad values at their path, a team outline without `team`) and their readings; `engine/core/present/projectile.test.ts` (Engine 0.16 E6) the projectile,
ring, label `max` and preview fields, their cross-file checks, the flight's places and angles and
`labelBar` against a tag.
