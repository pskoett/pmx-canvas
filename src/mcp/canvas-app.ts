import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { summarizeNodeForAgentContext } from '../shared/agent-context.js';
import type { CanvasNodeState } from '../server/canvas-state.js';
import { OperationError } from '../server/operations/index.js';
import { CANVAS_APP_URI, type CanvasAppSnapshot } from '../shared/canvas-app.js';
import type { CanvasAccess } from './canvas-access.js';

const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const additive = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const editing = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };
const boardId = z.string().min(1).describe('Active board id from pmx_read_canvas; refuses a stale board.');
const boardListSchema = z.array(z.object({ id: z.string(), name: z.string() }));
const summaryShape = {
  boardId: z.string().nullable(),
  boardName: z.string(),
  boards: boardListSchema,
  revision: z.string(),
  nodeCount: z.number(),
  edgeCount: z.number(),
  pinnedNodeIds: z.array(z.string()),
  nodes: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), contentRevision: z.number() })),
};

function editableContent(node: CanvasNodeState): string | undefined {
  return node.type === 'markdown' &&
    !node.data.path &&
    typeof node.data.content === 'string' &&
    node.data.content.length <= 50_000
    ? node.data.content
    : undefined;
}

async function readSnapshot(canvas: CanvasAccess): Promise<CanvasAppSnapshot> {
  const target = await canvas.prepareContextRead();
  const { boards } = z.object({ boards: boardListSchema }).parse(await canvas.invoker().invoke('board.list', {}));
  if (!target.boardId) {
    return {
      boardId: null,
      boardName: 'No board open',
      boards,
      revision: createHash('sha256').update(JSON.stringify(boards)).digest('hex'),
      nodes: [],
      edges: [],
      pinnedNodeIds: [],
    };
  }
  // Explicit board reads prevent a concurrent workbench switch mixing two boards.
  const layout = await canvas.getLayout(target.boardId);
  const info = z
    .object({ board: z.object({ name: z.string() }) })
    .parse(await canvas.invoker().invoke('board.get', { id: target.boardId }));
  const projection = {
    boardId: target.boardId,
    boardName: info.board.name,
    boards,
    nodes: layout.nodes.map((node) => {
      const src = node.data.src;
      // No network fetches, local paths, SVG or active documents in the app iframe.
      const image =
        node.type === 'image' &&
        typeof src === 'string' &&
        src.length <= 1_400_000 &&
        /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(src)
          ? src
          : undefined;
      return {
        id: node.id,
        type: node.type,
        title: typeof node.data.title === 'string' ? node.data.title : node.type,
        text: summarizeNodeForAgentContext(node, { defaultTextLength: 8000, webpageTextLength: 8000 }),
        contentRevision: node.contentRevision ?? 0,
        editableContent: editableContent(node),
        position: node.position,
        size: node.size,
        ...(image ? { image } : {}),
      };
    }),
    edges: layout.edges.map(({ id, from, to, label }) => ({ id, from, to, label: label ?? '' })),
    pinnedNodeIds: target.pinnedNodeIds,
  };
  return { ...projection, revision: createHash('sha256').update(JSON.stringify(projection)).digest('hex') };
}

function snapshotResult(snapshot: CanvasAppSnapshot): CallToolResult {
  return {
    content: [
      { type: 'text', text: `${snapshot.boardName}: ${snapshot.nodes.length} nodes, ${snapshot.edges.length} edges.` },
    ],
    structuredContent: {
      boardId: snapshot.boardId,
      boardName: snapshot.boardName,
      boards: snapshot.boards,
      revision: snapshot.revision,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      pinnedNodeIds: snapshot.pinnedNodeIds,
      nodes: snapshot.nodes.map(({ id, title, type, contentRevision }) => ({ id, title, type, contentRevision })),
    },
    // Full preview text and image bytes go to the app, not the model's tool transcript.
    _meta: { canvas: snapshot },
  };
}

async function toolResult(run: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof OperationError) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
    console.error('[canvas-app] tool failed', error);
    return {
      isError: true,
      content: [{ type: 'text', text: 'Could not access the canvas. Check the PMX server logs.' }],
    };
  }
}

