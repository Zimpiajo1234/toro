/**
 * Dev-only stand-in for GameState: builds a GameSnapshot from level data and scripts simple motion
 * (the forklift drives in a circle) plus pick / drop, so the render layer can be inspected alone.
 * Not part of the production build.
 */
import { GAME_CONFIG } from '../src/config';
import { approach, degToRad } from '../src/core/math';
import {
  cellKey,
  cellToWorld,
  forwardOf,
  worldToCell,
  type BoxState,
  type CellPos,
  type GameEvent,
  type GameSnapshot,
  type LevelData,
  type ZoneState,
} from '../src/core/types';

const cfg = GAME_CONFIG.forklift;

export function snapshotFromLevel(level: LevelData): GameSnapshot {
  const zones: ZoneState[] = level.zones.map((z) => ({
    id: z.id,
    color: z.color,
    cell: { x: z.x, z: z.z },
    pos: cellToWorld(z, level.size),
    occupiedBy: null,
    satisfied: false,
  }));
  const boxes: BoxState[] = level.boxes.map((b) => {
    const zone = zones.find((z) => z.cell.x === b.x && z.cell.z === b.z) ?? null;
    const correct = zone !== null && zone.color === b.color;
    if (zone) {
      zone.occupiedBy = b.id;
      zone.satisfied = correct;
    }
    return {
      id: b.id,
      color: b.color,
      kind: b.kind ?? 'standard',
      pos: cellToWorld(b, level.size),
      cell: { x: b.x, z: b.z },
      carried: false,
      zoneId: zone?.id ?? null,
      correct,
    };
  });
  return {
    level,
    forklift: {
      pos: cellToWorld(level.forklift, level.size),
      heading: degToRad(level.forklift.heading),
      speed: 0,
      forkLift: 0,
      carrying: null,
      wheelSpin: 0,
      steer: 0,
    },
    boxes,
    zones,
    hint: { targetBoxId: null, dropCell: null, dropZoneId: null },
    completed: false,
    progress: { satisfied: zones.filter((z) => z.satisfied).length, total: zones.length },
  };
}

export class PreviewSim {
  readonly snapshot: GameSnapshot;
  /** Drive in a circle (otherwise the forklift stays where it was put). */
  driving = true;
  private angle = 0;
  private t = 0;
  private readonly blocked = new Set<string>();

  constructor(readonly level: LevelData) {
    this.snapshot = snapshotFromLevel(level);
    for (const s of level.shelves)
      for (let x = s.x; x < s.x + s.w; x++) for (let z = s.z; z < s.z + s.d; z++) this.blocked.add(cellKey({ x, z }));
    for (const p of level.decor.plants) this.blocked.add(cellKey(p));
  }

  /** Place the forklift (world units, heading in degrees) and stop driving. */
  setPose(x: number, z: number, headingDeg: number): void {
    const f = this.snapshot.forklift;
    f.pos.x = x;
    f.pos.z = z;
    f.heading = degToRad(headingDeg);
    f.speed = 0;
    f.steer = 0;
    this.driving = false;
  }

  update(dt: number): GameEvent[] {
    const s = this.snapshot;
    const f = s.forklift;
    this.t += dt;
    if (this.driving) {
      const { width, depth } = this.level.size;
      const radius = Math.max(1, Math.min(width, depth) / 2 - 1.1);
      const speed = 1.5 + 0.9 * Math.sin(this.t * 0.6);
      this.angle += (speed / radius) * dt;
      f.pos.x = Math.sin(this.angle) * radius;
      f.pos.z = Math.cos(this.angle) * radius;
      f.heading = this.angle + Math.PI / 2;
      f.speed = speed;
      f.steer = 0.55;
    } else {
      f.speed = approach(f.speed, 0, 8 * dt);
      f.steer = approach(f.steer, 0, 4 * dt);
    }
    f.wheelSpin += (f.speed * dt) / cfg.wheelRadius;
    f.forkLift = approach(f.forkLift, f.carrying ? 1 : 0, cfg.forkLiftSpeed * dt);

    const fork = this.forkPoint();
    const carried = f.carrying ? s.boxes.find((b) => b.id === f.carrying) : undefined;
    if (carried) {
      carried.pos.x = fork.x;
      carried.pos.z = fork.z;
    }
    this.updateHint(fork);
    return [];
  }

