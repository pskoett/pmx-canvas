import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canvasState, type PersistedBlobRef } from '../../src/server/canvas-state.ts';
import { MARKDOWN_NODE_DEFAULT_SIZE, MCP_APP_NODE_DEFAULT_SIZE } from '../../src/server/canvas-operations.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { emitPrimaryWorkbenchEvent, startCanvasServer, stopCanvasServer, wrapCanvasAutomationScript } from '../../src/server/server.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  readPersistedCanvasState,
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
  annotations?: Array<{ id: string; type?: string; color: string; pointCount?: number; text?: string }>;
}

interface BlobSummary {
  stored: 'sidecar';
  path: string;
  bytes: number;
  jsonBytes: number;
  sha256: string;
}

function isBlobSummary(value: unknown): value is BlobSummary {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { stored?: unknown }).stored === 'sidecar';
}

function isBlobReference(value: unknown): value is PersistedBlobRef {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as { __pmxCanvasBlob?: unknown }).__pmxCanvasBlob === 'v1';
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

async function waitForNode(
  baseUrl: string,
  predicate: (node: CanvasStateResponse['nodes'][number]) => boolean,
  attempts = 60,
  delayMs = 100,
): Promise<CanvasStateResponse['nodes'][number] | null> {
  for (let index = 0; index < attempts; index++) {
    const response = await fetch(`${baseUrl}/api/canvas/state`);
    if (response.ok) {
      const state = await response.json() as CanvasStateResponse;
      const match = state.nodes.find(predicate);
      if (match) return match;
    }
    await Bun.sleep(delayMs);
  }
  return null;
}

