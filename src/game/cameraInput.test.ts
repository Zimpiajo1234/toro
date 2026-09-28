import { describe, expect, it } from 'vitest';
import { inputToDrive, inputToWorld, mapToWorld, parseMoveMapping, screenToWorld } from './cameraInput';
import { degToRad } from '../core/math';

const out = { x: 0, z: 0 };

describe('screenToWorld', () => {
  it('maps "up the screen" away from the default camera (which sits toward +x,+z)', () => {
    screenToWorld(0, 1, degToRad(45), out);
    expect(out.x).toBeCloseTo(-Math.SQRT1_2);
    expect(out.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('maps "right" to the camera right vector (cos ψ, -sin ψ)', () => {
    screenToWorld(1, 0, degToRad(45), out);
    expect(out.x).toBeCloseTo(Math.SQRT1_2);
    expect(out.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('follows camera rotation: at yaw 0 (camera on +z) up is -z and right is +x', () => {
    screenToWorld(0, 1, 0, out);
    expect(out.x).toBeCloseTo(0);
    expect(out.z).toBeCloseTo(-1);
    screenToWorld(1, 0, 0, out);
    expect(out.x).toBeCloseTo(1);
    expect(out.z).toBeCloseTo(0);
  });

  it('keeps analog magnitude and clamps the length to 1', () => {
    screenToWorld(0.3, 0, degToRad(135), out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(0.3);
    screenToWorld(1, 1, degToRad(10), out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
  });

  it('returns zero for no input and writes into the given object', () => {
    const target = { x: 5, z: 5 };
    expect(screenToWorld(0, 0, 1.2, target)).toBe(target);
    expect(Math.abs(target.x)).toBe(0);
    expect(Math.abs(target.z)).toBe(0);
  });
});

describe('mapToWorld (grid keyboard mapping)', () => {
  const v = { x: 0, z: 0 };
  /** Maps one key press and returns the world vector (copied). */
  const key = (moveX: number, moveY: number, yawDeg: number) => {
    mapToWorld(moveX, moveY, degToRad(yawDeg), 'grid', v);
    return { x: v.x, z: v.z };
  };
  /** Exactly on a world axis: the minor component is +0 and the major one is ±1. */
  const expectAxis = (w: { x: number; z: number }, x: -1 | 0 | 1, z: -1 | 0 | 1) => {
    if (x === 0) expect(Object.is(w.x, 0)).toBe(true);
    else expect(w.x).toBeCloseTo(x, 12);
    if (z === 0) expect(Object.is(w.z, 0)).toBe(true);
    else expect(w.z).toBeCloseTo(z, 12);
  };

  it('at yaw 45°: W → -Z, D → +X, S → +Z, A → -X, exactly on the floor axes', () => {
    expectAxis(key(0, 1, 45), 0, -1);
    expectAxis(key(1, 0, 45), 1, 0);
    expectAxis(key(0, -1, 45), 0, 1);
    expectAxis(key(-1, 0, 45), -1, 0);
  });

  it('at yaw -45°: W → +X, D → +Z, S → -X, A → -Z', () => {
    expectAxis(key(0, 1, -45), 1, 0);
    expectAxis(key(1, 0, -45), 0, 1);
    expectAxis(key(0, -1, -45), -1, 0);
    expectAxis(key(-1, 0, -45), 0, -1);
  });

  it('at yaw 135°: W → -X, D → -Z, S → +X, A → +Z', () => {
    expectAxis(key(0, 1, 135), -1, 0);
    expectAxis(key(1, 0, 135), 0, -1);
    expectAxis(key(0, -1, 135), 1, 0);
    expectAxis(key(-1, 0, 135), 0, 1);
  });

  it('keeps each key on screen as its screen direction turned 45° clockwise, whatever the yaw', () => {
    for (const yaw of [45, -45, 135]) {
      // W drives "screen up-right" = (right + up) / √2 in screen terms.
      const w = key(0, 1, yaw);
      const s = { x: 0, z: 0 };
      screenToWorld(Math.SQRT1_2, Math.SQRT1_2, degToRad(yaw), s);
      expect(w.x).toBeCloseTo(s.x, 12);
      expect(w.z).toBeCloseTo(s.z, 12);
    }
  });

  it('combines two keys into the diagonal between their axes (W + D = screen right)', () => {
    const wd = key(Math.SQRT1_2, Math.SQRT1_2, 45);
    const right = { x: 0, z: 0 };
    screenToWorld(1, 0, degToRad(45), right);
    expect(wd.x).toBeCloseTo(right.x);
    expect(wd.z).toBeCloseTo(right.z);
    expect(Math.hypot(wd.x, wd.z)).toBeCloseTo(1);
    expect(Math.abs(wd.x)).toBeGreaterThan(0.5); // a real diagonal on the floor, not snapped to an axis
    expect(Math.abs(wd.z)).toBeGreaterThan(0.5);
  });

  it('snaps away floating-point drift of a yaw reached through many rotations', () => {
    const yaw = degToRad(45) + 5 * (Math.PI / 2) - 2 * Math.PI; // ≡ 135° with rounding error
    mapToWorld(0, 1, yaw, 'grid', v);
    expect(Object.is(v.z, 0)).toBe(true);
    expect(v.x).toBeCloseTo(-1, 12);
  });

  it('follows an eased camera turn smoothly instead of jumping between axes', () => {
    const mid = key(0, 1, 90); // halfway between 45° (W → -Z) and 135° (W → -X)
    expect(mid.x).toBeCloseTo(-Math.SQRT1_2);
    expect(mid.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it("'screen' is the plain camera-relative mapping", () => {
    mapToWorld(0, 1, degToRad(45), 'screen', v);
    expect(v.x).toBeCloseTo(-Math.SQRT1_2);
    expect(v.z).toBeCloseTo(-Math.SQRT1_2);
  });
});

describe('inputToWorld', () => {
  const mappings = { keyboard: 'grid', stick: 'screen' } as const;
  const v = { x: 0, z: 0 };

  it('maps keys on the grid and the stick continuously relative to the screen', () => {
    inputToWorld({ keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, degToRad(45), mappings, v);
    expect(Object.is(v.x, 0)).toBe(true);
    expect(v.z).toBeCloseTo(-1);
    inputToWorld({ keyX: 0, keyY: 0, stickX: 0, stickY: 1 }, degToRad(45), mappings, v);
    expect(v.x).toBeCloseTo(-Math.SQRT1_2); // stick up = straight up the screen
    expect(v.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it('sums both sources and clamps the length to 1', () => {
    inputToWorld({ keyX: 0, keyY: 1, stickX: 0, stickY: 1 }, degToRad(45), mappings, v);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(1);
    inputToWorld({ keyX: 0, keyY: 0, stickX: 0.3, stickY: 0 }, degToRad(45), mappings, v);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(0.3); // analog magnitude kept
  });

  it("with 'screen' / 'screen' matches the plain mapping of the summed input", () => {
    const screenOnly = { keyboard: 'screen', stick: 'screen' } as const;
    const expected = { x: 0, z: 0 };
    screenToWorld(0.4, 0.5, 1.1, expected);
    inputToWorld({ keyX: 0.4, keyY: 0, stickX: 0, stickY: 0.5 }, 1.1, screenOnly, v);
    expect(v.x).toBeCloseTo(expected.x);
    expect(v.z).toBeCloseTo(expected.z);
  });
});

describe('parseMoveMapping', () => {
  it('accepts the three mappings and falls back on anything else', () => {
    expect(parseMoveMapping('vehicle', 'grid')).toBe('vehicle');
    expect(parseMoveMapping('grid', 'screen')).toBe('grid');
    expect(parseMoveMapping('screen', 'grid')).toBe('screen');
    expect(parseMoveMapping('diagonal', 'grid')).toBe('grid');
    expect(parseMoveMapping(undefined, 'screen')).toBe('screen');
  });
});

describe('inputToDrive (vehicle mapping)', () => {
  const drive = { throttle: 0, steer: 0 };
  const src = (keyX: number, keyY: number, stickX = 0, stickY = 0) => ({ keyX, keyY, stickX, stickY });

  it('W / S give full throttle, A / D full steer (A = +1 left), also when combined', () => {
    const m = { keyboard: 'vehicle', stick: 'screen' } as const;
    expect(inputToDrive(src(0, 1), m, drive)).toEqual({ throttle: 1, steer: 0 });
    expect(inputToDrive(src(-Math.SQRT1_2, Math.SQRT1_2), m, drive)).toEqual({ throttle: 1, steer: 1 });
    expect(inputToDrive(src(Math.SQRT1_2, -Math.SQRT1_2), m, drive)).toEqual({ throttle: -1, steer: -1 });
  });

  it('keys mapped as vehicle produce no floor direction; a screen-mapped stick still does', () => {
    const m = { keyboard: 'vehicle', stick: 'screen' } as const;
    inputToWorld(src(0, 1, 0, 0), degToRad(45), m, out);
    expect(out).toEqual({ x: 0, z: 0 });
    inputToWorld(src(0, 0, 0, 1), degToRad(45), m, out);
    expect(Math.hypot(out.x, out.z)).toBeCloseTo(1);
    expect(inputToDrive(src(0, 0, 0, 1), m, drive)).toEqual({ throttle: 0, steer: 0 });
  });

  it('an analog stick mapped as vehicle is proportional and clamped with the keys', () => {
    const m = { keyboard: 'vehicle', stick: 'vehicle' } as const;
    expect(inputToDrive(src(0, 0, 0.5, 0.25), m, drive)).toEqual({ throttle: 0.25, steer: -0.5 });
    expect(inputToDrive(src(0, 1, 0, 1), m, drive).throttle).toBe(1);
  });
});
