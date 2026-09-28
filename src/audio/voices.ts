import { disconnectAll, gain, holdParam } from './nodes';

export interface Voice {
  /** Quick click-free fade and stop starting at `at` (voice stealing / shutdown). */
  release(at: number): void;
}

/** Bounded polyphony: adding past capacity fast-releases the oldest voice. */
export class VoicePool {
  private readonly active: Voice[] = [];

  constructor(readonly max: number) {}

  get size(): number {
    return this.active.length;
  }

  add(voice: Voice, now: number): void {
    while (this.active.length >= this.max) this.active.shift()?.release(now);
    this.active.push(voice);
  }

  remove(voice: Voice): void {
    const i = this.active.indexOf(voice);
    if (i >= 0) this.active.splice(i, 1);
  }

  releaseAll(now: number): void {
    for (const v of this.active.splice(0)) v.release(now);
  }
}

/**
 * Owns every node of one sounding note. All sources start and stop together; once they have all
 * ended, every node is disconnected and the voice leaves its pool, so nothing lingers in the graph.
 * `output` (gain 1) is the voice's single exit, used for the steal / shutdown fade.
 */
export class NoteVoice implements Voice {
  readonly output: GainNode;
  private readonly nodes: AudioNode[] = [];
  private readonly sources: AudioScheduledSourceNode[] = [];
  /** Buffer offsets (seconds) for AudioBufferSourceNodes, keyed by index into `sources`. */
  private readonly offsets = new Map<number, { src: AudioBufferSourceNode; offset: number }>();
  private endedCount = 0;
  private done = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    destination: AudioNode,
    private readonly pool: VoicePool,
  ) {
    this.output = gain(ctx, 1);
    this.output.connect(destination);
    this.nodes.push(this.output);
  }

  /** Registers a processing node for cleanup. */
  node<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  /** Registers an oscillator / constant source. */
  source<T extends AudioScheduledSourceNode>(s: T): T {
    this.nodes.push(s);
    this.sources.push(s);
    s.onended = this.handleEnded;
    return s;
  }

  /** Registers a buffer source that starts `offset` seconds into its buffer. */
  bufferSource(s: AudioBufferSourceNode, offset: number): AudioBufferSourceNode {
    this.offsets.set(this.sources.length, { src: s, offset });
    return this.source(s);
  }

  /** Starts every source at `t0` (never in the past) and schedules their stop. */
  play(t0: number, stopAt: number): void {
    const now = this.ctx.currentTime;
    const start = Math.max(t0, now);
    const stop = Math.max(stopAt, start + 0.02);
    for (let i = 0; i < this.sources.length; i++) {
      const s = this.sources[i];
      const buffered = this.offsets.get(i);
      if (buffered) buffered.src.start(start, buffered.offset);
      else s.start(start);
      s.stop(stop);
    }
    this.pool.add(this, now);
  }

  release(at: number): void {
    if (this.done) return;
    const t = Math.max(at, this.ctx.currentTime);
    holdParam(this.output.gain, t);
    this.output.gain.setTargetAtTime(0, t, 0.03);
    for (const s of this.sources) {
      try {
        s.stop(t + 0.2);
      } catch {
        /* not started or already stopped */
      }
    }
  }

  private readonly handleEnded = (): void => {
    this.endedCount++;
    if (this.endedCount >= this.sources.length) this.cleanup();
  };

  private cleanup(): void {
    if (this.done) return;
    this.done = true;
    for (const s of this.sources) s.onended = null;
    disconnectAll(this.nodes);
    this.nodes.length = 0;
    this.sources.length = 0;
    this.offsets.clear();
    this.pool.remove(this);
  }
}
