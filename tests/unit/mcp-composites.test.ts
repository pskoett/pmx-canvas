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

interface TextContentItem { type: string; text?: string }
interface ToolResultShape { content?: TextContentItem[]; isError?: boolean }

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

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

async function createMcpSession(): Promise<Client> {
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
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<ToolResultShape> {
  return (await client.callTool({ name, arguments: args })) as ToolResultShape;
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
  test('canvas_node folds add/get/update/remove and matches canvas_get_node', async () => {
    const client = await createMcpSession();

    const added = parseJsonText<{ id: string }>(
      await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Composite', content: '# Hi' }),
    );
    expect(added.id).toBeTruthy();

    // Head-to-head read parity: composite `get` === standalone canvas_get_node.
    const viaComposite = parseJsonText(await call(client, 'canvas_node', { action: 'get', id: added.id }));
    const viaStandalone = parseJsonText(await call(client, 'canvas_get_node', { id: added.id }));
    expect(viaComposite).toEqual(viaStandalone);

    await call(client, 'canvas_node', { action: 'update', id: added.id, title: 'Renamed' });
    // node.get formatResult returns the compact node payload at top level.
    const afterUpdate = parseJsonText<{ title?: string }>(
      await call(client, 'canvas_node', { action: 'get', id: added.id }),
    );
    expect(afterUpdate.title).toBe('Renamed');

    const removed = parseJsonText<{ ok?: boolean }>(await call(client, 'canvas_node', { action: 'remove', id: added.id }));
    expect(removed.ok).toBe(true);
    const missing = await call(client, 'canvas_node', { action: 'get', id: added.id });
    expect(missing.isError).toBe(true);
  }, 30000);

  test('canvas_query search/layout match canvas_search/canvas_get_layout', async () => {
    const client = await createMcpSession();
    await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Findable', content: 'needle' });

    const searchComposite = parseJsonText(await call(client, 'canvas_query', { action: 'search', query: 'Findable' }));
    const searchStandalone = parseJsonText(await call(client, 'canvas_search', { query: 'Findable' }));
    expect(searchComposite).toEqual(searchStandalone);

    const layoutComposite = parseJsonText(await call(client, 'canvas_query', { action: 'layout' }));
    const layoutStandalone = parseJsonText(await call(client, 'canvas_get_layout', {}));
    expect(layoutComposite).toEqual(layoutStandalone);
  }, 30000);

  test('canvas_render describe-schema/validate/add-graph match standalone tools', async () => {
    const client = await createMcpSession();

    const schemaComposite = parseJsonText(await call(client, 'canvas_render', { action: 'describe-schema' }));
    const schemaStandalone = parseJsonText(await call(client, 'canvas_describe_schema', {}));
    expect(schemaComposite).toEqual(schemaStandalone);

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
    const client = await createMcpSession();
    const a = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'A' }));
    const b = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'B' }));

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
    const client = await createMcpSession();
    const node = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Grouped' }));

    const group = parseJsonText<{ id?: string; groupId?: string }>(
      await call(client, 'canvas_group', { action: 'create', title: 'G', childIds: [node.id] }),
    );
    const groupId = group.id ?? group.groupId;
    expect(groupId).toBeTruthy();

    // node.focus uses `id` (the composite schema is derived from the op's shape).
    expect((await call(client, 'canvas_view', { action: 'focus', id: node.id })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'fit' })).isError ?? false).toBe(false);
    expect((await call(client, 'canvas_view', { action: 'arrange' })).isError ?? false).toBe(false);

    const ungrouped = parseJsonText<{ ok?: boolean }>(await call(client, 'canvas_group', { action: 'ungroup', groupId }));
    expect(ungrouped.ok).toBe(true);
  }, 30000);

  test('canvas_history undo/redo reverse the last mutation', async () => {
    const client = await createMcpSession();
    const node = parseJsonText<{ id: string }>(await call(client, 'canvas_node', { action: 'add', type: 'markdown', title: 'Undoable' }));

    expect((await call(client, 'canvas_history', { action: 'undo' })).isError ?? false).toBe(false);
    // After undo, the node add is reversed → get errors.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError).toBe(true);

    expect((await call(client, 'canvas_history', { action: 'redo' })).isError ?? false).toBe(false);
    // After redo, the node is back.
    expect((await call(client, 'canvas_node', { action: 'get', id: node.id })).isError ?? false).toBe(false);
  }, 30000);

  test('an unknown action is a loud error, not a silent no-op', async () => {
    const client = await createMcpSession();
    const result = await call(client, 'canvas_node', { action: 'frobnicate', id: 'x' });
    // The derived `action` enum rejects unknown actions loudly at the schema
    // validation layer (before dispatch) — never a silent no-op.
    expect(result.isError).toBe(true);
    expect(textOf(result).toLowerCase()).toContain('action');
  }, 30000);
});
