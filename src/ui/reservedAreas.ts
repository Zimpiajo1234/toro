import { createContext, useCallback, useContext, type RefCallback } from 'react';
import type { ScreenInsets } from './uiState';

/** The screen edge an overlay piece is anchored to: it reserves the band from that edge to its far side. */
export type ScreenEdge = 'top' | 'right' | 'bottom' | 'left';

/** A layout box in the overlay's coordinates (CSS px from its top-left corner). */
export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An overlay piece's box and the screen edge it is anchored to. */
export interface ReservedBox {
  edge: ScreenEdge;
  box: LayoutBox;
}

/**
 * The bands that keep every box clear, in a `width` × `height` overlay: a top box reserves down to its bottom edge, a
 * bottom box up to its top edge, and so on. Empty boxes (not laid out) reserve nothing.
 */
export function insetsOf(
  pieces: Iterable<ReservedBox>,
  width: number,
  height: number,
  out: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 },
): ScreenInsets {
  out.top = out.right = out.bottom = out.left = 0;
  for (const { edge, box } of pieces) {
    if (box.width <= 0 || box.height <= 0) continue;
    if (edge === 'top') out.top = Math.max(out.top, box.y + box.height);
    else if (edge === 'bottom') out.bottom = Math.max(out.bottom, height - box.y);
    else if (edge === 'left') out.left = Math.max(out.left, box.x + box.width);
    else out.right = Math.max(out.right, width - box.x);
  }
  out.top = clampBand(out.top, height);
  out.bottom = clampBand(out.bottom, height);
  out.left = clampBand(out.left, width);
  out.right = clampBand(out.right, width);
  return out;
}

const clampBand = (px: number, size: number): number => Math.ceil(Math.min(Math.max(px, 0), Math.max(size, 0)));

/**
 * 'track': report what the reserved pieces cover when a level starts, and again on a viewport resize (playing).
 * 'hold': keep the last report (the completion card is up: the hint has left, but the camera should not move under the
 * card). 'clear': nothing is reserved (title, loading).
 */
export type ReserveMode = 'track' | 'hold' | 'clear';

interface Entry extends ReservedBox {
  /** Its box has been read once (its first ResizeObserver callback): until then it holds the report back. */
  measured: boolean;
}

/**
 * The overlay pieces that stay over the scene while playing (HUD pills, control hint) and the screen bands they
 * cover, reported to the game so the camera frames the level clear of them.
 * The camera never reframes on its own, so a level's bands are reported once, as the level starts (entering 'track',
 * or a new level while tracking: a level jump), and again only when the viewport resizes. A piece that changes size
 * mid-level (a hint row or its wording, a pill appearing, fonts) is measured but not reported: the level stays clear
 * of the pieces as they were when it started, and the next level or resize takes the change.
 * Measured on change: one ResizeObserver watches the overlay root (viewport, orientation, safe areas) and every piece;
 * its callback runs after layout, so reading the boxes never forces one. A level start reads them at once (after the
 * commit: a piece that changed size with the level is never taken as it was). Boxes are layout boxes (offsetTop /
 * offsetHeight up to the root): enter / leave animations (translate) never disturb them.
 */
export class ReservedAreas {
  private readonly entries = new Map<HTMLElement, Entry>();
  private root: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  private sink: ((insets: ScreenInsets) => void) | null = null;
  private mode: ReserveMode = 'clear';
  /** The level on screen (setMode): a new one while tracking takes its bands afresh. */
  private level: unknown = null;
  /** Tracking, and this level's bands are reported: piece changes wait for the next level or a resize. */
  private settled = false;
  /** The root's size at the last measurement (-1: none yet): a change is a viewport resize. */
  private rootWidth = -1;
  private rootHeight = -1;
  private readonly measured: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private readonly reported: ScreenInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  /** The overlay root (null on unmount): coordinates and the viewport size are taken from it. */
  setRoot(root: HTMLElement | null): void {
    if (root === this.root) return;
    this.observer?.disconnect();
    this.observer = null;
    this.root = root;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(this.onResize);
    observer.observe(root);
    for (const el of this.entries.keys()) observer.observe(el, { box: 'border-box' });
    this.observer = observer;
  }

  /** Where reports go (null: nowhere). A new sink gets the current bands at once. */
  connect(sink: ((insets: ScreenInsets) => void) | null): void {
    this.sink = sink;
    if (sink) sink({ ...this.reported });
  }

