/**
 * Slice 2 operations (plan-005): arrange / node.focus / view.fit /
 * canvas.clear.
 *
 * Event notes (matching the legacy handlers exactly):
 * - arrange: arrangeCanvasNodes records its own compound history entry; the
 *   registry emits the single canvas-layout-update (mutates: true).
 * - node.focus: emits ax-state-changed, canvas-focus-node, and (when panning)
 *   canvas-viewport-update via ctx.emit; the registry appends the final
 *   canvas-layout-update.
 * - view.fit: mutates: false with a manual canvas-viewport-update emit.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { arrangeCanvasNodes, clearCanvas, fitCanvasView } from '../../canvas-operations.js';
import { validateCanvasLayout } from '../../canvas-validation.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { closeNodeAppSession, isRecord } from './nodes.js';

// ── arrange ───────────────────────────────────────────────────

const arrangeShape = {
  layout: z.unknown().optional().describe('Arrangement layout: grid (default), column, or flow'),
};

const arrangeSchema = z.looseObject(arrangeShape);

const arrangeOperation = defineOperation<z.infer<typeof arrangeSchema>, Record<string, unknown>>({
  name: 'arrange',
  mutates: true,
  input: arrangeSchema,
  inputShape: arrangeShape,
  http: {
    method: 'POST',
    path: '/api/canvas/arrange',
  },
  mcp: {
    toolName: 'canvas_arrange',
    description:
      'Auto-arrange all nodes on the canvas. Layouts: grid (default), column (vertical stack), flow (horizontal row).',
    extraShape: {
      layout: z.enum(['grid', 'column', 'flow']).optional().describe('Arrangement layout (default: grid)'),
    },
    // Legacy tool reported { ok: true, layout } regardless of the arrange
    // result (it ignored the arranged count and validation outcome).
    formatResult: (result, input) => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ ok: true, layout: typeof input.layout === 'string' ? input.layout : 'grid' }),
        },
      ],
    }),
  },
  handler: (input) => {
    const layout = typeof input.layout === 'string' ? input.layout : 'grid';
    if (!['grid', 'column', 'flow'].includes(layout)) {
      throw new OperationError(`Invalid layout: "${layout}". Use: grid, column, flow`);
    }
    // arrangeCanvasNodes records its own single compound history entry —
    // nothing else here may record (no double-record).
    const result = arrangeCanvasNodes(layout as 'grid' | 'column' | 'flow');
    const validation = validateCanvasLayout(canvasState.getLayout());
    return {
      ok: validation.ok,
      arranged: result.arranged,
      layout: result.layout,
      ...(validation.ok ? {} : { validation, collisions: validation.summary.collisions }),
    };
  },
});

// ── node.focus ────────────────────────────────────────────────

const focusShape = {
  id: z.unknown().optional().describe('Node ID to focus on'),
  noPan: z.unknown().optional().describe('If true, raise/select the node without panning the viewport. Default false.'),
};

const focusSchema = z.looseObject(focusShape);

const focusOperation = defineOperation<z.infer<typeof focusSchema>, Record<string, unknown>>({
  name: 'node.focus',
  mutates: true,
  input: focusSchema,
  inputShape: focusShape,
  http: {
    method: 'POST',
    path: '/api/canvas/focus',
  },
  mcp: {
    toolName: 'canvas_focus_node',
    description:
      "Bring a node into focus. By default the viewport pans so the node is centered. Pass noPan=true to raise/select the node without moving the human's camera (useful when reacting to background events without disrupting the human's current view).",
    extraShape: {
      id: z.string().describe('Node ID to focus on'),
      noPan: z
        .boolean()
        .optional()
        .describe('If true, raise/select the node without panning the viewport. Default false.'),
    },
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ ok: true, focused: body.focused, panned: body.panned }),
          },
        ],
      };
    },
  },
  handler: (input, ctx) => {
    const body: Record<string, unknown> = input;
    const nodeId = typeof body.id === 'string' ? body.id : '';
    if (!nodeId) throw new OperationError('Missing id.');
    const node = canvasState.getNode(nodeId);
    if (!node) throw new OperationError(`Node "${nodeId}" not found.`, 404);
    const noPan = body.noPan === true;
    if (!noPan) {
      canvasState.setViewport({ x: node.position.x - 100, y: node.position.y - 100 });
    } else {
      const maxZ = canvasState.getLayout().nodes.reduce((max, layoutNode) => Math.max(max, layoutNode.zIndex), 0);
      canvasState.updateNode(nodeId, { zIndex: maxZ + 1 });
    }
    const focus = canvasState.setAxFocus([nodeId], { source: 'api', recordHistory: false });
    ctx.emit('ax-state-changed', { focus });
    ctx.emit('canvas-focus-node', { nodeId, noPan });
    if (!noPan) ctx.emit('canvas-viewport-update', { viewport: canvasState.viewport });
    return { ok: true, focused: nodeId, panned: !noPan, axFocus: focus };
  },
});

// ── view.fit ──────────────────────────────────────────────────

const fitShape = {
  width: z.number().optional().catch(undefined).describe('Viewport width used for fit math (default 1440)'),
  height: z.number().optional().catch(undefined).describe('Viewport height used for fit math (default 900)'),
  padding: z.number().optional().catch(undefined).describe('World-space padding around fitted nodes (default 60)'),
  maxScale: z.number().optional().catch(undefined).describe('Maximum zoom scale (default 1)'),
  nodeIds: z.unknown().optional().describe('Optional node IDs to fit instead of the whole canvas'),
};

const fitSchema = z.looseObject(fitShape);

const fitOperation = defineOperation<z.infer<typeof fitSchema>, Record<string, unknown>>({
  name: 'view.fit',
  mutates: false,
  input: fitSchema,
  inputShape: fitShape,
  http: {
    method: 'POST',
    path: '/api/canvas/fit',
  },
  mcp: {
    toolName: 'canvas_fit_view',
    description:
      'Fit the canvas viewport to all nodes or a selected subset. Useful before screenshots and whole-board review.',
    extraShape: {
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs to fit instead of the whole canvas'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: (input, ctx) => {
    const body: Record<string, unknown> = input;
    const nodeIds = Array.isArray(body.nodeIds)
      ? body.nodeIds.filter((id): id is string => typeof id === 'string')
      : undefined;
    const result = fitCanvasView({
      ...(typeof body.width === 'number' ? { width: body.width } : {}),
      ...(typeof body.height === 'number' ? { height: body.height } : {}),
      ...(typeof body.padding === 'number' ? { padding: body.padding } : {}),
      ...(typeof body.maxScale === 'number' ? { maxScale: body.maxScale } : {}),
      ...(nodeIds ? { nodeIds } : {}),
    });
    ctx.emit('canvas-viewport-update', { viewport: result.viewport });
    return result as unknown as Record<string, unknown>;
  },
});

// ── canvas.clear ──────────────────────────────────────────────

const clearShape = {};

const clearSchema = z.looseObject(clearShape);

const clearOperation = defineOperation<z.infer<typeof clearSchema>, Record<string, unknown>>({
  name: 'canvas.clear',
  mutates: true,
  input: clearSchema,
  inputShape: clearShape,
  http: {
    method: 'POST',
    path: '/api/canvas/clear',
  },
  mcp: {
    toolName: 'canvas_clear',
    description: 'Remove all nodes and edges from the canvas. Use with caution.',
    formatResult: () => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, cleared: true }) }],
    }),
  },
  handler: () => {
    for (const node of canvasState.getLayout().nodes) {
      closeNodeAppSession(node);
    }
    clearCanvas();
    return { ok: true };
  },
});

export const viewportOperations: Operation[] = [arrangeOperation, focusOperation, fitOperation, clearOperation];
