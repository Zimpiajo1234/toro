import { describe, expect, it } from 'vitest';
import { storageSlotsOf } from '../core/storage';
import { parseLevel } from '../data/asciiLevel';
import { LevelGrid } from './grid';
import text from '../data/levels/pruebas/tres-camiones.level?raw';

/*
 * The storage of a level in LevelGrid (docs/STORAGE.md «Contratos por capa», logic): one list of storage columns for every unit,
 * inside the map (a rack) or beyond a wall (a truck), in storage order; the boxes of each by its support. The
 * three-truck fixture has both: R and S (racks of 2 and 3 levels), T (two columns), C and U (one each); every truck
 * column holds 2 levels (`limit: 2`, docs/STORAGE.md rule 7: T's second and C's written with one, a «libre» one on top).
 */
const { level } = parseLevel(text, 'src/data/levels/pruebas/tres-camiones.level');
const index = (id: string) => level.boxes.findIndex((b) => b.id === id);

describe('LevelGrid: one list of storage columns', () => {
  it('every unit, column by column in storage order, with its support, access and where its cell lies', () => {
    const grid = new LevelGrid(level);
    expect(grid.columns.map((c) => [`${c.unitId}:${c.column}`, c.skin, c.support, c.access, c.inside, c.levels, c.firstSlot])).toEqual([
      ['r1:0', 'rack', 'shelves', 'front', true, 2, 0],
      ['r2:0', 'rack', 'shelves', 'front', true, 3, 2],
      ['t1:0', 'truck', 'stack', 'door', false, 2, 5],
      ['t1:1', 'truck', 'stack', 'door', false, 2, 7],
      ['t2:0', 'truck', 'stack', 'door', false, 2, 9],
      ['t3:0', 'truck', 'stack', 'door', false, 2, 11],
    ]);
    // The flat slot list is core/storage storageSlotsOf's (the snapshot's storageSlots).
    expect(grid.slotCount).toBe(storageSlotsOf(level).length);
    grid.columns.forEach((c, i) => {
      for (let k = 0; k < c.levels; k++) expect(storageSlotsOf(level)[grid.slotOf(i, k)].id).toBe(`${c.unitId}:${c.column}:${k}`);
      expect(grid.slotOf(i, c.levels)).toBe(-1);
      // Found by its cell, inside the map or beyond the wall; a rack's cell is solid, a door cell plain floor.
      expect(grid.columnAt(c.cell.x, c.cell.z)).toBe(i);
      expect(grid.isBlocked(c.cell.x, c.cell.z)).toBe(c.inside);
      if (!c.inside) expect(grid.isBlocked(c.front.x, c.front.z)).toBe(false);
    });
    expect(grid.columnAt(-1, 0)).toBe(-1);
    expect(grid.columnAt(3, 3)).toBe(-1);
  });

  it('keeps the boxes by support: one per shelf apart; a stack like a floor stack on its cell, its levels as capacity', () => {
    const grid = new LevelGrid(level);
    const [r1, , t1] = [0, 1, 2];
    // R: the lavender ▲ parked on the free top shelf; nothing on its cell as a stack.
    expect(grid.slotBox(grid.slotOf(r1, 1))).toBe(index('b8'));
    expect(grid.slotBox(grid.slotOf(r1, 0))).toBe(-1);
    const rCell = grid.columns[r1].cell;
    expect([grid.height(rCell.x, rCell.z), grid.boxAt(rCell.x, rCell.z), grid.capacity(rCell.x, rCell.z)]).toEqual([0, -1, level.stackLimit]);
    expect(grid.isStackColumn(rCell.x, rCell.z)).toBe(false);
    // C and U: a box loaded at the bottom, a stack on the bed cell beyond the wall.
    const c = grid.columns[4].cell;
    const u = grid.columns[5].cell;
    expect([grid.stackAt(c.x, c.z), grid.stackAt(u.x, u.z)]).toEqual([[index('b9')], [index('b10')]]);
    expect(grid.slotBox(grid.slotOf(5, 0))).toBe(index('b10'));
    expect(grid.slotBox(grid.slotOf(5, 1))).toBe(-1);
    expect([grid.capacity(u.x, u.z), grid.capacity(c.x, c.z), grid.isStackColumn(u.x, u.z)]).toEqual([2, 2, true]);
    // A shelf takes a box on any free level; a stack only on its next level up, while it has room (C's «libre» level
    // over its wrong load too).
    expect([grid.canStore(r1, 0), grid.canStore(r1, 1)]).toEqual([true, false]);
    expect([grid.canStore(5, 0), grid.canStore(5, 1), grid.canStore(4, 0), grid.canStore(4, 1)]).toEqual([false, true, false, true]);
    expect([grid.canStore(t1, 0), grid.canStore(t1, 1)]).toEqual([true, false]);
    // A pick lifts a shelf's box at its level; in a stack only the top box, at its own level (never one under another).
    expect([grid.liftableAt(r1, 1), grid.liftableAt(r1, 0), grid.liftableAt(4, 0), grid.liftableAt(4, 1), grid.liftableAt(t1, 0)]).toEqual([
      index('b8'),
      -1,
      index('b9'),
      -1,
      -1,
    ]);
    // Stored and taken out the same way whatever the support: a shelf at its level, a stack on top.
    expect(grid.putBox(r1, 0, 0)).toBe(0);
    expect(grid.slotBox(grid.slotOf(r1, 0))).toBe(0);
    expect(grid.putBox(t1, 0, 1)).toBe(0);
    expect(grid.putBox(t1, 1, 2)).toBe(1);
    const t = grid.columns[t1].cell;
    expect([grid.height(t.x, t.z), grid.baseAt(t.x, t.z), grid.boxAt(t.x, t.z), grid.slotBox(grid.slotOf(t1, 1))]).toEqual([2, 1, 2, 2]);
    expect(grid.canStore(t1, 1)).toBe(false);
    expect([grid.liftableAt(t1, 0), grid.liftableAt(t1, 1)]).toEqual([-1, 2]);
    grid.takeBox(t1, 1);
    grid.takeBox(r1, 0);
    expect([grid.height(t.x, t.z), grid.slotBox(grid.slotOf(r1, 0)), grid.canStore(t1, 1)]).toEqual([1, -1, true]);
    // A storage column never takes a floor drop.
    expect(grid.canTakeBox(rCell.x, rCell.z)).toBe(false);
    expect(grid.canTakeBox(t.x, t.z)).toBe(false);
  });
});
