import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, cleanup, render } from '@testing-library/preact';
import { TopBar } from '../../src/client/canvas/TopBar.tsx';
import { stopHumanPresence } from '../../src/client/state/human-store.ts';
import { agentPresences, resetPresence, sessionChromeActive } from '../../src/client/state/presence-store.ts';
import { EVENT_HANDLERS } from '../../src/client/state/sse-bridge.ts';
import { workspaceSettings } from '../../src/client/state/workspace-settings.ts';
import type { AgentPresenceSnapshot } from '../../src/shared/agent-presence.ts';

const quiet: AgentPresenceSnapshot = { presences: [], activity: [], sessionActive: false };
const attached: AgentPresenceSnapshot = {
  presences: ['alpha', 'beta'].map((agentId) => ({
    sessionId: agentId,
    source: 'api',
    agentId,
    label: agentId,
    phase: 'idle',
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached: true,
    opCount: 0,
    contextUsage: null,
    lastSeenAt: '2026-10-24T00:00:00.000Z',
  })),
  activity: [],
  sessionActive: true,
};

const realFetch = globalThis.fetch;
let releaseHttpSnapshot: (response: Response) => void;

beforeEach(() => {
  resetPresence();
  workspaceSettings.value = null;
  const delayed = new Promise<Response>((resolve) => {
    releaseHttpSnapshot = resolve;
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/canvas/ax/presence') return (await delayed).clone();
    return Response.json({});
  }) as typeof fetch;
});

afterEach(() => {
  stopHumanPresence();
  cleanup();
  resetPresence();
  workspaceSettings.value = null;
  globalThis.fetch = realFetch;
});

function connect(snapshot: AgentPresenceSnapshot, sessionId = 'server-1'): void {
  // Both SSE and polling deliver these frames, in this order, on every connect.
  EVENT_HANDLERS.connected({
    sessionId,
    workspaceSettings: { agentSessions: true, knowledgeLifecycle: false },
  });
  EVENT_HANDLERS['agent-presence']({ ...snapshot, reason: 'connect-snapshot' });
}

async function finishHttpSnapshot(snapshot: AgentPresenceSnapshot): Promise<void> {
  await act(async () => {
    releaseHttpSnapshot(Response.json(snapshot));
    // Drain the fetch/body/bridge promise chain before checking the settled UI,
    // not a polled assertion that could pass before the stale response lands.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

test('a late connect-time HTTP snapshot cannot erase newly attached alpha/beta sessions', async () => {
  const { container } = render(<TopBar />);
  act(() => connect(quiet));
  expect(sessionChromeActive.value).toBe(false);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(0);

  act(() => EVENT_HANDLERS['agent-presence']({ ...attached }));
  expect(sessionChromeActive.value).toBe(true);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(2);

  await finishHttpSnapshot(quiet);
  expect(sessionChromeActive.value).toBe(true);
  expect(agentPresences.value.map((presence) => presence.sessionId)).toEqual(['alpha', 'beta']);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(2);
});

test('a late connect-time HTTP snapshot cannot resurrect detached sessions', async () => {
  const { container } = render(<TopBar />);
  // Initial attached sessions must render without waiting for a separate read.
  act(() => connect(attached));
  expect(sessionChromeActive.value).toBe(true);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(2);

  act(() => EVENT_HANDLERS['agent-presence']({ ...quiet }));
  await finishHttpSnapshot(attached);
  expect(sessionChromeActive.value).toBe(false);
  expect(agentPresences.value).toEqual([]);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(0);
});

test('a reconnect snapshot replaces the old session state without an old HTTP read undoing it', async () => {
  const { container } = render(<TopBar />);
  act(() => connect(attached));
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(2);

  act(() => connect(quiet, 'server-2'));
  expect(sessionChromeActive.value).toBe(false);
  await finishHttpSnapshot(attached);
  expect(sessionChromeActive.value).toBe(false);
  expect(container.querySelectorAll('.agent-chip')).toHaveLength(0);
});
