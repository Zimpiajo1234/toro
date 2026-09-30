import { useEffect, useState } from 'react';
import { useStore, type Store } from '../core/store';
import { BellIcon, SoundIcon } from './icons';
import { Presence } from './Presence';
import type { UIState } from './uiState';

/** How long the confirmation pill stays up after an M or B press (ms). */
const NOTICE_MS = 1600;
/** It melts away rather than vanishing, like the control hint. */
const NOTICE_EXIT_MS = 600;

export function soundNoticeText(muted: boolean): string {
  return muted ? 'Sonido desactivado' : 'Sonido activado';
}

/** The reverse beeper's confirmation (B). */
export function beepNoticeText(on: boolean): string {
  return on ? 'Pitido de marcha atrás: sí' : 'Pitido de marcha atrás: no';
}

/** The sound settings the notice confirms. */
export type SoundSettings = Pick<UIState, 'muted' | 'reverseBeep'>;

/** What a notice says: which setting changed (its icon), its wording, and whether that sound is now off. */
export interface NoticeContent {
  kind: 'sound' | 'beep';
  text: string;
  off: boolean;
}

/**
 * The notice for a change of the sound settings from `before` to `after`, or null when neither changed. A key press
 * toggles one of them; if both change at once, the mute (which silences everything) is the one named.
 */
export function soundNotice(before: SoundSettings, after: SoundSettings): NoticeContent | null {
  if (after.muted !== before.muted) return { kind: 'sound', text: soundNoticeText(after.muted), off: after.muted };
  if (after.reverseBeep !== before.reverseBeep) {
    return { kind: 'beep', text: beepNoticeText(after.reverseBeep), off: !after.reverseBeep };
  }
  return null;
}

interface Notice extends NoticeContent {
  /** Bumped on every toggle: restarts the pill's timer and eases the new wording in. */
  seq: number;
}

/**
 * Confirms a mute toggle (M) or a reverse-beeper toggle (B), otherwise invisible — a silent game should never look
 * broken. Screen readers hear it through a polite live region that is always mounted and starts empty, so the saved
 * state is not announced on load. In a level, a small pill also shows it briefly and fades on its own (nothing
 * permanent joins the HUD); on the title, the footer wording says it instead.
 */
export function SoundNotice({ store, showPill }: { store: Store<UIState>; showPill: boolean }) {
  const muted = useStore(store, (s) => s.muted);
  const reverseBeep = useStore(store, (s) => s.reverseBeep);
  const [seen, setSeen] = useState<SoundSettings>({ muted, reverseBeep });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [open, setOpen] = useState(false);

  // Adjusting state while rendering: the toggle shows on the same frame; the first value is never a toggle.
  const next = soundNotice(seen, { muted, reverseBeep });
  if (next) {
    setSeen({ muted, reverseBeep });
    setNotice({ ...next, seq: (notice?.seq ?? 0) + 1 });
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
        {notice ? notice.text : ''}
      </p>
      <Presence show={showPill && open} className="notice-layer" exitMs={NOTICE_EXIT_MS}>
        {notice && (
          <p className="hud-pill notice ui-enter" aria-hidden="true">
            <span key={notice.seq} className="notice__body ui-swap">
              {notice.kind === 'beep' ? (
                <BellIcon className="notice__icon" off={notice.off} />
              ) : (
                <SoundIcon className="notice__icon" off={notice.off} />
              )}
              {notice.text}
            </span>
          </p>
        )}
      </Presence>
    </>
  );
}
