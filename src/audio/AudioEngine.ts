import type { MatchKind } from '../core/sorting';
import { STORAGE_SKINS } from '../core/storage';
import type { GameEvent, StorageSkin } from '../core/types';
import { GAME_CONFIG, type GameConfig } from '../config';
import type { AudioScene, Rng } from './types';
import { createAudioGraph, type AudioGraph } from './graph';
import { Composer, type ComposerDebug } from './music/Composer';
import { bassNote, buildChord, chimeNote, completionArpeggio, padVoicing, stackArpeggio } from './music/harmony';
import { TONIC_CHORD } from './music/progressions';
import { MusicPlayer } from './MusicPlayer';
import { SfxPlayer, STACK_NOTE_GAP } from './sfx';
import { CLUNK, MotorSound } from './motor';
import { beepFrequency } from './beeper';
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
/**
 * The level-complete arpeggio waits for the final chime (and its second strike) to ring first; a completed
 * stack's figure delays that chime further, and the arpeggio waits for that too.
 */
export const COMPLETE_AFTER_LAND_SEC = 0.2;
/**
 * Levels with racks: a box set down on a target that is not its destiny buzzes softly this long after it lands (its
 * thump / toc first, where a destined box's chime would ring).
 */
export const WRONG_AFTER_LAND_SEC = 0.05;
/** A zone un-completed by a box stacked on top ticks just after that box lands (its knock first). */
export const RELEASE_AFTER_LAND_SEC = 0.03;
/** A zone satisfied again by lifting a wrong top box chimes this long after the pickup knock. */
export const RESTORE_AFTER_PICK_SEC = 0.12;

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
  /** The player's «pitido» setting (B): the reverse beeper may sound. Kept here so it applies once audio starts. */
  private reverseBeep = true;
  private scene: AudioScene = 'title';
  private disposed = false;
  private unavailable = false;
  private creating = false;
  private gestureListening = false;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private resumeRequestedAt = -Infinity;
  /** Box of the drop just handled: a zone it un-completes (stacked on top) releases when it lands. Cleared by a pick. */
  private droppedBoxId: string | null = null;
  /** How much later than a plain chime that drop's chime rings (a completed stack climbs into it first). */
  private completeTail = 0;

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

  /**
   * `match`: how the zone (or rack slot cue) of a `boxDropped` / `zoneRestored` event matches its box (core/sorting
   * `matchKind` of its criteria), which picks the chime's timbre: color = the bell, symbol = a soft wooden marimba,
   * exact = both. Game passes it (audio never reads the level); omitted = color, the classic bell.
   */
  handleEvent(event: GameEvent, match: MatchKind = 'color'): void {
    if (this.disposed) return;
    // The music resolves even when muted, so it is in the right place when sound returns.
    if (event.type === 'levelComplete') this.composer.requestResolve();
    this.guard('handleEvent', (rt, now) => {
      switch (event.type) {
        case 'boxPicked':
          // Out of storage, as its skin sounds (core/storage STORAGE_SKINS): off a rack's metal beam the box eases up;
          // anywhere else (a truck bed too: wood), the classic knock.
          if (soundOf(event.fromSlotId, event.skin) === 'metal') rt.sfx.slotLift(now, event.level ?? 0);
          else rt.sfx.pickup(now, event.level ?? 0);
          break;
        case 'boxDropped': {
          const chord = this.composer.currentChord() ?? undefined;
          const chime = event.correct ? chimeNote(this.composer.keyPc, event.satisfiedCount, event.total, chord) : null;
          const final = event.correct && event.satisfiedCount >= event.total;
          const sound = soundOf(event.slotId, event.skin);
          if (sound === 'metal') {
            // Into a rack slot: the metal toc. `correct` = the slot now holds its destined box, the only one that
            // chimes; a box that merely fits the cue (or any box in a «libre» slot) just settles, never a success sound.
            rt.sfx.slotDrop(now + DROP_LAND_SEC, chime, final, event.level ?? 0, match);
          } else if (sound === 'wood') {
            // Onto a truck bed (loading docks): the hollow wooden trailer-floor thunk; the chime only when its truck
            // level is now satisfied (`correct`), like a rack slot.
            rt.sfx.truckDrop(now + DROP_LAND_SEC, chime, final, event.level ?? 0, match);
          } else {
            const stack =
              event.correct && event.recipeLength > 1
                ? stackArpeggio(this.composer.keyPc, event.satisfiedCount, event.total, event.recipeLength, chord)
                : null;
            rt.sfx.drop(now + DROP_LAND_SEC, chime, final, event.level ?? 0, stack, match);
          }
          // Levels with racks or trucks: on a floor zone, a cued slot or a truck slot it does not satisfy (trap boxes
          // included), the soft "no" follows the landing. A «libre» slot, plain floor and every other level never set it.
          if (isWrongTarget(event)) rt.sfx.wrongBuzz(now + DROP_LAND_SEC + WRONG_AFTER_LAND_SEC);
          break;
        }
        case 'zoneRestored': {
          // Lifting a wrong top box leaves the zone satisfied again: its chime (and stack climb) after the pickup
          // knock, never the final flourish (a pick never completes a level).
          const chord = this.composer.currentChord() ?? undefined;
          const chime = chimeNote(this.composer.keyPc, event.satisfiedCount, event.total, chord);
          const stack =
            event.recipeLength > 1
              ? stackArpeggio(this.composer.keyPc, event.satisfiedCount, event.total, event.recipeLength, chord)
              : null;
          rt.sfx.chime(now + RESTORE_AFTER_PICK_SEC, chime, false, stack, match);
          break;
        }
        case 'zoneReleased':
          // Un-completed by the box just stacked on top: the tick follows that box's landing, never precedes it.
          rt.sfx.tick(event.boxId === this.droppedBoxId ? now + DROP_LAND_SEC + RELEASE_AFTER_LAND_SEC : now, 'release');
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
    this.noteDrop(event);
    this.hushForkClunk(event);
  }

  /**
   * Called every frame with the forklift's motion (MotorSound). `speed` = speed / maxSpeed, signed −1‥1: the electric
   * whine and tyre roll follow |speed|, and moving in reverse (negative) sounds the back-up beeper. `forkMotion` = how
   * fast the forks move, signed −1‥1 (+ raising: the pump whir; − lowering: the soft tone and hiss; a 0‥1 value reads
   * as raising). `forkHeight` = their stack / slot height (0 = floor; the pump sits a little higher per level).
   * `reversing` = the shared reversing latch (`ForkliftState.reversing`, core/reversing): the beeper starts and stops
   * on its frames, the ones the roof beacon lights on (omitted, it latches `speed` itself, the same way).
   * Continuous sounds go through the master gain, so mute (M) silences them too (the beeper plays on the SFX bus, and
   * B turns it alone off: setReverseBeep).
   */
  setMotor(speed: number, forkMotion: number, forkHeight = 0, reversing?: boolean): void {
    const rt = this.rt;
    if (!rt) return;
    try {
      // Passed on only when given: without it MotorSound is called exactly as before and latches the speed itself.
      if (reversing === undefined) rt.motor.set(speed, forkMotion, forkHeight);
      else rt.motor.set(speed, forkMotion, forkHeight, reversing);
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

  /**
   * The reverse beeper on / off (the persisted «pitido» setting, B). Off, backing up stays silent and a beep sounding
   * fades out at once (its soft stop); every other sound is unaffected. Independent of mute (M silences everything,
   * the beep included, whatever this says). Safe before unlock: it applies when audio starts.
   */
  setReverseBeep(enabled: boolean): void {
    if (this.disposed) return;
    this.reverseBeep = enabled;
    const rt = this.rt;
    if (!rt) return;
    try {
      rt.motor.setReverseBeep(enabled);
    } catch (err) {
      warn('setReverseBeep', err);
    }
  }

  isReverseBeepOn(): boolean {
    return this.reverseBeep;
  }

  /** Soft click for UI buttons. */
  uiClick(): void {
    this.guard('uiClick', (rt, now) => rt.sfx.uiClick(now));
  }

  /**
   * Soft detent click for one fork step at a storage column (a rack's or a truck's: the forks go by the keys at every
   * unit). Game calls it only for a step that took effect (never at the top / bottom level, never away from a unit).
   * `level` = the level selected now, `direction` +1 up / −1 down.
   */
  forkClick(level: number, direction: 1 | -1): void {
    this.guard('forkClick', (rt, now) => rt.sfx.forkClick(now, level, direction));
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
      // The reverse beep is tuned to the song's key (fixed for the session) and plays on the SFX bus: on the quiet motor
      // bus it would vanish under the music and the drive whine. The player may have turned it off (B).
      const motor = new MotorSound(ctx, graph.motorIn, graph.noise, beepFrequency(this.composer.keyPc), graph.sfxIn);
      motor.setReverseBeep(this.reverseBeep);
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
    // The level completes on the final drop: the arpeggio follows that box's landing chime (after a completed
    // stack's climb into it, with the zones' glow wave), on the music's 8th-note grid so it feels part of the
    // song, fitted to the chord still sounding. The tonic swell waits for the downbeat where the music resolves (the bar requestResolve()
    // lands on) and carries that bar's sub-bass: one bass, never two roots at once.
    const at = rt.music.nextEighth(now + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC + this.completeTail);
    const downbeat = rt.music.nextUnplannedDownbeat(at);
    rt.music.yieldResolveBass();
    const arpeggio = completionArpeggio(key, this.composer.currentChord() ?? undefined);
    rt.sfx.levelComplete(at, arpeggio, downbeat, padVoicing(tonic, 48), bassNote(tonic, 36));
    const duck = rt.graph.musicDuck.gain;
    glideParam(duck, 0.45, now, 0.25);
    duck.setTargetAtTime(1, now + 3.4, 1.2);
  }

  /**
   * Remembers the drop just handled for the events that follow it in the same batch (zoneReleased,
   * levelComplete). Kept outside guard() so it stays in step while muted.
   */
  private noteDrop(event: GameEvent): void {
    if (event.type === 'boxDropped') {
      this.droppedBoxId = event.boxId;
      this.completeTail = event.correct && event.recipeLength > 1 ? (Math.round(event.recipeLength) - 1) * STACK_NOTE_GAP : 0;
    } else if (event.type === 'boxPicked' || event.type === 'levelComplete') {
      this.droppedBoxId = null;
      this.completeTail = 0;
    }
  }

  /**
   * A box picked or set down: its knock / thump marks the moment, so the forks' end-of-travel clunk keeps quiet while
   * the carry lift (or the lowering after the drop) finishes. Outside guard() so it stays in step while muted.
   */
  private hushForkClunk(event: GameEvent): void {
    if (event.type !== 'boxPicked' && event.type !== 'boxDropped') return;
    const rt = this.rt;
    if (!rt) return;
    try {
      rt.motor.hushClunk(rt.ctx.currentTime + CLUNK.hushSec);
    } catch (err) {
      warn('hushForkClunk', err);
    }
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

/**
 * Whether a drop earns the soft wrong-target buzz: only a `boxDropped` flagged `wrongTarget` (levels with racks), and
 * never one that is also `correct` (the destined box keeps its chime alone, whatever the flag says).
 */
export function isWrongTarget(event: GameEvent): boolean {
  return event.type === 'boxDropped' && event.wrongTarget === true && !event.correct;
}

/**
 * How a pick or a drop in storage sounds (docs/STORAGE.md «Contratos», audio): the event's slot names its unit's skin,
 * whose row says the sound (core/storage STORAGE_SKINS: `metal` = a rack's slotLift / slotDrop, `wood` = pickup /
 * truckDrop); null off storage (the floor's own sounds).
 */
function soundOf(slotId: string | undefined, skin: StorageSkin | undefined): 'metal' | 'wood' | null {
  return slotId !== undefined && skin !== undefined ? STORAGE_SKINS[skin].sound : null;
}

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
