/**
 * Dev-only stand-in for GameState: starts from the real GameState's initial snapshot (stacked starts, recipe
 * zones) and scripts simple motion (the forklift drives in a circle) plus pick / drop with the same stack rules
 * (top box only, drops on stacks with room, zones derived from their recipe), so the render layer can be
 * inspected alone. Not part of the production build.
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
import { forkRiseRate } from '../src/logic/forkRise';
import { GameState } from '../src/logic/GameState';

const cfg = GAME_CONFIG.forklift;

/** The real starting snapshot (box stack levels, zone stack / satisfied / next), detached from its GameState. */
export function snapshotFromLevel(level: LevelData): GameSnapshot {
  return structuredClone(new GameState(level).getSnapshot());
}

export class PreviewSim {
  readonly snapshot: GameSnapshot;
  /** Drive in a circle (otherwise the forklift stays where it was put). */
  driving = true;
  private angle = 0;
  private t = 0;
  private readonly blocked = new Set<string>();
  private readonly stackLimit: number;

  constructor(readonly level: LevelData) {
    this.snapshot = snapshotFromLevel(level);
    this.stackLimit = level.stackLimit ?? 1;
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
    // Carriage height like GameState: toward the drop height while carrying, the target box's level while empty.
    const target = f.carrying
      ? s.hint.dropCell
        ? s.hint.dropLevel
        : 0
      : (s.boxes.find((b) => b.id === s.hint.targetBoxId)?.level ?? 0);
    f.forkHeight = approach(f.forkHeight, target, forkRiseRate(GAME_CONFIG, Math.max(f.forkHeight, target)) * dt);
    return [];
  }

  pick(): GameEvent[] {
    const s = this.snapshot;
    if (s.forklift.carrying) return [];
    const box = this.nearestBox(this.forkPoint(), 1.3);
    if (!box) return [{ type: 'actionIdle', carrying: false }];
    const fromZoneId = box.zoneId;
    const fromLevel = box.level;
    const { released, restored } = this.lift(box);
    box.carried = true;
    s.forklift.carrying = box.id;
    this.refreshProgress();
    const events: GameEvent[] = [{ type: 'boxPicked', boxId: box.id, fromZoneId, level: fromLevel }];
    if (released) events.push({ type: 'zoneReleased', zoneId: released.id, boxId: box.id });
    if (restored) {
      events.push({
        type: 'zoneRestored',
        zoneId: restored.id,
        boxId: box.id,
        recipeLength: restored.recipe.length,
        satisfiedCount: s.progress.satisfied,
        total: s.progress.total,
      });
    }
    return events;
  }

  /** Drop on the cell under the fork (or `cell` when given, e.g. to test a zone): on the floor or on a stack with room. */
  drop(cell?: CellPos): GameEvent[] {
    const s = this.snapshot;
    const box = s.boxes.find((b) => b.id === s.forklift.carrying);
    if (!box) return [];
    const target = cell ?? worldToCell(this.forkPoint(), this.level.size);
    const level = this.dropLevel(target);
    if (level < 0) return [{ type: 'actionIdle', carrying: true }];
    const zone = this.zoneAt(target);
    box.carried = false;
    box.cell = { ...target };
    box.level = level;
    const p = cellToWorld(target, this.level.size);
    box.pos.x = p.x;
    box.pos.z = p.z;
    box.zoneId = zone?.id ?? null;
    box.correct = false;
    let released = false;
    if (zone) {
      const was = zone.satisfied;
      zone.stack.push(box.id);
      this.refreshZone(zone);
      released = was && !zone.satisfied;
    }
    s.forklift.carrying = null;
    this.refreshProgress();
    const events: GameEvent[] = [
      {
        type: 'boxDropped',
        boxId: box.id,
        cell: { ...target },
        zoneId: box.zoneId,
        level,
        correct: zone !== null && zone.satisfied,
        recipeLength: zone ? zone.recipe.length : 0,
        satisfiedCount: s.progress.satisfied,
        total: s.progress.total,
      },
    ];
    if (released && zone) events.push({ type: 'zoneReleased', zoneId: zone.id, boxId: box.id });
    if (s.progress.satisfied === s.progress.total && !s.completed) {
      s.completed = true;
      events.push({ type: 'levelComplete' });
    }
    return events;
  }

