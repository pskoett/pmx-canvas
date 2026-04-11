import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

interface CanvasStateResponse {
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
  edges: Array<{ id: string; from: string; to: string; type: string }>;
}

interface WorkbenchWebViewStatusResponse {
  supported: boolean;
  active: boolean;
  headlessOnly: true;
  url: string | null;
  backend: 'webkit' | 'chrome' | null;
  width: number | null;
  height: number | null;
  dataStoreDir: string | null;
  startedAt: string | null;
  lastError: string | null;
}

describe('canvas server HTTP API', () => {
  let workspaceRoot = '';
  let baseUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return await response.json() as T;
  }

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-api-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4527 });
    if (!base) {
      throw new Error('Failed to start canvas server for tests.');
    }
    baseUrl = base;
  });

  afterAll(() => {
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();
  });

  test('supports node CRUD, markdown rendering, and search', async () => {
    const render = await jsonRequest<{ html: string }>('/api/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# Canvas heading' }),
    });
    expect(render.html).toContain('<h1>Canvas heading</h1>');

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'API note',
        content: '# Hello',
        x: 320,
        y: 180,
      }),
    });

    const fetchedNode = await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(fetchedNode.id).toBe(created.id);
    expect(fetchedNode.data.title).toBe('API note');

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated API note',
        content: 'Updated body',
        collapsed: true,
      }),
    });

    const search = await jsonRequest<{ query: string; results: Array<{ id: string }> }>('/api/canvas/search?q=Updated');
    expect(search.results.map((result) => result.id)).toContain(created.id);

    const deleted = await jsonRequest<{ ok: boolean; removed: string }>(`/api/canvas/node/${created.id}`, {
      method: 'DELETE',
    });
    expect(deleted.removed).toBe(created.id);

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  test('supports edges, snapshots, clear, and pinned context over HTTP', async () => {
    const firstNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'First', content: 'One', x: 120, y: 120 }),
    });
    const secondNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Second', content: 'Two', x: 620, y: 120 }),
    });

    const edge = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: firstNode.id, to: secondNode.id, type: 'relation' }),
    });
    expect(edge.id).toContain('edge-');

    const pins = await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [firstNode.id, 'missing-node'] }),
    });
    expect(pins.count).toBe(1);

    const pinnedContext = await jsonRequest<{ count: number; nodeIds: string[] }>('/api/canvas/pinned-context');
    expect(pinnedContext.count).toBe(1);
    expect(pinnedContext.nodeIds).toEqual([firstNode.id]);

    const snapshotSave = await jsonRequest<{ ok: boolean; snapshot: { id: string; name: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'before-clear' }),
    });
    expect(snapshotSave.snapshot.name).toBe('before-clear');

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${firstNode.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Changed title' }),
    });

    await jsonRequest<{ ok: boolean }>('/api/canvas/clear', {
      method: 'POST',
    });

    const clearedState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(clearedState.nodes).toEqual([]);
    expect(clearedState.edges).toEqual([]);

    await jsonRequest<{ ok: boolean }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}`, {
      method: 'POST',
    });

    const restoredState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(restoredState.nodes).toHaveLength(2);
    expect(restoredState.edges).toHaveLength(1);
    expect(restoredState.nodes.find((node) => node.id === firstNode.id)?.data.title).toBe('First');
  });

  test('reports Bun.WebView automation status and fails cleanly when unsupported', async () => {
    const initialStatus = await jsonRequest<WorkbenchWebViewStatusResponse>('/api/workbench/webview');
    expect(initialStatus.active).toBe(false);
    expect(initialStatus.headlessOnly).toBe(true);

    const startResponse = await fetch(`${baseUrl}/api/workbench/webview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: 'chrome', width: 1440, height: 900 }),
    });

    if (!initialStatus.supported) {
      expect(startResponse.status).toBe(501);
      const unsupported = await startResponse.json() as {
        ok: boolean;
        error: string;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(unsupported.ok).toBe(false);
      expect(unsupported.error).toContain('Bun.WebView');
      expect(unsupported.webview.active).toBe(false);
      expect(unsupported.webview.lastError).toContain('Bun.WebView');
      return;
    }

    expect(startResponse.ok).toBe(true);
    const started = await startResponse.json() as {
      ok: boolean;
      webview: WorkbenchWebViewStatusResponse;
    };
    expect(started.ok).toBe(true);
    expect(started.webview.active).toBe(true);
    expect(started.webview.width).toBe(1440);
    expect(started.webview.height).toBe(900);
    expect(started.webview.url).toContain('/workbench');

    const stopResponse = await fetch(`${baseUrl}/api/workbench/webview`, {
      method: 'DELETE',
    });
    expect(stopResponse.ok).toBe(true);
    const stopped = await stopResponse.json() as {
      ok: boolean;
      stopped: boolean;
      webview: WorkbenchWebViewStatusResponse;
    };
    expect(stopped.ok).toBe(true);
    expect(stopped.stopped).toBe(true);
    expect(stopped.webview.active).toBe(false);
  });

  test('builds web artifacts over HTTP and serves the generated html route', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const build = await jsonRequest<{
      ok: boolean;
      path: string;
      projectPath: string;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
    }>('/api/canvas/web-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'HTTP Artifact',
        appTsx: 'export default function App() { return <main>HTTP Artifact</main>; }',
        projectPath: 'artifacts/.web-artifacts/http-artifact',
        outputPath: 'artifacts/http-artifact.html',
        initScriptPath,
        bundleScriptPath,
      }),
    });

    expect(build.openedInCanvas).toBe(true);
    expect(build.nodeId).toBeDefined();
    expect(build.url).toContain('/artifact?path=');
    expect(build.path).toContain('/artifacts/http-artifact.html');
    expect(build.projectPath).toContain('/artifacts/.web-artifacts/http-artifact');

    const artifactResponse = await fetch(`${baseUrl}${build.url}`);
    expect(artifactResponse.ok).toBe(true);
    expect(artifactResponse.headers.get('content-type')).toContain('text/html');
    const artifactHtml = await artifactResponse.text();
    expect(artifactHtml).toContain('HTTP Artifact');

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const artifactNode = layout.nodes.find((node) => node.id === build.nodeId);
    expect(artifactNode?.type).toBe('mcp-app');
    expect(artifactNode?.data.path).toBe(build.path);
  });

  test('creates json-render and graph nodes over HTTP and serves their viewer routes', async () => {
    const jsonRender = await jsonRequest<{
      ok: boolean;
      id: string;
      url: string;
      spec: { root: string; elements: Record<string, unknown> };
    }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Ops Dashboard',
        spec: {
          root: 'card',
          elements: {
            card: {
              type: 'Card',
              props: { title: 'Ops Dashboard', description: null, maxWidth: 'full', centered: false },
              children: ['copy'],
            },
            copy: {
              type: 'Text',
              props: { text: 'Live service summary', variant: 'lead' },
              children: [],
            },
          },
        },
      }),
    });

    const jsonViewer = await fetch(`${baseUrl}${jsonRender.url}`);
    expect(jsonViewer.ok).toBe(true);
    expect(jsonViewer.headers.get('content-type')).toContain('text/html');
    expect(await jsonViewer.text()).toContain('Ops Dashboard');

    const graph = await jsonRequest<{
      ok: boolean;
      id: string;
      url: string;
      spec: { root: string; elements: Record<string, unknown> };
    }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Deploy Trend',
        graphType: 'line',
        data: [
          { day: 'Mon', value: 3 },
          { day: 'Tue', value: 5 },
          { day: 'Wed', value: 4 },
        ],
        xKey: 'day',
        yKey: 'value',
      }),
    });

    const graphViewer = await fetch(`${baseUrl}${graph.url}`);
    expect(graphViewer.ok).toBe(true);
    expect(graphViewer.headers.get('content-type')).toContain('text/html');
    const graphHtml = await graphViewer.text();
    expect(graphHtml).toContain('Deploy Trend');
    expect(graphHtml).toContain('LineChart');

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(layout.nodes.find((node) => node.id === jsonRender.id)?.type).toBe('json-render');
    expect(layout.nodes.find((node) => node.id === graph.id)?.type).toBe('graph');
  }, 15_000);
});
