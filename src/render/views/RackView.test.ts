import { Box3, Color, Matrix4, Mesh, Vector3, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { racksOf } from '../../core/racks';
import { isDestined } from '../../core/sorting';
import type { BoxState, GameSnapshot, LevelData, RackHint, SlotState } from '../../core/types';
import { parseLevel } from '../../data/asciiLevel';
import { GameState } from '../../logic/GameState';
import { forkRiseRate } from '../../logic/forkRise';
import { defaultTheme } from '../../themes/default';
import { CUE, END_PLATE, LOADING_LINE, PANEL_HEIGHT, RACK_PANEL, rackTopY } from '../builders/rack';
import { FORK, RACK, boxDims, rackSlotY } from '../dims';
import { LevelView } from '../LevelView';
import { DROP_GLIDE_SEC } from './BoxView';
import { END_PLATE_OPACITY } from './RackView';

/*
 * Storage racks on screen (docs/RACKS.md, plan Fase 2): plain painted metal apart from the wooden shelves, open ends
 * (only a faint see-through plate, so the boxes show from the side), unlit cues readable from both faces and from the
 * ends, a slot lights only with its destined box, fitting slots breathe while carrying, boxes and forks at slot
 * heights, drop preview + selected-slot marker, ghosting like the shelves (the cues never fade). Layouts are inline
 * (no .level files).
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/**
 * A two-column rack in the middle of the room, front to the south (toward the default camera), rows 0–1 free behind
 * it. Column 0: «azul» / «▲» / libre; column 1: «amarillo ■» / libre. Blue ▲ fits both cues of column 0, but its
 * destiny is the «azul» slot (mint ▲ goes to «▲»): the gentle trap.
 */
const SOUTH = level(`
# 1 · Estantería de prueba
id: estanteria-render
limit: 1

  0123456
0 .......
1 .......
2 ...RR..
3 .......
4 .a.b.c.
5 ...^...

a = caja azul ▲       b = caja menta ▲       c = caja amarillo ■
R = estantería frente sur: azul / ▲ / libre | amarillo ■ / libre
`);

/** A rack along z, front to the east (its back to the west wall side): coral / libre, then lavender. */
const EAST = level(`
# 2 · Frente este
id: estanteria-este
limit: 1

  012345
0 ......
1 .R....
2 .R....
3 ......
4 .a.b^.

a = caja coral       b = caja lavanda
R = estantería frente este: coral / libre | lavanda
`);

/** A one-column rack in the middle of the room, front to the south (over x ∈ [-0.5, 0.5], z ∈ [-1, 0]): azul / libre. */
const ONE = level(`
# 3 · Una columna
id: estanteria-una
limit: 1

  01234
0 .....
1 ..R..
2 .....
3 .a.^.

a = caja azul
R = estantería frente sur: azul / libre
`);

const YAW = Math.PI / 4;
const height = boxDims(GAME_CONFIG).height;

function setup(lvl: LevelData = SOUTH): { state: GameState; snap: GameSnapshot; view: LevelView } {
  const state = new GameState(lvl);
  const snap = state.getSnapshot();
  return { state, snap, view: new LevelView(snap, defaultTheme, GAME_CONFIG, YAW) };
}

function step(view: LevelView, snap: GameSnapshot, seconds: number, yaw = YAW, t0 = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) view.update(snap, 1 / 60, t0 + i / 60, yaw, 0);
}

const rackGroup = (view: LevelView, id = 'r1') => view.root.children.find((c) => c.userData.rackId === id)!;
/** Frame mesh of each column (bay) of a rack, in column order. */
const frames = (view: LevelView, id = 'r1') =>
  rackGroup(view, id)
    .children.filter((c) => c.userData.rack)
    .sort((a, b) => a.userData.column - b.userData.column) as Mesh<BufferGeometry, MeshStandardMaterial>[];
const frame = (view: LevelView, column = 0, id = 'r1') => frames(view, id)[column];
/** The see-through end plate of each end column of a rack, in column order. */
const endPlates = (view: LevelView, id = 'r1') =>
  rackGroup(view, id)
    .children.filter((c) => c.userData.rackEndPlate !== undefined)
    .sort((a, b) => a.userData.rackEndPlate - b.userData.rackEndPlate) as Mesh<BufferGeometry, MeshStandardMaterial>[];
const rackBounds = (view: LevelView, id = 'r1') => {
  const box = new Box3();
  for (const f of frames(view, id)) box.union(f.geometry.boundingBox!);
  return box;
};
const panel = (view: LevelView, slotId: string) =>
  rackGroup(view, slotId.split(':')[0]).children.find((c) => c.userData.slotId === slotId) as Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
/** The unlit cue mesh of a slot (stickers + lip tape). */
const cueMesh = (view: LevelView, slotId: string) =>
  rackGroup(view, slotId.split(':')[0]).children.find((c) => c.userData.slotCue === slotId) as Mesh<BufferGeometry, MeshBasicMaterial> | undefined;
const cues = (view: LevelView, id = 'r1') =>
  rackGroup(view, id).children.filter((c) => c.userData.slotCue) as Mesh<BufferGeometry, MeshBasicMaterial>[];
/** The glow band of a slot with a cue (its pulse and its flash). */
const glowBand = (view: LevelView, slotId: string) =>
  rackGroup(view, slotId.split(':')[0]).children.find((c) => c.userData.slotGlow === slotId) as Mesh<BufferGeometry, MeshBasicMaterial> | undefined;
const colorDistance = (a: Color, b: Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
const boxGroup = (view: LevelView, id: string) => view.root.children.find((c) => c.userData.boxId === id)!;
const boxMesh = (view: LevelView, id: string) => boxGroup(view, id).children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
const tagged = (view: LevelView, tag: string) => view.root.children.find((c) => c.userData[tag]) as Mesh<BufferGeometry, MeshBasicMaterial>;
const slotOf = (snap: GameSnapshot, id: string) => snap.slots.find((s) => s.id === id)!;
const boxOf = (snap: GameSnapshot, color: string, symbol: string) => snap.boxes.find((b) => b.color === color && b.symbol === symbol)!;

/** The geometry vertex `i` is painted `hex` (vertex colors are linear, like three's Color). */
function paintedAt(geo: BufferGeometry, i: number, c: Color): boolean {
  const col = geo.getAttribute('color');
  return Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4;
}
function painted(geo: BufferGeometry, hex: string): number {
  const c = new Color(hex);
  let n = 0;
  for (let i = 0; i < geo.getAttribute('position').count; i++) if (paintedAt(geo, i, c)) n++;
  return n;
}
/** World positions (and normals) of the vertices of `mesh` painted `hex`. */
function paintedVertices(mesh: Mesh, hex: string): { p: Vector3; n: Vector3 }[] {
  mesh.updateWorldMatrix(true, false);
  const c = new Color(hex);
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const normal = new Matrix4().extractRotation(mesh.matrixWorld);
  const out: { p: Vector3; n: Vector3 }[] = [];
  for (let i = 0; i < pos.count; i++) {
    if (!paintedAt(geo, i, c)) continue;
    out.push({ p: new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), n: new Vector3().fromBufferAttribute(nor, i).applyMatrix4(normal) });
  }
  return out;
}

