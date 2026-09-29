import type { Store } from '../core/store';
import type { GameEvent, GameSnapshot, InputFrame, LevelData } from '../core/types';
import { clamp } from '../core/math';
import { zoneMatchKinds, type MatchKind } from '../core/sorting';
import { hasRacks } from '../core/racks';
import { GAME_CONFIG } from '../config';
import { LEVELS, getLevel } from '../data/levels';
import { GameState } from '../logic/GameState';
import { MOVE_EPSILON } from '../logic/forklift';
import { forkRiseRate } from '../logic/forkRise';
import { Timer } from '../logic/Timer';
import { GameRenderer } from '../render/GameRenderer';
import { AudioEngine } from '../audio/AudioEngine';
import { PROGRESS_STORAGE_KEY, ProgressStore } from '../storage/ProgressStore';
import { getTheme } from '../themes';
import type { GameActions, LevelResult, UIState } from '../ui/uiState';
import { Input, type InputSample } from './Input';
import { inputToDrive, inputToWorld, parseMoveMapping, type ControlMappings, type DriveInput } from './cameraInput';
import {
  Countdown,
  buildLevelSummaries,
  continueIndexAfter,
  continueTarget,
  resolveStartLevel,
  shouldShowHint,
  type SavedProgress,
} from './flow';
import { MessagePicker } from './messages';
import { forkMotion01, speed01 } from './motor';
import { ElapsedThrottle } from './throttle';

/** Longest simulated step: slow frames (or a tab coming back) never make anything jump. */
const MAX_DT = 1 / 20;
/** The HUD timer is pushed to the store at most every 100 ms of play (~10 Hz). */
const ELAPSED_STEP_MS = 100;
/** Hold-to-restart progress is published in steps of this size (the ↺ fill needs no more). */
const HOLD_STEP = 0.04;
/** How keys / d-pad and the stick map to the floor (gameConfig `controls`). */
const CONTROLS: ControlMappings = {
  keyboard: parseMoveMapping(GAME_CONFIG.controls.keyboardMapping, 'vehicle'),
  stick: parseMoveMapping(GAME_CONFIG.controls.stickMapping, 'screen'),
};

/** Subsystems that only exist between mount() and dispose(). */
interface Runtime {
  renderer: GameRenderer;
  audio: AudioEngine;
  progress: ProgressStore;
  input: Input;
}

/**
 * Orchestrator: owns the frame loop and wires logic → render / audio / UI store.
 * The constructor has no side effects; everything is created in mount() and torn down in dispose(),
 * so React StrictMode's mount → dispose → mount is safe.
 */
export class Game implements GameActions {
  private readonly container: HTMLElement;
  private readonly store: Store<UIState>;
  private readonly timer = new Timer();
  private readonly messages = new MessagePicker();
  private readonly elapsedThrottle = new ElapsedThrottle(ELAPSED_STEP_MS);
  private readonly completeDelay = new Countdown();
  /** Right after the completion card appears, keys / pad buttons cannot dismiss it yet. */
  private readonly confirmGrace = new Countdown();
  /** R / pad Back held while there is work to lose. */
  private readonly restartHold = new Countdown();
  /** "Modo prueba" level-jump key held while there is work to lose; `jumpStep` is its direction. */
  private readonly jumpHold = new Countdown();
  private jumpStep: -1 | 1 = 1;
  /** World-space input handed to the simulation; reused every frame. */
  private readonly frameInput: InputFrame & { drive: DriveInput; forkStep: -1 | 0 | 1 } = {
    move: { x: 0, z: 0 },
    drive: { throttle: 0, steer: 0 },
    actionPressed: false,
    forkStep: 0,
  };
  /** The level on screen has storage racks: F / V, the wheel and pad X / B step the forks there (docs/RACKS.md). */
  private levelHasRacks = false;

  private rt: Runtime | null = null;
  private rafId = 0;
  private lastFrameMs = -1;
  private levelIndex = 0;
  private level: LevelData | null = null;
  private state: GameState | null = null;
  /** How each zone of the level matches its box (color / symbol / exact): the timbre audio gives its chime. */
  private zoneMatch = new Map<string, MatchKind>();
  /** Result of the level just completed, shown once the completion delay runs out. */
  private pendingResult: LevelResult | null = null;
  /** The control hint disappears for the whole session after the first drop. */
  private dropDone = false;
  /** A box was picked since the level loaded: restarting by key now needs a hold. */
  private workAtStake = false;
  /** The level on screen was left mid-way for the title (Esc): "Continuar" resumes it as it was. */
  private suspended = false;
  /** The timer was running when the level was suspended: it resumes on the player's next input. */
  private resumeTimerOnInput = false;
  /** Last hold-to-restart progress published to the store (0 … 1). */
  private publishedHold = 0;

