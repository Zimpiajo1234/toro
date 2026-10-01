import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
import { validateLevel } from '../validateLevel';
import { BENCHMARK_ID, getSpecialLevel } from './index';
import { checkLevelTargets, levelMetrics } from './metrics';
import { levelsReport } from './report';
import {
  LevelGrid,
  POS_SHELF,
  boxCode,
  canLift,
  carrySearch,
  lift,
  minMoves,
  misplacedCount,
  movesLowerBounds,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  stacksOf,
  validDrop,
  type Stacks,
} from './solver';
import fixtureText from './pruebas/cinta.level?raw';
import buttonText from './pruebas/cinta-boton.level?raw';

/*
 * The grid model with conveyor belts (docs/CONVEYOR.md «Solver»): a belt's cells, its input and its end exit are solid;
 * the input is a storage position (one slot on the belt's table, at level 1: its id names it, the model needs no
 * height) loaded by one step on from behind its front cell, like a rack slot; the end exit is a storage position no
 * pose ever works, fed by its input (`feeds` / `fedBy`): a box set down on an empty input while the end exit has room
 * lands in the end exit in that one move. Without a button (the H1 fixture) the model leaves one move out: only the end
 * exit's destined box is sent down a belt, and a box is never lifted from an end exit. With the end exit full, a box
 * set down on the input stays there, and can be lifted again. With a button (H2, the button fixture) any box rides
 * down, and one resting at the end exit unlocked is lifted «from» it: the press (no move) brings it back onto the empty
 * input, where the move goes on, so the model never has a free edge.
 */

const FIXTURE = parseLevel(fixtureText, 'src/data/levels/pruebas/cinta.level').level;
const BUTTON = parseLevel(buttonText, 'src/data/levels/pruebas/cinta-boton.level').level;
const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;