/** Hand-driven snapshot edits (the view only reads it): rest `box` in `slot`, or lift it onto the forks. */
function rest(box: BoxState, slot: SlotState): void {
  const destined = isDestined(slot, box);
  Object.assign(box, { carried: false, cell: { ...slot.cell }, pos: { ...slot.pos }, level: slot.level, slotId: slot.id, zoneId: null, correct: destined, locked: destined });
  Object.assign(slot, { occupiedBy: box.id, satisfied: destined });
}
function carry(snap: GameSnapshot, box: BoxState): void {
  for (const s of snap.slots) if (s.occupiedBy === box.id) Object.assign(s, { occupiedBy: null, satisfied: false });
  Object.assign(box, { carried: true, cell: null, level: 0, slotId: null, zoneId: null, correct: false, locked: false });
  snap.forklift.carrying = box.id;
  snap.forklift.forkLift = 1;
}
function floor(snap: GameSnapshot, box: BoxState, cell: { x: number; z: number }): void {
  const { width, depth } = snap.level.size;
  Object.assign(box, { carried: false, cell, pos: { x: cell.x + 0.5 - width / 2, z: cell.z + 0.5 - depth / 2 }, level: 0, slotId: null, locked: false });
  if (snap.forklift.carrying === box.id) snap.forklift.carrying = null;
}
function atRack(snap: GameSnapshot, slotId: string, ready: boolean): RackHint {
  const slot = slotOf(snap, slotId);
  const levels = snap.slots.filter((s) => s.rackId === slot.rackId && s.column === slot.column).length;
  const hint: RackHint = { rackId: slot.rackId, column: slot.column, levels, level: slot.level, slotId, ready };
  snap.hint.rack = hint;
  return hint;
}
/** Highest panel glow of each slot with a cue over `seconds` (breathing peaks); the cue glows along (never dims). */
function peakGlow(view: LevelView, snap: GameSnapshot, seconds: number): Map<string, number> {
  const peak = new Map<string, number>();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    view.update(snap, 1 / 60, i / 60, YAW, 0);
    for (const s of snap.slots) {
      const mesh = panel(view, s.id);
      if (!mesh) continue;
      const glow = mesh.material.emissiveIntensity;
      const tint = cueMesh(view, s.id)!.material.color;
      expect(tint.r).toBeGreaterThanOrEqual(1);
      if (glow > 0.02) expect(tint.r).toBeGreaterThan(1);
      peak.set(s.id, Math.max(peak.get(s.id) ?? 0, glow));
    }
  }
  return peak;
}
/** Winding normal of the triangle starting at vertex `i` of `mesh`, in world space. */
function windingNormal(mesh: Mesh, i: number): Vector3 {
  const pos = mesh.geometry.getAttribute('position');
  const [a, b, c] = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
  return b.sub(a).cross(c.sub(a)).normalize();
}
/** The outward direction a vertex normal points to, rounded to the room's axes (e.g. "-1,0"). */
const faceKey = (n: Vector3) => `${Math.round(n.x) || 0},${Math.round(n.z) || 0}`;

