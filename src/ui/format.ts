/**
 * Time (and move minimum) formatting for the UI. Values are floored (a time is never shown as more than was played).
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

/** A level's move minimum as the HUD and the card print it: "mín. 10", or "mín. ≥ 10" when only a lower bound is known. */
export function formatMinimum(min: { moves: number; exact: boolean }): string {
  return min.exact ? `mín. ${min.moves}` : `mín. ≥ ${min.moves}`;
}

/**
 * A finished count that reached the minimum: no plan the solver knows is shorter. Fewer counts too (the solver's
 * carrying model is conservative, so the game may allow a shorter plan), and so does reaching a lower bound (proven
 * optimal then).
 */
export function reachedMinimum(moves: number, min: { moves: number; exact: boolean } | null): boolean {
  return min !== null && moves <= min.moves;
}

/** Tooltip of the "Modo prueba" switch and HUD tag: what it opens and how to jump levels while playing. */
export const TEST_MODE_TIP = 'Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente';

/** Tooltip of the title's "Benchmark" button and of the HUD's "sin récord" tag. */
export const BENCHMARK_TIP = 'Nivel de prueba con todo el juego de estanterías · sin récord: no guarda tiempos ni desbloquea niveles';
