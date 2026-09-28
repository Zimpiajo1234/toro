import type { GameEvent } from '../core/types';
import { GAME_CONFIG, type GameConfig } from '../config';
import type { AudioScene, Rng } from './types';
import { createAudioGraph, type AudioGraph } from './graph';
import { Composer, type ComposerDebug } from './music/Composer';
import { bassNote, buildChord, chimeNote, completionArpeggio, padVoicing } from './music/harmony';
import { TONIC_CHORD } from './music/progressions';
import { MusicPlayer } from './MusicPlayer';
import { SfxPlayer } from './sfx';
import { MotorSound } from './motor';
import { glideParam, rampParam } from './nodes';

export type { AudioScene } from './types';

const MUSIC_FADE_IN_SEC = 4;
const MUTE_RAMP_SEC = 0.4;
const RESUME_TIMEOUT_MS = 800;
/** Delay between the hide fade-out starting and suspending the context (the fade is 0.12 s). */
const SUSPEND_DELAY_MS = 180;
/** Sounds triggered right after unlock() are kept even if the context is still starting up. */
const STARTUP_GRACE_MS = 1000;
/**
 * A dropped box glides for this long before it touches the floor and squashes (render uses the same value):
 * the felt thump and the chime land with it. The forks' servo already answers the key press at once.
 */
export const DROP_LAND_SEC = GAME_CONFIG.box.dropLandSec;
/** The level-complete arpeggio waits for the final chime (and its second strike) to ring first. */
export const COMPLETE_AFTER_LAND_SEC = 0.2;

/** Internal state bundle, present only once Web Audio has been created. */
interface Runtime {
  ctx: AudioContext;
  graph: AudioGraph;
  music: MusicPlayer;
  sfx: SfxPlayer;
  motor: MotorSound;
}

export interface AudioDebugInfo extends ComposerDebug {
  state: AudioContextState | 'unavailable' | 'locked';
  muted: boolean;
  voices: number;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

/**
 * Procedural cozy soundscape (Web Audio only, no asset files): generative lo-fi music + soft SFX.
 * Every public method is safe to call at any time: before unlock, without Web Audio, after dispose —
 * it silently does nothing and never throws.
 */
export class AudioEngine {
  private rt: Runtime | null = null;
  private readonly composer: Composer;
  private readonly rng: Rng = Math.random;
  private muted = false;
  private scene: AudioScene = 'title';
  private disposed = false;
  private unavailable = false;
  private creating = false;
  private gestureListening = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeRequestedAt = -Infinity;

  constructor(private readonly config: GameConfig['audio'] = GAME_CONFIG.audio) {
    this.composer = new Composer({ rng: this.rng });
  }

  /** Create / resume the AudioContext. Must be called from a user gesture. Idempotent. */
  async unlock(): Promise<void> {
    if (this.disposed || this.unavailable) return;
    try {
      if (!this.rt && !this.creating) this.create();
      await this.resume();
    } catch (err) {
      warn('unlock', err);
    }
  }

  handleEvent(event: GameEvent): void {
    if (this.disposed) return;
    // The music resolves even when muted, so it is in the right place when sound returns.
    if (event.type === 'levelComplete') this.composer.requestResolve();
    this.guard('handleEvent', (rt, now) => {
      switch (event.type) {
        case 'boxPicked':
          rt.sfx.pickup(now);
          break;
        case 'boxDropped': {
          const chime = event.correct ? chimeNote(this.composer.keyPc, event.satisfiedCount, event.total, this.composer.currentChord() ?? undefined) : null;
          rt.sfx.drop(now + DROP_LAND_SEC, chime, event.correct && event.satisfiedCount >= event.total);
          break;
        }
        case 'zoneReleased':
          rt.sfx.tick(now, 'release');
          break;
        case 'actionIdle':
          rt.sfx.tick(now, 'idle');
          break;
        case 'levelComplete':
          this.playLevelComplete(rt, now);
          break;
        case 'firstInput':
          break;
      }
    });
  }

  /** Called every frame. speed01 = |speed| / maxSpeed, forkMotion01 = how fast the forks are moving. */
  setMotor(speed01: number, forkMotion01: number): void {
    const rt = this.rt;
    if (!rt) return;
    try {
      rt.motor.set(speed01, forkMotion01);
    } catch (err) {
      warn('setMotor', err);
    }
  }

