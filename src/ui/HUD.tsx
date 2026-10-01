import type { CSSProperties, MouseEvent } from 'react';
import { useStore, type Store } from '../core/store';
import { BENCHMARK_TIP, formatClock, formatMinimum, reachedMinimum, TEST_MODE_TIP } from './format';
import { BoxIcon, ClockIcon, RestartIcon, SparkleIcon } from './icons';
import { onScreen } from './interaction';
import { Presence } from './Presence';
import { useReservedArea } from './reservedAreas';
import type { GameActions, UIState } from './uiState';

interface HUDProps {
  store: Store<UIState>;
  actions: GameActions;
  show: boolean;
  /** Completion card on top: HUD fades back and stops taking input. */
  dimmed: boolean;
}

/** Space is the game's action key: a HUD button must never keep focus after being used. */
function releaseFocus(e: MouseEvent<HTMLButtonElement>): void {
  e.currentTarget.blur();
}

/** A mouse press never moves focus onto a HUD button, not even one dragged off before release (no click). */
function keepFocus(e: MouseEvent<HTMLButtonElement>): void {
  e.preventDefault();
}

/**
 * In-game HUD — level and restart top-left; the optional move counter and time top-right. Its corners reserve the top
 * band (the camera frames the level below them); a pill added elsewhere at the top takes `useReservedArea('top')` too.
 */
export function HUD({ store, actions, show, dimmed }: HUDProps) {
  const reserveTop = useReservedArea<HTMLDivElement>('top');
  return (
    <Presence show={show} inert={dimmed} className={`hud${dimmed ? ' is-dimmed' : ''}`}>
      <div className="hud__corner hud__corner--start" ref={reserveTop}>
        <LevelBadge store={store} />
        <RestartButton store={store} actions={actions} />
      </div>
      <div className="hud__corner hud__corner--end" ref={reserveTop}>
        <MovesButton store={store} actions={actions} />
        <TimerButton store={store} actions={actions} />
      </div>
    </Presence>
  );
}

function LevelBadge({ store }: { store: Store<UIState> }) {
  // The Benchmark (test mode's special level) has no number: its name, and a quiet "sin récord" (nothing is saved).
  const label = useStore(store, (s) => (s.benchmark ? 'Benchmark' : `Nivel ${s.levelIndex + 1}`));
  const benchmark = useStore(store, (s) => s.benchmark);
  const testMode = useStore(store, (s) => s.testMode);
  const tag = benchmark ? 'sin récord' : testMode ? 'prueba' : null;
  return (
    <div className="hud-pill hud-level ui-enter">
      {/* Keyed so a new level number eases in instead of snapping. */}
      <span key={label} className="ui-swap">{label}</span>
      {tag && (
        // Read as "Nivel 3, modo prueba" or "Benchmark, sin récord" (whitespace between flex items is dropped, so it
        // is spelled out).
        <span className="hud-level__test" title={benchmark ? BENCHMARK_TIP : TEST_MODE_TIP}>
          <span aria-hidden="true">{tag}</span>
          <span className="ui-visually-hidden">{benchmark ? ', sin récord' : ', modo prueba'}</span>
        </span>
      )}
    </div>
  );
}

function RestartButton({ store, actions }: Omit<HUDProps, 'show' | 'dimmed'>) {
  // R held mid-level (work at stake): a soft fill grows in the pill until the level restarts.
  const hold = useStore(store, (s) => s.restartHold);
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    releaseFocus(e);
    onScreen(store, 'playing', () => actions.restart());
  };
  return (
    <button
      type="button"
      className={`hud-pill hud-round hud-restart ui-enter ui-enter--d1${hold > 0 ? ' is-holding' : ''}`}
      style={{ '--ui-hold': hold } as CSSProperties}
      aria-label="Reiniciar nivel"
      title="Reiniciar nivel"
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      <RestartIcon className="hud-restart__icon" />
    </button>
  );
}

/**
 * Discreet clock. Re-renders only when the displayed text changes (selector returns the formatted
 * string), not on every 10 Hz elapsed update. Click toggles it; hidden leaves a faint clock glyph.
 */
function TimerButton({ store, actions }: Omit<HUDProps, 'show' | 'dimmed'>) {
  const showTimer = useStore(store, (s) => s.showTimer);
  const started = useStore(store, (s) => s.timerStarted);
  const clock = useStore(store, (s) => (s.timerStarted ? formatClock(s.elapsedMs) : '0:00'));

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    releaseFocus(e);
    actions.toggleTimer();
  };

  if (!showTimer) {
    return (
      <button
        key="hidden"
        type="button"
        className="hud-pill hud-round hud-timer is-hidden ui-enter"
        aria-label="Mostrar tiempo"
        title="Mostrar tiempo"
        onMouseDown={keepFocus}
        onClick={onClick}
      >
        <ClockIcon className="hud-timer__icon" />
      </button>
    );
  }
  return (
    // Distinct keys: toggling remounts the button so the new state eases in (see .ui-enter).
    <button
      key="shown"
      type="button"
      className={`hud-pill hud-timer ui-enter${started ? '' : ' is-idle'}`}
      aria-label={`Tiempo ${clock}. Ocultar tiempo`}
      title="Ocultar tiempo"
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      <span className="hud-timer__value">{clock}</span>
    </button>
  );
}

/**
 * Optional move counter, the timer's sibling: "12 · mín. 10" (box moves this attempt · the level's minimum), a gentle
 * tick each time the count grows, and a soft accent once the level is finished at the minimum. Click or N toggles it;
 * hidden leaves a faint box glyph.
 */
function MovesButton({ store, actions }: Omit<HUDProps, 'show' | 'dimmed'>) {
  const showMoves = useStore(store, (s) => s.showMoves);
  const moves = useStore(store, (s) => s.moves);
  const min = useStore(store, (s) => s.minMoves);
  const finished = useStore(store, (s) => s.finished);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    releaseFocus(e);
    actions.toggleMoves();
  };

  if (!showMoves) {
    return (
      <button
        key="hidden"
        type="button"
        className="hud-pill hud-round hud-moves is-hidden ui-enter"
        aria-label="Mostrar movimientos"
        title="Mostrar movimientos"
        onMouseDown={keepFocus}
        onClick={onClick}
      >
        <BoxIcon className="hud-moves__icon" />
      </button>
    );
  }
  const atMinimum = finished && reachedMinimum(moves, min);
  const minLabel = min ? formatMinimum(min) : null;
  const spoken = `Movimientos ${moves}${min ? `, mínimo ${min.exact ? '' : 'al menos '}${min.moves}` : ''}${atMinimum ? ', en el mínimo' : ''}`;
  return (
    // Distinct keys: toggling remounts the button so the new state eases in (see .ui-enter).
    <button
      key="shown"
      type="button"
      className={`hud-pill hud-moves ui-enter${moves === 0 ? ' is-idle' : ''}${atMinimum ? ' is-minimum' : ''}`}
      aria-label={`${spoken}. Ocultar movimientos`}
      title="Ocultar movimientos"
      onMouseDown={keepFocus}
      onClick={onClick}
    >
      {atMinimum ? <SparkleIcon className="hud-moves__icon" /> : <BoxIcon className="hud-moves__icon" />}
      {/* Keyed on the count: each new move remounts it with a soft tick (none for the 0 of a fresh level). */}
      <span key={moves} className={`hud-moves__value${moves > 0 ? ' ui-tick' : ''}`}>
        {moves}
      </span>
      {minLabel && <span className="hud-moves__min">· {minLabel}</span>}
    </button>
  );
}
