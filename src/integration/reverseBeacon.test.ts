/**
 * Integration check (logic × audio × render): the reverse beeper and the beacon on the forklift's roof follow one
 * signal, `ForkliftState.reversing` (core/reversing). Driven the way Game drives them — the real GameState with the
 * vehicle controls, AudioEngine on fake Web Audio fed `setMotor(sign · speed01, …, reversing)`, the real ForkliftView
 * synced with the snapshot — the beep and the light switch on and off on the same frames; with the beep turned off (B)
 * or everything muted (M) the light keeps doing exactly the same; and the beeps are exactly those the beeper scheduled
 * when it latched the speed on its own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../audio/AudioEngine';
import { BEEPER } from '../audio/beeper';
import { MotorSound } from '../audio/motor';
import { FakeAudioContext, type FakeGain } from '../audio/testing/fakeAudio';
import { GAME_CONFIG } from '../config';
import { REVERSING, signedSpeed01 } from '../core/reversing';
import type { InputFrame, LevelData } from '../core/types';
import { parseLevel } from '../data/asciiLevel';
import { speed01 } from '../game/motor';
import { GameState } from '../logic/GameState';
import { buildForkliftGeometry } from '../render/builders/forklift';
import { createSharedMaterials } from '../render/materials';
import { ResourceBag } from '../render/resources';
import { ForkliftView } from '../render/views/ForkliftView';
import { defaultTheme } from '../themes/default';

/** An open room, the forklift in the middle facing east: room to back up and to drive on. */
const ROOM: LevelData = parseLevel(
  `
# 1 · Marcha atrás
id: marcha-atras
limit: 1

  012345678
0 .........
1 .........
2 .........
3 ....>....
4 .........
5 .........
6 1.......a

1 = zona azul
a = caja azul
`.trim() + '\n',
  'prueba.level',
).level;

const FRAME = 1 / 60;
const CFG = GAME_CONFIG.forklift;
/** A stick barely pushed back: it creeps at 0.6 × the start threshold (inside the latch's band, so it never starts). */
const CREEP = (-0.6 * REVERSING.onSpeed * CFG.maxSpeed) / CFG.reverseSpeed;

/**
 * Seconds of each throttle (W = 1, S = −1, none = 0): back up from rest, coast to a stop, drive forward, brake into
 * reverse, cross over to forward, a light creep back that never gets past the start threshold, then a real one.
 */
const SCRIPT: readonly (readonly [number, number])[] = [
  [0.4, 0],
  [1.4, -1],
  [1.2, 0],
  [1.0, 1],
  [1.5, -1],
  [1.2, 1],
  [1.4, 0],
  [1.0, CREEP],
  [0.8, -1],
  [2.5, 0],
];

interface Frame {
  reversing: boolean;
  /** The engine's beeper beeping (MotorSound.reversing), and a bare one that latches the speed itself. */
  beeping: boolean;
  plain: boolean;
  beacon: number;
}

type Envelopes = { env: FakeGain; octaveEnv: FakeGain };
const beeperOf = (motor: MotorSound) => (motor as unknown as { beeper: Envelopes }).beeper;

/** Plays SCRIPT like Game.step does; `beep` / `muted` = the player's B and M settings. */
async function drive(beep = true, muted = false) {
  const engine = new AudioEngine();
  engine.setReverseBeep(beep);
  engine.setMuted(muted);
  await engine.unlock();
  const rt = (engine as unknown as { rt: { motor: MotorSound; ctx: FakeAudioContext } }).rt;
  // A bare MotorSound on its own clock: the beeper latching the speed itself, as before the shared latch.
  const plainCtx = new FakeAudioContext();
  const plain = new MotorSound(plainCtx.asContext(), plainCtx.createGain() as unknown as AudioNode);

  const state = new GameState(ROOM);
  const snap = state.getSnapshot();
  const f = snap.forklift;
  const view = new ForkliftView(
    buildForkliftGeometry(defaultTheme, { wheelRadius: CFG.wheelRadius, forkReach: CFG.forkReach, boxSize: GAME_CONFIG.box.size }),
    createSharedMaterials(new ResourceBag()),
    { maxSpeed: CFG.maxSpeed, wheelRadius: CFG.wheelRadius, forkReach: CFG.forkReach },
    f,
  );
  const input: InputFrame & { drive: { throttle: number; steer: number } } = { move: { x: 0, z: 0 }, drive: { throttle: 0, steer: 0 }, actionPressed: false };
  const frames: Frame[] = [];
  let t = 0;
  for (const [sec, throttle] of SCRIPT) {
    input.drive.throttle = throttle;
    for (let i = 0; i < Math.round(sec / FRAME); i++) {
      state.update(FRAME, input);
      const signed = Math.sign(f.speed) * speed01(f.speed, CFG.maxSpeed);
      expect(signed).toBe(signedSpeed01(f.speed, CFG.maxSpeed)); // the latch reads exactly what Game hands the motor
      rt.ctx.currentTime += FRAME;
      plainCtx.currentTime += FRAME;
      t += FRAME;
      engine.setMotor(signed, 0, f.forkHeight, f.reversing);
      plain.set(signed, 0, f.forkHeight);
      view.sync(f, FRAME, t);
      frames.push({ reversing: f.reversing === true, beeping: rt.motor.reversing, plain: plain.reversing, beacon: view.beaconLevel });
    }
  }
  const result = { frames, engine, beeper: beeperOf(rt.motor), plainBeeper: beeperOf(plain) };
  engine.dispose();
  return result;
}

