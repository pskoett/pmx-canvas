import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { HumanPresenceRegistry, humanPresence } from '../../src/server/human-presence.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { HUMAN_GRAB_TTL_MS, HUMAN_PRESENCE_TTL_MS } from '../../src/shared/human-presence.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// rail-chrome-v2 phase 8: human collaborator presence and the user-wins edit lock.

const T0 = 1_700_000_000_000;

describe('HumanPresenceRegistry', () => {
  let registry: HumanPresenceRegistry;
  let frames: string[];
  beforeEach(() => {
    registry = new HumanPresenceRegistry();
    frames = [];
    registry.setEmitter((event) => frames.push(event));
  });

  test('tabs report themselves; they fade after the TTL; an explicit leave drops them now', () => {
    registry.set({ clientId: 'tab-a', name: 'mia', cursor: { x: 10, y: 20 } }, T0);
    registry.set({ clientId: 'tab-b' }, T0);
    expect(registry.snapshot(T0).humans.map((h) => `${h.clientId}:${h.name}`)).toEqual(['tab-a:mia', 'tab-b:Human']);
    expect(registry.snapshot(T0 + HUMAN_PRESENCE_TTL_MS + 1).humans).toHaveLength(0);
    registry.set({ clientId: 'tab-c' }, T0);
    registry.set({ clientId: 'tab-c', left: true }, T0 + 1);
    expect(registry.snapshot(T0 + 1).humans).toHaveLength(0);
    expect(() => registry.set({ clientId: '' }, T0)).toThrow(/Invalid human presence/);
  });

  test('a grab locks the node for agents until released or stale', () => {
    registry.set({ clientId: 'tab-a', name: 'mia', grabbingNodeId: 'n1' }, T0);
    expect([...registry.lockedNodes(T0)]).toEqual([['n1', 'mia']]);
    expect(registry.lockedNodes(T0 + HUMAN_GRAB_TTL_MS + 1).size).toBe(0);
    registry.set({ clientId: 'tab-a', grabbingNodeId: 'n1' }, T0 + 5000); // renewed by the heartbeat
    expect(registry.lockedNodes(T0 + 5000 + HUMAN_GRAB_TTL_MS - 1).size).toBe(1);
    registry.set({ clientId: 'tab-a', grabbingNodeId: null }, T0 + 6000);
    expect(registry.lockedNodes(T0 + 6000).size).toBe(0);
  });
});

describe('human presence over HTTP', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-human-');
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
    humanPresence.reset();
    await post('/api/canvas/clear', {}, { 'x-pmx-workbench': '1' });
  });

  test('an agent write to a node a human is holding is refused with 409; the human and other nodes are fine', async () => {
    const held = (await (
      await post('/api/canvas/node', { type: 'markdown', title: 'Held', x: 10, y: 10 }, { 'x-pmx-workbench': '1' })
    ).json()) as { id: string };
    const free = (await (
      await post('/api/canvas/node', { type: 'markdown', title: 'Free', x: 500, y: 10 }, { 'x-pmx-workbench': '1' })
    ).json()) as { id: string };
    expect(
      (
        await post(
          '/api/canvas/human-presence',
          { clientId: 'tab-a', name: 'mia', grabbingNodeId: held.id },
          { 'x-pmx-workbench': '1' },
        )
      ).ok,
    ).toBe(true);

    const blocked = await fetch(`${baseUrl}/api/canvas/node/${held.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Agent edit' }),
    });
    expect(blocked.status).toBe(409);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/being edited by mia/);

    const other = await fetch(`${baseUrl}/api/canvas/node/${free.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Agent edit' }),
    });
    expect(other.ok).toBe(true);
    const human = await fetch(`${baseUrl}/api/canvas/node/${held.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ title: 'Human edit' }),
    });
    expect(human.ok).toBe(true);

    // Release → the agent may write again. Heartbeats never count as agent activity.
    await post('/api/canvas/human-presence', { clientId: 'tab-a', grabbingNodeId: null }, { 'x-pmx-workbench': '1' });
    const freed = await fetch(`${baseUrl}/api/canvas/node/${held.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Agent edit later' }),
    });
    expect(freed.ok).toBe(true);
    const snapshot = (await (await fetch(`${baseUrl}/api/canvas/human-presence`)).json()) as {
      humans: Array<{ clientId: string; name: string }>;
    };
    expect(snapshot.humans).toEqual([expect.objectContaining({ clientId: 'tab-a', name: 'mia' })]);
    const presence = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as {
      presences: Array<{ sessionId: string }>;
    };
    expect(presence.presences.map((p) => p.sessionId)).not.toContain('browser');
  });
});
