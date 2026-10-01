/**
 * The belt button fixture (src/data/levels/pruebas/cinta-boton.level, docs/CONVEYOR.md H2 «Nivel de prueba»): a
 * test-only level that neither the registry nor `npm run levels` reads. Two boxes on each other's zones, with nowhere on
 * the floor to park one without walling off the other: the belt (A (3,2) → B (3,0), «libre») is the parking, and its
 * button «o» (4,2), beside A, brings the box back. Its shortest plan uses the button (3 moves; without it, 5): the box
 * ridden to B, the other box home, the button pressed (no move) and the first box lifted off A and home. It must stay
 * canonical and valid, with one complete assignment and no dead ends (the whole state space searched), and the
 * autopilot (./autopilot.ts) plays it to the end with the real controls at 60 fps and at Game's worst dt (1/20),
 * pressing the button once, standing on it. The render draws the button (H2b: a pad on the floor in the belt's
 * identity colour, its input's pad's, with a cream back arrow), which brightens while the forklift stands on it, glows
 * and dips on an accepted press and flashes, muted, on a refused one, and the stripes slide back while the belt runs
 * back.
 */
import { Box3, Color, Mesh, Vector3, type BufferGeometry, type MeshStandardMaterial } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { conveyorsOf } from '../core/conveyors';
import { assignmentsOf, sortableOf, targetsOf } from '../core/sorting';
import { TINES, type GameEvent, type InputFrame } from '../core/types';
import { formatLevel, parseLevel, renderLevel } from '../data/asciiLevel';
import { formatRange, formatTarget } from '../data/difficulty';
import { LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES } from '../data/levels';
import { checkLevelTargets, levelMetrics } from '../data/levels/metrics';
import { LevelGrid, deadEnds, minMoves, replayMoves } from '../data/levels/solver';
import { validateLevel } from '../data/validateLevel';
import { GameState } from '../logic/GameState';
import { onButtonPad } from '../logic/conveyor';
import { BELT_BUTTON, BELT_BUTTON_ICON } from '../render/builders/conveyor';
import { BUTTON_FEEL } from '../render/views/ConveyorView';
import { LevelView } from '../render/LevelView';
import { defaultTheme } from '../themes/default';
import { autopilot } from './autopilot';
import text from '../data/levels/pruebas/cinta-boton.level?raw';

const FILE = 'src/data/levels/pruebas/cinta-boton.level';
const parsed = parseLevel(text, FILE);
const { level } = parsed;
const grid = new LevelGrid(level);
const exit = grid.positionOfSlot('s1:0:1');

/** World centre of map cell (x, z) of the fixture. */
const centre = (x: number, z: number) => ({ x: x + 0.5 - level.size.width / 2, z: z + 0.5 - level.size.depth / 2 });

type Picked = Extract<GameEvent, { type: 'boxPicked' }>;
const picks = (events: readonly GameEvent[]) => events.filter((e): e is Picked => e.type === 'boxPicked');

