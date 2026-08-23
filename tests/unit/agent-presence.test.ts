import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { AgentPresenceRegistry, estimateContextBudget } from '../../src/server/agent-presence.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import {
  CONTEXT_BUDGET_DEFAULT_TOKENS,
  MAX_PRESENCES,
  PRESENCE_ACTIVITY_TTL_MS,
  PRESENCE_ATTACHED_IDLE_TTL_MS,
  PRESENCE_TOOLING_SETTLE_MS,
  isSessionActive,
} from '../../src/shared/agent-presence.ts';

// rail-chrome-v2 phase 2: presence is DERIVED from feeds that already exist.
// These tests pin the contract in design/rail-chrome-v2/PLAN.md.

let registry: AgentPresenceRegistry;
let frames: Array<{ event: string; payload: Record<string, unknown> }>;
const T0 = 1_700_000_000_000;

function flushEmits(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 80));
}

beforeEach(() => {
  canvasState.withSuppressedRecording(() => canvasState.clear());
  registry = new AgentPresenceRegistry();
  frames = [];
  registry.setEmitter((event, payload) => frames.push({ event, payload }));
});

afterEach(() => {
  registry.reset();
  canvasState.withSuppressedRecording(() => canvasState.clear());
});

describe('sessionActive', () => {
  test('an unattached writer is NOT a session — the quiet board stays quiet', () => {
    registry.touch({ source: 'mcp', op: true }, T0);
    const snapshot = registry.snapshot(T0);
    expect(snapshot.presences).toHaveLength(1);
    expect(snapshot.sessionActive).toBe(false);
    expect(isSessionActive(snapshot.presences)).toBe(false);
  });

  test('session-start attaches; session-end detaches', () => {
    registry.observeActivity('session-start', { source: 'copilot', title: 'Copilot session' }, T0);
    expect(registry.snapshot(T0).sessionActive).toBe(true);
    expect(registry.snapshot(T0).presences[0]?.label).toBe('Copilot session');
    registry.observeActivity('session-end', { source: 'copilot', title: 'bye' }, T0 + 10);
    expect(registry.snapshot(T0 + 10).sessionActive).toBe(false);
    expect(registry.snapshot(T0 + 10).presences).toHaveLength(0);
  });

  test('agentId is the writer key; the host label is kept as source', () => {
    registry.touch({ source: 'copilot', agentId: 'planner', op: true }, T0);
    registry.touch({ source: 'copilot', agentId: 'planner', op: true }, T0 + 1);
    registry.touch({ source: 'copilot', op: true }, T0 + 2);
    const { presences } = registry.snapshot(T0 + 2);
    expect(presences.map((p) => p.sessionId).sort()).toEqual(['copilot', 'planner']);
    expect(presences.find((p) => p.sessionId === 'planner')?.opCount).toBe(2);
    expect(presences.find((p) => p.sessionId === 'planner')?.source).toBe('copilot');
  });
});

describe('phase derivation', () => {
  test('a mutation reads as tooling with the op name, then settles to idle after the quiet window', () => {
    registry.touch({ source: 'mcp', phase: 'tooling', detail: 'node.add', op: true }, T0);
    expect(registry.snapshot(T0 + 100).presences[0]).toMatchObject({ phase: 'tooling', detail: 'node.add' });
    const settled = registry.snapshot(T0 + PRESENCE_TOOLING_SETTLE_MS + 1).presences[0];
    expect(settled).toMatchObject({ phase: 'idle', detail: null });
  });

  test('tool-start / tool-result drive the phase', () => {
    registry.observeActivity('tool-start', { source: 'codex', title: 'bun test' }, T0);
    expect(registry.snapshot(T0).presences[0]).toMatchObject({ phase: 'tooling', detail: 'bun test' });
    registry.observeActivity('tool-result', { source: 'codex', title: 'bun test' }, T0 + 50);
    expect(registry.snapshot(T0 + 50).presences[0]).toMatchObject({ phase: 'idle', detail: null });
  });

  test('an explicit thinking phase holds until the next touch (no decay)', () => {
    registry.set({ phase: 'thinking', attached: true }, 'codex');
    const later = registry.snapshot(Date.now() + PRESENCE_TOOLING_SETTLE_MS * 3);
    expect(later.presences[0]?.phase).toBe('thinking');
  });

  test('an attached session with a pending approval gate reads as waiting-approval', () => {
    canvasState.addNode({
      id: 'gate-node',
      type: 'markdown',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: 'Gate target' },
    });
    canvasState.requestApproval({ title: 'Ship it?', nodeIds: ['gate-node'] }, { source: 'mcp' });
    registry.touch({ source: 'mcp', attached: true }, T0);
    // An IDENTIFIED writer keeps its own key (never attributed to the session).
    registry.touch({ source: 'api', agentId: 'helper', op: true }, T0);
    const { presences } = registry.snapshot(T0);
    // Only the attached session is blocked on the human; an unattached writer is not.
    expect(presences.find((p) => p.sessionId === 'mcp')?.phase).toBe('waiting-approval');
    expect(presences.find((p) => p.sessionId === 'helper')?.phase).toBe('idle');
  });
});

