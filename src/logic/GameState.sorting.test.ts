import { describe, expect, it } from 'vitest';
import {
  accepts,
  assignBoxes,
  criteriaOf,
  fitsLevel,
  matchKind,
  specificity,
  takesNext,
  usesSymbols,
  zoneMatchKinds,
  type Sortable,
} from '../core/sorting';
import {
  COLOR_IDS,
  DEFAULT_SYMBOL,
  SYMBOL_IDS,
  cellToWorld,
  type CellPos,
  type GameEvent,
  type LevelData,
  type ZoneCriteria,
  type ZoneState,
} from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { validateLevel } from '../data/validateLevel';
import { LEVELS } from '../data/levels';
import { GameState } from './GameState';
import { DT, IDLE, makeLevel, press, types } from './testUtils';

type BoxSpec = [id: string, color: string, symbol: string | null, x: number, z: number];
type ZoneSpec = [id: string, color: string | null, symbol: string | null, x: number, z: number];

/** 7×5 floor, forklift on (3,2) = world (0,0) facing `heading`°. Null color / symbol = not given. */
function sortLevel(heading: number, boxes: BoxSpec[], zones: ZoneSpec[], extra: Record<string, unknown> = {}): LevelData {
  return makeLevel({
    forklift: { x: 3, z: 2, heading },
    boxes: boxes.map(([id, color, symbol, x, z]) => ({ id, color, ...(symbol ? { symbol } : {}), x, z })),
    zones: zones.map(([id, color, symbol, x, z]) => ({ id, ...(color ? { color } : {}), ...(symbol ? { symbol } : {}), x, z })),
    ...extra,
  });
}

const eventOf = <T extends GameEvent['type']>(events: GameEvent[], type: T) => {
  const e = events.find((ev): ev is Extract<GameEvent, { type: T }> => ev.type === type);
  if (!e) throw new Error(`no ${type} event in [${types(events).join(', ')}]`);
  return e;
};

/**
 * Put the forklift on the cell before `cell` (seen along `heading`°), facing it, so the fork point sits over `cell`;
 * one idle frame lets the hint (and a carried box) follow. The simulation's own driving is covered elsewhere: these
 * tests are about who accepts what.
 */
function faceCell(state: GameState, cell: CellPos, heading: number): void {
  const snap = state.getSnapshot();
  const h = (heading * Math.PI) / 180;
  const c = cellToWorld(cell, snap.level.size);
  snap.forklift.pos.x = c.x - Math.sin(h);
  snap.forklift.pos.z = c.z - Math.cos(h);
  snap.forklift.heading = h;
  snap.forklift.speed = 0;
  state.update(DT, IDLE);
}