  constructor(container: HTMLElement, store: Store<UIState>) {
    this.container = container;
    this.store = store;
    // The overlay may pass these around as bare callbacks (onClick={actions.restart}).
    this.start = this.start.bind(this);
    this.restart = this.restart.bind(this);
    this.nextLevel = this.nextLevel.bind(this);
    this.toTitle = this.toTitle.bind(this);
    this.toggleMute = this.toggleMute.bind(this);
    this.toggleTimer = this.toggleTimer.bind(this);
    this.toggleTestMode = this.toggleTestMode.bind(this);
  }

  /** Start the frame loop and show the title screen. */
  mount(): void {
    if (this.rt) return;
    let renderer: GameRenderer;
    try {
      renderer = new GameRenderer(this.container);
    } catch (error) {
      // No WebGL 2 context (blocklisted GPU, hardware acceleration off, old browser). Never rethrow: that would
      // unmount the whole React root and leave a blank page. The overlay still mounts; nothing else is created.
      console.warn('[Toro] WebGL 2 is not available, the game cannot start.', error);
      this.store.set({ screen: 'unsupported' });
      return;
    }
    const progress = new ProgressStore();
    const audio = new AudioEngine();
    const input = new Input(window, {
      onGesture: this.onUserGesture,
      isGameplay: () => this.store.get().screen === 'playing',
      buttonKeysLocked: () => this.confirmGrace.active,
    });
    const rt: Runtime = { renderer, audio, progress, input };
    this.rt = rt;

    const settings = progress.getSettings();
    audio.setMuted(settings.muted);
    const index = resolveStartLevel(undefined, this.savedProgress(rt), LEVELS.length);
    const level = this.loadLevel(rt, index);
    renderer.setIdleOrbit(true);
    audio.setScene('title');

    this.store.set({
      screen: 'title',
      levelCount: LEVELS.length,
      levelIndex: index,
      levelName: level.name,
      elapsedMs: 0,
      timerStarted: false,
      result: null,
      showHint: false,
      showTimer: settings.showTimer,
      muted: settings.muted,
      testMode: settings.testMode,
      ...this.progressSummary(rt, settings.testMode),
    });

    // Another tab finished a level: the title's dots and "Continuar" follow it (ProgressStore re-reads storage).
    window.addEventListener('storage', this.onStorage);

    this.lastFrameMs = -1;
    this.rafId = requestAnimationFrame(this.onFrame);
  }

  dispose(): void {
    const rt = this.rt;
    if (!rt) return;
    this.rt = null;
    window.removeEventListener('storage', this.onStorage);
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.completeDelay.cancel();
    this.confirmGrace.cancel();
    this.restartHold.cancel();
    this.jumpHold.cancel();
    this.timer.stop();
    this.state = null;
    this.suspended = false;
    rt.input.dispose();
    rt.renderer.dispose();
    rt.audio.dispose();
  }

  /* ---------------------------------------------------------------- */
  /* Actions (GameActions)                                             */
  /* ---------------------------------------------------------------- */

  start(levelIndex?: number): void {
    const rt = this.rt;
    if (!rt) return;
    this.unlockAudio(rt); // called from a click / keydown, so this is a user gesture
    rt.audio.uiClick();
    // "Continuar" (no level asked for; a click event may come through as the argument) resumes the level left with
    // Esc, even one only "Modo prueba" opened (never saved as the last level).
    const resumeSuspended = typeof levelIndex !== 'number' && this.suspended && this.level !== null;
    const index = resumeSuspended ? this.levelIndex : resolveStartLevel(levelIndex, this.savedProgress(rt), LEVELS.length);
    rt.renderer.setIdleOrbit(false);
    // The level left with Esc picks up exactly where it was; any other level (or a finished one) loads fresh.
    const resume = this.suspended && index === this.levelIndex && this.level !== null;
    this.suspended = false;
    const level = resume && this.level ? this.level : this.loadLevel(rt, index);
    // "Modo prueba" may open a level that is still locked: it never becomes the saved "Continuar" target.
    if (this.isGenuinelyOpen(rt, index)) rt.progress.setLastLevel(index);
    this.elapsedThrottle.markPublished(this.timer.elapsedMs);
    this.store.set({
      screen: 'playing',
      levelIndex: index,
      levelName: level.name,
      elapsedMs: this.timer.elapsedMs,
      timerStarted: resume ? this.store.get().timerStarted : false,
      result: null,
      showHint: shouldShowHint(index, GAME_CONFIG.flow.hintLevels, this.dropDone),
      canContinue: rt.progress.hasProgress(),
    });
    rt.audio.setScene('playing');
  }

