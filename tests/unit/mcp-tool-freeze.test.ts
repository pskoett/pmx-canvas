// If this test fails, you renamed/removed a public MCP tool. That is a
// breaking change. Update CHANGELOG and this list deliberately.
//
// Pre-refactor safety net for the operation-registry refactor: the literal
// lists below were generated from a real listTools/listResources call against
// the current MCP server and freeze the public MCP surface. Per-skill resources
// (canvas://skills/<name>) track the skills/ directory contents and are
// intentionally NOT frozen by name.
//
// plan-006 through plan-008 (MCP tool consolidation) grew this list ADDITIVELY
// across v0.2, landing at 84 tools: 69 legacy single-purpose tools + 15
// action-discriminated composites (canvas_node, canvas_render, canvas_edge,
// canvas_group, canvas_history, canvas_view, canvas_query, canvas_webview,
// canvas_app, canvas_ax_state, canvas_ax_work, canvas_ax_gate,
// canvas_ax_timeline, canvas_ax_delivery, canvas_intent). Every composite
// action dispatched to an already-registered op, so the composite was
// byte-identical to its legacy standalone by construction.
//
// v0.3.0 is the SHRINK: per docs/api-stability.md's deprecate-one-minor-before-
// removal rule, the 57 legacy single-purpose tools folded by a composite are
// REMOVED (registration-suppressed via `compositeFoldedOpNames` in
// src/server/operations/composites.ts + the filter in
// src/server/operations/mcp.ts `registerOperationTools`) — the op itself is
// untouched and stays reachable through its composite (or canvas_batch). Three
// hand-registered tools with no composite of their own (canvas_add_html_node,
// canvas_add_html_primitive, canvas_refresh_webpage_node — folded into
// canvas_node add/update params) were deleted outright from src/mcp/server.ts.
// v0.3.0 dropped the surface from 84 to 27, keeping the 6 legacy snapshot
// tools deprecated (the canvas_snapshot composite name collided with the
// legacy save-snapshot tool, so it could not land additively).
//
// v0.4.0 completed the fold: the canvas_snapshot COMPOSITE ships (actions
// save | list | restore | delete | gc | diff), repurposing the freed name and
// removing the 6 deprecated snapshot standalones the same way v0.3.0 folded
// everything else. Surface: 22 tools = 16 composites + canvas_batch,
// canvas_pin_nodes, canvas_invoke_command, canvas_ax_interaction,
// canvas_ingest_activity, canvas_screenshot.
import { afterAll, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createTestWorkspace, getAvailablePort, removeTestWorkspace } from './helpers.ts';

const mcpServerPath = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

const FROZEN_TOOL_NAMES = [
  'canvas_app',
  'canvas_ax_delivery',
  'canvas_ax_gate',
  'canvas_ax_interaction',
  'canvas_ax_state',
  'canvas_ax_timeline',
  'canvas_ax_work',
  'canvas_batch',
  'canvas_edge',
  'canvas_group',
  'canvas_history',
  'canvas_ingest_activity',
  'canvas_intent',
  'canvas_invoke_command',
  'canvas_node',
  'canvas_pin_nodes',
  'canvas_query',
  'canvas_render',
  'canvas_screenshot',
  'canvas_snapshot',
  'canvas_view',
  'canvas_webview',
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
  test('the sorted tool-name list matches the frozen 22-tool list exactly', async () => {
    const client = await createMcpSession();
    const tools = await client.listTools();
    const sortedNames = tools.tools.map((tool) => tool.name).sort();
    expect(FROZEN_TOOL_NAMES).toHaveLength(22);
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
