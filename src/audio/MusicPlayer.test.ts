import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioGraph } from './graph';
import { PadInstrument, type PadOptions } from './instruments/pad';
import { Composer } from './music/Composer';
import { BAR_SEC } from './music/timing';
import { MusicPlayer, PAD_OVERLAP } from './MusicPlayer';
import { mulberry32 } from './random';
import { FakeAudioContext } from './testing/fakeAudio';

type PadCall = Parameters<PadInstrument['play']>;

function setup() {
  const ctx = new FakeAudioContext();
  const graph = { ctx: ctx.asContext(), musicIn: ctx.createGain(), noise: ctx.createBuffer(1, 16000, 8000) } as unknown as AudioGraph;
  const composer = new Composer({ rng: mulberry32(7), keyPc: 0 });
  composer.setScene('playing');
  const player = new MusicPlayer(graph, composer, mulberry32(8));
  const pad = vi.spyOn(PadInstrument.prototype, 'play');
  player.pump(); // t = 0: first downbeat
  /** Advances the audio clock in 25 ms timer ticks. */
  const runTo = (until: number) => {
    while (ctx.currentTime < until - 1e-9) {
      ctx.currentTime += 0.025;
      player.pump();
    }
  };
  const calls = () => pad.mock.calls as PadCall[];
  const options = (i: number): PadOptions => calls()[i][5] ?? {};
  return { ctx, composer, player, runTo, calls, options };
}

describe('MusicPlayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps the sub-bass monophonic: each bar hands it over on the next bar line', () => {
    const { runTo, calls, options } = setup();
    runTo(BAR_SEC + 0.1);
    expect(calls()).toHaveLength(2);
    for (let i = 0; i < 2; i++) {
      const [, , t0, duration] = calls()[i];
      expect(options(i).bassOverlap).toBe(PAD_OVERLAP);
      expect(t0 + duration - PAD_OVERLAP).toBeCloseTo((i + 1) * BAR_SEC, 6);
    }
  });

  it('does not layer a second pad when unmuted within the bar whose pad still sounds', () => {
    const { player, runTo, calls, options } = setup();
    runTo(1);
    player.setSilent(true, 1.45);
    runTo(2);
    player.setSilent(false, 2.45);
    runTo(3);
    expect(calls()).toHaveLength(1);
    runTo(BAR_SEC + 0.1);
    expect(calls()).toHaveLength(2);
    expect(calls()[1][2]).toBeCloseTo(BAR_SEC, 6);
    expect(options(1).attack).toBeUndefined();
  });

  it('restores a pad whose downbeat was skipped while muted, softly and ending on the bar line', () => {
    const { player, runTo, calls, options } = setup();
    runTo(1);
    player.setSilent(true, 1.45);
    runTo(4); // the bar-1 downbeat (≈3.43 s) passes while silent
    expect(calls()).toHaveLength(1);
    player.setSilent(false, 4.45);
    runTo(4.3);
    expect(calls()).toHaveLength(2);
    const [, , t0, duration] = calls()[1];
    expect(t0).toBeGreaterThan(4);
    expect(options(1).attack).toBe(0.9);
    expect(t0 + duration - PAD_OVERLAP).toBeCloseTo(2 * BAR_SEC, 6);
  });

  it('brings the pad bed back mid-bar after a stall skipped the downbeat', () => {
    const { ctx, player, runTo, calls, options } = setup();
    runTo(3);
    ctx.currentTime = 3.9; // main-thread stall across the bar-1 downbeat
    player.pump();
    expect(calls()).toHaveLength(2);
    expect(calls()[1][2]).toBeGreaterThanOrEqual(3.9 - 0.02);
    expect(options(1).attack).toBe(0.9);
  });

  it('reports where a requested resolve lands and lets the swell carry that bar’s bass', () => {
    const { composer, player, runTo, calls } = setup();
    runTo(1);
    composer.requestResolve();
    const downbeat = player.nextUnplannedDownbeat(-1);
    expect(downbeat).toBeCloseTo(BAR_SEC, 6);
    player.yieldResolveBass();
    runTo(BAR_SEC + 0.1);
    expect(composer.debug().progressionId).toBe('resolve');
    expect(calls()[1][2]).toBeCloseTo(downbeat, 6);
    expect(calls()[1][1]).toBeNull();
    runTo(2 * BAR_SEC + 0.1);
    expect(calls()[2][1]).not.toBeNull();
  });

  it('ignores a bass hand-over when the next bar is not a resolve bar', () => {
    const { player, runTo, calls } = setup();
    runTo(1);
    player.yieldResolveBass();
    runTo(BAR_SEC + 0.1);
    expect(calls()[1][1]).not.toBeNull();
  });

  it('falls back to the given time before the clock runs', () => {
    const ctx = new FakeAudioContext();
    const graph = { ctx: ctx.asContext(), musicIn: ctx.createGain(), noise: ctx.createBuffer(1, 16000, 8000) } as unknown as AudioGraph;
    const player = new MusicPlayer(graph, new Composer({ rng: mulberry32(1) }), mulberry32(2));
    expect(player.nextUnplannedDownbeat(5)).toBe(5);
    expect(player.nextEighth(5)).toBe(5);
  });
});