describe('grid model with conveyor belts', () => {
  const grid = new LevelGrid(FIXTURE);
  const input = grid.positionOfSlot('e1:0:1');
  const exit = grid.positionOfSlot('s1:0:1');
  const blue = boxCode({ color: 'blue', symbol: 'circle' });
  const blueSquare = boxCode({ color: 'blue', symbol: 'square' });

  it('the input and the end exit are storage positions after the cells, linked; the belt and both ends are solid', () => {
    expect([grid.kind[input], grid.kind[exit]]).toEqual([POS_SHELF, POS_SHELF]);
    expect([grid.capacity[input], grid.capacity[exit]]).toEqual([1, 1]);
    expect(input).toBeGreaterThanOrEqual(grid.cellCount);
    // Their one slot each, on the belt's table: level 1 (the forks' level the autopilot selects there).
    expect([grid.levelAt(input), grid.levelAt(exit)]).toEqual([1, 1]);
    expect(grid.positionOfSlot('e1:0:0')).toBe(-1);
    expect([grid.feeds[input], grid.fedBy[exit], grid.feeds[exit], grid.fedBy[input]]).toEqual([exit, input, -1, -1]);
    // The input asks for nothing; the end exit for its destined box (blue ●, the only blue the zones leave it).
    expect(grid.steps[input]).toBeNull();
    expect(grid.steps[exit]).toHaveLength(1);
    for (const [x, z] of [
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ])
      expect(grid.solid[grid.index(x, z)], `${x},${z}`).toBe(1);
    // Worked from the input's front, facing north (both ends share it); no pose works the end exit.
    expect([grid.front[input], grid.inward[input]]).toEqual([grid.index(3, 4), DIR.N]);
    expect([grid.front[exit], grid.inward[exit]]).toEqual([grid.index(3, 4), DIR.N]);
    const worked = new Set<number>();
    for (let pose = 0; pose < grid.cellCount * 4; pose++) if (grid.columnAtPose[pose] >= 0) worked.add(grid.columnAtPose[pose]);
    const columnOf = (pos: number) => grid.columns.indexOf(grid.columnOfPos(pos)!);
    expect(worked.has(columnOf(input))).toBe(true);
    expect(worked.has(columnOf(exit))).toBe(false);
  });

  it('a drop on the input lands in the end exit: its destined box only, while the input is empty and the end exit has room', () => {
    const start = stacksOf(grid, FIXTURE);
    const from = grid.index(1, 3); // blue ●
    const lifted = lift(start, from);
    expect(validDrop(grid, lifted, from, exit, blue)).toBe(true);
    // Not the destined box (blue ■ fits «azul» too), never: it could not come back before the button.
    expect(validDrop(grid, lifted, from, exit, blueSquare)).toBe(false);
    // The input itself only takes a box while the end exit is full (the box then stays there).
    expect(validDrop(grid, lifted, from, input, blue)).toBe(false);
    const full: Stacks = lifted.slice();
    full[exit] = blue;
    expect(validDrop(grid, full, grid.index(7, 5), input, blueSquare)).toBe(true);
    expect(validDrop(grid, full, grid.index(7, 5), exit, blueSquare)).toBe(false);
    // A box resting on the input can be lifted again; the end exit's, never.
    const parked = full.slice();
    parked[input] = blueSquare;
    expect(canLift(grid, parked, input)).toBe(true);
    expect(canLift(grid, parked, exit)).toBe(false);
    expect(validDrop(grid, parked, input, exit, blueSquare)).toBe(false);
  });

  it('carrying a box up to the input from behind its front offers both: the input and, through it, the end exit', () => {
    const start = stacksOf(grid, FIXTURE);
    const from = grid.index(1, 3);
    const occupancy = occupancyOf(grid, start);
    const region = reachableFrom(grid, occupancy, grid.index(FIXTURE.forklift.x, FIXTURE.forklift.z));
    const lifted = lift(start, from);
    occupancy[from] = -1;
    const search = carrySearch(grid, occupancy, lifted, pickupStarts(grid, region, from));
    expect(search.drops.has(input)).toBe(true);
    expect(search.drops.has(exit)).toBe(true);
    // Both from the input's front cell, one step on from behind it, facing north.
    for (const drop of [input, exit]) {
      const chain = search.chainTo(drop, grid.index(3, 4))!;
      expect(chain.at(-1)).toBe(grid.index(3, 4) * 4 + DIR.N);
    }
  });

  it('the exact search bound stays consistent with a belt (one move lowers it by at most one), Benchmark and its button included', () => {
    for (const lvl of [FIXTURE, BUTTON, getSpecialLevel(BENCHMARK_ID)!]) {
      const g = new LevelGrid(lvl);
      const start: Stacks = stacksOf(g, lvl);
      const h = movesLowerBounds(g, start, lvl.boxes.length);
      const plan = minMoves(lvl).plan!;
      expect(h(start)).toBeLessThanOrEqual(plan.length);
      let at = { stacks: start, forklift: g.index(lvl.forklift.x, lvl.forklift.z) };
      const states = [at];
      for (const m of plan) {
        const next = lift(at.stacks, m.from);
        next[m.drop] += at.stacks[m.from].slice(-1);
        at = { stacks: next, forklift: m.after! };
        states.push(at);
      }
      const bad: string[] = [];
      let belt = 0;
      for (const s of states) {
        const before = h(s.stacks);
        const occupancy = occupancyOf(g, s.stacks);
        const region = reachableFrom(g, occupancy, s.forklift);
        for (let from = 0; from < g.posCount; from++) {
          if (!canLift(g, s.stacks, from)) continue;
          const lifted = lift(s.stacks, from);
          const box = s.stacks[from].slice(-1);
          if (from < g.cellCount) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
          for (const drop of carrySearch(g, occupancy, lifted, pickupStarts(g, region, from)).drops.keys()) {
            if (!validDrop(g, lifted, from, drop, box)) continue;
            if (g.fedBy[drop] >= 0) belt++;
            const next = lifted.slice();
            next[drop] += box;
            const after = h(next);
            if (before - after > 1) bad.push(`${lvl.id}: ${before} → ${after} moving ${from} → ${drop}`);
          }
          if (from < g.cellCount) occupancy[from] = s.stacks[from].length > 0 ? 0 : -1;
        }
      }
      expect(belt, lvl.id).toBeGreaterThan(0);
      expect(bad).toEqual([]);
    }
  });
});

