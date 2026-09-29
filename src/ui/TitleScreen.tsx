import { useRef, useState } from 'react';
import { useStore, type Store } from '../core/store';
import { TEST_MODE_TIP } from './format';
import { SoundIcon, ToroMark } from './icons';
import { onScreen, useAutoFocus } from './interaction';
import { Keycap } from './Keycap';
import { LevelCaption, LevelDots } from './LevelDots';
import { Presence } from './Presence';
import type { GameActions, UIState } from './uiState';

interface TitleScreenProps {
  store: Store<UIState>;
  actions: GameActions;
  show: boolean;
}

/**
 * Title: wordmark at the top, menu at the bottom, the idle-orbiting diorama left clear in between.
 */
export function TitleScreen({ store, actions, show }: TitleScreenProps) {
  return (
    <Presence show={show} className="title">
      <div className="title__veil ui-enter" aria-hidden="true" />
      <header className="title__head">
        <ToroMark className="toro-mark ui-enter" />
        <h1 className="title__wordmark ui-enter ui-enter--d1">Toro</h1>
        <p className="title__subtitle ui-enter ui-enter--d2">Un pequeño almacén, a tu ritmo.</p>
      </header>
      <div className="title__bottom">
        <TitleMenu store={store} actions={actions} active={show} />
        <p className="title__footer ui-enter ui-enter--d4">
          <span>
            <Keycap>Q</Keycap> / <Keycap>E</Keycap> girar cámara
          </span>
          <span className="title__sep" aria-hidden="true">
            ·
          </span>
          <SoundHint store={store} />
          <span className="title__sep" aria-hidden="true">
            ·
          </span>
          <span>
            <Keycap>T</Keycap> tiempo
          </span>
          <span className="title__sep" aria-hidden="true">
            ·
          </span>
          {/* Esc leaves a level for this screen; "Continuar" picks it up where it was. */}
          <span>
            <Keycap>Esc</Keycap> inicio
          </span>
          <span className="title__sep" aria-hidden="true">
            ·
          </span>
          <TestModeToggle store={store} actions={actions} />
        </p>
      </div>
    </Presence>
  );
}

/** Discreet footer switch: "Modo prueba" opens every level (U toggles it too). */
function TestModeToggle({ store, actions }: { store: Store<UIState>; actions: GameActions }) {
  const on = useStore(store, (s) => s.testMode);
  return (
    <button
      type="button"
      className={`title__test${on ? ' is-on' : ''}`}
      aria-pressed={on}
      title={TEST_MODE_TIP}
      // A mouse press leaves focus on "Empezar / Continuar": the next Enter / Space starts, never re-toggles.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onScreen(store, 'title', () => actions.toggleTestMode())}
    >
      <span className="title__test-dot" aria-hidden="true" />
      Modo prueba
    </button>
  );
}

/** Footer mute hint that tells the truth: a returning player whose saved setting is muted sees why. */
function SoundHint({ store }: { store: Store<UIState> }) {
  const muted = useStore(store, (s) => s.muted);
  return (
    // Keyed so the new wording eases in.
    <span key={muted ? 'off' : 'on'} className="ui-swap">
      {muted && <SoundIcon className="title__footer-icon" off />}
      <Keycap>M</Keycap> {muted ? 'activar sonido' : 'silencio'}
    </span>
  );
}

function TitleMenu({ store, actions, active }: Omit<TitleScreenProps, 'show'> & { active: boolean }) {
  const canContinue = useStore(store, (s) => s.canContinue);
  const levels = useStore(store, (s) => s.levels);
  const currentIndex = useStore(store, (s) => s.levelIndex);
  const showTimes = useStore(store, (s) => s.showTimer);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(primaryRef, active);

  const start = (index?: number) => onScreen(store, 'title', () => actions.start(index));

  return (
    <div className="ui-panel title__panel ui-enter ui-enter--d3">
      <button ref={primaryRef} type="button" className="ui-btn ui-btn--primary title__start" onClick={() => start()}>
        {canContinue ? 'Continuar' : 'Empezar'}
      </button>
      {levels.length > 1 && (
        <>
          <LevelDots
            levels={levels}
            currentIndex={currentIndex}
            showTimes={showTimes}
            onPick={start}
            onPreview={setPreviewIndex}
          />
          <LevelCaption level={levels[previewIndex ?? currentIndex]} showTimes={showTimes} />
        </>
      )}
    </div>
  );
}
