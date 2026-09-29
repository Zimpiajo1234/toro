import { GAME_CONFIG } from '../config';
import { useStore, type Store } from '../core/store';
import { MouseWheelIcon } from './icons';
import { Keycap } from './Keycap';
import { Presence, useFrozen } from './Presence';
import type { UIState } from './uiState';

/** Leaving a level the hint lingers a little longer on its way out: it should melt away, not vanish. */
const HINT_EXIT_MS = 700;
/** Vehicle controls (W/S drive, A/D turn) get their own wording; floor-direction mappings keep "WASD mover". */
const VEHICLE_KEYS = GAME_CONFIG.controls.keyboardMapping === 'vehicle';

/**
 * Control hint, bottom center: on screen the whole time a level is played, in every level (it never fades out on its
 * own). The move row and, in levels with storage racks (`racks`), the fork row under it, in one soft panel.
 */
export function ControlHint({ store, show }: { store: Store<UIState>; show: boolean }) {
  const racks = useStore(store, (s) => s.racks);
  // On its way out (to the title, whose level may differ) it keeps the rows it showed.
  const forkRow = useFrozen(racks, !show);
  return (
    <Presence show={show} className="hint-layer" exitMs={HINT_EXIT_MS}>
      <div className={`hint ui-enter ui-enter--d4${forkRow ? ' hint--rows' : ''}`} role="note">
        <MoveRow />
        {forkRow && <ForkRow />}
      </div>
    </Presence>
  );
}

function Sep() {
  return (
    <span className="hint__sep" aria-hidden="true">
      ·
    </span>
  );
}

function MoveRow() {
  return (
    <p className="hint__row">
      {VEHICLE_KEYS ? (
        <>
          <span className="hint__group">
            <span className="hint__keys">
              <Keycap>W</Keycap>
              <Keycap>S</Keycap>
            </span>
            avanzar / atrás
          </span>
          <Sep />
          <span className="hint__group">
            <span className="hint__keys">
              <Keycap>A</Keycap>
              <Keycap>D</Keycap>
            </span>
            girar
          </span>
        </>
      ) : (
        <span className="hint__group">
          <span className="hint__keys">
            <Keycap>W</Keycap>
            <Keycap>A</Keycap>
            <Keycap>S</Keycap>
            <Keycap>D</Keycap>
          </span>
          mover
        </span>
      )}
      <Sep />
      <span className="hint__group">
        <Keycap wide>Espacio</Keycap>
        recoger / dejar
      </span>
    </p>
  );
}

/** F / V (and the mouse wheel, pad X / B) step the forks one slot up / down at a rack column (docs/RACKS.md). */
function ForkRow() {
  return (
    <p className="hint__row">
      <span className="hint__group">
        <span className="hint__keys">
          <Keycap>F</Keycap>
          <Keycap>V</Keycap>
        </span>
        subir / bajar horquilla
      </span>
      <Sep />
      <span className="hint__group">
        <MouseWheelIcon className="hint__icon" />
        rueda
      </span>
      <Sep />
      <span className="hint__group">
        <span className="hint__keys">
          <Keycap>X</Keycap>
          <Keycap>B</Keycap>
        </span>
        mando
      </span>
    </p>
  );
}
