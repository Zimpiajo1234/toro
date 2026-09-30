import { GAME_CONFIG } from '../config';
import { useStore, type Store } from '../core/store';
import { MouseWheelIcon } from './icons';
import { Keycap } from './Keycap';
import { Presence, useFrozen } from './Presence';
import { useReservedArea } from './reservedAreas';
import type { UIState } from './uiState';

/** Leaving a level the hint lingers a little longer on its way out: it should melt away, not vanish. */
const HINT_EXIT_MS = 700;
/** Vehicle controls (W/S drive, A/D turn) get their own wording; floor-direction mappings keep "WASD mover". */
const VEHICLE_KEYS = GAME_CONFIG.controls.keyboardMapping === 'vehicle';

/**
 * Control hint, bottom center: on screen the whole time a level is played, in every level (it never fades out on its
 * own). The move row (drive, pick / drop, zoom) and, in levels with storage whose forks go by the keys (`storage`:
 * today the racks'), the fork row under it, in one soft panel. It reserves the bottom band up to its top edge: the
 * camera frames the level above it.
 */
export function ControlHint({ store, show }: { store: Store<UIState>; show: boolean }) {
  const storage = useStore(store, (s) => s.storage);
  // On its way out (to the title, whose level may differ) it keeps the rows it showed.
  const forkRow = useFrozen(storage, !show);
  const reserveBottom = useReservedArea<HTMLDivElement>('bottom');
  return (
    <Presence show={show} className="hint-layer" exitMs={HINT_EXIT_MS}>
      <div ref={reserveBottom} className={`hint ui-enter ui-enter--d4${forkRow ? ' hint--rows' : ''}`} role="note">
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
      <Sep />
      <ZoomGroup />
    </p>
  );
}

/**
 * + / − zoom the camera in / out (numpad + / − too; also a trackpad or touch pinch and a gamepad's LT / RT, not listed:
 * the row stays short, and the hint never advertises the gamepad). Last in the move row, so the hint stays one row tall at desktop widths. The mouse wheel is not a zoom
 * control: it stays with the forks (docs/RACKS.md).
 */
function ZoomGroup() {
  return (
    <span className="hint__group">
      <span className="hint__keys">
        <Keycap>+</Keycap>
        <Keycap>−</Keycap>
      </span>
      zoom
    </span>
  );
}

/**
 * F / V and the mouse wheel step the forks one level up / down at a storage column whose forks go by the keys (a rack's,
 * docs/RACKS.md). A gamepad's X / B do too, but the hint only lists the keyboard and the mouse.
 */
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
    </p>
  );
}