describe('acceptance (core/sorting)', () => {
  const box = (color: Sortable['color'], symbol: Sortable['symbol']): Sortable => ({ color, symbol });

  it('a zone accepts a box iff the box meets every criterion it declares', () => {
    const anyBlue: ZoneCriteria = { color: 'blue' };
    const anyTriangle: ZoneCriteria = { symbol: 'triangle' };
    const blueSquare: ZoneCriteria = { color: 'blue', symbol: 'square' };
    // [zone, box, accepted]
    const matrix: [ZoneCriteria, Sortable, boolean][] = [
      [anyBlue, box('blue', 'circle'), true],
      [anyBlue, box('blue', 'triangle'), true],
      [anyBlue, box('mint', 'circle'), false],
      [anyTriangle, box('mint', 'triangle'), true],
      [anyTriangle, box('blue', 'triangle'), true],
      [anyTriangle, box('blue', 'circle'), false],
      [blueSquare, box('blue', 'square'), true],
      [blueSquare, box('blue', 'circle'), false],
      [blueSquare, box('yellow', 'square'), false],
      [blueSquare, box('mint', 'triangle'), false],
    ];
    for (const [criteria, b, expected] of matrix) expect(accepts({ accepts: criteria }, b), `${JSON.stringify(criteria)} ← ${b.color} ${b.symbol}`).toBe(expected);
    // Every color × symbol against every single-criterion zone: exactly the matching ones.
    for (const color of COLOR_IDS)
      for (const symbol of SYMBOL_IDS)
        for (const c of COLOR_IDS) {
          expect(accepts({ accepts: { color: c } }, box(color, symbol))).toBe(c === color);
          expect(accepts({ accepts: { symbol: SYMBOL_IDS[COLOR_IDS.indexOf(c)] } }, box(color, symbol))).toBe(SYMBOL_IDS[COLOR_IDS.indexOf(c)] === symbol);
        }
  });

  it('ranks the exact zone above a single criterion and names the kind of match', () => {
    expect(specificity({ color: 'blue', symbol: 'square' })).toBe(2);
    expect(specificity({ color: 'blue' })).toBe(1);
    expect(specificity({ symbol: 'square' })).toBe(1);
    expect(matchKind({ color: 'blue' })).toBe('color');
    expect(matchKind({ symbol: 'cross' })).toBe('symbol');
    expect(matchKind({ color: 'mint', symbol: 'cross' })).toBe('exact');
  });

  it('takesNext: an empty zone that accepts the box, or a stack zone whose recipe needs its color next', () => {
    const zone = (accepts: ZoneCriteria, stack: string[] = [], next: ZoneState['next'] = null) => ({ accepts, stack, next });
    expect(takesNext(zone({ symbol: 'triangle' }), box('coral', 'triangle'))).toBe(true);
    expect(takesNext(zone({ symbol: 'triangle' }, ['x']), box('coral', 'triangle'))).toBe(false);
    expect(takesNext(zone({ color: 'blue', symbol: 'square' }, [], 'blue'), box('blue', 'circle'))).toBe(false);
    // A [blue, mint] stack zone holding its blue base takes any mint box next (recipes are color-only).
    expect(takesNext(zone({ color: 'blue' }, ['b'], 'mint'), box('mint', 'cross'))).toBe(true);
    expect(takesNext(zone({ color: 'blue' }, ['b'], 'mint'), box('blue', 'circle'))).toBe(false);
    const stackZone = { accepts: { color: 'blue' } as ZoneCriteria, recipe: ['blue', 'mint'] as ZoneState['recipe'] };
    expect(fitsLevel(stackZone, 0, box('blue', 'square'))).toBe(true);
    expect(fitsLevel(stackZone, 1, box('mint', 'circle'))).toBe(true);
    expect(fitsLevel(stackZone, 1, box('blue', 'circle'))).toBe(false);
    expect(fitsLevel(stackZone, 2, box('mint', 'circle'))).toBe(false);
  });

  it('assignBoxes finds a complete sorting through augmenting paths, and names a stranded box', () => {
    // Greedy would put blue ▲ in "any blue" (listed first) and strand blue ●; the augmenting path moves it on.
    const zones: ZoneCriteria[] = [{ color: 'blue' }, { symbol: 'triangle' }];
    expect(assignBoxes([box('blue', 'triangle'), box('blue', 'circle')], zones)).toEqual([1, 0]);
    expect(assignBoxes([box('blue', 'square'), box('blue', 'circle')], zones)).toEqual([0, -1]);
    expect(assignBoxes([], zones)).toEqual([]);
  });
});