describe('the belt button fixture (pruebas/cinta-boton.level)', () => {
  it('is canonical (as levels:fmt writes it), validates and round-trips; the registry and npm run levels never see it', () => {
    expect(formatLevel(text, FILE)).toBe(text);
    expect(renderLevel(level, parsed)).toBe(text);
    expect(validateLevel(structuredClone(level), level.id)).toStrictEqual(level);
    for (const sources of [LEVEL_SOURCES, SPECIAL_LEVEL_SOURCES]) expect(sources.some((s) => s.file.includes('/pruebas/') || s.level.id === level.id)).toBe(false);
    expect(parsed.notes.join('\n')).toMatch(/conveyorButtonFixture\.test\.ts/);
  });

  it('one belt with its button: A (3,2), one floor cell, B (3,0) «libre»; the button (4,2) beside A, a pad driven onto from (4,3) only', () => {
    expect(conveyorsOf(level)).toEqual([{ id: 'c1', input: 'e1', output: 's1', cells: [{ x: 3, z: 1, piece: 'suelo', height: 1 }], button: { x: 4, z: 2 } }]);
    expect(level.storage!.map((u) => [u.id, u.skin, u.x, u.z, u.columns])).toEqual([
      ['e1', 'beltIn', 3, 2, [[null]]],
      ['s1', 'beltOut', 3, 0, [[null]]],
    ]);
    // Pressed standing on it: floor, never a drop, never a pick or drop pose; its only free side is (4,3).
    const pad = grid.index(4, 2);
    expect(grid.pressFrom[exit]).toEqual([pad]);
    expect([grid.solid[pad], grid.pads[pad]]).toEqual([0, 1]);
    expect([0, 1, 2, 3].map((d) => grid.step(pad, d)).filter((c) => c >= 0 && grid.solid[c] === 0)).toEqual([grid.index(4, 3)]);
  });

  it('has exactly one complete assignment (the two zones; a «libre» end exit is never a target), and its «dificultad:» targets hold', () => {
    const targets = targetsOf(level);
    expect(targets.map((t) => t.kind)).toEqual(['zone', 'zone']);
    expect(assignmentsOf(level.boxes.map(sortableOf), targets.map((t) => t.criteria), 2).count).toBe(1);
    const m = levelMetrics(level, { skipMoves: true });
    expect(m.belts).toEqual({ belts: 1, cells: 1, floor: 1, exits: 1, cued: 0, buttons: 1 });
    expect(parsed.targets.map((t) => t.metric)).toEqual(['movimientos', 'extra', 'repartos', 'cinta']);
    const failed = checkLevelTargets(level, parsed.targets).filter((c) => !c.ok);
    expect(failed.map((c) => `${formatTarget(c.target)}: medido ${formatRange(c.range)}`)).toEqual([]);
  });

  it('the exact solver: 3 moves through the button (azul ● parks at B, menta ▲ home, azul ● back off A and home); it replays', () => {
    const result = minMoves(level);
    expect(result).toMatchObject({ lower: 3, upper: 3, exact: true, unsolvable: false });
    expect(replayMoves(level, result.plan!)).toBe(true);
    expect(result.plan!.filter((m) => m.drop === exit)).toHaveLength(1);
    expect(result.plan!.filter((m) => m.from === exit)).toHaveLength(1);
  });

  it('no dead ends («callejones» = 0), every reachable state searched: a box at B always comes back', { timeout: 60_000 }, () => {
    const result = deadEnds(level, { plan: minMoves(level).plan, maxStates: 5000 });
    expect(result).toMatchObject({ found: 0, unknown: 0, complete: true });
    expect(result.explored).toBeGreaterThan(100);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: the autopilot finishes it pressing the button once, standing on it; the press and the ride back are no moves', (_, dt) => {
    // Every fork press, with where the tines' tips stood then (past A's face, at z = 3, the forklift facing north); and
    // where the forklift stood at every action pressed while the hint named the button.
    const presses: { step: number; tipDepth: number }[] = [];
    const onButton: { x: number; z: number }[] = [];
    const update = GameState.prototype.update;
    const tip = GAME_CONFIG.forklift.forkReach + TINES.tip * GAME_CONFIG.box.size;
    const faceZ = 3 - level.size.depth / 2;
    GameState.prototype.update = function (this: GameState, step: number, frame: InputFrame) {
      const f = this.getSnapshot().forklift;
      if (frame.forkStep) presses.push({ step: frame.forkStep, tipDepth: faceZ - (f.pos.z + Math.cos(f.heading) * tip) });
      if (frame.actionPressed && this.getSnapshot().hint.button) onButton.push({ x: f.pos.x, z: f.pos.z });
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
    expect([out.moves, out.snapshot.moves]).toEqual([3, 3]);
    const types = out.events.map((e) => e.type);
    // One press, accepted: the box at B (azul ●) rides back and rests on A again.
    const button = out.events.filter((e) => e.type === 'beltButton');
    expect(button).toEqual([{ type: 'beltButton', conveyorId: 'c1', accepted: true, boxId: 'b2', fromSlotId: 's1:0:1' }]);
    const pressedAt = out.events.indexOf(button[0]);
    expect(out.events.slice(pressedAt).find((e) => e.type === 'beltStarted')).toMatchObject({ boxId: 'b2', reverse: true });
    // Pressed standing on the pad (4,2), driven straight onto it from (4,3).
    expect(onButton).toHaveLength(1);
    expect(onButtonPad(onButton[0].x, onButton[0].z, centre(4, 2))).toBe(true);
    const back = types.indexOf('beltReturned');
    expect(out.events[back]).toEqual({ type: 'beltReturned', conveyorId: 'c1', boxId: 'b2', slotId: 'e1:0:1', skin: 'beltIn', level: 1 });
    // Lifted off A at level 1, after it came back.
    expect(picks(out.events.slice(back))).toEqual([expect.objectContaining({ boxId: 'b2', fromSlotId: 'e1:0:1', level: 1 })]);
    // F up at A (outside it) to set azul ● down, V once backed out, F up again (outside it) to lift it back.
    expect(out.controls.forkStepsAt.beltIn).toBe(3);
    expect(presses.map((p) => p.step)).toEqual([1, -1, 1]);
    for (const p of presses) expect(p.tipDepth).toBeLessThan(0);
    expect(types.filter((t) => t === 'levelComplete')).toHaveLength(1);
    expect(out.snapshot.boxes.every((b) => b.correct && b.locked)).toBe(true);
  });
});

describe('the belt button on screen', () => {
  const ANGLE = Math.PI / 4;
  /** The level view with its snapshot, the input unit's group, the button's pad and the arrow on it. */
  function view() {
    const snap = new GameState(level).getSnapshot();
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    v.update(snap, 1 / 60, 0, ANGLE, 0);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const pad = input.children.find((c) => c.userData.beltButton !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    const icon = pad.children.find((c) => c.userData.beltButtonIcon !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    return { snap, v, input, pad, icon };
  }
  /** World bounds of a mesh's own geometry (not its children's). */
  const boundsOf = (mesh: Mesh) => {
    mesh.updateWorldMatrix(true, false);
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  };

  it('on its own floor cell: its input\'s pad again, in the belt\'s identity colour, with a cream back arrow on it; no post, no cap', () => {
    const { v, pad, icon, input } = view();
    expect(pad.userData.beltButton).toBe('c1');
    expect(icon.userData.beltButtonIcon).toBe('c1');
    const identity = defaultTheme.conveyor.identity[0];
    const inputPad = input.children.find((c) => c.userData.beltPad !== undefined) as Mesh;
    expect(paints(pad, identity)).toBe(true);
    expect(paints(inputPad, identity)).toBe(true);
    // The same rounded square as the input's pad, as thick, standing on the floor and centred on (4,2).
    const own = boundsOf(pad);
    const a = boundsOf(inputPad);
    const at = centre(4, 2);
    expect(own.max.x - own.min.x).toBeCloseTo(a.max.x - a.min.x, 6);
    expect(own.max.z - own.min.z).toBeCloseTo(a.max.z - a.min.z, 6);
    expect(own.max.y - own.min.y).toBeCloseTo(a.max.y - a.min.y, 6);
    expect(own.max.x - own.min.x).toBeCloseTo(2 * BELT_BUTTON.half, 6);
    expect([own.min.y, own.max.y]).toEqual([expect.closeTo(0, 6), expect.closeTo(BELT_BUTTON.height, 6)]);
    expect((own.min.x + own.max.x) / 2).toBeCloseTo(at.x, 6);
    expect((own.min.z + own.max.z) / 2).toBeCloseTo(at.z, 6);
    // The arrow: cream, flat just over the pad's top, well inside it and centred on it, never glowing with it.
    expect(paints(icon, defaultTheme.conveyor.icon)).toBe(true);
    expect(icon.material).not.toBe(pad.material);
    const arrow = boundsOf(icon);
    expect(arrow.min.y).toBeGreaterThan(BELT_BUTTON.height);
    expect(arrow.max.y).toBeLessThan(BELT_BUTTON.height + 0.01);
    expect((arrow.min.x + arrow.max.x) / 2).toBeCloseTo(at.x, 2);
    expect((arrow.min.z + arrow.max.z) / 2).toBeCloseTo(at.z, 2);
    for (const span of [arrow.max.x - arrow.min.x, arrow.max.z - arrow.min.z]) {
      expect(span).toBeGreaterThan(0.35);
      expect(span).toBeLessThan(2 * BELT_BUTTON.half - 0.2);
    }
    // A back arrow, turned with its belt (here running north, from A to B): its turn toward B, the tip of its head
    // pointing back toward A (south).
    const { turn, head, tail } = BELT_BUTTON_ICON;
    const outer = turn.radius + turn.width / 2;
    const dx = -(turn.radius + head.half - outer) / 2;
    const dz = -(tail + turn.z + outer) / 2;
    // Turned by π (belt-local +z toward B, the north: world −z), a local point (x, z) lands at the centre minus it.
    const tip = { x: at.x - (turn.radius + dx), z: at.z - (turn.z - head.length + dz) };
    const positions = icon.geometry.getAttribute('position');
    const world = new Vector3();
    let hasTip = false;
    let north = Infinity;
    for (let i = 0; i < positions.count; i++) {
      world.fromBufferAttribute(positions, i).applyMatrix4(icon.matrixWorld);
      if (Math.abs(world.x - tip.x) < 1e-6 && Math.abs(world.z - tip.z) < 1e-6) hasTip = true;
      north = Math.min(north, world.z);
    }
    expect(hasTip).toBe(true);
    expect(tip.z).toBeGreaterThan(at.z - 0.05);
    expect(north).toBeLessThan(at.z - 0.15);
    // Nothing of the button stands up: no post, no cap, nothing over the pad but its arrow.
    expect(input.children.some((c) => c.userData.beltButtonPost !== undefined || c.userData.beltButtonCap !== undefined)).toBe(false);
    expect(new Box3().setFromObject(pad).max.y).toBeLessThan(BELT_BUTTON.height + 0.01);
    v.dispose();
  });

  it('standing on it the pad brightens a little; an accepted press lights it and sinks it softly; a refused one only flashes, muted', () => {
    const { snap, v, pad } = view();
    const belt = snap.conveyors[0];
    const identity = defaultTheme.conveyor.identity[0];
    let t = 0;
    const frame = () => v.update(snap, 1 / 60, (t += 1 / 60), ANGLE, 0);
    // At rest: no glow; its glow, when it comes, in its own colour.
    expect(pad.material.emissiveIntensity).toBe(0);
    expect(pad.material.emissive.getHex()).toBe(new Color(identity).getHex());
    expect(pad.position.y).toBe(0);
    // Standing on it (the hint names its belt): a slight, steady brightening, off again once it is left.
    snap.hint.button = 'c1';
    for (let i = 0; i < 60; i++) frame();
    expect(pad.material.emissiveIntensity).toBeCloseTo(BUTTON_FEEL.standGlow, 2);
    expect(pad.material.emissiveIntensity).toBeLessThan(0.3);
    snap.hint.button = null;
    for (let i = 0; i < 90; i++) frame();
    expect(pad.material.emissiveIntensity).toBe(0);
    // A refused press: a short, muted flash, no dip.
    const sample = (frames: number) => {
      const out = { glow: [] as number[], dip: [] as number[] };
      for (let i = 0; i < frames; i++) {
        frame();
        out.glow.push(pad.material.emissiveIntensity);
        out.dip.push(-pad.position.y);
      }
      return out;
    };
    belt.presses = 1;
    const refused = sample(40);
    expect(Math.max(...refused.dip)).toBeCloseTo(0, 12);
    expect(Math.max(...refused.glow)).toBeGreaterThan(0.5 * BUTTON_FEEL.refusedFlash);
    expect(Math.max(...refused.glow)).toBeLessThanOrEqual(BUTTON_FEEL.refusedFlash + 1e-9);
    expect(refused.glow.at(-1)).toBe(0);
    // An accepted one: it lights up (far brighter than the flash) and sinks into the floor a little, both gone within a
    // second.
    belt.presses = 2;
    belt.accepted = 1;
    const accepted = sample(60);
    expect(Math.max(...accepted.dip)).toBeCloseTo(BELT_BUTTON.dip, 3);
    expect(Math.max(...accepted.glow)).toBeGreaterThan(0.4);
    expect(accepted.glow.at(-1)).toBe(0);
    expect(pad.position.y).toBe(0);
    v.dispose();
  });

  it('a level loaded with presses already counted shows the pad at rest (nothing replays)', () => {
    const snap = new GameState(level).getSnapshot();
    snap.conveyors[0].presses = 4;
    snap.conveyors[0].accepted = 2;
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const pad = input.children.find((c) => c.userData.beltButton !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    for (let i = 0; i < 10; i++) v.update(snap, 1 / 60, i / 60, ANGLE, 0);
    expect(pad.position.y).toBe(0);
    expect(pad.material.emissiveIntensity).toBe(0);
    v.dispose();
  });

  it('while the belt runs back its stripes slide backwards, toward A (south here: the belt runs north)', () => {
    const { snap, v, input } = view();
    const stripes = input.children.find((c) => c.userData.beltStripes) as Mesh<BufferGeometry, MeshStandardMaterial>;
    const zs = () => Array.from(stripes.geometry.getAttribute('position').array).filter((_, i) => i % 3 === 2);
    const bandZ = [centre(3, 1).z - 0.5, centre(3, 1).z + 0.5];
    const inner = (values: number[]) => values.filter((z) => z > bandZ[0] + 1e-5 && z < bandZ[1] - 1e-5);
    snap.conveyors[0].travel = 0.1;
    v.update(snap, 1 / 60, 0.1, ANGLE, 0);
    const still = inner(zs());
    // Going back by a little (no stripe reaching an end of the band): every stripe on it moves south by as much (z grows).
    snap.conveyors[0].travel = 0.05;
    v.update(snap, 1 / 60, 0.2, ANGLE, 0);
    const back = inner(zs());
    expect(back).toHaveLength(still.length);
    back.forEach((z, i) => expect(z - still[i]).toBeCloseTo(0.05, 5));
    // Forward instead: north (z shrinks).
    snap.conveyors[0].travel = 0.15;
    v.update(snap, 1 / 60, 0.3, ANGLE, 0);
    inner(zs()).forEach((z, i) => expect(z - still[i]).toBeCloseTo(-0.05, 5));
    v.dispose();
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
