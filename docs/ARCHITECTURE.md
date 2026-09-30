# Toro — Architecture & Direction (contract for all module owners)

Read `docs/BRIEF.md` first (the client brief). This file fixes the technical contracts and the creative
direction so modules built in parallel fit together. **Do not change files you do not own.** If a shared
contract (`src/core/*`, `src/config/*`, `src/themes/*`, `src/data/validateLevel.ts`, `src/ui/uiState.ts`)
truly needs a change, make the smallest additive change (new optional field) and say so in your report.

Stack: Vite 8 · TypeScript 7 (strict, `noUnusedLocals`) · React 19 (DOM overlay only) · three r186 (plain,
no react-three-fiber) · Vitest 5 for pure-logic tests. No other runtime dependencies. No asset files for
audio (procedural Web Audio) and no textures required (vertex/flat colors; tiny CanvasTexture allowed).

Commands: `npm run typecheck` (covers `src/`, `dev/` and `vite.config.ts`) · `npm test` · `npx vite build` · `npm run dev` ·
`npm run levels` (level maps + difficulty metrics; `-- 3` for one level) · `npm run levels:fmt`.
The build uses `base: './'` (relative asset URLs) so `dist/` can be hosted under any subpath.

## Module map & ownership

| Path | Owner | Responsibility |
|---|---|---|
| `src/core/types.ts`, `math.ts`, `store.ts`, `sorting.ts`, `racks.ts`, `docks.ts` | shared | Contracts, helpers, tiny external store; `sorting.ts` = who accepts what (`accepts`, the single source of truth for logic, render and the level solvers; storage racks and trucks: `targetsOf`, `assignmentsOf`, `levelDestinies`, `cueFits`, `isDestined`); `racks.ts` = storage rack geometry (cells, fronts, slot ids); `docks.ts` = loading dock trucks (`trucksOf`, `hasTrucks`, bed cells beyond the wall, door cells, truck slot ids, `truckSlotsOf`, and `usesTargetRules` = racks or trucks, the gate of every «target rule») |
| `src/config/gameConfig.json` | shared | All tunables: `forklift`, `box` (`size`, `dropLandSec`), `stack` (`maxHeight`, `forkRiseSpeed`), `snap`, `camera` (incl. the player zoom: `zoomMax`, `zoomEaseSec`, `zoomTrackSec`, `zoomResetSec`, `zoomFollowSec`, `zoomRate`, `zoomStep`), `audio`, `controls`, `flow` (`completeDelaySec`, `confirmGraceSec`, `restartHoldSec`), `moves` (`showLowerBound`: show a minimum that is only a lower bound as "mín. ≥ N", default true) |
| `src/themes/*` | shared | Palettes (`Theme`). New theme = new file + entry in the `THEMES` map (`themes/index.ts`) |
| `src/data/validateLevel.ts` | shared | Level schema (`LevelData`) + validation |
| `src/data/asciiLevel.ts`, `src/data/difficulty.ts` | shared | `.level` text format: parser (→ validateLevel) and canonical renderer; `dificultad:` targets |
| `src/data/levels/*.level`, `src/data/levels/especiales/*.level` | **levels** | Level content (one text file per level, docs/LEVELS.md); `especiales/` = special levels outside the game's order (today the «Benchmark» of test mode) |
| `src/data/levels/index.ts`, `solver.ts`, `metrics.ts`, `report.ts` | **levels** | Registry (`LEVELS`, plus `SPECIAL_LEVELS` / `getSpecialLevel`); grid model + searches (tests, autopilot, metrics); difficulty metrics; `npm run levels` report |
| `src/data/levels/minimums.ts`, `minimumsBuild.ts`, `src/data/levelMinimums.json` | **levels** | The move counter's minimums: `levelMinimum(id)` → `{ moves, exact }` or null, read from the precomputed JSON (never solved at runtime); `minimumsBuild.ts` computes / formats / diffs it for `npm run levels -- --minimos` and `minimums.test.ts` (docs/LEVELS.md, «Mínimos del contador de movimientos») |
| `src/logic/**` | **logic** | Simulation (`GameState`, `Timer`), collisions, tests |
| `src/render/**` | **render** | three.js scene, meshes, camera, feedback animation |
| `src/audio/**` | **audio** | Procedural music + SFX |
| `src/ui/**` (except `uiState.ts`), `src/storage/**` | **ui** | React overlay, CSS, persistence |
| `src/game/**` | **game** | Frame loop, input, wiring, flow between screens |
| `src/integration/**` | integration | Cross-module tests (e.g. every level played by the autopilot of `autopilot.ts` on the real `GameState`, with the real controls: world-space moves, the vehicle reverse gear and the rack fork steps; `benchmarkPlayable` / `docksPlayable` also load and unload trucks) |
| `src/App.tsx`, `src/main.tsx`, `src/styles/base.css` | shared shell | Canvas host + overlay; sets `themeCssVars(theme)` (background gradient + `--ui-*` tokens) from the theme of the level on screen, the same one Game hands the renderer |

Data flow (one direction):

```
Input (keyboard/gamepad) ──► Game ──InputFrame──► GameState.update(dt) ──► GameEvent[]
                              │                        │
                              │                   GameSnapshot (read-only)
                              ▼                        ▼
                        UI store (UIState) ◄── Game ──► GameRenderer.update / handleEvent
                              ▲                        └► AudioEngine.handleEvent / setMotor
                        React Overlay ──GameActions──► Game
```

- Logic never imports three / DOM / audio. Render never mutates the snapshot. Audio never reads the snapshot.
- React never touches three. Game is the only module that imports all others.

## World conventions (see header of `src/core/types.ts`)

- 1 unit = 1 cell. Floor top at `y = 0`. Warehouse centered at origin. `cellToWorld` / `worldToCell`.
- Back walls: **north** at `z = -depth/2`, **west** at `x = -width/2`. Front edges are open (diorama cut-away).
- Heading `h` radians, forward = `(sin h, cos h)`. `LevelData.forklift.heading` in degrees (a `.level` arrow: `v` 0,
  `>` 90, `^` 180, `<` 270, or `rumbo:`). Meshes are modelled facing +Z
  and get `rotation.y = h`.
- Default camera yaw 45° sits toward `+x,+z`. Camera yaw `ψ`: camera horizontal position direction is
  `(sin ψ, cos ψ)`. Screen→world mapping (Game, `cameraInput.ts`): `forward = (-sin ψ, -cos ψ)`,
  `right = (cos ψ, -sin ψ)`, `move = right * moveX + forward * moveY`, then clamp length to 1.
- `controls` in gameConfig: `keyboardMapping` (keys + d-pad, default `"vehicle"`) and `stickMapping` (default
  `"screen"`). `"vehicle"` (user request 2026-09-28) is relative to the forklift, camera-independent: W/↑ forward,
  S/↓ reverse (≤ `reverseSpeed`), A/← turn left (heading increases), D/→ turn right; keys combine (W + A arcs).
  Game fills `InputFrame.drive` { throttle, steer } via `inputToDrive`; GameState routes non-zero drive to
  `ForkliftController.stepDrive` (turn inertia: ω eases to `driveTurnRate` at `turnAcceleration`, soft settle on
  release; while driving without steering, a heading within `headingAssistDeg` of a tile axis eases onto it; no
  self-rotation when parked), else to the camera-relative `step`. `"grid"` turns the screen direction 45° clockwise before mapping, so each key drives along a row of
  tiles: at yaw 45° D = +X, W = −Z, S = +Z, A = −X. It is recomputed from the live yaw, so after Q/E each key
  still drives along a floor axis (W always screen up-right, D down-right); single-key input snaps exactly onto
  the axis once the camera settles. `"screen"` drives straight along the screen direction.

