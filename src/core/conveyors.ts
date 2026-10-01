/**
 * Conveyor belts (docs/CONVEYOR.md), the shared geometry: a level's belts (`level.conveyors`), each a straight run of
 * belt cells from its input (a storage unit of skin `beltIn`) to its end exit (one of skin `beltOut`), both units of the
 * shared storage model (docs/STORAGE.md), and its button (H2: `LevelConveyor.button`, a cell of its own: since H2b a pad
 * on the floor). Validation, logic, the level solver and the render all read a belt through these. Pure.
 */
import type { CellPos, LevelConveyor, LevelData, LevelStorage } from './types';
import { storageOf } from './storage';

/**
 * The level a floor belt («suelo») runs at (docs/CONVEYOR.md, H1b): a table whose top is the floor of a rack's
 * level-1 slot, so a box set down on its input with the forks at level 1 (F, as at a rack) rides level into its end
 * exit. Its cells carry it as their `height`; its input and end exit stand there (their units' `baseLevel`).
 */
export const FLOOR_BELT_LEVEL = 1;

/** A level's belts (none → an empty list), in the order of their inputs. */
export function conveyorsOf(level: Pick<LevelData, 'conveyors'>): readonly LevelConveyor[] {
  return level.conveyors ?? [];
}

/** The level has at least one conveyor belt. */
export function hasConveyors(level: Pick<LevelData, 'conveyors'>): boolean {
  return (level.conveyors?.length ?? 0) > 0;
}

/** A belt's input and end exit units (level.storage), or null when one of them is missing (validateLevel refuses it). */
export function beltUnitsOf(
  level: Pick<LevelData, 'storage'>,
  conveyor: Pick<LevelConveyor, 'input' | 'output'>,
): { input: LevelStorage; output: LevelStorage } | null {
  const units = storageOf(level);
  const input = units.find((unit) => unit.id === conveyor.input);
  const output = units.find((unit) => unit.id === conveyor.output);
  return input && output ? { input, output } : null;
}

/**
 * The levels a belt's input and end exit stand at: the height of the belt cell next to each (validateLevel gives their
 * units that `baseLevel`). A floor belt: both on its table, FLOOR_BELT_LEVEL.
 */
export function beltEndLevels(conveyor: Pick<LevelConveyor, 'cells'>): { input: number; output: number } {
  const cells = conveyor.cells;
  return { input: cells[0]?.height ?? FLOOR_BELT_LEVEL, output: cells[cells.length - 1]?.height ?? FLOOR_BELT_LEVEL };
}

/**
 * The cells a box rides through on belt `conveyor`, in order: its input's cell, every belt cell, its end exit's cell.
 * Empty when a unit is missing.
 */
export function beltPathOf(level: Pick<LevelData, 'storage'>, conveyor: LevelConveyor): CellPos[] {
  const units = beltUnitsOf(level, conveyor);
  if (!units) return [];
  return [{ x: units.input.x, z: units.input.z }, ...conveyor.cells.map((c) => ({ x: c.x, z: c.z })), { x: units.output.x, z: units.output.z }];
}

/** Index (in conveyorsOf) of the belt whose input or end exit is unit `unitId`, or -1. */
export function conveyorOfUnit(level: Pick<LevelData, 'conveyors'>, unitId: string): number {
  return conveyorsOf(level).findIndex((c) => c.input === unitId || c.output === unitId);
}

/**
 * Some belt of the level has a button (docs/CONVEYOR.md H2): the action also presses (the control hint says so, and
 * the snapshot's hint names the button the forklift stands on).
 */
export function hasBeltButtons(level: Pick<LevelData, 'conveyors'>): boolean {
  return conveyorsOf(level).some((c) => c.button !== undefined);
}

/**
 * The cells the forklift drives onto a belt's button from (docs/CONVEYOR.md H2b: a pad on the floor, pressed standing
 * on it): its four neighbours (east, south, west, north) for which `free` holds (a floor cell of the map with no static
 * obstacle: validateLevel asks for one at least).
 */
export function buttonEntriesOf(button: CellPos, free: (x: number, z: number) => boolean): CellPos[] {
  const out: CellPos[] = [];
  for (const [dx, dz] of BUTTON_SIDES) if (free(button.x + dx, button.z + dz)) out.push({ x: button.x + dx, z: button.z + dz });
  return out;
}

/** A button's four sides, in grid direction order (east, south, west, north). */
const BUTTON_SIDES = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
] as const;
