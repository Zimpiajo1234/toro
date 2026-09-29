import { describe, expect, it } from 'vitest';
import { cellToWorld, type CellPos, type GameEvent, type LevelData, type ZoneState } from '../core/types';
import { GAME_CONFIG } from '../config';
import { BOX_SETTLE_SPEED, circleRectContact, CollisionWorld, createContact, type Rect } from './collision';
import { GameState } from './GameState';
import { LevelGrid } from './grid';
import { createDropChoice, Interaction } from './interaction';
import { DT, forkPoint, IDLE, makeLevel, move, press, run, runUntil, types, withForklift } from './testUtils';

const F = GAME_CONFIG.forklift;

/**
 * 7×5 floor, forklift at cell (3,2) = world (0,0) facing `heading`.
 * Boxes / zones given as [id, color, x, z].
 */
function level(
  heading: number,
  boxes: [string, string, number, number][],
  zones: [string, string, number, number][],
  extra: Record<string, unknown> = {},
): LevelData {
  return makeLevel({
    forklift: { x: 3, z: 2, heading },
    boxes: boxes.map(([id, color, x, z]) => ({ id, color, x, z })),
    zones: zones.map(([id, color, x, z]) => ({ id, color, x, z })),
    ...extra,
  });
}

function eventOf<T extends GameEvent['type']>(events: GameEvent[], type: T): Extract<GameEvent, { type: T }> {
  const e = events.find((ev) => ev.type === type);
  if (!e) throw new Error(`no ${type} event in [${types(events).join(', ')}]`);
  return e as Extract<GameEvent, { type: T }>;
}

/** Independent reading of the drop rule (nearest valid cell of the 3×3 around the fork point, no magnet). */
function nearestValidCell(state: GameState): CellPos | null {
  const snap = state.getSnapshot();
  const { width, depth } = snap.level.size;
  const fork = forkPoint(state);
  const c = createContact();
  const h = GAME_CONFIG.box.size / 2;
  const cx = Math.floor(fork.x + width / 2);
  const cz = Math.floor(fork.z + depth / 2);
  let best: CellPos | null = null;
  let bestD = Infinity;
  for (let z = cz - 1; z <= cz + 1; z++)
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || z < 0 || x >= width || z >= depth) continue;
      if (snap.boxes.some((b) => b.cell?.x === x && b.cell?.z === z)) continue;
      const w = cellToWorld({ x, z }, snap.level.size);
      const p = snap.forklift.pos;
      if (circleRectContact(p.x, p.z, F.bodyRadius, w.x - h, w.z - h, w.x + h, w.z + h, c) > 0.05) continue;
      const d = Math.hypot(w.x - fork.x, w.z - fork.z);
      if (d < bestD) [best, bestD] = [{ x, z }, d];
    }
  return best;
}

/** Overlap of the forklift body with the resting box `index` (full-size square). */
function bodyBoxOverlap(state: GameState, index: number): number {
  const snap = state.getSnapshot();
  const b = snap.boxes[index].pos;
  const p = snap.forklift.pos;
  const h = GAME_CONFIG.box.size / 2;
  return circleRectContact(p.x, p.z, F.bodyRadius, b.x - h, b.z - h, b.x + h, b.z + h, createContact());
}

/**
 * Drop now and follow the body for `seconds` of idle frames: returns the largest per-frame displacement (the drop
 * frame included) and the total distance the body was eased out.
 */
function dropAndSettle(state: GameState, seconds = 0.6): { events: GameEvent[]; maxStep: number; moved: number } {
  const f = state.getSnapshot().forklift;
  const start = { ...f.pos };
  const events = press(state);
  let maxStep = Math.hypot(f.pos.x - start.x, f.pos.z - start.z);
  for (let t = 0; t < seconds; t += DT) {
    const x = f.pos.x;
    const z = f.pos.z;
    state.update(DT, IDLE);
    maxStep = Math.max(maxStep, Math.hypot(f.pos.x - x, f.pos.z - z));
  }
  return { events, maxStep, moved: Math.hypot(f.pos.x - start.x, f.pos.z - start.z) };
}

