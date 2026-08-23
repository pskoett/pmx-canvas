import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentPresence } from '../../src/server/agent-presence.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import type { AgentPresenceSnapshot } from '../../src/shared/agent-presence.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// rail-chrome-v2 phase 2: the presence contract over its real transports —
// HTTP mutations, the AX activity feed, the explicit endpoint, and SSE.

let workspaceRoot = '';
let baseUrl = '';

type PresenceResponse = AgentPresenceSnapshot & { ok: boolean };

async function getPresence(): Promise<PresenceResponse> {
  const response = await fetch(`${baseUrl}/api/canvas/ax/presence`);
  expect(response.ok).toBe(true);
  return (await response.json()) as PresenceResponse;
}

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Resolve with the first `eventName` frame whose payload satisfies `accept`. */
async function readSseEvent(
  eventName: string,
  accept: (payload: Record<string, unknown>) => boolean,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('Failed to connect to workbench SSE.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let frameEnd = buffer.indexOf('\n\n');
      while (frameEnd !== -1) {
        const frame = buffer.slice(0, frameEnd);
        buffer = buffer.slice(frameEnd + 2);
        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (event === eventName && data) {
          const payload = JSON.parse(data) as Record<string, unknown>;
          if (accept(payload)) return payload;
        }
        frameEnd = buffer.indexOf('\n\n');
      }
    }
    throw new Error(`SSE event "${eventName}" was not received.`);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

beforeAll(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-presence-');
  resetCanvasForTests(workspaceRoot);
  const base = startCanvasServer({ workspaceRoot, port: 0 });
  if (!base) throw new Error('Failed to start canvas server for tests.');
  baseUrl = base;
});

afterAll(() => {
  stopCanvasServer();
  removeTestWorkspace(workspaceRoot);
});

beforeEach(async () => {
  // The clear itself is an agent mutation (no workbench marker) and registers
  // the test harness as a writer — reset presence AFTER it.
  await postJson('/api/canvas/clear', {});
  agentPresence.reset();
});

