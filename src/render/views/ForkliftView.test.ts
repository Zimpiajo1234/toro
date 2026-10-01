import { Mesh, MeshBasicMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../../config';
import { TAU } from '../../core/math';
import { BEAT_SEC } from '../../core/tempo';
import type { ForkliftState } from '../../core/types';
import { defaultTheme } from '../../themes/default';
import { BEACON, BEACON_LIGHT_Y, buildForkliftGeometry } from '../builders/forklift';
import { DOCK_PLATE } from '../builders/truck';
import { ZONE } from '../dims';
import { createSharedMaterials } from '../materials';
import { ResourceBag } from '../resources';
import { ForkliftView } from './ForkliftView';

/*
 * The reverse beacon on the roof: hidden at rest and driving forward, it eases in while ForkliftState.reversing (the
 * shared latch the beeper follows, core/reversing), its two beams turning half a turn per beat, and eases out after.
 * Driven with fake time: the view only sees the state and the dt it is handed.
 */

const FRAME = 1 / 60;
const F = GAME_CONFIG.forklift;

function setup() {
  const bag = new ResourceBag();
  const geometry = buildForkliftGeometry(defaultTheme, { wheelRadius: F.wheelRadius, forkReach: F.forkReach, boxSize: GAME_CONFIG.box.size });
  const materials = createSharedMaterials(bag);
  const state: ForkliftState = {
    pos: { x: 0, z: 0 },
    heading: 0,
    speed: 0,
    forkLift: 0,
    forkHeight: 0,
    carrying: null,
    wheelSpin: 0,
    steer: 0,
    reversing: false,
  };
  const view = new ForkliftView(geometry, materials, { maxSpeed: F.maxSpeed, wheelRadius: F.wheelRadius, forkReach: F.forkReach, stackStep: 0.64 }, state);
  const part = (name: string) => find(view.root, (o) => o.userData.beacon === name) as Mesh<typeof geometry.beaconBeam, MeshBasicMaterial>;
  const lamp = part('lamp');
  const beam = part('beam');
  const glow = part('glow');
  let t = 0;
  /** `frames` frames of the given motion (speed in u/s; `reversing` = the latch's state). */
  const run = (frames: number, speed: number, reversing: boolean, each?: () => void) => {
    for (let i = 0; i < frames; i++) {
      state.speed = speed;
      state.reversing = reversing;
      t += FRAME;
      view.sync(state, FRAME, t);
      each?.();
    }
  };
  const lit = () => [lamp.visible, beam.visible, glow.visible];
  return { view, state, lamp, beam, glow, run, lit, materials };
}

function find(root: Object3D, test: (o: Object3D) => boolean): Object3D | undefined {
  let hit: Object3D | undefined;
  root.traverse((o) => {
    if (!hit && test(o)) hit = o;
  });
  return hit;
}

function count(root: Object3D): number {
  let n = 0;
  root.traverse(() => n++);
  return n;
}

describe('ForkliftView reverse beacon', () => {
  it('stays hidden at rest and driving forward: nothing drawn, every light at opacity 0', () => {
    const { view, run, lit, materials } = setup();
    expect(lit()).toEqual([false, false, false]);
    run(60, 0, false);
    run(120, F.maxSpeed, false);
    expect(lit()).toEqual([false, false, false]);
    expect(view.beaconLevel).toBe(0);
    for (const m of Object.values(materials.beacon)) expect(m.opacity).toBe(0);
  });

  it('lights on the frame reversing starts and eases in softly, a beam pointing straight back', () => {
    const { view, beam, run, lit, materials } = setup();
    run(10, 0, false);
    run(1, -0.2, true);
    expect(lit()).toEqual([true, true, true]);
    // A soft glow-up, never a pop: a small share on the first frame, then it keeps rising.
    expect(view.beaconLevel).toBeGreaterThan(0.05);
    expect(view.beaconLevel).toBeLessThan(0.25);
    expect(beam.rotation.y).toBe(0);
    let last = view.beaconLevel;
    run(20, -0.5, true, () => {
      expect(view.beaconLevel).toBeGreaterThan(last);
      last = view.beaconLevel;
    });
    run(4, -0.5, true);
    expect(view.beaconLevel).toBeGreaterThan(0.95); // on within ≈ 0.4 s
    expect(materials.beacon.beam.opacity).toBeGreaterThan(0.5);
    expect(materials.beacon.lamp.opacity).toBeGreaterThan(0.6);
  });

  it('turns its two beams half a turn per beat of the music, so one points back with every beep', () => {
    const { beam, glow, run } = setup();
    run(1, -0.5, true);
    const frames = Math.round(BEAT_SEC / FRAME);
    run(frames, -0.5, true);
    const turned = (beam.rotation.y + TAU) % Math.PI;
    expect(Math.min(turned, Math.PI - turned)).toBeLessThan(0.05); // back along the axis after one beat
    // The floor behind swells as a beam points back, and eases between two passes.
    const back = glow.material.opacity;
    run(Math.round(frames / 2), -0.5, true);
    const side = Math.abs(Math.sin(beam.rotation.y));
    expect(side).toBeGreaterThan(0.99); // beams across the rig now
    expect(glow.material.opacity).toBeLessThan(0.7 * back);
    expect(glow.material.opacity).toBeGreaterThan(0.3 * back);
  });

  it('eases out once reversing ends, then hides and starts its turn over from the back', () => {
    const { view, beam, run, lit } = setup();
    run(60, -0.5, true);
    let last = view.beaconLevel;
    run(1, 0, false);
    expect(view.beaconLevel).toBeLessThan(last); // starts fading on that very frame…
    expect(view.beaconLevel).toBeGreaterThan(0.8 * last); // …softly
    last = view.beaconLevel;
    run(20, 0, false, () => {
      expect(view.beaconLevel).toBeLessThan(last);
      last = view.beaconLevel;
    });
    expect(lit()).toEqual([true, true, true]); // still dimming
    run(90, 0, false);
    expect(lit()).toEqual([false, false, false]);
    expect(view.beaconLevel).toBe(0);
    run(1, -0.5, true);
    expect(beam.rotation.y).toBe(0);
  });

  it('backing up again while it dims picks up from where it is (no jump in light or turn)', () => {
    const { view, beam, run } = setup();
    run(40, -0.5, true);
    run(12, 0, false);
    const level = view.beaconLevel;
    const turn = beam.rotation.y;
    run(1, -0.5, true);
    expect(view.beaconLevel).toBeGreaterThan(level);
    expect(view.beaconLevel - level).toBeLessThan(0.2);
    expect(beam.rotation.y).toBeGreaterThan(turn);
    expect(beam.rotation.y - turn).toBeLessThan(0.1);
  });

  it('is unlit light only, built once: no shadows, no depth writes, the same objects every frame', () => {
    const { view, lamp, beam, glow, run, materials } = setup();
    for (const m of [lamp, beam, glow]) {
      expect(m.material).toBeInstanceOf(MeshBasicMaterial);
      expect(m.castShadow).toBe(false);
      expect(m.material.depthWrite).toBe(false);
      expect(m.material.transparent).toBe(true);
      expect(m.material.toneMapped).toBe(false);
    }
    // The lamp and beams ride on the roof (tilting with the body); the glow lies level on the floor behind.
    expect(lamp.parent).toBe(beam.parent);
    expect(lamp.parent).not.toBe(view.root);
    expect(glow.parent).toBe(view.root);
    expect(lamp.position.y).toBeCloseTo(BEACON_LIGHT_Y, 6);
    expect(lamp.position.z).toBeLessThan(0);
    expect(glow.position.z).toBeLessThan(-0.5);
    const nodes = count(view.root);
    const used = [lamp.geometry, beam.geometry, glow.geometry, lamp.material, beam.material, glow.material];
    for (let i = 0; i < 20; i++) run(15, i % 2 ? -0.5 : 0, i % 2 === 1);
    expect(count(view.root)).toBe(nodes);
    expect([lamp.geometry, beam.geometry, glow.geometry, lamp.material, beam.material, glow.material]).toEqual(used);
    expect(Object.values(materials.beacon)).toEqual([lamp.material, beam.material, glow.material]);
  });

  it('keeps its floor glow over the zone pads and the dock plate, pulled forward in depth like every floor overlay', () => {
    const { glow } = setup();
    expect(BEACON.glowY).toBeGreaterThan(ZONE.padHeight + 0.004);
    expect(BEACON.glowY).toBeGreaterThan(DOCK_PLATE.top + DOCK_PLATE.tread + 0.001);
    expect(BEACON.glowY).toBeLessThan(0.05);
    expect(glow.position.y).toBe(BEACON.glowY);
    expect(glow.material.polygonOffset).toBe(true);
    expect(glow.material.polygonOffsetFactor).toBeLessThan(0);
    expect(glow.renderOrder).toBeLessThan(2); // under the drop preview (renderOrder 2)
  });
});
