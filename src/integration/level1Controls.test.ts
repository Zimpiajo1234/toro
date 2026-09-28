/**
 * Integration check (levels × controls × camera): the first level is a straight run that a single held key
 * drives from start to finish, with the keyboard mapping and camera yaw the game ships with. If
 * `controls.keyboardMapping` or `camera.yawDeg` changes, level 1 must still pass (re-lay it if not).
 */
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { degToRad } from '../core/math';
import { forwardOf, type Vec2 } from '../core/types';
import { LEVELS } from '../data/levels';
import { mapToWorld, parseMoveMapping } from '../game/cameraInput';
import { GameState } from '../logic/GameState';

const SINGLE_KEYS: readonly [string, number, number][] = [
  ['W', 0, 1],
  ['S', 0, -1],
  ['A', -1, 0],
  ['D', 1, 0],
];

describe('level 1 controls', () => {
  const [first] = LEVELS;
  const mapping = parseMoveMapping(GAME_CONFIG.controls.keyboardMapping, 'vehicle');

  it('a single key drives the forklift straight along its run, at the default camera', () => {
    if (mapping === 'vehicle') {
      // Holding W alone (full throttle, no steering) reaches the box, then — carrying it — the zone.
      const state = new GameState(first);
      const snap = state.getSnapshot();
      const heading = snap.forklift.heading;
      const hold = { move: { x: 0, z: 0 }, drive: { throttle: 1, steer: 0 }, actionPressed: false };
      let frames = 0;
      while (!snap.hint.targetBoxId && frames++ < 600) state.update(1 / 60, hold);
      expect(snap.hint.targetBoxId).not.toBeNull();
      state.update(1 / 60, { ...hold, actionPressed: true });
      expect(snap.forklift.carrying).not.toBeNull();
      frames = 0;
      while (!snap.hint.dropZoneId && frames++ < 900) state.update(1 / 60, hold);
      expect(snap.hint.dropZoneId).not.toBeNull();
      expect(snap.forklift.heading).toBeCloseTo(heading, 6);
      return;
    }
    const yaw = degToRad(GAME_CONFIG.camera.yawDeg);
    const f = forwardOf(degToRad(first.forklift.heading));
    const out: Vec2 = { x: 0, z: 0 };
    const matching = SINGLE_KEYS.filter(([, x, y]) => {
      mapToWorld(x, y, yaw, mapping, out);
      return Math.abs(out.x - f.x) < 1e-6 && Math.abs(out.z - f.z) < 1e-6;
    }).map(([key]) => key);
    expect(matching).toHaveLength(1);
  });
});