describe('rack builder + view: a different piece of furniture', () => {
  it('draws each rack column as its own mesh, plus a glowing panel and an unlit cue per slot with a cue («libre» ones stay in the frame)', () => {
    const { view } = setup();
    const group = rackGroup(view);
    expect(frames(view)).toHaveLength(2);
    // Each bay fades on its own: its own material.
    expect(frame(view, 0).material).not.toBe(frame(view, 1).material);
    // A see-through plate at each end, with the bay of its end column, on a material of its own (it stays faint).
    expect(endPlates(view).map((p) => p.userData.rackEndPlate)).toEqual([0, 1]);
    for (const plate of endPlates(view)) for (const f of frames(view)) expect(plate.material).not.toBe(f.material);
    const panels = group.children.filter((c) => c.userData.slotId);
    expect(panels.map((p) => p.userData.slotId).sort()).toEqual(['r1:0:0', 'r1:0:1', 'r1:1:0']);
    // Glowing panels share one geometry, never the material (each glows on its own).
    const mats = new Set(panels.map((p) => (p as Mesh).material));
    expect(mats.size).toBe(3);
    expect(frame(view).castShadow).toBe(true);
    // One cue per slot with a cue, each with its own unlit material: never shaded, never faded, casts no shadow.
    expect(cues(view).map((c) => c.userData.slotCue).sort()).toEqual(['r1:0:0', 'r1:0:1', 'r1:1:0']);
    for (const cue of cues(view)) {
      expect(cue.material.type).toBe('MeshBasicMaterial');
      expect(cue.material.toneMapped).toBe(false);
      expect(cue.material.transparent).toBe(false);
      expect(cue.material.vertexColors).toBe(true);
      expect(cue.castShadow).toBe(false);
    }
    expect(new Set(cues(view).map((c) => c.material)).size).toBe(3);
    view.dispose();
  });

  it('is painted slate metal with cream beams, never the wood and kraft of the obstacle shelves', () => {
    const { view } = setup();
    const count = (hex: string) => frames(view).reduce((n, f) => n + painted(f.geometry, hex), 0);
    expect(count(defaultTheme.rack.frame)).toBeGreaterThan(100);
    expect(count(defaultTheme.rack.beam)).toBeGreaterThan(50);
    // The two «libre» panels, one in each bay.
    for (const f of frames(view)) expect(painted(f.geometry, defaultTheme.rack.panel)).toBeGreaterThan(0);
    for (const hex of [defaultTheme.shelf.frame, defaultTheme.shelf.board, ...defaultTheme.shelf.storedBoxes]) expect(count(hex)).toBe(0);
    view.dispose();
  });

  it('keeps a plain low-poly silhouette: no diagonal brace anywhere, every face square to the room', () => {
    for (const lvl of [SOUTH, EAST]) {
      const { view } = setup(lvl);
      for (const f of [...frames(view), ...endPlates(view)]) {
        const nor = f.geometry.getAttribute('normal');
        for (let i = 0; i < nor.count; i++) {
          const n = new Vector3().fromBufferAttribute(nor, i);
          expect(Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)), `normal ${n.toArray()}`).toBeCloseTo(1, 6);
        }
      }
      view.dispose();
    }
  });

  it('leaves both ends open to the boxes: no side wall, only a faint see-through plate that holds the end cues', () => {
    const { snap, view } = setup();
    // South-facing rack over x ∈ [-0.5, 1.5], z ∈ [-1, 0] (depth d = −z from its front face): the west end closes
    // column 0 (3 slots), the east end column 1 (2 slots).
    const post = 0.06; // the uprights' side
    const ends = [
      { column: 0, end: -0.5, inward: 1, levels: 3 },
      { column: 1, end: 1.5, inward: -1, levels: 2 },
    ] as const;
    // Nothing of the solid frame closes an end any more: within an upright's side of it, only the front and back
    // uprights stand (d ≤ 0.06 or ≥ 0.94); the whole end between them is open.
    const p = new Vector3();
    for (const f of frames(view)) {
      f.updateWorldMatrix(true, false);
      const pos = f.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(f.matrixWorld);
        for (const e of ends) {
          if ((p.x - e.end) * e.inward >= post - 1e-6) continue;
          expect(Math.min(-p.z, 1 + p.z), `vertex ${p.toArray()} across the ${e.end < 0 ? 'west' : 'east'} end`).toBeLessThanOrEqual(post + 1e-6);
        }
      }
    }

    const plates = endPlates(view);
    expect(plates).toHaveLength(2);
    for (const e of ends) {
      const plate = plates[e.column];
      // Between the end uprights, a touch inside the rack's end, from the floor up to the top beam of its column.
      const b = plate.geometry.boundingBox!;
      const outer = e.end + e.inward * END_PLATE.u0;
      const inner = e.end + e.inward * END_PLATE.u1;
      expect(b.min.x).toBeCloseTo(Math.min(outer, inner), 5);
      expect(b.max.x).toBeCloseTo(Math.max(outer, inner), 5);
      expect(b.min.y).toBeCloseTo(0, 5);
      expect(b.max.y).toBeCloseTo(rackSlotY(e.levels), 5);
      expect(b.max.z - b.min.z).toBeGreaterThan(0.85);
      expect(b.min.z).toBeGreaterThan(-1 + post - 1e-6);
      expect(b.max.z).toBeLessThan(-post + 1e-6);
      expect(painted(plate.geometry, defaultTheme.rack.panel)).toBe(plate.geometry.getAttribute('position').count);
      // Faint and see-through: it never writes depth (the boxes and the frame behind it still draw), has no depth
      // prepass, never shades the boxes with a shadow, and draws after the solid rack, the boxes and the slot
      // overlays, so it only tints what stands behind it.
      expect(plate.material.transparent).toBe(true);
      expect(plate.material.opacity).toBeCloseTo(END_PLATE_OPACITY, 6);
      expect(plate.material.depthWrite).toBe(false);
      expect(plate.children).toHaveLength(0);
      expect(plate.castShadow).toBe(false);
      expect(plate.renderOrder).toBeGreaterThan(frame(view, e.column).renderOrder);
      for (const box of snap.boxes) expect(plate.renderOrder).toBeGreaterThan(boxMesh(view, box.id).renderOrder);
      expect(plate.renderOrder).toBeGreaterThan(glowBand(view, 'r1:0:0')!.renderOrder);
      expect(plate.renderOrder).toBeGreaterThan(tagged(view, 'slotMarker').renderOrder);
    }
    expect(END_PLATE_OPACITY).toBeGreaterThanOrEqual(0.15);
    expect(END_PLATE_OPACITY).toBeLessThanOrEqual(0.25);

    // A rack along z (front to the east, over x ∈ [-2, -1], z ∈ [-1.5, 0.5]) closes its north and south ends the same way.
    const e = setup(EAST).view;
    const [north, south] = endPlates(e).map((plate) => plate.geometry.boundingBox!);
    expect(north.min.z).toBeCloseTo(-1.5 + END_PLATE.u0, 5);
    expect(north.max.z).toBeCloseTo(-1.5 + END_PLATE.u1, 5);
    expect(south.min.z).toBeCloseTo(0.5 - END_PLATE.u1, 5);
    expect(south.max.z).toBeCloseTo(0.5 - END_PLATE.u0, 5);
    for (const b of [north, south]) {
      expect(b.min.x).toBeGreaterThan(-2 + post - 1e-6);
      expect(b.max.x).toBeLessThan(-1 - post + 1e-6);
    }
    view.dispose();
    e.dispose();
  });

  it('gives a one-column rack a single plate holding both of its ends, its cue reading from both', () => {
    const { view } = setup(ONE);
    const plates = endPlates(view);
    expect(plates).toHaveLength(1);
    expect(plates[0].userData.rackEndPlate).toBe(0);
    // Over x ∈ [-0.5, 0.5]: a thin sheet at each end, nothing in between.
    const b = plates[0].geometry.boundingBox!;
    expect(b.min.x).toBeCloseTo(-0.5 + END_PLATE.u0, 5);
    expect(b.max.x).toBeCloseTo(0.5 - END_PLATE.u0, 5);
    const pos = plates[0].geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) expect(0.5 - Math.abs(pos.getX(i))).toBeLessThanOrEqual(END_PLATE.u1 + 1e-6);
    const rim = paintedVertices(cueMesh(view, 'r1:0:0')!, defaultTheme.boxes.blue.ink);
    expect(rim.filter((v) => v.n.x < -0.99 && v.p.x < -0.5 + END_PLATE.u0).length).toBeGreaterThan(8);
    expect(rim.filter((v) => v.n.x > 0.99 && v.p.x > 0.5 - END_PLATE.u0).length).toBeGreaterThan(8);
    view.dispose();
  });

  it('stands on its cells, as tall as its tallest column, and the camera and the shadows take it in', () => {
    const { view } = setup();
    const b = rackBounds(view);
    // Cells (3, 2) and (4, 2) of a 7 × 6 room.
    expect(b.min.x).toBeCloseTo(-0.5, 3);
    expect(b.max.x).toBeCloseTo(1.5, 3);
    expect(b.min.z).toBeCloseTo(-1, 3);
    expect(b.max.z).toBeCloseTo(0, 3);
    expect(b.max.y).toBeCloseTo(rackTopY(3), 3);
    expect(view.fitBoxes.some((f) => f.max.y >= rackTopY(3) - 1e-6)).toBe(true);
    expect(view.shadowBounds.containsBox(b)).toBe(true);

    // A rack facing east runs along z, on its own cells too.
    const east = setup(EAST).view;
    const e = rackBounds(east);
    expect(e.min.x).toBeCloseTo(-2, 3);
    expect(e.max.x).toBeCloseTo(-1, 3);
    expect(e.min.z).toBeCloseTo(-1.5, 3);
    expect(e.max.z).toBeCloseTo(0.5, 3);
    expect(e.max.y).toBeCloseTo(rackTopY(2), 3);
    view.dispose();
    east.dispose();
  });

  it('never reaches into the space of a resting box or of the load going in and out', () => {
    const { view } = setup();
    const p = new Vector3();
    const half = GAME_CONFIG.box.size / 2;
    const play = 0.02; // the load's play inside the column
    // South-facing rack over x ∈ [-0.5, 1.5] (columns centred on x = 0 and 1), z ∈ [-1, 0]: depth from its front
    // face (z = 0). Every bay, and the panels too (they stand at the back of the slot).
    const meshes = rackGroup(view).children.filter((c) => c instanceof Mesh) as Mesh[];
    for (const mesh of meshes) {
      mesh.updateWorldMatrix(true, false);
      const pos = mesh.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        const depth = -p.z;
        const column = Math.round(p.x);
        const lateral = Math.abs(p.x - column);
        const levels = racksOf(SOUTH)[0].columns[column]?.length ?? 0;
        const e = 1e-6;
        for (let k = 0; k < levels; k++) {
          const floor = rackSlotY(k);
          // The box resting in the slot (d 0.11‥0.89)…
          const resting = lateral < half - e && depth > 0.5 - half + e && depth < 0.5 + half - e && p.y > floor + e && p.y < floor + height - e;
          // …and the load riding in over the slot floor, up to where the collision walls stop it.
          const load = lateral < half + play - e && depth < 0.91 - e && p.y > floor + RACK.forkCarry + e && p.y < floor + RACK.forkCarry + height - e;
          expect(resting || load, `vertex ${p.toArray()} inside slot ${column}:${k}`).toBe(false);
        }
      }
    }
    // Heights: the load rides just over its slot floor and clears the beam of the slot above.
    for (let k = 0; k < 3; k++) expect(rackSlotY(k) + RACK.forkCarry + height).toBeLessThan(rackSlotY(k + 1) - RACK.beam - 0.01);
    view.dispose();
  });

  it('paints the loading line on the floor in front of every column', () => {
    const { view } = setup();
    const floor = view.root.children[0] as Mesh;
    const line = paintedVertices(floor, defaultTheme.rack.line);
    expect(line.length).toBeGreaterThan(0);
    for (const { p } of line) {
      expect(p.y).toBeCloseTo(LOADING_LINE.y, 5);
      // The front cells (3, 3) and (4, 3): z ∈ [0, 1], x ∈ [-0.5, 1.5].
      expect(p.z).toBeGreaterThan(0);
      expect(p.z).toBeLessThanOrEqual(1);
      expect(p.x).toBeGreaterThan(-0.5);
      expect(p.x).toBeLessThan(1.5);
    }
    expect(line.some((v) => v.p.x < 0.5)).toBe(true);
    expect(line.some((v) => v.p.x > 0.5)).toBe(true);
    view.dispose();
  });
});

