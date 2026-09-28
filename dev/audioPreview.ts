/**
 * Dev-only audio preview (not part of the build): open http://localhost:5173/dev/audio-preview.html
 * with `npm run dev`. Buttons drive the real AudioEngine; the offline analysis renders the full mix
 * into an OfflineAudioContext and reports levels and voice counts.
 */
import { AudioEngine, COMPLETE_AFTER_LAND_SEC, DROP_LAND_SEC, type AudioScene } from '../src/audio/AudioEngine';
import { GAME_CONFIG } from '../src/config';
import type { GameEvent } from '../src/core/types';
import { createAudioGraph } from '../src/audio/graph';
import { Composer } from '../src/audio/music/Composer';
import { MusicPlayer } from '../src/audio/MusicPlayer';
import { SfxPlayer } from '../src/audio/sfx';
import { MotorSound } from '../src/audio/motor';
import { mulberry32 } from '../src/audio/random';
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
on('click', () => engine.uiClick());

// Motor: sliders, or a simulated drive (accelerate, cruise, brake, lift forks).
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
    const s = (t / 1000) % 8;
    speed = s < 1.5 ? s / 1.5 : s < 4.5 ? 1 : s < 5.5 ? 1 - (s - 4.5) : 0;
    fork = s > 6 && s < 6.35 ? 1 : 0;
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
  const motor = new MotorSound(ctx, graph.motorIn);
  let maxVoices = 0;

  // Title 0–8 s, playing 8–32 s with a little level being solved, completion at 30 s (timed like AudioEngine).
  const chord = () => composer.currentChord() ?? undefined;
  const events: [number, (t: number) => void][] = [
    [8, () => composer.setScene('playing')],
    [11, (t) => sfx.pickup(t)],
    [14, (t) => sfx.drop(t + DROP_LAND_SEC, chimeNote(composer.keyPc, 1, 3, chord()))],
    [17, (t) => sfx.pickup(t)],
    [19, (t) => sfx.tick(t, 'idle')],
    [21, (t) => sfx.drop(t + DROP_LAND_SEC, null)],
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
      const drive = t > 9 && t < 29 ? Math.max(0, Math.sin((t - 9) * 0.9)) : 0;
      motor.set(drive, t % 3 < 0.3 && t > 9 && t < 29 ? 1 : 0);
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

// Expose for console experiments.
Object.assign(window, { toroAudio: engine, toroAnalyse: analyse });
