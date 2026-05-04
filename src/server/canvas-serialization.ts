import { canvasState } from './canvas-state.js';
import type { CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';
import {
  normalizeCanvasNodeData,
  type CanvasNodeProvenance,
} from './canvas-provenance.js';
import { getCanvasNodeKind as getSharedCanvasNodeKind } from '../shared/canvas-node-kind.js';

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

interface BlobSummary {
  stored: 'sidecar';
  path: string;
  bytes: number;
  jsonBytes: number;
  sha256: string;
}

function pickString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function pickProvenance(value: unknown): CanvasNodeProvenance | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as CanvasNodeProvenance;
}

export function getCanvasNodeKind(node: CanvasNodeState, data: Record<string, unknown>): string {
  return getSharedCanvasNodeKind({ type: node.type, data });
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

function summarizeBlobValue(value: unknown): unknown {
  if (!canvasState.isBlobReference(value)) return value;
  return {
    stored: 'sidecar',
    path: value.path,
    bytes: value.bytes,
    jsonBytes: value.jsonBytes,
    sha256: value.sha256,
  } satisfies BlobSummary;
}

export function serializeCanvasNodeWithBlobSummaries(node: CanvasNodeState): SerializedCanvasNode {
  const serialized = serializeCanvasNode(node);
  if (serialized.type !== 'mcp-app') return serialized;
  const data = Object.fromEntries(
    Object.entries(serialized.data).map(([key, value]) => [key, summarizeBlobValue(value)]),
  );
  return { ...serialized, data };
}

export function serializeCanvasLayout(layout: CanvasLayout): SerializedCanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(serializeCanvasNode),
  };
}

export function serializeCanvasLayoutWithBlobSummaries(layout: CanvasLayout): SerializedCanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(serializeCanvasNodeWithBlobSummaries),
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
