import { Box3, Color, Matrix4, Mesh, SRGBColorSpace, Vector3, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { cueFits, isDestined } from '../../core/sorting';
import { cellToWorld, type BoxState, type GameSnapshot, type LevelData, type TruckSlotState } from '../../core/types';
import { parseLevel } from '../../data/asciiLevel';
import { BENCHMARK_ID, getSpecialLevel } from '../../data/levels';
import { GameState } from '../../logic/GameState';
import { defaultTheme } from '../../themes/default';
import { TRUCK, TRUCK_CUE } from '../builders/truck';
import { buildWallGeometry, dockSpan, wallLayouts } from '../builders/walls';
import { CameraRig } from '../CameraRig';
import { DIORAMA, DOCK, ZONE, boxDims } from '../dims';
import { LevelView } from '../LevelView';
import { LOCK_DELAY } from './BoxView';
import { FLASH_PEAK, LOCK_SEC, TARGET_REST } from './success';

/*
 * Loading docks on screen (docs/DOCKS.md): a door in the wall, a truck backed into it with its bed on the bed cells
 * (level with the floor: boxes stack on it as on the floor), a cue board per bed column with one full-colour sticker
 * per level (bottom at the bottom, over the full stack, readable from both sides), levels that light like rack slots
 * (only with the destined box on right levels below; the strong pulse only for the next level of a column), the board
 * ghosting like a rack bay (never its stickers) and the truck outside sinking with its wall. Layouts are inline.
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/**
 * The docs/DOCKS.md example: a north dock at cells 2–3. Column 0: «azul» / «▲»; column 1: «coral ◆», with the menta ▲
 * loaded on it by mistake. The azul ▲ goes to the bottom of column 0 and the menta ▲ on top of it.
 */
const NORTH = level(`
# 1 · Muelle de ejemplo
id: muelle-ejemplo
limit: 2
ventanas: oeste 2-3

  01234567
0 ..TT....
1 ........
2 .....1..
3 .a..b...
4 ....^.c.

1 = zona ■
a = caja azul ▲        b = caja amarillo ■    c = caja coral ◆
T = camión muelle norte: azul / ▲ | coral ◆ + caja menta ▲
`);

/** A west dock at rows 1–3 with a three-level column first, then «menta», then «lavanda ✚» already loaded. */
const WEST = level(`
# 2 · Muelle oeste
id: muelle-oeste
limit: 3
ventanas: norte 4-5

  01234567
0 ........
1 T.......
2 T....1..
3 T.a..b..
4 ....^.c.
5 ..d.e...

1 = zona amarillo
a = caja azul ●       b = caja lavanda ▲     c = caja coral ◆
d = caja menta ●      e = caja amarillo ■
T = camión muelle oeste: azul / ▲ / coral | menta | lavanda ✚ + caja lavanda ✚
`);

const YAW = Math.PI / 4;
const height = boxDims(GAME_CONFIG).height;
const half = GAME_CONFIG.box.size / 2;

function setup(lvl: LevelData = NORTH, yaw = YAW): { snap: GameSnapshot; view: LevelView } {
  const snap = new GameState(lvl).getSnapshot();
  return { snap, view: new LevelView(snap, defaultTheme, GAME_CONFIG, yaw) };
}

function step(view: LevelView, snap: GameSnapshot, seconds: number, yaw = YAW, t0 = 0): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) view.update(snap, 1 / 60, t0 + i / 60, yaw, 0);
}

const truckGroup = (view: LevelView, id = 't1') => view.root.children.find((c) => c.userData.truckId === id)!;
const outside = (view: LevelView, id = 't1') => view.root.children.find((c) => c.userData.truckOutside === id)!;
const part = <T extends Mesh>(view: LevelView, tag: string, id: string) =>
  truckGroup(view, id.split(':')[0]).children.find((c) => c.userData[tag] === id) as T | undefined;