describe('pick-up', () => {
  // Front box 2 cells ahead (out of reach at start), one behind, one beside.
  const pickLevel = () =>
    level(
      90,
      [
        ['behind', 'yellow', 1, 2],
        ['side', 'mint', 3, 1],
        ['front', 'blue', 5, 2],
      ],
      [
        ['zb', 'blue', 6, 0],
        ['zm', 'mint', 6, 4],
        ['zy', 'yellow', 0, 4],
      ],
    );

  it('ignores boxes out of reach, behind or beside', () => {
    const state = new GameState(pickLevel());
    expect(state.getSnapshot().hint.targetBoxId).toBeNull();
    expect(press(state)).toEqual([{ type: 'firstInput' }, { type: 'actionIdle', carrying: false }]);
    expect(state.getSnapshot().forklift.carrying).toBeNull();
  });

  it('picks the box in front once within reach, matching the hint', () => {
    const state = new GameState(pickLevel());
    const snap = state.getSnapshot();
    runUntil(state, () => snap.hint.targetBoxId !== null, move(1, 0));
    expect(snap.hint.targetBoxId).toBe('front');
    const fork = forkPoint(state);
    expect(Math.hypot(fork.x - 2, fork.z)).toBeLessThanOrEqual(F.pickupRadius);
    const events = press(state);
    expect(events).toEqual([{ type: 'boxPicked', boxId: 'front', fromZoneId: null, level: 0 }]);
    const box = snap.boxes[2];
    expect(box).toMatchObject({ carried: true, cell: null, zoneId: null, correct: false });
    expect(snap.forklift.carrying).toBe('front');
    expect(snap.hint.targetBoxId).toBeNull();
  });

  it('respects the pickup cone', () => {
    // Heading 60°: box at (4,2) is within reach but 30° off forward.
    const lv = level(60, [['b', 'blue', 4, 2]], [['z', 'blue', 0, 0]]);
    expect(types(press(new GameState(lv)))).toContain('boxPicked');
    const narrow = new GameState(lv, withForklift({ pickupAngleDeg: 20 }));
    expect(narrow.getSnapshot().hint.targetBoxId).toBeNull();
    expect(types(press(narrow))).toEqual(['firstInput', 'actionIdle']);
  });

  it('picks the nearest box, ties go to the first listed', () => {
    // Heading 45°: fork point sits near the corner shared by (3,3), (4,2) and (4,3).
    const nearest = new GameState(level(45, [['side', 'blue', 4, 2], ['diag', 'mint', 4, 3]], [['z1', 'blue', 0, 0], ['z2', 'mint', 0, 4]]));
    expect(eventOf(press(nearest), 'boxPicked').boxId).toBe('diag');
    const tie = new GameState(level(45, [['a', 'blue', 3, 3], ['b', 'mint', 4, 2]], [['z1', 'blue', 0, 0], ['z2', 'mint', 0, 4]]));
    expect(eventOf(press(tie), 'boxPicked').boxId).toBe('a');
  });

  it('carried box follows the fork point and the forks rise, then lower after the drop', () => {
    const state = new GameState(level(90, [['b', 'blue', 4, 2]], [['z', 'blue', 0, 0]]));
    const snap = state.getSnapshot();
    press(state);
    expect(snap.forklift.forkLift).toBeCloseTo(F.forkLiftSpeed * DT, 9);
    run(state, 0.5, move(0, 1));
    const fork = forkPoint(state);
    expect(snap.boxes[0].pos.x).toBeCloseTo(fork.x, 9);
    expect(snap.boxes[0].pos.z).toBeCloseTo(fork.z, 9);
    expect(snap.forklift.forkLift).toBe(1);
    run(state, 1, IDLE);
    expect(eventOf(press(state), 'boxDropped').boxId).toBe('b');
    expect(snap.forklift.forkLift).toBeCloseTo(1 - F.forkLiftSpeed * DT, 9);
    run(state, 0.5, IDLE);
    expect(snap.forklift.forkLift).toBe(0);
  });
});

