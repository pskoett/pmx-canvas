import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render } from '@testing-library/preact';
import { SelectionBar } from '../../src/client/canvas/SelectionBar.tsx';
import {
  clearSelection,
  contextPinnedNodeIds,
  selectNodes,
  selectedNodeIds,
} from '../../src/client/state/canvas-store.ts';

// Pinning fires a best-effort (caught) sync to the server; stub fetch so
// happy-dom's relative-URL rejection doesn't spam the test output.
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async () =>
    new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  selectedNodeIds.value = new Set();
  contextPinnedNodeIds.value = new Set();
});

afterEach(cleanup);

describe('SelectionBar', () => {
  // Regression for the conditional-hooks bug fixed in the Biome sweep: the
  // useCallback hooks must run before the `count === 0` early return. Cycling
  // empty -> selected -> empty -> selected re-renders the component across both
  // branches; with conditional hooks Preact throws hook-order errors here.
  test('survives empty -> selected -> empty -> selected transitions', () => {
    const { container, getByRole, queryByRole } = render(<SelectionBar />);
    expect(container.innerHTML).toBe('');

    act(() => {
      selectNodes(['n1', 'n2']);
    });
    expect(getByRole('button', { name: 'Pin as context' })).toBeTruthy();
    expect(getByRole('button', { name: 'Group' })).toBeTruthy();

    act(() => {
      clearSelection();
    });
    expect(container.innerHTML).toBe('');
    expect(queryByRole('button')).toBeNull();

    act(() => {
      selectNodes(['n3']);
    });
    expect(getByRole('button', { name: 'Pin as context' })).toBeTruthy();
  });

  test('single selection shows singular count and hides group/connect actions', () => {
    act(() => {
      selectNodes(['n1']);
    });
    const { getByText, getByRole, queryByRole } = render(<SelectionBar />);

    expect(getByText(/1 node selected/)).toBeTruthy();
    expect(getByRole('button', { name: 'Pin as context' })).toBeTruthy();
    expect(queryByRole('button', { name: 'Group' })).toBeNull();
    expect(queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  test('multi selection shows plural count and offers group/connect', () => {
    act(() => {
      selectNodes(['n1', 'n2', 'n3']);
    });
    const { getByText, getByRole } = render(<SelectionBar />);

    expect(getByText(/3 nodes selected/)).toBeTruthy();
    expect(getByRole('button', { name: 'Group' })).toBeTruthy();
    expect(getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  test('clear button empties the selection and removes the bar', () => {
    act(() => {
      selectNodes(['n1', 'n2']);
    });
    const { container, getByTitle } = render(<SelectionBar />);

    act(() => {
      fireEvent.click(getByTitle('Clear selection'));
    });

    expect(selectedNodeIds.value.size).toBe(0);
    expect(container.innerHTML).toBe('');
  });

  test('pin as context moves the selection into context pins', () => {
    act(() => {
      selectNodes(['n1', 'n2']);
    });
    const { container, getByRole } = render(<SelectionBar />);

    act(() => {
      fireEvent.click(getByRole('button', { name: 'Pin as context' }));
    });

    expect(Array.from(contextPinnedNodeIds.value).sort()).toEqual(['n1', 'n2']);
    expect(selectedNodeIds.value.size).toBe(0);
    expect(container.innerHTML).toBe('');
  });
});