## Gameplay rules (logic)

- Forklift = circle collider radius `bodyRadius` at `pos`. While carrying, a second circle (`carriedBoxRadius`)
  at the fork point `pos + forward * forkReach` also collides. Obstacles: warehouse bounds, shelves (cell
  rects), plants (0.6×0.6 centered in their cell), resting boxes (`box.size` square). Resolve with iterative
  circle-vs-AABB push-out (≥3 iterations) so the forklift *slides* along walls — never sticks, never jitters.
  A turn is tried with the current load radius first; a load that cannot grow yet never cancels it. When a turn
  has been refused for 0.08 s while the rig is pinned (< 0.15 u/s) and the other side has room, the forklift
  turns the long way round, once per intent (ends when the input changes by > 0.3 rad, is released, or a box
  is picked / dropped).
- Movement (`step`: gamepad stick and the `"screen"` / `"grid"` mappings; vehicle control `stepDrive` is described under
  `controls` above): camera-relative direct control. Desired direction → target heading. Heading has inertia: angular
  speed ramps up at `turnAcceleration` (rad/s²), cruises at `turnRate` (rad/s) and brakes early
  (ω ≤ √(2·a·error)) so it lands on the target without overshoot. Speed follows an S-curve toward
  `maxSpeed * alignment` (alignment = max(0, cos(Δheading)), so it turns mostly in place before driving): soft
  start ramp from rest, eased landing, `acceleration` / `deceleration` as peak rates. Feel is deliberately calm
  (tuned 2026-09-28 after playtest feedback: "más fluido, menos brusco y rápido"). `step` never reverses; `stepDrive` does (S, up to `reverseSpeed`): flipping
  W ↔ S first stops with the eased landing, then pulls away with the soft start. In reverse the visual `steer` is
  mirrored (rear-steered rig). The heading assist is its own eased turn rate scaled by speed (never turns a parked or
  pinned rig). With no input the rig settles with the release of the style it was last driven with.
  Pushing head-on into something (geometry block factor < 0.05, rig almost stopped) brakes at 2.5× deceleration.
  `steer` = signed turn intent for visuals. Per sub-step `wheelSpin += ((pos − prevPos) · forward) / wheelRadius`,
  so wheels roll with the ground actually covered (no spinning in place against a wall).
- Action (edge-triggered):
  - Not carrying → pick the best box: not carried, center within `pickupRadius` of the fork point and within
    `pickupAngleDeg` of forward; nearest wins. Emits `boxPicked` (+ `zoneReleased` if it was satisfying a zone).
  - Carrying → drop. Candidate cells: the cell under the fork point and its 8 neighbours. Valid = in bounds,
    not shelf/plant, no resting box, and the box square would not overlap the forklift body circle by more than
    ~0.05. **Zone magnet:** a zone that would take the carried box next (`core/sorting` `takesNext`: an empty zone
    that accepts it, or a stack zone whose recipe asks for its colour next; classic: a free zone of that colour)
    whose centre is within `zoneMagnetRadius` of the fork point wins: the most specific first (colour + symbol over
    one criterion), then the nearest. Other zones never pull; the
    nearest-cell rule still lands on them when the forks are over them. Otherwise nearest valid cell to the fork
    point. **Tight spot:** if no cell passes the 0.05 body tolerance, the nearest free cell overlapping the body by
    ≤ 0.15 is used, provided the body can be eased out along the push normal without hitting anything. A dropped
    box that overlaps the body starts with a shrunk collider that grows back at 0.4 u/s (`CollisionWorld.softenBox`
    / `settle(dt)`; picking calls `hardenBox`), so the forklift is eased out instead of popping. Emits `boxDropped`
    (with `correct`, `satisfiedCount`, `total`). If no valid cell: `actionIdle` (gentle, not negative).
  - Nothing to pick: `actionIdle`.
- `hint` in the snapshot is recomputed every update: `targetBoxId` when not carrying; `dropCell` / `dropZoneId` /
  `dropLevel` preview when carrying.
