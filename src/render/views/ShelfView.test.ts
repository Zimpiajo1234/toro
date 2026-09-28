import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { hidesBehind } from './ShelfView';

const PITCH = (38 * Math.PI) / 180;

/** Direction toward an orthographic camera at yaw ψ (camera sits toward (sin ψ, cos ψ)). */
function backAt(yawDeg: number): Vector3 {
  const y = (yawDeg * Math.PI) / 180;
  return new Vector3(Math.cos(PITCH) * Math.sin(y), Math.sin(PITCH), Math.cos(PITCH) * Math.cos(y));
}

/** A 2×1-cell shelf, 1.5 units tall, spanning x ∈ [-1, 1], z ∈ [-1, 0]. */
const SHELF = new Box3(new Vector3(-1, 0, -1), new Vector3(1, 1.5, 0));

function actorAt(x: number, z: number, half = 0.3, height = 0.8): [Vector3, Vector3] {
  return [new Vector3(x - half, 0, z - half), new Vector3(x + half, height, z + half)];
}

describe('hidesBehind', () => {
  it('detects an actor tucked behind the shelf, seen from the default 45° yaw', () => {
    expect(hidesBehind(SHELF, ...actorAt(0, -1.6), backAt(45))).toBe(true);
    expect(hidesBehind(SHELF, ...actorAt(-1.5, -0.5), backAt(45))).toBe(true);
  });

  it('ignores actors in front of the shelf or beside it', () => {
    expect(hidesBehind(SHELF, ...actorAt(0, 0.8), backAt(45))).toBe(false); // camera side
    expect(hidesBehind(SHELF, ...actorAt(1.6, -0.5), backAt(45))).toBe(false); // camera side (x)
    expect(hidesBehind(SHELF, ...actorAt(3, -3.5), backAt(45))).toBe(false); // off to the side on screen
  });

  it('only hides what is close enough behind: a tall shelf shadows about two cells', () => {
    expect(hidesBehind(SHELF, ...actorAt(0, -2), backAt(0))).toBe(true);
    expect(hidesBehind(SHELF, ...actorAt(0, -4), backAt(0))).toBe(false);
  });

  it('follows the camera: turning around puts the same actor in front', () => {
    const [min, max] = actorAt(0, -1.6);
    expect(hidesBehind(SHELF, min, max, backAt(45))).toBe(true);
    expect(hidesBehind(SHELF, min, max, backAt(225))).toBe(false);
  });
});
