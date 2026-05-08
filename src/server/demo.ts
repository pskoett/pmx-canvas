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
  });
  canvasState.flushToDisk();

  return {
    nodes: nodes.length,
    edges: edges.length,
    groups: nodes.filter((node) => node.type === 'group').length,
  };
}
