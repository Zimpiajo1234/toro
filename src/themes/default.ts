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
  /**
   * A cream cab with a soft slate stripe (the forklift's family, never a box hue), light wooden bed planks, slate trim
   * and a warm stone driveway a step below the warehouse floor. The dock sign's cells are a touch deeper than the
   * «any colour» sticker fill, so a symbol-only sticker still reads on them. The door's guard rails are a soft apricot
   * orange (hue ≈ 27°, between coral and yellow and far from both: ΔE ≥ 21 to every box tone), their post caps
   * cream.
   */
  truck: {
    cab: '#f3ece0',
    cabAccent: '#9aa9b5',
    roof: '#e2d6c3',
    glass: '#d6e0e4',
    lamp: '#fff5d6',
    deck: '#d9c29d',
    deckLine: '#c7ab82',
    trim: '#8f9ba6',
    board: '#e9e3d7',
    wheel: '#6f767c',
    hub: '#d7d2c8',
    leveller: '#b8c2cb',
    apron: '#d8cfc1',
    apronEdge: '#c8bca9',
    apronLine: '#f1ebe0',
    doorFrame: '#a9b4be',
    shutter: '#e6e1d8',
    rubber: '#8a8178',
    rail: '#eca060',
    railCap: '#f7f0e4',
  },
  /**
   * A table (H1b): a light warm top on a closed base (H1c), its side walls and its input's side guards a soft cool
   * near-black graphite («negro», L ≈ 32: the wheels' and the racks' family, never a deep black); on it a soft
   * light-grey rubber band («un gris algo más claro», L ≈ 57.5: still darker than every box face and ≥ 14.9 ΔE2000 from
   * each, so a box on it always reads) between fine warm-white rails, with white stripes (ΔL ≈ 39 over the band: the
   * motion reads), and on the input's pad the drop icon in a light cream. Identity colours (the input's pad and the end
   * exit's skirting), deeper than the pastel boxes so they never read as one: teal (hue ≈ 184°, between mint and blue
   * and far from both), plum (≈ 320°, far from red), moss and indigo. ΔE2000 ≥ 18 from every box face and zone tone
   * (≥ 11.8 from the deep lid inks), ≥ 26 from the rails and the beacon, ≥ 15.9 from the leaves, ≥ 25 from each other,
   * ≥ 18 from the band, ≥ 19.9 from the near-black; the cream icon ≥ 30 points of L over each (themes.test.ts).
   */
  conveyor: {
    belt: '#848b92',
    stripe: '#f8f6f1',
    edge: '#ebe6dc',
    top: '#e8e3da',
    side: '#474d52',
    icon: '#f6efe1',
    identity: ['#369aa1', '#a8508a', '#8f9a2c', '#4f62c4'],
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
    // Amber (hue ≈ 33°): a pale peach glass (lit, the light reads against it), and a warm light far from the yellow box
    // (#f3d47c, hue ≈ 44°) and from coral.
    beacon: '#f3d2aa',
    beaconLight: '#ffc378',
  },
  // `ink` (the large lid symbol of the sorting levels) and `engrave` (a symbol cut into a pad) are deeper tones of the
  // same hue: readable from the default camera, never black, coral kept pink so it never reads as red. `locked` (a box
  // done and fixed on its destiny, levels with storage) is base ≈ 8–9 points darker in lightness, same hue: coral turns
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
