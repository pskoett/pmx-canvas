import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace, removeTestWorkspace } from './helpers.ts';
import { MARKDOWN_NODE_DEFAULT_SIZE } from '../../src/server/canvas-operations.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';

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
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

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
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function textOf(result: ToolResultShape): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

function parseJsonText<T>(result: ToolResultShape): T {
  return JSON.parse(textOf(result)) as T;
}

async function createMcpSession(): Promise<{
  workspaceRoot: string;
  client: Client;
  transport: StdioClientTransport;
  port: number;
}> {
  const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-');
  const port = await getAvailablePort();
  const transport = new StdioClientTransport({
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
  const client = new Client({ name: 'pmx-canvas-mcp-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return { workspaceRoot, client, transport, port };
}

async function createMcpSessionForWorkspace(workspaceRoot: string, port: number, extraEnv: Record<string, string> = {}): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const transport = new StdioClientTransport({
    command: 'bun',
    args: ['run', mcpServerPath],
    cwd: workspaceRoot,
    env: {
      ...process.env,
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
      PMX_CANVAS_PORT: String(port),
      ...extraEnv,
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'pmx-canvas-mcp-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport };
}

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanup.length > 0) {
    const fn = cleanup.pop();
    if (!fn) continue;
    await fn();
  }
});

describe('MCP parity with CLI', () => {
  test('exposes the expected CLI parity surface via MCP tools and resources', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const toolNames = new Set(tools.tools.map((tool) => tool.name));
    const expectedTools = [
      'canvas_get_layout',
      'canvas_get_node',
      'canvas_add_node',
      'canvas_open_mcp_app',
      'canvas_add_diagram',
      'canvas_describe_schema',
      'canvas_validate_spec',
      'canvas_add_html_primitive',
      'canvas_add_graph_node',
      'canvas_add_json_render_node',
      'canvas_build_web_artifact',
      'canvas_update_node',
      'canvas_remove_node',
      'canvas_add_edge',
      'canvas_remove_edge',
      'canvas_arrange',
      'canvas_focus_node',
      'canvas_fit_view',
      'canvas_clear',
      'canvas_search',
      'canvas_undo',
      'canvas_redo',
      'canvas_diff',
      'canvas_create_group',
      'canvas_group_nodes',
      'canvas_ungroup',
      'canvas_pin_nodes',
      'canvas_snapshot',
      'canvas_list_snapshots',
      'canvas_gc_snapshots',
      'canvas_restore',
      'canvas_delete_snapshot',
      'canvas_batch',
      'canvas_validate',
      'canvas_webview_status',
      'canvas_webview_start',
      'canvas_webview_stop',
      'canvas_evaluate',
      'canvas_resize',
      'canvas_screenshot',
    ];
    for (const tool of expectedTools) {
      expect(toolNames.has(tool)).toBe(true);
    }

    const resources = await session.client.listResources();
    const resourceUris = new Set(resources.resources.map((resource) => resource.uri));
    const expectedResources = [
      'canvas://pinned-context',
      'canvas://schema',
      'canvas://layout',
      'canvas://summary',
      'canvas://spatial-context',
      'canvas://history',
      'canvas://code-graph',
    ];
    for (const uri of expectedResources) {
      expect(resourceUris.has(uri)).toBe(true);
    }
  });

  test('canvas_update_node exposes arrangeLocked and persists it', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const updateTool = tools.tools.find((tool) => tool.name === 'canvas_update_node');
    expect(updateTool?.inputSchema.properties).toHaveProperty('arrangeLocked');

    const added = await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Parity markdown',
        content: 'body',
      },
    }) as ToolResultShape;
    const created = parseJsonText<{
      id: string;
      node: { position: { x: number; y: number }; size: { width: number; height: number } };
    }>(added);
    expect(created.node.position).toEqual({ x: 40, y: 80 });
    expect(created.node.size).toEqual(MARKDOWN_NODE_DEFAULT_SIZE);
    const { id } = created;

    const updated = await session.client.callTool({
      name: 'canvas_update_node',
      arguments: {
        id,
        arrangeLocked: true,
      },
    }) as ToolResultShape;
    expect(parseJsonText<{ ok: boolean; id: string; node?: { id: string } }>(updated)).toMatchObject({
      ok: true,
      id,
      node: { id },
    });

    const fetched = await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id, full: true },
    }) as ToolResultShape;
    const node = parseJsonText<{ data?: { arrangeLocked?: boolean } }>(fetched);
    expect(node.data?.arrangeLocked).toBe(true);
  });

  test('canvas_add_node exposes and persists strictSize', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const addNodeTool = tools.tools.find((tool) => tool.name === 'canvas_add_node');
    expect(addNodeTool?.inputSchema.properties).toHaveProperty('strictSize');

    const described = parseJsonText<{
      nodeTypes: Array<{ type: string; fields: Array<{ name: string }> }>;
    }>(await session.client.callTool({
      name: 'canvas_describe_schema',
      arguments: {},
    }) as ToolResultShape);
    expect(described.nodeTypes.find((entry) => entry.type === 'markdown')?.fields.some((field) => field.name === 'strictSize')).toBe(true);

    const created = parseJsonText<{
      id: string;
      data: { strictSize?: boolean };
      size: { width: number; height: number };
    }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Strict MCP markdown',
        content: 'Tall content',
        width: 320,
        height: 140,
        strictSize: true,
        full: true,
      },
    }) as ToolResultShape);

    expect(created.size).toEqual({ width: 320, height: 140 });
    expect(created.data.strictSize).toBe(true);
  });

  test('canvas_add_node exposes and persists trace fields', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const addNodeTool = tools.tools.find((tool) => tool.name === 'canvas_add_node');
    const updateNodeTool = tools.tools.find((tool) => tool.name === 'canvas_update_node');
    const addDiagramTool = tools.tools.find((tool) => tool.name === 'canvas_add_diagram');
    expect(addNodeTool?.inputSchema.properties).toHaveProperty('toolName');
    expect(addNodeTool?.inputSchema.properties).toHaveProperty('resultSummary');
    expect(updateNodeTool?.inputSchema.properties).toHaveProperty('toolName');
    expect(updateNodeTool?.inputSchema.properties).toHaveProperty('resultSummary');
    expect(addDiagramTool?.inputSchema.properties).toHaveProperty('timeoutMs');
    expect(addDiagramTool?.inputSchema.properties).toHaveProperty('nodeId');

    const created = parseJsonText<{
      id: string;
      data: Record<string, unknown>;
    }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'trace',
        title: 'MCP trace',
        content: 'Trace body',
        toolName: 'canvas_add_node',
        category: 'mcp',
        status: 'success',
        duration: '42ms',
        resultSummary: 'Created node',
        error: '',
        full: true,
      },
    }) as ToolResultShape);

    expect(created.data).toMatchObject({
      title: 'MCP trace',
      content: 'Trace body',
      toolName: 'canvas_add_node',
      category: 'mcp',
      status: 'success',
      duration: '42ms',
      resultSummary: 'Created node',
      error: '',
    });

    const updated = parseJsonText<{ data: Record<string, unknown> }>(await session.client.callTool({
      name: 'canvas_update_node',
      arguments: {
        id: created.id,
        toolName: 'canvas_update_node',
        status: 'failed',
        error: 'boom',
        full: true,
      },
    }) as ToolResultShape);

    expect(updated.data).toMatchObject({
      toolName: 'canvas_update_node',
      status: 'failed',
      error: 'boom',
    });
  });

  test('uses an existing daemon as MCP state authority for HTTP-created nodes', async () => {
    const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-remote-');
    const port = await getAvailablePort();
    const baseUrl = startCanvasServer({ workspaceRoot, port, autoOpenBrowser: false });
    if (!baseUrl) throw new Error('Failed to start daemon for MCP remote authority test.');

    const session = await createMcpSessionForWorkspace(workspaceRoot, port);
    cleanup.push(async () => {
      await session.transport.close();
      stopCanvasServer();
      removeTestWorkspace(workspaceRoot);
    });

    const createdResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'HTTP authoritative node',
        content: 'visible to MCP',
        strictSize: true,
      }),
    });
    expect(createdResponse.ok).toBe(true);
    const created = await createdResponse.json() as { id: string };

    const fetchedResult = await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id: created.id },
    }) as ToolResultShape;
    expect(fetchedResult.isError).not.toBe(true);
    const fetched = parseJsonText<{
      id: string;
      title: string;
    }>(fetchedResult);

    expect(fetched.id).toBe(created.id);
    expect(fetched.title).toBe('HTTP authoritative node');
    expect(fetched).not.toHaveProperty('data');

    const fullFetched = parseJsonText<{
      id: string;
      data: { strictSize?: boolean };
    }>(await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id: created.id, full: true },
    }) as ToolResultShape);
    expect(fullFetched.data.strictSize).toBe(true);

    const addedByMcp = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'MCP through daemon',
        content: 'round trip',
      },
    }) as ToolResultShape);

    const httpLayout = await (await fetch(`${baseUrl}/api/canvas/state`)).json() as { nodes: Array<{ id: string }> };
    expect(httpLayout.nodes.some((node) => node.id === created.id)).toBe(true);
    expect(httpLayout.nodes.some((node) => node.id === addedByMcp.id)).toBe(true);
  });

  test('promotes local MCP access when a configured daemon becomes healthy later', async () => {
    const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-promote-');
    const localPort = await getAvailablePort();
    const remotePort = await getAvailablePort();
    const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;

    const session = await createMcpSessionForWorkspace(workspaceRoot, localPort, {
      PMX_CANVAS_URL: remoteBaseUrl,
    });
    cleanup.push(async () => {
      await session.transport.close();
      stopCanvasServer();
      removeTestWorkspace(workspaceRoot);
    });

    const localOnly = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Before delayed daemon',
        content: 'created in local MCP mode',
      },
    }) as ToolResultShape);
    expect(localOnly.id).toBeTruthy();

    const baseUrl = startCanvasServer({ workspaceRoot, port: remotePort, autoOpenBrowser: false });
    expect(baseUrl).toBe(remoteBaseUrl);
    const createdResponse = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Delayed daemon node',
        content: 'visible after promotion',
      }),
    });
    expect(createdResponse.ok).toBe(true);
    const created = await createdResponse.json() as { id: string };

    const fetchedResult = await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id: created.id },
    }) as ToolResultShape;
    expect(fetchedResult.isError).not.toBe(true);
    expect(parseJsonText<{ id: string; title: string }>(fetchedResult)).toMatchObject({
      id: created.id,
      title: 'Delayed daemon node',
    });

    const addedByMcp = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'MCP after promotion',
      },
    }) as ToolResultShape);

    const remoteLayout = await (await fetch(`${baseUrl}/api/canvas/state`)).json() as { nodes: Array<{ id: string }> };
    expect(remoteLayout.nodes.some((node) => node.id === addedByMcp.id)).toBe(true);
  });

  test('canvas_update_node combines graph updates with arrangeLocked', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const added = await session.client.callTool({
      name: 'canvas_add_graph_node',
      arguments: {
        title: 'MCP graph',
        graphType: 'line',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      },
    }) as ToolResultShape;
    const created = parseJsonText<{ id: string }>(added);

    const updated = await session.client.callTool({
      name: 'canvas_update_node',
      arguments: {
        id: created.id,
        data: [{ label: 'B', value: 8 }],
        arrangeLocked: true,
        full: true,
      },
    }) as ToolResultShape;

    const payload = parseJsonText<{
      ok: boolean;
      node?: { data?: { arrangeLocked?: boolean; graphConfig?: { data?: Array<Record<string, unknown>> } } };
    }>(updated);
    expect(payload.ok).toBe(true);
    expect(payload.node?.data?.arrangeLocked).toBe(true);
    expect(payload.node?.data?.graphConfig?.data).toEqual([{ label: 'B', value: 8 }]);
  });

  test('canvas_fit_view updates the viewport for screenshot workflows', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Fit A',
        x: 100,
        y: 100,
        width: 200,
        height: 100,
      },
    });
    await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Fit B',
        x: 700,
        y: 500,
        width: 300,
        height: 200,
      },
    });

    const fitted = parseJsonText<{
      ok: boolean;
      viewport: { x: number; y: number; scale: number };
      nodeCount: number;
    }>(await session.client.callTool({
      name: 'canvas_fit_view',
      arguments: { width: 1200, height: 800, padding: 100 },
    }) as ToolResultShape);
    expect(fitted).toMatchObject({ ok: true, nodeCount: 2, viewport: { x: 50, y: 0, scale: 1 } });

    const layout = parseJsonText<{ viewport: { x: number; y: number; scale: number } }>(await session.client.callTool({
      name: 'canvas_get_layout',
      arguments: { full: true },
    }) as ToolResultShape);
    expect(layout.viewport).toEqual(fitted.viewport);
  });

  test('canvas_add_node webpage returns explicit fetch status', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const result = await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'webpage',
        content: 'https://example.invalid',
      },
    }) as ToolResultShape;

    const payload = parseJsonText<{
      ok: boolean;
      id: string;
      error?: string;
      fetch: { ok: boolean; error?: string };
    }>(result);

    expect(payload.ok).toBe(true);
    expect(payload.id).toBeTruthy();
    expect(payload.fetch.ok).toBe(false);
    expect(payload.fetch.error).toBeTruthy();
    expect(payload.error).toBeTruthy();
  }, 15000);

  test('canvas://pinned-context returns structured webpage context for MCP consumers', async () => {
    const webpageServer = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
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
      },
    });

    const session = await createMcpSession();
    cleanup.push(async () => {
      webpageServer.stop(true);
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const created = parseJsonText<{
      id: string;
      fetch: { ok: boolean };
    }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'webpage',
        content: `http://127.0.0.1:${webpageServer.port}/article-long`,
        x: 220,
        y: 180,
      },
    }) as ToolResultShape);
    expect(created.fetch.ok).toBe(true);

    const pins = parseJsonText<{ ok: boolean; pinnedNodeIds: string[] }>(await session.client.callTool({
      name: 'canvas_pin_nodes',
      arguments: {
        nodeIds: [created.id],
        mode: 'set',
      },
    }) as ToolResultShape);
    expect(pins.pinnedNodeIds).toEqual([created.id]);

    const resource = await session.client.readResource({ uri: 'canvas://pinned-context' });
    const textResource = resource.contents.find((entry) => 'text' in entry && typeof entry.text === 'string');
    expect(textResource).toBeDefined();
    const parsed = JSON.parse(textResource?.text ?? '{}') as {
      pinnedCount: number;
      nodes: Array<{
        id: string;
        type: string;
        title: string | null;
        content: string | null;
        metadata?: Record<string, unknown>;
        position?: { x: number; y: number };
      }>;
    };

    expect(parsed.pinnedCount).toBe(1);
    expect(parsed.nodes).toEqual([
      expect.objectContaining({
        id: created.id,
        type: 'webpage',
        title: 'Long Canvas Webpage',
        content: expect.stringContaining('Long-form webpage section 10'),
        metadata: expect.objectContaining({
          url: `http://127.0.0.1:${webpageServer.port}/article-long`,
          pageTitle: 'Long Canvas Webpage',
          description: 'Long webpage node fixture',
        }),
        position: { x: 220, y: 180 },
      }),
    ]);
    expect(parsed.nodes[0]).not.toHaveProperty('data');
  });

  test('canvas://pinned-context returns kind for native, graph, and external app nodes', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const markdown = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'MCP Pinned Note',
        content: 'MCP native context',
      },
    }) as ToolResultShape);
    const graph = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_graph_node',
      arguments: {
        title: 'MCP Pinned Graph',
        graphType: 'bar',
        data: [{ label: 'A', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      },
    }) as ToolResultShape);
    const externalApp = parseJsonText<{ nodeId: string | null }>(await session.client.callTool({
      name: 'canvas_open_mcp_app',
      arguments: {
        title: 'MCP Pinned Counter',
        serverName: 'Fixture Counter',
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: session.workspaceRoot,
        },
      },
    }) as ToolResultShape);
    expect(externalApp.nodeId).toBeTruthy();

    parseJsonText<{ ok: boolean; pinnedNodeIds: string[] }>(await session.client.callTool({
      name: 'canvas_pin_nodes',
      arguments: {
        nodeIds: [markdown.id, graph.id, externalApp.nodeId],
        mode: 'set',
      },
    }) as ToolResultShape);

    const resource = await session.client.readResource({ uri: 'canvas://pinned-context' });
    const textResource = resource.contents.find((entry) => 'text' in entry && typeof entry.text === 'string');
    const parsed = JSON.parse(textResource?.text ?? '{}') as {
      nodes: Array<{ id: string; type: string; kind: string }>;
    };
    const kinds = Object.fromEntries(parsed.nodes.map((node) => [node.id, { type: node.type, kind: node.kind }]));

    expect(kinds[markdown.id]).toEqual({ type: 'markdown', kind: 'markdown' });
    expect(kinds[graph.id]).toEqual({ type: 'graph', kind: 'graph' });
    expect(kinds[externalApp.nodeId!]).toEqual({ type: 'mcp-app', kind: 'external-app' });
  }, 30000);

  test('canvas_open_mcp_app opens a standard ui:// MCP App node', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const opened = parseJsonText<{
      ok: boolean;
      id?: string;
      nodeId: string | null;
      toolCallId: string;
      sessionId: string;
      resourceUri: string;
    }>(await session.client.callTool({
      name: 'canvas_open_mcp_app',
      arguments: {
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: session.workspaceRoot,
        },
      },
    }) as ToolResultShape);

    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');
    expect(opened.id).toBe(opened.nodeId);
    expect(opened.nodeId?.startsWith('ext-app-ext-app-')).toBe(false);
    expect(opened.sessionId).toContain('mcp-app-session');
    expect(opened.resourceUri).toBe('ui://fixture/counter.html');

    const layout = parseJsonText<{
      nodes: Array<{
        id: string;
        type: string;
        data: Record<string, unknown>;
      }>;
    }>(await session.client.callTool({
      name: 'canvas_get_layout',
      arguments: { full: true },
    }) as ToolResultShape);

    const appNode = layout.nodes.find((node) =>
      node.type === 'mcp-app' &&
      node.data.mode === 'ext-app' &&
      node.data.appSessionId === opened.sessionId,
    );
    expect(appNode).toBeTruthy();
    expect(appNode?.id).toBe(opened.nodeId);
    expect(appNode?.data.resourceUri).toBe('ui://fixture/counter.html');
    expect(appNode?.data.toolName).toBe('show_counter');
  }, 20000);

  test('canvas_get_node and canvas_get_layout full elide hosted MCP app shell HTML', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const first = parseJsonText<{
      ok: boolean;
      nodeId: string | null;
      resourceUri: string;
    }>(await session.client.callTool({
      name: 'canvas_open_mcp_app',
      arguments: {
        toolName: 'show_counter',
        toolArguments: { initial: 1 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: session.workspaceRoot,
        },
      },
    }) as ToolResultShape);
    const second = parseJsonText<{ ok: boolean; nodeId: string | null }>(await session.client.callTool({
      name: 'canvas_open_mcp_app',
      arguments: {
        toolName: 'show_counter',
        toolArguments: { initial: 2 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: session.workspaceRoot,
        },
      },
    }) as ToolResultShape);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(typeof first.nodeId).toBe('string');
    expect(typeof second.nodeId).toBe('string');

    const nodeText = textOf(await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id: first.nodeId, full: true },
    }) as ToolResultShape);
    const fetchedNode = JSON.parse(nodeText) as { data: { html?: unknown; resourceUri?: unknown } };
    expect(nodeText).not.toContain('Fixture Counter');
    expect(fetchedNode.data.resourceUri).toBe('ui://fixture/counter.html');
    expect(fetchedNode.data.html).toMatchObject({
      omitted: 'external-mcp-app-html',
      resourceUri: 'ui://fixture/counter.html',
      bytes: expect.any(Number),
      sha256: expect.any(String),
    });

    const layoutText = textOf(await session.client.callTool({
      name: 'canvas_get_layout',
      arguments: { full: true },
    }) as ToolResultShape);
    const layout = JSON.parse(layoutText) as {
      nodes: Array<{ id: string; type: string; data: { html?: unknown; resourceUri?: unknown } }>;
    };
    const appNodes = layout.nodes.filter((node) => node.type === 'mcp-app');
    expect(appNodes).toHaveLength(2);
    expect(layoutText).not.toContain('Fixture Counter');
    for (const appNode of appNodes) {
      expect(appNode.data.resourceUri).toBe('ui://fixture/counter.html');
      expect(appNode.data.html).toMatchObject({
        omitted: 'external-mcp-app-html',
        resourceUri: 'ui://fixture/counter.html',
        bytes: expect.any(Number),
        sha256: expect.any(String),
      });
    }
  }, 30000);

  test('canvas_describe_schema, canvas_validate_spec, and canvas://schema expose the running-server schema surface', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const described = parseJsonText<{
      ok: boolean;
      nodeTypes: Array<{ type: string; kind: string; mcpTool?: string; fields: Array<{ name: string; aliases?: string[]; required?: boolean }> }>;
      jsonRender: { components: Array<{ type: string }> };
      mcp: { nodeTypeRouting: Record<string, string> };
    }>(await session.client.callTool({
      name: 'canvas_describe_schema',
      arguments: {},
    }) as ToolResultShape);

    expect(described.ok).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'webpage')?.fields.find((field) => field.name === 'url')?.aliases).toContain('content');
    expect(described.nodeTypes.find((entry) => entry.type === 'image')?.fields.find((field) => field.name === 'content')?.aliases).toContain('path');
    expect(described.nodeTypes.find((entry) => entry.type === 'json-render')?.fields.find((field) => field.name === 'title')).toMatchObject({ required: false });
    expect(described.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'series')).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'toolName')).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'trace')?.fields.some((field) => field.name === 'resultSummary')).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'external-app')?.kind).toBe('virtual-node');
    expect(described.mcp.nodeTypeRouting).toMatchObject({
      markdown: 'canvas_add_node',
      'json-render': 'canvas_add_json_render_node',
      graph: 'canvas_add_graph_node',
      'web-artifact': 'canvas_build_web_artifact',
      'html-primitive': 'canvas_add_html_primitive',
      'external-app': 'canvas_open_mcp_app',
      group: 'canvas_create_group',
    });
    expect(described.jsonRender.components.some((component) => component.type === 'Table')).toBe(true);

    const validated = parseJsonText<{
      ok: boolean;
      type: string;
      normalizedSpec: {
        elements: Record<string, { props?: { rows?: string[][] } }>;
      };
    }>(await session.client.callTool({
      name: 'canvas_validate_spec',
      arguments: {
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
      },
    }) as ToolResultShape);

    expect(validated.ok).toBe(true);
    expect(validated.type).toBe('json-render');
    expect(validated.normalizedSpec.elements.table?.props?.rows).toEqual([
      ['Builds', '12'],
      ['Deploys', '4'],
    ]);

    const resource = await session.client.readResource({ uri: 'canvas://schema' });
    const schemaText = resource.contents?.find((item) => item.uri === 'canvas://schema')?.text ?? '';
    expect(schemaText).toContain('"source": "running-server"');
    expect(schemaText).toContain('"nodeTypeRouting"');
    expect(schemaText).toContain('"web-artifact": "canvas_build_web_artifact"');
    expect(schemaText).toContain('"canvas_validate_spec"');
  });

  test('canvas_add_node supports image path alias and json-render accepts legacy shapes', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });
    const imagePath = join(session.workspaceRoot, 'mcp-image-path.png');
    writeFileSync(imagePath, tinyPng);

    const tools = await session.client.listTools();
    const addNodeTool = tools.tools.find((tool) => tool.name === 'canvas_add_node');
    expect(addNodeTool?.inputSchema.properties).toHaveProperty('path');
    const jsonRenderTool = tools.tools.find((tool) => tool.name === 'canvas_add_json_render_node');
    expect(jsonRenderTool?.inputSchema.required).not.toContain('title');

    const image = parseJsonText<{
      ok: boolean;
      id: string;
      data: { src: string; mimeType: string };
    }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'image',
        path: imagePath,
        full: true,
      },
    }) as ToolResultShape);
    expect(image.ok).toBe(true);
    expect(image.data.src).toBe(imagePath);
    expect(image.data.mimeType).toBe('image/png');

    const jsonRender = parseJsonText<{
      ok: boolean;
      id: string;
      spec: {
        root: string;
        elements: Record<string, { type?: string; props?: { text?: string; variant?: string; label?: string } }>;
      };
    }>(await session.client.callTool({
      name: 'canvas_add_json_render_node',
      arguments: {
        spec: {
          type: 'Badge',
          props: { label: 'MCP Legacy', variant: 'success' },
        },
      },
    }) as ToolResultShape);
    expect(jsonRender.ok).toBe(true);
    expect(jsonRender.spec.root).toBe('root');
    expect(jsonRender.spec.elements.root?.type).toBe('Badge');
    expect(jsonRender.spec.elements.root?.props?.text).toBe('MCP Legacy');
    expect(jsonRender.spec.elements.root?.props?.variant).toBe('success');
    expect(jsonRender.spec.elements.root?.props).not.toHaveProperty('label');
  });

  test('canvas_validate_spec covers the full graph payload surface', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const validateTool = tools.tools.find((tool) => tool.name === 'canvas_validate_spec');
    expect(validateTool?.inputSchema.properties).toHaveProperty('zKey');
    expect(validateTool?.inputSchema.properties).toHaveProperty('axisKey');
    expect(validateTool?.inputSchema.properties).toHaveProperty('metrics');
    expect(validateTool?.inputSchema.properties).toHaveProperty('series');
    expect(validateTool?.inputSchema.properties).toHaveProperty('barKey');
    expect(validateTool?.inputSchema.properties).toHaveProperty('lineKey');
    expect(validateTool?.inputSchema.properties).toHaveProperty('barColor');
    expect(validateTool?.inputSchema.properties).toHaveProperty('lineColor');

    const composed = parseJsonText<{
      ok: boolean;
      normalizedSpec: { elements: { chart?: { type?: string; props?: Record<string, unknown> } } };
    }>(await session.client.callTool({
      name: 'canvas_validate_spec',
      arguments: {
        type: 'graph',
        title: 'MCP Composed',
        graphType: 'composed',
        data: [
          { month: 'Jan', visits: 120, conversion: 0.2 },
          { month: 'Feb', visits: 160, conversion: 0.3 },
        ],
        xKey: 'month',
        barKey: 'visits',
        lineKey: 'conversion',
        barColor: '#60b5ff',
        lineColor: '#d7a83f',
      },
    }) as ToolResultShape);

    expect(composed.ok).toBe(true);
    expect(composed.normalizedSpec.elements.chart?.type).toBe('ComposedChart');
    expect(composed.normalizedSpec.elements.chart?.props).toEqual(expect.objectContaining({
      xKey: 'month',
      barKey: 'visits',
      lineKey: 'conversion',
      barColor: '#60b5ff',
      lineColor: '#d7a83f',
    }));
  });

  test('canvas_build_web_artifact matches CLI log behavior and keeps raw logs opt-in', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const artifactTool = tools.tools.find((tool) => tool.name === 'canvas_build_web_artifact');
    expect(artifactTool?.inputSchema.properties).toHaveProperty('includeLogs');
    expect(artifactTool?.description).toContain('60s MCP client timeouts');

    const initScriptPath = join(session.workspaceRoot, 'emit-init.sh');
    const bundleScriptPath = join(session.workspaceRoot, 'emit-bundle.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
echo "init stdout"
echo "init stderr" 1>&2
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"mcp-web-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
cat > "$PROJECT_NAME/src/main.tsx" <<'EOF'
console.log("main");
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
echo "bundle stdout"
echo "bundle stderr" 1>&2
echo '<!DOCTYPE html><html><body>artifact</body></html>' > bundle.html
`, 'utf-8');
    await Bun.$`chmod +x ${initScriptPath} ${bundleScriptPath}`;

    const quiet = parseJsonText<{
      id?: string;
      nodeId?: string;
      path: string;
      metadata?: Record<string, unknown>;
      logs?: { stdout?: { excerpt: string[] }; stderr?: { excerpt: string[] } };
      stdout?: string;
      stderr?: string;
      completedAt?: string;
    }>(await session.client.callTool({
      name: 'canvas_build_web_artifact',
      arguments: {
        title: 'Quiet MCP Artifact',
        appTsx: 'export default function App() { return <main>Quiet MCP Artifact</main>; }',
        initScriptPath,
        bundleScriptPath,
      },
    }) as ToolResultShape);
    expect(quiet.path).toContain('quiet-mcp-artifact.html');
    expect(quiet.id).toBe(quiet.nodeId);
    expect(quiet.stdout).toBeUndefined();
    expect(quiet.stderr).toBeUndefined();
    expect(quiet.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(quiet.logs?.stderr?.excerpt).toContain('bundle stderr');
    expect(quiet.metadata?.sourcePreview).toContain('Quiet MCP Artifact');
    expect(JSON.stringify(quiet.metadata)).not.toContain('<!DOCTYPE html>');

    const compactLayout = parseJsonText<{
      nodes: Array<{ id: string; kind: string; content: string | null }>;
    }>(await session.client.callTool({
      name: 'canvas_get_layout',
      arguments: {},
    }) as ToolResultShape);
    const compactArtifact = compactLayout.nodes.find((node) => node.id === quiet.nodeId);
    expect(compactArtifact?.kind).toBe('web-artifact');
    expect(compactArtifact?.content).toContain('Web artifact: Quiet MCP Artifact');
    expect(compactArtifact?.content).toContain('App source preview:');
    expect(compactArtifact?.content).not.toContain('<!DOCTYPE html>');

    const verbose = parseJsonText<{
      stdout?: string;
      stderr?: string;
    }>(await session.client.callTool({
      name: 'canvas_build_web_artifact',
      arguments: {
        title: 'Verbose MCP Artifact',
        appTsx: 'export default function App() { return <main>Verbose MCP Artifact</main>; }',
        initScriptPath,
        bundleScriptPath,
        includeLogs: true,
      },
    }) as ToolResultShape);
    expect(verbose.stdout).toContain('bundle stdout');
    expect(verbose.stderr).toContain('bundle stderr');
  });

  test('canvas_evaluate exposes script and accepts it as input', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const evaluateTool = tools.tools.find((tool) => tool.name === 'canvas_evaluate');
    expect(evaluateTool?.inputSchema.properties).toHaveProperty('script');
    expect(evaluateTool?.inputSchema.properties).toHaveProperty('expression');
    const evaluateProperties = evaluateTool?.inputSchema.properties as Record<string, { description?: string }> | undefined;
    expect(evaluateProperties?.script?.description).toContain('async IIFE');

    const result = await session.client.callTool({
      name: 'canvas_evaluate',
      arguments: {
        script: 'const value = 2 + 2; return value;',
      },
    }) as ToolResultShape;

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('automation WebView');
  });

  test('canvas_get_node exposes normalized title/content and canvas_add_edge supports style/animated', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const edgeTool = tools.tools.find((tool) => tool.name === 'canvas_add_edge');
    expect(edgeTool?.inputSchema.properties).toHaveProperty('style');
    expect(edgeTool?.inputSchema.properties).toHaveProperty('animated');
    expect(edgeTool?.inputSchema.properties).toHaveProperty('fromSearch');
    expect(edgeTool?.inputSchema.properties).toHaveProperty('toSearch');

    const first = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Edge start',
        content: 'alpha',
      },
    }) as ToolResultShape);
    const second = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Edge end',
        content: 'beta',
      },
    }) as ToolResultShape);

    const edge = parseJsonText<{ id: string; from: string; to: string }>(await session.client.callTool({
      name: 'canvas_add_edge',
      arguments: {
        fromSearch: 'Edge start',
        toSearch: 'Edge end',
        type: 'references',
        style: 'dashed',
        animated: true,
      },
    }) as ToolResultShape);
    expect(edge.id).toBeTruthy();

    const node = parseJsonText<{
      title: string | null;
      content: string | null;
    }>(await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id: first.id },
    }) as ToolResultShape);
    expect(node.title).toBe('Edge start');
    expect(node.content).toBe('alpha');

    const layout = parseJsonText<{
      edges: Array<{ id: string; style?: string; animated?: boolean }>;
    }>(await session.client.callTool({
      name: 'canvas_get_layout',
      arguments: {},
    }) as ToolResultShape);
    expect(layout.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: edge.id,
        from: first.id,
        to: second.id,
        style: 'dashed',
        animated: true,
      }),
    ]));
  });

  test('canvas_create_group exposes manual frame + childLayout, and canvas_batch/canvas_validate provide parity', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const groupTool = tools.tools.find((tool) => tool.name === 'canvas_create_group');
    expect(groupTool?.inputSchema.properties).toHaveProperty('childLayout');

    const child = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Grouped child',
        x: 760,
        y: 240,
        width: 220,
        height: 140,
      },
    }) as ToolResultShape);

    const group = parseJsonText<{
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(await session.client.callTool({
      name: 'canvas_create_group',
      arguments: {
        title: 'Manual group',
        x: 40,
        y: 60,
        width: 960,
        height: 720,
        childIds: [child.id],
        childLayout: 'column',
        full: true,
      },
    }) as ToolResultShape);
    expect(group.position).toEqual({ x: 40, y: 60 });
    expect(group.size).toEqual({ width: 960, height: 720 });

    await session.client.callTool({
      name: 'canvas_clear',
      arguments: {},
    });

    const batch = parseJsonText<{
      ok: boolean;
      refs: Record<string, { id: string }>;
    }>(await session.client.callTool({
      name: 'canvas_batch',
      arguments: {
        full: true,
        operations: [
          {
            op: 'node.add',
            assign: 'child',
            args: { type: 'markdown', title: 'Batch child', x: 240, y: 200, width: 240, height: 160 },
          },
          {
            op: 'group.create',
            assign: 'frame',
            args: { title: 'Batch frame', childIds: ['$child.id'] },
          },
        ],
      },
    }) as ToolResultShape);
    expect(batch.ok).toBe(true);

    const validation = parseJsonText<{
      ok: boolean;
      collisions: unknown[];
      containments: Array<{ groupId: string; childId: string }>;
    }>(await session.client.callTool({
      name: 'canvas_validate',
      arguments: {},
    }) as ToolResultShape);
    expect(validation.ok).toBe(true);
    expect(validation.collisions).toEqual([]);
    expect(validation.containments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: batch.refs.frame.id,
        childId: batch.refs.child.id,
      }),
    ]));
  });

  test('canvas_batch documents bare refs and surfaces partial failure envelopes', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const tools = await session.client.listTools();
    const batchTool = tools.tools.find((tool) => tool.name === 'canvas_batch');
    expect(batchTool?.description).toContain('"$name"');
    expect(batchTool?.description).toContain('non-atomic');

    const success = parseJsonText<{
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{ ok: boolean; id: string; from?: string; to?: string }>;
    }>(await session.client.callTool({
      name: 'canvas_batch',
      arguments: {
        operations: [
          { op: 'node.add', assign: 'src', args: { type: 'markdown', title: 'Bare source' } },
          { op: 'node.add', assign: 'dst', args: { type: 'markdown', title: 'Bare target' } },
          { op: 'edge.add', assign: 'edge', args: { from: '$src', to: '$dst', type: 'references' } },
        ],
      },
    }) as ToolResultShape);
    expect(success.ok).toBe(true);
    expect(success.results[2]).toMatchObject({
      from: success.refs.src.id,
      to: success.refs.dst.id,
    });

    const failed = await session.client.callTool({
      name: 'canvas_batch',
      arguments: {
        operations: [
          { op: 'node.add', assign: 'kept', args: { type: 'markdown', title: 'Partial success' } },
          { op: 'edge.add', args: { from: '$kept', to: '$missing', type: 'references' } },
        ],
      },
    }) as ToolResultShape;
    expect(failed.isError).toBe(true);
    expect(parseJsonText<{
      ok: boolean;
      failedIndex: number;
      error: string;
      refs: Record<string, { id: string }>;
      results: Array<{ id: string }>;
    }>(failed)).toMatchObject({
      ok: false,
      failedIndex: 1,
      refs: { kept: { id: expect.any(String) } },
      results: [expect.objectContaining({ id: expect.any(String) })],
    });
  });

  test('canvas_batch supports webpage nodes and surfaces fetch status', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const result = parseJsonText<{
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        ok: boolean;
        id: string;
        type: string;
        fetch: { ok: boolean; error?: string };
        error?: string;
      }>;
    }>(await session.client.callTool({
      name: 'canvas_batch',
      arguments: {
        operations: [
          {
            op: 'node.add',
            assign: 'page',
            args: {
              type: 'webpage',
              content: 'https://example.invalid',
            },
          },
        ],
      },
    }) as ToolResultShape);

    expect(result.ok).toBe(true);
    expect(typeof result.refs.page?.id).toBe('string');
    expect(result.results[0]?.type).toBe('webpage');
    expect(result.results[0]?.fetch.ok).toBe(false);
    expect(result.results[0]?.fetch.error).toBeTruthy();
    expect(result.results[0]?.error).toBe(result.results[0]?.fetch.error);
  }, 15000);

  test('canvas_batch supports graph.add operations', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const result = parseJsonText<{
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        ok: boolean;
        id: string;
        type: string;
        size: { width: number; height: number };
        data: Record<string, unknown>;
      }>;
    }>(await session.client.callTool({
      name: 'canvas_batch',
      arguments: {
        full: true,
        operations: [
          {
            op: 'graph.add',
            assign: 'graph',
            args: {
              title: 'Batch graph',
              graphType: 'radar',
              data: [
                { axis: 'Speed', north: 5, south: 3 },
                { axis: 'Quality', north: 4, south: 6 },
              ],
              axisKey: 'axis',
              metrics: ['north', 'south'],
              width: 880,
              nodeHeight: 640,
            },
          },
        ],
      },
    }) as ToolResultShape);

    expect(result.ok).toBe(true);
    expect(typeof result.refs.graph?.id).toBe('string');
    expect(result.results[0]?.type).toBe('graph');
    expect(result.results[0]?.size).toEqual({ width: 880, height: 640 });
    expect(result.results[0]?.data.graphConfig).toEqual(expect.objectContaining({
      graphType: 'radar',
      axisKey: 'axis',
      metrics: ['north', 'south'],
    }));
  });

  test('canvas_list_snapshots, canvas_gc_snapshots, and canvas_delete_snapshot match CLI snapshot management', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const savedSnapshots: Array<{ id: string; name: string }> = [];
    for (const name of ['mcp-alpha', 'mcp-beta', 'mcp-parity-snapshot']) {
      const saved = parseJsonText<{ ok: boolean; id: string; snapshot: { id: string; name: string } }>(await session.client.callTool({
        name: 'canvas_snapshot',
        arguments: { name },
      }) as ToolResultShape);
      expect(saved.ok).toBe(true);
      savedSnapshots.push(saved.snapshot);
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    const saved = { ok: true, id: savedSnapshots[2]!.id, snapshot: savedSnapshots[2]! };
    expect(saved.ok).toBe(true);
    expect(saved.id).toBe(saved.snapshot.id);

    const listed = parseJsonText<{ snapshots: Array<{ id: string; name: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: { limit: 2 },
    }) as ToolResultShape);
    expect(listed.snapshots.map((snapshot) => snapshot.name)).toEqual(['mcp-parity-snapshot', 'mcp-beta']);

    const filtered = parseJsonText<{ snapshots: Array<{ id: string; name: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: { query: 'alpha', all: true },
    }) as ToolResultShape);
    expect(filtered.snapshots.map((snapshot) => snapshot.name)).toEqual(['mcp-alpha']);

    const dateFiltered = parseJsonText<{ snapshots: Array<{ id: string; name: string; createdAt: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: {
        all: true,
        after: savedSnapshots[1]!.createdAt,
        before: savedSnapshots[1]!.createdAt,
      },
    }) as ToolResultShape);
    expect(dateFiltered.snapshots.map((snapshot) => snapshot.name)).toEqual(['mcp-beta']);

    const preview = parseJsonText<{ ok: boolean; kept: number; dryRun: boolean; deleted: Array<{ name: string }> }>(await session.client.callTool({
      name: 'canvas_gc_snapshots',
      arguments: { keep: 2, dryRun: true },
    }) as ToolResultShape);
    expect(preview.ok).toBe(true);
    expect(preview.kept).toBe(2);
    expect(preview.dryRun).toBe(true);
    expect(preview.deleted.map((snapshot) => snapshot.name)).toEqual(['mcp-alpha']);

    const deleted = parseJsonText<{ ok: boolean; deleted: string }>(await session.client.callTool({
      name: 'canvas_delete_snapshot',
      arguments: {
        id: saved.snapshot.id,
      },
    }) as ToolResultShape);
    expect(deleted).toEqual({ ok: true, deleted: saved.snapshot.id });

    const afterDelete = parseJsonText<{ snapshots: Array<{ id: string; name: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: { all: true },
    }) as ToolResultShape);
    expect(afterDelete.snapshots.some((snapshot) => snapshot.id === saved.snapshot.id)).toBe(false);
  });

  test('canvas_restore returns a compact summary instead of the full layout', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    await session.client.callTool({
      name: 'canvas_add_node',
      arguments: {
        type: 'markdown',
        title: 'Snapshot node',
        content: 'snapshot content',
      },
    });
    const saved = parseJsonText<{ id: string }>(await session.client.callTool({
      name: 'canvas_snapshot',
      arguments: { name: 'compact restore' },
    }) as ToolResultShape);
    await session.client.callTool({ name: 'canvas_clear', arguments: {} });

    const restored = parseJsonText<{
      ok: boolean;
      restored: string;
      summary: { nodeCount: number; edgeCount: number; nodesByType: Record<string, number> };
      layout?: unknown;
    }>(await session.client.callTool({
      name: 'canvas_restore',
      arguments: { id: saved.id },
    }) as ToolResultShape);

    expect(restored.ok).toBe(true);
    expect(restored.restored).toBe(saved.id);
    expect(restored.summary).toMatchObject({
      nodeCount: 1,
      edgeCount: 0,
      nodesByType: { markdown: 1 },
    });
    expect(restored.layout).toBeUndefined();
  });
});
