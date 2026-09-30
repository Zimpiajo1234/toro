import { Color, Mesh, type BufferGeometry, type MeshBasicMaterial, type MeshStandardMaterial, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../config';
import { accepts, isDestined } from '../core/sorting';
import type { BoxState, GameSnapshot, LevelData, SlotState, ZoneState } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { validateLevel } from '../data/validateLevel';
import { GameState } from '../logic/GameState';
import { defaultTheme } from '../themes/default';
import { LevelView } from './LevelView';
import { DROP_GLIDE_SEC, LOCK_DELAY, lockTintOf } from './views/BoxView';
import { FLASH_PEAK, INVITE_RATE, TARGET_REST } from './views/success';

/*
 * The optional target hints (Settings.targetHints, P; off by default; LevelView.setTargetHints): only with them on do
 * the destinations of the carried box light up, in every kind of level: the zones that take it (the gentle breathing of
 * the classic levels, the strong pulse and halo of the levels with racks), the recipe step it would fill, the empty rack
 * slots whose cue fits it, the loadable truck levels whose cue fits it, and the faint swap hint. Toggled while a box is
 * carried, that light eases in and out. Never gated: the success flash and soft glow, the locked box tone, the drop
 * preview's tone and the slot marker. Hand-driven snapshots (the view only reads them); layouts are inline.
 */

const level = (text: string): LevelData => parseLevel(`${text.trim()}\n`, 'prueba.level').level;

/** Classic: colour zones only. */
const CLASSIC = validateLevel({
  id: 'pistas-clasico',
  order: 1,
  name: 'Clásico',
  size: { width: 8, depth: 6 },
  forklift: { x: 1, z: 3, heading: 90 },
  boxes: [
    { id: 'b1', color: 'blue', x: 3, z: 3 },
    { id: 'b2', color: 'mint', x: 5, z: 1 },
  ],
  zones: [
    { id: 'z1', color: 'blue', x: 6, z: 3 },
    { id: 'z2', color: 'mint', x: 2, z: 1 },
  ],
  decor: { plants: [], windows: [] },
});

/** A stack zone (blue base already down, mint on top next). */
const STACK = validateLevel({
  id: 'pistas-pila',
  order: 1,
  name: 'Pila',
  size: { width: 9, depth: 5 },
  forklift: { x: 2, z: 2, heading: 90 },
  boxes: [
    { id: 'm', color: 'mint', x: 3, z: 2 },
    { id: 'b', color: 'blue', x: 5, z: 2 },
  ],
  zones: [{ id: 'z', color: 'blue', x: 5, z: 2, recipe: ['blue', 'mint'] }],
  decor: { plants: [], windows: [] },
});

/** Sorting by colour and symbol: two «▲» zones, «azul ■» and «azul». */
const SORTING = level(`
# 1 · La muestra
id: la-muestra
limit: 1
ventanas: norte 2-4, oeste 3-4

  0123456789
0 p.........
1 .1.2.3.4..
2 ..........
3 ..........
4 ....b..a..
5 ..c.......
6 .....d.^.p

1 2 = zona ▲        3 = zona azul ■     4 = zona azul
a = caja azul ▲     b = caja azul ■     c = caja menta ▲    d = caja azul ●
`);

/** A rack, front to the south: column 0 «azul» / «▲» / libre, column 1 «amarillo ■» / libre. */
const RACK = level(`
# 2 · Estantería
id: pistas-estanteria
limit: 1

  0123456
0 .......
1 .......
2 ...RR..
3 .......
4 .a.b.c.
5 ...^...

a = caja azul ▲       b = caja menta ▲       c = caja amarillo ■
R = estantería frente sur: azul / ▲ / libre | amarillo ■ / libre
`);

/** A rack level's floor zone «▲» (mint ▲'s; blue ▲ goes to the «azul» slot). */
const RACK_ZONE = level(`
# 3 · Zona y estantería
id: pistas-zona-estanteria
limit: 1

  0123456
0 .......
1 .......
2 ...R...
3 .......
4 .a.b.1.
5 ...^...

1 = zona ▲
a = caja azul ▲       b = caja menta ▲
R = estantería frente sur: azul
`);

/** A one-column north dock: «azul» / «▲» (azul ▲ below, menta ▲ over it; the azul ■ is the zone's). */
const TRUCK = level(`
# 4 · Muelle
id: pistas-muelle
limit: 2

  012345
0 ...T..
1 ......
2 .a.cb.
3 ..^..1

1 = zona ■
a = caja azul ▲        b = caja azul ■        c = caja menta ▲
T = camión muelle norte: azul / ▲
`);

const YAW = Math.PI / 4;
const FRAME = 1 / 60;

/** Advance `view` by `seconds` in 60 fps frames from time `t0`, calling `each` after every frame. */
function run(view: LevelView, snap: GameSnapshot, seconds: number, t0 = 0, each?: () => void): void {
  for (let i = 0; i < Math.round(seconds * 60); i++) {
    view.update(snap, FRAME, t0 + i * FRAME, YAW, 0);
    each?.();
  }
}

const lit = (m: Object3D) => m as Mesh<BufferGeometry, MeshStandardMaterial>;
const unlit = (m: Object3D) => m as Mesh<BufferGeometry, MeshBasicMaterial>;
/** An overlay's opacity as seen (0 while hidden). */
const shown = (m: Object3D) => (m.visible ? unlit(m).material.opacity : 0);

/**
 * Every light a carried box could turn on, by name: each zone's pad glow, halo and recipe steps; each rack slot's panel
 * glow, glow band and cue brightening; each truck level's sign panel, band and sticker brightening.
 */
function lights(view: LevelView): Map<string, number> {
  const out = new Map<string, number>();
  for (const group of view.root.children) {
    const zoneId = group.userData.zoneId as string | undefined;
    if (zoneId !== undefined) {
      // ZoneView: halo, pad, ring, then the recipe (a cream base and one mesh per step).
      const [halo, pad, , , ...steps] = group.children;
      out.set(`zone:${zoneId}:halo`, shown(halo));
      out.set(`zone:${zoneId}:pad`, lit(pad).material.emissiveIntensity);
      steps.forEach((step, i) => out.set(`zone:${zoneId}:step${i + 1}`, lit(step).material.emissiveIntensity));
    }
    if (group.userData.rackId !== undefined || group.userData.truckId !== undefined) {
      for (const m of group.children) {
        const d = m.userData;
        if (d.slotId) out.set(`slot:${d.slotId}:panel`, lit(m).material.emissiveIntensity);
        if (d.slotGlow) out.set(`slot:${d.slotGlow}:band`, shown(m));
        if (d.slotCue) out.set(`slot:${d.slotCue}:cue`, unlit(m).material.color.r - 1);
        if (d.signPanel) out.set(`sign:${d.signPanel}:panel`, lit(m).material.emissiveIntensity);
        if (d.truckGlow) out.set(`sign:${d.truckGlow}:band`, shown(m));
        if (d.truckCue) out.set(`sign:${d.truckCue}:cue`, unlit(m).material.color.r - 1);
      }
    }
  }
  return out;
}

/** Highest value of every light over `seconds`. */
function peakLights(view: LevelView, snap: GameSnapshot, seconds: number, t0: number): Map<string, number> {
  const peak = new Map<string, number>();
  run(view, snap, seconds, t0, () => {
    for (const [k, v] of lights(view)) peak.set(k, Math.max(peak.get(k) ?? -Infinity, v));
  });
  return peak;
}

const boxById = (snap: GameSnapshot, id: string) => snap.boxes.find((b) => b.id === id)!;
const boxOf = (snap: GameSnapshot, color: string, symbol: string) => snap.boxes.find((b) => b.color === color && b.symbol === symbol)!;
const zoneOf = (snap: GameSnapshot, color: string | undefined, symbol: string | undefined, nth = 0) =>
  snap.zones.filter((z) => z.accepts.color === color && z.accepts.symbol === symbol)[nth];
const slotOf = (snap: GameSnapshot, id: string) => snap.slots.find((s) => s.id === id)!;
const colorDistance = (a: Color, b: Color) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

/** Lift `box` onto the forks (freeing its zone or slot). */
function carry(snap: GameSnapshot, box: BoxState): void {
  for (const s of snap.slots) if (s.occupiedBy === box.id) Object.assign(s, { occupiedBy: null, satisfied: false });
  Object.assign(box, { carried: true, cell: null, level: 0, slotId: null, zoneId: null, correct: false, locked: false });
  snap.forklift.carrying = box.id;
  snap.forklift.forkLift = 1;
}
/** Rest `box` alone on `zone`, as logic would publish the drop. */
function restOnZone(snap: GameSnapshot, box: BoxState, zone: ZoneState): void {
  const right = snap.slots.length > 0 ? isDestined(zone, box) : accepts(zone, box);
  Object.assign(box, { carried: false, cell: { ...zone.cell }, pos: { ...zone.pos }, level: 0, slotId: null, zoneId: zone.id, correct: right, locked: right && snap.slots.length > 0 });
  Object.assign(zone, { stack: [box.id], occupiedBy: box.id, satisfied: right, next: null });
  if (snap.forklift.carrying === box.id) snap.forklift.carrying = null;
}
/** Rest `box` in rack `slot`, as logic would publish the drop. */
function restInSlot(snap: GameSnapshot, box: BoxState, slot: SlotState): void {
  const destined = isDestined(slot, box);
  Object.assign(box, { carried: false, cell: { ...slot.cell }, pos: { ...slot.pos }, level: slot.level, slotId: slot.id, zoneId: null, correct: destined, locked: destined });
  Object.assign(slot, { occupiedBy: box.id, satisfied: destined });
  if (snap.forklift.carrying === box.id) snap.forklift.carrying = null;
}

/** A pick-up the hints answer: the level, what is in place first, the box picked and how much each light then rises. */
interface Scenario {
  name: string;
  level: LevelData;
  arrange?: (snap: GameSnapshot) => void;
  pick: (snap: GameSnapshot) => BoxState;
  /** Lights the hints turn on for that box, with the least they rise over their rest. */
  rises: (snap: GameSnapshot) => Record<string, number>;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'classic zone (gentle breathing)',
    level: CLASSIC,
    pick: (s) => boxById(s, 'b1'),
    rises: () => ({ 'zone:z1:pad': 0.1 }),
  },
  {
    name: 'stack zone and the recipe step the box would fill',
    level: STACK,
    pick: (s) => boxById(s, 'm'),
    rises: () => ({ 'zone:z:pad': 0.1, 'zone:z:step2': 0.04 }),
  },
  {
    name: 'sorting: every free zone that accepts it',
    level: SORTING,
    pick: (s) => boxOf(s, 'blue', 'triangle'),
    rises: (s) => ({
      [`zone:${zoneOf(s, undefined, 'triangle', 0).id}:pad`]: 0.1,
      [`zone:${zoneOf(s, undefined, 'triangle', 1).id}:pad`]: 0.1,
      [`zone:${zoneOf(s, 'blue', undefined).id}:pad`]: 0.1,
    }),
  },
  {
    name: 'sorting: the faint swap hint',
    level: SORTING,
    arrange: (s) => {
      restOnZone(s, boxOf(s, 'blue', 'triangle'), zoneOf(s, 'blue', undefined));
      restOnZone(s, boxOf(s, 'blue', 'square'), zoneOf(s, 'blue', 'square'));
      restOnZone(s, boxOf(s, 'mint', 'triangle'), zoneOf(s, undefined, 'triangle', 0));
    },
    pick: (s) => boxOf(s, 'blue', 'circle'),
    rises: (s) => ({ [`zone:${zoneOf(s, 'blue', undefined).id}:pad`]: 0.02 }),
  },
  {
    name: 'rack slots whose cue fits (the strong pulse, its band and cue)',
    level: RACK,
    pick: (s) => boxOf(s, 'blue', 'triangle'),
    rises: () => ({
      'slot:r1:0:0:panel': 0.5,
      'slot:r1:0:0:band': 0.3,
      'slot:r1:0:0:cue': 0.3,
      'slot:r1:0:1:panel': 0.5,
      'slot:r1:0:1:band': 0.3,
    }),
  },
  {
    name: 'rack slots: the faint swap hint on an occupied one',
    level: RACK,
    arrange: (s) => restInSlot(s, boxOf(s, 'blue', 'triangle'), slotOf(s, 'r1:0:1')),
    pick: (s) => boxOf(s, 'mint', 'triangle'),
    rises: () => ({ 'slot:r1:0:1:panel': 0.01 }),
  },
  {
    name: 'a rack level’s floor zone (its pulse and halo)',
    level: RACK_ZONE,
    pick: (s) => boxOf(s, 'mint', 'triangle'),
    rises: (s) => ({ [`zone:${s.zones[0].id}:pad`]: 0.5, [`zone:${s.zones[0].id}:halo`]: 0.7 }),
  },
  {
    name: 'the loadable truck level whose cue fits, on the dock sign',
    level: TRUCK,
    pick: (s) => boxOf(s, 'blue', 'triangle'),
    rises: () => ({ 'sign:t1:0:0:panel': 0.24, 'sign:t1:0:0:band': 0.3, 'sign:t1:0:0:cue': 0.2 }),
  },
];

