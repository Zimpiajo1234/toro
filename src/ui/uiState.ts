import { createStore, type Store } from '../core/store';

/** 'unsupported': no WebGL 2 (or the app shell caught a crash): one calm card, nothing else. */
export type Screen = 'loading' | 'title' | 'playing' | 'complete' | 'unsupported';

export interface LevelResult {
  timeMs: number;
  bestMs: number;
  isNewBest: boolean;
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
  result: LevelResult | null;
  muted: boolean;
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
   * The level on screen has storage racks: the control hint (always on screen while playing) adds its fork row,
   * F / V, the wheel and pad X / B (docs/RACKS.md).
   */
  racks: boolean;
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
  toggleTimer(): void;
  /** Title: turn "Modo prueba" on / off (never changes the real unlock progress). */
  toggleTestMode(): void;
  /**
   * Title, "Modo prueba" only: play the «Benchmark» special level. Nothing is saved (no best time, no unlock, no
   * "Continuar" target); "Repetir" reloads it and its card leads back to the title.
   */
  startBenchmark(): void;
  /**
   * The overlay's reserved bands changed (HUD pills at the top, control hint at the bottom; ui/reservedAreas.ts,
   * measured on change): the camera frames the level clear of them. All zero on the title.
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
  result: null,
  muted: false,
  restartHold: 0,
  levels: [],
  canContinue: false,
  testMode: false,
  benchmark: false,
  racks: false,
};

export function createUIStore(): Store<UIState> {
  return createStore<UIState>({ ...initialUIState });
}
