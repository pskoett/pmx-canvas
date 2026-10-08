import { beforeEach, describe, expect, test } from 'bun:test';
import {
  activeSession,
  agentPresences,
  applyPresenceSnapshot,
  externalWriterPresences,
  resetPresence,
  sessionActive,
} from '../../src/client/state/presence-store.ts';
import type { AgentPresence } from '../../src/shared/agent-presence.ts';

function presence(overrides: Partial<AgentPresence>): AgentPresence {
  return {
    sessionId: 'api',
    source: 'api',
    agentId: null,
    label: 'api',
    phase: 'idle',
    detail: null,
    focusNodeId: null,
    cursor: null,
    attached: false,
    opCount: 0,
    contextUsage: null,
    lastSeenAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => resetPresence());

describe('presence store', () => {
  test('sessionActive is the single gate: only an attached presence flips it', () => {
    applyPresenceSnapshot({ presences: [presence({ sessionId: 'mcp', source: 'mcp', opCount: 3 })] });
    expect(sessionActive.value).toBe(false);
    expect(externalWriterPresences.value.map((p) => p.sessionId)).toEqual(['mcp']);
    expect(activeSession.value).toBeNull();

    applyPresenceSnapshot({
      presences: [
        presence({ sessionId: 'mcp', source: 'mcp' }),
        presence({ sessionId: 'copilot', source: 'copilot', attached: true, phase: 'thinking' }),
      ],
    });
    expect(sessionActive.value).toBe(true);
    expect(activeSession.value?.sessionId).toBe('copilot');
    // External writers exclude the attached session.
    expect(externalWriterPresences.value.map((p) => p.sessionId)).toEqual(['mcp']);
  });

  test('a snapshot with no presences clears everything (the server broadcasts expiry)', () => {
    applyPresenceSnapshot({ presences: [presence({ attached: true })] });
    expect(sessionActive.value).toBe(true);
    applyPresenceSnapshot({ presences: [] });
    expect(sessionActive.value).toBe(false);
    expect(agentPresences.value).toEqual([]);
  });

  test('a partial or malformed frame never corrupts the store', () => {
    applyPresenceSnapshot({ presences: [presence({ attached: true })] });
    applyPresenceSnapshot({ presences: 'x' as unknown as [] });
    applyPresenceSnapshot(null);
    applyPresenceSnapshot(undefined);
    expect(sessionActive.value).toBe(true);
  });
});
