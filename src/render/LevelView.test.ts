import { Color, Euler, Mesh, Scene, Vector3, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { accepts, criteriaOf, symbolOf } from '../core/sorting';
import { cellToWorld, type BoxState, type GameSnapshot, type LevelData, type ZoneState } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { LEVELS } from '../data/levels';
import { validateLevel } from '../data/validateLevel';
import { defaultTheme } from '../themes/default';
import { GameState } from '../logic/GameState';
import { buildBoxGeometry } from './builders/box';
import { buildZoneGeometry } from './builders/zone';
import { boxDims } from './dims';
import { LevelView } from './LevelView';
import { DROP_GLIDE_SEC } from './views/BoxView';

const LEVEL = validateLevel({
  id: 'test-render',
  order: 1,
  name: 'Prueba',
  size: { width: 8, depth: 6 },
  forklift: { x: 1, z: 3, heading: 90 },
  boxes: [
    { id: 'b1', color: 'blue', x: 3, z: 3 },
    { id: 'b2', color: 'mint', x: 5, z: 1 },
  ],
  zones: [
    { id: 'z1', color: 'blue', x: 6, z: 3 },
    { id: 'z2', color: 'mint', x: 2, z: 1 },
  ],
  shelves: [{ x: 0, z: 0, w: 2, d: 1 }],
  decor: { plants: [{ x: 7, z: 5 }], windows: [{ wall: 'north', at: 3, width: 2 }] },
});

/** A tall 3-tier shelf in the middle; at the default 45° yaw the camera sits toward +x/+z. */
const SHELF_LEVEL = validateLevel({
  id: 'test-shelf',
  order: 2,
  name: 'Estantería',
  size: { width: 8, depth: 6 },
  forklift: { x: 1, z: 4, heading: 0 },
  boxes: [{ id: 'b1', color: 'blue', x: 6, z: 4 }],
  zones: [{ id: 'z1', color: 'blue', x: 6, z: 1 }],
  shelves: [{ x: 3, z: 2, w: 2, d: 1, tiers: 3 }],
  decor: { plants: [], windows: [] },
});

function snapshot(level: LevelData = LEVEL): GameSnapshot {
  const size = level.size;
  return {
    level,
    forklift: { pos: cellToWorld(level.forklift, size), heading: Math.PI / 2, speed: 0, forkLift: 0, forkHeight: 0, carrying: null, wheelSpin: 0, steer: 0 },
    boxes: level.boxes.map((b) => ({ id: b.id, color: b.color, symbol: symbolOf(b), kind: 'standard' as const, pos: cellToWorld(b, size), cell: { x: b.x, z: b.z }, level: 0, carried: false, zoneId: null, slotId: null, correct: false, locked: false })),
    zones: level.zones.map((z) => ({ id: z.id, color: z.color ?? null, accepts: criteriaOf(z), cell: { x: z.x, z: z.z }, pos: cellToWorld(z, size), recipe: [z.color ?? null], stack: [], occupiedBy: null, satisfied: false, next: z.color ?? null, destined: null })),
    slots: [],
    hint: { targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0, rack: null },
    completed: false,
    progress: { satisfied: 0, total: level.zones.length },
    moves: 0,
  };
}

/** Inline `.level` layouts (the shipped levels 4–24 are being redone: tests never depend on them). */
const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/** Sorting sample (the former level 23 «La muestra»): symbol and colour criteria, a trap for blue ▲. */
const SAMPLE_LEVEL = level(`
# 1 · La muestra
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
`);

/** A big sorting room (the former level 24 «El gran reparto»): every colour and symbol. */
const BIG_SORTING_LEVEL = level(`
# 2 · El gran reparto
id: el-gran-reparto
limit: 1
ventanas: norte 3-5, norte 7-8, oeste 3-5

  012345678901
0 p..........p
1 .1.2.3.4.5..
2 ............
3 .6...e.g.##.
4 ...f........
5 .7...h.b.d..
6 ....c.......
7 .8.......a.<
8 p...........

1 = zona ▲             2 = zona lavanda ▲     3 = zona azul          4 = zona menta ●
5 = zona ◆             6 = zona amarillo      7 = zona coral ■       8 = zona ✚
a = caja lavanda ✚     b = caja azul ▲        c = caja menta ▲       d = caja amarillo ◆
e = caja coral ◆       f = caja menta ●       g = caja coral ■       h = caja lavanda ▲
`);

/** A big classic room (the former level 12 «El gran almacén»): colours only, a box on a wrong zone at start. */
const BIG_CLASSIC_LEVEL = level(`
# 3 · El gran almacén
id: el-gran-almacen
limit: 1
ventanas: norte 2-4, norte 9-11, oeste 7-8

   01234567890123
 0 p............p
 1 .12345.v67890.
 2 ..............
 3 .a............
 4 ...#b.##c.#d..
 5 ...#..##..#...
 6 ...#..##..#...
 7 ...#..##..#...
 8 .e.......f....
 9 .....g......h.
10 p.............

1 = zona azul                 2 = zona menta                3 = zona amarillo
4 = zona coral                5 = zona lavanda + caja coral
6 = zona lavanda              7 = zona coral                8 = zona amarillo
9 = zona menta + caja azul    0 = zona azul
a = caja lavanda              b = caja azul                 c = caja coral
d = caja menta                e = caja amarillo             f = caja menta
g = caja amarillo             h = caja lavanda
`);

function step(view: LevelView, snap: GameSnapshot, seconds: number, yaw = Math.PI / 4): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) view.update(snap, 1 / 60, i / 60, yaw, 0);
}