  restart(): void {
    const rt = this.rt;
    // During the completion delay the celebration plays out; the card that follows offers "Repetir".
    if (!rt || !this.level || this.completeDelay.active) return;
    rt.audio.uiClick();
    rt.renderer.setIdleOrbit(false);
    this.loadLevel(rt, this.levelIndex);
    this.store.set({
      screen: 'playing',
      elapsedMs: 0,
      timerStarted: false,
      result: null,
      showHint: shouldShowHint(this.levelIndex, GAME_CONFIG.flow.hintLevels, this.dropDone),
    });
    rt.audio.setScene('playing');
  }

  nextLevel(): void {
    if (!this.rt) return;
    if (this.levelIndex >= LEVELS.length - 1) this.toTitle();
    else this.start(this.levelIndex + 1);
  }

  toTitle(): void {
    const rt = this.rt;
    if (!rt || this.completeDelay.active) return;
    rt.audio.uiClick();
    const state = this.state;
    const leavingPlay = this.store.get().screen === 'playing' && state !== null && !state.getSnapshot().completed;
    // Still waiting to resume (Esc again right after "Continuar") counts as running.
    this.resumeTimerOnInput = leavingPlay && (this.timer.running || this.resumeTimerOnInput);
    this.timer.stop();
    this.restartHold.cancel();
    this.jumpHold.cancel();
    this.confirmGrace.cancel();
    this.pendingResult = null;
    let index = this.levelIndex;
    let level = this.level;
    if (leavingPlay && level) {
      // Non-destructive: the arrangement stays on screen behind the title and "Continuar" resumes it.
      this.suspended = true;
      this.publishElapsed(true); // the exact paused time, not the last throttled one
    } else {
      this.suspended = false;
      // Show the level "Continuar" leads to. If it is the one on screen (e.g. the finished last level), keep it.
      index = resolveStartLevel(undefined, this.savedProgress(rt), LEVELS.length);
      if (index !== this.levelIndex || !level) level = this.loadLevel(rt, index);
    }
    rt.renderer.setIdleOrbit(true);
    rt.audio.setScene('title');
    this.store.set({
      screen: 'title',
      levelIndex: index,
      levelName: level ? level.name : '',
      result: null,
      showHint: false,
      ...this.progressSummary(rt),
    });
  }

  toggleMute(): void {
    const rt = this.rt;
    if (!rt) return;
    const muted = !this.store.get().muted;
    rt.audio.setMuted(muted);
    rt.progress.setSettings({ muted });
    this.store.set({ muted });
  }

  toggleTimer(): void {
    const rt = this.rt;
    if (!rt) return;
    rt.audio.uiClick();
    const showTimer = !this.store.get().showTimer;
    rt.progress.setSettings({ showTimer });
    this.store.set({ showTimer });
  }

  /** "Modo prueba": every level dot opens; turning it off shows the real (untouched) unlock state again. */
  toggleTestMode(): void {
    const rt = this.rt;
    if (!rt) return;
    rt.audio.uiClick();
    const testMode = !this.store.get().testMode;
    rt.progress.setSettings({ testMode });
    if (!testMode && this.suspended && !this.isGenuinelyOpen(rt, this.levelIndex)) {
      // A still-locked level left mid-way cannot stay behind the title as the "Continuar" target: show the real one.
      this.suspended = false;
      const index = resolveStartLevel(undefined, this.savedProgress(rt), LEVELS.length);
      const level = this.loadLevel(rt, index);
      this.store.set({ testMode, levelIndex: index, levelName: level.name, ...this.progressSummary(rt, testMode) });
      return;
    }
    this.store.set({ testMode, ...this.progressSummary(rt, testMode) });
  }

  /** "Modo prueba" while playing: load the previous / next level fresh (timer reset). */
  private jumpLevel(step: -1 | 1): void {
    const index = clamp(this.levelIndex + step, 0, LEVELS.length - 1);
    if (index === this.levelIndex) return;
    this.suspended = false;
    this.start(index);
  }

