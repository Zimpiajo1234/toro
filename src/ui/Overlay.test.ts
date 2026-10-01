import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LevelCaption } from './LevelDots';
import { Overlay } from './Overlay';
import { NoticeIcon, beepNoticeText, hintsNotice, hintsNoticeText, soundNotice, soundNoticeText } from './SoundNotice';
import { createUIStore, type GameActions, type LevelResult, type UIState } from './uiState';

const noopActions: GameActions = {
  start() {},
  restart() {},
  nextLevel() {},
  toTitle() {},
  toggleMute() {},
  toggleReverseBeep() {},
  toggleHints() {},
  toggleTimer() {},
  toggleMoves() {},
  toggleObjectives() {},
  toggleTestMode() {},
  startBenchmark() {},
};

/** Server-renders the overlay for a given state (no DOM in the test env; effects do not run). */
function render(patch: Partial<UIState>): string {
  const store = createUIStore();
  store.set(patch);
  return renderToStaticMarkup(createElement(Overlay, { store, actions: noopActions }));
}

/** A finished attempt: `patch` sets what a test is about (moves fields default to "no record, no minimum"). */
function result(patch: Partial<LevelResult>): LevelResult {
  return {
    timeMs: 42_300,
    bestMs: 42_300,
    isNewBest: false,
    moves: 12,
    bestMoves: null,
    isNewBestMoves: false,
    minMoves: null,
    message: 'Buen trabajo',
    isLast: false,
    practice: false,
    ...patch,
  };
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
    // Zoom sits right after the camera turn in the footer.
    expect(html).toContain('<span><kbd class="keycap">+</kbd> / <kbd class="keycap">−</kbd> zoom</span>');
    expect(html.indexOf('girar cámara')).toBeLessThan(html.indexOf('zoom</span>'));
    expect(html).not.toContain('Reiniciar nivel');
  });

  it('title footer: a discreet "Modo prueba" switch reflecting the setting; HUD shows a faint tag', () => {
    const off = render({ screen: 'title', levels, levelCount: 3 });
    expect(off).toMatch(/<button type="button" class="title__test" aria-pressed="false"[^>]*>.*Modo prueba<\/button>/);
    const on = render({ screen: 'title', levels, levelCount: 3, testMode: true });
    expect(on).toContain('class="title__test is-on" aria-pressed="true"');
    expect(on).toContain('title="Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente"');
    const hud = render({ screen: 'playing', levelIndex: 2, testMode: true });
    // Faint visible word; screen readers hear "Nivel 3, modo prueba" (no run-on "Nivel 3prueba").
    expect(hud).toContain(
      '<span class="hud-level__test" title="Todos los niveles abiertos (U) · RePág / AvPág: nivel anterior / siguiente">' +
        '<span aria-hidden="true">prueba</span>' +
        '<span class="ui-visually-hidden">, modo prueba</span></span>',
    );
    expect(render({ screen: 'playing', levelIndex: 2 })).not.toContain('prueba');
  });

  it('title footer: a "Benchmark" button next to the switch, only while "Modo prueba" is on', () => {
    const off = render({ screen: 'title', levels, levelCount: 3 });
    expect(off).not.toContain('Benchmark');
    const on = render({ screen: 'title', levels, levelCount: 3, testMode: true });
    // A plain button (Tab reaches it, Enter / Space press it), right after the switch.
    expect(on).toMatch(
      /Modo prueba<\/button><button type="button" class="title__bench ui-swap" title="[^"]*sin récord[^"]*">Benchmark<\/button>/,
    );
  });

  it('title with a Benchmark left behind it: the caption names it and no level dot is the current one', () => {
    const html = render({ screen: 'title', levels, levelCount: 3, testMode: true, benchmark: true, canContinue: true });
    expect(html).toContain('>Continuar</button>');
    expect(html).toContain('<span class="level-caption__name">Benchmark</span><span class="level-caption__time">sin récord</span>');
    expect(html).not.toContain('aria-current');
    expect(html).not.toContain('Nivel 1 · Primer pedido');
  });

  it('title footer shows the saved mute state, without announcing it on load', () => {
    expect(render({ screen: 'title' })).toContain('M</kbd> silencio');
    const muted = render({ screen: 'title', muted: true });
    expect(muted).toContain('M</kbd> activar sonido');
    expect(muted).toContain('class="title__footer-icon"');
    expect(muted).toContain('<p class="ui-visually-hidden" role="status" aria-live="polite"></p>');
    expect(muted).not.toContain('Sonido desactivado');
  });

  it('title footer names B for the reverse beeper right after M, and tells the truth when it is off', () => {
    const on = render({ screen: 'title' });
    expect(on).toContain('<span class="ui-swap"><kbd class="keycap">B</kbd> pitido</span>');
    expect(on.indexOf('M</kbd> silencio')).toBeLessThan(on.indexOf('B</kbd> pitido'));
    expect(on.indexOf('B</kbd> pitido')).toBeLessThan(on.indexOf('T</kbd> tiempo'));
    const off = render({ screen: 'title', reverseBeep: false });
    // A quiet crossed bell and the way back, like the muted "M activar sonido".
    expect(off).toMatch(/<span class="ui-swap"><svg class="title__footer-icon"[^>]*>.*?<\/svg><kbd class="keycap">B<\/kbd> activar pitido<\/span>/);
    expect(off).not.toContain('B</kbd> pitido');
    expect(off).toContain('M</kbd> silencio'); // mute is its own setting
    // The saved state is never announced on load.
    expect(off).toContain('<p class="ui-visually-hidden" role="status" aria-live="polite"></p>');
    expect(off).not.toContain('Pitido de marcha atrás');
  });

  it('title footer names P for the target hints right after B: off by default ("activar pistas"), "pistas" when on', () => {
    const off = render({ screen: 'title' });
    // Off (the default): a quiet crossed bulb and the way to turn them on, like "B activar pitido".
    expect(off).toMatch(/<span class="ui-swap"><svg class="title__footer-icon"[^>]*>.*?<\/svg><kbd class="keycap">P<\/kbd> activar pistas<\/span>/);
    expect(off.indexOf('B</kbd> pitido')).toBeLessThan(off.indexOf('P</kbd> activar pistas'));
    expect(off.indexOf('P</kbd> activar pistas')).toBeLessThan(off.indexOf('T</kbd> tiempo'));
    // Only its own icon: the default footer shows no other crossed icon (mute and beep are on).
    expect(off.match(/class="title__footer-icon"/g)).toHaveLength(1);
    const on = render({ screen: 'title', targetHints: true });
    expect(on).toContain('<span class="ui-swap"><kbd class="keycap">P</kbd> pistas</span>');
    expect(on).not.toContain('activar pistas');
    expect(on).not.toContain('class="title__footer-icon"');
    expect(on).toContain('B</kbd> pitido'); // the beep is its own setting
    // The saved state is never announced on load.
    for (const html of [off, on]) {
      expect(html).toContain('<p class="ui-visually-hidden" role="status" aria-live="polite"></p>');
      expect(html).not.toContain('Pistas:');
    }
    // In a level nothing names P (the notice pill confirms a press there).
    expect(render({ screen: 'playing', targetHints: true })).not.toContain('<kbd class="keycap">P</kbd>');
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

  it('playing: only level, time and restart (+ the control hint, in every level)', () => {
    const html = render({ screen: 'playing', levelIndex: 2, elapsedMs: 42_900, timerStarted: true });
    expect(html).toContain('Nivel 3');
    expect(html).toContain('>0:42</span>');
    expect(html).toContain('aria-label="Reiniciar nivel"');
    expect(html).toContain('recoger / dejar');
    expect(html).not.toContain('Toro</h1>');
  });

  it('playing the Benchmark: its name instead of the level number, and a quiet "sin récord"', () => {
    const html = render({ screen: 'playing', levelIndex: 2, testMode: true, benchmark: true, levelName: 'Benchmark' });
    expect(html).toContain('<span class="ui-swap">Benchmark</span>');
    expect(html).not.toContain('Nivel 3');
    expect(html).toMatch(
      /<span class="hud-level__test" title="[^"]*"><span aria-hidden="true">sin récord<\/span><span class="ui-visually-hidden">, sin récord<\/span><\/span>/,
    );
    expect(html).not.toContain('>prueba<');
  });

  it('control hint: always the move row while playing and, with storage whose forks go by the keys (racks), the fork row under it', () => {
    const plain = render({ screen: 'playing' });
    expect(plain).toMatch(/<div class="hint ui-enter ui-enter--d4" role="note"><p class="hint__row">/);
    expect(plain).toContain('recoger / dejar');
    expect(plain).not.toContain('horquilla');
    expect(plain.match(/class="hint__row"/g)).toHaveLength(1);

    const racks = render({ screen: 'playing', storage: true });
    expect(racks).toMatch(/<div class="hint ui-enter ui-enter--d4 hint--rows" role="note">/);
    expect(racks.match(/class="hint__row"/g)).toHaveLength(2);
    // Move row first, fork row under it.
    expect(racks.indexOf('recoger / dejar')).toBeLessThan(racks.indexOf('horquilla'));
    expect(racks).toContain('<kbd class="keycap">F</kbd><kbd class="keycap">V</kbd></span>subir / bajar horquilla');
    // The wheel closes the fork row: two groups, one separator (the gamepad works but is never advertised).
    const forkRow = racks.slice(racks.lastIndexOf('<p class="hint__row">'));
    expect(forkRow).toMatch(/<span class="hint__sep" aria-hidden="true">·<\/span><span class="hint__group"><svg[^]*<\/svg>rueda<\/span><\/p>/);
    expect(forkRow.match(/class="hint__group"/g)).toHaveLength(2);
    expect(forkRow.match(/class="hint__sep"/g)).toHaveLength(1);

    // Only while playing.
    for (const screen of ['title', 'complete'] as const) {
      const html = render({ screen, storage: true });
      expect(html).not.toContain('recoger / dejar');
      expect(html).not.toContain('horquilla');
    }
  });

  it('never advertises the gamepad: no pad buttons or "mando" in the hint, on the title or on the card', () => {
    const screens: Partial<UIState>[] = [
      { screen: 'title', levels },
      { screen: 'playing' },
      { screen: 'playing', storage: true },
      { screen: 'complete', result: result({}) },
    ];
    for (const patch of screens) {
      const html = render(patch);
      expect(html).not.toMatch(/\bmando\b/i);
      // Pad-only buttons (A and B are keyboard keys too: turn left, and the reverse beeper's toggle on the title).
      for (const pad of ['X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Start', 'Back']) {
        expect(html).not.toContain(`<kbd class="keycap">${pad}</kbd>`);
      }
      // In a level nothing names B (there it would read as the pad's fork-down button): the beep key is on the title.
      if (patch.screen !== 'title') expect(html).not.toContain('<kbd class="keycap">B</kbd>');
    }
  });

  const ZOOM_GROUP =
    '<span class="hint__group"><span class="hint__keys"><kbd class="keycap">+</kbd><kbd class="keycap">−</kbd></span>' +
    'zoom</span>';

  it('control hint: + − zoom closes the move row, in every level, without adding a row', () => {
    const plain = render({ screen: 'playing' });
    expect(plain).toContain(`<span class="hint__sep" aria-hidden="true">·</span>${ZOOM_GROUP}</p>`);
    expect(plain.indexOf('recoger / dejar')).toBeLessThan(plain.indexOf(ZOOM_GROUP));
    expect(plain.match(/class="hint__row"/g)).toHaveLength(1);
    expect(plain.match(/>zoom</g)).toHaveLength(1);

    // With the fork row (racks): still in the move row, before it; the wheel stays with the forks (never "zoom").
    const racks = render({ screen: 'playing', storage: true });
    expect(racks.match(/class="hint__row"/g)).toHaveLength(2);
    const forkRowAt = racks.lastIndexOf('<p class="hint__row">');
    expect(racks.indexOf(ZOOM_GROUP)).toBeGreaterThan(0);
    expect(racks.indexOf(ZOOM_GROUP)).toBeLessThan(forkRowAt);
    expect(racks.slice(forkRowAt)).not.toContain('zoom');
    expect(racks.slice(forkRowAt)).toContain('rueda');

    for (const screen of ['title', 'complete'] as const) {
      expect(render({ screen, storage: true })).not.toContain(ZOOM_GROUP);
    }
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

  it('complete: message, precise time, new-best mark, next / repeat; HUD inert', () => {
    const html = render({
      screen: 'complete',
      levelIndex: 0,
      levelName: 'Primer pedido',
      result: result({ isNewBest: true, bestMoves: 12 }),
    });
    expect(html).toContain('Buen trabajo</h2>');
    // A new best time lights its own tile ("✦ nuevo récord" in place of the best time, which is this one).
    expect(html).toMatch(
      /<div class="card__stat is-record"><dt>Tiempo<\/dt><dd>0:42\.3<\/dd><dd class="card__stat-record ui-enter ui-enter--d3"><svg[^>]*class="card__stat-icon".*?<\/svg>nuevo récord<\/dd><\/div>/,
    );
    expect(html).not.toContain('mejor 0:42.3');
    expect(html).not.toContain('no se guarda');
    expect(html).toContain('>Siguiente almacén</button>');
    expect(html).toContain('>Repetir</button>');
    expect(html).toMatch(/class="ui-layer hud is-dimmed"[^>]*inert=""/);
  });

  it('complete, level open only through "Modo prueba": its time, no best time, and a quiet "not kept" note', () => {
    // Move counter hidden: the time alone, in one centred tile.
    const html = render({ screen: 'complete', showMoves: false, result: result({ practice: true }) });
    expect(html).toContain('class="card__stats card__stats--single ui-enter ui-enter--d1"');
    expect(html).toContain('<div class="card__stat"><dt>Tiempo</dt><dd>0:42.3</dd></div>');
    expect(html).not.toContain('card__stat-record');
    expect(html).toContain('>Modo prueba · este tiempo no se guarda</p>');
    // A genuinely open level (times kept) and a hidden timer and counter (nothing shown at all) carry no note.
    expect(render({ screen: 'complete', showMoves: false, result: result({ practice: false }) })).not.toContain('no se guarda');
    const hidden = render({ screen: 'complete', showTimer: false, showMoves: false, result: result({ practice: true }) });
    expect(hidden).not.toContain('no se guarda');
    expect(hidden).not.toContain('0:42.3');
    expect(hidden).not.toContain('card__stats');
  });

  it('complete, Benchmark: named, its time only, "sin récord", and the way back to the title', () => {
    const html = render({
      screen: 'complete',
      levelIndex: 4,
      levelName: 'Benchmark',
      benchmark: true,
      testMode: true,
      result: result({ timeMs: 95_400, bestMs: 95_400, moves: 16, minMoves: { moves: 14, exact: true }, practice: true }),
    });
    expect(html).toContain('<p class="card__eyebrow">Benchmark</p>');
    expect(html).not.toContain('Nivel 5');
    expect(html).toContain('<dt>Tiempo</dt><dd>1:35.4</dd></div>');
    // Its moves against its minimum, and no record under either: time and moves share one row.
    expect(html).toContain('<dt>Movimientos</dt><dd>16<span class="card__stat-note">· mín. 14</span></dd></div>');
    expect(html).not.toContain('card__stat-record');
    expect(html).not.toContain('card__stats--single');
    expect(html).toContain('>Modo prueba · sin récord</p>');
    expect(html).toContain('>Volver al inicio</button>');
    expect(html).not.toContain('Siguiente almacén');
    expect(html).not.toContain('Todos los almacenes están en orden.');
    expect(html).toContain('>Repetir</button>');
  });

  it('last level offers the way home', () => {
    const html = render({
      screen: 'complete',
      result: result({ timeMs: 50_000, bestMs: 40_000, message: 'Todo en su sitio', isLast: true, bestMoves: 12 }),
    });
    expect(html).toContain('Todos los almacenes están en orden.');
    expect(html).toContain('>Volver al inicio</button>');
    expect(html).toContain('<dd class="card__stat-record">mejor 0:40.0</dd>');
    expect(html).not.toContain('nuevo récord');
  });
});

describe('Overlay: move counter', () => {
  const min = { moves: 10, exact: true };
  /** The move pill's markup (the only element with the hud-moves class). */
  const pill = (html: string) => html.match(/<button[^>]*class="hud-pill[^"]*hud-moves[^"]*"[^>]*>.*?<\/button>/)?.[0] ?? '';

  it('shows the count against the minimum in a pill like the timer, top-right before the time', () => {
    const html = render({ screen: 'playing', moves: 12, minMoves: min, elapsedMs: 42_900, timerStarted: true });
    const moves = pill(html);
    expect(moves).toContain('class="hud-pill hud-moves ui-enter"');
    expect(moves).toContain('aria-label="Movimientos 12, mínimo 10. Ocultar movimientos"');
    expect(moves).toContain('<span class="hud-moves__value ui-tick">12</span><span class="hud-moves__min">· mín. 10</span>');
    // Same corner as the timer (the corner reserves the top band for the camera), right before it, after the
    // objectives counter.
    expect(html).toMatch(
      /<div class="hud__corner hud__corner--end"><button[^>]*hud-objectives[^>]*>.*?<\/button><button[^>]*hud-moves[^>]*>.*?<\/button><button[^>]*hud-timer/,
    );
    expect(html.indexOf('hud-moves')).toBeLessThan(html.indexOf('>0:42</span>'));
  });

  it('a fresh level reads a soft 0 without a tick; each new count remounts with the tick', () => {
    const fresh = pill(render({ screen: 'playing', moves: 0, minMoves: min }));
    expect(fresh).toContain('hud-moves ui-enter is-idle');
    expect(fresh).toContain('<span class="hud-moves__value">0</span>');
    expect(pill(render({ screen: 'playing', moves: 1, minMoves: min }))).toContain('<span class="hud-moves__value ui-tick">1</span>');
  });

  it('a lower bound reads "mín. ≥ N"; without a known minimum only the count shows', () => {
    const bound = pill(render({ screen: 'playing', moves: 3, minMoves: { moves: 10, exact: false } }));
    expect(bound).toContain('>· mín. ≥ 10</span>');
    expect(bound).toContain('aria-label="Movimientos 3, mínimo al menos 10. Ocultar movimientos"');
    const none = pill(render({ screen: 'playing', moves: 3, minMoves: null }));
    expect(none).not.toContain('mín.');
    expect(none).toContain('aria-label="Movimientos 3. Ocultar movimientos"');
  });

  it('hidden: a faint box glyph that shows it again, no count', () => {
    const moves = pill(render({ screen: 'playing', moves: 12, minMoves: min, showMoves: false }));
    expect(moves).toContain('class="hud-pill hud-round hud-moves is-hidden ui-enter"');
    expect(moves).toContain('aria-label="Mostrar movimientos"');
    expect(moves).not.toContain('hud-moves__value');
    expect(moves).not.toContain('mín.');
  });

  it('a soft accent (sparkle, never a warning) only once the level is finished at the minimum', () => {
    const done = pill(render({ screen: 'playing', moves: 10, minMoves: min, finished: true }));
    expect(done).toContain('class="hud-pill hud-moves ui-enter is-minimum"');
    expect(done).toContain('aria-label="Movimientos 10, mínimo 10, en el mínimo. Ocultar movimientos"');
    expect(done).not.toContain('<rect'); // the sparkle takes the box glyph's place
    // Reaching the count mid-level is not finishing; more moves than the minimum is just a count.
    expect(pill(render({ screen: 'playing', moves: 10, minMoves: min, finished: false }))).not.toContain('is-minimum');
    expect(pill(render({ screen: 'complete', moves: 11, minMoves: min, finished: true }))).not.toContain('is-minimum');
    // Without a minimum there is nothing to reach.
    expect(pill(render({ screen: 'playing', moves: 1, minMoves: null, finished: true }))).not.toContain('is-minimum');
    // The dimmed HUD under the card keeps it.
    expect(pill(render({ screen: 'complete', moves: 9, minMoves: min, finished: true }))).toContain('is-minimum');
  });

  it('title footer names the N key next to T', () => {
    const html = render({ screen: 'title' });
    expect(html).toContain('T</kbd> tiempo');
    expect(html).toContain('N</kbd> movimientos');
    expect(html.indexOf('N</kbd> movimientos')).toBeGreaterThan(html.indexOf('T</kbd> tiempo'));
  });

  it('card: one tile per metric, its record under the value (best time; moves beside the minimum, then the fewest)', () => {
    const html = render({ screen: 'complete', result: result({ bestMs: 38_900, moves: 12, bestMoves: 11, minMoves: min }) });
    expect(html).toContain(
      '<dl class="card__stats ui-enter ui-enter--d1">' +
        '<div class="card__stat"><dt>Tiempo</dt><dd>0:42.3</dd><dd class="card__stat-record">mejor 0:38.9</dd></div>' +
        '<div class="card__stat"><dt>Movimientos</dt><dd>12<span class="card__stat-note">· mín. 10</span></dd>' +
        '<dd class="card__stat-record">récord 11</dd></div></dl>',
    );
    expect(html).not.toContain('nuevo récord');
    expect(html).not.toContain('is-minimum');
    expect(html).not.toContain('is-record');
  });

  it('card: a new record lights its own tile, never a row of tags under the stats', () => {
    const html = render({
      screen: 'complete',
      result: result({ isNewBest: true, moves: 11, bestMoves: 11, isNewBestMoves: true, minMoves: min }),
    });
    expect(html).toMatch(/<div class="card__stat is-record"><dt>Tiempo<\/dt>.*?nuevo récord<\/dd><\/div>/);
    expect(html).toMatch(
      /<div class="card__stat is-record"><dt>Movimientos<\/dt><dd>11<span class="card__stat-note">· mín\. 10<\/span><\/dd><dd class="card__stat-record ui-enter ui-enter--d3"><svg[^>]*class="card__stat-icon".*?<\/svg>nuevo récord<\/dd><\/div>/,
    );
    expect(html).not.toContain('récord 11');
    expect(html).not.toContain('card__badge');
    // Each mark goes with its own display: hiding the counter hides its tile, hiding the timer hides the other.
    const noMoves = render({ screen: 'complete', showMoves: false, result: result({ isNewBest: true, isNewBestMoves: true, bestMoves: 11 }) });
    expect(noMoves).toMatch(/<div class="card__stat is-record"><dt>Tiempo<\/dt>/);
    expect(noMoves).not.toContain('Movimientos');
    expect(noMoves.match(/nuevo récord/g)).toHaveLength(1);
    const noTimer = render({ screen: 'complete', showTimer: false, result: result({ isNewBest: true, isNewBestMoves: true, bestMoves: 11 }) });
    expect(noTimer).not.toContain('Tiempo');
    expect(noTimer).toMatch(/<div class="card__stat is-record"><dt>Movimientos<\/dt>/);
    expect(noTimer.match(/nuevo récord/g)).toHaveLength(1);
  });

  it('card: the stats never take more than one row (at most two tiles), whatever is shown or improved', () => {
    // The card must stay below the middle of the diorama (ui.css): its 2-column grid may hold one row only.
    for (const showTimer of [true, false]) {
      for (const showMoves of [true, false]) {
        for (const practice of [true, false]) {
          for (const newRecords of [true, false]) {
            const html = render({
              screen: 'complete',
              showTimer,
              showMoves,
              result: result({
                practice,
                isLast: true,
                bestMoves: practice ? null : 11,
                minMoves: min,
                isNewBest: !practice && newRecords,
                isNewBestMoves: !practice && newRecords,
              }),
            });
            const tiles = html.match(/class="card__stat[ "]/g) ?? [];
            expect(tiles).toHaveLength(Number(showTimer) + Number(showMoves));
            expect(html).not.toContain('card__badge');
          }
        }
      }
    }
  });

  it('card: finishing at the minimum reads "mínimo" on a soft accent tile', () => {
    const html = render({ screen: 'complete', result: result({ moves: 10, bestMoves: 10, minMoves: min }) });
    expect(html).toMatch(
      /<div class="card__stat is-minimum"><dt>Movimientos<\/dt><dd>10<span class="card__stat-note"><svg[^>]*class="card__stat-icon".*?<\/svg>mínimo<\/span><\/dd><dd class="card__stat-record">récord 10<\/dd><\/div>/,
    );
    expect(html).not.toContain('mín. 10');
  });

  it('card: the timer hidden leaves the moves alone; a practice run shows its moves only, not kept', () => {
    const moves = render({ screen: 'complete', showTimer: false, result: result({ bestMoves: 12, minMoves: min }) });
    expect(moves).not.toContain('Tiempo');
    expect(moves).toContain('<dt>Movimientos</dt>');
    expect(moves).toContain('<dd class="card__stat-record">récord 12</dd></div>');
    expect(moves).toContain('class="card__stats card__stats--single ui-enter ui-enter--d1"');

    const practice = render({ screen: 'complete', showTimer: false, result: result({ practice: true, minMoves: min }) });
    expect(practice).toContain('class="card__stats card__stats--single ui-enter ui-enter--d1"');
    expect(practice).not.toContain('card__stat-record');
    expect(practice).toContain('>Modo prueba · estos movimientos no se guardan</p>');
    const both = render({ screen: 'complete', result: result({ practice: true, minMoves: min }) });
    expect(both).toContain('>Modo prueba · este resultado no se guarda</p>');
  });
});