function shelfMesh(view: LevelView): Mesh {
  const mesh = view.root.children.find((c) => c.userData.shelf) as Mesh | undefined;
  expect(mesh).toBeDefined();
  return mesh!;
}

function meshCount(root: Object3D): number {
  let n = 0;
  root.traverse((o) => {
    if (o instanceof Mesh) n++;
  });
  return n;
}

function boxGroup(view: LevelView, id: string): Object3D {
  return view.root.children.find((c) => c.children.some((m) => m instanceof Mesh) && c.userData.boxId === id)!;
}

describe('LevelView', () => {
  it('builds a compact scene (few meshes) and frames floor + both walls', () => {
    const view = new LevelView(snapshot(), defaultTheme, GAME_CONFIG, Math.PI / 4);
    expect(view.fitBoxes).toHaveLength(3);
    // floor, props, leaves, 2×(wall + glass/shafts), zones×3, boxes, forklift parts, preview
    expect(meshCount(view.root)).toBeLessThan(40);
    view.dispose();
  });

  it('carries a picked box on the forks and glides it onto its cell when dropped', () => {
    const snap = snapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const box = snap.boxes[0];
    const group = boxGroup(view, 'b1');
    expect(group).toBeDefined();

    // Pick: logic marks the box carried and lifts the forks.
    box.carried = true;
    box.cell = null;
    snap.forklift.carrying = 'b1';
    snap.forklift.forkLift = 1;
    snap.forklift.pos.x += 0.5;
    step(view, snap, 0.6);
    const fork = new Vector3(snap.forklift.pos.x + GAME_CONFIG.forklift.forkReach, 0, snap.forklift.pos.z);
    expect(group.position.x).toBeCloseTo(fork.x, 2);
    expect(group.position.z).toBeCloseTo(fork.z, 2);
    expect(group.position.y).toBeGreaterThan(0.3);

    // Drop on the blue zone: glide down, square to the grid, settle at scale 1.
    const target = cellToWorld({ x: 6, z: 3 }, LEVEL.size);
    box.carried = false;
    box.cell = { x: 6, z: 3 };
    box.pos = { ...target };
    box.correct = true;
    box.zoneId = 'z1';
    snap.forklift.carrying = null;
    snap.zones[0].occupiedBy = 'b1';
    snap.zones[0].satisfied = true;
    step(view, snap, 0.1);
    expect(group.position.y).toBeGreaterThan(0.01); // still gliding, never teleports
    step(view, snap, 1.5);
    expect(group.position.x).toBeCloseTo(target.x, 3);
    expect(group.position.z).toBeCloseTo(target.z, 3);
    expect(group.position.y).toBeCloseTo(0, 3);
    expect(group.scale.y).toBeCloseTo(1, 3);
    const yaw = new Euler().setFromQuaternion(group.quaternion, 'YXZ').y;
    const quarterTurns = yaw / (Math.PI / 2);
    expect(Math.abs(quarterTurns - Math.round(quarterTurns))).toBeLessThan(1e-3);
    view.dispose();
  });

  it('lifts and brightens the pick target enough to read at play scale', () => {
    const snap = snapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const mesh = boxGroup(view, 'b1').children.find((m) => m instanceof Mesh) as Mesh;
    snap.hint.targetBoxId = 'b1';
    step(view, snap, 1);
    expect(mesh.position.y).toBeGreaterThanOrEqual(0.045);
    const glow = (mesh.material as MeshStandardMaterial).emissiveIntensity;
    expect(glow).toBeGreaterThanOrEqual(0.15);
    expect(glow).toBeLessThanOrEqual(0.25); // still a gentle cue
    snap.hint.targetBoxId = null;
    step(view, snap, 1);
    expect(mesh.position.y).toBeLessThan(0.005);
    view.dispose();
  });

  it('ghosts a tall shelf while it hides the forklift, and makes it solid again afterwards', () => {
    const snap = snapshot(SHELF_LEVEL);
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const shelf = shelfMesh(view);
    const material = shelf.material as MeshStandardMaterial;
    step(view, snap, 1);
    expect(material.opacity).toBe(1); // nothing behind it at the default view
    expect(material.depthWrite).toBe(true);

    // Park the forklift right behind the shelf (away from the camera): the shelf fades to a ghost.
    snap.forklift.pos = cellToWorld({ x: 3, z: 1 }, SHELF_LEVEL.size);
    step(view, snap, 1);
    expect(material.opacity).toBeLessThan(0.4);
    expect(material.depthWrite).toBe(false);
    expect(shelf.castShadow).toBe(true);
    const depthPass = shelf.children[0] as Mesh;
    expect(depthPass.visible).toBe(true);
    expect(depthPass.renderOrder).toBeLessThan(shelf.renderOrder); // depth prepass first

    // Turned around (camera now behind the forklift), the shelf no longer hides it.
    step(view, snap, 1.5, Math.PI / 4 + Math.PI);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
    expect(depthPass.visible).toBe(false);
    view.dispose();
  });

  it('releases every resource and detaches on dispose', () => {
    const view = new LevelView(snapshot(), defaultTheme, GAME_CONFIG, Math.PI / 4);
    const scene = new Scene();
    scene.add(view.root);
    let disposedGeometries = 0;
    view.root.traverse((o) => {
      if (o instanceof Mesh) o.geometry.addEventListener('dispose', () => disposedGeometries++);
    });
    view.dispose();
    expect(view.root.parent).toBeNull();
    expect(scene.children).not.toContain(view.root);
    expect(disposedGeometries).toBeGreaterThan(10);
  });
});

