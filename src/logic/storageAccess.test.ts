import { describe, expect, it } from 'vitest';
import { STORAGE_SKINS } from '../core/storage';
import type { LevelStorage, StorageAccess, StorageSkin } from '../core/types';
import { STORAGE_ACCESS, STORAGE_ACCESS_ORDER, hasKeyedForks } from './storageAccess';

describe('STORAGE_ACCESS (docs/STORAGE.md «Acceso»)', () => {
  it('one row per access, a rack first: the numbers of the table', () => {
    expect(STORAGE_ACCESS_ORDER).toEqual(['front', 'door']);
    // Every skin's access has its row.
    for (const row of Object.values(STORAGE_SKINS)) expect(STORAGE_ACCESS[row.access]).toBeDefined();
    const deg = (rad: number) => Math.round((rad * 180) / Math.PI);
    const { front, door } = STORAGE_ACCESS;
    expect([deg(front.faceAngle), front.faceLateral, front.faceNear, front.faceFar]).toEqual([30, 0.35, 0.8, 1]);
    expect([deg(front.holdAngle), front.holdLateral, front.holdNear]).toEqual([50, 0.75, 1.3]);
    expect([front.bodyInLine, front.actsHeld, front.dropReach, front.doorway]).toEqual([false, false, -0.55, false]);
    // A rack acts anywhere it is faced (its pick reach is the facing margin itself).
    expect(front.pickReach).toBe(-front.faceNear);
    expect([deg(door.faceAngle), door.faceLateral, door.faceNear, door.faceFar]).toEqual([30, 0.5, 0.8, 1]);
    expect([deg(door.holdAngle), door.holdLateral, door.holdNear]).toEqual([45, 0.6, 0.8]);
    expect([door.bodyInLine, door.actsHeld, door.pickReach, door.dropReach, door.doorway]).toEqual([true, true, 0.3, 0.3, true]);
  });

  it('TEMPORARY until phase 6: the forks go by themselves only through a door (the truck), keyed at a rack', () => {
    expect(STORAGE_ACCESS.front.autoForks).toBe(false);
    expect(STORAGE_ACCESS.door.autoForks).toBe(true);
  });

  it('hasKeyedForks: a level with a unit whose forks go by the keys (today: a rack; the fork row, the clicks)', () => {
    const unit = (id: string, skin: StorageSkin, access: StorageAccess): LevelStorage => ({ id, skin, x: 1, z: 0, w: 1, access, columns: [[{ color: 'blue' }]] });
    const rack = unit('r1', 'rack', { kind: 'front', facing: 'south' });
    const truck = unit('t1', 'truck', { kind: 'door', wall: 'north' });
    expect(hasKeyedForks({})).toBe(false);
    expect(hasKeyedForks({ storage: [rack] })).toBe(true);
    expect(hasKeyedForks({ storage: [truck, { ...truck, id: 't2', x: 3 }] })).toBe(false);
    expect(hasKeyedForks({ storage: [rack, truck] })).toBe(true);
  });
});
