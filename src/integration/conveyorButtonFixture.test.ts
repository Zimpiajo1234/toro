/**
 * The belt button fixture (src/data/levels/pruebas/cinta-boton.level, docs/CONVEYOR.md H2 «Nivel de prueba»): a
 * test-only level that neither the registry nor `npm run levels` reads. Two boxes on each other's zones, with nowhere on
 * the floor to park one without walling off the other: the belt (A (3,2) → B (3,0), «libre») is the parking, and its
 * button «o» (4,2), beside A, brings the box back. Its shortest plan uses the button (3 moves; without it, 5): the box
 * ridden to B, the other box home, the button pressed (no move) and the first box lifted off A and home. It must stay
 * canonical and valid, with one complete assignment and no dead ends (the whole state space searched), and the
 * autopilot (./autopilot.ts) plays it to the end with the real controls at 60 fps and at Game's worst dt (1/20),
 * pressing the button once, facing it. The render draws the button (a post in the table's near-black, a cap in the
 * belt's identity colour) whose cap dips on a press and glows on an accepted one, and the stripes slide back while the
 * belt runs back.
 */
import { Box3, Color, Mesh, type BufferGeometry, type MeshStandardMaterial, type Object3D } from 'three';
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
import { BELT_BUTTON } from '../render/builders/conveyor';
import { LevelView } from '../render/LevelView';
import { defaultTheme } from '../themes/default';
import { autopilot } from './autopilot';
import text from '../data/levels/pruebas/cinta-boton.level?raw';