- **Stacks** (spec: `docs/STACKING.md`; the former levels 13–18, removed on 2026-09-30 to be redone: no shipped level
  stacks today, the system and its tests on inline layouts remain). `LevelData.stackLimit` (validateLevel fills it: the level's `limit`,
  else `stack.maxHeight` when the level uses stacking — a recipe longer than 1 or a stacked start — else 1, so the
  classic levels behave exactly as before). `LevelZone.recipe` (bottom → top, default `[color]`, `color` must be
  `recipe[0]`); box colors must equal the union of recipes as a multiset. Stacked starts: boxes with the same
  (x, z) are stacked in list order, first on the floor (no height field). `LevelGrid` keeps a per-cell stack of box
  indices. Pick = only the top box of a stack (collision check ignores the stack's own base). Drop candidates are
  free cells *or stacks with room* (the box goes on top, `BoxState.level` = height); the zone magnet only pulls
  toward a zone whose `ZoneState.next` (next recipe color while its stack is a correct prefix) is the carried
  color. `ZoneState` gains `recipe`, `stack` (ids bottom → top), `next`; `satisfied` iff the stack equals the recipe;
  `occupiedBy` = top box; `BoxState.correct` = stack from the floor up to it matches the recipe so far. Stacking onto
  a satisfied zone emits a neutral `zoneReleased`; lifting a wrong top box that leaves a zone satisfied again emits
  `zoneRestored` { zoneId, boxId, recipeLength, satisfiedCount, total } after `boxPicked` (a pick never completes a
  level). Events: `boxPicked.level`, `boxDropped.level` + `recipeLength` (`correct` = the drop completed its zone).
  Collision: a stack is one cell (only level-0 boxes collide); the body always collides; full stacks block the
  carried load. A stack with room lets the load pass over it (`CollisionWorld.setPassable` / `isPassable`) once
  `forkHeight >= height - LOAD_PASS_CLEARANCE` (0.25), and stays passable while the load is over it (never turns
  solid under it); until then it blocks the load like any box. `ForkliftState.forkHeight` (stack levels,
  continuous; 0 in classic levels) moves toward max(`dropLevel`, clear level) while carrying, the target box's level
  while empty (else the top box of a stack the tines reach). The clear level is the tallest stack the load (or the
  empty forks) is over or would reach before the forks could climb, predicted from the rig's motion, turn rate and
  throttle; the forks never go down while over a stack. Rate `forkRiseRate` (`logic/forkRise.ts`):
  `stack.forkRiseSpeed / (1 + 0.25·level)` (3.2: level 1 in 0.39 s, level 2 in 0.94 s). All of it is gated on
  `stackLimit > 1`.
- **Sorting** (spec: `docs/SORTING.md`; the former levels 19–24, removed on 2026-09-30 to be redone: today only the
  «Benchmark» uses symbols, the system and its tests on inline layouts remain). Every box has a colour and a symbol
  (`BoxState.symbol`: `LevelBox.symbol`, else `DEFAULT_SYMBOL[color]`, so classic levels are unchanged). A zone declares what it accepts
  (`LevelZone.color?` / `symbol?`, at least one → `ZoneState.accepts`): colour only = any box of that colour,
  symbol only = any box with that symbol, both = that exact box. `accepts(zone, box)` (core/sorting) is the single
  source of truth: a zone is satisfied iff its (bottom) box meets all its criteria, boxes above it follow the colour
  recipe (`fitsLevel`). Ambiguity is allowed (a box may fit several zones; any accepting one counts). `ZoneState.color`
  is the pad colour (`ColorId | null`, null = neutral pad), `recipe[0]` only the colour criterion (null without one).
  A level uses symbols iff a box or zone names one (`usesSymbols`); validateLevel then requires stackLimit 1 (no
  recipes, no stacked starts), one box per zone and a complete sorting (`assignBoxes`, augmenting paths). Events keep
  their shape (`boxDropped.correct` = accepted); Game passes the zone's `matchKind` to audio with each event.
- **Storage racks** (spec: `docs/RACKS.md`; no level of the game uses them yet, only the «Benchmark» special level). `LevelData.racks?` (`LevelRack { id, x, z, w, facing,
  columns: RackSlot[][] }`, slots bottom → top, cue `{ color?, symbol? }`, none = «libre»; a box starting in a slot is a
  `LevelBox` with `level`). Rack cells are solid for the body and for floor boxes; loading / unloading only from the
  front (`facing`), the cues are visible from both faces. Targets = zones + slots with a cue; validateLevel needs one box
  per target and exactly one complete assignment (up to identical boxes, `core/sorting` `assignmentsOf`), and every
  target is satisfied only by its destined kind (`ZoneState.destined`, `SlotState.destined`; levels without racks keep
  `destined: null` and the old rules). `GameSnapshot.slots`, `BoxState.slotId`, `hint.rack` (column faced + selected
  level, `ready`). `InputFrame.forkStep` (F / V, wheel, pad X / B) steps the selected slot level while at a rack
  column; `forkHeight` eases to it (`forkRiseRate`); elsewhere the forks stay automatic. The faced column opens for the
  carried load once the forks stand at the selected level and its slot is empty (walls: back panel + side uprights),
  and stays open while the load is inside; meanwhile the heading is locked (`ForkliftController.setHeadingLock`) and
  the level cannot change. Pick / drop act on the selected slot only with the forks at its level; facing a column never
  drops on the floor. Events keep their shape plus `boxPicked.fromSlotId`, `boxDropped.slotId` (`zoneId: null`),
  `zoneReleased { zoneId: null, slotId }`. Rack levels only (2026-09-30): a box resting on its destined zone or slot
  is locked (`BoxState.locked`; never a pick, drop or stack target, picking at it gives the gentle `actionIdle`), and
  `boxDropped.wrongTarget` is true when a box lands on a floor zone or a cued slot that is not its destiny («libre»
  slots and plain floor never); levels without racks keep `locked: false` and no `wrongTarget`. Every «rack level»
  rule here also holds in a level with trucks (below), with or without racks: the gate is `usesTargetRules(level)`.
- **Loading docks** (spec: `docs/DOCKS.md`, 2026-09-30; only the «Benchmark» has one). `LevelData.trucks?`
  (`LevelTruck { id, wall, x, z, w, columns: TruckCue[][] }`: a truck parked OUTSIDE a door of the north or west wall,
  its rear against the wall's outer face; (x, z) and `w` are its door cells, a straight run of plain floor cells along
  that wall, row z = 0 or column x = 0, each with one bed column just beyond the wall, outside the map (`core/docks`
  `truckCellOf`: z = -1 / x = -1; `truckFrontOf` = the door cell); 1‥`MAX_TRUCK_COLUMNS` (3) columns, cues bottom →
  top, colour and / or symbol, never «libre», 1‥`MAX_TRUCK_LEVELS` (2) levels and never more than `stackLimit`). Door
  cells start empty (no furniture, zone, box or forklift); a box loaded at the start sits on its bed cell. `LevelGrid`
  keeps each bed column's stack apart (`truckColumnAt` finds it by its outside cell). The forklift body meets the whole
  wall (`bounds`), so it stops at the wall line; the carried load and the fork point meet the walls as slabs open at
  each door between 0.02 jambs onto a 1-cell pocket, the bed column (`CollisionWorld` `loadWalls`, `doorWalls`; only
  in levels with trucks), and for the load each column's span of the door stays shut like the wall until the rig faces
  that column (`doorCells`, `setDoorOpen`, `GameState.refreshDoorPassage`: like a rack column; open while the load is
  in it), so a load turned on a door cell meets it like the wall until the rig faces that column, and never slides
  along a wide door into the next one. A bed column loads like a floor stack, only from its door cell facing the wall
  (the body in line with that door cell; `TRUCK_FACING`: south for a north dock, east for a west one; ≤ 30°, held to
  45°) with the fork point at least `TRUCK_REACH` (0.3) past the wall line; forks automatic, F / V do nothing; while
  the load is in the door the heading is locked (straight in, straight out, like a rack slot) and nothing drops short
  of the bed (`RackAim.doorway`).
  Every truck level is a target of the unique assignment (`targetsOf` kind `'truck'`, `levelDestinies.trucks`).
  `GameSnapshot.truckSlots?` (absent without trucks) = `TruckSlotState { id "t1:col:level", …, accepts, destined,
  occupiedBy, satisfied, loadable }`: `satisfied` = its destined box on satisfied levels below; `loadable` = the empty
  next level of its column with everything below satisfied (the only one that pulses). A box on a satisfied level is
  locked (never picked) but the next level still loads on top of it; any other box on a truck level buzzes
  (`wrongTarget`) and stays pickable. A full column faced up close drops nothing (`actionIdle`, never the floor beside
  it). Optional fields only in truck levels: `BoxState.truckSlotId`, `hint.dropTruckSlotId`,
  `boxPicked.fromTruckSlotId`, `boxDropped.truckSlotId` (`zoneId: null`, `recipeLength` 1), `zoneReleased.truckSlotId`
  (never fires today); events and snapshots of levels without trucks are exactly as before.
- Fork lift animates `forkLift` toward 1 while carrying, 0 otherwise, at `forkLiftSpeed` (units of 0‥1 per s).
- Level completes when every target is satisfied (every zone; also every cued rack slot and every truck level) and
  nothing is carried → `levelComplete` exactly once, after which
  updates ignore input (forklift coasts to rest).
- `firstInput` exactly once, on the first frame with non-zero move, non-zero drive (throttle / steer) or an action press (Game starts the timer).
- `GameSnapshot.moves`: box moves so far this attempt, the solver's «movimientos» criterion (one pick + one drop
  somewhere else = 1). A drop exactly where the box was picked up (same cell and height, same rack slot) counts
  nothing. Counted on the drop, before its `boxDropped` (so a `levelComplete` snapshot already has the final count);
  0 on a fresh GameState (load, restart).

## Level data (levels)

- Authoring format: one `src/data/levels/*.level` text file per level: title `# order · name`, header (`id:`,
  `limit:`, `ventanas:`, `rumbo:`, `tema:`, `dificultad:`, `nota:`), an ASCII map and a Spanish legend (full grammar,
  metrics and workflow: `docs/LEVELS.md`). Pipeline: `src/data/levels/index.ts` loads `*.level` with
  `import.meta.glob('./*.level', { query: '?raw' })` (plus legacy `*.json`), `parseLevel` (`src/data/asciiLevel.ts`)
  turns the text into a raw level object and hands it to `validateLevel`, which fills the defaults (`LevelData` in
  `src/core/types.ts`). Errors are Spanish, `file:line:column: motivo` (validateLevel's own messages are translated and
  placed on the map cell or legend entry to fix). Ids and orders must be unique across both formats. `renderLevel`
  writes any LevelData back as canonical text; `parseLevel(renderLevel(l))` deep-equals `l` (tested for every shipped
  level). The 24 JSON levels were migrated with a deep-equality proof and deleted: `.level` is the single source.
  Levels 4–24 were then removed (2026-09-30) to be redone: the game ships levels 1–3 (`SHIPPED` in `levels.test.ts`).
  Saves written by the 24-level game still load: `ProgressStore` reads indices past the last level as the last one
  and ignores times of ids no longer in the game (the stored document is not rewritten).
