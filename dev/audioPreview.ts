/**
 * Dev-only audio preview (not part of the build): open http://localhost:5173/dev/audio-preview.html
 * with `npm run dev`. Buttons drive the real AudioEngine; the offline analysis renders the full mix
 * into an OfflineAudioContext and reports levels and voice counts. `toroLevels()` in the console renders single
 * layers (music, reverse beep, pick-up, drop) through the real graph and reports their K-weighted loudness.
 */
import { AudioEngine, COMPLETE_AFTER_LAND_SEC, DROP_LAND_SEC, type AudioScene } from '../src/audio/AudioEngine';
import { GAME_CONFIG } from '../src/config';
import type { GameEvent } from '../src/core/types';
import { createAudioGraph, type AudioGraph } from '../src/audio/graph';
import { Composer } from '../src/audio/music/Composer';
import { MusicPlayer } from '../src/audio/MusicPlayer';
import { SfxPlayer } from '../src/audio/sfx';
import { MotorSound } from '../src/audio/motor';
import { beepFrequency, ReverseBeeper } from '../src/audio/beeper';
import { mulberry32 } from '../src/audio/random';
import type { Rng } from '../src/audio/types';
import { bassNote, buildChord, chimeNote, completionArpeggio, padVoicing } from '../src/audio/music/harmony';
import { TONIC_CHORD } from '../src/audio/music/progressions';

const engine = new AudioEngine();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let dropCount = 0;
const DROP_TOTAL = 5;
/** Zones in the little stacking level the "Apilar" buttons pretend to solve (2-stack, 3-stack, final 3-stack). */
const STACK_TOTAL = 3;

/** A landing at stack `level` (0 = floor); `recipeLength` > 0 means on a zone with that recipe. */
function dropped(level: number, correct: boolean, recipeLength: number, satisfiedCount: number, total: number): GameEvent {
  return { type: 'boxDropped', boxId: 'b', cell: { x: 0, z: 0 }, zoneId: recipeLength > 0 ? 'z' : null, level, correct, recipeLength, satisfiedCount, total };
}

function on(id: string, fn: () => void): void {
  $(id).addEventListener('click', () => {
    void engine.unlock();
    fn();
  });
}

function setScene(scene: AudioScene): void {
  engine.setScene(scene);
  document.querySelectorAll<HTMLButtonElement>('#scenes button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scene === scene)));
}

on('unlock', () => undefined);
on('mute', () => {
  engine.setMuted(!engine.isMuted());
  $('mute').setAttribute('aria-pressed', String(engine.isMuted()));
});
document.querySelectorAll<HTMLButtonElement>('#scenes button').forEach((b) =>
  b.addEventListener('click', () => {
    void engine.unlock();
    setScene(b.dataset.scene as AudioScene);
  }),
);
/** Level complete, then the music scene change Game makes after `flow.completeDelaySec`. */
function completeLevel(): void {
  engine.handleEvent({ type: 'levelComplete' });
  setTimeout(() => setScene('complete'), GAME_CONFIG.flow.completeDelaySec * 1000);
}

on('pickup', () => engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 0 }));
on('drop', () => engine.handleEvent(dropped(0, false, 0, dropCount, DROP_TOTAL)));
on('dropCorrect', () => {
  dropCount = dropCount >= DROP_TOTAL ? 1 : dropCount + 1;
  engine.handleEvent(dropped(0, true, 1, dropCount, DROP_TOTAL));
  $('dropCorrect').textContent = `Dejar en su zona (${dropCount >= DROP_TOTAL ? 1 : dropCount + 1}/${DROP_TOTAL})`;
});
on('released', () => engine.handleEvent({ type: 'zoneReleased', zoneId: 'z', boxId: 'b' }));
on('idle', () => engine.handleEvent({ type: 'actionIdle', carrying: false }));
on('complete', completeLevel);
// Stacking: the higher "toc" on a box, pick-ups from a stack, stack-completion figures, and the final stack
// completing the level in the same tick (as GameState emits it).
on('dropOnBox1', () => engine.handleEvent(dropped(1, false, 0, 0, STACK_TOTAL)));
on('dropOnBox2', () => engine.handleEvent(dropped(2, false, 0, 0, STACK_TOTAL)));
on('pickupStack1', () => engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 1 }));
on('pickupStack2', () => engine.handleEvent({ type: 'boxPicked', boxId: 'b', fromZoneId: null, level: 2 }));
on('stack2', () => engine.handleEvent(dropped(1, true, 2, 1, STACK_TOTAL)));
on('stack3', () => engine.handleEvent(dropped(2, true, 3, 2, STACK_TOTAL)));
on('restored', () => {
  engine.handleEvent({ type: 'boxPicked', boxId: 'w', fromZoneId: 'z', level: 2 });
  engine.handleEvent({ type: 'zoneRestored', zoneId: 'z', boxId: 'w', recipeLength: 2, satisfiedCount: 1, total: STACK_TOTAL });
});
on('stackFinal', () => {
  engine.handleEvent(dropped(2, true, 3, STACK_TOTAL, STACK_TOTAL));
  completeLevel();
});
// Sorting: the chime's timbre says how the zone matched (Game passes it along with the event).
const SORT_TOTAL = 4;
on('matchColor', () => engine.handleEvent(dropped(0, true, 1, 1, SORT_TOTAL), 'color'));
on('matchSymbol', () => engine.handleEvent(dropped(0, true, 1, 2, SORT_TOTAL), 'symbol'));
on('matchExact', () => engine.handleEvent(dropped(0, true, 1, 3, SORT_TOTAL), 'exact'));
on('matchFinal', () => {
  engine.handleEvent(dropped(0, true, 1, SORT_TOTAL, SORT_TOTAL), 'symbol');
  completeLevel();
});
on('click', () => engine.uiClick());

