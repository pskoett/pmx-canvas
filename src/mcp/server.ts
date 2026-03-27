/**
 * PMX Canvas MCP Server
 *
 * Exposes the canvas as an MCP tool server so any MCP-capable agent
 * (Claude Code, Codex, Cursor, Windsurf, pi, etc.) can control the
 * canvas with zero configuration beyond adding the server to their config.
 *
 * Auto-starts the HTTP server and opens the browser on first tool call.
 *
 * Usage in agent MCP config:
 * ```json
 * {
 *   "mcpServers": {
 *     "canvas": {
 *       "command": "bunx",
 *       "args": ["pmx-canvas", "--mcp"]
 *     }
 *   }
 * }
 * ```
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createCanvas, canvasState, type PmxCanvas } from '../server/index.js';
import { searchNodes, buildSpatialContext, findNeighborhoods } from '../server/spatial-analysis.js';
import { mutationHistory, diffLayouts, formatDiff } from '../server/mutation-history.js';
import { buildCodeGraphSummary, formatCodeGraph } from '../server/code-graph.js';

let canvas: PmxCanvas | null = null;

async function ensureCanvas(): Promise<PmxCanvas> {
  if (!canvas) {
    const port = parseInt(process.env.PMX_CANVAS_PORT ?? '4313');
    canvas = createCanvas({ port });
    await canvas.start({ open: true });
  }
  return canvas;
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'pmx-canvas',
    version: '0.1.0',
  });

  // ── canvas_get_layout ──────────────────────────────────────────
  server.tool(
    'canvas_get_layout',
    'Get the full canvas state: all nodes, edges, and viewport. Call this first to understand what is on the canvas.',
    {},
    async () => {
      const c = await ensureCanvas();
      const layout = c.getLayout();
      return {
        content: [{ type: 'text', text: JSON.stringify(layout, null, 2) }],
      };
    },
  );

  // ── canvas_get_node ────────────────────────────────────────────
  server.tool(
    'canvas_get_node',
    'Get a single node by ID, including its full data.',
    { id: z.string().describe('The node ID to retrieve') },
    async ({ id }) => {
      const c = await ensureCanvas();
      const node = c.getNode(id);
      if (!node) {
        return {
          content: [{ type: 'text', text: `Node "${id}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(node, null, 2) }],
      };
    },
  );

  // ── canvas_add_node ────────────────────────────────────────────
  server.tool(
    'canvas_add_node',
    'Add a node to the canvas. Returns the new node ID. Node types: markdown (rich content), status (compact indicator), context, ledger, trace, file (live file viewer — set content to a file path), image (set content to an image file path, data URI, or URL), mcp-app.',
    {
      type: z.enum(['markdown', 'status', 'context', 'ledger', 'trace', 'file', 'image', 'mcp-app', 'group'])
        .describe('Node type (prefer canvas_create_group for groups)'),
      title: z.string().optional().describe('Node title'),
      content: z.string().optional().describe('Node content (markdown for markdown nodes, file path for file nodes, image path/URL/data-URI for image nodes)'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 600)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const id = c.addNode(input);
      return {
        content: [{ type: 'text', text: JSON.stringify({ id }) }],
      };
    },
  );

  // ── canvas_update_node ─────────────────────────────────────────
  server.tool(
    'canvas_update_node',
    'Update an existing node. You can change its content, title, position, size, or data.',
    {
      id: z.string().describe('Node ID to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      x: z.number().optional().describe('New X position'),
      y: z.number().optional().describe('New Y position'),
      width: z.number().optional().describe('New width'),
      height: z.number().optional().describe('New height'),
      collapsed: z.boolean().optional().describe('Collapse or expand the node'),
    },
    async ({ id, title, content, x, y, width, height, collapsed }) => {
      const c = await ensureCanvas();
      const node = c.getNode(id);
      if (!node) {
        return {
          content: [{ type: 'text', text: `Node "${id}" not found.` }],
          isError: true,
        };
      }
      const patch: Record<string, unknown> = {};
      if (x !== undefined || y !== undefined) {
        patch.position = { x: x ?? node.position.x, y: y ?? node.position.y };
      }
      if (width !== undefined || height !== undefined) {
        patch.size = { width: width ?? node.size.width, height: height ?? node.size.height };
      }
      if (collapsed !== undefined) {
        patch.collapsed = collapsed;
      }
      if (title !== undefined || content !== undefined) {
        patch.data = {
          ...node.data,
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
        };
      }
      c.updateNode(id, patch);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, id }) }],
      };
    },
  );

  // ── canvas_remove_node ─────────────────────────────────────────
  server.tool(
    'canvas_remove_node',
    'Remove a node from the canvas. Also removes all edges connected to it.',
    { id: z.string().describe('Node ID to remove') },
    async ({ id }) => {
      const c = await ensureCanvas();
      c.removeNode(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, removed: id }) }],
      };
    },
  );

  // ── canvas_add_edge ────────────────────────────────────────────
  server.tool(
    'canvas_add_edge',
    'Add an edge (connection) between two nodes. Edge types: flow (sequential), depends-on (dependency), relation (general), references (cross-reference).',
    {
      from: z.string().describe('Source node ID'),
      to: z.string().describe('Target node ID'),
      type: z.enum(['flow', 'depends-on', 'relation', 'references']).describe('Edge type'),
      label: z.string().optional().describe('Edge label text'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const id = c.addEdge(input);
      return {
        content: [{ type: 'text', text: JSON.stringify({ id }) }],
      };
    },
  );

  // ── canvas_remove_edge ─────────────────────────────────────────
  server.tool(
    'canvas_remove_edge',
    'Remove an edge from the canvas.',
    { id: z.string().describe('Edge ID to remove') },
    async ({ id }) => {
      const c = await ensureCanvas();
      c.removeEdge(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, removed: id }) }],
      };
    },
  );

  // ── canvas_arrange ─────────────────────────────────────────────
  server.tool(
    'canvas_arrange',
    'Auto-arrange all nodes on the canvas. Layouts: grid (default), column (vertical stack), flow (horizontal row).',
    {
      layout: z.enum(['grid', 'column', 'flow']).optional().describe('Arrangement layout (default: grid)'),
    },
    async ({ layout }) => {
      const c = await ensureCanvas();
      c.arrange(layout ?? 'grid');
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, layout: layout ?? 'grid' }) }],
      };
    },
  );

  // ── canvas_focus_node ──────────────────────────────────────────
  server.tool(
    'canvas_focus_node',
    'Pan the viewport to center on a specific node.',
    { id: z.string().describe('Node ID to focus on') },
    async ({ id }) => {
      const c = await ensureCanvas();
      c.focusNode(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, focused: id }) }],
      };
    },
  );

  // ── canvas_clear ───────────────────────────────────────────────
  server.tool(
    'canvas_clear',
    'Remove all nodes and edges from the canvas. Use with caution.',
    {},
    async () => {
      const c = await ensureCanvas();
      c.clear();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, cleared: true }) }],
      };
    },
  );

  // ── canvas_search ───────────────────────────────────────────
  server.tool(
    'canvas_search',
    'Search for nodes by title or content keywords. Returns matching nodes ranked by relevance with snippets. Much faster than reading the full layout when you need to find specific nodes.',
    {
      query: z.string().describe('Search query — matches against node titles, content, and file paths'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    },
    async ({ query, limit }) => {
      await ensureCanvas();
      const results = searchNodes(canvasState.getLayout().nodes, query);
      const capped = results.slice(0, limit ?? 10);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ query, resultCount: results.length, results: capped }, null, 2),
        }],
      };
    },
  );

  // ── canvas_undo ────────────────────────────────────────────────
  server.tool(
    'canvas_undo',
    'Undo the last canvas mutation. Returns a description of what was undone. Use this to backtrack when an approach is wrong — explore without fear.',
    {},
    async () => {
      const c = await ensureCanvas();
      const result = c.undo();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, canUndo: mutationHistory.canUndo(), canRedo: mutationHistory.canRedo() }) }],
      };
    },
  );

  // ── canvas_redo ────────────────────────────────────────────────
  server.tool(
    'canvas_redo',
    'Redo the last undone canvas mutation. Use after undo to re-apply a change.',
    {},
    async () => {
      const c = await ensureCanvas();
      const result = c.redo();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, canUndo: mutationHistory.canUndo(), canRedo: mutationHistory.canRedo() }) }],
      };
    },
  );

  // ── canvas_diff ────────────────────────────────────────────────
  server.tool(
    'canvas_diff',
    'Compare the current canvas state against a saved snapshot. Shows added/removed/modified nodes and edges. Pass either a snapshot name or ID.',
    {
      snapshot: z.string().describe('Snapshot name or ID to compare against'),
    },
    async ({ snapshot }) => {
      await ensureCanvas();
      const snapData = canvasState.getSnapshotData(snapshot);
      if (!snapData) {
        return { content: [{ type: 'text', text: `Snapshot "${snapshot}" not found. Use canvas_snapshot to save one first.` }], isError: true };
      }
      const current = canvasState.getLayout();
      const diff = diffLayouts(snapData.name, snapData, current);
      return {
        content: [{ type: 'text', text: formatDiff(diff) }],
      };
    },
  );

  // ── MCP Resources: Canvas as Context ──────────────────────────
  //
  // The human pins nodes on the canvas → those nodes become the agent's
  // working context. Spatial arrangement IS semantic curation.

  server.resource(
    'pinned-context',
    'canvas://pinned-context',
    {
      description:
        'Content of all pinned nodes on the canvas. When the human pins nodes, ' +
        'they are telling the agent "this is what matters right now." Read this ' +
        'resource to get structured context from the canvas.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const { canvasState } = await import('../server/canvas-state.js');
      const pinnedIds = canvasState.contextPinnedNodeIds;
      const layout = c.getLayout();

      const pinnedNodes = layout.nodes.filter((n) => pinnedIds.has(n.id));
      const pinnedEdges = layout.edges.filter(
        (e) => pinnedIds.has(e.from) && pinnedIds.has(e.to),
      );

      // Compute neighborhoods: for each pinned node, find nearby unpinned nodes
      const neighborhoods = findNeighborhoods(layout.nodes, pinnedIds);

      const context = {
        pinnedCount: pinnedNodes.length,
        nodes: pinnedNodes.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.data.title ?? null,
          content: n.data.content ?? null,
          data: n.data,
          position: n.position,
        })),
        edges: pinnedEdges.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          type: e.type,
          label: e.label ?? null,
        })),
        neighborhoods: neighborhoods.map((nh) => ({
          pinnedNodeId: nh.pinnedNodeId,
          pinnedNodeTitle: nh.pinnedNodeTitle,
          nearbyNodes: nh.neighbors,
        })),
      };

      return {
        contents: [
          {
            uri: 'canvas://pinned-context',
            mimeType: 'application/json',
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'canvas-layout',
    'canvas://layout',
    {
      description:
        'The full canvas layout — all nodes, edges, and viewport state. ' +
        'Use this to understand the complete spatial workspace.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const layout = c.getLayout();
      return {
        contents: [
          {
            uri: 'canvas://layout',
            mimeType: 'application/json',
            text: JSON.stringify(layout, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'canvas-summary',
    'canvas://summary',
    {
      description:
        'A compact summary of the canvas: node count by type, edge count, ' +
        'pinned node titles. Useful for quick orientation without reading all content.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const { canvasState } = await import('../server/canvas-state.js');
      const layout = c.getLayout();
      const pinnedIds = canvasState.contextPinnedNodeIds;

      const typeCounts: Record<string, number> = {};
      for (const n of layout.nodes) {
        typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
      }

      const pinnedTitles = layout.nodes
        .filter((n) => pinnedIds.has(n.id))
        .map((n) => (n.data.title as string) ?? n.id);

      const summary = {
        totalNodes: layout.nodes.length,
        totalEdges: layout.edges.length,
        nodesByType: typeCounts,
        pinnedCount: pinnedIds.size,
        pinnedTitles,
        viewport: layout.viewport,
      };

      return {
        contents: [
          {
            uri: 'canvas://summary',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'spatial-context',
    'canvas://spatial-context',
    {
      description:
        'Spatial intelligence for the canvas. Detects proximity clusters (nodes the human ' +
        'grouped together), provides reading order (top-left to bottom-right), and shows ' +
        'neighborhoods around pinned nodes (nearby unpinned nodes the human implicitly associated). ' +
        'This makes "spatial arrangement is communication" real — read this to understand the ' +
        'human\'s spatial intent, not just which nodes are pinned.',
      mimeType: 'application/json',
    },
    async () => {
      await ensureCanvas();
      const layout = canvasState.getLayout();
      const spatial = buildSpatialContext(layout.nodes, layout.edges, canvasState.contextPinnedNodeIds);
      return {
        contents: [
          {
            uri: 'canvas://spatial-context',
            mimeType: 'application/json',
            text: JSON.stringify(spatial, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'history',
    'canvas://history',
    {
      description:
        'Mutation history timeline for the canvas. Shows what changed and when, ' +
        'with undo/redo position. Read this to understand how the canvas evolved ' +
        'during this session — useful for metacognition and tracking your own actions.',
      mimeType: 'text/plain',
    },
    async () => {
      await ensureCanvas();
      return {
        contents: [
          {
            uri: 'canvas://history',
            mimeType: 'text/plain',
            text: mutationHistory.toHumanReadable(),
          },
        ],
      };
    },
  );

  server.resource(
    'code-graph',
    'canvas://code-graph',
    {
      description:
        'Auto-detected dependency graph between file nodes on the canvas. Shows which files import ' +
        'which other files, central files (most depended on), and isolated files. Dependencies are ' +
        'parsed from import/require/from statements in JS/TS/Python/Go/Rust. Edges are created and ' +
        'updated automatically as file nodes are added or files change.',
      mimeType: 'application/json',
    },
    async () => {
      await ensureCanvas();
      const summary = buildCodeGraphSummary();
      return {
        contents: [
          {
            uri: 'canvas://code-graph',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // ── canvas_create_group ──────────────────────────────────────
  server.tool(
    'canvas_create_group',
    'Create a group (frame) on the canvas that visually contains other nodes. Groups are spatial containers — they communicate "these nodes belong together." If childIds are provided, the group auto-sizes to fit them. Collapsing a group hides its children and shows a summary.',
    {
      title: z.string().optional().describe('Group title (default: "Group")'),
      childIds: z.array(z.string()).optional().describe('Node IDs to include in the group. Group auto-sizes to fit them.'),
      color: z.string().optional().describe('Group accent color (CSS color string, e.g. "#4a9eff")'),
      x: z.number().optional().describe('X position (auto-computed from children if omitted)'),
      y: z.number().optional().describe('Y position (auto-computed from children if omitted)'),
      width: z.number().optional().describe('Width (auto-computed from children if omitted)'),
      height: z.number().optional().describe('Height (auto-computed from children if omitted)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const id = c.createGroup(input);
      return {
        content: [{ type: 'text', text: JSON.stringify({ id }) }],
      };
    },
  );

  // ── canvas_group_nodes ──────────────────────────────────────
  server.tool(
    'canvas_group_nodes',
    'Add nodes to an existing group. The nodes will be visually contained within the group frame.',
    {
      groupId: z.string().describe('The group node ID'),
      childIds: z.array(z.string()).describe('Node IDs to add to the group'),
    },
    async ({ groupId, childIds }) => {
      const c = await ensureCanvas();
      const ok = c.groupNodes(groupId, childIds);
      if (!ok) {
        return { content: [{ type: 'text', text: 'Group not found or no valid children.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groupId }) }] };
    },
  );

  // ── canvas_ungroup ──────────────────────────────────────────
  server.tool(
    'canvas_ungroup',
    'Remove all children from a group, releasing them as independent nodes. The group node itself remains (delete it separately with canvas_remove_node if desired).',
    {
      groupId: z.string().describe('The group node ID to ungroup'),
    },
    async ({ groupId }) => {
      const c = await ensureCanvas();
      const ok = c.ungroupNodes(groupId);
      if (!ok) {
        return { content: [{ type: 'text', text: 'Group not found or already empty.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groupId }) }] };
    },
  );

  // ── canvas_pin_nodes ─────────────────────────────────────────
  server.tool(
    'canvas_pin_nodes',
    'Pin nodes to include them in the agent context. Pinned nodes appear in the canvas://pinned-context resource. The human can also pin nodes by clicking in the browser.',
    {
      nodeIds: z.array(z.string()).describe('Array of node IDs to pin'),
      mode: z.enum(['set', 'add', 'remove']).optional()
        .describe('set: replace all pins, add: add to existing pins, remove: unpin these nodes (default: set)'),
    },
    async ({ nodeIds, mode }) => {
      const c = await ensureCanvas();
      const { canvasState } = await import('../server/canvas-state.js');
      const op = mode ?? 'set';

      if (op === 'set') {
        canvasState.setContextPins(nodeIds);
      } else if (op === 'add') {
        const current = Array.from(canvasState.contextPinnedNodeIds);
        canvasState.setContextPins([...current, ...nodeIds]);
      } else {
        const current = Array.from(canvasState.contextPinnedNodeIds);
        canvasState.setContextPins(current.filter((id) => !nodeIds.includes(id)));
      }

      const { emitPrimaryWorkbenchEvent } = await import('../server/server.js');
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            pinnedNodeIds: Array.from(canvasState.contextPinnedNodeIds),
          }),
        }],
      };
    },
  );

  // ── canvas_snapshot ──────────────────────────────────────────
  server.tool(
    'canvas_snapshot',
    'Save the current canvas state as a named snapshot. Snapshots persist to disk and can be restored later.',
    {
      name: z.string().describe('Name for this snapshot (e.g., "before refactor", "investigation v2")'),
    },
    async (input) => {
      await ensureCanvas();
      const snapshot = canvasState.saveSnapshot(input.name);
      if (!snapshot) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Failed to save snapshot' }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, snapshot }) }] };
    },
  );

  // ── canvas_restore ──────────────────────────────────────────
  server.tool(
    'canvas_restore',
    'Restore the canvas to a previously saved snapshot. Use canvas_snapshot to save first. Pass the snapshot ID to restore.',
    {
      id: z.string().describe('Snapshot ID to restore (from canvas_snapshot or snapshot list)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const ok = canvasState.restoreSnapshot(input.id);
      if (!ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Snapshot not found' }) }] };
      }
      const { emitPrimaryWorkbenchEvent } = await import('../server/server.js');
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, layout: canvasState.getLayout() }) }],
      };
    },
  );

  // ── Resource change notifications ──────────────────────────
  // When canvas state changes (nodes, edges, pins), notify MCP clients
  // so they can re-read resources like canvas://pinned-context.
  canvasState.onChange((type) => {
    try {
      if (type === 'pins') {
        server.server.sendResourceUpdated({ uri: 'canvas://pinned-context' });
      }
      server.server.sendResourceUpdated({ uri: 'canvas://layout' });
      server.server.sendResourceUpdated({ uri: 'canvas://summary' });
      server.server.sendResourceUpdated({ uri: 'canvas://spatial-context' });
      server.server.sendResourceUpdated({ uri: 'canvas://history' });
      server.server.sendResourceUpdated({ uri: 'canvas://code-graph' });
    } catch {
      // Notification failures are non-fatal (e.g., client disconnected)
    }
  });

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow direct execution: bun run src/mcp/server.ts
if (import.meta.main) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