/** The beacon eases toward the latch every frame: up (lit) while reversing, down while not, from that very frame. */
function expectBeaconFollows(frames: readonly Frame[]): void {
  for (let i = 1; i < frames.length; i++) {
    const { reversing, beacon } = frames[i];
    const prev = frames[i - 1];
    if (reversing) {
      expect(beacon, `frame ${i}`).toBeGreaterThan(0);
      expect(beacon, `frame ${i}`).toBeGreaterThanOrEqual(prev.beacon);
      if (!prev.reversing) expect(beacon, `frame ${i}: lights as the latch turns on`).toBeGreaterThan(prev.beacon);
    } else {
      expect(beacon, `frame ${i}`).toBeLessThanOrEqual(prev.beacon);
      if (prev.reversing) expect(beacon, `frame ${i}: dims as the latch turns off`).toBeLessThan(prev.beacon);
    }
  }
}

/** The frames where the latch turns on / off. */
function switches(frames: readonly Frame[]): { on: number[]; off: number[] } {
  const on: number[] = [];
  const off: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].reversing && !frames[i - 1].reversing) on.push(i);
    if (!frames[i].reversing && frames[i - 1].reversing) off.push(i);
  }
  return { on, off };
}

const strikes = (env: FakeGain) => env.gain.events.filter((e) => e.kind === 'target' && e.value === BEEPER.level);

describe('reverse beeper and roof beacon', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.instances.length = 0;
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('beep and light switch on and off on the same frames, and the beeps are the ones the beeper latched itself', async () => {
    const { frames, beeper, plainBeeper } = await drive();
    const { on, off } = switches(frames);
    // S from rest, the brake into reverse and the last real back-up: three times on, three times off (the creep never).
    expect(on).toHaveLength(3);
    expect(off).toHaveLength(3);
    frames.forEach((fr, i) => {
      expect(fr.beeping, `frame ${i}`).toBe(fr.reversing);
      expect(fr.plain, `frame ${i}`).toBe(fr.reversing);
    });
    expectBeaconFollows(frames);
    // Off at rest before, lit while backing up, hidden again at the end.
    expect(frames[on[0] - 1].beacon).toBe(0);
    expect(Math.max(...frames.slice(on[0], off[0]).map((fr) => fr.beacon))).toBeGreaterThan(0.95);
    expect(frames.at(-1)!.beacon).toBe(0);
    // The sound itself is untouched: the very same automation, strike for strike.
    expect(strikes(beeper.env).length).toBeGreaterThanOrEqual(4);
    expect(beeper.env.gain.events).toEqual(plainBeeper.env.gain.events);
    expect(beeper.octaveEnv.gain.events).toEqual(plainBeeper.octaveEnv.gain.events);
  });

  it('with the beep turned off (B) the forklift backs up in silence, and the light still comes and goes on those frames', async () => {
    const lit = await drive(true);
    const silent = await drive(false);
    expect(silent.frames.map((fr) => fr.reversing)).toEqual(lit.frames.map((fr) => fr.reversing));
    expect(silent.frames.every((fr) => !fr.beeping)).toBe(true);
    expect(silent.beeper.env.gain.events).toHaveLength(0); // not a single strike scheduled
    expect(silent.frames.map((fr) => fr.beacon)).toEqual(lit.frames.map((fr) => fr.beacon));
    expectBeaconFollows(silent.frames);
  });

  it('muted (M) everything is silent, and the light still comes and goes on the same frames', async () => {
    const lit = await drive(true);
    const muted = await drive(true, true);
    expect(muted.engine.isMuted()).toBe(true);
    // Mute only closes the master gain: the beeper keeps its rhythm underneath (back on the beat when M is undone).
    muted.frames.forEach((fr, i) => expect(fr.beeping, `frame ${i}`).toBe(fr.reversing));
    expect(muted.frames.map((fr) => fr.beacon)).toEqual(lit.frames.map((fr) => fr.beacon));
    expectBeaconFollows(muted.frames);
  });
});