/** Plays a scenario: settles what is in place, then carries the box for 3 s. Lights at rest before, peaks during. */
function play(s: Scenario, hints: boolean | 'default') {
  const snap = new GameState(s.level).getSnapshot();
  const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
  if (hints !== 'default') view.setTargetHints(hints);
  s.arrange?.(snap);
  run(view, snap, 3); // whatever that set off settles (celebrations, flashes)
  const rest = lights(view);
  carry(snap, s.pick(snap));
  const peak = peakLights(view, snap, 3, 3);
  view.dispose();
  return { snap, rest, peak };
}

describe('target hints (P): off by default, nothing lights up on a pick-up', () => {
  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s: dark with the hints off, lit as always with them on', (_, s) => {
    for (const hints of ['default', false] as const) {
      const { rest, peak } = play(s, hints);
      expect(rest.size).toBeGreaterThan(0);
      for (const [key, value] of peak) expect(value, `${key} (hints ${hints})`).toBeLessThan(rest.get(key)! + 0.005);
    }
    const { snap, rest, peak } = play(s, true);
    for (const [key, rise] of Object.entries(s.rises(snap))) {
      expect(peak.get(key), key).toBeGreaterThan(rest.get(key)! + rise);
    }
  });
});

describe('target hints (P): toggled while a box is carried, the light eases in and out', () => {
  /** A crest of the invitation's pulse (every breathing and pulse runs at INVITE_RATE): a pop there is a full one. */
  const crest = (k: number) => (Math.PI / 2 + 2 * Math.PI * k) / INVITE_RATE;
  /** Run 60 fps frames from `t0` to just before `t1`: each light's largest one-frame change, and its peak. */
  const watch = (view: LevelView, snap: GameSnapshot, t0: number, t1: number) => {
    const steps = new Map<string, number>();
    const peak = new Map<string, number>();
    let last = lights(view);
    run(view, snap, t1 - t0, t0, () => {
      const now = lights(view);
      for (const [k, v] of now) {
        steps.set(k, Math.max(steps.get(k) ?? 0, Math.abs(v - last.get(k)!)));
        peak.set(k, Math.max(peak.get(k) ?? -Infinity, v));
      }
      last = now;
    });
    return { steps, peak };
  };

  it.each(SCENARIOS.map((s) => [s.name, s] as const))('%s: no pop either way', (_, s) => {
    const snap = new GameState(s.level).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    s.arrange?.(snap);
    run(view, snap, 3);
    const rest = lights(view);
    carry(snap, s.pick(snap));
    const on = crest(2);
    const off = crest(5);
    run(view, snap, on - 3, 3); // carried, hints off: dark
    const keys = Object.entries(s.rises(snap));
    for (const [key] of keys) expect(lights(view).get(key)!, key).toBeLessThan(rest.get(key)! + 0.005);

    // On mid-carry, at a crest of the pulse: it comes in over a second or two, never in one frame.
    view.setTargetHints(true);
    const fadeIn = watch(view, snap, on, off);
    // Off mid-carry, at a crest again: it lets go the same way, from where it was, down to its rest.
    view.setTargetHints(false);
    const fadeOut = watch(view, snap, off, off + 3);
    for (const [key, rise] of keys) {
      const lift = fadeIn.peak.get(key)! - rest.get(key)!;
      expect(lift, key).toBeGreaterThan(rise);
      // A pop would move it by its whole lift in one frame; easing, about a twentieth of it.
      expect(fadeIn.steps.get(key)!, `${key} easing in`).toBeLessThan(lift * 0.25);
      expect(fadeOut.steps.get(key)!, `${key} easing out`).toBeLessThan(lift * 0.25);
      expect(lights(view).get(key)!, key).toBeLessThan(rest.get(key)! + 0.005);
    }
    // No light anywhere jumps (the faintest full invitation is ≈ 0.05, the classic breathing ≈ 0.17).
    expect(Math.max(...fadeIn.steps.values(), ...fadeOut.steps.values())).toBeLessThan(0.05);
    view.dispose();
  });

  it('a level loaded later keeps the setting (GameRenderer hands it to every new LevelView)', () => {
    // LevelView starts dark; the renderer calls setTargetHints right after building it (GameRenderer.loadLevel).
    const snap = new GameState(CLASSIC).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    carry(snap, boxById(snap, 'b1'));
    expect(peakLights(view, snap, 2, 0).get('zone:z1:pad')!).toBeLessThan(0.005);
    view.setTargetHints(true);
    expect(peakLights(view, snap, 3, 2).get('zone:z1:pad')!).toBeGreaterThan(0.1);
    view.dispose();
  });
});

