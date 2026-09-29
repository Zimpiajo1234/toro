import { DEFAULT_SYMBOL } from '../core/types';
import type { Theme } from './types';

/**
 * "Almacén de mañana" — warm cream, light wood, pastel functional colors.
 * No deep blacks, no neon, no saturated reds. Functional hues are reserved for boxes and zones.
 * Box colors are picked for how they read on screen under the warm window light (which deepens and
 * warms them): coral leans pink so it renders as a soft coral, never a red-orange.
 */
export const defaultTheme: Theme = {
  id: 'default',
  name: 'Almacén de mañana',
  background: { top: '#f6f0e6', bottom: '#eadfce' },
  floor: { base: '#ebe1d1', alt: '#e6dbc9', line: '#ddd0bc', edge: '#d3bf9f' },
  wall: { base: '#f3ece1', trim: '#dcc6a4', top: '#e8dccb' },
  window: { frame: '#d4b98f', glass: '#fff6e2', light: '#fff1d6' },
  shelf: { frame: '#cdb28a', board: '#dcc5a1', storedBoxes: ['#dfcaa8', '#e7d7bd', '#d6bf9b'] },
  /**
   * Soft slate metal with cream beams: cool where the wooden shelves are warm. Cue stickers: a cream-white «any colour»
   * fill with a warm taupe rim, and one deep warm-gray ink for every glyph (≥ 3.5:1 on each box colour, never black).
   */
  rack: {
    frame: '#95a3b0',
    beam: '#f1e5c9',
    panel: '#e8e5de',
    deck: '#b8c2cb',
    line: '#a9b4be',
    cueFill: '#fcf9f3',
    cueRim: '#b3a58f',
    cueInk: '#574e46',
  },
  plant: { pot: '#e4d8c6', soil: '#b9a488', leaves: ['#9db592', '#8aa981', '#a9c09c'] },
  forklift: {
    body: '#f7f2e9',
    accent: '#a9b6bf',
    mast: '#8f9aa3',
    fork: '#9aa3aa',
    wheel: '#6f767c',
    hub: '#d7d2c8',
    seat: '#b3a58f',
    light: '#fff5d6',
  },
  // `ink` (the large lid symbol of the sorting levels) and `engrave` (a symbol cut into a pad) are deeper tones of the
  // same hue: readable from the default camera, never black, coral kept pink so it never reads as red. `locked` (a box
  // done and fixed on its destiny, levels with racks) is base ≈ 8–9 points darker in lightness, same hue: coral turns
  // toward rose (hue ≈ 350°) and less saturated, so the deeper tone never reads as red, even in a shaded rack slot.
  boxes: {
    blue: { base: '#9bbce0', tape: '#89abd2', glyph: '#b5cdea', ink: '#5f87b8', locked: '#76a4d7' },
    mint: { base: '#92d2b6', tape: '#80c1a5', glyph: '#b1e1cb', ink: '#4f9a7b', locked: '#6cbf99' },
    yellow: { base: '#f3d47c', tape: '#e7c56a', glyph: '#f8e3a6', ink: '#c2952f', locked: '#e8c060' },
    coral: { base: '#f6b4ad', tape: '#eba39b', glyph: '#fad0cb', ink: '#d58780', locked: '#e59ea9' },
    lavender: { base: '#b8a6da', tape: '#a896cc', glyph: '#cfc2e8', ink: '#7f69ae', locked: '#9e86cd' },
  },
  zones: {
    blue: { fill: '#c9dbee', border: '#9dbde0', glow: '#b7d3f2', glyph: '#a7c4e4', engrave: '#86a8d0' },
    mint: { fill: '#c8eadb', border: '#9ad7bd', glow: '#b3f0d6', glyph: '#a5dcc4', engrave: '#7cc0a2' },
    yellow: { fill: '#f7e6b8', border: '#f0d185', glow: '#fbe7a8', glyph: '#f1d792', engrave: '#dcb760' },
    coral: { fill: '#f7d5ce', border: '#f0b0a5', glow: '#fbcdc4', glyph: '#f2bbb0', engrave: '#e4a097' },
    lavender: { fill: '#ddd5ef', border: '#bfb0e0', glow: '#d6c9f6', glyph: '#c6b9e3', engrave: '#a797cf' },
  },
  /** "Any box with this symbol": light cream pad with warm gray tape, a taupe engraving. */
  neutralZone: { fill: '#f4efe7', border: '#d6c9b4', glow: '#fff1d8', glyph: '#e6dccd', engrave: '#c2b095' },
  glyphs: DEFAULT_SYMBOL,
  lighting: {
    hemiSky: '#fff8ee',
    hemiGround: '#dccfbb',
    hemiIntensity: 1.25,
    sun: '#fff0da',
    sunIntensity: 1.9,
    exposure: 1.0,
  },
  ui: {
    text: '#5c534a',
    // ≥ 4.5:1 on the frosted panels (≈ 5:1) and ≈ 4.2:1 on the raw background; text stays darker.
    textSoft: '#70675d',
    panel: 'rgba(250, 246, 239, 0.82)',
    panelBorder: 'rgba(210, 196, 175, 0.55)',
    /** The blue box base, so the title mark and done dots match the boxes. */
    accent: '#9bbce0',
    /** Same hue, 4.9:1 with the white button label. */
    accentDeep: '#4a73a0',
    accentText: '#ffffff',
    shadow: 'rgba(120, 100, 75, 0.12)',
  },
};
