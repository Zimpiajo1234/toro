import { describe, expect, it } from 'vitest';
import { STORAGE_SKINS } from '../core/storage';
import { STORAGE_ACCESS, STORAGE_ACCESS_ORDER } from './storageAccess';

describe('STORAGE_ACCESS (docs/STORAGE.md «Acceso»)', () => {
  it('one row per access, a rack first: the numbers of the table', () => {
    expect(STORAGE_ACCESS_ORDER).toEqual(['front', 'door', 'belt']);
    // Every skin's access has its row.
    for (const row of Object.values(STORAGE_SKINS)) expect(STORAGE_ACCESS[row.access]).toBeDefined();
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
    const { front, door, belt } = STORAGE_ACCESS;
    // A belt's end exit (docs/CONVEYOR.md) is never engaged: only its belt fills it.
    expect([front.engages, door.engages, belt.engages]).toEqual([true, true, false]);
    expect([deg(front.faceAngle), front.faceLateral, front.faceNear, front.faceFar]).toEqual([30, 0.35, 0.8, 1]);
    expect([deg(front.holdAngle), front.holdLateral, front.holdNear]).toEqual([50, 0.75, 1.3]);
    expect([front.bodyInLine, front.actsHeld, front.dropReach, front.doorway]).toEqual([false, false, -0.55, false]);
    // A rack acts anywhere it is faced (its pick reach is the facing margin itself).
    expect(front.pickReach).toBe(-front.faceNear);
    expect([deg(door.faceAngle), door.faceLateral, door.faceNear, door.faceFar]).toEqual([30, 0.5, 0.8, 1]);
    expect([deg(door.holdAngle), door.holdLateral, door.holdNear]).toEqual([45, 0.6, 0.8]);
    expect([door.bodyInLine, door.actsHeld, door.pickReach, door.dropReach, door.doorway]).toEqual([true, true, 0.3, 0.3, true]);
  });

  it('the forks go by the keys at every access (docs/STORAGE.md rule 9): no row keeps an automatic mode', () => {
    for (const row of Object.values(STORAGE_ACCESS)) expect(row).not.toHaveProperty('autoForks');
  });
});
