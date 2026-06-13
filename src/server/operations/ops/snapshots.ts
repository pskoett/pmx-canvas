/**
 * Slice 3 operations (plan-005, migration item 5): snapshot.list /
 * snapshot.save / snapshot.gc / snapshot.diff (+ query-param variant) /
 * snapshot.restore / snapshot.delete.
 *
 * Wire notes:
 * - snapshot.list serves the bare-array body (tests/e2e clearSnapshots reads
 *   GET /api/canvas/snapshots?all=true and expects an array, not an envelope).
 * - snapshot.restore relies on the DEFERRED canvas-layout-update that
 *   restoreCanvasSnapshot itself schedules via setCanvasLayoutUpdateEmitter
 *   once async ext-app rehydration finishes. The handler must not emit that
 *   frame; `mutates: true` produces only the single immediate frame the legacy
 *   route broadcast.
 * - Legacy save/restore/delete error responses were plain-text
 *   (responseText); they are now the registry's JSON `{ ok:false, error }`
 *   envelope (save's unreachable disk-failure case also moves 500 → 400).
 *
 * Route-order note: snapshot.gc (POST /api/canvas/snapshots/gc) MUST be
 * registered before snapshot.restore (POST /api/canvas/snapshots/:id) — the
 * dispatcher checks routes in registration order and ':id' would otherwise
 * swallow the literal 'gc' segment, exactly like the legacy if-chain ordering.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import {
  deleteCanvasSnapshot,
  gcCanvasSnapshots,
  listCanvasSnapshots,
  restoreCanvasSnapshot,
  saveCanvasSnapshot,
} from '../../canvas-operations.js';
import { diffLayouts, formatDiff } from '../../mutation-history.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import { isRecord } from './nodes.js';

/** Legacy server.ts parsePositiveIntegerParam, tolerant of in-process numbers. */
function parsePositiveIntegerParam(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value);
  if (!text) return undefined;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

// ── snapshot.list ─────────────────────────────────────────────

const snapshotListShape = {
  limit: z.unknown().optional().describe('Maximum snapshots to return (default: 20)'),
  q: z.unknown().optional().describe('Query alias used by the HTTP/CLI surface'),
  query: z.unknown().optional().describe('Optional case-insensitive ID/name filter'),
  before: z.unknown().optional().describe('Only return snapshots created at or before this ISO timestamp'),
  after: z.unknown().optional().describe('Only return snapshots created at or after this ISO timestamp'),
  all: z.unknown().optional().describe('Return all snapshots instead of the default limit'),
};

const snapshotListSchema = z.looseObject(snapshotListShape);

const snapshotListOperation = defineOperation<z.infer<typeof snapshotListSchema>, unknown>({
  name: 'snapshot.list',
  mutates: false,
  input: snapshotListSchema,
  inputShape: snapshotListShape,
  http: {
    method: 'GET',
    path: '/api/canvas/snapshots',
  },
  mcp: {
    toolName: 'canvas_list_snapshots',
    description: 'List saved canvas snapshots with IDs, names, timestamps, and node/edge counts. Defaults to the 20 newest snapshots; pass all=true to return every snapshot.',
    extraShape: {
      limit: z.number().optional().describe('Maximum snapshots to return (default: 20)'),
      query: z.string().optional().describe('Optional case-insensitive ID/name filter'),
      before: z.string().optional().describe('Only return snapshots created at or before this ISO timestamp'),
      after: z.string().optional().describe('Only return snapshots created at or after this ISO timestamp'),
      all: z.boolean().optional().describe('Return all snapshots instead of the default limit'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ snapshots: result }, null, 2) }],
    }),
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    // Legacy precedence: ?q= wins over ?query= even when empty.
    const query = typeof body.q === 'string'
      ? body.q
      : typeof body.query === 'string' ? body.query : undefined;
    const limit = parsePositiveIntegerParam(body.limit);
    return listCanvasSnapshots({
      ...(limit !== undefined ? { limit } : {}),
      ...(query !== undefined ? { query } : {}),
      ...(typeof body.before === 'string' ? { before: body.before } : {}),
      ...(typeof body.after === 'string' ? { after: body.after } : {}),
      all: body.all === true || body.all === 'true',
    });
  },
});

// ── snapshot.save ─────────────────────────────────────────────

const snapshotSaveShape = {
  name: z.unknown().optional().describe('Name for this snapshot (e.g., "before refactor", "investigation v2")'),
};

const snapshotSaveSchema = z.looseObject(snapshotSaveShape);

