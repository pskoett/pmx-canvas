import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import { getCanvasNodeTitle } from './canvas-serialization.js';

/**
 * Per-type minimum node size (0.4.5 report follow-up): agents frequently
 * create nodes with explicit frames far too small for their content — clipped
 * markdown, charts squeezed behind inner scrollbars. Explicit sizes below the
 * floor are clamped UP at creation (canvas-operations.ts creators);
 * `strictSize: true` is the escape hatch for a genuinely small fixed frame.
 * Floors sit below every type default and above the point of unreadability.
 * Creation-only: later updates are untouched (the browser's drag-resize
 * enforces its own 200×100 floor client-side), but `validate` reports any
 * node below its floor as an advisory sizeWarning. Absent types (trace,
 * group, prompt/response) are intentionally unclamped — trace is small by
 * design, groups size to their children.
 */
export const NODE_MIN_CREATE_SIZES: Partial<Record<CanvasNodeState['type'], { width: number; height: number }>> = {
  markdown: { width: 360, height: 180 },
  context: { width: 360, height: 180 },
  file: { width: 360, height: 200 },
  diff: { width: 420, height: 240 },
  mermaid: { width: 360, height: 240 },
  status: { width: 280, height: 120 },
  ledger: { width: 320, height: 200 },
  image: { width: 240, height: 180 },
  html: { width: 420, height: 280 },
  webpage: { width: 420, height: 280 },
  'json-render': { width: 420, height: 280 },
  graph: { width: 420, height: 280 },
  'mcp-app': { width: 480, height: 320 },
};

export function clampCreateNodeSize(
  type: CanvasNodeState['type'],
  width: number,
  height: number,
  strictSize?: boolean,
): { width: number; height: number } {
  if (strictSize === true) return { width, height };
  const min = NODE_MIN_CREATE_SIZES[type];
  if (!min) return { width, height };
  return { width: Math.max(width, min.width), height: Math.max(height, min.height) };
}

export interface CanvasValidationPair {
  aId: string;
  aTitle: string | null;
  bId: string;
  bTitle: string | null;
}

export interface CanvasContainmentIssue {
  groupId: string;
  groupTitle: string | null;
  childId: string;
  childTitle: string | null;
}

export interface CanvasSizeWarning {
  id: string;
  title: string | null;
  type: CanvasNodeState['type'];
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}

export interface CanvasValidationResult {
  ok: boolean;
  collisions: CanvasValidationPair[];
  containments: CanvasContainmentIssue[];
  containmentViolations: CanvasContainmentIssue[];
  missingEdgeEndpoints: Array<{ edgeId: string; from: string; to: string }>;
  /** Nodes below their type's readable minimum (advisory — does not fail `ok`). */
  sizeWarnings: CanvasSizeWarning[];
  summary: {
    nodes: number;
    edges: number;
    collisions: number;
    containments: number;
    containmentViolations: number;
    missingEdgeEndpoints: number;
    sizeWarnings: number;
  };
}

function overlaps(a: CanvasNodeState, b: CanvasNodeState): boolean {
  return (
    a.position.x < b.position.x + b.size.width &&
    a.position.x + a.size.width > b.position.x &&
    a.position.y < b.position.y + b.size.height &&
    a.position.y + a.size.height > b.position.y
  );
}

function participatesInCanvasCollisionValidation(node: CanvasNodeState): boolean {
  return node.dockPosition === null;
}

function fullyContains(group: CanvasNodeState, child: CanvasNodeState): boolean {
  return (
    child.position.x >= group.position.x &&
    child.position.y >= group.position.y &&
    child.position.x + child.size.width <= group.position.x + group.size.width &&
    child.position.y + child.size.height <= group.position.y + group.size.height
  );
}

function isGroupChildPair(group: CanvasNodeState, child: CanvasNodeState): boolean {
  if (group.type !== 'group') return false;
  if (child.data.parentGroup === group.id) return true;
  const children = group.data.children;
  return Array.isArray(children) && children.includes(child.id);
}

function pair(a: CanvasNodeState, b: CanvasNodeState): CanvasValidationPair {
  return {
    aId: a.id,
    aTitle: getCanvasNodeTitle(a),
    bId: b.id,
    bTitle: getCanvasNodeTitle(b),
  };
}

function containment(group: CanvasNodeState, child: CanvasNodeState): CanvasContainmentIssue {
  return {
    groupId: group.id,
    groupTitle: getCanvasNodeTitle(group),
    childId: child.id,
    childTitle: getCanvasNodeTitle(child),
  };
}

export function validateCanvasLayout(layout: CanvasLayout): CanvasValidationResult {
  const collisions: CanvasValidationPair[] = [];
  const containments: CanvasContainmentIssue[] = [];
  const containmentViolations: CanvasContainmentIssue[] = [];

  for (let i = 0; i < layout.nodes.length; i++) {
    const a = layout.nodes[i]!;
    if (!participatesInCanvasCollisionValidation(a)) continue;
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const b = layout.nodes[j]!;
      if (!participatesInCanvasCollisionValidation(b)) continue;
      if (!overlaps(a, b)) continue;

      if (isGroupChildPair(a, b)) {
        (fullyContains(a, b) ? containments : containmentViolations).push(containment(a, b));
        continue;
      }
      if (isGroupChildPair(b, a)) {
        (fullyContains(b, a) ? containments : containmentViolations).push(containment(b, a));
        continue;
      }

      collisions.push(pair(a, b));
    }
  }

  const nodeIds = new Set(layout.nodes.map((node) => node.id));
  const missingEdgeEndpoints = layout.edges
    .filter((edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to))
    .map((edge) => ({ edgeId: edge.id, from: edge.from, to: edge.to }));

  // Advisory: nodes below their type's readable floor (clipped/unreadable
  // content — 0.4.5 report follow-up). Creation clamps these, but resized or
  // strictSize-created nodes can still be undersized; surface them so an
  // agent's validate pass sees the problem. Collapsed/docked nodes render as
  // bars, and strictSize is the deliberate opt-out — all skipped.
  const sizeWarnings: CanvasSizeWarning[] = layout.nodes
    .filter((node) => !node.collapsed && node.dockPosition == null && node.data?.strictSize !== true)
    .flatMap((node) => {
      const min = NODE_MIN_CREATE_SIZES[node.type];
      if (!min || (node.size.width >= min.width && node.size.height >= min.height)) return [];
      return [
        {
          id: node.id,
          title: getCanvasNodeTitle(node),
          type: node.type,
          width: node.size.width,
          height: node.size.height,
          minWidth: min.width,
          minHeight: min.height,
        },
      ];
    });

  return {
    ok: collisions.length === 0 && containmentViolations.length === 0 && missingEdgeEndpoints.length === 0,
    collisions,
    containments,
    containmentViolations,
    missingEdgeEndpoints,
    sizeWarnings,
    summary: {
      nodes: layout.nodes.length,
      edges: layout.edges.length,
      collisions: collisions.length,
      containments: containments.length,
      containmentViolations: containmentViolations.length,
      missingEdgeEndpoints: missingEdgeEndpoints.length,
      sizeWarnings: sizeWarnings.length,
    },
  };
}
