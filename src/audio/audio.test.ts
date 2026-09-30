import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AudioEngine,
  COMPLETE_AFTER_LAND_SEC,
  DROP_LAND_SEC,
  isWrongTarget,
  RELEASE_AFTER_LAND_SEC,
  RESTORE_AFTER_PICK_SEC,
  WRONG_AFTER_LAND_SEC,
} from './AudioEngine';
import type { AudioGraph } from './graph';
import { BellInstrument } from './instruments/bell';
import { PadInstrument } from './instruments/pad';
import { WOOD_LOWPASS_HZ, WoodInstrument } from './instruments/wood';
import { completionArpeggio, midiToFreq } from './music/harmony';
import { biquadQ, filter } from './nodes';
import { centsToRatio, chance, mulberry32, pick, range, vary, weightedIndex } from './random';
import { CLUNK, MotorSound } from './motor';
import { beepFrequency } from './beeper';
import {
  BEAM_LOWPASS_HZ,
  BEAM_MODES,
  SfxPlayer,
  TRUCK_BED_CAVITY_HZ,
  TRUCK_BED_LOWPASS_HZ,
  TRUCK_BED_MODES,
  TRUCK_BED_SAG,
  WRONG_BUZZ_DETUNE,
  WRONG_BUZZ_LOWPASS_HZ,
  WRONG_BUZZ_SAG,
} from './sfx';
import {
  FakeAudioContext,
  FakeBiquad,
  FakeBufferSource,
  FakeEventTarget,
  FakeGain,
  FakeOscillator,
  type FakeParam,
} from './testing/fakeAudio';
import { VoicePool, type Voice } from './voices';

describe('random helpers', () => {
  it('mulberry32 is deterministic and uniform-ish', () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    let sum = 0;
    for (let i = 0; i < 2000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 2000).toBeGreaterThan(0.45);
    expect(sum / 2000).toBeLessThan(0.55);
  });

  it('vary / range / pick / chance stay within bounds', () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 500; i++) {
      const v = vary(rng, 100, 0.05);
      expect(v).toBeGreaterThanOrEqual(95);
      expect(v).toBeLessThanOrEqual(105);
      const r = range(rng, 2, 3);
      expect(r).toBeGreaterThanOrEqual(2);
      expect(r).toBeLessThan(3);
      expect(['a', 'b', 'c']).toContain(pick(rng, ['a', 'b', 'c']));
    }
    expect(chance(rng, 0)).toBe(false);
    expect(chance(rng, 1)).toBe(true);
    expect(centsToRatio(1200)).toBeCloseTo(2, 9);
  });

  it('weightedIndex follows weights and ignores zero weights', () => {
    const rng = mulberry32(2);
    const counts = [0, 0, 0];
    for (let i = 0; i < 3000; i++) counts[weightedIndex(rng, [1, 0, 3])]++;
    expect(counts[1]).toBe(0);
    expect(counts[2]).toBeGreaterThan(counts[0] * 2);
    expect(weightedIndex(rng, [0, 0])).toBe(0);
  });
});

describe('VoicePool', () => {
  it('bounds polyphony by releasing the oldest voice', () => {
    const released: number[] = [];
    const make = (id: number): Voice => ({ release: () => released.push(id) });
    const pool = new VoicePool(3);
    const voices = [0, 1, 2, 3, 4].map(make);
    voices.forEach((v) => pool.add(v, 0));
    expect(pool.size).toBe(3);
    expect(released).toEqual([0, 1]);
    pool.remove(voices[3]);
    pool.remove(voices[0]); // already gone: no-op
    expect(pool.size).toBe(2);
    pool.releaseAll(1);
    expect(released).toEqual([0, 1, 2, 4]);
    expect(pool.size).toBe(0);
  });
});

describe('AudioEngine without Web Audio', () => {
  it('is a silent no-op that never throws', async () => {
    const engine = new AudioEngine();
    expect(engine.isMuted()).toBe(false);
    engine.setMuted(true);
    expect(engine.isMuted()).toBe(true);
    await expect(engine.unlock()).resolves.toBeUndefined();
    await expect(engine.unlock()).resolves.toBeUndefined();
    engine.setScene('playing');
    engine.setMotor(0.5, 0.2);
    engine.setMotor(0.5, 0.2, 1.5);
    engine.setMotor(Number.NaN, -1, Number.NaN);
    engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 0 });
    engine.handleEvent({ type: 'boxDropped', boxId: 'b', cell: { x: 1, z: 1 }, zoneId: 'z', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 2 });
    engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 1, fromSlotId: 'r1:0:1' });
    engine.handleEvent({ type: 'boxDropped', boxId: 'b', cell: { x: 1, z: 1 }, zoneId: null, level: 1, correct: true, recipeLength: 1, satisfiedCount: 2, total: 2, slotId: 'r1:0:1' });
    engine.handleEvent({ type: 'levelComplete' });
    engine.uiClick();
    engine.forkClick(1, 1);
    expect(engine.getDebugInfo().state).toBe('unavailable');
    engine.setMuted(false);
    expect(engine.isMuted()).toBe(false);
    engine.dispose();
    engine.dispose();
    engine.uiClick();
    await expect(engine.unlock()).resolves.toBeUndefined();
  });
});

describe('filter()', () => {
  it('writes low/high-pass Q in dB, so a linear q keeps its textbook meaning (no resonant bump)', () => {
    const ctx = new FakeAudioContext().asContext();
    expect(filter(ctx, 'lowpass', 10000, Math.SQRT1_2).Q.value).toBeCloseTo(-3.01, 2);
    expect(filter(ctx, 'lowpass', 3000, 0.5).Q.value).toBeCloseTo(-6.02, 2);
    expect(filter(ctx, 'highpass', 6200, 0.5).Q.value).toBeCloseTo(-6.02, 2);
    expect(filter(ctx, 'bandpass', 1150, 3.2).Q.value).toBe(3.2);
    expect(filter(ctx, 'peaking', 210, 0.9).Q.value).toBe(0.9);
    expect(Number.isFinite(biquadQ('lowpass', 0))).toBe(true);
  });
});

