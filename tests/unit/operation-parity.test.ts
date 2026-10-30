// Pre-refactor safety net for the operation-registry refactor.
//
// These tests pin the CURRENT behavior of the five core node operations
// (add, get, update, remove, layout get) across all four public surfaces:
//
//   1. HTTP API   — fetch against the Bun server (src/server/server.ts)
//   2. MCP tools  — stdio MCP client backed by the running daemon (src/mcp/server.ts)
//   3. CLI        — runAgentCli, which talks HTTP via PMX_CANVAS_URL (src/cli/agent.ts)
//   4. SDK        — PmxCanvas methods on the shared in-process singleton (src/server/index.ts)
//
// Response ENVELOPES are allowed to differ between surfaces (and they do);
// equivalence is asserted on the resulting canvas STATE, fetched back over
// HTTP after each call. Known asymmetries are pinned explicitly at the bottom
// — if one of those tests fails, the refactor changed observable legacy
// behavior and the change must be a deliberate, documented decision.
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import type { BoardMovePreview } from '../../src/server/board-move.ts';
import { createCanvas, type PmxCanvas } from '../../src/server/index.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import type { AgentPresenceSnapshot } from '../../src/shared/agent-presence.ts';
import {
  createTestWorkspace,
  getAvailablePort,
  makeNode,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

interface TextContentItem {
  type: string;
  text?: string;
}

interface ToolResultShape {
  content?: TextContentItem[];
  isError?: boolean;
}

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

function textOf(result: ToolResultShape): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

function parseJsonText<T>(result: ToolResultShape): T {
  return JSON.parse(textOf(result)) as T;
}

// The canonical state projection used for cross-surface equivalence. Envelope
// fields (ok / nodeId / fetch / compact-vs-full) intentionally do NOT appear.
interface NodeView {
  type: string;
  title: unknown;
  content: unknown;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

interface SerializedNodeShape {
  id: string;
  type: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  data: Record<string, unknown>;
}

interface LayoutShape {
  nodes: SerializedNodeShape[];
  edges: Array<{ id: string; from: string; to: string; type: string }>;
}

function projectNode(node: SerializedNodeShape): NodeView {
  return {
    type: node.type,
    title: node.data.title,
    content: node.data.content,
    position: node.position,
    size: node.size,
  };
}

function projectLayout(layout: LayoutShape): {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
  }>;
  edges: Array<{ id: string; from: string; to: string; type: string }>;
} {
  return {
    nodes: layout.nodes
      .map((node) => ({ id: node.id, type: node.type, position: node.position, size: node.size }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: layout.edges
      .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

// Minimal SSE subscriber for /api/workbench/events. Frames are
// `id: N\nevent: NAME\ndata: {...}\n\n` — we only count event names.
interface SseCollector {
  count(event: string): number;
  waitForCount(event: string, min: number, timeoutMs?: number): Promise<boolean>;
  close(): void;
}

async function connectSse(baseUrl: string): Promise<SseCollector> {
  const controller = new AbortController();
  const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: controller.signal });
  if (!response.ok || !response.body) {
    throw new Error('Failed to subscribe to /api/workbench/events.');
  }
  const counts = new Map<string, number>();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  void (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let frameEnd = buffer.indexOf('\n\n');
        while (frameEnd !== -1) {
          const frame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const match = frame.match(/^event: (.+)$/m);
          if (match) {
            counts.set(match[1]!, (counts.get(match[1]!) ?? 0) + 1);
          }
          frameEnd = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // Reader aborts when the collector is closed — expected stream teardown.
    }
  })();
  return {
    count: (event) => counts.get(event) ?? 0,
    async waitForCount(event, min, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if ((counts.get(event) ?? 0) >= min) return true;
        await Bun.sleep(25);
      }
      return (counts.get(event) ?? 0) >= min;
    },
    close: () => controller.abort(),
  };
}

describe('operation parity across HTTP, MCP, CLI, and SDK surfaces', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let port = 0;
  let previousPort = '';
  let previousUrl = '';
  let mcpClient: Client;
  let mcpTransport: StdioClientTransport;
  let sdk: PmxCanvas;

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok, response.ok ? undefined : await response.clone().text()).toBe(true);
    return (await response.json()) as T;
  }

  async function httpAddNode(body: Record<string, unknown>): Promise<{ ok: boolean; id: string }> {
    return await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async function fetchNodeView(id: string): Promise<NodeView> {
    return projectNode(await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${id}`));
  }

  async function runCliJson<T>(args: string[]): Promise<T> {
    const log = mock((..._args: unknown[]) => {});
    const originalLog = console.log;
    console.log = log;
    try {
      await runAgentCli(args);
    } finally {
      console.log = originalLog;
    }
    return JSON.parse(log.mock.calls[0]?.[0] as string) as T;
  }

  async function callMcp(name: string, args: Record<string, unknown>): Promise<ToolResultShape> {
    return (await mcpClient.callTool({ name, arguments: args })) as ToolResultShape;
  }

  beforeAll(async () => {
    workspaceRoot = createTestWorkspace('pmx-canvas-op-parity-');
    resetCanvasForTests(workspaceRoot);
    // Bind on port 0 and derive the real port from the base URL: reserving a
    // port and re-binding it races parallel test files, and a lost race sent
    // startCanvasServer's fallback toward the default port where a real
    // daemon may be listening.
    const base = startCanvasServer({ workspaceRoot, port: 0, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for operation parity tests.');
    }
    baseUrl = base;
    port = Number(new URL(baseUrl).port);

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;

    // The MCP server runs as a subprocess and uses the in-process daemon as
    // its state authority (PMX_CANVAS_PORT health check), so all four
    // surfaces mutate the same canvasState singleton.
    mcpTransport = new StdioClientTransport({
      command: 'bun',
      args: ['run', mcpServerPath],
      cwd: workspaceRoot,
      env: {
        ...process.env,
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
        PMX_CANVAS_PORT: String(port),
      },
      stderr: 'pipe',
    });
    mcpClient = new Client({ name: 'pmx-canvas-operation-parity-test', version: '0.1.0' }, { capabilities: {} });
    await mcpClient.connect(mcpTransport);

    sdk = createCanvas();
  });

  afterAll(async () => {
    await mcpClient.close();
    await mcpTransport.close();
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
    canvasState.clearAllSnapshots();
    mutationHistory.reset();
  });

  test('SDK annotations honor the shared scope fence and cannot overwrite another mark', async () => {
    const node = await httpAddNode({ type: 'markdown', x: 100, y: 100, width: 300, height: 200 });
    const outside = {
      id: 'outside-ink',
      points: [
        { x: 900, y: 700 },
        { x: 950, y: 720 },
      ],
    };
    await sdk.addAnnotation(outside);
    await expect(sdk.addAnnotation({ ...outside, label: 'overwrite' })).rejects.toThrow('different content');
    await jsonRequest('/api/canvas/ax/policy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-PMX-Workbench': '1' },
      body: JSON.stringify({ scope: { nodeIds: [node.id], padding: 0 } }),
    });
    try {
      await expect(sdk.addAnnotation({ ...outside, id: 'new-outside' })).rejects.toThrow('Outside the agent scope');
      await expect(sdk.removeAnnotation(outside.id)).rejects.toThrow('Outside the agent scope');
      await sdk.addAnnotation({
        id: 'inside',
        points: [
          { x: 130, y: 140 },
          { x: 190, y: 180 },
        ],
      });
      expect(await sdk.removeAnnotation('inside')).toBe(true);
      expect(canvasState.getAnnotations().map((mark) => mark.id)).toEqual(['outside-ink']);
    } finally {
      await jsonRequest('/api/canvas/ax/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PMX-Workbench': '1' },
        body: JSON.stringify({ scope: null }),
      });
    }
    expect(await sdk.removeAnnotation(outside.id)).toBe(true);
    await expect(sdk.removeAnnotation(outside.id)).rejects.toThrow('not found');
  });

  test('annotation batches preserve the writer territory for creation and erasing', async () => {
    const node = await httpAddNode({ type: 'markdown', x: 100, y: 100, width: 300, height: 200 });
    const points = [
      { x: 900, y: 700 },
      { x: 950, y: 720 },
    ];
    await sdk.addAnnotation({ id: 'outside', points });
    const policyHeaders = { 'Content-Type': 'application/json', 'X-PMX-Workbench': '1' };
    const headers = { 'Content-Type': 'application/json', 'X-PMX-Source': 'cli' };
    for (const writer of ['cli', 'named-worker']) {
      const identity = writer === 'cli' ? {} : { agentId: writer };
      await jsonRequest('/api/canvas/ax/policy', {
        method: 'POST',
        headers: policyHeaders,
        body: JSON.stringify({ scope: null, agentScopes: { [writer]: { nodeIds: [node.id], padding: 0 } } }),
      });
      try {
        const direct = await fetch(`${baseUrl}/api/canvas/annotation`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ id: 'refused', points, ...identity }),
        });
        expect(direct.status).toBe(403);
        for (const entry of [
          { op: 'annotation.add', args: { id: 'refused', points } },
          { op: 'annotation.remove', args: { id: 'outside' } },
        ]) {
          const batch = await fetch(`${baseUrl}/api/canvas/batch`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ operations: [entry], ...identity }),
          });
          expect(batch.status).toBe(400);
          expect(await batch.json()).toMatchObject({
            ok: false,
            failedIndex: 0,
            error: expect.stringContaining('territory'),
          });
        }
        const allowed = await jsonRequest<{ ok: boolean }>('/api/canvas/batch', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...identity,
            operations: [
              {
                op: 'annotation.add',
                args: {
                  id: 'inside',
                  points: [
                    { x: 130, y: 140 },
                    { x: 190, y: 180 },
                  ],
                },
              },
              { op: 'annotation.remove', args: { id: 'inside' } },
            ],
          }),
        });
        expect(allowed.ok).toBe(true);
        expect(canvasState.getAnnotations().map((mark) => mark.id)).toEqual(['outside']);
      } finally {
        await jsonRequest('/api/canvas/ax/policy', {
          method: 'POST',
          headers: policyHeaders,
          body: JSON.stringify({ agentScopes: { [writer]: null } }),
        });
      }
    }
  });

  for (const surface of ['HTTP', 'MCP', 'CLI', 'SDK'] as const) {
    test(`annotations: ${surface} shares ink, retries and Undo with human writes`, async () => {
      const input = {
        id: `ink-${surface}`,
        points: [
          { x: -20, y: 45 },
          { x: 70, y: 130 },
        ],
        label: 'Check this path',
      };
      const add = async (payload: Parameters<PmxCanvas['addAnnotation']>[0] = input) => {
        if (surface === 'SDK') return sdk.addAnnotation(payload);
        if (surface === 'HTTP')
          return jsonRequest('/api/canvas/annotation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        if (surface === 'CLI') {
          const result = await runCliJson<{ ok: boolean }>([
            'batch',
            '--json',
            JSON.stringify([{ op: 'annotation.add', args: payload }]),
          ]);
          expect(result.ok).toBe(true);
          return;
        }
        expect((await callMcp('canvas_view', { action: 'add-annotation', ...payload })).isError ?? false).toBe(false);
      };
      await add();
      const ink = canvasState.getAnnotations()[0];
      expect(ink).toMatchObject({
        ...input,
        type: 'freehand',
        color: 'currentColor',
        width: 4,
        bounds: { x: -20, y: 45, width: 90, height: 85 },
      });
      const history = mutationHistory.getSummaries();
      await add({ ...input, label: '  Check this path  ', width: 4, color: 'currentColor' });
      expect(mutationHistory.getSummaries()).toEqual(history);
      expect(canvasState.getAnnotations()).toEqual([ink]);
      await sdk.undo();
      expect(canvasState.getAnnotations()).toEqual([]);
      await sdk.redo();
      expect(canvasState.getAnnotations()).toEqual([ink]);

      const other = await httpAddNode({ type: 'markdown', title: 'Keep my redo' });
      await sdk.undo();
      await add();
      await sdk.redo();
      expect((await fetchNodeView(other.id)).title).toBe('Keep my redo');

      // A retry ID is not permission to replace a human's existing mark.
      const conflict = await fetch(`${baseUrl}/api/canvas/annotation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...input,
          points: [
            { x: 100, y: 200 },
            { x: 400, y: 500 },
          ],
        }),
      });
      expect(conflict.status).toBe(409);
      expect(canvasState.getAnnotations()).toEqual([ink]);

      await add({ id: 'agent-question', type: 'text', points: [{ x: 40, y: 75 }], text: 'Which option?', width: 20 });
      expect(canvasState.getAnnotations()[1]).toMatchObject({
        id: 'agent-question',
        type: 'text',
        text: 'Which option?',
        width: 20,
        bounds: { x: 40, y: 55, width: 161.2, height: 24 },
      });
      await jsonRequest('/api/canvas/annotation/agent-question', {
        method: 'DELETE',
        headers: { 'X-PMX-Workbench': '1' },
      });

      await jsonRequest('/api/canvas/annotation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-PMX-Workbench': '1' },
        body: JSON.stringify({
          id: 'human-reply',
          type: 'text',
          points: [{ x: 200, y: 90 }],
          label: 'Reply',
          text: 'Use option B',
        }),
      });
      const read = parseJsonText<{ annotations: Array<{ id: string; text: string }> }>(
        await callMcp('canvas_query', { action: 'layout' }),
      );
      expect(read.annotations).toContainEqual(expect.objectContaining({ id: 'human-reply', text: 'Use option B' }));
      if (surface === 'SDK') await sdk.removeAnnotation('human-reply');
      else if (surface === 'HTTP') await jsonRequest('/api/canvas/annotation/human-reply', { method: 'DELETE' });
      else if (surface === 'CLI') {
        const result = await runCliJson<{ ok: boolean }>([
          'batch',
          '--json',
          JSON.stringify([{ op: 'annotation.remove', args: { id: 'human-reply' } }]),
        ]);
        expect(result.ok).toBe(true);
      } else
        expect(
          (await callMcp('canvas_view', { action: 'remove-annotation', id: 'human-reply' })).isError ?? false,
        ).toBe(false);
      expect(canvasState.getAnnotations()).toEqual([ink]);
    });

    test(`board open: ${surface} switches explicitly before writing and can return Home`, async () => {
      const original = await sdk.createBoard('Original');
      await sdk.openBoard(original.id);
      const existing = await httpAddNode({ type: 'markdown', content: 'Preserve original' });
      const target = await sdk.createBoard(`Created for ${surface}`);
      expect(canvasState.activeBoardId).toBe(original.id);

      const open = async (id: string | null) => {
        if (surface === 'SDK') return sdk.openBoard(id);
        if (surface === 'HTTP') {
          return jsonRequest('/api/canvas/boards/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id }),
          });
        }
        if (surface === 'CLI') return runCliJson(['board', 'open', id ?? '--home']);
        const result = await callMcp('canvas_board', { action: 'open', id });
        expect(result.isError).not.toBe(true);
        expect(parseJsonText<{ activeBoardId: string | null }>(result).activeBoardId).toBe(id);
      };

      await open(target.id);
      expect(canvasState.activeBoardId).toBe(target.id);
      const added = await httpAddNode({ type: 'markdown', content: `Only on ${surface}` });
      expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual([added.id]);
      expect(canvasState.readBoard(original.id)?.layout.nodes.map((node) => node.id)).toEqual([existing.id]);
      await open(null);
      expect(canvasState.activeBoardId).toBeNull();
      await open(target.id);
      expect(canvasState.getLayout().nodes.map((node) => node.id)).toEqual([added.id]);
    });
  }

  test('node add: all four surfaces produce equivalent node state', async () => {
    const expected: NodeView = {
      type: 'markdown',
      title: 'Parity note',
      content: 'Parity body',
      position: { x: 120, y: 160 },
      size: { width: 360, height: 220 },
    };

    const http = await httpAddNode({
      type: 'markdown',
      title: 'Parity note',
      content: 'Parity body',
      x: 120,
      y: 160,
      width: 360,
      height: 220,
    });
    expect(http.ok).toBe(true);

    const mcp = parseJsonText<{ id: string; nodeId: string }>(
      await callMcp('canvas_node', {
        action: 'add',
        type: 'markdown',
        title: 'Parity note',
        content: 'Parity body',
        x: 120,
        y: 160,
        width: 360,
        height: 220,
      }),
    );
    // Envelope note: MCP node-create responses expose both `id` and `nodeId`.
    expect(mcp.nodeId).toBe(mcp.id);

    const cli = await runCliJson<{ ok: boolean; id: string; nodeId: string }>([
      'node',
      'add',
      '--type',
      'markdown',
      '--title',
      'Parity note',
      '--content',
      'Parity body',
      '--x',
      '120',
      '--y',
      '160',
      '--width',
      '360',
      '--height',
      '220',
    ]);
    expect(cli.ok).toBe(true);
    // Envelope note: HTTP/CLI node-create responses also carry the `nodeId` alias.
    expect(cli.nodeId).toBe(cli.id);

    const sdkNode = sdk.addNode({
      type: 'markdown',
      title: 'Parity note',
      content: 'Parity body',
      x: 120,
      y: 160,
      width: 360,
      height: 220,
    });

    const ids = [http.id, mcp.id, cli.id, sdkNode.id];
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(await fetchNodeView(id)).toEqual(expected);
    }
  });

  test('authored work cards share creation and validation across HTTP, MCP, CLI and SDK', async () => {
    const data = { workState: 'blocked', detail: 'Waiting for a fixture', progress: 37.5 };
    const http = await httpAddNode({ type: 'status', title: 'Verify', data });
    const mcp = parseJsonText<{ id: string }>(
      await callMcp('canvas_node', { action: 'add', type: 'status', title: 'Verify', data }),
    );
    const cli = await runCliJson<{ results: Array<{ id: string }> }>([
      'batch',
      '--json',
      JSON.stringify([{ op: 'node.add', args: { type: 'status', title: 'Verify', data } }]),
    ]);
    const direct = sdk.addNode({ type: 'status', title: 'Verify', data });
    for (const { id } of [http, mcp, cli.results[0]!, direct]) {
      const read = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${id}`);
      expect(read.data).toMatchObject(data);
    }
    await jsonRequest(`/api/canvas/node/${http.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { workState: 'done', progress: null } }),
    });
    expect((await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${http.id}`)).data).toMatchObject({
      workState: 'done',
      detail: data.detail,
      progress: null,
    });
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    expect((await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${http.id}`)).data).toMatchObject(data);

    for (const invalid of [
      { workState: 'running' },
      { workState: null },
      { progress: -1 },
      { progress: 101 },
      { progress: '42' },
      { detail: 10 },
    ]) {
      const response = await fetch(`${baseUrl}/api/canvas/node/${http.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: invalid }),
      });
      expect(response.status).toBe(400);
      expect((await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${http.id}`)).data).toMatchObject(data);
    }
    expect(
      (await callMcp('canvas_node', { action: 'add', type: 'status', data: { workState: 'running' } })).isError,
    ).toBe(true);
    expect(() => sdk.addNode({ type: 'status', data: { workState: 'todo', progress: Number.NaN } })).toThrow(
      'progress',
    );
    expect(() => sdk.updateNode(direct.id, { data: { workState: 'invalid' } })).toThrow('workState');
    // The existing generic status indicator does not acquire authored-work semantics.
    expect((await httpAddNode({ type: 'status', data: { phase: 'running' } })).ok).toBe(true);
  });

  test('live work cards share a read-only task projection across transports and history', async () => {
    const { workItem: task } = await jsonRequest<{ workItem: { id: string; title: string } }>('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Verify live work', detail: 'First evidence', agentId: 'reviewer' }),
    });
    expect(canvasState.getWorkItems().map((item) => item.id)).toContain(task.id);
    const data = { workItemId: task.id };
    const http = await httpAddNode({ type: 'status', data });
    const mcp = parseJsonText<{ id: string }>(await callMcp('canvas_node', { action: 'add', type: 'status', data }));
    const cli = await runCliJson<{ results: Array<{ id: string }> }>([
      'batch',
      '--json',
      JSON.stringify([{ op: 'node.add', args: { type: 'status', data } }]),
    ]);
    const direct = sdk.addNode({ type: 'status', data });
    const ids = [http.id, mcp.id, cli.results[0]!.id, direct.id];
    const read = (id: string) => jsonRequest<SerializedNodeShape>(`/api/canvas/node/${id}`);
    for (const id of ids) {
      expect((await read(id)).data).toMatchObject({
        ...data,
        title: task.title,
        workState: 'todo',
        liveWorkSource: 'reviewer',
      });
      expect((await read(id)).data.progress).toBeUndefined();
    }
    const before = canvasState.getContentRevision().revision;
    await jsonRequest(`/api/canvas/ax/work/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'New evidence', detail: 'Second evidence', status: 'blocked' }),
    });
    for (const id of ids)
      expect((await read(id)).data).toMatchObject({
        title: 'New evidence',
        detail: 'Second evidence',
        workState: 'blocked',
      });
    expect(
      canvasState
        .readContentDelta(before)
        .nodes.map((node) => node.id)
        .sort(),
    ).toEqual([...ids].sort());
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    for (const id of ids) expect((await read(id)).data).toMatchObject({ title: task.title, workState: 'todo' });
    for (const patch of [
      { title: 'Fake' },
      { data: { workState: 'done' } },
      { data: { workItemId: null } },
      { data: { progress: 50 } },
      { data: { axWorkStatus: 'done' } },
    ]) {
      expect(
        (
          await fetch(`${baseUrl}/api/canvas/node/${http.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
          })
        ).status,
      ).toBe(400);
    }
    expect(() => sdk.addNode({ type: 'status', data: { workItemId: 'missing' } })).toThrow('work item');
    expect(() => sdk.updateNode(direct.id, { data: { detail: 'Fake' } })).toThrow('read-only');
    await jsonRequest(`/api/canvas/node/${http.id}`, { method: 'DELETE' });
    expect(canvasState.getWorkItems()).toHaveLength(1);
    expect(canvasState.getWorkItems()[0]!.status).toBe('todo');
    await jsonRequest('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Unrelated task', status: 'done', nodeIds: [direct.id] }),
    });
    expect((await read(direct.id)).data.workState).toBe('todo');
    expect((await read(direct.id)).data.axWorkStatus).toBeUndefined();
    const originalBoardId = canvasState.activeBoardId;
    const otherBoard = await sdk.createBoard('Unrelated task board');
    await sdk.openBoard(otherBoard.id);
    expect(canvasState.getWorkItems()).toHaveLength(0);
    expect(canvasState.getLayout().nodes).toHaveLength(0);
    await sdk.openBoard(originalBoardId);
    expect((await read(direct.id)).data).toMatchObject({
      title: task.title,
      workState: 'todo',
      liveWorkAvailable: true,
      liveWorkSource: 'reviewer',
    });
    canvasState.applyPersistedAxState({ ...canvasState.getAxState(), workItems: [] });
    expect((await read(direct.id)).data).toMatchObject({ title: 'Task unavailable', liveWorkAvailable: false });
    expect((await read(direct.id)).data.workState).toBeUndefined();
  });

  test('move selection previews without side effects and replays one receipt across HTTP, SDK, MCP and CLI', async () => {
    const card = await httpAddNode({ type: 'markdown', title: 'Relocate once', content: 'Original evidence' });
    const sourceBoardId = canvasState.activeBoardId!;
    const metadata = await jsonRequest<{ contentRevision: number }>(`/api/canvas/boards/${sourceBoardId}`);
    const input = {
      sourceBoardId,
      nodeIds: [card.id],
      name: 'Moved once',
      expectedRevision: metadata.contentRevision,
      requestId: 'parity-move',
    };
    const beforeCount = canvasState.listBoards().length;
    const activity = async () => {
      const presence = await jsonRequest<AgentPresenceSnapshot>('/api/canvas/ax/presence');
      return {
        writers: presence.presences.map(({ sessionId, opCount, lastSeenAt }) => ({ sessionId, opCount, lastSeenAt })),
        activity: presence.activity,
      };
    };
    const beforeActivity = await activity();
    const http = <T>(body: unknown) =>
      jsonRequest<T>('/api/canvas/boards/move-selection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const preview = await http<{ ok: true; preview: BoardMovePreview }>({
      ...input,
      preview: true,
    });
    expect(preview).toMatchObject({ ok: true, preview: { nodeIds: [card.id], blockers: [] } });
    expect(await sdk.moveSelectionToNewBoard({ ...input, preview: true })).toEqual(preview);
    expect(
      parseJsonText<typeof preview>(
        await callMcp('canvas_board', { action: 'move-selection', ...input, preview: true }),
      ),
    ).toEqual(preview);
    expect(
      await runCliJson<typeof preview>([
        'board',
        'move-selection',
        sourceBoardId,
        input.name,
        '--nodes',
        card.id,
        '--revision',
        String(input.expectedRevision),
        '--request',
        input.requestId,
        '--preview',
      ]),
    ).toEqual(preview);
    expect(await activity()).toEqual(beforeActivity);
    expect(canvasState.listBoards()).toHaveLength(beforeCount);
    const moved = await sdk.moveSelectionToNewBoard(input);
    if (!('destinationBoardId' in moved)) throw new Error('Expected committed move');
    expect(canvasState.activeBoardId).toBe(sourceBoardId);
    const replay = { ...moved, replayed: true };
    await sdk.openBoard(moved.destinationBoardId);
    const committedActivity = await activity();
    expect(await http<typeof replay>(input)).toEqual(replay);
    expect(parseJsonText<typeof replay>(await callMcp('canvas_board', { action: 'move-selection', ...input }))).toEqual(
      replay,
    );
    expect(
      await runCliJson<typeof replay>([
        'board',
        'move-selection',
        sourceBoardId,
        input.name,
        '--nodes',
        card.id,
        '--revision',
        String(input.expectedRevision),
        '--request',
        input.requestId,
      ]),
    ).toEqual(replay);
    expect(canvasState.listBoards()).toHaveLength(beforeCount + 1);
    expect(await activity()).toEqual(committedActivity);
    expect(canvasState.getNode(card.id)!.data.content).toBe('Original evidence');
    expect(canvasState.activeBoardId).toBe(moved.destinationBoardId);
  });

  test('node get: all four surfaces return equivalent node state', async () => {
    const created = await httpAddNode({
      type: 'markdown',
      title: 'Get parity',
      content: 'Get body',
      x: 80,
      y: 90,
      width: 360,
      height: 180,
    });
    const expected: NodeView = {
      type: 'markdown',
      title: 'Get parity',
      content: 'Get body',
      position: { x: 80, y: 90 },
      size: { width: 360, height: 180 },
    };

    // HTTP GET returns the serialized node directly (no ok/envelope wrapper).
    const http = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
    expect(projectNode(http)).toEqual(expected);

    // MCP defaults to a compact projection; full:true returns the full node.
    const mcp = parseJsonText<SerializedNodeShape>(
      await callMcp('canvas_node', { action: 'get', id: created.id, full: true }),
    );
    expect(projectNode(mcp)).toEqual(expected);

    // CLI `node get` proxies the HTTP GET and prints the same serialized node.
    const cli = await runCliJson<SerializedNodeShape>(['node', 'get', created.id]);
    expect(projectNode(cli)).toEqual(expected);

    // SDK getNode returns the serialized node plus a `nodeId` alias.
    const sdkNode = sdk.getNode(created.id);
    if (!sdkNode) throw new Error('SDK getNode returned undefined for an existing node.');
    expect(projectNode(sdkNode)).toEqual(expected);
    expect(sdkNode.nodeId).toBe(created.id);
  });

  test('node update: the same logical patch via each surface yields equivalent state', async () => {
    const base = {
      type: 'markdown',
      title: 'Before title',
      content: 'Before body',
      x: 40,
      y: 60,
      width: 320,
      height: 200,
    };
    const targets: string[] = [];
    for (let index = 0; index < 4; index++) {
      targets.push((await httpAddNode(base)).id);
    }
    const expected: NodeView = {
      type: 'markdown',
      title: 'Updated title',
      content: 'Updated body',
      position: { x: 300, y: 340 },
      size: { width: 520, height: 260 },
    };

    // HTTP PATCH takes flat x/y/width/height keys.
    const patchResponse = await fetch(`${baseUrl}/api/canvas/node/${targets[0]}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated title',
        content: 'Updated body',
        x: 300,
        y: 340,
        width: 520,
        height: 260,
      }),
    });
    expect(patchResponse.ok).toBe(true);

    // MCP takes the same flat keys via canvas_node action:"update".
    const mcpResult = await callMcp('canvas_node', {
      action: 'update',
      id: targets[1],
      title: 'Updated title',
      content: 'Updated body',
      x: 300,
      y: 340,
      width: 520,
      height: 260,
    });
    expect(mcpResult.isError).not.toBe(true);

    // CLI takes flag-form flat keys.
    const cli = await runCliJson<{ ok: boolean }>([
      'node',
      'update',
      targets[2]!,
      '--title',
      'Updated title',
      '--content',
      'Updated body',
      '--x',
      '300',
      '--y',
      '340',
      '--width',
      '520',
      '--height',
      '260',
    ]);
    expect(cli.ok).toBe(true);

    // SDK envelope difference: geometry is expressed as position/size objects
    // (not flat x/width keys) and updateNode returns void.
    sdk.updateNode(targets[3]!, {
      title: 'Updated title',
      content: 'Updated body',
      position: { x: 300, y: 340 },
      size: { width: 520, height: 260 },
    });

    for (const id of targets) {
      expect(await fetchNodeView(id)).toEqual(expected);
    }
  });

  test('node remove: all four surfaces remove the node from canvas state', async () => {
    const targets: string[] = [];
    for (let index = 0; index < 4; index++) {
      targets.push((await httpAddNode({ type: 'markdown', title: `Remove me ${index}` })).id);
    }

    const httpResponse = await fetch(`${baseUrl}/api/canvas/node/${targets[0]}`, { method: 'DELETE' });
    expect(httpResponse.ok).toBe(true);
    expect((await httpResponse.json()) as { ok: boolean; removed: string }).toEqual({ ok: true, removed: targets[0]! });

    const mcp = parseJsonText<{ ok: boolean; removed: string }>(
      await callMcp('canvas_node', { action: 'remove', id: targets[1] }),
    );
    expect(mcp).toEqual({ ok: true, removed: targets[1]! });

    const cli = await runCliJson<{ ok: boolean; removed: string }>(['node', 'remove', targets[2]!]);
    expect(cli).toEqual({ ok: true, removed: targets[2]! });

    // SDK envelope difference: removeNode returns void.
    sdk.removeNode(targets[3]!);

    for (const id of targets) {
      const response = await fetch(`${baseUrl}/api/canvas/node/${id}`);
      expect(response.status).toBe(404);
    }
  });

  test('layout get: all four surfaces report the same nodes and edges', async () => {
    const first = await httpAddNode({ type: 'markdown', title: 'Layout A', x: 0, y: 0, width: 200, height: 100 });
    const second = await httpAddNode({ type: 'status', title: 'Layout B', x: 400, y: 300, width: 240, height: 120 });
    const edge = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: first.id, to: second.id, type: 'flow' }),
    });
    expect(edge.ok).toBe(true);

    const http = projectLayout(await jsonRequest<LayoutShape>('/api/canvas/state'));
    const mcp = projectLayout(
      parseJsonText<LayoutShape>(await callMcp('canvas_query', { action: 'layout', full: true })),
    );
    const cli = projectLayout(await runCliJson<LayoutShape>(['layout']));
    const sdkLayout = projectLayout(sdk.getLayout());

    expect(http.nodes).toHaveLength(2);
    expect(http.edges).toHaveLength(1);
    expect(mcp).toEqual(http);
    expect(cli).toEqual(http);
    expect(sdkLayout).toEqual(http);
  });

  test('SSE: every mutating op emits at least one canvas-layout-update', async () => {
    const sse = await connectSse(baseUrl);
    try {
      // The SSE stream replays a connect-snapshot canvas-layout-update frame;
      // baselines below are measured AFTER that snapshot.
      expect(await sse.waitForCount('canvas-layout-update', 1)).toBe(true);

      let baseline = sse.count('canvas-layout-update');
      const created = await httpAddNode({ type: 'markdown', title: 'SSE add' });
      expect(await sse.waitForCount('canvas-layout-update', baseline + 1)).toBe(true);

      baseline = sse.count('canvas-layout-update');
      const mcpUpdate = await callMcp('canvas_node', { action: 'update', id: created.id, title: 'SSE mcp update' });
      expect(mcpUpdate.isError).not.toBe(true);
      expect(await sse.waitForCount('canvas-layout-update', baseline + 1)).toBe(true);

      baseline = sse.count('canvas-layout-update');
      await runCliJson(['node', 'update', created.id, '--content', 'SSE cli update']);
      expect(await sse.waitForCount('canvas-layout-update', baseline + 1)).toBe(true);

      baseline = sse.count('canvas-layout-update');
      sdk.removeNode(created.id);
      expect(await sse.waitForCount('canvas-layout-update', baseline + 1)).toBe(true);
    } finally {
      sse.close();
    }
  });

  test('SSE: pure reads (node get, layout get) emit zero canvas-layout-update events', async () => {
    const created = await httpAddNode({ type: 'markdown', title: 'SSE read target' });

    const sse = await connectSse(baseUrl);
    try {
      expect(await sse.waitForCount('canvas-layout-update', 1)).toBe(true);
      // Deliberate fixed settle: let any in-flight frames land before the zero-event baseline (absence can't be polled).
      await Bun.sleep(150);
      const baseline = sse.count('canvas-layout-update');

      await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
      await jsonRequest<LayoutShape>('/api/canvas/state');
      expect((await callMcp('canvas_node', { action: 'get', id: created.id, full: true })).isError).not.toBe(true);
      expect((await callMcp('canvas_query', { action: 'layout', full: true })).isError).not.toBe(true);
      await runCliJson(['node', 'get', created.id]);
      await runCliJson(['layout']);
      sdk.getNode(created.id);
      sdk.getLayout();

      // Deliberate fixed window: proves NO frame arrived for pure reads — absence can't be polled.
      await Bun.sleep(300);
      expect(sse.count('canvas-layout-update')).toBe(baseline);
    } finally {
      sse.close();
    }
  });

  test('SSE: a canvas_batch of N mutating ops emits exactly ONE canvas-layout-update (plan-008 Wave 2)', async () => {
    const sse = await connectSse(baseUrl);
    try {
      expect(await sse.waitForCount('canvas-layout-update', 1)).toBe(true);
      // Deliberate fixed settle: let any in-flight frames land before the exactly-one-frame baseline (absence can't be polled).
      await Bun.sleep(150);
      const baseline = sse.count('canvas-layout-update');
      // Three mutating entries: the registry suppresses per-entry emits during
      // the batch loop and the meta-op fires ONE final frame — not one-per-entry.
      const res = await jsonRequest<{ ok: boolean; results: unknown[] }>('/api/canvas/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [
            { op: 'node.add', args: { type: 'markdown', title: 'batch frame 1' } },
            { op: 'node.add', args: { type: 'markdown', title: 'batch frame 2' } },
            { op: 'node.add', args: { type: 'markdown', title: 'batch frame 3' } },
          ],
        }),
      });
      expect(res.ok).toBe(true);
      expect(res.results).toHaveLength(3);
      expect(await sse.waitForCount('canvas-layout-update', baseline + 1)).toBe(true);
      // Exactly one frame for the whole batch — confirm no late/per-entry frames.
      await Bun.sleep(300);
      expect(sse.count('canvas-layout-update')).toBe(baseline + 1);
    } finally {
      sse.close();
    }
  });

  test('canvas_batch records per-entry history — one undo reverses the last entry only', async () => {
    const batch = await jsonRequest<{ ok: boolean; results: Array<{ id?: string }> }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          { op: 'node.add', args: { type: 'markdown', title: 'batch-hist-1' } },
          { op: 'node.add', args: { type: 'markdown', title: 'batch-hist-2' } },
        ],
      }),
    });
    expect(batch.ok).toBe(true);
    const titles = async (): Promise<string[]> => {
      const layout = await jsonRequest<{ nodes: Array<{ title?: string }> }>('/api/canvas/state');
      return layout.nodes.map((n) => n.title ?? '');
    };
    expect(await titles()).toEqual(expect.arrayContaining(['batch-hist-1', 'batch-hist-2']));

    // Each batch entry recorded its own history entry (the op handlers record via
    // canvasState.onMutation, independent of emit suppression). So one undo
    // reverses only the LAST entry, not the whole batch.
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    const afterUndo = await titles();
    expect(afterUndo).toContain('batch-hist-1');
    expect(afterUndo).not.toContain('batch-hist-2');

    await jsonRequest('/api/canvas/redo', { method: 'POST' });
    expect(await titles()).toEqual(expect.arrayContaining(['batch-hist-1', 'batch-hist-2']));
  });

  test('canvas_batch preserves legacy prompt/response node seeding without widening node.add', async () => {
    const batch = await jsonRequest<{
      ok: boolean;
      results: Array<{ id?: string; type?: string; title?: string; content?: string | null }>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            args: {
              type: 'prompt',
              title: 'Batch prompt renderer',
              data: { text: 'Prompt body' },
              width: 420,
              height: 260,
            },
          },
          {
            op: 'node.add',
            args: {
              type: 'response',
              title: 'Batch response renderer',
              data: { content: 'Response body', status: 'complete' },
              width: 420,
              height: 260,
            },
          },
        ],
      }),
    });

    expect(batch.ok).toBe(true);
    expect(batch.results.map((entry) => entry.type)).toEqual(['prompt', 'response']);
    expect(batch.results[0]?.content).toBe('Prompt body');
    expect(batch.results[1]?.content).toBe('Response body');

    const standalone = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'prompt', title: 'Standalone prompt still rejected' }),
    });
    expect(standalone.status).toBe(400);
  });

  test('canvas_batch rejects unsupported registry ops with HTTP 400 — no broad side-effect batching', async () => {
    // mcpapp.open creates its node from the ext-app-open SSE event, which the
    // batch suppresses; webartifact.build emits through the canvas-operations
    // emitter, outside registry suppression. Batch intentionally preserves the
    // legacy allowlist instead of accepting every registered op.
    for (const op of ['mcpapp.open', 'webartifact.build']) {
      const response = await fetch(`${baseUrl}/api/canvas/batch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operations: [
            {
              op,
              args:
                op === 'mcpapp.open'
                  ? { transport: { type: 'stdio', command: 'echo' }, toolName: 'noop' }
                  : { title: 'batch artifact', appTsx: 'export default function App(){return null}' },
            },
          ],
        }),
      });
      expect(response.status).toBe(400);
      const res = (await response.json()) as { ok: boolean; failedIndex?: number; error?: string; results: unknown[] };
      expect(res.ok).toBe(false);
      expect(res.failedIndex).toBe(0);
      expect(res.error).toContain(`Unsupported canvas_batch operation "${op}"`);
      expect(res.results).toHaveLength(0);
    }

    const mcpFailed = (await mcpClient.callTool({
      name: 'canvas_batch',
      arguments: {
        operations: [
          {
            op: 'webartifact.build',
            args: { title: 'batch artifact', appTsx: 'export default function App(){return null}' },
          },
        ],
      },
    })) as ToolResultShape;
    expect(mcpFailed.isError).toBe(true);
    const mcpBody = parseJsonText<{ ok: boolean; failedIndex?: number; error?: string; results: unknown[] }>(mcpFailed);
    expect(mcpBody.ok).toBe(false);
    expect(mcpBody.failedIndex).toBe(0);
    expect(mcpBody.error).toContain('Unsupported canvas_batch operation "webartifact.build"');
    expect(mcpBody.results).toHaveLength(0);
  });

  test('HTTP mutations tolerate unknown extra body keys (ignored, not persisted)', async () => {
    // POST with junk keys: 2xx, node created, junk does not land on the node.
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Junk tolerant',
        content: 'body',
        junkExtraKey: 'ignored',
        anotherUnknown: { nested: true },
      }),
    });
    expect(created.ok).toBe(true);
    const afterAdd = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
    expect(JSON.stringify(afterAdd)).not.toContain('junkExtraKey');
    expect(JSON.stringify(afterAdd)).not.toContain('anotherUnknown');

    // PATCH with junk keys alongside a real field: 2xx, real field applied,
    // junk dropped.
    const patched = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Renamed', junkExtraKey: 'still ignored' }),
    });
    expect(patched.ok).toBe(true);
    const afterPatch = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
    expect(afterPatch.data.title).toBe('Renamed');
    expect(JSON.stringify(afterPatch)).not.toContain('junkExtraKey');

    // DELETE ignores any request body entirely.
    const removed = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ junkExtraKey: 'ignored' }),
    });
    expect(removed.ok).toBe(true);
  });

  // ── Pinned asymmetries (current legacy behavior — change deliberately) ────

  test('removing a missing node errors on every surface (HTTP 404, daemon MCP, local MCP)', async () => {
    // HTTP: DELETE on a missing id is a hard 404 with { ok: false, error }.
    const httpResponse = await fetch(`${baseUrl}/api/canvas/node/node-that-never-existed`, { method: 'DELETE' });
    expect(httpResponse.status).toBe(404);
    const httpBody = (await httpResponse.json()) as { ok: boolean; error: string };
    expect(httpBody.ok).toBe(false);
    expect(httpBody.error).toContain('not found');

    // MCP via daemon (RemoteCanvasAccess): the 404 from the HTTP DELETE is
    // surfaced as a thrown error, so the tool call comes back isError.
    const remoteResult = await callMcp('canvas_node', { action: 'remove', id: 'node-that-never-existed' });
    expect(remoteResult.isError).toBe(true);
    expect(textOf(remoteResult)).toContain('not found');

    // MCP via local access (no daemon): plan-005 slice 1 deliberately unified
    // the old silent local success with the 404 path — node.remove on a
    // missing id now errors on ALL surfaces (see docs/plans/plan-005 and the
    // CHANGELOG note).
    const localWorkspace = createTestWorkspace('pmx-canvas-op-parity-local-mcp-');
    const localPort = await getAvailablePort();
    const localEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (typeof value === 'string') localEnv[key] = value;
    }
    // Strip the daemon URL so the subprocess genuinely runs in local mode.
    delete localEnv.PMX_CANVAS_URL;
    localEnv.PMX_CANVAS_DISABLE_BROWSER_OPEN = '1';
    localEnv.PMX_CANVAS_PORT = String(localPort);
    const localTransport = new StdioClientTransport({
      command: 'bun',
      args: ['run', mcpServerPath],
      cwd: localWorkspace,
      env: localEnv,
      stderr: 'pipe',
    });
    const localClient = new Client({ name: 'pmx-canvas-local-asymmetry-test', version: '0.1.0' }, { capabilities: {} });
    await localClient.connect(localTransport);
    try {
      const localResult = (await localClient.callTool({
        name: 'canvas_node',
        arguments: { action: 'remove', id: 'node-that-never-existed' },
      })) as ToolResultShape;
      expect(localResult.isError).toBe(true);
      expect(textOf(localResult)).toContain('not found');
    } finally {
      await localTransport.close();
      rmSync(localWorkspace, { recursive: true, force: true });
    }
  }, 30000);

  test('ASYMMETRY: HTTP PATCH on a webpage node stamps data.titleSource = "user" when the title changes', async () => {
    // Pinned for HTTP only. SDK updateNode has no webpage titleSource
    // special-casing today; we deliberately do NOT assert the SDK lacks it —
    // only that the HTTP behavior keeps working.
    canvasState.addNode(
      makeNode({
        id: 'parity-webpage-title',
        type: 'webpage',
        data: { url: 'http://127.0.0.1:1/never-fetched', title: 'Page title', titleSource: 'page' },
      }),
    );

    const patched = await fetch(`${baseUrl}/api/canvas/node/parity-webpage-title`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Human title' }),
    });
    expect(patched.ok).toBe(true);

    const node = await jsonRequest<SerializedNodeShape>('/api/canvas/node/parity-webpage-title');
    expect(node.data.title).toBe('Human title');
    expect(node.data.titleSource).toBe('user');
  });

  test('ASYMMETRY: HTTP accepts top-level `html` on POST and PATCH for html nodes', async () => {
    // Pinned for HTTP only (report #53 parity behavior). SDK updateNode has
    // no top-level html mapping; that gap is not asserted here.
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'HTML parity', html: '<p>before</p>' }),
    });
    expect(created.ok).toBe(true);
    const afterAdd = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
    expect(afterAdd.data.html).toBe('<p>before</p>');

    const patched = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<p>after</p>' }),
    });
    expect(patched.ok).toBe(true);
    const afterPatch = await jsonRequest<SerializedNodeShape>(`/api/canvas/node/${created.id}`);
    expect(afterPatch.data.html).toBe('<p>after</p>');
  });
});
