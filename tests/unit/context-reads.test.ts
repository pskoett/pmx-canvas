import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  CONTEXT_READ_RETENTION,
  CONTEXT_READS_SCHEMA_SQL,
  appendContextReadToDB,
  contextReadFromPayload,
  loadContextReadsFromDB,
  type ContextRead,
  type ContextReadConsumerSummary,
} from '../../src/server/context-reads.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('context read log', () => {
  test('delivery is the pinned ids present in what the reader received', () => {
    const read = contextReadFromPayload(
      {
        channel: 'operation',
        resource: 'summary.get',
        source: 'api',
        consumer: null,
        agentId: null,
        pinnedNodeIds: ['node-a', 'node-b'],
      },
      { nodes: [{ id: 'node-a' }] },
    );
    expect(read.deliveredNodeIds).toEqual(['node-a']);
    expect(read.bytes).toBe(JSON.stringify({ nodes: [{ id: 'node-a' }] }).length);
  });

  test('a bare id list or a matching word is not delivery', () => {
    const read = contextReadFromPayload(
      {
        channel: 'operation',
        resource: 'ax.context.get',
        source: 'api',
        consumer: null,
        agentId: null,
        pinnedNodeIds: ['context', 'node-b'],
      },
      JSON.stringify(
        { pinned: { nodeIds: ['context', 'node-b'] }, nodes: [{ id: 'node-b', type: 'context' }] },
        null,
        2,
      ),
    );
    expect(read.deliveredNodeIds).toEqual(['node-b']);
  });

  test('keeps the newest rows and summarizes per consumer', () => {
    const db = new Database(':memory:');
    db.exec(CONTEXT_READS_SCHEMA_SQL);
    const base = {
      channel: 'mcp-resource' as const,
      resource: 'canvas://pinned-context',
      source: 'mcp',
      agentId: null,
      bytes: 10,
    };
    for (let i = 0; i < CONTEXT_READ_RETENTION + 3; i++) {
      appendContextReadToDB(db, { ...base, consumer: 'claude', pinnedNodeIds: ['n1'], deliveredNodeIds: ['n1'] });
    }
    appendContextReadToDB(db, { ...base, consumer: 'codex', pinnedNodeIds: ['n1', 'n2'], deliveredNodeIds: ['n1'] });
    appendContextReadToDB(db, { ...base, consumer: 'codex', pinnedNodeIds: [], deliveredNodeIds: [] });

    const { reads, summary } = loadContextReadsFromDB(db, 2);
    expect(reads.map((read) => read.consumer)).toEqual(['codex', 'codex']);
    const byConsumer = new Map(summary.map((entry) => [entry.consumer, entry]));
    expect(byConsumer.get('claude')?.reads).toBe(CONTEXT_READ_RETENTION - 2);
    expect(byConsumer.get('codex')).toMatchObject({ reads: 2, readsWithPins: 1, readsDeliveringAllPins: 0 });
  });
});

describe('context reads over HTTP', () => {
  let workspaceRoot = '';
  let baseUrl = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-reads-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 0 });
    if (!base) throw new Error('Failed to start canvas server for tests.');
    baseUrl = base.replace(/\/$/, '');
  });

  afterAll(() => {
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  async function reads(): Promise<{ reads: ContextRead[]; summary: ContextReadConsumerSummary[] }> {
    return (await (await fetch(`${baseUrl}/api/canvas/ax/context-reads?limit=500`)).json()) as {
      reads: ContextRead[];
      summary: ContextReadConsumerSummary[];
    };
  }

  test('an agent read of pinned context is recorded with delivery; the workbench and proxies are not', async () => {
    const human = { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' };
    const node = (await (
      await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: human,
        body: JSON.stringify({ type: 'markdown', title: 'Pinned brief', content: 'x' }),
      })
    ).json()) as { id: string };
    await fetch(`${baseUrl}/api/canvas/context-pins`, {
      method: 'POST',
      headers: human,
      body: JSON.stringify({ nodeIds: [node.id] }),
    });

    await fetch(`${baseUrl}/api/canvas/ax/context`, { headers: { 'x-pmx-source': 'reads-agent' } });
    await fetch(`${baseUrl}/api/canvas/summary`, { headers: { 'x-pmx-source': 'reads-agent' } });
    await fetch(`${baseUrl}/api/canvas/ax/context`, { headers: { 'x-pmx-workbench': '1' } });
    await fetch(`${baseUrl}/api/canvas/ax/context`, {
      headers: { 'x-pmx-source': 'reads-proxy', 'x-pmx-proxied-read': '1' },
    });

    const log = await reads();
    const mine = log.reads.filter((read) => read.source === 'reads-agent');
    expect(mine.map((read) => read.resource).sort()).toEqual(['ax.context.get', 'summary.get']);
    const context = mine.find((read) => read.resource === 'ax.context.get');
    expect(context).toMatchObject({ channel: 'operation', pinnedNodeIds: [node.id], deliveredNodeIds: [node.id] });
    // The summary carries pinned titles only, so no pinned node was delivered.
    expect(mine.find((read) => read.resource === 'summary.get')?.deliveredNodeIds).toEqual([]);
    expect(log.reads.some((read) => read.source === 'reads-proxy')).toBe(false);
    expect(log.summary.find((entry) => entry.consumer === 'reads-agent')).toMatchObject({
      reads: 2,
      readsWithPins: 2,
      readsDeliveringAllPins: 1,
    });
  });

  test('a proxy records the read its agent made, without becoming an agent writer', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/ax/context-reads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'copilot' },
      body: JSON.stringify({
        channel: 'adapter',
        resource: 'copilot:prompt-context',
        source: 'copilot',
        consumer: 'copilot',
        pinnedNodeIds: ['node-x'],
        deliveredNodeIds: [],
        bytes: 0,
      }),
    });
    expect(response.status).toBe(200);

    const log = await reads();
    expect(log.reads[0]).toMatchObject({ channel: 'adapter', consumer: 'copilot', deliveredNodeIds: [] });
    const presence = (await (await fetch(`${baseUrl}/api/canvas/ax/presence`)).json()) as {
      presences: Array<{ source: string }>;
    };
    expect(presence.presences.some((entry) => entry.source === 'copilot')).toBe(false);
  });

  test('a malformed record is refused', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/ax/context-reads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'telepathy', resource: 'x', deliveredNodeIds: [], bytes: 0 }),
    });
    expect(response.status).toBe(400);
  });
});
