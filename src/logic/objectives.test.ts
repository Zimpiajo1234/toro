import { describe, expect, it } from 'vitest';
import { angleDelta } from '../core/math';
import { hasStorage } from '../core/storage';
import type { GameEvent, InputFrame, LevelData } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
import { GameState } from './GameState';
import { objectivesLeft } from './objectives';
import { DT, IDLE, makeLevel, move, press, rng, run, runUntil } from './testUtils';

/*
 * The objectives counter (HUD «Quedan N», logic/objectives): the boxes still to be put in their place, on the targets
 * the level-complete check reads. Classic zones and recipe steps one box each, storage slots with a cue one each until
 * they hold their destined box (in a stack, on satisfied levels); «libre» slots and wrong boxes never count.
 */

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;
const left = (state: GameState) => objectivesLeft(state.getSnapshot());
/** Vehicle controls (W / S throttle, A / D steer) and a fork step (F = +1, V = −1). */
const drive = (throttle = 0, steer = 0, forkStep: -1 | 0 | 1 = 0, actionPressed = false): InputFrame => ({
  move: { x: 0, z: 0 },
  drive: { throttle, steer },
  actionPressed,
  forkStep,
});
type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
const dropped = (events: readonly GameEvent[]) => events.find((e): e is Dropped => e.type === 'boxDropped');

/** 9×5 floor, forklift on (2,2) facing +x: the fork point starts over (3,2). */
function row(boxes: Record<string, unknown>[], zones: Record<string, unknown>[], extra: Record<string, unknown> = {}): LevelData {
  return makeLevel({ size: { width: 9, depth: 5 }, forklift: { x: 2, z: 2, heading: 90 }, boxes, zones, ...extra });
}

/** Pick what is in front, then roll east until the drop preview sits on column `x`. */
function carryTo(state: GameState, x: number): void {
  press(state);
  expect(state.getSnapshot().forklift.carrying).not.toBeNull();
  runUntil(state, () => state.getSnapshot().hint.dropCell?.x === x, move(0.4, 0), 6);
  run(state, 0.4, IDLE);
}

