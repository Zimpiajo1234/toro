import { describe, expect, it } from 'vitest';
import { parseLevel } from '../asciiLevel';
import { parseTargets } from '../difficulty';
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
  movesLowerBounds,
  occupancyOf,
  pickupStarts,
  reachableFrom,
  stacksOf,
  validDrop,
  type Stacks,
} from './solver';
import fixtureText from './pruebas/cinta.level?raw';

/*
 * The grid model with conveyor belts (docs/CONVEYOR.md «Solver»): a belt's cells, its input and its end exit are solid;
 * the input is a storage position (one level-0 slot) loaded by one step on from behind its front cell, like a rack
 * slot; the end exit is a storage position no pose ever works, fed by its input (`feeds` / `fedBy`): a box set down on
 * an empty input while the end exit has room lands in the end exit in that one move. H1 leaves one move out: only the
 * end exit's destined box is sent down a belt (a wrong one could only come back with H3's button). With the end exit
 * full, a box set down on the input stays there, and can be lifted again; a box is never lifted from an end exit.
 */

const FIXTURE = parseLevel(fixtureText, 'src/data/levels/pruebas/cinta.level').level;
const DIR = { E: 0, S: 1, W: 2, N: 3 } as const;

describe('grid model with conveyor belts', () => {
  const grid = new LevelGrid(FIXTURE);
  const input = grid.positionOfSlot('e1:0:0');
  const exit = grid.positionOfSlot('s1:0:0');
  const blue = boxCode({ color: 'blue', symbol: 'circle' });
  const blueSquare = boxCode({ color: 'blue', symbol: 'square' });

  it('the input and the end exit are storage positions after the cells, linked; the belt and both ends are solid', () => {
    expect([grid.kind[input], grid.kind[exit]]).toEqual([POS_SHELF, POS_SHELF]);
    expect([grid.capacity[input], grid.capacity[exit]]).toEqual([1, 1]);
    expect(input).toBeGreaterThanOrEqual(grid.cellCount);
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

  it('the exact search bound stays consistent with a belt (one move lowers it by at most one), Benchmark included', () => {
    for (const lvl of [FIXTURE, getSpecialLevel(BENCHMARK_ID)!]) {
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

describe('metrics and report with a conveyor belt', () => {
  it('cinta counts the belts (and their cells, end exits with a cue); a level without one has none', () => {
    const m = levelMetrics(FIXTURE, { skipMoves: true });
    expect(m.belts).toEqual({ belts: 1, cells: 2, floor: 2, exits: 1, cued: 1 });
    expect(m.sortings).toBe(1);
    // blue ● and blue ■ both fit «azul»: two boxes with more than one destination, one trap (■ on «azul»).
    expect(m.ambiguous).toBeGreaterThanOrEqual(1);
    expect(checkLevelTargets(FIXTURE, parseTargets('cinta=1, cintas>=1, repartos=1')).map((c) => c.ok)).toEqual([true, true, true]);
    const none = parseLevel(`# 5 · Sin cinta\nid: sin-cinta\n\n  012\n0 ...\n1 a1^\n2 ...\n\n1 = zona azul\na = caja azul\n`).level;
    expect(levelMetrics(none, { skipMoves: true }).belts).toEqual({ belts: 0, cells: 0, floor: 0, exits: 0, cued: 0 });
  });

  it('the report names the belt in the metrics, the plan and the summary', () => {
    const source = { file: 'x.level', format: 'level' as const, level: FIXTURE, targets: [], notes: [] };
    const report = levelsReport([source], [FIXTURE.id], { deadEndStates: 5 });
    for (const part of ['cinta        1 (2 casillas de suelo; 1 salida final con pista)', 'caja azul ● (1,3) → cinta A (3,3) → final B (3,0)'])
      expect(report).toContain(part);
    expect(levelsReport([source], [], { deadEndStates: 5 })).toMatch(/cinta 1 \(2 casillas de suelo; 1 salida final con pista\)/);
  });
});