describe('rack cues: the «leyenda» of each slot', () => {
  it('colour cue = the box colour itself, symbol cue = the neutral sticker with the symbol, both = exact; bold ink', () => {
    const { view } = setup();
    const t = defaultTheme;
    const blue = cueMesh(view, 'r1:0:0')!.geometry;
    expect(painted(blue, t.boxes.blue.base)).toBeGreaterThan(0);
    expect(painted(blue, t.boxes.blue.ink)).toBeGreaterThan(0); // its rim
    // Symbols sort in this level: a colour-only cue shows no symbol.
    expect(painted(blue, t.rack.cueInk)).toBe(0);
    const triangle = cueMesh(view, 'r1:0:1')!.geometry;
    expect(painted(triangle, t.rack.cueFill)).toBeGreaterThan(0);
    expect(painted(triangle, t.rack.cueRim)).toBeGreaterThan(0);
    expect(painted(triangle, t.rack.cueInk)).toBeGreaterThan(0);
    for (const c of ['blue', 'mint', 'yellow', 'coral', 'lavender'] as const) expect(painted(triangle, t.boxes[c].base)).toBe(0);
    const exact = cueMesh(view, 'r1:1:0')!.geometry;
    expect(painted(exact, t.boxes.yellow.base)).toBeGreaterThan(0);
    expect(painted(exact, t.rack.cueInk)).toBeGreaterThan(0);
    // The cue colours are the box colours, not the paler zone pads.
    expect(painted(blue, t.zones.blue.fill)).toBe(0);
    // The panel glows in its cue's own tone (never red): the zone glow of that colour, or the neutral one.
    expect(panel(view, 'r1:0:0')!.material.emissive.getHexString()).toBe(new Color(t.zones.blue.glow).getHexString());
    expect(panel(view, 'r1:0:1')!.material.emissive.getHexString()).toBe(new Color(t.neutralZone.glow).getHexString());
    // At rest the unlit cue shows its colours exactly as painted (x 1).
    expect(cueMesh(view, 'r1:0:0')!.material.color.getHex()).toBe(0xffffff);
    view.dispose();
  });

  it('reads from both faces of the back panel, upright and big: a sticker on each face', () => {
    for (const [lvl, slotId, rim, outward] of [
      [SOUTH, 'r1:0:1', defaultTheme.rack.cueRim, new Vector3(0, 0, 1)],
      [EAST, 'r1:0:0', defaultTheme.boxes.coral.ink, new Vector3(1, 0, 0)],
    ] as const) {
      const { view } = setup(lvl);
      const mesh = cueMesh(view, slotId)!;
      // A pure yaw: nothing is mirrored.
      mesh.updateWorldMatrix(true, false);
      expect(mesh.matrixWorld.determinant()).toBeCloseTo(1, 6);
      // Each face stands just off its side of the panel (depth 0.95‥0.98 from the front face), turned out.
      const cell = slotOf(new GameState(lvl).getSnapshot(), slotId).pos;
      const faceDepth = (p: Vector3) => 0.5 - ((p.x - cell.x) * outward.x + (p.z - cell.z) * outward.z);
      const verts = paintedVertices(mesh, rim);
      const front = verts.filter((v) => Math.abs(faceDepth(v.p) - RACK_PANEL.d0) < 0.01 && v.n.dot(outward) > 0.99);
      const back = verts.filter((v) => Math.abs(faceDepth(v.p) - RACK_PANEL.d1) < 0.01 && v.n.dot(outward) < -0.99);
      expect(front.length).toBeGreaterThan(8);
      expect(back.length).toBe(front.length);
      expect(front.every((v) => faceDepth(v.p) < RACK_PANEL.d0)).toBe(true);
      expect(back.every((v) => faceDepth(v.p) > RACK_PANEL.d1)).toBe(true);
      // Upright on both faces: the sticker spans the middle of the panel height, above the slot floor.
      const floor = rackSlotY(slotOf(new GameState(lvl).getSnapshot(), slotId).level);
      for (const face of [front, back]) {
        const ys = face.map((v) => v.p.y - floor);
        expect(Math.min(...ys)).toBeCloseTo(PANEL_HEIGHT / 2 - CUE.halfH, 3);
        expect(Math.max(...ys)).toBeCloseTo(PANEL_HEIGHT / 2 + CUE.halfH, 3);
      }
      view.dispose();
    }
    // Big enough to read at a glance: most of the panel, and a bold glyph.
    expect(CUE.halfW / RACK_PANEL.halfW).toBeGreaterThan(0.8);
    expect(CUE.halfH / (PANEL_HEIGHT / 2)).toBeGreaterThan(0.8);
    expect(CUE.glyph).toBeGreaterThanOrEqual(0.4);
  });

  it('reads from the ends too: the cues of each end column stay on the outer face of its end plate, level by level', () => {
    // The legends never move with the open ends: the end stickers stand where the solid end panel's face was.
    expect(END_PLATE.u0).toBeCloseTo(0.015, 6);
    // South-facing rack over x ∈ [-0.5, 1.5]: column 0 closes the west end, column 1 the east end.
    const { snap, view } = setup();
    const rims: Record<string, string> = {
      'r1:0:0': defaultTheme.boxes.blue.ink,
      'r1:0:1': defaultTheme.rack.cueRim,
      'r1:1:0': defaultTheme.boxes.yellow.ink,
    };
    const facing = (slotId: string, dir: Vector3) => paintedVertices(cueMesh(view, slotId)!, rims[slotId]).filter((v) => v.n.dot(dir) > 0.99);
    const west = new Vector3(-1, 0, 0);
    const east = new Vector3(1, 0, 0);
    for (const [slotId, out, x] of [
      ['r1:0:0', west, -0.5 + END_PLATE.u0],
      ['r1:0:1', west, -0.5 + END_PLATE.u0],
      ['r1:1:0', east, 1.5 - END_PLATE.u0],
    ] as const) {
      // The sticker (the lip tape lies on the beam, at the slot floor).
      const face = facing(slotId, out).filter((v) => v.p.y - rackSlotY(slotOf(snap, slotId).level) > 0.01);
      expect(face.length, slotId).toBeGreaterThan(8);
      // Just outside its end plate (never behind the faint sheet), at the height of its back-panel sticker, full size.
      for (const v of face) {
        expect(Math.abs(v.p.x - x)).toBeLessThan(0.01);
        expect((v.p.x - x) * out.x).toBeGreaterThan(0);
      }
      const floor = rackSlotY(slotOf(snap, slotId).level);
      const ys = face.map((v) => v.p.y - floor);
      expect(Math.min(...ys)).toBeCloseTo(PANEL_HEIGHT / 2 - CUE.halfH, 3);
      expect(Math.max(...ys)).toBeCloseTo(PANEL_HEIGHT / 2 + CUE.halfH, 3);
      const zs = face.map((v) => v.p.z);
      expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2 * CUE.halfW, 3);
      // Never on the other end (a two-column rack: each end belongs to one column).
      expect(facing(slotId, out.clone().negate()).filter((v) => Math.abs(v.p.x - (x < 0 ? 1.5 : -0.5)) < 0.1)).toHaveLength(0);
    }

    // A rack along z facing east: column 0 closes the north end (−z), column 1 the south end.
    const e = setup(EAST).view;
    const coral = paintedVertices(cueMesh(e, 'r1:0:0')!, defaultTheme.boxes.coral.ink);
    const north = coral.filter((v) => v.n.z < -0.99);
    expect(north.length).toBeGreaterThan(8);
    for (const v of north) expect(Math.abs(v.p.z - (-1.5 + END_PLATE.u0))).toBeLessThan(0.01);
    expect(coral.filter((v) => v.n.z > 0.99)).toHaveLength(0);
    const lavender = paintedVertices(cueMesh(e, 'r1:1:0')!, defaultTheme.boxes.lavender.ink);
    const south = lavender.filter((v) => v.n.z > 0.99);
    expect(south.length).toBeGreaterThan(8);
    for (const v of south) expect(Math.abs(v.p.z - (0.5 - END_PLATE.u0))).toBeLessThan(0.01);
    view.dispose();
    e.dispose();
  });

  it('turns every sticker toward whoever looks at it: front-facing winding, on its outer side, never mirrored', () => {
    for (const lvl of [SOUTH, EAST]) {
      const { view } = setup(lvl);
      for (const mesh of cues(view)) {
        mesh.updateWorldMatrix(true, false);
        expect(mesh.matrixWorld.determinant()).toBeCloseTo(1, 6);
        const pos = mesh.geometry.getAttribute('position');
        const nor = mesh.geometry.getAttribute('normal');
        const normal = new Matrix4().extractRotation(mesh.matrixWorld);
        const faces = new Set<string>();
        // Slot-local (the geometry's own space): +z toward the front, the back panel's middle plane at panelZ.
        const panelZ = 0.5 - (RACK_PANEL.d0 + RACK_PANEL.d1) / 2;
        for (let i = 0; i < pos.count; i += 3) {
          const local = new Vector3().fromBufferAttribute(pos, i);
          if (local.y < 0.01) continue; // the lip tape, lying on the beam top
          const ln = new Vector3().fromBufferAttribute(nor, i);
          const n = ln.clone().applyMatrix4(normal);
          // Counter-clockwise seen from where its normal points: drawn, not culled (a mirror would flip it).
          expect(windingNormal(mesh, i).dot(n)).toBeGreaterThan(0.99);
          // On the outer side of what it stands on: a back-panel face off that panel, an end face off the end plate.
          if (Math.abs(ln.z) > 0.99) expect((local.z - panelZ) * ln.z).toBeGreaterThan((RACK_PANEL.d1 - RACK_PANEL.d0) / 2);
          else expect(local.x * ln.x).toBeGreaterThan(0.48);
          faces.add(faceKey(n));
        }
        // The back panel's two faces plus one end face (each column of a two-column rack closes one end).
        expect(faces.size).toBe(3);
      }
      view.dispose();
    }
  });

  it('draws the glyph upright on every face (the ▲ points up)', () => {
    const { view } = setup();
    const ink = paintedVertices(cueMesh(view, 'r1:0:1')!, defaultTheme.rack.cueInk);
    const byFace = new Map<string, Vector3[]>();
    for (const v of ink) byFace.set(faceKey(v.n), [...(byFace.get(faceKey(v.n)) ?? []), v.p]);
    // Front, back and the west end.
    expect([...byFace.keys()].sort()).toEqual(['-1,0', '0,-1', '0,1']);
    for (const pts of byFace.values()) {
      const top = Math.max(...pts.map((p) => p.y));
      const bottom = Math.min(...pts.map((p) => p.y));
      // Pointing up: narrow at the top, a wide base at the bottom.
      const span = (y: number) => {
        const row = pts.filter((p) => Math.abs(p.y - y) < 0.03);
        return Math.max(...row.map((p) => p.x + p.z)) - Math.min(...row.map((p) => p.x + p.z));
      };
      expect(span(bottom)).toBeGreaterThan(span(top) + 0.15);
    }
    view.dispose();
  });

  it('keeps classic racks without symbols readable too: a colour cue carries its colour glyph, bold', () => {
    const { view } = setup(EAST);
    // No symbol anywhere in this level: the coral cue shows coral's own glyph, as the classic pads do.
    expect(painted(cueMesh(view, 'r1:0:0')!.geometry, defaultTheme.rack.cueInk)).toBeGreaterThan(0);
    // The «libre» slot has no panel mesh or cue of its own: plain.
    expect(panel(view, 'r1:0:1')).toBeUndefined();
    expect(cueMesh(view, 'r1:0:1')).toBeUndefined();
    view.dispose();
  });
});

