import { buildAgentContextPreamble, serializeNodeForAgentContext } from './agent-context.js';
import { buildAxContext, type PmxAxContext, type PmxAxPinnedContext } from './ax-state.js';
import { canvasState, type CanvasNodeState } from './canvas-state.js';

function serializeNodes(nodes: CanvasNodeState[]) {
  return nodes.map((node) => serializeNodeForAgentContext(node, {
    defaultTextLength: 700,
    webpageTextLength: 1600,
    includePosition: true,
  }));
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

export function buildCanvasAxContext(): PmxAxContext {
  const layout = canvasState.getLayout();
  const ax = canvasState.getAxState();
  const focusNodes = ax.focus.nodeIds
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined);
  return buildAxContext({
    layout,
    pinned: buildCanvasAxPinnedContext(),
    focus: ax.focus,
    focusNodes: serializeNodes(focusNodes),
    workItems: ax.workItems,
    approvalGates: ax.approvalGates,
    reviewAnnotations: ax.reviewAnnotations,
    elicitations: ax.elicitations,
    modeRequests: ax.modeRequests,
    policy: ax.policy,
    timeline: canvasState.getAxTimelineSummary(),
    host: canvasState.getHostCapability(),
  });
}