  /** The level is open without "Modo prueba" (index within the real unlock progress). */
  private isGenuinelyOpen(rt: Runtime, index: number): boolean {
    return index === 0 || index <= rt.progress.getHighestUnlocked();
  }

  /* ---------------------------------------------------------------- */
  /* Frame loop                                                        */
  /* ---------------------------------------------------------------- */

  private readonly onFrame = (now: number): void => {
    const rt = this.rt;
    if (!rt) return;
    this.rafId = requestAnimationFrame(this.onFrame);
    const dt = this.lastFrameMs < 0 ? 0 : clamp((now - this.lastFrameMs) / 1000, 0, MAX_DT);
    this.lastFrameMs = now;
    this.step(rt, dt);
  };

  private step(rt: Runtime, dt: number): void {
    const input = rt.input.poll();
    // Off the playing screen the action button (Space / gamepad A) confirms, like a focused primary button.
    // That press is consumed there: it must not also act in the level it just started.
    const wasPlaying = this.store.get().screen === 'playing';
    const confirm = input.confirmPressed || (input.actionPressed && !wasPlaying);
    this.handleCommands(rt, input, confirm, dt);
    if (this.rt !== rt) return;
    this.publishRestartHold();
    this.confirmGrace.tick(dt);
    if (this.completeDelay.tick(dt)) this.showCompletion();

    const state = this.state;
    if (!state) return;
    const playing = this.store.get().screen === 'playing';
    const frame = this.frameInput;
    if (playing) {
      inputToWorld(input, rt.renderer.getCameraYaw(), CONTROLS, frame.move);
      inputToDrive(input, CONTROLS, frame.drive);
      frame.actionPressed = input.actionPressed && wasPlaying;
      frame.forkStep = wasPlaying ? input.forkStep : 0;
      const driving = Math.abs(frame.drive.throttle) > MOVE_EPSILON || Math.abs(frame.drive.steer) > MOVE_EPSILON;
      const forking = frame.forkStep !== 0 && this.levelHasRacks;
      if (this.resumeTimerOnInput && (frame.actionPressed || driving || forking || Math.hypot(frame.move.x, frame.move.z) > MOVE_EPSILON)) {
        // A resumed level's clock picks up on the first input, like a fresh level's.
        this.resumeTimerOnInput = false;
        this.timer.start();
      }
    } else {
      // Title / completion card: no control, but the scene keeps settling (forklift coasts, forks lower).
      frame.move.x = 0;
      frame.move.z = 0;
      frame.drive.throttle = 0;
      frame.drive.steer = 0;
      frame.actionPressed = false;
      frame.forkStep = 0;
    }

    const liftBefore = state.getSnapshot().forklift.forkLift;
    const heightBefore = state.getSnapshot().forklift.forkHeight;
    const events = state.update(dt, frame);
    const snapshot = state.getSnapshot();
    for (let i = 0; i < events.length; i++) this.dispatch(rt, events[i], snapshot);
    if (this.rt !== rt || this.state !== state) return; // torn down or reloaded by an event handler

    if (playing) {
      this.timer.tick(dt);
      this.publishElapsed(false);
    }

    const forklift = snapshot.forklift;
    const cfg = GAME_CONFIG.forklift;
    // The climb slows with height (rate set by the higher of the current and target levels; while rising the target
    // is the next whole level up): normalise by that rate so a slower climb whines just as clearly.
    const climb = forklift.forkHeight - heightBefore;
    const climbRate = forkRiseRate(GAME_CONFIG, climb > 0 ? Math.ceil(forklift.forkHeight) : heightBefore);
    rt.audio.setMotor(
      speed01(forklift.speed, cfg.maxSpeed),
      // The servo answers both the carry lift and the climb to a stack's height, and sits higher up a stack.
      Math.max(forkMotion01(forklift.forkLift - liftBefore, dt, cfg.forkLiftSpeed), forkMotion01(climb, dt, climbRate)),
      forklift.forkHeight,
    );
    rt.renderer.update(snapshot, dt);
  }