describe('objectives left: classic levels', () => {
  it('level 1: its one box counts until it rests on its zone; carrying it there is not placing it', () => {
    const state = new GameState(LEVELS[0]);
    const snap = state.getSnapshot();
    expect(left(state)).toBe(1);
    // W up to the box, let the forklift come to rest, lift it.
    for (let i = 0; i < 600 && !snap.hint.targetBoxId; i++) state.update(DT, drive(1));
    run(state, 1.5, IDLE);
    press(state);
    expect(snap.forklift.carrying).not.toBeNull();
    expect(left(state)).toBe(1);
    // W to the zone and drop there: the level completes as the count reaches 0.
    for (let i = 0; i < 900 && !snap.hint.dropZoneId; i++) state.update(DT, drive(1));
    state.update(DT, drive(1, 0, 0, true));
    expect(snap.completed).toBe(true);
    expect(left(state)).toBe(0);
  });

  it('a box taken off its zone counts again, and put back it counts down again', () => {
    const state = new GameState(
      row(
        [
          { id: 'b', color: 'blue', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 7, z: 4 },
        ],
        [
          { id: 'zb', color: 'blue', x: 5, z: 2 },
          { id: 'zm', color: 'mint', x: 8, z: 0 },
        ],
      ),
    );
    const snap = state.getSnapshot();
    expect(left(state)).toBe(2);
    carryTo(state, 5);
    expect(left(state)).toBe(2);
    expect(dropped(press(state))).toMatchObject({ boxId: 'b', zoneId: 'zb', correct: true });
    expect(left(state)).toBe(1);
    run(state, 0.5, IDLE);
    expect(snap.hint.targetBoxId).toBe('b');
    press(state); // off its zone again
    expect(snap.forklift.carrying).toBe('b');
    expect(left(state)).toBe(2);
    expect(dropped(press(state))).toMatchObject({ boxId: 'b', zoneId: 'zb', correct: true });
    expect(left(state)).toBe(1);
    expect(snap.completed).toBe(false);
  });

  it('a wrong box on a zone changes nothing, nor does lifting it off again', () => {
    const state = new GameState(
      row(
        [
          { id: 'm', color: 'mint', x: 3, z: 2 },
          { id: 'b', color: 'blue', x: 7, z: 4 },
        ],
        [
          { id: 'zb', color: 'blue', x: 5, z: 2 },
          { id: 'zm', color: 'mint', x: 8, z: 0 },
        ],
      ),
    );
    const snap = state.getSnapshot();
    carryTo(state, 5);
    expect(dropped(press(state))).toMatchObject({ boxId: 'm', zoneId: 'zb', correct: false });
    expect(left(state)).toBe(2);
    run(state, 0.5, IDLE);
    press(state);
    expect(snap.forklift.carrying).toBe('m');
    expect(left(state)).toBe(2);
  });

  it('sorting by symbol: a box its zone accepts by symbol counts, one it does not accept leaves the count', () => {
    const zones = [
      { id: 'zc', symbol: 'circle', x: 5, z: 2 },
      { id: 'zm', color: 'mint', x: 8, z: 0 },
    ];
    // Coral ● fits the «●» zone by its symbol whatever its colour.
    const fits = new GameState(
      row(
        [
          { id: 'c', color: 'coral', symbol: 'circle', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 7, z: 4 },
        ],
        zones,
      ),
    );
    expect(left(fits)).toBe(2);
    carryTo(fits, 5);
    expect(dropped(press(fits))).toMatchObject({ boxId: 'c', zoneId: 'zc', correct: true });
    expect(left(fits)).toBe(1);
    // Mint ▲ on the «●» zone: not its box.
    const wrong = new GameState(
      row(
        [
          { id: 'm', color: 'mint', x: 3, z: 2 },
          { id: 'c', color: 'coral', symbol: 'circle', x: 7, z: 4 },
        ],
        zones,
      ),
    );
    carryTo(wrong, 5);
    expect(dropped(press(wrong))).toMatchObject({ boxId: 'm', zoneId: 'zc', correct: false });
    expect(left(wrong)).toBe(2);
  });
});

describe('objectives left: stacking recipes', () => {
  it('one per step still missing: a step lifted off counts again, put back or completed it counts down', () => {
    // Blue and mint already on the zone ahead (a correct start of its recipe): only the yellow step is missing.
    const state = new GameState(
      row(
        [
          { id: 'b', color: 'blue', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 3, z: 2 },
          { id: 'y', color: 'yellow', x: 7, z: 4 },
        ],
        [{ id: 'z', color: 'blue', recipe: ['blue', 'mint', 'yellow'], x: 3, z: 2 }],
        { stackLimit: 3 },
      ),
    );
    const snap = state.getSnapshot();
    expect(left(state)).toBe(1);
    run(state, 1.5, IDLE); // the forks up to the top box
    expect(snap.hint.targetBoxId).toBe('m');
    press(state);
    expect(snap.forklift.carrying).toBe('m');
    expect(left(state)).toBe(2);
    expect(dropped(press(state))).toMatchObject({ boxId: 'm', zoneId: 'z', level: 1, correct: false });
    expect(left(state)).toBe(1);

    // The last step: mint onto the blue already on its zone completes the recipe and the level.
    const last = new GameState(
      row(
        [
          { id: 'm', color: 'mint', x: 3, z: 2 },
          { id: 'b', color: 'blue', x: 5, z: 2 },
        ],
        [{ id: 'z', color: 'blue', recipe: ['blue', 'mint'], x: 5, z: 2 }],
      ),
    );
    expect(left(last)).toBe(1);
    carryTo(last, 5);
    const events = press(last);
    expect(dropped(events)).toMatchObject({ boxId: 'm', zoneId: 'z', level: 1, correct: true });
    expect(events.at(-1)).toEqual({ type: 'levelComplete' });
    expect(left(last)).toBe(0);
  });

  it('a wrong step counts nothing; a box on top of a finished recipe is not placed, nor counted when lifted', () => {
    const state = new GameState(
      row(
        [
          { id: 'b', color: 'blue', x: 5, z: 2 },
          { id: 'y', color: 'yellow', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 7, z: 4 },
        ],
        [
          { id: 'z', color: 'blue', recipe: ['blue', 'mint'], x: 5, z: 2 },
          { id: 'w', color: 'yellow', x: 8, z: 0 },
        ],
      ),
    );
    expect(left(state)).toBe(2);
    carryTo(state, 5);
    expect(dropped(press(state))).toMatchObject({ boxId: 'y', zoneId: 'z', level: 1, correct: false });
    expect(left(state)).toBe(2);

    // Mint done on blue, yellow on top of it (the recipe is full: the zone is released): only yellow is left to place.
    const full = new GameState(
      row(
        [
          { id: 'b', color: 'blue', x: 3, z: 2 },
          { id: 'm', color: 'mint', x: 3, z: 2 },
          { id: 'y', color: 'yellow', x: 3, z: 2 },
        ],
        [
          { id: 'z', color: 'blue', recipe: ['blue', 'mint'], x: 3, z: 2 },
          { id: 'w', color: 'yellow', x: 7, z: 0 },
        ],
        { stackLimit: 3 },
      ),
    );
    const snap = full.getSnapshot();
    expect(snap.zones[0].satisfied).toBe(false);
    expect(left(full)).toBe(1);
    run(full, 1.5, IDLE);
    expect(snap.hint.targetBoxId).toBe('y');
    expect(press(full).map((e) => e.type)).toContain('zoneRestored');
    expect(snap.zones[0].satisfied).toBe(true);
    expect(left(full)).toBe(1);
  });
});

