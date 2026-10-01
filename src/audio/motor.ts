import { disconnectAll, filter, gain, glideParam, holdParam, osc } from './nodes';
import { LEVEL_PITCH } from './sfx';
import { fillNoise } from './dsp/impulse';
import { mulberry32 } from './random';
import { ReverseBeeper } from './beeper';

/*
 * The forklift's own sounds, all on the (dry) motor bus: an electric traction motor, the tyres on the tiles, the
 * hydraulic forks and the reverse beeper. Every tuning value lives in the tables below; levels are on the motor bus
 * (`audio.motor` in gameConfig.json scales them all).
 */

/** Electric traction motor: a smooth whine whose pitch and level climb with speed. Silent at a standstill. */
export const DRIVE = {
  /** Rotor tone (Hz) at a crawl and at full speed. Reverse tops out near half speed, so it whines lower. */
  lowHz: 170,
  topHz: 440,
  /**
   * [ratio, level] of each sine over the rotor tone: the tone, its octave for body, and a faint inharmonic partial
   * for the inverter's electric shimmer. Pure sines only: nothing that reads as a combustion engine.
   */
  partials: [
    [1, 1],
    [2, 0.3],
    [4.2, 0.1],
  ],
  /** Level at full speed and the curve toward it (< 1: audible from a crawl, never a jump). */
  level: 0.075,
  curve: 0.6,
  /** Low-pass over the whine (Hz), opening with speed: mellow at a crawl, a little brighter at speed. */
  lowpassLowHz: 700,
  lowpassTopHz: 1900,
  /** Glide time constants (s): pitch, level rising, level falling (a calm spin-down after letting go). */
  pitchTau: 0.12,
  attackTau: 0.1,
  releaseTau: 0.22,
} as const;

/** Soft tyre roll on the tiles: filtered noise that grows with speed, with a faint swell at each tile joint. */
export const ROLL = {
  level: 0.24,
  curve: 1.1,
  highpassHz: 110,
  /** Low-pass (Hz) at a crawl and at full speed: a soft rumble that opens a little faster. */
  lowpassLowHz: 320,
  lowpassTopHz: 900,
  /**
   * Tile joints: the roll swells by this share of its level, this often per second at full speed (two axles over
   * 1-unit tiles at 2.3 u/s). 0 turns the joints off.
   */
  seamDepth: 0.3,
  seamTopHz: 4.6,
} as const;

/**
 * Hydraulic forks. Up: the electric pump's soft whir, a little higher per level. Down: no pump (the forks sink on the
 * valve), a softer, lower tone with a light hiss. The motion is the signed 0‥1 rate Game measures (+ up, − down).
 */
export const FORK = {
  /** Pump tone (Hz) going up / the softer tone going down, at the floor; each level adds `perLevel` of it. */
  upHz: 150,
  downHz: 104,
  perLevel: LEVEL_PITCH,
  /** A sine just over the octave beats slowly against the pump (≈ 2 Hz): the "whirr". [ratio, level]. */
  overtone: [2.015, 0.35],
  /** Pump level going up / the lowering tone's level, at full rate; the curve (< 1) keeps slow moves audible. */
  upLevel: 0.2,
  downLevel: 0.1,
  curve: 0.6,
  /** Low-pass over the pump (Hz): open going up, darker going down. */
  upLowpassHz: 700,
  downLowpassHz: 380,
  /** The lowering hiss: band-passed noise, light. */
  hissLevel: 0.07,
  hissHz: 2400,
  hissQ: 0.9,
  attackTau: 0.05,
  releaseTau: 0.08,
  /** The forks count as moving above this rate and as stopped below `stillAt` (hysteresis). */
  movingAt: 0.08,
  stillAt: 0.02,
} as const;

/** A tiny soft clunk as the forks reach the end of their travel. */
export const CLUNK = {
  /** Only after a travel at least this long (a nudge never clunks) and at most one per `gapSec`. */
  minTravelSec: 0.15,
  gapSec: 0.3,
  /**
   * Never within this long after a box is picked or set down: its knock / thump already marks the moment (the carry
   * lift and the lowering after a drop end inside it).
   */
  hushSec: 0.8,
  /** Its body: a sine gliding down (Hz), level, decay (s). A touch deeper arriving at the bottom (`downPitch`). */
  toneHz: 130,
  toneEndHz: 88,
  toneLevel: 0.22,
  toneTau: 0.045,
  downPitch: 0.85,
  /** Its contact: band-passed noise, short. */
  knockHz: 720,
  knockQ: 1.2,
  knockLevel: 0.1,
  knockTau: 0.015,
} as const;

