import { describe, expect, it } from 'vitest';
import type { GameEvent, GameSnapshot, InputFrame, LevelData, Vec2 } from '../core/types';
import { GAME_CONFIG } from '../config';
import { validateLevel } from '../data/validateLevel';
import { GameState, LOAD_PASS_CLEARANCE } from './GameState';
import { DT, forkPoint, IDLE, makeLevel, move, press, run, runUntil, types } from './testUtils';

type BoxSpec = [id: string, color: string, x: number, z: number];

/** 9×5 floor, forklift on (2,2) facing +x: the fork point starts over (3,2). */
function stackLevel(boxes: BoxSpec[], zones: Record<string, unknown>[], extra: Record<string, unknown> = {}): LevelData {
  return makeLevel({
    size: { width: 9, depth: 5 },
    forklift: { x: 2, z: 2, heading: 90 },
    boxes: boxes.map(([id, color, x, z]) => ({ id, color, x, z })),
    zones,
    ...extra,
  });
}

const east = move(1, 0);
const eventOf = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.find((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Pick what is in front, then roll east until the drop preview sits on `x`. */
function carryTo(state: GameState, x: number): void {
  press(state);
  expect(state.getSnapshot().forklift.carrying).not.toBeNull();
  runUntil(state, () => state.getSnapshot().hint.dropCell?.x === x, move(0.4, 0), 6);
  run(state, 0.4, IDLE);
}

describe('validateLevel: stacking', () => {
  const base = {
    id: 't',
    order: 1,
    name: 'T',
    size: { width: 7, depth: 5 },
    forklift: { x: 0, z: 0, heading: 0 },
    shelves: [],
    decor: { plants: [], windows: [] },
  };
  const v = (spec: Record<string, unknown>) => validateLevel({ ...base, ...spec }, 't');

  it('classic levels get stackLimit 1; stacking levels default to stack.maxHeight', () => {
    expect(v({ boxes: [{ id: 'a', color: 'blue', x: 2, z: 2 }], zones: [{ id: 'z', color: 'blue', x: 4, z: 2 }] }).stackLimit).toBe(1);
    const stacked = v({
      boxes: [
        { id: 'a', color: 'blue', x: 2, z: 2 },
        { id: 'b', color: 'mint', x: 3, z: 2 },
      ],
      zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }],
    });
    expect(stacked.stackLimit).toBe(GAME_CONFIG.stack.maxHeight);
    expect(stacked.zones[0].recipe).toEqual(['blue', 'mint']);
  });

  it('rejects bad recipes', () => {
    const boxes = [
      { id: 'a', color: 'blue', x: 2, z: 2 },
      { id: 'b', color: 'mint', x: 3, z: 2 },
    ];
    expect(() => v({ boxes, zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'pink'] }] })).toThrow(/unknown color/);
    expect(() => v({ boxes, zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: [] }] })).toThrow(/must not be empty/);
    expect(() => v({ boxes, zones: [{ id: 'z', color: 'mint', x: 4, z: 2, recipe: ['blue', 'mint'] }] })).toThrow(/recipe\[0\]/);
    expect(() => v({ boxes, stackLimit: 1, zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }] })).toThrow(/taller than stackLimit/);
    expect(() => v({ boxes, stackLimit: 4, zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }] })).toThrow(/stackLimit must be/);
  });

  it('box colors must equal the union of recipes (multiset)', () => {
    expect(() =>
      v({ boxes: [{ id: 'a', color: 'blue', x: 2, z: 2 }], zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }] }),
    ).toThrow(/more zones than boxes/);
    expect(() =>
      v({
        boxes: [
          { id: 'a', color: 'blue', x: 2, z: 2 },
          { id: 'b', color: 'blue', x: 3, z: 2 },
        ],
        zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }],
      }),
    ).toThrow(/color/);
  });

  it('stacked starts: same cell listed bottom → top, limited by stackLimit, may not start solved', () => {
    const zones = [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint'] }];
    expect(() =>
      v({
        stackLimit: 2,
        boxes: [
          { id: 'a', color: 'mint', x: 2, z: 2 },
          { id: 'b', color: 'blue', x: 2, z: 2 },
          { id: 'c', color: 'blue', x: 2, z: 2 },
        ],
        zones: [{ id: 'z', color: 'blue', x: 4, z: 2, recipe: ['blue', 'mint', 'blue'] }],
      }),
    ).toThrow(/taller than stackLimit/);
    expect(() =>
      v({
        boxes: [
          { id: 'a', color: 'blue', x: 4, z: 2 },
          { id: 'b', color: 'mint', x: 4, z: 2 },
        ],
        zones,
      }),
    ).toThrow(/already solved/);
    // Upside down on its zone: fine (that is the "dismantle a wrong stack" puzzle).
    expect(() =>
      v({
        boxes: [
          { id: 'a', color: 'mint', x: 4, z: 2 },
          { id: 'b', color: 'blue', x: 4, z: 2 },
        ],
        zones,
      }),
    ).not.toThrow();
    // stackLimit 1 still refuses two boxes on one cell.
    expect(() =>
      v({
        stackLimit: 1,
        boxes: [
          { id: 'a', color: 'blue', x: 2, z: 2 },
          { id: 'b', color: 'blue', x: 2, z: 2 },
        ],
        zones: [
          { id: 'z', color: 'blue', x: 4, z: 2 },
          { id: 'y', color: 'blue', x: 5, z: 2 },
        ],
      }),
    ).toThrow();
  });
});

