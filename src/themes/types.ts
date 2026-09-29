import type { ColorId, SymbolId } from '../core/types';

/** Glyph shapes drawn on lids and pads: the gameplay symbols themselves (core/types SYMBOL_IDS). */
export type GlyphShape = SymbolId;

export interface BoxPalette {
  /** Main cardboard color. */
  base: string;
  /** Tape strip / edge accent, slightly deeper tone of base. */
  tape: string;
  /** Tone-on-tone glyph on the lid (accessibility, never text). */
  glyph: string;
  /**
   * The box's symbol printed large on the lid in levels that sort by symbol: a deeper tone of base (never black),
   * readable from the default camera.
   */
  ink: string;
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
  /** Floor of the symbol engraved in the pad of a zone that asks for a symbol: deeper than `glyph`, soft, never black. */
  engrave: string;
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
  /**
   * Storage racks (docs/RACKS.md): painted metal, clearly apart from the wooden shelves. `frame` = the slate uprights,
   * `beam` = the cream load beams, `panel` = the plain back and end panels (a slot's cue is drawn on them), `deck` =
   * the deck and slot floors, `line` = the loading line painted on the floor in front. Never a functional hue.
   * Cues are unlit stickers: a colour cue is the box's own `base` rimmed in its `ink`; a symbol-only cue is `cueFill`
   * rimmed in `cueRim` (neutral, never a functional hue); every glyph is `cueInk` (deep and bold, never black).
   */
  rack: {
    frame: string;
    beam: string;
    panel: string;
    deck: string;
    line: string;
    cueFill: string;
    cueRim: string;
    cueInk: string;
  };
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
  /** Pad of a zone that asks for no color (a symbol only): neutral cream / light gray, never a functional hue. */
  neutralZone: ZonePalette;
  /**
   * Color → glyph. Symbols are gameplay data now, so this must stay the canonical map (core/types DEFAULT_SYMBOL,
   * checked by src/integration/themes.test.ts); the render draws each box's own symbol.
   */
  glyphs: Readonly<Record<ColorId, GlyphShape>>;
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