/** Press F / V until level `target` is selected at the storage column the rig works at, then let the forks get there. */
function selectLevel(state: GameState, target: number): void {
  for (let i = 0; i < 10; i++) {
    const at = state.getSnapshot().hint.storage;
    if (!at) throw new Error('not at a storage column');
    if (at.level === target) break;
    state.update(DT, drive(0, 0, at.level < target ? 1 : -1));
  }
  expect(state.getSnapshot().hint.storage?.level).toBe(target);
  run(state, 1.5, IDLE);
}

/** Turn in place (world-space move, as the stick does) until the forklift faces (dx, dz). */
function face(state: GameState, dx: number, dz: number): void {
  const heading = Math.atan2(dx, dz);
  for (let t = 0; t < 5 && Math.abs(angleDelta(state.getSnapshot().forklift.heading, heading)) > 0.005; t += DT)
    state.update(DT, { move: { x: dx * 0.08, z: dz * 0.08 }, actionPressed: false });
  run(state, 0.5, IDLE);
}

describe('objectives left: storage', () => {
  it('racks: only slots with a cue count; a «libre» slot or a wrong one leaves the count, the destined box takes one off', () => {
    // The rack against the north wall, front to the south: «azul» / «menta» / «libre». Blue ahead, mint behind.
    const state = new GameState(
      level(`
# 1 · Estantería
id: objetivos-estanteria
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 ...b...

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta / libre
`),
    );
    const snap = state.getSnapshot();
    expect(snap.storageSlots.filter((s) => s.accepts === null)).toHaveLength(1);
    expect(left(state)).toBe(2);
    press(state);
    expect(left(state)).toBe(2);
    // Into the «libre» top slot: stored, never a target.
    selectLevel(state, 2);
    run(state, 2, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', slotId: 'r1:0:2', recipeLength: 0 });
    expect(left(state)).toBe(2);
    // Out again, into the «menta» slot: a wrong box there.
    run(state, 0.3, IDLE);
    expect(press(state)[0]).toMatchObject({ type: 'boxPicked', fromSlotId: 'r1:0:2' });
    run(state, 0.4, IDLE);
    run(state, 1.2, drive(-1)); // straight back out of the slot (the level is locked while the load is in it)
    selectLevel(state, 1);
    run(state, 2, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', slotId: 'r1:0:1', correct: false, wrongTarget: true });
    expect(left(state)).toBe(2);
    // Out again, into its own «azul» slot: one off (and locked there for good).
    run(state, 0.3, IDLE);
    expect(press(state)[0]).toMatchObject({ type: 'boxPicked', fromSlotId: 'r1:0:1' });
    expect(left(state)).toBe(2);
    run(state, 0.4, IDLE);
    run(state, 1.2, drive(-1));
    selectLevel(state, 0);
    run(state, 2, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', slotId: 'r1:0:0', correct: true });
    expect(snap.boxes[0].locked).toBe(true);
    expect(left(state)).toBe(1);
    // Fetch the mint box behind, into the «menta» slot: the last one.
    run(state, 1, drive(-1));
    face(state, 0, 1);
    for (let t = 0; t < 3 && snap.hint.targetBoxId !== 'b2'; t += DT) state.update(DT, drive(0.3));
    press(state);
    expect(snap.forklift.carrying).toBe('b2');
    expect(left(state)).toBe(1);
    face(state, 0, -1);
    for (let t = 0; t < 3 && !snap.hint.storage; t += DT) state.update(DT, drive(0.5));
    selectLevel(state, 1);
    run(state, 3, drive(1));
    const events = press(state);
    expect(dropped(events)).toMatchObject({ boxId: 'b2', slotId: 'r1:0:1', correct: true });
    expect(events.at(-1)).toEqual({ type: 'levelComplete' });
    expect(left(state)).toBe(0);
  });

  /** A two-column truck outside the north wall: «azul» under «▲», and «coral ◆» (a «libre» level over it, limit 2). */
  const dock = (a: string, b: string, c: string) =>
    level(`
# 2 · Muelle
id: objetivos-muelle
limit: 2

  012345
0 pTTp..
1 ......
2 .a....
3 .^b...
4 ....c.

a = caja ${a}     b = caja ${b}     c = caja ${c}
T = camión muelle norte: azul / ▲ | coral ◆
`);

  it('trucks: the destined box on its level takes one off; a wrong base, and its destined box on top of it, do not', () => {
    // Blue ● right ahead: onto the bed, its destiny.
    const right = new GameState(dock('azul ●', 'menta ▲', 'coral ◆'));
    expect(right.getSnapshot().storageSlots.filter((s) => s.accepts === null)).toHaveLength(1);
    expect(left(right)).toBe(3);
    press(right);
    run(right, 2.5, drive(1));
    expect(dropped(press(right))).toMatchObject({ slotId: 't1:0:0', correct: true });
    expect(left(right)).toBe(2);

    // Coral ◆ onto the «azul» bed by mistake, then menta ▲ (the «▲» level's own box) on top of it: neither counts.
    const state = new GameState(dock('coral ◆', 'menta ▲', 'azul ●'));
    const snap = state.getSnapshot();
    press(state);
    run(state, 2.5, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', slotId: 't1:0:0', correct: false, wrongTarget: true });
    expect(left(state)).toBe(3);
    runUntil(state, () => snap.forklift.pos.z >= 3 + 0.5 - snap.level.size.depth / 2 - 0.15, drive(-1), 6);
    run(state, 0.6, IDLE);
    face(state, 1, 0);
    press(state);
    expect(snap.forklift.carrying).toBe('b2');
    face(state, 0, -1);
    run(state, 3, drive(1));
    state.update(DT, drive(0, 0, 1));
    run(state, 0.6, IDLE);
    run(state, 1.5, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b2', slotId: 't1:0:1', correct: false, wrongTarget: true });
    expect(snap.storageSlots[1].destined).toMatchObject({ color: 'mint', symbol: 'triangle' });
    expect(left(state)).toBe(3);
  });

  it('trucks: a box loaded on its destiny from the start is already done; a «libre» level never counts', () => {
    // «azul» loaded and locked from the start, a «libre» level over it (limit 2), and a floor zone for the mint box.
    const state = new GameState(
      level(`
# 3 · Aparcar en el camión
id: objetivos-aparcar
limit: 2

  0123
0 pTp.
1 ....
2 .a..
3 .^.1

1 = zona menta
a = caja menta ▲
T = camión muelle norte: azul + caja azul ●
`),
    );
    const snap = state.getSnapshot();
    expect(snap.progress).toEqual({ satisfied: 1, total: 2 });
    expect(left(state)).toBe(1);
    press(state);
    run(state, 3, drive(1));
    state.update(DT, drive(0, 0, 1));
    run(state, 0.6, IDLE);
    run(state, 1.5, drive(1));
    expect(dropped(press(state))).toMatchObject({ boxId: 'b1', slotId: 't1:0:1', recipeLength: 0 });
    expect(left(state)).toBe(1);
    run(state, 0.3, IDLE);
    press(state); // and out again
    expect(snap.forklift.carrying).toBe('b1');
    expect(left(state)).toBe(1);
  });
});

describe('objectives left: under random play', () => {
  // The forklift faces a box already on its target (counted done): random presses lift it off and put it down again.
  const classic = makeLevel({
    forklift: { x: 2, z: 2, heading: 90 },
    boxes: [
      { id: 'a', color: 'blue', x: 3, z: 2 },
      { id: 'b', color: 'mint', x: 4, z: 1 },
    ],
    zones: [
      { id: 'za', color: 'blue', x: 3, z: 2 },
      { id: 'zb', color: 'mint', x: 5, z: 2 },
    ],
  });
  const stacking = makeLevel({
    forklift: { x: 2, z: 2, heading: 90 },
    stackLimit: 3,
    boxes: [
      { id: 'a', color: 'blue', x: 3, z: 2 },
      { id: 'b', color: 'mint', x: 3, z: 2 },
      { id: 'c', color: 'coral', x: 4, z: 1 },
    ],
    zones: [
      { id: 'z', color: 'blue', recipe: ['blue', 'mint'], x: 3, z: 2 },
      { id: 'y', color: 'coral', x: 5, z: 2 },
    ],
  });
  const sorting = makeLevel({
    forklift: { x: 2, z: 2, heading: 90 },
    boxes: [
      { id: 'a', color: 'blue', symbol: 'triangle', x: 3, z: 2 },
      { id: 'b', color: 'mint', symbol: 'circle', x: 4, z: 1 },
    ],
    zones: [
      { id: 't', symbol: 'triangle', x: 3, z: 2 },
      { id: 'm', color: 'mint', x: 5, z: 2 },
    ],
  });
  // Facing a rack column with a box on its front cell, and facing a truck's door with a box ahead.
  const rack = level(`
# 4 · Frente
id: objetivos-frente
limit: 1

  0123456
0 ...R...
1 ...a...
2 ...^...
3 .......
4 .b.....

a = caja azul       b = caja menta
R = estantería frente sur: azul / menta / libre
`);
  const truck = level(`
# 5 · Muelle
id: objetivos-muelle-azar
limit: 2

  012345
0 pTTp..
1 ......
2 .a....
3 .^b...
4 ....c.

a = caja azul ●     b = caja menta ▲     c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆
`);

  it('never negative, 0 exactly when every target is satisfied, moved by one only on a pick or a drop; with storage, the targets left', () => {
    let changes = 0;
    for (const lvl of [...LEVELS, classic, stacking, sorting, rack, truck, getSpecialLevel(BENCHMARK_ID)!]) {
      const r = rng(lvl.boxes.length * 31 + lvl.zones.length);
      const state = new GameState(lvl);
      const snap = state.getSnapshot();
      const storage = hasStorage(lvl);
      let before = left(state);
      for (let i = 0; i < 2500; i++) {
        const k = r();
        const events = state.update(r() < 0.1 ? 1 / 20 : DT, drive(r() * 2 - 1, r() * 2 - 1, k < 0.04 ? 1 : k < 0.08 ? -1 : 0, r() < 0.05));
        const now = left(state);
        expect(now).toBeGreaterThanOrEqual(0);
        expect(now === 0).toBe(snap.progress.satisfied === snap.progress.total);
        if (storage) expect(now).toBe(snap.progress.total - snap.progress.satisfied);
        if (now !== before) {
          changes++;
          expect(Math.abs(now - before)).toBe(1);
          expect(events.some((e) => e.type === 'boxPicked' || e.type === 'boxDropped')).toBe(true);
        }
        before = now;
      }
    }
    // Boxes lifted off their targets and put down again, many times over (the seeds are fixed).
    expect(changes).toBeGreaterThan(50);
  });
});