describe('LevelView: stacks', () => {
  const STACK_LEVEL = validateLevel({
    id: 'test-stack',
    order: 1,
    name: 'Pila',
    size: { width: 9, depth: 5 },
    forklift: { x: 2, z: 2, heading: 90 },
    boxes: [
      { id: 'm', color: 'mint', x: 3, z: 2 },
      { id: 'b', color: 'blue', x: 5, z: 2 },
    ],
    zones: [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
    decor: { plants: [], windows: [] },
  });
  const height = GAME_CONFIG.box.size * 0.82;
  const run = (state: GameState, view: LevelView, seconds: number, x = 0, action = false) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      const events = state.update(1 / 60, { move: { x, z: 0 }, actionPressed: action && i === 0 });
      for (const e of events) view.handleEvent(e, state.getSnapshot());
      view.update(state.getSnapshot(), 1 / 60, i / 60, Math.PI / 4, 0);
    }
  };

  const zoneGroup = (view: LevelView, id: string) => view.root.children.find((c) => c.userData.zoneId === id)!;
  const opacity = (view: LevelView, id: string) => ((boxGroup(view, id).children[0] as Mesh).material as MeshStandardMaterial).opacity;
  /** World y of a box's bottom and top, including the inner mesh offset (hover, bob, stack dip) and the squash. */
  const boxSpan = (view: LevelView, id: string) => {
    const g = boxGroup(view, id);
    const mesh = g.children[0];
    const bottom = g.position.y + mesh.position.y * g.scale.y;
    return { bottom, top: bottom + height * g.scale.y };
  };
  /** Pick the mint box and roll until the drop preview sits on the blue base. */
  const carryToStack = (state: GameState, view: LevelView) => {
    const snap = state.getSnapshot();
    run(state, view, 0.3, 0, true);
    expect(snap.forklift.carrying).toBe('m');
    for (let t = 0; t < 6 && snap.hint.dropCell?.x !== 5; t += 1 / 60) run(state, view, 1 / 60, 0.4);
    expect(snap.hint.dropLevel).toBe(1);
  };

  it('draws the recipe on the zone, lifts the forks to the stack and lands the box on top', () => {
    const state = new GameState(STACK_LEVEL);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    // Recipe marker: a cream base + one mesh per step inside the zone group (halo, pad, ring before them).
    expect(zoneGroup(view, 'z').children.length).toBe(6);

    carryToStack(state, view);
    run(state, view, 1.2);
    expect(snap.forklift.forkHeight).toBeCloseTo(1, 3);
    const carried = boxGroup(view, 'm');
    expect(carried.position.y).toBeGreaterThan(height);

    run(state, view, 1.5, 0, true);
    expect(snap.completed).toBe(true);
    expect(carried.position.y).toBeCloseTo(height, 3);
    expect(boxGroup(view, 'b').position.y).toBeCloseTo(0, 3);
    expect(carried.scale.y).toBeCloseTo(1, 3);
    view.dispose();
  });

  it('lifts a box dropped from low forks before sliding it onto the stack (never through the box below)', () => {
    // Hand-driven snapshot (the view only reads it): mint carried on low forks, 0.9 short of the blue base.
    const snap = new GameState(STACK_LEVEL).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const stack = cellToWorld({ x: 5, z: 2 }, STACK_LEVEL.size);
    const mint = snap.boxes.find((b) => b.id === 'm')!;
    Object.assign(mint, { carried: true, cell: null });
    Object.assign(snap.forklift, { carrying: 'm', forkLift: 1, forkHeight: 0 });
    snap.forklift.pos = { x: stack.x - 0.9 - GAME_CONFIG.forklift.forkReach, z: stack.z };
    step(view, snap, 0.8);
    expect(boxSpan(view, 'm').bottom).toBeLessThan(height - 0.2);
    // Dropped right away onto the stack, forks still low.
    Object.assign(mint, { carried: false, cell: { x: 5, z: 2 }, level: 1, pos: { ...stack } });
    snap.forklift.carrying = null;
    snap.forklift.forkLift = 0;
    const base = boxGroup(view, 'b').position;
    const size = GAME_CONFIG.box.size;
    let overlapped = 0;
    for (let i = 0; i < 90; i++) {
      step(view, snap, 1 / 60);
      const g = boxGroup(view, 'm').position;
      if (Math.abs(g.x - base.x) < size - 1e-3 && Math.abs(g.z - base.z) < size - 1e-3) {
        overlapped++;
        expect(boxSpan(view, 'm').bottom).toBeGreaterThan(height - 2e-3);
      }
    }
    expect(overlapped).toBeGreaterThan(0);
    expect(boxGroup(view, 'm').position.x).toBeCloseTo(stack.x, 3);
    expect(boxGroup(view, 'm').position.y).toBeCloseTo(height, 3);
    view.dispose();
  });

  it('dips the whole stack together as a box lands on it, so no seam opens between the boxes', () => {
    const state = new GameState(STACK_LEVEL);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    carryToStack(state, view);
    run(state, view, 1.2);
    run(state, view, 1 / 60, 0, true);
    expect(snap.forklift.carrying).toBeNull();
    run(state, view, DROP_GLIDE_SEC);
    let deepest = 0;
    for (let i = 0; i < 90; i++) {
      run(state, view, 1 / 60);
      const lower = boxSpan(view, 'b');
      const upper = boxSpan(view, 'm');
      deepest = Math.min(deepest, lower.bottom);
      expect(Math.abs(upper.bottom - lower.top)).toBeLessThan(3e-3);
    }
    // The dip really played (a gentle ~2 cm), and everything is back at rest.
    expect(deepest).toBeLessThan(-0.01);
    expect(boxSpan(view, 'b').bottom).toBeCloseTo(0, 3);
    view.dispose();
  });

  it('lets the recipe step the carried box would fill breathe, and only that one', () => {
    const state = new GameState(STACK_LEVEL);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.setTargetHints(true); // the optional target hints (P) light it
    const [step0, step1] = zoneGroup(view, 'z').children.slice(-2).map((m) => (m as Mesh).material as MeshStandardMaterial);
    run(state, view, 1);
    expect(step1.emissiveIntensity).toBe(0); // nothing carried: no cue
    carryToStack(state, view);
    run(state, view, 1);
    expect(step0.emissiveIntensity).toBe(0); // the blue base is already down
    expect(step1.emissiveIntensity).toBeGreaterThan(0.04);
    run(state, view, 1 / 60, 0, true);
    run(state, view, 3);
    expect(snap.completed).toBe(true);
    expect(step1.emissiveIntensity).toBeLessThan(0.01);
    view.dispose();
  });

  /** A 3-high stack on (5,3); at the default 45° yaw the camera sits toward +x/+z, so "behind" is toward -x/-z. */
  const TOWER = validateLevel({
    id: 'test-tower',
    order: 1,
    name: 'Torre',
    size: { width: 9, depth: 7 },
    forklift: { x: 7, z: 5, heading: 0 },
    boxes: [
      { id: 'a', color: 'blue', x: 5, z: 3 },
      { id: 'u', color: 'yellow', x: 5, z: 3 },
      { id: 't', color: 'lavender', x: 5, z: 3 },
      { id: 'p', color: 'mint', x: 4, z: 2 },
    ],
    zones: [
      { id: 'z1', color: 'blue', x: 5, z: 3, recipe: ['blue', 'yellow', 'lavender'] },
      { id: 'z2', color: 'mint', x: 1, z: 5 },
    ],
    decor: { plants: [], windows: [] },
  });

  it('ghosts upper stacked boxes that hide a parked box, but keeps the base box solid', () => {
    const state = new GameState(TOWER);
    const view = new LevelView(state.getSnapshot(), defaultTheme, GAME_CONFIG, Math.PI / 4);
    step(view, state.getSnapshot(), 1);
    expect(opacity(view, 'a')).toBe(1);
    expect(opacity(view, 't')).toBeLessThan(0.6);
    // Turned around, nothing is behind the stack any more.
    step(view, state.getSnapshot(), 2, Math.PI / 4 + Math.PI);
    expect(opacity(view, 'u')).toBe(1);
    expect(opacity(view, 't')).toBe(1);
    view.dispose();
  });

  it('turns every ghosted box solid once the level is complete, so the glow wave plays on solid stacks', () => {
    const state = new GameState(TOWER);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    step(view, snap, 1);
    expect(opacity(view, 't')).toBeLessThan(0.6);
    snap.completed = true;
    step(view, snap, 2);
    expect(opacity(view, 'u')).toBe(1);
    expect(opacity(view, 't')).toBe(1);
    view.dispose();
  });

  it('holds the glow of a satisfied zone until a box stacked on top lands; a pick-up releases it at once', () => {
    const padGlow = (view: LevelView) => ((zoneGroup(view, 'z1').children[1] as Mesh).material as MeshStandardMaterial).emissiveIntensity;
    const release = (grow: boolean) => {
      // Hand-driven snapshot (the view only reads it): the complete tower zone stops being satisfied.
      const snap = new GameState(TOWER).getSnapshot();
      const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
      step(view, snap, 1);
      const rest = padGlow(view);
      expect(rest).toBeGreaterThan(0.1);
      const zone = snap.zones[0];
      if (grow) zone.stack = [...zone.stack, 'p'];
      else zone.stack = zone.stack.slice(0, -1);
      Object.assign(zone, { satisfied: false, next: grow ? null : 'lavender' });
      step(view, snap, DROP_GLIDE_SEC * 0.8);
      const held = padGlow(view);
      step(view, snap, 2);
      expect(padGlow(view)).toBeLessThan(0.02);
      view.dispose();
      return { rest, held };
    };
    const stacked = release(true);
    expect(stacked.held).toBeCloseTo(stacked.rest, 3);
    const picked = release(false);
    expect(picked.held).toBeLessThan(picked.rest - 0.02);
  });

  it('keeps a stack solid while the forklift docks at it, and ghosts it once it hides the cabin', () => {
    const level = { ...TOWER, boxes: TOWER.boxes.filter((b) => b.id !== 'p') };
    const state = new GameState(level);
    const snap = state.getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const stack = snap.zones[0].pos;
    // Docked west of the stack, facing it, forks raised: the player reads the stack, it must stay solid.
    snap.forklift.pos = { x: stack.x - 0.81, z: stack.z };
    snap.forklift.heading = Math.PI / 2;
    snap.forklift.forkHeight = 2;
    step(view, snap, 1.5);
    expect(opacity(view, 'u')).toBe(1);
    expect(opacity(view, 't')).toBe(1);
    // Cabin right behind the stack along the view: the upper boxes fade so the forklift stays visible.
    snap.forklift.pos = { x: stack.x - 0.85, z: stack.z - 0.75 };
    snap.forklift.heading = 0;
    step(view, snap, 1.5);
    expect(opacity(view, 't')).toBeLessThan(0.6);
    expect(opacity(view, 'a')).toBe(1);
    view.dispose();
  });

  it('keeps classic levels free of stacking visuals (no transparent boxes)', () => {
    const view = new LevelView(snapshot(), defaultTheme, GAME_CONFIG, Math.PI / 4);
    const material = (boxGroup(view, 'b1').children[0] as Mesh).material as MeshStandardMaterial;
    expect(material.transparent).toBe(false);
    view.dispose();
  });
});

