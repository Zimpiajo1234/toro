import { createStore, type Store } from '../core/store';

/** 'unsupported': no WebGL 2 (or the app shell caught a crash): one calm card, nothing else. */
export type Screen = 'loading' | 'title' | 'playing' | 'complete' | 'unsupported';

/**
 * Fewest box moves the solver needs for a level (precomputed, src/data/levels/minimums.ts). `exact: false` = the
 * search was cut and `moves` is only a proven lower bound (shown as "mín. ≥ N", or not at all: gameConfig
 * `moves.showLowerBound`).
 */
export interface MoveMinimum {
  moves: number;
  exact: boolean;
}

export interface LevelResult {
  timeMs: number;
  bestMs: number;
  isNewBest: boolean;
  /** Box moves of this attempt (a pick and a drop somewhere else = 1, the solver's «movimientos»). */
  moves: number;
  /** Fewest moves on record for the level after this attempt; null when nothing is kept (Benchmark, "Modo prueba"). */
  bestMoves: number | null;
  /** Fewer moves than a previous record (a first clear has nothing to beat). */
  isNewBestMoves: boolean;
  /** The level's minimum as the HUD showed it (null: none known, or a lower bound the config hides). */
  minMoves: MoveMinimum | null;
  /** Positive message, e.g. "Almacén organizado". */
  message: string;
  /** True when the level just finished was the last one. */
  isLast: boolean;
  /** The level was open only through "Modo prueba": its time is shown but not kept (no best time). */
  practice: boolean;
}

export interface LevelSummary {
  index: number;
  id: string;
  name: string;
  bestMs: number | null;
  unlocked: boolean;
}

export interface UIState {
  screen: Screen;
  levelIndex: number;
  levelCount: number;
  levelName: string;
  /** Elapsed play time of the current attempt (ms). Updated by Game at ~10 Hz. */
  elapsedMs: number;
  timerStarted: boolean;
  /** The timer is optional: the player can hide it (persisted). */
  showTimer: boolean;
  /** Box moves of the current attempt (GameSnapshot.moves; 0 on load / restart, kept on resume). */
  moves: number;
  /** The move counter is optional too: the player can hide it (persisted, N key or a click on its pill). */
  showMoves: boolean;
  /** The level's move minimum as the HUD shows it (null: none known, or a lower bound the config hides). */
  minMoves: MoveMinimum | null;
  /**
   * Boxes the level on screen still needs put in their place (logic/objectives `objectivesLeft`): the HUD's «Quedan N»,
   * «Todo en su sitio» at 0 (the level complete). Published by Game on load and when a pick or a drop changes it.
   */
  objectivesLeft: number;
  /** The objectives counter is optional too: the player can hide it (persisted, O key or a click on its pill). */
  showObjectives: boolean;
  /** The level on screen is finished (from its last drop through the card): the move pill may show its accent. */
  finished: boolean;
  result: LevelResult | null;
  muted: boolean;
  /** The reverse beeper ("tin… tin…" while backing up) is on (persisted; B toggles it, on the title and in a level). */
  reverseBeep: boolean;
  /**
   * The optional target hints are on (persisted, off by default; P toggles them, on the title and in a level): while a
   * box is carried, the destinations that would take it light up.
   */
  targetHints: boolean;
  /**
   * 0 … 1 while R / pad Back (or, in "Modo prueba", a level-jump key) is held with work at stake (drawn as a fill
   * on the ↺ pill).
   */
  restartHold: number;
  levels: LevelSummary[];
  /** A saved game exists (title shows "Continuar"). */
  canContinue: boolean;
  /** "Modo prueba" (persisted): every level dot is open and [ / ] jump between levels while playing. */
  testMode: boolean;
  /**
   * The level on screen is the «Benchmark» (test mode's special level, outside LEVELS): HUD and card read
   * "Benchmark" instead of "Nivel N", and nothing is saved. `levelIndex` keeps naming the game level "Continuar" knows.
   */
  benchmark: boolean;
  /**
   * The level on screen has storage (docs/STORAGE.md: core/storage hasStorage; racks, trucks: the forks go by the keys
   * at every unit, rule 9): the control hint (always on screen while playing) adds its fork row, F / V, the wheel and
   * pad X / B.
   */
  storage: boolean;
}

/** Screen bands covered by overlay pieces that stay over the scene while playing, in CSS px from each edge. */
export interface ScreenInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Commands the UI can issue. Implemented by game/Game.ts. */
export interface GameActions {
  /** From the title screen: start (or continue) at a level index. */
  start(levelIndex?: number): void;
  /** Restart the current level from its initial layout. */
  restart(): void;
  /** After completion: go to the next level (or back to title after the last one). */
  nextLevel(): void;
  /** Back to the title screen. */
  toTitle(): void;
  toggleMute(): void;
  /** Turn the reverse beeper on / off (persisted; independent of mute). */
  toggleReverseBeep(): void;
  /** Turn the optional target hints on / off (persisted; off by default). */
  toggleHints(): void;
  toggleTimer(): void;
  /** Show / hide the optional move counter (persisted, like the timer). */
  toggleMoves(): void;
  /** Show / hide the optional objectives counter (persisted, like the timer). */
  toggleObjectives(): void;
  /** Title: turn "Modo prueba" on / off (never changes the real unlock progress). */
  toggleTestMode(): void;
  /**
   * Title, "Modo prueba" only: play the «Benchmark» special level. Nothing is saved (no best time, no unlock, no
   * "Continuar" target); "Repetir" reloads it and its card leads back to the title.
   */
  startBenchmark(): void;
  /**
   * The overlay's reserved bands (HUD pills at the top, control hint at the bottom; ui/reservedAreas.ts), reported as
   * a level starts and on a viewport resize, never mid-level: the camera frames the level clear of them. All zero on
   * the title.
   */
  setViewInsets?(insets: ScreenInsets): void;
}

export const initialUIState: UIState = {
  screen: 'loading',
  levelIndex: 0,
  levelCount: 0,
  levelName: '',
  elapsedMs: 0,
  timerStarted: false,
  showTimer: true,
  moves: 0,
  showMoves: true,
  minMoves: null,
  objectivesLeft: 0,
  showObjectives: true,
  finished: false,
  result: null,
  muted: false,
  reverseBeep: true,
  targetHints: false,
  restartHold: 0,
  levels: [],
  canContinue: false,
  testMode: false,
  benchmark: false,
  storage: false,
};

export function createUIStore(): Store<UIState> {
  return createStore<UIState>({ ...initialUIState });
}
