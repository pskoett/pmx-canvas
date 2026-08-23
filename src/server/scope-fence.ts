/**
 * Scope fence enforcement (rail-chrome-v2 phase 4, design item 4).
 *
 * When the AX policy carries a scope fence, an attached agent may only WRITE
 * inside it: existing-node writes must target fenced nodes, new nodes must
 * land inside the fence's bounding box (fenced nodes + padding), and
 * board-wide writes (arrange, clear, restore) are refused. Reads are never
 * fenced, and neither are the human's own workbench writes — the fence is the
 * human's tool, not a cage for the human.
 *
 * Safe default: a mutating op this module does not know how to scope is
 * refused while a fence is set, rather than silently allowed.
 */
import { type FenceRect, fenceRectFromNodes } from '../shared/scope-fence.js';
import { canvasState } from './canvas-state.js';
import type { Operation } from './operations/types.js';

/** Bounding box of the fenced nodes plus padding; null when none of them exist. */
export function scopeFenceRect(fence: { nodeIds: string[]; padding: number }): FenceRect | null {
  const nodes = fence.nodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  return fenceRectFromNodes(nodes, fence.padding);
}

function inside(rect: FenceRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Ops that rewrite the whole board — never allowed under a fence. */
const BOARD_WIDE_OPS = new Set(['arrange', 'canvas.clear', 'snapshot.restore', 'render.workboard']);

/**
 * Returns a human-readable refusal, or null when the write is inside the
 * fence. Only call for mutating, agent-originated ops.
 */
export function checkScopeFence(op: Operation, rawInput: unknown): string | null {
  const fence = canvasState.getPolicy().scope;
  if (!fence) return null;
  const fenced = new Set(fence.nodeIds);
  const rect = scopeFenceRect(fence);
  const input = asRecord(rawInput);
  const outsideNode = (ids: string[]): string | null => ids.find((id) => !fenced.has(id)) ?? null;
  const describe = `the agent scope fence (${fence.nodeIds.length} node${fence.nodeIds.length === 1 ? '' : 's'}); reads are allowed — ask the human to widen the fence`;

  if (BOARD_WIDE_OPS.has(op.name)) {
    return `"${op.name}" rewrites the whole board, which is outside ${describe}.`;
  }

  switch (op.name) {
    case 'node.update':
    case 'node.remove':
    case 'jsonrender.stream': {
      const id = typeof input.id === 'string' ? input.id : '';
      return fenced.has(id) ? null : `node "${id}" is outside ${describe}.`;
    }
    case 'node.add':
    case 'jsonrender.add':
    case 'graph.add': {
      if (!rect) return `no fenced node exists to place new nodes near — outside ${describe}.`;
      const x = Number(input.x);
      const y = Number(input.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return `new nodes need an explicit x/y inside ${describe}.`;
      }
      return inside(rect, x, y) ? null : `position (${x}, ${y}) is outside ${describe}.`;
    }
    case 'edge.add': {
      const from = typeof input.from === 'string' ? input.from : '';
      const to = typeof input.to === 'string' ? input.to : '';
      const bad = outsideNode([from, to]);
      return bad === null ? null : `edge endpoint "${bad}" is outside ${describe}.`;
    }
    case 'edge.remove': {
      const id = typeof input.id === 'string' ? input.id : typeof input.edge_id === 'string' ? input.edge_id : '';
      const edge = canvasState.getEdges().find((entry) => entry.id === id);
      if (!edge) return null; // nothing to fence; the op will 404 on its own
      const bad = outsideNode([edge.from, edge.to]);
      return bad === null ? null : `edge endpoint "${bad}" is outside ${describe}.`;
    }
    case 'group.create': {
      const bad = outsideNode(stringList(input.childIds ?? input.children));
      return bad === null ? null : `group child "${bad}" is outside ${describe}.`;
    }
    case 'group.add':
    case 'group.remove': {
      const groupId = typeof input.groupId === 'string' ? input.groupId : '';
      const bad = outsideNode([groupId, ...stringList(input.childIds)]);
      return bad === null ? null : `node "${bad}" is outside ${describe}.`;
    }
    case 'annotation.add': {
      if (!rect) return `no fenced node exists to annotate near — outside ${describe}.`;
      const points = Array.isArray(input.points) ? input.points : [];
      for (const point of points) {
        const p = asRecord(point);
        const x = Number(p.x);
        const y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(rect, x, y)) {
          return `annotation point (${x}, ${y}) is outside ${describe}.`;
        }
      }
      return null;
    }
    case 'annotation.remove': {
      const id = typeof input.id === 'string' ? input.id : '';
      const annotation = canvasState.getAnnotations().find((entry) => entry.id === id);
      if (!annotation || !rect) return null;
      const { bounds } = annotation;
      return inside(rect, bounds.x, bounds.y) && inside(rect, bounds.x + bounds.width, bounds.y + bounds.height)
        ? null
        : `annotation "${id}" is outside ${describe}.`;
    }
    case 'node.focus':
      // Navigation, not a write.
      return null;
    default:
      return `"${op.name}" is not fence-aware and was refused under ${describe}.`;
  }
}
