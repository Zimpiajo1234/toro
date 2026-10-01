/**
 * The belt button fixture (src/data/levels/pruebas/cinta-boton.level, docs/CONVEYOR.md H2 «Nivel de prueba»): a
 * test-only level that neither the registry nor `npm run levels` reads. Two boxes on each other's zones, with nowhere on
 * the floor to park one without walling off the other: the belt (A (3,2) → B (3,0), «libre») is the parking, and its
 * button «o» (4,2), beside A, brings the box back. Its shortest plan uses the button (3 moves; without it, 5): the box
 * ridden to B, the other box home, the button pressed (no move) and the first box lifted off A and home. It must stay
 * canonical and valid, with one complete assignment and no dead ends (the whole state space searched), and the
 * autopilot (./autopilot.ts) plays it to the end with the real controls at 60 fps and at Game's worst dt (1/20),
 * pressing the button once, standing on it. The render draws the button (H2b: a pad on the floor in the belt's
 * identity colour, its input's pad's, with a cream back arrow; H2c: the halo of its light on the floor round it), which
 * brightens, with a faint halo, while the forklift stands on it, dips on an accepted press and stays brightly lit, pad
 * and halo, while the belt runs back, fading out once the box rests on A, and flashes, muted, on a refused one; the
 * stripes slide back while the belt runs back.
 */
import { Box3, Color, Mesh, SRGBColorSpace, Vector3, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial } from 'three';
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
import { BELT_BUTTON, BELT_BUTTON_HALO, BELT_BUTTON_ICON } from '../render/builders/conveyor';
import { BUTTON_FEEL, buttonLightTone } from '../render/views/ConveyorView';
import { FLASH_PEAK } from '../render/views/success';
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

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: with the pad\'s only free side east of it, the autopilot drives on facing A and presses as it is (H2c: the tines in A\'s base, its slot clear)', (_, dt) => {
    // A pad (4,2) east of A (3,2), plants north and south of it: driven onto only from (5,2), heading west, into A. The
    // azul ● parked at B («libre») first; its zone is the one way to finish, so it comes back with the button.
    const variant = parseLevel(
      `# 1 · Botón de cara a A
id: boton-de-cara
limit: 1

  0123456
0 ..pBp..
1 ...~p..
2 ...Ao..
3 ....p..
4 .......
5 .a.^.1.
6 .......

1 = zona azul
a = caja azul ●
A = cinta entrada        B = cinta final: libre   ~ = cinta                o = cinta botón
`,
      'prueba.level',
    ).level;
    const g = new LevelGrid(variant);
    const opening = [{ from: g.index(1, 5), drop: g.positionOfSlot('s1:0:1') }];
    const onButton: { x: number; z: number; heading: number; forkHeight: number }[] = [];
    const update = GameState.prototype.update;
    GameState.prototype.update = function (this: GameState, step: number, frame: InputFrame) {
      const { forklift: f, hint } = this.getSnapshot();
      if (frame.actionPressed && hint.button) onButton.push({ x: f.pos.x, z: f.pos.z, heading: f.heading, forkHeight: f.forkHeight });
      return update.call(this, step, frame);
    };
    let out: ReturnType<typeof autopilot>;
    try {
      out = autopilot(variant, dt, opening);
    } finally {
      GameState.prototype.update = update;
    }
    expect(out.note).toBe('');
    expect(out.solved).toBe(true);
    expect([out.moves, out.snapshot.moves]).toEqual([2, 2]);
    expect(out.events.filter((e) => e.type === 'beltButton')).toEqual([expect.objectContaining({ accepted: true, boxId: 'b1' })]);
    // One press, standing on the pad as it drove on, heading west (into A, at (3,2)), never turned first: the tines
    // reach into A's cell, the forks down.
    expect(onButton).toHaveLength(1);
    const [p] = onButton;
    expect(onButtonPad(p.x, p.z, { x: 4 + 0.5 - 3.5, z: 2 + 0.5 - 3.5 })).toBe(true);
    expect(Math.abs(Math.atan2(Math.sin(p.heading + Math.PI / 2), Math.cos(p.heading + Math.PI / 2)))).toBeLessThan(Math.PI / 4);
    const radius = TINES.spread + TINES.width / 2;
    const ahead = GAME_CONFIG.forklift.forkReach + TINES.tip * GAME_CONFIG.box.size - radius;
    const tines = { x: p.x + Math.sin(p.heading) * ahead, z: p.z + Math.cos(p.heading) * ahead };
    expect(tines.x).toBeLessThan(0.5 + radius - 0.1);
    expect(Math.abs(tines.z + 1)).toBeLessThan(0.5);
    expect(p.forkHeight).toBe(0);
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps (Game dt clamp)', 1 / 20],
  ] as const)('%s: through the autopilot\'s game, the pad lights up on the press (H2c), stays lit while the belt brings the box back, and fades out once it rests on A', (_, dt) => {
    // A level view of the autopilot's own game, updated after every frame: the pad's emissive and its halo, and the
    // frame's events.
    const update = GameState.prototype.update;
    const screens: { v: LevelView; pad: Mesh<BufferGeometry, MeshStandardMaterial>; halo: Mesh<BufferGeometry, MeshBasicMaterial> }[] = [];
    const light: { glow: number; halo: number; types: GameEvent['type'][] }[] = [];
    GameState.prototype.update = function (this: GameState, step: number, frame: InputFrame) {
      const events = update.call(this, step, frame);
      const snap = this.getSnapshot();
      if (screens.length === 0) {
        const v = new LevelView(snap, defaultTheme, GAME_CONFIG, Math.PI / 4);
        const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
        const pad = input.children.find((c) => c.userData.beltButton !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
        const halo = input.children.find((c) => c.userData.beltButtonHalo !== undefined) as Mesh<BufferGeometry, MeshBasicMaterial>;
        screens.push({ v, pad, halo });
      }
      const [screen] = screens;
      screen.v.update(snap, step, light.length * step, Math.PI / 4, 0);
      light.push({ glow: screen.pad.material.emissiveIntensity, halo: screen.halo.material.opacity, types: events.map((e) => e.type) });
      return events;
    };
    let out: ReturnType<typeof autopilot>;
    try {
      out = autopilot(level, dt);
    } finally {
      GameState.prototype.update = update;
      for (const screen of screens) screen.v.dispose();
    }
    expect(out.solved).toBe(true);
    const F = BUTTON_FEEL;
    const pressed = light.findIndex((l) => l.types.includes('beltButton'));
    const back = light.findIndex((l) => l.types.includes('beltReturned'));
    expect([pressed > 0, back > pressed]).toEqual([true, true]);
    // Before: at most the faint glow of standing on it.
    expect(Math.max(...light.slice(0, pressed).map((l) => l.glow))).toBeLessThanOrEqual(F.standGlow + 1e-9);
    // Up within litRise of the press, and lit, pad and halo, until the box rests on A (the forklift long off the pad).
    const rise = Math.ceil(F.litRise / dt + 1e-9);
    expect(light[pressed].glow).toBeLessThan(F.litGlow);
    for (const l of light.slice(pressed + rise, back)) expect([l.glow, l.halo]).toEqual([expect.closeTo(F.litGlow, 9), expect.closeTo(F.litHalo, 9)]);
    expect(back - pressed).toBeGreaterThan(rise + Math.round(2 / dt));
    // Then a smooth fade, out by litFade.
    const fade = light.slice(back, back + Math.ceil(F.litFade / dt + 1e-9) + 1);
    fade.slice(1).forEach((l, i) => expect(l.glow).toBeLessThanOrEqual(fade[i].glow));
    expect([fade.at(-1)!.glow, fade.at(-1)!.halo]).toEqual([0, 0]);
  });
});