describe('LevelView: sorting by color + symbol (docs/SORTING.md)', () => {
  const SAMPLE = SAMPLE_LEVEL;
  const zoneGroup = (view: LevelView, id: string) => view.root.children.find((c) => c.userData.zoneId === id)!;
  const pad = (view: LevelView, id: string) => zoneGroup(view, id).children[1] as Mesh<BufferGeometry, MeshStandardMaterial>;
  const lid = (view: LevelView, id: string) => boxGroup(view, id).children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
  /** The geometry has vertices painted `hex` (vertex colors are linear, like three's Color). */
  const painted = (geo: BufferGeometry, hex: string) => {
    const c = new Color(hex);
    const col = geo.getAttribute('color');
    for (let i = 0; i < col.count; i++)
      if (Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4) return true;
    return false;
  };
  const samePositions = (a: BufferGeometry, b: BufferGeometry) => {
    const pa = a.getAttribute('position').array;
    const pb = b.getAttribute('position').array;
    return pa.length === pb.length && pa.every((v, i) => Math.abs(v - pb[i]) < 1e-6);
  };
  const zoneOf = (snap: GameSnapshot, color: string | undefined, symbol: string | undefined, nth = 0) =>
    snap.zones.filter((z) => z.accepts.color === color && z.accepts.symbol === symbol)[nth];
  const boxOf = (snap: GameSnapshot, color: string, symbol: string) => snap.boxes.find((b) => b.color === color && b.symbol === symbol)!;
  /** Hand-driven snapshot edits (the view only reads it): rest `box` on `zone`, or lift it onto the forks. */
  const rest = (box: BoxState, zone: ZoneState) => {
    Object.assign(box, { carried: false, cell: { ...zone.cell }, pos: { ...zone.pos }, zoneId: zone.id, correct: accepts(zone, box) });
    Object.assign(zone, { stack: [box.id], occupiedBy: box.id, satisfied: accepts(zone, box), next: null });
  };
  const carry = (snap: GameSnapshot, box: BoxState) => {
    Object.assign(box, { carried: true, cell: null, zoneId: null, correct: false });
    snap.forklift.carrying = box.id;
    snap.forklift.forkLift = 1;
  };
  /** Highest pad glow of each zone over `seconds` (breathing peaks). */
  const peakGlow = (view: LevelView, snap: GameSnapshot, seconds: number) => {
    const peak = new Map<string, number>();
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      view.update(snap, 1 / 60, i / 60, Math.PI / 4, 0);
      for (const z of snap.zones) peak.set(z.id, Math.max(peak.get(z.id) ?? 0, pad(view, z.id).material.emissiveIntensity));
    }
    return peak;
  };

  it('pads read without text: color criterion = pad color (neutral when none), symbol criterion = a large engraving', () => {
    const snap = new GameState(SAMPLE).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const anyTriangle = zoneOf(snap, undefined, 'triangle');
    const anyBlue = zoneOf(snap, 'blue', undefined);
    const exact = zoneOf(snap, 'blue', 'square');
    const blue = defaultTheme.zones.blue;
    const neutral = defaultTheme.neutralZone;
    // "Any ▲": neutral cream pad, ▲ engraved (its floor in the engrave tone), no color glyph.
    expect(painted(pad(view, anyTriangle.id).geometry, neutral.fill)).toBe(true);
    expect(painted(pad(view, anyTriangle.id).geometry, neutral.engrave)).toBe(true);
    expect(painted(pad(view, anyTriangle.id).geometry, blue.fill)).toBe(false);
    expect(samePositions(pad(view, anyTriangle.id).geometry, buildZoneGeometry(neutral, { shape: 'triangle', style: 'engraved' }))).toBe(true);
    // "Any blue": the blue pad and nothing in the middle (no symbol asked, so none drawn: not even the old glyph).
    expect(painted(pad(view, anyBlue.id).geometry, blue.fill)).toBe(true);
    expect(painted(pad(view, anyBlue.id).geometry, blue.glyph)).toBe(false);
    expect(painted(pad(view, anyBlue.id).geometry, blue.engrave)).toBe(false);
    expect(samePositions(pad(view, anyBlue.id).geometry, buildZoneGeometry(blue, null))).toBe(true);
    // "Blue ■": both.
    expect(samePositions(pad(view, exact.id).geometry, buildZoneGeometry(blue, { shape: 'square', style: 'engraved' }))).toBe(true);
    expect(painted(pad(view, exact.id).geometry, blue.engrave)).toBe(true);
    view.dispose();
  });

  it('classic levels keep the tone-on-tone glyph of their color on every pad, and the small lid glyph', () => {
    for (const level of [LEVEL, BIG_CLASSIC_LEVEL, ...LEVELS]) {
      const snap = new GameState(level).getSnapshot();
      const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
      for (const z of snap.zones) {
        const palette = defaultTheme.zones[z.color!];
        expect(samePositions(pad(view, z.id).geometry, buildZoneGeometry(palette, { shape: defaultTheme.glyphs[z.color!], style: 'glyph' }))).toBe(true);
        expect(painted(pad(view, z.id).geometry, palette.glyph)).toBe(true);
      }
      const dims = boxDims(GAME_CONFIG);
      for (const b of snap.boxes) {
        const classic = buildBoxGeometry(b.kind, defaultTheme.boxes[b.color], defaultTheme.glyphs[b.color], dims);
        expect(samePositions(lid(view, b.id).geometry, classic), `${level.id} ${b.id}`).toBe(true);
      }
      view.dispose();
    }
  });

  it('lids print the box’s own symbol, larger and deeper, where symbols sort', () => {
    const snap = new GameState(SAMPLE).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const dims = boxDims(GAME_CONFIG);
    for (const b of snap.boxes) {
      const palette = defaultTheme.boxes[b.color];
      expect(samePositions(lid(view, b.id).geometry, buildBoxGeometry(b.kind, palette, b.symbol, dims, 'symbol')), b.id).toBe(true);
      expect(painted(lid(view, b.id).geometry, palette.ink)).toBe(true);
      expect(painted(lid(view, b.id).geometry, palette.glyph)).toBe(false);
    }
    // Blue ▲ and blue ■ share a color, not a lid.
    const tri = boxOf(snap, 'blue', 'triangle');
    const sq = boxOf(snap, 'blue', 'square');
    expect(lid(view, tri.id).geometry).not.toBe(lid(view, sq.id).geometry);
    view.dispose();
  });

  it('while carrying, the free zones that accept the box breathe; the others stay still', () => {
    const snap = new GameState(SAMPLE).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.setTargetHints(true); // the optional target hints (P)
    carry(snap, boxOf(snap, 'blue', 'triangle'));
    const peak = peakGlow(view, snap, 3);
    for (const id of [zoneOf(snap, undefined, 'triangle', 0).id, zoneOf(snap, undefined, 'triangle', 1).id, zoneOf(snap, 'blue', undefined).id])
      expect(peak.get(id), id).toBeGreaterThan(0.1);
    expect(peak.get(zoneOf(snap, 'blue', 'square').id)).toBeLessThan(0.005);
    view.dispose();
  });

  it('with no free zone for the carried box, the occupied zones that accept it breathe very faintly (a swap hint)', () => {
    // The trap of the sample: blue ▲ in "any blue", blue ■ and mint ▲ home, blue ● on the forks.
    const snap = new GameState(SAMPLE).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.setTargetHints(true); // the optional target hints (P)
    const anyBlue = zoneOf(snap, 'blue', undefined);
    rest(boxOf(snap, 'blue', 'triangle'), anyBlue);
    rest(boxOf(snap, 'blue', 'square'), zoneOf(snap, 'blue', 'square'));
    rest(boxOf(snap, 'mint', 'triangle'), zoneOf(snap, undefined, 'triangle', 0));
    step(view, snap, 3); // their celebrations settle
    const settled = pad(view, anyBlue.id).material.emissiveIntensity;
    carry(snap, boxOf(snap, 'blue', 'circle'));
    const peak = peakGlow(view, snap, 3);
    const lift = peak.get(anyBlue.id)! - settled;
    expect(lift).toBeGreaterThan(0.02);
    expect(lift).toBeLessThan(0.07); // a full invitation reaches ≈ 0.17
    // The free ▲ zone does not accept blue ●: still.
    expect(peak.get(zoneOf(snap, undefined, 'triangle', 1).id)).toBeLessThan(0.005);
    // Blue ▲ moved on to that ▲ zone: "any blue" is free again and invites blue ● fully (once its old glow is gone).
    rest(boxOf(snap, 'blue', 'triangle'), zoneOf(snap, undefined, 'triangle', 1));
    Object.assign(anyBlue, { stack: [], occupiedBy: null, satisfied: false, next: 'blue' });
    step(view, snap, 3);
    expect(peakGlow(view, snap, 1).get(anyBlue.id)).toBeGreaterThan(0.1);
    view.dispose();
  });

  it('classic levels never show the swap hint', () => {
    // Blue box carried, its only zone taken by the mint box: nothing breathes (as before the sorting chapter), even with
    // the optional target hints (P) on.
    const snap = snapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.setTargetHints(true);
    const [blueZone] = snap.zones;
    const mint = snap.boxes[1];
    Object.assign(mint, { cell: { ...blueZone.cell }, pos: { ...blueZone.pos }, zoneId: blueZone.id });
    Object.assign(blueZone, { stack: [mint.id], occupiedBy: mint.id, satisfied: false, next: null });
    carry(snap, snap.boxes[0]);
    const peak = peakGlow(view, snap, 3);
    expect(peak.get(blueZone.id)).toBeLessThan(0.005);
    view.dispose();
  });

  it('tints the drop preview only when it would land on a zone that takes the carried box', () => {
    const snap = new GameState(SAMPLE).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const preview = view.root.children.find((c) => c.renderOrder === 2) as Mesh<BufferGeometry, MeshBasicMaterial>;
    const tri = boxOf(snap, 'blue', 'triangle');
    carry(snap, tri);
    const aim = (zone: ZoneState) => {
      snap.hint.dropCell = { ...zone.cell };
      snap.hint.dropZoneId = zone.id;
      step(view, snap, 1);
      return preview.material.color.clone();
    };
    const blueBorder = new Color(defaultTheme.zones.blue.border);
    const neutral = new Color(defaultTheme.floor.edge);
    // "Any ▲" (a neutral pad) takes blue ▲: the preview takes the box's color tone.
    const onTriangle = aim(zoneOf(snap, undefined, 'triangle'));
    expect(Math.abs(onTriangle.r - blueBorder.r) + Math.abs(onTriangle.g - blueBorder.g) + Math.abs(onTriangle.b - blueBorder.b)).toBeLessThan(1e-3);
    // "Blue ■" is blue but does not take blue ▲: neutral, never red.
    const onExact = aim(zoneOf(snap, 'blue', 'square'));
    expect(Math.abs(onExact.r - neutral.r) + Math.abs(onExact.g - neutral.g) + Math.abs(onExact.b - neutral.b)).toBeLessThan(1e-3);
    view.dispose();
  });

  it('stays compact and releases everything on dispose', () => {
    const snap = new GameState(BIG_SORTING_LEVEL).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    // One mesh per pad (the engraving is part of it), one per box, as in the classic levels.
    const classic = new LevelView(new GameState(BIG_CLASSIC_LEVEL).getSnapshot(), defaultTheme, GAME_CONFIG, Math.PI / 4);
    expect(meshCount(view.root)).toBeLessThanOrEqual(meshCount(classic.root) + 2);
    classic.dispose();
    const geometries = new Set<BufferGeometry>();
    for (const z of snap.zones) geometries.add(pad(view, z.id).geometry);
    for (const b of snap.boxes) geometries.add(lid(view, b.id).geometry);
    let disposed = 0;
    for (const g of geometries) g.addEventListener('dispose', () => disposed++);
    view.dispose();
    expect(disposed).toBe(geometries.size);
  });
});
