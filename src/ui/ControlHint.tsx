import { GAME_CONFIG } from '../config';
import { useStore, type Store } from '../core/store';
import { Keycap } from './Keycap';
import { Presence } from './Presence';
import type { UIState } from './uiState';

/** The hint lingers a little longer on its way out: it should melt away, not vanish. */
const HINT_EXIT_MS = 700;
/** Vehicle controls (W/S drive, A/D turn) get their own wording; floor-direction mappings keep "WASD mover". */
const VEHICLE_KEYS = GAME_CONFIG.controls.keyboardMapping === 'vehicle';

/** First-level control hint, bottom center. Fades out once `showHint` turns false. */
export function ControlHint({ store, show }: { store: Store<UIState>; show: boolean }) {
  const showHint = useStore(store, (s) => s.showHint);
  return (
    <Presence show={show && showHint} className="hint-layer" exitMs={HINT_EXIT_MS}>
      <p className="hint ui-enter ui-enter--d4" role="note">
        {VEHICLE_KEYS ? (
          <>
            <span className="hint__group">
              <span className="hint__keys">
                <Keycap>W</Keycap>
                <Keycap>S</Keycap>
              </span>
              avanzar / atrás
            </span>
            <span className="hint__sep" aria-hidden="true">
              ·
            </span>
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
        <span className="hint__sep" aria-hidden="true">
          ·
        </span>
        <span className="hint__group">
          <Keycap wide>Espacio</Keycap>
          recoger / dejar
        </span>
      </p>
    </Presence>
  );
}
