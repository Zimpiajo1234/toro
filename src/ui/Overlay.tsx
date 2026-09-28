import { useStore, type Store } from '../core/store';
import { CompletionCard } from './CompletionCard';
import { ControlHint } from './ControlHint';
import { HUD } from './HUD';
import { SoundNotice } from './SoundNotice';
import { TitleScreen } from './TitleScreen';
import { UnsupportedCard } from './UnsupportedCard';
import type { GameActions, UIState } from './uiState';

/**
 * Root of the DOM overlay drawn above the canvas: title, HUD (level · time · restart), completion card,
 * plus the always-mounted sound notice (live region + a brief pill when M is pressed in a level).
 * The root is pointer-transparent; only buttons take pointer input, so the canvas stays usable.
 * Each part subscribes to just the fields it shows, so the 10 Hz timer only re-renders the clock.
 */
export function Overlay({ store, actions }: { store: Store<UIState>; actions: GameActions }) {
  const screen = useStore(store, (s) => s.screen);
  const inLevel = screen === 'playing' || screen === 'complete';

  return (
    <div className="ui-overlay" data-screen={screen}>
      <TitleScreen store={store} actions={actions} show={screen === 'title'} />
      <HUD store={store} actions={actions} show={inLevel} dimmed={screen === 'complete'} />
      <ControlHint store={store} show={screen === 'playing'} />
      <CompletionCard store={store} actions={actions} show={screen === 'complete'} />
      <SoundNotice store={store} showPill={inLevel} />
      <UnsupportedCard show={screen === 'unsupported'} />
    </div>
  );
}