  setScene(scene: AudioScene): void {
    if (this.disposed || scene === this.scene) return;
    this.scene = scene;
    try {
      this.composer.setScene(scene);
    } catch (err) {
      warn('setScene', err);
    }
  }

  setMuted(muted: boolean): void {
    if (this.disposed) return;
    this.muted = muted;
    const rt = this.rt;
    if (!rt) return;
    try {
      const now = rt.ctx.currentTime;
      rampParam(rt.graph.master.gain, muted ? 0 : this.config.master, now, MUTE_RAMP_SEC);
      rt.music.setSilent(muted, now + MUTE_RAMP_SEC + 0.05);
    } catch (err) {
      warn('setMuted', err);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  /** Soft click for UI buttons. */
  uiClick(): void {
    this.guard('uiClick', (rt, now) => rt.sfx.uiClick(now));
  }

  /** Dev / diagnostics snapshot (chord, scene, live voices). */
  getDebugInfo(): AudioDebugInfo {
    const rt = this.rt;
    return {
      ...this.composer.debug(),
      state: this.unavailable ? 'unavailable' : rt ? rt.ctx.state : 'locked',
      muted: this.muted,
      voices: rt ? rt.music.voiceCount() + rt.sfx.voiceCount() : 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopGestureListeners();
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    this.clearSuspendTimer();
    const rt = this.rt;
    this.rt = null;
    if (!rt) return;
    try {
      rt.music.dispose();
      rt.sfx.releaseAll();
      rt.motor.dispose();
      rt.graph.dispose();
      void rt.ctx.close().catch(() => undefined);
    } catch (err) {
      warn('dispose', err);
    }
  }

  /* ---------------------------------------------------------------- */

  private create(): void {
    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.unavailable = true;
      return;
    }
    this.creating = true;
    let ctx: AudioContext | null = null;
    try {
      ctx = new Ctor({ latencyHint: 'interactive' });
      const graph = createAudioGraph(ctx, this.config, this.rng, this.muted);
      const music = new MusicPlayer(graph, this.composer, this.rng);
      const sfx = new SfxPlayer(ctx, graph.sfxIn, graph.noise, this.rng);
      const motor = new MotorSound(ctx, graph.motorIn);
      this.rt = { ctx, graph, music, sfx, motor };

      this.composer.setScene(this.scene);
      if (this.muted) music.setSilent(true, 0);
      // Music fades in gently; the ramp waits on the audio clock if the context starts suspended.
      const t = ctx.currentTime;
      graph.musicFade.gain.setValueAtTime(0, t);
      graph.musicFade.gain.linearRampToValueAtTime(1, t + MUSIC_FADE_IN_SEC);
      music.start();

      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisibility);
      this.startGestureListeners();
    } catch (err) {
      if (!this.rt) {
        this.unavailable = true;
        if (ctx) void ctx.close().catch(() => undefined);
      }
      warn('create', err);
    } finally {
      this.creating = false;
    }
  }

  /** Resumes a suspended context (bounded wait: some browsers keep the promise pending without a gesture). */
  private async resume(): Promise<void> {
    const rt = this.rt;
    if (!rt || rt.ctx.state !== 'suspended' || isHidden()) return;
    this.resumeRequestedAt = Date.now();
    const resumed = rt.ctx.resume().catch(() => undefined);
    // A slow resume (e.g. Bluetooth output) may finish after the tab was hidden again: go straight back to sleep.
    void resumed.then(() => {
      try {
        if (!this.disposed && this.rt === rt && isHidden() && isRunning(rt.ctx)) this.fadeAndSuspend(rt);
      } catch (err) {
        warn('resume', err);
      }
    });
    await Promise.race([resumed, new Promise<void>((r) => setTimeout(r, RESUME_TIMEOUT_MS))]);
    // Disposed meanwhile (unmount / HMR): leave everything torn down.
    if (this.disposed || this.rt !== rt) return;
    // Still blocked (no user activation yet): retry on the next click / key press.
    if (isRunning(rt.ctx)) this.stopGestureListeners();
    else this.startGestureListeners();
  }

  private playLevelComplete(rt: Runtime, now: number): void {
    const key = this.composer.keyPc;
    const tonic = buildChord(key, TONIC_CHORD);
    // The level completes on the final drop: the arpeggio follows that box's landing chime (with the zones'
    // glow wave), on the music's 8th-note grid so it feels part of the song, fitted to the chord still
    // sounding. The tonic swell waits for the downbeat where the music resolves (the bar requestResolve()
    // lands on) and carries that bar's sub-bass: one bass, never two roots at once.
    const at = rt.music.nextEighth(now + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC);
    const downbeat = rt.music.nextUnplannedDownbeat(at);
    rt.music.yieldResolveBass();
    const arpeggio = completionArpeggio(key, this.composer.currentChord() ?? undefined);
    rt.sfx.levelComplete(at, arpeggio, downbeat, padVoicing(tonic, 48), bassNote(tonic, 36));
    const duck = rt.graph.musicDuck.gain;
    glideParam(duck, 0.45, now, 0.25);
    duck.setTargetAtTime(1, now + 3.4, 1.2);
  }

  /** Runs `fn` only when the engine is live and audible; swallows (and logs in dev) any error. */
  private guard(label: string, fn: (rt: Runtime, now: number) => void): void {
    const rt = this.rt;
    if (!rt || this.muted || !this.isLive(rt)) return;
    try {
      fn(rt, rt.ctx.currentTime);
    } catch (err) {
      warn(label, err);
    }
  }

  /** Running, or about to be (the click that unlocked audio should still get its sound). */
  private isLive(rt: Runtime): boolean {
    const state = rt.ctx.state;
    if (state === 'running') return true;
    return state === 'suspended' && !isHidden() && Date.now() - this.resumeRequestedAt < STARTUP_GRACE_MS;
  }

  private readonly onVisibility = (): void => {
    const rt = this.rt;
    if (!rt) return;
    try {
      if (isHidden()) {
        this.fadeAndSuspend(rt);
      } else {
        this.clearSuspendTimer();
        void this.resume().then(() => {
          const live = this.rt;
          if (this.disposed || !live) return;
          try {
            // Hidden again while the resume was pending: stay asleep instead of waking up in the background.
            if (isHidden()) this.fadeAndSuspend(live);
            else rampParam(live.graph.wake.gain, 1, live.ctx.currentTime, 0.8);
          } catch (err) {
            warn('visibility', err);
          }
        });
      }
    } catch (err) {
      warn('visibility', err);
    }
  };

  /** Fades everything out, then suspends the context (fading first so suspending never clicks). */
  private fadeAndSuspend(rt: Runtime): void {
    rampParam(rt.graph.wake.gain, 0, rt.ctx.currentTime, 0.12);
    rt.motor.silence();
    this.clearSuspendTimer();
    this.suspendTimer = setTimeout(() => {
      this.suspendTimer = null;
      const live = this.rt;
      if (live && isHidden() && isRunning(live.ctx)) void live.ctx.suspend().catch(() => undefined);
    }, SUSPEND_DELAY_MS);
  }

  private clearSuspendTimer(): void {
    if (this.suspendTimer !== null) clearTimeout(this.suspendTimer);
    this.suspendTimer = null;
  }

  /** Fallback: if the context could not start (no gesture yet), resume on the next interaction. */
  private readonly onGesture = (): void => {
    void this.resume();
  };

  private startGestureListeners(): void {
    if (this.disposed || this.gestureListening || typeof window === 'undefined') return;
    this.gestureListening = true;
    for (const type of GESTURE_EVENTS) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
  }

  private stopGestureListeners(): void {
    if (!this.gestureListening || typeof window === 'undefined') return;
    this.gestureListening = false;
    for (const type of GESTURE_EVENTS) window.removeEventListener(type, this.onGesture, { capture: true });
  }
}

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchend'] as const;

function audioContextCtor(): AudioContextCtor | null {
  const g = globalThis as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

function isHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function warn(where: string, err: unknown): void {
  if (import.meta.env?.DEV) console.warn(`[audio] ${where}:`, err);
}

/** Reads the live state (a plain function so TS does not keep a narrowed value across awaits). */
function isRunning(ctx: BaseAudioContext): boolean {
  return ctx.state === 'running';
}
