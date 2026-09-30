import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { CameraRig, type FitBox, type ViewInsets } from './CameraRig';

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

/** Visible half height per frame while running (off-center frusta included). */
function zoomTraceOf(rig: CameraRig, seconds: number, fps = 60): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.round(seconds * fps); i++) {
    rig.update(1 / fps);
    out.push(halfHeight(rig));
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

/**
 * Every fit corner lands in the free area (the canvas minus the insets), inside its padding: the same bound as
 * expectContained, measured in that area. Returns the corners' pixel extents.
 */
function expectFramedIn(rig: CameraRig, boxes: readonly FitBox[], w: number, h: number, inset: ViewInsets) {
  const p = new Vector3();
  const freeW = w - inset.left - inset.right;
  const freeH = h - inset.top - inset.bottom;
  const px = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const b of boxes) {
    for (let i = 0; i < 8; i++) {
      p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).project(rig.camera);
      const x = ((p.x + 1) / 2) * w;
      const y = ((1 - p.y) / 2) * h;
      px.minX = Math.min(px.minX, x);
      px.maxX = Math.max(px.maxX, x);
      px.minY = Math.min(px.minY, y);
      px.maxY = Math.max(px.maxY, y);
      expect(Math.abs(((x - inset.left) / freeW) * 2 - 1)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
      expect(Math.abs(((y - inset.top) / freeH) * 2 - 1)).toBeLessThanOrEqual(1 / cam.padding + 1e-6);
    }
  }
  return px;
}

/** Visible half height of the frustum (the zoom of an orthographic camera, off-center or not). */
const halfHeight = (rig: CameraRig): number => (rig.camera.top - rig.camera.bottom) / 2;

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

  describe('overlay insets', () => {
    // The HUD pills and the two-row control hint at 1280×800 / 1920×1080 and on a 375 px phone; then side bands.
    const cases: [number, number, ViewInsets][] = [
      [1280, 800, { top: 72, right: 0, bottom: 123, left: 0 }],
      [1920, 1080, { top: 72, right: 0, bottom: 127, left: 0 }],
      [375, 812, { top: 54, right: 0, bottom: 179, left: 0 }],
      [1280, 800, { top: 40, right: 90, bottom: 0, left: 220 }],
    ];

    it('frames every fit corner in the canvas minus the insets, at any yaw, centred there', () => {
      for (const fit of [FIT, LONG]) {
        for (const [w, h, inset] of cases) {
          const rig = new CameraRig(cam);
          rig.setFitBoxes(fit);
          rig.setAspect(w, h);
          rig.setInsets(inset, true);
          rig.update(0);
          for (let k = 0; k < 4; k++) {
            const px = expectFramedIn(rig, fit, w, h, inset);
            // The level's center sits on the free area's center.
            expect((px.minX + px.maxX) / 2).toBeCloseTo(inset.left + (w - inset.left - inset.right) / 2, 6);
            expect((px.minY + px.maxY) / 2).toBeCloseTo(inset.top + (h - inset.top - inset.bottom) / 2, 6);
            rig.rotate(1);
            for (let i = 0; i < 60; i++) {
              rig.update(cam.rotateDurationSec / 60);
              expectFramedIn(rig, fit, w, h, inset);
            }
          }
        }
      }
    });

    it('leaves the framing exactly as it was with no insets', () => {
      const plain = new CameraRig(cam);
      const zero = new CameraRig(cam);
      for (const rig of [plain, zero]) {
        rig.setFitBoxes(FIT);
        rig.setAspect(1280, 800);
      }
      zero.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
      plain.update(0);
      zero.update(0);
      expect(zero.camera.projectionMatrix.equals(plain.camera.projectionMatrix)).toBe(true);
      expect(zero.camera.top).toBe(-zero.camera.bottom);
    });

    it('eases to new insets gently (no zoom jump), settles there, and snaps only when asked', () => {
      for (const [w, h, inset] of cases) {
        const rig = new CameraRig(cam);
        rig.setFitBoxes(FIT);
        rig.setAspect(w, h);
        rig.update(0);
        const start = halfHeight(rig);
        rig.setInsets(inset);
        const trace = zoomTraceOf(rig, 2);
        expect(maxStepRatio(trace, start)).toBeLessThan(0.012);
        // Zooming out only: no overshoot on the way.
        for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1] - 1e-9);
        run(rig, 2);
        const snapped = new CameraRig(cam);
        snapped.setFitBoxes(FIT);
        snapped.setAspect(w, h);
        snapped.setInsets(inset, true);
        snapped.update(0);
        expect(rig.camera.top).toBeCloseTo(snapped.camera.top, 4);
        expect(rig.camera.bottom).toBeCloseTo(snapped.camera.bottom, 4);
        expect(rig.camera.left).toBeCloseTo(snapped.camera.left, 4);
        expect(rig.camera.right).toBeCloseTo(snapped.camera.right, 4);
        expectFramedIn(rig, FIT, w, h, inset);
        // And back to none (the title), as gently.
        const back = halfHeight(rig);
        rig.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(maxStepRatio(zoomTraceOf(rig, 3), back)).toBeLessThan(0.012);
        expectContained(rig, FIT);
      }
    });

    it('turns (Q/E) and orbits exactly as a canvas the size of the free area would: no new zoom jumps', () => {
      for (const fit of [FIT, LONG]) {
        const inset = cases[0][2];
        const framed = new CameraRig(cam);
        framed.setAspect(1280, 800);
        framed.setInsets(inset, true);
        const free = new CameraRig(cam);
        free.setAspect(1280, 800 - inset.top - inset.bottom);
        const traces = [framed, free].map((rig) => {
          rig.setFitBoxes(fit);
          rig.update(0);
          const trace: number[] = [halfHeight(rig)];
          rig.rotate(1);
          trace.push(...zoomTraceOf(rig, cam.rotateDurationSec * 0.45));
          rig.rotate(1);
          trace.push(...zoomTraceOf(rig, cam.rotateDurationSec * 1.2));
          rig.setIdleOrbit(true);
          trace.push(...zoomTraceOf(rig, 60, 30));
          rig.setIdleOrbit(false);
          trace.push(...zoomTraceOf(rig, cam.rotateDurationSec * 2));
          return trace;
        });
        const scale = 800 / (800 - inset.top - inset.bottom);
        traces[0].forEach((v, i) => expect(v / traces[1][i]).toBeCloseTo(scale, 9));
        // As smooth as without insets (the chained test above; LONG's mid-flight re-turn steps ≈ 2.4 % either way).
        if (fit === FIT) expect(maxStepRatio(traces[0], traces[0][0])).toBeLessThan(0.02);
      }
    });

    it('never lets the overlays take more than half the canvas: they squeeze the level, never hide it', () => {
      const rig = new CameraRig(cam);
      rig.setFitBoxes(FIT);
      rig.setAspect(800, 400);
      rig.setInsets({ top: 150, right: 0, bottom: 250, left: 0 }, true);
      rig.update(0);
      // 400 px asked for of 400: scaled to 200 (75 + 125), the level framed in the 200 px between.
      expectFramedIn(rig, FIT, 800, 400, { top: 75, right: 0, bottom: 125, left: 0 });
    });
  });
});