describe('Overlay: objectives counter', () => {
  /** The objectives pill's markup (the only element with the hud-objectives class). */
  const pill = (html: string) => html.match(/<button[^>]*class="hud-pill[^"]*hud-objectives[^"]*"[^>]*>.*?<\/button>/)?.[0] ?? '';

  it('reads «Quedan N» in a pill like the other counters, first in the top-right corner, before the moves and the time', () => {
    const html = render({ screen: 'playing', objectivesLeft: 9, moves: 3, elapsedMs: 42_900, timerStarted: true });
    const objectives = pill(html);
    expect(objectives).toContain('class="hud-pill hud-objectives ui-enter"');
    expect(objectives).toContain('aria-label="Quedan 9 objetivos. Ocultar objetivos"');
    expect(objectives).toContain('title="Ocultar objetivos"');
    // The verb small and soft, the count in the counters' numbers (each new count remounts: keyed).
    expect(objectives).toContain('<span class="hud-objectives__label">Quedan</span><span class="hud-objectives__value ui-swap">9</span>');
    expect(html).toMatch(/<div class="hud__corner hud__corner--end"><button[^>]*hud-objectives/);
    expect(html.indexOf('hud-objectives')).toBeLessThan(html.indexOf('hud-moves'));
    expect(html.indexOf('hud-moves')).toBeLessThan(html.indexOf('>0:42</span>'));
  });

  it('agrees with the count: «Queda 1»', () => {
    const one = pill(render({ screen: 'playing', objectivesLeft: 1 }));
    expect(one).toContain('<span class="hud-objectives__label">Queda</span><span class="hud-objectives__value ui-swap">1</span>');
    expect(one).toContain('aria-label="Queda 1 objetivo. Ocultar objetivos"');
  });

  it('«Todo en su sitio» once nothing is left, still there on the dimmed HUD under the card', () => {
    const done = pill(render({ screen: 'playing', objectivesLeft: 0, finished: true }));
    expect(done).toContain('<span class="hud-objectives__done ui-swap">Todo en su sitio</span>');
    expect(done).toContain('aria-label="Todo en su sitio. Ocultar objetivos"');
    expect(done).not.toContain('hud-objectives__value');
    expect(done).not.toContain('Quedan');
    const card = render({ screen: 'complete', objectivesLeft: 0, finished: true, result: result({}) });
    expect(card).toMatch(/class="ui-layer hud is-dimmed"[^>]*inert=""/);
    expect(pill(card)).toContain('>Todo en su sitio</span>');
  });

  it('hidden: a faint flag glyph that shows it again, no count', () => {
    const hidden = pill(render({ screen: 'playing', objectivesLeft: 9, showObjectives: false }));
    expect(hidden).toContain('class="hud-pill hud-round hud-objectives is-hidden ui-enter"');
    expect(hidden).toContain('aria-label="Mostrar objetivos"');
    expect(hidden).toContain('<svg class="hud-objectives__icon"');
    expect(hidden).not.toContain('Quedan');
    expect(hidden).not.toContain('hud-objectives__value');
    // Its own setting: the other counters stay as they are.
    expect(render({ screen: 'playing', objectivesLeft: 9, showObjectives: false, moves: 2 })).toContain('<span class="hud-moves__value ui-tick">2</span>');
  });

  it('only in a level: never on the title', () => {
    expect(pill(render({ screen: 'title', levels, objectivesLeft: 3 }))).toBe('');
  });

  it('title footer names the O key right after N', () => {
    const html = render({ screen: 'title' });
    expect(html).toContain('<span><kbd class="keycap">O</kbd> objetivos</span>');
    expect(html.indexOf('O</kbd> objetivos')).toBeGreaterThan(html.indexOf('N</kbd> movimientos'));
    expect(html.indexOf('O</kbd> objetivos')).toBeLessThan(html.indexOf('Esc</kbd> inicio'));
    // In a level nothing names O (the pill's tooltip and label say what it does).
    expect(render({ screen: 'playing', objectivesLeft: 2 })).not.toContain('<kbd class="keycap">O</kbd>');
  });
});