- Special levels: `src/data/levels/especiales/*.level`, same format and validation, outside the game's order. The
  `LEVELS` glob is not recursive, so they never reach `LEVELS`, saved times, unlocks or "Continuar"; the registry loads
  them apart (`SPECIAL_LEVEL_SOURCES`, `SPECIAL_LEVELS`, `getSpecialLevel(id)`) and refuses an id or order that clashes
  with a game level (`loadSpecialSources`). Today only the «Benchmark» (`BENCHMARK_ID = 'benchmark'`, order 100), played
  from test mode (`Game.startBenchmark`). `npm run levels` reports them after the game's levels ("Toro · 3 niveles + 1
  especial"), `levels:fmt` and the round-trip test cover them too.
- Level ids key saved progress (and seed the decor RNG): never change a shipped id. Box / zone ids are generated
  `b1…` / `z1…` in legend order unless written `(id)`; nothing outside the level depends on them.
- `src/data/levels/solver.ts` is the only grid model (conservative carrying model with the reverse gear, greedy
  search, exact A* for the fewest box moves with a consistent bound — swap cycles, dead-end corridors, fixed sorting
  destinations —, the dead-end check `deadEnds`, and storage rack slots as positions after the floor cells, then one
  stack position per truck bed column (outside the map), loaded with one step forward from the cell behind its door
  cell and emptied only in reverse; in levels with racks or trucks the exact search adds the destination-cycle bound
  `MoveSearch.destTerm`).
  `levels.test.ts`, the autopilot (`src/integration/autopilot.ts`, run by `levelsPlayable.test.ts`,
  `racksPlayable.test.ts`, `benchmarkPlayable.test.ts` and `docksPlayable.test.ts`) and the metrics (`metrics.ts`:
  movimientos, obligadas, extra, bloqueos, estrechas, libre, ambiguas, trampas, repartos, callejones, huecos, camion)
  all import it. `npm run levels` (`scripts/levels.mjs`: Vite `createServer` + `ssrLoadModule`, no port) prints maps and a
  metrics table; `npm run levels:fmt` rewrites files canonically. A `dificultad:` header (e.g. `extra>=2, bloqueos>=1`)
  declares targets that `levels.test.ts` proves against the measured metrics.

## Level design (levels)

- Lanes the forklift must turn in should be ≥ 2 cells wide; 1-cell corridors only for straight runs. No level may
  have a dead end («callejones», docs/LEVELS.md; `levels.test.ts` checks every state of a shortest plan).
- Storage racks (docs/RACKS.md) are loaded by driving straight at a column: its front cell and the cell behind it must
  be free floor (validateLevel checks the front cell; the solvability tests catch the rest). Trucks (docs/DOCKS.md) too:
  their door cells start empty (validateLevel) and the cell behind each must stay free floor, so keep zones off the door
  row and the row behind it (a box locked there would close that column: a «callejón»). A dock door never shares a
  wall cell with a window.
- Leave ≥ 1 free cell around every box on at least one side the forklift can approach from, and ≥ 2 free cells
  somewhere reachable to park a box temporarily (a level whose boxes start on wrong zones needs spare space to
  reorganize).
- Level 1 is one straight run along the forklift's start heading, so holding W alone (`"vehicle"` mapping) reaches
  the box and then the zone (`src/integration/level1Controls.test.ts` simulates it with the real GameState). 3-tier shelves only against the back walls (z = 0 or x = 0).
- Today the game ships levels 1–3 (classic, stackLimit 1); levels 4–24 were removed on 2026-09-30 to be redone.
  They were three chapters: 1–12 classic, 13–18 stacking (13–14 stackLimit 2), 19–24 sorting by colour + symbol
  (stackLimit 1). The level tests keep the chapter-aware checks (box count and area grow within each chapter, which
  starts small again). Start headings face a box straight ahead; the stacking and sorting chapters drove away from the
  camera (every sorting zone further from it than the start). The shared grid model (`src/data/levels/solver.ts`, used by `levels.test.ts` and the autopilot in
  `src/integration/levelsPlayable.test.ts`) keeps per-cell stacks of boxes (colour × symbol): a move lifts
  a stack's top box and drops it on the floor or on a stack with room (conservative: stacks block driving and turning
  sweeps); zones accept by their criteria, and in sorting levels a layout whose loose boxes have no complete sorting
  left (a trap) costs one more step.
- Colors are introduced in `COLOR_IDS` order. Shapes: small, readable warehouses; generous empty floor.
- Decor is sparse: 1–4 plants in corners/edges, 1–3 windows on north/west walls. Never clutter lanes.

## Render direction (render)

