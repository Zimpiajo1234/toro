/** A 2D screen-space axis pair (stick / keys). x = right, y = up the screen. */
export interface Axis2 {
  x: number;
  y: number;
}

/** Scale `v` down in place so its length is at most 1 (directions are kept). */
export function clampToUnit(v: Axis2): Axis2 {
  const lenSq = v.x * v.x + v.y * v.y;
  if (lenSq > 1) {
    const inv = 1 / Math.sqrt(lenSq);
    v.x *= inv;
    v.y *= inv;
  }
  return v;
}

/**
 * Radial deadzone with rescaling: anything shorter than `deadzone` is zero, and the remaining range is
 * stretched back to 0‥1 so movement starts smoothly right at the edge of the deadzone. Writes into `out`.
 */
export function applyRadialDeadzone(x: number, y: number, deadzone: number, out: Axis2): Axis2 {
  const len = Math.hypot(x, y);
  // `!(len > deadzone)` also rejects NaN from misbehaving drivers.
  if (!(len > deadzone)) {
    out.x = 0;
    out.y = 0;
    return out;
  }
  const k = Math.min(1, (len - deadzone) / (1 - deadzone)) / len;
  out.x = x * k;
  out.y = y * k;
  return out;
}
