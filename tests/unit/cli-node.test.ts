import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('agent CLI node commands', () => {
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
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-node-');
    resetCanvasForTests(workspaceRoot);
    createFakeWebArtifactScripts(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4542, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI node tests.');
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

  test('node update merges partial geometry flags with existing node state', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Resize me',
        x: 80,
        y: 120,
        width: 360,
        height: 200,
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--width', '640', '--y', '240']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);

    const updated = await jsonRequest<{
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 80, y: 240 });
    expect(updated.size).toEqual({ width: 640, height: 200 });
  });

  test('node update supports explicit arrange locking', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Lock me',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--lock-arrange']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const node = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.data.arrangeLocked).toBe(true);
  });

  test('node add supports graph nodes from a JSON data file', async () => {
    const dataPath = join(workspaceRoot, 'graph-data.json');
    writeFileSync(dataPath, JSON.stringify([
      { label: 'Docs', value: 5 },
      { label: 'Tests', value: 8 },
      { label: 'Release', value: 3 },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'CLI Graph',
        '--graph-type',
        'bar',
        '--data-file',
        dataPath,
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--width',
        '880',
        '--height',
        '640',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      size: { width: number; height: number };
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('graph');
    expect(node.size).toEqual({ width: 880, height: 640 });
    expect((node.data.graphConfig as Record<string, unknown>).graphType).toBe('bar');
  });

  test('node add supports json-render nodes from a spec file', async () => {
    const specPath = join(workspaceRoot, 'dashboard.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'CLI Dashboard',
          },
          children: ['copy'],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Rendered from the CLI',
          },
          children: [],
        },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'json-render',
        '--title',
        'CLI Dashboard',
        '--spec-file',
        specPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('json-render');
    expect((node.data.spec as Record<string, unknown>).root).toBe('card');
  });

  test('web-artifact build creates a bundled artifact and opens it on the canvas', async () => {
    const appPath = join(workspaceRoot, 'App.tsx');
    const cssPath = join(workspaceRoot, 'index.css');
    writeFileSync(appPath, 'export default function App() { return <main>CLI Artifact</main>; }', 'utf-8');
    writeFileSync(cssPath, 'body { background: #123456; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'CLI Artifact',
        '--app-file',
        appPath,
        '--index-css-file',
        cssPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      path: string;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
    };
    expect(output.ok).toBe(true);
    expect(output.openedInCanvas).toBe(true);
    expect(output.nodeId).toBeDefined();
    expect(output.url).toContain('/artifact?path=');

    const node = output.nodeId
      ? await jsonRequest<{ type: string; data: Record<string, unknown> }>(`/api/canvas/node/${output.nodeId}`)
      : null;
    expect(node?.type).toBe('mcp-app');
    expect(node?.data.title).toBe('CLI Artifact');
  });

  test('node list and node get expose the same normalized title/content fields', async () => {
    const filePath = join(workspaceRoot, 'normalized-node.ts');
    writeFileSync(filePath, 'export const normalized = true;\n', 'utf-8');

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: filePath }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'file']);
      await runAgentCli(['node', 'get', created.id]);
    } finally {
      console.log = originalLog;
    }

    const listed = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    }>;
    const fetched = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    };

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: created.id,
      title: 'normalized-node.ts',
      content: 'export const normalized = true;\n',
      path: filePath,
    }));
    expect(fetched).toEqual(expect.objectContaining({
      id: created.id,
      title: listed[0]?.title,
      content: listed[0]?.content,
      path: listed[0]?.path,
    }));
  });

  test('snapshot diff works from the CLI', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Snapshot target', content: 'before' }),
    });
    const snapshot = await jsonRequest<{ ok: boolean; snapshot: { id: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cli-snapshot' }),
    });
    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'after' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['snapshot', 'diff', snapshot.snapshot.id]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      text: string;
    };
    expect(output.ok).toBe(true);
    expect(output.text).toContain('Modified nodes (1):');
    expect(output.text).toContain('content changed');
  });

  test('edge add supports style and animated flags', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge start' }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge end' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'edge',
        'add',
        '--from',
        first.id,
        '--to',
        second.id,
        '--type',
        'references',
        '--style',
        'dashed',
        '--animated',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);

    const state = await jsonRequest<{
      edges: Array<{ id: string; style?: string; animated?: boolean }>;
    }>('/api/canvas/state');
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: output.id,
        style: 'dashed',
        animated: true,
      }),
    ]));
  });
});