describe('validateLevel: sorting', () => {
  const base = {
    id: 't',
    order: 1,
    name: 'T',
    size: { width: 7, depth: 5 },
    forklift: { x: 0, z: 0, heading: 0 },
    shelves: [],
    decor: { plants: [], windows: [] },
  };
  const v = (spec: Record<string, unknown>) => validateLevel({ ...base, ...spec }, 't');
  const two = [
    { id: 'a', color: 'blue', symbol: 'triangle', x: 2, z: 2 },
    { id: 'b', color: 'blue', symbol: 'circle', x: 3, z: 2 },
  ];

  it('accepts color-only, symbol-only and exact zones; boxes carry an explicit or their default symbol', () => {
    const level = v({
      boxes: [...two, { id: 'c', color: 'mint', x: 4, z: 2 }],
      zones: [
        { id: 'z1', color: 'blue', x: 1, z: 4 },
        { id: 'z2', symbol: 'triangle', x: 3, z: 4 },
        { id: 'z3', color: 'mint', symbol: 'triangle', x: 5, z: 4 },
      ],
    });
    expect(usesSymbols(level)).toBe(true);
    expect(level.zones.map(criteriaOf)).toEqual([{ color: 'blue' }, { symbol: 'triangle' }, { color: 'mint', symbol: 'triangle' }]);
    expect(level.boxes[2]).not.toHaveProperty('symbol');
    expect(new GameState(level).getSnapshot().boxes.map((b) => b.symbol)).toEqual(['triangle', 'circle', DEFAULT_SYMBOL.mint]);
    expect(zoneMatchKinds(level)).toEqual(new Map([['z1', 'color'], ['z2', 'symbol'], ['z3', 'exact']]));
  });

  it('rejects zones that accept nothing and unknown symbols', () => {
    expect(() => v({ boxes: two, zones: [{ id: 'z', x: 4, z: 4 }, { id: 'y', color: 'blue', x: 5, z: 4 }] })).toThrow(/must accept something/);
    expect(() => v({ boxes: two, zones: [{ id: 'z', symbol: 'star', x: 4, z: 4 }, { id: 'y', color: 'blue', x: 5, z: 4 }] })).toThrow(/unknown symbol "star"/);
    expect(() =>
      v({ boxes: [{ id: 'a', color: 'blue', symbol: 'heart', x: 2, z: 2 }], zones: [{ id: 'z', color: 'blue', x: 4, z: 4 }] }),
    ).toThrow(/unknown symbol "heart"/);
  });

  it('keeps sorting apart from stacking: no symbol with a recipe, no stacks in a level that names symbols', () => {
    expect(() =>
      v({
        boxes: two,
        zones: [{ id: 'z', color: 'blue', symbol: 'triangle', x: 4, z: 4, recipe: ['blue', 'blue'] }],
      }),
    ).toThrow(/recipes are color-only/);
    expect(() =>
      v({
        boxes: two,
        zones: [{ id: 'z', color: 'blue', x: 4, z: 4, recipe: ['blue', 'blue'] }],
      }),
    ).toThrow(/does not stack yet/);
    expect(() =>
      v({ stackLimit: 2, boxes: two, zones: [{ id: 'z', color: 'blue', x: 4, z: 4 }, { id: 'y', symbol: 'circle', x: 5, z: 4 }] }),
    ).toThrow(/does not stack yet/);
    // A one-box recipe is just the classic rule, so it may sit next to a symbol.
    expect(() =>
      v({ boxes: two, zones: [{ id: 'z', color: 'blue', symbol: 'triangle', x: 4, z: 4, recipe: ['blue'] }, { id: 'y', color: 'blue', x: 5, z: 4 }] }),
    ).not.toThrow();
  });

  it('asks for one box per zone and a complete sorting (ambiguity allowed), and never a solved start', () => {
    expect(() => v({ boxes: two, zones: [{ id: 'z', color: 'blue', x: 4, z: 4 }] })).toThrow(/one box per zone \(2 boxes, 1 zones\)/);
    // Both boxes fit only "any blue": no complete sorting.
    expect(() =>
      v({
        boxes: [
          { id: 'a', color: 'blue', symbol: 'square', x: 2, z: 2 },
          { id: 'b', color: 'blue', symbol: 'circle', x: 3, z: 2 },
        ],
        zones: [
          { id: 'z', color: 'blue', x: 4, z: 4 },
          { id: 'y', symbol: 'triangle', x: 5, z: 4 },
        ],
      }),
    ).toThrow(/no complete sorting exists: box "b"/);
    // Blue ▲ fits both zones; the complete sorting needs it on ▲ (found through an augmenting path).
    expect(() => v({ boxes: two, zones: [{ id: 'z', color: 'blue', x: 4, z: 4 }, { id: 'y', symbol: 'triangle', x: 5, z: 4 }] })).not.toThrow();
    // Starting solved: the only zone already holds a box it accepts (colour differs, the symbol is what it asks).
    expect(() => v({ boxes: [{ id: 'a', color: 'coral', symbol: 'triangle', x: 4, z: 4 }], zones: [{ id: 'z', symbol: 'triangle', x: 4, z: 4 }] })).toThrow(
      /already solved/,
    );
    expect(() => v({ boxes: [{ id: 'a', color: 'coral', symbol: 'circle', x: 4, z: 4 }], zones: [{ id: 'z', color: 'coral', symbol: 'triangle', x: 4, z: 4 }] })).toThrow(
      /no complete sorting/,
    );
  });

  it('classic levels are untouched: no symbol keys, the colour multiset rule, default symbols', () => {
    // The classic levels kept after the level redesign (1–3).
    for (const level of LEVELS.filter((l) => l.order <= 3)) {
      expect(usesSymbols(level), level.id).toBe(false);
      for (const z of level.zones) expect(Object.keys(z)).not.toContain('symbol');
      for (const b of level.boxes) expect(Object.keys(b)).not.toContain('symbol');
      const snap = new GameState(level).getSnapshot();
      for (const b of snap.boxes) expect(b.symbol).toBe(DEFAULT_SYMBOL[b.color]);
      for (const z of snap.zones) {
        expect(z.accepts).toEqual({ color: z.color });
        expect(z.recipe[0]).toBe(z.color);
      }
    }
    // Without symbols the old rule still applies: box colors must equal the zones' colors.
    expect(() => v({ boxes: [{ id: 'a', color: 'blue', x: 2, z: 2 }], zones: [{ id: 'z', color: 'mint', x: 4, z: 4 }] })).toThrow(/color "blue"/);
  });
});