describe('Sound notice (M, B, P)', () => {
  const sound = (muted: boolean, reverseBeep: boolean) => ({ muted, reverseBeep });

  it('confirms the target hints (P) with a pill of their own: "Pistas: sí / no" and the bulb, crossed when off', () => {
    expect(hintsNoticeText(true)).toBe('Pistas: sí');
    expect(hintsNoticeText(false)).toBe('Pistas: no');
    expect(hintsNotice(false, false)).toBeNull();
    expect(hintsNotice(false, true)).toEqual({ kind: 'hints', text: 'Pistas: sí', off: false });
    expect(hintsNotice(true, false)).toEqual({ kind: 'hints', text: 'Pistas: no', off: true });
    // The pill's icon: a bulb (its own shape, not the bell or the speaker), crossed out only when the hints go off.
    const bulb = (off: boolean) => renderToStaticMarkup(createElement(NoticeIcon, { kind: 'hints', off }));
    const bell = renderToStaticMarkup(createElement(NoticeIcon, { kind: 'beep', off: false }));
    const speaker = renderToStaticMarkup(createElement(NoticeIcon, { kind: 'sound', off: false }));
    expect(bulb(false)).toMatch(/^<svg class="notice__icon"[^>]*aria-hidden="true"/);
    expect(bulb(false)).not.toBe(bell);
    expect(bulb(false)).not.toBe(speaker);
    expect(bulb(true)).toContain('<path d="M5 5l14 14"></path>');
    expect(bulb(false)).not.toContain('M5 5l14 14');
  });

  it('names the setting that changed, in Spanish: the mute, or the reverse beeper', () => {
    expect(soundNoticeText(true)).toBe('Sonido desactivado');
    expect(beepNoticeText(false)).toBe('Pitido de marcha atrás: no');
    expect(beepNoticeText(true)).toBe('Pitido de marcha atrás: sí');
    expect(soundNotice(sound(false, true), sound(false, true))).toBeNull();
    expect(soundNotice(sound(false, true), sound(false, false))).toEqual({ kind: 'beep', text: 'Pitido de marcha atrás: no', off: true });
    expect(soundNotice(sound(true, false), sound(true, true))).toEqual({ kind: 'beep', text: 'Pitido de marcha atrás: sí', off: false });
    expect(soundNotice(sound(false, true), sound(true, true))).toEqual({ kind: 'sound', text: 'Sonido desactivado', off: true });
    // Both at once (never from one key press): the mute, which silences everything, is the one named.
    expect(soundNotice(sound(true, true), sound(false, false))).toMatchObject({ kind: 'sound', text: 'Sonido activado' });
  });

  it('shows nothing until a toggle: saved settings are never announced when a level loads', () => {
    const html = render({ screen: 'playing', muted: true, reverseBeep: false, targetHints: true });
    expect(html).toContain('<p class="ui-visually-hidden" role="status" aria-live="polite"></p>');
    expect(html).not.toContain('Pitido de marcha atrás');
    expect(html).not.toContain('Pistas:');
    expect(html).not.toContain('class="hud-pill notice');
  });
});