/** Parameter changes smaller than these are not sent (keeps the automation timeline tiny). */
const SPEED_EPSILON = 0.004;
const FORK_EPSILON = 0.01;
const HEIGHT_EPSILON = 0.02;
/** Highest fork height the pump pitch follows (rack slots and stacks are at most 3 high: levels 0‥2). */
const MAX_HEIGHT = 4;

/**
 * The forklift's continuous sounds: electric drive whine + tyre roll, fork pump / lowering hiss + end-of-travel clunk,
 * and the reverse beeper. Built once (every node lives for the whole session); `set()` runs every frame and allocates
 * nothing.
 */
export class MotorSound {
  private readonly drive: OscillatorNode[];
  private readonly driveFilter: BiquadFilterNode;
  private readonly driveGain: GainNode;
  private readonly noise: AudioBufferSourceNode;
  private readonly rollFilter: BiquadFilterNode;
  private readonly rollGain: GainNode;
  private readonly seam: OscillatorNode;
  private readonly seamDepth: GainNode;
  private readonly pump: OscillatorNode;
  private readonly pumpOvertone: OscillatorNode;
  private readonly pumpFilter: BiquadFilterNode;
  private readonly pumpGain: GainNode;
  private readonly hissGain: GainNode;
  private readonly clunkTone: OscillatorNode;
  private readonly clunkGain: GainNode;
  private readonly knockGain: GainNode;
  private readonly beeper: ReverseBeeper;
  private readonly sources: AudioScheduledSourceNode[];
  private readonly nodes: AudioNode[];
  private lastSpeed = -1;
  private lastFork = Number.NaN;
  private lastHeight = 0;
  /** Direction of the last fork travel (+1 up, −1 down): the tone keeps it while it fades. */
  private forkDir = 1;
  private forkMoving = false;
  private travelFrom = 0;
  private lastClunkAt = -Infinity;
  private hushUntil = -Infinity;

