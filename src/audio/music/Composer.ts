import type { AudioScene, Rng } from '../types';
import { chance, pick, weightedIndex } from '../random';
import {
  bassNote,
  buildChord,
  keysIntervals,
  melodyPitchClasses,
  NOTE_NAMES,
  notesInRange,
  padVoicing,
  pitchClass,
  voiceChord,
  type Chord,
} from './harmony';
import { generatePhrase, type NoteEvent } from './melody';
import { KEYS_BUSY, KEYS_CALM, PLUCK_PATTERNS, PLUCK_RESOLVE } from './patterns';
import { pickNextProgression, pickRepeats, RESOLVE_PROGRESSION, type Progression } from './progressions';
import { RANGES, STEPS_PER_BAR } from './timing';

export interface PadEvent {
  midis: number[];
  bass: number;
  velocity: number;
  durationSteps: number;
}

export interface KeysEvent {
  step: number;
  duration: number;
  midis: number[];
  velocity: number;
  /** Delay between successive chord notes (gentle roll), seconds. */
  strumSec: number;
}

export interface MelodyEvent extends NoteEvent {
  voice: 'keys' | 'guitar';
}

export interface PluckEvent {
  step: number;
  midi: number;
  velocity: number;
}

export interface PercEvent {
  step: number;
  velocity: number;
}

/** Everything the player needs to render one bar. Pure data. */
export interface BarPlan {
  index: number;
  progressionId: string;
  chord: Chord;
  /** True on the warm tonic bar that answers a level completion. */
  resolve: boolean;
  pad: PadEvent;
  keys: KeysEvent[];
  melody: MelodyEvent[];
  plucks: PluckEvent[];
  hats: PercEvent[];
  kicks: PercEvent[];
}

interface Density {
  keysRest: number;
  keysBusy: number;
  /** Chance of thinning the keys voicing to three notes. */
  thin: number;
  melody: number;
  pluck: number;
  padVelocity: number;
}

const DENSITY: Readonly<Record<AudioScene, Density>> = {
  title: { keysRest: 0.3, keysBusy: 0.12, thin: 0.6, melody: 0.26, pluck: 0.16, padVelocity: 0.8 },
  playing: { keysRest: 0.1, keysBusy: 0.45, thin: 0.35, melody: 0.5, pluck: 0.3, padVelocity: 0.9 },
  complete: { keysRest: 0.25, keysBusy: 0.15, thin: 0.5, melody: 0.2, pluck: 0.45, padVelocity: 1 },
};

/** Warm keys (F, E♭, D, G, C major), weighted toward the mellow ones. */
const KEY_CHOICES = [5, 3, 2, 7, 0] as const;
const KEY_WEIGHTS = [3, 2, 2, 1.5, 1];

const RECENT_PHRASES = 24;
const RECENT_PROGRESSIONS = 3;
/** Passes of the resolve loop while the completion card is up (~41 s), before calm title progressions. */
const RESOLVE_PASSES_ON_CARD = 3;

export interface ComposerOptions {
  rng?: Rng;
  /** Force a key (pitch class 0‥11). Random warm key otherwise. */
  keyPc?: number;
}

export interface ComposerDebug {
  bar: number;
  key: string;
  scene: AudioScene;
  progressionId: string;
  chord: string;
}

/**
 * Generative lo-fi composer: one chord per bar through looping jazzy progressions, with
 * probabilistic pad / keys / melody / guitar / brushes layers. Pure (no Web Audio) and seedable.
 */
export class Composer {
  readonly keyPc: number;
  private readonly rng: Rng;
  private scene: AudioScene = 'title';
  private barIndex = 0;
  private barsInScene = 0;
  private progression: Progression;
  private chordIndex = -1;
  private passesLeft: number;
  private readonly recentProgressions: string[] = [];
  private readonly recentPhrases: string[] = [];
  private prevKeys: number[] | null = null;
  private lastMelodyMidi: number | null = null;
  private melodyStreak = 0;
  private restStreak = 0;
  private percOn = false;
  private resolvePending = false;
  private lastChord: Chord | null = null;

  constructor(options: ComposerOptions = {}) {
    this.rng = options.rng ?? Math.random;
    this.keyPc = pitchClass(options.keyPc ?? KEY_CHOICES[weightedIndex(this.rng, KEY_WEIGHTS)]);
    this.progression = pickNextProgression(this.rng, 'title', null);
    this.passesLeft = pickRepeats(this.rng);
  }