describe('drop', () => {
  it('puts the box back on its own cell when dropped in place', () => {
    const state = new GameState(level(90, [['b', 'blue', 4, 2]], [['z', 'blue', 0, 0]]));
    press(state);
    const e = eventOf(press(state), 'boxDropped');
    expect(e).toEqual({ type: 'boxDropped', boxId: 'b', cell: { x: 4, z: 2 }, zoneId: null, level: 0, correct: false, recipeLength: 0, satisfiedCount: 0, total: 1 });
    expect(state.getSnapshot().boxes[0]).toMatchObject({ carried: false, cell: { x: 4, z: 2 }, pos: { x: 1, z: 0 } });
  });

  it('snaps to the nearest valid cell around the fork point', () => {
    // Pick the box right ahead, drive a little in some direction, coast to rest, drop.
    for (const [seconds, headingDeg] of [
      [0.25, 90],
      [0.35, 90],
      [0.3, 120],
      [0.2, 45],
      [0.4, 160],
    ] as const) {
      const state = new GameState(
        makeLevel({
          forklift: { x: 1, z: 2, heading: 90 },
          boxes: [{ id: 'b', color: 'blue', x: 2, z: 2 }],
          zones: [{ id: 'z', color: 'blue', x: 6, z: 0 }],
        }),
      );
      const snap = state.getSnapshot();
      expect(types(press(state))).toContain('boxPicked');
      const h = (headingDeg * Math.PI) / 180;
      run(state, seconds, move(Math.sin(h), Math.cos(h)));
      run(state, 1, IDLE);
      const expected = nearestValidCell(state);
      expect(expected).not.toBeNull();
      expect(snap.hint.dropCell).toEqual(expected);
      expect(eventOf(press(state), 'boxDropped').cell).toEqual(expected);
      expect(snap.boxes[0].cell).toEqual(expected);
      expect(snap.boxes[0].pos).toEqual(cellToWorld(expected!, snap.level.size));
    }
  });

  it('zone magnet: a free zone within reach wins over the nearest cell', () => {
    // Heading 45°: nearest cell to the fork point is (4,3); the zone at (4,2) is 0.74 away.
    const state = new GameState(level(45, [['b', 'blue', 4, 3]], [['zb', 'blue', 4, 2]]));
    const snap = state.getSnapshot();
    press(state);
    expect(snap.hint.dropCell).toEqual({ x: 4, z: 2 });
    expect(snap.hint.dropZoneId).toBe('zb');
    const events = press(state);
    expect(events).toEqual([
      { type: 'boxDropped', boxId: 'b', cell: { x: 4, z: 2 }, zoneId: 'zb', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 1 },
      { type: 'levelComplete' },
    ]);
    expect(snap.zones[0]).toMatchObject({ occupiedBy: 'b', satisfied: true });
    expect(snap.boxes[0]).toMatchObject({ zoneId: 'zb', correct: true });
  });

  it('zone magnet prefers a zone of the same color', () => {
    const state = new GameState(
      level(
        45,
        [['b', 'blue', 4, 3], ['m', 'mint', 0, 0]],
        [['zm', 'mint', 3, 3], ['zb', 'blue', 4, 2]],
      ),
    );
    press(state);
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ zoneId: 'zb', correct: true, satisfiedCount: 1, total: 2 });
  });

  it('zone magnet ignores zones of another color: the box parks on the aimed free cell', () => {
    // Heading 45 deg: the fork point is nearest to (4,3); the mint zone at (4,2) is within magnet range but not blue.
    const state = new GameState(level(45, [['b', 'blue', 4, 3], ['m', 'mint', 0, 0]], [['zm', 'mint', 4, 2], ['zb', 'blue', 0, 4]]));
    const snap = state.getSnapshot();
    press(state);
    expect(snap.hint).toMatchObject({ dropCell: { x: 4, z: 3 }, dropZoneId: null });
    const events = press(state);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ cell: { x: 4, z: 3 }, zoneId: null, level: 0, correct: false, recipeLength: 0, satisfiedCount: 0 });
    expect(snap.zones[0]).toMatchObject({ occupiedBy: null, satisfied: false });
  });

  it('parks on free floor next to a wrong-color zone when the forks aim at it (level 4 layout)', () => {
    const state = new GameState(
      makeLevel({
        size: { width: 9, depth: 7 },
        forklift: { x: 3, z: 3, heading: 180 },
        boxes: [
          { id: 'b1', color: 'yellow', x: 3, z: 2 },
          { id: 'b2', color: 'blue', x: 5, z: 2 },
          { id: 'b3', color: 'mint', x: 1, z: 5 },
        ],
        zones: [
          { id: 'z1', color: 'blue', x: 3, z: 2 },
          { id: 'z2', color: 'mint', x: 4, z: 2 },
          { id: 'z3', color: 'yellow', x: 5, z: 2 },
        ],
        shelves: [
          { x: 1, z: 0, w: 2, d: 1 },
          { x: 6, z: 0, w: 2, d: 1 },
        ],
        decor: { plants: [{ x: 0, z: 0 }, { x: 8, z: 0 }], windows: [] },
      }),
    );
    const snap = state.getSnapshot();
    // Lift the yellow box off the blue zone, then hold the forks over free cell (2,2): 0.12 from its center,
    // 0.89 from the blue zone it was just lifted from.
    expect(eventOf(press(state), 'boxPicked')).toMatchObject({ boxId: 'b1', fromZoneId: 'z1' });
    snap.forklift.pos.x = -1.89;
    snap.forklift.pos.z = -1.96;
    snap.forklift.heading = 0;
    state.update(DT, IDLE);
    expect(snap.hint).toMatchObject({ dropCell: { x: 2, z: 2 }, dropZoneId: null });
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ cell: { x: 2, z: 2 }, zoneId: null, correct: false });
    expect(snap.zones[0]).toMatchObject({ occupiedBy: null, satisfied: false });
  });

  it('drops snugly in front of a plant at the end of a lane, easing the body back', () => {
    // 1-cell lane between two shelf rows, ending in a plant. Carry the box into the plant: the cell in front of it
    // overlaps the body by 0.13 (more than the usual tolerance), and the body has room to back off.
    const state = new GameState(
      makeLevel({
        size: { width: 5, depth: 3 },
        forklift: { x: 0, z: 1, heading: 90 },
        boxes: [{ id: 'b', color: 'blue', x: 1, z: 1 }],
        zones: [{ id: 'z', color: 'blue', x: 3, z: 1 }],
        shelves: [
          { x: 0, z: 0, w: 5, d: 1 },
          { x: 0, z: 2, w: 5, d: 1 },
        ],
        decor: { plants: [{ x: 4, z: 1 }], windows: [] },
      }),
    );
    const snap = state.getSnapshot();
    press(state);
    run(state, 4, move(1, 0));
    expect(snap.forklift.speed).toBeLessThan(0.05);
    expect(snap.hint.dropCell).toEqual({ x: 3, z: 1 });
    const { events, maxStep, moved } = dropAndSettle(state);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ cell: { x: 3, z: 1 }, zoneId: 'z', correct: true });
    expect(moved).toBeCloseTo(0.13, 2);
    expect(maxStep).toBeLessThanOrEqual(BOX_SETTLE_SPEED * DT + 1e-5); // eased, never popped
    expect(bodyBoxOverlap(state, 0)).toBeLessThan(1e-4);
  });

  it('cannot drop into shelves, plants or onto the body → gentle actionIdle', () => {
    // Same lane with shorter forks: the only free cell ahead would land 0.25 deep in the body.
    const state = new GameState(
      makeLevel({
        size: { width: 5, depth: 3 },
        forklift: { x: 0, z: 1, heading: 90 },
        boxes: [{ id: 'b', color: 'blue', x: 1, z: 1 }],
        zones: [{ id: 'z', color: 'blue', x: 3, z: 1 }],
        shelves: [
          { x: 0, z: 0, w: 5, d: 1 },
          { x: 0, z: 2, w: 5, d: 1 },
        ],
        decor: { plants: [{ x: 4, z: 1 }], windows: [] },
      }),
      withForklift({ forkReach: 0.8 }),
    );
    const snap = state.getSnapshot();
    press(state);
    run(state, 4, move(1, 0));
    expect(snap.forklift.speed).toBeLessThan(0.05);
    expect(snap.hint.dropCell).toBeNull();
    expect(press(state)).toEqual([{ type: 'actionIdle', carrying: true }]);
    expect(snap.forklift.carrying).toBe('b');
  });

  it('drops into a snug concave corner with the forks pressed in diagonally (level 1 layout)', () => {
    // Screen-down with the default camera yaw is world 45 deg: straight into the SE corner.
    for (const a of [Math.PI / 4, 0.72]) {
      const state = new GameState(
        makeLevel({
          size: { width: 7, depth: 5 },
          forklift: { x: 1, z: 2, heading: 90 },
          boxes: [{ id: 'b1', color: 'blue', x: 3, z: 2 }],
          zones: [{ id: 'z1', color: 'blue', x: 5, z: 2 }],
          decor: { plants: [{ x: 0, z: 0 }, { x: 6, z: 0 }], windows: [] },
        }),
      );
      const snap = state.getSnapshot();
      runUntil(state, () => snap.hint.targetBoxId === 'b1', move(1, 0));
      run(state, 1, IDLE);
      expect(types(press(state))).toContain('boxPicked');
      run(state, 4, move(Math.sin(a), Math.cos(a)));
      expect(snap.forklift.speed).toBeLessThan(0.05);
      expect(snap.hint.dropCell).toEqual({ x: 6, z: 4 });
      const { events, maxStep, moved } = dropAndSettle(state);
      expect(eventOf(events, 'boxDropped').cell).toEqual({ x: 6, z: 4 });
      expect(moved).toBeGreaterThan(0.05); // it did overlap the body...
      expect(maxStep).toBeLessThanOrEqual(BOX_SETTLE_SPEED * Math.SQRT2 * DT + 1e-5); // ...and eased out of it
      expect(bodyBoxOverlap(state, 0)).toBeLessThan(1e-4);
    }
  });

  it('dropping against a neighbouring box eases the body out instead of popping it', () => {
    // Carry `a` until it rests against `b`: the drop cell (4,1) overlaps the body by 0.04 (within tolerance).
    const state = new GameState(
      makeLevel({
        size: { width: 8, depth: 3 },
        forklift: { x: 0, z: 1, heading: 90 },
        boxes: [
          { id: 'a', color: 'blue', x: 1, z: 1 },
          { id: 'b', color: 'mint', x: 5, z: 1 },
        ],
        zones: [
          { id: 'za', color: 'blue', x: 7, z: 0 },
          { id: 'zb', color: 'mint', x: 7, z: 2 },
        ],
      }),
    );
    const f = state.getSnapshot().forklift;
    press(state);
    run(state, 4, move(1, 0));
    run(state, 1, IDLE);
    expect(f.pos.x).toBeCloseTo(1.11 - F.carriedBoxRadius - F.forkReach, 4);
    const { events, maxStep, moved } = dropAndSettle(state);
    expect(eventOf(events, 'boxDropped').cell).toEqual({ x: 4, z: 1 });
    expect(moved).toBeCloseTo(0.04, 3);
    expect(maxStep).toBeLessThanOrEqual(BOX_SETTLE_SPEED * DT + 1e-5);
    expect(maxStep).toBeLessThan(F.maxSpeed * DT);
    expect(f.pos.x).toBeCloseTo(0.11 - F.bodyRadius, 4); // resting against the dropped box
    expect(bodyBoxOverlap(state, 0)).toBeLessThan(1e-4);
  });

  it('refuses a snug drop when the body could not ease out (it would be pushed into something)', () => {
    // Direct rule check: forks 0.7 into cell (3,2), so that cell overlaps the body by 0.09; every other cell of the
    // 3x3 is taken. Free space behind the body → the snug drop is allowed; a board right behind it → refused.
    const lv = makeLevel({
      size: { width: 7, depth: 5 },
      forklift: { x: 1, z: 2, heading: 90 },
      boxes: [
        { id: 'carried', color: 'blue', x: 0, z: 0 },
        ...[[2, 1], [3, 1], [4, 1], [2, 3], [3, 3], [4, 3], [4, 2]].map(([x, z], i) => ({ id: `n${i}`, color: 'mint', x, z })),
      ],
      zones: [{ id: 'z', color: 'blue', x: 6, z: 0 }, ...[0, 1, 2, 3, 4, 5, 6].map((x) => ({ id: `zm${x}`, color: 'mint', x, z: 4 }))],
    });
    const drop = (behind: Rect[]) => {
      const snap = new GameState(lv).getSnapshot();
      const boxes = snap.boxes.map((b) => ({ ...b, pos: { ...b.pos } }));
      boxes[0].carried = true;
      const grid = new LevelGrid(lv);
      grid.popBox(0, 0);
      const world = new CollisionWorld(CollisionWorld.fromLevel(lv, GAME_CONFIG.box.size).bounds, behind, GAME_CONFIG.box.size);
      world.setBoxes(boxes);
      const forklift = { ...snap.forklift, pos: { x: -0.72, z: 0 }, heading: Math.PI / 2 };
      const zones: ZoneState[] = snap.zones.map((z) => ({ ...z }));
      const out = createDropChoice();
      return new Interaction(lv, GAME_CONFIG, forklift, boxes, zones, grid, world).findDrop(boxes[0], out) ? out : null;
    };
    expect(drop([])).toMatchObject({ x: 3, z: 2 });
    const bodyBack = -0.72 - F.bodyRadius;
    expect(drop([{ minX: bodyBack - 0.2, minZ: -0.5, maxX: bodyBack, maxZ: 0.5 }])).toBeNull();
  });

  it('never drops onto a cell with a resting box', () => {
    // Lane with a resting box at the end: the carried box lands in front of it, on the zone.
    const state = new GameState(
      makeLevel({
        size: { width: 7, depth: 3 },
        forklift: { x: 0, z: 1, heading: 90 },
        boxes: [
          { id: 'a', color: 'blue', x: 1, z: 1 },
          { id: 'end', color: 'mint', x: 5, z: 1 },
        ],
        zones: [
          { id: 'za', color: 'blue', x: 4, z: 1 },
          { id: 'zend', color: 'mint', x: 5, z: 1 },
        ],
        shelves: [
          { x: 0, z: 0, w: 7, d: 1 },
          { x: 0, z: 2, w: 7, d: 1 },
        ],
      }),
    );
    press(state);
    // Drive all the way until the carried box rests against the other box.
    run(state, 5, move(1, 0));
    expect(state.getSnapshot().forklift.speed).toBeLessThan(0.05);
    const events = press(state);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ cell: { x: 4, z: 1 }, zoneId: 'za', correct: true, satisfiedCount: 2, total: 2 });
    expect(types(events)).toContain('levelComplete');
  });
});