describe('agent presence over HTTP', () => {
  test('starts empty: no writers, no session, zero budget used', async () => {
    const snapshot = await getPresence();
    expect(snapshot.ok).toBe(true);
    expect(snapshot.presences).toEqual([]);
    expect(snapshot.sessionActive).toBe(false);
    expect(snapshot.budget.used).toBe(0);
    expect(snapshot.budget.total).toBeGreaterThan(0);
  });

  test('an agent mutation registers the caller as a tooling writer; a workbench mutation does not', async () => {
    const agentCreate = await postJson('/api/canvas/node', { type: 'markdown', title: 'From agent' });
    expect(agentCreate.ok).toBe(true);
    const afterAgent = await getPresence();
    expect(afterAgent.presences).toHaveLength(1);
    expect(afterAgent.presences[0]).toMatchObject({ sessionId: 'api', source: 'api', opCount: 1, attached: false });
    expect(afterAgent.presences[0]?.phase).toBe('tooling');
    expect(afterAgent.presences[0]?.detail).toBe('node.add');
    expect(afterAgent.sessionActive).toBe(false);

    const humanCreate = await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'From the browser' },
      { 'x-pmx-workbench': '1' },
    );
    expect(humanCreate.ok).toBe(true);
    const afterHuman = await getPresence();
    // The human's own edit is not agent presence.
    expect(afterHuman.presences).toHaveLength(1);
    expect(afterHuman.presences[0]?.opCount).toBe(1);
  });

  test('agent writes feed the activity list with a summary and the writer', async () => {
    const created = await postJson('/api/canvas/node', { type: 'markdown', title: 'Plan', x: 10, y: 10 });
    const { id } = (await created.json()) as { id: string };
    await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'Human note', x: 400, y: 10 },
      { 'x-pmx-workbench': '1' },
    );
    const snapshot = await getPresence();
    expect(snapshot.activity).toHaveLength(1);
    expect(snapshot.activity[0]).toMatchObject({
      sessionId: 'api',
      label: 'api',
      op: 'node.add',
      summary: 'Created markdown “Plan”',
      nodeId: id,
    });
    expect(typeof snapshot.activity[0]?.at).toBe('string');
  });

  test('history entries carry who made them; the top of the shared stack is exposed', async () => {
    await postJson('/api/canvas/node', { type: 'markdown', title: 'Agent made', x: 10, y: 10 });
    let history = (await (await fetch(`${baseUrl}/api/canvas/history`)).json()) as {
      top: { actor: string; description: string } | null;
      entries: Array<{ actor: string }>;
    };
    expect(history.top).toMatchObject({ actor: 'agent', description: expect.stringContaining('Agent made') });
    await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'Human made', x: 400, y: 10 },
      { 'x-pmx-workbench': '1' },
    );
    history = (await (await fetch(`${baseUrl}/api/canvas/history`)).json()) as typeof history;
    expect(history.top?.actor).toBe('human');
    expect(history.entries.slice(-2).map((entry) => entry.actor)).toEqual(['agent', 'human']);
  });

  test('reads never count as presence', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/state`);
    expect(response.ok).toBe(true);
    expect((await getPresence()).presences).toEqual([]);
  });

  test('a custom writer label attaches under itself, so its own writes fold into the session (live-board finding)', async () => {
    // PMX_CANVAS_AGENT_SOURCE=claude-code: the MCP server labels its writes
    // `claude-code` AND attaches under it. Normalizing the attach through the
    // AX source enum dropped it to `api` and split one agent into two cursors.
    const attach = await postJson('/api/canvas/ax/presence', {
      source: 'claude-code',
      attached: true,
      label: 'Claude Code',
    });
    expect(attach.ok).toBe(true);
    const create = await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'From MCP' },
      { 'x-pmx-source': 'claude-code' },
    );
    const { id } = (await create.json()) as { id: string };
    const snapshot = await getPresence();
    expect(snapshot.presences).toHaveLength(1);
    expect(snapshot.presences[0]).toMatchObject({
      sessionId: 'claude-code',
      source: 'claude-code',
      attached: true,
      opCount: 1,
      focusNodeId: id,
    });
    await postJson('/api/canvas/ax/presence', { source: 'claude-code', attached: false });
  });

  test('an adapter identifies itself with x-pmx-source', async () => {
    const response = await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'From copilot' },
      { 'x-pmx-source': 'copilot' },
    );
    expect(response.ok).toBe(true);
    const snapshot = await getPresence();
    expect(snapshot.presences.map((p) => p.sessionId)).toEqual(['copilot']);
  });

  test('session-start / session-end on the activity feed attach and detach', async () => {
    const start = await postJson('/api/canvas/ax/activity', {
      kind: 'session-start',
      title: 'Copilot · release train',
      source: 'copilot',
    });
    expect(start.ok).toBe(true);
    const attached = await getPresence();
    expect(attached.sessionActive).toBe(true);
    expect(attached.presences[0]).toMatchObject({
      sessionId: 'copilot',
      attached: true,
      label: 'Copilot · release train',
    });

    const toolStart = await postJson('/api/canvas/ax/activity', {
      kind: 'tool-start',
      title: 'bun test',
      source: 'copilot',
    });
    expect(toolStart.ok).toBe(true);
    expect((await getPresence()).presences[0]).toMatchObject({ phase: 'tooling', detail: 'bun test' });

    const end = await postJson('/api/canvas/ax/activity', { kind: 'session-end', title: 'done', source: 'copilot' });
    expect(end.ok).toBe(true);
    const detached = await getPresence();
    expect(detached.sessionActive).toBe(false);
    expect(detached.presences).toEqual([]);
  });

  test('the explicit endpoint sets phase, cursor and focus, and validates its input', async () => {
    const node = (await (await postJson('/api/canvas/node', { type: 'markdown', title: 'Target' })).json()) as {
      id: string;
    };
    const set = await postJson('/api/canvas/ax/presence', {
      source: 'codex',
      agentId: 'planner',
      phase: 'thinking',
      focusNodeId: node.id,
      cursor: { x: 120, y: 80 },
      attached: true,
    });
    expect(set.ok).toBe(true);
    const body = (await set.json()) as { presence: Record<string, unknown>; sessionActive: boolean };
    expect(body.presence).toMatchObject({
      sessionId: 'planner',
      source: 'codex',
      phase: 'thinking',
      focusNodeId: node.id,
      cursor: { x: 120, y: 80 },
      attached: true,
    });
    expect(body.sessionActive).toBe(true);

    const badPhase = await postJson('/api/canvas/ax/presence', { phase: 'dancing' });
    expect(badPhase.status).toBe(400);
    const badFocus = await postJson('/api/canvas/ax/presence', { focusNodeId: 'missing-node' });
    expect(badFocus.status).toBe(404);
  });

  test('a pending approval gate turns an attached session into waiting-approval', async () => {
    await postJson('/api/canvas/ax/presence', { source: 'copilot', attached: true });
    const node = (await (await postJson('/api/canvas/node', { type: 'markdown', title: 'Gate target' })).json()) as {
      id: string;
    };
    const gate = await postJson('/api/canvas/ax/approval', { title: 'Ship?', nodeIds: [node.id], source: 'copilot' });
    expect(gate.ok).toBe(true);
    expect((await getPresence()).presences.find((p) => p.sessionId === 'copilot')?.phase).toBe('waiting-approval');
  });
});

describe('write attribution over HTTP', () => {
  test('transport writes land on the attached session; identified writers stay separate', async () => {
    await postJson('/api/canvas/ax/activity', { kind: 'session-start', title: 'Codex', source: 'codex' });
    // An MCP/HTTP write with no identity → the session's own work.
    const viaApi = await postJson('/api/canvas/node', { type: 'markdown', title: 'By the session' });
    expect(viaApi.ok).toBe(true);
    const viaCli = await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'Also the session' },
      { 'x-pmx-source': 'cli' },
    );
    expect(viaCli.ok).toBe(true);
    const second = (await viaCli.json()) as { id: string };
    let snapshot = await getPresence();
    expect(snapshot.presences.map((p) => p.sessionId)).toEqual(['codex']);
    expect(snapshot.presences[0]).toMatchObject({ attached: true, opCount: 2, phase: 'tooling', detail: 'node.add' });
    // The cursor follows the latest write.
    expect(snapshot.presences[0]?.focusNodeId).toBe(second.id);

    // A sub-agent with its own agentId is a separate writer.
    const subagent = await postJson('/api/canvas/node', { type: 'markdown', title: 'Helper', agentId: 'helper-1' });
    expect(subagent.ok).toBe(true);
    snapshot = await getPresence();
    expect(snapshot.presences.map((p) => p.sessionId).sort()).toEqual(['codex', 'helper-1']);
  });
});

describe('agent presence over SSE', () => {
  test('attaching a session broadcasts an agent-presence snapshot with sessionActive', async () => {
    const frame = readSseEvent('agent-presence', (payload) => payload.sessionActive === true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const set = await postJson('/api/canvas/ax/presence', { source: 'copilot', attached: true, phase: 'thinking' });
    expect(set.ok).toBe(true);
    const payload = (await frame) as unknown as AgentPresenceSnapshot;
    expect(payload.sessionActive).toBe(true);
    expect(payload.presences[0]).toMatchObject({ sessionId: 'copilot', phase: 'thinking', attached: true });
    expect(payload.budget).toMatchObject({ used: 0 });
  });

  test('a session attaches over a non-empty board → pre-session snapshot; ending it → a receipt with counts + that snapshot', async () => {
    // rail-chrome-v2 phase 5, design item 2.
    const beforeCount = ((await (await fetch(`${baseUrl}/api/canvas/snapshots?all=true`)).json()) as unknown[]).length;
    await postJson('/api/canvas/node', { type: 'markdown', title: 'Pre-existing', x: 0, y: 0 });
    expect(
      (await postJson('/api/canvas/ax/presence', { source: 'copilot', label: 'Copilot', attached: true })).ok,
    ).toBe(true);
    const snapshots = (await (await fetch(`${baseUrl}/api/canvas/snapshots?all=true`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    expect(snapshots).toHaveLength(beforeCount + 1);
    const before = snapshots.find((entry) => entry.name.startsWith('Before session · Copilot · '));
    expect(before).toBeDefined();

    // The session does some work: two items (one done), a gate the human rejects.
    const created = await postJson('/api/canvas/ax/work', { title: 'Done thing', status: 'done' });
    expect(created.ok).toBe(true);
    await postJson('/api/canvas/ax/work', { title: 'Open thing' });
    const gate = (await (await postJson('/api/canvas/ax/approval', { title: 'Risky' })).json()) as {
      approvalGate: { id: string };
    };
    await postJson(
      `/api/canvas/ax/approval/${gate.approvalGate.id}/resolve`,
      { decision: 'rejected' },
      { 'x-pmx-workbench': '1' },
    );
    await postJson('/api/canvas/node', { type: 'markdown', title: 'Added by the session', x: 400, y: 0 });

    const receipt = readSseEvent('agent-session-ended', () => true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((await postJson('/api/canvas/ax/presence', { source: 'copilot', attached: false })).ok).toBe(true);
    const payload = await receipt;
    expect(payload).toMatchObject({
      label: 'Copilot',
      counts: { items: 2, done: 1, vetoed: 1 },
      snapshot: { id: before?.id, name: before?.name },
    });
    expect(typeof payload.endedAt).toBe('string');

    // The receipt's View diff: the snapshot predates the session's node.
    const diff = (await (await fetch(`${baseUrl}/api/canvas/snapshots/${before?.id}/diff`)).json()) as {
      diff: { addedNodes: unknown[]; removedNodes: unknown[] };
    };
    expect(diff.diff.addedNodes).toHaveLength(1);
    expect(diff.diff.removedNodes).toHaveLength(0);
  });

  test('a human-started session takes the name of the agent that fills it — receipt and snapshot included', async () => {
    await postJson(
      '/api/canvas/node',
      { type: 'markdown', title: 'Pre-existing', x: 0, y: 0 },
      { 'x-pmx-workbench': '1' },
    );
    // *Start agent session* in the browser …
    expect(
      (await postJson('/api/canvas/ax/presence', { source: 'browser', label: 'Agent session', attached: true })).ok,
    ).toBe(true);
    // … then an agent identified by a host label writes through HTTP.
    expect(
      (
        await postJson(
          '/api/canvas/node',
          { type: 'markdown', title: 'By the agent', x: 400, y: 0 },
          { 'x-pmx-source': 'claude-code' },
        )
      ).ok,
    ).toBe(true);
    const presence = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as AgentPresenceSnapshot;
    expect(presence.presences.map((p) => [p.sessionId, p.label, p.attached])).toEqual([
      ['browser', 'claude-code', true],
    ]);

    const receipt = readSseEvent('agent-session-ended', () => true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await postJson('/api/canvas/ax/presence', { source: 'browser', attached: false });
    const payload = await receipt;
    expect(payload.label).toBe('claude-code');
    const snapshot = payload.snapshot as { id: string; name: string };
    expect(snapshot.name.startsWith('Before session · claude-code · ')).toBe(true);
    const listed = (await (await fetch(`${baseUrl}/api/canvas/snapshots?all=true`)).json()) as Array<{
      id: string;
      name: string;
    }>;
    expect(listed.find((entry) => entry.id === snapshot.id)?.name).toBe(snapshot.name);
  });

  test('a session attaching over an empty board takes no snapshot and the receipt says so', async () => {
    const beforeCount = ((await (await fetch(`${baseUrl}/api/canvas/snapshots?all=true`)).json()) as unknown[]).length;
    await postJson('/api/canvas/ax/presence', { source: 'codex', attached: true });
    expect(((await (await fetch(`${baseUrl}/api/canvas/snapshots?all=true`)).json()) as unknown[]).length).toBe(
      beforeCount,
    );
    const receipt = readSseEvent('agent-session-ended', () => true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await postJson('/api/canvas/ax/presence', { source: 'codex', attached: false });
    expect((await receipt).snapshot).toBeNull();
  });

  test('an agent mutation broadcasts the writer without a session', async () => {
    const frame = readSseEvent(
      'agent-presence',
      (payload) => Array.isArray(payload.presences) && (payload.presences as unknown[]).length > 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const create = await postJson('/api/canvas/node', { type: 'markdown', title: 'External write' });
    expect(create.ok).toBe(true);
    const payload = (await frame) as unknown as AgentPresenceSnapshot;
    expect(payload.sessionActive).toBe(false);
    expect(payload.presences[0]).toMatchObject({ sessionId: 'api', opCount: 1, phase: 'tooling' });
  });
});
