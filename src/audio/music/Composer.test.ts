import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../random';
import type { AudioScene } from '../types';
import { Composer, type BarPlan } from './Composer';
import { melodyPitchClasses, pitchClass } from './harmony';
import { generatePhrase } from './melody';
import { PROGRESSIONS } from './progressions';
import { STEPS_PER_BAR } from './timing';

function bars(composer: Composer, n: number): BarPlan[] {
  return Array.from({ length: n }, () => composer.nextBar());
}

function eventCount(plan: BarPlan): number {
  return plan.keys.length + plan.melody.length + plan.plucks.length + plan.hats.length + plan.kicks.length;
}

function allMidis(plan: BarPlan): number[] {
  return [
    ...plan.pad.midis,
    plan.pad.bass,
    ...plan.keys.flatMap((k) => k.midis),
    ...plan.melody.map((m) => m.midi),
    ...plan.plucks.map((p) => p.midi),
  ];
}

describe('Composer', () => {
  it('is deterministic for a seed', () => {
    const a = bars(new Composer({ rng: mulberry32(42) }), 32);
    const b = bars(new Composer({ rng: mulberry32(42) }), 32);
    expect(a).toEqual(b);
  });

  it('plays one chord per bar with a pad and in-range, in-grid events', () => {
    const c = new Composer({ rng: mulberry32(1), keyPc: 5 });
    c.setScene('playing');
    for (const plan of bars(c, 300)) {
      expect(plan.pad.midis.length).toBeGreaterThan(0);
      expect(plan.pad.durationSteps).toBe(STEPS_PER_BAR);
      for (const m of allMidis(plan)) {
        expect(m).toBeGreaterThanOrEqual(36);
        expect(m).toBeLessThanOrEqual(88);
      }
      const steps = [...plan.keys, ...plan.melody, ...plan.plucks, ...plan.hats, ...plan.kicks].map((e) => e.step);
      for (const s of steps) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThan(STEPS_PER_BAR);
      }
      for (const k of plan.keys) for (const v of [k.velocity]) expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('walks through known progressions chord by chord', () => {
    const c = new Composer({ rng: mulberry32(9), keyPc: 0 });
    const ids = new Set(PROGRESSIONS.map((p) => p.id));
    for (const plan of bars(c, 120)) expect(ids.has(plan.progressionId)).toBe(true);
  });

  it('keeps the melody inside the safe pool of each chord', () => {
    const c = new Composer({ rng: mulberry32(5), keyPc: 3 });
    c.setScene('playing');
    for (const plan of bars(c, 300)) {
      const pcs = melodyPitchClasses(3, plan.chord);
      for (const n of plan.melody) expect(pcs).toContain(pitchClass(n.midi));
    }
  });

  it('never repeats a melody phrase among recent bars', () => {
    const c = new Composer({ rng: mulberry32(77) });
    c.setScene('playing');
    const phrases: string[] = [];
    for (const plan of bars(c, 600)) {
      if (plan.melody.length === 0) continue;
      phrases.push(plan.melody.map((n) => `${n.step}.${n.duration}:${n.midi}`).join(' '));
    }
    expect(phrases.length).toBeGreaterThan(50);
    for (let i = 1; i < phrases.length; i++) {
      const window = phrases.slice(Math.max(0, i - 20), i);
      expect(window).not.toContain(phrases[i]);
    }
  });

  it('rests the melody after at most two consecutive bars', () => {
    const c = new Composer({ rng: mulberry32(13) });
    c.setScene('playing');
    let streak = 0;
    for (const plan of bars(c, 400)) {
      streak = plan.melody.length > 0 ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(2);
    }
  });

  it('is sparser on the title than while playing', () => {
    const density = (scene: AudioScene) => {
      const c = new Composer({ rng: mulberry32(21) });
      c.setScene(scene);
      const plans = bars(c, 400);
      return plans.reduce((s, p) => s + eventCount(p), 0) / plans.length;
    };
    expect(density('title')).toBeLessThan(density('playing') * 0.75);
  });

  it('only uses brushes while playing, after settling in', () => {
    const title = new Composer({ rng: mulberry32(2) });
    for (const plan of bars(title, 200)) expect(plan.hats.length + plan.kicks.length).toBe(0);
    const playing = new Composer({ rng: mulberry32(2) });
    playing.setScene('playing');
    const plans = bars(playing, 200);
    for (const plan of plans.slice(0, 4)) expect(plan.kicks.length).toBe(0);
    expect(plans.some((p) => p.hats.length > 0)).toBe(true);
  });

  it('resolves warmly to the tonic after a completion, then moves on', () => {
    const c = new Composer({ rng: mulberry32(4), keyPc: 5 });
    c.setScene('playing');
    bars(c, 6);
    c.requestResolve();
    const resolve = c.nextBar();
    expect(resolve.resolve).toBe(true);
    expect(resolve.chord.rootPc).toBe(5);
    expect(resolve.chord.quality).toBe('maj9');
    expect(resolve.melody).toHaveLength(0);
    expect(resolve.hats).toHaveLength(0);
    expect(resolve.plucks.length).toBeGreaterThan(3);

    // Completion card up: the resolve loop holds; a second request does not restart it.
    c.setScene('complete');
    c.requestResolve();
    const held = bars(c, 5);
    for (const p of held) expect(p.progressionId).toBe('resolve');
    expect(held.every((p) => !p.resolve)).toBe(true);

    // Next level: back to a normal progression at the next bar.
    c.setScene('playing');
    expect(c.nextBar().progressionId).not.toBe('resolve');
  });

  it('lingers on the resolve loop for three passes under the completion card, then drifts on calmly', () => {
    const c = new Composer({ rng: mulberry32(4), keyPc: 5 });
    c.setScene('playing');
    bars(c, 6);
    c.requestResolve();
    expect(c.nextBar().resolve).toBe(true);
    c.setScene('complete'); // arrives after the first resolve bar: 3 + 4 + 4 more resolve bars
    const held = bars(c, 11);
    for (const p of held) expect(p.progressionId).toBe('resolve');
    const after = bars(c, 40);
    for (const p of after) {
      expect(p.progressionId).not.toBe('resolve');
      expect(p.hats.length + p.kicks.length).toBe(0);
    }
    expect(new Set(after.map((p) => p.progressionId)).size).toBeGreaterThan(1);
  });

  it('leaves the resolve loop by itself if the scene never changes', () => {
    const c = new Composer({ rng: mulberry32(8) });
    c.setScene('playing');
    bars(c, 3);
    c.requestResolve();
    const plans = bars(c, 8);
    expect(plans[0].progressionId).toBe('resolve');
    expect(plans[7].progressionId).not.toBe('resolve');
  });

  it('picks a warm key and reports debug info', () => {
    const keys = new Set<number>();
    for (let s = 0; s < 60; s++) keys.add(new Composer({ rng: mulberry32(s) }).keyPc);
    for (const k of keys) expect([0, 2, 3, 5, 7]).toContain(k);
    const c = new Composer({ rng: mulberry32(1), keyPc: 5 });
    c.nextBar();
    const info = c.debug();
    expect(info.key).toBe('F');
    expect(info.chord).toBe(c.currentChord()?.name);
  });
});

describe('generatePhrase', () => {
  it('builds short phrases from the pool, landing strong beats on chord tones', () => {
    const rng = mulberry32(99);
    const pool = [65, 67, 69, 72, 74, 77, 79, 81, 84];
    const chordPcs = [5, 9, 0, 4];
    for (let i = 0; i < 200; i++) {
      const { notes, signature } = generatePhrase({ rng, pool, chordPcs, lastMidi: i % 2 ? 72 : null });
      expect(notes.length).toBeGreaterThanOrEqual(2);
      expect(signature.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(pool).toContain(n.midi);
        expect(n.velocity).toBeGreaterThan(0.3);
        expect(n.velocity).toBeLessThan(0.7);
        expect(n.step + n.duration).toBeLessThanOrEqual(STEPS_PER_BAR);
      }
      const last = notes[notes.length - 1];
      expect(chordPcs).toContain(pitchClass(last.midi));
    }
  });

  it('handles an empty pool', () => {
    expect(generatePhrase({ rng: mulberry32(1), pool: [], chordPcs: [0], lastMidi: null }).notes).toEqual([]);
  });
});
