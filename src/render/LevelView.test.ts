import { Euler, Mesh, Scene, Vector3, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { cellToWorld, type GameSnapshot, type LevelData } from '../core/types';
import { validateLevel } from '../data/validateLevel';
import { defaultTheme } from '../themes/default';
import { LevelView } from './LevelView';

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
    forklift: { pos: cellToWorld(level.forklift, size), heading: Math.PI / 2, speed: 0, forkLift: 0, carrying: null, wheelSpin: 0, steer: 0 },
    boxes: level.boxes.map((b) => ({ id: b.id, color: b.color, kind: 'standard' as const, pos: cellToWorld(b, size), cell: { x: b.x, z: b.z }, carried: false, zoneId: null, correct: false })),
    zones: level.zones.map((z) => ({ id: z.id, color: z.color, cell: { x: z.x, z: z.z }, pos: cellToWorld(z, size), occupiedBy: null, satisfied: false })),
    hint: { targetBoxId: null, dropCell: null, dropZoneId: null },
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
