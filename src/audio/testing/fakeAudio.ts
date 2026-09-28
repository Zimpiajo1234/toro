/**
 * Minimal recording fake of the Web Audio API, for unit tests only (they run in node, without audio).
 * Nodes remember their connections and params their automation calls; nothing is rendered.
 */

export interface ParamEvent {
  kind: 'set' | 'linear' | 'exp' | 'target' | 'cancel' | 'hold';
  value: number;
  time: number;
  tau?: number;
}

export class FakeParam {
  readonly events: ParamEvent[] = [];
  constructor(public value = 0) {}
  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'set', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'linear', value, time });
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: 'exp', value, time });
    return this;
  }
  setTargetAtTime(value: number, time: number, tau: number): this {
    this.events.push({ kind: 'target', value, time, tau });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.events.push({ kind: 'cancel', value: this.value, time });
    return this;
  }
  cancelAndHoldAtTime(time: number): this {
    this.events.push({ kind: 'hold', value: this.value, time });
    return this;
  }
  /** Last automation event (or undefined). */
  last(): ParamEvent | undefined {
    return this.events[this.events.length - 1];
  }
}

export class FakeNode {
  readonly outputs: unknown[] = [];
  constructor(readonly kind: string) {}
  connect<T>(destination: T): T {
    this.outputs.push(destination);
    return destination;
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);
}

export class FakeBiquad extends FakeNode {
  type: BiquadFilterType = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
  readonly detune = new FakeParam(0);
}

export class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  start(time = 0): void {
    this.startedAt = time;
  }
  stop(time = 0): void {
    this.stoppedAt = time;
  }
}

export class FakeOscillator extends FakeSource {
  type: OscillatorType = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
}

export class FakeBuffer {
  private readonly channels: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number): Float32Array {
    return this.channels[channel];
  }
}

export class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam(1);
  readonly detune = new FakeParam(0);
}

export class FakePanner extends FakeNode {
  readonly pan = new FakeParam(0);
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
  normalize = true;
}

export class FakeDelay extends FakeNode {
  readonly delayTime = new FakeParam(0);
}

/** Fake (Offline)AudioContext. `resumeMode: 'manual'` keeps resume() pending until `finishResume()`. */
export class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  currentTime = 0;
  readonly sampleRate: number;
  state: AudioContextState = 'suspended';
  readonly nodes: FakeNode[] = [];
  readonly destination = new FakeNode('destination');
  resumeMode: 'instant' | 'manual' = 'instant';
  suspendCalls = 0;
  private pendingResume: (() => void)[] = [];

  constructor(options: { sampleRate?: number } = {}) {
    this.sampleRate = options.sampleRate ?? 8000;
    FakeAudioContext.instances.push(this);
  }

  /** The fake typed as the real thing (for code under test). */
  asContext(): AudioContext {
    return this as unknown as AudioContext;
  }

  private add<T extends FakeNode>(node: T): T {
    this.nodes.push(node);
    return node;
  }

  createGain(): FakeGain {
    return this.add(new FakeGain('gain'));
  }
  createBiquadFilter(): FakeBiquad {
    return this.add(new FakeBiquad('biquad'));
  }
  createOscillator(): FakeOscillator {
    return this.add(new FakeOscillator('oscillator'));
  }
  createBufferSource(): FakeBufferSource {
    return this.add(new FakeBufferSource('bufferSource'));
  }
  createStereoPanner(): FakePanner {
    return this.add(new FakePanner('panner'));
  }
  createDynamicsCompressor(): FakeCompressor {
    return this.add(new FakeCompressor('compressor'));
  }
  createConvolver(): FakeConvolver {
    return this.add(new FakeConvolver('convolver'));
  }
  createDelay(): FakeDelay {
    return this.add(new FakeDelay('delay'));
  }
  createBuffer(channels: number, length: number, sampleRate: number): FakeBuffer {
    return new FakeBuffer(channels, length, sampleRate);
  }

  resume(): Promise<void> {
    if (this.resumeMode === 'instant') {
      if (this.state !== 'closed') this.state = 'running';
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.pendingResume.push(() => {
        if (this.state !== 'closed') this.state = 'running';
        resolve();
      });
    });
  }

  /** Completes every pending manual resume(). */
  finishResume(): void {
    for (const done of this.pendingResume.splice(0)) done();
  }

  suspend(): Promise<void> {
    this.suspendCalls++;
    if (this.state !== 'closed') this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';
    return Promise.resolve();
  }

  /** Created nodes of one kind, in creation order. */
  ofKind<T extends FakeNode>(ctor: new (kind: string) => T): T[] {
    return this.nodes.filter((n): n is T => n instanceof ctor);
  }
}

/** Minimal EventTarget stand-in for `window` / `document` in node tests. */
export class FakeEventTarget {
  readonly listeners = new Map<string, Set<() => void>>();
  visibilityState: DocumentVisibilityState = 'visible';
  addEventListener(type: string, fn: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)?.add(fn);
  }
  removeEventListener(type: string, fn: () => void): void {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }
  count(): number {
    let n = 0;
    for (const set of this.listeners.values()) n += set.size;
    return n;
  }
}
