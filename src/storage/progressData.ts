/**
 * Persisted progress format + pure helpers (parse, sanitize, serialize, ranking insert).
 * Everything read from storage is treated as untrusted: invalid fields fall back to defaults.
 */

export const PROGRESS_VERSION = 1;
/** Number of times kept in the local ranking of each level. */
export const RANKING_SIZE = 5;

export interface Settings {
  muted: boolean;
  showTimer: boolean;
  /** The optional move counter (HUD pill + the card's moves), like the timer. Additive field, default shown. */
  showMoves: boolean;
  /** "Modo prueba": every level can be started from the title (unlock progress itself is never changed). */
  testMode: boolean;
  /** The reverse beeper ("tin… tin…" while backing up; B toggles it). Additive field, default on. */
  reverseBeep: boolean;
  /**
   * The optional target hints («pistas»; P toggles them): while a box is carried, the destinations that would take it
   * light up. Additive field, default off (pure deduction; whoever wants the help turns it on).
   */
  targetHints: boolean;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = {
  muted: false,
  showTimer: true,
  showMoves: true,
  testMode: false,
  reverseBeep: true,
  targetHints: false,
};

/**
 * In-memory model. The best time of a level is always `rankings.get(id)[0]`.
 * Levels are identified by id wherever possible: indices shift when a level is inserted mid-sequence.
 * `highestUnlocked` / `lastLevel` are kept as index fallbacks (older saves, ids no longer in the game).
 */
export interface ProgressModel {
  /** Ascending top-N times (ms) per level id. A level with a ranking has been completed. */
  rankings: Map<string, number[]>;
  /**
   * Fewest box moves a level was finished in, per level id (the move counter's record). Never progress on its own:
   * only rankings unlock levels.
   */
  bestMoves: Map<string, number>;
  highestUnlocked: number;
  lastLevel: number;
  /** Id of the level "Continuar" leads to (null in saves written before ids were stored). */
  lastLevelId: string | null;
  settings: Settings;
}

/** JSON shape written under the storage key. */
interface ProgressJson {
  version: typeof PROGRESS_VERSION;
  rankings: Record<string, number[]>;
  /** Additive field (same version, like `lastLevelId`): saves written before the move counter simply lack it. */
  bestMoves: Record<string, number>;
  highestUnlocked: number;
  lastLevel: number;
  /** Additive field (same version): older readers ignore it, older saves simply lack it. */
  lastLevelId: string | null;
  settings: Settings;
}

export function createEmptyProgress(): ProgressModel {
  return {
    rankings: new Map(),
    bestMoves: new Map(),
    highestUnlocked: 0,
    lastLevel: 0,
    lastLevelId: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

/** A usable play time: finite and strictly positive. */
export function isValidTime(ms: unknown): ms is number {
  return typeof ms === 'number' && Number.isFinite(ms) && ms > 0;
}

/** A usable move count: a non-negative integer (box moves, docs/LEVELS.md «movimientos»). */
export function isValidMoves(moves: unknown): moves is number {
  return typeof moves === 'number' && Number.isInteger(moves) && moves >= 0;
}

/** A usable level index: non-negative integer. */
export function isValidIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Keeps only valid times, sorted ascending, capped to RANKING_SIZE. */
export function normalizeRanking(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isValidTime).sort((a, b) => a - b).slice(0, RANKING_SIZE);
}

/**
 * Inserts `ms` into an ascending ranking (ties go after existing equal times).
 * Returns the new ranking and the 1-based rank of the inserted time, or 0 if it did not make the cut
 * (in which case the ranking is returned unchanged).
 */
export function insertTime(ranking: readonly number[], ms: number): { ranking: number[]; rank: number } {
  let i = 0;
  while (i < ranking.length && ranking[i] <= ms) i++;
  if (i >= RANKING_SIZE) return { ranking: ranking.slice(), rank: 0 };
  const next = ranking.slice();
  next.splice(i, 0, ms);
  next.length = Math.min(next.length, RANKING_SIZE);
  return { ranking: next, rank: i + 1 };
}

/** Parses stored JSON. Anything unreadable or from another version yields fresh progress. */
export function parseProgress(json: string | null): ProgressModel {
  const progress = createEmptyProgress();
  if (!json) return progress;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return progress;
  }
  if (!isRecord(raw) || raw.version !== PROGRESS_VERSION) return progress;

  if (isRecord(raw.rankings)) {
    for (const [id, times] of Object.entries(raw.rankings)) {
      const ranking = normalizeRanking(times);
      if (ranking.length > 0) progress.rankings.set(id, ranking);
    }
  }
  // Additive field (same version): saves written before the move counter simply lack it (no records yet).
  if (isRecord(raw.bestMoves)) {
    for (const [id, moves] of Object.entries(raw.bestMoves)) if (isValidMoves(moves)) progress.bestMoves.set(id, moves);
  }
  if (isValidIndex(raw.highestUnlocked)) progress.highestUnlocked = raw.highestUnlocked;
  if (isValidIndex(raw.lastLevel)) progress.lastLevel = raw.lastLevel;
  if (typeof raw.lastLevelId === 'string' && raw.lastLevelId !== '') progress.lastLevelId = raw.lastLevelId;
  if (isRecord(raw.settings)) {
    const { muted, showTimer, showMoves, testMode, reverseBeep, targetHints } = raw.settings;
    if (typeof muted === 'boolean') progress.settings.muted = muted;
    if (typeof showTimer === 'boolean') progress.settings.showTimer = showTimer;
    // Additive field (same version): saves written before the move counter lack it (default shown).
    if (typeof showMoves === 'boolean') progress.settings.showMoves = showMoves;
    // Additive field (same version): saves written before it simply lack it (default off).
    if (typeof testMode === 'boolean') progress.settings.testMode = testMode;
    // Additive field (same version): saves written before the beep toggle lack it (default on).
    if (typeof reverseBeep === 'boolean') progress.settings.reverseBeep = reverseBeep;
    // Additive field (same version): saves written before the hints toggle lack it (default off).
    if (typeof targetHints === 'boolean') progress.settings.targetHints = targetHints;
  }
  return progress;
}

export function serializeProgress(progress: ProgressModel): string {
  const json: ProgressJson = {
    version: PROGRESS_VERSION,
    // fromEntries defines own properties, so unusual ids (e.g. "__proto__") round-trip safely.
    rankings: Object.fromEntries(progress.rankings),
    bestMoves: Object.fromEntries(progress.bestMoves),
    highestUnlocked: progress.highestUnlocked,
    lastLevel: progress.lastLevel,
    lastLevelId: progress.lastLevelId,
    settings: { ...progress.settings },
  };
  return JSON.stringify(json);
}
