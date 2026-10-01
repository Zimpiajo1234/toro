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

  it('reports on change only: tracks while playing, holds under the card, clears on the title', () => {
    const { root, areas, reports } = setup();
    expect(reports).toEqual([{ top: 0, right: 0, bottom: 0, left: 0 }]); // connect: the current bands at once
    const hud = piece(root, 28, 28, 150, 44);
    const hint = piece(root, 385, 717, 509, 43);
    areas.add(hud, 'top');
    areas.add(hint, 'bottom');
    areas.setMode('track');
    // Nothing is read before the pieces' first observation.
    expect(reports).toHaveLength(1);
    fire();
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 83, left: 0 });
    fire(); // same boxes: no report
    expect(reports).toHaveLength(2);

    // A second hint row (a level with racks).
    Object.assign(hint, { offsetTop: 677, offsetHeight: 83 });
    fire();
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 123, left: 0 });

    // Completion card: the hint leaves, the bands stay.
    areas.setMode('hold');
    areas.remove(hint);
    expect(reports).toHaveLength(3);

    // Next level: a new hint mounts; the report waits until it is measured.
    const next = piece(root, 385, 717, 509, 43);
    areas.add(next, 'bottom');
    areas.setMode('track');
    expect(reports).toHaveLength(3);
    fire();
    expect(reports.at(-1)).toEqual({ top: 72, right: 0, bottom: 83, left: 0 });

    areas.setMode('clear');
    expect(reports.at(-1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(reports).toHaveLength(5);
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
