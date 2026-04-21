import { canvasState } from './canvas-state.js';
import type { CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';

export interface SerializedCanvasNode extends CanvasNodeState {
  title: string | null;
  content: string | null;
  path: string | null;
  url: string | null;
}

export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
  nodes: SerializedCanvasNode[];
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function getCanvasNodeTitle(node: CanvasNodeState): string | null {
  return pickString(node.data.title)
    ?? (node.type === 'webpage' ? pickString(node.data.pageTitle) : null)
    ?? null;
}

export function getCanvasNodeContent(node: CanvasNodeState): string | null {
  return pickString(node.data.content)
    ?? pickString(node.data.fileContent)
    ?? pickString(node.data.text)
    ?? (node.type === 'file' ? pickString(node.data.path) : null)
    ?? (node.type === 'image' ? pickString(node.data.src) : null)
    ?? (node.type === 'webpage' ? pickString(node.data.url) : null)
    ?? null;
}

export function serializeCanvasNode(node: CanvasNodeState): SerializedCanvasNode {
  return {
    ...node,
    title: getCanvasNodeTitle(node),
    content: getCanvasNodeContent(node),
    path: pickString(node.data.path),
    url: pickString(node.data.url),
  };
}

export function serializeCanvasLayout(layout: CanvasLayout): SerializedCanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(serializeCanvasNode),
  };
}

export interface CanvasSummary {
  totalNodes: number;
  totalEdges: number;
  nodesByType: Record<string, number>;
  pinnedCount: number;
  pinnedTitles: string[];
  viewport: ViewportState;
}

export function buildCanvasSummary(): CanvasSummary {
  const layout = canvasState.getLayout();
  const pinnedIds = canvasState.contextPinnedNodeIds;

  const typeCounts: Record<string, number> = {};
  for (const n of layout.nodes) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }

  const pinnedTitles = layout.nodes
    .filter((n) => pinnedIds.has(n.id))
    .map((n) => getCanvasNodeTitle(n) ?? n.id);

  return {
    totalNodes: layout.nodes.length,
    totalEdges: layout.edges.length,
    nodesByType: typeCounts,
    pinnedCount: pinnedIds.size,
    pinnedTitles,
    viewport: layout.viewport,
  };
}
