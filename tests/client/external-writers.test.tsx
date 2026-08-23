import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/preact';
import { ActivityFeed, ExternalWriterIndicator, WritersSheet } from '../../src/client/canvas/ExternalWriters.tsx';
import { resetIntents, upsertIntent } from '../../src/client/state/intent-store.ts';
import {
  activityFeedOpen,
  activityFilter,
  applyPresenceSnapshot,
  relativeAge,
  resetPresence,
  writerInitial,
  writersSheetOpen,
} from '../../src/client/state/presence-store.ts';
import { resetSessionStore } from '../../src/client/state/session-store.ts';
import type { AgentActivityEntry, AgentPresence } from '../../src/shared/agent-presence.ts';

// rail-chrome-v2 phase 6: External Steering — writers with no session. The
// indicator, feed, and sheet mount only in that mode; the quiet board and the
// Focus Session show none of them.

function writer(overrides: Partial<AgentPresence>): AgentPresence {
  return {
    sessionId: 'claude-code',
    source: 'mcp',
    agentId: 'claude-code',
    label: 'claude-code',
    phase: 'tooling',
    detail: 'node.add',
    focusNodeId: null,
    cursor: null,
    attached: false,
    opCount: 3,
    contextUsage: null,
    lastSeenAt: new Date(Date.now() - 120_000).toISOString(),
    ...overrides,
  };
}

function entry(overrides: Partial<AgentActivityEntry>): AgentActivityEntry {
  return {
    id: 'act-1',
    at: new Date(Date.now() - 120_000).toISOString(),
    sessionId: 'claude-code',
    label: 'claude-code',
    op: 'node.add',
    summary: 'Created markdown “sse-bridge”',
    nodeId: 'n1',
    ...overrides,
  };
}