const fixtureMcpAppServerPath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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
    const base = startCanvasServer({ workspaceRoot, port: 0 });
    if (!base) {
      throw new Error('Failed to start canvas server for tests.');
    }
    baseUrl = base;

    webpageServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === '/article-long') {
          const sections = Array.from({ length: 24 }, (_, index) =>
            `<p>Long-form webpage section ${index + 1}. This is persistent context for agent grounding and should survive truncation better than the old excerpt-only path.</p>`,
          ).join('\n');
          return new Response(`<!doctype html>
<html>
  <head>
    <title>Long Canvas Webpage</title>
    <meta name="description" content="Long webpage node fixture" />
  </head>
  <body>
    <main>
      <h1>Long Canvas Webpage</h1>
      ${sections}
    </main>
  </body>
</html>`, {
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
          });
        }
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
        if (url.pathname === '/article-frame-blocked') {
          return new Response(`<!doctype html>
<html>
  <head>
    <title>Frame Blocked Fixture</title>
    <meta name="description" content="Frame blocked webpage node fixture" />
  </head>
  <body>
    <main>
      <h1>Frame Blocked Fixture</h1>
      <p>This page is readable by the server but not embeddable in an iframe.</p>
    </main>
  </body>
</html>`, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'X-Frame-Options': 'SAMEORIGIN',
            },
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
      canvasState.setTheme('dark');
    });
    canvasState.clearAllSnapshots();
    mutationHistory.reset();
  });

  test('wraps WebView script bodies in an async IIFE', async () => {
    const run = new Function(
      `return ${wrapCanvasAutomationScript('const value = await Promise.resolve("async-ok"); return value;')}`,
    ) as () => Promise<string>;

    expect(await run()).toBe('async-ok');
  });

  test('serves generated frame documents through same-origin URLs', async () => {
    const created = await jsonRequest<{ ok: boolean; url: string }>('/api/canvas/frame-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<!doctype html><main>Frame document fixture</main>',
        sandbox: 'allow-scripts allow-popups',
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.url).toStartWith('/api/canvas/frame-documents/');

    const response = await fetch(`${baseUrl}${created.url}`);
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('content-security-policy')).toBe('sandbox allow-scripts allow-popups');
    expect(await response.text()).toContain('Frame document fixture');
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
      nodeId: string;
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
    expect(created.size).toEqual(MARKDOWN_NODE_DEFAULT_SIZE);
    // HTTP/CLI node-create exposes both `id` and a `nodeId` alias.
    expect(created.nodeId).toBe(created.id);

    const appNode = await jsonRequest<{ id: string; size: { width: number; height: number } }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'mcp-app', title: 'API app', content: '/api/canvas/frame-documents/test' }),
    });
    expect(appNode.size).toEqual(MCP_APP_NODE_DEFAULT_SIZE);

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
    await jsonRequest<{ ok: boolean; removed: string }>(`/api/canvas/node/${appNode.id}`, {
      method: 'DELETE',
    });

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(layout.nodes).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  test('graph create accepts heightPx / nodeHeight as node-frame-height aliases (#48 follow-up)', async () => {
    const base = { graphType: 'bar', data: [{ label: 'A', value: 1 }], xKey: 'label', yKey: 'value' };
    const viaHeightPx = await jsonRequest<{ id: string; size: { height: number } }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, title: 'PX', heightPx: 320 }),
    });
    expect(viaHeightPx.size.height).toBe(320);
    const viaNodeHeight = await jsonRequest<{ id: string; size: { height: number } }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...base, title: 'NH', nodeHeight: 280 }),
    });
    expect(viaNodeHeight.size.height).toBe(280);
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${viaHeightPx.id}`, { method: 'DELETE' });
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${viaNodeHeight.id}`, { method: 'DELETE' });
  });

  test('persists data.userResized through PATCH so content-fit stays off after reconcile (#48 review)', async () => {
    const graph = await jsonRequest<{ id: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'G', graphType: 'bar', data: [{ label: 'A', value: 1 }], xKey: 'label', yKey: 'value' }),
    });
    // A manual resize round-trips userResized as a data merge (mirrors the client).
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${graph.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { userResized: true } }),
    });
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const node = state.nodes.find((n) => n.id === graph.id);
    // The flag survives in node.data so the next layout reconcile won't re-enable
    // content-fit and undo the user's manual size.
    expect(node?.data.userResized).toBe(true);
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${graph.id}`, { method: 'DELETE' });
  });

  test('supports annotation create and delete through HTTP', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      annotation: { id: string; color: string; pointCount: number; text: string | null };
    }>('/api/canvas/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: [{ x: 10, y: 20 }, { x: 40, y: 80 }],
        color: 'currentColor',
        width: 4,
      }),
    });

    expect(created.annotation.color).toBe('currentColor');
    expect(created.annotation.pointCount).toBe(2);
    expect(created.annotation.text).toBeNull();
    expect((await jsonRequest<CanvasStateResponse>('/api/canvas/state')).annotations?.map((annotation) => annotation.id)).toEqual([created.annotation.id]);

    const removed = await jsonRequest<{ ok: boolean; removed: string }>(`/api/canvas/annotation/${created.annotation.id}`, {
      method: 'DELETE',
    });

    expect(removed.removed).toBe(created.annotation.id);
    expect((await jsonRequest<CanvasStateResponse>('/api/canvas/state')).annotations).toEqual([]);
  });

  test('supports text annotations through HTTP', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      annotation: { id: string; type: string; pointCount: number; text: string | null; label: string | null };
    }>('/api/canvas/annotation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'text',
        points: [{ x: 10, y: 20 }],
        color: 'currentColor',
        width: 24,
        text: 'Investigate intent',
      }),
    });

    expect(created.annotation.type).toBe('text');
    expect(created.annotation.pointCount).toBe(1);
    expect(created.annotation.text).toBe('Investigate intent');
    expect(created.annotation.label).toBe('Investigate intent');

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.annotations?.[0]?.type).toBe('text');
    expect(state.annotations?.[0]?.text).toBe('Investigate intent');
  });

  test('accepts flat and nested geometry and returns nested node payloads', async () => {
    const nestedCreate = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string; position: { x: number; y: number }; size: { width: number; height: number } };
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Nested geometry',
        position: { x: 440, y: 260 },
        size: { width: 500, height: 280 },
      }),
    });

    expect(nestedCreate.node.id).toBe(nestedCreate.id);
    expect(nestedCreate.position).toEqual({ x: 440, y: 260 });
    expect(nestedCreate.size).toEqual({ width: 500, height: 280 });
    expect(nestedCreate.node.position).toEqual(nestedCreate.position);
    expect(nestedCreate.node.size).toEqual(nestedCreate.size);

    const flatPatch = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string; position: { x: number; y: number }; size: { width: number; height: number } };
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(`/api/canvas/node/${nestedCreate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 600, height: 360 }),
    });

    expect(flatPatch.node.id).toBe(nestedCreate.id);
    expect(flatPatch.position).toEqual({ x: 600, y: 260 });
    expect(flatPatch.size).toEqual({ width: 500, height: 360 });
  });

  test('image nodes accept real image files and keep the server responsive', async () => {
    const imagePath = join(workspaceRoot, 'local-image.png');
    writeFileSync(imagePath, tinyPng);

    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      kind: string;
      data: { mimeType: string };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', content: imagePath, title: 'Local image' }),
    });

    expect(created).toMatchObject({ ok: true, kind: 'image' });
    expect(created.data.mimeType).toBe('image/png');

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.nodes.some((node) => node.id === created.id && node.type === 'image')).toBe(true);
  });

  test('image nodes accept path as a compatibility alias for content', async () => {
    const imagePath = join(workspaceRoot, 'local-image-path.png');
    writeFileSync(imagePath, tinyPng);

    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      kind: string;
      data: { src: string; path: string; mimeType: string };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', path: imagePath, title: 'Path image' }),
    });

    expect(created).toMatchObject({ ok: true, kind: 'image' });
    expect(created.data.src).toBe(imagePath);
    expect(created.data.path).toBe(imagePath);
    expect(created.data.mimeType).toBe('image/png');
  });

  test('image nodes reject non-image files even with an image extension', async () => {
    const fakeImagePath = join(workspaceRoot, 'not-an-image.png');
    writeFileSync(fakeImagePath, 'not image bytes', 'utf-8');

    const response = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', content: fakeImagePath, title: 'Fake image' }),
    });
    const payload = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('not a recognized image file');
    expect(canvasState.getLayout().nodes).toHaveLength(0);
  });

  test('image nodes reject missing local files', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', content: join(workspaceRoot, 'missing.png'), title: 'Missing image' }),
    });
    const payload = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('does not exist');
    expect(canvasState.getLayout().nodes).toHaveLength(0);
  });

  test('the image route refuses to serve files outside the workspace', async () => {
    // A valid image that lives OUTSIDE the workspace (in the parent dir). Image
    // node creation does not enforce containment, so the node can be planted;
    // the /api/canvas/image/<id> route must refuse to read it (path traversal).
    const outsidePath = join(workspaceRoot, '..', `pmx-traversal-${Date.now()}.png`);
    writeFileSync(outsidePath, tinyPng);
    try {
      const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', content: outsidePath, title: 'Outside image' }),
      });
      expect(created.ok).toBe(true);

      const imageResponse = await fetch(`${baseUrl}/api/canvas/image/${created.id}`);
      expect(imageResponse.status).toBe(403);
      expect(await imageResponse.text()).toContain('outside the workspace');
    } finally {
      rmSync(outsidePath, { force: true });
    }
  });

  test('html nodes reject non-string html payloads without creating blank nodes', async () => {
    const topLevelResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Invalid html numeric', html: 123 }),
    });
    const topLevelPayload = await topLevelResponse.json() as { ok: boolean; error: string };

    expect(topLevelResponse.status).toBe(400);
    expect(topLevelPayload.ok).toBe(false);
    expect(topLevelPayload.error).toContain('"html" must be a string');

    const dataResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Invalid nested html', data: { html: 123 } }),
    });
    const dataPayload = await dataResponse.json() as { ok: boolean; error: string };

    expect(dataResponse.status).toBe(400);
    expect(dataPayload.ok).toBe(false);
    expect(dataPayload.error).toContain('"data.html" must be a string');
    expect(canvasState.getLayout().nodes).toHaveLength(0);

    const empty = await jsonRequest<{ ok: boolean; data: { html: string } }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Empty html', html: '' }),
    });
    expect(empty.ok).toBe(true);
    expect(empty.data.html).toBe('');
  });

  test('html primitive requests create searchable sandboxed html nodes with primitive metadata', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      type: string;
      title: string;
      size: { width: number; height: number };
      data: Record<string, unknown>;
      primitive: { kind: string; htmlBytes: number; defaultSize: { width: number; height: number } };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html',
        primitive: 'choice-grid',
        title: 'Primitive Options',
        data: {
          items: [
            { title: 'Use HTML', summary: 'Higher information density.', pros: ['Visual'], cons: ['More bytes'] },
          ],
        },
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.type).toBe('html');
    expect(created.title).toBe('Primitive Options');
    expect(created.primitive.kind).toBe('choice-grid');
    expect(created.primitive.htmlBytes).toBeGreaterThan(1000);
    expect(created.size).toEqual(created.primitive.defaultSize);
    expect(created.data.htmlPrimitive).toBe('choice-grid');
    expect(created.data.description).toContain('Side-by-side options');
    expect(created.data.html).toContain('Copy JSON');
    expect(created.data.html).toContain('Use HTML');

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>('/api/canvas/search?q=side-by-side');
    expect(search.results.some((result) => result.id === created.id)).toBe(true);
  });

  test('html primitive node creation accepts the documented query-string type form', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      type: string;
      data: Record<string, unknown>;
      primitive: { kind: string };
    }>('/api/canvas/node?type=html-primitive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'choice-grid',
        title: 'Query Primitive Options',
        data: {
          items: [
            { title: 'Query type', summary: 'Routes through html-primitive instead of markdown.' },
          ],
        },
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.type).toBe('html');
    expect(created.primitive.kind).toBe('choice-grid');
    expect(created.data.htmlPrimitive).toBe('choice-grid');
    expect(canvasState.getLayout().nodes.some((node) => node.type === 'markdown' && node.data.title === 'Query Primitive Options')).toBe(false);
  });

  test('presentation primitives persist slide metadata for agents', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      content: string | null;
      data: Record<string, unknown>;
      primitive: { kind: string; defaultSize: { width: number; height: number } };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        title: 'Release Briefing',
        data: {
          slides: [
            { title: 'Why now', body: 'Frame the release decision.', note: 'Open with the customer impact.' },
            { title: 'What ships', bullets: ['Presentation mode', 'Semantic slide metadata'] },
          ],
        },
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.primitive.kind).toBe('presentation');
    expect(created.primitive.defaultSize).toEqual({ width: 1120, height: 700 });
    expect(created.data.htmlPrimitive).toBe('presentation');
    expect(created.data.presentation).toBe(true);
    expect(created.data.slideCount).toBe(2);
    expect(created.data.slideTitles).toEqual(['Why now', 'What ships']);
    expect(created.data.speakerNotes).toEqual(['Open with the customer impact.']);
    expect(created.data.primitiveData).toEqual(expect.objectContaining({
      presentation: true,
      slideCount: 2,
      slideTitles: ['Why now', 'What ships'],
    }));
    expect(created.data.html).toContain('PMX presentation');
    expect(created.data.html).toContain('Page Up/Down');
    expect(created.data.html).not.toContain('Copy JSON');
    expect(created.data.html).not.toContain('Copy prompt');
    expect(created.data.html).toContain('data-pmx-presentation-mode="present"] .hint { display: none; }');
    const generatedScripts: string[] = [];
    for (const match of String(created.data.html).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      const attrs = match[1] ?? '';
      if (!/type=["']application\/json["']/i.test(attrs)) {
        generatedScripts.push(match[2] ?? '');
      }
    }
    expect(generatedScripts).not.toHaveLength(0);
    for (const script of generatedScripts) {
      expect(() => new Function(script)).not.toThrow();
    }
    expect(created.content).toContain('Slides: Why now, What ships');

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>('/api/canvas/search?q=What%20ships');
    expect(search.results.some((result) => result.id === created.id)).toBe(true);
  });

  test('presentation primitives support named and custom themes', async () => {
    const defaultTheme = await jsonRequest<{
      ok: boolean;
      data: Record<string, unknown>;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        title: 'Canvas Theme Deck',
        data: {
          slides: [{ title: 'Canvas themed', body: 'Follow the active PMX theme.' }],
        },
      }),
    });

    expect(defaultTheme.ok).toBe(true);
    expect(defaultTheme.data.presentationTheme).toBeUndefined();
    expect(defaultTheme.data.html).toContain('--deck-bg: var(--color-bg, #081524)');

    const named = await jsonRequest<{
      ok: boolean;
      data: Record<string, unknown>;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        title: 'Paper Deck',
        data: {
          theme: 'paper',
          slides: [{ title: 'Light deck', body: 'Use a paper theme.' }],
        },
      }),
    });

    expect(named.ok).toBe(true);
    expect(named.data.presentationTheme).toBe('paper');
    expect(named.data.primitiveData).toEqual(expect.objectContaining({ presentationTheme: 'paper' }));
    expect(named.data.html).toContain('color-scheme: light');
    expect(named.data.html).toContain('--deck-bg: #F4EFE6');

    const custom = await jsonRequest<{
      ok: boolean;
      data: Record<string, unknown>;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        title: 'Custom Deck',
        data: {
          theme: {
            base: 'paper',
            bg: '#fff7ed',
            panel: '#ffedd5',
            surface: '#fed7aa',
            border: '#fdba74',
            text: '#431407',
            textSecondary: '#7c2d12',
            textMuted: '#9a3412',
            accent: '#ea580c',
            colorScheme: 'light',
          },
          slides: [{ title: 'Custom deck', body: 'Use a custom presentation theme.' }],
        },
      }),
    });

    expect(custom.ok).toBe(true);
    expect(custom.data.presentationTheme).toEqual(expect.objectContaining({ accent: '#ea580c', colorScheme: 'light' }));
    expect(custom.data.html).toContain('--deck-bg: #fff7ed');
    expect(custom.data.html).toContain('--deck-accent: #ea580c');
  });

  test('presentation primitives reject unknown theme names', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        title: 'Bad Theme Deck',
        data: {
          theme: 'nonexistent',
          slides: [{ title: 'Invalid theme' }],
        },
      }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
    const body = await response.json() as { error: string };
    expect(body.error).toContain('Invalid presentation theme');
    expect(canvasState.getLayout().nodes.some((node) => node.data.title === 'Bad Theme Deck')).toBe(false);
  });

  test('html nodes persist semantic summaries for agent context and search', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      content: string | null;
      data: Record<string, unknown>;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html',
        title: 'Light HTML report',
        summary: 'Explicit semantic summary for the report.',
        embeddedNodeIds: ['graph-source-1'],
        html: `<!doctype html>
          <html><head><style>.hidden{color:red}</style></head><body>
            <h1>Quarterly HTML Report</h1>
            <p>Revenue climbed in the light theme test.</p>
            <script>window.secret = 'ignore me';</script>
            <iframe src="/api/canvas/json-render/view?nodeId=graph-source-1"></iframe>
          </body></html>`,
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.data.summary).toBe('Explicit semantic summary for the report.');
    expect(created.data.contentSummary).toContain('Quarterly HTML Report');
    expect(created.data.contentSummary).toContain('Revenue climbed');
    expect(created.data.contentSummary).not.toContain('window.secret');
    expect(created.data.agentSummary).toContain('Explicit semantic summary');
    expect(created.data.agentSummary).toContain('Quarterly HTML Report');
    expect(created.data.embeddedNodeIds).toEqual(['graph-source-1']);
    expect(created.data.embeddedUrls).toEqual(['/api/canvas/json-render/view?nodeId=graph-source-1']);
    expect(created.content).toContain('Explicit semantic summary');

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>('/api/canvas/search?q=revenue');
    expect(search.results.some((result) => result.id === created.id && result.snippet.includes('Revenue climbed'))).toBe(true);

    await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [created.id] }),
    });
    const pinnedContext = await jsonRequest<{
      preamble: string;
      nodes: Array<{ id: string; content: string | null; metadata?: Record<string, unknown> }>;
    }>('/api/canvas/pinned-context');
    expect(pinnedContext.preamble).toContain('Explicit semantic summary');
    expect(pinnedContext.preamble).toContain('Quarterly HTML Report');
    expect(pinnedContext.nodes[0]?.metadata).toEqual(expect.objectContaining({
      summary: 'Explicit semantic summary for the report.',
      embeddedNodeIds: ['graph-source-1'],
    }));

    const updated = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { html: '<main><h1>Updated HTML Report</h1><p>Churn dropped after the update.</p></main>' } }),
    });
    expect(updated.data.contentSummary).toContain('Updated HTML Report');
    expect(updated.data.contentSummary).toContain('Churn dropped');
    expect(updated.data.contentSummary).not.toContain('Revenue climbed');
  });

  test('raw html nodes can opt into presentation metadata', async () => {
    const created = await jsonRequest<{ ok: boolean; data: Record<string, unknown> }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html',
        title: 'Raw Presentation',
        html: '<main><h1>Raw deck</h1><section>Slide content</section></main>',
        presentation: true,
        slideTitles: ['Raw deck'],
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.data.presentation).toBe(true);
    expect(created.data.slideTitles).toEqual(['Raw deck']);
  });

  test('closes hosted MCP app sessions when nodes are deleted or the canvas is cleared', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      toolCallId: string;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const hostedNode = layout.nodes.find((node) => node.type === 'mcp-app' && node.data.title === 'Counter App');
    expect(hostedNode).toBeTruthy();
    expect(hostedNode?.id).toBe(opened.nodeId);

    const deleteResponse = await fetch(`${baseUrl}/api/canvas/node/${hostedNode?.id}`, {
      method: 'DELETE',
    });
    expect(deleteResponse.ok).toBe(true);

    const toolsAfterDelete = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: opened.sessionId }),
    });
    expect(toolsAfterDelete.ok).toBe(false);
    const deleteError = await toolsAfterDelete.json() as { error?: string };
    expect(deleteError.error?.toLowerCase().includes('not found')).toBe(true);

    const reopened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 4 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(reopened.ok).toBe(true);
    expect(typeof reopened.nodeId).toBe('string');

    await jsonRequest<{ ok: boolean }>('/api/canvas/clear', {
      method: 'POST',
    });

    const toolsAfterClear = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: reopened.sessionId }),
    });
    expect(toolsAfterClear.ok).toBe(false);
    const clearError = await toolsAfterClear.json() as { error?: string };
    expect(clearError.error?.toLowerCase().includes('not found')).toBe(true);
  });

  test('updates an existing Excalidraw diagram node in place', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/diagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Mutable Diagram',
        elements: [{ type: 'rectangle', id: 'before', x: 0, y: 0, width: 80, height: 50 }],
      }),
    }, 15_000);
    expect(created.ok).toBe(true);
    expect(typeof created.nodeId).toBe('string');

    const updated = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/diagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId: created.nodeId,
        elements: [{ type: 'rectangle', id: 'changed', x: 120, y: 0, width: 80, height: 50 }],
      }),
    });

    expect(updated.ok).toBe(true);
    expect(updated.nodeId).toBe(created.nodeId);
    expect(updated.sessionId).not.toBe(created.sessionId);
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.nodes.filter((node) => node.type === 'mcp-app')).toHaveLength(1);
    const node = state.nodes.find((entry) => entry.id === created.nodeId);
    const toolInput = node?.data.toolInput as { elements?: string } | undefined;
    const elements = toolInput?.elements ? JSON.parse(toolInput.elements) as Array<Record<string, unknown>> : [];
    expect(elements.some((element) => element.id === 'changed')).toBe(true);
    expect(elements.some((element) => element.id === 'before')).toBe(false);
  }, 30_000);

  test('rehydrates ext-app snapshot sessions on restore', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Snapshot Counter',
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const saved = await jsonRequest<{ ok: boolean; id: string; snapshot: { id: string; name: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'counter-snapshot' }),
    });
    expect(saved.id).toBe(saved.snapshot.id);
    expect(saved.snapshot.name).toBe('counter-snapshot');

    await jsonRequest<{ ok: boolean; sessionId: string }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Transient Counter',
        toolName: 'show_counter',
        toolArguments: { initial: 9 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });

    await jsonRequest<{ ok: boolean }>(`/api/canvas/snapshots/${encodeURIComponent('counter-snapshot')}`, {
      method: 'POST',
    });

    const restoredNode = await waitForNode(
      baseUrl,
      (entry) =>
        entry.type === 'mcp-app' &&
        entry.data.title === 'Snapshot Counter' &&
        typeof entry.data.appSessionId === 'string' &&
        entry.data.sessionStatus === 'ready',
    );
    expect(restoredNode).toBeTruthy();
    const restoredSessionId = restoredNode?.data.appSessionId as string;
    expect(restoredSessionId).toBeTruthy();
    expect(restoredSessionId).not.toBe(opened.sessionId);

    const oldSession = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: opened.sessionId }),
    });
    expect(oldSession.ok).toBe(false);

    const newSession = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: restoredSessionId }),
    });
    expect(newSession.ok).toBe(true);

  }, 30000);

  test('persists app model context from ext-app tool results', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Context Counter',
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const node = await waitForNode(
      baseUrl,
      (entry) =>
        entry.type === 'mcp-app' &&
        entry.data.title === 'Context Counter' &&
        entry.data.appSessionId === opened.sessionId,
    );
    expect(node).toBeTruthy();

    const toolResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId: node?.id,
        toolName: 'increment',
        arguments: {},
      }),
    });
    expect(toolResponse.ok).toBe(true);

    const updatedNode = await waitForNode(
      baseUrl,
      (entry) => {
        const modelContext = entry.data.appModelContext as
          | { structuredContent?: { count?: number } }
          | undefined;
        return (
          entry.id === node?.id &&
          modelContext?.structuredContent?.count === 3
        );
      },
    );
    expect(updatedNode).toBeTruthy();
  }, 30000);

  test('surface route serves an html node as a themed standalone document', async () => {
    canvasState.addNode({
      id: 'surface-html', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 720, height: 640 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { title: 'Doc', html: '<main>Surface body</main>' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-html?theme=light`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await res.text();
    expect(body).toContain('Surface body');
    expect(body).toContain('/canvas/surface-theme.css');
    expect(body).toContain('data-theme="light"');
    // The standalone tab title falls back to the node title (Bug #35) so the
    // browser tab shows "Doc" instead of the raw surface URL.
    expect(body).toContain('<title>Doc</title>');

    const meta = await fetch(`${baseUrl}/api/canvas/node/surface-html?includeBlobs=true`).then((r) => r.json()) as { surfaceUrl?: string };
    expect(meta.surfaceUrl).toBe('/api/canvas/surface/surface-html');
  });

  test('surface route falls back to the node id for the tab title when no node title is set', async () => {
    canvasState.addNode({
      id: 'surface-untitled', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 720, height: 640 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { title: '   ', html: '<main>Body</main>' }, // whitespace-only → falls back to id
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-untitled`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>surface-untitled</title>');
  });

  test('surface route 404s for unknown node and non-openable types', async () => {
    const missing = await fetch(`${baseUrl}/api/canvas/surface/does-not-exist`);
    expect(missing.status).toBe(404);
    canvasState.addNode({
      id: 'surface-md', type: 'markdown',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { content: '# hi' },
    });
    const md = await fetch(`${baseUrl}/api/canvas/surface/surface-md`);
    expect(md.status).toBe(404);
  });

  test('surface route redirects a webpage node to its external url', async () => {
    canvasState.addNode({
      id: 'surface-web', type: 'webpage',
      position: { x: 0, y: 0 }, size: { width: 600, height: 400 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { url: `${webpageOrigin}/article` },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-web`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${webpageOrigin}/article`);
  });

  test('surface route redirects a web-artifact node to the artifact route', async () => {
    canvasState.addNode({
      id: 'surface-artifact', type: 'mcp-app',
      position: { x: 0, y: 0 }, size: { width: 960, height: 720 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { viewerType: 'web-artifact', path: '/tmp/does-not-matter.html', url: '/artifact?path=x' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-artifact`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/artifact?path=${encodeURIComponent('/tmp/does-not-matter.html')}`);
  });

  test('surface route redirects a json-render node to the standalone viewer', async () => {
    canvasState.addNode({
      id: 'surface-jsonrender', type: 'json-render',
      position: { x: 0, y: 0 }, size: { width: 600, height: 400 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { viewerType: 'json-render', spec: { root: 'x', elements: {} } },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-jsonrender?theme=dark`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/api/canvas/json-render/view');
    expect(location).toContain('nodeId=surface-jsonrender');
    expect(location).toContain('theme=dark');
  });

  test('surface route serves an ext-app node with the ext-app sandbox', async () => {
    canvasState.addNode({
      id: 'surface-extapp', type: 'mcp-app',
      position: { x: 0, y: 0 }, size: { width: 960, height: 720 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { mode: 'ext-app', html: '<!doctype html><html><head></head><body>ext app surface</body></html>' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-extapp`);
    expect(res.status).toBe(200);
    // Standalone ext-app surface is served with a tighter sandbox than the
    // in-canvas iframe (no allow-popups-to-escape-sandbox) — untrusted top-level HTML.
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(await res.text()).toContain('ext app surface');
  });

  test('surface route blocks unsafe redirect targets', async () => {
    canvasState.addNode({
      id: 'surface-bad-url', type: 'webpage',
      position: { x: 0, y: 0 }, size: { width: 600, height: 400 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { url: 'javascript:alert(1)' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-bad-url`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('surface route injects the AX bridge only for opted-in html nodes', async () => {
    canvasState.addNode({
      id: 'surf-ax-off', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { html: '<main>x</main>' },
    });
    expect((await (await fetch(`${baseUrl}/api/canvas/surface/surf-ax-off`)).text()).includes('window.PMX_AX')).toBe(false);

    canvasState.addNode({
      id: 'surf-ax-on', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { html: '<main>x</main>', axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
    });
    const on = await (await fetch(`${baseUrl}/api/canvas/surface/surf-ax-on?axToken=ax-test`)).text();
    expect(on).toContain('window.PMX_AX');
    expect(on).toContain('ax-test');
  });

  test('surface route falls back to content, 404s when html node is empty', async () => {
    canvasState.addNode({
      id: 'surf-content', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { content: '<main>from content</main>' },
    });
    const c = await fetch(`${baseUrl}/api/canvas/surface/surf-content`);
    expect(c.status).toBe(200);
    expect(await c.text()).toContain('from content');

    canvasState.addNode({
      id: 'surf-empty', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 400, height: 300 }, zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: {},
    });
    expect((await fetch(`${baseUrl}/api/canvas/surface/surf-empty`)).status).toBe(404);
  });

  test('ax interaction creates a work item from an eligible node', async () => {
    canvasState.addNode({
      id: 'ax-status', type: 'status',
      position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { title: 'Build' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-status', payload: { title: 'Ship it' }, source: 'cli' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { ok: boolean; primitive?: { title: string; nodeIds: string[] } };
    expect(json.ok).toBe(true);
    expect(json.primitive?.title).toBe('Ship it');
    expect(json.primitive?.nodeIds).toEqual(['ax-status']);
    expect(canvasState.getAxState().workItems.some((w) => w.title === 'Ship it')).toBe(true);
  });

  test('ax interaction rejects a disallowed interaction type', async () => {
    canvasState.addNode({
      id: 'ax-file', type: 'file',
      position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { path: '/tmp/x.ts' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.steer', sourceNodeId: 'ax-file', payload: { message: 'go' } }),
    });
    expect(res.status).toBe(403);
    expect(await res.json() as Record<string, unknown>).toMatchObject({ ok: false, code: 'not-allowed' });
  });

  test('ax interaction respects per-node opt-in for html nodes', async () => {
    canvasState.addNode({
      id: 'ax-html-off', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { html: '<main>x</main>' },
    });
    const off = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-html-off', payload: { title: 'x' } }),
    });
    expect(off.status).toBe(403);
    expect((await off.json() as { code: string }).code).toBe('ax-disabled');

    canvasState.addNode({
      id: 'ax-html-on', type: 'html',
      position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: { html: '<main>x</main>', axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
    });
    const on = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-html-on', payload: { title: 'opted in' } }),
    });
    expect(on.status).toBe(200);
    expect((await on.json() as { ok: boolean }).ok).toBe(true);
  });

  test('ax interaction rejects unknown node and invalid payload', async () => {
    const unknown = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'nope', payload: { title: 'x' } }),
    });
    expect(unknown.status).toBe(404);
    canvasState.addNode({
      id: 'ax-status-2', type: 'status',
      position: { x: 0, y: 0 }, size: { width: 300, height: 200 },
      zIndex: 1, collapsed: false, pinned: false, dockPosition: null,
      data: {},
    });
    const bad = await fetch(`${baseUrl}/api/canvas/ax/interaction`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'ax.work.create', sourceNodeId: 'ax-status-2', payload: {} }),
    });
    expect(bad.status).toBe(400);
    expect((await bad.json() as { code: string }).code).toBe('invalid-payload');
  });

  test('ax delivery: pending query, loop prevention, and mark', async () => {
    const steer = await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'focus on the failing test', source: 'copilot' }),
    });
    const steering = (await steer.json() as { steering: { id: string } }).steering;

    const seenByMcp = async () => {
      const r = await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=mcp`);
      const body = await r.json() as { pending: Array<{ id: string }> };
      return body.pending.some((s) => s.id === steering.id);
    };

    // Visible to a different consumer...
    expect(await seenByMcp()).toBe(true);
    // ...but excluded for the originating consumer (loop prevention).
    const copilotPending = await (await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=copilot`)).json() as { pending: Array<{ id: string }> };
    expect(copilotPending.pending.some((s) => s.id === steering.id)).toBe(false);

    // Mark delivered, then it drops out of pending.
    const mark = await (await fetch(`${baseUrl}/api/canvas/ax/delivery/${encodeURIComponent(steering.id)}/mark`, { method: 'POST' })).json() as { ok: boolean; delivered: boolean };
    expect(mark.delivered).toBe(true);
    expect(await seenByMcp()).toBe(false);
  });

  test('ax elicitation: request, list, respond lifecycle', async () => {
    const req = await (await fetch(`${baseUrl}/api/canvas/ax/elicitation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'Who owns this?', fields: ['owner'], source: 'cli' }),
    })).json() as { ok: boolean; elicitation: { id: string; status: string } };
    expect(req.ok).toBe(true);
    expect(req.elicitation.status).toBe('pending');

    const list = await (await fetch(`${baseUrl}/api/canvas/ax/elicitation`)).json() as { elicitations: Array<{ id: string }> };
    expect(list.elicitations.some((e) => e.id === req.elicitation.id)).toBe(true);

    const respond = await (await fetch(`${baseUrl}/api/canvas/ax/elicitation/${encodeURIComponent(req.elicitation.id)}/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: { owner: 'alice' } }),
    })).json() as { ok: boolean; elicitation: { status: string; response: Record<string, unknown> } };
    expect(respond.elicitation.status).toBe('answered');
    expect(respond.elicitation.response).toEqual({ owner: 'alice' });

    // answered → snapshotted in ax state
    const ax = await (await fetch(`${baseUrl}/api/canvas/ax`)).json() as { state: { elicitations: Array<{ id: string; status: string }> } };
    expect(ax.state.elicitations.find((e) => e.id === req.elicitation.id)?.status).toBe('answered');
  });

  test('ax mode: request and resolve lifecycle', async () => {
    const req = await (await fetch(`${baseUrl}/api/canvas/ax/mode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'execute', reason: 'plan approved', source: 'cli' }),
    })).json() as { ok: boolean; modeRequest: { id: string; mode: string; status: string } };
    expect(req.modeRequest.mode).toBe('execute');
    expect(req.modeRequest.status).toBe('pending');

    const bad = await fetch(`${baseUrl}/api/canvas/ax/mode`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'turbo' }),
    });
    expect(bad.status).toBe(400);

    const resolve = await (await fetch(`${baseUrl}/api/canvas/ax/mode/${encodeURIComponent(req.modeRequest.id)}/resolve`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'approved', resolution: 'go' }),
    })).json() as { ok: boolean; modeRequest: { status: string; resolution: string } };
    expect(resolve.modeRequest.status).toBe('approved');
    expect(resolve.modeRequest.resolution).toBe('go');
  });

  test('ax command: registry list + registry-gated invoke', async () => {
    const list = await (await fetch(`${baseUrl}/api/canvas/ax/command`)).json() as { commands: Array<{ name: string }> };
    expect(list.commands.some((c) => c.name === 'pmx.plan')).toBe(true);

    const ok = await fetch(`${baseUrl}/api/canvas/ax/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'pmx.plan', args: { note: 'x' }, source: 'cli' }),
    });
    expect(ok.status).toBe(200);
    const okBody = await ok.json() as { ok: boolean; event: { kind: string; data: { command: string } } };
    expect(okBody.event.kind).toBe('command');
    expect(okBody.event.data.command).toBe('pmx.plan');

    const bad = await fetch(`${baseUrl}/api/canvas/ax/command`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'definitely-not-a-command' }),
    });
    expect(bad.status).toBe(400);
  });

  test('ax policy: defaults empty, merges on set, exposed in context', async () => {
    const initial = await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json() as { policy: { tools: { excluded: string[] } } };
    expect(initial.policy.tools.excluded).toEqual([]);

    await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools: { excluded: ['shell', 'write'] }, prompt: { mode: 'concise' }, source: 'cli' }),
    });
    const set = await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json() as { policy: { tools: { excluded: string[] }; prompt: { mode: string } } };
    expect(set.policy.tools.excluded).toEqual(['shell', 'write']);
    expect(set.policy.prompt.mode).toBe('concise');

    // merge: setting prompt does not wipe tools
    await fetch(`${baseUrl}/api/canvas/ax/policy`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: { systemAppend: 'be terse' } }),
    });
    const merged = await (await fetch(`${baseUrl}/api/canvas/ax/policy`)).json() as { policy: { tools: { excluded: string[] }; prompt: { mode: string; systemAppend: string } } };
    expect(merged.policy.tools.excluded).toEqual(['shell', 'write']);
    expect(merged.policy.prompt.systemAppend).toBe('be terse');

    const ctx = await (await fetch(`${baseUrl}/api/canvas/ax/context`)).json() as { policy?: { tools: { excluded: string[] } } };
    expect(ctx.policy?.tools.excluded).toEqual(['shell', 'write']);
  });

  test('json-render viewer injects the AX bridge only when an axToken is supplied', async () => {
    const created = await jsonRequest<{ id: string; url: string }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'AX Bridge Board',
        spec: {
          root: 'copy',
          elements: { copy: { type: 'Text', props: { text: 'bridge probe' }, children: [] } },
        },
      }),
    });

    // The viewer bundle *references* the bridge globals by name (buildAxHandlers
    // reads them), so the identifiers always appear. The injection is gated on the
    // token *value*: only present when both nodeId and axToken are supplied.
    const withToken = await (await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=${created.id}&axToken=ax-probe`)).text();
    expect(withToken).toContain('window.__PMX_CANVAS_AX_TOKEN__ = "ax-probe"');
    expect(withToken).toContain(`window.__PMX_CANVAS_JSON_RENDER_NODE_ID__ = "${created.id}"`);

    const withoutToken = await (await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=${created.id}`)).text();
    expect(withoutToken).not.toContain('ax-probe');
    expect(withoutToken).not.toContain('window.__PMX_CANVAS_AX_TOKEN__ = ');
  });

  test('keeps ext-app model context separate from the replayed tool result', async () => {
    const nodeId = 'ext-app-context-replay';
    canvasState.addNode({
      id: nodeId,
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        mode: 'ext-app',
        title: 'Diagram',
        appSessionId: 'session-1',
        toolResult: { content: [{ type: 'text', text: 'old' }] },
      },
    });

    const response = await fetch(`${baseUrl}/api/ext-app/model-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        content: [{ type: 'text', text: 'updated diagram' }],
        structuredContent: { elements: [{ id: 'rect-1' }] },
      }),
    });
    expect(response.ok).toBe(true);

    const node = canvasState.getNode(nodeId);
    expect(node?.data.appModelContext).toMatchObject({
      structuredContent: { elements: [{ id: 'rect-1' }] },
    });
    expect(node?.data.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'old' }],
    });
  });

  test('preserves existing tool result when model context only sends structured content', async () => {
    const nodeId = 'ext-app-structured-context';
    canvasState.addNode({
      id: nodeId,
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        mode: 'ext-app',
        title: 'Counter',
        appSessionId: 'session-1',
        toolResult: {
          content: [{ type: 'text', text: 'Counter incremented to 3.' }],
          structuredContent: { count: 3 },
        },
      },
    });

    const response = await fetch(`${baseUrl}/api/ext-app/model-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodeId,
        structuredContent: { count: 3 },
      }),
    });
    expect(response.ok).toBe(true);

    const node = canvasState.getNode(nodeId);
    expect(node?.data.appModelContext).toMatchObject({ structuredContent: { count: 3 } });
    expect(node?.data.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'Counter incremented to 3.' }],
      structuredContent: { count: 3 },
    });
  });

  test('app-only checkpoint saves do not replace the bootstrap tool result', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        title: 'Checkpoint Fixture',
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const saveResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId: opened.nodeId,
        toolName: 'save_checkpoint',
        arguments: { id: 'checkpoint-1', data: '{"elements":[{"id":"manual"}]}' },
      }),
    });
    expect(saveResponse.ok).toBe(true);

    const node = opened.nodeId ? canvasState.getNode(opened.nodeId) : undefined;
    expect(node?.data.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'Counter ready at 2.' }],
      structuredContent: { count: 2 },
    });

    const readResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        toolName: 'read_checkpoint',
        arguments: { id: 'checkpoint-1' },
      }),
    });
    expect(readResponse.ok).toBe(true);
    const read = await readResponse.json() as { result: { content: Array<{ text?: string }> } };
    expect(read.result.content[0]?.text).toBe('{"elements":[{"id":"manual"}]}');
  });

  test('app-only text tool results update model context without replacing bootstrap replay', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        title: 'Text Tool Fixture',
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const readResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId: opened.nodeId,
        toolName: 'read_checkpoint',
        arguments: { id: 'missing-checkpoint' },
      }),
    });
    expect(readResponse.ok).toBe(true);

    const node = opened.nodeId ? canvasState.getNode(opened.nodeId) : undefined;
    expect(node?.data.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'Counter ready at 2.' }],
      structuredContent: { count: 2 },
    });
    expect(node?.data.appModelContext).toMatchObject({
      content: [{ type: 'text', text: '' }],
    });
  }, 30000);

  test('Excalidraw checkpoint saves update the replayed create_view input', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Excalidraw Fixture',
        serverName: 'Excalidraw',
        toolName: 'create_view',
        toolArguments: {
          elements: JSON.stringify([
            { type: 'rectangle', id: 'original', x: 0, y: 0, width: 10, height: 10 },
          ]),
        },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const nodeId = opened.nodeId!;
    const node = canvasState.getNode(nodeId);
    const checkpointId = (node?.data.toolResult as { structuredContent?: { checkpointId?: string } } | undefined)
      ?.structuredContent?.checkpointId;
    expect(checkpointId).toBe(`pmx-${nodeId}`);

    const initialReadResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId,
        toolName: 'read_checkpoint',
        arguments: { id: checkpointId },
      }),
    });
    expect(initialReadResponse.ok).toBe(true);
    const initialRead = await initialReadResponse.json() as { result: { content: Array<{ text?: string }> } };
    expect(initialRead.result.content[0]?.text).toBe('');

    const wrongSessionReadResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'wrong-session',
        nodeId,
        toolName: 'read_checkpoint',
        arguments: { id: checkpointId },
      }),
    });
    expect(wrongSessionReadResponse.ok).toBe(false);

    const saveResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId,
        toolName: 'save_checkpoint',
        arguments: {
          id: checkpointId,
          data: JSON.stringify({
            elements: [{ type: 'ellipse', id: 'edited', x: 200, y: 150, width: 60, height: 40 }],
          }),
        },
      }),
    });
    expect(saveResponse.ok).toBe(true);

    const updatedNode = canvasState.getNode(nodeId);
    const toolInput = updatedNode?.data.toolInput as { elements?: string } | undefined;
    const replayedElements = toolInput?.elements ? JSON.parse(toolInput.elements) : [];
    expect(replayedElements[0]).toEqual({ type: 'restoreCheckpoint', id: checkpointId });
    expect(replayedElements[1]).toMatchObject({ type: 'cameraUpdate' });
    expect(replayedElements[1].width / replayedElements[1].height).toBeCloseTo(4 / 3, 2);
    expect(updatedNode?.data.toolResult).toMatchObject({
      content: [{ type: 'text', text: 'Diagram ready.' }],
      structuredContent: { checkpointId },
    });

    const readResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId,
        toolName: 'read_checkpoint',
        arguments: { id: checkpointId },
      }),
    });
    expect(readResponse.ok).toBe(true);
    const read = await readResponse.json() as { result: { content: Array<{ text?: string }> } };
    expect(read.result.content[0]?.text).toContain('"id":"edited"');
  });

  test('opens Excalidraw nodes with a single ext-app id prefix and id alias', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      id?: string;
      nodeId: string | null;
      toolCallId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Single Prefix Diagram',
        serverName: 'Excalidraw',
        toolName: 'create_view',
        toolArguments: {
          elements: JSON.stringify([
            { type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10 },
          ]),
        },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(opened.id).toBe(opened.nodeId);
    expect(opened.toolCallId.startsWith('ext-app-')).toBe(false);
    expect(opened.nodeId?.startsWith('ext-app-')).toBe(true);
    expect(opened.nodeId?.startsWith('ext-app-ext-app-')).toBe(false);
  }, 30_000);

  test('resizes reusable Excalidraw app nodes when explicit geometry is provided', async () => {
    canvasState.addNode({
      id: 'ext-app-pending-diagram',
      type: 'mcp-app',
      position: { x: 10, y: 20 },
      size: { width: 320, height: 240 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        mode: 'ext-app',
        title: 'Pending Diagram',
        serverName: 'Excalidraw',
        toolName: 'create_view',
      },
    });

    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Sized Reused Diagram',
        serverName: 'Excalidraw',
        toolName: 'create_view',
        toolArguments: {
          elements: JSON.stringify([
            { type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10 },
          ]),
        },
        x: 100,
        y: 120,
        width: 640,
        height: 520,
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });

    expect(opened.ok).toBe(true);
    expect(opened.nodeId).toBe('ext-app-pending-diagram');
    const node = canvasState.getNode('ext-app-pending-diagram');
    expect(node?.position).toEqual({ x: 100, y: 120 });
    expect(node?.size).toEqual({ width: 640, height: 520 });
    expect(node?.data.title).toBe('Sized Reused Diagram');
  }, 30_000);

  test('rehydrates persisted ext-app sessions after server restart', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Restart Counter',
        toolName: 'show_counter',
        toolArguments: { initial: 5 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Restart marker',
        content: 'Should still exist after restart',
      }),
    });

    stopCanvasServer();

    const persisted = readPersistedCanvasState(workspaceRoot);
    expect(
      persisted.nodes.some(
        (node) => node.type === 'mcp-app' && node.data.title === 'Restart Counter',
      ),
    ).toBe(true);

    const restarted = startCanvasServer({ workspaceRoot, port: 0 });
    expect(restarted).toBeTruthy();
    baseUrl = restarted!;

    const restoredNode = await waitForNode(
      baseUrl,
      (entry) =>
        entry.type === 'mcp-app' &&
        entry.data.title === 'Restart Counter' &&
        typeof entry.data.appSessionId === 'string' &&
        entry.data.sessionStatus === 'ready',
    );
    expect(restoredNode).toBeTruthy();

    const restoredSessionId = restoredNode?.data.appSessionId as string;
    expect(restoredSessionId).toBeTruthy();
    expect(restoredSessionId).not.toBe(opened.sessionId);

    const staleSession = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: opened.sessionId }),
    });
    expect(staleSession.ok).toBe(false);

    const liveSession = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: restoredSessionId }),
    });
    expect(liveSession.ok).toBe(true);

    const stateAfterRestart = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(
      stateAfterRestart.nodes.some(
        (node) => node.type === 'markdown' && node.data.title === 'Restart marker',
      ),
    ).toBe(true);
  }, 30000);

  test('stores large ext-app payloads in sidecar blobs while preserving opt-in full reads', async () => {
    const largeToolResult = {
      content: [
        {
          type: 'text',
          text: 'x'.repeat(20_000),
        },
      ],
      structuredContent: { checkpointId: 'large-checkpoint' },
    };

    canvasState.addNode({
      id: 'ext-app-large-blob',
      type: 'mcp-app',
      position: { x: 20, y: 30 },
      size: { width: 640, height: 420 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'Large ext-app blob',
        mode: 'ext-app',
        toolName: 'create_view',
        serverName: 'Excalidraw',
        toolInput: { elements: '[]' },
        toolResult: largeToolResult,
      },
    });
    canvasState.flushToDisk();

    const persisted = readPersistedCanvasState(workspaceRoot);
    const persistedNode = persisted.nodes.find((entry) => entry.id === 'ext-app-large-blob');
    expect(isBlobReference(persistedNode?.data.toolResult)).toBe(true);
    const blob = persistedNode?.data.toolResult as PersistedBlobRef;
    expect(blob.jsonBytes).toBeGreaterThan(20_000);
    // Blob is stored in SQLite db now — verify the node data field references it
    expect(blob.__pmxCanvasBlob).toBe('v1');
    expect(blob.sha256).toBeTruthy();

    stopCanvasServer();
    const restarted = startCanvasServer({ workspaceRoot, port: 0 });
    expect(restarted).toBeTruthy();
    baseUrl = restarted!;

    const compact = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const compactNode = compact.nodes.find((entry) => entry.id === 'ext-app-large-blob');
    expect(isBlobSummary(compactNode?.data.toolResult)).toBe(true);

    const full = await jsonRequest<CanvasStateResponse>('/api/canvas/state?includeBlobs=true');
    const fullNode = full.nodes.find((entry) => entry.id === 'ext-app-large-blob');
    expect((fullNode?.data.toolResult as typeof largeToolResult | undefined)?.content[0]?.text).toBe('x'.repeat(20_000));
  });

  test('rehydrates Excalidraw checkpoint replay after server restart', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Restart Diagram',
        serverName: 'Excalidraw',
        toolName: 'create_view',
        toolArguments: {
          elements: JSON.stringify([
            { type: 'rectangle', id: 'original', x: 0, y: 0, width: 10, height: 10 },
          ]),
        },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const nodeId = opened.nodeId!;
    const node = canvasState.getNode(nodeId);
    const checkpointId = (node?.data.toolResult as { structuredContent?: { checkpointId?: string } } | undefined)
      ?.structuredContent?.checkpointId;
    expect(checkpointId).toBe(`pmx-${nodeId}`);

    const saveResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: opened.sessionId,
        nodeId,
        toolName: 'save_checkpoint',
        arguments: {
          id: checkpointId,
          data: JSON.stringify({
            elements: [{ type: 'diamond', id: 'saved-after-restart', x: 10, y: 20, width: 300, height: 240 }],
          }),
        },
      }),
    });
    expect(saveResponse.ok).toBe(true);

    stopCanvasServer();

    const persisted = readPersistedCanvasState(workspaceRoot);
    const persistedNode = persisted.nodes.find((entry) => entry.id === nodeId);
    expect(persistedNode?.data.appCheckpoint).toMatchObject({ id: checkpointId });

    const restarted = startCanvasServer({ workspaceRoot, port: 0 });
    expect(restarted).toBeTruthy();
    baseUrl = restarted!;

    const restoredNode = await waitForNode(
      baseUrl,
      (entry) =>
        entry.id === nodeId &&
        typeof entry.data.appSessionId === 'string' &&
        entry.data.sessionStatus === 'ready',
    );
    expect(restoredNode).toBeTruthy();
    const restoredSessionId = restoredNode?.data.appSessionId as string;
    expect(restoredSessionId).toBeTruthy();
    expect(restoredSessionId).not.toBe(opened.sessionId);

    const restoredToolResult = restoredNode?.data.toolResult as { structuredContent?: { checkpointId?: string } } | undefined;
    expect(restoredToolResult?.structuredContent?.checkpointId).toBe(checkpointId);
    const restoredToolInput = restoredNode?.data.toolInput as { elements?: string } | undefined;
    const replayedElements = restoredToolInput?.elements ? JSON.parse(restoredToolInput.elements) : [];
    expect(replayedElements[0]).toEqual({ type: 'restoreCheckpoint', id: checkpointId });
    expect(replayedElements[1]).toMatchObject({ type: 'cameraUpdate' });

    const readResponse = await fetch(`${baseUrl}/api/ext-app/call-tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: restoredSessionId,
        nodeId,
        toolName: 'read_checkpoint',
        arguments: { id: checkpointId },
      }),
    });
    expect(readResponse.ok).toBe(true);
    const read = await readResponse.json() as { result: { content: Array<{ text?: string }> } };
    expect(read.result.content[0]?.text).toContain('saved-after-restart');
  }, 30000);

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

  test('group create rejects missing child IDs instead of creating an empty group', async () => {
    const response = await fetch(`${baseUrl}/api/canvas/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Missing children', childIds: ['node-missing-a', 'node-missing-b'] }),
    });
    const payload = await response.json() as { ok: boolean; error: string };

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain('missing child node IDs');
    expect(canvasState.getLayout().nodes).toHaveLength(0);
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

  test('batch accepts a bare-array body, not just { operations } (#49)', async () => {
    const before = (await jsonRequest<CanvasStateResponse>('/api/canvas/state')).nodes.length;
    // The documented bare-array form must create nodes (readJson previously coerced
    // top-level arrays to {} → ok:true with 0 results and nothing created).
    const batch = await jsonRequest<{ ok: boolean; results: Array<Record<string, unknown>> }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([
        { op: 'node.add', args: { type: 'markdown', title: 'Bare A', x: 1200, y: 1200 } },
        { op: 'node.add', args: { type: 'markdown', title: 'Bare B', x: 1500, y: 1200 } },
      ]),
    });
    expect(batch.ok).toBe(true);
    expect(batch.results).toHaveLength(2);
    const after = (await jsonRequest<CanvasStateResponse>('/api/canvas/state')).nodes.length;
    expect(after).toBe(before + 2);
  });

  test('batch supports the advertised node.remove operation', async () => {
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Batch removable', content: 'x' }),
    });
    const batch = await jsonRequest<{ ok: boolean; results: Array<Record<string, unknown>> }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operations: [{ op: 'node.remove', args: { id: created.id } }] }),
    });
    expect(batch.ok).toBe(true);
    expect(batch.results[0]).toMatchObject({ ok: true, id: created.id, removed: true });
    expect(canvasState.getNode(created.id)).toBeUndefined();
  });

  test('group/add preserves child positions when no childLayout is given', async () => {
    const post = (body: Record<string, unknown>) =>
      jsonRequest<{ id: string; ok?: boolean }>('/api/canvas/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const a = await post({ type: 'markdown', title: 'GA', content: 'a', x: 100, y: 100, width: 280, height: 180, strictSize: true });
    const b = await post({ type: 'markdown', title: 'GB', content: 'b', x: 900, y: 600, width: 280, height: 180, strictSize: true });
    const group = await jsonRequest<{ id: string }>('/api/canvas/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Frame', x: 50, y: 50, width: 1300, height: 900 }),
    });
    const added = await jsonRequest<{ ok: boolean }>('/api/canvas/group/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: group.id, childIds: [a.id, b.id] }),
    });
    expect(added.ok).toBe(true);
    // Grouping without an explicit layout must not auto-pack — positions stay.
    expect(canvasState.getNode(a.id)!.position).toEqual({ x: 100, y: 100 });
    expect(canvasState.getNode(b.id)!.position).toEqual({ x: 900, y: 600 });
  });

  test('batch operations support graph.add nodes for downstream refs', async () => {
    const batch = await jsonRequest<{
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        ok: boolean;
        id: string;
        type: string;
        url: string;
        size: { width: number; height: number };
        data: Record<string, unknown>;
      }>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'graph.add',
            assign: 'graph',
            args: {
              title: 'Batch graph',
              graphType: 'bar',
              data: [
                { label: 'Docs', value: 5 },
                { label: 'Tests', value: 8 },
              ],
              xKey: 'label',
              yKey: 'value',
              width: 880,
              nodeHeight: 640,
            },
          },
          {
            op: 'group.create',
            assign: 'frame',
            args: {
              title: 'Graph frame',
              childIds: ['$graph.id'],
            },
          },
        ],
      }),
    });

    expect(batch.ok).toBe(true);
    expect(typeof batch.refs.graph?.id).toBe('string');
    expect(typeof batch.refs.frame?.id).toBe('string');
    expect(batch.results[0]?.type).toBe('graph');
    expect(batch.results[0]?.url).toContain('/api/canvas/json-render/view?nodeId=');
    expect(batch.results[0]?.size).toEqual({ width: 880, height: 640 });
    expect((batch.results[0]?.data.graphConfig as Record<string, unknown>)?.graphType).toBe('bar');

    const group = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${batch.refs.frame.id}`);
    expect(group.data.children).toEqual([batch.refs.graph.id]);
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
              url: `${webpageOrigin}/article?v=1`,
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

  test('batch file node add returns compact file content metadata', async () => {
    const filePath = join(workspaceRoot, 'batch-large-file.ts');
    const content = Array.from({ length: 120 }, (_, index) => `export const value${index} = ${index};`).join('\n');
    writeFileSync(filePath, content, 'utf-8');

    const batch = await jsonRequest<{
      ok: boolean;
      results: Array<{ ok: boolean; content: string | null; data: Record<string, unknown> }>;
    }>('/api/canvas/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            args: {
              type: 'file',
              content: filePath,
            },
          },
        ],
      }),
    });

    expect(batch.ok).toBe(true);
    expect(batch.results[0]?.content).toBe(filePath);
    expect(batch.results[0]?.data.fileContent).toEqual(expect.objectContaining({
      omitted: 'file-content',
      bytes: Buffer.byteLength(content, 'utf-8'),
    }));
    expect(String(batch.results[0]?.data.fileContent)).not.toContain('export const value119');
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

  test('detects iframe-blocked live previews while preserving cached text context', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        content: `${webpageOrigin}/article-frame-blocked`,
      }),
    });

    const node = await jsonRequest<{
      type: string;
      content: string | null;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${created.id}`);

    expect(node.type).toBe('webpage');
    expect(node.content).toContain('This page is readable by the server');
    expect(node.data.frameBlocked).toBe(true);
    expect(String(node.data.frameBlockedReason)).toContain('X-Frame-Options');
    expect(node.data.status).toBe('ready');
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
    expect(updated.size).toEqual(MARKDOWN_NODE_DEFAULT_SIZE);
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

  test('records arrange as a single undoable history entry', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Arrange A', x: 600, y: 600 }),
    });
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Arrange B', x: 900, y: 900 }),
    });
    mutationHistory.reset();

    const before = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${first.id}`);
    const arranged = await jsonRequest<{ ok: boolean; arranged: number }>('/api/canvas/arrange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layout: 'column' }),
    });
    expect(arranged.ok).toBe(true);
    expect(arranged.arranged).toBe(2);

    const history = await jsonRequest<{
      entries: Array<{ description: string; operationType: string }>;
      canUndo: boolean;
    }>('/api/canvas/history');
    expect(history.canUndo).toBe(true);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0]).toMatchObject({
      operationType: 'arrange',
      description: 'Auto-arranged 2 nodes (column)',
    });

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.description).toContain('Auto-arranged 2 nodes (column)');
    const afterUndo = await jsonRequest<{ position: { x: number; y: number } }>(`/api/canvas/node/${first.id}`);
    expect(afterUndo.position).toEqual(before.position);

    const afterHistory = await jsonRequest<{
      entries: Array<{ isUndone: boolean }>;
      canUndo: boolean;
    }>('/api/canvas/history');
    expect(afterHistory.canUndo).toBe(false);
    expect(afterHistory.entries).toHaveLength(1);
    expect(afterHistory.entries[0]?.isUndone).toBe(true);
  });

  test('trace node creation promotes documented top-level fields into data', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      data: Record<string, unknown>;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'trace',
        title: 'Trace fixture',
        content: 'Completed',
        toolName: 'canvas_add_node',
        category: 'mcp',
        status: 'success',
        duration: '42ms',
        resultSummary: 'Created node',
        error: '',
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.data).toMatchObject({
      title: 'Trace fixture',
      content: 'Completed',
      toolName: 'canvas_add_node',
      category: 'mcp',
      status: 'success',
      duration: '42ms',
      resultSummary: 'Created node',
      error: '',
    });

    const updated = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'failed', error: 'boom' }),
    });
    expect(updated.data).toMatchObject({ status: 'failed', error: 'boom' });
  });

  test('runtime ext-app result sync does not clear redo history after undo', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Redo survives runtime sync', x: 120, y: 120 }),
    });

    const batchResult = await jsonRequest<{ ok: boolean; applied: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: [{ id: created.id, position: { x: 520, y: 420 } }] }),
    });
    expect(batchResult.applied).toBe(1);

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);

    const eventId = 'ext-app-redo-runtime-sync';
    canvasState.withSuppressedRecording(() => {
      canvasState.addNode({
        id: eventId,
        type: 'mcp-app',
        position: { x: 40, y: 40 },
        size: { width: 320, height: 240 },
        zIndex: 1,
        collapsed: false,
        pinned: false,
        dockPosition: null,
        data: { mode: 'ext-app', toolCallId: 'redo-sync', serverName: 'Fixture', toolName: 'show_counter' },
      });
    });
    const beforeRuntimeHistory = await jsonRequest<{ canRedo: boolean }>('/api/canvas/history');
    expect(beforeRuntimeHistory.canRedo).toBe(true);

    // Runtime app updates are SSE synchronization side effects and must not
    // truncate the user-visible redo stack.
    emitPrimaryWorkbenchEvent('ext-app-result', {
      toolCallId: 'redo-sync',
      nodeId: eventId,
      serverName: 'Fixture',
      toolName: 'show_counter',
      success: true,
      result: { content: [{ type: 'text', text: 'runtime result' }] },
    });

    const history = await jsonRequest<{ canRedo: boolean }>('/api/canvas/history');
    expect(history.canRedo).toBe(true);

    const redone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    expect(redone.ok).toBe(true);
    expect(redone.description).toContain('Updated 1 node (1 moved)');

    const replayed = await jsonRequest<{
      position: { x: number; y: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(replayed.position).toEqual({ x: 520, y: 420 });
  });

  test('ext-app open remains user-visible history while runtime result sync is suppressed', async () => {
    emitPrimaryWorkbenchEvent('ext-app-open', {
      toolCallId: 'undoable-open',
      nodeId: 'ext-app-undoable-open',
      title: 'Undoable app',
      html: '<main>app</main>',
      toolInput: {},
      serverName: 'Fixture',
      toolName: 'show_counter',
      appSessionId: 'session-undoable-open',
      transportConfig: { type: 'http', url: 'https://example.test/mcp' },
      resourceUri: 'ui://fixture/counter.html',
      toolDefinition: { name: 'show_counter' },
      sessionStatus: 'ready',
      sessionError: null,
    });

    const afterOpen = await jsonRequest<{ canUndo: boolean; text: string }>('/api/canvas/history');
    expect(afterOpen.canUndo).toBe(true);
    expect(afterOpen.text).toContain('Added mcp-app node "Undoable app"');

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Added mcp-app node "Undoable app"');

    const afterUndo = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(afterUndo.nodes.some((node) => node.id === 'ext-app-undoable-open')).toBe(false);
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

  test('can suppress browser-driven viewport updates from undo history', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Suppressed viewport target' }),
    });

    await jsonRequest<{ ok: boolean }>('/api/canvas/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x: 120, y: -80, scale: 1.5, recordHistory: false }),
    });

    const history = await jsonRequest<{ text: string }>('/api/canvas/history');
    expect(history.text).not.toContain('Updated viewport');

    const undone = await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    expect(undone.ok).toBe(true);
    expect(undone.description).toContain('Added markdown node "Suppressed viewport target"');

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.nodes.some((node) => node.id === created.id)).toBe(false);
    expect(state.viewport).toEqual({ x: 120, y: -80, scale: 1.5 });
  });

  test('fits the viewport to current canvas bounds over HTTP', async () => {
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Fit A', x: 100, y: 100, width: 200, height: 100 }),
    });
    await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Fit B', x: 700, y: 500, width: 300, height: 200 }),
    });

    const bodylessFit = await jsonRequest<{
      ok: boolean;
      nodeCount: number;
    }>('/api/canvas/fit', {
      method: 'POST',
    });
    expect(bodylessFit.ok).toBe(true);
    expect(bodylessFit.nodeCount).toBe(2);

    const fitted = await jsonRequest<{
      ok: boolean;
      viewport: { x: number; y: number; scale: number };
      bounds: { x: number; y: number; width: number; height: number };
      nodeCount: number;
    }>('/api/canvas/fit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 1200, height: 800, padding: 100 }),
    });

    expect(fitted.ok).toBe(true);
    expect(fitted.nodeCount).toBe(2);
    expect(fitted.bounds).toEqual({ x: 100, y: 100, width: 900, height: 600 });
    expect(fitted.viewport.scale).toBeCloseTo(1, 5);
    expect(fitted.viewport).toEqual({ x: 50, y: 0, scale: 1 });

    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(state.viewport).toEqual(fitted.viewport);
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

  test('generic group node APIs persist children and expose membership in snapshot diff', async () => {
    const first = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Group child A', x: 120, y: 120 }),
    });
    const second = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Group child B', x: 760, y: 120 }),
    });

    const createdGroup = await jsonRequest<{ id: string; data: Record<string, unknown> }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'group', title: 'Generic API Group', children: [first.id] }),
    });
    expect(createdGroup.data.children).toEqual([first.id]);

    const groupedFirst = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${first.id}`);
    expect(groupedFirst.data.parentGroup).toBe(createdGroup.id);

    const snapshotSave = await jsonRequest<{ snapshot: { id: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'before-group-patch' }),
    });

    const patchedGroup = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${createdGroup.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: [first.id, second.id] }),
    });
    expect(patchedGroup.data.children).toEqual([first.id, second.id]);

    const groupedSecond = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${second.id}`);
    expect(groupedSecond.data.parentGroup).toBe(createdGroup.id);

    const diff = await jsonRequest<{
      ok: boolean;
      text: string;
      diff: { modifiedNodes: Array<{ id: string; changes: string[] }> };
    }>(`/api/canvas/snapshots/${snapshotSave.snapshot.id}/diff`);
    expect(diff.ok).toBe(true);
    const groupDiff = diff.diff.modifiedNodes.find((node) => node.id === createdGroup.id);
    expect(groupDiff?.changes).toContain('data changed');
    expect(diff.text).toContain('Modified nodes');

    await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${createdGroup.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { children: [] } }),
    });

    const ungroupedFirst = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${first.id}`);
    const ungroupedSecond = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${second.id}`);
    expect(ungroupedFirst.data.parentGroup).toBeUndefined();
    expect(ungroupedSecond.data.parentGroup).toBeUndefined();

    const malformedPatch = await fetch(`${baseUrl}/api/canvas/node/${createdGroup.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ children: [first.id, 123] }),
    });
    expect(malformedPatch.status).toBe(400);
    const malformedBody = await malformedPatch.json() as { error?: string };
    expect(malformedBody.error).toContain('children');
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

    const pinnedNode = await jsonRequest<{ pinned: boolean }>(`/api/canvas/node/${firstNode.id}`);
    expect(pinnedNode.pinned).toBe(true);
    const stateWithPins = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(stateWithPins.nodes.find((node) => node.id === firstNode.id)?.pinned).toBe(true);
    expect(stateWithPins.nodes.find((node) => node.id === secondNode.id)?.pinned).toBe(false);

    const snapshotSave = await jsonRequest<{ ok: boolean; id: string; snapshot: { id: string; name: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'before-clear' }),
    });
    expect(snapshotSave.id).toBe(snapshotSave.snapshot.id);
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

    const queryDiff = await jsonRequest<{ ok: boolean; diff: { snapshotName: string } }>(
      `/api/canvas/snapshots/diff?name=${encodeURIComponent(snapshotSave.snapshot.name)}`,
    );
    expect(queryDiff.ok).toBe(true);
    expect(queryDiff.diff.snapshotName).toBe(snapshotSave.snapshot.name);

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

    await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/undo', {
      method: 'POST',
    });
    const undoneState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(undoneState.nodes).toEqual([]);
    expect(undoneState.edges).toEqual([]);
    expect(undoneState.viewport).toEqual({ x: 0, y: 0, scale: 1 });

    await jsonRequest<{ ok: boolean; description: string }>('/api/canvas/redo', {
      method: 'POST',
    });
    const redoneState = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(redoneState.nodes.find((node) => node.id === firstNode.id)?.data.title).toBe('First');
    expect(redoneState.nodes.find((node) => node.id === secondNode.id)?.position).toEqual({ x: 620, y: 120 });
  });

  test('limits, filters, and garbage-collects snapshots over HTTP', async () => {
    for (const name of ['http-alpha', 'http-beta', 'http-alpha-old']) {
      const saved = await jsonRequest<{ ok: boolean; snapshot: { name: string } }>('/api/canvas/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      expect(saved.snapshot.name).toBe(name);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }

    const limited = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?limit=2');
    expect(limited.map((item) => item.name)).toEqual(['http-alpha-old', 'http-beta']);

    const filtered = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?q=alpha&all=true');
    expect(filtered.map((item) => item.name)).toEqual(['http-alpha-old', 'http-alpha']);

    const preview = await jsonRequest<{
      ok: boolean;
      kept: number;
      dryRun: boolean;
      deleted: Array<{ name: string }>;
    }>('/api/canvas/snapshots/gc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 1, dryRun: true }),
    });
    expect(preview.ok).toBe(true);
    expect(preview.kept).toBe(1);
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted.map((item) => item.name)).toEqual(['http-beta', 'http-alpha']);

    const result = await jsonRequest<{
      ok: boolean;
      kept: number;
      dryRun: boolean;
      deleted: Array<{ name: string }>;
    }>('/api/canvas/snapshots/gc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keep: 1 }),
    });
    expect(result.ok).toBe(true);
    expect(result.kept).toBe(1);
    expect(result.dryRun).toBe(false);
    expect(result.deleted.map((item) => item.name)).toEqual(['http-beta', 'http-alpha']);

    const remaining = await jsonRequest<Array<{ name: string }>>('/api/canvas/snapshots?all=true');
    expect(remaining.map((item) => item.name)).toEqual(['http-alpha-old']);
  });

  test('pinned-context returns structured webpage context for CLI/http consumers', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
      fetch: { ok: boolean };
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'webpage',
        content: `${webpageOrigin}/article-long`,
        x: 200,
        y: 160,
      }),
    });
    expect(created.ok).toBe(true);
    expect(created.fetch.ok).toBe(true);

    const pins = await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [created.id] }),
    });
    expect(pins.count).toBe(1);

    const pinnedContext = await jsonRequest<{
      count: number;
      nodeIds: string[];
      preamble: string;
      nodes: Array<{
        id: string;
        type: string;
        title: string | null;
        content: string | null;
        metadata?: Record<string, unknown>;
        position?: { x: number; y: number };
      }>;
    }>('/api/canvas/pinned-context');
    expect(pinnedContext.count).toBe(1);
    expect(pinnedContext.nodeIds).toEqual([created.id]);
    expect(pinnedContext.preamble).toContain('Long-form webpage section 10');
    expect(pinnedContext.nodes).toEqual([
      expect.objectContaining({
        id: created.id,
        type: 'webpage',
        title: 'Long Canvas Webpage',
        content: expect.stringContaining('Long-form webpage section 10'),
        metadata: expect.objectContaining({
          url: `${webpageOrigin}/article-long`,
          pageTitle: 'Long Canvas Webpage',
          description: 'Long webpage node fixture',
        }),
        position: { x: 200, y: 160 },
      }),
    ]);
    expect(pinnedContext.nodes[0]).not.toHaveProperty('data');
  });

  test('pinned-context returns bounded web artifact source context without bundled html', async () => {
    const { initScriptPath, bundleScriptPath } = createFakeWebArtifactScripts(workspaceRoot);

    const build = await jsonRequest<{
      ok: boolean;
      id?: string;
      nodeId?: string;
    }>('/api/canvas/web-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pinned Artifact',
        appTsx: 'export default function App() { return <main>Pinned artifact explains the release checklist</main>; }',
        projectPath: '.pmx-canvas/artifacts/.web-artifacts/pinned-artifact',
        outputPath: '.pmx-canvas/artifacts/pinned-artifact.html',
        initScriptPath,
        bundleScriptPath,
      }),
    });
    expect(build.ok).toBe(true);
    expect(build.nodeId).toBeDefined();

    const pins = await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: [build.nodeId] }),
    });
    expect(pins.count).toBe(1);

    const pinnedContext = await jsonRequest<{
      preamble: string;
      nodes: Array<{ content: string | null; metadata?: Record<string, unknown> }>;
    }>('/api/canvas/pinned-context');
    expect(pinnedContext.preamble).toContain('Web artifact: Pinned Artifact');
    expect(pinnedContext.preamble).toContain('release checklist');
    expect(pinnedContext.preamble).not.toContain('<!DOCTYPE html>');
    expect(pinnedContext.nodes[0]?.content).toContain('Web artifact: Pinned Artifact');
    expect(pinnedContext.nodes[0]?.content).toContain('App source preview:');
    expect(pinnedContext.nodes[0]?.content).not.toContain('<!DOCTYPE html>');
    expect(pinnedContext.nodes[0]?.metadata).toEqual(expect.objectContaining({
      viewerType: 'web-artifact',
      sourceFiles: ['src/App.tsx'],
      sourceFileCount: 1,
    }));
  });

  test('pinned-context returns kind for native, graph, and mcp-app subtype nodes', async () => {
    const markdown = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Pinned Note', content: 'Native markdown context' }),
    });
    const graph = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Pinned Graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    });
    const artifactId = 'pinned-kind-artifact';
    canvasState.addNode({
      id: artifactId,
      type: 'mcp-app',
      position: { x: 20, y: 30 },
      size: { width: 640, height: 420 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'Pinned Artifact Kind',
        viewerType: 'web-artifact',
        hostMode: 'hosted',
        content: 'Web artifact: Pinned Artifact Kind',
        path: join(workspaceRoot, '.pmx-canvas', 'artifacts', 'pinned-kind-artifact.html'),
      },
    });
    const externalAppId = 'pinned-kind-external-app';
    canvasState.addNode({
      id: externalAppId,
      type: 'mcp-app',
      position: { x: 720, y: 30 },
      size: { width: 640, height: 420 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      dockPosition: null,
      data: {
        title: 'Pinned External App Kind',
        mode: 'ext-app',
        serverName: 'Fixture',
        toolName: 'show_counter',
      },
    });

    const ids = [markdown.id, graph.id, artifactId, externalAppId];
    const pins = await jsonRequest<{ ok: boolean; count: number }>('/api/canvas/context-pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeIds: ids }),
    });
    expect(pins.count).toBe(ids.length);

    const pinnedContext = await jsonRequest<{
      preamble: string;
      nodes: Array<{ id: string; type: string; kind: string }>;
    }>('/api/canvas/pinned-context');
    const kinds = Object.fromEntries(pinnedContext.nodes.map((node) => [node.id, { type: node.type, kind: node.kind }]));

    expect(kinds[markdown.id]).toEqual({ type: 'markdown', kind: 'markdown' });
    expect(kinds[graph.id]).toEqual({ type: 'graph', kind: 'graph' });
    expect(kinds[artifactId]).toEqual({ type: 'mcp-app', kind: 'web-artifact' });
    expect(kinds[externalAppId]).toEqual({ type: 'mcp-app', kind: 'external-app' });
    expect(pinnedContext.preamble).toContain('[Context from "Pinned Artifact Kind" (mcp-app/web-artifact)]');
    expect(pinnedContext.preamble).toContain('[Context from "Pinned External App Kind" (mcp-app/external-app)]');
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

    const steering = await jsonRequest<{ ok: boolean; steering: { id: string; message: string } }>('/api/canvas/ax/steer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'focus on the failing test', source: 'api' }),
    });
    expect(steering.steering.message).toBe('focus on the failing test');

    const evidence = await jsonRequest<{ ok: boolean; evidence: { id: string; kind: string } }>('/api/canvas/ax/evidence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'test-output', title: 'unit pass', source: 'api' }),
    });
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
    const body = await response.json() as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  test('AX work item and approval gate endpoints round-trip over HTTP', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'AX work node' }),
    });

    const created = await jsonRequest<{ ok: boolean; workItem: { id: string; status: string } }>('/api/canvas/ax/work', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Implement auth', status: 'todo', nodeIds: [node.id], source: 'api' }),
    });
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

    const gate = await jsonRequest<{ ok: boolean; approvalGate: { id: string; status: string } }>('/api/canvas/ax/approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Deploy to prod', action: 'deploy.prod', source: 'api' }),
    });
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

  test('AX review annotation and host capability endpoints round-trip over HTTP', async () => {
    const review = await jsonRequest<{ ok: boolean; reviewAnnotation: { id: string; status: string; severity: string } }>(
      '/api/canvas/ax/review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'off-by-one', kind: 'finding', severity: 'error', anchorType: 'file', file: 'src/x.ts', source: 'api' }),
      },
    );
    expect(review.reviewAnnotation.severity).toBe('error');

    // #39: a body-only review annotation (no anchorType, no nodeId) succeeds as an
    // unanchored note instead of 400ing — anchorType is documented optional.
    const bodyOnly = await jsonRequest<{ ok: boolean; reviewAnnotation: { id: string; anchorType: string; nodeId: string | null } }>(
      '/api/canvas/ax/review',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: 'general note, no anchor', source: 'api' }),
      },
    );
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

  test('GET /api/canvas/ax/surface-snapshot returns the compact board with review text redacted', async () => {
    const review = await jsonRequest<{ reviewAnnotation: { id: string } }>('/api/canvas/ax/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'secret human comment', author: 'alice', anchorType: 'file', file: 'x.ts', source: 'api' }),
    });
    const snap = await jsonRequest<{ reviewAnnotations: Array<Record<string, unknown>> }>('/api/canvas/ax/surface-snapshot');
    for (const k of ['focus', 'workItems', 'approvalGates', 'reviewAnnotations', 'elicitations', 'modeRequests', 'policy']) {
      expect(snap).toHaveProperty(k);
    }
    const entry = snap.reviewAnnotations.find((r) => r.id === review.reviewAnnotation.id);
    expect(entry).toBeDefined();
    // Free-text human fields are redacted from the surface snapshot.
    expect(entry?.body).toBeUndefined();
    expect(entry?.author).toBeUndefined();
    expect(entry?.severity).toBeDefined();
  });

  test('POST /api/canvas/open-external opens a node surface and validates input', async () => {
    const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Openable', html: '<p>x</p>' }),
    });
    const surfaceUrl = `/api/canvas/surface/${node.id}`;
    const ok = await jsonRequest<{ ok: boolean; opened: boolean; url: string }>('/api/canvas/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id, url: `${surfaceUrl}?theme=light` }),
    });
    expect(ok.ok).toBe(true);
    expect(ok.url).toBe(`${surfaceUrl}?theme=light`);
    expect(typeof ok.opened).toBe('boolean'); // false under PMX_CANVAS_DISABLE_BROWSER_OPEN

    const defaultTheme = await jsonRequest<{ ok: boolean; url: string }>('/api/canvas/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id }),
    });
    expect(defaultTheme.url).toBe(`${surfaceUrl}?theme=dark`);

    const missing = await fetch(`${baseUrl}/api/canvas/open-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'does-not-exist' }),
    });
    expect(missing.status).toBe(404);
    const noBody = await fetch(`${baseUrl}/api/canvas/open-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(noBody.status).toBe(400);

    const wrongNodeUrl = await fetch(`${baseUrl}/api/canvas/open-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id, url: '/api/canvas/surface/other?theme=light' }),
    });
    expect(wrongNodeUrl.status).toBe(400);
  });

  test('AX mutations emit ax-event-created and ax-state-changed SSE events', async () => {
    const abortController = new AbortController();
    const eventsPromise = (async () => {
      const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: abortController.signal });
      expect(response.ok).toBe(true);
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

    await Bun.sleep(50);
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

    const seen = await Promise.race([
      eventsPromise,
      Bun.sleep(2_000).then(() => new Set<string>()),
    ]);
    abortController.abort();

    expect(seen.has('ax-event-created')).toBe(true);
    expect(seen.has('ax-state-changed')).toBe(true);
  });

  test('canvas theme endpoint persists and returns the selected theme', async () => {
    const updated = await jsonRequest<{ ok: boolean; theme: string }>('/api/canvas/theme', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: 'light' }),
    });
    expect(updated).toEqual({ ok: true, theme: 'light' });

    const current = await jsonRequest<{ ok: boolean; theme: string }>('/api/canvas/theme');
    expect(current).toEqual({ ok: true, theme: 'light' });

    const state = await jsonRequest<{ theme?: string }>('/api/canvas/state');
    expect(state.theme).toBe('light');
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

    const edge = await jsonRequest<{
      ok: boolean;
      id: string;
      from: string;
      to: string;
      type: string;
      style?: string;
      animated?: boolean;
    }>('/api/canvas/edge', {
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
    expect(edge).toMatchObject({
      ok: true,
      from: firstNode.id,
      to: secondNode.id,
      type: 'references',
      style: 'dotted',
      animated: true,
    });

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

    if (!startResponse.ok) {
      expect([500, 501]).toContain(startResponse.status);
      const unsupported = await startResponse.json() as {
        ok: boolean;
        error: string;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(unsupported.ok).toBe(false);
      expect(unsupported.error.length).toBeGreaterThan(0);
      expect(unsupported.webview.active).toBe(false);
      expect(unsupported.webview.lastError).toContain(unsupported.error);
      if (!initialStatus.supported) {
        expect(startResponse.status).toBe(501);
        expect(unsupported.error).toContain('Bun.WebView');
      }
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

    if (!startResponse.ok) {
      expect([500, 501]).toContain(startResponse.status);
      const failed = await startResponse.json() as {
        ok: boolean;
        error: string;
        webview: WorkbenchWebViewStatusResponse;
      };
      expect(failed.ok).toBe(false);
      expect(failed.error.length).toBeGreaterThan(0);
      expect(failed.webview.active).toBe(false);
      return;
    }

    const evaluateResponse = await fetch(`${baseUrl}/api/workbench/webview/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression: 'document.title' }),
    });
    expect(evaluateResponse.ok).toBe(true);
    const evaluated = await evaluateResponse.json() as { ok: boolean; value: unknown };
    expect(evaluated.ok).toBe(true);
    expect(evaluated.value).toBe('PMX Canvas');

    const scriptResponse = await fetch(`${baseUrl}/api/workbench/webview/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        script: 'const title = await Promise.resolve(document.title); return `${title} async`;',
      }),
    });
    expect(scriptResponse.ok).toBe(true);
    const scriptEvaluated = await scriptResponse.json() as { ok: boolean; value: unknown };
    expect(scriptEvaluated.ok).toBe(true);
    expect(scriptEvaluated.value).toBe('PMX Canvas async');

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
      startedAt?: string;
      completedAt?: string;
      durationMs?: number;
      timeoutMs?: number;
      id?: string;
      nodeId?: string;
      url?: string;
      metadata?: Record<string, unknown>;
    }>('/api/canvas/web-artifact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'HTTP Artifact',
        appTsx: 'export default function App() { return <main>HTTP Artifact</main>; }',
        projectPath: '.pmx-canvas/artifacts/.web-artifacts/http-artifact',
        outputPath: '.pmx-canvas/artifacts/http-artifact.html',
        initScriptPath,
        bundleScriptPath,
      }),
    });

    expect(build.openedInCanvas).toBe(true);
    expect(build.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(build.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof build.durationMs).toBe('number');
    expect(build.timeoutMs).toBe(600000);
    expect(build.nodeId).toBeDefined();
    expect(build.id).toBe(build.nodeId);
    expect(build.url).toContain('/artifact?path=');
    expect(build.path).toContain('/.pmx-canvas/artifacts/http-artifact.html');
    expect(build.projectPath).toContain('/.pmx-canvas/artifacts/.web-artifacts/http-artifact');
    expect(build.metadata?.sourcePreview).toContain('HTTP Artifact');
    expect(JSON.stringify(build.metadata)).not.toContain('<!DOCTYPE html>');

    const artifactResponse = await fetch(`${baseUrl}${build.url}`);
    expect(artifactResponse.ok).toBe(true);
    expect(artifactResponse.headers.get('content-type')).toContain('text/html');
    const artifactHtml = await artifactResponse.text();
    expect(artifactHtml).toContain('HTTP Artifact');

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const artifactNode = layout.nodes.find((node) => node.id === build.nodeId);
    expect(artifactNode?.type).toBe('mcp-app');
    expect(artifactNode?.kind).toBe('web-artifact');
    expect(artifactNode?.data.path).toBe(build.path);
    expect(artifactNode?.data.content).toContain('Web artifact: HTTP Artifact');
    expect(artifactNode?.data.content).toContain('App source preview:');
    expect(artifactNode?.data.content).not.toContain('<!DOCTYPE html>');
    expect(artifactNode?.data.sourceFiles).toEqual(['src/App.tsx']);
    expect(artifactNode?.data.sourceFileCount).toBe(1);
    expect(artifactNode?.data.artifactBytes).toBeGreaterThan(0);
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
    expect(graphHtml).not.toContain('"height":320');

    const fixedHeightGraph = await jsonRequest<{ url: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Fixed Height Graph',
        graphType: 'line',
        data: [{ day: 'Mon', value: 3 }],
        height: 280,
      }),
    });
    const fixedHeightHtml = await (await fetch(`${baseUrl}${fixedHeightGraph.url}`)).text();
    expect(fixedHeightHtml).toContain('"height":280');

    const layout = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    expect(layout.nodes.find((node) => node.id === jsonRender.id)?.type).toBe('json-render');
    expect(layout.nodes.find((node) => node.id === graph.id)?.type).toBe('graph');
  }, 15_000);

  test('strict-size requests persist on json-render and graph nodes', async () => {
    const jsonRender = await jsonRequest<{
      id: string;
      size: { width: number; height: number };
      data: { strictSize?: boolean };
    }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Strict JSON UI',
        width: 420,
        height: 260,
        strictSize: true,
        spec: { type: 'Text', props: { text: 'Fixed frame' } },
      }),
    });

    expect(jsonRender.size).toEqual({ width: 420, height: 260 });
    expect(jsonRender.data.strictSize).toBe(true);

    const graph = await jsonRequest<{
      id: string;
      size: { width: number; height: number };
      data: { strictSize?: boolean };
    }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Strict Graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
        width: 360,
        nodeHeight: 220,
        strictSize: true,
      }),
    });

    expect(graph.size).toEqual({ width: 360, height: 220 });
    expect(graph.data.strictSize).toBe(true);
  });

  test('HTTP node creation broadcasts a live canvas-layout-update event', async () => {
    const abortController = new AbortController();
    const eventsPromise = (async () => {
      const response = await fetch(`${baseUrl}/api/workbench/events`, { signal: abortController.signal });
      expect(response.ok).toBe(true);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      const decoder = new TextDecoder();
      let buffer = '';
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          if (!frame.includes('event: canvas-layout-update')) continue;
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (!dataLine) continue;
          const payload = JSON.parse(dataLine.slice('data: '.length)) as { layout?: { nodes?: Array<{ id: string }> } };
          const nodeIds = payload.layout?.nodes?.map((node) => node.id) ?? [];
          if (nodeIds.some((id) => id.startsWith('node-'))) return nodeIds;
        }
      }
      return [];
    })();

    await Bun.sleep(50);
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'HTTP SSE node',
        content: 'broadcast me',
      }),
    });

    const nodeIds = await Promise.race([
      eventsPromise,
      Bun.sleep(2_000).then(() => [] as string[]),
    ]);
    abortController.abort();

    expect(nodeIds).toContain(created.id);
  });

  test('updates json-render and graph specs in place over HTTP', async () => {
    const jsonRender = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string };
    }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Original JSON UI',
        spec: {
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: 'Original JSON UI' }, children: ['copy'] },
            copy: { type: 'Text', props: { text: 'Original body' }, children: [] },
          },
        },
      }),
    });
    expect(jsonRender.node.id).toBe(jsonRender.id);

    const updatedJson = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string; data: { title: string; spec: { elements: Record<string, { props?: { text?: string } }> } } };
    }>(`/api/canvas/node/${jsonRender.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          root: 'card',
          elements: {
            card: { type: 'Card', props: { title: 'Updated JSON UI' }, children: ['copy'] },
            copy: { type: 'Text', props: { text: 'Updated body' }, children: [] },
          },
        },
      }),
    });
    expect(updatedJson.id).toBe(jsonRender.id);
    expect(updatedJson.node.id).toBe(jsonRender.id);
    expect(updatedJson.node.data.title).toBe('Updated JSON UI');
    expect(updatedJson.node.data.spec.elements.copy?.props?.text).toBe('Updated body');

    const graph = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { data: { graphConfig: Record<string, unknown> } };
    }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Original Graph',
        graphType: 'line',
        data: [{ day: 'Mon', value: 1 }],
        xKey: 'day',
        yKey: 'value',
      }),
    });

    const updatedGraph = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string; data: { graphConfig: Record<string, unknown>; spec: { elements: Record<string, { type?: string; props?: Record<string, unknown> }> } } };
    }>(`/api/canvas/node/${graph.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Updated Graph',
        graphType: 'bar',
        data: [{ day: 'Tue', value: 7 }],
        xKey: 'day',
        yKey: 'value',
        chartHeight: 420,
        color: '#f97316',
      }),
    });

    expect(updatedGraph.id).toBe(graph.id);
    expect(updatedGraph.node.id).toBe(graph.id);
    expect(updatedGraph.node.data.graphConfig.title).toBe('Updated Graph');
    expect(updatedGraph.node.data.graphConfig.graphType).toBe('bar');
    expect(updatedGraph.node.data.graphConfig.height).toBe(420);
    expect(updatedGraph.node.data.spec.elements.chart?.type).toBe('BarChart');
    expect(updatedGraph.node.data.spec.elements.chart?.props?.height).toBe(420);

    const metadataPatch = await jsonRequest<{
      ok: boolean;
      id: string;
      node: { id: string; data: { note?: string; graphConfig: Record<string, unknown> } };
    }>(`/api/canvas/node/${graph.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { note: 'metadata only' } }),
    });
    expect(metadataPatch.id).toBe(graph.id);
    expect(metadataPatch.node.data.note).toBe('metadata only');
    expect(metadataPatch.node.data.graphConfig.graphType).toBe('bar');

    const mixedGraphUpdate = await jsonRequest<{
      ok: boolean;
      node: { data: { arrangeLocked?: boolean; graphConfig: Record<string, unknown> } };
    }>(`/api/canvas/node/${graph.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [{ day: 'Wed', value: 11 }],
        arrangeLocked: true,
      }),
    });
    expect(mixedGraphUpdate.ok).toBe(true);
    expect(mixedGraphUpdate.node.data.arrangeLocked).toBe(true);
    expect(mixedGraphUpdate.node.data.graphConfig.data).toEqual([{ day: 'Wed', value: 11 }]);

    const invalidStructuredUpdate = await fetch(`${baseUrl}/api/canvas/node/${jsonRender.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphType: 'bar' }),
    });
    expect(invalidStructuredUpdate.ok).toBe(false);
    const invalidStructuredBody = await invalidStructuredUpdate.json() as { ok: boolean; error: string };
    expect(invalidStructuredBody.ok).toBe(false);
    expect(invalidStructuredBody.error).toContain('Graph update fields can only be used with graph nodes');

    const markdown = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Plain note' }),
    });
    const invalidSpecUpdate = await fetch(`${baseUrl}/api/canvas/node/${markdown.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: { root: 'card', elements: {} } }),
    });
    expect(invalidSpecUpdate.ok).toBe(false);
    const invalidSpecBody = await invalidSpecUpdate.json() as { ok: boolean; error: string };
    expect(invalidSpecBody.error).toContain('Structured spec and graph updates can only be used');
  });

  test('accepts json-render without title and wraps bare component specs for compatibility', async () => {
    const inferredTitle = await jsonRequest<{
      ok: boolean;
      id: string;
      spec: { root: string; elements: Record<string, unknown> };
    }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          root: 'card',
          elements: {
            card: {
              type: 'Card',
              props: { title: 'Inferred Dashboard' },
              children: [],
            },
          },
        },
      }),
    });
    expect(inferredTitle.ok).toBe(true);

    const inferredNode = await jsonRequest<{ data: { title: string } }>(`/api/canvas/node/${inferredTitle.id}`);
    expect(inferredNode.data.title).toBe('Inferred Dashboard');

    const bareComponent = await jsonRequest<{
      ok: boolean;
      id: string;
      spec: {
        root: string;
        elements: Record<string, { type?: string; props?: { text?: string; variant?: string; label?: string } }>;
      };
    }>('/api/canvas/json-render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spec: {
          type: 'Badge',
          props: { label: 'Legacy OK', variant: 'success' },
        },
      }),
    });

    expect(bareComponent.ok).toBe(true);
    expect(bareComponent.spec.root).toBe('root');
    expect(bareComponent.spec.elements.root?.type).toBe('Badge');
    expect(bareComponent.spec.elements.root?.props?.text).toBe('Legacy OK');
    expect(bareComponent.spec.elements.root?.props?.variant).toBe('success');
    expect(bareComponent.spec.elements.root?.props).not.toHaveProperty('label');
  });

  test('exposes running-server schema metadata and structured validation over HTTP', async () => {
    const schema = await jsonRequest<{
      ok: boolean;
      source: string;
      nodeTypes: Array<{ type: string; fields: Array<{ name: string; aliases?: string[]; required?: boolean }> }>;
      jsonRender: { components: Array<{ type: string }> };
      graph: { graphTypes: string[] };
      htmlPrimitives: Array<{ kind: string; dataShape: string }>;
      mcp: { tools: string[]; resources: string[]; nodeTypeRouting: Record<string, string> };
    }>('/api/canvas/schema');

    expect(schema.ok).toBe(true);
    expect(schema.source).toBe('running-server');
    expect(schema.nodeTypes.find((entry) => entry.type === 'webpage')?.fields.find((field) => field.name === 'url')?.aliases).toContain('content');
    expect(schema.nodeTypes.find((entry) => entry.type === 'image')?.fields.find((field) => field.name === 'content')?.aliases).toContain('path');
    const htmlFields = schema.nodeTypes.find((entry) => entry.type === 'html')?.fields ?? [];
    expect(htmlFields.find((field) => field.name === 'agentSummary')?.aliases).toContain('agent-summary');
    expect(htmlFields.find((field) => field.name === 'embeddedNodeIds')?.aliases).toEqual(expect.arrayContaining(['embedded-node-id', 'embedded-node-ids']));
    expect(htmlFields.find((field) => field.name === 'embeddedUrls')?.aliases).toEqual(expect.arrayContaining(['embedded-url', 'embedded-urls']));
    expect(htmlFields.find((field) => field.name === 'slideTitles')?.aliases).toEqual(expect.arrayContaining(['slide-title', 'slide-titles']));
    expect(schema.nodeTypes.find((entry) => entry.type === 'json-render')?.fields.find((field) => field.name === 'title')).toMatchObject({ required: false });
    expect(schema.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'zKey')).toBe(true);
    expect(schema.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'metrics')).toBe(true);
    expect(schema.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'toolName')).toBe(true);
    expect(schema.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'resultSummary')).toBe(true);
    expect(schema.nodeTypes.find((entry) => entry.type === 'web-artifact')?.fields.some((field) => field.name === 'timeoutMs')).toBe(true);
    expect(schema.jsonRender.components.some((component) => component.type === 'Table')).toBe(true);
    expect(schema.graph.graphTypes).toContain('area');
    expect(schema.graph.graphTypes).toContain('stacked-bar');
    expect(schema.graph.graphTypes).toContain('composed');
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'choice-grid')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'pr-writeup')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'code-walkthrough')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'interaction-prototype')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'illustration-set')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'presentation')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'incident-report')).toBe(true);
    expect(schema.htmlPrimitives.some((primitive) => primitive.kind === 'triage-board')).toBe(true);
    expect(schema.mcp.tools).toContain('canvas_describe_schema');
    expect(schema.mcp.tools).toContain('canvas_add_html_primitive');
    expect(schema.mcp.resources).toContain('canvas://schema');
    expect(schema.mcp.nodeTypeRouting).toMatchObject({
      markdown: 'canvas_add_node',
      'json-render': 'canvas_add_json_render_node',
      graph: 'canvas_add_graph_node',
      'web-artifact': 'canvas_build_web_artifact',
      'html-primitive': 'canvas_add_html_primitive',
      'external-app': 'canvas_open_mcp_app',
      group: 'canvas_create_group',
    });

    const jsonValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      normalizedSpec: {
        elements: Record<string, { props?: { rows?: string[][] } }>;
      };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'json-render',
        spec: {
          root: 'table',
          elements: {
            table: {
              type: 'Table',
              props: {
                columns: ['Metric', 'Value'],
                rows: [
                  ['Builds', 12],
                  ['Deploys', 4],
                ],
              },
              children: [],
            },
          },
        },
      }),
    });

    expect(jsonValidation.ok).toBe(true);
    expect(jsonValidation.type).toBe('json-render');
    expect(jsonValidation.normalizedSpec.elements.table?.props?.rows).toEqual([
      ['Builds', '12'],
      ['Deploys', '4'],
    ]);

    const graphValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      summary: { graphType: string; dataPoints: number };
      normalizedSpec: { elements: { chart?: { type?: string; props?: Record<string, unknown> } } };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'graph',
        title: 'Trend',
        graphType: 'composed',
        data: [
          { label: 'Docs', value: 5, rate: 0.2 },
          { label: 'Tests', value: 8, rate: 0.4 },
        ],
        xKey: 'label',
        barKey: 'value',
        lineKey: 'rate',
        barColor: '#60b5ff',
        lineColor: '#d7a83f',
      }),
    });

    expect(graphValidation.ok).toBe(true);
    expect(graphValidation.type).toBe('graph');
    expect(graphValidation.summary).toEqual(expect.objectContaining({ graphType: 'ComposedChart', dataPoints: 2 }));
    expect(graphValidation.normalizedSpec.elements.chart?.props).toEqual(expect.objectContaining({
      xKey: 'label',
      barKey: 'value',
      lineKey: 'rate',
      barColor: '#60b5ff',
      lineColor: '#d7a83f',
    }));

    const invalidGraphValidation = await fetch(`${baseUrl}/api/canvas/schema/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'graph',
        graphType: 'bar',
        data: [{ label: 'Docs', value: 5 }],
        xKey: 'missingLabel',
        yKey: 'value',
      }),
    });
    expect(invalidGraphValidation.ok).toBe(false);
    const invalidGraphBody = await invalidGraphValidation.json() as { ok: boolean; error: string };
    expect(invalidGraphBody.ok).toBe(false);
    expect(invalidGraphBody.error).toContain('missingLabel');
    expect(invalidGraphBody.error).toContain('Available keys: label, value');

    const invalidGraphCreate = await fetch(`${baseUrl}/api/canvas/graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphType: 'bar',
        data: [{ label: 'Docs', value: 5 }],
        xKey: 'label',
        yKey: 'missingValue',
      }),
    });
    expect(invalidGraphCreate.ok).toBe(false);
    const invalidGraphCreateBody = await invalidGraphCreate.json() as { ok: boolean; error: string };
    expect(invalidGraphCreateBody.ok).toBe(false);
    expect(invalidGraphCreateBody.error).toContain('missingValue');

    const htmlPrimitiveValidation = await jsonRequest<{
      ok: boolean;
      type: string;
      normalizedPrimitive: { kind: string; title: string; htmlBytes: number };
      summary: { dataKeys: string[] };
    }>('/api/canvas/schema/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'incident-report',
        title: 'HTTP Incident',
        data: {
          summary: 'Latency incident summary.',
          timeline: [{ time: '10:04', event: 'Alert fired', detail: 'p95 crossed threshold.' }],
        },
      }),
    });

    expect(htmlPrimitiveValidation.ok).toBe(true);
    expect(htmlPrimitiveValidation.type).toBe('html-primitive');
    expect(htmlPrimitiveValidation.normalizedPrimitive.kind).toBe('incident-report');
    expect(htmlPrimitiveValidation.normalizedPrimitive.title).toBe('HTTP Incident');
    expect(htmlPrimitiveValidation.normalizedPrimitive.htmlBytes).toBeGreaterThan(1000);
    expect(htmlPrimitiveValidation.summary.dataKeys).toContain('timeline');

    const invalidHtmlPrimitiveValidation = await fetch(`${baseUrl}/api/canvas/schema/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html-primitive',
        kind: 'presentation',
        data: {
          theme: 'nonexistent',
          slides: [{ title: 'Bad theme' }],
        },
      }),
    });
    expect(invalidHtmlPrimitiveValidation.status).toBe(400);
    expect((await invalidHtmlPrimitiveValidation.json() as { error: string }).error).toContain('Invalid presentation theme');
  });

  test('rejects invalid json-render payloads and invalid viewer requests', async () => {
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
