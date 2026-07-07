/**
 * Annotation ops: annotation.remove (plan-008 Wave 1) and annotation.add
 * (plan-009 C1 slice 3 — the legacy POST /api/canvas/annotation handler,
 * wire-identical).
 *
 * annotation.remove: DELETE-by-id of a human-drawn canvas annotation.
 * mutates: true → the registry auto-emits one canvas-layout-update after
 * success, matching the legacy handler. A non-existent id is a 404
 * OperationError carrying the exact legacy message; an omitted id is a 400 so
 * composite callers get a loud input error instead of a misleading "not
 * found". HTTP renders errors as { ok:false, error } and MCP renders them as
 * isError tool results.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState, type CanvasAnnotation } from '../../canvas-state.js';
import { summarizeCanvasAnnotation } from '../../canvas-serialization.js';
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

// ── annotation.add (helpers moved from server.ts) ─────────────

function annotationBounds(points: CanvasAnnotation['points']): CanvasAnnotation['bounds'] {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function textAnnotationBounds(
  point: CanvasAnnotation['points'][number],
  text: string,
  width: number,
): CanvasAnnotation['bounds'] {
  return {
    x: point.x,
    y: point.y - width,
    width: Math.max(width, text.length * width * 0.62),
    height: width * 1.2,
  };
}

function parseAnnotationPoints(value: unknown): CanvasAnnotation['points'] {
  if (!Array.isArray(value)) return [];
  return value
    .map((point) => {
      if (!point || typeof point !== 'object' || Array.isArray(point)) return null;
      const record = point as Record<string, unknown>;
      if (typeof record.x !== 'number' || typeof record.y !== 'number') return null;
      if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) return null;
      return { x: record.x, y: record.y };
    })
    .filter((point): point is CanvasAnnotation['points'][number] => point !== null);
}

const annotationAddShape = {
  type: z.unknown().optional().describe("Annotation type: 'freehand' (default) or 'text'"),
  points: z.unknown().optional().describe('Annotation points: [{ x, y }, …]'),
  width: z.unknown().optional().describe('Stroke width (freehand) or font size (text)'),
  color: z.unknown().optional().describe("'currentColor' or a #rrggbb hex color"),
  label: z.unknown().optional().describe('Short annotation label'),
  text: z.unknown().optional().describe('Text annotation content'),
  id: z.unknown().optional().describe('Explicit annotation id'),
};

const annotationAddSchema = z.looseObject(annotationAddShape);

const annotationAddOperation = defineOperation<z.infer<typeof annotationAddSchema>, Record<string, unknown>>({
  name: 'annotation.add',
  mutates: true,
  input: annotationAddSchema,
  inputShape: annotationAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/annotation',
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const type = body.type === 'text' ? 'text' : 'freehand';
    const points = parseAnnotationPoints(body.points);
    if (points.length < (type === 'text' ? 1 : 2)) {
      throw new OperationError(
        type === 'text' ? 'Text annotation requires a valid point.' : 'Annotation requires at least two valid points.',
      );
    }

    const defaultWidth = type === 'text' ? 24 : 4;
    const maxWidth = type === 'text' ? 96 : 24;
    const width =
      typeof body.width === 'number' && Number.isFinite(body.width)
        ? Math.min(maxWidth, Math.max(1, body.width))
        : defaultWidth;
    const color =
      typeof body.color === 'string' && (body.color === 'currentColor' || /^#[0-9a-fA-F]{6}$/.test(body.color))
        ? body.color
        : 'currentColor';
    const label =
      typeof body.label === 'string' && body.label.trim().length > 0 ? body.label.trim().slice(0, 160) : undefined;
    const text =
      type === 'text' && typeof body.text === 'string' && body.text.trim().length > 0
        ? body.text.trim().slice(0, 240)
        : undefined;
    if (type === 'text' && !text) {
      throw new OperationError('Text annotation requires text.');
    }
    const id =
      typeof body.id === 'string' && body.id.trim().length > 0
        ? body.id.trim().slice(0, 120)
        : `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const annotation: CanvasAnnotation = {
      id,
      type,
      points,
      bounds: type === 'text' ? textAnnotationBounds(points[0]!, text!, width) : annotationBounds(points),
      color,
      width,
      ...(text ? { text } : {}),
      ...((label ?? text) ? { label: label ?? text } : {}),
      createdAt: new Date().toISOString(),
    };

    canvasState.addAnnotation(annotation);
    return { ok: true, annotation: summarizeCanvasAnnotation(annotation) };
  },
});

export const annotationOperations: Operation[] = [annotationRemoveOperation, annotationAddOperation];
