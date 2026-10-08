import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { TopBar } from '../../src/client/canvas/TopBar.tsx';

// Narrow bars fold Export/Present/zoom/fit into ⋯ More (Pane600.dc.html); the
// menu must work from the keyboard: focus moves in, arrows move, Esc returns.

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
afterEach(cleanup);

describe('top bar ⋯ More menu', () => {
  test('opening moves focus to the first item; arrows move; Escape returns to the trigger', () => {
    const { getByRole } = render(<TopBar />);
    const trigger = getByRole('button', { name: 'More: export, present, zoom, fit' });
    fireEvent.click(trigger);
    const items = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(items.map((item) => item.textContent)).toContain('Fit all');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1] ?? null);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
