/**
 * What kind of element currently receives keyboard events:
 * - 'text'   → typing / native keyboard widgets (inputs, textareas, selects): the game ignores every key.
 * - 'button' → activatable controls: Space / Enter may belong to them.
 * - 'none'   → body / canvas / anything else: all keys are game keys.
 */
export type FocusKind = 'text' | 'button' | 'none';

/** Structural view of an element, so this stays testable without a DOM. */
interface ElementLike {
  tagName?: unknown;
  type?: unknown;
  isContentEditable?: unknown;
  getAttribute?: (name: string) => string | null;
  blur?: () => void;
}

const BUTTON_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'image', 'checkbox', 'radio', 'color', 'file']);
const BUTTON_ROLES = new Set(['button', 'link', 'checkbox', 'switch', 'menuitem', 'tab', 'option', 'radio']);
const TEXT_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'slider', 'spinbutton']);

export function classifyFocusTarget(target: unknown): FocusKind {
  if (!target || typeof target !== 'object') return 'none';
  const el = target as ElementLike;
  if (el.isContentEditable === true) return 'text';
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  switch (tag) {
    case 'TEXTAREA':
    case 'SELECT':
      return 'text';
    case 'INPUT':
      return BUTTON_INPUT_TYPES.has(String(el.type).toLowerCase()) ? 'button' : 'text';
    case 'BUTTON':
    case 'SUMMARY':
    case 'A':
      return 'button';
  }
  const role = typeof el.getAttribute === 'function' ? el.getAttribute('role') : null;
  if (role && BUTTON_ROLES.has(role)) return 'button';
  if (role && TEXT_ROLES.has(role)) return 'text';
  return 'none';
}

/** Drop focus from an element (no-op for anything that cannot blur). */
export function blurTarget(target: unknown): void {
  if (target && typeof target === 'object' && typeof (target as ElementLike).blur === 'function') {
    (target as ElementLike).blur!();
  }
}
