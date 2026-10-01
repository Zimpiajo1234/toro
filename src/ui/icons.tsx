/** Inline SVG icons. Decorative only (aria-hidden); colors come from CSS (currentColor / classes). */

interface IconProps {
  className?: string;
}

const LINE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** ↺ — counter-clockwise circular arrow. */
export function RestartIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M4 12a8 8 0 1 0 2.34-5.66L4 8.7" />
      <path d="M4 4.5v4.2h4.2" />
    </svg>
  );
}

export function ClockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 7.8V12l2.8 1.8" />
    </svg>
  );
}

/** Small taped box (the mark's box): the move counter's glyph, in its pill and when hidden. */
export function BoxIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <rect x="4.5" y="6.5" width="15" height="12.5" rx="2.8" />
      <path d="M12 6.8v4.4" />
    </svg>
  );
}

/** Small pennant on its pole: the objectives counter's glyph while it is hidden. */
export function FlagIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M6.5 20V4.5" />
      <path d="M6.5 5h10.5l-2.6 3.6L17 12.2H6.5" />
    </svg>
  );
}

/** Speaker with sound waves, or crossed out when `off` (muted). */
export function SoundIcon({ className, off = false }: IconProps & { off?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      {off ? <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" /> : <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.2 6.6a7.6 7.6 0 0 1 0 10.8" />}
    </svg>
  );
}

/** Small bell (the reverse beeper's soft "tin"), crossed out when `off` (the beep turned off). */
export function BellIcon({ className, off = false }: IconProps & { off?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M6.5 16.5h11L16 14.3v-3.8a4 4 0 0 0-8 0v3.8z" />
      <path d="M10.4 19.2a1.8 1.8 0 0 0 3.2 0" />
      {off && <path d="M5 5l14 14" />}
    </svg>
  );
}

/** Small light bulb (the optional target hints, «pistas»), crossed out when `off` (the hints turned off). */
export function BulbIcon({ className, off = false }: IconProps & { off?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M9.6 16.6v-1.2c0-.9-.6-1.6-1.3-2.4A5.2 5.2 0 1 1 15.7 13c-.7.8-1.3 1.5-1.3 2.4v1.2z" />
      <path d="M10 19.6h4" />
      {off && <path d="M5 5l14 14" />}
    </svg>
  );
}

/** Mouse seen from above, its wheel marked: "rueda" in the fork hint. */
export function MouseWheelIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...LINE}>
      <rect x="6.5" y="3.5" width="11" height="17" rx="5.5" />
      <path d="M12 7.2v3.2" />
    </svg>
  );
}

/** Soft four-point sparkle for the "new best" tag. */
export function SparkleIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="3 2 10 10" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 2c.6 3.3 1.7 4.4 5 5-3.3.6-4.4 1.7-5 5-.6-3.3-1.7-4.4-5-5 3.3-.6 4.4-1.7 5-5z" />
    </svg>
  );
}

/** Tiny side-view forklift carrying a box: the game's mark on the title screen. */
export function ToroMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 64 48" aria-hidden="true" focusable="false">
      <g className="toro-mark__line">
        <path d="M31 22V10.5h14.5L49 22" />
        <path d="M22 8v30" />
        <path d="M22 37.5H8.5" />
      </g>
      <rect className="toro-mark__box" x="8.5" y="23" width="12" height="13" rx="2.6" />
      <path className="toro-mark__tape" d="M14.5 23.5v4" />
      <rect className="toro-mark__body" x="25" y="22" width="28" height="13" rx="5" />
      <circle className="toro-mark__wheel" cx="31" cy="38" r="5" />
      <circle className="toro-mark__wheel" cx="47" cy="38" r="5" />
      <circle className="toro-mark__hub" cx="31" cy="38" r="1.7" />
      <circle className="toro-mark__hub" cx="47" cy="38" r="1.7" />
      <circle className="toro-mark__eye" cx="28.6" cy="27.2" r="1.6" />
    </svg>
  );
}
