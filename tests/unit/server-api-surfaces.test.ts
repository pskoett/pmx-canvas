import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canvasState, type PersistedBlobRef } from '../../src/server/canvas-state.ts';
import { emitPrimaryWorkbenchEvent, startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createFakeWebArtifactScripts, readPersistedCanvasState } from './helpers.ts';
import {
  fixtureMcpAppServerPath,
  isBlobReference,
  isBlobSummary,
  resetServerApiState,
  startServerApiSuite,
  stopServerApiSuite,
  waitForNode,
  type CanvasStateResponse,
  type ServerApiSuite,
} from './server-api-harness.ts';

describe('canvas server HTTP API: surfaces', () => {
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
    suite = startServerApiSuite('pmx-canvas-api-surfaces-');
    ({ workspaceRoot, baseUrl, webpageOrigin } = suite);
  });

  afterAll(() => {
    if (suite) stopServerApiSuite(suite);
  });

  beforeEach(resetServerApiState);

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

  test('frame documents answer HEAD so clients can revalidate after reconnect (Finding S)', async () => {
    const created = await jsonRequest<{ ok: boolean; url: string }>('/api/canvas/frame-documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<!doctype html><main>Revalidate fixture</main>' }),
    });
    expect(created.ok).toBe(true);

    const alive = await fetch(`${baseUrl}${created.url}`, { method: 'HEAD' });
    expect(alive.status).toBe(200);

    // A restarted daemon has an empty in-memory frame store — stale URLs 404,
    // which is the client's signal to re-mint the document.
    const gone = await fetch(`${baseUrl}/api/canvas/frame-documents/definitely-gone`, { method: 'HEAD' });
    expect(gone.status).toBe(404);
  });

  test('html nodes reject non-string html payloads without creating blank nodes', async () => {
    const topLevelResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Invalid html numeric', html: 123 }),
    });
    const topLevelPayload = (await topLevelResponse.json()) as { ok: boolean; error: string };

    expect(topLevelResponse.status).toBe(400);
    expect(topLevelPayload.ok).toBe(false);
    expect(topLevelPayload.error).toContain('"html" must be a string');

    const dataResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'html', title: 'Invalid nested html', data: { html: 123 } }),
    });
    const dataPayload = (await dataResponse.json()) as { ok: boolean; error: string };

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
    expect(created.data.html).not.toContain('data-copy-json');
    expect(created.data.html).not.toContain('data-copy-prompt');
    expect(created.data.html).toContain('Use HTML');

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>(
      '/api/canvas/search?q=side-by-side',
    );
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
          items: [{ title: 'Query type', summary: 'Routes through html-primitive instead of markdown.' }],
        },
      }),
    });

    expect(created.ok).toBe(true);
    expect(created.type).toBe('html');
    expect(created.primitive.kind).toBe('choice-grid');
    expect(created.data.htmlPrimitive).toBe('choice-grid');
    expect(
      canvasState
        .getLayout()
        .nodes.some((node) => node.type === 'markdown' && node.data.title === 'Query Primitive Options'),
    ).toBe(false);
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
    expect(created.data.primitiveData).toEqual(
      expect.objectContaining({
        presentation: true,
        slideCount: 2,
        slideTitles: ['Why now', 'What ships'],
      }),
    );
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

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>(
      '/api/canvas/search?q=What%20ships',
    );
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
    const body = (await response.json()) as { error: string };
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

    const search = await jsonRequest<{ results: Array<{ id: string; snippet: string }> }>(
      '/api/canvas/search?q=revenue',
    );
    expect(
      search.results.some((result) => result.id === created.id && result.snippet.includes('Revenue climbed')),
    ).toBe(true);

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
    expect(pinnedContext.nodes[0]?.metadata).toEqual(
      expect.objectContaining({
        summary: 'Explicit semantic summary for the report.',
        embeddedNodeIds: ['graph-source-1'],
      }),
    );

    const updated = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: { html: '<main><h1>Updated HTML Report</h1><p>Churn dropped after the update.</p></main>' },
      }),
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
    expect(hostedNode?.id).toBe(opened.nodeId!);

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
    const deleteError = (await toolsAfterDelete.json()) as { error?: string };
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
    const clearError = (await toolsAfterClear.json()) as { error?: string };
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
    });
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
    const elements = toolInput?.elements ? (JSON.parse(toolInput.elements) as Array<Record<string, unknown>>) : [];
    expect(elements.some((element) => element.id === 'changed')).toBe(true);
    expect(elements.some((element) => element.id === 'before')).toBe(false);
  }, 30_000);

  test('an undo while an MCP app is still opening does not close its session', async () => {
    await jsonRequest('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Undo me', content: 'x' }),
    });
    // The app takes a moment to boot, so the undo lands while it is connecting.
    const slowStart = join(workspaceRoot, 'slow-start.ts');
    writeFileSync(slowStart, 'Bun.sleepSync(600);');
    const opening = jsonRequest<{ ok: boolean; nodeId: string | null; sessionId: string }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Slow Counter',
        toolName: 'show_counter',
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['--preload', slowStart, fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    await Bun.sleep(150);
    const undone = await jsonRequest<{ ok: boolean }>('/api/canvas/undo', { method: 'POST' });
    expect(undone.ok).toBe(true);
    const opened = await opening;
    expect(opened.ok).toBe(true);
    const tools = await fetch(`${baseUrl}/api/ext-app/list-tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: opened.sessionId }),
    });
    expect(tools.status).toBe(200);
  }, 30000);

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

    const saved = await jsonRequest<{ ok: boolean; id: string; snapshot: { id: string; name: string } }>(
      '/api/canvas/snapshots',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'counter-snapshot' }),
      },
    );
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

    const updatedNode = await waitForNode(baseUrl, (entry) => {
      const modelContext = entry.data.appModelContext as { structuredContent?: { count?: number } } | undefined;
      return entry.id === node?.id && modelContext?.structuredContent?.count === 3;
    });
    expect(updatedNode).toBeTruthy();
  }, 30000);

  test('surface route serves an html node as a themed standalone document', async () => {
    canvasState.addNode({
      id: 'surface-html',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 720, height: 640 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: 'Doc', html: '<main>Surface body</main>' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-html?theme=daylight`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const body = await res.text();
    expect(body).toContain('Surface body');
    // Theme tokens are INLINED (not linked) so srcdoc-rendered surfaces in
    // nested-iframe hosts stay styled without a subresource load.
    expect(body).toContain('data-pmx-surface-theme');
    expect(body).toContain('data-theme="daylight"');
    // The standalone tab title falls back to the node title (Bug #35) so the
    // browser tab shows "Doc" instead of the raw surface URL.
    expect(body).toContain('<title>Doc</title>');

    const meta = (await fetch(`${baseUrl}/api/canvas/node/surface-html?includeBlobs=true`).then((r) => r.json())) as {
      surfaceUrl?: string;
    };
    expect(meta.surfaceUrl).toBe('/api/canvas/surface/surface-html');
  });

  test('html surfaces render new named themes and keep tokens inline', async () => {
    canvasState.addNode({
      id: 'surface-ember',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: 'Ember doc', html: '<main>Ember surface body</main>' },
    });
    const body = await fetch(`${baseUrl}/api/canvas/surface/surface-ember?theme=ember`).then((r) => r.text());
    expect(body).toContain('data-theme="ember"');
    expect(body).toContain('data-pmx-surface-theme');
    // The inlined stylesheet must actually carry the ember token block.
    expect(body).toContain('data-theme="ember"');
    expect(body).toContain('#F34E1C');
  });

  test('iframe-probe endpoint serves the tiny embed-detection document', async () => {
    // The client boots a hidden iframe against this URL to learn whether the
    // embedding context loads src-URL iframes at all (Amp orb portals block
    // them); it must always be a small 200 html document, never cached.
    const res = await fetch(`${baseUrl}/api/canvas/iframe-probe`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-security-policy')).toBe('sandbox allow-scripts');
    const body = await res.text();
    expect(body).toContain('pmx-canvas iframe probe');
    // The handshake script is the actual probe signal — blocked hosts fire
    // `load` on an error page, so the client only trusts this postMessage.
    expect(body).toContain(`parent.postMessage({ source: "pmx-canvas-iframe-probe" }, "*")`);
  });

  test('surface route falls back to the node id for the tab title when no node title is set', async () => {
    canvasState.addNode({
      id: 'surface-untitled',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 720, height: 640 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: '   ', html: '<main>Body</main>' }, // whitespace-only → falls back to id
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-untitled`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>surface-untitled</title>');
  });

  test('surface and json-render view answer HEAD like GET (0.3.2 report Finding O)', async () => {
    // Tooling probes the advertised surfaceUrl with HEAD; a 404 against a
    // working GET reads as a broken surface.
    canvasState.addNode({
      id: 'surface-head-graph',
      type: 'graph',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {
        title: 'HEAD probe graph',
        viewerType: 'graph',
        graphConfig: { graphType: 'bar', height: 320 },
        spec: { root: 'chart', elements: { chart: { type: 'BarChart', props: { height: 320, data: [] } } } },
      },
    });
    // Graph surfaces redirect to the json-render view; HEAD must mirror GET at
    // every hop, so following redirects ends 200 exactly like GET does.
    const surfaceHead = await fetch(`${baseUrl}/api/canvas/surface/surface-head-graph`, { method: 'HEAD' });
    expect(surfaceHead.status).toBe(200);
    expect(await surfaceHead.text()).toBe('');
    const viewGet = await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=surface-head-graph`);
    expect(viewGet.status).toBe(200);
    const viewHead = await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=surface-head-graph`, {
      method: 'HEAD',
    });
    expect(viewHead.status).toBe(200);
    expect(viewHead.headers.get('Content-Type')).toBe(viewGet.headers.get('Content-Type'));
    expect(await viewHead.text()).toBe('');
    // RFC 9110 §8.6: HEAD's Content-Length must match what GET would send
    // (Bun.serve strips the body natively and keeps the true length).
    expect(viewHead.headers.get('Content-Length')).toBe(viewGet.headers.get('Content-Length'));
    // HEAD mirrors GET's failure statuses too.
    const missingHead = await fetch(`${baseUrl}/api/canvas/surface/does-not-exist`, { method: 'HEAD' });
    expect(missingHead.status).toBe(404);
  });

  test('surface route 404s for unknown node and non-openable types', async () => {
    const missing = await fetch(`${baseUrl}/api/canvas/surface/does-not-exist`);
    expect(missing.status).toBe(404);
    canvasState.addNode({
      id: 'surface-md',
      type: 'markdown',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { content: '# hi' },
    });
    const md = await fetch(`${baseUrl}/api/canvas/surface/surface-md`);
    expect(md.status).toBe(404);
  });

  test('surface route redirects a webpage node to its external url', async () => {
    canvasState.addNode({
      id: 'surface-web',
      type: 'webpage',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { url: `${webpageOrigin}/article` },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-web`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${webpageOrigin}/article`);
  });

  test('surface route redirects a web-artifact node to the artifact route', async () => {
    canvasState.addNode({
      id: 'surface-artifact',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { viewerType: 'web-artifact', path: '/tmp/does-not-matter.html', url: '/artifact?path=x' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-artifact`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/artifact?path=${encodeURIComponent('/tmp/does-not-matter.html')}`);
  });

  test('surface route redirects a json-render node to the standalone viewer', async () => {
    canvasState.addNode({
      id: 'surface-jsonrender',
      type: 'json-render',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { viewerType: 'json-render', spec: { root: 'x', elements: {} } },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-jsonrender?theme=harbor`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location).toContain('/api/canvas/json-render/view');
    expect(location).toContain('nodeId=surface-jsonrender');
    expect(location).toContain('theme=harbor');
    // #65: "Open as site" is a standalone tab → display=site (fills the viewport).
    expect(location).toContain('display=site');
  });

  test('#65: the standalone viewer renders in full-viewport (site) mode', async () => {
    canvasState.addNode({
      id: 'surface-graph-65',
      type: 'graph',
      position: { x: 0, y: 0 },
      size: { width: 760, height: 520 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {
        viewerType: 'graph',
        graphConfig: { graphType: 'bar', height: 320 },
        spec: { root: 'chart', elements: { chart: { type: 'BarChart', props: { height: 320, data: [] } } } },
      },
    });
    // The viewer page opened in site mode injects the display flag the renderer reads
    // to fill the browser viewport instead of the in-canvas card height.
    const view = await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=surface-graph-65&display=site`);
    expect(view.status).toBe(200);
    const html = await view.text();
    expect(html).toContain('__PMX_CANVAS_JSON_RENDER_DISPLAY__ = "site"');
  });

  test('surface route 404s a hosted ext-app node — it is not openable as a standalone site (#61)', async () => {
    canvasState.addNode({
      id: 'surface-extapp',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 720 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { mode: 'ext-app', html: '<!doctype html><html><head></head><body>ext app surface</body></html>' },
    });
    // A hosted ext-app is a live MCP-app shell needing the in-canvas AppBridge host; a
    // standalone tab has no host, so it errored with `-32601`. It now refuses cleanly
    // instead of serving the broken live-app HTML (#61).
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-extapp`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('surface route blocks unsafe redirect targets', async () => {
    canvasState.addNode({
      id: 'surface-bad-url',
      type: 'webpage',
      position: { x: 0, y: 0 },
      size: { width: 600, height: 400 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { url: 'javascript:alert(1)' },
    });
    const res = await fetch(`${baseUrl}/api/canvas/surface/surface-bad-url`, { redirect: 'manual' });
    expect(res.status).toBe(404);
  });

  test('surface route injects the AX bridge only for opted-in html nodes', async () => {
    canvasState.addNode({
      id: 'surf-ax-off',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { html: '<main>x</main>' },
    });
    expect((await (await fetch(`${baseUrl}/api/canvas/surface/surf-ax-off`)).text()).includes('window.PMX_AX')).toBe(
      false,
    );

    canvasState.addNode({
      id: 'surf-ax-on',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { html: '<main>x</main>', axCapabilities: { enabled: true, allowed: ['ax.work.create'] } },
    });
    const on = await (await fetch(`${baseUrl}/api/canvas/surface/surf-ax-on?axToken=ax-test`)).text();
    expect(on).toContain('window.PMX_AX');
    expect(on).toContain('ax-test');
  });

  test('surface route falls back to content, 404s when html node is empty', async () => {
    canvasState.addNode({
      id: 'surf-content',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { content: '<main>from content</main>' },
    });
    const c = await fetch(`${baseUrl}/api/canvas/surface/surf-content`);
    expect(c.status).toBe(200);
    expect(await c.text()).toContain('from content');

    canvasState.addNode({
      id: 'surf-empty',
      type: 'html',
      position: { x: 0, y: 0 },
      size: { width: 400, height: 300 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: {},
    });
    expect((await fetch(`${baseUrl}/api/canvas/surface/surf-empty`)).status).toBe(404);
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
    const withToken = await (
      await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=${created.id}&axToken=ax-probe`)
    ).text();
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
    const read = (await readResponse.json()) as { result: { content: Array<{ text?: string }> } };
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
          elements: JSON.stringify([{ type: 'rectangle', id: 'original', x: 0, y: 0, width: 10, height: 10 }]),
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
    const initialRead = (await initialReadResponse.json()) as { result: { content: Array<{ text?: string }> } };
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
    const read = (await readResponse.json()) as { result: { content: Array<{ text?: string }> } };
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
          elements: JSON.stringify([{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10 }]),
        },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(opened.id).toBe(opened.nodeId!);
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
          elements: JSON.stringify([{ type: 'rectangle', id: 'box', x: 0, y: 0, width: 10, height: 10 }]),
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
    expect(persisted.nodes.some((node) => node.type === 'mcp-app' && node.data.title === 'Restart Counter')).toBe(true);

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
      stateAfterRestart.nodes.some((node) => node.type === 'markdown' && node.data.title === 'Restart marker'),
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
    expect((fullNode?.data.toolResult as typeof largeToolResult | undefined)?.content[0]?.text).toBe(
      'x'.repeat(20_000),
    );
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
          elements: JSON.stringify([{ type: 'rectangle', id: 'original', x: 0, y: 0, width: 10, height: 10 }]),
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
        entry.id === nodeId && typeof entry.data.appSessionId === 'string' && entry.data.sessionStatus === 'ready',
    );
    expect(restoredNode).toBeTruthy();
    const restoredSessionId = restoredNode?.data.appSessionId as string;
    expect(restoredSessionId).toBeTruthy();
    expect(restoredSessionId).not.toBe(opened.sessionId);

    const restoredToolResult = restoredNode?.data.toolResult as
      | { structuredContent?: { checkpointId?: string } }
      | undefined;
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
    const read = (await readResponse.json()) as { result: { content: Array<{ text?: string }> } };
    expect(read.result.content[0]?.text).toContain('saved-after-restart');
  }, 30000);

  test('two concurrent opens of the same app tool keep their own nodes and results', () => {
    const open = (call: string) =>
      emitPrimaryWorkbenchEvent('ext-app-open', {
        toolCallId: call,
        nodeId: `ext-app-${call}`,
        title: `Chart ${call}`,
        html: '<main>app</main>',
        serverName: 'Concurrent',
        toolName: 'show_chart',
        appSessionId: `session-${call}`,
      });
    const result = (call: string) =>
      emitPrimaryWorkbenchEvent('ext-app-result', {
        toolCallId: call,
        nodeId: `ext-app-${call}`,
        serverName: 'Concurrent',
        toolName: 'show_chart',
        success: true,
        result: { content: [{ type: 'text', text: `result ${call}` }] },
      });
    open('first');
    open('second');
    result('first');
    result('second');
    for (const call of ['first', 'second']) {
      const node = canvasState.getNode(`ext-app-${call}`);
      expect(node?.data).toMatchObject({ toolCallId: call, title: `Chart ${call}` });
      expect(JSON.stringify(node?.data.toolResult)).toContain(`result ${call}`);
    }
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
      body: JSON.stringify({ nodeId: node.id, url: `${surfaceUrl}?theme=daylight` }),
    });
    expect(ok.ok).toBe(true);
    expect(ok.url).toBe(`${surfaceUrl}?theme=daylight`);
    expect(typeof ok.opened).toBe('boolean'); // false under PMX_CANVAS_DISABLE_BROWSER_OPEN

    const defaultTheme = await jsonRequest<{ ok: boolean; url: string }>('/api/canvas/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: node.id }),
    });
    expect(defaultTheme.url).toBe(`${surfaceUrl}?theme=harbor`);

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
      body: JSON.stringify({ nodeId: node.id, url: '/api/canvas/surface/other?theme=daylight' }),
    });
    expect(wrongNodeUrl.status).toBe(400);
  });

  test('POST /api/canvas/open-external refuses nodes the surface route cannot serve (#61)', async () => {
    canvasState.addNode({
      id: 'open-external-extapp',
      type: 'mcp-app',
      position: { x: 0, y: 0 },
      size: { width: 960, height: 600 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { mode: 'ext-app', html: '<!doctype html><html><head></head><body>ext app surface</body></html>' },
    });
    // The surface route already refuses a hosted ext-app; open-external must agree
    // instead of launching a browser at a URL that is guaranteed to 404.
    const surface = await fetch(`${baseUrl}/api/canvas/surface/open-external-extapp`, { redirect: 'manual' });
    expect(surface.status).toBe(404);
    const surfaceBody = (await surface.json()) as { error?: string };

    const refused = await fetch(`${baseUrl}/api/canvas/open-external`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: 'open-external-extapp' }),
    });
    expect(refused.status).toBe(400);
    const refusedBody = (await refused.json()) as { ok: boolean; opened?: boolean; error?: string };
    expect(refusedBody.ok).toBe(false);
    expect(refusedBody.opened).toBe(false);
    // One wording for both surfaces, so the refusal reads the same either way.
    expect(refusedBody.error).toBe(surfaceBody.error);
    canvasState.removeNode('open-external-extapp');

    // A node type that does have a standalone surface still opens.
    const graph = await jsonRequest<{ id: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Open external graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    });
    const allowed = await jsonRequest<{ ok: boolean; opened: boolean; url: string }>('/api/canvas/open-external', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nodeId: graph.id }),
    });
    expect(allowed.ok).toBe(true);
    expect(allowed.url).toBe(`/api/canvas/surface/${graph.id}?theme=harbor`);
    // PMX_CANVAS_DISABLE_BROWSER_OPEN=1 keeps the real system browser out of tests.
    expect(allowed.opened).toBe(false);
    await jsonRequest<{ ok: boolean }>(`/api/canvas/node/${graph.id}`, { method: 'DELETE' });
  });

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
      sizeAdjustment?: unknown;
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
    // Separator-agnostic: build paths are OS-native (backslashes on Windows).
    expect(build.path.replaceAll('\\', '/')).toContain('/.pmx-canvas/artifacts/http-artifact.html');
    expect(build.projectPath.replaceAll('\\', '/')).toContain('/.pmx-canvas/artifacts/.web-artifacts/http-artifact');
    expect(build.metadata?.sourcePreview).toContain('HTTP Artifact');
    expect(JSON.stringify(build.metadata)).not.toContain('<!DOCTYPE html>');
    expect(build.sizeAdjustment).toEqual({
      requested: { width: null, height: null },
      applied: { width: 960, height: 720 },
      reason: 'defaulted',
    });

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

    const darkJsonViewer = await fetch(`${baseUrl}${jsonRender.url}&theme=harbor`);
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
    expect(updatedJson.node.data.title).toBe('Original JSON UI');
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
      node: {
        id: string;
        data: {
          graphConfig: Record<string, unknown>;
          spec: { elements: Record<string, { type?: string; props?: Record<string, unknown> }> };
        };
      };
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
    const invalidStructuredBody = (await invalidStructuredUpdate.json()) as { ok: boolean; error: string };
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
    const invalidSpecBody = (await invalidSpecUpdate.json()) as { ok: boolean; error: string };
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
    expect(((await invalidSpec.json()) as { ok: boolean; error: string }).error).toContain('Missing root and elements');

    const missingNodeId = await fetch(`${baseUrl}/api/canvas/json-render/view`);
    expect(missingNodeId.status).toBe(400);
    expect(await missingNodeId.text()).toContain('Missing nodeId');

    const missingNode = await fetch(`${baseUrl}/api/canvas/json-render/view?nodeId=missing-node`);
    expect(missingNode.status).toBe(404);
    expect(await missingNode.text()).toContain('json-render node not found');
  });
});
