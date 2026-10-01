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
  /**
   * Levels with storage: the box once it is done and fixed on its destined zone or slot (BoxState.locked). A
   * deeper tone of `base` (same hue, never black, never red): the whole box eases toward it (render scales every
   * painted tone by `locked / base`, so the tape and the symbol keep their contrast).
   */
  locked: string;
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
   * `beam` = the cream load beams, `panel` = the plain back panels and the faint see-through end plates (a slot's cue
   * is drawn on them), `deck` = the deck and slot floors, `line` = the loading line painted on the floor in front.
   * Never a functional hue.
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
  /**
   * Loading docks (docs/DOCKS.md): the dock door in its wall, the sign over it and the truck parked outside. Soft, never
   * a functional hue (the box colours) and never red. `cab` / `cabAccent` (a stripe) / `roof` = the cab, `glass` its
   * windows, `lamp` its headlights; `deck` / `deckLine` = the wooden bed planks and their seams; `trim` = the bed's
   * rear sill and the caps of its drop sides, the headboard's posts and cap, chassis, bumpers, grille and mirrors, the
   * dock plate's hinge and treads; `board` = the plain panels of the drop sides and the headboard, and the cells of the
   * dock sign (its stickers are Theme.rack.cue*, like a rack's); `wheel` / `hub`; `leveller` = the dock plate in the
   * door (from the floor onto the bed); `apron` / `apronEdge` / `apronLine` = the driveway outside, the face of the dock
   * pit and its painted guide lines; `doorFrame` / `shutter` = the door opening's frame (and the dock sign's frame)
   * and its rolled-up door; `rubber` = the dock seals and bumpers (warm deep gray, never black); `rail` / `railCap` =
   * the low guard rails on both sides of the door (posts and bars: a soft cozy orange, clearly none of the box colours
   * and never red) and the cream caps of their posts.
   */
  truck: {
    cab: string;
    cabAccent: string;
    roof: string;
    glass: string;
    lamp: string;
    deck: string;
    deckLine: string;
    trim: string;
    board: string;
    wheel: string;
    hub: string;
    leveller: string;
    apron: string;
    apronEdge: string;
    apronLine: string;
    doorFrame: string;
    shutter: string;
    rubber: string;
    rail: string;
    railCap: string;
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
    /** The glass of the reverse beacon on the roof (views/ForkliftView) while it is off: lit and shaded like the body. */
    beacon: string;
    /**
     * The beacon's warm amber light while backing up: its lit lens, the two soft beams turning round it and the faint
     * glow on the floor behind. Cozy, pastel-leaning: clearly apart from the yellow box, never red.
     */
    beaconLight: string;
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
