import { formatPrecise } from './format';
import type { LevelSummary } from './uiState';

interface LevelDotsProps {
  levels: readonly LevelSummary[];
  /** Level whose diorama is behind the title (the one "Continuar" leads to). */
  currentIndex: number;
  /** Best times are part of the optional timer: hidden when the player hid it. */
  showTimes: boolean;
  onPick(index: number): void;
  /** Hovered / focused level, or null when the pointer and focus leave the dots. */
  onPreview(index: number | null): void;
}

function bestLabel(level: LevelSummary, showTimes: boolean): string | null {
  return showTimes && level.bestMs !== null ? formatPrecise(level.bestMs) : null;
}

/** Discreet row of level dots: unlocked ones start that level, the rest wait quietly. */
export function LevelDots({ levels, currentIndex, showTimes, onPick, onPreview }: LevelDotsProps) {
  return (
    <nav className="level-dots" aria-label="Almacenes" onPointerLeave={() => onPreview(null)}>
      {levels.map((level) => {
        const name = `Nivel ${level.index + 1}`;
        const best = bestLabel(level, showTimes);
        const label = !level.unlocked ? `${name}, por descubrir` : best ? `${name}, mejor tiempo ${best}` : name;
        const state = !level.unlocked ? 'is-locked' : level.bestMs !== null ? 'is-done' : 'is-open';
        const current = level.index === currentIndex;
        return (
          <button
            key={level.id}
            type="button"
            className={`level-dot ${state}${current ? ' is-current' : ''}`}
            disabled={!level.unlocked}
            aria-label={label}
            aria-current={current ? 'true' : undefined}
            onClick={() => onPick(level.index)}
            onPointerEnter={() => onPreview(level.index)}
            onFocus={() => onPreview(level.index)}
            onBlur={() => onPreview(null)}
          >
            <span className="level-dot__dot" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Quiet label under the dots: the hovered / focused level, otherwise the one "Continuar" leads to.
 * Decorative for screen readers (each dot carries the same information in its aria-label). Locked levels
 * keep their name for later, exactly like their aria-label ("por descubrir").
 */
export function LevelCaption({ level, showTimes }: { level: LevelSummary | undefined; showTimes: boolean }) {
  if (!level) return null;
  const best = level.unlocked ? bestLabel(level, showTimes) : null;
  const detail = level.unlocked ? level.name : 'por descubrir';
  return (
    <p className="level-caption" aria-hidden="true">
      {/* Keyed so each change eases in. */}
      <span key={level.index} className="ui-swap">
        <span className="level-caption__name">{`Nivel ${level.index + 1} · ${detail}`}</span>
        {best && <span className="level-caption__time">{`Mejor ${best}`}</span>}
      </span>
    </p>
  );
}

/** The caption for a special level behind the title (a Benchmark left with Esc): its name and a quiet note. */
export function SpecialCaption({ name, note }: { name: string; note: string }) {
  return (
    <p className="level-caption" aria-hidden="true">
      <span key="special" className="ui-swap">
        <span className="level-caption__name">{name}</span>
        <span className="level-caption__time">{note}</span>
      </span>
    </p>
  );
}
