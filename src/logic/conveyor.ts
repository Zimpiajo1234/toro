import { beltPathOf, conveyorsOf } from '../core/conveyors';
import { cellToWorld, type BoxState, type ConveyorState, type LevelData } from '../core/types';
import type { LevelGrid } from './grid';

/**
 * The belt's feel (docs/CONVEYOR.md «Ajustes»), safe to tune: calm like the forklift, a soft start and a soft stop.
 * A run takes length / speed + rampSec seconds (a 3-cell path: ≈ 3.9 s).
 */
export const CONVEYOR = {
  /** Seconds a box set down on a belt's input rests there before the belt starts: its drop glide lands first. */
  settleSec: 0.5,
  /** Cruise speed of the belt's surface, and of the box riding it (cells / s). */
  speed: 0.9,
  /** Seconds the belt takes to reach its cruise speed, and to come to rest at the end exit (sine-eased both ways). */
  rampSec: 0.6,
} as const;

/** What GameState does when a belt starts or a box reaches an end exit (it owns the slots, the events, completion). */
export interface ConveyorHost {
  /** Belt `belt` starts carrying its box (it has settled on the input). */
  started(belt: number): void;
  /** Belt `belt`'s box (`box`, index in the snapshot's boxes) has reached the centre of its end exit: move it in there. */
  arrived(belt: number, box: number): void;
}

/** One belt as the logic keeps it; its public part is `state` (GameSnapshot.conveyors). */
interface Belt {
  readonly state: ConveyorState;
  /** Its input's and end exit's storage columns (LevelGrid.columns) and their one slot (flat index). */
  readonly input: number;
  readonly output: number;
  readonly inputSlot: number;
  readonly outputSlot: number;
  /** World x, z of each point of its path: the input's centre, every belt cell's centre, the end exit's centre. */
  readonly path: Float64Array;
  /** Length of the path (cells). */
  readonly length: number;
  /** Peak speed of a run (CONVEYOR.speed, lower only on a path too short to reach it) and the run's cruise time (s). */
  readonly peak: number;
  readonly cruise: number;
  /** Seconds a whole run takes. */
  readonly runSec: number;
  /** The box settling or riding on it (index in the snapshot's boxes), -1 = none. */
  box: number;
  /** Seconds into the current phase. */
  elapsed: number;
  /** Distance covered in the current run (cells). */
  covered: number;
}

/**
 * Conveyor belts (docs/CONVEYOR.md), the logic: one per level.conveyors entry. A box set down on a belt's input (its
 * slot on the belt's table, at the belt's height) rests there a moment (`settleSec`, the belt `settling`), then the
 * belt runs and carries it along its cells (`running`, level all the way: `box.pos` only), and it comes to rest in the
 * end exit's slot, at the belt's height there, where GameState places it (ConveyorHost.arrived). One box at a time:
 * while a box settles or rides, the input holds it in its slot, sealed (no other box goes in, and it is never picked
 * up; the end exit stays free for it, since only its belt ever fills it). GameState asks before loading: with the end
 * exit full the box simply stays on the input (pickable again) and the belt never starts.
 * Deterministic: a run's position is a closed-form function of the time since it started (sine-eased ramps, a cruise),
 * so 60 and 20 fps go through the same states, the arrival differing by less than a frame. Allocates nothing per frame.
 */
export class ConveyorSystem {
  /** Every belt's live state, in level.conveyors order (GameSnapshot.conveyors). */
  readonly states: ConveyorState[] = [];
  private readonly belts: Belt[] = [];