  /** `noise` = the graph's shared white-noise buffer (a small one is made when omitted). `beepHz` = reverse beep pitch. */
  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    noise?: AudioBuffer,
    beepHz?: number,
  ) {
    const nodes: AudioNode[] = [];
    const keep = <T extends AudioNode>(n: T): T => {
      nodes.push(n);
      return n;
    };

    // Drive whine: sines → speed-tracking low-pass → level.
    this.driveGain = keep(gain(ctx, 0));
    this.driveGain.connect(out);
    this.driveFilter = keep(filter(ctx, 'lowpass', DRIVE.lowpassLowHz, 0.6));
    this.driveFilter.connect(this.driveGain);
    this.drive = DRIVE.partials.map(([ratio, level]) => {
      const o = keep(osc(ctx, 'sine', DRIVE.lowHz * ratio));
      const g = keep(gain(ctx, level));
      o.connect(g);
      g.connect(this.driveFilter);
      return o;
    });

    // One looping noise source feeds the tyre roll, the lowering hiss and the clunk's contact.
    this.noise = keep(ctx.createBufferSource());
    this.noise.buffer = noise ?? makeNoise(ctx);
    this.noise.loop = true;

    this.rollGain = keep(gain(ctx, 0));
    this.rollGain.connect(out);
    this.rollFilter = keep(filter(ctx, 'lowpass', ROLL.lowpassLowHz, 0.6));
    this.rollFilter.connect(this.rollGain);
    const rollHighpass = keep(filter(ctx, 'highpass', ROLL.highpassHz, 0.6));
    rollHighpass.connect(this.rollFilter);
    this.noise.connect(rollHighpass);
    // Tile joints: a slow swell added to the roll level (scaled with it, so it is silent when the roll is).
    this.seam = keep(osc(ctx, 'sine', 0.1));
    this.seamDepth = keep(gain(ctx, 0));
    this.seam.connect(this.seamDepth);
    this.seamDepth.connect(this.rollGain.gain);

    // Fork pump / lowering tone.
    this.pumpGain = keep(gain(ctx, 0));
    this.pumpGain.connect(out);
    this.pumpFilter = keep(filter(ctx, 'lowpass', FORK.upLowpassHz, 0.5));
    this.pumpFilter.connect(this.pumpGain);
    this.pump = keep(osc(ctx, 'sawtooth', FORK.upHz));
    this.pump.connect(this.pumpFilter);
    this.pumpOvertone = keep(osc(ctx, 'sine', FORK.upHz * FORK.overtone[0]));
    const overtoneLevel = keep(gain(ctx, FORK.overtone[1]));
    this.pumpOvertone.connect(overtoneLevel);
    overtoneLevel.connect(this.pumpFilter);

    // Lowering hiss.
    this.hissGain = keep(gain(ctx, 0));
    this.hissGain.connect(out);
    const hissFilter = keep(filter(ctx, 'bandpass', FORK.hissHz, FORK.hissQ));
    hissFilter.connect(this.hissGain);
    this.noise.connect(hissFilter);

    // End-of-travel clunk: a persistent tone and noise band, each behind its own envelope (triggered, never created).
    this.clunkGain = keep(gain(ctx, 0));
    this.clunkGain.connect(out);
    this.clunkTone = keep(osc(ctx, 'sine', CLUNK.toneHz));
    this.clunkTone.connect(this.clunkGain);
    this.knockGain = keep(gain(ctx, 0));
    this.knockGain.connect(out);
    const knockFilter = keep(filter(ctx, 'bandpass', CLUNK.knockHz, CLUNK.knockQ));
    knockFilter.connect(this.knockGain);
    this.noise.connect(knockFilter);

    this.beeper = new ReverseBeeper(ctx, out, beepHz);

    this.nodes = nodes;
    this.sources = [...this.drive, this.noise, this.seam, this.pump, this.pumpOvertone, this.clunkTone];
    const t = ctx.currentTime;
    for (const s of this.sources) s.start(t);
  }

  /**
   * Once per frame. `speed` = signed normalised drive speed −1‥1 (|speed| / maxSpeed; negative = in reverse, which
   * also beeps). `forkMotion` = signed normalised fork rate −1‥1 (+ up, − down; 0‥1 values read as rising).
   * `forkHeight` = the carriage's stack / slot height (0 = floor, fractional while it moves): the pump sits a little
   * higher per level. Smoothing is done by the audio thread (setTargetAtTime).
   */
  set(speed: number, forkMotion: number, forkHeight = 0): void {
    const now = this.ctx.currentTime;
    const signed = clampSigned(speed);
    this.setDrive(Math.abs(signed), now);
    this.beeper.update(signed);
    this.setForks(clampSigned(forkMotion), clampHeight(forkHeight), now);
  }

  /** Whether the reverse beeper is running. */
  get reversing(): boolean {
    return this.beeper.beeping;
  }

  /** No end-of-travel clunk until audio time `until` (a box was just picked or set down: its own knock says it). */
  hushClunk(until: number): void {
    if (Number.isFinite(until)) this.hushUntil = Math.max(this.hushUntil, until);
  }

  /** Fade to silence quickly (e.g. before suspending): no clunk, no beep. */
  silence(): void {
    this.forkMoving = false;
    this.set(0, 0, this.lastHeight);
  }

  dispose(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.beeper.dispose();
    disconnectAll(this.nodes);
  }

  private setDrive(s: number, now: number): void {
    if (Math.abs(s - this.lastSpeed) <= SPEED_EPSILON && !(s === 0 && this.lastSpeed !== 0)) return;
    const rising = s > this.lastSpeed;
    this.lastSpeed = s;
    const tau = rising ? DRIVE.attackTau : DRIVE.releaseTau;
    const pitch = DRIVE.lowHz + (DRIVE.topHz - DRIVE.lowHz) * s;
    for (let i = 0; i < this.drive.length; i++) glideParam(this.drive[i].frequency, pitch * DRIVE.partials[i][0], now, DRIVE.pitchTau);
    glideParam(this.driveFilter.frequency, DRIVE.lowpassLowHz + (DRIVE.lowpassTopHz - DRIVE.lowpassLowHz) * s, now, DRIVE.pitchTau);
    glideParam(this.driveGain.gain, DRIVE.level * Math.pow(s, DRIVE.curve), now, tau);

    const roll = ROLL.level * Math.pow(s, ROLL.curve);
    glideParam(this.rollGain.gain, roll, now, tau);
    glideParam(this.seamDepth.gain, roll * ROLL.seamDepth, now, tau);
    glideParam(this.seam.frequency, Math.max(0.1, ROLL.seamTopHz * s), now, DRIVE.pitchTau);
    glideParam(this.rollFilter.frequency, ROLL.lowpassLowHz + (ROLL.lowpassTopHz - ROLL.lowpassLowHz) * s, now, DRIVE.pitchTau);
  }

  private setForks(m: number, h: number, now: number): void {
    const rate = Math.abs(m);
    // End of travel: moving → still after a real travel, outside the hush after a pick / drop, not too often.
    if (rate > FORK.movingAt) {
      if (!this.forkMoving) this.travelFrom = now;
      this.forkMoving = true;
    } else if (this.forkMoving && rate < FORK.stillAt) {
      this.forkMoving = false;
      if (now - this.travelFrom >= CLUNK.minTravelSec && now >= this.hushUntil && now - this.lastClunkAt >= CLUNK.gapSec) {
        this.clunk(now, this.forkDir, h);
      }
    }

    if (Math.abs(m - this.lastFork) <= FORK_EPSILON && Math.abs(h - this.lastHeight) <= HEIGHT_EPSILON && !(m === 0 && this.lastFork !== 0)) return;
    this.lastFork = m;
    this.lastHeight = h;
    if (m !== 0) this.forkDir = m > 0 ? 1 : -1;
    const up = this.forkDir > 0;
    const amount = Math.pow(rate, FORK.curve);
    const tau = rate > 0 ? FORK.attackTau : FORK.releaseTau;
    const pitch = (up ? FORK.upHz : FORK.downHz) * (1 + FORK.perLevel * h);
    glideParam(this.pump.frequency, pitch, now, FORK.attackTau);
    glideParam(this.pumpOvertone.frequency, pitch * FORK.overtone[0], now, FORK.attackTau);
    glideParam(this.pumpFilter.frequency, up ? FORK.upLowpassHz : FORK.downLowpassHz, now, FORK.attackTau);
    glideParam(this.pumpGain.gain, (up ? FORK.upLevel : FORK.downLevel) * amount, now, tau);
    glideParam(this.hissGain.gain, up ? 0 : FORK.hissLevel * amount, now, tau);
  }

  /** The clunk at `t`: a short low tone gliding down plus a soft contact, from the persistent nodes' envelopes. */
  private clunk(t: number, dir: number, h: number): void {
    this.lastClunkAt = t;
    const k = (1 + FORK.perLevel * h) * (dir < 0 ? CLUNK.downPitch : 1);
    const f = this.clunkTone.frequency;
    holdParam(f, t);
    f.setValueAtTime(CLUNK.toneHz * k, t);
    f.exponentialRampToValueAtTime(CLUNK.toneEndHz * k, t + 0.08);
    strike(this.clunkGain.gain, CLUNK.toneLevel, CLUNK.toneTau, t);
    strike(this.knockGain.gain, CLUNK.knockLevel, CLUNK.knockTau, t);
  }
}

/** A percussive envelope on a persistent gain: a near-instant rise to `peak` at `t`, then a `decay` fall. */
function strike(param: AudioParam, peak: number, decay: number, t: number): void {
  holdParam(param, t);
  param.setTargetAtTime(peak, t, 0.002);
  param.setTargetAtTime(0, t + 0.008, decay);
}

function clampSigned(v: number): number {
  return Number.isFinite(v) ? (v < -1 ? -1 : v > 1 ? 1 : v) : 0;
}

function clampHeight(v: number): number {
  return Number.isFinite(v) ? Math.min(Math.max(0, v), MAX_HEIGHT) : 0;
}

/** 1 s of white noise, for a MotorSound built without the graph's shared buffer. */
function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate)), ctx.sampleRate);
  fillNoise(buffer.getChannelData(0), mulberry32(0x7040));
  return buffer;
}