// Motor: sliders, or a simulated drive (accelerate, cruise, brake, lift forks, back up: the reverse beep).
// `toroAudio.setReverseBeep(false)` in the console turns the beep off, like B in the game.
let driving = false;
on('drive', () => {
  driving = !driving;
  $('drive').setAttribute('aria-pressed', String(driving));
});
const speedInput = $<HTMLInputElement>('speed');
const forkInput = $<HTMLInputElement>('fork');
function frame(t: number): void {
  let speed = Number(speedInput.value);
  let fork = Number(forkInput.value);
  if (driving) {
    const s = (t / 1000) % 10;
    speed = s < 1.5 ? s / 1.5 : s < 4.5 ? 1 : s < 5.5 ? 1 - (s - 4.5) : 0;
    fork = s > 6 && s < 6.35 ? 1 : 0;
    // Backing up (reverse tops out near half speed): the beeper's "tin… tin…".
    if (s > 6.8) speed = -0.5 * Math.max(0, Math.min(1, (s - 6.8) / 0.4, (9.6 - s) / 0.4));
    speedInput.value = String(speed);
    forkInput.value = String(fork);
  }
  engine.setMotor(speed, fork);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  const i = engine.getDebugInfo();
  $('info').textContent = [
    `contexto: ${i.state}${i.muted ? ' · silenciado' : ''}`,
    `tonalidad: ${i.key} mayor · escena: ${i.scene}`,
    `compás: ${i.bar} · progresión: ${i.progressionId} · acorde: ${i.chord}`,
    `voces activas: ${i.voices}`,
  ].join('\n');
}, 250);

/* ------------------------------------------------------------------ */
/* Offline analysis                                                    */
/* ------------------------------------------------------------------ */

let rendered: AudioBuffer | null = null;