const FILE = 'src/data/levels/pruebas/cinta-boton.level';
const parsed = parseLevel(text, FILE);
const { level } = parsed;
const grid = new LevelGrid(level);
const exit = grid.positionOfSlot('s1:0:1');

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

  it('one belt with its button: A (3,2), one floor cell, B (3,0) «libre»; the button (4,2) beside A, pressed from (4,3) only', () => {
    expect(conveyorsOf(level)).toEqual([{ id: 'c1', input: 'e1', output: 's1', cells: [{ x: 3, z: 1, piece: 'suelo', height: 1 }], button: { x: 4, z: 2 } }]);
    expect(level.storage!.map((u) => [u.id, u.skin, u.x, u.z, u.columns])).toEqual([
      ['e1', 'beltIn', 3, 2, [[null]]],
      ['s1', 'beltOut', 3, 0, [[null]]],
    ]);
    expect(grid.pressFrom[exit]).toEqual([grid.index(4, 3)]);
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
  ] as const)('%s: the autopilot finishes it pressing the button once, facing it; the press and the ride back are no moves', (_, dt) => {
    // Every fork press, with where the tines' tips stood then (past A's face, at z = 3, the forklift facing north).
    const presses: { step: number; tipDepth: number }[] = [];
    const update = GameState.prototype.update;
    const tip = GAME_CONFIG.forklift.forkReach + TINES.tip * GAME_CONFIG.box.size;
    const faceZ = 3 - level.size.depth / 2;
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
    expect([out.moves, out.snapshot.moves]).toEqual([3, 3]);
    const types = out.events.map((e) => e.type);
    // One press, accepted: the box at B (azul ●) rides back and rests on A again.
    const button = out.events.filter((e) => e.type === 'beltButton');
    expect(button).toEqual([{ type: 'beltButton', conveyorId: 'c1', accepted: true, boxId: 'b2', fromSlotId: 's1:0:1' }]);
    const pressedAt = out.events.indexOf(button[0]);
    expect(out.events.slice(pressedAt).find((e) => e.type === 'beltStarted')).toMatchObject({ boxId: 'b2', reverse: true });
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
  /** The level view with its snapshot, the input unit's group and the button's two meshes. */
  function view() {
    const snap = new GameState(level).getSnapshot();
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    v.update(snap, 1 / 60, 0, ANGLE, 0);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const tagged = (group: Object3D, tag: string) => group.children.filter((c) => c.userData[tag] !== undefined) as Mesh[];
    const [post] = tagged(input, 'beltButtonPost');
    const [cap] = tagged(input, 'beltButtonCap') as Mesh<BufferGeometry, MeshStandardMaterial>[];
    return { snap, v, input, post, cap };
  }
  const centre = (x: number, z: number) => ({ x: x + 0.5 - level.size.width / 2, z: z + 0.5 - level.size.depth / 2 });

  it('on its own cell: a slim post in the table\'s near-black and a mushroom cap in the belt\'s identity colour (its input\'s pad\'s), a little over the table', () => {
    const { v, post, cap, input } = view();
    expect(post.userData.beltButtonPost).toBe('c1');
    expect(cap.userData.beltButtonCap).toBe('c1');
    expect(paints(post, defaultTheme.conveyor.side)).toBe(true);
    const identity = defaultTheme.conveyor.identity[0];
    expect(paints(cap, identity)).toBe(true);
    const pad = input.children.find((c) => c.userData.beltPad !== undefined) as Mesh;
    expect(paints(pad, identity)).toBe(true);
    // Centred on (4,2): the post from the floor up to its cap, the cap over the table top (0.78), under a box on A.
    const at = centre(4, 2);
    const postBox = new Box3().setFromObject(post);
    expect(postBox.min.y).toBeCloseTo(0, 6);
    expect(postBox.max.y).toBeCloseTo(BELT_BUTTON.post.top, 6);
    expect((postBox.min.x + postBox.max.x) / 2).toBeCloseTo(at.x, 6);
    expect((postBox.min.z + postBox.max.z) / 2).toBeCloseTo(at.z, 6);
    const capBox = new Box3().setFromObject(cap);
    expect(capBox.min.y).toBeCloseTo(BELT_BUTTON.post.top, 6);
    expect(capBox.max.y).toBeCloseTo(BELT_BUTTON.post.top + BELT_BUTTON.cap.height, 6);
    expect(capBox.max.x - capBox.min.x).toBeLessThanOrEqual(2 * BELT_BUTTON.cap.radius + 1e-6);
    expect(capBox.max.y).toBeGreaterThan(0.78);
    expect(capBox.max.y).toBeLessThan(0.78 + 0.5 * 0.64);
    // At rest: no glow.
    expect(cap.material.emissiveIntensity).toBe(0);
    expect(cap.material.emissive.getHex()).toBe(new Color(identity).getHex());
    v.dispose();
  });

  it('a press dips the cap and brings it back up; an accepted one also glows, in its own colour; while aimed at, a faint glow', () => {
    const { snap, v, cap } = view();
    const rest = cap.position.y;
    const belt = snap.conveyors[0];
    const frame = (t: number) => v.update(snap, 1 / 60, t, ANGLE, 0);
    // A refused press: the dip, no glow.
    belt.presses = 1;
    const dips: number[] = [];
    const glows: number[] = [];
    for (let i = 1; i <= 40; i++) {
      frame(i / 60);
      dips.push(rest - cap.position.y);
      glows.push(cap.material.emissiveIntensity);
    }
    expect(Math.max(...dips)).toBeCloseTo(BELT_BUTTON.dip, 2);
    expect(dips.at(-1)).toBeCloseTo(0, 9);
    expect(Math.max(...glows)).toBe(0);
    // An accepted one: the dip and the glow, both gone within a second.
    belt.presses = 2;
    belt.accepted = 1;
    dips.length = 0;
    glows.length = 0;
    for (let i = 1; i <= 60; i++) {
      frame(1 + i / 60);
      dips.push(rest - cap.position.y);
      glows.push(cap.material.emissiveIntensity);
    }
    expect(Math.max(...dips)).toBeGreaterThan(0.5 * BELT_BUTTON.dip);
    expect(Math.max(...glows)).toBeGreaterThan(0.4);
    expect(glows.at(-1)).toBe(0);
    expect(cap.position.y).toBe(rest);
    // Aimed at (the hint names its belt): a faint steady glow, off again once it is not.
    snap.hint.button = 'c1';
    for (let i = 1; i <= 60; i++) frame(2 + i / 60);
    expect(cap.material.emissiveIntensity).toBeGreaterThan(0.1);
    expect(cap.material.emissiveIntensity).toBeLessThan(0.2);
    snap.hint.button = null;
    for (let i = 1; i <= 90; i++) frame(3 + i / 60);
    expect(cap.material.emissiveIntensity).toBe(0);
    v.dispose();
  });

  it('a level loaded with presses already counted shows the cap at rest (nothing replays)', () => {
    const snap = new GameState(level).getSnapshot();
    snap.conveyors[0].presses = 4;
    snap.conveyors[0].accepted = 2;
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const cap = input.children.find((c) => c.userData.beltButtonCap !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    for (let i = 0; i < 10; i++) v.update(snap, 1 / 60, i / 60, ANGLE, 0);
    expect(cap.position.y).toBe(BELT_BUTTON.post.top);
    expect(cap.material.emissiveIntensity).toBe(0);
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
