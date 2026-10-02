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
 * One core check (`checkFenceTarget`) serves two describers: the operation
 * registry (`checkScopeFence`, every HTTP/MCP/CLI write) and the sync SDK,
 * whose methods bypass the registry and describe their own targets.
 *
 * Safe default: a mutating op this module does not know how to scope is
 * refused while a fence is set, rather than silently allowed. Likewise a
 * write this module cannot resolve (an edge given by search, a missing id)
 * is refused — fail closed, never a bypass.
 *
 * Trust note: the workbench marker is a self-reported header. Under the
 * local single-workspace model that is by design (any local process may
 * write; the safety model is human veto plus this fence), so the fence holds
 * cooperating agents to the region the human granted — it is not an
 * authentication boundary.
 */
import { type FenceRect, fenceRectFromNodes } from '../shared/scope-fence.js';
import { canvasState } from './canvas-state.js';
import { resolvePatchGeometry, validCanvasNodeUpdates } from './canvas-geometry.js';
import type { Operation } from './operations/types.js';

/** Bounding box of the fenced nodes plus padding; null when none of them exist. */
export function scopeFenceRect(fence: { nodeIds: string[]; padding: number }): FenceRect | null {
  const nodes = fence.nodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is NonNullable<typeof node> => node !== undefined);
  return fenceRectFromNodes(nodes, fence.padding);
}

/** What a write touches, in fence terms. */
export interface FenceTarget {
  /** Existing nodes the write targets — every one must be fenced. */
  nodeIds?: string[];
  /** World points a write introduces (a new node, annotation points) — all must be inside the box. */
  points?: Array<{ x: number; y: number }>;
  /** A new node with no position: refused (it cannot be placed inside the fence). */
  unplacedCreate?: boolean;
  /** Rewrites the whole board — never allowed under a fence. */
  boardWide?: boolean;
  /** The op is not fence-aware — refused while a fence is set. */
  unknown?: string;
}