describe('grid model with a belt button (H2)', () => {
  const grid = new LevelGrid(BUTTON);
  const input = grid.positionOfSlot('e1:0:1');
  const exit = grid.positionOfSlot('s1:0:1');
  const blue = boxCode({ color: 'blue', symbol: 'circle' });
  const mint = boxCode({ color: 'mint', symbol: 'triangle' });
  const press = grid.index(4, 3);

  it('the button is solid and pressed from the free cells beside it: only (4,3), facing north; a belt without one has none', () => {
    expect(grid.solid[grid.index(4, 2)]).toBe(1);
    expect(grid.pressFrom[exit]).toEqual([press]);
    expect(grid.pressFrom.filter((cells) => cells.length > 0)).toHaveLength(1);
    const plain = new LevelGrid(FIXTURE);
    expect(plain.pressFrom.every((cells) => cells.length === 0)).toBe(true);
  });

  it('any box rides down a belt with a button (input empty, exit free); one at its exit unlocked comes back onto the empty input', () => {
    const start = stacksOf(grid, BUTTON);
    const from = grid.index(1, 5); // azul ●, on the menta zone
    const lifted = lift(start, from);
    // «libre» end exit: no box is its destiny, yet with the button any may park there.
    expect(grid.steps[exit]).toBeNull();
    expect(validDrop(grid, lifted, from, exit, blue)).toBe(true);
    const parked: Stacks = lifted.slice();
    parked[exit] = blue;
    // Lifted «from» the end exit through the button: A empty; with a box on A, never (the press needs its slot).
    expect(canLift(grid, parked, exit)).toBe(true);
    const busy = parked.slice();
    busy[input] = mint;
    expect(canLift(grid, busy, exit)).toBe(false);
    // Only while the forklift reaches the cell the button is pressed from; then off the input, from its front.
    const occupancy = occupancyOf(grid, parked);
    const region = reachableFrom(grid, occupancy, grid.index(BUTTON.forklift.x, BUTTON.forklift.z));
    expect(region[press]).toBe(1);
    expect(pickupStarts(grid, region, exit)).toEqual([grid.index(3, 3) * 4 + DIR.N]);
    const away = region.slice();
    away[press] = 0;
    expect(pickupStarts(grid, away, exit)).toEqual([]);
    // Back where it came from it never goes: not onto the input (it would ride back), not into the end exit.
    const again = lift(parked, exit);
    expect(validDrop(grid, again, exit, input, blue)).toBe(false);
    expect(validDrop(grid, again, exit, exit, blue)).toBe(false);
    expect(validDrop(grid, again, exit, from, blue)).toBe(true);
  });

  it('the exact search uses the button: 3 moves (azul ● parks at B, menta ▲ home, azul ● back and home); without it, 5', () => {
    const result = minMoves(BUTTON);
    expect(result).toMatchObject({ lower: 3, upper: 3, exact: true });
    const plan = result.plan!;
    expect(plan.map((m) => [m.from === exit, m.drop === exit])).toEqual([
      [false, true],
      [false, false],
      [true, false],
    ]);
    const bare = structuredClone(BUTTON);
    delete bare.conveyors![0].button;
    expect(minMoves(validateLevel(bare, 'sin botón'))).toMatchObject({ lower: 5, upper: 5, exact: true });
  });

  it('the bound is admissible and consistent on every state the model can reach (an exhaustive search): it never overshoots the true fewest moves left, and no move lowers it by more than one', () => {
    const total = BUTTON.boxes.length;
    const h = movesLowerBounds(grid, stacksOf(grid, BUTTON), total);
    // Every state the model can reach (stacks + the forklift's region) and every move between them.
    const keyOf = (stacks: Stacks, region: Uint8Array) => `${stacks.join('|')}#${region.indexOf(1)}`;
    const start = stacksOf(grid, BUTTON);
    const startRegion = reachableFrom(grid, occupancyOf(grid, start), grid.index(BUTTON.forklift.x, BUTTON.forklift.z));
    const nodes: { stacks: Stacks; region: Uint8Array; to: number[] }[] = [{ stacks: start, region: startRegion, to: [] }];
    const index = new Map<string, number>([[keyOf(start, startRegion), 0]]);
    let viaButton = 0;
    for (let n = 0; n < nodes.length; n++) {
      const s = nodes[n];
      const occupancy = occupancyOf(grid, s.stacks);
      for (let from = 0; from < grid.posCount; from++) {
        if (!canLift(grid, s.stacks, from)) continue;
        const lifted = lift(s.stacks, from);
        const box = s.stacks[from].slice(-1);
        if (from < grid.cellCount) occupancy[from] = lifted[from].length > 0 ? 0 : -1;
        for (const [drop, cells] of carrySearch(grid, occupancy, lifted, pickupStarts(grid, s.region, from)).drops) {
          if (!validDrop(grid, lifted, from, drop, box)) continue;
          if (from === exit) viaButton++;
          const after = lifted.slice();
          after[drop] += box;
          const occ = occupancyOf(grid, after);
          for (const cell of new Set(cells)) {
            const region = reachableFrom(grid, occ, cell);
            const key = keyOf(after, region);
            let m = index.get(key);
            if (m === undefined) {
              m = nodes.length;
              index.set(key, m);
              nodes.push({ stacks: after, region, to: [] });
            }
            s.to.push(m);
          }
        }
        if (from < grid.cellCount) occupancy[from] = s.stacks[from].length > 0 ? 0 : -1;
      }
    }
    // The true fewest moves left from each state: breadth first back from the finished ones.
    const left = new Array<number>(nodes.length).fill(Infinity);
    const from: number[][] = nodes.map(() => []);
    nodes.forEach((s, n) => s.to.forEach((m) => from[m].push(n)));
    const queue = nodes.flatMap((s, n) => (misplacedCount(grid, s.stacks, total) === 0 ? [n] : []));
    for (const n of queue) left[n] = 0;
    for (let q = 0; q < queue.length; q++) for (const p of from[queue[q]]) if (left[p] === Infinity) (left[p] = left[queue[q]] + 1), queue.push(p);
    expect(left[0]).toBe(3);
    const overshoot = nodes.filter((s, n) => left[n] < Infinity && h(s.stacks) > left[n]);
    expect(overshoot.map((s) => s.stacks.join('|'))).toEqual([]);
    const jumps: string[] = [];
    nodes.forEach((s, n) => s.to.forEach((m) => h(s.stacks) - h(nodes[m].stacks) > 1 && jumps.push(`${n} → ${m}`)));
    expect(jumps).toEqual([]);
    // The button's moves are among them, and every reachable state can still be finished (no dead end).
    expect(viaButton).toBeGreaterThan(0);
    expect(left.every((d) => d < Infinity)).toBe(true);
    expect(nodes.length).toBeGreaterThan(100);
  });
});

