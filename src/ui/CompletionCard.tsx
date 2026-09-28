import { useId, useRef } from 'react';
import { useStore, type Store } from '../core/store';
import { formatPrecise } from './format';
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
 * positive message, time, best time, next / repeat.
 */
export function CompletionCard({ store, actions, show }: CompletionCardProps) {
  const liveResult = useStore(store, (s) => s.result);
  const liveIndex = useStore(store, (s) => s.levelIndex);
  const liveName = useStore(store, (s) => s.levelName);
  const visible = show && liveResult !== null;

  // While fading out, keep showing the finished level (the game may already have moved on).
  const result = useFrozen(liveResult, !visible);
  const levelIndex = useFrozen(liveIndex, !visible);
  const levelName = useFrozen(liveName, !visible);

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
}

function CardBody({ store, actions, active, result, levelIndex, levelName }: CardBodyProps) {
  // Times belong to the optional timer: if the player hid it, the card stays purely celebratory.
  const showTimes = useStore(store, (s) => s.showTimer);
  const titleId = useId();
  const primaryRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(primaryRef, active);

  const next = () => onScreen(store, 'complete', () => actions.nextLevel());
  const repeat = () => onScreen(store, 'complete', () => actions.restart());
  const eyebrow = levelName ? `Nivel ${levelIndex + 1} · ${levelName}` : `Nivel ${levelIndex + 1}`;

  return (
    <section className="ui-panel card ui-enter" role="dialog" aria-labelledby={titleId}>
      <p className="card__eyebrow">{eyebrow}</p>
      <h2 id={titleId} className="card__title">
        {result.message}
      </h2>
      {result.isLast && <p className="card__line">Todos los almacenes están en orden.</p>}

      {showTimes && (
        <dl className="card__stats ui-enter ui-enter--d1">
          <div className="card__stat">
            <dt>Tiempo</dt>
            <dd>{formatPrecise(result.timeMs)}</dd>
          </div>
          <div className="card__stat">
            <dt>Mejor tiempo</dt>
            <dd>{formatPrecise(result.bestMs)}</dd>
          </div>
        </dl>
      )}
      {showTimes && result.isNewBest && (
        <p className="card__badge ui-enter ui-enter--d3">
          <SparkleIcon className="card__badge-icon" />
          Nuevo mejor tiempo
        </p>
      )}

      <div className="card__actions">
        <button ref={primaryRef} type="button" className="ui-btn ui-btn--primary" onClick={next}>
          {result.isLast ? 'Volver al inicio' : 'Siguiente almacén'}
        </button>
        <button type="button" className="ui-btn ui-btn--quiet" onClick={repeat}>
          Repetir
        </button>
      </div>
    </section>
  );
}
