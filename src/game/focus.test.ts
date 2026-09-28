import { describe, expect, it, vi } from 'vitest';
import { blurTarget, classifyFocusTarget } from './focus';

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, getAttribute: () => null, ...extra });

describe('classifyFocusTarget', () => {
  it('treats text entry as off-limits for game keys', () => {
    expect(classifyFocusTarget(el('INPUT', { type: 'text' }))).toBe('text');
    expect(classifyFocusTarget(el('INPUT', { type: 'search' }))).toBe('text');
    expect(classifyFocusTarget(el('TEXTAREA'))).toBe('text');
    expect(classifyFocusTarget(el('SELECT'))).toBe('text');
    expect(classifyFocusTarget(el('DIV', { isContentEditable: true }))).toBe('text');
    expect(classifyFocusTarget(el('DIV', { getAttribute: () => 'textbox' }))).toBe('text');
  });

  it('recognises activatable controls', () => {
    expect(classifyFocusTarget(el('BUTTON'))).toBe('button');
    expect(classifyFocusTarget(el('button'))).toBe('button');
    expect(classifyFocusTarget(el('A'))).toBe('button');
    expect(classifyFocusTarget(el('INPUT', { type: 'checkbox' }))).toBe('button');
    expect(classifyFocusTarget(el('DIV', { getAttribute: (n: string) => (n === 'role' ? 'button' : null) }))).toBe('button');
  });

  it('lets everything else through as game input', () => {
    expect(classifyFocusTarget(el('BODY'))).toBe('none');
    expect(classifyFocusTarget(el('CANVAS'))).toBe('none');
    expect(classifyFocusTarget({})).toBe('none'); // document / window
    expect(classifyFocusTarget(null)).toBe('none');
  });
});

describe('blurTarget', () => {
  it('blurs elements and ignores anything else', () => {
    const blur = vi.fn();
    blurTarget({ blur });
    expect(blur).toHaveBeenCalledOnce();
    expect(() => blurTarget(null)).not.toThrow();
    expect(() => blurTarget({})).not.toThrow();
  });
});
