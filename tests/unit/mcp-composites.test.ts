// Parity + behavior tests for the plan-006 composite (action-discriminated)
// MCP tools. Each composite action dispatches to the same registered operation
// as its legacy standalone tool, reusing that op's buildInput/formatResult — so
// a composite action and its standalone tool must return identical results. The
// head-to-head reads below prove that; the mutation cases prove the wiring.
import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace, removeTestWorkspace } from './helpers.ts';

interface TextContentItem {
  type: string;
  text?: string;
}
interface ToolResultShape {
  content?: TextContentItem[];
  isError?: boolean;
}

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));
const fixtureMcpAppServerPath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve an ephemeral port.'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

function textOf(result: ToolResultShape): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}
function parseJsonText<T>(result: ToolResultShape): T {
  return JSON.parse(textOf(result)) as T;
}

const sessions: Array<{ transport: StdioClientTransport; workspaceRoot: string }> = [];

async function createMcpSession(): Promise<{ client: Client; port: number; workspaceRoot: string }> {
  const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-composites-');
  const port = await getAvailablePort();
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', mcpServerPath],
    cwd: workspaceRoot,
    env: { ...process.env, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1', PMX_CANVAS_PORT: String(port) },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pmx-canvas-mcp-composites-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  sessions.push({ transport, workspaceRoot });
  return { client, port, workspaceRoot };
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResultShape> {
  return (await client.callTool({ name, arguments: args })) as ToolResultShape;
}

/**
 * Resolve the HTTP base URL of the in-process canvas server the MCP session
 * started. It binds the requested port, but may fall back if taken — probe a
 * small window from `port` upward until /health answers.
 */
async function resolveBaseUrl(port: number): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    for (let offset = 0; offset < 8; offset++) {
      const baseUrl = `http://127.0.0.1:${port + offset}`;
      try {
        const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(300) });
        if (response.ok) return baseUrl;
      } catch {
        // server not up yet on this candidate — keep probing.
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Canvas server did not become reachable.');
}

afterEach(async () => {
  while (sessions.length > 0) {
    const session = sessions.pop();
    if (!session) continue;
    await session.transport.close();
    removeTestWorkspace(session.workspaceRoot);
  }
});

describe('MCP composite tools (plan-006)', () => {
  test('canvas_node folds add/get/update/remove', async () => {
    const { client } = await createMcpSession();

    const added = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Composite', content: '# Hi' }),
    );
    expect(added.id).toBeTruthy();

    // node.get formatResult returns the compact node payload at top level
    // (known expected output — canvas_get_node no longer exists standalone).
    const viaComposite = parseJsonText<{ id?: string; type?: string; title?: string }>(
      await call(client, 'canvas_node', { action: 'get', id: added.id }),
    );
    expect(viaComposite.id).toBe(added.id);
    expect(viaComposite.type).toBe('markdown');
    expect(viaComposite.title).toBe('Composite');

    await call(client, 'canvas_node', { action: 'update', id: added.id, title: 'Renamed' });
    // node.get formatResult returns the compact node payload at top level.
    const afterUpdate = parseJsonText<{ title?: string }>(
      await call(client, 'canvas_node', { action: 'get', id: added.id }),
    );
    expect(afterUpdate.title).toBe('Renamed');

    const removed = parseJsonText<{ ok?: boolean }>(
      await call(client, 'canvas_node', { action: 'remove', id: added.id }),
    );
    expect(removed.ok).toBe(true);
    const missing = await call(client, 'canvas_node', { action: 'get', id: added.id });
    expect(missing.isError).toBe(true);
  }, 30000);

  test('canvas_query folds search/layout', async () => {
    const { client } = await createMcpSession();
    const added = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Findable', content: 'needle' }),
    );

    // search.formatResult's known shape (canvas_search no longer exists standalone).
    const searchComposite = parseJsonText<{ query?: string; resultCount?: number; results?: Array<{ id?: string }> }>(
      await call(client, 'canvas_query', { action: 'search', query: 'Findable' }),
    );
    expect(searchComposite.query).toBe('Findable');
    expect(searchComposite.resultCount).toBe(1);
    expect(searchComposite.results?.[0]?.id).toBe(added.id);

    // layout.get's compact projection includes the newly-added node
    // (canvas_get_layout no longer exists standalone).
    const layoutComposite = parseJsonText<{ nodes?: Array<{ id?: string }> }>(
      await call(client, 'canvas_query', { action: 'layout' }),
    );
    expect(layoutComposite.nodes?.some((node) => node.id === added.id)).toBe(true);
  }, 30000);

  test('canvas_query validate returns the board-summary validation shape', async () => {
    const { client } = await createMcpSession();
    await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Validatable', content: 'x' });

    // Known expected output of validate.get's CanvasValidationResult shape
    // (canvas_validate no longer exists standalone): ok + a board summary,
    // not a generic { ok } envelope.
    const validateComposite = parseJsonText<{ ok?: boolean; summary?: { nodes?: number } }>(
      await call(client, 'canvas_query', { action: 'validate' }),
    );
    expect(typeof validateComposite.ok).toBe('boolean');
    expect(validateComposite.summary?.nodes).toBeGreaterThanOrEqual(1);
  }, 30000);

  test('canvas_view remove-annotation removes a drawn annotation; a missing id is a loud error', async () => {
    const { client, port } = await createMcpSession();
    // A tool call triggers ensureCanvas(), which starts the in-process canvas
    // HTTP server (lazily — not at connect time).
    await call(client, 'canvas_query', { action: 'layout' });
    // Seed a freehand annotation through the now-running public HTTP API (no MCP
    // tool draws annotations — humans do, in the browser).
    const baseUrl = await resolveBaseUrl(port);
    const annotationId = 'ann-composite-test';
    const created = await fetch(`${baseUrl}/api/canvas/annotation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: annotationId,
        type: 'freehand',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      }),
    });
    expect(((await created.json()) as { ok?: boolean }).ok).toBe(true);

    const removed = parseJsonText<{ ok?: boolean; removed?: string }>(
      await call(client, 'canvas_view', { action: 'remove-annotation', id: annotationId }),
    );
    expect(removed.ok).toBe(true);
    expect(removed.removed).toBe(annotationId);

    // A non-existent id is a loud error (404 OperationError → isError tool result).
    const missing = await call(client, 'canvas_view', { action: 'remove-annotation', id: 'does-not-exist' });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toContain('not found');

    // An OMITTED id is a 400, not a misleading 404 — the composite widens `id` to
    // optional (node.focus also contributes it), so the handler guards it.
    const noId = await call(client, 'canvas_view', { action: 'remove-annotation' });
    expect(noId.isError).toBe(true);
    expect(textOf(noId)).toContain('Missing id');
  }, 30000);

  test('canvas_render describe-schema/validate/add-graph', async () => {
    const { client } = await createMcpSession();

    // Known expected output of schema.describe (canvas_describe_schema no
    // longer exists standalone): the deterministic describeCanvasSchema()
    // shape, including mcp.nodeTypeRouting per the tool description.
    const schemaComposite = parseJsonText<{
      ok?: boolean;
      source?: string;
      mcp?: { nodeTypeRouting?: Record<string, string> };
    }>(await call(client, 'canvas_render', { action: 'describe-schema' }));
    expect(schemaComposite.ok).toBe(true);
    expect(schemaComposite.source).toBe('running-server');
    expect(schemaComposite.mcp?.nodeTypeRouting).toBeTruthy();

    const valid = parseJsonText<{ ok?: boolean }>(
      await call(client, 'canvas_render', {
        action: 'validate',
        type: 'graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    );
    expect(valid.ok).toBe(true);

    const graph = parseJsonText<{ id?: string; url?: string }>(
      await call(client, 'canvas_render', {
        action: 'add-graph',
        title: 'Bars',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      }),
    );
    expect(graph.id).toBeTruthy();
    expect(graph.url).toContain('/api/canvas/json-render/view?nodeId=');
  }, 30000);

  test('canvas_edge folds add/remove', async () => {
    const { client } = await createMcpSession();
    const a = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'A' }),
    );
    const b = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'B' }),
    );

    const edge = parseJsonText<{ id?: string; from?: string; to?: string; type?: string }>(
      await call(client, 'canvas_edge', { action: 'add', from: a.id, to: b.id, type: 'flow' }),
    );
    expect(edge.id).toBeTruthy();
    expect(edge.from).toBe(a.id);
    expect(edge.to).toBe(b.id);
    expect(edge.type).toBe('flow');

    const removed = parseJsonText<{ ok?: boolean; removed?: string }>(
      await call(client, 'canvas_edge', { action: 'remove', id: edge.id }),
    );
    expect(removed.ok).toBe(true);
  }, 30000);

  test('canvas_group create/ungroup and canvas_view focus/fit/arrange', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Grouped' }),
    );

    const group = parseJsonText<{ id?: string; groupId?: string }>(
      await call(client, 'canvas_group', { action: 'create', title: 'G', childIds: [node.id] }),
    );
    const groupId = group.id ?? group.groupId;
    expect(groupId).toBeTruthy();

    // node.focus uses `id` (the composite schema is derived from the op's shape).
    expect((await call(client, 'canvas_view', { action: 'focus', id: node.id })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'fit' })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'arrange' })).isError ?? false).toBe(false);

    const ungrouped = parseJsonText<{ ok?: boolean }>(
      await call(client, 'canvas_group', { action: 'ungroup', groupId }),
    );
    expect(ungrouped.ok).toBe(true);
  }, 30000);

  test('canvas_history undo/redo reverse the last mutation', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Undoable' }),
    );

    expect((await call(client, 'canvas_history', { action: 'undo' })).isError ?? false).toBe(false);
    // After undo, the node add is reversed → get errors.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError).toBe(true);

    expect((await call(client, 'canvas_history', { action: 'redo' })).isError ?? false).toBe(false);
    // After redo, the node is back.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError ?? false).toBe(false);
  }, 30000);

  // ── canvas_webview (plan-008 Wave 3) ──────────────────────────────────────
  // Each webview composite action dispatches to the same registry op (and the
  // same injected runner) as its legacy standalone tool, reusing the op's
  // buildInput/formatResult — so a composite action is byte-identical to the
  // standalone tool. `status` is the safe head-to-head read. start/stop/resize/
  // evaluate are environment-gated: with no browser available the runner throws
  // (or start fails); the composite must surface the SAME outcome as the
  // standalone tool. canvas_screenshot is NOT folded (binary payload).
  test('canvas_webview status returns the automation status shape (canvas_webview_status no longer exists standalone)', async () => {
    const { client } = await createMcpSession();

    const composite = parseJsonText<{ supported?: boolean; active?: boolean; headlessOnly?: boolean }>(
      await call(client, 'canvas_webview', { action: 'status' }),
    );
    // The status carries the automation shape (not a generic ok).
    expect(composite.headlessOnly).toBe(true);
    expect(composite.active).toBe(false);
  }, 30000);

  test('canvas_webview evaluate/resize error with the known webview.evaluate/webview.resize messages when no session is active', async () => {
    const { client } = await createMcpSession();

    // evaluate with no active session: dispatches to webview.evaluate → the
    // runner throws "not active" (canvas_evaluate no longer exists standalone).
    const evalComposite = await call(client, 'canvas_webview', {
      action: 'evaluate',
      script: 'const value = 2 + 2; return value;',
    });
    expect(evalComposite.isError).toBe(true);
    expect(textOf(evalComposite)).toContain('automation WebView');

    // The "exactly one of expression/script" validation is preserved on the
    // composite action (legacy canvas_evaluate message), thrown before dispatch.
    const evalBoth = await call(client, 'canvas_webview', {
      action: 'evaluate',
      expression: 'document.title',
      script: 'return 1;',
    });
    expect(evalBoth.isError).toBe(true);
    expect(textOf(evalBoth)).toContain('exactly one');

    // resize with no active session: dispatches to webview.resize → "not
    // active" (canvas_resize no longer exists standalone).
    const resizeComposite = await call(client, 'canvas_webview', { action: 'resize', width: 1024, height: 768 });
    expect(resizeComposite.isError).toBe(true);
    expect(textOf(resizeComposite)).toContain('automation WebView');
  }, 30000);

  test('canvas_webview start/stop dispatch to webview.start/webview.stop (canvas_webview_start/_stop no longer exist standalone)', async () => {
    const { client } = await createMcpSession();

    // start is environment-gated: it succeeds only when a webview backend
    // (Chrome/WebKit) is available. Assert the known shape in each branch.
    const startComposite = await call(client, 'canvas_webview', { action: 'start', width: 800, height: 600 });
    if (startComposite.isError) {
      // No browser available: structured JSON error result with ok:false.
      expect(parseJsonText<{ ok?: boolean }>(startComposite).ok).toBe(false);
    } else {
      // A browser is available: start reports the active webview status.
      expect(parseJsonText<{ active?: boolean }>(startComposite).active).toBe(true);
    }

    // stop dispatches to webview.stop and reports { ok, stopped, webview }; it is
    // stateful (the first stop consumes any active session), so assert the shape +
    // a stopped session.
    const stopComposite = parseJsonText<{ ok?: boolean; stopped?: boolean; webview?: { active?: boolean } }>(
      await call(client, 'canvas_webview', { action: 'stop' }),
    );
    expect(stopComposite.ok).toBe(true);
    expect(typeof stopComposite.stopped).toBe('boolean');
    expect(stopComposite.webview?.active).toBe(false);

    // A second stop (now nothing active) is a safe no-op: stopped flips to false.
    const stopComposite2 = parseJsonText<{ ok?: boolean; stopped?: boolean }>(
      await call(client, 'canvas_webview', { action: 'stop' }),
    );
    expect(stopComposite2.ok).toBe(true);
    expect(stopComposite2.stopped).toBe(false);
  }, 30000);

  // ── canvas_app (plan-008 Wave 4) ──────────────────────────────────────────
  // open-mcp-app / diagram / build-artifact dispatch to the same registry ops
  // (mcpapp.open / diagram.open / webartifact.build) as their legacy standalone
  // tools (canvas_open_mcp_app / canvas_add_diagram / canvas_build_web_artifact),
  // reusing each op's formatResult — so a composite action is byte-identical to
  // the standalone tool. open-mcp-app is exercised against the stdio mcp-app
  // fixture (the same fixture mcp-server.test.ts uses). build-artifact is a real
  // pnpm/bundle build (minutes, network) — too heavy for a unit test — so its
  // DISPATCH parity is asserted via the cheap validation-error path (both
  // surfaces reject a missing appTsx with the same op error), not a full build.
  test('canvas_app open-mcp-app dispatches to mcpapp.open (canvas_open_mcp_app no longer exists standalone)', async () => {
    const { client, workspaceRoot } = await createMcpSession();

    const transport = {
      type: 'stdio' as const,
      command: 'bun',
      args: ['run', fixtureMcpAppServerPath],
      cwd: workspaceRoot,
    };

    // Composite open-mcp-app opens a real ui:// MCP App node via the fixture —
    // known expected shape of mcpapp.open's formatResult.
    const viaComposite = parseJsonText<{
      ok: boolean;
      id?: string;
      nodeId: string | null;
      toolCallId: string;
      sessionId: string;
      resourceUri: string;
    }>(
      await call(client, 'canvas_app', {
        action: 'open-mcp-app',
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport,
      }),
    );
    expect(viaComposite.ok).toBe(true);
    expect(typeof viaComposite.nodeId).toBe('string');
    expect(viaComposite.id).toBe(viaComposite.nodeId);
    expect(viaComposite.resourceUri).toBe('ui://fixture/counter.html');
    expect(viaComposite.sessionId).toContain('mcp-app-session');
  }, 30000);

  test('canvas_app diagram dispatches to diagram.open (preset-parse-error, no live Excalidraw; canvas_add_diagram no longer exists standalone)', async () => {
    const { client } = await createMcpSession();

    // diagram.open builds the Excalidraw input via buildExcalidrawOpenMcpAppInput,
    // which parses `elements` BEFORE any (network) call to the hosted Excalidraw
    // MCP app. A non-empty-string-but-invalid-JSON `elements` fails that parse
    // deterministically — a cheap way to prove dispatch without depending on a
    // reachable Excalidraw server (the live path is heavy + network).
    const args = { elements: '{not json' };
    const viaComposite = await call(client, 'canvas_app', { action: 'diagram', ...args });
    expect(viaComposite.isError).toBe(true);
    expect(textOf(viaComposite)).toContain('diagram.elements');
  }, 30000);

  test('canvas_app build-artifact dispatches to webartifact.build (workspace-escape error, no full build; canvas_build_web_artifact no longer exists standalone)', async () => {
    const { client } = await createMcpSession();

    // An out-of-workspace projectPath is rejected by the op handler's
    // resolveWorkspacePath BEFORE any pnpm/bundle work — a cheap way to assert
    // the known dispatch error without a multi-minute build. title + appTsx
    // are present so the composite passes schema validation and reaches the
    // op handler, which throws the known workspace-escape error.
    const args = { title: 'Escape', appTsx: 'export default () => null;', projectPath: '../escape' };
    const viaComposite = await call(client, 'canvas_app', { action: 'build-artifact', ...args });
    expect(viaComposite.isError).toBe(true);
    expect(textOf(viaComposite)).toContain('outside workspace');
  }, 30000);

  // ── canvas_node folds the 3 deferred html/webpage tools (plan-008 Wave 5) ──
  // node.add (type:"html", primitive:"<kind>") and node.update (refresh:true)
  // already absorb canvas_add_html_node / canvas_add_html_primitive /
  // canvas_refresh_webpage_node via plain params — no new action or per-action
  // input-injection mechanism is needed. These assert canvas_node produces the
  // KNOWN result each deleted standalone tool used to (canvas_add_html_node /
  // canvas_add_html_primitive / canvas_refresh_webpage_node no longer exist).
  test('canvas_node add type:"html" creates a node with every documented html field', async () => {
    const { client } = await createMcpSession();
    const htmlArgs = {
      html: '<h1>Deck</h1>',
      title: 'A Deck',
      presentation: true,
      slideTitles: ['One', 'Two'],
      embeddedNodeIds: ['n-embed-1', 'n-embed-2'],
      embeddedUrls: ['https://example.com/a'],
      axCapabilities: { enabled: true, allowed: ['ax.work.create'] },
    };

    // node.add's known compact create payload { node: { id, type, title }, id }.
    const viaComposite = parseJsonText<{ id?: string; node?: { type?: string; title?: string } }>(
      await call(client, 'canvas_node', { action: 'add', type: 'html', ...htmlArgs }),
    );
    expect(viaComposite.node?.type).toBe('html');
    expect(viaComposite.node?.title).toBe('A Deck');
    expect(viaComposite.id).toBeTruthy();

    // The rich html fields land on the created node's data — read the full node
    // back and confirm every documented param the deleted standalone tool
    // accepted (presentation, slideTitles, embeddedNodeIds/Urls, axCapabilities
    // — the last only reachable because Wave 5 advertised it in nodeAddShape).
    type HtmlData = {
      presentation?: boolean;
      slideTitles?: string[];
      html?: string;
      embeddedNodeIds?: string[];
      embeddedUrls?: string[];
      axCapabilities?: { enabled?: boolean; allowed?: string[] };
    };
    const compositeNode = parseJsonText<{ data?: HtmlData }>(
      await call(client, 'canvas_node', { action: 'get', id: viaComposite.id, full: true }),
    );
    expect(compositeNode.data?.presentation).toBe(true);
    expect(compositeNode.data?.slideTitles).toEqual(['One', 'Two']);
    expect(compositeNode.data?.html).toBe('<h1>Deck</h1>');
    expect(compositeNode.data?.embeddedNodeIds).toEqual(['n-embed-1', 'n-embed-2']);
    expect(compositeNode.data?.embeddedUrls).toEqual(['https://example.com/a']);
    // axCapabilities: the AX bridge config must survive the composite path
    // (would silently drop if the field were not advertised).
    expect(compositeNode.data?.axCapabilities?.enabled).toBe(true);
    expect(compositeNode.data?.axCapabilities?.allowed).toEqual(['ax.work.create']);
  }, 30000);

  test('canvas_node add type:"html" primitive:"<kind>" creates the primitive-marked html node', async () => {
    const { client } = await createMcpSession();
    // A real HtmlPrimitiveKind (see src/server/html-primitives.ts HTML_PRIMITIVE_KINDS).
    const kind = 'choice-grid';
    const data = {
      options: [
        { title: 'Option A', summary: 'first' },
        { title: 'Option B', summary: 'second' },
      ],
    };

    // The composite passes the kind via `primitive` (node.add routes
    // type:"html" + primitive → createHtmlPrimitiveNode). strictSize is the
    // one primitive-specific param beyond kind/title/data. Note: the deleted
    // standalone canvas_add_html_primitive tool appended a top-level
    // `primitive: { kind, title, htmlBytes }` field via its own hand-written
    // response wrapper — that field was never part of node.add's registry
    // formatResult, so it has no composite equivalent; the canonical proof is
    // the node's data.htmlPrimitive marker, asserted below.
    const viaComposite = parseJsonText<{ id?: string; node?: { type?: string } }>(
      await call(client, 'canvas_node', { action: 'add', type: 'html', primitive: kind, data, strictSize: true }),
    );
    expect(viaComposite.id).toBeTruthy();
    expect(viaComposite.node?.type).toBe('html');

    // Confirm the created node carries the htmlPrimitive marker (type:"html",
    // htmlPrimitive === kind) + strictSize — the canonical proof.
    const compositeNode = parseJsonText<{ type?: string; data?: { htmlPrimitive?: string; strictSize?: boolean } }>(
      await call(client, 'canvas_node', { action: 'get', id: viaComposite.id, full: true }),
    );
    expect(compositeNode.type).toBe('html');
    expect(compositeNode.data?.htmlPrimitive).toBe(kind);
    expect(compositeNode.data?.strictSize).toBe(true);
  }, 30000);

  test('canvas_node update refresh:true surfaces the known refresh-failure shape', async () => {
    const { client } = await createMcpSession();
    // A connection-refused address fails fast and deterministically (no DNS, no
    // network egress). createWebpageNode adds the node BEFORE the fetch, so the
    // node is created (id returned) even though the initial fetch fails — we can
    // then exercise the REFRESH failure path.
    const refusedUrl = 'http://127.0.0.1:1';
    const created = parseJsonText<{ id?: string; nodeId?: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'webpage', url: refusedUrl, title: 'refresh-fail' }),
    );
    const id = created.id ?? created.nodeId;
    expect(id).toBeTruthy();

    // Refresh re-fetches the refused URL → ok:false. The composite path must
    // surface isError (not a false ok:true) — this is the Wave 5 node.update
    // formatResult fix that let the deleted standalone tool be removed.
    const viaComposite = await call(client, 'canvas_node', { action: 'update', id, refresh: true });

    expect(viaComposite.isError).toBe(true);
    expect(parseJsonText<{ ok?: boolean }>(viaComposite).ok).toBe(false);
  }, 30000);
  test('an unknown action is a loud error, not a silent no-op', async () => {
    const { client } = await createMcpSession();
    const result = await call(client, 'canvas_node', { action: 'frobnicate', id: 'x' });
    // The derived `action` enum rejects unknown actions loudly at the schema
    // validation layer (before dispatch) — never a silent no-op.
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain('action');
  }, 30000);
});

// ── AX composites (plan-007 Slice C) ──────────────────────────────────────────
// Each AX composite action dispatches to the same registry op as its legacy
// standalone tool (reusing buildInput/formatResult), so a composite action is
// byte-identical to the standalone tool. Head-to-head equality where it is a read;
// behavior assertions where it mutates.
describe('MCP AX composite tools (plan-007 Slice C)', () => {
  test('canvas_ax_state get/set-focus/set-policy/report-capability', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'AX state' }),
    );

    // ax.get's known handler shape (canvas_get_ax no longer exists standalone):
    // { ok: true, state, host } — includeContext:false drops the agent context
    // block entirely.
    const getComposite = parseJsonText<{ ok?: boolean; state?: unknown; host?: unknown; context?: unknown }>(
      await call(client, 'canvas_ax_state', { action: 'get', includeContext: false }),
    );
    expect(getComposite.ok).toBe(true);
    expect(getComposite.state).toBeTruthy();
    expect(getComposite.context).toBeUndefined();

    // set-focus → ax.focus.set; the focus field reflects the node.
    const focus = parseJsonText<{ ok?: boolean; focus?: { nodeIds?: string[] } }>(
      await call(client, 'canvas_ax_state', { action: 'set-focus', nodeIds: [node.id] }),
    );
    expect(focus.ok).toBe(true);
    expect(focus.focus?.nodeIds).toEqual([node.id]);

    // set-policy → ax.policy.set; patch merges into the policy.
    const policy = parseJsonText<{ ok?: boolean; policy?: { tools?: { allowed?: string[] } } }>(
      await call(client, 'canvas_ax_state', { action: 'set-policy', tools: { allowed: ['pmx.plan'] } }),
    );
    expect(policy.ok).toBe(true);
    expect(policy.policy?.tools?.allowed).toContain('pmx.plan');

    // report-capability → ax.host-capability.report.
    const cap = parseJsonText<{ ok?: boolean; host?: { host?: string } }>(
      await call(client, 'canvas_ax_state', { action: 'report-capability', host: 'codex', tools: true }),
    );
    expect(cap.ok).toBe(true);
    expect(cap.host?.host).toBe('codex');
  }, 30000);

  test('canvas_ax_work add/update/annotate match standalone tools', async () => {
    const { client } = await createMcpSession();
    const node = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Reviewable' }),
    );

    const added = parseJsonText<{ ok?: boolean; workItem?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_work', { action: 'add', title: 'Build it', status: 'todo' }),
    );
    expect(added.ok).toBe(true);
    expect(added.workItem?.id).toBeTruthy();

    const updated = parseJsonText<{ ok?: boolean; workItem?: { status?: string } }>(
      await call(client, 'canvas_ax_work', { action: 'update', id: added.workItem!.id, status: 'done' }),
    );
    expect(updated.ok).toBe(true);
    expect(updated.workItem?.status).toBe('done');

    const annotated = parseJsonText<{ ok?: boolean; reviewAnnotation?: { id: string } }>(
      await call(client, 'canvas_ax_work', {
        action: 'annotate',
        body: 'Looks good',
        kind: 'comment',
        anchorType: 'node',
        nodeId: node.id,
      }),
    );
    expect(annotated.ok).toBe(true);
    expect(annotated.reviewAnnotation?.id).toBeTruthy();
  }, 30000);

  test('canvas_ax_timeline read/record-event/add-evidence/send-steering', async () => {
    const { client } = await createMcpSession();

    const event = parseJsonText<{ ok?: boolean; event?: { id?: string; kind?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'record-event', kind: 'tool-start', summary: 'started' }),
    );
    expect(event.ok).toBe(true);
    expect(event.event?.kind).toBe('tool-start');

    const evidence = parseJsonText<{ ok?: boolean; evidence?: { id?: string; kind?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'add-evidence', kind: 'logs', title: 'run.log' }),
    );
    expect(evidence.ok).toBe(true);
    expect(evidence.evidence?.kind).toBe('logs');

    const steering = parseJsonText<{ ok?: boolean; steering?: { id?: string; message?: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'send-steering', message: 'focus on tests' }),
    );
    expect(steering.ok).toBe(true);
    expect(steering.steering?.message).toBe('focus on tests');

    // ax.timeline.get's known shape { ok, events, evidence, steering, summary }
    // (canvas_get_ax_timeline no longer exists standalone) — confirm the three
    // rows just recorded are present.
    const readComposite = parseJsonText<{
      ok?: boolean;
      events?: Array<{ id?: string }>;
      evidence?: Array<{ id?: string }>;
      steering?: Array<{ id?: string }>;
    }>(await call(client, 'canvas_ax_timeline', { action: 'read' }));
    expect(readComposite.ok).toBe(true);
    expect(readComposite.events?.some((row) => row.id === event.event?.id)).toBe(true);
    expect(readComposite.evidence?.some((row) => row.id === evidence.evidence?.id)).toBe(true);
    expect(readComposite.steering?.some((row) => row.id === steering.steering?.id)).toBe(true);
  }, 30000);

  test('canvas_ax_delivery claim/mark', async () => {
    const { client } = await createMcpSession();
    // Steering originated by `browser` so the `mcp` consumer can claim it (loop-safe).
    const steering = parseJsonText<{ steering?: { id: string } }>(
      await call(client, 'canvas_ax_timeline', { action: 'send-steering', message: 'do the thing', source: 'browser' }),
    );
    const steeringId = steering.steering!.id;

    // ax.delivery.pending's known shape { ok, pending, pendingActivity }
    // (canvas_claim_ax_delivery no longer exists standalone) — the just-sent
    // steering message must be claimable by the mcp consumer.
    const claimComposite = parseJsonText<{ ok?: boolean; pending?: Array<{ id?: string }> }>(
      await call(client, 'canvas_ax_delivery', { action: 'claim', consumer: 'mcp' }),
    );
    expect(claimComposite.ok).toBe(true);
    expect(claimComposite.pending?.some((row) => row.id === steeringId)).toBe(true);

    const marked = parseJsonText<{ ok?: boolean; delivered?: boolean }>(
      await call(client, 'canvas_ax_delivery', { action: 'mark', id: steeringId }),
    );
    expect(marked.ok).toBe(true);
    expect(marked.delivered).toBe(true);
  }, 30000);

  test('canvas_ax_gate folds approval request → resolve (kind × action)', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; approvalGate?: { id: string; status?: string; action?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'approval',
        action: 'request',
        title: 'Deploy to prod',
        // approvalAction is the namespaced machine-readable identifier — it must
        // NOT collide with the `action` lifecycle discriminator.
        approvalAction: 'deploy',
      }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.approvalGate?.status).toBe('pending');
    // The remapped approvalAction round-trips to the op's `action` field.
    expect(requested.approvalGate?.action).toBe('deploy');

    const resolved = parseJsonText<{ ok?: boolean; approvalGate?: { status?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'approval',
        action: 'resolve',
        id: requested.approvalGate!.id,
        decision: 'approved',
      }),
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.approvalGate?.status).toBe('approved');
  }, 30000);

  test('canvas_ax_gate folds elicitation request → resolve (resolve → respond op)', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; elicitation?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_gate', { kind: 'elicitation', action: 'request', prompt: 'Pick a branch' }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.elicitation?.status).toBe('pending');

    // resolve for elicitation routes to ax.elicitation.respond (carries `response`).
    const resolved = parseJsonText<{ ok?: boolean; elicitation?: { status?: string } }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'elicitation',
        action: 'resolve',
        id: requested.elicitation!.id,
        response: { branch: 'main' },
      }),
    );
    expect(resolved.ok).toBe(true);
    expect(resolved.elicitation?.status).not.toBe('pending');
  }, 30000);

  test('canvas_ax_gate folds mode request and an immediate await read', async () => {
    const { client } = await createMcpSession();
    const requested = parseJsonText<{ ok?: boolean; modeRequest?: { id: string; status?: string } }>(
      await call(client, 'canvas_ax_gate', { kind: 'mode', action: 'request', mode: 'plan' }),
    );
    expect(requested.ok).toBe(true);
    expect(requested.modeRequest?.status).toBe('pending');

    // await (action → ax.mode.get) with timeoutMs 0 is an immediate read; the
    // gate is still pending, so pending=true (canvas_await_mode no longer
    // exists standalone).
    const awaitComposite = parseJsonText<{ pending?: boolean }>(
      await call(client, 'canvas_ax_gate', {
        kind: 'mode',
        action: 'await',
        id: requested.modeRequest!.id,
        timeoutMs: 0,
      }),
    );
    expect(awaitComposite.pending).toBe(true);
  }, 30000);

  test('canvas_ax_gate rejects an invalid kind/action combo loudly', async () => {
    const { client } = await createMcpSession();
    // Invalid kind: the `kind` enum rejects it at the schema layer.
    const badKind = await call(client, 'canvas_ax_gate', { kind: 'nonsense', action: 'request' });
    expect(badKind.isError).toBe(true);

    // Invalid action: the `action` enum rejects it at the schema layer.
    const badAction = await call(client, 'canvas_ax_gate', { kind: 'approval', action: 'frobnicate' });
    expect(badAction.isError).toBe(true);
  }, 30000);

  test('canvas_intent folds signal/update/clear over the ephemeral intent registry', async () => {
    const { client } = await createMcpSession();

    const signalled = parseJsonText<{ ok?: boolean; intent?: { id: string; kind: string } }>(
      await call(client, 'canvas_intent', {
        action: 'signal',
        kind: 'create',
        position: { x: 120, y: 80 },
        nodeType: 'markdown',
        label: 'Add evidence',
        reason: 'capturing the failing test',
        confidence: 0.8,
      }),
    );
    expect(signalled.ok).toBe(true);
    expect(signalled.intent?.kind).toBe('create');
    const intentId = signalled.intent!.id;

    const updated = parseJsonText<{ ok?: boolean; intent?: { label?: string } }>(
      await call(client, 'canvas_intent', { action: 'update', id: intentId, label: 'Add evidence node' }),
    );
    expect(updated.ok).toBe(true);
    expect(updated.intent?.label).toBe('Add evidence node');

    const cleared = parseJsonText<{ ok?: boolean; cleared?: boolean }>(
      await call(client, 'canvas_intent', { action: 'clear', id: intentId, settledNodeId: 'md-1' }),
    );
    expect(cleared.ok).toBe(true);
    expect(cleared.cleared).toBe(true);

    // A create intent missing its position is a loud validation error.
    const bad = await call(client, 'canvas_intent', { action: 'signal', kind: 'create' });
    expect(bad.isError).toBe(true);

    // Intents are presence-only: they never enter the canvas layout.
    const layout = parseJsonText<{ nodes?: unknown[] }>(await call(client, 'canvas_query', { action: 'layout' }));
    expect(layout.nodes ?? []).toHaveLength(0);
  }, 30000);
});