describe('PadInstrument sub-bass', () => {
  const bassEnvelope = (ctx: FakeAudioContext, midi: number): FakeParam => {
    const f = midiToFreq(midi);
    const sub = ctx.ofKind(FakeOscillator).find((o) => Math.abs(o.frequency.value - f) < 1e-9);
    return (sub?.outputs[0] as FakeGain).gain;
  };
  const releases = (env: FakeParam) => env.events.filter((e) => e.kind === 'target' && e.value === 0);

  it('attacks quickly and hands over before the chord releases in monophonic mode', () => {
    const ctx = new FakeAudioContext();
    const pad = new PadInstrument(ctx.asContext(), ctx.createGain() as unknown as AudioNode, mulberry32(3));
    pad.play([57, 64, 67], 45, 1, 3.68, 1, { bassOverlap: 0.25 });
    const env = bassEnvelope(ctx, 45);
    expect(env.events.find((e) => e.kind === 'linear')?.time).toBeCloseTo(1.2, 9);
    const [release] = releases(env);
    expect(release.time).toBeCloseTo(1 + 3.68 - 0.25, 9);
    expect(release.tau).toBeLessThanOrEqual(0.15);
  });

  it('keeps its long tail with the chord otherwise', () => {
    const ctx = new FakeAudioContext();
    const pad = new PadInstrument(ctx.asContext(), ctx.createGain() as unknown as AudioNode, mulberry32(3));
    pad.play([48, 59, 62, 64], 36, 1, 3, 0.9, { release: 1.3 });
    const env = bassEnvelope(ctx, 36);
    expect(env.events.find((e) => e.kind === 'linear')?.time).toBeCloseTo(1.35, 9);
    const [release] = releases(env);
    expect(release.time).toBeCloseTo(4, 9);
    expect(release.tau).toBe(0.5);
  });
});

