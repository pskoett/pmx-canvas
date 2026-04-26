import { afterEach, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
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
      'canvas_add_graph_node',
      'canvas_add_json_render_node',
      'canvas_build_web_artifact',
      'canvas_update_node',
      'canvas_remove_node',
      'canvas_add_edge',
      'canvas_remove_edge',
      'canvas_arrange',
      'canvas_focus_node',
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
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(added);
    expect(created.position).toEqual({ x: 40, y: 80 });
    expect(created.size).toEqual({ width: 360, height: 200 });
    const { id } = created;

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
      arguments: {},
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

  test('canvas_describe_schema, canvas_validate_spec, and canvas://schema expose the running-server schema surface', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const described = parseJsonText<{
      ok: boolean;
      nodeTypes: Array<{ type: string; kind: string; mcpTool?: string; fields: Array<{ name: string; aliases?: string[] }> }>;
      jsonRender: { components: Array<{ type: string }> };
      mcp: { nodeTypeRouting: Record<string, string> };
    }>(await session.client.callTool({
      name: 'canvas_describe_schema',
      arguments: {},
    }) as ToolResultShape);

    expect(described.ok).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'webpage')?.fields.find((field) => field.name === 'url')?.aliases).toContain('content');
    expect(described.nodeTypes.find((entry) => entry.type === 'graph')?.fields.some((field) => field.name === 'series')).toBe(true);
    expect(described.nodeTypes.find((entry) => entry.type === 'external-app')?.kind).toBe('virtual-node');
    expect(described.mcp.nodeTypeRouting).toMatchObject({
      markdown: 'canvas_add_node',
      'json-render': 'canvas_add_json_render_node',
      graph: 'canvas_add_graph_node',
      'web-artifact': 'canvas_build_web_artifact',
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
      logs?: { stdout?: { excerpt: string[] }; stderr?: { excerpt: string[] } };
      stdout?: string;
      stderr?: string;
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
    expect(quiet.logs?.stderr?.excerpt).toContain('bundle stderr');

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

  test('canvas_list_snapshots and canvas_delete_snapshot match CLI snapshot management', async () => {
    const session = await createMcpSession();
    cleanup.push(async () => {
      await session.transport.close();
      removeTestWorkspace(session.workspaceRoot);
    });

    const saved = parseJsonText<{ ok: boolean; snapshot: { id: string; name: string } }>(await session.client.callTool({
      name: 'canvas_snapshot',
      arguments: {
        name: 'mcp-parity-snapshot',
      },
    }) as ToolResultShape);
    expect(saved.ok).toBe(true);

    const listed = parseJsonText<{ snapshots: Array<{ id: string; name: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: {},
    }) as ToolResultShape);
    expect(listed.snapshots).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: saved.snapshot.id,
        name: 'mcp-parity-snapshot',
      }),
    ]));

    const deleted = parseJsonText<{ ok: boolean; deleted: string }>(await session.client.callTool({
      name: 'canvas_delete_snapshot',
      arguments: {
        id: saved.snapshot.id,
      },
    }) as ToolResultShape);
    expect(deleted).toEqual({ ok: true, deleted: saved.snapshot.id });

    const afterDelete = parseJsonText<{ snapshots: Array<{ id: string; name: string }> }>(await session.client.callTool({
      name: 'canvas_list_snapshots',
      arguments: {},
    }) as ToolResultShape);
    expect(afterDelete.snapshots.some((snapshot) => snapshot.id === saved.snapshot.id)).toBe(false);
  });
});
