import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { agentPresence } from '../../src/server/agent-presence.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// rail-chrome-v2 phase 4, design item 4: the scope fence over its real
// transport — agent writes outside it are 403, the human is never fenced, and
// the fence itself is the human's to set.

let workspaceRoot = '';
let baseUrl = '';

const WORKBENCH = { 'x-pmx-workbench': '1' };

async function postJson(path: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function patchNode(id: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${baseUrl}/api/canvas/node/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function addNode(title: string, x: number, y: number): Promise<string> {
  const response = await postJson('/api/canvas/node', { type: 'markdown', title, x, y });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function errorOf(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error;
}

beforeAll(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-fence-api-');
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
  await postJson('/api/canvas/ax/policy', { scope: null, source: 'browser' }, WORKBENCH);
  await postJson('/api/canvas/clear', {});
  agentPresence.reset();
});

describe('scope fence over HTTP', () => {
  test('agent writes outside the fence are 403; the human and reads are never fenced', async () => {
    const inside = await addNode('In', 100, 100);
    const outside = await addNode('Out', 2000, 2000);
    const policy = await postJson(
      '/api/canvas/ax/policy',
      { scope: { nodeIds: [inside] }, source: 'browser' },
      WORKBENCH,
    );
    expect(policy.ok).toBe(true);

    const blocked = await patchNode(outside, { title: 'Agent edit' });
    expect(blocked.status).toBe(403);
    expect(await errorOf(blocked)).toMatch(/Outside the agent scope/);

    expect((await patchNode(inside, { title: 'Agent edit inside' })).ok).toBe(true);
    expect((await patchNode(outside, { title: 'Human edit' }, WORKBENCH)).ok).toBe(true);
    expect((await fetch(`${baseUrl}/api/canvas/node/${outside}`)).ok).toBe(true);

    // Batch inner ops are agent writes too — fenced.
    const batch = await postJson('/api/canvas/batch', {
      operations: [{ op: 'node.update', args: { id: outside, title: 'via batch' } }],
    });
    expect(JSON.stringify(await batch.json())).toMatch(/Outside the agent scope/);

    // The fence is visible to the agent through its own context.
    const context = await (await fetch(`${baseUrl}/api/canvas/ax/context`)).json();
    expect(JSON.stringify(context)).toContain(inside);
  });

  test('new nodes and group membership are fenced', async () => {
    const inside = await addNode('In', 100, 100);
    const outside = await addNode('Out', 2000, 2000);
    await postJson('/api/canvas/ax/policy', { scope: { nodeIds: [inside], padding: 40 } }, WORKBENCH);

    const far = await postJson('/api/canvas/node', { type: 'markdown', title: 'Far', x: 3000, y: 3000 });
    expect(far.status).toBe(403);
    expect(await errorOf(far)).toMatch(/position \(3000, 3000\) is outside/);

    const unplaced = await postJson('/api/canvas/node', { type: 'markdown', title: 'Unplaced' });
    expect(unplaced.status).toBe(403);

    const group = await postJson('/api/canvas/node', {
      type: 'group',
      title: 'G',
      x: 110,
      y: 110,
      children: [outside],
    });
    expect(group.status).toBe(403);
    expect(await errorOf(group)).toMatch(new RegExp(`node "${outside}" is outside`));

    const reparent = await patchNode(inside, { children: [outside] });
    expect(reparent.status).toBe(403);
  });

  test('the fence belongs to the human: an agent cannot set, widen, or clear it', async () => {
    const inside = await addNode('In', 100, 100);
    const outside = await addNode('Out', 2000, 2000);

    const agentSet = await postJson('/api/canvas/ax/policy', { scope: { nodeIds: [inside, outside] } });
    expect(agentSet.status).toBe(403);
    expect(await errorOf(agentSet)).toMatch(/set and cleared by the human/);

    await postJson('/api/canvas/ax/policy', { scope: { nodeIds: [inside] } }, WORKBENCH);
    const agentClear = await postJson('/api/canvas/ax/policy', { scope: null });
    expect(agentClear.status).toBe(403);

    // Still fenced after the refused clear; tools-only patches are still the agent's to make.
    expect((await patchNode(outside, { title: 'x' })).status).toBe(403);
    const toolsOnly = await postJson('/api/canvas/ax/policy', { tools: { excluded: ['shell'] } });
    expect(toolsOnly.ok).toBe(true);
    const policy = (await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json()) as {
      policy: { scope: { nodeIds: string[] } | null; tools: { excluded: string[] } };
    };
    expect(policy.policy.scope?.nodeIds).toEqual([inside]);
    expect(policy.policy.tools.excluded).toEqual(['shell']);

    // The human clears it and the board is open again.
    expect((await postJson('/api/canvas/ax/policy', { scope: null }, WORKBENCH)).ok).toBe(true);
    expect((await patchNode(outside, { title: 'x' })).ok).toBe(true);
  });
});
