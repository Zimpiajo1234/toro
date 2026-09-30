import { Color, Mesh, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { isDestined } from '../../core/sorting';
import type { BoxState, GameSnapshot, LevelData, SlotState, ZoneState } from '../../core/types';
import { parseLevel } from '../../data/asciiLevel';
import { GameState } from '../../logic/GameState';
import { defaultTheme } from '../../themes/default';
import { LevelView } from '../LevelView';
import { DROP_GLIDE_SEC, LOCK_DELAY, lockTintOf } from './BoxView';
import { BURST_SEC, FLASH_PEAK, FLASH_RISE_SHARE, FLASH_SEC, LOCK_SEC, TARGET_REST, flashEnvelope, flashGlow } from './success';

/*
 * Levels with racks (docs/RACKS.md, decision 2026-09-30): the destined box on its zone or slot flashes the target, plays
 * a small burst, the glow settles soft, then the box eases to a deeper tone and is locked (done and fixed). Driven with
 * fake time: the view only sees the dt it is handed. Layouts are inline (no .level files).
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/**
 * One rack slot «azul» and one floor zone «▲», front to the south. Blue ▲ fits both (the zone is its trap), but its
 * destiny is the slot; mint ▲ goes to the zone.
 */
const MIXED = level(`
# 1 · Zona y estantería
id: zona-estanteria
limit: 1

  0123456
0 .......
1 .......
2 ...R...
3 .......
4 .a.b.1.
5 ...^...

1 = zona ▲
a = caja azul ▲       b = caja menta ▲
R = estantería frente sur: azul
`);

/** The same room without the rack: a classic sorting level (nothing locks, nothing changes). */
const PLAIN = level(`
# 2 · Sin estanterías
id: sin-estanterias
limit: 1

  0123456
0 .......
1 .1.....
2 .......
3 .......
4 .a.b.2.
5 ...^...

1 = zona azul        2 = zona ▲
a = caja azul ▲      b = caja menta ▲
`);

const YAW = Math.PI / 4;
const FRAME = 1 / 60;

function setup(lvl: LevelData = MIXED): { snap: GameSnapshot; view: LevelView } {
  const snap = new GameState(lvl).getSnapshot();
  return { snap, view: new LevelView(snap, defaultTheme, GAME_CONFIG, YAW) };
}

/** Fake clock: advance the view by `seconds` in 60 fps frames, calling `each` after every frame. */
function run(view: LevelView, snap: GameSnapshot, seconds: number, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    view.update(snap, FRAME, i * FRAME, YAW, 0);
    each?.();
  }
}

const rackGroup = (view: LevelView) => view.root.children.find((c) => c.userData.rackId === 'r1')!;
const panel = (view: LevelView, slotId: string) =>
  rackGroup(view).children.find((c) => c.userData.slotId === slotId) as Mesh<BufferGeometry, MeshStandardMaterial>;
const band = (view: LevelView, slotId: string) =>
  rackGroup(view).children.find((c) => c.userData.slotGlow === slotId) as Mesh<BufferGeometry, MeshBasicMaterial>;
const pad = (view: LevelView, zoneId: string) =>
  view.root.children.find((c) => c.userData.zoneId === zoneId)!.children[1] as Mesh<BufferGeometry, MeshStandardMaterial>;
const boxMesh = (view: LevelView, id: string) =>
  view.root.children.find((c) => c.userData.boxId === id)!.children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
