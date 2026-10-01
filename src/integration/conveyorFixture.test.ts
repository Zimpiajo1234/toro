/**
 * The conveyor belt fixture (src/data/levels/pruebas/cinta.level, docs/CONVEYOR.md «Nivel de prueba»): a test-only
 * level that neither the registry nor `npm run levels` reads. A belt of two floor cells, a table at level 1 (H1b) on a
 * closed base (H1c), runs north from its input A to its end exit B, between two potted plants: the forklift can only
 * send a box there along the belt. It must stay canonical and valid, with one complete assignment and no dead ends,
 * exactly solvable (3 moves: the ride counts none) and played to the end by the autopilot (./autopilot.ts) with the
 * real controls at 60 fps and at Game's worst dt (1/20), raising the forks with F at A as at a rack's level-1 slot
 * (outside it), backing out after the drop and only then lowering them with V; and the render builds the belt's table
 * on its closed near-black base, its band (whose white stripes slide only while it runs), A's pad with its drop icon,
 * its black side guards and the loading line in front of it, and B's deck with its cue painted flat and its low
 * skirting in the belt's colour.
 */
import { Box3, Color, Mesh, Vector3, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { beltPathOf, conveyorsOf } from '../core/conveyors';
import { assignmentsOf, sortableOf, targetsOf } from '../core/sorting';
import { storageOf, storageSlotsOf } from '../core/storage';
import { TINES, type GameEvent, type InputFrame } from '../core/types';
import { formatLevel, parseLevel, renderLevel } from '../data/asciiLevel';
import { formatRange, formatTarget } from '../data/difficulty';
import { LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } from '../data/levels';
import { DEAD_END_STATES, checkLevelTargets, levelMetrics } from '../data/levels/metrics';
import { LevelGrid, deadEnds, minMoves, replayMoves } from '../data/levels/solver';
import { validateLevel } from '../data/validateLevel';
import { CONVEYOR } from '../logic/conveyor';
import { GameState } from '../logic/GameState';
import { BELT, BELT_CUE, BELT_SKIRTING } from '../render/builders/conveyor';
import { boxDims, rackSlotY } from '../render/dims';
import { LevelView } from '../render/LevelView';
import { STORAGE_RENDER } from '../render/storage';
import { defaultTheme } from '../themes/default';
import { autopilot } from './autopilot';
import text from '../data/levels/pruebas/cinta.level?raw';

const FILE = 'src/data/levels/pruebas/cinta.level';
const parsed = parseLevel(text, FILE);
const { level } = parsed;
const grid = new LevelGrid(level);
const plantAt = (x: number, z: number) => level.decor.plants.some((p) => p.x === x && p.z === z);

type Dropped = Extract<GameEvent, { type: 'boxDropped' }>;
const drops = (events: readonly GameEvent[]) => events.filter((e): e is Dropped => e.type === 'boxDropped');

describe('the conveyor belt fixture (pruebas/cinta.level)', () => {
  it('is canonical (as levels:fmt writes it), validates and round-trips; the registry and npm run levels never see it', () => {
    expect(formatLevel(text, FILE)).toBe(text);
    expect(renderLevel(level, parsed)).toBe(text);
    expect(validateLevel(structuredClone(level), level.id)).toStrictEqual(level);
    for (const sources of [LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES]) expect(sources.some((s) => s.file.includes('/pruebas/') || s.level.id === level.id)).toBe(false);
    expect(parsed.notes.join('\n')).toMatch(/conveyorFixture\.test\.ts/);
  });

  it('one belt: input A (3,3), two floor cells north, end exit B (3,0) between two plants, all on a table at level 1; A loaded from its front, free floor', () => {
    const [belt, ...more] = conveyorsOf(level);
    expect(more).toEqual([]);
    expect(belt).toEqual({
      id: 'c1',
      input: 'e1',
      output: 's1',
      cells: [
        { x: 3, z: 2, piece: 'suelo', height: 1 },
        { x: 3, z: 1, piece: 'suelo', height: 1 },
      ],
    });
    // Both ends on the table: their one slot at level 1.
    expect(storageOf(level)).toEqual([
      { id: 'e1', skin: 'beltIn', x: 3, z: 3, w: 1, access: { kind: 'front', facing: 'south' }, columns: [[null]], baseLevel: 1 },
      { id: 's1', skin: 'beltOut', x: 3, z: 0, w: 1, access: { kind: 'belt', facing: 'south' }, columns: [[{ color: 'blue' }]], baseLevel: 1 },
    ]);
    expect(storageSlotsOf(level).map((s) => [s.id, s.level])).toEqual([
      ['e1:0:1', 1],
      ['s1:0:1', 1],
    ]);
    expect(beltPathOf(level, belt).map((c) => [c.x, c.z])).toEqual([
      [3, 3],
      [3, 2],
      [3, 1],
      [3, 0],
    ]);
    // The forklift can reach B from nowhere: a plant each side, the belt in front, the wall behind.
    expect([plantAt(2, 0), plantAt(4, 0)]).toEqual([true, true]);
    // A's front and the cell behind it: free floor, no zone (the model loads it by one step from behind).
    for (const c of [
      { x: 3, z: 4 },
      { x: 3, z: 5 },
    ]) {
      expect(grid.solid[grid.index(c.x, c.z)]).toBe(0);
      expect(level.zones.some((z) => z.x === c.x && z.z === c.z)).toBe(false);
    }
    // The belt's cells, A and B are obstacles of the model.
    for (const [x, z] of [
      [3, 0],
      [3, 1],
      [3, 2],
      [3, 3],
    ])
      expect(grid.solid[grid.index(x, z)], `${x},${z}`).toBe(1);
  });

  it('has exactly one complete assignment (the end exit is a target, the input never), and its «dificultad:» targets hold', () => {
    const targets = targetsOf(level);
    expect(targets.map((t) => t.skin ?? t.kind)).toEqual(['zone', 'zone', 'beltOut']);
    expect(assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria), 2).count).toBe(1);
    const m = levelMetrics(level, { skipMoves: true });
    expect(m.sortings).toBe(1);
    expect(m.belts).toEqual({ belts: 1, cells: 2, floor: 2, exits: 1, cued: 1 });
    expect(parsed.targets.map((t) => t.metric)).toEqual(['movimientos', 'repartos', 'cinta']);
    const failed = checkLevelTargets(level, parsed.targets).filter((c) => !c.ok);
    expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`)).toEqual([]);
  });

  it('the exact solver: 3 moves, one per box; blue ● goes to B in one move, through A; nothing is ever lifted from B', () => {
    const result = minMoves(level);
    expect(result).toMatchObject({ lower: 3, upper: 3, exact: true, unsolvable: false });
    expect(replayMoves(level, result.plan!)).toBe(true);
    const exit = grid.positionOfSlot('s1:0:1');
    const input = grid.positionOfSlot('e1:0:1');
    expect([grid.levelAt(input), grid.levelAt(exit)]).toEqual([1, 1]);
    const blue = level.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
    expect(result.plan!.filter((m) => m.drop === exit)).toEqual([expect.objectContaining({ from: grid.index(blue.x, blue.z) })]);
    expect(result.plan!.some((m) => m.from === exit || m.drop === input || m.from === input)).toBe(false);
  });

  it('no dead ends («callejones» = 0) as far as npm run levels looks', { timeout: 60_000 }, () => {
    const result = deadEnds(level, { plan: minMoves(level).plan, maxStates: DEAD_END_STATES });
    expect(result).toMatchObject({ found: 0, unknown: 0 });
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: the autopilot finishes it, F at A, the belt carrying blue ● into B; the ride is no move', (_, dt) => {
    // Every fork press, with where the tines' tips stood then (past A's face, the forklift facing it from the south).
    const presses: { step: number; tipDepth: number }[] = [];
    const update = GameState.prototype.update;
    const tip = GAME_CONFIG.forklift.forkReach + TINES.tip * GAME_CONFIG.box.size;
    const faceZ = 4 - level.size.depth / 2;
    GameState.prototype.update = function (this: GameState, step: number, frame: InputFrame) {
      if (frame.forkStep) {
        const f = this.getSnapshot().forklift;
        presses.push({ step: frame.forkStep, tipDepth: faceZ - (f.pos.z + Math.cos(f.heading) * tip) });
      }
      return update.call(this, step, frame);
    };
    let out: ReturnType<typeof autopilot>;
    try {
      out = autopilot(level, dt);
    } finally {
      GameState.prototype.update = update;
    }
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect(out.moves).toBe(3);
    expect(out.snapshot.moves).toBe(3);
    // The forks go up to A's slot on the table with one press of F, as to a rack's level-1 slot (nothing else stores),
    // with the tines still outside A; after the drop it backs out, and only out there V brings them down.
    expect(out.controls.forkStepsAt).toEqual({ rack: 0, truck: 0, beltIn: 2, beltOut: 0 });
    expect(out.controls.forkSteps).toBe(2);
    expect(presses.map((p) => p.step)).toEqual([1, -1]);
    for (const p of presses) expect(p.tipDepth).toBeLessThan(0);
    const types = out.events.map((e) => e.type);
    expect(types.filter((t) => t === 'levelComplete')).toHaveLength(1);
    const onInput = drops(out.events).filter((d) => d.skin === 'beltIn');
    expect(onInput).toEqual([expect.objectContaining({ boxId: 'b1', slotId: 'e1:0:1', level: 1, correct: false, recipeLength: 0 })]);
    const at = (type: GameEvent['type']) => types.indexOf(type);
    expect(at('beltStarted')).toBeGreaterThan(out.events.indexOf(onInput[0]));
    expect(out.events.find((e) => e.type === 'beltStarted')).toMatchObject({ conveyorId: 'c1', boxId: 'b1', runSec: expect.closeTo(3 / CONVEYOR.speed + CONVEYOR.rampSec, 9) });
    expect(at('beltDelivered')).toBeGreaterThan(at('beltStarted'));
    expect(out.events.find((e) => e.type === 'beltDelivered')).toMatchObject({ boxId: 'b1', slotId: 's1:0:1', skin: 'beltOut', correct: true });
    expect(types).not.toContain('beltBlocked');
    // Every drop or delivery lit its target, except the drop on the input («libre»: never a target, never a buzz).
    expect(drops(out.events).every((d) => !('wrongTarget' in d) && (d.correct || d.skin === 'beltIn'))).toBe(true);
    expect(out.snapshot.boxes.find((b) => b.id === 'b1')).toMatchObject({ slotId: 's1:0:1', level: 1, correct: true, locked: true });
  });

  it('the render builds the belt as a table at level 1 on a closed base: its band, A\'s pad with its icon between its guards, B\'s deck with its cue painted flat and its low skirting', () => {
    const snap = new GameState(level).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.update(snap, 1 / 60, 0, Math.PI / 4, 0);
    const input = view.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const exit = view.root.children.find((c) => c.userData.beltOutId === 's1')!;
    const tagged = (group: Object3D, tag: string) => group.children.filter((c) => c.userData[tag] !== undefined) as Mesh[];
    const one = (group: Object3D, tag: string) => {
      const found = tagged(group, tag);
      expect(found, tag).toHaveLength(1);
      return found[0];
    };
    const boxOf = (mesh: Mesh) => new Box3().setFromObject(mesh);
    const top = rackSlotY(1);
    const height = boxDims(GAME_CONFIG).height;
    const centre = (x: number, z: number) => ({ x: x + 0.5 - level.size.width / 2, z: z + 0.5 - level.size.depth / 2 });
    // The table: from A's front to B's back, its top (under the band, the pad and the deck) at a rack's level-1 slot.
    const table = boxOf(one(input, 'beltTable'));
    expect(one(input, 'beltTable').userData.beltTable).toBe('c1');
    expect(table.max.y).toBeCloseTo(top - BELT.skin, 6);
    expect(table.min.y).toBeCloseTo(0, 6);
    expect(table.min.z).toBeCloseTo(centre(3, 0).z - 0.5 + BELT.endGap, 6);
    expect(table.max.z).toBeCloseTo(centre(3, 3).z + 0.5 - BELT.endGap, 6);
    // On it, flush with the table top: the band over the belt's cells (its rails a touch higher) and A's pad.
    const band = boxOf(one(input, 'beltBand'));
    expect([band.min.z, band.max.z]).toEqual([expect.closeTo(centre(3, 0).z + 0.5, 6), expect.closeTo(centre(3, 3).z - 0.5, 6)]);
    expect(band.max.y).toBeCloseTo(top + BELT.edge.height, 6);
    const pad = one(input, 'beltPad');
    expect(boxOf(pad).max.y).toBeCloseTo(top, 6);
    // The table's closed base: no legs, its sides the near-black from the floor up (one block: storage.test.ts).
    expect(paints(one(input, 'beltTable'), defaultTheme.conveyor.side)).toBe(true);
    // A's closed guards in the same near-black, on its two side edges (x), the length of its cell up to the table's
    // front end: its loading face (south) stays open.
    const a = centre(3, 3);
    const guards = boxOf(one(input, 'beltGuards'));
    expect(paints(one(input, 'beltGuards'), defaultTheme.conveyor.side)).toBe(true);
    expect([guards.min.x, guards.max.x]).toEqual([expect.closeTo(a.x - BELT.halfW, 6), expect.closeTo(a.x + BELT.halfW, 6)]);
    expect([guards.min.z, guards.max.z]).toEqual([expect.closeTo(a.z - 0.5, 6), expect.closeTo(a.z + 0.5 - BELT.endGap, 6)]);
    expect(guards.max.y - top).toBeLessThan(0.25 * height);
    // The drop icon on the pad, light cream.
    expect(paints(one(input, 'beltIcon'), defaultTheme.conveyor.icon)).toBe(true);
    // The belt's identity colour on A's pad and on B's skirting only (they pair up), never on B's deck or its cue.
    const identity = defaultTheme.conveyor.identity[0];
    expect(paints(pad, identity)).toBe(true);
    exit.traverse((o) => {
      if (o instanceof Mesh) expect(paints(o, identity), String(o.userData.beltDeck ?? o.userData.beltSkirting ?? o.userData.beltCue)).toBe(o.userData.beltSkirting !== undefined);
    });
    // B: its deck at the same level, its cue sticker painted flat on it (face up, well inside the fence), its glow.
    const deck = boxOf(one(exit, 'beltDeck'));
    expect(deck.max.y).toBeCloseTo(top, 6);
    const cue = one(exit, 'beltCue');
    expect(cue.userData.beltCue).toBe('s1:0:1');
    const sticker = boxOf(cue);
    expect(sticker.min.y).toBeGreaterThanOrEqual(top);
    expect(sticker.max.y - sticker.min.y).toBeLessThan(0.02);
    expect(sticker.getSize(new Vector3()).x).toBeCloseTo(2 * BELT_CUE.halfW, 6);
    const normals = (cue.geometry as BufferGeometry).getAttribute('normal');
    for (let i = 0; i < normals.count; i++) expect(normals.getY(i)).toBeCloseTo(1, 6);
    expect(one(exit, 'beltGlow').userData.beltGlow).toBe('s1:0:1');
    // Its low skirting: one solid strip of the belt's colour on its deck, a tenth of a box high, round B's back and
    // sides only (open toward the belt, where the box slides in).
    const skirtingMesh = one(exit, 'beltSkirting');
    const skirting = boxOf(skirtingMesh);
    expect(skirting.min.y).toBeCloseTo(top, 6);
    expect(skirting.max.y - top).toBeCloseTo(BELT_SKIRTING.top, 6);
    expect(skirting.max.y - top).toBeLessThan(0.15 * height);
    const b = centre(3, 0);
    expect(skirting.min.x).toBeGreaterThan(b.x - 0.5);
    expect(skirting.max.x).toBeLessThan(b.x + 0.5);
    expect(skirting.min.z).toBeGreaterThan(b.z - 0.5);
    expect(skirting.max.z).toBeLessThanOrEqual(b.z + 0.5 + 1e-6);
    const pos = (skirtingMesh.geometry as BufferGeometry).getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const [x, z] = [pos.getX(i) + skirtingMesh.position.x - b.x, pos.getZ(i) + skirtingMesh.position.z - b.z];
      // Never across the box's way in: nothing of it in the middle of B's near edge (toward the belt, +z here).
      if (z > 0) expect(Math.abs(x), `${x},${z}`).toBeGreaterThan(0.4);
      // Never over the box resting on B (0.39 across each side): only round it.
      expect(Math.max(Math.abs(x), Math.abs(z)), `${x},${z}`).toBeGreaterThan(0.4);
    }
    // The input shows the chosen-level marker (it is worked like a rack slot); the end exit, never.
    expect(STORAGE_RENDER.beltIn.markerGeometry).toBeDefined();
    expect(STORAGE_RENDER.beltOut.markerGeometry).toBeUndefined();
    view.dispose();
  });

  it('the target hints (P) light B for a box its cue fits, never A («libre»); off, nothing invites', () => {
    const snap = new GameState(level).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    const exit = view.root.children.find((c) => c.userData.beltOutId === 's1')!;
    const glow = exit.children.find((c) => c.userData.beltGlow === 's1:0:1') as Mesh<BufferGeometry, MeshStandardMaterial>;
    const deck = exit.children.find((c) => c.userData.beltDeck === 's1') as Mesh<BufferGeometry, MeshStandardMaterial>;
    const run = () => {
      for (let i = 0; i < 90; i++) view.update(snap, 1 / 60, i / 60, Math.PI / 4, 0);
    };
    // Carrying blue ● (it fits «azul»), the hints on: B pulses (its band and its deck); A has no light at all.
    const blue = snap.boxes.find((b) => b.color === 'blue' && b.symbol === 'circle')!;
    blue.carried = true;
    blue.cell = null;
    snap.forklift.carrying = blue.id;
    view.setTargetHints(true);
    run();
    expect(glow.visible).toBe(true);
    expect(deck.material.emissiveIntensity).toBeGreaterThan(0.1);
    const input = view.root.children.find((c) => c.userData.beltInId === 'e1')!;
    expect(input.children.some((c) => c.userData.beltGlow !== undefined)).toBe(false);
    // The hints off (the default): nothing invites.
    view.setTargetHints(false);
    run();
    expect(glow.visible).toBe(false);
    expect(deck.material.emissiveIntensity).toBeLessThan(0.02);
    view.dispose();
  });

  it('the band\'s white stripes slide only as the belt moves, along it and on it', () => {
    const snap = new GameState(level).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
    view.update(snap, 1 / 60, 0, Math.PI / 4, 0);
    const input = view.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const stripes = input.children.find((c) => c.userData.beltStripes) as Mesh<BufferGeometry, MeshStandardMaterial>;
    expect(stripes.material.color.getHex()).toBe(new Color(defaultTheme.conveyor.stripe).getHex());
    const positions = () => Array.from(stripes.geometry.getAttribute('position').array);
    // On the band's surface, the table top at level 1.
    const ys = positions().filter((_, i) => i % 3 === 1);
    for (const y of ys) expect(y).toBeCloseTo(rackSlotY(1) + BELT.stripe.lift, 5);
    const still = positions();
    // Idle: nothing moves, frame after frame.
    for (let i = 0; i < 5; i++) view.update(snap, 1 / 60, (i + 1) / 60, Math.PI / 4, 0);
    expect(positions()).toEqual(still);
    // The surface moves (ConveyorState.travel): the stripes slide along the belt (north, toward B: world z decreasing)
    // and stay on its band.
    snap.conveyors[0].travel = 0.1;
    view.update(snap, 1 / 60, 0.2, Math.PI / 4, 0);
    const moved = positions();
    expect(moved).not.toEqual(still);
    const zs = (values: number[]) => values.filter((_, i) => i % 3 === 2);
    const xs = (values: number[]) => values.filter((_, i) => i % 3 === 0);
    const bandZ = [3 + 0.5 - level.size.depth / 2 - 0.5 - 2, 3 + 0.5 - level.size.depth / 2 - 0.5];
    for (const z of zs(moved)) {
      expect(z).toBeGreaterThanOrEqual(bandZ[0] - 1e-5);
      expect(z).toBeLessThanOrEqual(bandZ[1] + 1e-5);
    }
    for (const x of xs(moved)) expect(Math.abs(x - (3 + 0.5 - level.size.width / 2))).toBeLessThanOrEqual(BELT.band + 1e-5);
    expect(Math.min(...zs(moved).filter((z) => z < bandZ[1] - 1e-5 && z > bandZ[0] + 1e-5))).toBeLessThan(Math.min(...zs(still).filter((z) => z < bandZ[1] - 1e-5 && z > bandZ[0] + 1e-5)));
    view.dispose();
  });
});

/** The mesh's vertex colours include `hex` (as painted: three.js keeps them linear). */
function paints(mesh: Mesh, hex: string): boolean {
  const colors = (mesh.geometry as BufferGeometry).getAttribute('color');
  if (!colors) return false;
  const want = new Color(hex);
  for (let i = 0; i < colors.count; i++) {
    if (Math.abs(colors.getX(i) - want.r) + Math.abs(colors.getY(i) - want.g) + Math.abs(colors.getZ(i) - want.b) < 1e-4) return true;
  }
  return false;
}
