import { Box3, Color, Mesh, MeshBasicMaterial, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { STORAGE_SKINS, STORAGE_SKIN_ORDER, storageOf } from '../../core/storage';
import { COLOR_IDS, type ForkliftState, type GameSnapshot, type LevelData, type StorageSlotState } from '../../core/types';
import { parseLevel } from '../../data/asciiLevel';
import { GameState } from '../../logic/GameState';
import { defaultTheme } from '../../themes/default';
import { buildForkliftGeometry } from '../builders/forklift';
import { PANEL_HEIGHT, outwardYaw } from '../builders/rack';
import { DOCK_SIGN, SIGN_MARKER, dockColumnX, dockToWorld, signMidZ, signRowY } from '../builders/truck';
import { wallLayouts } from '../builders/walls';
import { RACK, boxDims, rackSlotY } from '../dims';
import { LevelView } from '../LevelView';
import { createSharedMaterials } from '../materials';
import { ResourceBag } from '../resources';
import { ForkliftView } from '../views/ForkliftView';
import { WallView } from '../views/WallView';
import { TARGET_REST } from '../views/success';
import {
  STORAGE_RENDER,
  SUPPORT_LOOK,
  supportOf,
  type BurstPlace,
  type MarkerPlace,
  type StorageBuildContext,
  type StorageUnitBuilder,
  type StorageUnitView,
} from '.';

/*
 * The storage skins registry of the render (docs/STORAGE.md «Contratos por capa», render): one entry per skin, one
 * common interface per unit (a group, a light per level, the chosen-level marker: the forks go by the keys at every
 * unit, a static frame, the pieces that ghost, the burst), heights by support. Layouts are inline (no .level files).
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/**
 * A synthetic warehouse with four trucks on both back walls (two north, a plant apart; two west) and two racks, of 2
 * and 3 levels. Every cue exact, every box of its own kind: one complete assignment by construction.
 */
const MANY = level(`
# 1 · Registro de aspectos
id: registro-aspectos
limit: 2

  0123456789
0 pTTpCp..R.
1 ..........
2 p..a...b..
3 U..c...d..
4 p....S..e.
5 p..f....1.
6 V...g.h.i.
7 p..j.k...^

1 = zona azul ▲
a = caja azul ■        b = caja coral ◆       c = caja menta ●       d = caja amarillo ✚
e = caja lavanda ▲     f = caja azul ●        g = caja coral ■       h = caja menta ◆
i = caja amarillo ■    j = caja lavanda ◆     k = caja azul ▲
R = estantería frente sur: menta ◆ / libre
S = estantería frente norte: amarillo ■ / libre / lavanda ◆
T = camión muelle norte: azul ■ / coral ◆ | menta ●
C = camión muelle norte: amarillo ✚
U = camión muelle oeste: lavanda ▲ / azul ●
V = camión muelle oeste: coral ■
`);

const YAW = Math.PI / 4;
const height = boxDims(GAME_CONFIG).height;

/** A build context as LevelView lends it, by hand (its walls standing). */
function context(lvl: LevelData): { ctx: StorageBuildContext; bag: ResourceBag } {
  const bag = new ResourceBag();
  const walls = new Map(wallLayouts(lvl).map((l) => [l.side, new WallView(l.inward, new Vector3(), new Vector3())]));
  const ctx: StorageBuildContext = {
    level: lvl,
    theme: defaultTheme,
    mats: createSharedMaterials(bag),
    bag,
    depthOnly: bag.track(new MeshBasicMaterial({ colorWrite: false, transparent: true })),
    landDelay: GAME_CONFIG.box.dropLandSec,
    boxHeight: height,
    slotTones: new Map(COLOR_IDS.map((c) => [c, { band: new Color(defaultTheme.boxes[c].base), glow: new Color(defaultTheme.zones[c].glow) }])),
    markOf: (criteria) => (criteria.symbol ? { shape: criteria.symbol, style: 'engraved' } : null),
    wall: (side) => walls.get(side)!,
  };
  return { ctx, bag };
}

/** Every unit of `lvl` built straight through the registry, one builder per skin, in storage order. */
function buildAll(lvl: LevelData): { snap: GameSnapshot; units: StorageUnitView[]; bag: ResourceBag } {
  const snap = new GameState(lvl).getSnapshot();
  const { ctx, bag } = context(lvl);
  const builders = new Map<string, StorageUnitBuilder>();
  const units = storageOf(lvl).map((unit) => {
    const builder = builders.get(unit.skin) ?? STORAGE_RENDER[unit.skin].builder(ctx);
    builders.set(unit.skin, builder);
    return builder.build(unit, snap.storageSlots.filter((s) => s.unitId === unit.id));
  });
  return { snap, units, bag };
}

/** The lit panel of level `id` in a unit's group (a rack slot's panel, a dock sign cell's). */
const panelOf = (unit: StorageUnitView, id: string) =>
  unit.group.children.find((c) => c.userData.slotId === id || c.userData.signPanel === id) as Mesh<BufferGeometry, MeshStandardMaterial> | undefined;
const stickerOf = (unit: StorageUnitView, id: string) => unit.group.children.find((c) => c.userData.slotCue === id || c.userData.truckCue === id);

describe('render/storage: the registry', () => {
  it('has one entry per skin of STORAGE_SKINS, each with its chosen-level marker (the forks go by the keys at every unit)', () => {
    expect(Object.keys(STORAGE_RENDER)).toEqual([...STORAGE_SKIN_ORDER]);
    for (const skin of STORAGE_SKIN_ORDER) expect(typeof STORAGE_RENDER[skin].builder).toBe('function');
    // A rack's marker frames the chosen shelf; a truck's, the chosen level's cell on its sign (docs/STORAGE.md rule 9).
    for (const skin of STORAGE_SKIN_ORDER) expect(STORAGE_RENDER[skin].markerGeometry, skin).toBeDefined();
    // The truck's is the size of a sign cell: a door cell wide, one row high, on both faces of the sign.
    const sign = STORAGE_RENDER.truck.markerGeometry!();
    sign.computeBoundingBox();
    const size = sign.boundingBox!.getSize(new Vector3());
    expect(size.x).toBeCloseTo(2 * SIGN_MARKER.halfW, 5);
    expect(size.x).toBeCloseTo(1, 5);
    expect(size.y).toBeCloseTo(2 * SIGN_MARKER.halfH, 5);
    expect(size.y).toBeGreaterThan(DOCK_SIGN.row);
    expect(size.y).toBeLessThan(DOCK_SIGN.row + 2 * DOCK_SIGN.divider);
    expect(sign.boundingBox!.min.z).toBeLessThan(-DOCK_SIGN.depth / 2);
    expect(sign.boundingBox!.max.z).toBeGreaterThan(DOCK_SIGN.depth / 2);
    sign.dispose();
  });

  it('heights go by support, never by skin: shelf floors at rackSlotY, a stack at floor stack heights', () => {
    for (const skin of STORAGE_SKIN_ORDER) expect(supportOf(skin)).toBe(STORAGE_SKINS[skin].support);
    expect([SUPPORT_LOOK.shelves.shelf, SUPPORT_LOOK.stack.shelf]).toEqual([true, false]);
    for (const lvl of [0, 0.5, 1, 2]) {
      expect(SUPPORT_LOOK.shelves.levelY(lvl, height)).toBe(rackSlotY(lvl));
      expect(SUPPORT_LOOK.stack.levelY(lvl, height)).toBe(lvl * height);
    }
    // The forks: on shelves just over the chosen shelf's floor, in a stack (and off storage) at stack heights.
    const bag = new ResourceBag();
    const F = GAME_CONFIG.forklift;
    const geometry = buildForkliftGeometry(defaultTheme, { wheelRadius: F.wheelRadius, forkReach: F.forkReach, boxSize: GAME_CONFIG.box.size });
    const state: ForkliftState = { pos: { x: 0, z: 0 }, heading: 0, speed: 0, forkLift: 0, forkHeight: 2, carrying: null, wheelSpin: 0, steer: 0 };
    const tuning = { maxSpeed: F.maxSpeed, wheelRadius: F.wheelRadius, forkReach: F.forkReach, stackStep: height };
    const forkY = (support: 'shelves' | 'stack' | null) => {
      const view = new ForkliftView(geometry, createSharedMaterials(bag), tuning, state);
      for (let i = 0; i < 300; i++) view.sync(state, 1 / 60, i / 60, support);
      view.root.updateMatrixWorld(true);
      return view.anchor.getWorldPosition(new Vector3()).y;
    };
    // (± the idle hum of the parked body, 0.004.)
    expect(forkY('shelves')).toBeCloseTo(rackSlotY(2) + RACK.forkRest, 2);
    expect(forkY('stack')).toBe(forkY(null));
    expect(forkY(null)).toBeGreaterThan(2 * height);
    bag.dispose();
  });

  it('builds every unit from its LevelStorage and its levels: its group, a light per level with a cue, its frame, its ghosting pieces', () => {
    const { snap, units, bag } = buildAll(MANY);
    expect(units.map((u) => u.id)).toEqual(storageOf(MANY).map((u) => u.id));
    expect(units.map((u) => u.id)).toEqual(['r1', 'r2', 't1', 't2', 't3', 't4']);
    for (const [i, unit] of units.entries()) {
      const source = storageOf(MANY)[i];
      expect(unit.group.userData[source.skin === 'rack' ? 'rackId' : 'truckId']).toBe(unit.id);
      // A lit panel and an unlit sticker for every level with a cue, by its id; nothing for a «libre» one.
      for (const slot of snap.storageSlots.filter((s) => s.unitId === unit.id)) {
        expect(panelOf(unit, slot.id) !== undefined, slot.id).toBe(slot.accepts !== null);
        expect(stickerOf(unit, slot.id) !== undefined, slot.id).toBe(slot.accepts !== null);
      }
      // A static frame holding all it draws, and its ghosting pieces: a bay per rack column, a truck's sign.
      expect(new Box3(unit.fitBox.min, unit.fitBox.max).containsBox(unit.bounds)).toBe(true);
      expect(unit.bounds.isEmpty()).toBe(false);
      expect(unit.occluders).toHaveLength(source.skin === 'rack' ? source.w : 1);
      // Only a truck stands beyond a wall (the `door` access): its own.
      expect(unit.beyondWall?.side ?? null).toBe(source.access.kind === 'door' ? source.access.wall : null);
    }
    // A truck follows its wall: standing, it hides what lies beyond it; sunk, no longer.
    const truck = units[2].beyondWall!;
    truck.follow(0);
    expect(truck.stands).toBe(false);
    truck.follow(1);
    expect(truck.stands).toBe(true);
    bag.dispose();
  });

  it('places the marker at the chosen level of every unit (a rack shelf at its floor, a truck level on its sign cell), the burst on the face the camera sees', () => {
    const { snap, units, bag } = buildAll(MANY);
    const slot = (id: string) => snap.storageSlots.find((s) => s.id === id)!;
    const place: MarkerPlace = { x: 0, y: 0, z: 0, yaw: 0 };
    const burst: BurstPlace = { x: 0, y: 0, z: 0, yaw: 0, halfW: 0, halfH: 0 };
    const [r1, r2, t1, , t3] = units;
    // S (r2) faces north: its marker turns to the north, at the floor of the chosen shelf.
    const top = slot('r2:0:2');
    expect(r2.markerAt(top, place)).toEqual({ x: top.pos.x, y: rackSlotY(2), z: top.pos.z, yaw: outwardYaw('north') });
    expect(r1.markerAt(slot('r1:0:1'), place)).not.toBeNull();
    // A truck: the cell of the level on the sign over its door (its column's door cell along the wall, its row), turned
    // like the sign (toward the warehouse); its «libre» level too (the plain cell over «menta ●»).
    const cell = (wall: 'north' | 'west', x: number, z: number, column: number, row: number) =>
      dockToWorld(wall, MANY, dockColumnX({ wall, x, z }, MANY, column), signRowY(row), signMidZ(), new Vector3());
    for (const [id, column, row] of [
      ['t1:0:1', 0, 1],
      ['t1:1:0', 1, 0],
      ['t1:1:1', 1, 1],
    ] as const) {
      const at = cell('north', 1, 0, column, row);
      expect(t1.markerAt(slot(id), place), id).toEqual({ x: at.x, y: at.y, z: at.z, yaw: 0 });
    }
    expect(slot('t1:1:1').accepts).toBeNull();
    const west = cell('west', 0, 3, 0, 1);
    const onWest = t3.markerAt(slot('t3:0:1'), place)!;
    expect([onWest.x, onWest.y, onWest.z]).toEqual([west.x, west.y, west.z]);
    expect(onWest.yaw).toBeCloseTo(Math.PI / 2, 9);
    // A rack's burst hugs the slot opening at its floor; a truck's, the box on its bed, at its stack height. Each on
    // the face the camera sees: R faces south, toward the default camera; from the far side, the other face.
    expect(r1.burstAt(slot('r1:0:0'), YAW, burst)).toMatchObject({ y: rackSlotY(0), yaw: outwardYaw('south'), halfH: PANEL_HEIGHT / 2 });
    expect(r1.burstAt(slot('r1:0:0'), YAW + Math.PI, burst).yaw).toBeCloseTo(outwardYaw('south') + Math.PI, 9);
    const upper = slot('t1:0:1');
    expect(t1.burstAt(upper, YAW, burst)).toMatchObject({ x: upper.pos.x, y: height, z: upper.pos.z, halfH: height / 2 });
    // Only a rack's pieces carry the boxes on their shelves: nothing hides the forklift yet.
    expect(units.every((u) => !u.hidesActorAt(`${u.id}:0:0`))).toBe(true);
    bag.dispose();
  });

  it('lights a level by its id: only that level glows, on its own unit', () => {
    const { snap, units, bag } = buildAll(MANY);
    const unitOf = (s: StorageSlotState) => units.find((u) => u.id === s.unitId)!;
    const cued = snap.storageSlots.filter((s) => s.accepts !== null);
    for (const lit of [cued.find((s) => s.skin === 'rack')!, cued.find((s) => s.id === 't3:0:1')!]) {
      for (let i = 0; i < 120; i++) {
        for (const s of cued) unitOf(s).syncSlot(s.id === lit.id ? { ...s, satisfied: true } : s, 0, null, i / 60, 1 / 60);
      }
      for (const s of cued) {
        const glow = panelOf(unitOf(s), s.id)!.material.emissiveIntensity;
        if (s.id === lit.id) expect(glow, s.id).toBeCloseTo(TARGET_REST, 2);
        else expect(glow, s.id).toBeLessThan(0.02);
      }
      // Back to unlit for the next one.
      for (let i = 0; i < 240; i++) for (const s of cued) unitOf(s).syncSlot(s, 0, null, i / 60, 1 / 60);
    }
    bag.dispose();
  });
});

describe('render/storage: a synthetic warehouse, four trucks on both walls and racks of 2 and 3 levels', () => {
  it('mounts cleanly in LevelView: every unit in storage order, a dock door each, no truck touching another', () => {
    const snap = new GameState(MANY).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    for (const yaw of [YAW, YAW + Math.PI / 2, YAW + Math.PI, YAW - Math.PI / 2]) for (let i = 0; i < 90; i++) view.update(snap, 1 / 60, i / 60, yaw, 0);
    const groups = view.root.children.filter((c) => typeof c.userData.rackId === 'string' || typeof c.userData.truckId === 'string');
    expect(groups.map((g) => g.userData.rackId ?? g.userData.truckId)).toEqual(['r1', 'r2', 't1', 't2', 't3', 't4']);
    // Two dock doors in each back wall, one per truck.
    expect(wallLayouts(MANY).map((l) => [l.side, l.doors.length])).toEqual([
      ['north', 2],
      ['west', 2],
    ]);
    // Every truck: its body outside, its sign's stickers (one per level with a cue: none on a «libre» one), the rails
    // of its door; bodies apart.
    const trucks = groups.filter((g) => g.userData.truckId !== undefined);
    const bodies = trucks.map((g) => {
      const tagged = (tag: string) => g.children.filter((c) => c.userData[tag] !== undefined);
      expect(tagged('truckCue').map((c) => c.userData.truckCue)).toEqual(
        snap.storageSlots.filter((s) => s.unitId === g.userData.truckId && s.accepts !== null).map((s) => s.id),
      );
      expect(tagged('dockRails')).toHaveLength(1);
      return new Box3().setFromObject(tagged('truckBody')[0]);
    });
    for (let a = 0; a < bodies.length; a++) for (let b = a + 1; b < bodies.length; b++) expect(bodies[a].intersectsBox(bodies[b]), `trucks ${a}, ${b}`).toBe(false);
    // Each unit's frame is in the camera's (after the floor and both walls).
    expect(view.fitBoxes).toHaveLength(3 + groups.length);

    // Everything built is released on dispose.
    const disposed = new Set<object>();
    const tracked: Mesh[] = [];
    view.root.traverse((o: Object3D) => {
      if (!(o instanceof Mesh)) return;
      tracked.push(o);
      o.geometry.addEventListener('dispose', () => disposed.add(o.geometry));
      (o.material as MeshStandardMaterial).addEventListener('dispose', () => disposed.add(o.material as MeshStandardMaterial));
    });
    view.dispose();
    for (const mesh of tracked) {
      expect(disposed.has(mesh.geometry)).toBe(true);
      expect(disposed.has(mesh.material as MeshStandardMaterial)).toBe(true);
    }
  });

  it('shows the chosen-level marker of the unit worked at: a rack shelf, a truck level on its sign cell (one marker per skin)', () => {
    const snap = new GameState(MANY).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    const markers = view.root.children.filter((c) => c.userData.slotMarker) as Mesh<BufferGeometry, MeshBasicMaterial>[];
    // One marker per skin, shared by its units: the racks' and the trucks'.
    expect(markers.map((m) => m.userData.markerSkin)).toEqual(['rack', 'truck']);
    const [marker, sign] = markers;
    const at = (id: string, ready = false) => {
      const slot = snap.storageSlots.find((s) => s.id === id)!;
      const levels = snap.storageSlots.filter((s) => s.unitId === slot.unitId && s.column === slot.column).length;
      snap.hint.storage = { unitId: slot.unitId, skin: slot.skin, column: slot.column, levels, level: slot.level, slotId: slot.id, ready };
    };
    const run = () => {
      for (let i = 0; i < 60; i++) view.update(snap, 1 / 60, i / 60, YAW, 0);
    };
    at('r2:0:1');
    run();
    expect(marker.visible).toBe(true);
    expect(marker.position.y).toBeCloseTo(rackSlotY(1), 3);
    at('r1:0:0', true);
    run();
    expect(marker.visible).toBe(true);
    expect(marker.material.opacity).toBeGreaterThan(0.7);
    expect(marker.position.y).toBeCloseTo(rackSlotY(0), 3);
    expect(sign.visible).toBe(false);
    // At a truck: its marker frames the chosen level's sign cell (faint while the action would not work there, clear
    // when it would), turned like the sign; the rack's marker fades away.
    const cellOf = (wall: 'north' | 'west', x: number, z: number, column: number, row: number) =>
      dockToWorld(wall, MANY, dockColumnX({ wall, x, z }, MANY, column), signRowY(row), signMidZ(), new Vector3());
    for (const [id, wall, x, z, column, row, yaw] of [
      ['t1:0:0', 'north', 1, 0, 0, 0, 0],
      ['t1:1:1', 'north', 1, 0, 1, 1, 0],
      ['t3:0:1', 'west', 0, 3, 0, 1, Math.PI / 2],
    ] as const) {
      at(id, true);
      run();
      expect(marker.visible, id).toBe(false);
      expect(sign.visible, id).toBe(true);
      expect(sign.material.opacity, id).toBeGreaterThan(0.7);
      const want = cellOf(wall, x, z, column, row);
      expect(sign.position.distanceTo(want), id).toBeLessThan(1e-3);
      expect(sign.rotation.y, id).toBeCloseTo(yaw, 9);
    }
    at('t1:0:1');
    run();
    expect(sign.visible).toBe(true);
    expect(sign.material.opacity).toBeGreaterThan(0.2);
    expect(sign.material.opacity).toBeLessThan(0.4);
    expect(sign.position.y).toBeCloseTo(signRowY(1), 3);
    snap.hint.storage = null;
    run();
    expect([marker.visible, sign.visible]).toEqual([false, false]);
    view.dispose();
  });
});