describe('metrics and report with a conveyor belt', () => {
  it('cinta counts the belts (and their cells, end exits with a cue, buttons); a level without one has none', () => {
    const m = levelMetrics(FIXTURE, { skipMoves: true });
    expect(m.belts).toEqual({ belts: 1, cells: 2, floor: 2, exits: 1, cued: 1, buttons: 0 });
    expect(levelMetrics(BUTTON, { skipMoves: true }).belts).toEqual({ belts: 1, cells: 1, floor: 1, exits: 1, cued: 0, buttons: 1 });
    expect(m.sortings).toBe(1);
    // blue ● and blue ■ both fit «azul»: two boxes with more than one destination, one trap (■ on «azul»).
    expect(m.ambiguous).toBeGreaterThanOrEqual(1);
    expect(checkLevelTargets(FIXTURE, parseTargets('cinta=1, cintas>=1, repartos=1')).map((c) => c.ok)).toEqual([true, true, true]);
    const none = parseLevel(`# 5 · Sin cinta\nid: sin-cinta\n\n  012\n0 ...\n1 a1^\n2 ...\n\n1 = zona azul\na = caja azul\n`).level;
    expect(levelMetrics(none, { skipMoves: true }).belts).toEqual({ belts: 0, cells: 0, floor: 0, exits: 0, cued: 0, buttons: 0 });
  });

  it('the report names the belt in the metrics, the plan and the summary', () => {
    const source = { file: 'x.level', format: 'level' as const, level: FIXTURE, targets: [], notes: [] };
    const report = levelsReport([source], [FIXTURE.id], { deadEndStates: 5 });
    for (const part of ['cinta        1 (2 casillas de suelo; 1 salida final con pista)', 'caja azul ● (1,3) → cinta A (3,3) → final B (3,0)'])
      expect(report).toContain(part);
    expect(report).not.toContain('botón');
    expect(levelsReport([source], [], { deadEndStates: 5 })).toMatch(/cinta 1 \(2 casillas de suelo; 1 salida final con pista\)/);
  });

  it('and its button (H2): counted with the belt, the box it parks at B and the move that brings it back by the button', () => {
    const source = { file: 'x.level', format: 'level' as const, level: BUTTON, targets: [], notes: [] };
    const report = levelsReport([source], [BUTTON.id], { deadEndStates: 5 });
    for (const part of [
      'cinta        1 (1 casilla de suelo; 1 salida final, 0 con pista; 1 botón)',
      'su botón devuelve a la entrada la última mal puesta (0 movimientos)',
      '1. caja azul ● (1,5) → cinta A (3,2) → final B (aparcar: vuelve con el botón) (3,0)',
      '3. caja azul ● (3,0), final B, botón o (4,2) de vuelta a A (3,2) → zona 1 (1,0)',
    ])
      expect(report).toContain(part);
    expect(levelsReport([source], [], { deadEndStates: 5 })).toMatch(/cinta 1 \(1 casilla de suelo; 1 salida final, 0 con pista; 1 botón\)/);
  });
});