describe('SfxPlayer', () => {
  afterEach(() => vi.restoreAllMocks());

  function setup() {
    const ctx = new FakeAudioContext();
    const noise = ctx.createBuffer(1, 16000, 8000) as unknown as AudioBuffer;
    const sfx = new SfxPlayer(ctx.asContext(), ctx.createGain() as unknown as AudioNode, noise, mulberry32(4));
    return { ctx, sfx };
  }

  it('drop reaches small speakers: energy above 200 Hz and a softer sub body', () => {
    const { ctx, sfx } = setup();
    sfx.drop(0, null);
    const oscs = ctx.ofKind(FakeOscillator);
    expect(oscs.some((o) => o.frequency.value > 200)).toBe(true);
    const bands = ctx.ofKind(FakeBiquad).filter((b) => b.type === 'bandpass');
    expect(bands.some((b) => b.frequency.value > 500 && b.frequency.value < 700)).toBe(true);
    const sub = oscs.find((o) => o.frequency.value < 130);
    const lp = sub?.outputs[0] as FakeBiquad;
    const env = lp.outputs[0] as FakeGain;
    const peak = env.gain.events.find((e) => e.kind === 'linear')?.value ?? 1;
    expect(peak).toBeLessThanOrEqual(0.32);
  });

  it('a drop on a box knocks lighter and higher per level; a completed stack climbs into its chime', () => {
    const bandsOf = (level: number) => {
      const { ctx, sfx } = setup();
      sfx.drop(0, null, false, level);
      return ctx.ofKind(FakeBiquad).filter((b) => b.type === 'bandpass').map((b) => b.frequency.value);
    };
    const floor = Math.max(...bandsOf(0));
    const one = Math.max(...bandsOf(1));
    const two = Math.max(...bandsOf(2));
    expect(one).toBeGreaterThan(floor);
    expect(two).toBeGreaterThan(one);
    expect(two).toBeLessThan(1400); // soft, never shrill

    const { sfx } = setup();
    const strike = vi.spyOn(BellInstrument.prototype, 'strike');
    sfx.drop(0, 79, false, 2, [74, 76, 79]);
    expect(strike.mock.calls.map((c) => c[0])).toEqual([74, 76, 79]);
    const times = strike.mock.calls.map((c) => c[1]);
    expect(times[1]).toBeGreaterThan(times[0]);
    expect(times[2]).toBeGreaterThan(times[1]);
  });

  it('rings a zone by how it matched: color = the bell, symbol = soft wood, exact = both, softer', () => {
    const strikes = (match: 'color' | 'symbol' | 'exact', final = false) => {
      const { sfx } = setup();
      const bell = vi.spyOn(BellInstrument.prototype, 'strike');
      const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
      sfx.chime(1, 79, final, null, match);
      const out = { bell: bell.mock.calls.map((c) => [c[0], c[2]]), wood: wood.mock.calls.map((c) => [c[0], c[2]]) };
      vi.restoreAllMocks();
      return out;
    };
    const color = strikes('color');
    expect(color.bell.map((c) => c[0])).toEqual([79]);
    expect(color.wood).toEqual([]);
    const symbol = strikes('symbol');
    expect(symbol.bell).toEqual([]);
    expect(symbol.wood.map((c) => c[0])).toEqual([79]);
    const exact = strikes('exact');
    expect(exact.bell.map((c) => c[0])).toEqual([79]);
    expect(exact.wood.map((c) => c[0])).toEqual([79]);
    // Layered, each softer than a lone strike, so the pair is not louder than one chime.
    expect(exact.bell[0][1]).toBeLessThan(color.bell[0][1] * 0.8);
    expect(exact.wood[0][1]).toBeLessThan(symbol.wood[0][1] * 0.8);
    expect(exact.bell[0][1] + exact.wood[0][1]).toBeLessThan(color.bell[0][1] * 1.5);
    // The last zone's second strike (a fourth below) stays on the zone's own timbre.
    expect(strikes('color', true).bell.map((c) => c[0])).toEqual([79, 74]);
    expect(strikes('symbol', true)).toMatchObject({ bell: [], wood: [[79, expect.any(Number)], [74, expect.any(Number)]] });
    expect(strikes('exact', true).bell.map((c) => c[0])).toEqual([79, 74]);
  });

  it('a symbol chime is a soft wooden strike: warm low-pass, no high partials, short decay', () => {
    const ctx = new FakeAudioContext();
    const noise = ctx.createBuffer(1, 16000, 8000) as unknown as AudioBuffer;
    const wood = new WoodInstrument(ctx.asContext(), ctx.createGain() as unknown as AudioNode, noise, mulberry32(9));
    for (const midi of [67, 72, 79, 84]) wood.strike(midi, 0, 1);
    const oscs = ctx.ofKind(FakeOscillator);
    expect(oscs.length).toBeGreaterThan(0);
    for (const o of oscs) expect(o.frequency.value).toBeLessThan(9000);
    const filters = ctx.ofKind(FakeBiquad);
    for (const f of filters.filter((b) => b.type === 'lowpass')) expect(f.frequency.value).toBeLessThanOrEqual(WOOD_LOWPASS_HZ * 1.06);
    for (const f of filters.filter((b) => b.type === 'bandpass')) expect(f.frequency.value).toBeLessThanOrEqual(2200);
    const envs = ctx.ofKind(FakeGain).flatMap((g) => g.gain.events.filter((e) => e.kind === 'target' && e.value === 0));
    expect(envs.length).toBeGreaterThan(0);
    for (const e of envs) expect(e.tau!).toBeLessThan(0.45);
    const peaks = ctx.ofKind(FakeGain).flatMap((g) => g.gain.events.filter((e) => e.kind === 'linear').map((e) => e.value));
    expect(Math.max(...peaks)).toBeLessThan(0.3);
  });

  /** Every envelope peak scheduled so far (the attack ramps of each hit / strike). */
  const peaksOf = (ctx: FakeAudioContext) =>
    ctx.ofKind(FakeGain).flatMap((g) => g.gain.events.filter((e) => e.kind === 'linear').map((e) => e.value));
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  /** The beam modes of a rack sound: the sines under the beam's own low-pass. */
  const beamOf = (ctx: FakeAudioContext) =>
    ctx.ofKind(FakeOscillator).filter((o) => {
      const out = o.outputs[0];
      return out instanceof FakeBiquad && out.frequency.value === BEAM_LOWPASS_HZ;
    });

  it('settles a box into a rack slot with a soft metallic toc: inharmonic beam modes, warm, no floor sub', () => {
    const { ctx, sfx } = setup();
    const bell = vi.spyOn(BellInstrument.prototype, 'strike');
    const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
    sfx.slotDrop(0, null, false, 0, 'symbol');
    // No chime passed (a box that fits the cue but is not the destined one): nothing but the neutral toc.
    expect(bell).not.toHaveBeenCalled();
    expect(wood).not.toHaveBeenCalled();
    const beam = beamOf(ctx);
    expect(beam).toHaveLength(BEAM_MODES.length);
    expect(beam[1].frequency.value / beam[0].frequency.value).toBeCloseTo(2.76, 9); // metal, never a note
    const freqs = ctx.ofKind(FakeOscillator).map((o) => o.frequency.value);
    expect(Math.max(...freqs)).toBeLessThan(2000);
    expect(Math.min(...freqs)).toBeGreaterThan(130); // nothing hits the floor: no sub body
    for (const b of ctx.ofKind(FakeBiquad)) expect(b.frequency.value).toBeLessThanOrEqual(BEAM_LOWPASS_HZ);
    // Softer than a box set down on another box.
    const slot = peaksOf(ctx);
    const onBox = setup();
    onBox.sfx.drop(0, null, false, 1);
    expect(sum(slot)).toBeLessThan(sum(peaksOf(onBox.ctx)));
    expect(Math.max(...slot)).toBeLessThanOrEqual(Math.max(...peaksOf(onBox.ctx)));
  });

  it('a slot chimes only when handed its chime, in the timbre of its cue, after the toc', () => {
    const { sfx } = setup();
    const bell = vi.spyOn(BellInstrument.prototype, 'strike');
    const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
    sfx.slotDrop(1, 79, false, 1, 'symbol');
    expect(bell).not.toHaveBeenCalled();
    expect(wood.mock.calls.map((c) => c[0])).toEqual([79]);
    expect(wood.mock.calls[0][1]).toBeGreaterThan(1.03);
    wood.mockClear();
    sfx.slotDrop(2, 79, true, 2, 'exact');
    expect(bell.mock.calls.map((c) => c[0])).toEqual([79, 74]); // the last target's second strike
    expect(wood.mock.calls.map((c) => c[0])).toEqual([79]);
  });

  it('a slot toc and lift sit a little higher per slot level, never shrill', () => {
    const beamBase = (play: (sfx: SfxPlayer) => void) => {
      const { ctx, sfx } = setup();
      play(sfx);
      return beamOf(ctx)[0].frequency.value;
    };
    const drop = [0, 1, 2].map((level) => beamBase((sfx) => sfx.slotDrop(0, null, false, level)));
    expect(drop[1]).toBeGreaterThan(drop[0]);
    expect(drop[2]).toBeGreaterThan(drop[1]);
    expect(drop[2] * BEAM_MODES[1][0]).toBeLessThan(2000);
    const lift = [0, 2].map((level) => beamBase((sfx) => sfx.slotLift(0, level)));
    expect(lift[1]).toBeGreaterThan(lift[0]);
  });

  it('lifts a box out of a slot softly: a lighter knock than a pickup, a faint beam tone, no one-shot servo', () => {
    const knockOf = (ctx: FakeAudioContext) => Math.max(...peaksOf(ctx));
    const slot = setup();
    slot.sfx.slotLift(0, 1);
    const floor = setup();
    floor.sfx.pickup(0, 1);
    expect(knockOf(slot.ctx)).toBeLessThan(knockOf(floor.ctx) * 0.7);
    const beam = beamOf(slot.ctx);
    expect(beam).toHaveLength(BEAM_MODES.length);
    // The lift itself is the forks' continuous pump whir (MotorSound), which follows the real motion: no servo glide
    // on top of it, so the two never stack into a blur.
    for (const ctx of [slot.ctx, floor.ctx]) {
      expect(ctx.ofKind(FakeOscillator).filter((o) => o.type !== 'sine')).toHaveLength(0);
      for (const o of ctx.ofKind(FakeOscillator)) expect(o.frequency.events.every((e) => e.kind !== 'exp' || e.value < o.frequency.value)).toBe(true);
    }
  });

  it('sets a box down on a truck bed with a hollow wooden thunk: low inharmonic body, a boxy hollow, no sub', () => {
    const { ctx, sfx } = setup();
    const bell = vi.spyOn(BellInstrument.prototype, 'strike');
    const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
    sfx.truckDrop(0, null);
    expect(bell).not.toHaveBeenCalled();
    expect(wood).not.toHaveBeenCalled();
    const body = ctx.ofKind(FakeOscillator).filter((o) => (o.outputs[0] as FakeBiquad).frequency.value === TRUCK_BED_LOWPASS_HZ);
    expect(body).toHaveLength(TRUCK_BED_MODES.length);
    const [low, high] = body.map((o) => o.frequency.value);
    expect(high / low).toBeCloseTo(TRUCK_BED_MODES[1][0] / TRUCK_BED_MODES[0][0], 9);
    expect(Math.abs(high / low - 2)).toBeGreaterThan(0.05); // never an octave: wood, not a note
    for (const o of body) {
      expect(o.type).toBe('sine');
      expect(o.frequency.value).toBeGreaterThan(130); // hollow, not the floor's sub thump
      expect(o.frequency.value).toBeLessThan(320);
      const end = o.frequency.events.find((e) => e.kind === 'exp')!;
      expect(end.value / o.frequency.value).toBeCloseTo(TRUCK_BED_SAG, 9); // a "thunk" that sags
    }
    const bands = ctx.ofKind(FakeBiquad).filter((b) => b.type === 'bandpass').map((b) => b.frequency.value);
    expect(bands.some((f) => Math.abs(f - TRUCK_BED_CAVITY_HZ) < TRUCK_BED_CAVITY_HZ * 0.06)).toBe(true);
    // Distinct from the rack slot's metal toc: no beam modes, lower and rounder.
    expect(beamOf(ctx)).toHaveLength(0);
    const slot = setup();
    slot.sfx.slotDrop(0, null);
    expect(Math.max(...body.map((o) => o.frequency.value))).toBeLessThan(Math.min(...beamOf(slot.ctx).map((o) => o.frequency.value)));
    // As firm as the other landings, never louder than the floor's thump.
    const floor = setup();
    floor.sfx.drop(0, null);
    expect(Math.max(...peaksOf(ctx))).toBeLessThanOrEqual(Math.max(...peaksOf(floor.ctx)));
    expect(sum(peaksOf(ctx))).toBeGreaterThan(sum(peaksOf(slot.ctx)) * 0.8);
  });

  it('a truck level above the bed answers more faintly and a little higher; it chimes only when handed its chime', () => {
    const bedOf = (level: number) => {
      const { ctx, sfx } = setup();
      sfx.truckDrop(0, null, false, level);
      const body = ctx.ofKind(FakeOscillator).filter((o) => (o.outputs[0] as FakeBiquad).frequency.value === TRUCK_BED_LOWPASS_HZ);
      const env = (o: FakeOscillator) => ((o.outputs[0] as FakeBiquad).outputs[0] as FakeGain).gain.events.find((e) => e.kind === 'linear')!.value;
      const contact = Math.max(...ctx.ofKind(FakeBiquad).filter((b) => b.type === 'bandpass').map((b) => b.frequency.value));
      return { bed: sum(body.map(env)), pitch: body[0].frequency.value, contact };
    };
    const [bed, one, two] = [0, 1, 2].map(bedOf);
    expect(two.pitch).toBeGreaterThan(bed.pitch);
    expect(two.pitch).toBeLessThan(bed.pitch * 1.25); // a little, still a low hollow thunk
    expect(one.bed).toBeLessThan(bed.bed * 0.7);
    expect(two.bed).toBeLessThan(one.bed);
    expect(two.contact).toBeGreaterThan(one.contact);
    expect(two.contact).toBeLessThan(2000);

    const { sfx } = setup();
    const bell = vi.spyOn(BellInstrument.prototype, 'strike');
    const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
    sfx.truckDrop(1, 79, false, 0, 'symbol');
    expect(bell).not.toHaveBeenCalled();
    expect(wood.mock.calls.map((c) => c[0])).toEqual([79]);
    expect(wood.mock.calls[0][1]).toBeGreaterThan(1.03); // after the thunk
    wood.mockClear();
    sfx.truckDrop(2, 79, true, 1, 'exact');
    expect(bell.mock.calls.map((c) => c[0])).toEqual([79, 74]); // the last target's second strike
    expect(wood.mock.calls.map((c) => c[0])).toEqual([79]);
  });

  it('a fork step clicks about half as loud as a UI click, a little higher per level and going up', () => {
    const bandOf = (level: number, direction: 1 | -1) => {
      const { ctx, sfx } = setup();
      sfx.forkClick(0, level, direction);
      return { ctx, band: ctx.ofKind(FakeBiquad).find((b) => b.type === 'bandpass')!.frequency.value };
    };
    const down = bandOf(0, -1);
    const up = bandOf(0, 1);
    const top = bandOf(2, 1);
    expect(up.band).toBeGreaterThan(down.band);
    expect(top.band).toBeGreaterThan(up.band);
    expect(top.band).toBeLessThan(2000);
    const ui = setup();
    ui.sfx.uiClick(0);
    expect(Math.max(...peaksOf(up.ctx))).toBeLessThanOrEqual(Math.max(...peaksOf(ui.ctx)) * 0.6);
    expect(sum(peaksOf(up.ctx))).toBeLessThan(sum(peaksOf(ui.ctx)) * 0.6);
    // Short: every envelope decays within a few tens of milliseconds.
    for (const g of up.ctx.ofKind(FakeGain)) for (const e of g.gain.events) if (e.kind === 'target') expect(e.tau!).toBeLessThan(0.02);
  });

  it('a wrong target buzzes softly: low, beating, sagging, under a warm low-pass, about 0.2 s, no chime', () => {
    const { ctx, sfx } = setup();
    const bell = vi.spyOn(BellInstrument.prototype, 'strike');
    const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
    sfx.wrongBuzz(1);
    expect(bell).not.toHaveBeenCalled();
    expect(wood).not.toHaveBeenCalled();
    expect(ctx.ofKind(FakeBufferSource)).toHaveLength(0); // tones only: no noise burst, nothing percussive

    const oscs = ctx.ofKind(FakeOscillator);
    expect(oscs).toHaveLength(2);
    for (const o of oscs) {
      // Low, but above the sub range small speakers drop.
      expect(o.frequency.value).toBeGreaterThan(160);
      expect(o.frequency.value).toBeLessThan(220);
      // Sags a little: a "no", never a rising question.
      const end = o.frequency.events.find((e) => e.kind === 'exp')!;
      expect(end.value / o.frequency.value).toBeCloseTo(WRONG_BUZZ_SAG, 9);
      expect(end.value).toBeLessThan(o.frequency.value);
      expect(end.value).toBeGreaterThan(o.frequency.value * 0.8);
      // Filtered: every tone goes through the warm, knee-soft low-pass.
      const lp = o.outputs[0] as FakeBiquad;
      expect(lp).toBeInstanceOf(FakeBiquad);
      expect(lp.type).toBe('lowpass');
      expect(lp.frequency.value).toBe(WRONG_BUZZ_LOWPASS_HZ);
      expect(lp.Q.value).toBeLessThan(0); // linear Q < 0.707: no resonant bump
    }
    expect(WRONG_BUZZ_LOWPASS_HZ).toBeLessThanOrEqual(800);
    // A soft buzz, not a note: the two tones beat slowly against each other (a flutter, never a rasp).
    const [hum, beat] = oscs.map((o) => o.frequency.value).sort((a, b) => a - b);
    expect(beat / hum).toBeCloseTo(WRONG_BUZZ_DETUNE, 9);
    expect(beat - hum).toBeGreaterThan(5);
    expect(beat - hum).toBeLessThan(16);
    expect(oscs.find((o) => o.type === 'triangle')!.frequency.value).toBe(hum); // the softer wave carries the body

    // Short: every envelope is down 26 dB between ≈ 150 and 250 ms after it starts, and it starts at `t`.
    const envs = ctx.ofKind(FakeGain).filter((g) => g.gain.events.some((e) => e.kind === 'target' && e.value === 0));
    expect(envs).toHaveLength(2);
    for (const g of envs) {
      const start = g.gain.events.find((e) => e.kind === 'set')!.time;
      const decay = g.gain.events.find((e) => e.kind === 'target')!;
      expect(start).toBe(1);
      const faded = decay.time + 3 * decay.tau! - start;
      expect(faded).toBeGreaterThanOrEqual(0.15);
      expect(faded).toBeLessThanOrEqual(0.25);
    }
    // Gentle: quieter than the neutral idle tick at its peak, and far under any drop's thump.
    const buzz = peaksOf(ctx);
    const idle = setup();
    idle.sfx.tick(0, 'idle');
    expect(sum(buzz)).toBeLessThanOrEqual(sum(peaksOf(idle.ctx)) * 1.1);
    expect(Math.max(...buzz)).toBeLessThan(Math.max(...peaksOf(idle.ctx)));
    for (const onto of [(s: SfxPlayer) => s.slotDrop(0, null), (s: SfxPlayer) => s.drop(0, null)]) {
      const landing = setup();
      onto(landing.sfx);
      expect(sum(buzz)).toBeLessThan(sum(peaksOf(landing.ctx)) * 0.5);
    }
  });

  it('starts the level-complete swell on the given downbeat and hands its bass over when it ends', () => {
    const { sfx } = setup();
    const play = vi.spyOn(PadInstrument.prototype, 'play');
    sfx.levelComplete(0.5, completionArpeggio(5), 2.4, [53, 64, 67, 69], 41, 3.43);
    expect(play).toHaveBeenCalledTimes(1);
    const [midis, bass, t0, duration, , options] = play.mock.calls[0];
    expect(midis).toEqual([53, 64, 67, 69]);
    expect(bass).toBe(41);
    expect(t0).toBe(2.4);
    expect(duration).toBe(3.43);
    expect(options?.bassOverlap).toBe(0);
  });
});

