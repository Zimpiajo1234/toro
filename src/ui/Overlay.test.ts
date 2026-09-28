import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LevelCaption } from './LevelDots';
import { Overlay } from './Overlay';
import { createUIStore, type GameActions, type UIState } from './uiState';

const noopActions: GameActions = {
  start() {},
  restart() {},
  nextLevel() {},
  toTitle() {},
  toggleMute() {},
  toggleTimer() {},
};

/** Server-renders the overlay for a given state (no DOM in the test env; effects do not run). */
function render(patch: Partial<UIState>): string {
  const store = createUIStore();
  store.set(patch);
  return renderToStaticMarkup(createElement(Overlay, { store, actions: noopActions }));
}

const levels: UIState['levels'] = [
  { index: 0, id: 'a', name: 'Primer pedido', bestMs: 38_900, unlocked: true },
  { index: 1, id: 'b', name: 'Dos colores', bestMs: null, unlocked: true },
  { index: 2, id: 'c', name: 'Tres', bestMs: null, unlocked: false },
];

describe('Overlay', () => {
  it('renders nothing but the root and an empty live region while loading', () => {
    expect(render({ screen: 'loading' })).toBe(
      '<div class="ui-overlay" data-screen="loading">' +
        '<p class="ui-visually-hidden" role="status" aria-live="polite"></p></div>',
    );
  });

  it('unsupported: one calm card with a reload button, nothing else', () => {
    const html = render({ screen: 'unsupported' });
    expect(html).toContain('Toro necesita WebGL 2');
    expect(html).toContain('>Recargar</button>');
    expect(html).not.toContain('Reiniciar nivel');
    expect(html).not.toContain('>Toro</h1>');
  });

  it('title: wordmark, subtitle, start button and level dots', () => {
    const html = render({ screen: 'title', levels, levelCount: 3 });
    expect(html).toContain('>Toro</h1>');
    expect(html).toContain('Un pequeño almacén, a tu ritmo.');
    expect(html).toContain('>Empezar</button>');
    expect(html).toContain('aria-label="Nivel 1, mejor tiempo 0:38.9"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Nivel 3, por descubrir"/);
    // Caption defaults to the level "Continuar" leads to (levelIndex).
    expect(html).toContain('Nivel 1 · Primer pedido');
    expect(html).toContain('Mejor 0:38.9');
    expect(html).toContain('girar cámara');
    expect(html).not.toContain('Reiniciar nivel');
  });

  it('title footer shows the saved mute state, without announcing it on load', () => {
    expect(render({ screen: 'title' })).toContain('M</kbd> silencio');
    const muted = render({ screen: 'title', muted: true });
    expect(muted).toContain('M</kbd> activar sonido');
    expect(muted).toContain('class="title__footer-icon"');
    expect(muted).toContain('<p class="ui-visually-hidden" role="status" aria-live="polite"></p>');
    expect(muted).not.toContain('Sonido desactivado');
  });

  it('caption never shows a locked level as available', () => {
    const html = renderToStaticMarkup(createElement(LevelCaption, { level: levels[2], showTimes: true }));
    expect(html).toContain('Nivel 3 · por descubrir');
    expect(html).not.toContain('Tres');
    const locked = { ...levels[0], unlocked: false };
    expect(renderToStaticMarkup(createElement(LevelCaption, { level: locked, showTimes: true }))).not.toContain(
      'Mejor',
    );
  });

  it('title says "Continuar" when there is a saved game', () => {
    expect(render({ screen: 'title', canContinue: true })).toContain('>Continuar</button>');
  });

  it('playing: only level, time and restart (+ hint)', () => {
    const html = render({ screen: 'playing', levelIndex: 2, elapsedMs: 42_900, timerStarted: true, showHint: true });
    expect(html).toContain('Nivel 3');
    expect(html).toContain('>0:42</span>');
    expect(html).toContain('aria-label="Reiniciar nivel"');
    expect(html).toContain('recoger / dejar');
    expect(html).not.toContain('Toro</h1>');
  });

  it('shows a soft 0:00 before the timer starts', () => {
    const html = render({ screen: 'playing', elapsedMs: 1234, timerStarted: false });
    expect(html).toContain('is-idle');
    expect(html).toContain('>0:00</span>');
  });

  it('hidden timer leaves only the clock glyph', () => {
    const html = render({ screen: 'playing', elapsedMs: 42_900, timerStarted: true, showTimer: false });
    expect(html).toContain('aria-label="Mostrar tiempo"');
    expect(html).not.toContain('0:42');
  });

  it('complete: message, precise times, new-best tag, next / repeat; HUD inert', () => {
    const html = render({
      screen: 'complete',
      levelIndex: 0,
      levelName: 'Primer pedido',
      result: { timeMs: 42_300, bestMs: 42_300, isNewBest: true, message: 'Buen trabajo', isLast: false },
    });
    expect(html).toContain('Buen trabajo</h2>');
    expect(html).toContain('<dt>Tiempo</dt><dd>0:42.3</dd>');
    expect(html).toContain('<dt>Mejor tiempo</dt><dd>0:42.3</dd>');
    expect(html).toContain('Nuevo mejor tiempo');
    expect(html).toContain('>Siguiente almacén</button>');
    expect(html).toContain('>Repetir</button>');
    expect(html).toMatch(/class="ui-layer hud is-dimmed"[^>]*inert=""/);
  });

  it('last level offers the way home', () => {
    const html = render({
      screen: 'complete',
      result: { timeMs: 50_000, bestMs: 40_000, isNewBest: false, message: 'Todo en su sitio', isLast: true },
    });
    expect(html).toContain('Todos los almacenes están en orden.');
    expect(html).toContain('>Volver al inicio</button>');
    expect(html).not.toContain('Nuevo mejor tiempo');
  });
});
