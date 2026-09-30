import {
  Box3,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Raycaster,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type MeshStandardMaterial,
  type Object3D,
} from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { DOCK_RAIL, dockRailsOf, trucksOf } from '../../core/docks';
import { cueFits, isDestined } from '../../core/sorting';
import { cellToWorld, type BoxState, type GameSnapshot, type LevelData, type StorageHint, type StorageSlotState, type WallSide } from '../../core/types';
import { parseLevel } from '../../data/asciiLevel';
import { BENCHMARK_ID, getSpecialLevel } from '../../data/levels';
import { GameState } from '../../logic/GameState';
import { defaultTheme } from '../../themes/default';
import { DOCK_PLATE, DOCK_SIGN, RAIL, SIGN_CUE, TRUCK, dockColumnX, signBottom, signMidZ, signRowY, signRows, signTop } from '../builders/truck';
import { DOOR, buildWallGeometry, dockSpan, wallLayouts } from '../builders/walls';
import { CameraRig } from '../CameraRig';
import { DIORAMA, DOCK, FORK, ZONE, boxDims } from '../dims';
import { LevelView } from '../LevelView';
import { LOCK_DELAY } from './BoxView';
import { FLASH_PEAK, LOCK_SEC, TARGET_REST } from './success';

/*
 * Loading docks on screen (docs/DOCKS.md): a door in the wall with the dock plate in it, a truck parked OUTSIDE (its
 * low open flatbed level with the floor, its rear flush with the wall's outer face, nothing of it in the room and
 * nothing over or between its bed columns: boxes stack on it as on the floor), and the framed sign over the door: one
 * cell per bed column (right above its door cell) and level (bottom row = level 0), with a full-colour sticker on both
 * faces. Levels light like rack slots on the sign (only with the destined box on right levels below; the strong pulse
 * only for the next level of a column); the sign ghosts like a rack bay (never its stickers), softly with its wall
 * sunk; the truck never sinks and stays in frame. Layouts are inline: 1- to 3-column trucks of up to 2 levels, on the
 * north and the west wall.
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/**
 * The docs/DOCKS.md example: a north dock at door cells 2–3. Column 0: «azul» / «▲»; column 1: «coral ◆», with the
 * menta ▲ loaded on it by mistake. The azul ▲ goes to the bottom of column 0 and the menta ▲ on top of it.
 */
const NORTH = level(`
# 1 · Muelle de ejemplo
id: muelle-ejemplo
limit: 2
ventanas: oeste 2-3

  01234567
0 .pTTp...
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
`);

/** A one-column north dock at cell 3: «azul» / «▲». The azul ■ is the zone's, so the azul ▲ goes below the menta ▲. */
const NORTH1 = level(`
# 2 · Muelle norte de una columna
id: muelle-norte-uno
limit: 2

  012345
0 ..pTp.
1 ......
2 .a.cb.
3 ..^..1

1 = zona ■
a = caja azul ▲        b = caja azul ■        c = caja menta ▲
T = camión muelle norte: azul / ▲
`);

/** A three-column north dock at cells 1–3: «azul» / «coral», «menta», «lavanda». */
const NORTH3 = level(`
# 3 · Muelle norte triple
id: muelle-norte-triple
limit: 2

  0123456
0 pTTTp..
1 .......
2 .a.b.c.
3 ...^.d.

a = caja azul ●        b = caja coral ◆       c = caja menta ■       d = caja lavanda ✚
T = camión muelle norte: azul / coral | menta | lavanda
`);

/** A one-column west dock at row 2: «lavanda ✚» already loaded right, then «azul» over it. */
const WEST = level(`
# 4 · Muelle oeste
id: muelle-oeste
limit: 2
ventanas: norte 4-5

  01234567
0 ........
1 p.......
2 T....1..
3 p.a..b..
4 ....^...

1 = zona amarillo
a = caja azul ●        b = caja amarillo ■
T = camión muelle oeste: lavanda ✚ + caja lavanda ✚ / azul
`);

/** The docs example on the west wall: rows 1–2, column 0 (north) «azul» / «▲», column 1 «coral ◆» + menta ▲. */
const WEST2 = level(`
# 5 · Muelle oeste doble
id: muelle-oeste-doble
limit: 2

  01234567
0 p.......
1 T.......
2 T....1..
3 pa..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle oeste: azul / ▲ | coral ◆ + caja menta ▲
`);

/** A three-column west dock at rows 1–3: «azul», «menta» / «coral», «lavanda». */
const WEST3 = level(`
# 6 · Muelle oeste triple
id: muelle-oeste-triple
limit: 2

  0123456
0 p......
1 T......
2 T..a.b.
3 T..c...
4 p..^.d.

a = caja azul ●        b = caja coral ◆       c = caja menta ■       d = caja lavanda ✚
T = camión muelle oeste: azul | menta / coral | lavanda
`);

const ALL = [NORTH, NORTH1, NORTH3, WEST, WEST2, WEST3];

const YAW = Math.PI / 4;
const T = DIORAMA.wallThickness;
const height = boxDims(GAME_CONFIG).height;
const half = GAME_CONFIG.box.size / 2;
const tanPitch = Math.tan((GAME_CONFIG.camera.pitchDeg * Math.PI) / 180);
/** A camera yaw that sinks the wall of `wall` (the camera behind it, outside). */
const behindOf = (wall: WallSide) => (wall === 'north' ? YAW + Math.PI / 2 : YAW - Math.PI / 2);

function setup(lvl: LevelData = NORTH, yaw = YAW): { snap: GameSnapshot; view: LevelView } {
  const snap = new GameState(lvl).getSnapshot();
  return { snap, view: new LevelView(snap, defaultTheme, GAME_CONFIG, yaw) };
}

function step(view: LevelView, snap: GameSnapshot, seconds: number, yaw = YAW, t0 = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) view.update(snap, 1 / 60, t0 + i / 60, yaw, 0);
}

type Lit = Mesh<BufferGeometry, MeshStandardMaterial>;
type Unlit = Mesh<BufferGeometry, MeshBasicMaterial>;
const truckGroup = (view: LevelView, id = 't1') => view.root.children.find((c) => c.userData.truckId === id)!;
const child = <M extends Mesh>(view: LevelView, tag: string, id: string) =>
  truckGroup(view, id.split(':')[0]).children.find((c) => c.userData[tag] === id) as M | undefined;