describe('sorting: zones, satisfaction and events', () => {
  it('a zone is satisfied iff its box meets all of its criteria (start layouts)', () => {
    const state = new GameState(
      sortLevel(
        0,
        [
          ['onSymbol', 'coral', 'triangle', 1, 1],
          ['onExactWrong', 'blue', 'circle', 3, 0],
          ['onColor', 'mint', 'cross', 5, 1],
          ['loose', 'blue', 'square', 6, 4],
        ],
        [
          ['zs', null, 'triangle', 1, 1],
          ['zx', 'blue', 'square', 3, 0],
          ['zc', 'mint', null, 5, 1],
          ['zb', 'blue', null, 0, 4],
        ],
      ),
    );
    const snap = state.getSnapshot();
    const zone = (id: string) => snap.zones.find((z) => z.id === id)!;
    expect(zone('zs')).toMatchObject({ color: null, accepts: { symbol: 'triangle' }, recipe: [null], satisfied: true, occupiedBy: 'onSymbol' });
    expect(zone('zx')).toMatchObject({ color: 'blue', accepts: { color: 'blue', symbol: 'square' }, satisfied: false, next: null });
    expect(zone('zc')).toMatchObject({ satisfied: true });
    expect(zone('zb')).toMatchObject({ satisfied: false, occupiedBy: null, next: 'blue' });
    expect(snap.boxes.map((b) => b.correct)).toEqual([true, false, true, false]);
    expect(snap.progress).toEqual({ satisfied: 2, total: 4 });
  });

  it('boxDropped keeps its shape: correct = the zone accepted the box', () => {
    // Heading 45°: the fork point sits nearest to (4,3), where the coral ▲ box waits; "any ▲" is on (4,2).
    const state = new GameState(sortLevel(45, [['b', 'coral', 'triangle', 4, 3], ['m', 'mint', 'circle', 0, 0]], [['zt', null, 'triangle', 4, 2], ['zm', 'mint', null, 6, 4]]));
    press(state);
    expect(press(state)).toEqual([
      { type: 'boxDropped', boxId: 'b', cell: { x: 4, z: 2 }, zoneId: 'zt', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 2 },
    ]);
  });

  it('an ambiguous box counts wherever a zone accepts it', () => {
    // Blue ▲ fits "any blue" (4,2) and "any ▲" (3,3), both 0.74 from the fork point; either drop is correct.
    for (const [blueAt, triangleAt] of [
      [[4, 2], [3, 3]],
      [[3, 3], [4, 2]],
    ] as const) {
      const state = new GameState(
        sortLevel(
          45,
          [['a', 'blue', 'triangle', 4, 3], ['c', 'blue', 'circle', 0, 0]],
          [['zb', 'blue', null, ...blueAt], ['zt', null, 'triangle', ...triangleAt]],
        ),
      );
      press(state);
      const drop = eventOf(press(state), 'boxDropped');
      expect(drop.correct).toBe(true);
      expect(['zb', 'zt']).toContain(drop.zoneId);
    }
  });
});

