/**
 * Many boards (plan 012): board.list / board.get / board.create /
 * board.update / board.open / board.delete.
 *
 * Agents can explicitly open boards as well as list, read and create them.
 * Deletion requires the human (HUMAN_ONLY_OPS in registry.ts).
 * Every change broadcasts `boards-changed` with the full list.
 *
 * Route-order note: board.open (POST /api/canvas/boards/open) is registered
 * before any `/api/canvas/boards/:id` POST route so ':id' cannot swallow it.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { normalizeBoardCategory } from '../../../shared/boards.js';
import { canvasState, type CanvasLayout } from '../../canvas-state.js';
import { openCanvasBoard } from '../../canvas-operations.js';
import { summarizeNodeForAgentContext } from '../../agent-context.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';

export function boardsPayload(): Record<string, unknown> {
  const boards = canvasState.listBoards();
  const names = new Map(boards.map((board) => [board.id, board.name]));
  const links = new Map<string, Array<{ nodeId: string; boardId: string; title: string | null; missing: boolean }>>();
  for (const board of boards) {
    const nodes = canvasState.readBoard(board.id, false)?.layout.nodes ?? [];
    links.set(
      board.id,
      nodes
        .filter((node) => node.type === 'board')
        .map((node) => {
          const boardId = typeof node.data.boardId === 'string' ? node.data.boardId : '';
          return { nodeId: node.id, boardId, title: names.get(boardId) ?? null, missing: !names.has(boardId) };
        }),
    );
  }
  return {
    activeBoardId: canvasState.activeBoardId,
    boards: boards.map((board) => {
      const read = canvasState.readBoard(board.id, true);
      const readme = read?.layout.nodes.find((node) => node.id === board.readmeNodeId && node.type === 'markdown');
      return {
        ...board,
        summary: readme ? summarizeNodeForAgentContext(readme, { defaultTextLength: 1000 }) : null,
        pinnedTitles: (read?.layout.nodes ?? [])
          .filter((node) => read?.state.contextPins.includes(node.id))
          .map((node) => ({ nodeId: node.id, title: typeof node.data.title === 'string' ? node.data.title : node.id })),
        links: links.get(board.id) ?? [],
        backlinks: boards.flatMap((source) =>
          (links.get(source.id) ?? [])
            .filter((link) => link.boardId === board.id)
            .map((link) => ({ boardId: source.id, title: source.name, nodeId: link.nodeId })),
        ),
      };
    }),
  };
}

/** Read a board without opening it. Omitted board preserves the active-board contract. */
export function readTargetBoard(
  boardId?: unknown,
  includeBlobs = true,
): {
  boardId: string | null;
  layout: CanvasLayout;
  pinnedNodeIds: Set<string>;
} {
  const requested = typeof boardId === 'string' && boardId.trim() ? boardId.trim() : null;
  if (!requested) {
    return {
      boardId: canvasState.activeBoardId,
      layout: canvasState.getLayout(),
      pinnedNodeIds: new Set(canvasState.contextPinnedNodeIds),
    };
  }
  const read = canvasState.readBoard(requested, includeBlobs);
  if (!read) throw new OperationError(`Board "${requested}" not found.`, 404);
  return {
    boardId: requested,
    layout: read.layout,
    pinnedNodeIds: new Set(read.state.contextPins),
  };
}

function emitBoardsChanged(ctx: OperationContext): void {
  ctx.emit('boards-changed', boardsPayload());
}

const jsonResult = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
});

/** '' or null clears the category; undefined leaves it alone. */
function boardCategory(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  try {
    return normalizeBoardCategory(typeof value === 'string' ? value : null);
  } catch (error) {
    throw new OperationError(error instanceof Error ? error.message : String(error));
  }
}

function boardName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new OperationError('A board needs a name.');
  if (name.length > 120) throw new OperationError('Board names are at most 120 characters.');
  return name;
}

// ── board.list ────────────────────────────────────────────────

const listShape = {};
const listSchema = z.looseObject(listShape);

const boardListOperation = defineOperation<z.infer<typeof listSchema>, Record<string, unknown>>({
  name: 'board.list',
  mutates: false,
  input: listSchema,
  inputShape: listShape,
  http: { method: 'GET', path: '/api/canvas/boards' },
  mcp: {
    toolName: 'canvas_list_boards',
    description:
      'List the boards in this workspace, most recently opened first, with node counts and which one is open (activeBoardId; null means the human is on Home).',
    formatResult: jsonResult,
  },
  handler: () => ({ ok: true, ...boardsPayload() }),
});

