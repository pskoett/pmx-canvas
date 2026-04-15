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
  return { workspaceRoot, client, transport };
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
    const { id } = parseJsonText<{ id: string }>(added);

    const updated = await session.client.callTool({
      name: 'canvas_update_node',
      arguments: {
        id,
        arrangeLocked: true,
      },
    }) as ToolResultShape;
    expect(parseJsonText<{ ok: boolean; id: string }>(updated)).toEqual({ ok: true, id });

    const fetched = await session.client.callTool({
      name: 'canvas_get_node',
      arguments: { id },
    }) as ToolResultShape;
    const node = parseJsonText<{ data?: { arrangeLocked?: boolean } }>(fetched);
    expect(node.data?.arrangeLocked).toBe(true);
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

    const result = await session.client.callTool({
      name: 'canvas_evaluate',
      arguments: {
        script: 'const value = 2 + 2; return value;',
      },
    }) as ToolResultShape;

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('automation WebView');
  });
});
