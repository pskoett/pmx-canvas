import {
  canvasState,
  type CanvasAnnotation,
  type CanvasEdge,
  type CanvasNodeState,
  type ViewportState,
} from './canvas-state.js';
import demoStateJson from './demo-state.json';

interface DemoStateFixture {
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
  contextPins?: string[];
  /**
   * Canvas-bound AX state (work items and friends), restored verbatim so the
   * `data.axStep.workItemId` stamped on the ⑧ agent-at-work step nodes resolves
   * to a real work item — without it the seeded Start/Done controls 404.
   * Timeline rows (events/evidence/steering) are deliberately absent: snapshots
   * do not restore them either.
   */
  ax?: unknown;
}

const demoState = demoStateJson as DemoStateFixture;

export function seedDemoCanvas(): { nodes: number; edges: number; groups: number } {
  const nodes = demoState.nodes.map((node) => structuredClone(node));
  const edges = demoState.edges.map((edge) => structuredClone(edge));
  const annotations = (demoState.annotations ?? []).map((annotation) => structuredClone(annotation));
  const pins = demoState.contextPins ?? [];

  canvasState.withSuppressedRecording(() => {
    for (const node of nodes) canvasState.addNode(node);
    for (const edge of edges) canvasState.addEdge(edge);
    for (const annotation of annotations) canvasState.addAnnotation(annotation);
    canvasState.setContextPins(pins);
    canvasState.setViewport(demoState.viewport);
    // After the nodes exist: the AX partition is normalized against the current
    // node set, so applying it first would strip every work item's `nodeIds`.
    //
    // Only when the canvas-bound AX partition is EMPTY. applyPersistedAxState
    // REPLACES it (work items, gates, review annotations, and the policy
    // singleton) and the seed is flushed to disk — and the caller's
    // only-seed-when-empty guard counts NODES only. Work items need no nodes,
    // so an agent tracking a plan on a bare board would have it destroyed by
    // `--demo`.
    const axPartitionEmpty =
      canvasState.getWorkItems().length === 0 &&
      canvasState.getApprovalGates().length === 0 &&
      canvasState.getReviewAnnotations().length === 0;
    if (demoState.ax !== undefined && axPartitionEmpty) {
      canvasState.applyPersistedAxState(structuredClone(demoState.ax));
    }
  });
  canvasState.flushToDisk();

  return {
    nodes: nodes.length,
    edges: edges.length,
    groups: nodes.filter((node) => node.type === 'group').length,
  };
}