/** Focused app profile; deliberately does not register the general-purpose composites. */
export function registerCanvasApp(server: McpServer, ensureCanvas: () => Promise<CanvasAccess>): void {
  const read = () => toolResult(async () => snapshotResult(await readSnapshot(await ensureCanvas())));
  const invoke = (operation: string, input: Record<string, unknown>) =>
    toolResult(async () => {
      const result = await (await ensureCanvas()).invoker().invoke(operation, input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    });
  registerAppTool(
    server,
    'pmx_open_canvas',
    {
      title: 'PMX Canvas',
      description: 'Open a live view of the shared PMX board. Select nodes to share context with the conversation.',
      inputSchema: {},
      outputSchema: summaryShape,
      annotations: readOnly,
      _meta: {
        ui: { resourceUri: CANVAS_APP_URI },
        // ChatGPT-specific extensions are confined to this launcher descriptor.
        'openai/ui': { entrypoints: [{ type: 'global' }, { type: 'thread' }], preferredModelDisplayMode: 'fullscreen' },
      },
    },
    read,
  );
  registerAppTool(
    server,
    'pmx_read_canvas',
    {
      title: 'Read PMX Canvas',
      description:
        'Read the shared active board, node identifiers and context pins. Use pmx_read_node for full note content before editing. Does not change boards.',
      inputSchema: {},
      outputSchema: summaryShape,
      annotations: readOnly,
      _meta: { ui: { visibility: ['model', 'app'] } },
    },
    read,
  );

  server.registerTool(
    'pmx_read_node',
    {
      title: 'Read a complete PMX note',
      description:
        'Read full editable Markdown, content revision, position and incident edges for one note. Always read this before replacing or appending content; selection context is truncated. Other node types, file-linked and oversized notes require the workbench.',
      inputSchema: { boardId, id: z.string().min(1) },
      annotations: readOnly,
    },
    (input) =>
      toolResult(async () => {
        const layout = await (await ensureCanvas()).getLayout(input.boardId);
        const node = layout.nodes.find((entry) => entry.id === input.id);
        const content = node && editableContent(node);
        if (!node || content === undefined)
          throw new OperationError('This node is not an editable standalone note. Use the PMX workbench.');
        const result = {
          boardId: input.boardId,
          id: node.id,
          type: node.type,
          title: typeof node.data.title === 'string' ? node.data.title : node.type,
          content,
          contentRevision: node.contentRevision ?? 0,
          position: node.position,
          size: node.size,
          edges: layout.edges
            .filter((edge) => edge.from === node.id || edge.to === node.id)
            .map(({ id, from, to, type, label }) => ({ id, from, to, type, label: label ?? '' })),
        };
        return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
      }),
  );

  server.registerTool(
    'pmx_add_note',
    {
      title: 'Add a PMX note',
      description: 'Add a Markdown note to the shared active board at a canvas position. Existing nodes are preserved.',
      inputSchema: {
        boardId,
        title: z.string().min(1).max(200),
        content: z.string().max(50_000),
        x: z.number().finite(),
        y: z.number().finite(),
      },
      annotations: additive,
    },
    (input) =>
      toolResult(async () => {
        const canvas = await ensureCanvas();
        const result = await canvas.invoker().invoke('node.add', { ...input, type: 'markdown' });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );
  server.registerTool(
    'pmx_connect_nodes',
    {
      title: 'Connect PMX nodes',
      description: 'Add a labelled relationship between two nodes on the shared active board.',
      inputSchema: {
        boardId,
        from: z.string().min(1),
        to: z.string().min(1),
        type: z.enum(['flow', 'depends-on', 'relation', 'references']),
        label: z.string().max(500).optional(),
      },
      annotations: additive,
    },
    (input) =>
      toolResult(async () => {
        const canvas = await ensureCanvas();
        const result = await canvas.invoker().invoke('edge.add', { ...input, expectedBoardId: input.boardId });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );

  server.registerTool(
    'pmx_create_board',
    {
      title: 'Create a PMX board',
      description:
        'Create an empty board without switching the shared workspace. Open it explicitly with pmx_open_board.',
      inputSchema: { name: z.string().trim().min(1).max(120) },
      annotations: additive,
    },
    (input) => invoke('board.create', input),
  );
  server.registerTool(
    'pmx_open_board',
    {
      title: 'Switch the shared PMX board',
      description: 'Switch the active board for ALL conversations and the workbench. Null opens Home.',
      inputSchema: { id: z.string().min(1).nullable(), expectedBoardId: boardId.nullable() },
      annotations: editing,
    },
    (input) => invoke('board.open', input),
  );
  server.registerTool(
    'pmx_pin_nodes',
    {
      title: 'Curate PMX context pins',
      description: 'Add or remove context pins without replacing unrelated pins.',
      inputSchema: { boardId, nodeIds: z.array(z.string().min(1)).min(1).max(20), mode: z.enum(['add', 'remove']) },
      annotations: editing,
    },
    (input) => invoke('pin.set', { ...input, expectedBoardId: input.boardId }),
  );
  server.registerTool(
    'pmx_move_node',
    {
      title: 'Move a PMX node',
      description: 'Set the position of an existing node. Moving a group also moves its children.',
      inputSchema: { boardId, id: z.string().min(1), x: z.number().finite(), y: z.number().finite() },
      annotations: editing,
    },
    (input) => invoke('node.update', { ...input, expectedBoardId: input.boardId }),
  );
  server.registerTool(
    'pmx_update_note',
    {
      title: 'Edit a PMX note',
      description:
        'Replace standalone Markdown using full content and revision from pmx_read_node, never from a truncated selection excerpt. Refuses stale edits and file-linked notes.',
      inputSchema: {
        boardId,
        id: z.string().min(1),
        expectedContentRevision: z.number().int().nonnegative(),
        title: z.string().min(1).max(200),
        content: z.string().max(50_000),
      },
      annotations: editing,
    },
    (input) =>
      toolResult(async () => {
        const canvas = await ensureCanvas();
        const node = await canvas.getNode(input.id, input.boardId);
        if (!node || editableContent(node) === undefined)
          throw new OperationError('Edit this node in the PMX workbench.');
        // Compare again inside node.update, atomically with the actual mutation.
        const result = await canvas.invoker().invoke('node.update', { ...input, expectedBoardId: input.boardId });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      }),
  );

  registerAppResource(server, 'PMX Canvas', CANVAS_APP_URI, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
    contents: [
      {
        uri: CANVAS_APP_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(new URL('../../dist/canvas/mcp-app.html', import.meta.url), 'utf8'),
        _meta: { ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } } },
      },
    ],
  }));
}
