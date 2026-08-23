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

  test('reads never count as presence', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/state`);
    expect(response.ok).toBe(true);
    expect((await getPresence()).presences).toEqual([]);
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

describe('scope fence over HTTP', () => {
  test('agent writes outside the fence are 403; the human and reads are never fenced', async () => {
    const inside = (await (
      await postJson('/api/canvas/node', { type: 'markdown', title: 'In', x: 100, y: 100 })
    ).json()) as {
      id: string;
    };
    const outside = (await (
      await postJson('/api/canvas/node', { type: 'markdown', title: 'Out', x: 2000, y: 2000 })
    ).json()) as {
      id: string;
    };
    const policy = await postJson(
      '/api/canvas/ax/policy',
      { scope: { nodeIds: [inside.id] }, source: 'browser' },
      {
        'x-pmx-workbench': '1',
      },
    );
    expect(policy.ok).toBe(true);

    const blocked = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Agent edit' }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/Outside the agent scope/);

    const allowed = await fetch(`${baseUrl}/api/canvas/node/${inside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Agent edit inside' }),
    });
    expect(allowed.ok).toBe(true);

    const human = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ title: 'Human edit' }),
    });
    expect(human.ok).toBe(true);

    const read = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`);
    expect(read.ok).toBe(true);

    // Batch inner ops are agent writes too — fenced.
    const batch = await postJson('/api/canvas/batch', {
      operations: [{ op: 'node.update', args: { id: outside.id, title: 'via batch' } }],
    });
    const batchBody = (await batch.json()) as {
      results?: Array<{ ok?: boolean; error?: string }>;
      ok?: boolean;
      error?: string;
    };
    const batchText = JSON.stringify(batchBody);
    expect(batchText).toMatch(/Outside the agent scope/);

    // The fence is visible to the agent through its own context.
    const context = (await (await fetch(`${baseUrl}/api/canvas/ax/context`)).json()) as Record<string, unknown>;
    expect(JSON.stringify(context)).toContain(inside.id);

    await postJson('/api/canvas/ax/policy', { scope: null, source: 'browser' }, { 'x-pmx-workbench': '1' });
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
