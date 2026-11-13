import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { intentRegistry } from '../../src/server/intent-registry.ts';
import {
  readSseEvent,
  resetServerApiState,
  startServerApiSuite,
  stopServerApiSuite,
  type CanvasStateResponse,
  type ServerApiSuite,
} from './server-api-harness.ts';

describe('canvas server HTTP API: AX', () => {
  let suite: ServerApiSuite | null = null;
  let baseUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return (await response.json()) as T;
  }

  beforeAll(() => {
    suite = startServerApiSuite('pmx-canvas-api-ax-');
    ({ baseUrl } = suite);
  });

  afterAll(() => {
    if (suite) stopServerApiSuite(suite);
  });

  beforeEach(resetServerApiState);

  test('ghost veto metadata blocks linked mutation and live intents replay on connect', async () => {
    const signalled = await jsonRequest<{ intent: { id: string } }>('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'http-veto',
        kind: 'create',
        position: { x: 120, y: 160 },
      }),
    });
    expect(signalled.intent.id).toBe('http-veto');

    const replay = await readSseEvent(baseUrl, 'ax-intent');
    expect(replay.intent).toMatchObject({ id: 'http-veto', kind: 'create' });

    const vetoed = await jsonRequest<{ cleared: boolean }>('/api/canvas/ax/intent/http-veto', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vetoed: true }),
    });
    expect(vetoed.cleared).toBe(true);

    const blocked = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: 'http-veto',
        type: 'markdown',
        title: 'Must not be created',
      }),
    });
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ ok: false, error: 'Intent "http-veto" was vetoed.' });
    expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'Must not be created')).toBe(false);

    // Veto via the ?vetoed=true query form (coerced to boolean; body-less DELETE).
    await jsonRequest('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'http-veto-query',
        kind: 'create',
        position: { x: 160, y: 160 },
      }),
    });
    const vetoedByQuery = await jsonRequest<{ cleared: boolean }>('/api/canvas/ax/intent/http-veto-query?vetoed=true', {
      method: 'DELETE',
    });
    expect(vetoedByQuery.cleared).toBe(true);
    const blockedByQuery = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: 'http-veto-query',
        type: 'markdown',
        title: 'Query veto must also block',
      }),
    });
    expect(blockedByQuery.status).toBe(409);

    // A non-literal query value still fails validation loudly (no silent false).
    await jsonRequest('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'http-veto-junk',
        kind: 'create',
        position: { x: 200, y: 160 },
      }),
    });
    const junkVeto = await fetch(`${baseUrl}/api/canvas/ax/intent/http-veto-junk?vetoed=banana`, {
      method: 'DELETE',
    });
    expect(junkVeto.status).toBe(400);
    await jsonRequest('/api/canvas/ax/intent/http-veto-junk', { method: 'DELETE' });

    await jsonRequest('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'http-commit',
        kind: 'create',
        position: { x: 240, y: 200 },
      }),
    });
    const committed = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: 'http-commit',
        type: 'markdown',
        title: 'Committed node',
        x: 240,
        y: 200,
      }),
    });
    expect(canvasState.getNode(committed.id)?.data.title).toBe('Committed node');
    expect(intentRegistry.list().some((intent) => intent.id === 'http-commit')).toBe(false);

    // A create intent may omit its position: the ghost forms where the node
    // will actually land, staged ghosts do not stack, and the linked create
    // lands on its own ghost (not world 0,0 or wherever the agent guessed).
    const occupied = canvasState.getLayout().nodes.map((node) => ({ ...node.position, ...node.size }));
    const placedA = await jsonRequest<{ intent: { position: { x: number; y: number } } }>('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'auto-place-a', kind: 'create', nodeType: 'markdown' }),
    });
    const placedB = await jsonRequest<{ intent: { position: { x: number; y: number } } }>('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'auto-place-b', kind: 'create', nodeType: 'markdown' }),
    });
    const a = placedA.intent.position;
    const b = placedB.intent.position;
    expect(a).toBeDefined();
    expect(b).not.toEqual(a);
    for (const rect of occupied) {
      const overlaps =
        a.x < rect.x + rect.width && a.x + 640 > rect.x && a.y < rect.y + rect.height && a.y + 420 > rect.y;
      expect(overlaps).toBe(false);
    }
    const landed = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intentId: 'auto-place-a', type: 'markdown', title: 'Lands on its ghost' }),
    });
    expect(canvasState.getNode(landed.id)?.position).toEqual(a);
    await jsonRequest('/api/canvas/ax/intent/auto-place-b', { method: 'DELETE' });

    const blankIntent = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: ' ',
        type: 'markdown',
        title: 'Blank intent must not bypass gating',
      }),
    });
    expect(blankIntent.status).toBe(400);
    expect(
      canvasState.getLayout().nodes.some((node) => node.data.title === 'Blank intent must not bypass gating'),
    ).toBe(false);

    const streamed = await jsonRequest<{ id: string }>('/api/canvas/json-render/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Existing stream',
        patches: [],
      }),
    });
    await jsonRequest('/api/canvas/ax/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'wrong-stream-kind',
        kind: 'create',
        position: { x: 0, y: 0 },
      }),
    });
    const wrongStreamKind = await fetch(`${baseUrl}/api/canvas/json-render/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId: 'wrong-stream-kind',
        nodeId: streamed.id,
        patches: [],
      }),
    });
    expect(wrongStreamKind.status).toBe(409);
    expect(intentRegistry.list().some((intent) => intent.id === 'wrong-stream-kind')).toBe(true);
  });

  test('agent mutations without an intent synthesize an auto-ghost; workbench + batch calls do not', async () => {
    const seqOf = async () =>
      ((await fetch(`${baseUrl}/api/workbench/poll`).then((r) => r.json())) as { seq: number }).seq;
    const eventsSince = async (seq: number) =>
      (
        (await fetch(`${baseUrl}/api/workbench/poll?since=${seq}`).then((r) => r.json())) as {
          events: Array<{ event: string; payload: Record<string, unknown> }>;
        }
      ).events;

    // Agent-originated create (no workbench marker): ax-intent signal with
    // auto:true, then the settle clear referencing the created node.
    let seq = await seqOf();
    const created = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Ghosted note', content: 'auto', x: 40, y: 40 }),
    }).then((r) => r.json())) as { id: string };
    let events = await eventsSince(seq);
    const signal = events.find((e) => e.event === 'ax-intent');
    const clear = events.find((e) => e.event === 'ax-intent-clear');
    expect((signal?.payload.intent as Record<string, unknown> | undefined)?.auto).toBe(true);
    expect((signal?.payload.intent as Record<string, unknown> | undefined)?.label).toContain('Ghosted note');
    expect(clear?.payload.settled).toBe(true);
    expect(clear?.payload.nodeId).toBe(created.id);

    // Workbench-marked call (human action in the browser): no ghost.
    seq = await seqOf();
    await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PMX-Workbench': '1' },
      body: JSON.stringify({ type: 'markdown', title: 'Human note', content: 'no ghost', x: 40, y: 240 }),
    });
    events = await eventsSince(seq);
    expect(events.some((e) => e.event === 'ax-intent')).toBe(false);

    // Batch churn: exempt (matches the skill's ghost-cursor batch exemption).
    seq = await seqOf();
    await fetch(`${baseUrl}/api/canvas/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'node.add', type: 'markdown', title: 'Batch note', x: 40, y: 440 }] }),
    });
    events = await eventsSince(seq);
    expect(events.some((e) => e.event === 'ax-intent')).toBe(false);

    // Kill switch.
    process.env.PMX_CANVAS_AUTO_INTENT = '0';
    try {
      seq = await seqOf();
      await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'markdown', title: 'Silent note', content: 'off', x: 40, y: 640 }),
      });
      events = await eventsSince(seq);
      expect(events.some((e) => e.event === 'ax-intent')).toBe(false);
    } finally {
      delete process.env.PMX_CANVAS_AUTO_INTENT;
    }
  });

  test('delivery mark is compare-and-set and steering accepts the amp source', async () => {
    const steer = (await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'CAS mark probe', source: 'amp' }),
    }).then((r) => r.json())) as { steering: { id: string; source: string } };
    expect(steer.steering.source).toBe('amp');

    const first = (await fetch(`${baseUrl}/api/canvas/ax/delivery/${steer.steering.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then((r) => r.json())) as { delivered: boolean };
    expect(first.delivered).toBe(true);

    // Re-mark (or a raced second consumer): NOT the transition — false.
    const second = (await fetch(`${baseUrl}/api/canvas/ax/delivery/${steer.steering.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }).then((r) => r.json())) as { delivered: boolean };
    expect(second.delivered).toBe(false);
  });

  test('a quietly expired ghost does not block its mutation nor poison a batch; vetoes still do', async () => {
    // Expired (never vetoed): the linked create proceeds unlinked.
    const ghost = (await (
      await fetch(`${baseUrl}/api/canvas/ax/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'create', label: 'Slow spawn', ttlMs: 60, position: { x: 100, y: 100 } }),
      })
    ).json()) as { intent: { id: string } };
    const expiredId = ghost.intent.id;
    expect(typeof expiredId).toBe('string');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const batch = (await (
      await fetch(`${baseUrl}/api/canvas/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operations: [
            {
              op: 'node.add',
              args: { type: 'markdown', title: 'Ghosted create', intentId: expiredId, x: 120, y: 120 },
            },
            { op: 'node.add', args: { type: 'markdown', title: 'Sibling create', x: 620, y: 120 } },
          ],
        }),
      })
    ).json()) as { ok: boolean; results: Array<{ id?: string }> };
    expect(batch.ok).toBe(true);
    expect(batch.results).toHaveLength(2);

    // Vetoed: still refused — the human said no.
    const vetoSignal = (await (
      await fetch(`${baseUrl}/api/canvas/ax/intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'create', label: 'Vetoed spawn', ttlMs: 30000, position: { x: 100, y: 400 } }),
      })
    ).json()) as { intent: { id: string } };
    const vetoId = vetoSignal.intent.id;
    const veto = await fetch(`${baseUrl}/api/canvas/ax/intent/${vetoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vetoed: true }),
    });
    expect(veto.status).toBe(200);
    const blocked = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Should not land', intentId: vetoId, x: 100, y: 400 }),
    });
    expect(blocked.status).toBe(409);
    for (const created of batch.results) {
      if (created.id)
        await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
          method: 'DELETE',
          headers: { 'x-pmx-workbench': '1' },
        });
    }
  });

  test('an AX work-item write never becomes the cursor focus — only real nodes do', async () => {
    const made = (await (
      await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'focus-probe' },
        body: JSON.stringify({ type: 'markdown', title: 'Focus anchor', content: 'x', x: 40, y: 40 }),
      })
    ).json()) as { id: string };
    const work = (await (
      await fetch(`${baseUrl}/api/canvas/ax/work`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'focus-probe' },
        body: JSON.stringify({ title: 'Probe item', status: 'in-progress' }),
      })
    ).json()) as { workItem: { id: string } };
    const snap = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as {
      presences: Array<{ sessionId: string; focusNodeId: string | null }>;
    };
    const probe = snap.presences.find((p) => p.sessionId === 'focus-probe');
    // The node create parked focus on the node; the work-item write must NOT
    // replace it with a work-item id (review #9 — the cursor aimed at nothing).
    expect(probe?.focusNodeId).toBe(made.id);
    expect(probe?.focusNodeId?.startsWith('work-')).toBe(false);
    expect(work.workItem.id.startsWith('work-')).toBe(true);
    await fetch(`${baseUrl}/api/canvas/node/${made.id}`, { method: 'DELETE', headers: { 'x-pmx-workbench': '1' } });
  });

  test('per-agent territories: a worker is fenced to its lane, others roam, and no agent fences itself', async () => {
    const mk = async (title: string, x: number, y: number) =>
      (await (
        await fetch(`${baseUrl}/api/canvas/node`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
          body: JSON.stringify({ type: 'markdown', title, content: 'x', x, y, width: 300, height: 160 }),
        })
      ).json()) as { id: string };
    const lane = await mk('Worker lane', 100, 100);
    const outside = await mk('Elsewhere', 4000, 4000);

    // The orchestrator (a DIFFERENT writer) fences worker run1:impl to its lane.
    const set = await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'copilot' },
      body: JSON.stringify({ agentScopes: { 'run1:impl': { nodeIds: [lane.id], padding: 80 } } }),
    });
    expect(set.status).toBe(200);

    // The worker may write inside its territory…
    const inside = await fetch(`${baseUrl}/api/canvas/node/${lane.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Worker lane (updated)', agentId: 'run1:impl' }),
    });
    expect(inside.status).toBe(200);

    // …but not outside it.
    const refused = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Grabbed', agentId: 'run1:impl' }),
    });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: string }).error).toContain('territory');

    // A writer WITHOUT a territory is untouched (no global fence set).
    const roam = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'claude-code' },
      body: JSON.stringify({ title: 'Roamed' }),
    });
    expect(roam.status).toBe(200);

    // No agent sets its OWN territory — that is escalation.
    const selfFence = await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'copilot' },
      body: JSON.stringify({ agentScopes: { copilot: null } }),
    });
    expect(selfFence.status).toBe(403);

    // The human clears the worker's territory; the worker roams again.
    const clear = await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ agentScopes: { 'run1:impl': null } }),
    });
    expect(clear.status).toBe(200);
    const freed = await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Freed', agentId: 'run1:impl' }),
    });
    expect(freed.status).toBe(200);
    await fetch(`${baseUrl}/api/canvas/node/${lane.id}`, { method: 'DELETE', headers: { 'x-pmx-workbench': '1' } });
    await fetch(`${baseUrl}/api/canvas/node/${outside.id}`, { method: 'DELETE', headers: { 'x-pmx-workbench': '1' } });
  });

  test('delivery marks are quiet plumbing: attributed to the consumer, no activity row, no anonymous mcp writer', async () => {
    const steer = (await (
      await fetch(`${baseUrl}/api/canvas/ax/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'quiet-mark probe', source: 'browser' }),
      })
    ).json()) as { steering: { id: string } };
    const before = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as {
      presences: Array<{ sessionId: string }>;
      activity?: Array<{ op: string }>;
    };
    const mark = await fetch(`${baseUrl}/api/canvas/ax/delivery/${steer.steering.id}/mark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ consumer: 'quietbot' }),
    });
    expect(mark.status).toBe(200);
    const snap = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as {
      presences: Array<{ sessionId: string }>;
      activity?: Array<{ op: string; sessionId?: string }>;
    };
    // The mark books the CONSUMER as the writer — never an anonymous transport.
    expect(snap.presences.some((p) => p.sessionId === 'quietbot')).toBe(true);
    const hadMcpBefore = before.presences.some((p) => p.sessionId === 'mcp');
    if (!hadMcpBefore) expect(snap.presences.some((p) => p.sessionId === 'mcp')).toBe(false);
    // …and adds NO activity row (the Steer row flipping to delivered is the signal).
    expect((snap.activity ?? []).some((entry) => entry.op === 'ax.delivery.mark')).toBe(false);
  });

  test('broadcast steering is delivered PER consumer — one worker marking it leaves it pending for the rest', async () => {
    const steer = (await (
      await fetch(`${baseUrl}/api/canvas/ax/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'all workers: stop', source: 'browser' }),
      })
    ).json()) as { steering: { id: string } };
    const id = steer.steering.id;
    const pendingFor = async (consumer: string) =>
      (
        (await (await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=${consumer}&limit=50`)).json()) as {
          pending: Array<{ id: string }>;
        }
      ).pending.some((entry) => entry.id === id);

    expect(await pendingFor('worker-a')).toBe(true);
    expect(await pendingFor('worker-b')).toBe(true);

    // worker-a marks it — per-consumer CAS: true once, false on re-mark.
    const mark = async (consumer: string) =>
      (
        (await (
          await fetch(`${baseUrl}/api/canvas/ax/delivery/${id}/mark`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ consumer }),
          })
        ).json()) as { delivered: boolean }
      ).delivered;
    expect(await mark('worker-a')).toBe(true);
    expect(await mark('worker-a')).toBe(false);

    // Still pending for worker-b — the whole fleet receives a broadcast.
    expect(await pendingFor('worker-a')).toBe(false);
    expect(await pendingFor('worker-b')).toBe(true);
    expect(await mark('worker-b')).toBe(true);
    expect(await pendingFor('worker-b')).toBe(false);

    // The timeline shows the pickup list and reads delivered once anyone has it.
    const timeline = (await (await fetch(`${baseUrl}/api/canvas/ax/timeline?limit=10`)).json()) as {
      steering: Array<{ id: string; delivered: boolean; deliveredTo?: string[] }>;
    };
    const row = timeline.steering.find((entry) => entry.id === id);
    expect(row?.delivered).toBe(true);
    expect(row?.deliveredTo?.sort()).toEqual(['worker-a', 'worker-b']);
  });

  test('delivery long-poll: ?waitMs parks until steering for the consumer arrives, then returns it', async () => {
    // The reactive loop for hosts that cannot be woken from outside (Copilot,
    // Codex): one blocked call instead of tight polling. Broadcasts are now
    // per-consumer, so drain this consumer's inbox first (what a real agent
    // loop does) so the wait path actually parks.
    const backlog = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=longpoll-agent&limit=50`)
    ).json()) as { pending: Array<{ id: string }> };
    for (const entry of backlog.pending) {
      await fetch(`${baseUrl}/api/canvas/ax/delivery/${entry.id}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumer: 'longpoll-agent' }),
      });
    }
    const t0 = Date.now();
    const waiting = fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=longpoll-agent&waitMs=8000`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'wake up and fix it', source: 'browser', target: 'longpoll-agent' }),
    });
    const res = await waiting;
    const elapsed = Date.now() - t0;
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pending: Array<{ message: string }> };
    expect(body.pending.some((entry) => entry.message === 'wake up and fix it')).toBe(true);
    // Woke on arrival, not on the 8s timeout — and only after the steer landed.
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(5000);

    // Timeout path: no steering for this consumer → empty after ~the wait.
    // (Drain first — per-consumer broadcasts from earlier tests are pending
    // for every fresh consumer label.)
    const backlog2 = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=longpoll-agent-2&limit=50`)
    ).json()) as { pending: Array<{ id: string }> };
    for (const entry of backlog2.pending) {
      await fetch(`${baseUrl}/api/canvas/ax/delivery/${entry.id}/mark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consumer: 'longpoll-agent-2' }),
      });
    }
    const t1 = Date.now();
    const idle = await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=longpoll-agent-2&waitMs=400`);
    const idleBody = (await idle.json()) as { pending: unknown[] };
    expect(idleBody.pending).toHaveLength(0);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(350);
  });

  test('ax interaction creates a work item from an eligible node', async () => {
    canvasState.addNode({
      id: 'ax-status',
      type: 'status',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: 'Build' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ax.work.create',
        sourceNodeId: 'ax-status',
        payload: { title: 'Ship it' },
        source: 'cli',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; primitive?: { title: string; nodeIds: string[] } };
    expect(json.ok).toBe(true);
    expect(json.primitive?.title).toBe('Ship it');
    expect(json.primitive?.nodeIds).toEqual(['ax-status']);
    expect(canvasState.getAxState().workItems.some((w) => w.title === 'Ship it')).toBe(true);
  });

  test('ax interaction rejects a disallowed interaction type', async () => {
    canvasState.addNode({
      id: 'ax-file',
      type: 'file',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { path: '/tmp/x.ts' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.steer', sourceNodeId: 'ax-file', payload: { message: 'go' } }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()) as Record<string, unknown>).toMatchObject({ ok: false, code: 'not-allowed' });
  });

  test('ax interaction respects per-node opt-in for html nodes', async () => {
    canvasState.addNode({
      id: 'ax-html-off',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { html: '<main>x</main>' },
    });
    const off = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-html-off', payload: { title: 'x' } }),
    });
    expect(off.status).toBe(403);
    expect(((await off.json()) as { code: string }).code).toBe('ax-disabled');

    canvasState.addNode({
      id: 'ax-html-on',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { html: '<main>x</main>', axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
    });
    const on = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-html-on', payload: { title: 'opted in' } }),
    });
    expect(on.status).toBe(200);
    expect(((await on.json()) as { ok: boolean }).ok).toBe(true);
  });

  test('ax interaction rejects unknown node and invalid payload', async () => {
    const unknown = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'nope', payload: { title: 'x' } }),
    });
    expect(unknown.status).toBe(404);
    canvasState.addNode({
      id: 'ax-status-2',
      type: 'status',
      position: { x: 0, y: 0 },
      size: { width: 300, height: 200 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {},
    });
    const bad = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-status-2', payload: {} }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('invalid-payload');
  });

  test('ax delivery: pending query, loop prevention, and mark', async () => {
    const steer = await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'focus on the failing test', source: 'copilot' }),
    });
    const steering = ((await steer.json()) as { steering: { id: string } }).steering;

    const seenByMcp = async () => {
      const r = await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=mcp`);
      const body = (await r.json()) as { pending: Array<{ id: string }> };
      return body.pending.some((s) => s.id === steering.id);
    };

    // Visible to a different consumer...
    expect(await seenByMcp()).toBe(true);
    // ...but excluded for the originating consumer (loop prevention).
    const copilotPending = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot`)
    ).json()) as { pending: Array<{ id: string }> };
    expect(copilotPending.pending.some((s) => s.id === steering.id)).toBe(false);

    // Mark delivered, then it drops out of pending.
    const mark = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/${encodeURIComponent(steering.id)}/mark`, { method: 'POST' })
    ).json()) as { ok: boolean; delivered: boolean };
    expect(mark.delivered).toBe(true);
    expect(await seenByMcp()).toBe(false);
  });

  test('ax elicitation: request, list, respond lifecycle', async () => {
    const req = (await (
      await fetch(`${baseUrl}/api/canvas/ax/elicitation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: 'Who owns this?', fields: ['owner'], source: 'cli' }),
      })
    ).json()) as { ok: boolean; elicitation: { id: string; status: string } };
    expect(req.ok).toBe(true);
    expect(req.elicitation.status).toBe('pending');

    const list = (await (await fetch(`${baseUrl}/api/canvas/ax/elicitation`)).json()) as {
      elicitations: Array<{ id: string }>;
    };
    expect(list.elicitations.some((e) => e.id === req.elicitation.id)).toBe(true);

    const respond = (await (
      await fetch(`${baseUrl}/api/canvas/ax/elicitation/${encodeURIComponent(req.elicitation.id)}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: { owner: 'alice' } }),
      })
    ).json()) as { ok: boolean; elicitation: { status: string; response: Record<string, unknown> } };
    expect(respond.elicitation.status).toBe('answered');
    expect(respond.elicitation.response).toEqual({ owner: 'alice' });

    // answered → snapshotted in ax state
    const ax = (await (await fetch(`${baseUrl}/api/canvas/ax`)).json()) as {
      state: { elicitations: Array<{ id: string; status: string }> };
    };
    expect(ax.state.elicitations.find((e) => e.id === req.elicitation.id)?.status).toBe('answered');
  });

  test('ax mode: request and resolve lifecycle', async () => {
    const req = (await (
      await fetch(`${baseUrl}/api/canvas/ax/mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'execute', reason: 'plan approved', source: 'cli' }),
      })
    ).json()) as { ok: boolean; modeRequest: { id: string; mode: string; status: string } };
    expect(req.modeRequest.mode).toBe('execute');
    expect(req.modeRequest.status).toBe('pending');

    const bad = await fetch(`${baseUrl}/api/canvas/ax/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'turbo' }),
    });
    expect(bad.status).toBe(400);

    const resolve = (await (
      await fetch(`${baseUrl}/api/canvas/ax/mode/${encodeURIComponent(req.modeRequest.id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', resolution: 'go' }),
      })
    ).json()) as { ok: boolean; modeRequest: { status: string; resolution: string } };
    expect(resolve.modeRequest.status).toBe('approved');
    expect(resolve.modeRequest.resolution).toBe('go');
  });

  test('ax command: registry list + registry-gated invoke', async () => {
    const list = (await (await fetch(`${baseUrl}/api/canvas/ax/command`)).json()) as {
      commands: Array<{ name: string }>;
    };
    expect(list.commands.some((c) => c.name === 'pmx.plan')).toBe(true);

    const ok = await fetch(`${baseUrl}/api/canvas/ax/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pmx.plan', args: { note: 'x' }, source: 'cli' }),
    });
    expect(ok.status).toBe(200);
    const okBody = (await ok.json()) as { ok: boolean; event: { kind: string; data: { command: string } } };
    expect(okBody.event.kind).toBe('command');
    expect(okBody.event.data.command).toBe('pmx.plan');

    const bad = await fetch(`${baseUrl}/api/canvas/ax/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'definitely-not-a-command' }),
    });
    expect(bad.status).toBe(400);
  });

  test('ax policy: defaults empty, merges on set, exposed in context', async () => {
    const initial = (await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json()) as {
      policy: { tools: { excluded: string[] } };
    };
    expect(initial.policy.tools.excluded).toEqual([]);

    await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: { excluded: ['shell', 'write'] }, prompt: { mode: 'concise' }, source: 'cli' }),
    });
    const set = (await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json()) as {
      policy: { tools: { excluded: string[] }; prompt: { mode: string } };
    };
    expect(set.policy.tools.excluded).toEqual(['shell', 'write']);
    expect(set.policy.prompt.mode).toBe('concise');

    // merge: setting prompt does not wipe tools
    await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: { systemAppend: 'be terse' } }),
    });
    const merged = (await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json()) as {
      policy: { tools: { excluded: string[] }; prompt: { mode: string; systemAppend: string } };
    };
    expect(merged.policy.tools.excluded).toEqual(['shell', 'write']);
    expect(merged.policy.prompt.systemAppend).toBe('be terse');

    const ctx = (await (await fetch(`${baseUrl}/api/canvas/ax/context`)).json()) as {
      policy?: { tools: { excluded: string[] } };
    };
    expect(ctx.policy?.tools.excluded).toEqual(['shell', 'write']);
  });

  test('AX context combines pinned context and server-authoritative focus', async () => {
    const pinnedNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Pinned AX note', content: 'Pinned context body' }),
    });
    const focusedNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Focused AX note', content: 'Focused context body' }),
    });

    await jsonRequest('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [pinnedNode.id] }),
    });

    const focus = await jsonRequest<{
      ok: boolean;
      focus: { nodeIds: string[]; primaryNodeId: string | null; source: string | null };
    }>('/api/canvas/ax/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [focusedNode.id, 'missing-node'], source: 'api' }),
    });
    expect(focus.focus).toMatchObject({
      nodeIds: [focusedNode.id],
      primaryNodeId: focusedNode.id,
      source: 'api',
    });

    const context = await jsonRequest<{
      pinned: { nodeIds: string[]; preamble: string };
      focus: { nodeIds: string[]; nodes: Array<{ id: string; content: string | null }> };
    }>('/api/canvas/ax/context');
    expect(context.pinned.nodeIds).toEqual([pinnedNode.id]);
    expect(context.pinned.preamble).toContain('Pinned context body');
    expect(context.focus.nodeIds).toEqual([focusedNode.id]);
    expect(context.focus.nodes[0]?.content).toContain('Focused context body');
  });

  test('AX timeline endpoints round-trip events, steering, and evidence', async () => {
    const event = await jsonRequest<{ ok: boolean; event: { id: string; kind: string } }>('/api/canvas/ax/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool-start', summary: 'ran tests', source: 'api' }),
    });
    expect(event.event.kind).toBe('tool-start');

    const steering = await jsonRequest<{ ok: boolean; steering: { id: string; message: string } }>(
      '/api/canvas/ax/steer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'focus on the failing test', source: 'api' }),
      },
    );
    expect(steering.steering.message).toBe('focus on the failing test');

    const evidence = await jsonRequest<{ ok: boolean; evidence: { id: string; kind: string } }>(
      '/api/canvas/ax/evidence',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'test-output', title: 'unit pass', source: 'api' }),
      },
    );
    expect(evidence.evidence.kind).toBe('test-output');

    const timeline = await jsonRequest<{
      ok: boolean;
      events: Array<{ id: string }>;
      evidence: Array<{ id: string }>;
      steering: Array<{ id: string }>;
    }>('/api/canvas/ax/timeline');
    expect(timeline.events.map((e) => e.id)).toContain(event.event.id);
    expect(timeline.evidence.map((e) => e.id)).toContain(evidence.evidence.id);
    expect(timeline.steering.map((s) => s.id)).toContain(steering.steering.id);
  });

  test('AX event endpoint rejects an invalid kind with a 400', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/ax/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'not-a-real-kind', summary: 'nope' }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test('AX work item and approval gate endpoints round-trip over HTTP', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'AX work node' }),
    });

    const created = await jsonRequest<{ ok: boolean; workItem: { id: string; status: string } }>(
      '/api/canvas/ax/work',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Implement auth', status: 'todo', nodeIds: [node.id], source: 'api' }),
      },
    );
    expect(created.workItem.status).toBe('todo');

    const updated = await jsonRequest<{ ok: boolean; workItem: { status: string } }>(
      `/api/canvas/ax/work/${created.workItem.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', source: 'api' }),
      },
    );
    expect(updated.workItem.status).toBe('done');

    const missing = await fetch(`${baseUrl}/api/canvas/ax/work/does-not-exist`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    expect(missing.status).toBe(404);

    const gate = await jsonRequest<{ ok: boolean; approvalGate: { id: string; status: string } }>(
      '/api/canvas/ax/approval',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Deploy to prod', action: 'deploy.prod', source: 'api' }),
      },
    );
    expect(gate.approvalGate.status).toBe('pending');

    const resolved = await jsonRequest<{ ok: boolean; approvalGate: { status: string } }>(
      `/api/canvas/ax/approval/${gate.approvalGate.id}/resolve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approved', source: 'api' }),
      },
    );
    expect(resolved.approvalGate.status).toBe('approved');

    const reResolve = await fetch(`${baseUrl}/api/canvas/ax/approval/${gate.approvalGate.id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'rejected' }),
    });
    expect(reResolve.status).toBe(404);
  });

  test('AX work item agentId round-trips and mirrors status onto linked node data', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'AX agentId node' }),
    });

    const created = await jsonRequest<{ workItem: { id: string; status: string; agentId: string | null } }>(
      '/api/canvas/ax/work',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Implement auth',
          status: 'todo',
          nodeIds: [node.id],
          agentId: 'researcher',
          source: 'api',
        }),
      },
    );
    expect(created.workItem.agentId).toBe('researcher');

    const stateAfterCreate = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(stateAfterCreate.nodes.find((n) => n.id === node.id)?.data.axWorkStatus).toBe('todo');

    const updated = await jsonRequest<{ workItem: { status: string } }>(`/api/canvas/ax/work/${created.workItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done', source: 'api' }),
    });
    expect(updated.workItem.status).toBe('done');

    const stateAfterUpdate = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(stateAfterUpdate.nodes.find((n) => n.id === node.id)?.data.axWorkStatus).toBe('done');

    // One undo reverts the status and its chip together.
    await jsonRequest('/api/canvas/undo', { method: 'POST', headers: { 'x-pmx-workbench': '1' } });
    const stateAfterUndo = await jsonRequest<CanvasStateResponse & { ax?: unknown }>('/api/canvas/state');
    expect(stateAfterUndo.nodes.find((n) => n.id === node.id)?.data.axWorkStatus).toBe('todo');
    expect(canvasState.getWorkItems().find((w) => w.id === created.workItem.id)?.status).toBe('todo');

    // An ingested failure's blocked work item lights its node's chip too.
    const failing = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Failing step' }),
    });
    await jsonRequest('/api/canvas/ax/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'failure', title: 'Build failed', nodeIds: [failing.id] }),
    });
    expect(canvasState.getNode(failing.id)?.data.axWorkStatus).toBe('blocked');
  });

  test('workboard endpoint creates a live board node that auto-refreshes on work-item changes', async () => {
    interface WorkboardResponse {
      ok: boolean;
      id: string;
      created: boolean;
      itemCount: number;
    }
    const specOf = async (nodeId: string): Promise<string> => {
      const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
      const node = state.nodes.find((n) => n.id === nodeId);
      expect(node).toBeDefined();
      expect(node?.data.workboard).toBe(true);
      return JSON.stringify(node?.data.spec ?? {});
    };

    // (a) No work items → creates the board with itemCount 0 and an empty-state spec.
    const first = await jsonRequest<WorkboardResponse>('/api/canvas/workboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(first.ok).toBe(true);
    expect(first.created).toBe(true);
    expect(first.itemCount).toBe(0);
    expect(await specOf(first.id)).toContain('No work items');

    // (b) Two work items (one with agentId) → second call rebuilds the SAME node.
    await jsonRequest('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Board item one', status: 'todo', agentId: 'researcher', source: 'api' }),
    });
    await jsonRequest('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Board item two', status: 'in-progress', source: 'api' }),
    });
    const second = await jsonRequest<WorkboardResponse>('/api/canvas/workboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(second.itemCount).toBe(2);
    const boardState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(boardState.nodes.filter((n) => n.data.workboard === true)).toHaveLength(1);
    const rebuiltSpec = await specOf(first.id);
    expect(rebuiltSpec).toContain('Board item one');
    expect(rebuiltSpec).toContain('Board item two');
    expect(rebuiltSpec).toContain('researcher');

    // (c) A third work item added over the AX API auto-refreshes the board
    // WITHOUT calling the workboard endpoint again.
    const third = await jsonRequest<{ workItem: { id: string } }>('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Board item three', status: 'todo', source: 'api' }),
    });
    expect(await specOf(first.id)).toContain('Board item three');

    // (d) A work-item status update is reflected in the board spec.
    await jsonRequest(`/api/canvas/ax/work/${third.workItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'blocked', source: 'api' }),
    });
    expect(await specOf(first.id)).toContain('Blocked (1)');

    await jsonRequest(`/api/canvas/node/${first.id}`, { method: 'DELETE' });
  });

  test('AX record-event accepts agentId and the timeline read returns it', async () => {
    const event = await jsonRequest<{ event: { id: string; agentId: string | null } }>('/api/canvas/ax/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'tool-start', summary: 'agentId probe', agentId: 'researcher', source: 'api' }),
    });
    expect(event.event.agentId).toBe('researcher');

    const timeline = await jsonRequest<{ events: Array<{ id: string; agentId: string | null }> }>(
      '/api/canvas/ax/timeline',
    );
    expect(timeline.events.find((e) => e.id === event.event.id)?.agentId).toBe('researcher');
  });

  test('AX steering target scopes delivery to the addressed consumer; a broadcast steer reaches everyone', async () => {
    const tag = `target-${Date.now()}`;
    const targeted = await jsonRequest<{ steering: { agentId: string | null; target: string | null } }>(
      '/api/canvas/ax/steer',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: tag, agentId: 'researcher', target: 'impl-auth', source: 'api' }),
      },
    );
    expect(targeted.steering.agentId).toBe('researcher');
    expect(targeted.steering.target).toBe('impl-auth');

    const broadcastTag = `${tag}-broadcast`;
    await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: broadcastTag, source: 'api' }),
    });

    type Pending = { pending: Array<{ message: string }> };
    const forTarget = await jsonRequest<Pending>('/api/canvas/ax/delivery/pending?consumer=impl-auth&limit=200');
    expect(forTarget.pending.some((s) => s.message === tag)).toBe(true);
    expect(forTarget.pending.some((s) => s.message === broadcastTag)).toBe(true);

    const forOther = await jsonRequest<Pending>('/api/canvas/ax/delivery/pending?consumer=other&limit=200');
    expect(forOther.pending.some((s) => s.message === tag)).toBe(false);
    expect(forOther.pending.some((s) => s.message === broadcastTag)).toBe(true);

    // A claim that does not identify itself gets broadcasts only — addressed
    // steering is claimable solely by the consumer it names.
    const anonymous = await jsonRequest<Pending>('/api/canvas/ax/delivery/pending?limit=200');
    expect(anonymous.pending.some((s) => s.message === tag)).toBe(false);
    expect(anonymous.pending.some((s) => s.message === broadcastTag)).toBe(true);

    // The browser composer's addressed form: workbench steer with a target.
    const composerTag = `${tag}-composer`;
    await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ message: composerTag, source: 'browser', target: 'copilot' }),
    });
    const forCopilot = await jsonRequest<Pending>('/api/canvas/ax/delivery/pending?consumer=copilot&limit=200');
    expect(forCopilot.pending.some((s) => s.message === composerTag)).toBe(true);
    expect(
      (await jsonRequest<Pending>('/api/canvas/ax/delivery/pending?consumer=impl-auth&limit=200')).pending.some(
        (s) => s.message === composerTag,
      ),
    ).toBe(false);
    // The timeline row carries the address so the panel can show “→ copilot”.
    const timeline = await jsonRequest<{ steering: Array<{ message: string; target: string | null }> }>(
      '/api/canvas/ax/timeline?limit=50',
    );
    expect(timeline.steering.find((s) => s.message === composerTag)?.target).toBe('copilot');
  });

  test('AX review annotation and host capability endpoints round-trip over HTTP', async () => {
    const review = await jsonRequest<{
      ok: boolean;
      reviewAnnotation: { id: string; status: string; severity: string };
    }>('/api/canvas/ax/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'off-by-one',
        kind: 'finding',
        severity: 'error',
        anchorType: 'file',
        file: 'src/x.ts',
        source: 'api',
      }),
    });
    expect(review.reviewAnnotation.severity).toBe('error');

    // #39: a body-only review annotation (no anchorType, no nodeId) succeeds as an
    // unanchored note instead of 400ing — anchorType is documented optional.
    const bodyOnly = await jsonRequest<{
      ok: boolean;
      reviewAnnotation: { id: string; anchorType: string; nodeId: string | null };
    }>('/api/canvas/ax/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'general note, no anchor', source: 'api' }),
    });
    expect(bodyOnly.ok).toBe(true);
    expect(bodyOnly.reviewAnnotation.anchorType).toBe('file');
    expect(bodyOnly.reviewAnnotation.nodeId).toBeNull();

    const updated = await jsonRequest<{ ok: boolean; reviewAnnotation: { status: string } }>(
      `/api/canvas/ax/review/${review.reviewAnnotation.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'resolved', source: 'api' }),
      },
    );
    expect(updated.reviewAnnotation.status).toBe('resolved');

    const reported = await jsonRequest<{ ok: boolean; host: { host: string; sessionMessaging: boolean } }>(
      '/api/canvas/ax/host-capability',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: 'copilot', canvas: true, sessionMessaging: true, source: 'api' }),
      },
    );
    expect(reported.host.host).toBe('copilot');
    expect(reported.host.sessionMessaging).toBe(true);

    const read = await jsonRequest<{ ok: boolean; host: { host: string } | null }>('/api/canvas/ax/host-capability');
    expect(read.host?.host).toBe('copilot');
  });

  test('#56: AX work endpoints reject an unknown status with 400 (add + update)', async () => {
    const badCreate = await fetch(`${baseUrl}/api/canvas/ax/work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', status: 'in_progress' }),
    });
    expect(badCreate.status).toBe(400);
    expect(((await badCreate.json()) as { error: string }).error).toContain('in-progress');

    const created = await jsonRequest<{ workItem: { id: string; status: string } }>('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'valid', status: 'in-progress' }),
    });
    expect(created.workItem.status).toBe('in-progress');

    const badPatch = await fetch(`${baseUrl}/api/canvas/ax/work/${created.workItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    });
    expect(badPatch.status).toBe(400);
    // The item is unchanged (not silently no-op'd to ok:true).
    const ax = (await (await fetch(`${baseUrl}/api/canvas/ax`)).json()) as {
      state: { workItems: Array<{ id: string; status: string }> };
    };
    expect(ax.state.workItems.find((w) => w.id === created.workItem.id)?.status).toBe('in-progress');
  });

  test('GET /api/canvas/ax returns the aggregate { ok, state, host, context } (plan-007 B.1)', async () => {
    // The registry ax.get op serves one wire body that the remote-MCP invoker
    // also consumes, so the HTTP route now carries the full aggregate (host +
    // context), not just state. Pin it so the expansion is not silently reverted.
    const ax = await jsonRequest<{ ok: boolean; state: unknown; host: unknown; context?: unknown }>('/api/canvas/ax');
    expect(ax.ok).toBe(true);
    expect(ax).toHaveProperty('state');
    expect(ax).toHaveProperty('host');
    expect(ax).toHaveProperty('context');
    // includeContext=false drops the context block.
    const slim = await jsonRequest<{ context?: unknown }>('/api/canvas/ax?includeContext=false');
    expect(slim).not.toHaveProperty('context');
  });

  test('primitive A: activity ingestion applies kind-driven reactions, overridable', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'activity node' }),
    });

    // failure → work item (blocked) + review (finding/error, node-anchored) + evidence (logs)
    const failure = await jsonRequest<{
      ok: boolean;
      event: { kind: string; data: { activityKind?: string } | null };
      workItem: { status: string } | null;
      evidence: { kind: string } | null;
      review: { kind: string; severity: string; anchorType: string; nodeId: string | null } | null;
    }>('/api/canvas/ax/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'failure',
        title: 'tsc failed',
        summary: 'type error in x.ts',
        nodeIds: [node.id],
        source: 'api',
      }),
    });
    expect(failure.workItem?.status).toBe('blocked');
    expect(failure.review?.severity).toBe('error');
    expect(failure.review?.nodeId).toBe(node.id);
    expect(failure.evidence?.kind).toBe('logs');
    expect(failure.event.data?.activityKind).toBe('failure');

    // tool-result + success → evidence only (no work item / review)
    const success = await jsonRequest<{ workItem: unknown; review: unknown; evidence: { kind: string } | null }>(
      '/api/canvas/ax/activity',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'tool-result', title: 'tests passed', outcome: 'success', source: 'api' }),
      },
    );
    expect(success.evidence?.kind).toBe('tool-result');
    expect(success.workItem).toBeNull();
    expect(success.review).toBeNull();

    // reactions overrides: suppress the work item + review on a failure
    const suppressed = await jsonRequest<{ workItem: unknown; review: unknown; evidence: unknown }>(
      '/api/canvas/ax/activity',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'failure',
          title: 'noisy',
          reactions: { workItem: false, review: false },
          source: 'api',
        }),
      },
    );
    expect(suppressed.workItem).toBeNull();
    expect(suppressed.review).toBeNull();
    expect(suppressed.evidence).not.toBeNull();

    // invalid kind → 400
    const bad = await fetch(`${baseUrl}/api/canvas/ax/activity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'nope', title: 'x' }),
    });
    expect(bad.status).toBe(400);

    // Caller data cannot clobber the canonical activityKind/outcome on the event.
    const clobber = await jsonRequest<{ event: { data: { activityKind?: string; outcome?: string } | null } }>(
      '/api/canvas/ax/activity',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'failure',
          title: 'spoofed',
          outcome: 'failure',
          data: { activityKind: 'note', outcome: 'success' },
          source: 'api',
        }),
      },
    );
    expect(clobber.event.data?.activityKind).toBe('failure');
    expect(clobber.event.data?.outcome).toBe('failure');
  });

  test('primitive D: single-item gate GET reads immediately and long-polls until resolved', async () => {
    const gate = await jsonRequest<{ approvalGate: { id: string } }>('/api/canvas/ax/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Deploy', action: 'deploy', source: 'api' }),
    });
    const id = gate.approvalGate.id;

    // Immediate read (no waitMs): still pending.
    const now = await jsonRequest<{ ok: boolean; approvalGate: { status: string }; pending: boolean }>(
      `/api/canvas/ax/approval/${id}`,
    );
    expect(now.approvalGate.status).toBe('pending');
    expect(now.pending).toBe(true);

    // Long-poll resolves when the gate is resolved mid-wait.
    const waitPromise = fetch(`${baseUrl}/api/canvas/ax/approval/${id}?waitMs=5000`).then((r) => r.json()) as Promise<{
      approvalGate: { status: string };
      pending: boolean;
    }>;
    // Deliberate 60ms gap so the long-poll is in flight server-side before the
    // resolve lands — there is no "waiter registered" signal to poll, and the
    // endpoint answers correctly either way; this keeps the mid-wait path exercised.
    await new Promise((resolve) => setTimeout(resolve, 60));
    await fetch(`${baseUrl}/api/canvas/ax/approval/${id}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', source: 'api' }),
    });
    const waited = await waitPromise;
    expect(waited.approvalGate.status).toBe('approved');
    expect(waited.pending).toBe(false);

    // Unknown id → 404.
    const missing = await fetch(`${baseUrl}/api/canvas/ax/approval/does-not-exist`);
    expect(missing.status).toBe(404);
  });

  test('B+C: ax/context exposes a loop-safe delivery lead block', async () => {
    await fetch(`${baseUrl}/api/canvas/ax/work`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'human task', status: 'todo', source: 'browser' }),
    });
    await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'focus on auth', source: 'browser' }),
    });

    type Delivery = {
      delivery: { pendingSteering: Array<{ source: string | null }>; pendingActivity: Array<{ kind: string }> };
    };
    const unfiltered = await jsonRequest<Delivery>('/api/canvas/ax/context');
    expect(unfiltered.delivery.pendingActivity.some((a) => a.kind === 'work-item')).toBe(true);
    expect(unfiltered.delivery.pendingSteering.some((s) => s.source === 'browser')).toBe(true);

    // The browser consumer never sees its own steering/activity (loop-safety). Work
    // items are canvas-bound (cleared each test), so the only one is mine → filtered out.
    const filtered = await jsonRequest<Delivery>('/api/canvas/ax/context?consumer=browser');
    expect(filtered.delivery.pendingActivity).toHaveLength(0);
    expect(filtered.delivery.pendingSteering.every((s) => s.source !== 'browser')).toBe(true);
  });

  test('#57: compact context surfaces NEWEST steering first + backlog counts; FIFO delivery stays oldest-first', async () => {
    const tag = `s57-${Date.now()}`;
    const n = 13; // > AX_CONTEXT_STEERING_LIMIT (10) so the compact block must omit some
    for (let i = 0; i < n; i += 1) {
      await fetch(`${baseUrl}/api/canvas/ax/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `${tag}-${i}`, source: 'api' }),
      });
    }

    // Compact context (consumer=copilot does NOT filter source:'api' steers).
    type Ctx = {
      delivery: { pendingSteering: Array<{ message: string }>; totalPending: number; omittedPending: number };
    };
    const ctx = await jsonRequest<Ctx>('/api/canvas/ax/context?consumer=copilot');
    const ps = ctx.delivery.pendingSteering;
    expect(ps).toHaveLength(10); // capped at the context limit
    expect(ps[0].message).toBe(`${tag}-${n - 1}`); // NEWEST steer is first (was the bug)
    expect(ps[9].message).toBe(`${tag}-${n - 10}`); // descending by recency
    expect(ctx.delivery.totalPending).toBeGreaterThanOrEqual(n);
    expect(ctx.delivery.omittedPending).toBe(ctx.delivery.totalPending - ps.length);
    expect(ctx.delivery.omittedPending).toBeGreaterThan(0); // backlog is signalled, not hidden

    // The FIFO claim/ack delivery queue is unchanged: oldest-first, no count fields.
    const fifo = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot&limit=80`)
    ).json()) as {
      pending: Array<{ message: string }>;
      totalPending?: number;
    };
    const mine = fifo.pending.filter((s) => s.message.startsWith(tag)).map((s) => s.message);
    expect(mine[0]).toBe(`${tag}-0`); // oldest of mine first (FIFO)
    expect(mine[mine.length - 1]).toBe(`${tag}-${n - 1}`);
    expect(fifo.totalPending).toBeUndefined(); // delivery shape NOT changed
  });

  test('loop prevention also keys on agentId: a consumer never claims a broadcast steer it originated as an agent', async () => {
    const tag = `loop-agent-${Date.now()}`;
    // Orchestrator (agentId within the mcp host) posts a BROADCAST steer.
    await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: tag, source: 'mcp', agentId: 'orchestrator' }),
    });
    type Pending = { pending: Array<{ message: string }> };
    const pendingFor = async (consumer: string) =>
      (
        (await (
          await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=${consumer}&limit=200`)
        ).json()) as Pending
      ).pending.map((s) => s.message);

    // Claiming under its own agentId must NOT surface its own steer…
    expect(await pendingFor('orchestrator')).not.toContain(tag);
    // …and claiming under the originating host label stays excluded as before…
    expect(await pendingFor('mcp')).not.toContain(tag);
    // …while any other consumer still receives the broadcast.
    expect(await pendingFor('impl-auth')).toContain(tag);
  });

  test('#68: delivery claim accepts order=newest to surface the latest steering first; default stays oldest-first FIFO', async () => {
    const tag = `s68-${Date.now()}`;
    const n = 8;
    for (let i = 0; i < n; i += 1) {
      await fetch(`${baseUrl}/api/canvas/ax/steer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `${tag}-${i}`, source: 'api' }),
      });
    }
    type Pending = { pending: Array<{ message: string }> };
    const mineOf = (p: Pending) => p.pending.filter((s) => s.message.startsWith(tag)).map((s) => s.message);

    // order=newest reverses MY steers vs the default FIFO oldest-first (large limit
    // so other tests' steers don't truncate mine out).
    const newest = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot&order=newest&limit=200`)
    ).json()) as Pending;
    const oldest = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot&order=oldest&limit=200`)
    ).json()) as Pending;
    expect(mineOf(newest)[0]).toBe(`${tag}-${n - 1}`); // newest-first
    expect(mineOf(oldest)[0]).toBe(`${tag}-0`); // oldest-first (default behavior)
    expect(mineOf(newest)).toEqual([...mineOf(oldest)].reverse());

    // The crux of #68: with a SMALL limit, order=newest surfaces the human's
    // latest action (mine were created last → globally newest), instead of burying
    // it behind the stale backlog the default FIFO returns.
    const smallNewest = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot&order=newest&limit=3`)
    ).json()) as Pending;
    expect(smallNewest.pending[0].message).toBe(`${tag}-${n - 1}`);
    const smallDefault = (await (
      await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot&limit=3`)
    ).json()) as Pending;
    expect(smallDefault.pending.some((s) => s.message === `${tag}-${n - 1}`)).toBe(false); // latest buried by the backlog
  });

  test('GET /api/canvas/ax/surface-snapshot returns the compact board with review text redacted', async () => {
    const review = await jsonRequest<{ reviewAnnotation: { id: string } }>('/api/canvas/ax/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        body: 'secret human comment',
        author: 'alice',
        anchorType: 'file',
        file: 'x.ts',
        source: 'api',
      }),
    });
    const snap = await jsonRequest<{ reviewAnnotations: Array<Record<string, unknown>> }>(
      '/api/canvas/ax/surface-snapshot',
    );
    for (const k of [
      'focus',
      'workItems',
      'approvalGates',
      'reviewAnnotations',
      'elicitations',
      'modeRequests',
      'policy',
    ]) {
      expect(snap).toHaveProperty(k);
    }
    const entry = snap.reviewAnnotations.find((r) => r.id === review.reviewAnnotation.id);
    expect(entry).toBeDefined();
    // Free-text human fields are redacted from the surface snapshot.
    expect(entry?.body).toBeUndefined();
    expect(entry?.author).toBeUndefined();
    expect(entry?.severity).toBeDefined();
  });

  test('AX mutations emit ax-event-created and ax-state-changed SSE events', async () => {
    const abortController = new AbortController();
    // Await the SSE handshake before mutating: the server registers the
    // subscriber in the stream's start() before the response is returned, so a
    // resolved fetch means the events below cannot be missed.
    const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: abortController.signal });
    expect(response.ok).toBe(true);
    const eventsPromise = (async () => {
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let buffer = '';
      const seen = new Set<string>();
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
          if (eventLine) seen.add(eventLine.slice('event: '.length));
        }
        if (seen.has('ax-event-created') && seen.has('ax-state-changed')) return seen;
      }
      return seen;
    })();

    await jsonRequest('/api/canvas/ax/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'prompt', summary: 'timeline event', source: 'api' }),
    });
    await jsonRequest('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'canvas-bound work', source: 'api' }),
    });

    const seen = await Promise.race([eventsPromise, Bun.sleep(2_000).then(() => new Set<string>())]);
    abortController.abort();

    expect(seen.has('ax-event-created')).toBe(true);
    expect(seen.has('ax-state-changed')).toBe(true);
  });
});
