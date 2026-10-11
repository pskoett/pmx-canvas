import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { categorySchema, lifecycleSchema, type Lifecycle } from '../../knowledge-lifecycle.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { readTargetBoard } from './boards.js';

const jsonResult = (result: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
});
const target = { id: z.string().min(1), expectedBoardId: z.string().nullable().optional() };

export const lifecycleOperations: Operation[] = [
  defineOperation({
    name: 'knowledge.list',
    mutates: false,
    input: z.object({}),
    inputShape: {},
    http: { method: 'GET', path: '/api/canvas/knowledge' },
    mcp: {
      toolName: 'canvas_knowledge_list',
      description: 'Read workspace categories and folder properties. No inferred defaults.',
      formatResult: jsonResult,
    },
    handler: () => ({ ok: true, ...canvasState.knowledge.list() }),
  }),
  defineOperation({
    name: 'knowledge.category-set',
    mutates: false,
    input: z.object({ category: categorySchema }),
    inputShape: { category: categorySchema },
    http: { method: 'POST', path: '/api/canvas/knowledge/category' },
    mcp: {
      toolName: 'canvas_knowledge_category_set',
      description: 'Create or replace one workspace category by stable id.',
      formatResult: jsonResult,
    },
    handler: (input, ctx) => {
      const category = canvasState.knowledge.setCategory(input.category);
      ctx.emit('knowledge-changed', canvasState.knowledge.list());
      return { ok: true, category };
    },
  }),
  defineOperation({
    name: 'knowledge.folder-set',
    mutates: false,
    input: z.object({
      path: z.string(),
      categoryId: z.string().nullable(),
      lifecycleOverride: lifecycleSchema.nullable(),
    }),
    inputShape: { path: z.string(), categoryId: z.string().nullable(), lifecycleOverride: lifecycleSchema.nullable() },
    http: { method: 'POST', path: '/api/canvas/knowledge/folder' },
    mcp: {
      toolName: 'canvas_knowledge_folder_set',
      description: 'Replace canonical folder properties. Null category inherits; null lifecycle clears the override.',
      formatResult: jsonResult,
    },
    handler: (input, ctx) => {
      try {
        const folder = canvasState.knowledge.setFolder(input);
        ctx.emit('knowledge-changed', canvasState.knowledge.list());
        return { ok: true, folder };
      } catch (error) {
        throw new OperationError(String(error));
      }
    },
  }),
  defineOperation({
    name: 'node.lifecycle-get',
    mutates: false,
    input: z.object({ id: z.string(), board: z.string().optional() }),
    inputShape: { id: z.string(), board: z.string().optional() },
    http: { method: 'GET', path: '/api/canvas/node/:id/lifecycle' },
    mcp: {
      toolName: 'canvas_node_lifecycle_get',
      description:
        'Read effective category/lifecycle, source folder and audited review history without opening a board.',
      formatResult: jsonResult,
    },
    handler: (input) => {
      const read = readTargetBoard(input.board);
      const node = read.layout.nodes.find((n) => n.id === input.id);
      if (!read.boardId || !node) throw new OperationError('Card not found.', 404);
      const folder = canvasState.listBoards().find((b) => b.id === read.boardId)?.folder ?? null;
      return {
        ok: true,
        boardId: read.boardId,
        nodeId: input.id,
        contentRevision: node.contentRevision ?? 0,
        ...canvasState.knowledge.resolve(folder, node.data.lifecycleOverride as Lifecycle | null),
        ...canvasState.knowledge.reviews(read.boardId, input.id),
      };
    },
  }),
  defineOperation({
    name: 'node.lifecycle-set',
    mutates: true,
    input: z.object({ ...target, lifecycleOverride: lifecycleSchema.nullable() }),
    inputShape: { ...target, lifecycleOverride: lifecycleSchema.nullable() },
    http: { method: 'POST', path: '/api/canvas/node/:id/lifecycle' },
    mcp: {
      toolName: 'canvas_node_lifecycle_set',
      description:
        'Set a full card lifecycle override, or null to inherit. Never changes category or semantic content revision.',
      formatResult: jsonResult,
    },
    handler: (input) => {
      canvasState.setNodeLifecycle(input.id, input.lifecycleOverride);
      return { ok: true };
    },
  }),
  defineOperation({
    name: 'node.review',
    mutates: true,
    input: z.object({
      ...target,
      outcome: z.enum(['retain', 'revise', 'externalize', 'retire', 'unresolved']),
      evidence: z.string(),
      applied: z.boolean(),
      expectedContentRevision: z.number().int().nonnegative().optional(),
    }),
    inputShape: {
      ...target,
      outcome: z.enum(['retain', 'revise', 'externalize', 'retire', 'unresolved']),
      evidence: z.string(),
      applied: z.boolean(),
      expectedContentRevision: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Required for evidence-backed validating outcomes; use the revision of the content you checked.'),
    },
    http: { method: 'POST', path: '/api/canvas/node/:id/review' },
    mcp: {
      toolName: 'canvas_node_review',
      description:
        'Audit an outcome. Applied retain/revise/externalize with nonempty evidence and matching expectedContentRevision renew validation. Reviewed content is persisted before evidence. Does not edit content or restore retirement.',
      formatResult: jsonResult,
    },
    handler: (input, ctx) => {
      if (!canvasState.getNode(input.id) || !canvasState.activeBoardId)
        throw new OperationError('Card not found.', 404);
      const record = canvasState.knowledge.record(canvasState.activeBoardId, input.id, input);
      ctx.emit('lifecycle-changed', { boardId: canvasState.activeBoardId, nodeId: input.id });
      return { ok: true, record };
    },
  }),
  defineOperation({
    name: 'node.lifecycle-restore',
    mutates: true,
    input: z.object({ ...target, evidence: z.string() }),
    inputShape: { ...target, evidence: z.string() },
    http: { method: 'POST', path: '/api/canvas/node/:id/lifecycle/restore' },
    mcp: {
      toolName: 'canvas_node_lifecycle_restore',
      description: 'Explicitly reverse retirement and audit the restoration. Never validates.',
      formatResult: jsonResult,
    },
    handler: (input, ctx) => {
      if (!canvasState.getNode(input.id) || !canvasState.activeBoardId)
        throw new OperationError('Card not found.', 404);
      const record = canvasState.knowledge.record(canvasState.activeBoardId, input.id, {
        outcome: 'restore',
        evidence: input.evidence,
        applied: true,
      });
      ctx.emit('lifecycle-changed', { boardId: canvasState.activeBoardId, nodeId: input.id });
      return { ok: true, record };
    },
  }),
];