async function analyse(seconds = 40): Promise<void> {
  const report = $('report');
  report.textContent = 'Renderizando…';
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const rng = mulberry32(Math.floor(Math.random() * 1e9));
  const graph = createAudioGraph(ctx, GAME_CONFIG.audio, rng, false);
  graph.musicFade.gain.setValueAtTime(0, 0);
  graph.musicFade.gain.linearRampToValueAtTime(1, 4);
  const composer = new Composer({ rng });
  const music = new MusicPlayer(graph, composer, rng);
  const sfx = new SfxPlayer(ctx, graph.sfxIn, graph.noise, rng);
  // Like AudioEngine: the reverse beep on the SFX bus, tuned to the song's key.
  const motor = new MotorSound(ctx, graph.motorIn, graph.noise, beepFrequency(composer.keyPc), graph.sfxIn);
  let maxVoices = 0;

  // Title 0–8 s, playing 8–32 s with a little level being solved, completion at 30 s (timed like AudioEngine).
  const chord = () => composer.currentChord() ?? undefined;
  const events: [number, (t: number) => void][] = [
    [8, () => composer.setScene('playing')],
    [11, (t) => sfx.pickup(t)],
    [14, (t) => sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 1, 3, chord()))],
    [17, (t) => sfx.pickup(t)],
    [19, (t) => sfx.tick(t, 'idle')],
    // Sorting timbres at the same climb: a symbol match (wood), then an exact one (bell + wood).
    [20, (t) => sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 1, 3, chord()), false, 0, null, 'symbol')],
    [21, (t) => sfx.drop(t + DROP_LAND_SEC, null)],
    [22, (t) => sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 1, 3, chord()), false, 0, null, 'exact')],
    [23, (t) => sfx.pickup(t)],
    [24, (t) => sfx.tick(t, 'release')],
    [26, (t) => sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 2, 3, chord()))],
    [28, (t) => sfx.pickup(t)],
    [30, (t) => {
      sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 3, 3, chord()), true);
      composer.requestResolve();
      const tonic = buildChord(composer.keyPc, TONIC_CHORD);
      const at = music.nextEighth(t + DROP_LAND_SEC + COMPLETE_AFTER_LAND_SEC);
      const downbeat = music.nextUnplannedDownbeat(at);
      music.yieldResolveBass();
      sfx.levelComplete(at, completionArpeggio(composer.keyPc, chord()), downbeat, padVoicing(tonic, 48), bassNote(tonic, 36));
    }],
    [31.1, () => composer.setScene('complete')],
    [31.5, (t) => sfx.uiClick(t)],
  ];

  music.pump();
  const quantum = 0.1;
  for (let i = 1; i * quantum < seconds - 0.05; i++) {
    const t = i * quantum;
    void ctx.suspend(t).then(() => {
      for (const [at, fn] of events) if (at > t - quantum && at <= t) fn(ctx.currentTime);
      // Forward and back (reverse at half speed at most, like the forklift): the beeper sounds while it backs up.
      const wave = t > 9 && t < 29 ? Math.sin((t - 9) * 0.9) : 0;
      motor.set(wave >= 0 ? wave : 0.5 * wave, t % 3 < 0.3 && t > 9 && t < 29 ? 1 : 0);
      music.pump();
      maxVoices = Math.max(maxVoices, music.voiceCount() + sfx.voiceCount());
      void ctx.resume();
    });
  }

  const buffer = await ctx.startRendering();
  rendered = buffer;
  ($('playRender') as HTMLButtonElement).disabled = false;
  report.textContent = describe(buffer, [
    ['título (4–8 s)', 4, 8],
    ['jugando (8–30 s)', 8, 30],
    ['completado (32–40 s)', 32, 40],
  ]) + `\nvoces máx.: ${maxVoices} · voces vivas al final: ${music.voiceCount() + sfx.voiceCount()}`;
}

