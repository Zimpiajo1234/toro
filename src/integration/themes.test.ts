/**
 * Integration check (levels × themes × shell): every shipped level names a registered theme (a typo would
 * otherwise fall back to 'default' silently), themes keep the gameplay symbols canonical, and the shell exposes
 * every UI token of a theme to CSS.
 */
import { describe, expect, it } from 'vitest';
import { COLOR_IDS, DEFAULT_SYMBOL } from '../core/types';
import { LEVELS } from '../data/levels';
import { getTheme, hasTheme, themeCssVars } from '../themes';
import { defaultTheme } from '../themes/default';

/** sRGB hex → CIE L*a*b* (D65). */
function lab(hex: string): [number, number, number] {
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const chroma = (hex: string) => Math.hypot(lab(hex)[1], lab(hex)[2]);

/** The CIEDE2000 colour difference of two sRGB hex colours. */
function deltaE2000(c1: string, c2: string): number {
  const [L1, a1, b1] = lab(c1);
  const [L2, a2, b2] = lab(c2);
  const rad = Math.PI / 180;
  const Cb = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const [a1p, a2p] = [(1 + G) * a1, (1 + G) * a2];
  const [C1p, C2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const [h1p, h2p] = [(Math.atan2(b1, a1p) / rad + 360) % 360, (Math.atan2(b2, a2p) / rad + 360) % 360];
  let dh = h2p - h1p;
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  const hb = (h1p + h2p) / 2 + (Math.abs(h1p - h2p) > 180 ? 180 : 0);
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hb - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** HSL hue of an sRGB hex colour, in degrees. */
function hslHue(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

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

  it('keeps symbols gameplay data: every theme draws the canonical color → symbol map, and has the sorting tones', () => {
    for (const theme of [defaultTheme, ...LEVELS.map((l) => getTheme(l.theme))]) {
      expect(theme.glyphs).toEqual(DEFAULT_SYMBOL);
      for (const c of COLOR_IDS) {
        expect(theme.boxes[c].ink).toMatch(/^#[0-9a-f]{6}$/i);
        expect(theme.zones[c].engrave).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // The neutral pad is none of the functional hues.
      const neutral = theme.neutralZone;
      for (const c of COLOR_IDS) expect(neutral.fill).not.toBe(theme.zones[c].fill);
      expect(neutral.engrave).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('gives conveyor belts identity colours of their own: apart from every box and zone tone, the rails, the beacon, the plants and each other; never red', () => {
    const t = defaultTheme;
    const palette = t.conveyor.identity;
    expect(palette.length).toBeGreaterThanOrEqual(4);
    const faces = COLOR_IDS.flatMap((c) => [t.boxes[c].base, t.boxes[c].tape, t.boxes[c].glyph, t.boxes[c].locked, ...Object.values(t.zones[c])]);
    const furniture = [t.truck.rail, t.forklift.beacon, t.forklift.beaconLight, ...t.plant.leaves];
    for (const c of palette) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Math.min(...faces.map((f) => deltaE2000(c, f))), c).toBeGreaterThan(17);
      expect(Math.min(...COLOR_IDS.map((k) => deltaE2000(c, t.boxes[k].ink))), c).toBeGreaterThan(11);
      expect(Math.min(...furniture.map((f) => deltaE2000(c, f))), c).toBeGreaterThan(15);
      // Never red: its hue well away from red's, whatever its saturation.
      const hue = hslHue(c);
      expect(Math.min(hue, 360 - hue), c).toBeGreaterThan(30);
    }
    palette.forEach((a, i) => palette.slice(i + 1).forEach((b) => expect(deltaE2000(a, b), `${a} ${b}`).toBeGreaterThan(20)));
    // The band itself is a quiet graphite, nothing like a box: low chroma, darker than every box face.
    expect(chroma(t.conveyor.belt)).toBeLessThan(6);
    for (const f of faces) expect(lab(t.conveyor.belt)[0]).toBeLessThan(lab(f)[0] - 15);
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
