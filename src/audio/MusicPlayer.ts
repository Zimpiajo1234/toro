import type { Rng } from './types';
import type { AudioGraph } from './graph';
import { range } from './random';
import { Composer, type BarPlan } from './music/Composer';
import { BAR_SEC, STEP_SEC, STEPS_PER_BAR, stepOffsetSec } from './music/timing';
import { LookaheadScheduler } from './scheduler';
import { PadInstrument } from './instruments/pad';
import { createKeysChannel, KeysInstrument, type KeysChannel } from './instruments/keys';
import { PluckInstrument } from './instruments/pluck';
import { BrushKit } from './instruments/percussion';
import { gain } from './nodes';

/** Small timing imperfections (seconds) so nothing sounds quantised. */
const HUMANIZE = 0.007;
/** Extra overlap of consecutive pads so chord changes cross-fade (the sub-bass still hands over on the bar line). */
export const PAD_OVERLAP = 0.25;

/**
 * Plays the Composer's bars on the audio clock through the music instruments.
 * The composer keeps advancing while silent (muted) so the music resumes mid-flow.
 */
export class MusicPlayer {
  private readonly scheduler: LookaheadScheduler;
  private readonly pad: PadInstrument;
  private readonly keysChannel: KeysChannel;
  private readonly keys: KeysInstrument;
  private readonly lead: KeysInstrument;
  private readonly guitar: PluckInstrument;
  private readonly kit: BrushKit;
  private readonly kitBus: GainNode;
  private plan: BarPlan | null = null;
  private planBar = -1;
  private barStart = 0;
  private silent = false;
  private silentFrom = 0;
  /** This bar's pad has not started yet (its downbeat was skipped while silent or after a stall). */
  private padMissing = false;
  /** The level-complete swell supplies the sub-bass of the coming resolve bar. */
  private bassYielded = false;
  private omitBass = false;
  /** Driven by pump() (offline preview) rather than the timer. */
  private pumped = false;

  constructor(
    graph: AudioGraph,
    readonly composer: Composer,
    private readonly rng: Rng,
  ) {
    const { ctx, musicIn } = graph;
    this.pad = new PadInstrument(ctx, musicIn, rng);
    this.keysChannel = createKeysChannel(ctx, musicIn);
    this.keys = new KeysInstrument(ctx, this.keysChannel.input, rng, 16);
    this.lead = new KeysInstrument(ctx, this.keysChannel.input, rng, 6);
    this.guitar = new PluckInstrument(ctx, musicIn, rng);
    this.kitBus = gain(ctx, 0.8);
    this.kitBus.connect(musicIn);
    this.kit = new BrushKit(ctx, this.kitBus, graph.noise, rng);
    this.scheduler = new LookaheadScheduler(ctx, this.onStep, { stepSec: STEP_SEC, intervalMs: 25, horizonSec: 0.2 });
  }

  get running(): boolean {
    return this.scheduler.running;
  }

  start(): void {
    this.scheduler.start();
  }

  stop(): void {
    this.scheduler.stop();
  }

  /** Schedules due steps without the timer (offline rendering in the dev preview). */
  pump(): void {
    this.pumped = true;
    this.scheduler.tick();
  }

  /**
   * While silent (muted), bars keep advancing but no voices are created. A bar whose downbeat was
   * skipped gets its pad back (softly) at the first audible step; a pad that already started is left alone.
   */
  setSilent(silent: boolean, fromTime: number): void {
    this.silent = silent;
    this.silentFrom = fromTime;
  }

  /** Next 8th-note boundary after `time` (for musically-timed SFX), or `time` if not running. */
  nextEighth(time: number): number {
    return this.clocked ? this.scheduler.nextGridTime(2, time) : time;
  }

  /**
   * Downbeat of the first bar not planned yet — where a Composer.requestResolve() made now lands —
   * or `fallback` if not running.
   */
  nextUnplannedDownbeat(fallback: number): number {
    return this.clocked ? this.scheduler.nextGridTime(STEPS_PER_BAR, this.scheduler.nextStepTime) : fallback;
  }

  /** The next bar, if it is a resolve bar, plays without its sub-bass (the level-complete swell carries it). */
  yieldResolveBass(): void {
    this.bassYielded = true;
  }

  private get clocked(): boolean {
    return this.scheduler.running || this.pumped;
  }

  voiceCount(): number {
    return this.pad.activeVoices + this.keys.activeVoices + this.lead.activeVoices + this.guitar.activeVoices + this.kit.activeVoices;
  }

  dispose(): void {
    this.scheduler.stop();
    this.pad.releaseAll();
    this.keys.releaseAll();
    this.lead.releaseAll();
    this.kit.releaseAll();
    this.guitar.dispose();
    this.keysChannel.dispose();
    this.kitBus.disconnect();
  }

  private readonly onStep = (step: number, time: number): void => {
    const bar = Math.floor(step / STEPS_PER_BAR);
    const s = step - bar * STEPS_PER_BAR;
    if (bar !== this.planBar) {
      this.planBar = bar;
      this.plan = this.composer.nextBar();
      this.barStart = time - s * STEP_SEC;
      this.padMissing = true;
      this.omitBass = this.bassYielded && this.plan.resolve;
      this.bassYielded = false;
    }
    const plan = this.plan;
    if (!plan) return;
    if (this.silent && time >= this.silentFrom) return;
    this.playStep(plan, s, this.barStart + stepOffsetSec(s));
  };

  private playStep(plan: BarPlan, s: number, t: number): void {
    const rng = this.rng;
    if (this.padMissing) {
      // On the downbeat normally; later in the bar (softer attack) after a mute or a stall skipped it.
      const remaining = BAR_SEC - stepOffsetSec(s);
      const { midis, bass, velocity } = plan.pad;
      const options = s === 0 ? { bassOverlap: PAD_OVERLAP } : { attack: 0.9, bassOverlap: PAD_OVERLAP };
      this.pad.play(midis, this.omitBass ? null : bass, t, remaining + PAD_OVERLAP, velocity, options);
      this.padMissing = false;
    }
    for (const e of plan.keys) {
      if (e.step === s) this.keys.playChord(e.midis, t + range(rng, 0, HUMANIZE), e.duration * STEP_SEC, e.velocity, e.strumSec);
    }
    for (const e of plan.melody) {
      if (e.step !== s) continue;
      const at = t + range(rng, -HUMANIZE, HUMANIZE);
      if (e.voice === 'guitar') this.guitar.play(e.midi, at, e.velocity * 0.95, { tone: 1.15 });
      else this.lead.playNote(e.midi, at, e.duration * STEP_SEC, e.velocity, { brightness: 1.15, level: 1.7 });
    }
    for (const e of plan.plucks) {
      if (e.step === s) this.guitar.play(e.midi, t + range(rng, 0, HUMANIZE), e.velocity * 0.8);
    }
    for (const e of plan.hats) if (e.step === s) this.kit.hat(t + range(rng, -0.004, 0.004), e.velocity);
    for (const e of plan.kicks) if (e.step === s) this.kit.kick(t, e.velocity);
  }
}