  /** Keyboard / gamepad shortcuts that act on the flow rather than the forklift. */
  private handleCommands(rt: Runtime, input: InputSample, confirm: boolean, dt: number): void {
    if (input.mutePressed) this.toggleMute();
    if (input.timerPressed) this.toggleTimer();
    const testMode = this.store.get().testMode;
    if (input.rotateCamera !== 0) rt.renderer.rotateCamera(input.rotateCamera);
    switch (this.store.get().screen) {
      case 'title':
        if (input.testModePressed) this.toggleTestMode();
        else if (confirm) this.start();
        break;
      case 'playing': {
        if (this.completeDelay.active) {
          // The level is done: let the celebration play out.
          this.restartHold.cancel();
          this.jumpHold.cancel();
          break;
        }
        const step = testMode ? this.levelJumpRequested(input, dt) : 0;
        if (step !== 0) this.jumpLevel(step);
        else if (input.backPressed) this.toTitle();
        else if (this.restartRequested(input, dt)) this.restart();
        break;
      }
      case 'complete':
        if (this.confirmGrace.active) break; // a stray press must not skip the card before it can be read
        if (input.restartPressed || input.retryPressed) this.restart();
        else if (input.backPressed) this.toTitle();
        else if (confirm) this.nextLevel();
        break;
      default:
        break;
    }
  }

  /**
   * R / gamepad Back mid-level. Instant while nothing has been moved yet; once a box was picked it must be held
   * for `flow.restartHoldSec`, so a slip of the finger (R sits next to E) never wipes a half-tidied warehouse.
   * The HUD button stays a single click: mouse clicks are deliberate.
   */
  private restartRequested(input: InputSample, dt: number): boolean {
    if (input.restartPressed && !this.restartHold.active) {
      if (!this.workAtStake) return true;
      this.restartHold.arm(GAME_CONFIG.flow.restartHoldSec);
      return false;
    }
    if (!this.restartHold.active) return false;
    if (!input.restartHeld) {
      this.restartHold.cancel();
      return false;
    }
    return this.restartHold.tick(dt);
  }

  /**
   * "Modo prueba" level jump ([ / ], PageUp / PageDown), guarded like R: instant while nothing has been moved yet,
   * held for `flow.restartHoldSec` once a box was picked (PageDown sits by the arrows, ] by Enter), with the wait
   * shown on the HUD's ↺ fill. Returns the step to take this frame, or 0.
   */
  private levelJumpRequested(input: InputSample, dt: number): -1 | 0 | 1 {
    if (input.levelStep !== 0) {
      if (!this.workAtStake) return input.levelStep;
      this.jumpStep = input.levelStep;
      this.jumpHold.arm(GAME_CONFIG.flow.restartHoldSec);
      return 0;
    }
    if (!this.jumpHold.active) return 0;
    if (input.levelStepHeld !== this.jumpStep) {
      this.jumpHold.cancel();
      return 0;
    }
    return this.jumpHold.tick(dt) ? this.jumpStep : 0;
  }

  private dispatch(rt: Runtime, event: GameEvent, snapshot: GameSnapshot): void {
    rt.renderer.handleEvent(event, snapshot);
    rt.audio.handleEvent(event, this.matchOf(event));
    switch (event.type) {
      case 'firstInput':
        this.timer.start();
        this.store.set({ timerStarted: true });
        break;
      case 'boxPicked':
        this.workAtStake = true;
        break;
      case 'boxDropped':
        if (!this.dropDone) {
          this.dropDone = true;
          this.store.set({ showHint: false });
        }
        break;
      case 'levelComplete':
        this.onLevelComplete(rt);
        break;
      default:
        break;
    }
  }

  private onLevelComplete(rt: Runtime): void {
    const level = this.level;
    if (!level) return;
    this.timer.stop();
    this.restartHold.cancel();
    this.jumpHold.cancel();
    this.publishElapsed(true);
    const timeMs = Math.round(this.timer.elapsedMs);
    const isLast = this.levelIndex >= LEVELS.length - 1;
    // A level only "Modo prueba" opened leaves the real progress untouched: a stored time would unlock the next one
    // (a completed level always unlocks its successor), so its time is shown but not recorded.
    const genuine = this.isGenuinelyOpen(rt, this.levelIndex);
    const previousBest = rt.progress.getBest(level.id);
    const record = genuine
      ? rt.progress.record(level.id, timeMs)
      : { bestMs: Math.min(timeMs, previousBest ?? timeMs), isNewBest: false, previousBestMs: previousBest };
    if (genuine) {
      if (!isLast) rt.progress.unlock(this.levelIndex + 1);
      rt.progress.setLastLevel(continueIndexAfter(this.levelIndex, LEVELS.length));
    }

    this.pendingResult = {
      timeMs,
      bestMs: record.bestMs,
      // A first clear has nothing to beat: keep "Nuevo mejor tiempo" for real improvements.
      isNewBest: record.isNewBest && record.previousBestMs !== null,
      message: this.messages.next(),
      isLast,
      practice: !genuine,
    };
    this.store.set(this.progressSummary(rt));
    this.completeDelay.arm(GAME_CONFIG.flow.completeDelaySec);
    rt.audio.setScene('complete');
  }

