import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { Game } from './game/Game';
import { Overlay } from './ui/Overlay';
import { UnsupportedCard } from './ui/UnsupportedCard';
import { createUIStore, type GameActions } from './ui/uiState';
import { useStore } from './core/store';
import { BENCHMARK_ID, getLevel, getSpecialLevel } from './data/levels';
import { getTheme, themeCssVars } from './themes';

/** App shell: a full-screen canvas host + the DOM overlay, behind an error boundary. Game wiring lives in game/Game.ts. */
export function App() {
  return (
    <ShellBoundary>
      <Shell />
    </ShellBoundary>
  );
}

function Shell() {
  const hostRef = useRef<HTMLDivElement>(null);
  const store = useMemo(() => createUIStore(), []);
  const [game, setGame] = useState<Game | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const g = new Game(host, store);
    g.mount();
    setGame(g);
    // Dev-only handle for manual inspection from the console; stripped from production builds.
    if (import.meta.env.DEV) (window as unknown as { __toro?: Game }).__toro = g;
    return () => {
      g.dispose();
      setGame(null);
    };
  }, [store]);

  // Gradient behind the canvas + UI tokens follow the theme of the level on screen — the same theme Game hands
  // the renderer (store.levelIndex names the loaded level, title diorama included, unless the Benchmark is on screen).
  const levelIndex = useStore(store, (s) => s.levelIndex);
  const benchmark = useStore(store, (s) => s.benchmark);
  const theme = getTheme((benchmark ? getSpecialLevel(BENCHMARK_ID) : getLevel(levelIndex))?.theme);
  const style = useMemo(() => themeCssVars(theme) as React.CSSProperties, [theme]);

  return (
    <div className="app" style={style}>
      <div className="stage" ref={hostRef} />
      {game && <Overlay store={store} actions={game as GameActions} />}
    </div>
  );
}

/**
 * Last line of defence: a render error anywhere below unmounts the game (its effect cleanup disposes it) and
 * shows the same calm card as a missing WebGL 2, with a reload button — never a blank page.
 */
class ShellBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[Toro] The app shell caught an error.', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="app" style={themeCssVars(getTheme(undefined)) as React.CSSProperties}>
        <div className="ui-overlay" data-screen="unsupported">
          <UnsupportedCard show reason="crash" />
        </div>
      </div>
    );
  }
}
