export type MoveBinding = 'up' | 'down' | 'left' | 'right';
export type CommandBinding = 'action' | 'rotateLeft' | 'rotateRight' | 'restart' | 'mute' | 'timer' | 'confirm' | 'back';
/** Logical game keys produced by the keyboard. */
export type KeyBinding = MoveBinding | CommandBinding;

/** Physical positions first (KeyboardEvent.code): WASD keeps its shape on AZERTY / Dvorak. */
const BY_CODE = new Map<string, KeyBinding>([
  ['KeyW', 'up'],
  ['ArrowUp', 'up'],
  ['KeyS', 'down'],
  ['ArrowDown', 'down'],
  ['KeyA', 'left'],
  ['ArrowLeft', 'left'],
  ['KeyD', 'right'],
  ['ArrowRight', 'right'],
  ['Space', 'action'],
  ['KeyQ', 'rotateLeft'],
  ['KeyE', 'rotateRight'],
  ['KeyR', 'restart'],
  ['KeyM', 'mute'],
  ['KeyT', 'timer'],
  ['Enter', 'confirm'],
  ['NumpadEnter', 'confirm'],
  ['Escape', 'back'],
]);

/** Fallback on the produced character (lower-cased KeyboardEvent.key) when the code is empty or unbound. */
const BY_KEY = new Map<string, KeyBinding>([
  ['w', 'up'],
  ['arrowup', 'up'],
  ['s', 'down'],
  ['arrowdown', 'down'],
  ['a', 'left'],
  ['arrowleft', 'left'],
  ['d', 'right'],
  ['arrowright', 'right'],
  [' ', 'action'],
  ['spacebar', 'action'],
  ['q', 'rotateLeft'],
  ['e', 'rotateRight'],
  ['r', 'restart'],
  ['m', 'mute'],
  ['t', 'timer'],
  ['enter', 'confirm'],
  ['escape', 'back'],
  ['esc', 'back'],
]);

/** Resolve a key event to a game binding. Tolerates missing fields (autofill fires bare `keydown` Events). */
export function resolveKey(code: string | undefined, key: string | undefined): KeyBinding | null {
  const byCode = code ? BY_CODE.get(code) : undefined;
  if (byCode) return byCode;
  return (key ? BY_KEY.get(key.toLowerCase()) : undefined) ?? null;
}

export function isMoveBinding(binding: KeyBinding): binding is MoveBinding {
  return binding === 'up' || binding === 'down' || binding === 'left' || binding === 'right';
}

/** Stable id of a physical key for held-key bookkeeping (keydown and keyup must agree). */
export function keyId(code: string | undefined, key: string | undefined): string {
  return code ? code : `key:${(key ?? '').toLowerCase()}`;
}
