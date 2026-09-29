import type { LevelData } from '../../core/types';
import { parseLevel } from '../asciiLevel';
import type { DifficultyTarget } from '../difficulty';
import { validateLevel } from '../validateLevel';

/**
 * Level registry. Every `*.level` file in this folder is a level (ASCII map + legend, docs/LEVELS.md); drop a new
 * file to add one. `*.json` files (the old LevelData format) still load too. Levels are parsed and validated at
 * import time, ids and orders must be unique across both formats, and the play order is ascending `order`.
 * Subfolders are not scanned: `especiales/` holds the special levels (SPECIAL_LEVELS below), never part of LEVELS.
 */
export interface LevelSource {
  /** Path from the project root, e.g. "src/data/levels/level-23.level". */
  readonly file: string;
  readonly format: 'level' | 'json';
  readonly level: LevelData;
  /** `dificultad:` targets (none for JSON levels), checked by the level tests. */
  readonly targets: readonly DifficultyTarget[];
  /** `nota:` lines (none for JSON levels). */
  readonly notes: readonly string[];
  /** The file's text (.level only), for tooling. */
  readonly text?: string;
}

const FOLDER = 'src/data/levels';

/** Parses both formats (keys as given by import.meta.glob: "./name.ext"), checks ids / orders, sorts by order. */
export function loadLevelSources(texts: Readonly<Record<string, string>>, jsons: Readonly<Record<string, unknown>>): LevelSource[] {
  const fileOf = (path: string) => `${FOLDER}/${path.replace(/^\.\//, '')}`;
  const sources: LevelSource[] = [
    ...Object.entries(texts).map(([path, text]): LevelSource => {
      const file = fileOf(path);
      return { file, format: 'level', ...parseLevel(text, file), text };
    }),
    ...Object.entries(jsons).map(([path, raw]): LevelSource => ({
      file: fileOf(path),
      format: 'json',
      level: validateLevel(raw, path),
      targets: [],
      notes: [],
    })),
  ];
  const byId = new Map<string, LevelSource>();
  const byOrder = new Map<number, LevelSource>();
  for (const source of sources) {
    const { id, order } = source.level;
    const sameId = byId.get(id);
    if (sameId) throw new Error(`Nivel repetido: el id «${id}» está en ${sameId.file} y en ${source.file}`);
    const sameOrder = byOrder.get(order);
    if (sameOrder) throw new Error(`Orden repetido: ${order} está en ${sameOrder.file} y en ${source.file}`);
    byId.set(id, source);
    byOrder.set(order, source);
  }
  return sources.sort((a, b) => a.level.order - b.level.order);
}

const texts = import.meta.glob<string>('./*.level', { eager: true, query: '?raw', import: 'default' });
const jsons = import.meta.glob<unknown>('./*.json', { eager: true, import: 'default' });

export const LEVEL_SOURCES: readonly LevelSource[] = loadLevelSources(texts, jsons);

export const LEVELS: readonly LevelData[] = LEVEL_SOURCES.map((s) => s.level);

export function getLevel(index: number): LevelData {
  return LEVELS[Math.max(0, Math.min(LEVELS.length - 1, index))];
}

/**
 * Special levels: `especiales/*.level`, outside the game's progression (the glob above is not recursive, so they never
 * reach LEVELS, saved times, unlocks or «Continuar»). Parsed and validated like the others; their ids and orders never
 * clash with the game's, so tooling can name any level unambiguously. Today only the «Benchmark» of test mode.
 */
export function loadSpecialSources(texts: Readonly<Record<string, string>>, game: readonly LevelSource[]): LevelSource[] {
  const sources = loadLevelSources(texts, {});
  for (const source of sources) {
    const { id, order } = source.level;
    const sameId = game.find((s) => s.level.id === id);
    if (sameId) throw new Error(`Nivel repetido: el id «${id}» está en ${sameId.file} y en ${source.file}`);
    const sameOrder = game.find((s) => s.level.order === order);
    if (sameOrder) throw new Error(`Orden repetido: ${order} está en ${sameOrder.file} y en ${source.file}`);
  }
  return sources;
}

const specialTexts = import.meta.glob<string>('./especiales/*.level', { eager: true, query: '?raw', import: 'default' });

export const SPECIAL_LEVEL_SOURCES: readonly LevelSource[] = loadSpecialSources(specialTexts, LEVEL_SOURCES);

/** Special levels by ascending order (not part of LEVELS). */
export const SPECIAL_LEVELS: readonly LevelData[] = SPECIAL_LEVEL_SOURCES.map((s) => s.level);

/** Id of the «Benchmark» special level (src/data/levels/especiales/benchmark.level), played from test mode. */
export const BENCHMARK_ID = 'benchmark';

/** A special level by id, or undefined. */
export function getSpecialLevel(id: string): LevelData | undefined {
  return SPECIAL_LEVELS.find((level) => level.id === id);
}
