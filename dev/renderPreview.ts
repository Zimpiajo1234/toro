/**
 * Dev-only render preview: `npx vite` → /dev/render-preview.html (not part of the production build).
 * Keys: 1–9 niveles · B nivel grande · Q/E girar · O órbita · P recoger/dejar · Z resolver una zona ·
 *       C completar · I acción vacía · Espacio conducir/parar
 * `window.preview` exposes the same actions (plus freeze/step) for scripted screenshots.
 */
import { LEVELS } from '../src/data/levels';
import type { GameEvent, LevelData } from '../src/core/types';
import { getTheme } from '../src/themes';
import { GameRenderer } from '../src/render/GameRenderer';
import { BIG_LEVEL } from './bigLevel';
import { PreviewSim } from './previewSim';

const stage = document.getElementById('stage') as HTMLElement;
const hud = document.getElementById('hud') as HTMLElement;
const renderer = new GameRenderer(stage);
const levels: LevelData[] = [...LEVELS, BIG_LEVEL];
let sim = new PreviewSim(levels[0]);
let orbit = false;
let frozen = false;

function load(index: number): void {
  const level = levels[Math.max(0, Math.min(levels.length - 1, index))];
  sim = new PreviewSim(level);
  const theme = getTheme(level.theme);
  document.body.style.setProperty('--bg-top', theme.background.top);
  document.body.style.setProperty('--bg-bottom', theme.background.bottom);
  renderer.loadLevel(sim.snapshot, theme);
}

function emit(events: GameEvent[]): void {
  for (const e of events) renderer.handleEvent(e, sim.snapshot);
}

function advance(dt: number): void {
  emit(sim.update(dt));
  renderer.update(sim.snapshot, dt);
}

const actions = {
  load,
  pickOrDrop: () => emit(sim.snapshot.forklift.carrying ? sim.drop() : sim.pick()),
  solveZone: () => {
    const zone = sim.snapshot.zones.find((z) => z.next !== null);
    if (zone) emit(sim.solveZone(zone.id));
  },
  solveAll: () => {
    for (const z of sim.snapshot.zones) emit(sim.solveZone(z.id));
  },
  complete: () => emit([{ type: 'levelComplete' }]),
  idle: () => emit([{ type: 'actionIdle', carrying: sim.snapshot.forklift.carrying !== null }]),
  rotate: (dir: -1 | 1) => renderer.rotateCamera(dir),
  orbit: (on: boolean) => {
    orbit = on;
    renderer.setIdleOrbit(on);
  },
  drive: (on: boolean) => {
    sim.driving = on;
  },
  setPose: (x: number, z: number, headingDeg: number) => sim.setPose(x, z, headingDeg),
  /** Stop real-time ticking (for exact, scripted frames). */
  freeze: (on: boolean) => {
    frozen = on;
  },
  /** Advance by `seconds` in fixed steps, then report the renderer stats. */
  step: (seconds: number, fps = 60) => {
    const n = Math.max(1, Math.round(seconds * fps));
    for (let i = 0; i < n; i++) advance(1 / fps);
    return renderer.getStats();
  },
  stats: () => renderer.getStats(),
  sim: () => sim,
  /** Raw renderer, for poking at internals from the console. */
  renderer: () => renderer,
};
(window as unknown as { preview: typeof actions }).preview = actions;

window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k >= '1' && k <= '9') load(Number(k) - 1);
  else if (k === 'b') load(levels.length - 1);
  else if (k === 'q') actions.rotate(-1);
  else if (k === 'e') actions.rotate(1);
  else if (k === 'o') actions.orbit(!orbit);
  else if (k === 'p') actions.pickOrDrop();
  else if (k === 'z') actions.solveZone();
  else if (k === 'c') actions.complete();
  else if (k === 'i') actions.idle();
  else if (k === ' ') actions.drive(!sim.driving);
});

let last = performance.now();
let lastTickAt = 0;
let hudTimer = 0;
let frames = 0;

function tick(now: number): void {
  lastTickAt = now;
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (frozen) return;
  advance(dt);
  frames++;
  hudTimer += dt;
  if (hudTimer < 0.5) return;
  const s = renderer.getStats();
  const yaw = Math.round((renderer.getCameraYaw() * 180) / Math.PI);
  hud.textContent = [
    `${sim.level.name} · ${sim.level.size.width}×${sim.level.size.depth}`,
    `draw calls ${s.drawCalls} · triángulos ${s.triangles} · geometrías ${s.geometries}`,
    `${Math.round(frames / hudTimer)} fps · yaw ${yaw}°`,
    '1–9/B nivel · Q/E girar · O órbita · P recoger/dejar · Z zona · C completar · I vacío · Espacio conducir',
  ].join('\n');
  hudTimer = 0;
  frames = 0;
}

load(0);
function rafLoop(now: number): void {
  tick(now);
  requestAnimationFrame(rafLoop);
}
requestAnimationFrame(rafLoop);
// Hidden tabs / panes pause rAF: keep ticking on a timer so the preview stays alive.
setInterval(() => {
  const now = performance.now();
  if (now - lastTickAt > 100) tick(now);
}, 33);
