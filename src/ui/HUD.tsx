import type { CSSProperties, MouseEvent } from 'react';
import { useStore, type Store } from '../core/store';
import { formatClock } from './format';
import { ClockIcon, RestartIcon } from './icons';
import { onScreen } from './interaction';
import { Presence } from './Presence';
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

/** In-game HUD — only three things: level, time, restart. */
export function HUD({ store, actions, show, dimmed }: HUDProps) {
  return (
    <Presence show={show} inert={dimmed} className={`hud${dimmed ? ' is-dimmed' : ''}`}>
      <div className="hud__corner hud__corner--start">
        <LevelBadge store={store} />
        <RestartButton store={store} actions={actions} />
      </div>
      <div className="hud__corner hud__corner--end">
        <TimerButton store={store} actions={actions} />
      </div>
    </Presence>
  );
}

function LevelBadge({ store }: { store: Store<UIState> }) {
  const level = useStore(store, (s) => s.levelIndex + 1);
  return (
    <div className="hud-pill hud-level ui-enter">
      {/* Keyed so a new level number eases in instead of snapping. */}
      <span key={level} className="ui-swap">{`Nivel ${level}`}</span>
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
