import { canvasState } from './canvas-state.js';
import type { CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';
import {
  normalizeCanvasNodeData,
  type CanvasNodeProvenance,
} from './canvas-provenance.js';

export interface SerializedCanvasNode extends CanvasNodeState {
  kind: string;
  title: string | null;
  content: string | null;
  path: string | null;
  url: string | null;
  provenance: CanvasNodeProvenance | null;
}

export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
  nodes: SerializedCanvasNode[];
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickProvenance(value: unknown): CanvasNodeProvenance | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CanvasNodeProvenance;
}

function getCanvasNodeKind(node: CanvasNodeState, data: Record<string, unknown>): string {
  if (node.type !== 'mcp-app') return node.type;
  // Authoritative discriminator added in v0.1.4. New web-artifacts always set
  // it; matching here first means a future URL-only artifact (no `data.path`)
  // still classifies correctly without falling through to the legacy heuristic.
  if (data.viewerType === 'web-artifact') return 'web-artifact';
  if (data.mode === 'ext-app') return 'external-app';
  // Transitional fallback for canvas state.json files persisted before v0.1.4
  // introduced `viewerType`. Web-artifacts written by older versions always
  // stored a `path` to the bundled HTML file, so this heuristic is safe for
  // existing data. Remove in v0.2.x once a one-shot migration runs at boot.
  if (data.hostMode === 'hosted' && typeof data.path === 'string') return 'web-artifact';
  return 'mcp-app';
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
  const data = normalizeCanvasNodeData(node.type, node.data);
  return {
    ...node,
    data,
    kind: getCanvasNodeKind(node, data),
    title: getCanvasNodeTitle(node),
    content: getCanvasNodeContent(node),
    path: pickString(data.path),
    url: pickString(data.url),
    provenance: pickProvenance(data.provenance),
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
    const kind = getCanvasNodeKind(n, normalizeCanvasNodeData(n.type, n.data));
    typeCounts[kind] = (typeCounts[kind] ?? 0) + 1;
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
