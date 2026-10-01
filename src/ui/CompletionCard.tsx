import { useId, useRef, type ReactNode } from 'react';
import { useStore, type Store } from '../core/store';
import { formatMinimum, formatPrecise, reachedMinimum } from './format';
import { SparkleIcon } from './icons';
import { onScreen, useAutoFocus } from './interaction';
import { Presence, useFrozen } from './Presence';
import type { GameActions, LevelResult, UIState } from './uiState';

interface CompletionCardProps {
  store: Store<UIState>;
  actions: GameActions;
  show: boolean;
}

/**
 * Compact card at the bottom center after a level (the tidied warehouse stays in view above it):
 * positive message, time (with the best time under it) and moves (with the level's minimum, and the fewest moves under
 * it), next / repeat. Times go with the optional timer and moves with the optional move counter. A "Modo prueba" run
 * shows its time and moves only, marked as not kept; the Benchmark's card reads "Benchmark" and leads back to the title.
 */
export function CompletionCard({ store, actions, show }: CompletionCardProps) {
  const liveResult = useStore(store, (s) => s.result);
  const liveIndex = useStore(store, (s) => s.levelIndex);
  const liveName = useStore(store, (s) => s.levelName);
  const liveBenchmark = useStore(store, (s) => s.benchmark);
  const visible = show && liveResult !== null;

  // While fading out, keep showing the finished level (the game may already have moved on).
  const result = useFrozen(liveResult, !visible);
  const levelIndex = useFrozen(liveIndex, !visible);
  const levelName = useFrozen(liveName, !visible);
  const benchmark = useFrozen(liveBenchmark, !visible);

  return (
    <Presence show={visible} className="card-layer">
      {result && (
        <CardBody
          store={store}
          actions={actions}
          active={visible}
          result={result}
          levelIndex={levelIndex}
          levelName={levelName}
          benchmark={benchmark}
        />
      )}
    </Presence>
  );
}

interface CardBodyProps {
  store: Store<UIState>;
  actions: GameActions;
  active: boolean;
  result: LevelResult;
  levelIndex: number;
  levelName: string;
  /** The Benchmark (test mode's special level): named instead of numbered, its card leads back to the title. */
  benchmark: boolean;
}

function CardBody({ store, actions, active, result, levelIndex, levelName, benchmark }: CardBodyProps) {
  // Times belong to the optional timer and moves to the optional move counter: with both hidden the card stays purely
  // celebratory.
  const showTimes = useStore(store, (s) => s.showTimer);
  const showMoves = useStore(store, (s) => s.showMoves);
  // A level only "Modo prueba" opened keeps no time and no moves: no records to show, and the card says so.
  const practice = result.practice === true;
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(primaryRef, active);

  const next = () => onScreen(store, 'complete', () => actions.nextLevel());
  const repeat = () => onScreen(store, 'complete', () => actions.restart());
  const eyebrow = benchmark
    ? levelName || 'Benchmark'
    : levelName
      ? `Nivel ${levelIndex + 1} · ${levelName}`
      : `Nivel ${levelIndex + 1}`;

  // One tile per metric, so the stats stay a single row whatever is shown (the card must never climb over the middle
  // of the diorama): each value carries the level's record on a quiet line under it, and a new record lights its own
  // tile instead of adding a row of tags. A practice run keeps no records, so its tiles carry none.
  const stats: ReactNode[] = [];
  if (showTimes) {
    stats.push(
      <Stat
        key="time"
        label="Tiempo"
        record={practice ? null : `mejor ${formatPrecise(result.bestMs)}`}
        newRecord={!practice && result.isNewBest}
      >
        {formatPrecise(result.timeMs)}
      </Stat>,
    );
  }
  if (showMoves) {
    stats.push(
      <MovesStat
        key="moves"
        moves={result.moves}
        min={result.minMoves}
        record={practice || result.bestMoves === null ? null : `récord ${result.bestMoves}`}
        newRecord={!practice && result.isNewBestMoves}
      />,
    );
  }
  const practiceNote = benchmark
    ? 'Modo prueba · sin récord'
    : showTimes && showMoves
      ? 'Modo prueba · este resultado no se guarda'
      : showTimes
        ? 'Modo prueba · este tiempo no se guarda'
        : 'Modo prueba · estos movimientos no se guardan';

  return (
    <section className="ui-panel card ui-enter" role="dialog" aria-labelledby={titleId}>
      <p className="card__eyebrow">{eyebrow}</p>
      <h2 id={titleId} className="card__title">
        {result.message}
      </h2>
      {result.isLast && <p className="card__line">Todos los almacenes están en orden.</p>}

      {stats.length > 0 && (
        <dl className={`card__stats${stats.length === 1 ? ' card__stats--single' : ''} ui-enter ui-enter--d1`}>{stats}</dl>
      )}
      {stats.length > 0 && practice && <p className="card__line card__practice ui-enter ui-enter--d2">{practiceNote}</p>}

      <div className="card__actions">
        <button ref={primaryRef} type="button" className="ui-btn ui-btn--primary" onClick={next}>
          {result.isLast || benchmark ? 'Volver al inicio' : 'Siguiente almacén'}
        </button>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={repeat}>
          Repetir
        </button>
      </div>
    </section>
  );
}

interface StatProps {
  label: string;
  /** The level's record, shown under the value ("mejor 0:38.9", "récord 11"); null: nothing kept. */
  record: string | null;
  /** This attempt set a new record: "✦ nuevo récord" in its place (the record is this value then). */
  newRecord: boolean;
  /** A count at the minimum (the soft accent tile, like a new record). */
  minimum?: boolean;
  children: ReactNode;
}

/**
 * One metric: its value, then the level's record on a small soft line under it. A new record reads "✦ nuevo récord"
 * instead, on the soft accent wash the "new best" tags used to have (a tile of its own, never an extra row).
 */
function Stat({ label, record, newRecord, minimum = false, children }: StatProps) {
  return (
    <div className={`card__stat${minimum ? ' is-minimum' : ''}${newRecord ? ' is-record' : ''}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
      {newRecord ? (
        <dd className="card__stat-record ui-enter ui-enter--d3">
          <SparkleIcon className="card__stat-icon" />
          nuevo récord
        </dd>
      ) : (
        record !== null && <dd className="card__stat-record">{record}</dd>
      )}
    </div>
  );
}

interface MovesStatProps extends Pick<StatProps, 'record' | 'newRecord'> {
  moves: number;
  min: LevelResult['minMoves'];
}

/**
 * This attempt's moves beside the level's minimum ("12 · mín. 10"); a count that reached it reads "10 ✦ mínimo" on a
 * soft accent tile (never a warning tone above it: more moves are just more moves).
 */
function MovesStat({ moves, min, record, newRecord }: MovesStatProps) {
  const atMinimum = reachedMinimum(moves, min);
  return (
    <Stat label="Movimientos" record={record} newRecord={newRecord} minimum={atMinimum}>
      {moves}
      {atMinimum ? (
        <span className="card__stat-note">
          <SparkleIcon className="card__stat-icon" />
          mínimo
        </span>
      ) : (
        min && <span className="card__stat-note">· {formatMinimum(min)}</span>
      )}
    </Stat>
  );
}