  constructor(level: LevelData, grid: LevelGrid) {
    const columnOf = (unitId: string) => grid.columns.findIndex((c) => c.unitId === unitId);
    for (const conveyor of conveyorsOf(level)) {
      const input = columnOf(conveyor.input);
      const output = columnOf(conveyor.output);
      const cells = beltPathOf(level, conveyor);
      const path = new Float64Array(cells.length * 2);
      cells.forEach((cell, i) => {
        const p = cellToWorld(cell, level.size);
        path[2 * i] = p.x;
        path[2 * i + 1] = p.z;
      });
      let length = 0;
      for (let i = 1; i < cells.length; i++) length += Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1]);
      const ramp = CONVEYOR.rampSec;
      // A run: sine-eased up to its peak speed over rampSec (covering peak · ramp / 2), a cruise, and the same ease down.
      const peak = ramp > 0 ? Math.min(CONVEYOR.speed, length / ramp) : CONVEYOR.speed;
      const cruise = Math.max(0, length / peak - ramp);
      const state: ConveyorState = { id: conveyor.id, phase: 'idle', boxId: null, progress: 0, running: false, travel: 0 };
      this.states.push(state);
      this.belts.push({
        state,
        input,
        output,
        inputSlot: grid.columns[input].firstSlot,
        outputSlot: grid.columns[output].firstSlot,
        path,
        length,
        peak,
        cruise,
        runSec: cruise + 2 * ramp,
        box: -1,
        elapsed: 0,
        covered: 0,
      });
    }
  }

  /** Number of belts in the level. */
  get count(): number {
    return this.belts.length;
  }

  /** The belt whose input is storage column `column` (LevelGrid.columns), or -1. */
  atInput(column: number): number {
    for (let b = 0; b < this.belts.length; b++) if (this.belts[b].input === column) return b;
    return -1;
  }

  /** Its input's and end exit's storage columns, and their slots (flat index). */
  inputOf(belt: number): number {
    return this.belts[belt].input;
  }

  outputOf(belt: number): number {
    return this.belts[belt].output;
  }

  inputSlotOf(belt: number): number {
    return this.belts[belt].inputSlot;
  }

  outputSlotOf(belt: number): number {
    return this.belts[belt].outputSlot;
  }

  /** The box settling or riding on belt `belt` (index in the snapshot's boxes), -1 = none. */
  boxOn(belt: number): number {
    return this.belts[belt].box;
  }

  /** Seconds a run of belt `belt` takes. */
  runSecOf(belt: number): number {
    return this.belts[belt].runSec;
  }

  /**
   * Box `box` (index in the snapshot's boxes, id `boxId`) was just set down on belt `belt`'s input, its end exit free:
   * it settles there, then rides (it is on its way from now on: the input holds it sealed).
   */
  load(belt: number, box: number, boxId: string): void {
    const b = this.belts[belt];
    b.box = box;
    b.elapsed = 0;
    b.covered = 0;
    b.state.phase = 'settling';
    b.state.boxId = boxId;
    b.state.progress = 0;
    b.state.running = false;
  }

  /**
   * Advance every belt by `dt` s: a settled box starts riding (host.started), a riding one moves along the path (its
   * `pos` written into `boxes`), and one that reaches the end exit's centre is handed over (host.arrived), the belt then
   * idle again.
   */
  update(dt: number, boxes: BoxState[], host: ConveyorHost): void {
    if (!(dt > 0)) return;
    for (let i = 0; i < this.belts.length; i++) {
      const b = this.belts[i];
      if (b.box < 0) continue;
      const s = b.state;
      b.elapsed += dt;
      if (s.phase === 'settling') {
        if (b.elapsed < CONVEYOR.settleSec) continue;
        // The run starts within this frame: carry the rest of it over, so every frame rate rides the same curve.
        b.elapsed -= CONVEYOR.settleSec;
        s.phase = 'running';
        s.running = true;
        host.started(i);
      }
      const covered = b.elapsed >= b.runSec ? b.length : this.coveredAt(b, b.elapsed);
      s.travel += covered - b.covered;
      b.covered = covered;
      s.progress = b.length > 0 ? covered / b.length : 1;
      this.place(b, covered, boxes[b.box]);
      if (b.elapsed < b.runSec) continue;
      const box = b.box;
      s.phase = 'idle';
      s.running = false;
      s.progress = 0;
      s.boxId = null;
      b.box = -1;
      host.arrived(i, box);
    }
  }

  /** Distance covered `t` s into a run of belt `b`: sine-eased up to its peak, a cruise, sine-eased down to rest. */
  private coveredAt(b: Belt, t: number): number {
    const ramp = CONVEYOR.rampSec;
    if (t <= 0) return 0;
    if (t < ramp) return rampDistance(b.peak, ramp, t);
    if (t < ramp + b.cruise) return (b.peak * ramp) / 2 + b.peak * (t - ramp);
    return Math.min(b.length, b.length - rampDistance(b.peak, ramp, Math.max(0, b.runSec - t)));
  }

  /** The point `covered` cells along belt `b`'s path, written into the riding box's position. */
  private place(b: Belt, covered: number, box: BoxState): void {
    const p = b.path;
    let left = covered;
    const last = p.length / 2 - 1;
    for (let i = 0; i < last; i++) {
      const dx = p[2 * i + 2] - p[2 * i];
      const dz = p[2 * i + 3] - p[2 * i + 1];
      const segment = Math.hypot(dx, dz);
      if (left <= segment || i === last - 1) {
        const k = segment > 0 ? Math.min(1, left / segment) : 1;
        box.pos.x = p[2 * i] + dx * k;
        box.pos.z = p[2 * i + 1] + dz * k;
        return;
      }
      left -= segment;
    }
  }
}

/**
 * Distance covered `u` s into a sine-eased start up to speed `peak` over `ramp` s (speed = peak · (1 − cos(π u / ramp))
 * / 2): no jolt at either end of the ramp; the whole ramp covers peak · ramp / 2.
 */
function rampDistance(peak: number, ramp: number, u: number): number {
  if (!(ramp > 0)) return peak * u;
  return (peak / 2) * (u - (ramp / Math.PI) * Math.sin((Math.PI * u) / ramp));
}
