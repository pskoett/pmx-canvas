import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/preact';
import { SessionReceipt } from '../../src/client/canvas/SessionReceipt.tsx';
import {
  activityLensNodeIds,
  applySessionReceipt,
  dismissSessionReceipt,
} from '../../src/client/state/session-store.ts';

// docs/design/AgentContext.dc.html: after a session, the receipt says what the
// agent did with context, and the lens dims every node it did not touch.

beforeEach(dismissSessionReceipt);

afterEach(() => {
  cleanup();
  dismissSessionReceipt();
});

function receipt(context: Record<string, unknown>) {
  applySessionReceipt({
    label: 'Claude',
    endedAt: '2026-10-05T14:20:00.000Z',
    endedBy: 'agent',
    counts: {},
    snapshot: null,
    context,
  });
}

describe('session receipt: context', () => {
  test('shows the out-of-date pins first, then one row per kind of touch', () => {
    receipt({
      read: [{ id: 'a', title: 'Brief' }],
      pinned: [{ id: 'b', title: 'Churn by plan', reason: 'the chart the finding rests on' }],
      created: [{ id: 'c', title: 'Churn flat' }],
      edited: [],
      changedSinceRead: [{ id: 'a', title: 'Brief' }],
    });
    const { getByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    const context = getByTestId('session-receipt-context');
    expect(context.querySelector('.session-receipt-warn')?.textContent).toContain('Brief changed after Claude read it');
    expect([...context.querySelectorAll('[data-row]')].map((row) => row.getAttribute('data-row'))).toEqual([
      'read',
      'pinned',
      'created',
    ]);
    expect(context.querySelector('[data-row="pinned"]')?.textContent).toContain('the chart the finding rests on');
  });

  test('the lens dims every node the session did not touch', () => {
    receipt({
      read: [{ id: 'a', title: 'Brief' }],
      pinned: [],
      created: [{ id: 'c', title: 'Churn flat' }],
      edited: [],
      changedSinceRead: [],
    });
    const { getByRole } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    const lens = getByRole('switch', { name: 'Dim untouched nodes' });
    expect(lens.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(lens);
    expect([...(activityLensNodeIds.value ?? [])].sort()).toEqual(['a', 'c']);
    dismissSessionReceipt();
    expect(activityLensNodeIds.value).toBeNull();
  });

  test('a session that touched no context shows no context section', () => {
    receipt({ read: [], pinned: [], created: [], edited: [], changedSinceRead: [] });
    const { queryByTestId } = render(<SessionReceipt onOpenSnapshots={() => {}} />);
    expect(queryByTestId('session-receipt-context')).toBeNull();
  });
});
