/**
 * Slice 2 operations (plan-005): group.create / group.add / group.remove
 * (ungroup). Names match the canvas_batch op names.
 *
 * Note: the legacy POST /api/canvas/group handler only rejected MISSING child
 * IDs (lowercase "missing child node ID…" message) — unlike the node.add
 * group branch, it does not reject group-typed children. Replicated as-is.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState, type CanvasNodeState } from '../../canvas-state.js';
import { createCanvasGroup, groupCanvasNodes, ungroupCanvasNodes } from '../../canvas-operations.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { buildNodeResponse, createdNodePayloadFromNode, isRecord } from './nodes.js';

function pickChildLayout(value: unknown): 'grid' | 'column' | 'flow' | undefined {
  return value === 'grid' || value === 'column' || value === 'flow' ? value : undefined;
}

// ── group.create ──────────────────────────────────────────────

const groupCreateShape = {
  intentId: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  title: z.string().optional().catch(undefined).describe('Group title (default: "Group")'),
  childIds: z.unknown().optional().describe('Node IDs to include in the group. Group auto-sizes to fit them.'),
  color: z.string().optional().catch(undefined).describe('Group accent color (CSS color string, e.g. "#4a9eff")'),
  x: z.number().optional().catch(undefined).describe('X position (auto-computed from children if omitted)'),
  y: z.number().optional().catch(undefined).describe('Y position (auto-computed from children if omitted)'),
  width: z.number().optional().catch(undefined).describe('Width (auto-computed from children if omitted)'),
  height: z.number().optional().catch(undefined).describe('Height (auto-computed from children if omitted)'),
  childLayout: z
    .enum(['grid', 'column', 'flow'])
    .optional()
    .catch(undefined)
    .describe('Optional child auto-layout. Omit to preserve current child positions.'),
};

const groupCreateSchema = z.looseObject(groupCreateShape);

const groupCreateOperation = defineOperation<z.infer<typeof groupCreateSchema>, CanvasNodeState>({
  name: 'group.create',
  mutates: true,
  input: groupCreateSchema,
  inputShape: groupCreateShape,
  http: {
    method: 'POST',
    path: '/api/canvas/group',
  },
  mcp: {
    toolName: 'canvas_create_group',
    description:
      'Create a group (frame) on the canvas that visually contains other nodes. Groups are spatial containers — they communicate "these nodes belong together." If childIds are provided, grouping preserves child positions by default; pass childLayout to auto-pack them. You can also provide an explicit frame (x/y/width/height) and auto-arrange children inside it.',
    extraShape: {
      childIds: z
        .array(z.string())
        .optional()
        .describe('Node IDs to include in the group. Group auto-sizes to fit them.'),
      full: z
        .boolean()
        .optional()
        .describe('Return the full created group payload. Default false returns compact metadata.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    formatResult: (result, input) => {
      const body = isRecord(result) ? result : {};
      const node = body.node as CanvasNodeState | undefined;
      const payload = node ? createdNodePayloadFromNode(node, input) : { ok: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const title = typeof body.title === 'string' ? body.title : 'Group';
    const childIds = Array.isArray(body.childIds)
      ? body.childIds.filter((id): id is string => typeof id === 'string')
      : [];
    const color = typeof body.color === 'string' ? body.color : undefined;
    const x = typeof body.x === 'number' ? body.x : undefined;
    const y = typeof body.y === 'number' ? body.y : undefined;
    const width = typeof body.width === 'number' ? body.width : undefined;
    const height = typeof body.height === 'number' ? body.height : undefined;
    const childLayout = pickChildLayout(body.childLayout);
    if (childIds.length > 0) {
      const missingChildIds = childIds.filter((id) => !canvasState.getNode(id));
      if (missingChildIds.length > 0) {
        throw new OperationError(
          `Cannot create group: missing child node ID${missingChildIds.length === 1 ? '' : 's'}: ${missingChildIds.join(', ')}.`,
        );
      }
    }
    const { node } = createCanvasGroup({
      title,
      childIds,
      color,
      x,
      y,
      width,
      height,
      ...(childLayout ? { childLayout } : {}),
    });
    return node;
  },
  serialize: (node) => buildNodeResponse(node),
});

// ── group.add ─────────────────────────────────────────────────

const groupAddShape = {
  intentId: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  groupId: z.string().optional().catch(undefined).describe('The group node ID'),
  childIds: z.unknown().optional().describe('Node IDs to add to the group'),
  childLayout: z
    .enum(['grid', 'column', 'flow'])
    .optional()
    .catch(undefined)
    .describe('Optional child layout to apply while grouping'),
};

const groupAddSchema = z.looseObject(groupAddShape);

const groupAddOperation = defineOperation<z.infer<typeof groupAddSchema>, Record<string, unknown>>({
  name: 'group.add',
  mutates: true,
  input: groupAddSchema,
  inputShape: groupAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/group/add',
  },
  mcp: {
    toolName: 'canvas_group_nodes',
    description: 'Add nodes to an existing group. The nodes will be visually contained within the group frame.',
    extraShape: {
      groupId: z.string().describe('The group node ID'),
      childIds: z.array(z.string()).describe('Node IDs to add to the group'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const groupId = typeof body.groupId === 'string' ? body.groupId : '';
    const childIds = Array.isArray(body.childIds)
      ? body.childIds.filter((id): id is string => typeof id === 'string')
      : [];
    const childLayout = pickChildLayout(body.childLayout);
    if (!groupId || childIds.length === 0) {
      throw new OperationError('Missing groupId or childIds.');
    }
    const { ok } = groupCanvasNodes(groupId, childIds, childLayout ? { childLayout } : {});
    if (!ok) throw new OperationError('Group not found or no valid children.');
    return { ok: true, groupId };
  },
});

// ── group.remove (ungroup) ────────────────────────────────────

const groupRemoveShape = {
  intentId: z
    .string()
    .optional()
    .catch(undefined)
    .describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  groupId: z.string().optional().catch(undefined).describe('The group node ID to ungroup'),
};

const groupRemoveSchema = z.looseObject(groupRemoveShape);

const groupRemoveOperation = defineOperation<z.infer<typeof groupRemoveSchema>, Record<string, unknown>>({
  name: 'group.remove',
  mutates: true,
  input: groupRemoveSchema,
  inputShape: groupRemoveShape,
  http: {
    method: 'POST',
    path: '/api/canvas/group/ungroup',
  },
  mcp: {
    toolName: 'canvas_ungroup',
    description:
      'Remove all children from a group, releasing them as independent nodes. The group node itself remains (delete it separately with canvas_remove_node if desired).',
    extraShape: {
      groupId: z.string().describe('The group node ID to ungroup'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: (input) => {
    const groupId = typeof input.groupId === 'string' ? input.groupId : '';
    if (!groupId) throw new OperationError('Missing groupId.');
    const { ok } = ungroupCanvasNodes(groupId);
    if (!ok) throw new OperationError('Group not found or empty.');
    return { ok: true, groupId };
  },
});

export const groupOperations: Operation[] = [groupCreateOperation, groupAddOperation, groupRemoveOperation];