  getScene(): AudioScene {
    return this.scene;
  }

  setScene(scene: AudioScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.barsInScene = 0;
    if (scene !== 'playing') this.percOn = false;
    if (scene === 'complete') {
      // Linger on the warm resolve loop while the completion card is up, then drift on (never a fixed loop).
      if (this.inResolve()) this.passesLeft = RESOLVE_PASSES_ON_CARD;
      else this.resolvePending = true;
    } else {
      this.resolvePending = false;
      if (this.inResolve()) {
        // Leave the resolve loop at the next bar with a fresh progression.
        this.passesLeft = 0;
        this.chordIndex = this.progression.chords.length - 1;
      }
    }
  }

  /** Land on a warm tonic at the next bar (level completed). */
  requestResolve(): void {
    if (!this.inResolve()) this.resolvePending = true;
  }

  private inResolve(): boolean {
    return this.progression === RESOLVE_PROGRESSION;
  }

  /** Chord of the most recently planned bar (null before the first bar). */
  currentChord(): Chord | null {
    return this.lastChord;
  }

  debug(): ComposerDebug {
    return {
      bar: this.barIndex,
      key: NOTE_NAMES[this.keyPc],
      scene: this.scene,
      progressionId: this.progression.id,
      chord: this.lastChord?.name ?? '—',
    };
  }

  nextBar(): BarPlan {
    const resolve = this.resolvePending;
    if (resolve) {
      this.resolvePending = false;
      this.progression = RESOLVE_PROGRESSION;
      this.chordIndex = 0;
      // A few passes while the completion card is shown; otherwise one gentle pass, then move on.
      this.passesLeft = this.scene === 'complete' ? RESOLVE_PASSES_ON_CARD : 1;
      this.percOn = false;
    } else {
      this.advanceChord();
    }

    const chord = buildChord(this.keyPc, this.progression.chords[this.chordIndex]);
    const density = DENSITY[this.scene];
    const plan: BarPlan = {
      index: this.barIndex,
      progressionId: this.progression.id,
      chord,
      resolve,
      pad: this.planPad(chord, density, resolve),
      keys: this.planKeys(chord, density, resolve),
      melody: [],
      plucks: [],
      hats: [],
      kicks: [],
    };
    plan.melody = this.planMelody(chord, density, resolve);
    plan.plucks = this.planPlucks(chord, density, resolve, plan.melody.length > 0 && plan.melody[0].voice === 'guitar');
    if (this.percOn && !resolve) this.planPercussion(plan);

    this.lastChord = chord;
    this.barIndex++;
    this.barsInScene++;
    return plan;
  }

  private advanceChord(): void {
    this.chordIndex++;
    if (this.chordIndex < this.progression.chords.length) return;
    this.chordIndex = 0;
    this.passesLeft--;
    if (this.passesLeft > 0) return;
    if (this.progression !== RESOLVE_PROGRESSION) {
      this.recentProgressions.push(this.progression.id);
      if (this.recentProgressions.length > RECENT_PROGRESSIONS) this.recentProgressions.shift();
    }
    const current = this.progression === RESOLVE_PROGRESSION ? null : this.progression.id;
    const scene = this.scene === 'complete' ? 'title' : this.scene;
    this.progression = pickNextProgression(this.rng, scene, current, this.recentProgressions);
    this.passesLeft = pickRepeats(this.rng);
    // Brushes come and go by sections, and only once the player has settled in.
    this.percOn = this.scene === 'playing' && this.barsInScene >= 4 && chance(this.rng, 0.55);
  }

  private planPad(chord: Chord, d: Density, resolve: boolean): PadEvent {
    return {
      midis: padVoicing(chord, RANGES.padRootLow),
      bass: bassNote(chord, RANGES.bassLow),
      velocity: Math.min(1, d.padVelocity * (0.92 + this.rng() * 0.16) * (resolve ? 1.08 : 1)),
      durationSteps: STEPS_PER_BAR,
    };
  }

