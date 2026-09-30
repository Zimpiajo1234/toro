export type MoveBinding = 'up' | 'down' | 'left' | 'right';
export type CommandBinding =
  | 'action'
  | 'rotateLeft'
  | 'rotateRight'
  | 'restart'
  | 'mute'
  | 'timer'
  /** Show / hide the optional move counter (N: "número de movimientos"; far from the driving and fork keys). */
  | 'moves'
  | 'confirm'
  | 'back'
  /** "Modo prueba" only: previous / next level ([ / ], PageUp / PageDown). */
  | 'prevLevel'
  | 'nextLevel'
  /** Title: toggle "Modo prueba" (U). */
  | 'testMode'
  /** In front of a storage rack: fork one slot up (F) / down (V) (docs/RACKS.md). */
  | 'forkUp'
  | 'forkDown'
  /** Camera zoom: closer (+, = on US keyboards, numpad +) / further (−, numpad −). Held = continuous, a tap = one step. */
  | 'zoomIn'
  | 'zoomOut';
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
  ['KeyN', 'moves'],
  ['Enter', 'confirm'],
  ['NumpadEnter', 'confirm'],
  ['Escape', 'back'],
  ['BracketLeft', 'prevLevel'],
  ['BracketRight', 'nextLevel'],
  ['PageUp', 'prevLevel'],
  ['PageDown', 'nextLevel'],
  ['KeyU', 'testMode'],
  ['KeyF', 'forkUp'],
  ['KeyV', 'forkDown'],
  // The keys right of 0 (US "- / =", "+" with Shift) and the numpad's.
  ['Equal', 'zoomIn'],
  ['NumpadAdd', 'zoomIn'],
  ['Minus', 'zoomOut'],
  ['NumpadSubtract', 'zoomOut'],
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
  ['n', 'moves'],
  ['enter', 'confirm'],
  ['escape', 'back'],
  ['esc', 'back'],
  ['[', 'prevLevel'],
  [']', 'nextLevel'],
  ['pageup', 'prevLevel'],
  ['pagedown', 'nextLevel'],
  ['u', 'testMode'],
  ['f', 'forkUp'],
  ['v', 'forkDown'],
]);

/**
 * Characters that name their binding whatever physical key types them, ahead of the code: "+" and "-" mean zoom on
 * any layout. On Spanish, German or Italian keyboards "+" sits on BracketRight ("]" there needs AltGr, so the level
 * jump keeps it) and "-" on Slash; on AZERTY "-" is the 6 key.
 */
const BY_CHARACTER = new Map<string, KeyBinding>([
  ['+', 'zoomIn'],
  ['-', 'zoomOut'],
]);

/** Resolve a key event to a game binding. Tolerates missing fields (autofill fires bare `keydown` Events). */
export function resolveKey(code: string | undefined, key: string | undefined): KeyBinding | null {
  const byCharacter = key ? BY_CHARACTER.get(key) : undefined;
  if (byCharacter) return byCharacter;
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
