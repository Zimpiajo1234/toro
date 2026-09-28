import { Euler, Mesh, Scene, Vector3, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { cellToWorld, type GameSnapshot, type LevelData } from '../core/types';
import { validateLevel } from '../data/validateLevel';
import { defaultTheme } from '../themes/default';
import { GameState } from '../logic/GameState';
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
    boxes: level.boxes.map((b) => ({ id: b.id, color: b.color, kind: 'standard' as const, pos: cellToWorld(b, size), cell: { x: b.x, z: b.z }, level: 0, carried: false, zoneId: null, correct: false })),
    zones: level.zones.map((z) => ({ id: z.id, color: z.color, cell: { x: z.x, z: z.z }, pos: cellToWorld(z, size), recipe: [z.color], stack: [], occupiedBy: null, satisfied: false, next: z.color })),
    hint: { targetBoxId: null, dropCell: null, dropZoneId: null, dropLevel: 0 },
    completed: false,
    progress: { satisfied: 0, total: level.zones.length },
  };
}

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
