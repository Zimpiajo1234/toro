import type { GameConfig } from '../config';

/** Each level the forks climb slows the climb by this fraction (levels 2–3 rise a little slower). */
export const FORK_RISE_SLOWDOWN = 0.25;

/**
 * Fork climb speed (levels / s) toward or from `level` (the higher of the current and target heights): slower the
 * higher the forks go. GameState moves the forks at this rate; the game's servo sound and the dev preview use it too.
 */
export function forkRiseRate(config: GameConfig, level: number): number {
  return config.stack.forkRiseSpeed / (1 + FORK_RISE_SLOWDOWN * Math.max(0, level));
}
