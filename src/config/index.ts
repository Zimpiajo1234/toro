import raw from './gameConfig.json';

/** Tunables loaded from gameConfig.json. Edit the JSON, not the code. */
export type GameConfig = typeof raw;

export const GAME_CONFIG: GameConfig = raw;
