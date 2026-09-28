import type { Theme } from './types';
import { defaultTheme } from './default';

export type { Theme } from './types';

/**
 * Theme registry. To add a theme: create `themes/<id>.ts` exporting a `Theme` and add it to this map.
 * Levels reference themes by id; unknown ids fall back to 'default' at runtime, and
 * src/integration/themes.test.ts fails on any shipped level whose id is not registered here.
 */
const THEMES: Readonly<Record<string, Theme>> = {
  [defaultTheme.id]: defaultTheme,
};

/** True when `id` names a registered theme (own keys only, so 'constructor' & co. never match). */
export function hasTheme(id: string): boolean {
  return Object.hasOwn(THEMES, id);
}

export function getTheme(id: string | undefined): Theme {
  return id !== undefined && hasTheme(id) ? THEMES[id] : defaultTheme;
}

/**
 * CSS custom properties the app shell sets from the current theme: the gradient behind the transparent
 * canvas (base.css) and every UI token (ui.css).
 */
export function themeCssVars(theme: Theme): Record<`--${string}`, string> {
  const vars: Record<`--${string}`, string> = {
    '--bg-top': theme.background.top,
    '--bg-bottom': theme.background.bottom,
    '--ui-text': theme.ui.text,
    '--ui-text-soft': theme.ui.textSoft,
    '--ui-panel': theme.ui.panel,
    '--ui-panel-border': theme.ui.panelBorder,
    '--ui-accent': theme.ui.accent,
    '--ui-accent-text': theme.ui.accentText,
    '--ui-shadow': theme.ui.shadow,
  };
  // Optional token; without it ui.css derives a deep accent. (The overlay itself defines --ui-accent-strong.)
  if (theme.ui.accentDeep) vars['--ui-accent-deep'] = theme.ui.accentDeep;
  return vars;
}
