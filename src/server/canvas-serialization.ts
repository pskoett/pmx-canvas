import { createHash } from 'node:crypto';
import { canvasState } from './canvas-state.js';
import type { CanvasAnnotation, CanvasLayout, CanvasNodeState, ViewportState } from './canvas-state.js';
import {
  normalizeCanvasNodeData,
  type CanvasNodeProvenance,
} from './canvas-provenance.js';
import { getCanvasNodeKind as getSharedCanvasNodeKind } from '../shared/canvas-node-kind.js';
import { canOpenNodeAsSurface } from '../shared/surface.js';

export interface SerializedCanvasNode extends CanvasNodeState {
  kind: string;
  title: string | null;
  content: string | null;
  path: string | null;
  url: string | null;
  surfaceUrl: string | null;
  provenance: CanvasNodeProvenance | null;
}

export interface SerializedCanvasLayout extends Omit<CanvasLayout, 'nodes'> {
  nodes: SerializedCanvasNode[];
}

export interface CanvasAnnotationSummary {
  id: string;
  type: CanvasAnnotation['type'];
  bounds: CanvasAnnotation['bounds'];
  color: string;
  width: number;
  pointCount: number;
  text: string | null;
  label: string | null;
  createdAt: string;
}

export interface CanvasAnnotationContextSummary {
  id: string;
  label: string | null;
  bounds: CanvasAnnotation['bounds'];
  targetNodeIds: string[];
  targetNodeTitles: string[];
  target: string;
}

interface BlobSummary {
  stored: 'sidecar';
  path: string;
  bytes: number;
  jsonBytes: number;
  sha256: string;
}

interface ExternalMcpAppHtmlSummary {
  omitted: 'external-mcp-app-html';
  resourceUri: string;
  bytes: number;
  sha256: string;
}

interface FileContentSummary {
  omitted: 'file-content';
  bytes: number;
  lineCount: number;
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
  if (node.type === 'html') {
    const primitive = typeof node.data.htmlPrimitive === 'string' ? node.data.htmlPrimitive : null;
    const description = pickString(node.data.description);
    return pickString(node.data.agentSummary)
      ?? pickString(node.data.contentSummary)
      ?? (primitive
        ? (description ? `${primitive}: ${description}` : primitive)
        : null);
  }
  return pickString(node.data.content)
    ?? pickString(node.data.fileContent)
    ?? pickString(node.data.text)
    ?? (node.type === 'file' ? pickString(node.data.path) : null)
    ?? (node.type === 'image' ? pickString(node.data.src) : null)
    ?? (node.type === 'webpage' ? pickString(node.data.url) : null)
    ?? null;
}

export function getCanvasNodeSurfaceUrl(node: CanvasNodeState, data: Record<string, unknown>): string | null {
  return canOpenNodeAsSurface(node.type, data)
    ? `/api/canvas/surface/${encodeURIComponent(node.id)}`
    : null;
}

export function serializeCanvasNode(node: CanvasNodeState): SerializedCanvasNode {
  const data = normalizeCanvasNodeData(node.type, node.data);
  const normalizedNode = { ...node, data };
  return {
    ...node,
    data,
    kind: getCanvasNodeKind(node, data),
    title: getCanvasNodeTitle(normalizedNode),
    content: getCanvasNodeContent(normalizedNode),
    path: pickString(data.path),
    url: pickString(data.url),
    surfaceUrl: getCanvasNodeSurfaceUrl(node, data),
    provenance: pickProvenance(data.provenance),
  };
}

function summarizeExternalMcpAppHtml(node: SerializedCanvasNode): Record<string, unknown> {
  const html = node.data.html;
  const resourceUri = node.data.resourceUri;
  if (
    node.type !== 'mcp-app' ||
    node.data.mode !== 'ext-app' ||
    typeof html !== 'string' ||
    html.length === 0 ||
    typeof resourceUri !== 'string' ||
    resourceUri.length === 0
  ) {
    return node.data;
  }

  return {
    ...node.data,
    html: {
      omitted: 'external-mcp-app-html',
      resourceUri,
      bytes: Buffer.byteLength(html, 'utf-8'),
      sha256: createHash('sha256').update(html).digest('hex'),
    } satisfies ExternalMcpAppHtmlSummary,
  };
}

export function serializeCanvasNodeForAgent(node: CanvasNodeState): SerializedCanvasNode {
  const serialized = serializeCanvasNode(node);
  return {
    ...serialized,
    data: summarizeExternalMcpAppHtml(serialized),
  };
}

export function serializeCanvasNodeCompact(node: CanvasNodeState): SerializedCanvasNode {
  const serialized = serializeCanvasNode(node);
  if (serialized.type !== 'file' || typeof serialized.data.fileContent !== 'string') return serialized;
  const fileContent = serialized.data.fileContent;
  return {
    ...serialized,
    content: serialized.path,
    data: {
      ...serialized.data,
      fileContent: {
        omitted: 'file-content',
        bytes: Buffer.byteLength(fileContent, 'utf-8'),
        lineCount: fileContent.split('\n').length,
        sha256: createHash('sha256').update(fileContent).digest('hex'),
      } satisfies FileContentSummary,
    },
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

export function serializeCanvasLayoutForAgent(layout: CanvasLayout): SerializedCanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(serializeCanvasNodeForAgent),
  };
}

export function serializeCanvasLayoutWithBlobSummaries(layout: CanvasLayout): SerializedCanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(serializeCanvasNodeWithBlobSummaries),
  };
}

export function summarizeCanvasAnnotation(annotation: CanvasAnnotation): CanvasAnnotationSummary {
  return {
    id: annotation.id,
    type: annotation.type,
    bounds: annotation.bounds,
    color: annotation.color,
    width: annotation.width,
    pointCount: annotation.points.length,
    text: annotation.text ?? null,
    label: annotation.label ?? annotation.text ?? null,
    createdAt: annotation.createdAt,
  };
}

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y;
}

export function summarizeCanvasAnnotationForContext(
  annotation: CanvasAnnotation,
  nodes: CanvasNodeState[],
): CanvasAnnotationContextSummary {
  const targetNodes = nodes.filter((node) => rectsOverlap(annotation.bounds, {
    x: node.position.x,
    y: node.position.y,
    width: node.size.width,
    height: node.size.height,
  }));
  const targetNodeTitles = targetNodes.map((node) => getCanvasNodeTitle(node) ?? node.id);
  return {
    id: annotation.id,
    label: annotation.label ?? annotation.text ?? null,
    bounds: annotation.bounds,
    targetNodeIds: targetNodes.map((node) => node.id),
    targetNodeTitles,
    target: targetNodeTitles.length > 0 ? targetNodeTitles.join(', ') : 'empty canvas region',
  };
}

export interface CanvasSummary {
  totalNodes: number;
  totalEdges: number;
  totalAnnotations: number;
  annotations: CanvasAnnotationContextSummary[];
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
    totalAnnotations: layout.annotations.length,
    annotations: layout.annotations.map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
    nodesByType: typeCounts,
    pinnedCount: pinnedIds.size,
    pinnedTitles,
    viewport: layout.viewport,
  };
}
