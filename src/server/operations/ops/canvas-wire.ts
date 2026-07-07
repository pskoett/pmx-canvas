/**
 * Canvas wire ops (plan-009 C1 slice 3): theme.get / theme.set /
 * canvas.apply-updates — the remaining simple browser-client routes
 * (GET+POST /api/canvas/theme, POST /api/canvas/update), wire-identical to
 * the legacy server.ts handlers they replace. HTTP-only: no MCP tools.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { normalizeCanvasTheme } from '../../canvas-db.js';
import { applyCanvasNodeUpdates } from '../../canvas-operations.js';
import { canvasState } from '../../canvas-state.js';
import { defineOperation, type Operation } from '../types.js';

const emptyShape = {};
const emptySchema = z.looseObject(emptyShape);

const themeGetOperation = defineOperation<z.infer<typeof emptySchema>, Record<string, unknown>>({
  name: 'theme.get',
  mutates: false,
  input: emptySchema,
  inputShape: emptyShape,
  http: {
    method: 'GET',
    path: '/api/canvas/theme',
  },
  handler: () => ({ ok: true, theme: canvasState.theme }),
});

const themeSetShape = {
  theme: z.unknown().optional().describe('Theme: dark, light, or high-contrast'),
};
const themeSetSchema = z.looseObject(themeSetShape);

const themeSetOperation = defineOperation<z.infer<typeof themeSetSchema>, Record<string, unknown>>({
  name: 'theme.set',
  mutates: false,
  input: themeSetSchema,
  inputShape: themeSetShape,
  http: {
    method: 'POST',
    path: '/api/canvas/theme',
  },
  handler: (input, ctx) => {
    const theme = normalizeCanvasTheme(input.theme, canvasState.theme);
    const next = canvasState.setTheme(theme);
    ctx.emit('theme-changed', { theme: next });
    return { ok: true, theme: next };
  },
});

const applyUpdatesShape = {
  updates: z.unknown().optional().describe('Array of node updates: { id, position?, size?, … }'),
  recordHistory: z.unknown().optional().describe('Pass false to skip the undo-history entries'),
};
const applyUpdatesSchema = z.looseObject(applyUpdatesShape);

const applyUpdatesOperation = defineOperation<z.infer<typeof applyUpdatesSchema>, Record<string, unknown>>({
  name: 'canvas.apply-updates',
  mutates: false,
  input: applyUpdatesSchema,
  inputShape: applyUpdatesShape,
  http: {
    method: 'POST',
    path: '/api/canvas/update',
  },
  // Legacy wire: one layout update only when something actually applied.
  handler: (input, ctx) => {
    const body: Record<string, unknown> = input;
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const result =
      body.recordHistory === false
        ? (() => {
            let suppressedResult: ReturnType<typeof applyCanvasNodeUpdates> = {
              applied: 0,
              skipped: updates.length,
            };
            canvasState.withSuppressedRecording(() => {
              suppressedResult = applyCanvasNodeUpdates(updates);
            });
            return suppressedResult;
          })()
        : applyCanvasNodeUpdates(updates);
    if (result.applied > 0) {
      ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
    }
    return { ok: true, ...result };
  },
});

export const canvasWireOperations: Operation[] = [themeGetOperation, themeSetOperation, applyUpdatesOperation];