describe('rack slots: light only with the destined box, breathe for a fitting one', () => {
  it('a box that fits the cue but is not the destined one leaves the slot neutral; the destined one lights it', () => {
    const { snap, view } = setup();
    view.setTargetHints(true); // the optional target hints (P): the slot breathes while mint ▲ is lifted out, below
    const trap = boxOf(snap, 'blue', 'triangle');
    const mint = boxOf(snap, 'mint', 'triangle');
    const slot = slotOf(snap, 'r1:0:1'); // «▲»: blue ▲ fits, mint ▲ is destined
    rest(trap, slot);
    expect(slot.satisfied).toBe(false);
    step(view, snap, 2);
    expect(panel(view, 'r1:0:1')!.material.emissiveIntensity).toBeLessThan(0.005);
    expect(boxMesh(view, trap.id).material.emissiveIntensity).toBeLessThan(0.005);

    // The trap back on the floor, mint ▲ in.
    carry(snap, trap);
    floor(snap, trap, { x: 5, z: 3 });
    rest(mint, slot);
    expect(slot.satisfied).toBe(true);
    step(view, snap, DROP_GLIDE_SEC * 0.5);
    // Waits for the box to land, then rises and settles to a gentle rest glow.
    expect(panel(view, 'r1:0:1')!.material.emissiveIntensity).toBeLessThan(0.005);
    step(view, snap, 2);
    const glow = panel(view, 'r1:0:1')!.material.emissiveIntensity;
    expect(glow).toBeGreaterThan(0.1);
    expect(glow).toBeLessThan(0.2);
    // Lifting it out lets go softly (it breathes while mint ▲ is on the forks, the cue fits it), then rests neutral.
    carry(snap, mint);
    step(view, snap, 1);
    floor(snap, mint, { x: 1, z: 3 });
    step(view, snap, 3);
    expect(panel(view, 'r1:0:1')!.material.emissiveIntensity).toBeLessThan(0.01);
    view.dispose();
  });

  it('while carrying, the empty slots whose cue fits the box pulse clearly; the others stay still', () => {
    const { snap, view } = setup();
    view.setTargetHints(true); // the optional target hints (P), in every view of this test
    carry(snap, boxOf(snap, 'blue', 'triangle'));
    let peak = peakGlow(view, snap, 3);
    // Much more than the gentle breathing of the levels without racks (≈ 0.17), still a soft pastel light.
    expect(peak.get('r1:0:0')).toBeGreaterThan(0.5); // «azul»
    expect(peak.get('r1:0:1')).toBeGreaterThan(0.5); // «▲»: the cue, not the solution
    expect(peak.get('r1:1:0')).toBeLessThan(0.005); // «amarillo ■»
    expect(peak.get('r1:0:0')).toBeLessThan(0.65);
    // Its glow band pulses in the carried box's tone, around the slot on both faces; none on the slot it does not fit.
    const band = glowBand(view, 'r1:0:0')!;
    expect(band.visible).toBe(true);
    expect(band.material.opacity).toBeGreaterThan(0.3);
    expect(band.material.opacity).toBeLessThan(0.9);
    expect(colorDistance(band.material.color, new Color(defaultTheme.boxes.blue.base))).toBeLessThan(1e-3);
    expect(glowBand(view, 'r1:1:0')!.visible).toBe(false);
    // The cue brightens with it but stays a pastel of its own colour (capped, never washed to white).
    expect(cueMesh(view, 'r1:0:0')!.material.color.r).toBeLessThan(1.6);

    // Occupied: not an invitation. Holding its destined box it only keeps its rest glow (never hinted).
    const { snap: s2, view: v2 } = setup();
    v2.setTargetHints(true);
    rest(boxOf(s2, 'mint', 'triangle'), slotOf(s2, 'r1:0:1'));
    step(v2, s2, 3);
    const lit = panel(v2, 'r1:0:1')!.material.emissiveIntensity;
    carry(s2, boxOf(s2, 'blue', 'triangle'));
    peak = peakGlow(v2, s2, 2);
    expect(peak.get('r1:0:0')).toBeGreaterThan(0.05);
    expect(peak.get('r1:0:1')).toBeLessThan(lit + 0.005);

    // Holding a box that fits but is not its destiny, when no free target takes the carried one: a faint swap hint.
    const { snap: s3, view: v3 } = setup();
    v3.setTargetHints(true);
    rest(boxOf(s3, 'blue', 'triangle'), slotOf(s3, 'r1:0:1'));
    carry(s3, boxOf(s3, 'mint', 'triangle')); // fits only «▲»
    peak = peakGlow(v3, s3, 2);
    expect(peak.get('r1:0:1')).toBeGreaterThan(0.01);
    expect(peak.get('r1:0:1')).toBeLessThan(0.08);
    expect(peak.get('r1:0:0')).toBeLessThan(0.005);
    view.dispose();
    v2.dispose();
    v3.dispose();
  });
});