const cueMesh = (view: LevelView, id: string) => part<Mesh<BufferGeometry, MeshBasicMaterial>>(view, 'truckCue', id);
const panel = (view: LevelView, id: string) => part<Mesh<BufferGeometry, MeshStandardMaterial>>(view, 'truckSlotId', id);
const band = (view: LevelView, id: string) => part<Mesh<BufferGeometry, MeshBasicMaterial>>(view, 'truckGlow', id);
/** The cue board frame of each bed column, in column order. */
const boards = (view: LevelView, id = 't1') =>
  truckGroup(view, id)
    .children.filter((c) => c.userData.truck)
    .sort((a, b) => a.userData.column - b.userData.column) as Mesh<BufferGeometry, MeshStandardMaterial>[];
const boxGroup = (view: LevelView, id: string) => view.root.children.find((c) => c.userData.boxId === id)!;
const boxMesh = (view: LevelView, id: string) => boxGroup(view, id).children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
const tagged = (view: LevelView, tag: string) => view.root.children.find((c) => c.userData[tag]) as Mesh<BufferGeometry, MeshBasicMaterial>;
const slotOf = (snap: GameSnapshot, id: string) => snap.truckSlots!.find((s) => s.id === id)!;
const boxOf = (snap: GameSnapshot, color: string, symbol: string) => snap.boxes.find((b) => b.color === color && b.symbol === symbol)!;
const colorDistance = (a: Color, b: Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

function painted(geo: BufferGeometry, hex: string): number {
  const c = new Color(hex);
  const col = geo.getAttribute('color');
  let n = 0;
  for (let i = 0; i < col.count; i++) {
    if (Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4) n++;
  }
  return n;
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
    if (c && !(Math.abs(col.getX(i) - c.r) < 1e-4 && Math.abs(col.getY(i) - c.g) < 1e-4 && Math.abs(col.getZ(i) - c.b) < 1e-4)) continue;
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
 * Hand-driven snapshot edits (the view only reads it). `load`: rest `box` on truck slot `slot`, satisfied when it is
 * the destined one on satisfied levels below (then locked, and the level above becomes loadable). `carry`: lift it.
 */
function load(snap: GameSnapshot, box: BoxState, slot: TruckSlotState): void {
  const column = snap.truckSlots!.filter((s) => s.truckId === slot.truckId && s.column === slot.column);
  const right = column.every((s) => s.level >= slot.level || s.satisfied) && isDestined(slot, box);
  Object.assign(box, { carried: false, cell: { ...slot.cell }, pos: { ...slot.pos }, level: slot.level, zoneId: null, slotId: null, truckSlotId: slot.id, correct: right, locked: right });
  Object.assign(slot, { occupiedBy: box.id, satisfied: right, loadable: false });
  const above = column.find((s) => s.level === slot.level + 1);
  if (above) above.loadable = right;
  if (snap.forklift.carrying === box.id) snap.forklift.carrying = null;
}
function carry(snap: GameSnapshot, box: BoxState): void {
  for (const s of snap.truckSlots ?? []) {
    if (s.occupiedBy !== box.id) continue;
    Object.assign(s, { occupiedBy: null, satisfied: false });
    const below = snap.truckSlots!.filter((t) => t.truckId === s.truckId && t.column === s.column && t.level < s.level);
    s.loadable = below.every((t) => t.satisfied);
  }
  Object.assign(box, { carried: true, cell: null, level: 0, zoneId: null, slotId: null, truckSlotId: null, correct: false, locked: false });
  snap.forklift.carrying = box.id;
  snap.forklift.forkLift = 1;
}
/** Highest panel glow of each truck level over `seconds`. */
function peakGlow(view: LevelView, snap: GameSnapshot, seconds: number): Map<string, number> {
  const peak = new Map<string, number>();
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    view.update(snap, 1 / 60, i / 60, YAW, 0);
    for (const s of snap.truckSlots!) peak.set(s.id, Math.max(peak.get(s.id) ?? 0, panel(view, s.id)!.material.emissiveIntensity));
  }
  return peak;
}

describe('dock door', () => {
  it('opens its wall over the bed cells from the floor to the lintel: baseboard broken, the trailer passes clear', () => {
    const T = DIORAMA.wallThickness;
    for (const lvl of [NORTH, WEST]) {
      const truck = lvl.trucks![0];
      const layouts = wallLayouts(lvl);
      const layout = layouts.find((l) => l.side === truck.wall)!;
      expect(layouts.find((l) => l.side !== truck.wall)!.doors).toEqual([]);
      const span = dockSpan(truck, lvl);
      expect(span.b - span.a).toBe(truck.columns.length);
      expect(layout.doors).toEqual([{ a: span.a + DOCK.doorInset, b: span.b - DOCK.doorInset }]);
      const door = layout.doors[0];
      const geo = buildWallGeometry(layout, defaultTheme, new Vector3(0.5, 1, -0.5).normalize());
      const mesh = new Mesh(geo.body);
      // No wall and no baseboard inside the opening, between the sill and the lintel.
      const opening = new Box3(new Vector3(door.a, DOCK.sillTop, -T), new Vector3(door.b, DOCK.doorTop, 0.05));
      for (const hex of [defaultTheme.wall.base, defaultTheme.wall.trim]) {
        for (const tri of triangles(mesh, hex)) expect(overlaps(tri, opening)).toBe(false);
      }
      // Nothing at all where the trailer deck and its rails pass (the rolled-up door waits in the head).
      const passage = new Box3(new Vector3(span.a + TRUCK.inset, TRUCK.deckBottom, -T), new Vector3(span.b - TRUCK.inset, 1.8, 0));
      for (const tri of triangles(mesh)) expect(overlaps(tri, passage)).toBe(false);
      // Framed in slate, sealed in rubber outside: never a functional hue.
      expect(painted(geo.body, defaultTheme.truck.doorFrame)).toBeGreaterThan(0);
      expect(painted(geo.body, defaultTheme.truck.rubber)).toBeGreaterThan(0);
      // The windows are still there, on their own.
      expect(layouts.flatMap((l) => l.openings)).toHaveLength(1);
    }
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
    expect(snap.truckSlots).toBeUndefined();
    step(view, snap, 0.5);
    expect(view.root.children.some((c) => c.userData.truckId || c.userData.truckOutside)).toBe(false);
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

  it('lays its bed on the bed cells level with the floor, clear of every box its columns hold', () => {
    for (const lvl of [NORTH, WEST]) {
      const { snap, view } = setup(lvl);
      const group = truckGroup(view);
      const bed = group.children.find((c) => c.userData.truckBed) as Mesh;
      const bounds = bed.geometry.boundingBox!;
      // Flat: planks a hair over the floor, rails and the leveller barely above them.
      expect(bounds.max.y).toBeLessThanOrEqual(TRUCK.railTop + 1e-6);
      expect(bounds.min.y).toBeLessThan(0);
      const columns = new Map<string, TruckSlotState[]>();
      for (const s of snap.truckSlots!) columns.set(`${s.truckId}:${s.column}`, [...(columns.get(`${s.truckId}:${s.column}`) ?? []), s]);
      expect(columns.size).toBe(lvl.trucks![0].columns.length);
      const meshes = group.children.filter((c): c is Mesh => c instanceof Mesh && !c.userData.truckCue && !c.userData.truckGlow);
      for (const levels of columns.values()) {
        const p = levels[0].pos;
        expect(bounds.containsPoint(new Vector3(p.x, 0, p.z))).toBe(true);
        // The space a full column of boxes takes, from the planks up: nothing of the truck reaches into it.
        const stack = new Box3(new Vector3(p.x - half, DOCK.bedTop + 0.005, p.z - half), new Vector3(p.x + half, levels.length * height, p.z + half));
        for (const mesh of meshes) for (const tri of triangles(mesh)) expect(overlaps(tri, stack)).toBe(false);
      }
      view.dispose();
    }
  });

  it('stacks the boxes on its bed at floor stack heights', () => {
    const { snap, view } = setup();
    const blue = boxOf(snap, 'blue', 'triangle');
    const mint = boxOf(snap, 'mint', 'triangle');
    load(snap, blue, slotOf(snap, 't1:0:0'));
    load(snap, mint, slotOf(snap, 't1:0:1'));
    step(view, snap, 1.5);
    const p = slotOf(snap, 't1:0:0').pos;
    expect(boxGroup(view, blue.id).position.y).toBeCloseTo(0, 3);
    expect(boxGroup(view, mint.id).position.y).toBeCloseTo(height, 3);
    expect(boxGroup(view, mint.id).position.x).toBeCloseTo(p.x, 3);
    expect(boxGroup(view, mint.id).position.z).toBeCloseTo(p.z, 3);
    view.dispose();
  });

  it('shows one sticker per level on the board of its column, bottom at the bottom, above the full stack, at full colour', () => {
    const r = defaultTheme.rack;
    for (const lvl of [NORTH, WEST]) {
      const { snap, view } = setup(lvl);
      for (const s of snap.truckSlots!) {
        const cue = cueMesh(view, s.id)!;
        expect(cue).toBeDefined();
        expect(cue.position.x).toBeCloseTo(s.pos.x, 6);
        expect(cue.position.z).toBeCloseTo(s.pos.z, 6);
        const levels = snap.truckSlots!.filter((t) => t.truckId === s.truckId && t.column === s.column);
        // Never behind the load: its bottom edge over the top of a full column.
        expect(cue.position.y - TRUCK_CUE.halfH).toBeGreaterThan(levels.length * height);
        const above = levels.find((t) => t.level === s.level + 1);
        if (above) expect(cueMesh(view, above.id)!.position.y).toBeGreaterThan(cue.position.y + 2 * TRUCK_CUE.halfH);
        // Unlit, opaque, not tone mapped: exactly its colours, never shaded or faded.
        expect(cue.material.toneMapped).toBe(false);
        expect(cue.material.transparent).toBe(false);
        expect(cue.material.opacity).toBe(1);
        const box = s.accepts.color ? defaultTheme.boxes[s.accepts.color] : null;
        expect(painted(cue.geometry, box ? box.base : r.cueFill)).toBeGreaterThan(0);
        expect(painted(cue.geometry, box ? box.ink : r.cueRim)).toBeGreaterThan(0);
        // These levels sort by symbol: a symbol cue carries it bold, a colour-only cue none.
        expect(painted(cue.geometry, r.cueInk) > 0).toBe(s.accepts.symbol !== undefined);
      }
      view.dispose();
    }
  });

  it('turns each sticker to the warehouse and to the outside: front-facing, upright, never mirrored', () => {
    for (const lvl of [NORTH, WEST]) {
      const { snap, view } = setup(lvl);
      for (const s of snap.truckSlots!) {
        const mesh = cueMesh(view, s.id)!;
        mesh.updateWorldMatrix(true, false);
        expect(mesh.matrixWorld.determinant()).toBeCloseTo(1, 6);
        const pos = mesh.geometry.getAttribute('position');
        const nor = mesh.geometry.getAttribute('normal');
        const rot = new Matrix4().extractRotation(mesh.matrixWorld);
        // The loading side (TRUCK_FACING): +z for a north dock, +x for a west one.
        const loading = s.wall === 'north' ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
        const sides = new Set<number>();
        for (let i = 0; i < pos.count; i += 3) {
          const v = [0, 1, 2].map((k) => new Vector3().fromBufferAttribute(pos, i + k).applyMatrix4(mesh.matrixWorld));
          const winding = v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).normalize();
          const n = new Vector3().fromBufferAttribute(nor, i).applyMatrix4(rot);
          // Counter-clockwise seen from where its normal points: drawn, not culled (a mirror would flip it).
          expect(winding.dot(n)).toBeGreaterThan(0.99);
          sides.add(Math.round(n.dot(loading)));
        }
        expect([...sides].sort()).toEqual([-1, 1]);
      }
      view.dispose();
    }
  });
});

describe('truck levels light like rack slots', () => {
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

  it('previews the drop on the bed at its level, on top of a locked box, in the box tone only where it is right now', () => {
    const { snap, view } = setup();
    load(snap, boxOf(snap, 'blue', 'triangle'), slotOf(snap, 't1:0:0'));
    const mint = boxOf(snap, 'mint', 'triangle');
    carry(snap, mint);
    const top = slotOf(snap, 't1:0:1');
    Object.assign(snap.hint, { dropCell: { ...top.cell }, dropLevel: 1, dropZoneId: null, dropTruckSlotId: top.id });
    step(view, snap, 1);
    const preview = tagged(view, 'dropPreview');
    expect(preview.visible).toBe(true);
    expect(preview.position.x).toBeCloseTo(top.pos.x, 2);
    expect(preview.position.z).toBeCloseTo(top.pos.z, 2);
    expect(preview.position.y).toBeCloseTo(height + ZONE.padHeight + 0.008, 2);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.zones.mint.border))).toBeLessThan(0.02);

    // «coral ◆» would not take it: the preview stays neutral.
    const coral = slotOf(snap, 't1:1:0');
    Object.assign(snap.hint, { dropCell: { ...coral.cell }, dropLevel: 0, dropTruckSlotId: coral.id });
    step(view, snap, 1);
    expect(preview.visible).toBe(true);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.floor.edge))).toBeLessThan(0.02);
    view.dispose();
  });

  it('tints the preview where the cue fits and the level loads next, never «this is its destiny»: a trap is tinted too', () => {
    // «azul» takes the azul ▲ (the zone ■ is the azul ■'s): the azul ■ fits the cue, is tinted and pulses, then buzzes
    // on the drop (wrongTarget: logic/GameState.docks.test.ts), as a rack slot's cue would (docs/DOCKS.md, vista previa).
    const TRAP = level(`
# 3 · Trampa del camión
id: trampa-camion
limit: 2

  012345
0 ..T...
1 ......
2 .a..b.
3 ...^.1

1 = zona ■
a = caja azul ▲        b = caja azul ■
T = camión muelle norte: azul
`);
    const { snap, view } = setup(TRAP);
    const slot = slotOf(snap, 't1:0:0');
    const trap = boxOf(snap, 'blue', 'square');
    expect(cueFits(slot, trap)).toBe(true);
    expect(isDestined(slot, trap)).toBe(false);
    expect(slot.loadable).toBe(true);
    carry(snap, trap);
    Object.assign(snap.hint, { dropCell: { ...slot.cell }, dropLevel: 0, dropZoneId: null, dropTruckSlotId: slot.id });
    const peak = peakGlow(view, snap, 3);
    const preview = tagged(view, 'dropPreview');
    expect(preview.visible).toBe(true);
    expect(colorDistance(preview.material.color, new Color(defaultTheme.zones.blue.border))).toBeLessThan(0.02);
    expect(peak.get(slot.id)!).toBeGreaterThan(0.24);
    view.dispose();
  });
});

