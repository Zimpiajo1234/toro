import type { GameConfig } from '../config';
import type { Rng } from './types';
import { fillNoise, renderImpulse } from './dsp/impulse';
import { disconnectAll, filter, gain, osc } from './nodes';

export type AudioVolumes = GameConfig['audio'];

/**
 * The fixed mixing graph:
 *
 *   music voices → musicIn → tape wow → musicFade → musicDuck → musicVol ┐
 *   sfx voices   → sfxIn  → sfxVol ────────────────────────────────────── ├→ master → wake → low-pass → compressor → out
 *   motor        → motorIn → motorVol ────────────────────────────────── ┘
 *   musicVol / sfxVol ─send→ reverb (procedural IR) ─→ master
 */
export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly musicIn: GainNode;
  readonly sfxIn: GainNode;
  readonly motorIn: GainNode;
  /** One-shot fade-in on unlock. */
  readonly musicFade: GainNode;
  /** Level-complete ducking. */
  readonly musicDuck: GainNode;
  /** Volume × mute. */
  readonly master: GainNode;
  /** Page-visibility fades (so suspending never clicks). */
  readonly wake: GainNode;
  /** 2 s of white noise shared by every noise-based voice. */
  readonly noise: AudioBuffer;
  dispose(): void;
}

export function createAudioGraph(ctx: BaseAudioContext, volumes: AudioVolumes, rng: Rng, muted: boolean): AudioGraph {
  const nodes: AudioNode[] = [];
  const keep = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };

  const compressor = keep(ctx.createDynamicsCompressor());
  compressor.threshold.value = -18;
  compressor.knee.value = 24;
  compressor.ratio.value = 2.5;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.3;
  compressor.connect(ctx.destination);

  // Butterworth: flat below, -3 dB at 10 kHz (a lower Q would pull the whole mix down from ~6 kHz).
  const lowpass = keep(filter(ctx, 'lowpass', 10000, Math.SQRT1_2));
  lowpass.connect(compressor);
  const wake = keep(gain(ctx, 1));
  wake.connect(lowpass);
  const master = keep(gain(ctx, muted ? 0 : volumes.master));
  master.connect(wake);

  // Reverb: warm small-room IR rendered at startup.
  const reverb = keep(ctx.createConvolver());
  const [left, right] = renderImpulse(ctx.sampleRate, rng);
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.getChannelData(0).set(left);
  ir.getChannelData(1).set(right);
  reverb.buffer = ir;
  const reverbReturn = keep(gain(ctx, 0.55));
  reverb.connect(reverbReturn);
  reverbReturn.connect(master);

  // Music bus.
  const musicIn = keep(gain(ctx, 1));
  const wow = keep(ctx.createDelay(0.05));
  wow.delayTime.value = 0.015;
  const wowLfo = keep(osc(ctx, 'sine', 0.31));
  const wowDepth = keep(gain(ctx, 0.0011));
  wowLfo.connect(wowDepth);
  wowDepth.connect(wow.delayTime);
  wowLfo.start();
  const musicFade = keep(gain(ctx, 0));
  const musicDuck = keep(gain(ctx, 1));
  const musicVol = keep(gain(ctx, volumes.music));
  const musicSend = keep(gain(ctx, 0.42));
  musicIn.connect(wow);
  wow.connect(musicFade);
  musicFade.connect(musicDuck);
  musicDuck.connect(musicVol);
  musicVol.connect(master);
  musicVol.connect(musicSend);
  musicSend.connect(reverb);

  // SFX bus.
  const sfxIn = keep(gain(ctx, 1));
  const sfxVol = keep(gain(ctx, volumes.sfx));
  const sfxSend = keep(gain(ctx, 0.22));
  sfxIn.connect(sfxVol);
  sfxVol.connect(master);
  sfxVol.connect(sfxSend);
  sfxSend.connect(reverb);

  // Motor bus (dry).
  const motorIn = keep(gain(ctx, 1));
  const motorVol = keep(gain(ctx, volumes.motor));
  motorIn.connect(motorVol);
  motorVol.connect(master);

  const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
  fillNoise(noise.getChannelData(0), rng);

  return {
    ctx,
    musicIn,
    sfxIn,
    motorIn,
    musicFade,
    musicDuck,
    master,
    wake,
    noise,
    dispose() {
      try {
        wowLfo.stop();
      } catch {
        /* already stopped */
      }
      disconnectAll(nodes);
    },
  };
}
