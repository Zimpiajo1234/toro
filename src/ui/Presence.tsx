import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { blurWithin } from './interaction';

/** Default exit fade (ms). Passed to CSS as --ui-leave-ms so JS and CSS never drift apart. */
export const EXIT_MS = 360;

/**
 * Keeps content mounted while it fades out. `rendered` stays true for `exitMs` after `show` turns
 * false; `leaving` is true during that window.
 */
export function usePresence(show: boolean, exitMs: number): { rendered: boolean; leaving: boolean } {
  const [rendered, setRendered] = useState(show);
  // Adjusting state while rendering (instead of in an effect) mounts on the same frame `show` flips.
  if (show && !rendered) setRendered(true);

  useEffect(() => {
    if (show || !rendered) return;
    const timer = window.setTimeout(() => setRendered(false), exitMs);
    return () => window.clearTimeout(timer);
  }, [show, rendered, exitMs]);

  return { rendered: show || rendered, leaving: !show && rendered };
}

/**
 * Returns `value` while live, or the last live value while `frozen` — so a panel that is fading out
 * keeps showing what it showed instead of flickering to the next state.
 */
export function useFrozen<T>(value: T, frozen: boolean): T {
  const [held, setHeld] = useState<T>(() => value);
  if (!frozen && !Object.is(held, value)) setHeld(() => value);
  return frozen ? held : value;
}

interface PresenceProps {
  show: boolean;
  className: string;
  /** Make the content non-interactive even while shown (e.g. the dimmed HUD). */
  inert?: boolean;
  exitMs?: number;
  children: ReactNode;
}

/**
 * Full-screen, pointer-transparent layer that plays enter / exit animations on its `.ui-enter`
 * descendants. The layer itself never animates opacity: a translucent ancestor would stop the
 * frosted panels' backdrop-filter from seeing the scene behind them.
 */
export function Presence({ show, className, inert = false, exitMs = EXIT_MS, children }: PresenceProps) {
  const { rendered, leaving } = usePresence(show, exitMs);
  const ref = useRef<HTMLDivElement>(null);
  const isInert = leaving || inert;

  useEffect(() => {
    if (isInert) blurWithin(ref.current);
  }, [isInert]);

  if (!rendered) return null;
  const style = { '--ui-leave-ms': `${exitMs}ms` } as CSSProperties;
  return (
    <div ref={ref} className={`ui-layer ${className}${leaving ? ' is-leaving' : ''}`} style={style} inert={isInert}>
      {children}
    </div>
  );
}
