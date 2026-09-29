# Toro — Architecture & Direction (contract for all module owners)

Read `docs/BRIEF.md` first (the client brief). This file fixes the technical contracts and the creative
direction so modules built in parallel fit together. **Do not change files you do not own.** If a shared
contract (`src/core/*`, `src/config/*`, `src/themes/*`, `src/data/validateLevel.ts`, `src/ui/uiState.ts`)
truly needs a change, make the smallest additive change (new optional field) and say so in your report.

Stack: Vite 8 · TypeScript 7 (strict, `noUnusedLocals`) · React 19 (DOM overlay only) · three r186 (plain,
no react-three-fiber) · Vitest 5 for pure-logic tests. No other runtime dependencies. No asset files for
audio (procedural Web Audio) and no textures required (vertex/flat colors; tiny CanvasTexture allowed).

Commands: `npm run typecheck` (covers `src/`, `dev/` and `vite.config.ts`) · `npm test` · `npx vite build` · `npm run dev` ·
`npm run levels` (level maps + difficulty metrics; `-- 23` for one level) · `npm run levels:fmt`.
The build uses `base: './'` (relative asset URLs) so `dist/` can be hosted under any subpath.

## Module map & ownership

| Path | Owner | Responsibility |
|---|---|---|
| `src/core/types.ts`, `math.ts`, `store.ts`, `sorting.ts`, `racks.ts` | shared | Contracts, helpers, tiny external store; `sorting.ts` = who accepts what (`accepts`, the single source of truth for logic, render and the level solvers; storage racks: `targetsOf`, `assignmentsOf`, `levelDestinies`, `cueFits`, `isDestined`); `racks.ts` = storage rack geometry (cells, fronts, slot ids) |
| `src/config/gameConfig.json` | shared | All tunables: `forklift`, `box` (`size`, `dropLandSec`), `stack` (`maxHeight`, `forkRiseSpeed`), `snap`, `camera`, `audio`, `controls`, `flow` (`completeDelaySec`, `confirmGraceSec`, `restartHoldSec`, `hintLevels`) |
| `src/themes/*` | shared | Palettes (`Theme`). New theme = new file + entry in the `THEMES` map (`themes/index.ts`) |
| `src/data/validateLevel.ts` | shared | Level schema (`LevelData`) + validation |
| `src/data/asciiLevel.ts`, `src/data/difficulty.ts` | shared | `.level` text format: parser (→ validateLevel) and canonical renderer; `dificultad:` targets |
| `src/data/levels/*.level` | **levels** | Level content (one text file per level, docs/LEVELS.md) |
| `src/data/levels/index.ts`, `solver.ts`, `metrics.ts`, `report.ts` | **levels** | Registry; grid model + searches (tests, autopilot, metrics); difficulty metrics; `npm run levels` report |
| `src/logic/**` | **logic** | Simulation (`GameState`, `Timer`), collisions, tests |
| `src/render/**` | **render** | three.js scene, meshes, camera, feedback animation |
| `src/audio/**` | **audio** | Procedural music + SFX |
| `src/ui/**` (except `uiState.ts`), `src/storage/**` | **ui** | React overlay, CSS, persistence |
| `src/game/**` | **game** | Frame loop, input, wiring, flow between screens |
| `src/integration/**` | integration | Cross-module tests (e.g. every level played by the autopilot of `autopilot.ts` on the real `GameState`, with the real controls: world-space moves, the vehicle reverse gear and the rack fork steps) |
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
- **Stacks** (spec: `docs/STACKING.md`; levels 13–18). `LevelData.stackLimit` (validateLevel fills it: the level's `limit`,
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
- **Sorting** (spec: `docs/SORTING.md`; levels 19–24). Every box has a colour and a symbol (`BoxState.symbol`:
  `LevelBox.symbol`, else `DEFAULT_SYMBOL[color]`, so levels 1–18 are unchanged). A zone declares what it accepts
  (`LevelZone.color?` / `symbol?`, at least one → `ZoneState.accepts`): colour only = any box of that colour,
  symbol only = any box with that symbol, both = that exact box. `accepts(zone, box)` (core/sorting) is the single
  source of truth: a zone is satisfied iff its (bottom) box meets all its criteria, boxes above it follow the colour
  recipe (`fitsLevel`). Ambiguity is allowed (a box may fit several zones; any accepting one counts). `ZoneState.color`
  is the pad colour (`ColorId | null`, null = neutral pad), `recipe[0]` only the colour criterion (null without one).
  A level uses symbols iff a box or zone names one (`usesSymbols`); validateLevel then requires stackLimit 1 (no
  recipes, no stacked starts), one box per zone and a complete sorting (`assignBoxes`, augmenting paths). Events keep
  their shape (`boxDropped.correct` = accepted); Game passes the zone's `matchKind` to audio with each event.
- **Storage racks** (spec: `docs/RACKS.md`; no shipped level yet). `LevelData.racks?` (`LevelRack { id, x, z, w, facing,
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
  `zoneReleased { zoneId: null, slotId }`.
- Fork lift animates `forkLift` toward 1 while carrying, 0 otherwise, at `forkLiftSpeed` (units of 0‥1 per s).
- Level completes when every zone is satisfied and nothing is carried → `levelComplete` exactly once, after which
  updates ignore input (forklift coasts to rest).
- `firstInput` exactly once, on the first frame with non-zero move, non-zero drive (throttle / steer) or an action press (Game starts the timer).

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
- Level ids key saved progress (and seed the decor RNG): never change a shipped id. Box / zone ids are generated
  `b1…` / `z1…` in legend order unless written `(id)`; nothing outside the level depends on them.
- `src/data/levels/solver.ts` is the only grid model (conservative carrying model with the reverse gear, greedy
  search, exact A* for the fewest box moves with a consistent bound — swap cycles, dead-end corridors, fixed sorting
  destinations —, the dead-end check `deadEnds`, and storage rack slots as positions after the floor cells).
  `levels.test.ts`, the autopilot (`src/integration/autopilot.ts`, run by `levelsPlayable.test.ts` and
  `racksPlayable.test.ts`) and the metrics (`metrics.ts`: movimientos, obligadas, extra, bloqueos, estrechas, libre,
  ambiguas, trampas, repartos, callejones, huecos) all import it. `npm run levels` (`scripts/levels.mjs`: Vite `createServer` + `ssrLoadModule`, no port) prints maps and a
  metrics table; `npm run levels:fmt` rewrites files canonically. A `dificultad:` header (e.g. `extra>=2, bloqueos>=1`)
  declares targets that `levels.test.ts` proves against the measured metrics.

## Level design (levels)

- Lanes the forklift must turn in should be ≥ 2 cells wide; 1-cell corridors only for straight runs. No level may
  have a dead end («callejones», docs/LEVELS.md; `levels.test.ts` checks every state of a shortest plan).
- Storage racks (docs/RACKS.md) are loaded by driving straight at a column: its front cell and the cell behind it must
  be free floor (validateLevel checks the front cell; the solvability tests catch the rest).
- Leave ≥ 1 free cell around every box on at least one side the forklift can approach from, and ≥ 2 free cells
  somewhere reachable to park a box temporarily (level 4+ needs spare space to reorganize).
- Level 1 is one straight run along the forklift's start heading, so holding W alone (`"vehicle"` mapping) reaches
  the box and then the zone (`src/integration/level1Controls.test.ts` simulates it with the real GameState). 3-tier shelves only against the back walls (z = 0 or x = 0).
- Three chapters: 1–12 classic (stackLimit 1), 13–18 stacking (13–14 stackLimit 2), 19–24 sorting by colour +
  symbol (stackLimit 1). Box count and area grow within each chapter. Start headings face a box straight ahead;
  the stacking and sorting chapters drive away from the camera (every sorting zone lies further from it than the
  start). The shared grid model (`src/data/levels/solver.ts`, used by `levels.test.ts` and the autopilot in
  `src/integration/levelsPlayable.test.ts`) keeps per-cell stacks of boxes (colour × symbol): a move lifts
  a stack's top box and drops it on the floor or on a stack with room (conservative: stacks block driving and turning
  sweeps); zones accept by their criteria, and in sorting levels a layout whose loose boxes have no complete sorting
  left (a trap) costs one more step.
- Colors are introduced in `COLOR_IDS` order. Shapes: small, readable warehouses; generous empty floor.
- Decor is sparse: 1–4 plants in corners/edges, 1–3 windows on north/west walls. Never clutter lanes.

## Render direction (render)

- Orthographic camera, pitch `camera.pitchDeg` (38°), yaw 45°, auto-fit so the whole warehouse (incl. walls)
  is visible with `camera.padding`, on any aspect. Q/E rotate yaw by 90° with a slow ease-in-out
  (`rotateDurationSec`). Idle orbit on title: extremely slow yaw drift. Never shake, never snap. The camera
  never zooms in during a Q/E turn or the idle orbit: the frame stays at least as wide as the blend of the two
  diagonal (45° + k·90°) framings around the current yaw.
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
  - pick up: light wooden knock (short bandpassed noise + low sine body), plus soft servo glide.
  - drop: soft felt thump scheduled `box.dropLandSec` after the event, when the box touches the floor; if
    `correct`: a chime whose pitch climbs a pentatonic scale with `satisfiedCount` (satisfying
    progression), in the current music key; its timbre follows the zone's `matchKind` (passed by Game as
    `handleEvent(event, match)`): colour = the warm bell, symbol = a soft wooden marimba (`instruments/wood.ts`),
    exact = both, softer (`CHIME_LEVELS`; all three peak within ±0.2 dB). The fork servo answers the key press at once.
  - stacks: a drop on a box is a lighter, higher wooden "toc" (+12 % pitch per level, less sub); pickup knock and
    servo rise per level too; a completed stack zone plays `recipeLength` soft pentatonic notes climbing into its
    chime (the lower notes skip avoid notes over the sounding chord). `zoneRestored`: the zone's chime (and stack
    climb) 0.12 s after the pickup knock, no final flourish.
  - zoneReleased / actionIdle: barely audible soft tick (never a buzzer, never "wrong"). A release caused by
    stacking onto a satisfied zone ticks when that box lands (0.03 s after its knock); a pick-up releases at once.
  - levelComplete: gentle ascending arpeggio (on the 8th-note grid, after the final landing chime and a completed
    stack's climb into it) + pad swell on the downbeat the music resolves on; music ducks slightly, then returns.
  - motor: electric hum (two soft oscillators, lowpassed), gain and pitch follow `speed01`, very low level,
    fades to silence when stopped; fork servo whine follows `forkMotion01` and sits +12 % higher per stack level
    (`setMotor`'s 3rd argument `forkHeight`; 0 in classic levels).
  - uiClick: tiny soft wooden tap.

## UI direction (ui)

- DOM overlay, Nunito (loaded in `index.html`), warm gray text (`--ui-text`), frosted cream panels
  (`--ui-panel`, `backdrop-filter: blur`), radius 16–20 px, soft shadows, no pure black/white contrast.
- HUD while playing — only three things: level ("Nivel 3", top-left), time ("0:42", top-right, tabular numbers;
  clicking it or T toggles hide/show — hidden shows a small faint clock glyph), restart button (round, icon ↺,
  `aria-label="Reiniciar nivel"`; a soft disc fills it while R is held, see Game flow). Nothing else. Fades in
  gently. HUD buttons never take focus from a mouse press (Space stays the game's key).
- Control hint (only first level, `showHint`): tiny keycaps at the bottom center — "W S avanzar / atrás · A D girar · Espacio
  recoger / dejar" — fades out when `showHint` turns false.
- Title screen: game name "Toro", subtitle "Un pequeño almacén, a tu ritmo.", primary button "Empezar" or
  "Continuar", discreet level dots in even rows of twelve (24 levels = two rows; 22 px dots on short windows such as
  800×450) (unlocked ones clickable, show best time on hover/focus; locked ones
  read "Nivel N · por descubrir"), small footer "Q / E girar cámara · M silencio (M activar sonido when muted)
  · T tiempo · Esc inicio · [Modo prueba]". Diorama visible behind (idle orbit).
- **Modo prueba** (`Settings.testMode`, persisted, additive field, default off; `UIState.testMode`,
  `GameActions.toggleTestMode()`): the footer switch (`aria-pressed`) or U on the title opens every level dot. While
  playing, PageUp / PageDown (RePág / AvPág) or the two keys right of P (`BracketLeft` / `BracketRight`: `[` / `]`
  on a US layout; matched by `e.code`, with or without AltGr, so Spanish / ISO layouts work too) load the previous /
  next level fresh: at once while no box has been picked, else held like R (`flow.restartHoldSec`, same ↺ fill).
  Unlock progress is never modified: a level open only because of test mode records no time (a ranking would
  unlock its successor), does not unlock anything and never becomes the "Continuar" target; its card shows only
  "Tiempo" plus the quiet line "Modo prueba · este tiempo no se guarda" (`LevelResult.practice`). Genuinely
  unlocked levels behave normally. HUD adds a faint "prueba" tag next to "Nivel N"; tag and switch share the
  tooltip "Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente".
- Mute toggles are confirmed by a polite live region and, in a level, a brief top-center pill (~1.6 s).
- Completion card: compact (≤ 420 px) and anchored at the bottom center so the tidied warehouse stays in view;
  rises in, settles down on exit. Positive `result.message` as heading, "Tiempo 0:42.3", "Mejor tiempo 0:38.9",
  soft "Nuevo mejor tiempo" tag when `isNewBest`, one action row: primary "Siguiente almacén" (or "Volver al
  inicio" when `isLast`, with the line "Todos los almacenes están en orden."), quiet "Repetir". The HUD dims.
  Never negative wording, never deltas like "+3 s".
- `unsupported` screen (no WebGL 2, or a render crash caught by the shell's error boundary): one calm centred
  card with a "Recargar" button, nothing else.
- Time format: `m:ss` in HUD, `m:ss.d` on the card.
- Theme UI tokens: `text`, `textSoft` (≥ 4.5:1 on panels), `panel`, `panelBorder`, `accent`, optional
  `accentDeep` (primary button fill, ≥ 4.5:1 with `accentText`; exposed as `--ui-accent-deep`), `accentText`, `shadow`.
- Storage (`ProgressStore`, key `PROGRESS_STORAGE_KEY`): versioned JSON under one localStorage key, all access in
  try/catch with in-memory fallback, best time + top-5 ranking per level id, highest unlocked index, last level
  (index + `lastLevelId`, additive, same version), settings. Unlocks and "Continuar" resolve by level id against
  the current play order (constructor arg `levelIds`, default `LEVELS`), so inserting a level never re-locks one.
  Every call re-reads storage first and each change writes only its own delta (read-modify-write), so two tabs
  never erase each other's progress.

## Game flow (game)

- `mount()`: load progress + settings, fill `levels` summaries, show title with the last played level's diorama
  behind it (`setIdleOrbit(true)`), start rAF loop. dt = min(real dt, 1/20). No WebGL 2 → warn, screen
  `unsupported`, nothing else created. A `storage` event for the progress key refreshes the title's summaries.
- `start(i)`: `audio.unlock()` (user gesture), load level i, screen `playing`, hint if i < `flow.hintLevels`
  and no drop done yet. Timer starts on `firstInput`, ticks with dt, stops on `levelComplete`.
- On `levelComplete`: stop timer, record time (ProgressStore), unlock next, wait `flow.completeDelaySec` (1.6 s;
  R / Esc / HUD restart are ignored meanwhile), then screen `complete` with a random positive message from:
  "Buen trabajo", "Almacén organizado", "Perfectamente colocado", "Todo en su sitio", "¡Qué orden tan agradable!".
  For `flow.confirmGraceSec` (0.45 s) after the card appears, keys and pad buttons cannot dismiss it.
- `restart()`: rebuild the same level (fresh GameState, renderer.loadLevel), timer reset. `nextLevel()`: next or
  title after last. `toTitle()` mid-level is non-destructive: the level stays as it is, the timer pauses, and
  `start()` with the same index or no index ("Continuar") resumes it, even a level only test mode opened; the clock
  restarts on the first input. Turning test mode off on the title drops such a suspended level and shows the real
  "Continuar" level. "Continuar" follows `flow.continueTarget`: a saved last level already cleared, whose next level
  is open but not cleared, moves on to that next level (an old 12-level save leads into levels 13–18).
- Keyboard: W/S drive forward / reverse and A/D turn (default `"vehicle"`; arrows too; see `controls.keyboardMapping`), Space pick / drop, F / V fork one slot up / down in front of a storage rack (also the mouse wheel while playing: one notch = one slot, trackpad deltas add up; `preventDefault` only while playing; pad X / B; `InputFrame.forkStep`), Q/E camera, M mute, T timer, U test mode (title), PageUp / PageDown · the two keys right of P (`[` / `]` on US; AltGr accepted for these two only, any other Ctrl / Alt / Meta combination is ignored) level jump (test mode, playing; same hold rule as R, `InputSample.levelStepHeld`),
  Esc title (resumable), Enter = primary button on the card. R restarts at once until a box has been picked in
  this level; after that it must be held `flow.restartHoldSec` (0.55 s; releasing cancels; progress published as
  `UIState.restartHold` 0‥1). R on the card repeats at once. Gamepad: left stick (`controls.stickMapping`, default screen-relative) moves,
  d-pad drives like W/S/A/D (`controls.keyboardMapping`; non-zero drive wins over the stick), A pick / drop and confirm, LB/RB camera, Start confirm, Back/View = restart (same hold rule),
  Y = "Repetir" on the card only.
- Push `elapsedMs` to the store at ≤ 10 Hz. Pass `|speed| / maxSpeed`, fork motion (carry lift, and the stack
  climb normalised by `forkRiseRate`) and `forkHeight` to `audio.setMotor` every frame. Resize handled by the renderer (ResizeObserver on its container).