function describe(buffer: AudioBuffer, segments: [string, number, number][]): string {
  const l = buffer.getChannelData(0);
  const r = buffer.getChannelData(1);
  let peak = 0;
  let bad = 0;
  let clipped = 0;
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]));
    if (!Number.isFinite(a)) bad++;
    else {
      peak = Math.max(peak, a);
      if (a > 0.98) clipped++;
    }
  }
  const db = (v: number) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dBFS` : '-∞');
  const lines = [`pico: ${db(peak)} · muestras no finitas: ${bad} · recortes: ${clipped}`];
  for (const [name, from, to] of segments) {
    const a = Math.floor(from * buffer.sampleRate);
    const b = Math.min(l.length, Math.floor(to * buffer.sampleRate));
    let s = 0;
    for (let i = a; i < b; i++) s += (l[i] * l[i] + r[i] * r[i]) / 2;
    lines.push(`RMS ${name}: ${db(Math.sqrt(s / Math.max(1, b - a)))}`);
  }
  return lines.join('\n');
}

$('analyse').addEventListener('click', () => void analyse().catch((e: unknown) => ($('report').textContent = String(e))));
$('playRender').addEventListener('click', () => {
  if (!rendered) return;
  const ctx = new AudioContext();
  const src = ctx.createBufferSource();
  src.buffer = rendered;
  src.connect(ctx.destination);
  src.onended = () => void ctx.close();
  src.start();
});

/* ------------------------------------------------------------------ */
/* Loudness of single layers (K-weighted, ITU-R BS.1770)               */
/* ------------------------------------------------------------------ */

/** The K-weighting coefficients below are the 48 kHz ones. */
const LOUDNESS_SR = 48000;
/** BS.1770 K-weighting at 48 kHz: the high-shelf "head" stage, then the RLB high-pass. [b0, b1, b2], [a1, a2]. */
const K_STAGES: readonly (readonly [readonly number[], readonly number[]])[] = [
  [
    [1.53512485958697, -2.69169618940638, 1.19839281085285],
    [-1.69065929318241, 0.73248077421585],
  ],
  [
    [1, -2, 1],
    [-1.99004745483398, 0.99007225036621],
  ],
];

function kWeighted(x: Float32Array): Float64Array {
  let y = Float64Array.from(x);
  for (const [b, a] of K_STAGES) {
    const out = new Float64Array(y.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let i = 0; i < y.length; i++) {
      const x0 = y[i];
      const y0 = b[0] * x0 + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      out[i] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    y = out;
  }
  return y;
}

/** RBJ band-pass (0 dB at `f0`), a third of an octave wide (Q 4.32): a tone against the music in its own band. */
function thirdOctave(x: Float32Array, f0: number): Float64Array {
  const w = (2 * Math.PI * f0) / LOUDNESS_SR;
  const alpha = Math.sin(w) / (2 * 4.32);
  const a0 = 1 + alpha;
  const [b0, b2, a1, a2] = [alpha / a0, -alpha / a0, (-2 * Math.cos(w)) / a0, (1 - alpha) / a0];
  const y = new Float64Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i];
    const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
    y[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return y;
}

/**
 * Running sum of the power of both channels after `weigh` (K-weighting by default; BS.1770 channel weights 1): any
 * window's mean in O(1).
 */
function powerSums(buffer: AudioBuffer, weigh: (x: Float32Array) => Float64Array = kWeighted): Float64Array {
  const l = weigh(buffer.getChannelData(0));
  const r = weigh(buffer.getChannelData(1));
  const sums = new Float64Array(l.length + 1);
  for (let i = 0; i < l.length; i++) sums[i + 1] = sums[i] + l[i] * l[i] + r[i] * r[i];
  return sums;
}

const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);

/** Mean K-weighted power over [from, to) s. */
function meanPower(sums: Float64Array, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * LOUDNESS_SR));
  const b = Math.min(sums.length - 1, Math.floor(to * LOUDNESS_SR));
  return b > a ? (sums[b] - sums[a]) / (b - a) : 0;
}

/** Mean power of the loudest `win`-second window over [from, to) (10 ms hop). */
function maxPower(sums: Float64Array, win: number, from: number, to: number): number {
  let best = 0;
  for (let t = from; t + win <= to + 1e-9; t += 0.01) best = Math.max(best, meanPower(sums, t, t + win));
  return best;
}

const maxLufs = (sums: Float64Array, win: number, from: number, to: number) => toLufs(maxPower(sums, win, from, to));

/** BS.1770-4 integrated loudness over [from, to): 400 ms blocks every 100 ms, −70 LUFS then −10 LU gates. */
function integratedLufs(sums: Float64Array, from: number, to: number): number {
  const blocks: number[] = [];
  for (let t = from; t + 0.4 <= to + 1e-9; t += 0.1) blocks.push(meanPower(sums, t, t + 0.4));
  const mean = (list: number[]) => list.reduce((s, v) => s + v, 0) / Math.max(1, list.length);
  const loud = blocks.filter((p) => toLufs(p) > -70);
  const gate = toLufs(mean(loud)) - 10;
  return toLufs(mean(loud.filter((p) => toLufs(p) > gate)));
}

function samplePeakDb(buffer: AudioBuffer, from: number, to: number): number {
  const a = Math.max(0, Math.floor(from * buffer.sampleRate));
  const b = Math.min(buffer.length, Math.floor(to * buffer.sampleRate));
  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

/**
 * Renders `seconds` of one layer alone through the real mixing graph (48 kHz, music at full level: no fade-in).
 * `build` wires the layer and returns what runs every `quantum` s of audio time (the frame loop's stand-in).
 */
async function renderLayer(
  seconds: number,
  build: (ctx: OfflineAudioContext, graph: AudioGraph, rng: Rng) => (t: number) => void,
  quantum = 0.02,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.round(LOUDNESS_SR * seconds), LOUDNESS_SR);
  const rng = mulberry32(0x70a0);
  const graph = createAudioGraph(ctx, GAME_CONFIG.audio, rng, false);
  graph.musicFade.gain.value = 1;
  const tick = build(ctx, graph, rng);
  tick(0);
  for (let i = 1; i * quantum < seconds - 0.05; i++) {
    void ctx.suspend(i * quantum).then(() => {
      tick(ctx.currentTime);
      void ctx.resume();
    });
  }
  return ctx.startRendering();
}

/** Loudest 100 ms (LUFS) and sample peak (dBFS) of each one-second slot holding one hit, averaged. */
function hitLevels(buffer: AudioBuffer, starts: readonly number[]): { lufs: number; peak: number } {
  const sums = powerSums(buffer);
  let lufs = 0;
  let peak = 0;
  for (const t of starts) {
    lufs += maxLufs(sums, 0.1, t - 0.05, t + 0.9);
    peak += samplePeakDb(buffer, t - 0.05, t + 0.9);
  }
  return { lufs: lufs / starts.length, peak: peak / starts.length };
}

/**
 * The numbers the reverse beep's level is balanced against: the music's mean (playing scene), the loudest 100 ms of
 * one beep, a box pick-up and a floor drop (each alone through the whole graph, K-weighted), plus sample peaks and how
 * far the beep stands over the music in its own third-octave band. `keyPc` = the song's key (default F, the
 * composer's most likely one). About 10 s per call.
 */
async function levels(keyPc = 5): Promise<string> {
  const report = $('report');
  report.textContent = 'Midiendo…';
  const music = await renderLayer(
    40,
    (_ctx, graph, rng) => {
      const composer = new Composer({ rng, keyPc });
      composer.setScene('playing');
      const player = new MusicPlayer(graph, composer, rng);
      return () => player.pump();
    },
    0.1,
  );
  const musicSums = powerSums(music);
  // Reversing from 0.5 s to 5 s: the beeps land on the beat grid from there.
  const beepHz = beepFrequency(keyPc);
  const beeps = await renderLayer(6, (ctx, graph) => {
    const beeper = new ReverseBeeper(ctx, graph.sfxIn, beepHz);
    return (t) => beeper.update(t >= 0.5 && t < 5 ? -0.5 : 0);
  });
  const beepSums = powerSums(beeps);
  const band = (x: Float32Array) => thirdOctave(x, beepHz);
  const inBand = 10 * Math.log10(maxPower(powerSums(beeps, band), 0.1, 0.5, 5) / meanPower(powerSums(music, band), 4, 40));
  const hits = [0.5, 1.5, 2.5, 3.5, 4.5];
  const hitRender = (play: (sfx: SfxPlayer, t: number) => void) =>
    renderLayer(6, (ctx, graph, rng) => {
      const sfx = new SfxPlayer(ctx, graph.sfxIn, graph.noise, rng);
      for (const t of hits) play(sfx, t);
      return () => undefined;
    });
  const pickup = hitLevels(await hitRender((sfx, t) => sfx.pickup(t)), hits);
  const drop = hitLevels(await hitRender((sfx, t) => sfx.drop(t, null)), hits);

  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-∞');
  const beep100 = maxLufs(beepSums, 0.1, 0.5, 5);
  const musicMean = toLufs(meanPower(musicSums, 4, 40));
  const lines = [
    `música (jugando, 4–40 s): media ${f(musicMean)} LUFS · integrada ${f(integratedLufs(musicSums, 4, 40))} LUFS · 100 ms máx. ${f(maxLufs(musicSums, 0.1, 4, 40))} LUFS · pico ${f(samplePeakDb(music, 4, 40))} dBFS`,
    `pitido (${beepHz.toFixed(0)} Hz): 100 ms más fuertes ${f(beep100)} LUFS · 400 ms ${f(maxLufs(beepSums, 0.4, 0.5, 5))} LUFS · pico ${f(samplePeakDb(beeps, 0.5, 5))} dBFS`,
    `recoger caja: 100 ms ${f(pickup.lufs)} LUFS · pico ${f(pickup.peak)} dBFS`,
    `dejar en el suelo: 100 ms ${f(drop.lufs)} LUFS · pico ${f(drop.peak)} dBFS`,
    `pitido − música: ${f(beep100 - musicMean)} LU · pitido − recoger: ${f(beep100 - pickup.lufs)} dB · pitido − dejar: ${f(beep100 - drop.lufs)} dB`,
    `en su tercio de octava: pitido ${f(inBand)} dB sobre la media de la música`,
  ];
  report.textContent = lines.join('\n');
  return report.textContent;
}

// Expose for console experiments.
Object.assign(window, { toroAudio: engine, toroAnalyse: analyse, toroLevels: levels });