// ── board.get ─────────────────────────────────────────────────

const getShape = {
  id: z.unknown().optional().describe('Board id (default: the open board)'),
};
const getSchema = z.looseObject(getShape);

const boardGetOperation = defineOperation<z.infer<typeof getSchema>, Record<string, unknown>>({
  name: 'board.get',
  mutates: false,
  input: getSchema,
  inputShape: getShape,
  http: { method: 'GET', path: '/api/canvas/boards/:id' },
  mcp: {
    toolName: 'canvas_get_board',
    description: 'Read one board by id (name, created, last opened, node count). Omit id for the open board.',
    extraShape: { id: z.string().optional().describe('Board id (default: the open board)') },
    formatResult: jsonResult,
  },
  handler: (input) => {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : canvasState.activeBoardId;
    const board = id ? canvasState.listBoards().find((entry) => entry.id === id) : undefined;
    if (!board) throw new OperationError(id ? `Board "${id}" not found.` : 'No board is open.', 404);
    return { ok: true, board, open: board.id === canvasState.activeBoardId };
  },
});

// ── board.create ──────────────────────────────────────────────

const createShape = {
  name: z.unknown().optional().describe('Board name'),
  category: z.unknown().optional().describe('Folder path on Home, e.g. Engineering/Canvas'),
};
const createSchema = z.looseObject(createShape);

const boardCreateOperation = defineOperation<z.infer<typeof createSchema>, Record<string, unknown>>({
  name: 'board.create',
  mutates: false,
  input: createSchema,
  inputShape: createShape,
  http: { method: 'POST', path: '/api/canvas/boards' },
  mcp: {
    toolName: 'canvas_create_board',
    description:
      'Create a new empty board without opening it. Use canvas_board action "open" with the returned board id before writing to it.',
    extraShape: {
      name: z.string().describe('Board name'),
      category: z.string().optional().describe('Folder path on Home, e.g. Engineering/Canvas'),
    },
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const board = canvasState.createBoard(boardName(input.name), boardCategory(input.category) ?? null);
    if (!board) throw new OperationError('Boards need a workspace database.', 409);
    emitBoardsChanged(ctx);
    return { ok: true, board };
  },
});

// ── board.open ────────────────────────────────────────────────

const openShape = {
  id: z.unknown().optional().describe('Board id to open; null or omitted opens Home'),
};
const openSchema = z.looseObject(openShape);

const boardOpenOperation = defineOperation<z.infer<typeof openSchema>, Record<string, unknown>>({
  name: 'board.open',
  mutates: false,
  input: openSchema,
  inputShape: openShape,
  http: { method: 'POST', path: '/api/canvas/boards/open' },
  mcp: {
    toolName: 'canvas_open_board',
    description:
      'Open a board in the shared workbench, or Home with null. Changes the visible board and the target of subsequent writes. Verify activeBoardId in the response before authoring.',
    extraShape: { id: z.string().nullable().optional().describe('Board id to open; null or omitted opens Home') },
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : null;
    if (!openCanvasBoard(id).ok) throw new OperationError(`Board "${id}" not found.`, 404);
    emitBoardsChanged(ctx);
    return { ok: true, ...boardsPayload() };
  },
});

// ── board.update ──────────────────────────────────────────────

const updateShape = {
  id: z.unknown().optional().describe('Board id'),
  name: z.unknown().optional().describe('New name'),
  category: z.unknown().optional().describe('Folder path on Home; "" or null unfiles it'),
  readmeNodeId: z.unknown().optional().describe('Markdown node id to use as README; null clears it'),
};
const updateSchema = z.looseObject(updateShape);

