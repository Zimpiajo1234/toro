import { useId, useRef } from 'react';
import { useAutoFocus } from './interaction';
import { Presence } from './Presence';

/** 'webgl': no WebGL 2 context. 'crash': the app shell caught an error while rendering. */
export type UnsupportedReason = 'webgl' | 'crash';

const COPY: Record<UnsupportedReason, { title: string; line: string }> = {
  webgl: {
    title: 'Toro necesita WebGL 2',
    line: 'Activa la aceleración por hardware del navegador o prueba con otro navegador.',
  },
  crash: {
    title: 'El almacén necesita un momento',
    line: 'Recarga la página para volver a ordenar.',
  },
};

/**
 * The one calm card shown when the game cannot run (no WebGL 2) or the shell caught a crash: a frosted panel in
 * the middle of the background gradient, a plain explanation and a reload button. Never alarming.
 */
export function UnsupportedCard({ show, reason = 'webgl' }: { show: boolean; reason?: UnsupportedReason }) {
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  useAutoFocus(buttonRef, show);
  const copy = COPY[reason];

  return (
    <Presence show={show} className="unsupported-layer">
      <section className="ui-panel card unsupported ui-enter" aria-labelledby={titleId}>
        <h2 id={titleId} className="card__title">
          {copy.title}
        </h2>
        <p className="card__line">{copy.line}</p>
        <div className="card__actions">
          <button ref={buttonRef} type="button" className="ui-btn ui-btn--primary" onClick={() => window.location.reload()}>
            Recargar
          </button>
        </div>
      </section>
    </Presence>
  );
}
