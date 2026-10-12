import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { categorySchema, lifecycleSchema, type Lifecycle } from '../../knowledge-lifecycle.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { readTargetBoard } from './boards.js';
import { lifecycleQualifications } from '../../lifecycle-status.js';
import { memoryKey } from '../../../shared/memory-graph.js';
import { folderAncestors } from '../../../shared/boards.js';

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
    handler: () => {
      const catalog = canvasState.knowledge.list();
      const paths = new Set([
        ...catalog.folders.flatMap((folder) => folderAncestors(folder.path)),
        ...canvasState.listBoards().flatMap((board) => (board.folder ? folderAncestors(board.folder) : [])),
      ]);
      return {
        ok: true,
        ...catalog,
        cards: lifecycleQualifications(),
        resolvedFolders: Object.fromEntries(
          [...paths].map((path) => [path, canvasState.knowledge.resolve(path, null, catalog)]),
        ),
      };
    },
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
    name: 'knowledge.category-remove',
    mutates: false,
    input: z.object({ id: z.string().trim().min(1) }),
    inputShape: { id: z.string().trim().min(1) },
    http: { method: 'DELETE', path: '/api/canvas/knowledge/category/:id' },
    mcp: {
      toolName: 'canvas_knowledge_category_remove',
      description:
        'Delete an unused workspace category by id. Explicit folder assignments, including empty folders, refuse deletion.',
      formatResult: jsonResult,
    },
    handler: (input, ctx) => {
      const id = canvasState.knowledge.removeCategory(input.id);
      ctx.emit('knowledge-changed', canvasState.knowledge.list());
      return { ok: true, id };
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
        qualification: lifecycleQualifications(Date.now(), [{ boardId: read.boardId, cardId: input.id }])[
          memoryKey({ boardId: read.boardId, cardId: input.id })
        ],
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
      expectedSources: z.record(z.string(), z.number().int().nonnegative().nullable()).optional(),
    }),
    inputShape: {
      ...target,
      outcome: z.enum(['retain', 'revise', 'externalize', 'retire', 'unresolved']),
      evidence: z.string(),
      applied: z.boolean(),
      expectedSources: z
        .record(z.string(), z.number().int().nonnegative().nullable())
        .optional()
        .describe('Required when validating dependencies: observations from lifecycle-get after checking the sources.'),
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
      const observations =
        lifecycleQualifications()[memoryKey({ boardId: canvasState.activeBoardId, cardId: input.id })]?.observations ??
        {};
      const validates =
        input.applied && input.evidence.trim() && ['retain', 'revise', 'externalize'].includes(input.outcome);
      if (validates) {
        const expected = input.expectedSources ?? {};
        if (
          Object.keys(expected).length !== Object.keys(observations).length ||
          Object.entries(observations).some(([key, revision]) => revision === null || expected[key] !== revision)
        )
          throw new OperationError(
            'Sources changed or are unavailable. Check the current sources and pass expectedSources from lifecycle-get.',
            409,
          );
      }
      const record = canvasState.knowledge.record(canvasState.activeBoardId, input.id, input, observations);
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
