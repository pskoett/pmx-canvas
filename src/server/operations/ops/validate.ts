/**
 * Board validation read op (plan-008 Wave 1): validate.get.
 *
 * Pure read — no mutation, no emit. Serializes the same shape the legacy
 * GET /api/canvas/validate handler and the canvas_validate MCP tool returned.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { validateCanvasLayout, type CanvasValidationResult } from '../../canvas-validation.js';
import { defineOperation, type Operation } from '../types.js';

const validateGetShape = {};

const validateGetSchema = z.looseObject(validateGetShape);

const validateGetOperation = defineOperation<z.infer<typeof validateGetSchema>, CanvasValidationResult>({
  name: 'validate.get',
  mutates: false,
  input: validateGetSchema,
  inputShape: validateGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/validate',
  },
  mcp: {
    toolName: 'canvas_validate',
    description:
      'Validate the current canvas layout. Distinguishes true node collisions from expected group-child containment and reports missing edge endpoints.',
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: () => validateCanvasLayout(canvasState.getLayout()),
});

export const validateOperations: Operation[] = [validateGetOperation];