  /**
   * Teleport free boxes onto a zone, one recipe step at a time, while it needs a color and a box of that color
   * sits on top of some stack (quick way to preview satisfied zones and stacks). A wrong stack is left alone.
   */
  solveZone(zoneId: string): GameEvent[] {
    const s = this.snapshot;
    const zone = s.zones.find((z) => z.id === zoneId);
    const events: GameEvent[] = [];
    if (!zone) return events;
    const was = s.forklift.carrying;
    while (zone.next !== null && this.dropLevel(zone.cell) >= 0) {
      const need = zone.next;
      const box = s.boxes.find((b) => b.color === need && !b.carried && !b.correct && this.isTop(b));
      if (!box) break;
      this.lift(box);
      box.carried = true;
      s.forklift.carrying = box.id;
      events.push(...this.drop(zone.cell));
    }
    s.forklift.carrying = was;
    return events;
  }

  /**
   * Take `box` (a stack top) off its cell and zone; returns the zone it stopped satisfying, or the zone that is
   * satisfied again because a wrong box came off its top (like GameState's zoneReleased / zoneRestored).
   */
  private lift(box: BoxState): { released: ZoneState | null; restored: ZoneState | null } {
    const zone = box.zoneId ? (this.snapshot.zones.find((z) => z.id === box.zoneId) ?? null) : null;
    let released: ZoneState | null = null;
    let restored: ZoneState | null = null;
    if (zone) {
      const was = zone.satisfied;
      zone.stack.pop();
      this.refreshZone(zone);
      if (was && !zone.satisfied) released = zone;
      else if (!was && zone.satisfied) restored = zone;
    }
    box.cell = null;
    box.level = 0;
    box.zoneId = null;
    box.correct = false;
    return { released, restored };
  }

  /** Same derivation as GameState: satisfied iff the stack equals the recipe, `next` while it is a correct prefix. */
  private refreshZone(zone: ZoneState): void {
    const boxes = this.snapshot.boxes;
    let prefix = true;
    zone.stack.forEach((id, i) => {
      const box = boxes.find((b) => b.id === id);
      prefix = prefix && box !== undefined && i < zone.recipe.length && zone.recipe[i] === box.color;
      if (box) box.correct = prefix;
    });
    const n = zone.stack.length;
    zone.occupiedBy = n > 0 ? zone.stack[n - 1] : null;
    zone.satisfied = prefix && n === zone.recipe.length;
    zone.next = prefix && n < zone.recipe.length ? zone.recipe[n] : null;
  }

  private forkPoint(): { x: number; z: number } {
    const f = this.snapshot.forklift;
    const fwd = forwardOf(f.heading);
    return { x: f.pos.x + fwd.x * cfg.forkReach, z: f.pos.z + fwd.z * cfg.forkReach };
  }

  /** Nearest box on top of its stack (only those can be picked). */
  private nearestBox(p: { x: number; z: number }, maxDist: number): BoxState | undefined {
    let best: BoxState | undefined;
    let bestD = maxDist;
    for (const b of this.snapshot.boxes) {
      if (!this.isTop(b)) continue;
      const d = Math.hypot(b.pos.x - p.x, b.pos.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private height(c: CellPos): number {
    let n = 0;
    for (const b of this.snapshot.boxes) if (!b.carried && b.cell && b.cell.x === c.x && b.cell.z === c.z) n++;
    return n;
  }

  private isTop(b: BoxState): boolean {
    return !b.carried && b.cell !== null && b.level === this.height(b.cell) - 1;
  }

  /** Height a box would land at on `c` (0 = floor), or -1 when the cell is blocked or its stack is full. */
  private dropLevel(c: CellPos): number {
    const { width, depth } = this.level.size;
    if (c.x < 0 || c.z < 0 || c.x >= width || c.z >= depth) return -1;
    if (this.blocked.has(cellKey(c))) return -1;
    const h = this.height(c);
    return h < this.stackLimit ? h : -1;
  }

  private zoneAt(c: CellPos): ZoneState | null {
    return this.snapshot.zones.find((z) => z.cell.x === c.x && z.cell.z === c.z) ?? null;
  }

  private updateHint(fork: { x: number; z: number }): void {
    const s = this.snapshot;
    s.hint.dropLevel = 0;
    if (s.forklift.carrying) {
      const cell = worldToCell(fork, this.level.size);
      const level = this.dropLevel(cell);
      s.hint.targetBoxId = null;
      s.hint.dropCell = level >= 0 ? cell : null;
      s.hint.dropZoneId = level >= 0 ? (this.zoneAt(cell)?.id ?? null) : null;
      s.hint.dropLevel = Math.max(0, level);
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