describe('stacks: state', () => {
  it('stacked starts get levels bottom → top, zone stacks and derived flags', () => {
    const state = new GameState(
      stackLevel(
        [
          ['m', 'mint', 5, 2],
          ['b', 'blue', 5, 2],
        ],
        [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
      ),
    );
    const snap = state.getSnapshot();
    expect(snap.boxes.map((b) => b.level)).toEqual([0, 1]);
    expect(snap.zones[0]).toMatchObject({ stack: ['m', 'b'], occupiedBy: 'b', satisfied: false, next: null });
    expect(snap.boxes.every((b) => !b.correct)).toBe(true);
  });

  it('classic levels keep forkHeight at 0 and every box at level 0', () => {
    const state = new GameState(stackLevel([['a', 'blue', 3, 2]], [{ id: 'z', color: 'blue', x: 6, z: 2 }]));
    carryTo(state, 5);
    const snap = state.getSnapshot();
    expect(snap.forklift.forkHeight).toBe(0);
    expect(snap.hint.dropLevel).toBe(0);
  });
});

describe('stacks: pick and drop', () => {
  const twoHigh = (): LevelData =>
    stackLevel(
      [
        ['low', 'blue', 3, 2],
        ['top', 'mint', 3, 2],
        ['c', 'yellow', 6, 1],
      ],
      [
        { id: 'z', color: 'blue', x: 6, z: 3, recipe: ['blue', 'mint'] },
        { id: 'y', color: 'yellow', x: 7, z: 1 },
      ],
    );

  it('picks the top of the stack in front and leaves the rest standing', () => {
    const state = new GameState(twoHigh());
    const snap = state.getSnapshot();
    expect(snap.hint.targetBoxId).toBe('top');
    const events = press(state);
    expect(eventOf(events, 'boxPicked')).toEqual({ type: 'boxPicked', boxId: 'top', fromZoneId: null, level: 1 });
    expect(snap.forklift.carrying).toBe('top');
    const low = snap.boxes[0];
    expect(low).toMatchObject({ level: 0, carried: false, cell: { x: 3, z: 2 } });
    // Next press (after dropping somewhere) could lift the lower one; right now the carried box has level 0.
    expect(snap.boxes[1].level).toBe(0);
  });

  it('forks rise toward the target box level while empty', () => {
    const state = new GameState(twoHigh());
    run(state, 1.5, IDLE);
    expect(state.getSnapshot().forklift.forkHeight).toBeCloseTo(1, 5);
  });

  it('drops on top of a stack with room: dropLevel in the hint, level in the event, forks at that height', () => {
    const state = new GameState(
      stackLevel(
        [
          ['a', 'mint', 3, 2],
          ['s', 'blue', 5, 2],
        ],
        [{ id: 'z', color: 'blue', x: 7, z: 2, recipe: ['blue', 'mint'] }],
      ),
    );
    carryTo(state, 5);
    const snap = state.getSnapshot();
    expect(snap.hint.dropCell).toEqual({ x: 5, z: 2 });
    expect(snap.hint.dropLevel).toBe(1);
    run(state, 1, IDLE);
    expect(snap.forklift.forkHeight).toBeCloseTo(1, 5);
    const drop = eventOf(press(state), 'boxDropped');
    expect(drop).toMatchObject({ boxId: 'a', cell: { x: 5, z: 2 }, level: 1, zoneId: null, correct: false, recipeLength: 0 });
    expect(snap.boxes[0]).toMatchObject({ level: 1, cell: { x: 5, z: 2 } });
    // It is now the pick target again: the forks stay at its height.
    run(state, 1, IDLE);
    expect(snap.hint.targetBoxId).toBe('a');
    expect(snap.forklift.forkHeight).toBeCloseTo(1, 5);
  });

  it('the carried load passes over a stack with room but not over a full one', () => {
    const run2 = (limit: number, stack: BoxSpec[]) => {
      const state = new GameState(stackLevel([['a', 'mint', 3, 2], ...stack], [{ id: 'z', color: 'mint', x: 8, z: 0 }, { id: 'y', color: 'blue', x: 8, z: 4 }, ...(stack.length > 1 ? [{ id: 'x', color: 'blue', x: 7, z: 4 }] : [])], { stackLimit: limit }));
      press(state);
      run(state, 3, east);
      return state.getSnapshot().forklift.pos.x;
    };
    // Stack of 1 at (5,2) with limit 2: the load rides over it until the body touches the stack.
    const over = run2(2, [['s', 'blue', 5, 2]]);
    // Same stack but full (limit 1 would be classic; use a 2-high stack with limit 2).
    const blocked = run2(2, [
      ['s', 'blue', 5, 2],
      ['t', 'blue', 5, 2],
    ]);
    expect(over).toBeGreaterThan(blocked + 0.3);
  });

  it('never stacks on a full cell: the drop goes to the floor next to it', () => {
    const state = new GameState(
      stackLevel(
        [
          ['a', 'mint', 3, 2],
          ['s', 'blue', 5, 2],
          ['t', 'blue', 5, 2],
        ],
        [
          { id: 'z', color: 'blue', x: 7, z: 2, recipe: ['blue', 'blue'] },
          { id: 'y', color: 'mint', x: 7, z: 0 },
        ],
        { stackLimit: 2 },
      ),
    );
    press(state);
    run(state, 3, move(0.4, 0));
    const hint = state.getSnapshot().hint;
    expect(hint.dropCell).not.toEqual({ x: 5, z: 2 });
    expect(hint.dropLevel).toBe(0);
  });
});

describe('stacks: recipe zones', () => {
  const recipeLevel = (): LevelData =>
    stackLevel(
      [
        ['b', 'blue', 3, 2],
        ['m', 'mint', 3, 1],
      ],
      [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
    );

  it('a zone is satisfied only when its stack equals the recipe', () => {
    const state = new GameState(recipeLevel());
    const snap = state.getSnapshot();
    expect(snap.zones[0].next).toBe('blue');
    carryTo(state, 5);
    const first = eventOf(press(state), 'boxDropped');
    expect(first).toMatchObject({ zoneId: 'z', level: 0, correct: false, recipeLength: 2, satisfiedCount: 0 });
    expect(snap.zones[0]).toMatchObject({ stack: ['b'], satisfied: false, next: 'mint' });
    expect(snap.boxes[0].correct).toBe(true);
    expect(snap.completed).toBe(false);
  });

  it('the completing drop on top reports correct + level, and the level completes', () => {
    const state = new GameState(
      stackLevel(
        [
          ['m', 'mint', 3, 2],
          ['b', 'blue', 5, 2],
        ],
        [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
      ),
    );
    const snap = state.getSnapshot();
    expect(snap.zones[0]).toMatchObject({ stack: ['b'], next: 'mint', satisfied: false });
    carryTo(state, 5);
    expect(snap.hint).toMatchObject({ dropZoneId: 'z', dropLevel: 1 });
    const events = press(state);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ zoneId: 'z', level: 1, correct: true, recipeLength: 2, satisfiedCount: 1, total: 1 });
    expect(types(events)).toEqual(['boxDropped', 'levelComplete']);
    expect(snap.zones[0]).toMatchObject({ stack: ['b', 'm'], satisfied: true, next: null, occupiedBy: 'm' });
    expect(snap.boxes.every((b) => b.correct)).toBe(true);
  });

  it('a wrong order is neutral: no satisfaction, no negative event, next = null', () => {
    const state = new GameState(
      stackLevel(
        [
          ['m', 'mint', 3, 2],
          ['b', 'blue', 6, 0],
        ],
        [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
      ),
    );
    carryTo(state, 5);
    const events = press(state);
    expect(types(events)).toEqual(['boxDropped']);
    const snap = state.getSnapshot();
    expect(snap.zones[0]).toMatchObject({ satisfied: false, next: null });
    expect(snap.boxes[0].correct).toBe(false);
  });

  it('stacking onto a satisfied zone releases it (neutral zoneReleased), lifting it off restores it', () => {
    const state = new GameState(
      stackLevel(
        [
          ['a', 'mint', 3, 2],
          ['s', 'blue', 5, 2],
          ['c', 'mint', 7, 0],
        ],
        [
          { id: 'z', color: 'blue', x: 5, z: 2 },
          { id: 'y', color: 'mint', x: 8, z: 0 },
          { id: 'w', color: 'mint', x: 8, z: 4 },
        ],
        { stackLimit: 2 },
      ),
    );
    const snap = state.getSnapshot();
    expect(snap.zones[0].satisfied).toBe(true);
    carryTo(state, 5);
    const events = press(state);
    expect(types(events)).toEqual(['boxDropped', 'zoneReleased']);
    expect(snap.zones[0].satisfied).toBe(false);
    expect(snap.progress.satisfied).toBe(0);
    run(state, 0.5, IDLE);
    expect(snap.hint.targetBoxId).toBe('a');
    const lifted = press(state);
    expect(types(lifted)).toEqual(['boxPicked', 'zoneRestored']);
    expect(eventOf(lifted, 'zoneRestored')).toEqual({
      type: 'zoneRestored',
      zoneId: 'z',
      boxId: 'a',
      recipeLength: 1,
      satisfiedCount: 1,
      total: 3,
    });
    expect(snap.zones[0].satisfied).toBe(true);
    expect(snap.progress.satisfied).toBe(1);
  });

  it('lifting the wrong top box off a finished recipe restores it with its recipe length', () => {
    const state = new GameState(
      stackLevel(
        [
          ['b', 'blue', 3, 2],
          ['m', 'mint', 3, 2],
          ['y', 'yellow', 3, 2],
        ],
        [
          { id: 'z', color: 'blue', x: 3, z: 2, recipe: ['blue', 'mint'] },
          { id: 'w', color: 'yellow', x: 7, z: 0 },
        ],
        { stackLimit: 3 },
      ),
    );
    const snap = state.getSnapshot();
    expect(snap.zones[0].satisfied).toBe(false);
    run(state, 1.5, IDLE); // forks up to the top box
    expect(snap.hint.targetBoxId).toBe('y');
    const events = press(state);
    expect(types(events)).toEqual(['firstInput', 'boxPicked', 'zoneRestored']);
    expect(eventOf(events, 'zoneRestored')).toMatchObject({ zoneId: 'z', boxId: 'y', recipeLength: 2, satisfiedCount: 1, total: 2 });
    expect(snap.completed).toBe(false);
  });

  it('the magnet pulls toward a zone that needs the carried color next, never toward one that needs another', () => {
    const forkX = (state: GameState) => {
      const f = state.getSnapshot().forklift;
      return f.pos.x + Math.sin(f.heading) * GAME_CONFIG.forklift.forkReach + 4.5;
    };
    // Needs mint on top of its blue: pulls from the neighbouring cell.
    const wants = new GameState(
      stackLevel(
        [
          ['m', 'mint', 3, 2],
          ['b', 'blue', 5, 2],
        ],
        [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
      ),
    );
    press(wants);
    runUntil(wants, () => forkX(wants) > 4.61, move(0.2, 0), 6);
    expect(wants.getSnapshot().hint).toMatchObject({ dropCell: { x: 5, z: 2 }, dropZoneId: 'z', dropLevel: 1 });

    // Mint pad (recipe mint → blue) already holding its mint: the carried mint is not pulled.
    const full = new GameState(
      stackLevel(
        [
          ['m', 'mint', 3, 2],
          ['n', 'mint', 5, 2],
          ['b', 'blue', 7, 0],
        ],
        [
          { id: 'z', color: 'mint', x: 5, z: 2, recipe: ['mint', 'blue'] },
          { id: 'y', color: 'mint', x: 7, z: 4 },
        ],
      ),
    );
    press(full);
    runUntil(full, () => forkX(full) > 4.61, move(0.2, 0), 6);
    expect(full.getSnapshot().hint).toMatchObject({ dropCell: { x: 4, z: 2 }, dropZoneId: null, dropLevel: 0 });
  });
});

describe('stacks: the carried box and the forks never sink into a stack', () => {
  const half = GAME_CONFIG.box.size / 2;
  const drive = (throttle: number, steer = 0): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle, steer }, actionPressed: false });

  /** The drawn carried box (turned with the heading) overlaps the square of the box resting at `p`. */
  const carriedOverlaps = (snap: GameSnapshot, p: Vec2): boolean => {
    const fork = snap.boxes.find((b) => b.id === snap.forklift.carrying)!.pos;
    const s = Math.sin(snap.forklift.heading);
    const c = Math.cos(snap.forklift.heading);
    const extent = half * (1 + Math.abs(s) + Math.abs(c));
    const dx = p.x - fork.x;
    const dz = p.z - fork.z;
    return Math.abs(dx) < extent && Math.abs(dz) < extent && Math.abs(dx * s + dz * c) < extent && Math.abs(dx * c - dz * s) < extent;
  };
  /** Every stack base with its stack height. */
  const bases = (snap: GameSnapshot) =>
    snap.boxes
      .filter((b) => b.cell && b.level === 0)
      .map((b) => ({ box: b, h: snap.boxes.filter((o) => o.cell && o.cell.x === b.cell!.x && o.cell.z === b.cell!.z).length }));

  /**
   * Step `seconds` with `input`. On every frame the carried box overlaps a stack with room, the forks must already
   * be (nearly) at its top, and driving forward never pushes the rig backwards. Returns the frames spent over a stack.
   */
  const driveChecked = (state: GameState, input: InputFrame, seconds: number, limit: number): number => {
    const snap = state.getSnapshot();
    let over = 0;
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      const x = snap.forklift.pos.x;
      const z = snap.forklift.pos.z;
      state.update(DT, input);
      const f = snap.forklift;
      const along = (f.pos.x - x) * Math.sin(f.heading) + (f.pos.z - z) * Math.cos(f.heading);
      if ((input.drive?.throttle ?? 0) > 0 || input.move.x > 0) expect(along).toBeGreaterThan(-1e-9);
      if (!f.carrying) continue;
      for (const { box, h } of bases(snap)) {
        if (h >= limit || !carriedOverlaps(snap, box.pos)) continue;
        over++;
        expect(f.forkHeight).toBeGreaterThanOrEqual(h - LOAD_PASS_CLEARANCE);
      }
    }
    return over;
  };

  /** Carry the mint east into a `height`-high stack with room at (6,2). */
  const approachLevel = (height: number, limit: number): LevelData =>
    stackLevel(
      [
        ['a', 'mint', 3, 2],
        ...Array.from({ length: height }, (_, i): BoxSpec => [`s${i}`, i === 0 ? 'blue' : 'yellow', 6, 2]),
      ],
      [
        { id: 'z', color: 'mint', x: 8, z: 0 },
        { id: 'y', color: 'blue', x: 8, z: 4, recipe: ['blue', ...Array.from({ length: height - 1 }, () => 'yellow')] },
      ],
      { stackLimit: limit },
    );

  for (const [height, limit] of [
    [1, 2],
    [2, 3],
  ] as const) {
    for (const [style, input] of [
      ['stick, full speed', move(1, 0)],
      ['stick, slow', move(0.4, 0)],
      ['vehicle, full speed', drive(1)],
    ] as const) {
      it(`forks are up before the load reaches a ${height}-high stack (${style}), then it rides over`, () => {
        const state = new GameState(approachLevel(height, limit));
        const snap = state.getSnapshot();
        press(state);
        expect(driveChecked(state, input, 5, limit)).toBeGreaterThan(10);
        // All the way: the body rests against the base with the load over the stack, forks at its top.
        expect(Math.abs(forkPoint(state).x - snap.boxes[1].pos.x)).toBeLessThan(0.2);
        expect(snap.forklift.forkHeight).toBeCloseTo(height, 5);
      });
    }
  }

  it('the forks hold over a stack while the drop target moves to a floor zone beside it', () => {
    // A lone box with, right behind it, a zone that wants the carried mint: the magnet picks the zone (floor level)
    // while the load still hangs over the box.
    const state = new GameState(
      stackLevel(
        [
          ['a', 'mint', 3, 2],
          ['s', 'blue', 5, 2],
        ],
        [
          { id: 'z', color: 'mint', x: 6, z: 2 },
          { id: 'y', color: 'blue', x: 8, z: 4 },
        ],
        { stackLimit: 2 },
      ),
    );
    const snap = state.getSnapshot();
    press(state);
    driveChecked(state, move(1, 0), 2.5, 2);
    expect(snap.hint).toMatchObject({ dropCell: { x: 6, z: 2 }, dropLevel: 0 });
    expect(carriedOverlaps(snap, snap.boxes[1].pos)).toBe(true);
    expect(driveChecked(state, IDLE, 2, 2)).toBeGreaterThan(100);
    expect(snap.forklift.forkHeight).toBe(1);
    // The drop still goes where the preview says.
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ cell: { x: 6, z: 2 }, zoneId: 'z', level: 0, correct: true });
  });

  it('turning in place over a stack keeps the forks up until the load is clear, with no shove', () => {
    const state = new GameState(approachLevel(1, 3));
    const snap = state.getSnapshot();
    press(state);
    driveChecked(state, drive(0.6), 3, 3);
    expect(carriedOverlaps(snap, snap.boxes[1].pos)).toBe(true);
    let moved = 0;
    let over = 0;
    for (let i = 0; i < 180; i++) {
      const x = snap.forklift.pos.x;
      const z = snap.forklift.pos.z;
      over += driveChecked(state, drive(0, 1), DT, 3);
      moved = Math.max(moved, Math.hypot(snap.forklift.pos.x - x, snap.forklift.pos.z - z));
    }
    // More than a full turn: the load swept off the stack and back over it; the body was never pushed out.
    expect(over).toBeGreaterThan(20);
    expect(moved).toBeLessThan(1e-3);
  });

  it('a stack the load cannot clear yet blocks it like any box, then lets it over once the forks are up', () => {
    // Forks that climb very slowly: the load reaches the face long before they are up.
    const slow = { ...GAME_CONFIG, stack: { ...GAME_CONFIG.stack, forkRiseSpeed: 0.3 } };
    const state = new GameState(approachLevel(1, 2), slow);
    const snap = state.getSnapshot();
    press(state);
    expect(driveChecked(state, move(0.5, 0), 8, 2)).toBeGreaterThan(0);
    expect(Math.abs(forkPoint(state).x - snap.boxes[1].pos.x)).toBeLessThan(0.2);
  });

  it('empty forks reach the top of a stack before the tines get to it', () => {
    const state = new GameState(
      stackLevel(
        [
          ['s', 'blue', 5, 2],
          ['t', 'mint', 5, 2],
          ['u', 'yellow', 5, 2],
        ],
        [{ id: 'z', color: 'blue', x: 8, z: 0, recipe: ['blue', 'mint', 'yellow'] }],
        { stackLimit: 3, forklift: { x: 1, z: 2, heading: 90 } },
      ),
    );
    const snap = state.getSnapshot();
    const stack = snap.boxes[0].pos;
    let near = 0;
    for (let i = 0; i < 240; i++) {
      state.update(DT, move(1, 0));
      // Fork point within reach of the stack's footprint (the tines stick out a little past it).
      if (stack.x - forkPoint(state).x < half + 0.3) {
        near++;
        expect(snap.forklift.forkHeight).toBeGreaterThanOrEqual(2 - LOAD_PASS_CLEARANCE);
      }
    }
    expect(near).toBeGreaterThan(10);
    expect(snap.hint.targetBoxId).toBe('u');
    expect(snap.forklift.forkHeight).toBe(2);
  });

  it('driving past a box in the next lane does not lift the forks', () => {
    const state = new GameState(
      stackLevel(
        [
          ['a', 'mint', 3, 2],
          ['s', 'blue', 5, 1],
        ],
        [
          { id: 'z', color: 'mint', x: 8, z: 3 },
          { id: 'y', color: 'blue', x: 8, z: 0 },
        ],
        { stackLimit: 2 },
      ),
    );
    const snap = state.getSnapshot();
    press(state);
    let highest = 0;
    runUntil(
      state,
      () => {
        highest = Math.max(highest, snap.forklift.forkHeight);
        return forkPoint(state).x > 2.2;
      },
      move(1, 0),
    );
    expect(highest).toBe(0);
  });
});