- Orthographic camera, pitch `camera.pitchDeg` (38°), yaw 45°, auto-fit so the whole warehouse (incl. walls)
  is visible with `camera.padding`, on any aspect. Q/E rotate yaw by 90° with a slow ease-in-out
  (`rotateDurationSec`). Idle orbit on title: extremely slow yaw drift. Never shake, never snap. The auto-fit
  never zooms in during a Q/E turn or the idle orbit: the frame stays at least as wide as the blend of the two
  diagonal (45° + k·90°) framings around the current yaw (the player's zoom, below, is a separate factor on top).
  **The camera never reframes on its own** (user rule 2026-09-30): the framing changes only with the player's input (a
  Q/E turn, the zoom, a canvas / window resize), the title's orbit and its glide to the nearest canonical yaw as a
  level starts from it (1.44 s), and a freshly loaded level (a cut). The fit boxes (`CameraRig` `FitBox`) are static:
  the floor up to `DIORAMA.contentHeight`, each back wall whole, racks, docks (truck + sign). A wall is framed at full
  height even while it is sunk: it then stands on the camera's side of the room, where its top never reaches the edge
  of the frame, so the framing at rest is bit for bit the settled sink's (every level, any room ≥ 2 × 2) and nothing
  clips mid-turn; walls sinking or rising, forks, loads and trucks never move the frame. Every ease lands exactly
  (zoom, followed point, bands; the yaw sheds whole turns only as a turn starts), so at rest the camera is
  bit-identical frame to frame (`CameraRig.test.ts`, «never moves on its own»).
  The fit frames the canvas minus the bands the DOM overlay keeps over the scene while playing (HUD pills at the
  top, control hint at the bottom; `useReservedArea` in `ui/reservedAreas.ts` → `GameActions.setViewInsets` →
  `GameRenderer.setViewInsets` → `CameraRig.setInsets`, ≤ half the canvas). They are reported once as a level starts
  (entering play, or a new level while playing: read right after the DOM commit, in a layout effect, so they reach
  the camera before the level's first frame is painted) and again only on a viewport resize: a piece that changes
  size mid-level (a hint row or its wording, a pill, fonts) is measured but waits for the next level or resize, and
  a restart of the same level keeps them. The camera takes them at once (the renderer redraws right away), except
  with the title's orbit and its glide into a level, where they glide in over the same 1.44 s (hermite, exact end):
  one calm motion. Held while the completion card is up, none on the title.
- Player zoom (user request 2026-09-30): `GameRenderer.zoomBy(deltaLog2)` (a step; + = closer, in log2 "stops", +1 =
  twice as close), `zoomTrack(deltaLog2)` (zoom that follows the input as it moves) and `resetZoom()` → `CameraRig`,
  fed by Game while playing from `InputSample.zoomStep` (a + / − tap's small step on the press, a Ctrl + mouse wheel
  notch) and `InputSample.zoom` (held + / − and pad RT / LT give a rate × `dt`; a pinch — trackpad Ctrl + wheel, two
  fingers on the scene, Safari's gesture events — the log-ratio of that frame). Zoom 1 = the full-warehouse auto-fit
  above and is the floor (never further out); the ceiling is `camera.zoomMax` (2.5×). A step eases in on a critically
  damped spring (`zoomEaseSec`: calm, no overshoot; the way back to the full view is slower, `zoomResetSec`); a step
  against one still easing in starts from what is on screen (a − tap never ends closer than the view was). Tracked zoom
  moves the view and that goal together over `zoomTrackSec` (0.15 s, first order), so a held key stops ≈ 0.05 stops
  after the release instead of gliding on to a goal that ran ahead of the view (it used to overrun ≈ 0.3 stops). While
  the page itself is still pinch-zoomed (`visualViewport.scale` > 1.01, e.g. after a pinch over the title) pinches stay
  the browser's even while playing, so the player can pinch it back to 1. As the zoom grows the framing target blends from the level centre to the
  forklift (followed with `zoomFollowSec`; once it stops the followed point lands exactly on it, 0.1 mm), clamped so
  the visible free area stays over the (padded) level; zooming fully out returns to the centred full view, and at zoom
  1 the forklift never moves the frame. Q/E turns pivot around that target; the reserved bands (`setInsets`) and
  occlusion ghosting compose with it (a dock's truck is static and always framed: it never moves the frame). Reset to
  1 on a level change and on the title (the idle orbit stays unzoomed); kept across a restart of the same level.
  `zoomRate` (stops / s held) and `zoomStep` (stops per tap) tune the keys. The plain mouse wheel never zooms: it
  stays with the forks (docs/RACKS.md).
- `WebGLRenderer({ antialias: true, alpha: true })`, transparent clear (CSS gradient shows through),
  `outputColorSpace = SRGB`, `toneMapping = NeutralToneMapping`, pixel ratio ≤ 2. Soft shadows from one
  warm directional "window" light (PCFSoft, map 2048, tight shadow camera fitted to the level) + hemisphere.
- Materials: `MeshStandardMaterial` (roughness ~0.85, metalness 0) or Lambert; flat colors from `Theme`.
  Share geometries/materials between instances; dispose everything on `loadLevel` / `dispose`.
- Diorama: floor slab with a thin visible edge (thickness ~0.25, color `floor.edge`), faint alternating floor
  tiles or 1-px grid lines (very subtle), two low back walls (north + west, height ~2.2, with trim/baseboard and a
  top cap) with windows: light-wood frame, warm emissive glass, optional very faint light-shaft planes
  (additive, opacity ≤ 0.08). Shelves: light-wood frames with neutral kraft boxes (never functional colors).
  Plants: soft pot + 2–3 low-poly icosahedron/cone leaf clumps in sage. Each shelf is its own mesh and fades
  to a clean ghost (~0.35 opacity, depth prepass) whenever it stands in front of the forklift, a box or a zone.
- Zones: rounded-square pad slightly raised (≈0.02), `fill` color, inset border in `border` color like floor
  tape, tone-on-tone glyph (`theme.glyphs`; the diamond is a rhombus, never a rotated square). Satisfied → emissive `glow` eases up (≈0.35) then settles (≈0.15),
  plus one soft expanding ring that fades out (≈0.8 s). While carrying a box, zones that would take it
  (`takesNext`; classic: free zones of that color) breathe gently (slow sine on emissive), teaching the goal without
  text. Sorting levels (`usesSymbols`): pad colour = colour criterion (`theme.neutralZone` cream when none), the
  symbol criterion is engraved large in the middle (a real recess, floor in `ZonePalette.engrave`), no glyph otherwise;
  when no free zone takes the carried box, the occupied zones that accept it breathe at ≈ ⅓ (a swap hint).
- Boxes: low-poly beveled cube (`box.size`), `base` color, tape strip across the lid in `tape`, the box's own
  symbol on the lid (small tone-on-tone glyph; in sorting levels printed 1.5× larger in `BoxPalette.ink`). Pick →
  small hop then ride on forks (visual position damped, never teleports). Drop → eased glide to
  the cell lasting `box.dropLandSec` (0.26 s; the zone celebration and the audio thump wait for it), then a
  squash/stretch settle (≈0.35 s, easeOutBack, scale ≤ 1.08). Correct → persistent faint emissive.
  `targetBoxId` → subtle lift/brighten (≈+0.05 y, emissive 0.16). `dropCell` → soft outline square on the floor
  (in the carried box's zone tone if the drop is on a zone that takes it). `actionIdle` → tiny gentle wobble (never
  red, never shake).
- Forklift ("simpático"): compact body (cream), rounded cabin frame/roof, counterweight, seat, two mast rails,
  forks that move with `forkLift` (y 0.06 → 0.34), 4 low-segment wheels spinning with `wheelSpin`, rear wheels
  steered by `steer`, two round headlight "eyes" at the front that occasionally blink (every 4–8 s),
  slight body pitch on acceleration and roll on turns (≤ 3°). Carried box rides on the forks.
- Level complete: zones glow in a gentle sequential wave, window light warms slightly. No flashes, no particles
  storms, no screen effects. Everything eases.
- Stacks: box y = `level · boxHeight` (visual height `box.size · 0.82`); drop glide ends on the stack top (landing
  up from lower forks it lifts first, then slides on top). As a box lands, the whole stack dips together (3.5 % of
  a box height, no squash, no seam). The carriage adds `forkHeight · boxHeight` (eased in the view) and an inner
  mast stage appears only while raised. A stack zone draws its recipe as a mini stack of colored steps with cream
  spacers on a cream plinth, at two opposite pad corners (one glow-material mesh per step); the step the carried
  box would fill breathes with the zone. The drop outline floats on the stack top. A completed stack glows box by
  box bottom → top (stacked boxes glow without the bob). A zone un-completed by a box stacked on top keeps its glow
  until that box lands. In stack levels, a box above the floor fades to a ghost (0.55) while it hides the forklift
  cabin, another box's lid or a zone pad; base boxes never ghost, and every box turns solid once the level is
  complete (materials stay `transparent`; classic levels are untouched).
- Storage racks (docs/RACKS.md, «Render»): their own furniture (`builders/rack.ts`, `views/RackView.ts`): plain
  low-poly slate metal (no diagonal braces), cream beams, open slots, a faint see-through plate at each end (no solid side wall: `END_PLATE`, opacity 0.2, no depth write, so the end column's boxes show through), a back panel per slot, and a
  loading line painted on the floor in front (`Theme.rack`). The cue is an unlit, opaque sticker (`createCueMaterial`)
  in the exact box colour (or the neutral cue fill) with a bold `rack.cueInk` glyph, on both faces of the back panel
  and on the outer face of the end plate for the end columns, so a rack reads from all four camera angles. Slot n's
  floor is at `rackSlotY(n)` (`dims.ts` `RACK`, taller than a stack level). A slot (panel emissive + cue brightening)
  glows only with `slot.satisfied`, breathes with `cueFits` while a box is carried (≈ ⅓ swap hint on an occupied,
  unlit slot when no free target takes the box); each column ghosts on its own like a shelf (0.35 over the forklift or
  its load, its slot boxes with it; a softer 0.6 over resting boxes or zones), while its cues never fade or dim (drawn
  in the opaque pass, before any ghost). `views/SlotMarker.ts` frames the selected slot (`hint.rack`,
  brighter when `ready`); the drop outline floats on the slot floor. At a rack the forks ride just over the selected
  slot floor (`ForkliftView.sync(…, atRack)`, eased blend, little pitch); slot boxes rest at `rackSlotY(level)`.
- Loading docks (docs/DOCKS.md, «Render»): the dock door is an opening in its wall over the door cells
  (`builders/walls.ts`, `dims.ts` `DOCK`: up to `doorTop` 1.70, over a level-1 load's ≈ 1.62; slate frame on both
  faces, the shutter's bottom rail at the head and its roll outside above the door, rubber seals and bumpers outside,
  baseboard broken). The truck (`builders/truck.ts`, `views/TruckView.ts`, `Theme.truck`: soft cream and slate, never
  a box colour, never red or black) is a small low-poly rigid truck parked entirely outside, its bed's rear 0.012 off
  the wall's outer face (`TRUCK`, `buildTruckBody`): a low open flatbed level with the floor (`DOCK.bedTop`: boxes rest
  at floor stack heights), low drop sides only at the ends of the door run and a headboard by the cab (nothing over or
  between the bed columns: no posts, rails or dividers), the cab facing away, wheels and a driveway a step down; a flat
  dock plate fills the door (`DOCK_PLATE`, `buildDockPlate`, under the drop preview). It is static: low enough never to
  hide the warehouse, it never sinks with its wall (the boxes on its bed are ordinary `BoxView`s at their state
  positions) and it is always framed (a static `fitBox`), so the zoom never moves for it. The cues are on a framed sign
  on the wall's inner face above the door (`DOCK_SIGN`, `buildSignFrame`, `buildSignPanel`, `buildSignCue`,
  `SIGN_CUE`): one cell per bed column, right above its door cell, and per level, bottom row = level 0 (the upper cell
  of a shorter column is a plain panel; with 2 levels the sign rises ≈ 0.3 over the wall cap), each with its unlit rack
  sticker (`buildCueFace`) on both faces, upright and unmirrored, never faded (its two brackets hide behind the frame's
  end bars, clear of every sticker). The sign's frame and panels are a rack bay (`RackBay` kind `'sign'`,
  `TruckView.occluder`) that ghosts over the forklift, a resting box or a zone (never for the boxes on its bed) and
  softly while its wall is sunk; its stickers never fade. What a standing dock wall hides (a box on the bed, the part of
  a load through the door) never ghosts a shelf, a rack or a stacked box (`LevelView.clipToRoom`). A truck level lights
  exactly like a rack slot (`SlotLight` on its sign cell: flash, soft glow, glow band round its sticker, `SIGN_GLOW`),
  with the success burst and the locked box tone on its box on the bed; while carrying, only a `loadable` level whose
  cue fits pulses, and the drop preview (on the bed cell, outside) takes the box tone only there. Levels with trucks and
  no racks switch on the same target feedback (`usesTargetRules`); without trucks nothing changes.
- Performance: aim < 150 draw calls on the largest level, no per-frame allocations in hot paths,
  `renderer.setAnimationLoop` NOT used (Game drives frames; `update()` renders once).

## Audio direction (audio)

- Web Audio graph: buses (music / sfx / motor) → master gain → gentle lowpass (~10 kHz) → soft compressor →
  destination. Mute = master ramps to 0 over ~0.4 s. Suspend when the page is hidden, resume on return.
- Music: generative lo-fi (~70 BPM), look-ahead scheduler (setInterval 25 ms, 0.2 s horizon). Jazzy major
  progression (e.g. Fmaj9 – Em7 – Dm9 – G13sus or I–vi–IV–V with 7ths/9ths) with slow harmonic rhythm (1 chord / bar).
  Layers: warm detuned pad (slow attack/release, lowpassed), electric-piano-ish keys (sine + soft FM, gentle
  velocity variation, sparse voicings), sparse pentatonic melody chosen probabilistically (never the same
  bar twice), occasional Karplus-Strong guitar plucks/arpeggios, optional ultra-soft brushed hat/kick at very
  low level. Fade in over ~4 s on unlock. Density slightly lower on title. Mixed low (bus gain from config).
- SFX (each with ±4–6 % random pitch/gain so nothing repeats identically):
  - pick up: light wooden knock (short bandpassed noise + low sine body). The lift itself is the forks' continuous pump
    whir (motor, below); the one-shot servo glide that used to follow the knock was removed on 2026-09-30 (it blurred
    into the pump).
  - drop: soft felt thump scheduled `box.dropLandSec` after the event, when the box touches the floor; if
    `correct`: a chime whose pitch climbs a pentatonic scale with `satisfiedCount` (satisfying
    progression), in the current music key; its timbre follows the zone's `matchKind` (passed by Game as
    `handleEvent(event, match)`): colour = the warm bell, symbol = a soft wooden marimba (`instruments/wood.ts`),
    exact = both, softer (`CHIME_LEVELS`; all three peak within ±0.2 dB).
  - stacks: a drop on a box is a lighter, higher wooden "toc" (+12 % pitch per level, less sub); the pickup knock and
    the fork pump rise per level too; a completed stack zone plays `recipeLength` soft pentatonic notes climbing into its
    chime (the lower notes skip avoid notes over the sounding chord). `zoneRestored`: the zone's chime (and stack
    climb) 0.12 s after the pickup knock, no final flourish.
  - storage racks (docs/RACKS.md, «Audio»): `boxDropped.slotId` → `slotDrop`, a soft metal "toc" (no floor bass,
    rises per level) whose chime (by the cue's `matchKind`) plays only when `correct` (the destined box); a box that
    merely fits, or any box in a «libre» slot, just settles. `boxPicked.fromSlotId` → `slotLift` (lighter knock, faint
    metal; the lift is the pump whir). `AudioEngine.forkClick(level, direction)`: a soft detent click per fork step that
    took effect at a rack column (Game decides with `audio/forkSteps.ts` `ForkStepWatcher`). `boxDropped.wrongTarget`
    (levels with racks or trucks) → `wrongBuzz`, a soft muffled "no" after the landing (docs/RACKS.md).
  - loading docks (docs/DOCKS.md, «Audio»): `boxDropped.truckSlotId` → `truckDrop`, a hollow wooden "thunk" of the
    trailer's planks (`TRUCK_BED_MODES` + a cavity resonance, no sub), a little higher and with a fainter bed per level;
    chime only when `correct`, the buzz when `wrongTarget`. `boxPicked.fromTruckSlotId` → the plain `pickup`.
  - zoneReleased / actionIdle: barely audible soft tick (never a buzzer, never "wrong"). A release caused by
    stacking onto a satisfied zone ticks when that box lands (0.03 s after its knock); a pick-up releases at once.
  - levelComplete: gentle ascending arpeggio (on the 8th-note grid, after the final landing chime and a completed
    stack's climb into it) + pad swell on the downbeat the music resolves on; music ducks slightly, then returns.
  - motor (`audio/motor.ts` `MotorSound`, rewritten 2026-09-30; every value in its named tables `DRIVE`, `ROLL`,
    `FORK`, `CLUNK`; all on the motor bus, so M mutes them; built once, `set()` allocates nothing per frame):
    `setMotor(speed, forkMotion, forkHeight)`, both motions signed −1‥1.
    - drive: an electric traction whine of pure sines (rotor tone 170 Hz at a crawl → 440 Hz at full speed, its
      octave and a faint inverter partial; low-pass opening with speed), nothing that reads as a combustion engine; a
      soft tyre roll (filtered noise) with a faint swell at each tile joint. Both follow |speed|, silent when stopped,
      ≈ 7 dB under the music at full speed.
    - forks: going up, the electric pump's soft whir (150 Hz, a slow beat against a sine just over its octave, +12 %
      per level); going down, a softer, lower tone (104 Hz) with a light hiss; a tiny low clunk at the end of a travel
      (only after ≥ 0.15 s of motion, at most one per 0.3 s, never within 0.8 s of a pick or drop:
      `AudioEngine.hushForkClunk`).
    - reverse beeper (`audio/beeper.ts` `ReverseBeeper`, `BEEPER`): while the forklift really moves backwards (S, or
      backing out of a rack slot or a truck), a sweet, soft "tin… tin… tin", one strike per beat of the music
      (0.86 s), scheduled on the audio clock (2026-09-30: the ≈ 1.1 kHz sustained alarm before it was "too
      industrial"). A sine on the song's tonic or fifth, whichever is nearest F♯5 (622–880 Hz with the composer's
      keys), and a faint octave (0.16) whose own faster envelope sits under the beep's; no odd harmonic. Each beep is
      a strike: a quick soft rise (τ 5 ms, the peak in ≈ 15 ms), then a natural decay (τ 0.1 s: ≈ 0.3 s of ring, gone
      long before the next beat); no click. It plays on the SFX bus (`MotorSound`'s `beepOut`; on the quiet motor bus
      it vanished), level 0.08: its loudest 100 ms ≈ −31.5 LUFS, the music's own mean, ≈ 6 dB under the old alarm,
      ≈ 9 / 11 dB under a pick-up / floor drop, yet ≈ 12–14 dB over the music in its own third-octave band (measured
      offline: `dev/audioPreview` `toroLevels()`). `Settings.reverseBeep` (persisted, additive, default on; B on the
      title and while playing, `Game.toggleReverseBeep`; the title footer reads "B pitido" / "B activar pitido", and
      in a level the notice pill says "Pitido de marcha atrás: sí / no") → `AudioEngine.setReverseBeep` →
      `ReverseBeeper.setEnabled`: off, backing up stays silent and a beep sounding fades out at once (τ 25 ms).
  - uiClick: tiny soft wooden tap.

## UI direction (ui)

- DOM overlay, Nunito (loaded in `index.html`), warm gray text (`--ui-text`), frosted cream panels
  (`--ui-panel`, `backdrop-filter: blur`), radius 16–20 px, soft shadows, no pure black/white contrast.
- HUD while playing — only four things: level ("Nivel 3", top-left), time ("0:42", top-right, tabular numbers;
  clicking it or T toggles hide/show — hidden shows a small faint clock glyph), the optional move counter (left of
  the time, same pill family: a small box glyph, the count, then the level's minimum smaller and softer, "12 · mín.
  10", or "mín. ≥ 10" for a lower bound; clicking it or N toggles it — hidden shows a faint box glyph; each new count
  settles in with a gentle tick, `.ui-tick`; once the level is finished (`UIState.finished`) at or under the minimum
  the pill takes a soft accent wash and edge and a sparkle replaces the box, never red), restart button (round, icon
  ↺, `aria-label="Reiniciar nivel"`; a soft disc fills it while R is held, see Game flow). Nothing else. Fades in
  gently. HUD buttons never take focus from a mouse press (Space stays the game's key). Both corners reserve the top
  band (the camera frames the level below them); under 480 px wide the end corner stacks the counter under the time.
- Control hint, always on screen while playing, in every level (it never fades out on its own): tiny keycaps at the
  bottom center — "W S avanzar / atrás · A D girar · Espacio recoger / dejar · + − zoom" (zoom last, so the row stays
  one line at desktop widths; pinch and pad LT / RT are not listed) — and, in levels with storage racks
  (`UIState.racks`, published by Game when a level loads), a second row in the same panel: "F V subir / bajar
  horquilla · rueda" (the pad's X / B also step the forks but are not listed). Trucks add nothing to it (their forks are automatic, no new keys).
- Title screen: game name "Toro", subtitle "Un pequeño almacén, a tu ritmo.", primary button "Empezar" or
  "Continuar", discreet level dots in centred rows of up to twelve (3 levels today = one short row; 22 px dots on
  short windows such as
  800×450) (unlocked ones clickable, show best time on hover/focus; locked ones
  read "Nivel N · por descubrir"), small footer "Q / E girar cámara · + / − zoom · M silencio (M activar sonido when
  muted) · B pitido (B activar pitido when off) · T tiempo · N movimientos · Esc inicio · [Modo prueba]". Diorama visible behind (idle orbit).
- **Modo prueba** (`Settings.testMode`, persisted, additive field, default off; `UIState.testMode`,
  `GameActions.toggleTestMode()`): the footer switch (`aria-pressed`) or U on the title opens every level dot. While
  playing, PageUp / PageDown (RePág / AvPág) or the two keys right of P (`BracketLeft` / `BracketRight`: `[` / `]`
  on a US layout; matched by `e.code`, with or without AltGr, so Spanish / ISO layouts work too, except that a key
  typing "+" zooms instead: on Spanish / German / Italian layouts the next level is AltGr + that key) load the previous
  / next level fresh: at once while no box has been picked, else held like R (`flow.restartHoldSec`, same ↺ fill).
  Unlock progress is never modified: a level open only because of test mode records no time (a ranking would
  unlock its successor), does not unlock anything and never becomes the "Continuar" target; its card shows only
  "Tiempo" plus the quiet line "Modo prueba · este tiempo no se guarda" (`LevelResult.practice`). Genuinely
  unlocked levels behave normally. HUD adds a faint "prueba" tag next to "Nivel N"; tag and switch share the
  tooltip "Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente".
- **Benchmark** (test mode only; `GameActions.startBenchmark()`, `UIState.benchmark`): a quiet "Benchmark" button right
  after the switch, shown only while test mode is on (a plain button: Tab / Enter / Space; the title has no gamepad
  focus navigation, as for the dots and the switch). It plays the special level of the same name, which saves nothing.
  HUD: "Benchmark" instead of "Nivel N" with the faint tag "sin récord" (tooltip `BENCHMARK_TIP`). Card: eyebrow
  "Benchmark", "Tiempo" only, the line "Modo prueba · sin récord", primary "Volver al inicio", quiet "Repetir". Behind
  the title (left with Esc) the caption reads "Benchmark · sin récord" and no level dot is marked current. The app
  shell takes the theme from the Benchmark while it is on screen.
- Mute toggles are confirmed by a polite live region and, in a level, a brief top-center pill (~1.6 s).
- Completion card: compact (≤ 420 px) and anchored at the bottom center so the tidied warehouse stays in view;
  rises in, settles down on exit. Positive `result.message` as heading, one row of at most two tiles, one per
  metric, each with the level's record on a small soft line under its value: "Tiempo 0:42.3" over "mejor 0:38.9"
  (with the timer shown), "Movimientos 12 · mín. 10" over "récord 11" (with the move counter shown; a count at or
  under the minimum reads "10 ✦ mínimo" on a soft accent tile). A new record (`isNewBest` / `isNewBestMoves`, a first
  clear has nothing to beat) reads "✦ nuevo récord" in place of the record line, on that tile's soft accent wash:
  never a row of tags, so the card keeps one stat row and its top edge stays below the middle of the framed diorama
  (ui.css; measured at 740×360, 800×450, 1280×640 and 360×740). A lone tile (one display hidden) is centred.
  Practice runs (Benchmark, "Modo prueba") show no record line and add the quiet note ("… este tiempo / estos
  movimientos / este resultado no se guarda", "Modo prueba · sin récord" for the Benchmark). One action row: primary
  "Siguiente almacén" (or "Volver al inicio" when `isLast`, with the line "Todos los almacenes están en orden."), quiet "Repetir". The HUD
  dims. Never negative wording, never deltas like "+3 s" or "+2 movimientos".
- `unsupported` screen (no WebGL 2, or a render crash caught by the shell's error boundary): one calm centred
  card with a "Recargar" button, nothing else.
- Time format: `m:ss` in HUD, `m:ss.d` on the card. Move minimum: `formatMinimum` ("mín. 10" / "mín. ≥ 10");
  `reachedMinimum(moves, min)` = `moves <= min.moves` (a lower bound reached is optimal too).
- Theme UI tokens: `text`, `textSoft` (≥ 4.5:1 on panels), `panel`, `panelBorder`, `accent`, optional
  `accentDeep` (primary button fill, ≥ 4.5:1 with `accentText`; exposed as `--ui-accent-deep`), `accentText`, `shadow`.
- Storage (`ProgressStore`, key `PROGRESS_STORAGE_KEY`): versioned JSON under one localStorage key, all access in
  try/catch with in-memory fallback, best time + top-5 ranking per level id, fewest moves per level id (`bestMoves`,
  additive, same version: `getBestMoves` / `recordMoves`, replaced only by strictly fewer, never progress on its own),
  highest unlocked index, last level (index + `lastLevelId`, additive, same version), settings (`muted`, `showTimer`,
  `showMoves` additive default true, `reverseBeep` additive default true, `testMode`). Saves written before an additive field simply lack it (defaults). Unlocks and "Continuar" resolve by level id against
  the current play order (constructor arg `levelIds`, default `LEVELS`), so inserting a level never re-locks one.
  Indices past the last level (a save from a game with more levels) read as the last one, and rankings of ids no
  longer in `levelIds` are ignored (kept in the document, never counted as progress); reads never rewrite it.
  Every call re-reads storage first and each change writes only its own delta (read-modify-write), so two tabs
  never erase each other's progress.

## Game flow (game)

- `mount()`: load progress + settings, fill `levels` summaries, show title with the last played level's diorama
  behind it (`setIdleOrbit(true)`), start rAF loop. dt = min(real dt, 1/20). No WebGL 2 → warn, screen
  `unsupported`, nothing else created. A `storage` event for the progress key refreshes the title's summaries.
- `start(i)`: `audio.unlock()` (user gesture), load level i, screen `playing` (the control hint shows while playing).
  Timer starts on `firstInput`, ticks with dt, stops on `levelComplete`.
- Move counter: every frame Game copies `snapshot.moves` to `UIState.moves` (a store write only when it changes); on
  load it publishes the level's minimum (`levelMinimum(id)`; a lower bound only if `moves.showLowerBound`, else null)
  as `UIState.minMoves` and clears `finished`. `toggleMoves()` (N, the pill) persists `showMoves` like the timer.
- On `levelComplete`: stop timer, record time and moves (ProgressStore `record` / `recordMoves`, both skipped for
  the Benchmark and a level only test mode opened), set `UIState.finished`, unlock next, wait `flow.completeDelaySec` (1.6 s;
  R / Esc / HUD restart are ignored meanwhile), then screen `complete` with a random positive message from:
  "Buen trabajo", "Almacén organizado", "Perfectamente colocado", "Todo en su sitio", "¡Qué orden tan agradable!".
  For `flow.confirmGraceSec` (0.45 s) after the card appears, keys and pad buttons cannot dismiss it.
- `restart()`: rebuild the same level (fresh GameState, renderer.loadLevel), timer reset. `nextLevel()`: next or
  title after last. `toTitle()` mid-level is non-destructive: the level stays as it is, the timer pauses, and
  `start()` with the same index or no index ("Continuar") resumes it, even a level only test mode opened; the clock
  restarts on the first input. Turning test mode off on the title drops such a suspended level and shows the real
  "Continuar" level. "Continuar" follows `flow.continueTarget`: a saved last level already cleared, whose next level
  is open but not cleared, moves on to that next level (a save from before new levels were added leads into the first
  new one).
- `startBenchmark()` (test mode on, else a no-op): loads `getSpecialLevel(BENCHMARK_ID)` without touching progress (no
  `record`, no `unlock`, no `setLastLevel`; `LevelResult.practice` true); `levelIndex` keeps naming the game level
  "Continuar" knows. `restart()` reloads the Benchmark; `nextLevel()` / the card lead to the title, which shows the real
  "Continuar" level; level jumps are ignored there. Esc suspends it like any level ("Continuar" or the button resume
  it, a level dot loads that level fresh); turning test mode off drops a suspended Benchmark.
- Keyboard: W/S drive forward / reverse and A/D turn (default `"vehicle"`; arrows too; see `controls.keyboardMapping`), Space pick / drop, F / V fork one slot up / down in front of a storage rack (also the mouse wheel while playing: one notch = one slot, trackpad deltas add up; `preventDefault` only while playing; pad X / B; `InputFrame.forkStep`), Q/E camera, + / − zoom in / out (the typed character first, so "+" / "-" zoom on any layout — Spanish "+" is `BracketRight`, "-" is `Slash` —, then `Equal` / `Minus` and `NumpadAdd` / `NumpadSubtract` by code; held = continuous, a tap = a small step; also a trackpad pinch, i.e. Ctrl + wheel, and a touch pinch; see Render direction), M mute, T timer, N move counter (title and playing; no pad button, like the timer), B reverse beeper on / off (title and playing, persisted `Settings.reverseBeep`; no pad button), U test mode (title), PageUp / PageDown · the two keys right of P (`[` / `]` on US; AltGr accepted for these two only, any other Ctrl / Alt / Meta combination is ignored; where `BracketRight` types "+" it zooms, and AltGr + it, typing "]", jumps) level jump (test mode, playing; same hold rule as R, `InputSample.levelStepHeld`),
  Esc title (resumable), Enter = primary button on the card. R restarts at once until a box has been picked in
  this level; after that it must be held `flow.restartHoldSec` (0.55 s; releasing cancels; progress published as
  `UIState.restartHold` 0‥1). R on the card repeats at once. Gamepad: left stick (`controls.stickMapping`, default screen-relative) moves,
  d-pad drives like W/S/A/D (`controls.keyboardMapping`; non-zero drive wins over the stick), A pick / drop and confirm, LB/RB camera, LT / RT zoom out / in (analog), Start confirm, Back/View = restart (same hold rule),
  Y = "Repetir" on the card only.
- Push `elapsedMs` to the store at ≤ 10 Hz. Pass the signed speed (`sign(speed) · |speed| / maxSpeed`: negative =
  reverse, which beeps), the signed fork motion (the faster of the carry lift and the stack / slot climb normalised by
  `forkRiseRate`, + up / − down) and `forkHeight` to `audio.setMotor` every frame. With each event Game passes the
  match kind of its zone, rack slot or truck slot (`matchOf`). Resize handled by the renderer (ResizeObserver on its container).