describe("write attribution (the cursor follows the session's own work)", () => {
  test('a transport-labelled write lands on the single attached session', () => {
    registry.observeActivity('session-start', { source: 'copilot', title: 'Copilot' }, T0);
    registry.touch({ source: 'mcp', phase: 'tooling', detail: 'node.add', focusNodeId: 'n1', op: true }, T0 + 10);
    const { presences } = registry.snapshot(T0 + 10);
    expect(presences).toHaveLength(1);
    expect(presences[0]).toMatchObject({
      sessionId: 'copilot',
      attached: true,
      phase: 'tooling',
      detail: 'node.add',
      focusNodeId: 'n1',
      opCount: 1,
    });
  });

  test('pre-attach transport writes fold into the session once it attaches', () => {
    registry.touch({ source: 'api', op: true }, T0);
    registry.touch({ source: 'api', op: true }, T0 + 1);
    registry.touch({ source: 'codex', attached: true }, T0 + 2);
    registry.touch({ source: 'api', op: true, focusNodeId: 'n2' }, T0 + 3);
    const { presences } = registry.snapshot(T0 + 3);
    expect(presences.map((p) => p.sessionId)).toEqual(['codex']);
    expect(presences[0]?.opCount).toBe(3);
    expect(presences[0]?.focusNodeId).toBe('n2');
  });

  test('with two sessions attached a transport write is ambiguous and stays its own writer', () => {
    registry.touch({ source: 'copilot', attached: true }, T0);
    registry.touch({ source: 'codex', attached: true }, T0);
    registry.touch({ source: 'mcp', op: true }, T0 + 1);
    const ids = registry
      .snapshot(T0 + 1)
      .presences.map((p) => p.sessionId)
      .sort();
    expect(ids).toEqual(['codex', 'copilot', 'mcp']);
  });

  test('an identified writer (agentId) or a host label is never re-attributed', () => {
    registry.touch({ source: 'copilot', attached: true }, T0);
    registry.touch({ source: 'mcp', agentId: 'subagent-2', op: true }, T0 + 1);
    registry.touch({ source: 'codex', op: true }, T0 + 2);
    const ids = registry
      .snapshot(T0 + 2)
      .presences.map((p) => p.sessionId)
      .sort();
    expect(ids).toEqual(['codex', 'copilot', 'subagent-2']);
  });

  test('an MCP agent that attached itself as mcp keeps accumulating on its own key', () => {
    registry.touch({ source: 'mcp', attached: true }, T0);
    registry.touch({ source: 'mcp', op: true, focusNodeId: 'n9' }, T0 + 1);
    const { presences } = registry.snapshot(T0 + 1);
    expect(presences).toHaveLength(1);
    expect(presences[0]).toMatchObject({ sessionId: 'mcp', attached: true, focusNodeId: 'n9', opCount: 1 });
  });
});

describe('lifetime discipline', () => {
  test('unattached writers fade after the activity TTL; attached sessions outlive it', () => {
    registry.touch({ source: 'api', op: true }, T0);
    registry.touch({ source: 'copilot', attached: true }, T0);
    const after = registry.snapshot(T0 + PRESENCE_ACTIVITY_TTL_MS + 1);
    expect(after.presences.map((p) => p.sessionId)).toEqual(['copilot']);
    expect(after.sessionActive).toBe(true);
  });

  test('an attached session expires without a session-end after the idle TTL', () => {
    registry.touch({ source: 'copilot', attached: true }, T0);
    expect(registry.snapshot(T0 + PRESENCE_ATTACHED_IDLE_TTL_MS + 1).sessionActive).toBe(false);
  });

  test('the oldest writer is evicted past the cap', () => {
    for (let i = 0; i < MAX_PRESENCES + 3; i += 1) {
      registry.touch({ source: `writer-${i}`, op: true }, T0 + i);
    }
    const { presences } = registry.snapshot(T0 + 100);
    expect(presences).toHaveLength(MAX_PRESENCES);
    expect(presences.some((p) => p.sessionId === 'writer-0')).toBe(false);
    expect(presences.some((p) => p.sessionId === `writer-${MAX_PRESENCES + 2}`)).toBe(true);
  });
});

