import { describe, expect, test } from 'bun:test';
import { render } from 'preact';
import { ShortcutOverlay } from '../../src/client/canvas/ShortcutOverlay.tsx';
import { isMac, modChord } from '../../src/client/utils/platform.ts';

// happy-dom reports a non-Mac platform, so these assert the Windows/Linux
// renderings — the ⌘ variants are the isMac branch of the same call sites.

describe('shortcut labels off-Mac', () => {
  test('modChord joins with Ctrl+', () => {
    expect(isMac).toBe(false);
    expect(modChord('K')).toBe('Ctrl+K');
  });

  test('overlay advertises Windows conventions: Ctrl+Y redo, Backspace spelled out', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(<ShortcutOverlay onClose={() => {}} />, host);
    const text = host.textContent ?? '';
    expect(text).toContain('Ctrl+Z / Ctrl+Y');
    expect(text).toContain('Delete / Backspace');
    expect(text).toContain('Ctrl+K');
    expect(text).not.toContain('⌘');
    expect(text).not.toContain('⌫');
    render(null, host);
    host.remove();
  });
});