const snapshotSaveOperation = defineOperation<z.infer<typeof snapshotSaveSchema>, Record<string, unknown>>({
  name: 'snapshot.save',
  mutates: false,
  input: snapshotSaveSchema,
  inputShape: snapshotSaveShape,
  http: {
    method: 'POST',
    path: '/api/canvas/snapshots',
  },
  mcp: {
    toolName: 'canvas_snapshot',
    description: 'Save the current canvas state as a named snapshot. Snapshots persist to disk and can be restored later.',
    extraShape: {
      name: z.string().describe('Name for this snapshot (e.g., "before refactor", "investigation v2")'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: (input) => {
    const name = typeof input.name === 'string' ? input.name.trim() : '';
    if (!name) throw new OperationError('Missing snapshot name');
    const snapshot = saveCanvasSnapshot(name);
    if (!snapshot) throw new OperationError('Failed to save snapshot');
    return { ok: true, id: snapshot.id, snapshot };
  },
});

// ── snapshot.gc ───────────────────────────────────────────────

const snapshotGcShape = {
  keep: z.unknown().optional().describe('Number of newest snapshots to keep (default: 20)'),
  dryRun: z.unknown().optional().describe('Preview deletions without removing snapshot files'),
};

const snapshotGcSchema = z.looseObject(snapshotGcShape);

const snapshotGcOperation = defineOperation<z.infer<typeof snapshotGcSchema>, Record<string, unknown>>({
  name: 'snapshot.gc',
  mutates: false,
  input: snapshotGcSchema,
  inputShape: snapshotGcShape,
  http: {
    method: 'POST',
    path: '/api/canvas/snapshots/gc',
  },
  mcp: {
    toolName: 'canvas_gc_snapshots',
    description: 'Delete old saved canvas snapshots, keeping the newest N snapshots. Use dryRun=true to preview deletions.',
    extraShape: {
      keep: z.number().optional().describe('Number of newest snapshots to keep (default: 20)'),
      dryRun: z.boolean().optional().describe('Preview deletions without removing snapshot files'),
    },
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const keepValue = body.keep;
    // Legacy coercion replicated as-is, including the Number('junk') → NaN
    // pass-through (gcCanvasSnapshots falls back to its own default).
    const keep = typeof keepValue === 'number'
      ? keepValue
      : typeof keepValue === 'string'
        ? Number(keepValue)
        : undefined;
    const dryRun = body.dryRun === true || body['dry-run'] === true;
    return gcCanvasSnapshots({
      ...(keep !== undefined ? { keep } : {}),
      dryRun,
    }) as unknown as Record<string, unknown>;
  },
});

// ── snapshot.diff ─────────────────────────────────────────────

function diffSnapshotCore(idOrName: string): Record<string, unknown> {
  const snapshot = canvasState.getSnapshotData(idOrName);
  if (!snapshot) throw new OperationError(`Snapshot "${idOrName}" not found.`, 404);
  const diff = diffLayouts(snapshot.name, snapshot, canvasState.getLayout());
  return { ok: true, text: formatDiff(diff), diff };
}

const snapshotDiffShape = {
  id: z.string().optional().catch(undefined).describe('Snapshot ID or name to compare against'),
};

const snapshotDiffSchema = z.looseObject(snapshotDiffShape);

const snapshotDiffOperation = defineOperation<z.infer<typeof snapshotDiffSchema>, Record<string, unknown>>({
  name: 'snapshot.diff',
  mutates: false,
  input: snapshotDiffSchema,
  inputShape: snapshotDiffShape,
  http: {
    method: 'GET',
    path: '/api/canvas/snapshots/:id/diff',
  },
  mcp: {
    toolName: 'canvas_diff',
    description: 'Compare the current canvas state against a saved snapshot. Shows added/removed/modified nodes and edges. Pass either a snapshot name or ID.',
    extraShape: {
      snapshot: z.string().describe('Snapshot name or ID to compare against'),
    },
    buildInput: (input) => ({ id: typeof input.snapshot === 'string' ? input.snapshot : '' }),
    // Legacy success output was the human-readable diff text, not JSON.
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [{ type: 'text' as const, text: typeof body.text === 'string' ? body.text : '' }],
      };
    },
  },
  handler: ({ id }) => diffSnapshotCore(id ?? ''),
});

// Query-param variant: GET /api/canvas/snapshots/diff?name=… (HTTP only).
const snapshotDiffQueryShape = {
  name: z.unknown().optional().describe('Snapshot name to compare against'),
  id: z.unknown().optional().describe('Snapshot ID alias for name'),
};

const snapshotDiffQuerySchema = z.looseObject(snapshotDiffQueryShape);

const snapshotDiffQueryOperation = defineOperation<z.infer<typeof snapshotDiffQuerySchema>, Record<string, unknown>>({
  name: 'snapshot.diff.query',
  mutates: false,
  input: snapshotDiffQuerySchema,
  inputShape: snapshotDiffQueryShape,
  http: {
    method: 'GET',
    path: '/api/canvas/snapshots/diff',
  },
  handler: (input) => {
    // Legacy precedence: ?name= wins over ?id= even when empty.
    const name = typeof input.name === 'string'
      ? input.name
      : typeof input.id === 'string' ? input.id : '';
    if (!name.trim()) throw new OperationError('Missing snapshot name or id.');
    return diffSnapshotCore(name);
  },
});

// ── snapshot.restore ──────────────────────────────────────────

/** Legacy mcp/server.ts buildSnapshotRestoreSummary, fed from the wire layout. */
function buildSnapshotRestoreSummary(layout: unknown): Record<string, unknown> {
  const body = isRecord(layout) ? layout : {};
  const nodes = Array.isArray(body.nodes) ? body.nodes : [];
  const edges = Array.isArray(body.edges) ? body.edges : [];
  const annotations = Array.isArray(body.annotations) ? body.annotations : [];
  const nodesByType: Record<string, number> = {};
  for (const node of nodes) {
    const type = isRecord(node) && typeof node.type === 'string' ? node.type : 'unknown';
    nodesByType[type] = (nodesByType[type] ?? 0) + 1;
  }
  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    annotationCount: annotations.length,
    nodesByType,
    viewport: body.viewport,
  };
}