describe('AudioEngine lifecycle (fake Web Audio)', () => {
  let win: FakeEventTarget;
  let doc: FakeEventTarget;

  class SlowStartContext extends FakeAudioContext {
    override resumeMode: 'instant' | 'manual' = 'manual';
  }

  beforeEach(() => {
    vi.useFakeTimers();
    FakeAudioContext.instances.length = 0;
    win = new FakeEventTarget();
    doc = new FakeEventTarget();
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const setVisibility = (state: DocumentVisibilityState) => {
    doc.visibilityState = state;
    doc.dispatch('visibilitychange');
  };

  /** Advances the fake audio clock together with the timers (25 ms scheduler ticks). */
  const play = async (ctx: FakeAudioContext, until: number) => {
    while (ctx.currentTime < until) {
      ctx.currentTime += 0.025;
      await vi.advanceTimersByTimeAsync(25);
    }
  };

  it('does not re-arm gesture listeners when disposed while an unlock is pending', async () => {
    vi.stubGlobal('AudioContext', SlowStartContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AudioEngine();
    const unlocking = engine.unlock();
    expect(win.count()).toBe(3);
    engine.dispose();
    expect(win.count()).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    await unlocking;
    expect(win.count()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stays asleep when the tab is hidden again while a resume is still pending', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    const wake = (engine as unknown as { rt: { graph: AudioGraph } }).rt.graph.wake.gain as unknown as FakeParam;
    expect(ctx.state).toBe('running');

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(200);
    expect(ctx.state).toBe('suspended');

    ctx.resumeMode = 'manual'; // e.g. a Bluetooth output that takes a while to wake up
    setVisibility('visible');
    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(200); // the suspend timer fires while the resume is still pending
    ctx.finishResume();
    await vi.advanceTimersByTimeAsync(1000);

    expect(ctx.state).toBe('suspended');
    expect(wake.last()?.value).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('hands the kind of match through to the chime (default: the classic color bell)', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const drop = vi.spyOn(SfxPlayer.prototype, 'drop');
    const chime = vi.spyOn(SfxPlayer.prototype, 'chime');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    const dropped = { type: 'boxDropped', boxId: 'b', cell: { x: 1, z: 1 }, zoneId: 'z', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 3 } as const;
    engine.handleEvent(dropped);
    engine.handleEvent(dropped, 'symbol');
    engine.handleEvent({ ...dropped, satisfiedCount: 2 }, 'exact');
    expect(drop.mock.calls.map((c) => c[5])).toEqual(['color', 'symbol', 'exact']);
    // The chime inside each drop follows it.
    expect(chime.mock.calls.map((c) => c[4])).toEqual(['color', 'symbol', 'exact']);
    engine.handleEvent({ type: 'zoneRestored', zoneId: 'z', boxId: 'w', recipeLength: 1, satisfiedCount: 2, total: 3 }, 'symbol');
    expect(chime.mock.calls.at(-1)?.[4]).toBe('symbol');
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('lands the drop thump (and its chime) with the box, box.dropLandSec after the event', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const drop = vi.spyOn(SfxPlayer.prototype, 'drop');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    engine.handleEvent({ type: 'boxDropped', boxId: 'b', cell: { x: 1, z: 1 }, zoneId: 'z', level: 0, correct: true, recipeLength: 1, satisfiedCount: 1, total: 2 });
    expect(drop).toHaveBeenCalledTimes(1);
    expect(drop.mock.calls[0][0]).toBeCloseTo(ctx.currentTime + DROP_LAND_SEC, 9);
    expect(drop.mock.calls[0][1]).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('plays the level-complete arpeggio after the final landing chime and starts the swell on the downbeat the music resolves on', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const levelComplete = vi.spyOn(SfxPlayer.prototype, 'levelComplete');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    engine.handleEvent({ type: 'levelComplete' });
    expect(levelComplete).toHaveBeenCalledTimes(1);
    const [at, , swellAt] = levelComplete.mock.calls[0];
    // After the box lands (thump + chime), on the next 8th (≤ 0.43 s at 70 BPM).
    expect(at).toBeGreaterThanOrEqual(ctx.currentTime + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC - 1e-9);
    expect(at).toBeLessThanOrEqual(ctx.currentTime + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC + 0.5);
    expect(swellAt).toBeGreaterThan(ctx.currentTime + 0.2);
    await play(ctx, swellAt - 0.3);
    expect(engine.getDebugInfo().progressionId).not.toBe('resolve');
    await play(ctx, swellAt + 0.05);
    expect(engine.getDebugInfo().progressionId).toBe('resolve');
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('waits for a completed stack to climb into its final chime (and second strike) before the level-complete arpeggio', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const strike = vi.spyOn(BellInstrument.prototype, 'strike');
    const levelComplete = vi.spyOn(SfxPlayer.prototype, 'levelComplete');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    // Every phase of the 8th-note grid (an 8th is ≈ 0.43 s at 70 BPM).
    for (let i = 0; i < 10; i++) {
      await play(ctx, ctx.currentTime + 0.05);
      strike.mockClear();
      levelComplete.mockClear();
      engine.handleEvent({ type: 'boxDropped', boxId: 'b', cell: { x: 1, z: 1 }, zoneId: 'z', level: 2, correct: true, recipeLength: 3, satisfiedCount: 2, total: 2 });
      const dropStrikes = strike.mock.calls.map((c) => c[1]);
      expect(dropStrikes).toHaveLength(4); // two stack notes, the chime, its second strike
      engine.handleEvent({ type: 'levelComplete' });
      const [at] = levelComplete.mock.calls[0];
      expect(at).toBeGreaterThanOrEqual(Math.max(...dropStrikes) + 0.05 - 1e-9);
    }
    // A classic final drop afterwards is back to the plain wait.
    levelComplete.mockClear();
    engine.handleEvent({ type: 'boxDropped', boxId: 'c', cell: { x: 2, z: 1 }, zoneId: 'y', level: 0, correct: true, recipeLength: 1, satisfiedCount: 2, total: 2 });
    engine.handleEvent({ type: 'levelComplete' });
    const [plainAt] = levelComplete.mock.calls[0];
    expect(plainAt).toBeLessThanOrEqual(ctx.currentTime + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC + 0.5);
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('chimes a zone satisfied again by lifting a wrong top box, after the pickup knock and without a flourish', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const chime = vi.spyOn(SfxPlayer.prototype, 'chime');
    const strike = vi.spyOn(BellInstrument.prototype, 'strike');
    const levelComplete = vi.spyOn(SfxPlayer.prototype, 'levelComplete');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    engine.handleEvent({ type: 'boxPicked', boxId: 'w', fromZoneId: 'z', level: 2 });
    engine.handleEvent({ type: 'zoneRestored', zoneId: 'z', boxId: 'w', recipeLength: 2, satisfiedCount: 1, total: 3 });
    expect(chime).toHaveBeenCalledTimes(1);
    const [at, midi, final, stack] = chime.mock.calls[0];
    expect(at).toBeCloseTo(ctx.currentTime + RESTORE_AFTER_PICK_SEC, 9);
    expect(final).toBe(false);
    expect(stack).toHaveLength(2);
    expect(strike.mock.calls.map((c) => c[0])).toEqual([stack![0], midi]); // climbs into the chime, no second strike
    expect(levelComplete).not.toHaveBeenCalled();

    chime.mockClear();
    engine.handleEvent({ type: 'zoneRestored', zoneId: 'y', boxId: 'v', recipeLength: 1, satisfiedCount: 2, total: 3 });
    expect(chime.mock.calls[0][3]).toBeNull(); // a single-box recipe: just the chime
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  it('ticks a zone released by a box stacked on top when that box lands; a pick-up releases at once', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tick = vi.spyOn(SfxPlayer.prototype, 'tick');
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = FakeAudioContext.instances[0];
    engine.setScene('playing');
    await play(ctx, 1);
    engine.handleEvent({ type: 'boxDropped', boxId: 'c', cell: { x: 1, z: 1 }, zoneId: 'z', level: 1, correct: false, recipeLength: 1, satisfiedCount: 0, total: 2 });
    engine.handleEvent({ type: 'zoneReleased', zoneId: 'z', boxId: 'c' });
    expect(tick).toHaveBeenCalledTimes(1);
    expect(tick.mock.calls[0][0]).toBeCloseTo(ctx.currentTime + DROP_LAND_SEC + RELEASE_AFTER_LAND_SEC, 9);
    expect(tick.mock.calls[0][1]).toBe('release');

    await play(ctx, ctx.currentTime + 1);
    engine.handleEvent({ type: 'boxPicked', boxId: 'c', fromZoneId: 'z', level: 1 });
    engine.handleEvent({ type: 'zoneReleased', zoneId: 'z', boxId: 'c' });
    expect(tick).toHaveBeenCalledTimes(2);
    expect(tick.mock.calls[1][0]).toBe(ctx.currentTime);
    expect(warn).not.toHaveBeenCalled();
    engine.dispose();
  });

  describe('storage racks', () => {
    const inSlot = (correct: boolean, recipeLength = 1, satisfiedCount = 1) =>
      ({
        type: 'boxDropped',
        boxId: 'b',
        cell: { x: 6, z: 1 },
        zoneId: null,
        level: 1,
        correct,
        recipeLength,
        satisfiedCount,
        total: 3,
        slotId: 'r1:0:1',
      }) as const;

    async function live() {
      vi.stubGlobal('AudioContext', FakeAudioContext);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const engine = new AudioEngine();
      await engine.unlock();
      const ctx = FakeAudioContext.instances[0];
      engine.setScene('playing');
      await play(ctx, 1);
      return { engine, ctx, warn };
    }

    it('settles every slot drop with the metal toc as it lands; only the destined box chimes, by its cue', async () => {
      const { engine, ctx, warn } = await live();
      const slotDrop = vi.spyOn(SfxPlayer.prototype, 'slotDrop');
      const drop = vi.spyOn(SfxPlayer.prototype, 'drop');
      const bell = vi.spyOn(BellInstrument.prototype, 'strike');
      const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
      // Fits the cue but is not the destined box: the neutral toc, no success sound at all.
      engine.handleEvent(inSlot(false, 1, 0), 'symbol');
      // Any box in a «libre» slot: the same.
      engine.handleEvent(inSlot(false, 0, 0), 'color');
      expect(drop).not.toHaveBeenCalled();
      expect(slotDrop).toHaveBeenCalledTimes(2);
      for (const call of slotDrop.mock.calls) {
        expect(call[0]).toBeCloseTo(ctx.currentTime + DROP_LAND_SEC, 9);
        expect(call[1]).toBeNull();
        expect(call[2]).toBe(false);
        expect(call[3]).toBe(1);
      }
      expect(bell).not.toHaveBeenCalled();
      expect(wood).not.toHaveBeenCalled();

      // The destined box: the chime in its cue's timbre (symbol = wood only).
      slotDrop.mockClear();
      engine.handleEvent(inSlot(true, 1, 2), 'symbol');
      expect(slotDrop.mock.calls[0][1]).not.toBeNull();
      expect(slotDrop.mock.calls[0][2]).toBe(false);
      expect(slotDrop.mock.calls[0][4]).toBe('symbol');
      expect(bell).not.toHaveBeenCalled();
      expect(wood).toHaveBeenCalledTimes(1);

      // The last target: the second strike, then the level-complete arpeggio after it (no stack climb to wait for).
      const levelComplete = vi.spyOn(SfxPlayer.prototype, 'levelComplete');
      bell.mockClear();
      engine.handleEvent(inSlot(true, 1, 3), 'exact');
      expect(slotDrop.mock.calls[1][2]).toBe(true);
      const strikes = bell.mock.calls.map((c) => c[1]);
      expect(strikes).toHaveLength(2);
      engine.handleEvent({ type: 'levelComplete' });
      expect(levelComplete.mock.calls[0][0]).toBeGreaterThanOrEqual(Math.max(...strikes) + 0.05 - 1e-9);
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('lifts a box out of a slot with the soft lift; releasing its slot ticks at once', async () => {
      const { engine, ctx, warn } = await live();
      const slotLift = vi.spyOn(SfxPlayer.prototype, 'slotLift');
      const pickup = vi.spyOn(SfxPlayer.prototype, 'pickup');
      const tick = vi.spyOn(SfxPlayer.prototype, 'tick');
      engine.handleEvent(inSlot(true));
      await play(ctx, ctx.currentTime + 1);
      engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 2, fromSlotId: 'r1:0:2' });
      engine.handleEvent({ type: 'zoneReleased', zoneId: null, boxId: 'b', slotId: 'r1:0:2' });
      expect(pickup).not.toHaveBeenCalled();
      expect(slotLift.mock.calls).toEqual([[ctx.currentTime, 2]]);
      expect(tick.mock.calls).toEqual([[ctx.currentTime, 'release']]);
      // Off the floor, the classic pickup as before.
      engine.handleEvent({ type: 'boxPicked', boxId: 'c', fromZoneId: null, level: 0 });
      expect(pickup).toHaveBeenCalledTimes(1);
      expect(slotLift).toHaveBeenCalledTimes(1);
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('buzzes softly just after a box lands on a target that is not its destiny, slot or floor zone', async () => {
      const { engine, ctx, warn } = await live();
      const buzz = vi.spyOn(SfxPlayer.prototype, 'wrongBuzz');
      const slotDrop = vi.spyOn(SfxPlayer.prototype, 'slotDrop');
      const drop = vi.spyOn(SfxPlayer.prototype, 'drop');
      const bell = vi.spyOn(BellInstrument.prototype, 'strike');
      const wood = vi.spyOn(WoodInstrument.prototype, 'strike');
      const landed = () => ctx.currentTime + DROP_LAND_SEC;

      // A trap box in a cued slot it fits: the usual toc as it lands, then the soft "no"; never a chime.
      engine.handleEvent({ ...inSlot(false, 1, 0), wrongTarget: true }, 'symbol');
      expect(slotDrop).toHaveBeenCalledTimes(1);
      expect(slotDrop.mock.calls[0][0]).toBeCloseTo(landed(), 9);
      expect(slotDrop.mock.calls[0][1]).toBeNull();
      expect(buzz).toHaveBeenCalledTimes(1);
      expect(buzz.mock.calls[0][0]).toBeCloseTo(landed() + WRONG_AFTER_LAND_SEC, 9);
      expect(WRONG_AFTER_LAND_SEC).toBeGreaterThan(0);
      expect(WRONG_AFTER_LAND_SEC).toBeLessThan(0.1);

      // A floor zone that is not its destiny: the floor thump, then the same buzz.
      const onZone = { type: 'boxDropped', boxId: 'c', cell: { x: 2, z: 3 }, zoneId: 'z1', level: 0, correct: false, recipeLength: 1, satisfiedCount: 0, total: 3 } as const;
      engine.handleEvent({ ...onZone, wrongTarget: true }, 'color');
      expect(drop).toHaveBeenCalledTimes(1);
      expect(drop.mock.calls[0][0]).toBeCloseTo(landed(), 9);
      expect(drop.mock.calls[0][1]).toBeNull();
      expect(buzz).toHaveBeenCalledTimes(2);
      expect(buzz.mock.calls[1][0]).toBeCloseTo(landed() + WRONG_AFTER_LAND_SEC, 9);
      expect(bell).not.toHaveBeenCalled();
      expect(wood).not.toHaveBeenCalled();

      // No flag, no buzz: a «libre» slot, plain floor, the destined box (its chime alone), levels without racks.
      buzz.mockClear();
      engine.handleEvent(inSlot(false, 0, 0));
      engine.handleEvent({ ...onZone, zoneId: null, recipeLength: 0 });
      engine.handleEvent(onZone); // a level without racks: a wrong colour just thumps, as always
      engine.handleEvent({ ...onZone, wrongTarget: false });
      engine.handleEvent(inSlot(true, 1, 1), 'symbol');
      engine.handleEvent({ ...onZone, correct: true, satisfiedCount: 2 }, 'color');
      expect(buzz).not.toHaveBeenCalled();
      expect(wood).toHaveBeenCalledTimes(1);
      expect(bell).toHaveBeenCalledTimes(1);
      // Defensive: a destined drop keeps its chime alone even if it came flagged.
      engine.handleEvent({ ...inSlot(true, 1, 2), wrongTarget: true }, 'symbol');
      expect(buzz).not.toHaveBeenCalled();
      expect(wood).toHaveBeenCalledTimes(2);

      // Muted: nothing at all.
      engine.setMuted(true);
      engine.handleEvent({ ...onZone, wrongTarget: true });
      expect(buzz).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('isWrongTarget: only a boxDropped flagged wrongTarget that is not also correct', () => {
      expect(isWrongTarget({ ...inSlot(false), wrongTarget: true })).toBe(true);
      expect(isWrongTarget({ ...inSlot(true), wrongTarget: true })).toBe(false);
      expect(isWrongTarget({ ...inSlot(false), wrongTarget: false })).toBe(false);
      expect(isWrongTarget(inSlot(false))).toBe(false);
      expect(isWrongTarget({ type: 'actionIdle', carrying: true })).toBe(false);
      expect(isWrongTarget({ type: 'levelComplete' })).toBe(false);
    });

    it('clicks a fork step on the audio clock, and stays silent while muted', async () => {
      const { engine, ctx, warn } = await live();
      const click = vi.spyOn(SfxPlayer.prototype, 'forkClick');
      engine.forkClick(2, 1);
      engine.forkClick(1, -1);
      expect(click.mock.calls).toEqual([
        [ctx.currentTime, 2, 1],
        [ctx.currentTime, 1, -1],
      ]);
      engine.setMuted(true);
      engine.forkClick(2, 1);
      expect(click).toHaveBeenCalledTimes(2);
      engine.dispose();
      engine.forkClick(2, 1);
      expect(click).toHaveBeenCalledTimes(2);
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('forklift sounds and loading docks', () => {
    async function live() {
      vi.stubGlobal('AudioContext', FakeAudioContext);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const engine = new AudioEngine();
      await engine.unlock();
      const ctx = FakeAudioContext.instances[0];
      engine.setScene('playing');
      await play(ctx, 1);
      return { engine, ctx, warn };
    }
    const onTruck = (correct: boolean, level = 0, satisfiedCount = 1) =>
      ({
        type: 'boxDropped',
        boxId: 'b',
        cell: { x: 3, z: 0 },
        zoneId: null,
        level,
        correct,
        recipeLength: 1,
        satisfiedCount,
        total: 3,
        truckSlotId: `t1:1:${level}`,
      }) as const;

    it('lands a box on a truck bed with the hollow thunk; it chimes only when correct and buzzes on a wrong truck slot', async () => {
      const { engine, ctx, warn } = await live();
      const truckDrop = vi.spyOn(SfxPlayer.prototype, 'truckDrop');
      const slotDrop = vi.spyOn(SfxPlayer.prototype, 'slotDrop');
      const drop = vi.spyOn(SfxPlayer.prototype, 'drop');
      const buzz = vi.spyOn(SfxPlayer.prototype, 'wrongBuzz');
      const landed = () => ctx.currentTime + DROP_LAND_SEC;

      engine.handleEvent({ ...onTruck(false, 0, 0), wrongTarget: true }, 'color');
      expect(truckDrop.mock.calls).toEqual([[expect.closeTo(landed(), 9), null, false, 0, 'color']]);
      expect(buzz.mock.calls).toEqual([[expect.closeTo(landed() + WRONG_AFTER_LAND_SEC, 9)]]);

      engine.handleEvent(onTruck(true, 1, 2), 'exact');
      expect(truckDrop.mock.calls[1][1]).not.toBeNull();
      expect(truckDrop.mock.calls[1].slice(2)).toEqual([false, 1, 'exact']);
      engine.handleEvent(onTruck(true, 2, 3), 'symbol');
      expect(truckDrop.mock.calls[2][2]).toBe(true); // the last target: the final strike
      expect(buzz).toHaveBeenCalledTimes(1);
      expect(slotDrop).not.toHaveBeenCalled();
      expect(drop).not.toHaveBeenCalled();

      // Picking from a truck bed is the classic wooden pickup.
      const pickup = vi.spyOn(SfxPlayer.prototype, 'pickup');
      engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 1, fromTruckSlotId: 't1:1:1' });
      expect(pickup.mock.calls).toEqual([[ctx.currentTime, 1]]);
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('drives the motor with the signed speed and fork motion, through the master gain that mute silences', async () => {
      const { engine, warn } = await live();
      const set = vi.spyOn(MotorSound.prototype, 'set');
      engine.setMotor(-0.4, -1, 2);
      engine.setMotor(0.8, 0.5);
      expect(set.mock.calls).toEqual([
        [-0.4, -1, 2],
        [0.8, 0.5, 0],
      ]);
      const graph = (engine as unknown as { rt: { graph: AudioGraph } }).rt.graph;
      const motorVol = (graph.motorIn as unknown as FakeGain).outputs[0] as FakeGain;
      expect(motorVol.outputs).toContain(graph.master);
      engine.setMuted(true);
      expect((graph.master.gain as unknown as FakeParam).last()?.value).toBe(0);
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('keeps the fork clunk quiet while a pick or a drop is marked by its own knock, muted or not', async () => {
      const { engine, ctx, warn } = await live();
      const hush = vi.spyOn(MotorSound.prototype, 'hushClunk');
      engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 0 });
      engine.handleEvent(onTruck(false));
      engine.handleEvent({ type: 'actionIdle', carrying: false });
      engine.setMuted(true);
      engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 0 });
      expect(hush.mock.calls).toEqual([[ctx.currentTime + CLUNK.hushSec], [ctx.currentTime + CLUNK.hushSec], [ctx.currentTime + CLUNK.hushSec]]);
      expect(warn).not.toHaveBeenCalled();
      engine.dispose();
    });

    it('tunes the reverse beep to the key of the song and plays it on the SFX bus, not the quiet motor bus', async () => {
      const { engine } = await live();
      const internals = engine as unknown as {
        composer: { keyPc: number };
        rt: { graph: AudioGraph; motor: { beeper: { tone: FakeOscillator; env: FakeGain } } };
      };
      const { graph, motor } = internals.rt;
      expect(motor.beeper.tone.frequency.value).toBeCloseTo(beepFrequency(internals.composer.keyPc), 9);
      expect(motor.beeper.env.outputs).toEqual([graph.sfxIn]);
      // Still under the master gain (mute) and the wake fade (hidden tab), like every other sound.
      const sfxVol = (graph.sfxIn as unknown as FakeGain).outputs[0] as FakeGain;
      expect(sfxVol.outputs).toContain(graph.master);
      engine.dispose();
    });
  });
});
