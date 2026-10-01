import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReservedAreas, insetsOf, type ReservedBox } from './reservedAreas';
import type { ScreenInsets } from './uiState';

const box = (edge: ReservedBox['edge'], x: number, y: number, width: number, height: number): ReservedBox => ({
  edge,
  box: { x, y, width, height },
});

describe('insetsOf', () => {
  it('reserves each band from its screen edge to the far side of its pieces', () => {
    const insets = insetsOf(
      [
        // HUD corners (44 px pills 28 px down), the two-row hint (83 px tall, 40 px up from the bottom).
        box('top', 28, 28, 150, 44),
        box('top', 1172, 28, 80, 44),
        box('bottom', 385, 677, 509, 83),
        box('left', 0, 300, 120, 200),
        box('right', 1200, 300, 80, 200),
      ],
      1280,
      800,
    );
    expect(insets).toEqual({ top: 72, right: 80, bottom: 123, left: 120 });
  });

  it('ignores pieces that are not laid out and never reserves more than the screen', () => {
    expect(insetsOf([box('bottom', 0, 0, 0, 0), box('top', 0, 0, 10, 0)], 1280, 800)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
    expect(insetsOf([box('top', 0, 700, 100, 300), box('bottom', 0, -50, 100, 60)], 400, 800)).toEqual({
      top: 800,
      right: 0,
      bottom: 800,
      left: 0,
    });
  });
});

/** A laid-out element: its layout box relative to the root (its offset parent). */
function piece(root: object, x: number, y: number, width: number, height: number) {
  return { offsetParent: root, offsetLeft: x, offsetTop: y, offsetWidth: width, offsetHeight: height } as unknown as HTMLElement;
}

describe('ReservedAreas', () => {
  let fire: () => void = () => {};
  class FakeResizeObserver {
    constructor(callback: () => void) {
      fire = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const root = { clientWidth: 1280, clientHeight: 800 } as unknown as HTMLElement;
    const areas = new ReservedAreas();
    const reports: ScreenInsets[] = [];
    areas.connect((insets) => reports.push(insets));
    areas.setRoot(root);
    return { root, areas, reports };
  }

  it('reports a level’s bands as it starts, holds them under the card, clears on the title', () => {
    const { root, areas, reports } = setup();
    expect(reports).toEqual([{ top: 0, right: 0, bottom: 0, left: 0 }]); // connect: the current bands at once
    const hud = piece(root, 28, 28, 150, 44);
    const hint = piece(root, 385, 717, 509, 43);
    areas.add(hud, 'top');
    areas.add(hint, 'bottom');
    // Nothing is read as they mount (mid-commit)…
    expect(reports).toHaveLength(1);
    // …the level start reads them (after the commit), at once.
    areas.setMode('track', 1);
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 83, left: 0 });
    fire(); // their first observations: the same boxes, no report
    expect(reports).toHaveLength(2);

    // Completion card: the hint leaves, the bands stay.
    areas.setMode('hold', 1);
    areas.remove(hint);
    expect(reports).toHaveLength(2);

    // Next level, with racks: its two-row hint mounts, and the level start reads it at once.
    const next = piece(root, 385, 677, 509, 83);
    areas.add(next, 'bottom');
    areas.setMode('track', 2);
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 123, left: 0 });
    fire();
    expect(reports).toHaveLength(3);

    // "Repetir" from its card: the same bands, nothing new to report.
    areas.setMode('hold', 2);
    areas.setMode('track', 2);
    expect(reports).toHaveLength(3);

    areas.setMode('clear', 2);
    expect(reports.at(-1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(reports).toHaveLength(4);
  });

  it('never re-reports mid-level: a piece that changes size waits for the next level or a resize', () => {
    const { root, areas, reports } = setup();
    const hud = piece(root, 28, 28, 150, 44);
    const hint = piece(root, 385, 717, 509, 43);
    areas.add(hud, 'top');
    areas.add(hint, 'bottom');
    areas.setMode('track', 1);
    fire();
    expect(reports).toHaveLength(2);
    // A second hint row or new wording, the HUD corner growing (a pill steps under another), a pill mounting and
    // leaving again, a restart of the same level: the camera keeps the level's bands.
    Object.assign(hint, { offsetTop: 677, offsetHeight: 83 });
    fire();
    Object.assign(hud, { offsetHeight: 92 });
    fire();
    const pill = piece(root, 600, 28, 80, 140);
    areas.add(pill, 'top');
    fire();
    areas.remove(pill);
    areas.setMode('track', 1);
    expect(reports).toHaveLength(2);
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 83, left: 0 });

    // A resize takes the pieces as they are now.
    Object.assign(root, { clientHeight: 780 });
    fire();
    expect(reports.at(-1)).toEqual({ top: 120, right: 0, bottom: 103, left: 0 });
    // …and the level keeps those.
    Object.assign(hint, { offsetTop: 717, offsetHeight: 43 });
    fire();
    expect(reports).toHaveLength(3);
  });

  it('takes a new level’s bands at once while playing ("Modo prueba" jumps), read after the commit', () => {
    const { root, areas, reports } = setup();
    const hint = piece(root, 385, 717, 509, 43);
    areas.add(piece(root, 28, 28, 150, 44), 'top');
    areas.add(hint, 'bottom');
    areas.setMode('track', 3);
    fire();
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 83, left: 0 });
    // The next level has racks: the same hint element gains its fork row in the jump's commit, before any observation.
    Object.assign(hint, { offsetTop: 677, offsetHeight: 83 });
    areas.setMode('track', 4);
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 123, left: 0 });
    fire(); // its observation arrives later: the same box, nothing new
    expect(reports).toHaveLength(3);
  });

  it('hands a new sink the current bands (a remounted game), and follows the viewport', () => {
    const { root, areas } = setup();
    areas.add(piece(root, 385, 717, 509, 43), 'bottom');
    areas.setMode('track');
    fire();
    const late: ScreenInsets[] = [];
    areas.connect((insets) => late.push(insets));
    expect(late).toEqual([{ top: 0, right: 0, bottom: 83, left: 0 }]);
    // Orientation change: the root resizes (the band is measured against the root's new height).
    Object.assign(root, { clientWidth: 375, clientHeight: 812 });
    fire();
    expect(late.at(-1)).toEqual({ top: 0, right: 0, bottom: 95, left: 0 });
  });
});
