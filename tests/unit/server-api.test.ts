import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  viewport?: { x: number; y: number; scale: number };
  nodes: Array<{
    id: string;
    type: string;
    pinned?: boolean;
    dockPosition?: 'left' | 'right' | null;
    data: Record<string, unknown>;
  }>;
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
  let webpageServer: ReturnType<typeof Bun.serve> | null = null;
  let webpageOrigin = '';

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

    webpageServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/article') {
          const version = url.searchParams.get('v') ?? '1';
          const title = version === '2' ? 'Canvas Webpage v2' : 'Canvas Webpage v1';
          const body = version === '2'
            ? 'Updated webpage content for saved canvas refresh.'
            : 'Initial webpage content for canvas grounding.';
          return new Response(`<!doctype html>
<html>
  <head>
    <title>${title}</title>
    <meta name="description" content="Webpage node fixture ${version}" />
    <meta property="og:image" content="/image-${version}.png" />
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${body}</p>
      <p>Supplemental text block ${version}.</p>
    </main>
  </body>
</html>`, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
        return new Response('missing', { status: 404 });
      },
    });
    webpageOrigin = `http://127.0.0.1:${webpageServer.port}`;
  });

  afterAll(() => {
    stopCanvasServer();
    webpageServer?.stop(true);
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

    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>('/api/canvas/node', {
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
    expect(created.position).toEqual({ x: 320, y: 180 });
    expect(created.size).toEqual({ width: 360, height: 200 });

    const fetchedNode = await jsonRequest<{ id: string; title: string | null; content: string | null; data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(fetchedNode.id).toBe(created.id);
    expect(fetchedNode.title).toBe('API note');
    expect(fetchedNode.content).toBe('# Hello');
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

  test('creates path-backed file nodes over HTTP and uses shared arrange behavior', async () => {
    const filePath = join(workspaceRoot, 'server-api-file.ts');
    writeFileSync(filePath, 'export const value = 1;\n', 'utf-8');

    const fileNode = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: filePath }),
    });

    const markdownNode = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Arrange me', width: 360, height: 200 }),
    });

    const createdFile = await jsonRequest<{ id: string; position: { x: number; y: number }; path: string | null; content: string | null; data: Record<string, unknown> }>(`/api/canvas/node/${fileNode.id}`);
    expect(createdFile.path).toBe(filePath);
    expect(createdFile.content).toBe('export const value = 1;\n');
    expect(createdFile.data.path).toBe(filePath);
    expect(createdFile.data.fileContent).toBe('export const value = 1;\n');

    const arrange = await jsonRequest<{ ok: boolean; arranged: number; layout: string }>('/api/canvas/arrange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'column' }),
    });
    expect(arrange.ok).toBe(true);
    expect(arrange.arranged).toBe(2);
    expect(arrange.layout).toBe('column');

    const arrangedFile = await jsonRequest<{ id: string; position: { x: number; y: number } }>(`/api/canvas/node/${fileNode.id}`);
    const arrangedMarkdown = await jsonRequest<{ id: string; position: { x: number; y: number } }>(`/api/canvas/node/${markdownNode.id}`);
    expect(arrangedFile.position).toEqual({ x: 40, y: 80 });
    expect(arrangedMarkdown.position).toEqual({ x: 40, y: 304 });
  });

  test('group create preserves child positions by default and supports explicit manual frames with child layout', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'DCP O1',
        x: 680,
        y: 160,
        width: 360,
        height: 200,
      }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'DCP O2',
        x: 680,
        y: 420,
        width: 360,
        height: 200,
      }),
    });

    const grouped = await jsonRequest<{
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
      data: Record<string, unknown>;
    }>('/api/canvas/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'DCP Group',
        childIds: [first.id, second.id],
      }),
    });

    const groupedFirst = await jsonRequest<{ position: { x: number; y: number }; data: Record<string, unknown> }>(`/api/canvas/node/${first.id}`);
    const groupedSecond = await jsonRequest<{ position: { x: number; y: number }; data: Record<string, unknown> }>(`/api/canvas/node/${second.id}`);
    expect(groupedFirst.position).toEqual({ x: 680, y: 160 });
    expect(groupedSecond.position).toEqual({ x: 680, y: 420 });
    expect(groupedFirst.data.parentGroup).toBe(grouped.id);
    expect(groupedSecond.data.parentGroup).toBe(grouped.id);
    expect(grouped.data.children).toEqual([first.id, second.id]);
    expect(grouped.position.x).toBeLessThanOrEqual(680);
    expect(grouped.position.y).toBeLessThanOrEqual(160);

    const looseA = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Loose A',
        x: 1200,
        y: 200,
        width: 260,
        height: 180,
      }),
    });
    const looseB = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Loose B',
        x: 1500,
        y: 560,
        width: 260,
        height: 180,
      }),
    });

    const manualGroup = await jsonRequest<{
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>('/api/canvas/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Manual Frame',
        x: 40,
        y: 60,
        width: 900,
        height: 700,
        childIds: [looseA.id, looseB.id],
        childLayout: 'column',
      }),
    });

    expect(manualGroup.position).toEqual({ x: 40, y: 60 });
    expect(manualGroup.size).toEqual({ width: 900, height: 700 });

    const manualChildA = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${looseA.id}`);
    const manualChildB = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${looseB.id}`);
    expect(manualChildA.position.x).toBeGreaterThanOrEqual(80);
    expect(manualChildA.position.y).toBeGreaterThanOrEqual(132);
    expect(manualChildB.position.y).toBeGreaterThan(manualChildA.position.y);
  });

  test('batch operations support assigned refs and validate distinguishes containment from collisions', async () => {
    const batch = await jsonRequest<{
      ok: boolean;
      results: Array<Record<string, unknown>>;
      refs: Record<string, Record<string, unknown>>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            assign: 'child',
            args: {
              type: 'markdown',
              title: 'Batch child',
              x: 240,
              y: 200,
              width: 280,
              height: 180,
            },
          },
          {
            op: 'group.create',
            assign: 'frame',
            args: {
              title: 'Batch frame',
              childIds: ['$child.id'],
            },
          },
          {
            op: 'node.add',
            assign: 'peer',
            args: {
              type: 'markdown',
              title: 'Batch peer',
              x: 680,
              y: 200,
            },
          },
          {
            op: 'edge.add',
            args: {
              from: '$child.id',
              to: '$peer.id',
              type: 'relation',
            },
          },
        ],
      }),
    });

    expect(batch.ok).toBe(true);
    expect(batch.results).toHaveLength(4);
    expect(typeof batch.refs.child?.id).toBe('string');
    expect(typeof batch.refs.frame?.id).toBe('string');

    const validation = await jsonRequest<{
      ok: boolean;
      collisions: unknown[];
      containments: Array<{ groupId: string; childId: string }>;
      containmentViolations: unknown[];
      summary: { collisions: number; containments: number };
    }>('/api/canvas/validate');
    expect(validation.ok).toBe(true);
    expect(validation.collisions).toEqual([]);
    expect(validation.containmentViolations).toEqual([]);
    expect(validation.summary.containments).toBeGreaterThanOrEqual(1);
    expect(validation.containments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: String(batch.refs.frame?.id),
        childId: String(batch.refs.child?.id),
      }),
    ]));

    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Collision node',
        x: 240,
        y: 200,
        width: 280,
        height: 180,
      }),
    });

    const invalid = await jsonRequest<{
      ok: boolean;
      collisions: Array<{ a: string; b: string }>;
      summary: { collisions: number };
    }>('/api/canvas/validate');
    expect(invalid.ok).toBe(false);
    expect(invalid.summary.collisions).toBeGreaterThanOrEqual(1);
    expect(invalid.collisions.length).toBeGreaterThanOrEqual(1);
  });

  test('batch operations support webpage nodes and surface fetch status without failing the batch', async () => {
    const successBatch = await jsonRequest<{
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        ok: boolean;
        id: string;
        type: string;
        url: string | null;
        content: string | null;
        fetch: { ok: boolean; error?: string };
        error?: string;
      }>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            assign: 'page',
            args: {
              type: 'webpage',
              content: `${webpageOrigin}/article?v=1`,
            },
          },
        ],
      }),
    });

    expect(successBatch.ok).toBe(true);
    expect(successBatch.results).toHaveLength(1);
    expect(successBatch.results[0]?.type).toBe('webpage');
    expect(successBatch.results[0]?.url).toBe(`${webpageOrigin}/article?v=1`);
    expect(successBatch.results[0]?.content).toContain('Initial webpage content for canvas grounding.');
    expect(successBatch.results[0]?.fetch.ok).toBe(true);
    expect(successBatch.results[0]?.error).toBeUndefined();
    expect(typeof successBatch.refs.page?.id).toBe('string');

    const failedBatch = await jsonRequest<{
      ok: boolean;
      results: Array<{
        ok: boolean;
        id: string;
        type: string;
        fetch: { ok: boolean; error?: string };
        error?: string;
      }>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            args: {
              type: 'webpage',
              content: 'http://127.0.0.1:9/unreachable',
            },
          },
        ],
      }),
    });

    expect(failedBatch.ok).toBe(true);
    expect(failedBatch.results[0]?.type).toBe('webpage');
    expect(failedBatch.results[0]?.fetch.ok).toBe(false);
    expect(failedBatch.results[0]?.fetch.error).toBeTruthy();
    expect(failedBatch.results[0]?.error).toBe(failedBatch.results[0]?.fetch.error);
  });

  test('creates and refreshes webpage nodes over HTTP with cached text context', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string; error?: string; fetch: { ok: boolean; error?: string } }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        content: `${webpageOrigin}/article?v=1`,
      }),
    });
    expect(created.fetch.ok).toBe(true);

    const node = await jsonRequest<{ id: string; type: string; url: string | null; content: string | null; data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.type).toBe('webpage');
    expect(node.url).toBe(`${webpageOrigin}/article?v=1`);
    expect(node.content).toContain('Initial webpage content for canvas grounding.');
    expect(node.data.url).toBe(`${webpageOrigin}/article?v=1`);
    expect(node.data.pageTitle).toBe('Canvas Webpage v1');
    expect(node.data.status).toBe('ready');
    expect(String(node.data.content)).toContain('Initial webpage content for canvas grounding.');

    const search = await jsonRequest<{ results: Array<{ id: string }> }>(`/api/canvas/search?q=${encodeURIComponent('grounding')}`);
    expect(search.results.map((result) => result.id)).toContain(created.id);

    const refreshed = await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${webpageOrigin}/article?v=2` }),
    });
    expect(refreshed.ok).toBe(true);

    const updated = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(updated.data.url).toBe(`${webpageOrigin}/article?v=2`);
    expect(updated.data.pageTitle).toBe('Canvas Webpage v2');
    expect(String(updated.data.content)).toContain('Updated webpage content for saved canvas refresh.');
  });

  test('surfaces webpage fetch failures in the create response while preserving the error node', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      error?: string;
      fetch: { ok: boolean; error?: string };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        content: 'http://127.0.0.1:9/unreachable',
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.fetch.ok).toBe(false);
    expect(created.fetch.error).toBeDefined();
    expect(created.error).toBe(created.fetch.error);

    const node = await jsonRequest<{ type: string; data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.type).toBe('webpage');
    expect(node.data.status).toBe('error');
    expect(node.data.error).toBe(created.fetch.error);
  });

  test('rejects invalid single-node patch geometry and skips invalid batch updates', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Validation node', x: 80, y: 80 }),
    });

    const invalidPatch = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: { width: -10, height: 100 } }),
    });
    expect(invalidPatch.status).toBe(400);
    const invalidPatchBody = await invalidPatch.json() as { ok: boolean; error: string };
    expect(invalidPatchBody.ok).toBe(false);
    expect(invalidPatchBody.error).toContain('greater than zero');

    const batchResult = await jsonRequest<{ ok: boolean; applied: number; skipped: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [
          { id: created.id, position: { x: 200, y: 240 } },
          { id: created.id, size: { width: 0, height: 50 } },
          { id: created.id, position: { x: Number.NaN, y: 10 } },
          { id: 'missing-node', position: { x: 10, y: 10 } },
        ],
      }),
    });
    expect(batchResult.applied).toBe(1);
    expect(batchResult.skipped).toBe(1);

    const updated = await jsonRequest<{ id: string; position: { x: number; y: number }; size: { width: number; height: number } }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 200, y: 240 });
    expect(updated.size).toEqual({ width: 360, height: 200 });
  });

  test('persists node pinned and dock state through single-node patch and batch updates', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Patch target', x: 80, y: 80 }),
    });

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true, dockPosition: 'left' }),
    });

    const patched = await jsonRequest<{
      id: string;
      pinned: boolean;
      dockPosition: 'left' | 'right' | null;
    }>(`/api/canvas/node/${created.id}`);
    expect(patched.pinned).toBe(true);
    expect(patched.dockPosition).toBe('left');

    const batchResult = await jsonRequest<{ ok: boolean; applied: number; skipped: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: created.id, position: { x: 240, y: 320 }, collapsed: true, dockPosition: null }],
      }),
    });
    expect(batchResult.applied).toBe(1);

    const updated = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
      dockPosition: 'left' | 'right' | null;
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 240, y: 320 });
    expect(updated.collapsed).toBe(true);
    expect(updated.dockPosition).toBeNull();
  });

  test('records batch updates in history and supports undo/redo over HTTP', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'History target', x: 120, y: 120 }),
    });

    const batchResult = await jsonRequest<{ ok: boolean; applied: number; skipped: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: created.id, position: { x: 520, y: 420 }, collapsed: true }],
      }),
    });
    expect(batchResult.applied).toBe(1);

    const history = await jsonRequest<{
      text: string;
      entries: Array<{ operationType: string; description: string }>;
      canUndo: boolean;
      canRedo: boolean;
    }>('/api/canvas/history');
    expect(history.canUndo).toBe(true);
    expect(history.canRedo).toBe(false);
    expect(history.text).toContain('Updated 1 node (1 moved, 1 collapsed)');
    expect(history.entries.some((entry) => entry.operationType === 'batch' && entry.description === 'Updated 1 node (1 moved, 1 collapsed)')).toBe(true);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Updated 1 node (1 moved, 1 collapsed)');

    const reverted = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(reverted.position).toEqual({ x: 120, y: 120 });
    expect(reverted.collapsed).toBe(false);

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.ok).toBe(true);
    expect(redone.description).toContain('Updated 1 node (1 moved, 1 collapsed)');

    const replayed = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(replayed.position).toEqual({ x: 520, y: 420 });
    expect(replayed.collapsed).toBe(true);
  });

  test('records viewport changes in history and supports undo/redo over HTTP', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Viewport target', x: 640, y: 480 }),
    });

    const focused = await jsonRequest<{ ok: boolean; focused: string }>('/api/canvas/focus', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: created.id }),
    });
    expect(focused.focused).toBe(created.id);

    const afterFocus = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterFocus.viewport).toEqual({ x: 540, y: 380, scale: 1 });

    const history = await jsonRequest<{
      text: string;
      entries: Array<{ operationType: string; description: string }>;
      canUndo: boolean;
      canRedo: boolean;
    }>('/api/canvas/history');
    expect(history.text).toContain('Updated viewport');
    expect(history.entries.some((entry) => entry.operationType === 'viewport')).toBe(true);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.description).toContain('Updated viewport');

    const afterUndo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterUndo.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.description).toContain('Updated viewport');

    const afterRedo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterRedo.viewport).toEqual({ x: 540, y: 380, scale: 1 });
  });

  test('updates viewport directly over HTTP', async () => {
    const updated = await jsonRequest<{ ok: boolean }>('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 120, y: -80, scale: 1.5 }),
    });
    expect(updated.ok).toBe(true);

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.viewport).toEqual({ x: 120, y: -80, scale: 1.5 });
  });

  test('keeps file node cache metadata authoritative after file reload-style patching', async () => {
    const filePath = join(workspaceRoot, 'reload-target.ts');
    writeFileSync(filePath, 'export const before = 1;\n', 'utf-8');

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: filePath }),
    });

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: {
          fileContent: 'export const after = 2;\n',
          lineCount: 1,
          updatedAt: '2026-04-12T12:00:00.000Z',
        },
      }),
    });

    const fetched = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(fetched.data.fileContent).toBe('export const after = 2;\n');
    expect(fetched.data.lineCount).toBe(1);
    expect(fetched.data.updatedAt).toBe('2026-04-12T12:00:00.000Z');
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

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${secondNode.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: { x: 900, y: 640 } }),
    });

    const diff = await jsonRequest<{
      ok: boolean;
      text: string;
      diff: {
        modifiedNodes: Array<{ id: string; changes: string[] }>;
      };
    }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}/diff`);
    expect(diff.ok).toBe(true);
    expect(diff.text).toContain('Modified nodes (2):');
    expect(diff.diff.modifiedNodes.map((node) => node.id)).toEqual(expect.arrayContaining([firstNode.id, secondNode.id]));

    await jsonRequest<{ ok: boolean }>('/api/canvas/clear', {
      method: 'POST',
    });

    const clearedState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(clearedState.nodes).toEqual([]);
    expect(clearedState.edges).toEqual([]);
    expect(clearedState.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    const clearedPins = await jsonRequest<{ count: number; nodeIds: string[] }>('/api/canvas/pinned-context');
    expect(clearedPins.count).toBe(0);
    expect(clearedPins.nodeIds).toEqual([]);

    await jsonRequest<{ ok: boolean }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}`, {
      method: 'POST',
    });

    const restoredState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(restoredState.nodes).toHaveLength(2);
    expect(restoredState.edges).toHaveLength(1);
    expect(restoredState.nodes.find((node) => node.id === firstNode.id)?.data.title).toBe('First');
    expect(restoredState.nodes.find((node) => node.id === secondNode.id)?.position).toEqual({ x: 620, y: 120 });
  });

  test('accepts edge style and animation flags over HTTP', async () => {
    const firstNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Styled edge A' }),
    });
    const secondNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Styled edge B' }),
    });

    const edge = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: firstNode.id,
        to: secondNode.id,
        type: 'references',
        style: 'dotted',
        animated: true,
      }),
    });
    expect(edge.ok).toBe(true);

    const state = await jsonRequest<CanvasStateResponse & {
      edges: Array<{ id: string; type: string; style?: string; animated?: boolean }>;
    }>('/api/canvas/state');
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: edge.id,
        type: 'references',
        style: 'dotted',
        animated: true,
      }),
    ]));
  });

  test('covers group and ungroup HTTP routes', async () => {
    const firstNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Grouped A', x: 100, y: 100 }),
    });
    const secondNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Grouped B', x: 520, y: 160 }),
    });

    const createdGroup = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'API Group', childIds: [firstNode.id, secondNode.id] }),
    });

    const groupNode = await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${createdGroup.id}`);
    expect(groupNode.data.children).toEqual([firstNode.id, secondNode.id]);
    expect((await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${firstNode.id}`)).data.parentGroup).toBe(createdGroup.id);

    const ungrouped = await jsonRequest<{ ok: boolean; groupId: string }>('/api/canvas/group/ungroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: createdGroup.id }),
    });
    expect(ungrouped.groupId).toBe(createdGroup.id);

    const ungroupedGroup = await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${createdGroup.id}`);
    expect(ungroupedGroup.data.children).toEqual([]);
    expect((await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${firstNode.id}`)).data.parentGroup).toBeUndefined();

    const missingGroup = await fetch(`${baseUrl}/api/canvas/group/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: '', childIds: [] }),
    });
    expect(missingGroup.status).toBe(400);
  });

  test('covers duplicate, self-edge, and delete edge HTTP behavior', async () => {
    const firstNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge A', x: 140, y: 140 }),
    });
    const secondNode = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge B', x: 520, y: 140 }),
    });

    const edge = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/edge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: firstNode.id, to: secondNode.id, type: 'relation' }),
    });
    expect(edge.id).toContain('edge-');

    const duplicateEdge = await fetch(`${baseUrl}/api/canvas/edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: firstNode.id, to: secondNode.id, type: 'relation' }),
    });
    expect(duplicateEdge.status).toBe(400);

    const selfEdge = await fetch(`${baseUrl}/api/canvas/edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: firstNode.id, to: firstNode.id, type: 'relation' }),
    });
    expect(selfEdge.status).toBe(400);

    const removed = await jsonRequest<{ ok: boolean; removed: string }>('/api/canvas/edge', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edge.id }),
    });
    expect(removed.removed).toBe(edge.id);

    const missingDelete = await fetch(`${baseUrl}/api/canvas/edge`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edge_id: edge.id }),
    });
    expect(missingDelete.status).toBe(404);
  });

  test('reports Bun.WebView automation status and fails cleanly when unsupported', async () => {
    const initialStatus = await jsonRequest<WorkbenchWebViewStatusResponse>('/api/workbench/webview');
    expect(initialStatus.active).toBe(false);
    expect(initialStatus.headlessOnly).toBe(true);

    const requestedBackend =
      process.platform === 'darwin'
        ? 'webkit'
        : 'chrome';

    const startResponse = await fetch(`${baseUrl}/api/workbench/webview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: requestedBackend, width: 1440, height: 900 }),
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
  }, 15000);

  test('supports WebView evaluate, resize, and screenshot endpoints', async () => {
    const requestedBackend =
      process.platform === 'darwin'
        ? 'webkit'
        : 'chrome';

    const startResponse = await fetch(`${baseUrl}/api/workbench/webview/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ backend: requestedBackend, width: 900, height: 700 }),
    });

    if (typeof Bun.WebView !== 'function') {
      expect(startResponse.status).toBe(501);
      return;
    }

    expect(startResponse.ok).toBe(true);

    const evaluateResponse = await fetch(`${baseUrl}/api/workbench/webview/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: 'document.title' }),
    });
    expect(evaluateResponse.ok).toBe(true);
    const evaluated = await evaluateResponse.json() as { ok: boolean; value: unknown };
    expect(evaluated.ok).toBe(true);
    expect(evaluated.value).toBe('PMX Canvas');

    const resizeResponse = await fetch(`${baseUrl}/api/workbench/webview/resize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 1024, height: 768 }),
    });
    expect(resizeResponse.ok).toBe(true);
    const resized = await resizeResponse.json() as {
      ok: boolean;
      webview: WorkbenchWebViewStatusResponse;
    };
    expect(resized.ok).toBe(true);
    expect(resized.webview.width).toBe(1024);
    expect(resized.webview.height).toBe(768);

    const screenshotResponse = await fetch(`${baseUrl}/api/workbench/webview/screenshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'png' }),
    });
    expect(screenshotResponse.ok).toBe(true);
    expect(screenshotResponse.headers.get('Content-Type')).toBe('image/png');
    const screenshot = new Uint8Array(await screenshotResponse.arrayBuffer());
    expect(screenshot.byteLength).toBeGreaterThan(0);

    const stopResponse = await fetch(`${baseUrl}/api/workbench/webview`, {
      method: 'DELETE',
    });
    expect(stopResponse.ok).toBe(true);
  }, 15000);

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

    const darkJsonViewer = await fetch(`${baseUrl}${jsonRender.url}&theme=dark`);
    expect(darkJsonViewer.ok).toBe(true);
    const darkJsonHtml = await darkJsonViewer.text();
    expect(darkJsonHtml).toContain('"dark"');

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

  test('rejects invalid json-render payloads and invalid viewer requests', async () => {
    const missingTitle = await fetch(`${baseUrl}/api/canvas/json-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          root: 'card',
          elements: {
            card: {
              type: 'Card',
              props: { title: 'Missing title wrapper' },
              children: [],
            },
          },
        },
      }),
    });
    expect(missingTitle.status).toBe(400);
    expect((await missingTitle.json() as { ok: boolean; error: string }).error).toContain('Missing required field: title');

    const invalidSpec = await fetch(`${baseUrl}/api/canvas/json-render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Broken spec',
        spec: {},
      }),
    });
    expect(invalidSpec.status).toBe(400);
    expect((await invalidSpec.json() as { ok: boolean; error: string }).error).toContain('Missing root and elements');

    const missingNodeId = await fetch(`${baseUrl}/api/canvas/json-render/view`);
    expect(missingNodeId.status).toBe(400);
    expect(await missingNodeId.text()).toContain('Missing nodeId');

    const missingNode = await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=missing-node`);
    expect(missingNode.status).toBe(404);
    expect(await missingNode.text()).toContain('json-render node not found');
  });
});