const boardUpdateOperation = defineOperation<z.infer<typeof updateSchema>, Record<string, unknown>>({
  name: 'board.update',
  mutates: false,
  input: updateSchema,
  inputShape: updateShape,
  http: { method: 'PATCH', path: '/api/canvas/boards/:id' },
  mcp: {
    toolName: 'canvas_update_board',
    description:
      'Rename a board, move it into a nested folder on Home (e.g. Engineering/Canvas; category "" unfiles it), or designate its markdown introduction with readmeNodeId. During board authoring, set a useful README when none exists; preserve an existing designation unless the human requests a change. Moving preserves the board ID and content.',
    extraShape: {
      id: z.string().describe('Board id'),
      name: z.string().optional().describe('New name'),
      category: z.string().optional().describe('Folder path, up to 8 levels of 1–60 characters; "" unfiles it'),
      readmeNodeId: z.string().nullable().optional().describe('Markdown node id used as the board README'),
    },
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const patch = {
      ...(input.name !== undefined ? { name: boardName(input.name) } : {}),
      ...(input.category !== undefined ? { category: boardCategory(input.category) ?? null } : {}),
    };
    if (input.readmeNodeId !== undefined) {
      const board = canvasState.readBoard(id, false);
      if (!board) throw new OperationError(`Board "${id}" not found.`, 404);
      if (
        input.readmeNodeId &&
        !board.layout.nodes.some((node) => node.id === input.readmeNodeId && node.type === 'markdown')
      ) {
        throw new OperationError('README must identify a markdown node on this board.');
      }
    }
    if (!canvasState.updateBoard(id, patch)) {
      throw new OperationError(`Board "${id}" not found.`, 404);
    }
    if (input.readmeNodeId !== undefined) {
      const nodeId = typeof input.readmeNodeId === 'string' && input.readmeNodeId ? input.readmeNodeId : null;
      if (!canvasState.setBoardReadme(id, nodeId)) {
        throw new OperationError('README must identify a markdown node on this board.');
      }
    }
    emitBoardsChanged(ctx);
    return { ok: true, ...boardsPayload() };
  },
});

const fromShape = {
  sourceBoardId: z.string().describe('Source board id'),
  name: z.string().describe('New board name'),
  category: z.string().optional(),
  nodeIds: z.array(z.string()).optional(),
  includeReadme: z.boolean().optional(),
  includeStructure: z.boolean().optional(),
  preview: z.boolean().optional().describe('Return reusable cards and structure without creating'),
};
const fromSchema = z.looseObject(fromShape);
const boardCreateFromOperation = defineOperation<z.infer<typeof fromSchema>, Record<string, unknown>>({
  name: 'board.create-from',
  // Like board.create, this writes only a new inactive board. `mutates` means
  // active-layout mutation: setting it would auto-open a board from Home.
  mutates: false,
  input: fromSchema,
  inputShape: fromShape,
  http: { method: 'POST', path: '/api/canvas/boards/from' },
  mcp: {
    toolName: 'canvas_create_board_from',
    description: 'Preview or create an inactive board from selected reusable cards and structure on another board.',
    extraShape: fromShape,
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const source = canvasState.readBoard(input.sourceBoardId, false);
    if (!source) throw new OperationError(`Board "${input.sourceBoardId}" not found.`, 404);
    if (input.preview) {
      return {
        ok: true,
        sourceBoardId: input.sourceBoardId,
        readmeNodeId: source.board.readmeNodeId,
        cards: source.layout.nodes.map((node) => ({
          id: node.id,
          type: node.type,
          title: typeof node.data.title === 'string' ? node.data.title : null,
          reusable: !['prompt', 'response', 'trace', 'mcp-app'].includes(node.type),
        })),
        edges: source.layout.edges.map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })),
      };
    }
    const board = canvasState.createBoardFromBoard({
      ...input,
      name: boardName(input.name),
      category: boardCategory(input.category),
    });
    if (!board) throw new OperationError('Could not create board from source.', 409);
    emitBoardsChanged(ctx);
    return { ok: true, board };
  },
});

// ── board.delete (human only) ─────────────────────────────────

const deleteShape = {
  id: z.unknown().optional().describe('Board id'),
};
const deleteSchema = z.looseObject(deleteShape);

const boardDeleteOperation = defineOperation<z.infer<typeof deleteSchema>, Record<string, unknown>>({
  name: 'board.delete',
  mutates: false,
  input: deleteSchema,
  inputShape: deleteShape,
  http: { method: 'DELETE', path: '/api/canvas/boards/:id' },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    // Deleting the open board returns to Home through the same path as opening it.
    if (id === canvasState.activeBoardId) openCanvasBoard(null);
    if (!canvasState.deleteBoard(id)) throw new OperationError(`Board "${id}" not found.`, 404);
    emitBoardsChanged(ctx);
    return { ok: true, ...boardsPayload() };
  },
});

export const boardOperations: Operation[] = [
  boardListOperation,
  boardOpenOperation,
  boardGetOperation,
  boardCreateOperation,
  boardCreateFromOperation,
  boardUpdateOperation,
  boardDeleteOperation,
];
