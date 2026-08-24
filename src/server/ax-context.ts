import { buildAgentContextPreamble, serializeNodeForAgentContext } from './agent-context.js';
import {
  type PmxAxHumanAnnotation,
  buildAxContext,
  buildPendingAxActivity,
  AX_CONTEXT_STEERING_LIMIT,
  type PmxAxContext,
  type PmxAxPinnedContext,
  type PmxAxWorkItem,
  type PmxAxApprovalGate,
  type PmxAxReviewAnnotation,
  type PmxAxElicitation,
  type PmxAxModeRequest,
  type PmxAxPolicy,
} from './ax-state.js';
import type { CanvasLayout } from './canvas-state.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';

/**
 * Compact, surface-safe view of the canvas-bound AX state, injected into (and
 * pushed to) AX-enabled surfaces so authored boards can RENDER the work queue /
 * focus, not just emit interactions. Deliberately excludes the timeline, pinned
 * preamble, and serialized node bodies to keep the payload small.
 */
export interface PmxAxSurfaceSnapshot {
  focus: string[];
  workItems: PmxAxWorkItem[];
  approvalGates: PmxAxApprovalGate[];
  // Free-text human fields (`body`, `author`) are redacted — a surface gets review
  // status/severity/anchor for a review board, but not raw human comment text.
  reviewAnnotations: Array<Omit<PmxAxReviewAnnotation, 'body' | 'author'>>;
  elicitations: PmxAxElicitation[];
  modeRequests: PmxAxModeRequest[];
  policy: PmxAxPolicy;
}

/**
 * NOTE: this is whole-canvas AX state (every work item, etc.), exposed to ANY
 * AX-enabled surface — reads are board-wide while emits are node-scoped. Acceptable
 * under the single-workspace local-trust model, but author surfaces accordingly
 * (don't embed untrusted third-party scripts in an AX-enabled surface). Sensitive
 * human review text is redacted below.
 */
export function buildCanvasAxSurfaceSnapshot(): PmxAxSurfaceSnapshot {
  const ax = canvasState.getAxState();
  return {
    focus: ax.focus.nodeIds,
    workItems: ax.workItems,
    approvalGates: ax.approvalGates,
    reviewAnnotations: ax.reviewAnnotations.map(({ body: _body, author: _author, ...rest }) => rest),
    elicitations: ax.elicitations,
    modeRequests: ax.modeRequests,
    policy: ax.policy,
  };
}

function serializeNodes(nodes: CanvasNodeState[]) {
  return nodes.map((node) =>
    serializeNodeForAgentContext(node, {
      defaultTextLength: 700,
      webpageTextLength: 1600,
      includePosition: true,
    }),
  );
}

export function buildCanvasAxPinnedContext(): PmxAxPinnedContext {
  const nodeIds = Array.from(canvasState.contextPinnedNodeIds);
  const nodes = nodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined);
  return {
    preamble: nodes.length > 0 ? buildAgentContextPreamble(nodes) : '',
    nodeIds,
    count: nodeIds.length,
    nodes: serializeNodes(nodes),
  };
}

/**
 * Human ink → agent context: each annotation, anchored to the nodes whose
 * padded frame it overlaps. Without this the human's strokes and notes were
 * invisible to every agent-facing surface — the annotate tool IS the human
 * writing to the agent (the pins principle, in ink).
 */
function buildHumanAnnotations(layout: CanvasLayout): PmxAxHumanAnnotation[] {
  const PAD = 40;
  return canvasState.getAnnotations().map((annotation) => {
    const xs = annotation.points.map((point) => point.x);
    const ys = annotation.points.map((point) => point.y);
    const center = xs.length
      ? {
          x: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
          y: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        }
      : { x: 0, y: 0 };
    const onNodes = layout.nodes
      .filter((node) => {
        const left = node.position.x - PAD;
        const top = node.position.y - PAD;
        const right = node.position.x + node.size.width + PAD;
        const bottom = node.position.y + node.size.height + PAD;
        return (
          xs.length > 0 &&
          Math.min(...xs) <= right &&
          Math.max(...xs) >= left &&
          Math.min(...ys) <= bottom &&
          Math.max(...ys) >= top
        );
      })
      .map((node) => ({ id: node.id, title: typeof node.data.title === 'string' ? node.data.title : null }));
    const text =
      typeof annotation.text === 'string' && annotation.text
        ? annotation.text
        : typeof annotation.label === 'string' && annotation.label
          ? annotation.label
          : null;
    return { id: annotation.id, type: annotation.type, text, onNodes, center };
  });
}

export function buildCanvasAxContext(consumer?: string): PmxAxContext {
  const layout = canvasState.getLayout();
  const ax = canvasState.getAxState();
  const focusNodes = ax.focus.nodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined);
  // Report #57: surface the NEWEST undelivered steering (so a fresh steer is visible
  // even behind a long backlog) + counts so the agent can detect an omitted backlog.
  // The FIFO claim/ack queue (getPendingSteering) stays oldest-first for processing.
  const pendingSteering = canvasState.getPendingSteeringForContext({ consumer, limit: AX_CONTEXT_STEERING_LIMIT });
  const totalPending = canvasState.getPendingSteeringCount(consumer);
  return buildAxContext({
    layout,
    delivery: {
      pendingSteering,
      totalPending,
      omittedPending: Math.max(0, totalPending - pendingSteering.length),
      pendingActivity: buildPendingAxActivity(ax, consumer),
    },
    pinned: buildCanvasAxPinnedContext(),
    focus: ax.focus,
    focusNodes: serializeNodes(focusNodes),
    workItems: ax.workItems,
    approvalGates: ax.approvalGates,
    reviewAnnotations: ax.reviewAnnotations,
    humanAnnotations: buildHumanAnnotations(layout),
    elicitations: ax.elicitations,
    modeRequests: ax.modeRequests,
    policy: ax.policy,
    timeline: canvasState.getAxTimelineSummary(),
    host: canvasState.getHostCapability(),
  });
}