describe('truck and camera', () => {
  it('fades a cue board like a rack bay while it hides the forklift from outside (wall sunk), never its stickers', () => {
    const behind = YAW + Math.PI;
    const { snap, view } = setup(NORTH, behind);
    const front = cellToWorld(slotOf(snap, 't1:1:0').front, NORTH.size);
    snap.forklift.pos = { ...front };
    snap.forklift.heading = Math.PI;
    step(view, snap, 1.5, behind);
    const board = boards(view)[0];
    expect(board.material.opacity).toBeLessThan(0.4);
    expect(board.material.depthWrite).toBe(false);
    expect(panel(view, 't1:0:0')!.material.opacity).toBeCloseTo(board.material.opacity, 6);
    for (const s of snap.truckSlots!) {
      const cue = cueMesh(view, s.id)!;
      expect(cue.visible).toBe(true);
      expect(cue.material.transparent).toBe(false);
      expect(cue.material.opacity).toBe(1);
      expect(cue.material.depthWrite).toBe(true);
    }
    // From inside (the default camera) the boards stand behind everything: solid.
    step(view, snap, 2);
    for (const b of boards(view)) expect(b.material.opacity).toBe(1);
    view.dispose();
  });

  it('sinks the truck outside with its wall when the camera goes behind it, and raises it back; framed only standing', () => {
    const S = DIORAMA.slabThickness;
    for (const [lvl, behind] of [
      [NORTH, YAW + Math.PI / 2],
      [WEST, YAW - Math.PI / 2],
    ] as const) {
      const { snap, view } = setup(lvl);
      const out = outside(view);
      const fit = view.fitBoxes.find((f) => f.max.y > 0.9 && (f.min.z < -lvl.size.depth / 2 - 1 || f.min.x < -lvl.size.width / 2 - 1))!;
      step(view, snap, 0.5);
      expect(out.visible).toBe(true);
      expect(out.scale.y).toBeCloseTo(1, 6);
      expect(fit).toBeDefined();
      let last = out.scale.y;
      for (let i = 0; i < 180; i++) {
        view.update(snap, 1 / 60, i / 60, behind, 0);
        expect(out.scale.y).toBeLessThanOrEqual(last + 1e-9);
        last = out.scale.y;
      }
      expect(out.visible).toBe(false);
      // Nothing of it left to frame beyond the warehouse, and the bed and its boards stay.
      expect(fit.max.y).toBeLessThanOrEqual(-S + 1e-3);
      expect(fit.min.x).toBeGreaterThan(-lvl.size.width / 2 - DIORAMA.wallThickness - 1e-3);
      expect(fit.min.z).toBeGreaterThan(-lvl.size.depth / 2 - DIORAMA.wallThickness - 1e-3);
      expect(truckGroup(view).visible).toBe(true);
      step(view, snap, 3);
      expect(out.visible).toBe(true);
      expect(out.scale.y).toBeCloseTo(1, 3);
      expect(fit.max.y).toBeGreaterThan(0.9);
      view.dispose();
    }
  });

  it('keeps the frame calm while the Benchmark dock wall sinks and rises: idle orbit and Q/E turns, truck in frame', () => {
    // The truck's reach used to come back into the fit within ~4 frames of its wall rising: a 2.4 % per-frame zoom on
    // the idle orbit (3.1 % on a portrait Q/E turn). Walls alone step by up to ≈ 0.7 %.
    const MAX_STEP = 0.015;
    const bench = getSpecialLevel(BENCHMARK_ID)!;
    const runs: [string, number, (rig: CameraRig, frame: number) => void][] = [
      ['orbit', 242 * 60, (rig, f) => f === 0 && rig.setIdleOrbit(true)],
      ['Q', 5 * 150, (rig, f) => f % 150 === 0 && f < 600 && rig.rotate(1)],
      ['E', 5 * 150, (rig, f) => f % 150 === 0 && f < 600 && rig.rotate(-1)],
    ];
    const bounds = new Box3();
    const p = new Vector3();
    for (const [w, h] of [[1920, 1080], [800, 1200]]) {
      for (const [name, frames, drive] of runs) {
        const snap = new GameState(bench).getSnapshot();
        const rig = new CameraRig(GAME_CONFIG.camera);
        rig.setAspect(w, h);
        const view = new LevelView(snap, defaultTheme, GAME_CONFIG, rig.yaw);
        rig.setFitBoxes(view.fitBoxes);
        rig.update(0);
        const out = outside(view);
        let prev = rig.camera.top;
        let worst = 0;
        let spill = 0;
        let sank = false;
        for (let f = 0; f < frames; f++) {
          drive(rig, f);
          rig.update(1 / 60);
          view.update(snap, 1 / 60, f / 60, rig.yaw, 0);
          worst = Math.max(worst, Math.abs(rig.camera.top / prev - 1));
          prev = rig.camera.top;
          sank ||= !out.visible;
          if (!out.visible) continue;
          out.updateWorldMatrix(true, true);
          bounds.setFromObject(out, true);
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
        view.dispose();
      }
    }
  });

  it('plays the completion wave on truck levels too, and releases every truck resource on dispose', () => {
    const { snap, view } = setup(WEST);
    step(view, snap, 2);
    // «lavanda ✚» starts right: already glowing softly, no flash on load.
    expect(panel(view, 't1:2:0')!.material.emissiveIntensity).toBeCloseTo(TARGET_REST, 2);
    view.handleEvent({ type: 'levelComplete' }, snap);
    const peak = peakGlow(view, snap, 3);
    expect(peak.get('t1:2:0')!).toBeGreaterThan(TARGET_REST + 0.1);
    expect(peak.get('t1:0:0')!).toBeGreaterThan(0.1);

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
    expect(tracked.some((o) => o.parent === outside(view))).toBe(true);
    view.dispose();
    for (const o of tracked) {
      const mesh = o as Mesh;
      expect(disposed.has(mesh.geometry)).toBe(true);
      expect(disposed.has(mesh.material as MeshStandardMaterial)).toBe(true);
    }
  });
});