describe('the belt button on screen', () => {
  const ANGLE = Math.PI / 4;
  /** The level view with its snapshot, the input unit's group, the button's pad, the arrow on it and its halo (H2c). */
  function view() {
    const snap = new GameState(level).getSnapshot();
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    v.update(snap, 1 / 60, 0, ANGLE, 0);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const pad = input.children.find((c) => c.userData.beltButton !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    const icon = pad.children.find((c) => c.userData.beltButtonIcon !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    const halo = input.children.find((c) => c.userData.beltButtonHalo !== undefined) as Mesh<BufferGeometry, MeshBasicMaterial>;
    return { snap, v, input, pad, icon, halo };
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

  it('round the pad, the halo of its light on the floor (H2c): hidden at rest, spilling well past the pad, feathered out, in a lighter tone of its colour', () => {
    const { v, pad, input, halo } = view();
    // Its own mesh, never the pad's child (it never dips), off at rest.
    expect(halo.parent).toBe(input);
    expect(pad.children).not.toContain(halo);
    expect([halo.visible, halo.material.opacity]).toEqual([false, 0]);
    expect(halo.material.transparent).toBe(true);
    expect(halo.material.depthWrite).toBe(false);
    // Flat just over the floor, centred on the pad (4,2), from under the pad's edge out past it on every side: more than
    // three times as far as a zone's halo (0.2), into the cells round it.
    const b = boundsOf(halo);
    const at = centre(4, 2);
    expect(b.max.y - b.min.y).toBeLessThan(1e-6);
    expect(b.min.y).toBeCloseTo(BELT_BUTTON_HALO.lift, 6);
    expect(b.min.y).toBeLessThan(BELT_BUTTON.height);
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(at.x, 6);
    expect((b.min.z + b.max.z) / 2).toBeCloseTo(at.z, 6);
    const spill = (b.max.x - b.min.x) / 2 - BELT_BUTTON.half;
    expect(spill).toBeGreaterThan(0.6);
    expect((b.max.z - b.min.z) / 2 - BELT_BUTTON.half).toBeCloseTo(spill, 6);
    // Feathered: opaque from under the pad's edge, gone at its outer edge, never brighter outward.
    const positions = halo.geometry.getAttribute('position');
    const alpha = halo.geometry.getAttribute('color');
    const reach = (i: number) => Math.max(Math.abs(positions.getX(i)), Math.abs(positions.getZ(i)));
    let inner = 0;
    let outer = 0;
    for (let i = 0; i < positions.count; i++) {
      if (reach(i) < BELT_BUTTON.half) {
        inner++;
        expect(alpha.getW(i)).toBe(1);
      }
      if (reach(i) > BELT_BUTTON.half + spill - 1e-6) {
        outer++;
        expect(alpha.getW(i)).toBe(0);
      }
    }
    expect([inner > 0, outer > 0]).toEqual([true, true]);
    const stops = BELT_BUTTON_HALO.stops.map((s) => s.alpha);
    stops.slice(1).forEach((a, i) => expect(a).toBeLessThan(stops[i]));
    // Its tone: the belt's identity colour, the same hue and saturation, lighter (a light of that colour).
    const hsl = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }, SRGBColorSpace);
    const identity = hsl(new Color(defaultTheme.conveyor.identity[0]));
    const tone = hsl(halo.material.color.clone());
    expect(tone.h).toBeCloseTo(identity.h, 2);
    expect(tone.s).toBeCloseTo(identity.s, 2);
    expect(tone.l).toBeCloseTo(identity.l + BUTTON_FEEL.haloLift, 2);
    expect(halo.material.color.getHex()).toBe(buttonLightTone(defaultTheme.conveyor.identity[0]).getHex());
    v.dispose();
  });

  it('standing on it the pad brightens a little, a faint halo round it (it reads round the forklift); a refused press only flashes, muted', () => {
    const { snap, v, pad, halo } = view();
    const belt = snap.conveyors[0];
    const identity = defaultTheme.conveyor.identity[0];
    let t = 0;
    const frame = () => v.update(snap, 1 / 60, (t += 1 / 60), ANGLE, 0);
    // At rest: no glow; its glow, when it comes, in its own colour.
    expect(pad.material.emissiveIntensity).toBe(0);
    expect(pad.material.emissive.getHex()).toBe(new Color(identity).getHex());
    expect(pad.position.y).toBe(0);
    // Standing on it (the hint names its belt): a slight, steady brightening and a faint halo, off again once it is left.
    snap.hint.button = 'c1';
    for (let i = 0; i < 60; i++) frame();
    expect(pad.material.emissiveIntensity).toBeCloseTo(BUTTON_FEEL.standGlow, 2);
    expect(pad.material.emissiveIntensity).toBeLessThan(0.3);
    expect(halo.visible).toBe(true);
    expect(halo.material.opacity).toBeCloseTo(BUTTON_FEEL.standHalo, 2);
    expect(halo.material.opacity).toBeLessThan(0.4);
    snap.hint.button = null;
    for (let i = 0; i < 90; i++) frame();
    expect([pad.material.emissiveIntensity, halo.material.opacity, halo.visible]).toEqual([0, 0, false]);
    // A refused press: a short, muted flash of the pad and the halo, no dip.
    const out = { glow: [] as number[], halo: [] as number[], dip: [] as number[] };
    belt.presses = 1;
    for (let i = 0; i < 40; i++) {
      frame();
      out.glow.push(pad.material.emissiveIntensity);
      out.halo.push(halo.material.opacity);
      out.dip.push(-pad.position.y);
    }
    expect(Math.max(...out.dip)).toBeCloseTo(0, 12);
    expect(Math.max(...out.glow)).toBeGreaterThan(0.5 * BUTTON_FEEL.refusedFlash);
    expect(Math.max(...out.glow)).toBeLessThanOrEqual(BUTTON_FEEL.refusedFlash + 1e-9);
    expect(Math.max(...out.halo)).toBeGreaterThan(0.5 * BUTTON_FEEL.refusedHalo);
    expect(Math.max(...out.halo)).toBeLessThanOrEqual(BUTTON_FEEL.refusedHalo + 1e-9);
    expect([out.glow.at(-1), out.halo.at(-1), halo.visible]).toEqual([0, 0, false]);
    v.dispose();
  });

  it.each([
    ['60 fps', 1 / 60],
    ['20 fps', 1 / 20],
  ] as const)('%s: an accepted press dips the pad and lights it brightly, pad and halo, within litRise; lit while the belt runs back; faded out smoothly once the box rests on A', (_, dt) => {
    const { snap, v, pad, halo } = view();
    const belt = snap.conveyors[0];
    let t = 0;
    const samples: { t: number; glow: number; halo: number; shown: boolean; dip: number }[] = [];
    const frames = (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / dt); i++) {
        v.update(snap, dt, (t += dt), ANGLE, 0);
        samples.push({ t, glow: pad.material.emissiveIntensity, halo: halo.material.opacity, shown: halo.visible, dip: -pad.position.y });
      }
    };
    // The press accepted: the belt settles back (pressSec), then runs back for a while (as ConveyorSystem.reverse does).
    belt.presses = 1;
    belt.accepted = 1;
    belt.direction = -1;
    belt.phase = 'settling';
    frames(0.3);
    belt.phase = 'running';
    belt.running = true;
    frames(2.4);
    const lit = samples.slice();
    // The box rests on A: the belt at rest again.
    belt.phase = 'idle';
    belt.running = false;
    belt.direction = 1;
    const landed = samples.length;
    frames(1.5);
    const F = BUTTON_FEEL;
    // Bright on the press, within litRise, never in one jump: far brighter than a target's success flash
    // (views/success FLASH_PEAK) and than standing on it, its halo near opaque.
    const up = lit.findIndex((s) => s.glow >= F.litGlow - 1e-9);
    expect(lit[up].t).toBeLessThanOrEqual(F.litRise + dt + 1e-9);
    expect(lit[0].glow).toBeLessThan(0.5 * F.litGlow + 1e-9);
    lit.slice(1, up + 1).forEach((s, i) => expect(s.glow).toBeGreaterThanOrEqual(lit[i].glow));
    expect(F.litGlow).toBeGreaterThan(1.5 * FLASH_PEAK);
    expect(F.litGlow).toBeGreaterThan(4 * F.standGlow);
    expect(F.litHalo).toBeGreaterThan(0.9);
    // Lit all the way back, steady (no flicker); the dip, a quick press and a gentle return, long over.
    for (const s of lit.slice(up)) expect([s.glow, s.halo]).toEqual([expect.closeTo(F.litGlow, 9), expect.closeTo(F.litHalo, 9)]);
    expect(lit.slice(up).every((s) => s.shown)).toBe(true);
    expect(Math.max(...lit.map((s) => s.dip))).toBeCloseTo(BELT_BUTTON.dip, dt < 0.03 ? 3 : 2);
    expect(lit.at(-1)!.dip).toBeCloseTo(0, 12);
    // Once the box rests on A: a smooth fade, never brighter again, gone by litFade.
    const fade = samples.slice(landed);
    fade.slice(1).forEach((s, i) => expect(s.glow).toBeLessThanOrEqual(fade[i].glow));
    expect(fade[0].glow).toBeGreaterThan(0.9 * F.litGlow);
    const out = fade.findIndex((s) => s.glow === 0 && s.halo === 0);
    expect(out).toBeGreaterThan(0);
    expect(fade[out].t - samples[landed - 1].t).toBeLessThanOrEqual(F.litFade + dt + 1e-9);
    expect(fade[out].t - samples[landed - 1].t).toBeGreaterThan(0.6 * F.litFade);
    // Steps no larger than its eased ramp allows (π/2 · dt / litFade of the peak).
    fade.slice(1).forEach((s, i) => expect(fade[i].glow - s.glow).toBeLessThanOrEqual((Math.PI / 2) * (dt / F.litFade) * F.litGlow + 1e-9));
    expect(halo.visible).toBe(false);
    v.dispose();
  });

  it('a level loaded with presses already counted shows the pad at rest (nothing replays)', () => {
    const snap = new GameState(level).getSnapshot();
    snap.conveyors[0].presses = 4;
    snap.conveyors[0].accepted = 2;
    const v = new LevelView(snap, defaultTheme, GAME_CONFIG, ANGLE);
    const input = v.root.children.find((c) => c.userData.beltInId === 'e1')!;
    const pad = input.children.find((c) => c.userData.beltButton !== undefined) as Mesh<BufferGeometry, MeshStandardMaterial>;
    const halo = input.children.find((c) => c.userData.beltButtonHalo !== undefined) as Mesh<BufferGeometry, MeshBasicMaterial>;
    for (let i = 0; i < 10; i++) v.update(snap, 1 / 60, i / 60, ANGLE, 0);
    expect(pad.position.y).toBe(0);
    expect(pad.material.emissiveIntensity).toBe(0);
    expect([halo.visible, halo.material.opacity]).toEqual([false, 0]);
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
