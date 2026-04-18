import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { runAgentCli } from '../../src/cli/agent.ts';
import {
  formatCompactWatchEvent,
  SemanticWatchReducer,
  type SemanticWatchEvent,
} from '../../src/cli/watch.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createTestWorkspace,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

function makeLayout(
  nodes: Parameters<typeof makeNode>[0][],
  edges: Array<{
    id: string;
    from: string;
    to: string;
    type: 'relation' | 'depends-on' | 'flow' | 'references';
  }> = [],
) {
  return {
    viewport: { x: 0, y: 0, scale: 1 },
    nodes: nodes.map((node) => makeNode(node)),
    edges: edges.map((edge) => ({ ...edge })),
  };
}

function findEvent<T extends SemanticWatchEvent['type']>(
  events: SemanticWatchEvent[],
  type: T,
): Extract<SemanticWatchEvent, { type: T }> | undefined {
  return events.find((event) => event.type === type) as Extract<SemanticWatchEvent, { type: T }> | undefined;
}

describe('semantic watch reducer', () => {
  test('emits connect events from added edges', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Bug report' } },
          { id: 'b', type: 'file', data: { title: 'auth.ts' }, position: { x: 800, y: 80 } },
        ]),
        timestamp: 't0',
      },
    });

    const events = reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout(
          [
            { id: 'a', type: 'markdown', data: { title: 'Bug report' } },
            { id: 'b', type: 'file', data: { title: 'auth.ts' }, position: { x: 800, y: 80 } },
          ],
          [{ id: 'e1', from: 'a', to: 'b', type: 'relation' }],
        ),
        timestamp: 't1',
      },
    });

    const connect = findEvent(events, 'connect');
    expect(connect).toBeDefined();
    expect(connect?.edges).toHaveLength(1);
    expect(connect?.edges[0]).toMatchObject({
      fromId: 'a',
      toId: 'b',
      edgeType: 'relation',
      fromTitle: 'Bug report',
      toTitle: 'auth.ts',
    });
  });

  test('emits remove events for removed nodes', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Keep me' } },
          { id: 'b', type: 'markdown', data: { title: 'Remove me' }, position: { x: 700, y: 80 } },
        ]),
      },
    });

    const events = reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([{ id: 'a', type: 'markdown', data: { title: 'Keep me' } }]),
      },
    });

    const removal = findEvent(events, 'remove');
    expect(removal).toBeDefined();
    expect(removal?.nodes).toHaveLength(1);
    expect(removal?.nodes[0]).toMatchObject({
      id: 'b',
      title: 'Remove me',
    });
  });

  test('emits group events for created groups', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'One' } },
          { id: 'b', type: 'markdown', data: { title: 'Two' }, position: { x: 0, y: 420 } },
        ]),
      },
    });

    const events = reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'One', parentGroup: 'g1' } },
          { id: 'b', type: 'markdown', data: { title: 'Two', parentGroup: 'g1' }, position: { x: 0, y: 420 } },
          {
            id: 'g1',
            type: 'group',
            data: { title: 'API Group', children: ['a', 'b'] },
            position: { x: -80, y: -40 },
            size: { width: 600, height: 760 },
          },
        ]),
      },
    });

    const group = findEvent(events, 'group');
    expect(group).toBeDefined();
    expect(group?.created).toEqual([{ id: 'g1', title: 'API Group', childCount: 2 }]);
  });

  test('suppresses move-end when movement does not change semantics', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Alpha' }, position: { x: 0, y: 0 } },
          { id: 'b', type: 'markdown', data: { title: 'Beta' }, position: { x: 1200, y: 0 } },
        ]),
      },
    });

    const events = reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Alpha' }, position: { x: 40, y: 0 } },
          { id: 'b', type: 'markdown', data: { title: 'Beta' }, position: { x: 1200, y: 0 } },
        ]),
      },
    });

    expect(findEvent(events, 'move-end')).toBeUndefined();
  });

  test('emits move-end when movement changes clustering', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Alpha' }, position: { x: 0, y: 0 } },
          { id: 'b', type: 'markdown', data: { title: 'Beta' }, position: { x: 900, y: 0 } },
        ]),
      },
    });

    const events = reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([
          { id: 'a', type: 'markdown', data: { title: 'Alpha' }, position: { x: 0, y: 0 } },
          { id: 'b', type: 'markdown', data: { title: 'Beta' }, position: { x: 180, y: 0 } },
        ]),
      },
    });

    const move = findEvent(events, 'move-end');
    expect(move).toBeDefined();
    expect(move?.nodes).toHaveLength(1);
    expect(move?.nodes[0].id).toBe('b');
    expect(move?.nodes[0].reasons).toContain('joined cluster');
    expect(formatCompactWatchEvent(move!)).toContain('joined cluster');
  });

  test('emits context-pin events from pin deltas', () => {
    const reducer = new SemanticWatchReducer();
    reducer.handleMessage({
      event: 'canvas-layout-update',
      data: {
        layout: makeLayout([{ id: 'a', type: 'markdown', data: { title: 'Bug report' } }]),
      },
    });

    const events = reducer.handleMessage({
      event: 'context-pins-changed',
      data: {
        nodeIds: ['a'],
        count: 1,
        timestamp: 't1',
      },
    });

    const pin = findEvent(events, 'context-pin');
    expect(pin).toBeDefined();
    expect(pin?.added).toEqual([{ id: 'a', title: 'Bug report', nodeType: 'markdown' }]);
  });
});

describe('agent CLI watch command', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return await response.json() as T;
  }

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-watch-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4544, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI watch tests.');
    }
    baseUrl = base;

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) {
      process.env.PMX_CANVAS_URL = previousUrl;
    } else {
      delete process.env.PMX_CANVAS_URL;
    }
    if (previousPort) {
      process.env.PMX_CANVAS_PORT = previousPort;
    } else {
      delete process.env.PMX_CANVAS_PORT;
    }
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();
  });

  test('watch emits JSONL semantic events from SSE and exits after max-events', async () => {
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Pinned note',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      const watchPromise = runAgentCli(['watch', '--json', '--events', 'context-pin', '--max-events', '1']);
      await Bun.sleep(100);
      await jsonRequest<{ ok: boolean }>('/api/canvas/context-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: [created.id] }),
      });
      await watchPromise;
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      type: string;
      added: Array<{ id: string; title: string | null }>;
    };
    expect(output.type).toBe('context-pin');
    expect(output.added).toEqual([{ id: created.id, title: 'Pinned note', nodeType: 'markdown' }]);
  });
});