const body = (view: LevelView, id = 't1') => child<Lit>(view, 'truckBody', id)!;
const plate = (view: LevelView, id = 't1') => child<Lit>(view, 'truckPlate', id)!;
const signFrame = (view: LevelView, id = 't1') => truckGroup(view, id).children.find((c) => c.userData.sign) as Lit;
const rails = (view: LevelView, id = 't1') => truckGroup(view, id).children.find((c) => c.userData.dockRails === id) as Lit | undefined;
const cueMesh = (view: LevelView, id: string) => child<Unlit>(view, 'truckCue', id);
const band = (view: LevelView, id: string) => child<Unlit>(view, 'truckGlow', id);
const panel = (view: LevelView, id: string) => child<Lit>(view, 'signPanel', id);
const boxGroup = (view: LevelView, id: string) => view.root.children.find((c) => c.userData.boxId === id)!;
const boxMesh = (view: LevelView, id: string) => boxGroup(view, id).children[0] as Lit;
const tagged = (view: LevelView, tag: string) => view.root.children.find((c) => c.userData[tag]) as Unlit;
/** The dock's fit box (the only one reaching down to the driveway). */
const truckFit = (view: LevelView) => view.fitBoxes.find((f) => f.min.y < DOCK.apronTop)!;
/** A wall of the view is sunk this frame (its group squashed flat, WallView). */
const wallSunk = (view: LevelView) => view.root.children.some((c) => c.scale.y < 0.01);
/** The truck levels of the snapshot (snapshot.storageSlots of skin truck) and whether a box rests on one. */
const truckSlots = (snap: GameSnapshot) => snap.storageSlots.filter((s) => s.skin === 'truck');
const onTruck = (snap: GameSnapshot, box: BoxState) => box.slotId !== null && truckSlots(snap).some((s) => s.id === box.slotId);
const slotOf = (snap: GameSnapshot, id: string) => truckSlots(snap).find((s) => s.id === id)!;
/** hint.storage as logic shows it while a drop would land on truck level `slot` (docs/STORAGE.md: until phase 6). */
const dropOn = (snap: GameSnapshot, slot: StorageSlotState): StorageHint => {
  const levels = truckSlots(snap).filter((s) => s.unitId === slot.unitId && s.column === slot.column).length;
  return { unitId: slot.unitId, skin: 'truck', column: slot.column, levels, level: slot.level, slotId: slot.id, ready: true };
};
const boxOf = (snap: GameSnapshot, color: string, symbol: string) => snap.boxes.find((b) => b.color === color && b.symbol === symbol)!;
const colorDistance = (a: Color, b: Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
/** Direction from the scene toward the camera (LevelView's `back`). */
const toCamera = (yaw: number) => {
  const p = (GAME_CONFIG.camera.pitchDeg * Math.PI) / 180;
  return new Vector3(Math.cos(p) * Math.sin(yaw), Math.sin(p), Math.cos(p) * Math.cos(yaw));
};

/** World → dock-local (builders/truck: x along the wall, y up, z inward from the wall's inner face). */
function toDock(lvl: LevelData, wall: WallSide, p: Vector3): Vector3 {
  const { width: w, depth: d } = lvl.size;
  return wall === 'north' ? new Vector3(p.x + w / 2, p.y, p.z + d / 2) : new Vector3(d / 2 - p.z, p.y, p.x + w / 2);
}
/** Dock-local → world. */
function toWorld(lvl: LevelData, wall: WallSide, x: number, y: number, z: number): Vector3 {
  const { width: w, depth: d } = lvl.size;
  return wall === 'north' ? new Vector3(x - w / 2, y, z - d / 2) : new Vector3(z - w / 2, y, d / 2 - x);
}
/** A dock-local box in world space. */
const dockBox = (lvl: LevelData, wall: WallSide, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) =>
  new Box3().setFromPoints([toWorld(lvl, wall, x0, y0, z0), toWorld(lvl, wall, x1, y1, z1)]);

function isPainted(col: { getX(i: number): number; getY(i: number): number; getZ(i: number): number }, i: number, c: Color): boolean {
  return Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4;
}

function painted(geo: BufferGeometry, hex: string): number {
  const c = new Color(hex);
  const col = geo.getAttribute('color');
  let n = 0;
  for (let i = 0; i < col.count; i++) if (isPainted(col, i, c)) n++;
  return n;
}

/** World-space vertices of `mesh`. */
function vertices(mesh: Mesh): Vector3[] {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.getAttribute('position');
  const out: Vector3[] = [];
  for (let i = 0; i < pos.count; i++) out.push(new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  return out;
}

/** World-space bounds of each triangle of `mesh` (optionally only those painted `hex`). */
function triangles(mesh: Mesh, hex?: string): Box3[] {
  mesh.updateWorldMatrix(true, false);
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const col = geo.getAttribute('color');
  const c = hex ? new Color(hex) : null;
  const out: Box3[] = [];
  for (let i = 0; i < pos.count; i += 3) {
    if (c && !isPainted(col, i, c)) continue;
    const box = new Box3();
    for (let k = 0; k < 3; k++) box.expandByPoint(new Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
    out.push(box);
  }
  return out;
}

/** The boxes overlap by more than `eps` on every axis. */
const overlaps = (a: Box3, b: Box3, eps = 1e-4) =>
  a.max.x > b.min.x + eps && a.min.x < b.max.x - eps && a.max.y > b.min.y + eps && a.min.y < b.max.y - eps && a.max.z > b.min.z + eps && a.min.z < b.max.z - eps;

/**
 * The walls of `lvl` as LevelView places them (world space, both faces hit by rays); with `yaw`, only those standing
 * for a camera at that yaw (WallView: a wall sinks while the camera is behind it).
 */
function wallMeshes(lvl: LevelData, yaw?: number): Mesh[] {
  const standing = wallLayouts(lvl).filter((l) => yaw === undefined || l.inward.x * Math.sin(yaw) + l.inward.z * Math.cos(yaw) > -0.05);
  return standing.map((layout) => {
    const mesh = new Mesh(buildWallGeometry(layout, defaultTheme, new Vector3(0.5, 1, -0.5).normalize()).body, new MeshBasicMaterial({ side: DoubleSide }));
    mesh.position.copy(layout.position);
    mesh.rotation.y = layout.rotationY;
    mesh.updateMatrixWorld(true);
    return mesh;
  });
}

/**
 * Hand-driven snapshot edits (the view only reads it). `load`: rest `box` on truck slot `slot`, satisfied when it is
 * the destined one on satisfied levels below (then locked, and the level above becomes loadable). `carry`: lift it.
 */
function load(snap: GameSnapshot, box: BoxState, slot: StorageSlotState): void {
  const column = truckSlots(snap).filter((s) => s.unitId === slot.unitId && s.column === slot.column);
  const right = column.every((s) => s.level >= slot.level || s.satisfied) && isDestined(slot, box);
  for (const s of truckSlots(snap)) if (s.occupiedBy === box.id) Object.assign(s, { occupiedBy: null, satisfied: false });
  Object.assign(box, { carried: false, cell: { ...slot.cell }, pos: { ...slot.pos }, level: slot.level, zoneId: null, slotId: slot.id, correct: right, locked: right });
  Object.assign(slot, { occupiedBy: box.id, satisfied: right, loadable: false });
  const above = column.find((s) => s.level === slot.level + 1);
  if (above) above.loadable = right;
  if (snap.forklift.carrying === box.id) snap.forklift.carrying = null;
}
function carry(snap: GameSnapshot, box: BoxState): void {
  for (const s of truckSlots(snap)) {
    if (s.occupiedBy !== box.id) continue;
    Object.assign(s, { occupiedBy: null, satisfied: false });
    const below = truckSlots(snap).filter((t) => t.unitId === s.unitId && t.column === s.column && t.level < s.level);
    s.loadable = below.every((t) => t.satisfied);
  }
  Object.assign(box, { carried: true, cell: null, level: 0, zoneId: null, slotId: null, correct: false, locked: false });
  snap.forklift.carrying = box.id;
  snap.forklift.forkLift = 1;
}
/** Highest glow of each truck level's sign panel over `seconds`. */
function peakGlow(view: LevelView, snap: GameSnapshot, seconds: number): Map<string, number> {
  const peak = new Map<string, number>();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    view.update(snap, 1 / 60, i / 60, YAW, 0);
    for (const s of truckSlots(snap)) peak.set(s.id, Math.max(peak.get(s.id) ?? 0, panel(view, s.id)!.material.emissiveIntensity));
  }
  return peak;
}

describe('dock door', () => {
  it('opens its wall over the door cells from the sill up: baseboard broken, a load up to level 1 passes clear', () => {
    for (const lvl of ALL) {
      const truck = trucksOf(lvl)[0];
      const layouts = wallLayouts(lvl);
      const layout = layouts.find((l) => l.side === truck.wall)!;
      expect(layouts.find((l) => l.side !== truck.wall)!.doors).toEqual([]);
      const span = dockSpan(truck, lvl);
      expect(span.b - span.a).toBe(truck.columns.length);
      expect(layout.doors).toEqual([{ a: span.a + DOCK.doorInset, b: span.b - DOCK.doorInset }]);
      const door = layout.doors[0];
      const geo = buildWallGeometry(layout, defaultTheme, new Vector3(0.5, 1, -0.5).normalize());
      const mesh = new Mesh(geo.body);
      // No wall and no baseboard inside the opening, between the sill and the door top.
      const opening = new Box3(new Vector3(door.a, DOCK.sillTop, -T), new Vector3(door.b, DOCK.doorTop, 0.05));
      for (const hex of [defaultTheme.wall.base, defaultTheme.wall.trim]) {
        for (const tri of triangles(mesh, hex)) expect(overlaps(tri, opening)).toBe(false);
      }
      // Nothing at all where a box goes through, from the bed cell to the door cell, up to a load carried to level 1
      // (forks up + one stack step: its top at ≈ 1.62; the shutter's rail waits above it).
      const loadTop = 0.34 + 2 * height;
      expect(loadTop).toBeLessThan(DOCK.doorTop - DOOR.rail);
      const passage = new Box3(new Vector3(span.a + 0.5 - half, DOCK.sillTop + 0.01, -1), new Vector3(span.b - 0.5 + half, loadTop + 0.01, 0.05));
      for (const tri of triangles(mesh)) expect(overlaps(tri, passage)).toBe(false);
      // The rolled-up door waits outside, over the opening (the inner face over the door is the sign's).
      const roll = triangles(mesh, defaultTheme.truck.shutter);
      expect(roll.length).toBeGreaterThan(0);
      for (const tri of roll) {
        expect(tri.max.z).toBeLessThanOrEqual(-T + 1e-6);
        expect(tri.min.y).toBeGreaterThan(DOCK.doorTop);
      }
      // Framed in slate, sealed in rubber outside: never a functional hue.
      expect(painted(geo.body, defaultTheme.truck.doorFrame)).toBeGreaterThan(0);
      expect(painted(geo.body, defaultTheme.truck.rubber)).toBeGreaterThan(0);
      for (const tri of triangles(mesh, defaultTheme.truck.rubber)) expect(tri.max.z).toBeLessThanOrEqual(-T + 1e-6);
    }
    // The windows are still there, on their own.
    expect(wallLayouts(NORTH).flatMap((l) => l.openings)).toHaveLength(1);
  });

  it('adds no door, no truck and nothing new to levels without docks', () => {
    const plain = level(`
# 1 · Sin muelle
id: sin-muelle
ventanas: norte 1-2

  01234
0 .....
1 .a.1.
2 ..^..

1 = zona azul
a = caja azul
`);
    expect(wallLayouts(plain).every((l) => l.doors.length === 0)).toBe(true);
    const { snap, view } = setup(plain);
    expect(truckSlots(snap)).toEqual([]);
    step(view, snap, 0.5);
    let tagged = 0;
    view.root.traverse((o) => {
      if (o.userData.truckId || o.userData.truckBody || o.userData.truckPlate || o.userData.sign || o.userData.truckCue || o.userData.dockRails) tagged++;
    });
    expect(tagged).toBe(0);
    view.dispose();
  });
});

describe('truck', () => {
  it('is painted soft and neutral: never a box colour, never red', () => {
    const boxes = Object.values(defaultTheme.boxes).flatMap((b) => [b.base, b.locked]).map((h) => new Color(h));
    const hsl = { h: 0, s: 0, l: 0 };
    for (const hex of Object.values(defaultTheme.truck)) {
      const c = new Color(hex);
      for (const b of boxes) expect(Math.hypot(c.r - b.r, c.g - b.g, c.b - b.b)).toBeGreaterThan(0.1);
      c.getHSL(hsl, SRGBColorSpace);
      // Saturated reds (hue within ±25° of red) never appear; greys and warm creams may.
      const redness = Math.min(hsl.h, 1 - hsl.h) * 360;
      if (hsl.s > 0.3) expect(redness).toBeGreaterThan(25);
      // Never black: the deepest tone (the tyres) stays a soft grey.
      expect(hsl.l).toBeGreaterThan(0.35);
    }
  });

  it('waits entirely outside, its bed level with the floor and its rear flush with the wall; only the flat plate is in the door', () => {
    for (const lvl of ALL) {
      const truck = trucksOf(lvl)[0];
      const { view } = setup(lvl);
      const span = dockSpan(truck, lvl);
      const local = vertices(body(view)).map((p) => toDock(lvl, truck.wall, p));
      // Nothing of the truck, its driveway or the pit face past the wall's outer face.
      for (const p of local) expect(p.z).toBeLessThanOrEqual(-T + 1e-5);
      // Low: from any camera looking over it (at the camera pitch), it never hides the floor inside the warehouse.
      for (const p of local) expect(p.y).toBeLessThanOrEqual(-p.z * tanPitch + 1e-5);
      // The bed (from the planks up): its rear just off the wall's outer face, flush with it.
      const rear = Math.max(...local.filter((p) => p.y > TRUCK.deckBottom - 0.03).map((p) => p.z));
      expect(rear).toBeLessThan(-T);
      expect(rear).toBeGreaterThan(-T - 0.02);
      // Its planks level with the floor, within the door run.
      const deck = triangles(body(view), defaultTheme.truck.deck).map((b) => new Box3().setFromPoints([toDock(lvl, truck.wall, b.min), toDock(lvl, truck.wall, b.max)]));
      expect(deck.length).toBeGreaterThan(0);
      expect(Math.max(...deck.map((b) => b.max.y))).toBeCloseTo(DOCK.bedTop, 5);
      expect(Math.min(...deck.map((b) => b.min.x))).toBeGreaterThanOrEqual(span.a);
      expect(Math.max(...deck.map((b) => b.max.x))).toBeLessThanOrEqual(span.b);
      // The dock plate: flat (under the drop preview), in the door opening, onto the floor only by its lip.
      const drop = ZONE.padHeight + 0.008;
      for (const p of vertices(plate(view)).map((q) => toDock(lvl, truck.wall, q))) {
        expect(p.y).toBeLessThan(drop);
        expect(p.z).toBeLessThanOrEqual(DOCK_PLATE.lip + 1e-5);
        expect(p.x).toBeGreaterThanOrEqual(span.a + DOCK.doorInset - 1e-5);
        expect(p.x).toBeLessThanOrEqual(span.b - DOCK.doorInset + 1e-5);
      }
      view.dispose();
    }
  });

  it('leaves its load open: nothing over or between its bed columns, and each full column clear of the door', () => {
    for (const lvl of ALL) {
      const truck = trucksOf(lvl)[0];
      const { snap, view } = setup(lvl);
      const span = dockSpan(truck, lvl);
      const rear = -T - TRUCK.rearGap;
      const far = rear - TRUCK.bedLength;
      // Between the drop sides, from the headboard to the wall, over the plate: none of the dock's own parts.
      const space = dockBox(lvl, truck.wall, span.a + TRUCK.inset + TRUCK.side + 1e-3, span.b - TRUCK.inset - TRUCK.side - 1e-3, DOCK_PLATE.top + 0.003, 3, far + TRUCK.headboard.postDepth + 1e-3, 0);
      const meshes = truckGroup(view).children.filter((c): c is Mesh => c instanceof Mesh);
      for (const mesh of meshes) for (const tri of triangles(mesh)) expect(overlaps(tri, space)).toBe(false);
      // Each bed column's full stack, from the planks up, is clear of the door, its frame, seals and roll too.
      const walls = wallMeshes(lvl);
      const columns = new Map<number, StorageSlotState[]>();
      for (const s of truckSlots(snap)) columns.set(s.column, [...(columns.get(s.column) ?? []), s]);
      expect(columns.size).toBe(truck.columns.length);
      for (const levels of columns.values()) {
        const p = levels[0].pos;
        const stack = new Box3(new Vector3(p.x - half, DOCK_PLATE.top + 0.003, p.z - half), new Vector3(p.x + half, levels.length * height, p.z + half));
        for (const mesh of [...meshes, ...walls]) for (const tri of triangles(mesh)) expect(overlaps(tri, stack)).toBe(false);
      }
      view.dispose();
    }
  });

  it('stacks the boxes on its bed outside, at floor stack heights', () => {
    const { snap, view } = setup();
    const blue = boxOf(snap, 'blue', 'triangle');
    const mint = boxOf(snap, 'mint', 'triangle');
    load(snap, blue, slotOf(snap, 't1:0:0'));
    load(snap, mint, slotOf(snap, 't1:0:1'));
    step(view, snap, 1.5);
    const p = slotOf(snap, 't1:0:0').pos;
    // Beyond the wall: the bed cell's centre is half a cell past the wall's inner face.
    expect(p.z).toBeCloseTo(-NORTH.size.depth / 2 - 0.5, 6);
    expect(boxGroup(view, blue.id).position.y).toBeCloseTo(0, 3);
    expect(boxGroup(view, mint.id).position.y).toBeCloseTo(height, 3);
    expect(boxGroup(view, mint.id).position.x).toBeCloseTo(p.x, 3);
    expect(boxGroup(view, mint.id).position.z).toBeCloseTo(p.z, 3);
    view.dispose();
  });
});

describe('guard rails', () => {
  /** A north door in the corner (no rail at its west end) and a west door (rails north and south of its run). */
  const CORNER = level(`
# 9 · Puerta en el rincón
id: puerta-rincon
limit: 1

  012345
0 TTp...
1 ......
2 .a.b..
3 ...^..

a = caja azul ●        b = caja coral ◆
T = camión muelle norte: azul | coral
`);

  it('stands at each end of the door run within the footprint the logic gives it: from the door frame one cell in', () => {
    for (const lvl of [...ALL, CORNER]) {
      const truck = trucksOf(lvl)[0];
      const own = dockRailsOf(lvl);
      expect(own.length, lvl.id).toBe(lvl === CORNER ? 1 : 2);
      const { view } = setup(lvl);
      const mesh = rails(view)!;
      expect(mesh, lvl.id).toBeDefined();
      // Each rail: two posts with a cream cap, two bars (every part a box of 36 vertices).
      expect(painted(mesh.geometry, defaultTheme.truck.railCap)).toBe(own.length * 2 * 36);
      expect(painted(mesh.geometry, defaultTheme.truck.rail)).toBe(own.length * 4 * 36);
      // Along the wall (dock-local x) a west door's rails run the other way: local x = depth − z.
      const along = (u: number) => (truck.wall === 'north' ? u : lvl.size.depth - u);
      const spans = own.map((r) => [Math.min(along(r.line), along(r.outer)), Math.max(along(r.line), along(r.outer))]);
      for (const p of vertices(mesh).map((q) => toDock(lvl, truck.wall, q))) {
        // Off the door frame (proud of the wall), never into the row behind the door cells.
        expect(p.z).toBeGreaterThanOrEqual(DOOR.proud - 1e-5);
        expect(p.z).toBeLessThanOrEqual(1 + 1e-5);
        expect(p.y).toBeGreaterThanOrEqual(-1e-5);
        expect(p.y).toBeLessThanOrEqual(RAIL.top + RAIL.cap + 1e-5);
        // Inside one rail's footprint along the wall (its cap a hair over it).
        expect(spans.some(([a, b]) => p.x >= a - RAIL.capOver - 1e-5 && p.x <= b + RAIL.capOver + 1e-5)).toBe(true);
      }
      // The orange posts reach the jamb line exactly (the opening's side, one straight chute) and are DOCK_RAIL thick.
      const orange = triangles(mesh, defaultTheme.truck.rail).map((b) => new Box3().setFromPoints([toDock(lvl, truck.wall, b.min), toDock(lvl, truck.wall, b.max)]));
      for (const [a, b] of spans) {
        const posts = orange.filter((t) => t.min.x >= a - 1e-5 && t.max.x <= b + 1e-5);
        expect(Math.min(...posts.map((t) => t.min.x))).toBeCloseTo(a, 5);
        expect(Math.max(...posts.map((t) => t.max.x))).toBeCloseTo(b, 5);
        expect(b - a).toBeCloseTo(DOCK_RAIL.thickness, 9);
      }
      view.dispose();
    }
  });

  it('is low and soft orange: well under a carried box, never a box colour, never red; it casts and takes shadows', () => {
    const { view } = setup();
    const mesh = rails(view)!;
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    // Under the carried box by far (forks up: its bottom at FORK.upY, its top a box height higher).
    expect(RAIL.top + RAIL.cap).toBeLessThan(FORK.upY + height - 0.4);
    const hsl = { h: 0, s: 0, l: 0 };
    new Color(defaultTheme.truck.rail).getHSL(hsl, SRGBColorSpace);
    expect(hsl.h * 360).toBeGreaterThan(25);
    expect(hsl.h * 360).toBeLessThan(35);
    expect(hsl.s).toBeGreaterThan(0.5);
    const orange = new Color(defaultTheme.truck.rail);
    for (const b of Object.values(defaultTheme.boxes).flatMap((p) => [p.base, p.tape, p.glyph, p.ink, p.locked]).map((h) => new Color(h)))
      expect(Math.hypot(orange.r - b.r, orange.g - b.g, orange.b - b.b)).toBeGreaterThan(0.1);
    view.dispose();
  });

  it('never sinks, never fades: static and whole from every camera quarter, its dock wall up or down', () => {
    for (const lvl of [NORTH, WEST2]) {
      const { snap, view } = setup(lvl);
      const mesh = rails(view)!;
      const at = new Box3().setFromPoints(vertices(mesh));
      for (let k = 0; k < 4; k++) {
        step(view, snap, 1.5, YAW + (k * Math.PI) / 2);
        expect(mesh.visible).toBe(true);
        expect(mesh.material.transparent).toBe(false);
        expect(mesh.material.opacity).toBe(1);
        expect(new Box3().setFromPoints(vertices(mesh)).equals(at)).toBe(true);
      }
      view.dispose();
    }
  });
});

describe('dock sign', () => {
  it('hangs over the door, clear of the wall and its cap: one cell per bed column over its door cell, bottom row = level 0', () => {
    for (const lvl of ALL) {
      const truck = trucksOf(lvl)[0];
      const { snap, view } = setup(lvl);
      const span = dockSpan(truck, lvl);
      const rows = signRows(truck);
      const frame = signFrame(view);
      expect(frame).toBeDefined();
      const bounds = new Box3().setFromPoints(vertices(frame).map((p) => toDock(lvl, truck.wall, p)));
      expect(bounds.min.y).toBeCloseTo(signBottom(), 5);
      expect(bounds.min.y).toBeGreaterThan(DOCK.doorTop + DOOR.frame);
      expect(bounds.max.y).toBeCloseTo(signTop(rows), 5);
      expect(bounds.min.x).toBeCloseTo(span.a, 5);
      expect(bounds.max.x).toBeCloseTo(span.b, 5);
      // Off the wall (only its two brackets touch the inner face), in front of the cap's overhang.
      expect(bounds.min.z).toBeGreaterThanOrEqual(-1e-5);
      const layout = wallLayouts(lvl).find((l) => l.side === truck.wall)!;
      const cap = new Box3(
        new Vector3(layout.capFrom, DIORAMA.wallHeight, -T - DIORAMA.capOverhang),
        new Vector3(layout.capTo, DIORAMA.wallHeight + DIORAMA.capHeight, DIORAMA.capOverhang),
      );
      for (const tri of triangles(frame)) {
        const t = new Box3().setFromPoints([toDock(lvl, truck.wall, tri.min), toDock(lvl, truck.wall, tri.max)]);
        expect(overlaps(t, cap)).toBe(false);
      }
      // Every level's sticker sits on its cell: right over its door cell, its row from the bottom up.
      for (const s of truckSlots(snap)) {
        const cue = cueMesh(view, s.id)!;
        expect(cue).toBeDefined();
        const at = toDock(lvl, truck.wall, cue.position);
        const door = toDock(lvl, truck.wall, new Vector3(cellToWorld(s.front, lvl.size).x, 0, cellToWorld(s.front, lvl.size).z));
        expect(at.x).toBeCloseTo(door.x, 5);
        expect(at.x).toBeCloseTo(dockColumnX(truck, lvl, s.column), 5);
        expect(at.y).toBeCloseTo(signRowY(s.level), 5);
        expect(at.z).toBeCloseTo(signMidZ(), 5);
        expect(panel(view, s.id)!.position.distanceTo(cue.position)).toBeLessThan(1e-9);
        // The sticker fits its cell (between the frame's bars).
        expect(2 * SIGN_CUE.halfH).toBeLessThan(DOCK_SIGN.row - DOCK_SIGN.divider);
        expect(2 * SIGN_CUE.halfW).toBeLessThan(1 - DOCK_SIGN.divider);
      }
      // A column with fewer levels than the tallest leaves plain cream panels in the frame, and only there.
      const board = triangles(frame, defaultTheme.truck.board).map((b) => new Box3().setFromPoints([toDock(lvl, truck.wall, b.min), toDock(lvl, truck.wall, b.max)]));
      const blanks = truck.columns.reduce((n, cues) => n + rows - cues.length, 0);
      expect(board.length > 0).toBe(blanks > 0);
      truck.columns.forEach((cues, column) => {
        const x = dockColumnX(truck, lvl, column);
        for (let k = 0; k < rows; k++) {
          const cell = new Box3(new Vector3(x - 0.45, signRowY(k) - 0.15, 0), new Vector3(x + 0.45, signRowY(k) + 0.15, 1));
          expect(board.some((b) => overlaps(b, cell)), `${lvl.id} column ${column} row ${k}`).toBe(k >= cues.length);
        }
      });
      // Always in frame and in the shadow volume (it may rise over the wall cap), with the whole truck.
      const fit = new Box3(truckFit(view).min, truckFit(view).max);
      expect(fit.containsBox(new Box3().setFromPoints(vertices(frame)))).toBe(true);
      expect(fit.containsBox(new Box3().setFromPoints(vertices(body(view))))).toBe(true);
      expect(view.shadowBounds.containsBox(fit)).toBe(true);
      view.dispose();
    }
  });

  it('shows each level at full colour: unlit, opaque, the colour of the box it asks for, its symbol bold', () => {
    const r = defaultTheme.rack;
    for (const lvl of ALL) {
      const { snap, view } = setup(lvl);
      for (const s of truckSlots(snap)) {
        const cue = cueMesh(view, s.id)!;
        // Unlit, opaque, not tone mapped: exactly its colours, never shaded or faded.
        expect(cue.material.toneMapped).toBe(false);
        expect(cue.material.transparent).toBe(false);
        expect(cue.material.opacity).toBe(1);
        // Every truck level asks for something until phase 6 (no «libre» there yet).
        const accepts = s.accepts!;
        const box = accepts.color ? defaultTheme.boxes[accepts.color] : null;
        expect(painted(cue.geometry, box ? box.base : r.cueFill)).toBeGreaterThan(0);
        expect(painted(cue.geometry, box ? box.ink : r.cueRim)).toBeGreaterThan(0);
        // These levels sort by symbol: a symbol cue carries it bold, a colour-only cue none.
        expect(painted(cue.geometry, r.cueInk) > 0).toBe(accepts.symbol !== undefined);
      }
      view.dispose();
    }
  });

  it('turns a sticker to the warehouse and one to the outside: upright, never mirrored, one facing every camera angle', () => {
    for (const lvl of ALL) {
      const truck = trucksOf(lvl)[0];
      const { snap, view } = setup(lvl);
      const inward = truck.wall === 'north' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
      const yaws = [0, 1, 2, 3].map((k) => YAW + (k * Math.PI) / 2);
      for (const s of truckSlots(snap)) {
        const mesh = cueMesh(view, s.id)!;
        mesh.updateWorldMatrix(true, false);
        // A pure yaw: never mirrored, never tilted (its up stays up).
        expect(mesh.matrixWorld.determinant()).toBeCloseTo(1, 6);
        expect(new Vector3(0, 1, 0).transformDirection(mesh.matrixWorld).y).toBeCloseTo(1, 6);
        const pos = mesh.geometry.getAttribute('position');
        const nor = mesh.geometry.getAttribute('normal');
        const rot = new Matrix4().extractRotation(mesh.matrixWorld);
        const sides = new Set<number>();
        const best = yaws.map(() => -1);
        for (let i = 0; i < pos.count; i += 3) {
          const v = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
          const winding = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
          const n = new Vector3().fromBufferAttribute(nor, i).applyMatrix4(rot);
          // Counter-clockwise seen from where its normal points: drawn, not culled (a mirror would flip it).
          expect(winding.dot(n)).toBeGreaterThan(0.99);
          sides.add(Math.round(n.dot(inward)));
          yaws.forEach((yaw, k) => {
            const c = toCamera(yaw).setY(0).normalize();
            best[k] = Math.max(best[k], n.dot(c));
          });
        }
        expect([...sides].sort()).toEqual([-1, 1]);
        for (const b of best) expect(b).toBeGreaterThan(0.5);
      }
      view.dispose();
    }
  });

  it('never covers a sticker with its frame, from any camera quarter: its brackets hide behind the end bars', () => {
    const raycaster = new Raycaster();
    const yaws = [0, 1, 2, 3].map((k) => YAW + (k * Math.PI) / 2);
    for (const lvl of ALL) {
      const { snap, view } = setup(lvl);
      const frame = signFrame(view);
      frame.updateWorldMatrix(true, false);
      // Either face of a frame triangle blocks the view (a sticker point may even sit inside a bar or a bracket).
      const solid = new Mesh(frame.geometry, new MeshBasicMaterial({ side: DoubleSide }));
      solid.matrixAutoUpdate = false;
      solid.matrixWorld.copy(frame.matrixWorld);
      for (const s of truckSlots(snap)) {
        const cue = cueMesh(view, s.id)!;
        cue.updateWorldMatrix(true, false);
        const pos = cue.geometry.getAttribute('position');
        const nor = cue.geometry.getAttribute('normal');
        const rot = new Matrix4().extractRotation(cue.matrixWorld);
        for (const yaw of yaws) {
          const dir = toCamera(yaw);
          let seen = 0;
          for (let i = 0; i < pos.count; i += 3) {
            const n = new Vector3().fromBufferAttribute(nor, i).applyMatrix4(rot);
            // Only the face turned toward that camera shows (its back face is culled).
            if (n.dot(dir) <= 0) continue;
            const v = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(cue.matrixWorld));
            const centre = v[0].clone().add(v[1]).add(v[2]).divideScalar(3);
            // Its corners (a hair inside) and its centre, just off the sticker's surface, looking at the camera.
            for (const p of [...v.map((q) => q.lerp(centre, 0.05)), centre]) {
              raycaster.set(p.addScaledVector(n, 1e-4), dir);
              expect(raycaster.intersectObject(solid, false), `${lvl.id} ${s.id} yaw ${yaw.toFixed(2)}`).toEqual([]);
              seen++;
            }
          }
          expect(seen).toBeGreaterThan(0);
        }
      }
      solid.material.dispose();
      view.dispose();
    }
  });
});

describe('truck levels light like rack slots, on the sign', () => {
  it('lights a level only with its destined box on right levels below: flash, burst, soft glow, deeper box', () => {
    const { snap, view } = setup();
    step(view, snap, 1);
    // The menta ▲ loaded on «coral ◆» fits nothing there: neutral.
    expect(panel(view, 't1:1:0')!.material.emissiveIntensity).toBeLessThan(0.01);
    expect(band(view, 't1:1:0')!.visible).toBe(false);

    const blue = boxOf(snap, 'blue', 'triangle');
    const tint = boxMesh(view, blue.id).material.color.clone();
    load(snap, blue, slotOf(snap, 't1:0:0'));
    let peak = 0;
    let burst = false;
    let bandPeak = 0;
    for (let i = 0; i < 60; i++) {
      view.update(snap, 1 / 60, i / 60, YAW, 0);
      peak = Math.max(peak, panel(view, 't1:0:0')!.material.emissiveIntensity);
      bandPeak = Math.max(bandPeak, band(view, 't1:0:0')!.material.opacity);
      burst ||= view.root.children.some((c) => c.userData.successBurst && c.visible);
    }
    expect(peak).toBeGreaterThan(FLASH_PEAK * 0.9);
    expect(bandPeak).toBeGreaterThan(0.8);
    expect(burst).toBe(true);
    // The burst plays on the box on the bed, at the door plane (the face the default camera sees).
    const ring = view.root.children.find((c) => c.userData.successBurst)!;
    const p = slotOf(snap, 't1:0:0').pos;
    expect(ring.position.x).toBeCloseTo(p.x, 6);
    expect(ring.position.z).toBeCloseTo(p.z, 6);
    step(view, snap, LOCK_DELAY + LOCK_SEC + 1);
    expect(panel(view, 't1:0:0')!.material.emissiveIntensity).toBeCloseTo(TARGET_REST, 2);
    // The sticker glows by brightening its own colour, never below full colour.
    expect(cueMesh(view, 't1:0:0')!.material.color.r).toBeGreaterThan(1);
    // Locked: the box eased to its deeper tone.
    expect(colorDistance(boxMesh(view, blue.id).material.color, tint)).toBeGreaterThan(0.05);

    // The destined menta ▲ on a wrong base stays neutral: the column is wrong from the bed up.
    const other = setup();
    const yellow = boxOf(other.snap, 'yellow', 'square');
    load(other.snap, yellow, slotOf(other.snap, 't1:0:0'));
    const mint = boxOf(other.snap, 'mint', 'triangle');
    carry(other.snap, mint);
    load(other.snap, mint, slotOf(other.snap, 't1:0:1'));
    step(other.view, other.snap, 2);
    expect(slotOf(other.snap, 't1:0:1').satisfied).toBe(false);
    expect(panel(other.view, 't1:0:1')!.material.emissiveIntensity).toBeLessThan(0.01);
    view.dispose();
    other.view.dispose();
  });

  it('while carrying, only the next level of a column whose cue fits pulses clearly, in the tone of the box', () => {
    const { snap, view } = setup();
    view.setTargetHints(true); // the optional target hints (P)
    const blue = boxOf(snap, 'blue', 'triangle');
    carry(snap, blue);
    step(view, snap, 1);
    let peak = peakGlow(view, snap, 3);
    // «azul» (next level of column 0) takes it: a clear pulse. «▲» fits it too but is not next: still.
    expect(peak.get('t1:0:0')!).toBeGreaterThan(0.24);
    expect(peak.get('t1:0:1')!).toBeLessThan(0.02);
    expect(peak.get('t1:1:0')!).toBeLessThan(0.02);
    expect(band(view, 't1:0:0')!.visible).toBe(true);
    expect(colorDistance(band(view, 't1:0:0')!.material.color, new Color(defaultTheme.boxes.blue.base))).toBeLessThan(1e-3);

    // Loaded right: now the «▲» over it is next, and pulses for the menta ▲ (the «coral ◆» it leaves does not fit).
    load(snap, blue, slotOf(snap, 't1:0:0'));
    carry(snap, boxOf(snap, 'mint', 'triangle'));
    step(view, snap, 2);
    peak = peakGlow(view, snap, 3);
    expect(peak.get('t1:0:1')!).toBeGreaterThan(0.24);
    expect(peak.get('t1:1:0')!).toBeLessThan(0.02);
    view.dispose();
  });

  it('previews the drop on the bed outside at its level, on top of a locked box, in the box tone only where it is right now', () => {
    const { snap, view } = setup();
    load(snap, boxOf(snap, 'blue', 'triangle'), slotOf(snap, 't1:0:0'));
    const mint = boxOf(snap, 'mint', 'triangle');
    carry(snap, mint);
    const top = slotOf(snap, 't1:0:1');
    Object.assign(snap.hint, { dropCell: { ...top.cell }, dropLevel: 1, dropZoneId: null, storage: dropOn(snap, top) });
    step(view, snap, 1);
    const preview = tagged(view, 'dropPreview');
    expect(preview.visible).toBe(true);
    expect(preview.position.x).toBeCloseTo(top.pos.x, 2);
    expect(preview.position.z).toBeCloseTo(top.pos.z, 2);
    expect(preview.position.z).toBeLessThan(-NORTH.size.depth / 2 - T);
    expect(preview.position.y).toBeCloseTo(height + ZONE.padHeight + 0.008, 2);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.zones.mint.border))).toBeLessThan(0.02);

    // «coral ◆» would not take it: the preview stays neutral, over the plate and the bed (never under them).
    const coral = slotOf(snap, 't1:1:0');
    Object.assign(snap.hint, { dropCell: { ...coral.cell }, dropLevel: 0, storage: dropOn(snap, coral) });
    step(view, snap, 1);
    expect(preview.visible).toBe(true);
    expect(preview.position.y).toBeGreaterThan(DOCK_PLATE.top + 0.002);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.floor.edge))).toBeLessThan(0.02);
    view.dispose();
  });

  it('tints the preview where the cue fits and the level loads next, never «this is its destiny»: a trap is tinted too', () => {
    // «azul» takes the azul ▲ (the zone ■ is the azul ■'s): the azul ■ fits the cue, is tinted and pulses, then buzzes
    // on the drop (wrongTarget: logic/GameState.docks.test.ts), as a rack slot's cue would (docs/DOCKS.md, vista previa).
    const TRAP = level(`
# 7 · Trampa del camión
id: trampa-camion
limit: 2

  012345
0 .pTp..
1 ......
2 .a..b.
3 ...^.1

1 = zona ■
a = caja azul ▲        b = caja azul ■
T = camión muelle norte: azul
`);
    const { snap, view } = setup(TRAP);
    view.setTargetHints(true); // the optional target hints (P): the level pulses too
    const slot = slotOf(snap, 't1:0:0');
    const trap = boxOf(snap, 'blue', 'square');
    expect(cueFits(slot, trap)).toBe(true);
    expect(isDestined(slot, trap)).toBe(false);
    expect(slot.loadable).toBe(true);
    carry(snap, trap);
    Object.assign(snap.hint, { dropCell: { ...slot.cell }, dropLevel: 0, dropZoneId: null, storage: dropOn(snap, slot) });
    const peak = peakGlow(view, snap, 3);
    const preview = tagged(view, 'dropPreview');
    expect(preview.visible).toBe(true);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.zones.blue.border))).toBeLessThan(0.02);
    expect(peak.get(slot.id)!).toBeGreaterThan(0.24);
    view.dispose();
  });
});