describe('target hints (P): what the setting never touches', () => {
  it('with the hints off, the drop preview and the slot marker still take the box tone where its cue fits', () => {
    const snap = new GameState(RACK).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    const preview = view.root.children.find((c) => c.userData.dropPreview)! as Mesh<BufferGeometry, MeshBasicMaterial>;
    const marker = view.root.children.find((c) => c.userData.slotMarker)! as Mesh<BufferGeometry, MeshBasicMaterial>;
    const blueBorder = new Color(defaultTheme.zones.blue.border);
    const blue = boxOf(snap, 'blue', 'triangle');
    carry(snap, blue);
    const slot = slotOf(snap, 'r1:0:0');
    snap.hint.rack = { rackId: 'r1', column: 0, levels: 3, level: 0, slotId: slot.id, ready: true };
    snap.hint.dropCell = { ...slot.cell };
    snap.hint.dropLevel = 0;
    const peak = peakLights(view, snap, 1.5, 0);
    expect(peak.get('slot:r1:0:0:panel')!).toBeLessThan(0.005); // no pulse
    expect(preview.visible).toBe(true);
    expect(colorDistance(preview.material.color, blueBorder)).toBeLessThan(1e-2);
    expect(marker.material.opacity).toBeGreaterThan(0.7);
    expect(colorDistance(marker.material.color, blueBorder)).toBeLessThan(1e-2);

    // A classic zone that takes the carried box: the preview's tone too.
    const classic = new GameState(CLASSIC).getSnapshot();
    const plain = new LevelView(classic, defaultTheme, GAME_CONFIG, YAW);
    const outline = plain.root.children.find((c) => c.userData.dropPreview)! as Mesh<BufferGeometry, MeshBasicMaterial>;
    carry(classic, boxById(classic, 'b1'));
    Object.assign(classic.hint, { dropCell: { ...classic.zones[0].cell }, dropZoneId: 'z1', dropLevel: 0 });
    run(plain, classic, 1);
    expect(colorDistance(outline.material.color, blueBorder)).toBeLessThan(1e-2);
    view.dispose();
    plain.dispose();
  });

  it('with the hints off, a destined drop still flashes, settles to its soft glow and deepens the box', () => {
    const snap = new GameState(RACK).getSnapshot();
    const view = new LevelView(snap, defaultTheme, GAME_CONFIG, YAW);
    const blue = boxOf(snap, 'blue', 'triangle');
    carry(snap, blue);
    run(view, snap, 1);
    restInSlot(snap, blue, slotOf(snap, 'r1:0:0'));
    const flash = peakLights(view, snap, DROP_GLIDE_SEC + 0.3, 1);
    expect(flash.get('slot:r1:0:0:panel')!).toBeGreaterThan(FLASH_PEAK * 0.9);
    expect(flash.get('slot:r1:0:0:band')!).toBeGreaterThan(0.8);
    run(view, snap, LOCK_DELAY + 1.5, 2);
    expect(lights(view).get('slot:r1:0:0:panel')!).toBeCloseTo(TARGET_REST, 2);
    const box = view.root.children.find((c) => c.userData.boxId === blue.id)!.children[0] as Mesh<BufferGeometry, MeshStandardMaterial>;
    expect(colorDistance(box.material.color, lockTintOf(defaultTheme.boxes.blue))).toBeLessThan(1e-3);

    // A classic zone keeps its celebration and rest glow as well.
    const classic = new GameState(CLASSIC).getSnapshot();
    const plain = new LevelView(classic, defaultTheme, GAME_CONFIG, YAW);
    const b1 = boxById(classic, 'b1');
    carry(classic, b1);
    run(plain, classic, 1);
    restOnZone(classic, b1, classic.zones[0]);
    const glow = peakLights(plain, classic, 2, 1);
    expect(glow.get('zone:z1:pad')!).toBeGreaterThan(0.3);
    expect(lights(plain).get('zone:z1:pad')!).toBeCloseTo(0.15, 2);
    view.dispose();
    plain.dispose();
  });
});