  private showCompletion(): void {
    const result = this.pendingResult;
    if (!result) return;
    this.confirmGrace.arm(GAME_CONFIG.flow.confirmGraceSec);
    this.store.set({ screen: 'complete', result, showHint: false });
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /** Kind of match of the zone (or rack slot) a drop / restore event is about (the classic color bell for anything else). */
  private matchOf(event: GameEvent): MatchKind {
    if (event.type !== 'boxDropped' && event.type !== 'zoneRestored') return 'color';
    const target = event.type === 'boxDropped' ? (event.slotId ?? event.zoneId) : event.zoneId;
    return (target !== null && this.zoneMatch.get(target)) || 'color';
  }

  /** Fresh simulation + scene for a level; resets the timer and any pending completion or suspended level. */
  private loadLevel(rt: Runtime, index: number): LevelData {
    const level = getLevel(index);
    this.levelIndex = clamp(index, 0, Math.max(0, LEVELS.length - 1));
    this.level = level;
    this.zoneMatch = zoneMatchKinds(level);
    this.levelHasRacks = hasRacks(level);
    this.state = new GameState(level);
    rt.renderer.loadLevel(this.state.getSnapshot(), getTheme(level.theme));
    this.timer.reset();
    this.elapsedThrottle.markPublished(0);
    this.completeDelay.cancel();
    this.confirmGrace.cancel();
    this.restartHold.cancel();
    this.jumpHold.cancel();
    this.pendingResult = null;
    this.workAtStake = false;
    this.suspended = false;
    this.resumeTimerOnInput = false;
    return level;
  }

  /**
   * Drives the soft fill on the HUD's ↺ pill while R / pad Back (or a "Modo prueba" level-jump key) is held
   * (0 when no hold is running).
   */
  private publishRestartHold(): void {
    const total = GAME_CONFIG.flow.restartHoldSec;
    const countdown = this.restartHold.active ? this.restartHold : this.jumpHold;
    const hold = countdown.active && total > 0 ? clamp(1 - countdown.secondsLeft / total, 0, 1) : 0;
    if (hold === this.publishedHold) return;
    if (hold !== 0 && hold !== 1 && Math.abs(hold - this.publishedHold) < HOLD_STEP) return;
    this.publishedHold = hold;
    this.store.set({ restartHold: hold });
  }

  private publishElapsed(force: boolean): void {
    const ms = this.timer.elapsedMs;
    if (force) {
      this.elapsedThrottle.markPublished(ms);
      this.store.set({ elapsedMs: ms });
    } else if (this.elapsedThrottle.shouldPublish(ms)) {
      this.store.set({ elapsedMs: ms });
    }
  }

  private savedProgress(rt: Runtime): SavedProgress {
    const { progress } = rt;
    const highestUnlocked = progress.getHighestUnlocked();
    const cleared = (index: number) => index >= 0 && index < LEVELS.length && progress.getBest(LEVELS[index].id) !== null;
    return {
      // A save from before new levels were added: its final level, already cleared, leads on to the first new one.
      lastLevel: continueTarget(progress.getLastLevel(), highestUnlocked, cleared),
      highestUnlocked,
      hasProgress: progress.hasProgress(),
    };
  }

  private progressSummary(rt: Runtime, testMode = this.store.get().testMode): Pick<UIState, 'levels' | 'canContinue'> {
    const { progress } = rt;
    const highest = testMode ? LEVELS.length - 1 : progress.getHighestUnlocked();
    return {
      levels: buildLevelSummaries(LEVELS, (id) => progress.getBest(id), highest),
      // A level left mid-way can always be continued, even on a fresh save.
      canContinue: progress.hasProgress() || this.suspended,
    };
  }

  private readonly onStorage = (e: StorageEvent): void => {
    const rt = this.rt;
    if (!rt || (e.key !== null && e.key !== PROGRESS_STORAGE_KEY)) return;
    if (this.store.get().screen === 'title') this.store.set(this.progressSummary(rt));
  };

  private readonly onUserGesture = (): void => {
    const rt = this.rt;
    if (rt) this.unlockAudio(rt);
  };

  private unlockAudio(rt: Runtime): void {
    rt.audio.unlock().catch(() => {
      // Autoplay still blocked: the next key press or click retries (unlock is idempotent).
    });
  }
}