const snapshotRestoreShape = {
  id: z.string().optional().catch(undefined).describe('Snapshot ID or name to restore (from canvas_snapshot or snapshot list)'),
};

const snapshotRestoreSchema = z.looseObject(snapshotRestoreShape);

const snapshotRestoreOperation = defineOperation<z.infer<typeof snapshotRestoreSchema>, Record<string, unknown>>({
  name: 'snapshot.restore',
  mutates: true,
  input: snapshotRestoreSchema,
  inputShape: snapshotRestoreShape,
  http: {
    method: 'POST',
    path: '/api/canvas/snapshots/:id',
  },
  mcp: {
    toolName: 'canvas_restore',
    description: 'Restore the canvas to a previously saved snapshot. Use canvas_snapshot to save first. Pass either the snapshot ID or name to restore.',
    extraShape: {
      id: z.string().describe('Snapshot ID or name to restore (from canvas_snapshot or snapshot list)'),
    },
    formatResult: async (_result, input, host) => {
      const layout = await host.invoker().invoke('layout.get', { includeBlobs: true });
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            restored: input.id,
            summary: buildSnapshotRestoreSummary(layout),
          }, null, 2),
        }],
      };
    },
  },
  handler: async ({ id }) => {
    // Awaits only the synchronous restore; restoreCanvasSnapshot fires the
    // async ext-app rehydration itself and schedules a deferred
    // canvas-layout-update through setCanvasLayoutUpdateEmitter when it
    // finishes. mutates: true contributes the single immediate frame — do NOT
    // add a manual emit here or the frame is doubled.
    const result = await restoreCanvasSnapshot(id ?? '');
    if (!result.ok) throw new OperationError('Snapshot not found', 404);
    return { ok: true };
  },
});

// ── snapshot.delete ───────────────────────────────────────────

const snapshotDeleteShape = {
  id: z.string().optional().catch(undefined).describe('Snapshot ID to delete'),
};

const snapshotDeleteSchema = z.looseObject(snapshotDeleteShape);

const snapshotDeleteOperation = defineOperation<z.infer<typeof snapshotDeleteSchema>, Record<string, unknown>>({
  name: 'snapshot.delete',
  mutates: false,
  input: snapshotDeleteSchema,
  inputShape: snapshotDeleteShape,
  http: {
    method: 'DELETE',
    path: '/api/canvas/snapshots/:id',
  },
  mcp: {
    toolName: 'canvas_delete_snapshot',
    description: 'Delete a saved snapshot by ID.',
    extraShape: {
      id: z.string().describe('Snapshot ID to delete'),
    },
    formatResult: (_result, input) => ({
      content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, deleted: input.id }) }],
    }),
  },
  handler: ({ id }) => {
    const result = deleteCanvasSnapshot(id ?? '');
    if (!result.ok) throw new OperationError('Snapshot not found', 404);
    return { ok: true };
  },
});

export const snapshotOperations: Operation[] = [
  snapshotListOperation,
  snapshotSaveOperation,
  // gc before restore: POST /api/canvas/snapshots/gc must match before
  // POST /api/canvas/snapshots/:id (registration order = dispatch order).
  snapshotGcOperation,
  snapshotDiffQueryOperation,
  snapshotDiffOperation,
  snapshotRestoreOperation,
  snapshotDeleteOperation,
];
