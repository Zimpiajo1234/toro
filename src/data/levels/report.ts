/**
 * Text report behind `npm run levels` (scripts/levels.mjs): every level's map and legend plus a metrics table, or one
 * level in detail (its canonical text, metrics with their meaning, difficulty targets, a shortest plan and the narrow
 * cells). Pure: the script loads the registry and prints what this returns. Metric definitions: docs/LEVELS.md.
 */
import type { StorageSkin } from '../../core/types';
import { usesSymbols } from '../../core/sorting';
import { COLOR_NAMES, SYMBOL_GLYPHS, drawLevel, renderLevel, renderMapLines } from '../asciiLevel';
import { formatRange, formatTarget } from '../difficulty';
import type { LevelSource } from './index';
import { DEAD_END_STATES, checkTargets, levelMetrics, type LevelMetrics, type TargetCheck } from './metrics';
import { LevelGrid, POS_SHELF, POS_STACK, boxOfCode, lift, stacksOf, type Move } from './solver';

export interface ReportOptions {
  /** Add a milliseconds column (off for deterministic output, e.g. in tests). */
  timings?: boolean;
  /** Work budget of the exact move search (see solver.minMoves `maxWork`). */
  maxWork?: number;
  /** States the dead-end check expands per level (see solver.deadEnds `maxStates`; default DEAD_END_STATES). */
  deadEndStates?: number;
}

