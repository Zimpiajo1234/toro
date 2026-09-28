import type { ColorId } from '../core/types';

export type GlyphShape = 'circle' | 'triangle' | 'square' | 'diamond' | 'cross';

export interface BoxPalette {
  /** Main cardboard color. */
  base: string;
  /** Tape strip / edge accent, slightly deeper tone of base. */
  tape: string;
  /** Tone-on-tone glyph on the lid (accessibility, never text). */
  glyph: string;
}

export interface ZonePalette {
  /** Floor pad fill. */
  fill: string;
  /** Inset "tape" border of the pad. */
  border: string;
  /** Emissive glow color when satisfied. */
  glow: string;
  /** Glyph painted in the center of the pad. */
  glyph: string;
}

/** A visual theme. Add new themes as new files and add them to the `THEMES` map in themes/index.ts. */
export interface Theme {
  id: string;
  name: string;
  /** CSS gradient painted behind the (transparent) WebGL canvas. */
  background: { top: string; bottom: string };
  floor: { base: string; alt: string; line: string; edge: string };
  wall: { base: string; trim: string; top: string };
  window: { frame: string; glass: string; light: string };
  shelf: { frame: string; board: string; storedBoxes: string[] };
  plant: { pot: string; soil: string; leaves: string[] };
  forklift: {
    body: string;
    accent: string;
    mast: string;
    fork: string;
    wheel: string;
    hub: string;
    seat: string;
    light: string;
  };
  boxes: Record<ColorId, BoxPalette>;
  zones: Record<ColorId, ZonePalette>;
  glyphs: Record<ColorId, GlyphShape>;
  lighting: {
    hemiSky: string;
    hemiGround: string;
    hemiIntensity: number;
    sun: string;
    sunIntensity: number;
    exposure: number;
  };
  /** UI tokens, exposed to CSS as custom properties by the app shell. */
  ui: {
    text: string;
    textSoft: string;
    panel: string;
    panelBorder: string;
    /** Soft fills: done level dots, the new-best tag, the title mark's box. */
    accent: string;
    /** Deep accent behind `accentText` (primary buttons, ≥ 4.5:1). Optional: ui.css derives one from `accent`. */
    accentDeep?: string;
    accentText: string;
    shadow: string;
  };
}