describe('zones and events', () => {
  it('lifting a correct box releases its zone', () => {
    const state = new GameState(
      makeLevel({
        forklift: { x: 1, z: 2, heading: 90 },
        boxes: [
          { id: 'b', color: 'blue', x: 2, z: 2 },
          { id: 'm', color: 'mint', x: 5, z: 0 },
        ],
        zones: [
          { id: 'zb', color: 'blue', x: 2, z: 2 },
          { id: 'zm', color: 'mint', x: 5, z: 4 },
        ],
      }),
    );
    const snap = state.getSnapshot();
    expect(snap.progress).toEqual({ satisfied: 1, total: 2 });
    expect(press(state)).toEqual([
      { type: 'firstInput' },
      { type: 'boxPicked', boxId: 'b', fromZoneId: 'zb', level: 0 },
      { type: 'zoneReleased', zoneId: 'zb', boxId: 'b' },
    ]);
    expect(snap.progress).toEqual({ satisfied: 0, total: 2 });
    expect(snap.zones[0]).toMatchObject({ occupiedBy: null, satisfied: false });
    // Dropping it back satisfies the zone again (no completion: mint is still off).
    expect(press(state)).toEqual([
      { type: 'boxDropped', boxId: 'b', cell: { x: 2, z: 2 }, zoneId: 'zb', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 2 },
    ]);
  });

  it('lifting a box off a wrong-color zone frees it without zoneReleased', () => {
    const state = new GameState(
      makeLevel({
        forklift: { x: 1, z: 2, heading: 90 },
        boxes: [
          { id: 'b', color: 'blue', x: 2, z: 2 },
          { id: 'm', color: 'mint', x: 5, z: 0 },
        ],
        zones: [
          { id: 'zm', color: 'mint', x: 2, z: 2 },
          { id: 'zb', color: 'blue', x: 5, z: 4 },
        ],
      }),
    );
    expect(state.getSnapshot().zones[0]).toMatchObject({ occupiedBy: 'b', satisfied: false });
    expect(press(state)).toEqual([{ type: 'firstInput' }, { type: 'boxPicked', boxId: 'b', fromZoneId: 'zm', level: 0 }]);
    expect(state.getSnapshot().zones[0].occupiedBy).toBeNull();
    // With the forks over it, the box still goes back onto the mint zone (nearest cell), just not "correct".
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ cell: { x: 2, z: 2 }, zoneId: 'zm', correct: false });
    expect(state.getSnapshot().zones[0]).toMatchObject({ occupiedBy: 'b', satisfied: false });
  });

  it('emits firstInput exactly once, on the first move or action', () => {
    const lv = level(90, [['b', 'blue', 0, 0]], [['z', 'blue', 6, 4]]);
    const moved = new GameState(lv);
    expect(run(moved, 0.5, IDLE)).toEqual([]);
    expect(moved.update(DT, move(0.5, 0))).toEqual([{ type: 'firstInput' }]);
    expect(run(moved, 1, move(1, 1))).toEqual([]);
    expect(press(moved)).toEqual([{ type: 'actionIdle', carrying: false }]);
    // Tiny analog noise is not input.
    const noisy = new GameState(lv);
    expect(noisy.update(DT, move(1e-4, 0))).toEqual([]);
  });

  it('completes exactly once, then ignores input and coasts to rest', () => {
    const state = new GameState(level(45, [['b', 'blue', 4, 3]], [['zb', 'blue', 4, 2]]));
    const snap = state.getSnapshot();
    press(state);
    expect(types(press(state))).toEqual(['boxDropped', 'levelComplete']);
    expect(snap.completed).toBe(true);
    const pos = { ...snap.forklift.pos };
    const later = [...run(state, 1, move(1, 0)), ...run(state, 0.5, move(0, 1, true)), ...run(state, 0.5, { move: { x: 0, z: 0 }, actionPressed: true })];
    expect(later).toEqual([]);
    expect(snap.forklift.pos).toEqual(pos);
    expect(snap.hint).toEqual({ targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0 });
  });

  it('the drop hint keeps its object while the cell is unchanged', () => {
    const state = new GameState(level(90, [['b', 'blue', 4, 2]], [['z', 'blue', 0, 0]]));
    const snap = state.getSnapshot();
    press(state);
    const cell = snap.hint.dropCell;
    expect(cell).toEqual({ x: 4, z: 2 });
    state.update(DT, IDLE);
    expect(snap.hint.dropCell).toBe(cell);
  });
});
