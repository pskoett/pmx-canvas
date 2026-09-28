/**
 * Static board export (plan 013): export.preview / export.run. HTTP, CLI and
 * SDK — sharing is the human's act, so there is no MCP surface. The written
 * file is served by GET /api/canvas/exports/:name (server.ts).
 *
 * This module must never import server.ts or index.ts.
 */
import { basename } from 'node:path';
import { z } from 'zod';
import { buildBoardExport, previewBoardExport, writeBoardExport } from '../../board-export.js';
import { canvasState } from '../../canvas-state.js';
import { defineOperation, OperationError, type Operation } from '../types.js';

const shape = {
  board: z.unknown().optional().describe('Board id (default: the open board)'),
  includeFiles: z.unknown().optional().describe('Include the contents of file cards (default: false)'),
  includeDerivedText: z
    .unknown()
    .optional()
    .describe('Include imported document text (default: false; originals remain excluded)'),
};
const schema = z.looseObject(shape);

function target(input: z.infer<typeof schema>): { boardId: string; includeFiles: boolean } {
  const boardId =
    typeof input.board === 'string' && input.board.trim() ? input.board.trim() : canvasState.activeBoardId;
  if (!boardId) throw new OperationError('No board is open. Open one, or pass board.', 409);
  return { boardId, includeFiles: input.includeFiles === true || input.includeFiles === 'true' };
}

const exportPreviewOperation = defineOperation<z.infer<typeof schema>, Record<string, unknown>>({
  name: 'export.preview',
  mutates: false,
  input: schema,
  inputShape: shape,
  http: { method: 'GET', path: '/api/canvas/export/preview' },
  handler: async (input) => {
    const { boardId, includeFiles } = target(input);
    const manifest = await previewBoardExport(
      boardId,
      includeFiles,
      input.includeDerivedText === true || input.includeDerivedText === 'true',
    );
    if (!manifest) throw new OperationError(`Board "${boardId}" not found.`, 404);
    return { ok: true, manifest };
  },
});

const exportRunOperation = defineOperation<z.infer<typeof schema>, Record<string, unknown>>({
  name: 'export.run',
  mutates: false,
  input: schema,
  inputShape: shape,
  http: { method: 'POST', path: '/api/canvas/export' },
  handler: async (input) => {
    const { boardId, includeFiles } = target(input);
    const built = await buildBoardExport(
      boardId,
      includeFiles,
      input.includeDerivedText === true || input.includeDerivedText === 'true',
    );
    if (!built) throw new OperationError(`Board "${boardId}" not found.`, 404);
    const path = writeBoardExport(built.html, built.manifest.boardName);
    return {
      ok: true,
      path,
      url: `/api/canvas/exports/${encodeURIComponent(basename(path))}`,
      bytes: Buffer.byteLength(built.html),
      manifest: built.manifest,
    };
  },
});

export const exportOperations: Operation[] = [exportPreviewOperation, exportRunOperation];