  pick(): GameEvent[] {
    const s = this.snapshot;
    if (s.forklift.carrying) return [];
    const fork = this.forkPoint();
    const box = this.nearestBox(fork, 1.3);
    if (!box) return [{ type: 'actionIdle', carrying: false }];
    const events: GameEvent[] = [];
    const zone = box.zoneId ? s.zones.find((z) => z.id === box.zoneId) : undefined;
    if (zone) {
      if (zone.satisfied) events.push({ type: 'zoneReleased', zoneId: zone.id, boxId: box.id });
      zone.occupiedBy = null;
      zone.satisfied = false;
    }
    box.carried = true;
    box.cell = null;
    box.zoneId = null;
    box.correct = false;
    s.forklift.carrying = box.id;
    this.refreshProgress();
    events.unshift({ type: 'boxPicked', boxId: box.id, fromZoneId: zone?.id ?? null });
    return events;
  }

  /** Drop on the cell under the fork (or `cell` when given, e.g. to test a zone). */
  drop(cell?: CellPos): GameEvent[] {
    const s = this.snapshot;
    const box = s.boxes.find((b) => b.id === s.forklift.carrying);
    if (!box) return [];
    const target = cell ?? worldToCell(this.forkPoint(), this.level.size);
    if (!this.isFree(target)) return [{ type: 'actionIdle', carrying: true }];
    const zone = s.zones.find((z) => z.cell.x === target.x && z.cell.z === target.z) ?? null;
    box.carried = false;
    box.cell = { ...target };
    const p = cellToWorld(target, this.level.size);
    box.pos.x = p.x;
    box.pos.z = p.z;
    box.zoneId = zone?.id ?? null;
    box.correct = zone !== null && zone.color === box.color;
    if (zone) {
      zone.occupiedBy = box.id;
      zone.satisfied = box.correct;
    }
    s.forklift.carrying = null;
    this.refreshProgress();
    const events: GameEvent[] = [
      {
        type: 'boxDropped',
        boxId: box.id,
        cell: { ...target },
        zoneId: zone?.id ?? null,
        correct: box.correct,
        satisfiedCount: s.progress.satisfied,
        total: s.progress.total,
      },
    ];
    if (s.progress.satisfied === s.progress.total && !s.completed) {
      s.completed = true;
      events.push({ type: 'levelComplete' });
    }
    return events;
  }

  /** Teleport the matching box of a zone onto it (quick way to preview satisfied zones). */
  solveZone(zoneId: string): GameEvent[] {
    const s = this.snapshot;
    const zone = s.zones.find((z) => z.id === zoneId);
    if (!zone || zone.satisfied) return [];
    const box = s.boxes.find((b) => b.color === zone.color && !b.correct && !b.carried);
    if (!box) return [];
    const was = s.forklift.carrying;
    s.forklift.carrying = box.id;
    box.carried = true;
    const events = this.drop(zone.cell);
    s.forklift.carrying = was === box.id ? null : was;
    return events;
  }

  private forkPoint(): { x: number; z: number } {
    const f = this.snapshot.forklift;
    const fwd = forwardOf(f.heading);
    return { x: f.pos.x + fwd.x * cfg.forkReach, z: f.pos.z + fwd.z * cfg.forkReach };
  }

  private nearestBox(p: { x: number; z: number }, maxDist: number): BoxState | undefined {
    let best: BoxState | undefined;
    let bestD = maxDist;
    for (const b of this.snapshot.boxes) {
      if (b.carried) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private isFree(c: CellPos): boolean {
    const { width, depth } = this.level.size;
    if (c.x < 0 || c.z < 0 || c.x >= width || c.z >= depth) return false;
    if (this.blocked.has(cellKey(c))) return false;
    return !this.snapshot.boxes.some((b) => !b.carried && b.cell && b.cell.x === c.x && b.cell.z === c.z);
  }

  private updateHint(fork: { x: number; z: number }): void {
    const s = this.snapshot;
    if (s.forklift.carrying) {
      const cell = worldToCell(fork, this.level.size);
      const free = this.isFree(cell);
      s.hint.targetBoxId = null;
      s.hint.dropCell = free ? cell : null;
      s.hint.dropZoneId = free ? (s.zones.find((z) => z.cell.x === cell.x && z.cell.z === cell.z)?.id ?? null) : null;
    } else {
      s.hint.targetBoxId = this.nearestBox(fork, 0.9)?.id ?? null;
      s.hint.dropCell = null;
      s.hint.dropZoneId = null;
    }
  }

  private refreshProgress(): void {
    const s = this.snapshot;
    s.progress.satisfied = s.zones.filter((z) => z.satisfied).length;
  }
}
