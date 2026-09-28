/**
 * Integration check (levels × themes × shell): every shipped level names a registered theme (a typo would
 * otherwise fall back to 'default' silently), and the shell exposes every UI token of a theme to CSS.
 */
import { describe, expect, it } from 'vitest';
import { LEVELS } from '../data/levels';
import { getTheme, hasTheme, themeCssVars } from '../themes';
import { defaultTheme } from '../themes/default';

describe('themes', () => {
  it.each(LEVELS.map((l) => [l.id, l.theme] as const))('level %s uses a registered theme (%s)', (_id, theme) => {
    expect(hasTheme(theme)).toBe(true);
    expect(getTheme(theme).id).toBe(theme);
  });

  it('falls back to the default theme for missing or unknown ids, never to prototype keys', () => {
    expect(getTheme(undefined)).toBe(defaultTheme);
    expect(getTheme('')).toBe(defaultTheme);
    expect(getTheme('no-such-theme')).toBe(defaultTheme);
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(hasTheme(key)).toBe(false);
      expect(getTheme(key)).toBe(defaultTheme);
    }
  });

  it('maps the background and every UI token to a CSS custom property', () => {
    const vars = themeCssVars(defaultTheme);
    expect(vars['--bg-top']).toBe(defaultTheme.background.top);
    expect(vars['--bg-bottom']).toBe(defaultTheme.background.bottom);
    const kebab = (k: string) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    for (const [key, value] of Object.entries(defaultTheme.ui)) expect(vars[`--ui-${kebab(key)}`]).toBe(value);
    expect(Object.keys(vars)).toHaveLength(2 + Object.keys(defaultTheme.ui).length);
  });
});
