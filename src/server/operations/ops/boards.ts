/**
 * Many boards (plan 012): board.list / board.get / board.create /
 * board.rename / board.open / board.delete.
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
import { canvasState } from '../../canvas-state.js';
import { openCanvasBoard } from '../../canvas-operations.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';

export function boardsPayload(): Record<string, unknown> {
  return { activeBoardId: canvasState.activeBoardId, boards: canvasState.listBoards() };
}

function emitBoardsChanged(ctx: OperationContext): void {
  ctx.emit('boards-changed', boardsPayload());
}

const jsonResult = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
});

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
    extraShape: { name: z.string().describe('Board name') },
    formatResult: jsonResult,
  },
  handler: (input, ctx) => {
    const board = canvasState.createBoard(boardName(input.name));
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

// ── board.rename ──────────────────────────────────────────────

const renameShape = {
  id: z.unknown().optional().describe('Board id'),
  name: z.unknown().optional().describe('New name'),
};
const renameSchema = z.looseObject(renameShape);

const boardRenameOperation = defineOperation<z.infer<typeof renameSchema>, Record<string, unknown>>({
  name: 'board.rename',
  mutates: false,
  input: renameSchema,
  inputShape: renameShape,
  http: { method: 'PATCH', path: '/api/canvas/boards/:id' },
  handler: (input, ctx) => {
    const id = typeof input.id === 'string' ? input.id : '';
    if (!canvasState.renameBoard(id, boardName(input.name))) {
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
  boardRenameOperation,
  boardDeleteOperation,
];
