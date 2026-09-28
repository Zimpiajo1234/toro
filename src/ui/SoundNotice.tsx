import { useEffect, useState } from 'react';
import { useStore, type Store } from '../core/store';
import { SoundIcon } from './icons';
import { Presence } from './Presence';
import type { UIState } from './uiState';

/** How long the confirmation pill stays up after an M press (ms). */
const NOTICE_MS = 1600;
/** It melts away rather than vanishing, like the control hint. */
const NOTICE_EXIT_MS = 600;

export function soundNoticeText(muted: boolean): string {
  return muted ? 'Sonido desactivado' : 'Sonido activado';
}

interface Notice {
  muted: boolean;
  /** Bumped on every toggle: restarts the pill's timer and eases the new wording in. */
  seq: number;
}

/**
 * Confirms a mute toggle (M), which is otherwise invisible — a silent game should never look broken.
 * Screen readers hear it through a polite live region that is always mounted and starts empty, so the
 * saved state is not announced on load. In a level, a small pill also shows it briefly and fades on its
 * own (nothing permanent joins the HUD); on the title, the footer wording says it instead.
 */
export function SoundNotice({ store, showPill }: { store: Store<UIState>; showPill: boolean }) {
  const muted = useStore(store, (s) => s.muted);
  const [seen, setSeen] = useState(muted);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState(false);

  // Adjusting state while rendering: the toggle shows on the same frame; the first value is never a toggle.
  if (muted !== seen) {
    setSeen(muted);
    setNotice({ muted, seq: (notice?.seq ?? 0) + 1 });
    setOpen(showPill);
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setOpen(false), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [open, notice]);

  return (
    <>
      <p className="ui-visually-hidden" role="status" aria-live="polite">
        {notice ? soundNoticeText(notice.muted) : ''}
      </p>
      <Presence show={showPill && open} className="notice-layer" exitMs={NOTICE_EXIT_MS}>
        {notice && (
          <p className="hud-pill notice ui-enter" aria-hidden="true">
            <span key={notice.seq} className="notice__body ui-swap">
              <SoundIcon className="notice__icon" off={notice.muted} />
              {soundNoticeText(notice.muted)}
            </span>
          </p>
        )}
      </Presence>
    </>
  );
}
