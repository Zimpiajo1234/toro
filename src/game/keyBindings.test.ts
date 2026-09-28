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
    expect(resolveKey('Enter', 'Enter')).toBe('confirm');
    expect(resolveKey('NumpadEnter', 'Enter')).toBe('confirm');
    expect(resolveKey('Escape', 'Escape')).toBe('back');
    expect(resolveKey('', 'Esc')).toBe('back');
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
