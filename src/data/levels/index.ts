import type { LevelData } from '../../core/types';
import { validateLevel } from '../validateLevel';

/**
 * Level registry. Every *.json file in this folder is a level; drop a new file to add one.
 * Levels are validated at import time and sorted by `order`.
 */
const modules = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export const LEVELS: readonly LevelData[] = Object.entries(modules)
  .map(([path, raw]) => validateLevel(raw, path))
  .sort((a, b) => a.order - b.order);

export function getLevel(index: number): LevelData {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
}