describe('sorting: zone magnet', () => {
  it('prefers the most specific accepting zone (color + symbol) over a nearer single-criterion one', () => {
    // Blue ■ starts on "any blue" (4,3), the cell nearest the fork point (0.50 away); "blue ■" (4,2) is 0.74 away.
    const state = new GameState(sortLevel(45, [['b', 'blue', 'square', 4, 3], ['c', 'blue', 'circle', 0, 0]], [['zb', 'blue', null, 4, 3], ['zx', 'blue', 'square', 4, 2]]));
    const snap = state.getSnapshot();
    expect(snap.zones[0].satisfied).toBe(true);
    expect(press(state)).toEqual([
      { type: 'firstInput' },
      { type: 'boxPicked', boxId: 'b', fromZoneId: 'zb', level: 0 },
      { type: 'zoneReleased', zoneId: 'zb', boxId: 'b' },
    ]);
    expect(snap.hint).toMatchObject({ dropCell: { x: 4, z: 2 }, dropZoneId: 'zx' });
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ zoneId: 'zx', correct: true, satisfiedCount: 1 });
  });

  it('among equally specific accepting zones the nearest wins', () => {
    // Mint ▲ starts on "any ▲" (4,2, 0.74 away); "any mint" (4,3) is nearer (0.50).
    const state = new GameState(sortLevel(45, [['m', 'mint', 'triangle', 4, 2], ['t', 'blue', 'triangle', 0, 0]], [['zt', null, 'triangle', 4, 2], ['zm', 'mint', null, 4, 3]]));
    press(state);
    expect(eventOf(press(state), 'boxDropped')).toMatchObject({ cell: { x: 4, z: 3 }, zoneId: 'zm', correct: true });
  });

  it('never pulls toward a zone that does not accept the box, even the nearest or a same-colored one', () => {
    // Carried mint ▲: "any ●" on the nearest cell (4,3) and "mint ■" (3,3) do not accept it; "any ▲" (4,2) does.
    const accepting = new GameState(
      sortLevel(
        45,
        [['m', 'mint', 'triangle', 4, 3], ['c', 'coral', 'circle', 0, 0], ['s', 'mint', 'square', 6, 0]],
        [['zo', null, 'circle', 4, 3], ['zms', 'mint', 'square', 3, 3], ['zt', null, 'triangle', 4, 2]],
      ),
    );
    press(accepting);
    expect(eventOf(press(accepting), 'boxDropped')).toMatchObject({ zoneId: 'zt', correct: true });
    // Nothing nearby accepts it: the nearest-cell rule lands on "any ●" (the forks are over it), neutrally.
    const none = new GameState(sortLevel(45, [['m', 'mint', 'triangle', 4, 3], ['c', 'coral', 'circle', 0, 0]], [['zo', null, 'circle', 4, 3], ['zt', null, 'triangle', 0, 4]]));
    press(none);
    const events = press(none);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ cell: { x: 4, z: 3 }, zoneId: 'zo', correct: false, satisfiedCount: 0 });
    expect(types(events)).toEqual(['boxDropped']);
  });
});

