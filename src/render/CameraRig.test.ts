import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { CameraRig, type FitBox } from './CameraRig';

const DEG = Math.PI / 180;
const cam = GAME_CONFIG.camera;

function box(min: [number, number, number], max: [number, number, number]): FitBox {
  return { min: new Vector3(...min), max: new Vector3(...max), heightScale: 1 };
}

/** Diorama-like volumes: a 14×11 floor plus the north and west walls. */
const FIT: FitBox[] = [
  box([-7, -0.25, -5.5], [7, 1.3, 5.5]),
  box([-7.23, -0.25, -5.73], [7.03, 2.26, -5.47]),
  box([-7.23, -0.25, -5.47], [-6.97, 2.26, 5.5]),
];

/** A long, narrow warehouse (14×5): its widest projection is not on the 45° diagonals. */
const LONG: FitBox[] = [
  box([-7, -0.25, -2.5], [7, 1.3, 2.5]),
  box([-7.23, -0.25, -2.73], [7.03, 2.26, -2.47]),
  box([-7.23, -0.25, -2.47], [-6.97, 2.26, 2.5]),
];

function run(rig: CameraRig, seconds: number, fps = 60): void {
  for (let i = 0; i < Math.round(seconds * fps); i++) rig.update(1 / fps);
}

/** Frustum half height per frame while running (the zoom level of an orthographic camera). */
function zoomTrace(rig: CameraRig, seconds: number, fps = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    rig.update(1 / fps);
    out.push(rig.camera.top);
  }
  return out;
}

function maxStepRatio(trace: readonly number[], start: number): number {
  let prev = start;
  let worst = 0;
  for (const v of trace) {
    worst = Math.max(worst, Math.abs(v / prev - 1));
    prev = v;
  }
  return worst;
}

function expectContained(rig: CameraRig, boxes: readonly FitBox[]): void {
  const p = new Vector3();
  for (const b of boxes) {
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(rig.camera);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
    }
  }
}

describe('CameraRig', () => {
  it('starts at the configured yaw, with the camera sitting toward (sin ψ, cos ψ)', () => {
    const rig = new CameraRig(cam);
    rig.setFitBoxes(FIT);
    rig.update(0);
    expect(rig.yaw).toBeCloseTo(cam.yawDeg * DEG, 6);
    const dir = rig.camera.position.clone().setY(0).normalize();
    expect(dir.x).toBeCloseTo(Math.sin(rig.yaw), 3);
    expect(dir.z).toBeCloseTo(Math.cos(rig.yaw), 3);
  });

  it('keeps every fit corner inside the frustum for any aspect and yaw', () => {
    const rig = new CameraRig(cam);
    rig.setFitBoxes(FIT);
    const p = new Vector3();
    for (const [w, h] of [[1920, 1080], [800, 1200], [3440, 1440], [500, 500]]) {
      rig.setAspect(w, h);
      for (let k = 0; k < 4; k++) {
        rig.rotate(1);
        run(rig, cam.rotateDurationSec + 0.1);
        for (const b of FIT) {
          for (let i = 0; i < 8; i++) {
            p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(rig.camera);
            expect(Math.abs(p.x)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
            expect(Math.abs(p.y)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
          }
        }
      }
    }
  });

  it('never zooms in mid-turn: a Q/E rotation keeps the frame between its start and end framings', () => {
    for (const fit of [FIT, LONG]) {
      for (const [w, h] of [[1920, 1080], [800, 1200], [1280, 760]]) {
        const rig = new CameraRig(cam);
        rig.setFitBoxes(fit);
        rig.setAspect(w, h);
        rig.update(0);
        for (const dir of [1, 1, -1, -1] as const) {
          const start = rig.camera.top;
          rig.rotate(dir);
          const trace: number[] = [];
          for (let i = 0; i < 60; i++) {
            rig.update(cam.rotateDurationSec / 60);
            trace.push(rig.camera.top);
            expectContained(rig, fit); // the live fit still guards containment at every frame
          }
          const end = trace[trace.length - 1];
          for (const top of trace) expect(top).toBeGreaterThanOrEqual(Math.min(start, end) * (1 - 1e-9));
          expect(maxStepRatio(trace, start)).toBeLessThan(0.02);
        }
      }
    }
  });

  it('keeps the zoom continuous when rotations are chained mid-flight and around the idle orbit', () => {
    const rig = new CameraRig(cam);
    rig.setFitBoxes(FIT);
    rig.setAspect(1280, 760);
    rig.update(0);
    const rest = rig.camera.top;
    let prev = rest;
    const trace: number[] = [];
    rig.rotate(1);
    trace.push(...zoomTrace(rig, cam.rotateDurationSec * 0.45));
    rig.rotate(1);
    trace.push(...zoomTrace(rig, cam.rotateDurationSec * 0.3));
    rig.rotate(-1);
    trace.push(...zoomTrace(rig, cam.rotateDurationSec * 1.2));
    expect(maxStepRatio(trace, prev)).toBeLessThan(0.02);
    for (const top of trace) expect(top).toBeGreaterThanOrEqual(rest * 0.97);

    prev = rig.camera.top;
    rig.setIdleOrbit(true);
    const orbit = zoomTrace(rig, 90, 30);
    rig.setIdleOrbit(false);
    const settle = zoomTrace(rig, cam.rotateDurationSec * 2);
    expect(maxStepRatio([...orbit, ...settle], prev)).toBeLessThan(0.01);
    // Orbiting past an axis-aligned view never tightens the frame below the diagonal framing.
    for (const top of orbit) expect(top).toBeGreaterThanOrEqual(rest * 0.97);
  });

  it('rotates by exactly 90° with a smooth ease-in-out, clockwise = yaw decreasing', () => {
    const rig = new CameraRig(cam);
    const start = rig.yaw;
    rig.rotate(1);
    const samples: number[] = [];
    for (let i = 0; i < 60; i++) {
      rig.update(cam.rotateDurationSec / 60);
      samples.push(rig.yaw);
    }
    expect(rig.yaw).toBeCloseTo(start - Math.PI / 2, 6);
    for (let i = 1; i < samples.length; i++) expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-9);
    // Ease-in-out: slow start and end, fastest in the middle.
    const firstStep = start - samples[0];
    const midStep = samples[29] - samples[30];
    expect(midStep).toBeGreaterThan(firstStep * 5);
  });

  it('stays continuous when a rotation is requested mid-flight', () => {
    const rig = new CameraRig(cam);
    const start = rig.yaw;
    rig.rotate(-1);
    run(rig, cam.rotateDurationSec / 2);
    let prev = rig.yaw;
    rig.rotate(-1);
    let maxJump = 0;
    for (let i = 0; i < 120; i++) {
      rig.update(1 / 60);
      maxJump = Math.max(maxJump, Math.abs(rig.yaw - prev));
      prev = rig.yaw;
    }
    expect(rig.yaw).toBeCloseTo(start + Math.PI, 6);
    expect(maxJump).toBeLessThan(0.08);
  });

  it('drifts slowly in idle orbit and glides back to a canonical 45° + k·90° yaw', () => {
    const rig = new CameraRig(cam);
    rig.setIdleOrbit(true);
    run(rig, 20);
    const drifted = rig.yaw - cam.yawDeg * DEG;
    expect(drifted).toBeGreaterThan(0.1);
    expect(drifted).toBeLessThan(0.6);
    rig.setIdleOrbit(false);
    run(rig, cam.rotateDurationSec * 2);
    const steps = (rig.yaw - cam.yawDeg * DEG) / (Math.PI / 2);
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
  });
});
