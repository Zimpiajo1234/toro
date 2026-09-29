/**
 * Time formatting for the UI. Values are floored (a time is never shown as more than was played).
 * Minutes are not padded and keep growing past 59 ("75:02"): a relaxed session never needs hours.
 */

/** Guards against float noise from summed frame deltas (4299.9999… ms must read as 4.3 s). */
const EPSILON = 1e-6;

function safeMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

function minutesSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** HUD clock: "m:ss". */
export function formatClock(ms: number): string {
  return minutesSeconds(Math.floor(safeMs(ms) / 1000 + EPSILON));
}

/** Completion card: "m:ss.d" (tenths, floored). */
export function formatPrecise(ms: number): string {
  const tenths = Math.floor(safeMs(ms) / 100 + EPSILON);
  return `${minutesSeconds(Math.floor(tenths / 10))}.${tenths % 10}`;
}

/** Tooltip of the "Modo prueba" switch and HUD tag: what it opens and how to jump levels while playing. */
export const TEST_MODE_TIP = 'Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente';