describe('rack slots: boxes, forks, preview and marker at slot heights', () => {
  it('a box rests on its slot floor, and glides in from the forks without teleporting', () => {
    const { snap, view } = setup();
    const box = boxOf(snap, 'mint', 'triangle');
    const slot = slotOf(snap, 'r1:0:1');
    carry(snap, box);
    atRack(snap, slot.id, true);
    snap.forklift.forkHeight = 1;
    step(view, snap, 2);
    const held = boxGroup(view, box.id).position.clone();
    rest(box, slot);
    step(view, snap, DROP_GLIDE_SEC * 0.5);
    const mid = boxGroup(view, box.id).position;
    expect(mid.distanceTo(held)).toBeGreaterThan(1e-3);
    expect(mid.y).toBeGreaterThan(rackSlotY(1) - 1e-3); // never below its slot floor on the way in
    step(view, snap, 1.5);
    const g = boxGroup(view, box.id).position;
    expect(g.x).toBeCloseTo(slot.pos.x, 3);
    expect(g.z).toBeCloseTo(slot.pos.z, 3);
    expect(g.y).toBeCloseTo(rackSlotY(1), 3);
    view.dispose();
  });

  it('at a rack the forks go to slot heights and the load rides just over the slot floor, clear of the beam above', () => {
    const { snap, view } = setup();
    const box = boxOf(snap, 'mint', 'triangle');
    carry(snap, box);
    step(view, snap, 1);
    expect(boxGroup(view, box.id).position.y).toBeCloseTo(FORK.upY, 2); // floor carrying height

    // Logic moves the forks at a steady rate (forkRise); the view eases on top of it.
    const ramp = (target: number, t: number) => {
      const f = snap.forklift;
      const rate = forkRiseRate(GAME_CONFIG, Math.max(f.forkHeight, target)) / 60;
      f.forkHeight = f.forkHeight < target ? Math.min(target, f.forkHeight + rate) : Math.max(target, f.forkHeight - rate);
      view.update(snap, 1 / 60, t, YAW, 0);
    };
    atRack(snap, 'r1:0:2', false);
    let top = 0;
    for (let i = 0; i < 180; i++) {
      ramp(2, 1 + i / 60);
      top = Math.max(top, boxGroup(view, box.id).position.y + height);
    }
    const y = boxGroup(view, box.id).position.y;
    expect(y).toBeGreaterThan(rackSlotY(2) + RACK.forkCarry - 0.01);
    expect(y).toBeLessThan(rackSlotY(2) + RACK.forkCarry + 0.01);
    expect(top).toBeLessThan(rackSlotY(3) - RACK.beam);

    // Leaving the rack: back to automatic heights, smoothly (no jump in one frame).
    snap.hint.rack = null;
    let last = boxGroup(view, box.id).position.y;
    let maxStep = 0;
    for (let i = 0; i < 240; i++) {
      ramp(0, 4 + i / 60);
      const now = boxGroup(view, box.id).position.y;
      maxStep = Math.max(maxStep, Math.abs(now - last));
      last = now;
    }
    expect(last).toBeCloseTo(FORK.upY, 2);
    expect(maxStep).toBeLessThan(0.04);
    view.dispose();
  });

  it('shows the drop inside the slot, and frames the selected slot (faintly until the action would work)', () => {
    const { snap, view } = setup();
    const preview = tagged(view, 'dropPreview');
    const marker = tagged(view, 'slotMarker');
    expect(marker).toBeDefined();
    const blueBorder = new Color(defaultTheme.zones.blue.border);

    // Facing column 0 with a box, the forks set to slot 1 but not there yet: a faint frame, no drop preview.
    const box = boxOf(snap, 'blue', 'triangle');
    carry(snap, box);
    atRack(snap, 'r1:0:1', false);
    step(view, snap, 1);
    expect(marker.visible).toBe(true);
    expect(marker.material.opacity).toBeGreaterThan(0.2);
    expect(marker.material.opacity).toBeLessThan(0.4);
    expect(marker.position.y).toBeCloseTo(rackSlotY(1), 3);
    expect(preview.visible).toBe(false);

    // Ready: the outline floats on the slot floor, hugging the box, in the box's tone (the cue fits it).
    const hint = atRack(snap, 'r1:0:1', true);
    snap.hint.dropCell = { ...slotOf(snap, hint.slotId).cell };
    snap.hint.dropLevel = 1;
    step(view, snap, 1);
    expect(preview.visible).toBe(true);
    expect(preview.position.y).toBeCloseTo(rackSlotY(1) + 0.008, 3);
    expect(preview.scale.x).toBeLessThan(0.9);
    expect(marker.material.opacity).toBeGreaterThan(0.7);
    const tone = marker.material.color;
    expect(Math.abs(tone.r - blueBorder.r) + Math.abs(tone.g - blueBorder.g) + Math.abs(tone.b - blueBorder.b)).toBeLessThan(1e-3);

    // F / V to slot 2 («libre»): the frame glides up, neutral again (no cue to fit).
    atRack(snap, 'r1:0:2', true);
    snap.hint.dropLevel = 2;
    step(view, snap, 0.05);
    expect(marker.position.y).toBeGreaterThan(rackSlotY(1));
    expect(marker.position.y).toBeLessThan(rackSlotY(2));
    step(view, snap, 1);
    expect(marker.position.y).toBeCloseTo(rackSlotY(2), 3);
    expect(Math.abs(tone.r - blueBorder.r) + Math.abs(tone.g - blueBorder.g) + Math.abs(tone.b - blueBorder.b)).toBeGreaterThan(1e-2);

    // Away from the rack: gone.
    snap.hint.rack = null;
    snap.hint.dropCell = null;
    step(view, snap, 1);
    expect(marker.visible).toBe(false);
    view.dispose();
  });

  it('a box landing in an upper slot does not dip the box in the slot below (they are not a stack)', () => {
    const { snap, view } = setup();
    const below = boxOf(snap, 'blue', 'triangle');
    const above = boxOf(snap, 'mint', 'triangle');
    rest(below, slotOf(snap, 'r1:0:0'));
    rest(above, slotOf(snap, 'r1:0:1'));
    step(view, snap, 1);
    view.handleEvent(
      { type: 'boxDropped', boxId: above.id, cell: { x: 3, z: 2 }, zoneId: null, level: 1, correct: true, recipeLength: 1, satisfiedCount: 2, total: 3, slotId: 'r1:0:1' },
      snap,
    );
    let lowest = 0;
    for (let i = 0; i < 60; i++) {
      view.update(snap, 1 / 60, i / 60, YAW, 0);
      lowest = Math.min(lowest, boxMesh(view, below.id).position.y);
    }
    expect(lowest).toBeGreaterThan(-1e-6);
    view.dispose();
  });
});

