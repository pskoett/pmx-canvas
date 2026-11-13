import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasState } from '../../src/server/canvas-state.ts';
import { MARKDOWN_NODE_DEFAULT_SIZE, MCP_APP_NODE_DEFAULT_SIZE } from '../../src/server/canvas-operations.ts';
import { createFakeWebArtifactScripts } from './helpers.ts';
import {
  resetServerApiState,
  startServerApiSuite,
  stopServerApiSuite,
  tinyPng,
  type CanvasStateResponse,
  type ServerApiSuite,
} from './server-api-harness.ts';

describe('canvas server HTTP API: nodes', () => {
  let suite: ServerApiSuite | null = null;
  let workspaceRoot = '';
  let baseUrl = '';
  let webpageOrigin = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return (await response.json()) as T;
  }

  beforeAll(() => {
    suite = startServerApiSuite('pmx-canvas-api-nodes-');
    ({ workspaceRoot, baseUrl, webpageOrigin } = suite);
  });

  afterAll(() => {
    if (suite) stopServerApiSuite(suite);
  });

  beforeEach(resetServerApiState);

  test('search ranks library metadata and README hits consistently with cards without switching boards', async () => {
    const original = canvasState.activeBoardId;
    const activeBoard = canvasState.createBoard('Deployment')!;
    const archive = canvasState.createBoard('TV2 pictures')!;
    canvasState.switchBoard(archive.id);
    const readme = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Overview', content: 'TV2 image collection' }),
    });
    canvasState.setBoardReadme(archive.id, readme.id);
    canvasState.switchBoard(activeBoard.id);
    const exact = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'V2', content: 'Pilot deployment plan' }),
    });
    type Search = { results: Array<{ id: string; boardId: string }> };
    const active = await jsonRequest<Search>('/api/canvas/search?q=V2');
    expect(active.results.map((result) => result.id)).toEqual([exact.id]);
    const library = await jsonRequest<Search>('/api/canvas/search?q=%20V2%20&scope=library');
    expect(library.results[0]?.id).toBe(exact.id);
    expect(library.results.map((result) => result.id)).toContain(archive.id);
    expect(library.results.map((result) => result.id)).toContain(readme.id);
    const limited = await jsonRequest<Search>('/api/canvas/search?q=V2&scope=library&limit=1');
    expect(limited.results.map((result) => result.id)).toEqual([exact.id]);
    expect(canvasState.activeBoardId).toBe(activeBoard.id);
    canvasState.switchBoard(original);
    canvasState.deleteBoard(archive.id);
    canvasState.deleteBoard(activeBoard.id);
  });

  test('search filters intersect board and normalized folder before ranking limits without activating boards', async () => {
    const original = canvasState.activeBoardId;
    const boards = [
      canvasState.createBoard('Filter parent', 'Search')!,
      canvasState.createBoard('Filter child', 'Search/Child')!,
      canvasState.createBoard('Filter sibling', 'Searchable')!,
      canvasState.createBoard('Filter unfiled')!,
    ];
    const ids: string[] = [];
    try {
      for (const [index, board] of boards.entries()) {
        canvasState.switchBoard(board.id);
        const node = await jsonRequest<{ id: string }>('/api/canvas/node', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'markdown', title: index === 3 ? 'Needle' : 'Overview', content: 'Needle' }),
        });
        ids.push(node.id);
      }
      const search = async (options: Record<string, string> = {}) => {
        const result = await jsonRequest<{ results: Array<{ id: string }> }>(
          `/api/canvas/search?${new URLSearchParams({ q: 'Needle absent', ...options })}`,
        );
        expect(canvasState.activeBoardId).toBe(boards[3]!.id);
        return result.results.map((hit) => hit.id);
      };
      expect(await search()).toEqual([ids[3]!]);
      expect((await search({ folder: ' Search ' })).sort()).toEqual(ids.slice(0, 2).sort());
      expect(await search({ boardId: boards[1]!.id, folder: 'Search', limit: '1' })).toEqual([ids[1]!]);
      expect(await search({ boardId: boards[1]!.id, folder: 'Search/Child', scope: 'library' })).toEqual([ids[1]!]);
      expect(await search({ boardId: boards[2]!.id, folder: 'Search' })).toEqual([]);
      expect(await search({ boardId: 'missing' })).toEqual([]);
      expect(await search({ folder: 'missing' })).toEqual([]);
      expect(await search({ folder: '' })).toEqual([ids[3]!]);
      expect(await search({ scope: 'active', folder: 'Search' })).toEqual([]);
      expect(await search({ scope: 'active', boardId: boards[1]!.id })).toEqual([]);
      expect(await search({ scope: 'active', folder: '', boardId: boards[3]!.id })).toEqual([ids[3]!]);
    } finally {
      canvasState.switchBoard(original);
      for (const board of boards) canvasState.deleteBoard(board.id);
    }
  });

  test('search returns topic-ranked cards and matching README passages through the HTTP API', async () => {
    const original = canvasState.activeBoardId;
    const board = canvasState.createBoard('Architecture', 'Search/Decisions')!;
    try {
      canvasState.switchBoard(board.id);
      const add = (title: string, content: string) =>
        jsonRequest<{ id: string }>('/api/canvas/node', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'markdown', title, content }),
        });
      const readme = await add(
        'Overview',
        `# Fabric\n\n${'Workshop reference. '.repeat(40)}\n\nAtlas Fabric was rejected. The reason is not recorded.`,
      );
      canvasState.setBoardReadme(board.id, readme.id);
      const generic = await add('Why was Atlas?', 'Atlas');
      const current = await add('Platform overview', 'Current Platform OKRs. Scope is not verified.');
      const historical = await add('Platform OKRs', 'Historical cycle.');
      canvasState.switchBoard(original);
      const search = (q: string, extra: Record<string, string> = {}) =>
        jsonRequest<{ results: Array<{ id: string; snippet: string }> }>(
          `/api/canvas/search?${new URLSearchParams({ q, folder: 'Search', ...extra })}`,
        );
      const decisions = await search('Why was Atlas Fabric rejected?');
      for (const id of [board.id, readme.id]) {
        const hit = decisions.results.find((result) => result.id === id);
        expect(hit?.snippet).toContain('Atlas Fabric was rejected. The reason is not recorded.');
        expect(decisions.results.findIndex((result) => result.id === id)).toBeLessThan(
          decisions.results.findIndex((result) => result.id === generic.id),
        );
      }
      const okrs = await search('What are the current Platform OKRs?');
      expect(okrs.results.map((result) => result.id)).toEqual([current.id, historical.id]);
      expect(okrs.results[0]?.snippet).toContain('Scope is not verified.');
      expect((await search('What are the current Platform OKRs?', { limit: '1' })).results[0]?.id).toBe(current.id);
      expect(canvasState.activeBoardId).toBe(original);
    } finally {
      canvasState.switchBoard(original);
      canvasState.deleteBoard(board.id);
    }
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

    const fetchedNode = await jsonRequest<{
      id: string;
      title: string | null;
      content: string | null;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${created.id}`);
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

  test('rejects invalid explicit provenance on create and update with field errors', async () => {
    const headers = { 'Content-Type': 'application/json' };
    const invalid = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'status', data: { provenance: { sourceKind: 'recipe' } } }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.text()).toContain('sourceUri');
    expect((await jsonRequest<CanvasStateResponse>('/api/canvas/state')).nodes).toHaveLength(0);

    const provenance = { sourceKind: 'recipe', sourceUri: 'recipe://plan', refreshStrategy: 'agent-request' };
    const created = await jsonRequest<{ id: string }>('/api/canvas/node', {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'status', title: 'Original', data: { provenance } }),
    });
    const before = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const updated = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ data: { provenance: { ...provenance, refreshStrategy: 'unknown' } } }),
    });
    expect(updated.status).toBe(400);
    expect(await updated.text()).toContain('refreshStrategy');
    expect((await jsonRequest<CanvasStateResponse>('/api/canvas/state')).nodes).toEqual(before.nodes);
  });

  test('creates diff nodes with the diff default size and clamps undersized creates', async () => {
    const diffContent = ['--- a/src/app.ts', '+++ b/src/app.ts', '@@ -1 +1 @@', '-const a = 1;', '+const a = 2;'].join(
      '\n',
    );
    const created = await jsonRequest<{ id: string; type?: string; size: { width: number; height: number } }>(
      '/api/canvas/node',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'diff', title: 'App fix', content: diffContent }),
      },
    );
    expect(created.size).toEqual({ width: 640, height: 420 });
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const node = state.nodes.find((n) => n.id === created.id);
    expect(node?.type).toBe('diff');
    expect(node?.data.content).toBe(diffContent);

    // An undersized explicit create clamps to the diff minimum (420x240).
    const undersized = await jsonRequest<{ id: string; size: { width: number; height: number } }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'diff', title: 'Tiny', content: diffContent, width: 300, height: 150 }),
    });
    expect(undersized.size).toEqual({ width: 420, height: 240 });

    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${created.id}`, { method: 'DELETE' });
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${undersized.id}`, { method: 'DELETE' });
  });

  test('creates mermaid nodes with the mermaid default size and serves their surface', async () => {
    const mermaidSource = 'graph TD; A-->B;';
    const created = await jsonRequest<{ id: string; type?: string; size: { width: number; height: number } }>(
      '/api/canvas/node',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'mermaid', title: 'Flow', content: mermaidSource }),
      },
    );
    expect(created.size).toEqual({ width: 640, height: 460 });
    const state = await jsonRequest<CanvasStateResponse>('/api/canvas/state');
    const node = state.nodes.find((n) => n.id === created.id);
    expect(node?.type).toBe('mermaid');
    expect(node?.data.content).toBe(mermaidSource);

    // The surface serves the ESCAPED source plus the renderer bundle script.
    const res = await fetch(`${baseUrl}/api/canvas/surface/${created.id}?theme=harbor`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    const body = await res.text();
    expect(body).toContain('graph TD; A--&gt;B;');
    expect(body).toContain('<pre class="mermaid-source"');
    expect(body).toContain('<script src="/canvas/mermaid-entry.js"></script>');

    // srcdoc-mode fetches ask for inlined assets: hosts that block sub-frame
    // documents block the script subresource too, so the renderer is embedded.
    const inline = await fetch(`${baseUrl}/api/canvas/surface/${created.id}?theme=harbor&inline-assets=1`);
    expect(inline.status).toBe(200);
    const inlineBody = await inline.text();
    expect(inlineBody).toContain('<pre class="mermaid-source"');
    expect(inlineBody).not.toContain('<script src="/canvas/mermaid-entry.js"');
    // Parser-safe base64 is decoded into script text, with no subresource URL.
    expect(inlineBody.includes('s.textContent=new TextDecoder().decode(')).toBe(true);
    expect(inlineBody.includes('<script src="data:')).toBe(false);
    expect(inlineBody.length).toBeGreaterThan(1_000_000);

    // An undersized explicit create clamps to the mermaid minimum (360x240).
    const undersized = await jsonRequest<{ id: string; size: { width: number; height: number } }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'mermaid', title: 'Tiny', content: mermaidSource, width: 200, height: 100 }),
    });
    expect(undersized.size).toEqual({ width: 360, height: 240 });

    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${created.id}`, { method: 'DELETE' });
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${undersized.id}`, { method: 'DELETE' });
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
      body: JSON.stringify({
        title: 'G',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
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
        points: [
          { x: 10, y: 20 },
          { x: 40, y: 80 },
        ],
        color: 'currentColor',
        width: 4,
      }),
    });

    expect(created.annotation.color).toBe('currentColor');
    expect(created.annotation.pointCount).toBe(2);
    expect(created.annotation.text).toBeNull();
    expect(
      (await jsonRequest<CanvasStateResponse>('/api/canvas/state')).annotations?.map((annotation) => annotation.id),
    ).toEqual([created.annotation.id]);

    const removed = await jsonRequest<{ ok: boolean; removed: string }>(
      `/api/canvas/annotation/${created.annotation.id}`,
      {
        method: 'DELETE',
      },
    );

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
    const payload = (await response.json()) as { ok: boolean; error: string };

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
    const payload = (await response.json()) as { ok: boolean; error: string };

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

  test('a batch containing pin ops emits one final context-pins-changed frame', async () => {
    // Finding X (0.4.5): the batch suppression window swallowed the pins op's
    // context-pins-changed, leaving client pin state (menus, indicators) stale
    // until reload. The batch must follow its single layout frame with one
    // final pins frame carrying the end state.
    const seq = ((await fetch(`${baseUrl}/api/workbench/poll`).then((r) => r.json())) as { seq: number }).seq;
    const batch = (await fetch(`${baseUrl}/api/canvas/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operations: [
          {
            op: 'node.add',
            assign: 'note',
            args: { type: 'markdown', title: 'Batch pin note', content: 'x', x: 40, y: 900 },
          },
          { op: 'pin.add', args: { nodeIds: ['$note'] } },
        ],
      }),
    }).then((r) => r.json())) as { ok: boolean; refs: { note?: { id?: string } } };
    expect(batch.ok).toBe(true);
    const nodeId = batch.refs.note?.id ?? '';
    expect(nodeId).not.toBe('');

    const { events } = (await fetch(`${baseUrl}/api/workbench/poll?since=${seq}`).then((r) => r.json())) as {
      events: Array<{ event: string; payload: Record<string, unknown> }>;
    };
    const pinsFrame = events.find((entry) => entry.event === 'context-pins-changed');
    expect(pinsFrame).toBeDefined();
    expect((pinsFrame?.payload.nodeIds as string[]) ?? []).toContain(nodeId);

    // Cleanup: unpin + remove the probe node.
    await fetch(`${baseUrl}/api/canvas/context-pins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'remove', nodeIds: [nodeId] }),
    });
    await fetch(`${baseUrl}/api/canvas/node/${nodeId}`, { method: 'DELETE' });
  });

  test('undersized explicit creation frames are clamped to type floors; strictSize opts out', async () => {
    // 0.4.5 report follow-up: agents kept creating unreadably small nodes.
    const clamped = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Tiny probe',
        content: 'x',
        x: 40,
        y: 1300,
        width: 180,
        height: 90,
      }),
    }).then((r) => r.json())) as {
      id: string;
      sizeAdjustment: {
        requested: { width: number; height: number };
        applied: { width: number; height: number };
        reason: string;
      };
    };
    expect(clamped.sizeAdjustment).toEqual({
      requested: { width: 180, height: 90 },
      applied: { width: 360, height: 180 },
      reason: 'clamped-to-minimum',
    });
    const clampedState = (await fetch(`${baseUrl}/api/canvas/node/${clamped.id}`).then((r) => r.json())) as {
      size: { width: number; height: number };
    };
    expect(clampedState.size).toEqual({ width: 360, height: 180 });

    const strict = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Strict tiny',
        content: 'x',
        x: 460,
        y: 1300,
        width: 180,
        height: 90,
        strictSize: true,
      }),
    }).then((r) => r.json())) as { id: string };
    const strictState = (await fetch(`${baseUrl}/api/canvas/node/${strict.id}`).then((r) => r.json())) as {
      size: { width: number; height: number };
    };
    expect(strictState.size).toEqual({ width: 180, height: 90 });

    // Graph creator has its own size path — same floor applies.
    const graph = (await fetch(`${baseUrl}/api/canvas/graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphType: 'bar',
        title: 'Tiny graph',
        data: [{ label: 'a', value: 1 }],
        xKey: 'label',
        yKey: 'value',
        x: 900,
        y: 1300,
        width: 200,
        nodeHeight: 140,
      }),
    }).then((r) => r.json())) as { id: string };
    const graphState = (await fetch(`${baseUrl}/api/canvas/node/${graph.id}`).then((r) => r.json())) as {
      size: { width: number; height: number };
    };
    expect(graphState.size).toEqual({ width: 420, height: 280 });

    const plotHeightOnly = (await fetch(`${baseUrl}/api/canvas/graph`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graphType: 'bar',
        data: [{ label: 'a', value: 1 }],
        xKey: 'label',
        yKey: 'value',
        height: 180,
      }),
    }).then((r) => r.json())) as {
      id: string;
      sizeAdjustment: { requested: { height: null }; applied: { height: number }; reason: string };
      warning: string;
    };
    expect(plotHeightOnly.sizeAdjustment).toMatchObject({
      requested: { height: null },
      applied: { height: 520 },
      reason: 'defaulted',
    });
    expect(plotHeightOnly.warning).toContain('plot height');

    // The update path stays unclamped — but validate reports the undersized
    // node as an advisory sizeWarning (strictSize nodes are exempt).
    await fetch(`${baseUrl}/api/canvas/node/${clamped.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ width: 200, height: 100 }),
    });
    const validation = (await fetch(`${baseUrl}/api/canvas/validate`).then((r) => r.json())) as {
      ok: boolean;
      sizeWarnings: Array<{ id: string; minWidth: number; minHeight: number }>;
      summary: { sizeWarnings: number };
    };
    const warning = validation.sizeWarnings.find((w) => w.id === clamped.id);
    expect(warning).toMatchObject({ minWidth: 360, minHeight: 180 });
    expect(validation.sizeWarnings.some((w) => w.id === strict.id)).toBe(false);
    expect(validation.summary.sizeWarnings).toBeGreaterThanOrEqual(1);

    for (const id of [clamped.id, strict.id, graph.id, plotHeightOnly.id]) {
      await fetch(`${baseUrl}/api/canvas/node/${id}`, { method: 'DELETE' });
    }
  });

  test('a group auto-fit over a non-member is reported by create and flagged by validate', async () => {
    const post = async (path: string, body: unknown) =>
      (await fetch(`${baseUrl}/api/canvas/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }).then((r) => r.json())) as { id: string; sizeAdjustment?: { reason: string } };

    const member = await post('node', { type: 'markdown', content: 'm', x: 9000, y: 9000, width: 360, height: 180 });
    const neighbour = await post('node', { type: 'markdown', content: 'n', x: 9000, y: 9230, width: 360, height: 180 });
    const group = await post('group', { title: 'Fit', childIds: [member.id] });
    expect(group.sizeAdjustment?.reason).toBe('fit-to-children');

    const validation = (await fetch(`${baseUrl}/api/canvas/validate`).then((r) => r.json())) as {
      groupFrameOverlaps: Array<{ aId: string; bId: string }>;
    };
    const flagged = validation.groupFrameOverlaps.filter((p) => [p.aId, p.bId].includes(group.id));
    expect(flagged).toEqual([expect.objectContaining({ aId: neighbour.id, bId: group.id })]);

    for (const id of [group.id, member.id, neighbour.id]) {
      await fetch(`${baseUrl}/api/canvas/node/${id}`, { method: 'DELETE' });
    }
  });

  test('structured create reports only actual size adjustments; updates keep requested dimensions', async () => {
    const spec = { root: 'text', elements: { text: { type: 'Text', props: { text: 'Size report' }, children: [] } } };
    for (const [route, payload] of [
      ['json-render', { spec }],
      ['json-render/stream', { patches: [] }],
      ['graph', { graphType: 'bar', data: [{ label: 'a', value: 2 }], xKey: 'label', yKey: 'value' }],
    ] as const) {
      for (const geometry of [
        { width: 811, height: 433, nodeHeight: 433 },
        { width: 123, height: 97, nodeHeight: 97, strictSize: true },
        { width: 123 },
      ]) {
        const response = await fetch(`${baseUrl}/api/canvas/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, ...geometry }),
        });
        expect(response.ok).toBe(true);
        const created = (await response.json()) as {
          id: string;
          sizeAdjustment?: { requested: { width: number; height: number | null }; reason: string };
        };
        if (geometry.height === undefined) {
          expect(created.sizeAdjustment).toMatchObject({
            requested: { width: 123, height: null },
            reason: 'defaulted-and-clamped-to-minimum',
          });
        } else {
          expect(created.sizeAdjustment).toBeUndefined();
        }
        const updated = await fetch(`${baseUrl}/api/canvas/node/${created.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: { width: 201, height: 109 } }),
        });
        const body = (await updated.json()) as { size: { width: number; height: number }; sizeAdjustment?: unknown };
        expect(body.size).toEqual({ width: 201, height: 109 });
        expect(body.sizeAdjustment).toBeUndefined();
        await fetch(`${baseUrl}/api/canvas/node/${created.id}`, { method: 'DELETE' });
      }
    }
  });

  test('an agent-created context node lands on the canvas where it was put, expanded', async () => {
    // 0.4.6 orb feedback #1: a context node existed in the API and passed
    // validation but never rendered (silently auto-docked), so an edge to it
    // trailed off into empty space.
    const ctx = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'context', title: 'Visible context', content: 'ctx', x: 200, y: 2400 }),
    }).then((r) => r.json())) as { id: string; node: { position: { x: number; y: number }; collapsed: boolean } };
    expect(ctx.node.position).toEqual({ x: 200, y: 2400 });
    expect(ctx.node.collapsed).toBe(false);

    const peer = (await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge peer', content: 'x', x: 800, y: 2400 }),
    }).then((r) => r.json())) as { id: string };

    const goodEdge = (await fetch(`${baseUrl}/api/canvas/edge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: ctx.id, to: peer.id, type: 'relation' }),
    }).then((r) => r.json())) as { id: string };
    const validation = (await fetch(`${baseUrl}/api/canvas/validate`).then((r) => r.json())) as {
      ok: boolean;
      missingEdgeEndpoints: unknown[];
    };
    expect(validation.ok).toBe(true);
    expect(validation.missingEdgeEndpoints).toEqual([]);

    await fetch(`${baseUrl}/api/canvas/edge?id=${goodEdge.id}`, { method: 'DELETE' });
    for (const id of [ctx.id, peer.id]) {
      await fetch(`${baseUrl}/api/canvas/node/${id}`, { method: 'DELETE' });
    }
  });

  test('strictSize persists for every node type, not just the generic ones', async () => {
    // The per-type builders for file/image/webpage return a fresh data object
    // and used to drop `strictSize`. The creation clamp still honored it (it
    // reads the input directly), but nothing persisted `data.strictSize`, so
    // the browser's auto-fit resized the node anyway — the same "server says
    // one thing, browser undoes it" class as the 0.4.6 Finding AA floor bug.
    const created: Array<{ type: string; id: string; strictSize: unknown; size: { width: number; height: number } }> =
      [];
    const specs = [
      { type: 'file', title: 'Strict file', content: 'line one\nline two' },
      {
        type: 'image',
        title: 'Strict image',
        content:
          'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiLz4=',
      },
      { type: 'markdown', title: 'Strict markdown', content: 'x' },
      { type: 'trace', title: 'Strict trace', content: 'x' },
    ];
    for (const spec of specs) {
      const node = (await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...spec, strictSize: true, x: 60, y: 4200, width: 200, height: 100 }),
      }).then((r) => r.json())) as {
        id: string;
        node: { data: Record<string, unknown>; size: { width: number; height: number } };
      };
      created.push({ type: spec.type, id: node.id, strictSize: node.node.data.strictSize, size: node.node.size });
    }

    for (const entry of created) {
      expect(entry.strictSize, `${entry.type} must persist strictSize`).toBe(true);
      // strictSize also opts out of the readability floor, so the small frame stands.
      expect(entry.size, `${entry.type} keeps its explicit frame`).toEqual({ width: 200, height: 100 });
    }

    for (const entry of created) {
      await fetch(`${baseUrl}/api/canvas/node/${entry.id}`, { method: 'DELETE' });
    }
  });

  test('dead create/patch fields are rejected loudly — content is the canonical field', async () => {
    // file + path → 400 with guidance (was silently dropped, node rendered empty).
    const filePath = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', title: 'Trap', path: 'src/shared/iframe-probe.ts' }),
    });
    expect(filePath.status).toBe(400);
    expect(((await filePath.json()) as { error: string }).error).toContain('as `content`');

    // dockPosition → 400: docking was removed in 0.5.0, and a silently-ignored
    // create read as "docking works" (0.5.0 Copilot report, PASS-ish).
    const docked = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'context', title: 'Trap', content: 'x', dockPosition: 'left' }),
    });
    expect(docked.status).toBe(400);
    expect(((await docked.json()) as { error: string }).error).toContain('docking was removed');

    // any type + src → 400.
    const imgSrc = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'image', title: 'Trap', src: 'data:image/png;base64,xx' }),
    });
    expect(imgSrc.status).toBe(400);
    expect(((await imgSrc.json()) as { error: string }).error).toContain('content');

    // image + path stays a working compatibility alias (documented).
    // (covered by the existing 'Path image' test — no duplicate here.)

    // patch: `path` on a file node is the REPOINT field (round-2 review) —
    // valid string moves the node, but an empty one is still rejected loudly.
    const made = (await (
      await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', title: 'Real file', content: 'src/shared/iframe-probe.ts' }),
      })
    ).json()) as { id: string };
    const emptyRepoint = await fetch(`${baseUrl}/api/canvas/node/${made.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '   ' }),
    });
    expect(emptyRepoint.status).toBe(400);
    expect(((await emptyRepoint.json()) as { error: string }).error).toContain('non-empty');
    // path on a non-file, non-image node stays dead and loud.
    const md = (await (
      await fetch(`${baseUrl}/api/canvas/node`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'markdown', title: 'Doc', content: 'x' }),
      })
    ).json()) as { id: string };
    const mdPath = await fetch(`${baseUrl}/api/canvas/node/${md.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'readme.md' }),
    });
    expect(mdPath.status).toBe(400);
    await fetch(`${baseUrl}/api/canvas/node/${made.id}`, { method: 'DELETE', headers: { 'x-pmx-workbench': '1' } });
    await fetch(`${baseUrl}/api/canvas/node/${md.id}`, { method: 'DELETE', headers: { 'x-pmx-workbench': '1' } });
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

    const createdFile = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      path: string | null;
      content: string | null;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${fileNode.id}`);
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

    const arrangedFile = await jsonRequest<{ id: string; position: { x: number; y: number } }>(
      `/api/canvas/node/${fileNode.id}`,
    );
    const arrangedMarkdown = await jsonRequest<{ id: string; position: { x: number; y: number } }>(
      `/api/canvas/node/${markdownNode.id}`,
    );
    expect(arrangedFile.position).toEqual({ x: 40, y: 80 });
    // 80 + the file node's 360 default height (0.4.5: real code-preview size)
    // + the column gap.
    expect(arrangedMarkdown.position).toEqual({ x: 40, y: 464 });
  });

  test('binary file nodes carry byte metadata instead of mojibake and serve their bytes', async () => {
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'ascii'),
      Buffer.from([0x00, 0x01, 0x02, 0x03]),
      Buffer.from('\n%%EOF\n', 'ascii'),
    ]);
    const pdfPath = join(workspaceRoot, 'file-bytes-fixture.pdf');
    writeFileSync(pdfPath, pdfBytes);

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: pdfPath, title: 'file-bytes-fixture.pdf' }),
    });

    const node = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.data.binary).toBe(true);
    expect(node.data.mimeType).toBe('application/pdf');
    expect(node.data.byteSize).toBe(pdfBytes.length);
    expect(node.data.fileContent).toBeUndefined();
    expect(node.data.lineCount).toBeUndefined();

    const bytes = await fetch(`${baseUrl}/api/canvas/file-bytes?nodeId=${created.id}`);
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get('content-type')).toBe('application/pdf');
    expect(bytes.headers.get('content-disposition')).toBe('inline');
    expect(bytes.headers.get('cache-control')).toBe('no-store');
    expect(Buffer.from(await bytes.arrayBuffer()).equals(pdfBytes)).toBe(true);

    const head = await fetch(`${baseUrl}/api/canvas/file-bytes?nodeId=${created.id}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe('application/pdf');

    await jsonRequest(`/api/canvas/node/${created.id}`, { method: 'DELETE' });
    rmSync(pdfPath, { force: true });
  });

  test('the file-bytes route refuses paths outside the workspace and unknown nodes', async () => {
    // File node creation does not enforce containment, so the node can be
    // planted with a path in the parent dir; the byte route must refuse it.
    const outsidePath = join(workspaceRoot, '..', `pmx-file-bytes-traversal-${Date.now()}.pdf`);
    writeFileSync(outsidePath, Buffer.from('%PDF-1.4\n', 'ascii'));
    try {
      const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', content: outsidePath, title: 'outside.pdf' }),
      });

      const forbidden = await fetch(`${baseUrl}/api/canvas/file-bytes?nodeId=${created.id}`);
      expect(forbidden.status).toBe(403);
      const forbiddenPayload = (await forbidden.json()) as { ok: boolean; error: string };
      expect(forbiddenPayload.ok).toBe(false);
      expect(forbiddenPayload.error).toContain('outside the workspace');

      const unknown = await fetch(`${baseUrl}/api/canvas/file-bytes?nodeId=node-not-on-canvas`);
      expect(unknown.status).toBe(404);

      await jsonRequest(`/api/canvas/node/${created.id}`, { method: 'DELETE' });
    } finally {
      rmSync(outsidePath, { force: true });
    }
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

    const groupedFirst = await jsonRequest<{ position: { x: number; y: number }; data: Record<string, unknown> }>(
      `/api/canvas/node/${first.id}`,
    );
    const groupedSecond = await jsonRequest<{ position: { x: number; y: number }; data: Record<string, unknown> }>(
      `/api/canvas/node/${second.id}`,
    );
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
    const payload = (await response.json()) as { ok: boolean; error: string };

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
    expect(validation.containments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupId: String(batch.refs.frame?.id),
          childId: String(batch.refs.child?.id),
        }),
      ]),
    );

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
    const a = await post({
      type: 'markdown',
      title: 'GA',
      content: 'a',
      x: 100,
      y: 100,
      width: 280,
      height: 180,
      strictSize: true,
    });
    const b = await post({
      type: 'markdown',
      title: 'GB',
      content: 'b',
      x: 900,
      y: 600,
      width: 280,
      height: 180,
      strictSize: true,
    });
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
    expect(batch.results[0]?.data.fileContent).toEqual(
      expect.objectContaining({
        omitted: 'file-content',
        bytes: Buffer.byteLength(content, 'utf-8'),
      }),
    );
    expect(String(batch.results[0]?.data.fileContent)).not.toContain('export const value119');
  });

  test('creates and refreshes webpage nodes over HTTP with cached text context', async () => {
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
        content: `${webpageOrigin}/article?v=1`,
      }),
    });
    expect(created.fetch.ok).toBe(true);

    const node = await jsonRequest<{
      id: string;
      type: string;
      url: string | null;
      content: string | null;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${created.id}`);
    expect(node.type).toBe('webpage');
    expect(node.url).toBe(`${webpageOrigin}/article?v=1`);
    expect(node.content).toContain('Initial webpage content for canvas grounding.');
    expect(node.data.url).toBe(`${webpageOrigin}/article?v=1`);
    expect(node.data.pageTitle).toBe('Canvas Webpage v1');
    expect(node.data.status).toBe('ready');
    expect(String(node.data.content)).toContain('Initial webpage content for canvas grounding.');

    const search = await jsonRequest<{ results: Array<{ id: string }> }>(
      `/api/canvas/search?q=${encodeURIComponent('grounding')}`,
    );
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
    const invalidPatchBody = (await invalidPatch.json()) as { ok: boolean; error: string };
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

    const updated = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 200, y: 240 });
    expect(updated.size).toEqual(MARKDOWN_NODE_DEFAULT_SIZE);
  });

  test('persists node pinned state through single-node patch and batch updates', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Patch target', x: 80, y: 80 }),
    });

    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });

    const patched = await jsonRequest<{
      id: string;
      pinned: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(patched.pinned).toBe(true);

    const batchResult = await jsonRequest<{ ok: boolean; applied: number; skipped: number }>('/api/canvas/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        updates: [{ id: created.id, position: { x: 240, y: 320 }, collapsed: true }],
      }),
    });
    expect(batchResult.applied).toBe(1);

    const updated = await jsonRequest<{
      id: string;
      position: { x: number; y: number };
      collapsed: boolean;
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 240, y: 320 });
    expect(updated.collapsed).toBe(true);
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
    const malformedBody = (await malformedPatch.json()) as { error?: string };
    expect(malformedBody.error).toContain('children');
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
    expect(pinnedContext.nodes[0]?.metadata).toEqual(
      expect.objectContaining({
        viewerType: 'web-artifact',
        sourceFiles: ['src/App.tsx'],
        sourceFileCount: 1,
      }),
    );
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
    const kinds = Object.fromEntries(
      pinnedContext.nodes.map((node) => [node.id, { type: node.type, kind: node.kind }]),
    );

    expect(kinds[markdown.id]).toEqual({ type: 'markdown', kind: 'markdown' });
    expect(kinds[graph.id]).toEqual({ type: 'graph', kind: 'graph' });
    expect(kinds[artifactId]).toEqual({ type: 'mcp-app', kind: 'web-artifact' });
    expect(kinds[externalAppId]).toEqual({ type: 'mcp-app', kind: 'external-app' });
    expect(pinnedContext.preamble).toContain('[Context from "Pinned Artifact Kind" (mcp-app/web-artifact)]');
    expect(pinnedContext.preamble).toContain('[Context from "Pinned External App Kind" (mcp-app/external-app)]');
  });

  test('#50: POST /api/canvas/node requires a resolvable type', async () => {
    const empty = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '',
    });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as { error: string }).error).toContain("requires a 'type'");
    expect(canvasState.getLayout().nodes).toHaveLength(0);

    // ?type= query still resolves the type (no body needed).
    const viaQuery = await jsonRequest<{ ok: boolean; type: string }>('/api/canvas/node?type=markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(viaQuery.ok).toBe(true);
  });

  test('#53: HTTP accepts top-level html + axCapabilities on POST add AND PATCH update', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string; data: Record<string, unknown> }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'html',
        title: 'AX html',
        html: '<p>one</p>',
        axCapabilities: { enabled: true, allowed: ['ax.steer'] },
      }),
    });
    expect(created.data.html).toBe('<p>one</p>');
    expect((created.data.axCapabilities as { enabled?: boolean }).enabled).toBe(true);

    const patched = await jsonRequest<{ ok: boolean; data: Record<string, unknown> }>(
      `/api/canvas/node/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: '<p>two</p>', axCapabilities: { enabled: false } }),
      },
    );
    expect(patched.data.html).toBe('<p>two</p>');
    expect((patched.data.axCapabilities as { enabled?: boolean }).enabled).toBe(false);
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

    const state = await jsonRequest<
      CanvasStateResponse & {
        edges: Array<{ id: string; type: string; style?: string; animated?: boolean }>;
      }
    >('/api/canvas/state');
    expect(state.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: edge.id,
          type: 'references',
          style: 'dotted',
          animated: true,
        }),
      ]),
    );
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

    const groupNode = await jsonRequest<{ id: string; data: Record<string, unknown> }>(
      `/api/canvas/node/${createdGroup.id}`,
    );
    expect(groupNode.data.children).toEqual([firstNode.id, secondNode.id]);
    expect(
      (await jsonRequest<{ id: string; data: Record<string, unknown> }>(`/api/canvas/node/${firstNode.id}`)).data
        .parentGroup,
    ).toBe(createdGroup.id);

    // Ungroup dissolves: children released, the frame gone — one undo step.
    const ungrouped = await jsonRequest<{ ok: boolean; groupId: string; title?: string }>('/api/canvas/group/ungroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: createdGroup.id }),
    });
    expect(ungrouped).toMatchObject({ ok: true, groupId: createdGroup.id, title: 'API Group' });
    expect((await fetch(`${baseUrl}/api/canvas/node/${createdGroup.id}`)).status).toBe(404);
    for (const id of [firstNode.id, secondNode.id]) {
      expect(
        (await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${id}`)).data.parentGroup,
      ).toBeUndefined();
    }
    const history = await jsonRequest<{ entries: Array<{ description: string }>; top: { description: string } | null }>(
      '/api/canvas/history',
    );
    expect(history.top?.description).toBe('Dissolved group "API Group" — 2 nodes released');

    // Undo brings the frame back WITH its membership; redo dissolves again.
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    const restored = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${createdGroup.id}`);
    expect(restored.data.children).toEqual([firstNode.id, secondNode.id]);
    for (const id of [firstNode.id, secondNode.id]) {
      expect((await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${id}`)).data.parentGroup).toBe(
        createdGroup.id,
      );
    }
    await jsonRequest('/api/canvas/redo', { method: 'POST' });
    expect((await fetch(`${baseUrl}/api/canvas/node/${createdGroup.id}`)).status).toBe(404);

    // An empty frame dissolves too; a non-group is refused.
    const empty = await jsonRequest<{ id: string }>('/api/canvas/group', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Empty', x: 900, y: 900, width: 300, height: 200 }),
    });
    expect(
      (
        await jsonRequest<{ ok: boolean }>('/api/canvas/group/ungroup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: empty.id }),
        })
      ).ok,
    ).toBe(true);
    expect((await fetch(`${baseUrl}/api/canvas/node/${empty.id}`)).status).toBe(404);
    expect(
      (
        await fetch(`${baseUrl}/api/canvas/group/ungroup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId: firstNode.id }),
        })
      ).status,
    ).toBe(404);

    const missingGroup = await fetch(`${baseUrl}/api/canvas/group/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: '', childIds: [] }),
    });
    expect(missingGroup.status).toBe(400);
  });

  test('ungroup is the same operation for the human and the agent, nested groups included', async () => {
    // Build the same board twice: Outer ⊃ { Inner ⊃ {A, B}, C }, an edge to Inner, Inner pinned.
    const build = async () => {
      const node = async (title: string, x: number, y: number) =>
        (
          await jsonRequest<{ id: string }>('/api/canvas/node', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'markdown', title, content: title, x, y, width: 200, height: 120 }),
          })
        ).id;
      const a = await node('A', 100, 100);
      const b = await node('B', 400, 100);
      const c = await node('C', 100, 500);
      const group = async (title: string, childIds: string[]) =>
        (
          await jsonRequest<{ id: string }>('/api/canvas/group', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, childIds }),
          })
        ).id;
      const inner = await group('Inner', [a, b]);
      const outer = await group('Outer', [inner, c]);
      await jsonRequest('/api/canvas/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: c, to: inner, type: 'relation' }),
      });
      await jsonRequest('/api/canvas/context-pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeIds: [inner] }),
      });
      return { a, b, c, inner, outer };
    };
    const normalize = async (ids: Record<string, string>) => {
      const state = await jsonRequest<{
        nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
        edges: Array<{ from: string; to: string }>;
        contextPinnedNodeIds?: string[];
      }>('/api/canvas/state');
      const name = (id: string) => Object.entries(ids).find(([, value]) => value === id)?.[0] ?? id;
      return {
        nodes: state.nodes
          .map((node) => ({
            id: name(node.id),
            type: node.type,
            parent: node.data.parentGroup ? name(node.data.parentGroup as string) : null,
            children: Array.isArray(node.data.children) ? (node.data.children as string[]).map(name) : null,
          }))
          .sort((x, y) => x.id.localeCompare(y.id)),
        edges: state.edges.map((edge) => [name(edge.from), name(edge.to)]),
        pins: (await jsonRequest<{ nodes: Array<{ id: string }> }>('/api/canvas/pinned-context')).nodes.map((n) =>
          name(n.id),
        ),
      };
    };

    // The human dissolves Inner (workbench marker), …
    const human = await build();
    await jsonRequest('/api/canvas/group/ungroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' },
      body: JSON.stringify({ groupId: human.inner }),
    });
    const afterHuman = await normalize(human);
    canvasState.clear();
    // … the agent dissolves Inner over MCP/HTTP as claude-code.
    const agent = await build();
    await jsonRequest('/api/canvas/group/ungroup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-pmx-source': 'claude-code' },
      body: JSON.stringify({ groupId: agent.inner }),
    });
    const afterAgent = await normalize(agent);

    expect(afterAgent).toEqual(afterHuman);
    // A and B moved up into Outer (in Inner's slot), the edge to Inner and its pin are gone.
    expect(afterAgent).toEqual({
      nodes: [
        { id: 'a', type: 'markdown', parent: 'outer', children: null },
        { id: 'b', type: 'markdown', parent: 'outer', children: null },
        { id: 'c', type: 'markdown', parent: 'outer', children: null },
        { id: 'outer', type: 'group', parent: null, children: ['a', 'b', 'c'] },
      ],
      edges: [],
      pins: [],
    });

    // Undo restores the nesting, the edge and the pin — identically.
    await jsonRequest('/api/canvas/undo', { method: 'POST' });
    expect(await normalize(agent)).toEqual({
      nodes: [
        { id: 'a', type: 'markdown', parent: 'inner', children: null },
        { id: 'b', type: 'markdown', parent: 'inner', children: null },
        { id: 'c', type: 'markdown', parent: 'outer', children: null },
        { id: 'inner', type: 'group', parent: 'outer', children: ['a', 'b'] },
        { id: 'outer', type: 'group', parent: null, children: ['inner', 'c'] },
      ],
      edges: [['c', 'inner']],
      pins: ['inner'],
    });
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
});
