import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { TAU } from '../core/math';
import type { InputFrame, LevelData } from '../core/types';
import { BENCHMARK_ID, LEVELS, getSpecialLevel } from '../data/levels';
import { GameState } from '../logic/GameState';
import { defaultTheme } from '../themes/default';
import { CameraRig, FOLLOW_HEIGHT, type FitBox, type ViewInsets } from './CameraRig';
import { LevelView } from './LevelView';

const DEG = Math.PI / 180;
const cam = GAME_CONFIG.camera;

function box(min: [number, number, number], max: [number, number, number]): FitBox {
  return { min: new Vector3(...min), max: new Vector3(...max) };
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

/** Everything that places the picture: the projection, the camera's position and its orientation. */
const pose = (rig: CameraRig): number[] => [
  ...rig.camera.projectionMatrix.elements,
  ...rig.camera.position.toArray(),
  ...rig.camera.quaternion.toArray(),
];

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

    it('takes a level’s bands at once while playing (a new level, a resize): no ease left to run on its own', () => {
      for (const [w, h, inset] of cases) {
        const snapped = new CameraRig(cam);
        snapped.setFitBoxes(FIT);
        snapped.setAspect(w, h);
        snapped.setInsets(inset, true);
        snapped.update(0);
        const rig = new CameraRig(cam);
        rig.setFitBoxes(FIT);
        rig.setAspect(w, h);
        rig.update(0);
        rig.setInsets(inset);
        rig.update(1 / 60);
        expect(pose(rig)).toEqual(pose(snapped));
        for (let i = 0; i < 120; i++) {
          rig.update(1 / 60);
          expect(pose(rig)).toEqual(pose(snapped));
        }
      }
    });

    it('glides the bands in with the start of a level from the title, gently, and lands exactly with it', () => {
      for (const [w, h, inset] of cases) {
        const snapped = new CameraRig(cam);
        snapped.setFitBoxes(FIT);
        snapped.setAspect(w, h);
        snapped.setInsets(inset, true);
        snapped.update(0);
        // The title's orbit (no bands), stopped on a canonical yaw so only the bands move; the level's bands arrive
        // a frame into the glide out of it.
        const rig = new CameraRig(cam);
        rig.setFitBoxes(FIT);
        rig.setAspect(w, h);
        rig.setIdleOrbit(true);
        rig.update(0);
        rig.setIdleOrbit(false);
        rig.update(1 / 60);
        const start = halfHeight(rig);
        rig.setInsets(inset);
        const glide = cam.rotateDurationSec * 1.6;
        const trace = zoomTraceOf(rig, glide);
        // ≈ 0.5 % per frame at most (Title → play at 1280×800), zooming out only: no overshoot on the way.
        expect(maxStepRatio(trace, start)).toBeLessThan(0.012);
        for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1] - 1e-9);
        // It ends with the glide: then exactly the framing taken at once, and still.
        rig.update(1 / 60);
        expect(pose(rig)).toEqual(pose(snapped));
        run(rig, 1);
        expect(pose(rig)).toEqual(pose(snapped));
        expectFramedIn(rig, FIT, w, h, inset);

        // Back to the title: the orbit starts and the bands glide out as gently.
        const back = halfHeight(rig);
        rig.setIdleOrbit(true);
        rig.setInsets({ top: 0, right: 0, bottom: 0, left: 0 });
        expect(maxStepRatio(zoomTraceOf(rig, 3), back)).toBeLessThan(0.012);
        expectContained(rig, FIT);
      }
    });

    it('never moves for the bands in force reported again, mid-glide or at rest', () => {
      const [w, h, inset] = cases[0];
      const twice = new CameraRig(cam);
      const once = new CameraRig(cam);
      for (const rig of [twice, once]) {
        rig.setFitBoxes(FIT);
        rig.setAspect(w, h);
        rig.setIdleOrbit(true);
        rig.update(1 / 60);
        rig.setIdleOrbit(false);
        rig.setInsets(inset);
      }
      for (let i = 0; i < 180; i++) {
        if (i % 7 === 0) twice.setInsets({ ...inset });
        twice.update(1 / 60);
        once.update(1 / 60);
        expect(pose(twice)).toEqual(pose(once));
      }
      const rest = pose(twice);
      twice.setInsets({ ...inset }, true);
      twice.update(1 / 60);
      expect(pose(twice)).toEqual(rest);
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

  describe('player zoom', () => {
    const NONE: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 };
    const SIZES: [number, number, ViewInsets][] = [
      [1280, 800, NONE],
      [1280, 800, { top: 72, right: 0, bottom: 123, left: 0 }],
      [375, 812, { top: 54, right: 0, bottom: 179, left: 0 }],
      [1280, 800, { top: 40, right: 90, bottom: 0, left: 220 }],
    ];
    /** Where the forklift can stand on a floor `w`×`d` (its body radius in from the walls), plus the middle. */
    const spots = (w: number, d: number): [number, number][] => {
      const x = w / 2 - GAME_CONFIG.forklift.bodyRadius;
      const z = d / 2 - GAME_CONFIG.forklift.bodyRadius;
      return [[0, 0], [x, z], [-x, z], [x, -z], [-x, -z], [x, 0], [-x, 0], [0, z], [0, -z]];
    };
    const FLOORS: [readonly FitBox[], number, number][] = [
      [FIT, 14, 11],
      [LONG, 14, 5],
    ];

    function framedRig(fit: readonly FitBox[], w: number, h: number, inset: ViewInsets): CameraRig {
      const rig = new CameraRig(cam);
      rig.setFitBoxes(fit);
      rig.setAspect(w, h);
      rig.setInsets(inset, true);
      rig.update(0);
      return rig;
    }

    /** Zoom exactly to `zoom`, the view already on the followed point (no ease left). */
    function zoomedAt(rig: CameraRig, zoom: number, x: number, z: number): void {
      rig.resetZoom(true);
      rig.zoomBy(Math.log2(zoom));
      rig.settleZoom();
      rig.setFollow(x, z, true);
      rig.update(0);
    }

    /** A world point in the free area's own NDC: −1 … 1 spans the canvas minus the insets, y up. */
    function inFree(p: Vector3, rig: CameraRig, w: number, h: number, inset: ViewInsets): { x: number; y: number } {
      const q = p.clone().project(rig.camera);
      const px = ((q.x + 1) / 2) * w;
      const py = ((1 - q.y) / 2) * h;
      return {
        x: ((px - inset.left) / (w - inset.left - inset.right)) * 2 - 1,
        y: 1 - ((py - inset.top) / (h - inset.top - inset.bottom)) * 2,
      };
    }

    /**
     * The visible free area stays over the padded level: on each screen axis the padded level spans all of it, or (where
     * the level is the smaller) the level stays centred in it.
     */
    function expectOverLevel(rig: CameraRig, fit: readonly FitBox[], w: number, h: number, inset: ViewInsets): void {
      const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
      const p = new Vector3();
      for (const b of fit) {
        for (let i = 0; i < 8; i++) {
          p.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z);
          const q = inFree(p, rig, w, h, inset);
          e.minX = Math.min(e.minX, q.x);
          e.maxX = Math.max(e.maxX, q.x);
          e.minY = Math.min(e.minY, q.y);
          e.maxY = Math.max(e.maxY, q.y);
        }
      }
      for (const [min, max] of [[e.minX, e.maxX], [e.minY, e.maxY]]) {
        const mid = (min + max) / 2;
        const half = ((max - min) / 2) * cam.padding;
        if (half > 1) {
          expect(mid - half).toBeLessThanOrEqual(-1 + 1e-9);
          expect(mid + half).toBeGreaterThanOrEqual(1 - 1e-9);
        } else {
          expect(Math.abs(mid)).toBeLessThan(1e-9);
        }
      }
    }

    /** Everything the zoomed free area shows, the full view (`full`, same yaw, zoom 1) shows too. */
    function expectWithinFullView(rig: CameraRig, full: CameraRig, w: number, h: number, inset: ViewInsets): void {
      expect(rig.yaw).toBe(full.yaw);
      for (const [px, py] of [[inset.left, inset.top], [w - inset.right, inset.top], [inset.left, h - inset.bottom], [w - inset.right, h - inset.bottom]]) {
        const corner = new Vector3((px / w) * 2 - 1, 1 - (py / h) * 2, 0).unproject(rig.camera);
        const q = inFree(corner, full, w, h, inset);
        expect(Math.abs(q.x)).toBeLessThanOrEqual(1 + 1e-9);
        expect(Math.abs(q.y)).toBeLessThanOrEqual(1 + 1e-9);
      }
    }

    const forkliftAt = (x: number, z: number): Vector3 => new Vector3(x, FOLLOW_HEIGHT, z);
    /** The camera's position along its own screen-right axis (where the framing is, horizontally). */
    const viewX = (rig: CameraRig): number =>
      rig.camera.position.dot(new Vector3().setFromMatrixColumn(rig.camera.matrixWorld, 0));

    it('leaves the projection exactly as it always was at zoom 1, wherever the forklift is', () => {
      // Captured from the rig before the player zoom existed (FIT, 1280×800): at rest, with the HUD bands, mid-turn.
      const golden = [
        [-12.016692939567424, 12.016692939567424, 7.510433087229639, -7.510433087229639, 33.05160875976851, 37.64265608117602, 33.03660875976852],
        [-15.88984190356023, 15.88984190356023, 9.298040301380164, -10.56426207807012, 33.05160875976851, 37.64265608117602, 33.03660875976852],
        [-15.89778592997587, 15.89778592997587, 9.302688798087441, -10.569543614382393, -0.09999999999996591, 37.61954627633919, 46.74948212294662],
      ];
      const snap = (rig: CameraRig) => {
        const c = rig.camera;
        return [c.left, c.right, c.top, c.bottom, c.position.x, c.position.y, c.position.z];
      };
      const plain = framedRig(FIT, 1280, 800, NONE);
      plain.setFollow(6, -5, true);
      plain.update(0);
      expect(snap(plain)).toEqual(golden[0]);
      const banded = framedRig(FIT, 1280, 800, SIZES[1][2]);
      banded.setFollow(-6, 4, true);
      banded.update(0);
      expect(snap(banded)).toEqual(golden[1]);
      banded.rotate(1);
      for (let i = 0; i < 27; i++) {
        banded.setFollow(-6 + i * 0.04, 4);
        banded.update(1 / 60);
      }
      expect(snap(banded)).toEqual(golden[2]);
      expect(banded.zoom).toBe(1);

      // Zoomed in and back out, it lands exactly on the full view again.
      const back = framedRig(FIT, 1280, 800, NONE);
      back.setFollow(6, -5, true);
      back.zoomBy(cam.zoomStep * 3);
      run(back, 1);
      expect(back.zoom).toBeGreaterThan(1.3);
      back.zoomBy(-cam.zoomStep * 3);
      run(back, 3);
      expect(back.zoom).toBe(1);
      expect(snap(back)).toEqual(golden[0]);
      expect(back.camera.projectionMatrix.equals(plain.camera.projectionMatrix)).toBe(true);
    });

    it('eases a tap step gently and without overshoot, at 60 and 20 fps', () => {
      for (const fps of [60, 20]) {
        const rig = framedRig(FIT, 1280, 800, NONE);
        rig.zoomBy(cam.zoomStep);
        const goal = rig.zoomTarget;
        expect(goal).toBeCloseTo(Math.pow(2, cam.zoomStep), 12);
        const trace: number[] = [];
        for (let i = 0; i < 3 * fps; i++) {
          rig.update(1 / fps);
          trace.push(rig.zoom);
        }
        for (let i = 0; i < trace.length; i++) {
          expect(trace[i]).toBeLessThanOrEqual(goal);
          if (i > 0) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
        }
        // A soft start (a few % of the step on the first 60 fps frame), ≈ 95 % there after zoomEaseSec, then exact.
        if (fps === 60) expect(Math.log2(trace[0]) / cam.zoomStep).toBeLessThan(0.05);
        const at = Math.ceil(cam.zoomEaseSec * 1.05 * fps) - 1;
        expect(Math.log2(trace[at]) / cam.zoomStep).toBeGreaterThan(0.95);
        expect(trace[trace.length - 1]).toBe(goal);
      }
    });

    it('zooms continuously while held, never past the goal nor the limits, and follows a reversal calmly', () => {
      const rig = framedRig(FIT, 1280, 800, NONE);
      const trace: number[] = [];
      for (let i = 0; i < 30; i++) {
        rig.zoomTrack(cam.zoomRate / 60); // held for half a second
        rig.update(1 / 60);
        trace.push(rig.zoom);
      }
      const held = rig.zoomTarget;
      expect(held).toBeCloseTo(Math.pow(2, cam.zoomRate / 2), 9);
      for (let i = 0; i < 120; i++) {
        rig.update(1 / 60);
        trace.push(rig.zoom);
      }
      for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
      for (const z of trace) expect(z).toBeLessThanOrEqual(held);
      expect(trace[trace.length - 1]).toBe(held);
      expect(maxStepRatio(trace, 1)).toBeLessThan(0.02);

      // Far past the ceiling and the floor: the goal stops at the limits and the ease never passes them.
      rig.zoomBy(10);
      expect(rig.zoomTarget).toBeCloseTo(cam.zoomMax, 12);
      for (let i = 0; i < 180; i++) {
        rig.update(1 / 60);
        expect(rig.zoom).toBeLessThanOrEqual(cam.zoomMax);
      }
      expect(rig.zoom).toBeCloseTo(cam.zoomMax, 12);
      rig.zoomBy(-10);
      expect(rig.zoomTarget).toBe(1);
      for (let i = 0; i < 180; i++) {
        rig.update(1 / 60);
        expect(rig.zoom).toBeGreaterThanOrEqual(1);
      }
      expect(rig.zoom).toBe(1);

      // In, then out halfway there: it stays within the goals asked for and settles on the last one.
      rig.zoomBy(0.5);
      run(rig, 0.2);
      rig.zoomBy(-0.5);
      for (let i = 0; i < 180; i++) {
        rig.update(1 / 60);
        expect(rig.zoom).toBeGreaterThanOrEqual(1);
        expect(rig.zoom).toBeLessThanOrEqual(Math.pow(2, 0.5));
      }
      expect(rig.zoom).toBe(1);
    });

    /**
     * Input's frames for + held `seconds` at `fps`: the tap's step on the press, then the held rate every frame. Returns
     * the zoom shown (stops) frame by frame.
     */
    function hold(rig: CameraRig, dir: 1 | -1, seconds: number, fps: number): number[] {
      const out: number[] = [];
      rig.zoomBy(dir * cam.zoomStep);
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        rig.zoomTrack((dir * cam.zoomRate) / fps);
        rig.update(1 / fps);
        out.push(Math.log2(rig.zoom));
      }
      return out;
    }
    function coast(rig: CameraRig, seconds: number, fps: number): number[] {
      const out: number[] = [];
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        rig.update(1 / fps);
        out.push(Math.log2(rig.zoom));
      }
      return out;
    }

    it('stops with a held key: no more than a few hundredths of a stop after the release, at 60 and 20 fps', () => {
      for (const fps of [60, 20]) {
        const rig = framedRig(FIT, 1280, 800, NONE);
        const during = hold(rig, 1, 1, fps);
        const shown = during[during.length - 1];
        const after = coast(rig, 3, fps);
        const settled = after[after.length - 1];
        // It settles where the frames asked for (the tap's step plus a second of the rate), exactly and at rest…
        expect(settled).toBeCloseTo(cam.zoomStep + cam.zoomRate, 9);
        expect(rig.zoomTarget).toBe(rig.zoom);
        // …but that is barely past what was on screen at the release (it used to glide on ≈ 0.3 stops more).
        expect(settled - shown).toBeGreaterThanOrEqual(0);
        expect(settled - shown).toBeLessThan(0.06);
        const trace = [...during, ...after];
        for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1]);
      }
    });

    it('turns from what is on screen: a − tap right after holding +, or while a + step is still easing in', () => {
      for (const fps of [60, 20]) {
        // Hold + for 0.6 s, then tap −: it ends further out than the screen was at the tap, and never goes much closer.
        const held = framedRig(FIT, 1280, 800, NONE);
        const during = hold(held, 1, 0.6, fps);
        const atTap = during[during.length - 1];
        held.zoomBy(-cam.zoomStep);
        const after = coast(held, 3, fps);
        expect(Math.max(...after) - atTap).toBeLessThan(0.03);
        expect(after[after.length - 1]).toBeLessThan(atTap - cam.zoomStep * 0.75);

        // A big + step easing in (four quick taps), then a − tap: the step's rest is dropped, the − one taken from the
        // screen, and the ease turns without a jolt.
        const stepped = framedRig(FIT, 1280, 800, NONE);
        stepped.zoomBy(cam.zoomStep * 4);
        const easing = coast(stepped, 0.3, fps);
        const shown = easing[easing.length - 1];
        expect(shown).toBeLessThan(cam.zoomStep * 3);
        stepped.zoomBy(-cam.zoomStep);
        const back = coast(stepped, 3, fps);
        expect(back[back.length - 1]).toBeCloseTo(shown - cam.zoomStep, 9);
        expect(Math.max(...back) - shown).toBeLessThan(0.07);
        let turns = 0;
        const path = [...easing, ...back];
        for (let i = 2; i < path.length; i++) if ((path[i] - path[i - 1]) * (path[i - 1] - path[i - 2]) < 0) turns++;
        expect(turns).toBe(1);

        // Holding − right after holding +: it turns within a few hundredths of a stop too.
        const swap = framedRig(FIT, 1280, 800, NONE);
        const up = hold(swap, 1, 1, fps);
        const top = up[up.length - 1];
        const down = hold(swap, -1, 0.5, fps);
        expect(Math.max(...down) - top).toBeLessThan(0.06);
        expect(down[down.length - 1]).toBeLessThan(top - 0.4);
      }
    });

    it('holding on at a limit stores nothing: the way back starts at once', () => {
      const rig = framedRig(FIT, 1280, 800, NONE);
      hold(rig, 1, 3, 60);
      expect(rig.zoom).toBeCloseTo(cam.zoomMax, 9);
      expect(rig.zoomTarget).toBeCloseTo(cam.zoomMax, 9);
      for (let i = 0; i < 6; i++) {
        rig.zoomTrack(-cam.zoomRate / 60);
        rig.update(1 / 60);
      }
      expect(rig.zoom).toBeLessThan(cam.zoomMax * 0.99); // a tenth of a second of − already shows
      // A cut lands what is still pouring in; a reset drops it.
      rig.zoomTrack(-0.5);
      rig.settleZoom();
      const cut = rig.zoom;
      run(rig, 1);
      expect(rig.zoom).toBe(cut);
      rig.zoomTrack(0.5);
      rig.resetZoom(true);
      run(rig, 1);
      expect(rig.zoom).toBe(1);
    });

    it('keeps the zoomed view over the level at every yaw, zoom and forklift spot, with the HUD bands too', () => {
      for (const [fit, fw, fd] of FLOORS) {
        for (const [w, h, inset] of SIZES) {
          for (const zoom of [1, 1.25, 1.8, cam.zoomMax]) {
            for (const [x, z] of spots(fw, fd)) {
              const rig = framedRig(fit, w, h, inset);
              const full = framedRig(fit, w, h, inset);
              zoomedAt(rig, zoom, x, z);
              for (const dir of [1, 1, -1, 1, 1] as const) {
                // At rest: over the padded level. Mid-turn the full view itself is wider than the level (it never zooms
                // in during a turn): the zoomed view stays inside it.
                expectOverLevel(rig, fit, w, h, inset);
                expectWithinFullView(rig, full, w, h, inset);
                rig.rotate(dir);
                full.rotate(dir);
                for (let i = 0; i < 60; i++) {
                  rig.update(cam.rotateDurationSec / 60);
                  full.update(cam.rotateDurationSec / 60);
                  if (i % 6 === 0) expectWithinFullView(rig, full, w, h, inset);
                }
              }
            }
          }
        }
      }
    });

    it('keeps the forklift in view wherever it stands, at every yaw and zoom', () => {
      // At the full view a forklift in a far corner sits ≈ 0.81 of the way to the free area's edge; zooming keeps it there.
      for (const [fit, fw, fd] of FLOORS) {
        for (const [w, h, inset] of SIZES) {
          for (let zoom = 1; zoom <= cam.zoomMax + 1e-9; zoom += 0.1) {
            for (const [x, z] of spots(fw, fd)) {
              const rig = framedRig(fit, w, h, inset);
              zoomedAt(rig, zoom, x, z);
              for (let k = 0; k < 4; k++) {
                const q = inFree(forkliftAt(x, z), rig, w, h, inset);
                expect(Math.abs(q.x)).toBeLessThan(0.9);
                expect(Math.abs(q.y)).toBeLessThan(0.9);
                rig.rotate(1);
                run(rig, cam.rotateDurationSec + 0.05);
              }
            }
          }
        }
      }
    });

    it('frames the forklift in the middle at full zoom, and turns (Q/E) around it', () => {
      const at = forkliftAt(1.5, -1);
      for (const [w, h, inset] of SIZES) {
        const rig = framedRig(FIT, w, h, inset);
        zoomedAt(rig, cam.zoomMax, 1.5, -1);
        for (const dir of [1, 1, -1, 1] as const) {
          let q = inFree(at, rig, w, h, inset);
          expect(Math.abs(q.x)).toBeLessThan(1e-9);
          // On the phone the level is shorter than the zoomed view: it stays centred on that axis instead.
          if (w > h) expect(Math.abs(q.y)).toBeLessThan(1e-9);
          rig.rotate(dir);
          let prev = q;
          for (let i = 0; i < 60; i++) {
            rig.update(cam.rotateDurationSec / 60);
            // Where the level is the smaller (the phone's height), the view stays centred on it, so the forklift sways
            // there a little as the level turns, as smoothly as at zoom 1.
            q = inFree(at, rig, w, h, inset);
            expect(Math.abs(q.x)).toBeLessThan(0.15);
            expect(Math.abs(q.y)).toBeLessThan(0.15);
            expect(Math.hypot(q.x - prev.x, q.y - prev.y)).toBeLessThan(0.015);
            prev = q;
          }
        }
      }
    });

    it('follows a driving forklift smoothly at 20 fps: a steady trail, no back-and-forth, no overshoot', () => {
      for (const fps of [20, 60]) {
        const rig = framedRig(FIT, 1280, 800, NONE);
        zoomedAt(rig, cam.zoomMax, -3, 0);
        const v = GAME_CONFIG.forklift.maxSpeed;
        let x = -3;
        const trail: number[] = [];
        for (let i = 0; i < 2.5 * fps; i++) {
          x += v / fps;
          rig.setFollow(x, 0);
          rig.update(1 / fps);
          trail.push(inFree(forkliftAt(x, 0), rig, 1280, 800, NONE).x);
        }
        // The view trails a little behind (the forklift a bit ahead of the middle), growing steadily to a constant.
        for (let i = 1; i < trail.length; i++) expect(trail[i]).toBeGreaterThanOrEqual(trail[i - 1] - 1e-12);
        const steady = trail[trail.length - 1];
        expect(steady).toBeGreaterThan(0.05);
        expect(steady).toBeLessThan(0.35);
        expect(Math.abs(trail[trail.length - 1] - trail[trail.length - 2])).toBeLessThan(2e-3);
        // Stopped: the view catches up and settles on it without passing it.
        const settle: number[] = [];
        for (let i = 0; i < 3 * fps; i++) {
          rig.setFollow(x, 0);
          rig.update(1 / fps);
          settle.push(inFree(forkliftAt(x, 0), rig, 1280, 800, NONE).x);
        }
        for (let i = 0; i < settle.length; i++) {
          expect(settle[i]).toBeGreaterThanOrEqual(-1e-9);
          if (i > 0) expect(settle[i]).toBeLessThanOrEqual(settle[i - 1] + 1e-12);
        }
        expect(Math.abs(settle[settle.length - 1])).toBeLessThan(1e-3);
      }
    });

    it('brakes smoothly at the level edge instead of stopping dead', () => {
      const rig = framedRig(FIT, 1280, 800, NONE);
      zoomedAt(rig, cam.zoomMax, 0, 0);
      // Toward the floor's east corner, straight along the screen's horizontal at yaw 45°: past where the view stops.
      const tx = 6.5;
      const tz = -5;
      const len = Math.hypot(tx, tz);
      const steps: number[] = [];
      let prev = viewX(rig);
      for (let i = 0; i < 6 * 60; i++) {
        const s = Math.min(len, ((i + 1) / 60) * GAME_CONFIG.forklift.maxSpeed);
        rig.setFollow((tx * s) / len, (tz * s) / len);
        rig.update(1 / 60);
        const now = viewX(rig);
        steps.push(now - prev);
        prev = now;
      }
      const top = Math.max(...steps);
      expect(steps[steps.length - 1]).toBeLessThan(top * 0.01); // it did stop at the edge
      for (let i = 1; i < steps.length; i++) expect(Math.abs(steps[i] - steps[i - 1])).toBeLessThan(top * 0.1);
      expectOverLevel(rig, FIT, 1280, 800, NONE);
    });

    it('resets to the full view: eased, or at once; the idle orbit is always unzoomed', () => {
      const plain = framedRig(FIT, 1280, 800, NONE);
      const eased = framedRig(FIT, 1280, 800, NONE);
      zoomedAt(eased, 2, 4, 3);
      eased.resetZoom();
      expect(eased.zoomTarget).toBe(1);
      const zoomed = halfHeight(eased);
      const trace = zoomTraceOf(eased, 4);
      for (let i = 1; i < trace.length; i++) expect(trace[i]).toBeGreaterThanOrEqual(trace[i - 1] - 1e-12);
      expect(maxStepRatio(trace, zoomed)).toBeLessThan(0.02);
      expect(eased.zoom).toBe(1);
      expect(eased.camera.projectionMatrix.equals(plain.camera.projectionMatrix)).toBe(true);
      expect(eased.camera.position.equals(plain.camera.position)).toBe(true);

      const cut = framedRig(FIT, 1280, 800, NONE);
      zoomedAt(cut, cam.zoomMax, -4, 2);
      cut.resetZoom(true);
      cut.update(0);
      expect(cut.zoom).toBe(1);
      expect(cut.camera.projectionMatrix.equals(plain.camera.projectionMatrix)).toBe(true);
      expect(cut.camera.position.equals(plain.camera.position)).toBe(true);

      // A cut that keeps the zoom (a restart) lands on its goal at once.
      cut.zoomBy(1);
      cut.settleZoom();
      expect(cut.zoom).toBe(2);

      // The title: the orbit eases the zoom out (as calmly from all the way in) and ignores zoom requests; after it,
      // zooming works again.
      const title = framedRig(FIT, 1280, 800, NONE);
      zoomedAt(title, cam.zoomMax, 4, 3);
      const zoomedHalf = halfHeight(title);
      title.setIdleOrbit(true);
      expect(title.zoomTarget).toBe(1);
      title.zoomBy(1);
      title.zoomTrack(1);
      expect(title.zoomTarget).toBe(1);
      expect(maxStepRatio(zoomTraceOf(title, 4), zoomedHalf)).toBeLessThan(0.02);
      expect(title.zoom).toBe(1);
      title.setIdleOrbit(false);
      title.zoomBy(1);
      expect(title.zoomTarget).toBe(2);
    });
  });

  describe('never moves on its own', () => {
    /** The HUD pills and the one-row control hint at 1280×800. */
    const BANDS: ViewInsets = { top: 72, right: 0, bottom: 83, left: 0 };
    const IDLE: InputFrame = { move: { x: 0, z: 0 }, actionPressed: false };
    const driving = (steer: number): InputFrame => ({ move: { x: 0, z: 0 }, drive: { throttle: 1, steer }, actionPressed: false });
    /** Frames (at 60 fps) until a Q/E turn has ended, counted as the rig counts them. */
    const TURN_FRAMES = (() => {
      let t = 0;
      let n = 0;
      while (t < 1) {
        t = Math.min(1, t + 1 / 60 / cam.rotateDurationSec);
        n++;
      }
      return n;
    })();
    const SCREENS = [...LEVELS, getSpecialLevel(BENCHMARK_ID)!];

    /** A level as the game runs it, frame by frame: the simulation, the rig on the forklift, the view at the rig's yaw. */
    function playing(level: LevelData) {
      const state = new GameState(level);
      const rig = new CameraRig(cam);
      rig.setAspect(1280, 800);
      rig.setInsets(BANDS, true);
      const view = new LevelView(state.getSnapshot(), defaultTheme, GAME_CONFIG, rig.yaw);
      rig.setFitBoxes(view.fitBoxes);
      const start = state.getSnapshot().forklift.pos;
      rig.setFollow(start.x, start.z, true);
      rig.update(0);
      let time = 0;
      const frame = (input: InputFrame = IDLE): void => {
        state.update(1 / 60, input);
        const snap = state.getSnapshot();
        rig.setFollow(snap.forklift.pos.x, snap.forklift.pos.z);
        rig.update(1 / 60);
        time += 1 / 60;
        view.update(snap, 1 / 60, time, rig.yaw, 0);
      };
      /** The height scale of every group of the scene: the walls' sink shows here. */
      const scales = (): number[] => view.root.children.map((c) => c.scale.y);
      return { state, rig, view, frame, scales };
    }

    /** Frames of `run` (1-based) whose pose differs from the one before. */
    function changedFrames(rig: CameraRig, frames: number, frame: (i: number) => void = () => rig.update(1 / 60)): number[] {
      const out: number[] = [];
      let prev = pose(rig);
      for (let i = 1; i <= frames; i++) {
        frame(i);
        const now = pose(rig);
        if (now.some((v, k) => !Object.is(v, prev[k]))) out.push(i);
        prev = now;
      }
      return out;
    }

    it('stays bit-identical at rest while the walls finish sinking or rising, zoomed or not, bands reported again', () => {
      for (const level of SCREENS) {
        for (const zoom of [1, cam.zoomMax]) {
          const { rig, view, frame, scales } = playing(level);
          if (zoom > 1) {
            rig.zoomBy(Math.log2(zoom));
            rig.settleZoom();
          }
          // Round all four quarters and back: every turn sinks or raises one wall (a dock wall on the Benchmark).
          for (const dir of [1, 1, -1, -1, -1, 1] as const) {
            const label = `${level.id} ×${zoom} turn ${dir}`;
            rig.rotate(dir);
            for (let i = 0; i < TURN_FRAMES; i++) frame();
            const rest = pose(rig);
            let sinking = false;
            for (let i = 0; i < 90; i++) {
              const before = scales();
              rig.setInsets({ ...BANDS }); // the bands in force, reported again
              frame();
              sinking ||= scales().some((s, k) => s !== before[k]);
              expect(pose(rig), label).toEqual(rest);
            }
            expect(sinking, label).toBe(true);
          }
          view.dispose();
        }
      }
    });

    it('never follows the forklift at the full view: driving around moves nothing', () => {
      for (const level of SCREENS) {
        const { rig, state, view, frame } = playing(level);
        const from = { ...state.getSnapshot().forklift.pos };
        expect(changedFrames(rig, 150, (i) => frame(driving(i < 75 ? 0.5 : -0.5)))).toEqual([]);
        const to = state.getSnapshot().forklift.pos;
        expect(Math.hypot(to.x - from.x, to.z - from.z), level.id).toBeGreaterThan(0.5);
        view.dispose();
      }
    });

    it('zoomed in, follows the forklift every frame it drives, then lands exactly on it and stays still', () => {
      for (const level of SCREENS) {
        const { rig, view, frame } = playing(level);
        rig.zoomBy(Math.log2(cam.zoomMax));
        rig.settleZoom();
        rig.update(0);
        expect(changedFrames(rig, 90, () => frame(driving(0.4)))).toHaveLength(90);
        // Let go: the forklift coasts to a halt and the view glides onto it, then rests exactly (no endless tail).
        const after = changedFrames(rig, 6 * 60, () => frame());
        expect(after.length, level.id).toBeGreaterThan(20);
        expect(after[after.length - 1], level.id).toBeLessThan(4 * 60);
        view.dispose();
      }
    });

    it('moves for input only: a resize, a Q/E turn and a zoom step change it, smoothly, and it is exactly still after', () => {
      const rig = new CameraRig(cam);
      rig.setFitBoxes(FIT);
      rig.setAspect(1280, 800);
      rig.setInsets(BANDS, true);
      rig.update(0);
      expect(changedFrames(rig, 60)).toEqual([]);
      // A resize: the canvas itself changed, so at once; then still.
      rig.setAspect(1600, 900);
      rig.setInsets({ top: 72, right: 0, bottom: 90, left: 0 });
      expect(changedFrames(rig, 60)).toEqual([1]);
      // A turn: every frame of it, gently, then still.
      const start = halfHeight(rig);
      rig.rotate(1);
      const heights: number[] = [];
      const turn = changedFrames(rig, TURN_FRAMES + 60, () => {
        rig.update(1 / 60);
        heights.push(halfHeight(rig));
      });
      // (Its last frame may already sit on the goal: the ease rounds onto it.)
      expect(turn.length).toBeGreaterThanOrEqual(TURN_FRAMES - 1);
      expect(turn.length).toBe(turn[turn.length - 1]);
      expect(turn[turn.length - 1]).toBeLessThanOrEqual(TURN_FRAMES);
      expect(maxStepRatio(heights, start)).toBeLessThan(0.02);
      // A zoom step: it eases in over ≈ zoomEaseSec and lands exactly, then still.
      rig.zoomBy(cam.zoomStep);
      const zoomed = changedFrames(rig, 4 * 60);
      expect(zoomed[0]).toBe(1);
      expect(zoomed.length).toBe(zoomed[zoomed.length - 1]);
      expect(zoomed.length).toBeLessThan(2.5 * 60);
      expect(rig.zoom).toBe(rig.zoomTarget);
    });

    it('in long sessions sheds whole turns off the yaw as a turn starts, never at rest', () => {
      const rig = new CameraRig(cam);
      rig.setFitBoxes(FIT);
      rig.setAspect(1280, 800);
      rig.update(0);
      for (let k = 0; k < 40; k++) {
        rig.rotate(-1);
        const turn = changedFrames(rig, TURN_FRAMES + 30);
        expect(turn[turn.length - 1]).toBeLessThanOrEqual(TURN_FRAMES);
        expect(Math.abs(rig.yaw)).toBeLessThan(TAU * 4 + Math.PI);
      }
      // Ten whole turns later it frames exactly as at the start (up to the last bits of the angle).
      const fresh = new CameraRig(cam);
      fresh.setFitBoxes(FIT);
      fresh.setAspect(1280, 800);
      fresh.update(0);
      pose(rig).forEach((v, i) => expect(v).toBeCloseTo(pose(fresh)[i], 9));
    });
  });
});
