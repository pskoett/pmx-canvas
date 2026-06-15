/**
 * Annotation mutation op (plan-008 Wave 1): annotation.remove.
 *
 * DELETE-by-id of a human-drawn canvas annotation. mutates: true → the registry
 * auto-emits one canvas-layout-update after success, matching the legacy
 * handleCanvasRemoveAnnotation handler (which emitted the layout update only on a
 * successful removal). A missing id is a 404 OperationError carrying the EXACT
 * legacy message; HTTP renders it as { ok:false, error } (byte-identical to the
 * legacy handler) and MCP renders it as an isError tool result with the bare
 * message text (byte-identical to the legacy canvas_remove_annotation tool).
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { defineOperation, OperationError, type Operation } from '../types.js';

const annotationRemoveShape = {
  id: z.string().optional().catch(undefined).describe('Annotation ID to remove'),
};

const annotationRemoveSchema = z.looseObject(annotationRemoveShape);

const annotationRemoveOperation = defineOperation<z.infer<typeof annotationRemoveSchema>, Record<string, unknown>>({
  name: 'annotation.remove',
  mutates: true,
  input: annotationRemoveSchema,
  inputShape: annotationRemoveShape,
  http: {
    method: 'DELETE',
    path: '/api/canvas/annotation/:id',
  },
  mcp: {
    toolName: 'canvas_remove_annotation',
    description: 'Remove a human-drawn canvas annotation by ID.',
    extraShape: {
      id: z.string().describe('Annotation ID to remove'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: ({ id }) => {
    const annotationId = id ?? '';
    // A missing id is a 400, not a misleading 404 — matches edge.remove. The
    // canvas_view composite widens `id` to optional (node.focus also contributes
    // it), so the schema does not reject an absent id at the MCP boundary; guard
    // here so `{ action: "remove-annotation" }` with no id fails loudly.
    if (!annotationId) {
      throw new OperationError('Missing id.', 400);
    }
    const removed = canvasState.removeAnnotation(annotationId);
    if (!removed) {
      throw new OperationError(`Annotation "${annotationId}" not found.`, 404);
    }
    return { ok: true, removed: annotationId };
  },
});

export const annotationOperations: Operation[] = [annotationRemoveOperation];
