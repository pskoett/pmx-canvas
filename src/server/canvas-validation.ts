import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import { getCanvasNodeTitle } from './canvas-serialization.js';
// The readability floor is SHARED with the client: the server clamps it at
// creation and `validate` reports violations, but the browser's auto-fit must
// honor the same floor or it silently undoes the clamp (0.4.6 Finding AA).
import { nodeMinSize } from '../shared/node-sizes.js';

export { NODE_MIN_SIZES, clampCreateNodeSize, nodeMinSize } from '../shared/node-sizes.js';

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

export interface CanvasHiddenEdgeEndpoint {
  edgeId: string;
  nodeId: string;
  nodeTitle: string | null;
  dockPosition: 'left' | 'right';
}

export interface CanvasValidationResult {
  ok: boolean;
  collisions: CanvasValidationPair[];
  containments: CanvasContainmentIssue[];
  containmentViolations: CanvasContainmentIssue[];
  missingEdgeEndpoints: Array<{ edgeId: string; from: string; to: string }>;
  /**
   * Edges whose endpoint node is DOCKED — it renders in the HUD column, not on
   * the canvas, so the edge visually terminates in empty space even though both
   * endpoint IDs resolve (0.4.6 orb feedback #1). Same defect class as a missing
   * endpoint: the edge cannot be drawn, so this fails `ok`.
   */
  hiddenEdgeEndpoints: CanvasHiddenEdgeEndpoint[];
  /** Nodes below their type's readable minimum (advisory — does not fail `ok`). */
  sizeWarnings: CanvasSizeWarning[];
  summary: {
    nodes: number;
    edges: number;
    collisions: number;
    containments: number;
    containmentViolations: number;
    missingEdgeEndpoints: number;
    hiddenEdgeEndpoints: number;
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

  // An edge to a DOCKED node cannot be drawn: docked nodes live in the HUD
  // column, and the world-space edge layer skips them, so the edge trails off
  // into empty canvas. Structural validation used to miss this entirely because
  // both endpoint IDs resolve (0.4.6 orb feedback #1).
  const dockedById = new Map(
    layout.nodes.filter((node) => node.dockPosition != null).map((node) => [node.id, node] as const),
  );
  const hiddenEdgeEndpoints: CanvasHiddenEdgeEndpoint[] = layout.edges.flatMap((edge) =>
    [edge.from, edge.to].flatMap((nodeId) => {
      const docked = dockedById.get(nodeId);
      if (!docked || docked.dockPosition == null) return [];
      return [
        {
          edgeId: edge.id,
          nodeId,
          nodeTitle: getCanvasNodeTitle(docked),
          dockPosition: docked.dockPosition,
        },
      ];
    }),
  );

  // Advisory: nodes below their type's readable floor (clipped/unreadable
  // content — 0.4.5 report follow-up). Creation clamps these, but resized or
  // strictSize-created nodes can still be undersized; surface them so an
  // agent's validate pass sees the problem. Collapsed/docked nodes render as
  // bars, and strictSize is the deliberate opt-out — all skipped.
  const sizeWarnings: CanvasSizeWarning[] = layout.nodes
    .filter((node) => !node.collapsed && node.dockPosition == null && node.data?.strictSize !== true)
    .flatMap((node) => {
      const min = nodeMinSize(node.type);
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
    ok:
      collisions.length === 0 &&
      containmentViolations.length === 0 &&
      missingEdgeEndpoints.length === 0 &&
      hiddenEdgeEndpoints.length === 0,
    collisions,
    containments,
    containmentViolations,
    missingEdgeEndpoints,
    hiddenEdgeEndpoints,
    sizeWarnings,
    summary: {
      nodes: layout.nodes.length,
      edges: layout.edges.length,
      collisions: collisions.length,
      containments: containments.length,
      containmentViolations: containmentViolations.length,
      missingEdgeEndpoints: missingEdgeEndpoints.length,
      hiddenEdgeEndpoints: hiddenEdgeEndpoints.length,
      sizeWarnings: sizeWarnings.length,
    },
  };
}