describe('rack ghosting', () => {
  it('fades the rack bays and the boxes in their slots while they hide the forklift, solid again once they do not', () => {
    const { snap, view } = setup();
    const box = boxOf(snap, 'mint', 'triangle');
    rest(box, slotOf(snap, 'r1:0:1'));
    const material = frame(view).material;
    step(view, snap, 1);
    expect(material.opacity).toBe(1); // the forklift is in front of it
    expect(boxMesh(view, box.id).material.opacity).toBe(1);

    // Right behind it (north), away from the camera at the default yaw: rack and slot boxes fade together.
    snap.forklift.pos = { x: 0, z: -1.6 };
    step(view, snap, 1);
    expect(material.opacity).toBeLessThan(0.4);
    expect(material.depthWrite).toBe(false);
    expect(panel(view, 'r1:0:0')!.material.opacity).toBeCloseTo(material.opacity, 6);
    const depthPass = frame(view).children[0] as Mesh;
    expect(depthPass.visible).toBe(true);
    expect(depthPass.renderOrder).toBeLessThan(frame(view).renderOrder);
    expect(boxMesh(view, box.id).material.opacity).toBeLessThan(0.6);
    // Its end plate fades along with it (still never writing depth), drawn just after the bay's ghost colour pass.
    const westPlate = endPlates(view)[0];
    expect(westPlate.material.opacity).toBeCloseTo(END_PLATE_OPACITY * material.opacity, 6);
    expect(westPlate.material.depthWrite).toBe(false);
    expect(westPlate.renderOrder).toBeGreaterThan(frame(view).renderOrder);
    expect(westPlate.renderOrder).toBeLessThan(frame(view).renderOrder + 1);
    // «Sin atenuante»: the cues (the end ones too) stay opaque, at full colour, in the opaque pass (before any ghost)
    // and writing depth, so the ghost's depth prepass and colour pass stop at them.
    for (const cue of cues(view)) {
      expect(cue.visible).toBe(true);
      expect(cue.material.transparent).toBe(false);
      expect(cue.material.opacity).toBe(1);
      expect(cue.material.depthWrite).toBe(true);
      expect(cue.material.color.r).toBeGreaterThanOrEqual(1);
      expect(cue.material.color.g).toBeGreaterThanOrEqual(1);
    }

    // Back in front of it: solid again.
    snap.forklift.pos = { x: 0, z: 2.5 };
    step(view, snap, 1.5);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
    expect(boxMesh(view, box.id).material.opacity).toBe(1);
    expect(westPlate.material.opacity).toBeCloseTo(END_PLATE_OPACITY, 6);
    expect(westPlate.material.depthWrite).toBe(false);
    expect(westPlate.renderOrder).toBeGreaterThan(frame(view).renderOrder);
    expect(westPlate.renderOrder).toBeGreaterThan(boxMesh(view, box.id).renderOrder);

    // Only a resting box behind it: a light fade, the cues stay readable and the boxes in its slots solid.
    const floorBox = boxOf(snap, 'yellow', 'square');
    floor(snap, floorBox, { x: 3, z: 1 });
    step(view, snap, 1.5);
    expect(material.opacity).toBeGreaterThan(0.5);
    expect(material.opacity).toBeLessThan(0.7);
    expect(boxMesh(view, box.id).material.opacity).toBe(1);
    floor(snap, floorBox, { x: 5, z: 4 });

    // Behind the west end only: that bay fades, the other one (and its cues) stays solid.
    snap.forklift.pos = { x: -1.2, z: -1.6 };
    step(view, snap, 1.5);
    expect(frame(view, 0).material.opacity).toBeLessThan(0.4);
    expect(frame(view, 1).material.opacity).toBe(1);
    expect(panel(view, 'r1:1:0')!.material.opacity).toBe(1);
    // The plates follow their own bay: the west one fades, the east one keeps its light tint, drawn before any ghost.
    expect(westPlate.material.opacity).toBeLessThan(END_PLATE_OPACITY * 0.4);
    const eastPlate = endPlates(view)[1];
    expect(eastPlate.material.opacity).toBeCloseTo(END_PLATE_OPACITY, 6);
    expect(eastPlate.renderOrder).toBeLessThan(frame(view, 0).renderOrder);
    view.dispose();
  });

  it('does not ghost for the load going in or out of its own slots', () => {
    const { snap, view } = setup();
    const box = boxOf(snap, 'mint', 'triangle');
    carry(snap, box);
    atRack(snap, 'r1:0:1', true);
    snap.forklift.forkHeight = 1;
    // At column 0 from the front (heading north): the load half in, then all the way in.
    snap.forklift.heading = Math.PI;
    for (const z of [1.0, 0.43]) {
      snap.forklift.pos = { x: 0, z };
      step(view, snap, 1.5);
      expect(frame(view).material.opacity).toBe(1);
    }
    view.dispose();
  });
});

describe('rack view lifecycle', () => {
  it('plays the completion wave on slots too, and releases every rack resource on dispose', () => {
    const { snap, view } = setup();
    rest(boxOf(snap, 'blue', 'triangle'), slotOf(snap, 'r1:0:0'));
    step(view, snap, 2);
    const rest0 = panel(view, 'r1:0:0')!.material.emissiveIntensity;
    view.handleEvent({ type: 'levelComplete' }, snap);
    const peak = peakGlow(view, snap, 2).get('r1:0:0')!;
    expect(peak).toBeGreaterThan(rest0 + 0.1);

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
    view.dispose();
    for (const o of tracked) {
      const mesh = o as Mesh;
      expect(disposed.has(mesh.geometry)).toBe(true);
      expect(disposed.has(mesh.material as MeshStandardMaterial)).toBe(true);
    }
  });

  it('adds nothing to levels without racks', () => {
    const plain = level(`
# 1 · Sin estanterías
id: sin-estanterias

  01234
0 .....
1 .a.1.
2 ..^..

1 = zona azul
a = caja azul
`);
    const { view } = setup(plain);
    expect(view.root.children.some((c) => c.userData.rackId || c.userData.slotMarker)).toBe(false);
    view.dispose();
  });
});
