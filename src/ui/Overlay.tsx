import { useCallback, useEffect, useLayoutEffect, useState, type RefCallback } from 'react';
import { useStore, type Store } from '../core/store';
import { CompletionCard } from './CompletionCard';
import { ControlHint } from './ControlHint';
import { HUD } from './HUD';
import { ReservedAreas, ReservedAreasProvider, type ReserveMode } from './reservedAreas';
import { SoundNotice } from './SoundNotice';
import { TitleScreen } from './TitleScreen';
import { UnsupportedCard } from './UnsupportedCard';
import type { GameActions, Screen, UIState } from './uiState';

/**
 * Playing: the HUD pills and the hint are reserved (the camera frames the level clear of them, as they are when the
 * level starts). The completion card keeps those bands (the camera stays put under the card). Anywhere else nothing is
 * (the title frames the whole canvas).
 */
function reserveMode(screen: Screen): ReserveMode {
  if (screen === 'playing') return 'track';
  return screen === 'complete' ? 'hold' : 'clear';
}

/**
 * Root of the DOM overlay drawn above the canvas: title, HUD (level · time · restart), completion card,
 * plus the always-mounted sound notice (live region + a brief pill when M or B is pressed in a level).
 * The root is pointer-transparent; only buttons take pointer input, so the canvas stays usable.
 * Each part subscribes to just the fields it shows, so the 10 Hz timer only re-renders the clock.
 */
export function Overlay({ store, actions }: { store: Store<UIState>; actions: GameActions }) {
  const screen = useStore(store, (s) => s.screen);
  const inLevel = screen === 'playing' || screen === 'complete';
  // The level on screen: a new one while playing (a "Modo prueba" jump) takes its own bands.
  const level = useStore(store, (s) => (s.benchmark ? 'benchmark' : s.levelIndex));

  const [areas] = useState(() => new ReservedAreas());
  const rootRef = useCallback<RefCallback<HTMLDivElement>>(
    (el) => {
      areas.setRoot(el);
      return () => areas.setRoot(null);
    },
    [areas],
  );
  useEffect(() => {
    const report = actions.setViewInsets;
    if (!report) return undefined;
    areas.connect(report);
    return () => areas.connect(null);
  }, [areas, actions]);
  // After the commit, before the paint: a level's bands reach the camera before its first frame shows.
  useLayoutEffect(() => areas.setMode(reserveMode(screen), level), [areas, screen, level]);

  return (
    <ReservedAreasProvider value={areas}>
      <div className="ui-overlay" data-screen={screen} ref={rootRef}>
        <TitleScreen store={store} actions={actions} show={screen === 'title'} />
        <HUD store={store} actions={actions} show={inLevel} dimmed={screen === 'complete'} />
        <ControlHint store={store} show={screen === 'playing'} />
        <CompletionCard store={store} actions={actions} show={screen === 'complete'} />
        <SoundNotice store={store} showPill={inLevel} />
        <UnsupportedCard show={screen === 'unsupported'} />
      </div>
    </ReservedAreasProvider>
  );
}