describe('session lifecycle (pre-session snapshot + receipt)', () => {
  // rail-chrome-v2 phase 5: server.ts snapshots the board when a session
  // ATTACHES and emits the receipt when it ends. The registry's contract is
  // exactly one start per attach and one end per attached session, whichever
  // way it ends.
  let starts: string[];
  let ends: Array<{ sessionId: string; startSnapshotId: string | null }>;

  beforeEach(() => {
    starts = [];
    ends = [];
    registry.setSessionStartListener((presence) => {
      starts.push(presence.sessionId);
      return `snap-${starts.length}`;
    });
    registry.setSessionEndListener((presence, startSnapshotId) =>
      ends.push({ sessionId: presence.sessionId, startSnapshotId }),
    );
  });

  test('start fires once per attach and its snapshot id comes back at the explicit end', () => {
    registry.touch({ source: 'copilot', attached: true }, T0);
    registry.touch({ source: 'copilot', attached: true, op: true }, T0 + 10); // still attached: no second start
    registry.touch({ source: 'copilot', op: true }, T0 + 20);
    expect(starts).toEqual(['copilot']);
    registry.touch({ source: 'copilot', attached: false }, T0 + 30);
    expect(ends).toEqual([{ sessionId: 'copilot', startSnapshotId: 'snap-1' }]);
    registry.touch({ source: 'copilot', attached: true }, T0 + 40); // a new session gets a new snapshot
    expect(starts).toEqual(['copilot', 'copilot']);
  });

  test('detach and the idle-TTL sweep end an attached session too; unattached writers never do', () => {
    registry.touch({ source: 'codex', attached: true }, T0);
    registry.detach('codex');
    expect(ends).toEqual([{ sessionId: 'codex', startSnapshotId: 'snap-1' }]);

    registry.touch({ source: 'copilot', attached: true }, T0);
    registry.touch({ source: 'api', op: true }, T0);
    registry.snapshot(T0 + PRESENCE_ATTACHED_IDLE_TTL_MS + 1);
    expect(ends.map((end) => end.sessionId)).toEqual(['codex', 'copilot']);
  });
});

describe('transport', () => {
  test('every change emits one coalesced agent-presence snapshot frame', async () => {
    registry.touch({ source: 'mcp', op: true });
    registry.touch({ source: 'mcp', op: true });
    registry.touch({ source: 'mcp', op: true });
    await flushEmits();
    expect(frames).toHaveLength(1);
    expect(frames[0]?.event).toBe('agent-presence');
    const payload = frames[0]?.payload as { presences: Array<{ opCount: number }>; sessionActive: boolean };
    expect(payload.presences[0]?.opCount).toBe(3);
    expect(payload.sessionActive).toBe(false);
  });

  test('set() validates: an unknown phase is rejected, a missing focus node is 404', () => {
    expect(() => registry.set({ phase: 'dancing' }, 'api')).toThrow(/Invalid presence/);
    expect(() => registry.set({ focusNodeId: 'nope' }, 'api')).toThrow(/does not exist/);
  });
});

describe('context budget', () => {
  test('is zero with nothing pinned and grows with pinned content', () => {
    expect(estimateContextBudget()).toEqual({ used: 0, total: CONTEXT_BUDGET_DEFAULT_TOKENS });
    canvasState.addNode({
      id: 'pinned-a',
      type: 'markdown',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: 'Pinned', content: 'word '.repeat(400) },
    });
    canvasState.setContextPins(['pinned-a']);
    const budget = estimateContextBudget();
    expect(budget.used).toBeGreaterThan(100);
    expect(budget.total).toBe(CONTEXT_BUDGET_DEFAULT_TOKENS);
    expect(registry.snapshot().budget).toEqual(budget);
  });
});
