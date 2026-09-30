import { describe, expect, it } from 'vitest';
import { isMoveBinding, keyId, resolveKey } from './keyBindings';

describe('resolveKey', () => {
  it('binds WASD and arrows by physical position', () => {
    expect(resolveKey('KeyW', 'w')).toBe('up');
    expect(resolveKey('ArrowUp', 'ArrowUp')).toBe('up');
    expect(resolveKey('KeyA', 'a')).toBe('left');
    expect(resolveKey('ArrowRight', 'ArrowRight')).toBe('right');
    expect(resolveKey('KeyS', 'S')).toBe('down');
  });

  it('binds the command keys', () => {
    expect(resolveKey('Space', ' ')).toBe('action');
    expect(resolveKey('KeyQ', 'q')).toBe('rotateLeft');
    expect(resolveKey('KeyE', 'e')).toBe('rotateRight');
    expect(resolveKey('KeyR', 'r')).toBe('restart');
    expect(resolveKey('KeyM', 'm')).toBe('mute');
    expect(resolveKey('KeyT', 't')).toBe('timer');
    expect(resolveKey('KeyN', 'n')).toBe('moves');
    expect(resolveKey('', 'N')).toBe('moves');
    expect(resolveKey('KeyB', 'b')).toBe('beep');
    expect(resolveKey('', 'B')).toBe('beep');
    expect(resolveKey(undefined, 'b')).toBe('beep');
    expect(resolveKey('Enter', 'Enter')).toBe('confirm');
    expect(resolveKey('NumpadEnter', 'Enter')).toBe('confirm');
    expect(resolveKey('Escape', 'Escape')).toBe('back');
    expect(resolveKey('', 'Esc')).toBe('back');
  });

  it('binds the fork level keys: F up, V down (docs/RACKS.md), by position or character', () => {
    expect(resolveKey('KeyF', 'f')).toBe('forkUp');
    expect(resolveKey('KeyV', 'v')).toBe('forkDown');
    expect(resolveKey('', 'F')).toBe('forkUp');
    expect(resolveKey(undefined, 'v')).toBe('forkDown');
  });

  it('binds the camera zoom: + / − on the main row and the numpad', () => {
    expect(resolveKey('Equal', '=')).toBe('zoomIn');
    expect(resolveKey('Equal', '+')).toBe('zoomIn'); // US Shift + =
    expect(resolveKey('NumpadAdd', '+')).toBe('zoomIn');
    expect(resolveKey('Minus', '-')).toBe('zoomOut');
    expect(resolveKey('NumpadSubtract', '-')).toBe('zoomOut');
    expect(resolveKey('', '+')).toBe('zoomIn');
    expect(resolveKey(undefined, '-')).toBe('zoomOut');
  });

  it('reads "+" / "-" by character first: they sit on other keys on Spanish, German or AZERTY layouts', () => {
    expect(resolveKey('BracketRight', '+')).toBe('zoomIn'); // Spanish / German "+"
    expect(resolveKey('BracketRight', ']')).toBe('nextLevel'); // the same key with AltGr: the level jump keeps it
    expect(resolveKey('BracketRight', '*')).toBe('nextLevel'); // Shift: not a zoom character
    expect(resolveKey('Slash', '-')).toBe('zoomOut'); // Spanish / German "-"
    expect(resolveKey('Digit6', '-')).toBe('zoomOut'); // AZERTY "-"
    expect(resolveKey('Digit0', '=')).toBeNull(); // Spanish Shift + 0 stays unbound
  });

  it('no two game keys share a physical key or a character', () => {
    // F / V were free; the fork keys must not steal a key another binding already uses.
    // N (move counter) was free too; so were the keys right of 0 and the numpad + / − (camera zoom), and B (the
    // reverse beeper on / off).
    const codes = [
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'KeyQ',
      'KeyE',
      'KeyR',
      'KeyM',
      'KeyT',
      'KeyN',
      'KeyB',
      'KeyU',
      'KeyF',
      'KeyV',
      'Space',
      'Enter',
      'Escape',
      'Equal',
      'Minus',
    ];
    const bound = codes.map((c) => resolveKey(c, ''));
    expect(bound.every((b) => b !== null)).toBe(true);
    expect(new Set(bound).size).toBe(bound.length);
  });

  it('prefers the physical code over the character (AZERTY: the A key sits on KeyQ)', () => {
    expect(resolveKey('KeyQ', 'a')).toBe('rotateLeft');
    expect(resolveKey('KeyW', 'z')).toBe('up');
  });

  it('falls back on the character when the code is unbound or empty', () => {
    expect(resolveKey('Semicolon', 'm')).toBe('mute');
    expect(resolveKey('', 'W')).toBe('up');
    expect(resolveKey(undefined, 'Enter')).toBe('confirm');
  });

  it('returns null for unrelated or malformed events', () => {
    expect(resolveKey('KeyX', 'x')).toBeNull();
    expect(resolveKey('Tab', 'Tab')).toBeNull();
    expect(resolveKey(undefined, undefined)).toBeNull();
  });
});

describe('isMoveBinding / keyId', () => {
  it('tells movement from commands', () => {
    expect(isMoveBinding('up')).toBe(true);
    expect(isMoveBinding('action')).toBe(false);
  });

  it('identifies keys by code, or by character when there is no code', () => {
    expect(keyId('KeyW', 'W')).toBe('KeyW');
    expect(keyId('', 'W')).toBe(keyId('', 'w'));
  });
});