  /**
   * The screen's reserve mode, and `level`: the level on screen (any value, compared with ===). Entering 'track', or a
   * new `level` while tracking (a level jump), starts a level: its bands are read at once and reported. Call after the
   * DOM commit (a layout effect), so the level's pieces are laid out and its bands reach the camera before its first
   * frame is painted.
   */
  setMode(mode: ReserveMode, level: unknown = null): void {
    const starts = mode === 'track' && (this.mode !== 'track' || level !== this.level);
    this.level = level;
    if (mode === this.mode && !starts) return;
    this.mode = mode;
    if (!starts) {
      this.publish();
      return;
    }
    this.settled = false;
    this.measure();
    this.recompute();
  }

  add(el: HTMLElement, edge: ScreenEdge): void {
    this.entries.set(el, { edge, box: { x: 0, y: 0, width: 0, height: 0 }, measured: false });
    // Its first observation measures it (after layout); nothing is read here, mid-commit.
    this.observer?.observe(el, { box: 'border-box' });
  }

  remove(el: HTMLElement): void {
    if (!this.entries.delete(el)) return;
    this.observer?.unobserve(el);
    // The others' boxes are still current: recompute from them, no layout read.
    this.recompute();
  }

  private readonly onResize = (): void => {
    const root = this.root;
    if (!root) return;
    // The viewport changed (not only a piece): its bands are taken again, as when a level starts.
    if (root.clientWidth !== this.rootWidth || root.clientHeight !== this.rootHeight) this.settled = false;
    this.measure();
    this.recompute();
  };

  /** Read every piece's box and the root's size (after layout). */
  private measure(): void {
    const root = this.root;
    if (!root) return;
    this.rootWidth = root.clientWidth;
    this.rootHeight = root.clientHeight;
    for (const [el, entry] of this.entries) {
      layoutBox(el, root, entry.box);
      entry.measured = true;
    }
  }

  private recompute(): void {
    const root = this.root;
    if (!root) return;
    insetsOf(this.entries.values(), root.clientWidth, root.clientHeight, this.measured);
    this.publish();
  }

  private publish(): void {
    if (this.mode === 'hold') return;
    if (this.mode === 'track') {
      // The level has its bands: the camera keeps them (it never reframes on its own) until the next level or a resize.
      if (this.settled) return;
      // A piece just mounted and not measured yet: wait for it (its observation is due before the next paint).
      for (const entry of this.entries.values()) if (!entry.measured) return;
      this.settled = true;
    }
    const next = this.mode === 'track' ? this.measured : CLEAR;
    const last = this.reported;
    if (next.top === last.top && next.right === last.right && next.bottom === last.bottom && next.left === last.left) return;
    Object.assign(last, next);
    this.sink?.({ ...last });
  }
}

const CLEAR: Readonly<ScreenInsets> = { top: 0, right: 0, bottom: 0, left: 0 };

/** `el`'s layout box relative to `root` (offset chain: transforms and translate animations are ignored). */
function layoutBox(el: HTMLElement, root: HTMLElement, out: LayoutBox): LayoutBox {
  // Not laid out (display: none, detached): reserves nothing.
  if (el.offsetParent === null) {
    out.width = out.height = 0;
    return out;
  }
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  out.x = x;
  out.y = y;
  out.width = el.offsetWidth;
  out.height = el.offsetHeight;
  return out;
}

const ReservedAreasContext = createContext<ReservedAreas | null>(null);

/** Provided by the Overlay: the registry every reserved piece joins (useReservedArea). */
export const ReservedAreasProvider = ReservedAreasContext.Provider;

/**
 * Ref for an overlay piece that stays over the scene while playing, anchored to `edge` of the screen: the camera
 * frames the level clear of the band from that edge to the piece's far side. A new HUD pill inside a `.hud__corner`
 * is covered already; one anywhere else takes this ref too.
 */
export function useReservedArea<T extends HTMLElement>(edge: ScreenEdge): RefCallback<T> {
  const areas = useContext(ReservedAreasContext);
  return useCallback<RefCallback<T>>(
    (el) => {
      if (!el || !areas) return undefined;
      areas.add(el, edge);
      return () => areas.remove(el);
    },
    [areas, edge],
  );
}