function inside(rect: FenceRect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Returns a human-readable refusal, or null when the target is inside the fence. */
export function checkFenceTarget(target: FenceTarget, opName: string, writerKey?: string): string | null {
  const policy = canvasState.getPolicy();
  // Per-agent territory (fleet orchestration) overrides the global fence for
  // that writer; writers without a territory fall under the global fence.
  const territory = writerKey ? policy.agentScopes[writerKey] : undefined;
  const fence = territory ?? policy.scope;
  if (!fence) return null;
  const describe = territory
    ? `your assigned territory (${fence.nodeIds.length} node${fence.nodeIds.length === 1 ? '' : 's'}); reads are allowed — ask the orchestrator or the human to widen it`
    : `the agent scope fence (${fence.nodeIds.length} node${fence.nodeIds.length === 1 ? '' : 's'}); reads are allowed — ask the human to widen the fence`;
  if (target.boardWide) return `"${opName}" rewrites the whole board, which is outside ${describe}.`;
  if (target.unknown) return `"${target.unknown}" is not fence-aware and was refused under ${describe}.`;
  const fenced = new Set(fence.nodeIds);
  for (const id of target.nodeIds ?? []) {
    if (!fenced.has(id)) return `node "${id}" is outside ${describe}.`;
  }
  if (target.unplacedCreate) return `new nodes need an explicit x/y inside ${describe}.`;
  if (target.points && target.points.length > 0) {
    const rect = scopeFenceRect(fence);
    if (!rect) return `no fenced node exists to place new content near — outside ${describe}.`;
    for (const point of target.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !inside(rect, point.x, point.y)) {
        return `position (${point.x}, ${point.y}) is outside ${describe}.`;
      }
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Group membership as `node.add` / `node.update` accept it (mirrors `pickGroupChildIds`). */
function groupChildren(input: Record<string, unknown>): string[] {
  if ('children' in input) return stringList(input.children);
  if ('childIds' in input) return stringList(input.childIds);
  const data = asRecord(input.data);
  return 'children' in data ? stringList(data.children) : [];
}

/** Automatic frames are write targets when their descendants can cause a re-fit.
 * Conservatively include them even if the resulting bounds happen to be equal.
 * A manual frame does not re-fit, so propagation stops there. */
function includeAutoFrameParents(nodeIds: string[]): string[] {
  const targets = new Set(nodeIds);
  for (const id of targets) {
    const parentId = canvasState.getNode(id)?.data.parentGroup;
    if (typeof parentId !== 'string') continue;
    const parent = canvasState.getNode(parentId);
    if (parent?.type === 'group' && parent.data.frameMode !== 'manual') targets.add(parentId);
  }
  return [...targets];
}

/** `canvasState.applyUpdates`: group moves translate children unless that child has its own position update. */
function applyUpdatesTarget(input: Record<string, unknown>): FenceTarget {
  const updates = validCanvasNodeUpdates(input.updates);
  const explicitPositionIds = new Set(
    updates.filter((update) => update.position !== undefined).map((update) => update.id),
  );
  const nodeIds: string[] = [];
  const points: Array<{ x: number; y: number }> = [];
  for (const update of updates) {
    const id = update.id;
    nodeIds.push(id);
    if (!update.position) continue;
    const { x, y } = update.position;
    points.push({ x, y });
    const node = canvasState.getNode(id);
    if (node?.type !== 'group') continue;
    const deltaX = x - node.position.x;
    const deltaY = y - node.position.y;
    for (const childId of stringList(node.data.children)) {
      if (explicitPositionIds.has(childId)) continue;
      nodeIds.push(childId);
      const child = canvasState.getNode(childId);
      if (child) points.push({ x: child.position.x + deltaX, y: child.position.y + deltaY });
    }
  }
  return { nodeIds: includeAutoFrameParents(nodeIds), points };
}

function createTarget(input: Record<string, unknown>, extraNodeIds: string[] = []): FenceTarget {
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { unplacedCreate: true, nodeIds: extraNodeIds };
  return { points: [{ x, y }], nodeIds: extraNodeIds };
}

/** Ops that rewrite the whole board — never allowed under a fence. */
const BOARD_WIDE_OPS = new Set(['arrange', 'canvas.clear', 'snapshot.restore', 'render.workboard', 'tour.set']);

/** Describe what a registry op would write, in fence terms. */
export function describeOpTarget(op: Operation, rawInput: unknown): FenceTarget {
  const input = asRecord(rawInput);
  if (BOARD_WIDE_OPS.has(op.name)) return { boardWide: true };
  switch (op.name) {
    case 'canvas.apply-updates':
      return applyUpdatesTarget(input);
    case 'node.update': {
      const id = str(input.id);
      const existing = canvasState.getNode(id);
      const geometry = existing ? resolvePatchGeometry(input, existing) : {};
      // Share the bulk translation rules after resolving PATCH aliases and
      // omitted axes. Check children's destinations as well as the group origin.
      const target = applyUpdatesTarget({ updates: [{ id, ...geometry }] });
      return {
        ...target,
        nodeIds: includeAutoFrameParents([id, ...(target.nodeIds ?? []), ...groupChildren(input)]),
      };
    }
    case 'node.remove':
      return { nodeIds: [str(input.id)] };
    case 'node.add':
      return createTarget(input, input.type === 'group' ? groupChildren(input) : []);
    case 'jsonrender.add':
    case 'graph.add':
      return createTarget(input);
    case 'jsonrender.stream':
      // Appends to an existing node by `nodeId`, or creates one at x/y.
      return typeof input.nodeId === 'string' ? { nodeIds: [input.nodeId] } : createTarget(input);
    case 'edge.add':
      // Search-resolved endpoints (`fromSearch`/`toSearch`) cannot be checked
      // before resolution and so read as '' — refused, not bypassed.
      return { nodeIds: [str(input.from), str(input.to)] };
    case 'edge.remove': {
      const id = str(input.id) || str(input.edge_id);
      const edge = canvasState.getEdges().find((entry) => entry.id === id);
      return edge ? { nodeIds: [edge.from, edge.to] } : {}; // missing edge: the op 404s on its own
    }
    case 'group.create':
      return { nodeIds: stringList(input.childIds ?? input.children) };
    case 'group.add':
    case 'group.remove':
      return { nodeIds: [str(input.groupId), ...stringList(input.childIds)] };
    case 'annotation.add': {
      const points = Array.isArray(input.points) ? input.points : [];
      return {
        points: points.map((point) => {
          const p = asRecord(point);
          return { x: Number(p.x), y: Number(p.y) };
        }),
      };
    }
    case 'annotation.remove': {
      const annotation = canvasState.getAnnotations().find((entry) => entry.id === str(input.id));
      if (!annotation) return {};
      const { bounds } = annotation;
      return {
        points: [
          { x: bounds.x, y: bounds.y },
          { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        ],
      };
    }
    case 'node.focus':
      return {}; // navigation, not a write
    default:
      return { unknown: op.name };
  }
}

/** Registry entry point: refusal text or null. Only call for mutating, agent-originated ops. */
export function checkScopeFence(op: Operation, rawInput: unknown, writerKey?: string): string | null {
  return checkFenceTarget(describeOpTarget(op, rawInput), op.name, writerKey);
}

/**
 * The GLOBAL fence belongs to the human: an agent must not clear, widen, or
 * replace it through `ax.policy.set`. Per-agent territories (`agentScopes`)
 * are the orchestration surface — an agent MAY set territories for OTHER
 * writers (fencing its workers), but never its own: granting yourself a wider
 * territory (or deleting it) is escalation.
 */
export function checkScopeOwnership(rawInput: unknown, writerKey?: string): string | null {
  const input = asRecord(rawInput);
  if ('scope' in input)
    return 'the scope fence is set and cleared by the human in the session panel, not by the agent.';
  const agentScopes = input.agentScopes;
  if (writerKey && agentScopes && typeof agentScopes === 'object' && !Array.isArray(agentScopes)) {
    if (Object.hasOwn(agentScopes, writerKey)) {
      return `an agent cannot set or clear its OWN territory ("${writerKey}") — only the human or a different writer (the orchestrator) may.`;
    }
  }
  return null;
}
