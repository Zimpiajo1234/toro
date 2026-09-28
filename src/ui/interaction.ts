import { useEffect, type RefObject } from 'react';
import type { Store } from '../core/store';
import type { Screen, UIState } from './uiState';

/**
 * Runs `fn` only while the store still shows `screen`. The game also binds hotkeys (Enter, R) that
 * may fire on the same key press as a focused button; the first handler changes the screen
 * synchronously, so the second one becomes a no-op instead of skipping a level.
 */
export function onScreen(store: Store<UIState>, screen: Screen, fn: () => void): void {
  if (store.get().screen === screen) fn();
}

/** Drops focus if it sits inside `root` (e.g. a panel fading out), so game keys reach the game again. */
export function blurWithin(root: HTMLElement | null): void {
  const active = document.activeElement;
  if (root && active instanceof HTMLElement && root.contains(active)) active.blur();
}

/** Focuses the element when `active` turns true (primary buttons: Enter / Space just work). */
export function useAutoFocus(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (active) ref.current?.focus({ preventScroll: true });
  }, [ref, active]);
}
