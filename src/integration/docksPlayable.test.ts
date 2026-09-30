/**
 * Integration check (loading docks × logic × controls, docs/DOCKS.md): the autopilot (./autopilot.ts) plays small truck
 * levels with the real GameState at 60 fps and at Game's worst dt (1/20): the truck loaded through its door, between
 * the door's guard rails, at the automatic fork height (never F / V), a wrong load taken off and backed out with the
 * reverse gear (S), a box loaded on top of a locked one, every truck level lit once and never lifted again.
 */
import { describe, expect, it } from 'vitest';
import { trucksOf } from '../core/docks';
import type { GameEvent } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { autopilot } from './autopilot';

const level = (text: string) => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');
const picks = (events: readonly GameEvent[]) => events.filter((e): e is Picked => e.type === 'boxPicked');

/** docs/DOCKS.md's example: a north dock, menta ▲ loaded on the wrong column at the start. */
const NORTH = level(`
# 1 · Muelle de ejemplo
id: muelle-ejemplo
limit: 2
ventanas: oeste 2-3

  01234567
0 .pTTp...
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
`);

/** A west dock: its first column starts satisfied at the bottom (locked), the level above loads on top of it. */
const WEST = level(`
# 2 · Muelle oeste
id: muelle-oeste
limit: 2

  012345
0 p.....
1 T.....
2 T..a..
3 p.....
4 ...^b.

a = caja menta ▲        b = caja coral ●
T = camión muelle oeste: azul + caja azul ● / ▲ | coral
`);

/** A door 3 cells wide (the most): its last column starts satisfied; a box goes on top of another in the middle one. */
const WIDE = level(`
# 3 · Muelle de tres
id: muelle-tres
limit: 2

  0123456
0 pTTTp..
1 .......
2 .......
3 .a.b.c.
4 ....^..

a = caja azul ●     b = caja coral ◆    c = caja menta ▲
T = camión muelle norte: azul | coral ◆ / ▲ | lavanda + caja lavanda ●
`);

describe('truck levels are playable with the real controls', () => {
  it.each([
    ['muelle-ejemplo, 60 fps', NORTH, 1 / 60],
    ['muelle-ejemplo, 20 fps', NORTH, 1 / 20],
    ['muelle-oeste, 60 fps', WEST, 1 / 60],
    ['muelle-oeste, 20 fps', WEST, 1 / 20],
    ['muelle-tres, 60 fps', WIDE, 1 / 60],
    ['muelle-tres, 20 fps', WIDE, 1 / 20],
  ] as const)('%s: the autopilot finishes it, loading the truck through its door', (_, lvl, dt) => {
    const out = autopilot(lvl, dt);
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.events.filter((e) => e.type === 'levelComplete')).toHaveLength(1);
    // No fork keys at a truck: the height is automatic, as on a floor stack.
    expect(out.controls.forkSteps).toBe(0);
    const truckSlots = trucksOf(lvl).flatMap((t) => t.columns.flatMap((levels, column) => levels.map((_, k) => `${t.id}:${column}:${k}`)));
    const onTruck = drops(out.events).filter((d) => d.truckSlotId !== undefined);
    const correct = onTruck.filter((d) => d.correct);
    const started = lvl.boxes.filter((b) => b.level !== undefined).length;
    // Every truck level lit exactly once (the one that starts satisfied never needs a drop), on top of a locked box too.
    expect(new Set(correct.map((d) => d.truckSlotId)).size).toBe(correct.length);
    expect(correct.length + (lvl === NORTH ? 0 : started)).toBe(truckSlots.length);
    expect(correct.some((d) => d.level === 1)).toBe(true);
    for (const d of correct) {
      expect(d).not.toHaveProperty('wrongTarget');
      expect(d).toMatchObject({ zoneId: null, recipeLength: 1 });
      const after = out.events.slice(out.events.indexOf(d) + 1);
      expect(picks(after).some((p) => p.boxId === d.boxId), d.boxId).toBe(false);
    }
    if (lvl === NORTH) {
      // The wrong load comes off from the front and the rig backs out with it.
      expect(picks(out.events).filter((p) => p.fromTruckSlotId !== undefined)).toMatchObject([{ fromTruckSlotId: 't1:1:0', level: 0, fromZoneId: null }]);
      expect(out.controls.reverseFrames).toBeGreaterThan(0);
    }
    expect(drops(out.events).at(-1)).toMatchObject({ correct: true });
    expect(out.events.some((e) => e.type === 'zoneReleased')).toBe(false);
  });
});
