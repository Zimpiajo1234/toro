/**
 * Difficulty targets a .level file may declare (`dificultad: extra>=2, bloqueos>=1`, docs/LEVELS.md). The level tests
 * measure every level that declares some (src/data/levels/metrics.ts) and fail when a target is not proven.
 * Pure: names are Spanish, like the rest of the level format.
 */

/** Metric names, as written after `dificultad:` (definitions: docs/LEVELS.md, «Métricas»). */
export const DIFFICULTY_METRICS = [
  'movimientos',
  'extra',
  'obligadas',
  'bloqueos',
  'estrechas',
  'libre',
  'ambiguas',
  'trampas',
  'repartos',
  'callejones',
  'cajas',
  'zonas',
  'huecos',
  'camion',
  'cinta',
] as const;
export type DifficultyMetric = (typeof DIFFICULTY_METRICS)[number];

/** Other spellings accepted (accent- and case-insensitive), mapped to the canonical name. */
const ALIASES: Readonly<Record<string, DifficultyMetric>> = {
  min: 'movimientos',
  minimo: 'movimientos',
  movimiento: 'movimientos',
  mov: 'movimientos',
  obligada: 'obligadas',
  bloqueo: 'bloqueos',
  estrecha: 'estrechas',
  ambigua: 'ambiguas',
  trampa: 'trampas',
  reparto: 'repartos',
  callejon: 'callejones',
  caja: 'cajas',
  zona: 'zonas',
  hueco: 'huecos',
  camiones: 'camion',
  cintas: 'cinta',
};

export const DIFFICULTY_OPS = ['>=', '<=', '=', '>', '<'] as const;
export type DifficultyOp = (typeof DIFFICULTY_OPS)[number];

const OP_SPELLINGS: Readonly<Record<string, DifficultyOp>> = {
  '>=': '>=',
  '=>': '>=',
  '≥': '>=',
  '<=': '<=',
  '=<': '<=',
  '≤': '<=',
  '==': '=',
  '=': '=',
  '>': '>',
  '<': '<',
};

export interface DifficultyTarget {
  metric: DifficultyMetric;
  op: DifficultyOp;
  value: number;
}

/**
 * A measured value as a proven range: exact when `lower === upper`; `upper` is Infinity when only a lower bound is
 * known (e.g. a minimum of moves the search could not finish). NaN = the metric does not apply to the level.
 */
export interface MetricRange {
  lower: number;
  upper: number;
}

/** Thrown by parseTargets; `offset` is the 0-based index of the bad item in the parsed text. */
export class DifficultySyntaxError extends Error {
  readonly offset: number;
  constructor(offset: number, message: string) {
    super(message);
    this.name = 'DifficultySyntaxError';
    this.offset = offset;
  }
}

const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Canonical metric name for a spelling, or null. */
export function difficultyMetric(word: string): DifficultyMetric | null {
  const w = strip(word);
  if ((DIFFICULTY_METRICS as readonly string[]).includes(w)) return w as DifficultyMetric;
  return Object.hasOwn(ALIASES, w) ? ALIASES[w] : null;
}

/** Parses `extra>=2, bloqueos>=1` (items separated by commas; spaces optional). */
export function parseTargets(text: string): DifficultyTarget[] {
  const targets: DifficultyTarget[] = [];
  let offset = 0;
  for (const item of text.split(',')) {
    const lead = item.length - item.trimStart().length;
    const at = offset + lead;
    const m = /^([A-Za-zÀ-ÿ]+)\s*(>=|=>|<=|=<|==|≥|≤|=|>|<)\s*(-?\d+(?:\.\d+)?)$/.exec(item.trim());
    if (!m) {
      throw new DifficultySyntaxError(
        at,
        item.trim() === ''
          ? 'objetivo vacío: separa los objetivos con comas, p. ej. «extra>=2, bloqueos>=1»'
          : `objetivo mal escrito «${item.trim()}»: usa métrica, comparación y número, p. ej. «extra>=2»`,
      );
    }
    const metric = difficultyMetric(m[1]);
    if (!metric) throw new DifficultySyntaxError(at, `métrica desconocida «${m[1]}»; usa ${DIFFICULTY_METRICS.join(', ')}`);
    targets.push({ metric, op: OP_SPELLINGS[m[2]], value: Number(m[3]) });
    offset += item.length + 1;
  }
  return targets;
}

export function formatTarget(target: DifficultyTarget): string {
  return `${target.metric}${target.op}${target.value}`;
}

export function formatTargets(targets: readonly DifficultyTarget[]): string {
  return targets.map(formatTarget).join(', ');
}

/** The target is proven by the measured range (a lower bound proves `>=` / `>`, an upper bound `<=` / `<`). */
export function targetHolds(target: DifficultyTarget, range: MetricRange): boolean {
  switch (target.op) {
    case '>=':
      return range.lower >= target.value;
    case '>':
      return range.lower > target.value;
    case '<=':
      return range.upper <= target.value;
    case '<':
      return range.upper < target.value;
    case '=':
      return range.lower === target.value && range.upper === target.value;
  }
}

/** The measured range already rules the target out (e.g. a plan shorter than `movimientos>=` asks for). */
export function targetRefuted(target: DifficultyTarget, range: MetricRange): boolean {
  switch (target.op) {
    case '>=':
      return range.upper < target.value;
    case '>':
      return range.upper <= target.value;
    case '<=':
      return range.lower > target.value;
    case '<':
      return range.lower >= target.value;
    case '=':
      return range.lower > target.value || range.upper < target.value;
  }
}

/** Human-readable measured range: "5", "≥ 12 (≤ 14)", "≥ 12", "—". */
export function formatRange(range: MetricRange): string {
  if (Number.isNaN(range.lower)) return '—';
  if (range.lower === range.upper) return String(range.lower);
  return Number.isFinite(range.upper) ? `≥ ${range.lower} (≤ ${range.upper})` : `≥ ${range.lower}`;
}