  private planKeys(chord: Chord, d: Density, resolve: boolean): KeysEvent[] {
    if (!resolve && (this.barIndex === 0 || chance(this.rng, d.keysRest))) return [];
    let intervals = keysIntervals(chord);
    if (intervals.length > 3 && chance(this.rng, d.thin)) intervals = intervals.slice(0, 3);
    const pcs = intervals.map((i) => pitchClass(chord.rootPc + i));
    const voicing = voiceChord(pcs, RANGES.keys.low, RANGES.keys.high, this.prevKeys);
    this.prevKeys = voicing;
    const pattern = resolve ? KEYS_CALM[0] : chance(this.rng, d.keysBusy) ? pick(this.rng, KEYS_BUSY) : pick(this.rng, KEYS_CALM);
    return pattern.map((hit) => ({
      step: hit.step,
      duration: hit.duration,
      midis: hit.partial ? voicing.slice(-2) : voicing,
      velocity: (0.36 + this.rng() * 0.18) * (hit.partial ? 0.8 : 1),
      strumSec: 0.008 + this.rng() * 0.02,
    }));
  }

  private planMelody(chord: Chord, d: Density, resolve: boolean): MelodyEvent[] {
    let p = d.melody;
    if (resolve || this.barIndex < 2) p = 0;
    else if (this.melodyStreak >= 2) p = 0;
    else if (this.melodyStreak === 1) p *= 0.6;
    else if (this.restStreak >= 3) p = Math.min(0.9, p * 1.8);
    if (!chance(this.rng, p)) {
      this.melodyStreak = 0;
      this.restStreak++;
      return [];
    }
    const voice: MelodyEvent['voice'] = chance(this.rng, 0.25) ? 'guitar' : 'keys';
    const range = voice === 'guitar' ? RANGES.melodyGuitar : RANGES.melody;
    const pool = notesInRange(melodyPitchClasses(this.keyPc, chord), range.low, range.high);
    const phrase = this.uniquePhrase(pool, chord.tones);
    if (phrase.length === 0) return [];
    this.melodyStreak++;
    this.restStreak = 0;
    this.lastMelodyMidi = phrase[phrase.length - 1].midi;
    return phrase.map((n) => ({ ...n, voice }));
  }

  /** Generates a phrase not heard among the recent ones (never the same bar twice). */
  private uniquePhrase(pool: readonly number[], chordPcs: readonly number[]): NoteEvent[] {
    for (let attempt = 0; attempt < 8; attempt++) {
      const phrase = generatePhrase({ rng: this.rng, pool, chordPcs, lastMidi: this.lastMelodyMidi });
      if (phrase.notes.length === 0) return [];
      if (attempt < 7 && this.recentPhrases.includes(phrase.signature)) continue;
      this.recentPhrases.push(phrase.signature);
      if (this.recentPhrases.length > RECENT_PHRASES) this.recentPhrases.shift();
      return phrase.notes;
    }
    return [];
  }

  private planPlucks(chord: Chord, d: Density, resolve: boolean, guitarMelody: boolean): PluckEvent[] {
    if (!resolve && (guitarMelody || this.barIndex < 1 || !chance(this.rng, d.pluck))) return [];
    const base = padVoicing(chord, RANGES.pluckRootLow);
    const notes = [...base, base[0] + 19];
    if (resolve) notes.push(base[0] + 24);
    const steps = resolve ? PLUCK_RESOLVE : pick(this.rng, PLUCK_PATTERNS);
    const start = resolve ? 0 : Math.floor(this.rng() * Math.max(1, notes.length - steps.length + 1));
    const line = notes.slice(start, start + steps.length);
    while (line.length < steps.length) line.push(line[line.length - 1]);
    if (!resolve && chance(this.rng, 0.25)) line.reverse();
    return steps.map((step, i) => ({ step, midi: line[i], velocity: (0.45 + this.rng() * 0.2) * (i === 0 ? 1 : 0.85) }));
  }

  private planPercussion(plan: BarPlan): void {
    for (let step = 0; step < STEPS_PER_BAR; step += 2) {
      if (chance(this.rng, 0.2)) continue;
      plan.hats.push({ step, velocity: (step % 4 === 2 ? 1 : 0.55) * (0.85 + this.rng() * 0.3) });
    }
    if (chance(this.rng, 0.25)) plan.hats.push({ step: chance(this.rng, 0.5) ? 7 : 15, velocity: 0.3 });
    plan.hats.sort((a, b) => a.step - b.step);
    plan.kicks.push({ step: 0, velocity: 0.9 + this.rng() * 0.1 });
    if (chance(this.rng, 0.5)) plan.kicks.push({ step: 10, velocity: 0.6 + this.rng() * 0.1 });
  }
}
