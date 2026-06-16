// If this test fails, you renamed/removed a public MCP tool. That is a
// breaking change. Update CHANGELOG and this list deliberately.
//
// Pre-refactor safety net for the operation-registry refactor: the literal
// lists below were generated from a real listTools/listResources call against
// the current MCP server and freeze the public MCP surface. Per-skill resources
// (canvas://skills/<name>) track the skills/ directory contents and are
// intentionally NOT frozen by name.
//
// plan-006 (MCP tool consolidation) grows this list ADDITIVELY: 69 legacy tools
// + 7 wave-1 action-discriminated composites (canvas_node, canvas_render,
// canvas_edge, canvas_group, canvas_history, canvas_view, canvas_query) + 5 AX
// composites (plan-007 Slice C: canvas_ax_state, canvas_ax_work, canvas_ax_gate,
// canvas_ax_timeline, canvas_ax_delivery — canvas_ax_gate alone folds 9 gate
// tools) = 81, then + canvas_webview (plan-008 Wave 3: folds the 5 webview tools
// via runner injection; canvas_screenshot stays standalone — binary payload) =
// 82, then + canvas_app (plan-008 Wave 4: folds canvas_open_mcp_app,
// canvas_add_diagram, canvas_build_web_artifact — migrated to the registry as
// mcpapp.open / diagram.open / webartifact.build) = 83. plan-008 Wave 5 is
// deprecate-only (no new tool, count stays 83): canvas_add_html_node /
// canvas_add_html_primitive / canvas_refresh_webpage_node carry "Deprecated: use
// canvas_node …" prefixes steering to existing canvas_node add/update params. The
// canvas_snapshot composite is deferred to v0.3 (its name is still held by the
// legacy save-snapshot tool). Legacy single-purpose tools are removed (and this list
// shrinks to the survivors) in v0.3 per docs/api-stability.md — both edits are
// deliberate.
import { afterAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTestWorkspace, removeTestWorkspace } from './helpers.ts';

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

const FROZEN_TOOL_NAMES = [
  'canvas_add_diagram',
  'canvas_add_edge',
  'canvas_add_evidence',
  'canvas_add_graph_node',
  'canvas_add_html_node',
  'canvas_add_html_primitive',
  'canvas_add_json_render_node',
  'canvas_add_node',
  'canvas_add_review_annotation',
  'canvas_add_work_item',
  'canvas_app',
  'canvas_arrange',
  'canvas_await_approval',
  'canvas_await_elicitation',
  'canvas_await_mode',
  'canvas_ax_delivery',
  'canvas_ax_gate',
  'canvas_ax_interaction',
  'canvas_ax_state',
  'canvas_ax_timeline',
  'canvas_ax_work',
  'canvas_batch',
  'canvas_build_web_artifact',
  'canvas_claim_ax_delivery',
  'canvas_clear',
  'canvas_create_group',
  'canvas_delete_snapshot',
  'canvas_describe_schema',
  'canvas_diff',
  'canvas_edge',
  'canvas_evaluate',
  'canvas_fit_view',
  'canvas_focus_node',
  'canvas_gc_snapshots',
  'canvas_get_ax',
  'canvas_get_ax_timeline',
  'canvas_get_layout',
  'canvas_get_node',
  'canvas_group',
  'canvas_group_nodes',
  'canvas_history',
  'canvas_ingest_activity',
  'canvas_invoke_command',
  'canvas_list_snapshots',
  'canvas_mark_ax_delivery',
  'canvas_node',
  'canvas_open_mcp_app',
  'canvas_pin_nodes',
  'canvas_query',
  'canvas_record_ax_event',
  'canvas_redo',
  'canvas_refresh_webpage_node',
  'canvas_remove_annotation',
  'canvas_remove_edge',
  'canvas_remove_node',
  'canvas_render',
  'canvas_report_host_capability',
  'canvas_request_approval',
  'canvas_request_elicitation',
  'canvas_request_mode',
  'canvas_resize',
  'canvas_resolve_approval',
  'canvas_resolve_mode',
  'canvas_respond_elicitation',
  'canvas_restore',
  'canvas_screenshot',
  'canvas_search',
  'canvas_send_steering',
  'canvas_set_ax_focus',
  'canvas_set_ax_policy',
  'canvas_snapshot',
  'canvas_stream_json_render_node',
  'canvas_undo',
  'canvas_ungroup',
  'canvas_update_node',
  'canvas_update_work_item',
  'canvas_validate',
  'canvas_validate_spec',
  'canvas_view',
  'canvas_webview',
  'canvas_webview_start',
  'canvas_webview_status',
  'canvas_webview_stop',
];

const FROZEN_RESOURCE_URIS = [
  'canvas://ax',
  'canvas://ax-context',
  'canvas://ax-delivery',
  'canvas://ax-pending-steering',
  'canvas://ax-timeline',
  'canvas://ax-work',
  'canvas://code-graph',
  'canvas://history',
  'canvas://layout',
  'canvas://pinned-context',
  'canvas://schema',
  'canvas://skills',
  'canvas://spatial-context',
  'canvas://summary',
];

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  while (cleanup.length > 0) {
    const fn = cleanup.pop();
    if (!fn) continue;
    await fn();
  }
});

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

async function createMcpSession(): Promise<Client> {
  const workspaceRoot = createTestWorkspace('pmx-canvas-mcp-freeze-');
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
  const client = new Client({ name: 'pmx-canvas-mcp-freeze-test', version: '0.1.0' }, { capabilities: {} });
  await client.connect(transport);
  cleanup.push(async () => {
    await transport.close();
    removeTestWorkspace(workspaceRoot);
  });
  return client;
}

describe('MCP public surface freeze', () => {
  test('the sorted tool-name list matches the frozen 83-tool list exactly', async () => {
    const client = await createMcpSession();
    const tools = await client.listTools();
    const sortedNames = tools.tools.map((tool) => tool.name).sort();
    expect(FROZEN_TOOL_NAMES).toHaveLength(83);
    expect(sortedNames).toEqual(FROZEN_TOOL_NAMES);
  }, 30000);

  test('the fixed resource URI list matches the frozen 14-resource list exactly', async () => {
    const client = await createMcpSession();
    const resources = await client.listResources();
    const uris = resources.resources.map((resource) => resource.uri);

    // Per-skill resources are derived from skills/ content and may grow or
    // shrink without being an API break — but everything that is not a
    // per-skill resource must match the frozen list exactly.
    const fixedUris = uris.filter((uri) => !uri.startsWith('canvas://skills/')).sort();
    const skillUris = uris.filter((uri) => uri.startsWith('canvas://skills/'));

    expect(FROZEN_RESOURCE_URIS).toHaveLength(14);
    expect(fixedUris).toEqual(FROZEN_RESOURCE_URIS);
    expect(fixedUris.length + skillUris.length).toBe(uris.length);
  }, 30000);
});
