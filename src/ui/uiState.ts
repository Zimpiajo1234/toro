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
  /** Transient control hint on the first level(s); hidden after the first successful drop. */
  showHint: boolean;
  /** 0 … 1 while R / pad Back is held to restart a level with work at stake (drawn as a fill on the ↺ pill). */
  restartHold: number;
  levels: LevelSummary[];
  /** A saved game exists (title shows "Continuar"). */
  canContinue: boolean;
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
  showHint: false,
  restartHold: 0,
  levels: [],
  canContinue: false,
};

export function createUIStore(): Store<UIState> {
  return createStore<UIState>({ ...initialUIState });
}