const bursts = (view: LevelView) => view.root.children.filter((c) => c.userData.successBurst);
/** Some burst is on screen with at least one sparkle showing. */
const bursting = (view: LevelView) => bursts(view).some((b) => b.visible && b.children.some((m, i) => i > 0 && m.visible));
const boxOf = (snap: GameSnapshot, color: string) => snap.boxes.find((b) => b.color === color)!;
const colorDistance = (a: Color, b: Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

/** Hand-driven snapshot edits (the view only reads it), as logic would publish them on a drop. */
function restInSlot(box: BoxState, slot: SlotState): void {
  const destined = isDestined(slot, box);
  Object.assign(box, { carried: false, cell: { ...slot.cell }, pos: { ...slot.pos }, level: slot.level, slotId: slot.id, zoneId: null, correct: destined, locked: destined });
  Object.assign(slot, { occupiedBy: box.id, satisfied: destined });
}
function restOnZone(box: BoxState, zone: ZoneState): void {
  const destined = isDestined(zone, box);
  Object.assign(box, { carried: false, cell: { ...zone.cell }, pos: { ...zone.pos }, level: 0, slotId: null, zoneId: zone.id, correct: destined, locked: destined });
  Object.assign(zone, { stack: [box.id], occupiedBy: box.id, satisfied: destined, next: null });
}
function carry(snap: GameSnapshot, box: BoxState): void {
  Object.assign(box, { carried: true, cell: null, level: 0, slotId: null, zoneId: null, correct: false, locked: false });
  snap.forklift.carrying = box.id;
  snap.forklift.forkLift = 1;
}

describe('success timing', () => {
  it('flashes up quickly to the peak, then eases down to the soft rest glow', () => {
    expect(flashEnvelope(0)).toBe(0);
    expect(flashEnvelope(FLASH_RISE_SHARE)).toBeCloseTo(1, 6);
    expect(flashEnvelope(1)).toBeCloseTo(0, 6);
    expect(flashGlow(0, 0)).toBe(0);
    expect(flashGlow(FLASH_RISE_SHARE, 0)).toBeCloseTo(FLASH_PEAK, 6);
    expect(flashGlow(1, 0)).toBeCloseTo(TARGET_REST, 6);
    // Settled before the box starts to deepen, the burst over by then.
    expect(LOCK_DELAY).toBeCloseTo(DROP_GLIDE_SEC + FLASH_SEC, 6);
    expect(BURST_SEC).toBeLessThanOrEqual(FLASH_SEC);
    expect(BURST_SEC).toBeGreaterThanOrEqual(0.5);
    expect(BURST_SEC).toBeLessThanOrEqual(0.7);
  });
});

describe('destined box in a rack slot: flash, burst, soft glow, then deeper and locked', () => {
  it('plays the sequence once the box lands, in order', () => {
    const { snap, view } = setup();
    const blue = boxOf(snap, 'blue');
    const slot = snap.slots[0];
    run(view, snap, 0.5);
    const own = boxMesh(view, blue.id).material.color.clone();
    expect(colorDistance(own, new Color(1, 1, 1))).toBeLessThan(1e-6);

    restInSlot(blue, slot);
    expect(slot.satisfied && blue.locked).toBe(true);
    // Gliding in: nothing yet.
    run(view, snap, DROP_GLIDE_SEC - 2 * FRAME);
    expect(panel(view, slot.id).material.emissiveIntensity).toBeLessThan(0.005);
    expect(bursting(view)).toBe(false);

    // Landed: the target flashes intense, its band flares, the burst plays.
    let peak = 0;
    let bandPeak = 0;
    let burst = false;
    run(view, snap, FLASH_SEC * FLASH_RISE_SHARE + 3 * FRAME, () => {
      peak = Math.max(peak, panel(view, slot.id).material.emissiveIntensity);
      bandPeak = Math.max(bandPeak, band(view, slot.id).material.opacity);
      burst ||= bursting(view);
    });
    expect(peak).toBeGreaterThan(0.7);
    expect(bandPeak).toBeGreaterThan(0.8);
    expect(burst).toBe(true);
    // The burst's sparkles and ring are a light of the box's own colour (never red, never text).
    const sparkle = bursts(view).find((b) => b.visible)!.children[1] as Mesh<BufferGeometry, MeshBasicMaterial>;
    const tone = new Color(defaultTheme.boxes.blue.base).lerp(new Color(1, 1, 1), 0.08);
    expect(colorDistance(sparkle.material.color, tone)).toBeLessThan(1e-3);
    // The box keeps its own tone while the target celebrates.
    expect(colorDistance(boxMesh(view, blue.id).material.color, own)).toBeLessThan(1e-6);

    // The glow settles soft and steady; the burst is over; the box has not started to deepen yet.
    run(view, snap, FLASH_SEC * (1 - FLASH_RISE_SHARE) - 6 * FRAME);
    expect(panel(view, slot.id).material.emissiveIntensity).toBeGreaterThan(TARGET_REST - 0.02);
    expect(panel(view, slot.id).material.emissiveIntensity).toBeLessThan(TARGET_REST + 0.05);
    expect(bursting(view)).toBe(false);
    expect(band(view, slot.id).material.opacity).toBeLessThan(0.05);
    expect(colorDistance(boxMesh(view, blue.id).material.color, own)).toBeLessThan(0.02);

    // Then the box eases (≈ 0.6 s, no jump) to the deeper tone of its colour.
    let last = boxMesh(view, blue.id).material.color.clone();
    let maxStep = 0;
    run(view, snap, LOCK_SEC + 0.3, () => {
      const c = boxMesh(view, blue.id).material.color;
      maxStep = Math.max(maxStep, colorDistance(c, last));
      last = c.clone();
    });
    const tint = lockTintOf(defaultTheme.boxes.blue);
    expect(colorDistance(boxMesh(view, blue.id).material.color, tint)).toBeLessThan(1e-3);
    expect(maxStep).toBeLessThan(0.05);
    // Base × tint = exactly the theme's locked tone; every channel darker, same hue family (blue stays bluest).
    const locked = new Color(defaultTheme.boxes.blue.base).multiply(tint);
    expect(colorDistance(locked, new Color(defaultTheme.boxes.blue.locked))).toBeLessThan(1e-3);
    expect(tint.r).toBeLessThan(1);
    expect(locked.b).toBeGreaterThan(locked.r);
    // "Hecho y fijo": the target keeps its soft glow, the box its faint "correct" lift fades out (matte and deep).
    run(view, snap, 2);
    expect(panel(view, slot.id).material.emissiveIntensity).toBeCloseTo(TARGET_REST, 2);
    expect(band(view, slot.id).visible).toBe(false);
    expect(boxMesh(view, blue.id).material.emissiveIntensity).toBeLessThan(0.01);
    view.dispose();
  });

  it('a trap box that fits the cue gets no visual at all (the error is audio only)', () => {
    const { snap, view } = setup();
    const mint = boxOf(snap, 'mint');
    const zone = snap.zones[0];
    run(view, snap, 0.5);
    // Mint ▲ fits nothing in the rack; blue ▲ onto the «▲» zone (its trap) instead.
    const blue = boxOf(snap, 'blue');
    restOnZone(blue, zone);
    expect(zone.satisfied || blue.locked).toBe(false);
    let peak = 0;
    let burst = false;
    run(view, snap, 3, () => {
      peak = Math.max(peak, pad(view, zone.id).material.emissiveIntensity);
      burst ||= bursting(view);
    });
    expect(peak).toBeLessThan(0.005);
    expect(burst).toBe(false);
    expect(colorDistance(boxMesh(view, blue.id).material.color, new Color(1, 1, 1))).toBeLessThan(1e-6);
    // Still pickable: it lifts as the pick target, like any box.
    snap.hint.targetBoxId = blue.id;
    run(view, snap, 0.5);
    expect(boxMesh(view, blue.id).position.y).toBeGreaterThan(0.02);
    expect(mint.locked).toBe(false);
    view.dispose();
  });
});

describe('destined box on a floor zone (rack level)', () => {
  it('flashes the pad and its halo, sparkles over it, settles soft, then deepens the box', () => {
    const { snap, view } = setup();
    const mint = boxOf(snap, 'mint');
    const zone = snap.zones[0];
    run(view, snap, 0.5);
    restOnZone(mint, zone);
    expect(zone.satisfied && mint.locked).toBe(true);
    let peak = 0;
    let burst = false;
    run(view, snap, DROP_GLIDE_SEC + FLASH_SEC * FLASH_RISE_SHARE + 3 * FRAME, () => {
      peak = Math.max(peak, pad(view, zone.id).material.emissiveIntensity);
      burst ||= bursting(view);
    });
    expect(peak).toBeGreaterThan(0.7);
    expect(burst).toBe(true);
    run(view, snap, LOCK_DELAY + LOCK_SEC + 0.5);
    expect(pad(view, zone.id).material.emissiveIntensity).toBeCloseTo(TARGET_REST, 2);
    expect(bursting(view)).toBe(false);
    expect(colorDistance(boxMesh(view, mint.id).material.color, lockTintOf(defaultTheme.boxes.mint))).toBeLessThan(1e-3);
    view.dispose();
  });

  it('pulses a free zone clearly for a box it would take (much more than in levels without racks)', () => {
    const peakOf = (lvl: LevelData, color: string) => {
      const { snap, view } = setup(lvl);
      view.setTargetHints(true); // the optional target hints (P)
      const zone = snap.zones.find((z) => z.accepts.symbol === 'triangle' && z.accepts.color === undefined)!;
      carry(snap, boxOf(snap, color));
      let peak = 0;
      let halo = 0;
      run(view, snap, 3, () => {
        peak = Math.max(peak, pad(view, zone.id).material.emissiveIntensity);
        const zoneGroup = view.root.children.find((c) => c.userData.zoneId === zone.id)!;
        halo = Math.max(halo, ((zoneGroup.children[0] as Mesh).material as MeshBasicMaterial).opacity);
      });
      view.dispose();
      return { peak, halo };
    };
    const racked = peakOf(MIXED, 'mint');
    const plain = peakOf(PLAIN, 'mint');
    expect(racked.peak).toBeGreaterThan(0.5);
    expect(racked.peak).toBeLessThan(0.65);
    expect(racked.halo).toBeGreaterThan(0.7);
    // Levels without racks: the gentle breathing of always (≈ 0.17).
    expect(plain.peak).toBeGreaterThan(0.1);
    expect(plain.peak).toBeLessThan(0.18);
  });
});

describe('locked boxes: no pick affordance, no drop preview on them', () => {
  it('never lifts a locked box as the pick target, nor frames its slot as ready, nor previews a drop on it', () => {
    const { snap, view } = setup();
    const blue = boxOf(snap, 'blue');
    const mint = boxOf(snap, 'mint');
    const slot = snap.slots[0];
    const zone = snap.zones[0];
    restInSlot(blue, slot);
    restOnZone(mint, zone);
    run(view, snap, 3);

    // Facing its slot with empty forks: even if a hint named it, no hover lift or glow, and the slot marker stays faint.
    snap.hint.targetBoxId = blue.id;
    snap.hint.rack = { rackId: 'r1', column: 0, levels: 1, level: 0, slotId: slot.id, ready: true };
    run(view, snap, 1);
    expect(boxMesh(view, blue.id).position.y).toBeCloseTo(0, 4);
    expect(boxMesh(view, blue.id).material.emissiveIntensity).toBeLessThan(0.01);
    const marker = view.root.children.find((c) => c.userData.slotMarker) as Mesh<BufferGeometry, MeshBasicMaterial>;
    expect(marker.material.opacity).toBeLessThan(0.4);

    // Carrying another box over the locked zone box: no drop preview on top of it.
    snap.hint.rack = null;
    snap.hint.targetBoxId = null;
    Object.assign(blue, { carried: true, cell: null, slotId: null, locked: false, correct: false });
    Object.assign(slot, { occupiedBy: null, satisfied: false });
    snap.forklift.carrying = blue.id;
    snap.hint.dropCell = { ...zone.cell };
    snap.hint.dropZoneId = zone.id;
    snap.hint.dropLevel = 1;
    run(view, snap, 1);
    const preview = view.root.children.find((c) => c.userData.dropPreview) as Mesh;
    expect(preview.visible).toBe(false);
    // A free floor cell still previews as always.
    snap.hint.dropCell = { x: 1, z: 2 };
    snap.hint.dropZoneId = null;
    snap.hint.dropLevel = 0;
    run(view, snap, 1);
    expect(preview.visible).toBe(true);
    view.dispose();
  });
});

describe('load, restart and completion', () => {
  it('a level loaded (or restarted) with a box already locked shows it done at once: nothing replays', () => {
    const state = new GameState(MIXED);
    const snap = state.getSnapshot();
    const blue = boxOf(snap, 'blue');
    restInSlot(blue, snap.slots[0]);
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    const tint = lockTintOf(defaultTheme.boxes.blue);
    expect(colorDistance(boxMesh(view, blue.id).material.color, tint)).toBeLessThan(1e-3);
    let peak = 0;
    let burst = false;
    run(view, snap, 3, () => {
      peak = Math.max(peak, panel(view, snap.slots[0].id).material.emissiveIntensity);
      burst ||= bursting(view);
      expect(colorDistance(boxMesh(view, blue.id).material.color, tint)).toBeLessThan(1e-3);
    });
    expect(peak).toBeLessThan(TARGET_REST + 0.005);
    expect(burst).toBe(false);
    view.dispose();

    // A fresh level (restart): own tones, nothing lit, nothing plays.
    const fresh = setup();
    let lit = 0;
    run(fresh.view, fresh.snap, 2, () => {
      lit = Math.max(lit, panel(fresh.view, fresh.snap.slots[0].id).material.emissiveIntensity);
      burst ||= bursting(fresh.view);
    });
    expect(lit).toBeLessThan(0.005);
    expect(burst).toBe(false);
    expect(colorDistance(boxMesh(fresh.view, boxOf(fresh.snap, 'blue').id).material.color, new Color(1, 1, 1))).toBeLessThan(1e-6);
    fresh.view.dispose();
  });

  it('the level-complete wave still plays over locked boxes and their targets', () => {
    const { snap, view } = setup();
    restInSlot(boxOf(snap, 'blue'), snap.slots[0]);
    restOnZone(boxOf(snap, 'mint'), snap.zones[0]);
    run(view, snap, LOCK_DELAY + LOCK_SEC + 1);
    snap.completed = true;
    view.handleEvent({ type: 'levelComplete' }, snap);
    let slotPeak = 0;
    let padPeak = 0;
    let boxPeak = 0;
    run(view, snap, 2.5, () => {
      slotPeak = Math.max(slotPeak, panel(view, snap.slots[0].id).material.emissiveIntensity);
      padPeak = Math.max(padPeak, pad(view, snap.zones[0].id).material.emissiveIntensity);
      boxPeak = Math.max(boxPeak, boxMesh(view, boxOf(snap, 'blue').id).material.emissiveIntensity);
    });
    expect(slotPeak).toBeGreaterThan(TARGET_REST + 0.1);
    expect(padPeak).toBeGreaterThan(TARGET_REST + 0.1);
    expect(boxPeak).toBeGreaterThan(0.1);
    // Still deep and locked after the wave.
    expect(colorDistance(boxMesh(view, boxOf(snap, 'blue').id).material.color, lockTintOf(defaultTheme.boxes.blue))).toBeLessThan(1e-3);
    view.dispose();
  });

  it('builds its bursts and bands once (hidden while idle) and releases them on dispose', () => {
    const { snap, view } = setup();
    expect(bursts(view)).toHaveLength(2);
    expect(bursts(view).every((b) => !b.visible)).toBe(true);
    expect(band(view, snap.slots[0].id).visible).toBe(false);
    const disposed = new Set<object>();
    const tracked: Mesh[] = [];
    const watch = (o: Object3D) => {
      if (!(o instanceof Mesh)) return;
      tracked.push(o);
      o.geometry.addEventListener('dispose', () => disposed.add(o.geometry));
      (o.material as MeshBasicMaterial).addEventListener('dispose', () => disposed.add(o.material as MeshBasicMaterial));
    };
    for (const b of bursts(view)) b.traverse(watch);
    watch(band(view, snap.slots[0].id));
    view.dispose();
    for (const m of tracked) {
      expect(disposed.has(m.geometry)).toBe(true);
      expect(disposed.has(m.material as MeshBasicMaterial)).toBe(true);
    }
    // Levels without racks get none of it.
    const plain = setup(PLAIN);
    expect(bursts(plain.view)).toHaveLength(0);
    plain.view.dispose();
  });
});