describe('sorting: the level-23 sample (docs/SORTING.md)', () => {
  // The old level 23 «La muestra» (levels 4–24 were removed for the redesign), inline: the trap it teaches still works.
  const sample = parseLevel(
    `# 23 · La muestra
id: la-muestra
limit: 1
ventanas: norte 2-4, oeste 3-4

  0123456789
0 p.........
1 .1.2.3.4..
2 ..........
3 ..........
4 ....b..a..
5 ..c.......
6 .....d.^.p

1 2 = zona ▲        3 = zona azul ■     4 = zona azul
a = caja azul ▲     b = caja azul ■     c = caja menta ▲    d = caja azul ●
`,
    'la-muestra.level',
  ).level;
  const NORTH = 180;
  const EAST = 90;
  const SOUTH = 0;
  const zoneId = (color: string | undefined, symbol: string | undefined, nth = 0) =>
    sample.zones.filter((z) => z.color === color && z.symbol === symbol)[nth].id;
  const boxCell = (color: string, symbol: string) => {
    const b = sample.boxes.find((x) => x.color === color && x.symbol === symbol)!;
    return { x: b.x, z: b.z };
  };
  const zoneCell = (id: string) => {
    const z = sample.zones.find((x) => x.id === id)!;
    return { x: z.x, z: z.z };
  };
  /** Carry the box on `from` (approached heading `fromHeading`°) to `to` (every zone is approached from the south). */
  const move = (state: GameState, from: CellPos, to: CellPos, fromHeading = NORTH) => {
    faceCell(state, from, fromHeading);
    const picked = press(state);
    faceCell(state, to, NORTH);
    return [...picked, ...press(state)];
  };
  const forward = { move: { x: 0, z: 0 }, drive: { throttle: 0.5, steer: 0 }, actionPressed: false };

  it('falls into the trap, hints at the swap by acceptance only, and completes once blue ▲ moves on', () => {
    const state = new GameState(sample);
    const snap = state.getSnapshot();
    const anyBlue = zoneId('blue', undefined);
    const exact = zoneId('blue', 'square');
    const [tri1, tri2] = [zoneId(undefined, 'triangle', 0), zoneId(undefined, 'triangle', 1)];
    const all: GameEvent[] = [];

    // 1. The trap: blue ▲ into "any blue" is accepted (it chimes), like any correct drop.
    let events = move(state, boxCell('blue', 'triangle'), zoneCell(anyBlue));
    all.push(...events);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ zoneId: anyBlue, correct: true, satisfiedCount: 1 });
    all.push(...move(state, boxCell('blue', 'square'), zoneCell(exact)));
    all.push(...move(state, boxCell('mint', 'triangle'), zoneCell(tri1)));
    expect(snap.progress.satisfied).toBe(3);

    // 2. Blue ● has no free zone: none takes it next, and "any blue" (holding blue ▲) is the only one that accepts it.
    faceCell(state, boxCell('blue', 'circle'), SOUTH);
    all.push(...press(state));
    const carried = snap.boxes.find((b) => b.carried)!;
    expect(carried).toMatchObject({ color: 'blue', symbol: 'circle' });
    expect(snap.zones.filter((z) => takesNext(z, carried))).toEqual([]);
    expect(snap.zones.filter((z) => accepts(z, carried)).map((z) => z.id)).toEqual([anyBlue]);
    // Driving up to it until the load rests against blue ▲: the drop would only find free floor, never that zone.
    faceCell(state, { x: zoneCell(anyBlue).x, z: zoneCell(anyBlue).z + 1 }, NORTH);
    for (let t = 0; t < 1.5; t += DT) all.push(...state.update(DT, forward));
    expect(snap.forklift.carrying).toBe(carried.id);
    expect(snap.hint.dropCell).not.toBeNull();
    expect(snap.hint.dropZoneId).toBeNull();
    // Park blue ● on the floor east of the lane.
    faceCell(state, { x: 9, z: 3 }, EAST);
    events = press(state);
    all.push(...events);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ cell: { x: 9, z: 3 }, zoneId: null, correct: false });

    // 3. The fix: blue ▲ out of "any blue" (a neutral release) onto the free ▲ zone, then blue ● home.
    events = move(state, zoneCell(anyBlue), zoneCell(tri2));
    all.push(...events);
    expect(types(events)).toEqual(['boxPicked', 'zoneReleased', 'boxDropped']);
    expect(eventOf(events, 'boxDropped')).toMatchObject({ zoneId: tri2, correct: true, satisfiedCount: 3 });
    faceCell(state, { x: 9, z: 3 }, EAST);
    all.push(...press(state));
    faceCell(state, zoneCell(anyBlue), NORTH);
    events = press(state);
    all.push(...events);
    expect(events).toEqual([
      { type: 'boxDropped', boxId: carried.id, cell: zoneCell(anyBlue), zoneId: anyBlue, level: 0, correct: true, recipeLength: 1, satisfiedCount: 4, total: 4 },
      { type: 'levelComplete' },
    ]);
    expect(snap.completed).toBe(true);
    // Only the usual, gentle events along the way (no refusal: every press did something).
    expect(new Set(types(all))).toEqual(new Set(['firstInput', 'boxPicked', 'boxDropped', 'zoneReleased', 'levelComplete']));
  });

  it('avoiding the trap needs no extra move: the complete sorting drops straight in', () => {
    const state = new GameState(sample);
    move(state, boxCell('blue', 'triangle'), zoneCell(zoneId(undefined, 'triangle', 1)));
    move(state, boxCell('blue', 'square'), zoneCell(zoneId('blue', 'square')));
    move(state, boxCell('mint', 'triangle'), zoneCell(zoneId(undefined, 'triangle', 0)));
    const last = move(state, boxCell('blue', 'circle'), zoneCell(zoneId('blue', undefined)), SOUTH);
    expect(types(last)).toEqual(['boxPicked', 'boxDropped', 'levelComplete']);
    expect(state.getSnapshot().zones.every((z) => z.satisfied)).toBe(true);
  });
});
