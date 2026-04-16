import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import { getCanvasNodeTitle } from './canvas-serialization.js';

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

export interface CanvasValidationResult {
  ok: boolean;
  collisions: CanvasValidationPair[];
  containments: CanvasContainmentIssue[];
  containmentViolations: CanvasContainmentIssue[];
  missingEdgeEndpoints: Array<{ edgeId: string; from: string; to: string }>;
  summary: {
    nodes: number;
    edges: number;
    collisions: number;
    containments: number;
    containmentViolations: number;
    missingEdgeEndpoints: number;
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

function fullyContains(group: CanvasNodeState, child: CanvasNodeState): boolean {
  return (
    child.position.x >= group.position.x &&
    child.position.y >= group.position.y &&
    child.position.x + child.size.width <= group.position.x + group.size.width &&
    child.position.y + child.size.height <= group.position.y + group.size.height
  );
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
    for (let j = i + 1; j < layout.nodes.length; j++) {
      const b = layout.nodes[j]!;
      if (!overlaps(a, b)) continue;

      if (a.type === 'group' && b.data.parentGroup === a.id) {
        (fullyContains(a, b) ? containments : containmentViolations).push(containment(a, b));
        continue;
      }
      if (b.type === 'group' && a.data.parentGroup === b.id) {
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

  return {
    ok: collisions.length === 0 && containmentViolations.length === 0 && missingEdgeEndpoints.length === 0,
    collisions,
    containments,
    containmentViolations,
    missingEdgeEndpoints,
    summary: {
      nodes: layout.nodes.length,
      edges: layout.edges.length,
      collisions: collisions.length,
      containments: containments.length,
      containmentViolations: containmentViolations.length,
      missingEdgeEndpoints: missingEdgeEndpoints.length,
    },
  };
}