describe('dock and camera', () => {
  it('fades the sign like a rack bay while it hides the forklift from outside, softly while its wall is down, never its stickers', () => {
    for (const lvl of [NORTH, WEST2]) {
      const truck = trucksOf(lvl)[0];
      const behind = behindOf(truck.wall);
      const { snap, view } = setup(lvl, behind);
      // The forklift where the sign stands between it and the camera: its middle seen through the sign's middle.
      const back = toCamera(behind);
      const span = dockSpan(truck, lvl);
      const centre = toWorld(lvl, truck.wall, (span.a + span.b) / 2, (signBottom() + signTop(signRows(truck))) / 2, signMidZ());
      const at = centre.clone().addScaledVector(back, -(centre.y - 0.6) / back.y);
      snap.forklift.pos = { x: at.x, z: at.z };
      step(view, snap, 1.5, behind);
      const frame = signFrame(view);
      expect(frame.material.opacity).toBeLessThan(0.4);
      expect(frame.material.depthWrite).toBe(false);
      for (const s of truckSlots(snap)) expect(panel(view, s.id)!.material.opacity).toBeCloseTo(frame.material.opacity, 6);
      for (const s of truckSlots(snap)) {
        const cue = cueMesh(view, s.id)!;
        expect(cue.visible).toBe(true);
        expect(cue.material.transparent).toBe(false);
        expect(cue.material.opacity).toBe(1);
        expect(cue.material.depthWrite).toBe(true);
      }
      // Nothing behind it now (the forklift in the far corner), but its wall is down: it stands where the lintel was,
      // a soft ghost.
      snap.forklift.pos = { x: lvl.size.width / 2 - 0.5, z: lvl.size.depth / 2 - 0.5 };
      step(view, snap, 2, behind);
      expect(frame.material.opacity).toBeGreaterThan(0.5);
      expect(frame.material.opacity).toBeLessThan(0.7);
      // From inside (the default camera) the sign hangs behind everything: solid, even over a stack on the bed.
      const s0 = truckSlots(snap).find((s) => s.level === 1)!;
      const below = truckSlots(snap).find((s) => s.column === s0.column && s.level === 0)!;
      const loose = snap.boxes.filter((b) => !onTruck(snap, b));
      if (!below.occupiedBy) load(snap, loose[0], below);
      load(snap, loose.find((b) => b.id !== below.occupiedBy)!, s0);
      step(view, snap, 3);
      expect(frame.material.opacity).toBe(1);
      view.dispose();
    }
  });

  it('never ghosts a rack for a box the standing dock wall already hides: on the forks through the door or on the bed (Benchmark)', () => {
    const bench = getSpecialLevel(BENCHMARK_ID)!;
    const { snap, view } = setup(bench);
    const { width: w, depth: d } = bench.size;
    // R stands two cells east of the door; from the default camera a box on the bed beyond (2,0) lies «behind» it, but
    // behind the wall first.
    const rack = view.root.children.find((c) => c.userData.rackId === 'r1')!;
    const bays = rack.children.filter((c): c is Lit => c instanceof Mesh && c.userData.rack === true);
    expect(bays).toHaveLength(2);
    const opacity = () => bays.map((b) => b.material.opacity);
    step(view, snap, 1);
    expect(opacity()).toEqual([1, 1]);
    // The amarillo ✚ on the forks, through the door of (2,0): the forklift's body against the wall on that door cell.
    const yellow = boxOf(snap, 'yellow', 'cross');
    carry(snap, yellow);
    snap.forklift.pos = { x: 2.5 - w / 2, z: GAME_CONFIG.forklift.bodyRadius - d / 2 };
    snap.forklift.heading = Math.PI;
    step(view, snap, 1.5);
    expect(boxGroup(view, yellow.id).position.z + half).toBeLessThan(-d / 2);
    expect(opacity()).toEqual([1, 1]);
    // Loaded on its level (t1:1:0), the forklift back in the aisle: R stays solid all the while.
    load(snap, yellow, slotOf(snap, 't1:1:0'));
    snap.forklift.pos = { x: 2.5 - w / 2, z: 3.5 - d / 2 };
    for (let i = 0; i < 180; i++) {
      view.update(snap, 1 / 60, i / 60, YAW, 0);
      expect(opacity()).toEqual([1, 1]);
    }
    // With its wall sunk the camera looks from outside: the bed stands in front of everything, it hides nothing.
    step(view, snap, 2, behindOf('north'));
    expect(opacity()).toEqual([1, 1]);
    view.dispose();
  });

  it('never ghosts a stacked box for a lid the standing dock wall already hides', () => {
    // A two-box floor stack parked on the door cell (2,0), right beside the bed column of (1,0): from the default
    // camera the coral ◆ on that bed is «behind» its top box, but behind the wall first. (The stack starts elsewhere:
    // door cells start empty; it is set on the door cell as the player would leave it.)
    const STACK = level(`
# 8 · Pila junto a la puerta
id: pila-junto-puerta
limit: 2

  012345
0 pTTp..
1 ......
2 1....2
3 .d.c.^

1 = zona azul          2 = zona menta
c = pila azul ●,menta ▲
d = caja lavanda ■
T = camión muelle norte: coral + caja coral ◆ | lavanda
`);
    const snap = new GameState(STACK).getSnapshot();
    const door = { x: 2, z: 0 };
    ['blue', 'mint'].forEach((color, level) => {
      const box = snap.boxes.find((b) => b.color === color)!;
      Object.assign(box, { cell: { ...door }, pos: cellToWorld(door, STACK.size), level });
    });
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    const top = boxOf(snap, 'mint', 'triangle');
    expect(top).toMatchObject({ cell: door, level: 1 });
    expect(boxOf(snap, 'coral', 'diamond')).toMatchObject({ cell: { x: 1, z: -1 }, slotId: 't1:0:0' });
    for (let i = 0; i < 120; i++) {
      view.update(snap, 1 / 60, i / 60, YAW, 0);
      expect(boxMesh(view, top.id).material.opacity).toBe(1);
    }
    view.dispose();
  });

  it('never sinks: the truck, its plate and the sign stay put and in frame while their wall goes down and up', () => {
    for (const lvl of [NORTH, WEST2, NORTH3]) {
      const truck = trucksOf(lvl)[0];
      const { snap, view } = setup(lvl);
      step(view, snap, 0.5);
      const fit = truckFit(view);
      const before = { min: fit.min.clone(), max: fit.max.clone() };
      const bodyBounds = new Box3().setFromPoints(vertices(body(view)));
      expect(new Box3(fit.min, fit.max).containsBox(bodyBounds)).toBe(true);
      const loaded = snap.boxes.find((b) => onTruck(snap, b));
      const behind = behindOf(truck.wall);
      let sank = false;
      for (let i = 0; i < 240; i++) {
        view.update(snap, 1 / 60, i / 60, behind, 0);
        sank ||= wallSunk(view);
        for (const mesh of [body(view), plate(view), signFrame(view)]) {
          expect(mesh.visible).toBe(true);
          expect(mesh.scale.y).toBe(1);
        }
        expect(fit.min.equals(before.min) && fit.max.equals(before.max)).toBe(true);
      }
      expect(sank).toBe(true);
      // A box on the bed stays on the bed (never left floating over a sunk truck).
      if (loaded) expect(boxGroup(view, loaded.id).position.y).toBeCloseTo(loaded.level * height, 3);
      view.dispose();
    }
  });

  it('shows the boxes on the bed through the door from the camera: nothing of the wall or the sign in the way', () => {
    const raycaster = new Raycaster();
    for (const lvl of [NORTH1, NORTH3, WEST, WEST3]) {
      const truck = trucksOf(lvl)[0];
      const { snap, view } = setup(lvl);
      // Fill every bed column up to its top (whatever boxes: the view only reads the positions).
      const loose = snap.boxes.filter((b) => !onTruck(snap, b));
      for (const s of truckSlots(snap)) if (!s.occupiedBy) load(snap, loose.shift()!, s);
      step(view, snap, 1);
      const group = truckGroup(view);
      const sign = group.children.filter((c): c is Mesh => c instanceof Mesh && (c.userData.sign || c.userData.signPanel || c.userData.truckCue));
      for (const m of sign) m.updateMatrixWorld(true);
      // The standing wall's two camera quarters (the other two sink it).
      const yaws = truck.wall === 'north' ? [YAW, -YAW] : [YAW, YAW + Math.PI / 2];
      for (const yaw of yaws) {
        const dir = toCamera(yaw);
        const walls = wallMeshes(lvl, yaw);
        for (const s of truckSlots(snap)) {
          const c = s.pos;
          const local = toDock(lvl, truck.wall, new Vector3(c.x, 0, c.z));
          // The middle of the face the box turns to the warehouse, a hair in front of it.
          const face = toWorld(lvl, truck.wall, local.x, s.level * height + height / 2, local.z + half + 0.005);
          raycaster.set(face, dir);
          const hits = raycaster.intersectObjects([...walls, ...sign], false);
          expect(hits, `${lvl.id} ${s.id} yaw ${yaw.toFixed(2)}`).toEqual([]);
        }
      }
      view.dispose();
    }
  });

  it('keeps the frame calm on the Benchmark while its dock wall sinks and rises: idle orbit and Q/E turns, truck in frame', () => {
    // Everything framed is static (the truck, the walls whole): only the yaw moves the frame, gently (≈ 0.4 % per frame
    // at most), and at rest it never moves while the dock wall finishes sinking or rising.
    const MAX_STEP = 0.015;
    const bench = getSpecialLevel(BENCHMARK_ID)!;
    const runs: [string, number, (rig: CameraRig, frame: number) => void][] = [
      ['orbit', 242 * 60, (rig, f) => f === 0 && rig.setIdleOrbit(true)],
      ['Q', 5 * 150, (rig, f) => f % 150 === 0 && f < 600 && rig.rotate(1)],
      ['E', 5 * 150, (rig, f) => f % 150 === 0 && f < 600 && rig.rotate(-1)],
    ];
    const p = new Vector3();
    for (const [w, h] of [[1920, 1080], [800, 1200]]) {
      for (const [name, frames, drive] of runs) {
        const snap = new GameState(bench).getSnapshot();
        const rig = new CameraRig(GAME_CONFIG.camera);
        rig.setAspect(w, h);
        const view = new LevelView(snap, defaultTheme, GAME_CONFIG, rig.yaw);
        rig.setFitBoxes(view.fitBoxes);
        rig.update(0);
        const bounds = new Box3().setFromPoints([...vertices(body(view)), ...vertices(signFrame(view))]);
        let prev = rig.camera.top;
        let worst = 0;
        let spill = 0;
        let sank = false;
        // At rest (the yaw still): frames seen, and frames where the camera moved all the same.
        const last = { yaw: rig.yaw, projection: rig.camera.projectionMatrix.clone(), position: rig.camera.position.clone() };
        let rest = 0;
        let restMoves = 0;
        for (let f = 0; f < frames; f++) {
          drive(rig, f);
          rig.update(1 / 60);
          view.update(snap, 1 / 60, f / 60, rig.yaw, 0);
          worst = Math.max(worst, Math.abs(rig.camera.top / prev - 1));
          prev = rig.camera.top;
          sank ||= wallSunk(view);
          if (rig.yaw === last.yaw) {
            rest++;
            if (!rig.camera.projectionMatrix.equals(last.projection) || !rig.camera.position.equals(last.position)) restMoves++;
          }
          last.yaw = rig.yaw;
          last.projection.copy(rig.camera.projectionMatrix);
          last.position.copy(rig.camera.position);
          if (f % 10 !== 0) continue;
          rig.camera.updateMatrixWorld(true);
          for (let i = 0; i < 8; i++) {
            p.set(i & 1 ? bounds.max.x : bounds.min.x, i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z);
            p.project(rig.camera);
            spill = Math.max(spill, Math.abs(p.x), Math.abs(p.y));
          }
        }
        const label = `${name} ${w}×${h}`;
        expect(sank, label).toBe(true);
        expect(worst, label).toBeLessThan(MAX_STEP);
        expect(spill, label).toBeLessThanOrEqual(1);
        // Between the turns (the wall still easing for ≈ 0.6 s of it) the camera stays exactly still.
        if (name !== 'orbit') expect(rest, label).toBeGreaterThan(300);
        expect(restMoves, label).toBe(0);
        view.dispose();
      }
    }
  });

  it('plays the completion wave on truck levels too, creates nothing per frame and releases every resource on dispose', () => {
    const { snap, view } = setup(WEST);
    step(view, snap, 2);
    // «lavanda ✚» starts right: already glowing softly, no flash on load.
    expect(panel(view, 't1:0:0')!.material.emissiveIntensity).toBeCloseTo(TARGET_REST, 2);
    const count = () => {
      let n = 0;
      view.root.traverse(() => n++);
      return n;
    };
    const before = count();
    view.handleEvent({ type: 'levelComplete' }, snap);
    const peak = peakGlow(view, snap, 3);
    expect(peak.get('t1:0:0')!).toBeGreaterThan(TARGET_REST + 0.1);
    expect(peak.get('t1:0:1')!).toBeGreaterThan(0.1);
    step(view, snap, 2, behindOf('west'));
    expect(count()).toBe(before);

    const disposed = new Set<object>();
    const tracked: Object3D[] = [];
    view.root.traverse((o) => {
      if (o instanceof Mesh) {
        tracked.push(o);
        o.geometry.addEventListener('dispose', () => disposed.add(o.geometry));
        const m = o.material as MeshStandardMaterial;
        m.addEventListener('dispose', () => disposed.add(m));
      }
    });
    expect(tracked.filter((o) => o.parent === truckGroup(view)).length).toBeGreaterThan(3);
    view.dispose();
    for (const o of tracked) {
      const mesh = o as Mesh;
      expect(disposed.has(mesh.geometry)).toBe(true);
      expect(disposed.has(mesh.material as MeshStandardMaterial)).toBe(true);
    }
  });
});
