/**
 * Conveyor belts (docs/CONVEYOR.md), the shared geometry: a level's belts (`level.conveyors`), each a straight run of
 * belt cells from its input (a storage unit of skin `beltIn`) to its end exit (one of skin `beltOut`), both units of the
 * shared storage model (docs/STORAGE.md). Validation, logic, the level solver and the render all read a belt through
 * these. Pure.
 */
import type { CellPos, LevelConveyor, LevelData, LevelStorage } from './types';
import { storageOf } from './storage';

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