let calls: Array<{ url: string; init: RequestInit | undefined }>;
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return new Response(JSON.stringify({ ok: true, cleared: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  calls = [];
  resetPresence();
  resetIntents();
  resetSessionStore();
});
afterEach(cleanup);

describe('external writer indicator', () => {
  test('absent on the quiet board and while a session is attached', () => {
    const { container, rerender } = render(<ExternalWriterIndicator />);
    expect(container.innerHTML).toBe('');
    act(() => applyPresenceSnapshot({ presences: [writer({ attached: true })] }));
    rerender(<ExternalWriterIndicator />);
    expect(container.innerHTML).toBe('');
  });

  test('one writer shows its label; several show a count, the op total, and an avatar per writer', () => {
    act(() => applyPresenceSnapshot({ presences: [writer({})] }));
    const { container, rerender, getByTestId } = render(<ExternalWriterIndicator />);
    expect(container.querySelector('.external-indicator-label')?.textContent).toBe('claude-code');
    expect(container.querySelector('.external-indicator-ops')?.textContent).toBe('3 ops');

    act(() =>
      applyPresenceSnapshot({
        presences: [
          writer({}),
          writer({ sessionId: 'research-bot', agentId: 'research-bot', label: 'research-bot', opCount: 10 }),
          writer({ sessionId: 'mcp-sync', agentId: 'mcp-sync', label: 'mcp-sync', opCount: 8 }),
        ],
      }),
    );
    rerender(<ExternalWriterIndicator />);
    expect(container.querySelector('.external-indicator-label')?.textContent).toBe('3 writers');
    expect(container.querySelector('.external-indicator-ops')?.textContent).toBe('21 ops');
    expect([...container.querySelectorAll('.writer-avatar')].map((el) => el.textContent)).toEqual(['C', 'R', 'M']);

    fireEvent.click(getByTestId('external-indicator'));
    expect(activityFeedOpen.value).toBe(true);
  });
});

describe('activity feed', () => {
  test('lists the writes newest first, attributed and aged, and filters per writer', () => {
    act(() => {
      applyPresenceSnapshot({
        presences: [writer({}), writer({ sessionId: 'research-bot', agentId: 'research-bot', label: 'research-bot' })],
        activity: [
          entry({
            id: 'act-2',
            sessionId: 'research-bot',
            label: 'research-bot',
            op: 'node.update',
            summary: 'Updated “canvas-store”',
            at: new Date(Date.now() - 6 * 60_000).toISOString(),
          }),
          entry({}),
        ],
      });
      activityFeedOpen.value = true;
    });
    const { getAllByTestId, getByText, queryByText, getByTestId } = render(<ActivityFeed />);
    expect(getByTestId('activity-feed').textContent).toContain('External activity — 2 writers');
    const rows = getAllByTestId('activity-row');
    expect(rows.map((row) => row.querySelector('.activity-text')?.textContent)).toEqual([
      'Updated “canvas-store”',
      'Created markdown “sse-bridge”',
    ]);
    expect(rows[0]?.querySelector('.activity-writer')?.textContent).toBe('research-bot');
    expect(rows[0]?.querySelector('.activity-age')?.textContent).toBe('6m');

    fireEvent.click(getByText('claude-code', { selector: '.activity-filter' }));
    expect(activityFilter.value).toBe('claude-code');
    expect(queryByText('Updated “canvas-store”')).toBeNull();
    expect(getByText('Created markdown “sse-bridge”')).toBeTruthy();
  });

  test('a pending explicit intent is a proposal row whose Veto clears it through the intent veto path', async () => {
    act(() => {
      applyPresenceSnapshot({ presences: [writer({})] });
      upsertIntent({
        id: 'int-1',
        kind: 'create',
        label: 'Add ledger-flow node',
        reason: 'summarizing the flow',
        source: 'claude-code',
        position: { x: 0, y: 0 },
        createdAt: Date.now(),
        expiresAt: Date.now() + 8000,
      });
      activityFeedOpen.value = true;
    });
    const { getByTestId, getByText, queryByTestId } = render(<ActivityFeed />);
    expect(getByTestId('activity-proposal').textContent).toContain('Proposing: Add ledger-flow node');
    fireEvent.click(getByText('Veto'));
    await waitFor(() => expect(calls.some((call) => call.url === '/api/canvas/ax/intent/int-1')).toBe(true));
    expect(calls.find((call) => call.url === '/api/canvas/ax/intent/int-1')?.init?.method).toBe('DELETE');
    await waitFor(() => expect(queryByTestId('activity-proposal')).toBeNull());
  });

  test('Writers opens the sheet; Esc closes the sheet first, then the feed', () => {
    act(() => {
      applyPresenceSnapshot({ presences: [writer({})], activity: [entry({})] });
      activityFeedOpen.value = true;
    });
    const { getByText } = render(<ActivityFeed />);
    fireEvent.click(getByText('Writers'));
    expect(writersSheetOpen.value).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(writersSheetOpen.value).toBe(false);
    expect(activityFeedOpen.value).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(activityFeedOpen.value).toBe(false);
  });
});

describe('writers sheet', () => {
  test('lists sessions with their steering config and external writers with transport + last write', () => {
    act(() => {
      applyPresenceSnapshot({
        presences: [
          writer({ sessionId: 'copilot', source: 'copilot', agentId: null, label: 'Claude', attached: true }),
          writer({ lastSeenAt: new Date(Date.now() - 9 * 60_000).toISOString() }),
        ],
      });
      writersSheetOpen.value = true;
    });
    const { getByTestId, getByText } = render(<WritersSheet />);
    const sheet = getByTestId('writers-sheet');
    expect(sheet.querySelector('.writers-config')?.textContent).toBe('open');
    expect(sheet.textContent).toContain('Claude');
    expect(sheet.querySelector('.writers-meta')?.textContent).toBe('mcp · wrote 9m ago');
    expect(sheet.textContent).toContain('veto is the control, not permissions');
    fireEvent.click(getByText('Done'));
    expect(writersSheetOpen.value).toBe(false);
  });
});

describe('helpers', () => {
  test('writerInitial and relativeAge', () => {
    expect(writerInitial('claude-code')).toBe('C');
    expect(writerInitial('  research-bot')).toBe('R');
    expect(writerInitial('@mcp')).toBe('M');
    const now = Date.now();
    expect(relativeAge(new Date(now - 1000).toISOString(), now)).toBe('now');
    expect(relativeAge(new Date(now - 42_000).toISOString(), now)).toBe('42s');
    expect(relativeAge(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m');
    expect(relativeAge(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h');
  });
});