/** Levels named on the command line: an order number ("3"), a position ("#3"), an id or a file name. */
export function selectSources(sources: readonly LevelSource[], args: readonly string[]): LevelSource[] {
  return args.map((arg) => {
    const base = (s: LevelSource) => s.file.replace(/^.*\//, '');
    const found =
      (/^-?\d+(?:\.\d+)?$/.test(arg) ? sources.find((s) => s.level.order === Number(arg)) : undefined) ??
      (/^#\d+$/.test(arg) ? sources[Number(arg.slice(1)) - 1] : undefined) ??
      sources.find((s) => s.level.id === arg || base(s) === arg || base(s).replace(/\.[^.]+$/, '') === arg);
    if (!found) throw new Error(`No encuentro el nivel «${arg}»: usa su número de orden (3), su posición (#3), su id o su archivo`);
    return found;
  });
}

export function levelsReport(sources: readonly LevelSource[], args: readonly string[] = [], options: ReportOptions = {}): string {
  const selected = args.length > 0 ? selectSources(sources, args) : sources;
  const measured = selected.map((source) => {
    const started = performance.now();
    const metrics = levelMetrics(source.level, {
      ...(options.maxWork === undefined ? {} : { maxWork: options.maxWork }),
      deadEndStates: options.deadEndStates ?? DEAD_END_STATES,
    });
    return { source, metrics, ms: performance.now() - started, checks: checkTargets(metrics, source.targets) };
  });
  const out: string[] = [];
  if (args.length === 0) {
    // Special levels (src/data/levels/especiales/, outside the game's progression) are counted apart.
    const special = sources.filter((s) => s.file.includes('/especiales/')).length;
    const count = `${sources.length - special} niveles${special === 0 ? '' : ` + ${special} ${special === 1 ? 'especial' : 'especiales'}`}`;
    out.push(`Toro · ${count} · métricas en el modelo conservador de carga (docs/LEVELS.md)`, '');
    for (const m of measured) out.push(...summaryBlock(m.source, m.metrics), '');
  } else {
    for (const m of measured) out.push(...detailBlock(m.source, m.metrics, m.checks));
  }
  out.push(...table(measured, options.timings ?? false));
  return `${out.join('\n')}\n`;
}

const pct = (n: number) => `${n}%`;

function movesText(m: LevelMetrics): string {
  if (m.moves.unsolvable) return 'sin solución';
  return m.moves.exact ? String(m.moves.lower) : `≥${m.moves.lower}`;
}

function extraText(m: LevelMetrics): string {
  if (m.moves.unsolvable) return '—';
  return m.moves.exact ? String(m.extra.lower) : `≥${m.extra.lower}`;
}

/**
 * Dead ends found: exact once every reachable state was explored; otherwise «≥ n», or «0 (n)» = none among the n
 * states explored. «+k?» = k more the check could not decide.
 */
function deadEndText(m: LevelMetrics): string {
  const d = m.deadEnds;
  if (!d) return '—';
  const undecided = d.unknown > 0 ? `+${d.unknown}?` : '';
  if (d.complete) return `${d.found}${undecided}`;
  return d.found > 0 ? `≥${d.found}${undecided}` : `0${undecided} (${d.explored})`;
}

function deadEndDetail(m: LevelMetrics): string {
  const d = m.deadEnds;
  if (!d) return '—';
  const undecided = d.unknown > 0 ? ` + ${d.unknown} sin decidir` : '';
  const undo = d.deepChecks > 0 ? `, ${d.deepChecks} sin vuelta atrás directa` : '';
  return `${d.found}${undecided} (${d.explored} estados, ${d.complete ? 'todos' : 'parcial'}${undo})`;
}

/** «6 (4 con pista, 2 libres)». */
function slotsText(m: LevelMetrics): string {
  return `${m.slots.total} (${m.slots.cued} con pista, ${m.slots.free} ${m.slots.free === 1 ? 'libre' : 'libres'})`;
}

/** «5 (2 columnas, 1 camión; 1 cargado al empezar)»: truck levels (docs/DOCKS.md). */
function trucksText(m: LevelMetrics): string {
  const t = m.trucks;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const loaded = t.loaded > 0 ? `; ${plural(t.loaded, 'cargado', 'cargados')} al empezar` : '';
  return `${t.levels} (${plural(t.columns, 'columna', 'columnas')}, ${plural(t.trucks, 'camión', 'camiones')}${loaded})`;
}

function heading(source: LevelSource): string {
  const { level } = source;
  const canonical = source.text === undefined || source.text === renderLevel(level, source);
  return `== ${level.order} · ${level.name} · ${level.id} · ${source.file}${canonical ? '' : ' (no canónico: npm run levels:fmt)'} ==`;
}

function summaryBlock(source: LevelSource, m: LevelMetrics): string[] {
  const { grid, legend } = drawLevel(source.level);
  const parts = [
    `movimientos ${movesText(m)}`,
    `extra ${extraText(m)}`,
    `bloqueos ${m.blockers.count}`,
    `estrechas ${m.narrow.count}`,
    `libre ${pct(m.freeFloorPct)}`,
    `ambiguas ${m.ambiguous}`,
  ];
  if (m.sortings !== null) parts.push(`trampas ${m.traps}`, `repartos ${m.sortings}`);
  if (m.slots.total > 0) parts.push(`huecos ${slotsText(m)}`);
  if (m.trucks.levels > 0) parts.push(`camión ${trucksText(m)}`);
  parts.push(`callejones ${deadEndText(m)}`);
  return [heading(source), ...renderMapLines(grid), ...(legend.length > 0 ? ['', ...legend] : []), parts.join(' · ')];
}

function detailBlock(source: LevelSource, m: LevelMetrics, checks: TargetCheck[]): string[] {
  const { level } = source;
  const { grid } = drawLevel(level);
  const lines = [heading(source), '', ...renderLevel(level, source).trimEnd().split('\n'), ''];
  const moves = m.moves.unsolvable
    ? 'sin solución en el modelo'
    : m.moves.exact
      ? `${m.moves.lower} (exacto${m.moves.states > 0 ? `, ${m.moves.states} estados` : ''})`
      : `≥ ${m.moves.lower}${m.moves.upper === null ? '' : `, el mejor plan encontrado hace ${m.moves.upper}`} (presupuesto agotado tras ${m.moves.states} estados: sube --estados)`;
  const rows: [string, string, string][] = [
    ['movimientos', moves, 'mínimo de movimientos de caja (coger + dejar) para terminar'],
    ['obligadas', String(m.mustMove), 'cajas que tienen que moverse al menos una vez'],
    ['extra', m.moves.unsolvable ? '—' : formatRange(m.extra), 'movimientos de más: aparcar, reordenar una pila, deshacer una trampa'],
    [
      'bloqueos',
      String(m.blockers.count),
      `cajas que hay que apartar antes de usar otra caja o zona${blockerIds(m)}`,
    ],
    ['estrechas', `${m.narrow.count} de ${m.narrow.floor}`, 'casillas de suelo donde no cabe un giro de 90° con carga'],
    ['libre', pct(m.freeFloorPct), 'casillas sin estantería, planta ni caja al empezar'],
    ['ambiguas', String(m.ambiguous), 'cajas con más de un destino posible (zona o piso de pila)'],
    ['trampas', String(m.traps), 'colocaciones aceptadas que dejan otra caja sin zona'],
    ['repartos', m.sortings === null ? '—' : String(m.sortings), 'repartos completos distintos (niveles con símbolos, estanterías o camiones)'],
    ['callejones', deadEndDetail(m), 'estados desde los que ya no se puede terminar (desde un plan mínimo; --callejones N)'],
  ];
  if (m.slots.total > 0) rows.push(['huecos', slotsText(m), 'huecos de estantería almacenable (docs/RACKS.md)']);
  if (m.trucks.levels > 0) rows.push(['camion', trucksText(m), 'niveles de camión en los muelles de carga, cada uno un objetivo (docs/DOCKS.md)']);
  const w0 = Math.max(...rows.map((r) => r[0].length));
  const w1 = Math.max(...rows.map((r) => r[1].length));
  lines.push('Métricas', ...rows.map(([name, value, what]) => `  ${name.padEnd(w0)}  ${value.padEnd(w1)}  ${what}`), '');
  lines.push(
    'Objetivos (dificultad:)',
    ...(checks.length === 0
      ? ['  ninguno']
      : checks.map((c) => `  ${c.ok ? 'OK ' : 'NO '} ${formatTarget(c.target)}   medido ${formatRange(c.range)}`)),
    '',
  );
  if (m.moves.plan) {
    lines.push(
      `Plan de ${m.moves.plan.length} movimientos${m.moves.exact ? ' (uno de los más cortos)' : ' (el mejor encontrado)'}:`,
      ...planLines(level, grid, m.moves.plan),
      '',
    );
  }
  if (m.narrow.count > 0) {
    const overlay = grid.map((row) => [...row]);
    for (const cell of m.narrow.cells) {
      const x = cell % level.size.width;
      const z = Math.floor(cell / level.size.width);
      if (overlay[z][x] === '.') overlay[z][x] = '!';
    }
    lines.push('Casillas estrechas (! = no cabe un giro con carga):', ...renderMapLines(overlay), '');
  }
  return lines;
}

function blockerIds(m: LevelMetrics): string {
  const parts: string[] = [];
  if (m.blockers.covering.length > 0) parts.push(`tapan: ${m.blockers.covering.join(', ')}`);
  if (m.blockers.gatekeepers.length > 0) parts.push(`cierran paso: ${m.blockers.gatekeepers.join(', ')}`);
  return parts.length > 0 ? ` (${parts.join('; ')})` : '';
}

/**
 * How the plan names a storage unit (docs/STORAGE.md), per skin: its word, and the word for one of its levels. With its
 * legend letter (the map character on its cell, or on its front cell when the cell lies beyond a wall) and by its
 * support: a shelf is a place of its own («hueco 2 de R»); a stack column names its unit («camión T»), then the height
 * the box leaves or lands at («nivel 2»), like a floor stack's «piso».
 */
const PLAN_WORDS: { readonly [S in StorageSkin]: { readonly unit: string; readonly level: string } } = {
  rack: { unit: 'estantería', level: 'hueco' },
  truck: { unit: 'camión', level: 'nivel' },
};

/**
 * "1. caja azul ▲ (7,4) → zona 4 (7,1)" per move, replayed on the model's stacks; storage by PLAN_WORDS («hueco 2 de
 * R» for a rack slot, «camión T (x,z), nivel 2» for a truck bed column, named by its door cell: the one its map
 * character stands on).
 */
function planLines(level: LevelSource['level'], grid: string[][], plan: readonly Move[]): string[] {
  const model = new LevelGrid(level);
  const symbols = usesSymbols(level);
  let stacks = stacksOf(model, level);
  const width = String(plan.length).length;
  /** A position's cell on the map: a floor cell itself; a storage column's own, or its front cell beyond a wall. */
  const mapCell = (pos: number) => {
    const cell = model.cellOfPos(pos);
    return model.inMap(cell.x, cell.z) ? cell : model.cellOf(model.accessOf(pos));
  };
  const onShelf = (pos: number) => model.kind[pos] === POS_SHELF;
  const onStack = (pos: number) => model.kind[pos] === POS_STACK;
  const wordsOf = (pos: number) => PLAN_WORDS[model.columnOfPos(pos)!.ref.unit.skin];
  /** A storage position by its skin's words and its unit's letter: a shelf «hueco 2 de R», a stack column «camión T». */
  const storageName = (pos: number) => {
    const cell = mapCell(pos);
    const letter = grid[cell.z][cell.x];
    return onShelf(pos) ? `${wordsOf(pos).level} ${model.levelAt(pos) + 1} de ${letter}` : `${wordsOf(pos).unit} ${letter}`;
  };
  /** A level of a stack column (0 = bottom): «, nivel 2». */
  const stackLevel = (pos: number, level: number) => `, ${wordsOf(pos).level} ${level + 1}`;
  return plan.map((move, i) => {
    const code = stacks[move.from].slice(-1);
    const box = boxOfCode(code);
    const lifted = lift(stacks, move.from);
    const height = onShelf(move.drop) ? 0 : lifted[move.drop].length;
    const at = mapCell(move.drop);
    const fromCell = mapCell(move.from);
    const from = model.isStorage(move.from)
      ? storageName(move.from) + (onStack(move.from) ? stackLevel(move.from, stacks[move.from].length - 1) : '')
      : null;
    // A storage level with no cue takes any box: parking (a shelf's steps are null there).
    const steps = model.steps[move.drop];
    const target = model.isStorage(move.drop)
      ? storageName(move.drop) + (steps && height < steps.length ? '' : ' (libre: aparcar)')
      : steps
        ? `zona ${grid[at.z][at.x]}`
        : height > 0
          ? 'encima de otra caja'
          : 'suelo (aparcar)';
    lifted[move.drop] += code;
    stacks = lifted;
    const what = `caja ${COLOR_NAMES[box.color]}${symbols ? ` ${SYMBOL_GLYPHS[box.symbol]}` : ''}`;
    const source = `(${fromCell.x},${fromCell.z})${from ? `, ${from}` : ''}`;
    const floor = onStack(move.drop) ? stackLevel(move.drop, height) : height > 0 ? `, piso ${height + 1}` : '';
    return `  ${String(i + 1).padStart(width)}. ${what} ${source} → ${target} (${at.x},${at.z})${floor}`;
  });
}

function table(measured: { source: LevelSource; metrics: LevelMetrics; ms: number; checks: TargetCheck[] }[], timings: boolean): string[] {
  const head = ['#', 'id', 'tamaño', 'cajas', 'zonas', 'limit', 'mov.', 'extra', 'oblig.', 'bloq.', 'estr.', 'libre', 'ambig.', 'tramp.', 'repart.', 'callej.', 'huecos', 'camión', 'dific.'];
  if (timings) head.push('ms');
  const rows = measured.map(({ metrics: m, ms, checks }) => {
    const row = [
      String(m.order),
      m.id,
      `${m.width}×${m.depth}`,
      String(m.boxes),
      String(m.zones),
      String(m.stackLimit),
      movesText(m),
      extraText(m),
      String(m.mustMove),
      String(m.blockers.count),
      String(m.narrow.count),
      pct(m.freeFloorPct),
      String(m.ambiguous),
      String(m.traps),
      m.sortings === null ? '—' : String(m.sortings),
      deadEndText(m),
      m.slots.total === 0 ? '—' : `${m.slots.total}/${m.slots.cued}`,
      m.trucks.levels === 0 ? '—' : `${m.trucks.columns}/${m.trucks.levels}`,
      checks.length === 0 ? '—' : `${checks.every((c) => c.ok) ? 'OK' : 'NO'} ${checks.filter((c) => c.ok).length}/${checks.length}`,
    ];
    if (timings) row.push(ms.toFixed(0));
    return row;
  });
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const left = new Set([1]);
  const line = (cells: string[]) => cells.map((c, i) => (left.has(i) ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ').trimEnd();
  return [
    'Resumen',
    line(head),
    ...rows.map(line),
    '',
    'mov. = mínimo de movimientos de caja (≥ = cota inferior: la búsqueda exacta se cortó) · extra = mov. − oblig.',
    'oblig. = cajas que deben moverse · bloq. = cajas que hay que apartar antes · estr. = casillas sin giro con carga',
    'libre = % de casillas vacías al empezar · ambig. = cajas con varios destinos · tramp./repart. = niveles con símbolos, estanterías o camiones',
    'callej. = callejones encontrados (entre paréntesis: estados explorados, si la búsqueda no los cubrió todos)',
    'huecos = huecos de estantería almacenable / con pista (docs/RACKS.md) · camión = columnas / niveles de camión (docs/DOCKS.md)',
    'dific. = objetivos «dificultad:» del archivo que se cumplen · detalle y plan: npm run levels -- <nivel>',
  ];
}
