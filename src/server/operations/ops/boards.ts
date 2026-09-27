/**
 * Many boards (plan 012): board.list / board.get / board.create /
 * board.update / board.open / board.delete.
 *
 * Agents list, read and create boards. Opening, switching and deleting are the
 * human's (HUMAN_ONLY_OPS in registry.ts): an agent that wants another board
 * asks. Every change broadcasts `boards-changed` with the full list.
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
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';

export function boardsPayload(): Record<string, unknown> {
  return { activeBoardId: canvasState.activeBoardId, boards: canvasState.listBoards() };
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
      'Create a new empty board. It is NOT opened: only the human opens boards, so ask them to open it before writing to it.',
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

// ── board.open (human only) ───────────────────────────────────

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
      'Rename a board or move it into a nested folder on Home (e.g. Engineering/Canvas; category "" unfiles it). Moving preserves the board ID and content.',
    extraShape: {
      id: z.string().describe('Board id'),
      name: z.string().optional().describe('New name'),
      category: z.string().optional().describe('Folder path, up to 8 levels of 1–60 characters; "" unfiles it'),
    },
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    const patch = {
      ...(input.name !== undefined ? { name: boardName(input.name) } : {}),
      ...(input.category !== undefined ? { category: boardCategory(input.category) ?? null } : {}),
    };
    if (!canvasState.updateBoard(id, patch)) {
      throw new OperationError(`Board "${id}" not found.`, 404);
    }
    emitBoardsChanged(ctx);
    return { ok: true, ...boardsPayload() };
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
  boardUpdateOperation,
  boardDeleteOperation,
];
