/**
 * Slice 1 operations (plan-005): node.add / node.get / node.update /
 * node.remove / layout.get — plus the shared cores the SDK wraps directly
 * (`createBasicCanvasNode`, `buildNodePatch`, `removeNodeCore`) and the
 * shared helpers that used to live in server.ts / mcp/server.ts
 * (buildNodeResponse, geometry resolvers, group-children helpers,
 * closeNodeAppSession, MCP payload formatters).
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import {
  canvasState,
  type CanvasAnnotation,
  type CanvasLayout,
  type CanvasNodeState,
} from '../../canvas-state.js';
import {
  addCanvasNode,
  createCanvasGroup,
  buildStructuredNodeUpdate,
  hasStructuredNodeUpdateFields,
  hasTraceNodeDataFields,
  mergeTraceNodeDataFields,
  refreshCanvasWebpageNode,
  removeCanvasNode,
  resolveHtmlContent,
  scheduleCodeGraphRecompute,
  validateCanvasNodePatch,
  MARKDOWN_NODE_DEFAULT_SIZE,
  MCP_APP_NODE_DEFAULT_SIZE,
  IMAGE_NODE_DEFAULT_SIZE,
  LEDGER_NODE_DEFAULT_SIZE,
} from '../../canvas-operations.js';
import { normalizeNodeAxCapabilities } from '../../ax-interaction.js';
import { buildHtmlPrimitive, getHtmlPrimitiveSemanticMetadata, isHtmlPrimitiveKind } from '../../html-primitives.js';
import { closeMcpAppSession } from '../../mcp-app-runtime.js';
import {
  getCanvasNodeTitle,
  type SerializedCanvasNode,
  serializeCanvasLayout,
  serializeCanvasLayoutForAgent,
  serializeCanvasLayoutWithBlobSummaries,
  serializeCanvasNode,
  serializeCanvasNodeForAgent,
  serializeCanvasNodeWithBlobSummaries,
  summarizeCanvasAnnotationForContext,
} from '../../canvas-serialization.js';
import { WEBPAGE_NODE_DEFAULT_SIZE, normalizeWebpageUrl } from '../../webpage-node.js';
import { defineOperation, OperationError, type Operation, type OperationContext } from '../types.js';

// ── Node types ────────────────────────────────────────────────
// Single definition site for the basic node-type list: drives the HTTP type
// guard (formerly the VALID_NODE_TYPES Set in server.ts), the error message,
// and the MCP type enum.
export const NODE_TYPES = [
  'markdown',
  'status',
  'context',
  'ledger',
  'trace',
  'file',
  'image',
  'mcp-app',
  'webpage',
  'html',
  'group',
] as const;

const NODE_TYPE_SET = new Set<string>(NODE_TYPES);

/** Per-type default node frame size (formerly copy-pasted ladders). */
export function defaultNodeSize(type: string): { width: number; height: number } {
  switch (type) {
    case 'html':
      return { width: 720, height: 640 };
    case 'markdown':
      return MARKDOWN_NODE_DEFAULT_SIZE;
    case 'mcp-app':
      return MCP_APP_NODE_DEFAULT_SIZE;
    case 'image':
      return IMAGE_NODE_DEFAULT_SIZE;
    case 'ledger':
      return LEDGER_NODE_DEFAULT_SIZE;
    default:
      return { width: 360, height: 200 };
  }
}

// ── Shared helpers (moved from server.ts) ─────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function pickFiniteNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function pickPositiveNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = pickFiniteNumber(record, key);
  return value !== undefined && value > 0 ? value : undefined;
}

function normalizeGeometryInput(body: Record<string, unknown>): {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  position?: { x?: number; y?: number };
  size?: { width?: number; height?: number };
} {
  const position = getRecord(body.position);
  const size = getRecord(body.size);
  return {
    ...(pickFiniteNumber(body, 'x') !== undefined ? { x: pickFiniteNumber(body, 'x') } : {}),
    ...(pickFiniteNumber(body, 'y') !== undefined ? { y: pickFiniteNumber(body, 'y') } : {}),
    ...(pickFiniteNumber(body, 'width') !== undefined ? { width: pickFiniteNumber(body, 'width') } : {}),
    ...(pickFiniteNumber(body, 'height') !== undefined ? { height: pickFiniteNumber(body, 'height') } : {}),
    ...(position ? {
      position: {
        ...(pickFiniteNumber(position, 'x') !== undefined ? { x: pickFiniteNumber(position, 'x') } : {}),
        ...(pickFiniteNumber(position, 'y') !== undefined ? { y: pickFiniteNumber(position, 'y') } : {}),
      },
    } : {}),
    ...(size ? {
      size: {
        ...(pickFiniteNumber(size, 'width') !== undefined ? { width: pickFiniteNumber(size, 'width') } : {}),
        ...(pickFiniteNumber(size, 'height') !== undefined ? { height: pickFiniteNumber(size, 'height') } : {}),
      },
    } : {}),
  };
}

export function resolveCreateGeometry(body: Record<string, unknown>): {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
} {
  const geometry = normalizeGeometryInput(body);
  const x = geometry.x ?? geometry.position?.x;
  const y = geometry.y ?? geometry.position?.y;
  const width = geometry.width ?? geometry.size?.width;
  const height = geometry.height ?? geometry.size?.height;
  return {
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
  };
}

function resolvePatchGeometry(
  body: Record<string, unknown>,
  existing: CanvasNodeState,
): {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
} {
  const geometry = normalizeGeometryInput(body);
  const x = geometry.x ?? geometry.position?.x;
  const y = geometry.y ?? geometry.position?.y;
  const width = geometry.width ?? geometry.size?.width;
  const height = geometry.height ?? geometry.size?.height;
  return {
    ...(x !== undefined || y !== undefined
      ? { position: { x: x ?? existing.position.x, y: y ?? existing.position.y } }
      : {}),
    ...(width !== undefined || height !== undefined
      ? { size: { width: width ?? existing.size.width, height: height ?? existing.size.height } }
      : {}),
  };
}

type StringListField = { value?: string[]; error?: string };

function parseStringListField(field: string, value: unknown): StringListField {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: `"${field}" must be an array of node IDs.` };
  const invalid = value.find((item) => typeof item !== 'string' || item.trim().length === 0);
  if (invalid !== undefined) return { error: `"${field}" must contain only non-empty node IDs.` };
  return { value };
}

function pickGroupChildIds(body: Record<string, unknown>): StringListField {
  if ('children' in body) return parseStringListField('children', body.children);
  if ('childIds' in body) return parseStringListField('childIds', body.childIds);
  const data = isRecord(body.data) ? body.data : undefined;
  return data && 'children' in data ? parseStringListField('data.children', data.children) : {};
}

function validateGroupChildIds(groupId: string, childIds: string[]): string | null {
  const missingChildIds = childIds.filter((id) => !canvasState.getNode(id));
  if (missingChildIds.length > 0) {
    return `Missing child node ID${missingChildIds.length === 1 ? '' : 's'}: ${missingChildIds.join(', ')}.`;
  }
  const invalidChildIds = childIds.filter((id) => {
    const node = canvasState.getNode(id);
    return id === groupId || node?.type === 'group';
  });
  if (invalidChildIds.length > 0) {
    return `Invalid group child ID${invalidChildIds.length === 1 ? '' : 's'}: ${invalidChildIds.join(', ')}.`;
  }
  return null;
}

export function setGroupChildrenFromApi(groupId: string, childIds: string[]): boolean {
  const group = canvasState.getNode(groupId);
  if (!group || group.type !== 'group') return false;

  const dataChildIds = Array.isArray(group.data.children)
    ? group.data.children.filter((id): id is string => typeof id === 'string')
    : [];
  const parentBackrefIds = canvasState.getLayout().nodes
    .filter((node) => node.id !== groupId && node.data.parentGroup === groupId)
    .map((node) => node.id);
  const currentChildIds = [...new Set([...dataChildIds, ...parentBackrefIds])];
  if (currentChildIds.length > 0) {
    if (currentChildIds.length !== dataChildIds.length || currentChildIds.some((id) => !dataChildIds.includes(id))) {
      canvasState.updateNode(groupId, { data: { ...group.data, children: currentChildIds } });
    }
    canvasState.ungroupNodes(groupId);
  }
  if (childIds.length === 0) return true;

  const latestGroup = canvasState.getNode(groupId);
  return canvasState.groupNodes(groupId, childIds, {
    preservePositions: true,
    keepGroupFrame: latestGroup?.data.frameMode === 'manual',
  });
}

export function nodeAppSessionId(node: CanvasNodeState | undefined): string | null {
  if (!node || node.type !== 'mcp-app') return null;
  const sessionId = node.data.appSessionId;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId : null;
}

export function closeNodeAppSession(node: CanvasNodeState | undefined): void {
  const sessionId = nodeAppSessionId(node);
  if (sessionId) closeMcpAppSession(sessionId);
}

export function buildNodeResponse(node: CanvasNodeState): Record<string, unknown> {
  const serialized = serializeCanvasNode(node);
  return {
    ok: true,
    node: serialized,
    ...serialized,
    // `nodeId` aliases `id` so HTTP/CLI node-create responses match the MCP
    // createdNodePayload — agents using either key (or a cached schema) work.
    nodeId: node.id,
  };
}

function withContextPinReadState(node: CanvasNodeState): CanvasNodeState {
  return {
    ...node,
    pinned: node.pinned || canvasState.contextPinnedNodeIds.has(node.id),
  };
}

function withContextPinLayoutReadState(layout: CanvasLayout): CanvasLayout {
  return {
    ...layout,
    nodes: layout.nodes.map(withContextPinReadState),
  };
}

// ── MCP payload formatters (moved from mcp/server.ts) ─────────

export function wantsFullPayload(input: Record<string, unknown> = {}): boolean {
  return input.full === true || input.verbose === true || input.includeData === true;
}

export function compactNodePayload(node: CanvasNodeState | undefined): Record<string, unknown> | null {
  if (!node) return null;
  const serialized = serializeCanvasNode(node);
  return {
    id: serialized.id,
    type: serialized.type,
    kind: serialized.kind,
    title: serialized.title,
    content: serialized.content,
    position: serialized.position,
    size: serialized.size,
    pinned: serialized.pinned,
    collapsed: serialized.collapsed,
    dockPosition: serialized.dockPosition,
    provenance: serialized.provenance,
  };
}

export function buildSummaryFromLayout(layout: CanvasLayout, pinnedIds: string[]): Record<string, unknown> {
  const pinned = new Set(pinnedIds);
  const nodesByType: Record<string, number> = {};
  const pinnedTitles: string[] = [];
  for (const node of layout.nodes) {
    const serialized = serializeCanvasNode(node);
    nodesByType[serialized.kind] = (nodesByType[serialized.kind] ?? 0) + 1;
    if (pinned.has(node.id)) pinnedTitles.push(getCanvasNodeTitle(node) ?? node.id);
  }
  return {
    totalNodes: layout.nodes.length,
    totalEdges: layout.edges.length,
    totalAnnotations: (layout.annotations ?? []).length,
    annotations: (layout.annotations ?? []).map((annotation: CanvasAnnotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
    nodesByType,
    pinnedCount: pinned.size,
    pinnedTitles,
    viewport: layout.viewport,
  };
}

export function compactLayoutPayload(layout: CanvasLayout, pinnedIds: string[]): Record<string, unknown> {
  return {
    summary: buildSummaryFromLayout(layout, pinnedIds),
    viewport: layout.viewport,
    annotations: (layout.annotations ?? []).map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
    nodes: layout.nodes.map((node) => compactNodePayload(node)).filter((node): node is Record<string, unknown> => node !== null),
    edges: layout.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.style ? { style: edge.style } : {}),
      ...(edge.animated !== undefined ? { animated: edge.animated } : {}),
    })),
  };
}

export function agentSafeFullLayoutPayload(layout: CanvasLayout): Record<string, unknown> {
  return {
    ...serializeCanvasLayoutForAgent(layout),
    annotations: (layout.annotations ?? []).map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
  };
}

/**
 * Node-create/update MCP payload: exposes both `id` and a `nodeId` alias so
 * agents using either key (or a cached schema) work — matching the
 * external-app / web-artifact responses that already return both.
 */
export function createdNodePayloadFromNode(node: CanvasNodeState, options: Record<string, unknown> = {}): Record<string, unknown> {
  if (!wantsFullPayload(options)) {
    return { ok: true, node: compactNodePayload(node), id: node.id, nodeId: node.id };
  }
  const serialized = serializeCanvasNodeForAgent(node);
  return { ok: true, node: serialized, ...serialized, nodeId: node.id };
}

// ── Operation cores (the SDK wraps these directly) ────────────

/**
 * Create a basic (non-webpage / non-group / non-primitive) node. Union of the
 * legacy handleCanvasAddNode generic branch; the SDK passes fileMode 'path',
 * the HTTP/MCP operation passes fileMode 'auto'.
 */
export function createBasicCanvasNode(
  body: Record<string, unknown>,
  options: { fileMode: 'auto' | 'path' },
): { node: CanvasNodeState; needsCodeGraphRecompute: boolean } {
  const type = typeof body.type === 'string' ? body.type : '';
  const extraData = isRecord(body.data) ? body.data : undefined;
  if (type === 'html') {
    if ('html' in body && typeof body.html !== 'string') {
      throw new OperationError('HTML node field "html" must be a string.');
    }
    if (extraData && 'html' in extraData && typeof extraData.html !== 'string') {
      throw new OperationError('HTML node field "data.html" must be a string.');
    }
  }
  const content = type === 'image' && typeof body.path === 'string' && typeof body.content !== 'string'
    ? body.path
    : body.content;
  // For html nodes, accept top-level `html` AND `axCapabilities` and merge into data
  // so callers can POST { type: 'html', title, html, axCapabilities } without nesting
  // under `data` (report #53 — transport parity with MCP canvas_add_html_node). A
  // top-level value overrides the same key under `data` (mirrors the `html` precedence).
  const topAxCapabilities = type === 'html' ? normalizeNodeAxCapabilities(body.axCapabilities) : null;
  const htmlMergedData = type === 'html'
    ? {
        ...(extraData ?? {}),
        ...(typeof body.html === 'string' ? { html: resolveHtmlContent(body.html) } : {}),
        ...(typeof body.summary === 'string' ? { summary: body.summary } : {}),
        ...(typeof body.agentSummary === 'string' ? { agentSummary: body.agentSummary } : {}),
        ...(typeof body.description === 'string' ? { description: body.description } : {}),
        ...(body.presentation === true ? { presentation: true } : {}),
        ...(Array.isArray(body.slideTitles) ? { slideTitles: body.slideTitles } : {}),
        ...(Array.isArray(body.embeddedNodeIds) ? { embeddedNodeIds: body.embeddedNodeIds } : {}),
        ...(Array.isArray(body.embeddedUrls) ? { embeddedUrls: body.embeddedUrls } : {}),
        ...(topAxCapabilities ? { axCapabilities: topAxCapabilities } : {}),
      }
    : extraData;
  const geometry = resolveCreateGeometry(body);
  const defaults = defaultNodeSize(type);
  try {
    const { node, needsCodeGraphRecompute } = addCanvasNode({
      type: type as CanvasNodeState['type'],
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof content === 'string' ? { content } : {}),
      ...(htmlMergedData && Object.keys(htmlMergedData).length > 0 ? { data: htmlMergedData } : {}),
      ...(type === 'trace' && typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
      ...(type === 'trace' && typeof body.category === 'string' ? { category: body.category } : {}),
      ...(type === 'trace' && typeof body.status === 'string' ? { status: body.status } : {}),
      ...(type === 'trace' && typeof body.duration === 'string' ? { duration: body.duration } : {}),
      ...(type === 'trace' && typeof body.resultSummary === 'string' ? { resultSummary: body.resultSummary } : {}),
      ...(type === 'trace' && typeof body.error === 'string' ? { error: body.error } : {}),
      ...(body.strictSize === true ? { strictSize: true } : {}),
      ...geometry,
      defaultWidth: defaults.width,
      defaultHeight: defaults.height,
      fileMode: options.fileMode,
    });
    return { node, needsCodeGraphRecompute };
  } catch (error) {
    if (error instanceof OperationError) throw error;
    throw new OperationError(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Build a node patch with the full HTTP superset semantics (webpage
 * titleSource, html top-level fields, axCapabilities merge, group children,
 * structured spec/graph updates, trace fields). Throws OperationError on
 * validation failures. The SDK's updateNode delegates here.
 */
export function buildNodePatch(
  existing: CanvasNodeState,
  body: Record<string, unknown>,
): { patch: Partial<CanvasNodeState>; groupChildIds?: string[] } {
  const groupChildList = existing.type === 'group' ? pickGroupChildIds(body) : {};
  if (groupChildList.error) throw new OperationError(`Cannot update group: ${groupChildList.error}`);
  const groupChildIds = groupChildList.value;
  if (groupChildIds !== undefined) {
    const childError = validateGroupChildIds(existing.id, groupChildIds);
    if (childError) throw new OperationError(`Cannot update group: ${childError}`);
  }
  const patch: Record<string, unknown> = resolvePatchGeometry(body, existing);
  if (body.collapsed !== undefined) patch.collapsed = body.collapsed;
  if (body.pinned !== undefined) patch.pinned = Boolean(body.pinned);
  if (body.dockPosition === null || body.dockPosition === 'left' || body.dockPosition === 'right') {
    patch.dockPosition = body.dockPosition;
  }
  if (hasStructuredNodeUpdateFields(body)) {
    try {
      patch.data = buildStructuredNodeUpdate(existing, body).data;
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
  } else if (
    body.title !== undefined ||
    body.content !== undefined ||
    body.data ||
    typeof body.arrangeLocked === 'boolean' ||
    typeof body.strictSize === 'boolean' ||
    (existing.type === 'trace' && hasTraceNodeDataFields(body)) ||
    (existing.type === 'html' && body.html !== undefined) ||
    body.axCapabilities !== undefined
  ) {
    const data = { ...existing.data };
    if (body.title !== undefined) {
      data.title = String(body.title);
      if (existing.type === 'webpage') {
        data.titleSource = 'user';
      }
    }
    if (body.content !== undefined) data.content = String(body.content);
    if (typeof body.arrangeLocked === 'boolean') data.arrangeLocked = body.arrangeLocked;
    if (typeof body.strictSize === 'boolean') data.strictSize = body.strictSize;
    // Merge extra data fields (for status, context, ledger, trace nodes)
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      Object.assign(data, body.data as Record<string, unknown>);
    }
    // Report #53: accept top-level `html` on PATCH too (top-level overrides the
    // `data.*` merge above — matches POST + MCP parity).
    if (existing.type === 'html' && body.html !== undefined) {
      if (typeof body.html !== 'string') {
        throw new OperationError('HTML node field "html" must be a string.');
      }
      data.html = resolveHtmlContent(body.html);
    }
    // Top-level `axCapabilities` merges into node data for any node type (the
    // legacy MCP canvas_update_node behavior; the html-only HTTP special case
    // is generalized here). Capabilities are clamped to the node-type ceiling
    // at interaction time.
    const patchAxCapabilities = normalizeNodeAxCapabilities(body.axCapabilities);
    if (patchAxCapabilities) data.axCapabilities = patchAxCapabilities;
    if (existing.type === 'webpage') {
      const nextUrl = typeof body.url === 'string'
        ? body.url
        : typeof (body.data as Record<string, unknown> | undefined)?.url === 'string'
          ? (body.data as Record<string, unknown>).url as string
          : undefined;
      if (typeof nextUrl === 'string' && nextUrl.trim().length > 0) {
        try {
          data.url = normalizeWebpageUrl(nextUrl);
        } catch (error) {
          throw new OperationError(error instanceof Error ? error.message : 'Invalid webpage URL.');
        }
      }
    }
    patch.data = existing.type === 'trace'
      ? mergeTraceNodeDataFields(data, body)
      : data;
  }
  const error = validateCanvasNodePatch({
    ...(patch.position ? { position: patch.position as { x: number; y: number } } : {}),
    ...(patch.size ? { size: patch.size as { width: number; height: number } } : {}),
  });
  if (error) throw new OperationError(error);
  return {
    patch: patch as Partial<CanvasNodeState>,
    ...(groupChildIds !== undefined ? { groupChildIds } : {}),
  };
}

/**
 * Remove a node (closing any mcp-app session). Missing id → OperationError 404
 * on ALL surfaces (plan-005 deliberately unifies the old silent local success).
 */
export function removeNodeCore(id: string): { needsCodeGraphRecompute: boolean } {
  const existing = canvasState.getNode(id);
  if (!existing) throw new OperationError(`Node "${id}" not found.`, 404);
  closeNodeAppSession(existing);
  const { removed, needsCodeGraphRecompute } = removeCanvasNode(id);
  if (!removed) throw new OperationError(`Node "${id}" not found.`, 404);
  return { needsCodeGraphRecompute };
}

// ── node.add ──────────────────────────────────────────────────

interface NodeAddResult {
  node: CanvasNodeState;
  extras?: Record<string, unknown>;
}

async function createWebpageNode(body: Record<string, unknown>, ctx: OperationContext): Promise<NodeAddResult> {
  const rawUrl = typeof body.url === 'string' && body.url.trim().length > 0
    ? body.url
    : typeof body.content === 'string'
      ? body.content
      : '';

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeWebpageUrl(rawUrl);
  } catch (error) {
    throw new OperationError(error instanceof Error ? error.message : 'Invalid webpage URL.');
  }

  const extraData = isRecord(body.data) ? body.data : undefined;
  const geometry = resolveCreateGeometry(body);
  const { id, node } = addCanvasNode({
    type: 'webpage',
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    content: normalizedUrl,
    ...(extraData ? { data: extraData } : {}),
    ...(body.strictSize === true ? { strictSize: true } : {}),
    ...geometry,
    ...(geometry.width === undefined ? { width: WEBPAGE_NODE_DEFAULT_SIZE.width } : {}),
    ...(geometry.height === undefined ? { height: WEBPAGE_NODE_DEFAULT_SIZE.height } : {}),
  });

  // The node should appear before the (slow) page fetch completes; the
  // registry emits the final layout update after the handler returns.
  ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
  const refreshed = await refreshCanvasWebpageNode(id);
  const created = canvasState.getNode(id) ?? node;
  return {
    node: created,
    extras: {
      fetch: refreshed.ok
        ? { ok: true }
        : { ok: false, error: refreshed.error ?? 'Failed to fetch webpage content.' },
      ...(refreshed.ok ? {} : { error: refreshed.error }),
    },
  };
}

function createHtmlPrimitiveNode(body: Record<string, unknown>): NodeAddResult {
  const rawKind = typeof body.primitive === 'string' ? body.primitive : body.kind;
  if (typeof rawKind !== 'string' || !isHtmlPrimitiveKind(rawKind)) {
    throw new OperationError(`Unknown HTML primitive: ${String(rawKind)}.`);
  }
  const data = isRecord(body.data) ? body.data : {};
  let built: ReturnType<typeof buildHtmlPrimitive>;
  try {
    built = buildHtmlPrimitive({
      kind: rawKind,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      data,
    });
  } catch (error) {
    throw new OperationError(error instanceof Error ? error.message : String(error));
  }
  const geometry = resolveCreateGeometry(body);
  const { node } = addCanvasNode({
    type: 'html',
    title: built.title,
    data: {
      html: built.html,
      htmlPrimitive: built.kind,
      primitiveData: built.data,
      description: built.summary,
      agentSummary: typeof data.agentSummary === 'string' ? data.agentSummary : built.summary,
      ...(typeof data.summary === 'string' ? { summary: data.summary } : {}),
      ...getHtmlPrimitiveSemanticMetadata(built.data),
    },
    ...(body.strictSize === true ? { strictSize: true } : {}),
    ...geometry,
    defaultWidth: built.defaultSize.width,
    defaultHeight: built.defaultSize.height,
  });
  return {
    node,
    extras: {
      primitive: {
        kind: built.kind,
        title: built.title,
        htmlBytes: Buffer.byteLength(built.html, 'utf-8'),
        defaultSize: built.defaultSize,
      },
    },
  };
}

function createGroupNode(body: Record<string, unknown>): NodeAddResult {
  const geometry = resolveCreateGeometry(body);
  const childList = pickGroupChildIds(body);
  if (childList.error) throw new OperationError(`Cannot create group: ${childList.error}`);
  const childIds = childList.value ?? [];
  const childError = validateGroupChildIds('', childIds);
  if (childError) throw new OperationError(`Cannot create group: ${childError}`);
  const childLayout = body.childLayout === 'grid' || body.childLayout === 'column' || body.childLayout === 'flow'
    ? body.childLayout
    : undefined;
  const { node } = createCanvasGroup({
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    childIds,
    ...(typeof body.color === 'string' ? { color: body.color } : {}),
    ...(childLayout ? { childLayout } : {}),
    ...geometry,
  });
  return { node };
}

const nodeAddShape = {
  intentId: z.string().optional().catch(undefined).describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  type: z.string().optional().catch(undefined).describe('Node type (prefer canvas_group {action:"create"} for groups)'),
  title: z.string().optional().catch(undefined).describe('Node title'),
  content: z.string().optional().catch(undefined).describe('Node content (markdown for markdown nodes, file path for file nodes, image path/URL/data-URI for image nodes, URL for webpage nodes)'),
  path: z.string().optional().catch(undefined).describe('Compatibility alias for image node content. Prefer content for image paths.'),
  url: z.string().optional().catch(undefined).describe('Canonical webpage URL field for webpage nodes. Overrides content when both are provided.'),
  x: z.number().optional().catch(undefined).describe('X position (auto-placed if omitted)'),
  y: z.number().optional().catch(undefined).describe('Y position (auto-placed if omitted)'),
  width: z.number().optional().catch(undefined).describe('Width in pixels (default: 720)'),
  height: z.number().optional().catch(undefined).describe('Height in pixels (default: 600)'),
  strictSize: z.boolean().optional().catch(undefined).describe('Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting'),
  children: z.unknown().optional().describe('Group-only alias for childIds. Node IDs to include in a generic group node.'),
  childIds: z.unknown().optional().describe('Group-only field. Node IDs to include in a generic group node. Prefer canvas_group {action:"create"} for groups.'),
  childLayout: z.enum(['grid', 'column', 'flow']).optional().catch(undefined).describe('Group-only optional layout for grouped children.'),
  color: z.string().optional().catch(undefined).describe('Group-only frame accent color.'),
  toolName: z.string().optional().catch(undefined).describe('Trace node tool or operation label'),
  category: z.string().optional().catch(undefined).describe('Trace node category: mcp, file, subagent, or other'),
  status: z.string().optional().catch(undefined).describe('Trace node status: running, success, or failed'),
  duration: z.string().optional().catch(undefined).describe('Trace node duration badge text'),
  resultSummary: z.string().optional().catch(undefined).describe('Trace node result summary'),
  error: z.string().optional().catch(undefined).describe('Trace node error message'),
  data: z.unknown().optional().describe('Extra node data merged into the created node.'),
  html: z.unknown().optional().describe('HTML node document/fragment (html nodes only).'),
  primitive: z.unknown().optional().describe('HTML primitive kind (html-primitive creation).'),
  kind: z.unknown().optional().describe('Alias for primitive.'),
  summary: z.string().optional().catch(undefined).describe('Agent-readable semantic summary (html nodes).'),
  agentSummary: z.string().optional().catch(undefined).describe('Explicit agent-readable summary (html nodes).'),
  description: z.string().optional().catch(undefined).describe('Short description included in search and pinned/spatial context (html nodes).'),
  presentation: z.boolean().optional().catch(undefined).describe('Marks an html node as a fullscreen presentation/deck.'),
  slideTitles: z.unknown().optional().describe('Agent-readable slide titles for presentation HTML.'),
  embeddedNodeIds: z.unknown().optional().describe('Canvas node IDs embedded or represented by this HTML surface.'),
  embeddedUrls: z.unknown().optional().describe('URLs embedded or represented by this HTML surface.'),
  axCapabilities: z.unknown().optional().describe('Opt an html node into AX interactions. Merged into node data for html nodes; clamped to the node-type ceiling server-side.'),
  position: z.unknown().optional().describe('Geometry alias: { x, y } object form.'),
  size: z.unknown().optional().describe('Geometry alias: { width, height } object form.'),
};

const nodeAddSchema = z.looseObject(nodeAddShape);

const fullVerboseShape = {
  full: z.boolean().optional().describe('Return the full created node payload. Default false returns compact metadata.'),
  verbose: z.boolean().optional().describe('Alias for full:true.'),
};

const nodeAddOperation = defineOperation<z.infer<typeof nodeAddSchema>, NodeAddResult>({
  name: 'node.add',
  mutates: true,
  input: nodeAddSchema,
  inputShape: nodeAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/node',
  },
  mcp: {
    toolName: 'canvas_add_node',
    description: 'Add a basic node to the canvas. Returns the created node with normalized title/content and rendered geometry. Supported here: markdown, status, context, ledger, trace, file, image, webpage, mcp-app, html, group. Dedicated routes: json-render -> canvas_render {action:"add-json-render"}, graph -> canvas_render {action:"add-graph"}, web-artifact -> canvas_app {action:"build-artifact"}, external apps -> canvas_app {action:"open-mcp-app"}, groups -> canvas_group {action:"create"}. Call canvas_render {action:"describe-schema"} for the full nodeTypeRouting table.',
    extraShape: {
      type: z.enum(['markdown', 'status', 'context', 'ledger', 'trace', 'file', 'image', 'webpage', 'mcp-app', 'html', 'group'])
        .describe('Node type (prefer canvas_group {action:"create"} for groups)'),
      children: z.array(z.string()).optional().describe('Group-only alias for childIds. Node IDs to include in a generic group node.'),
      childIds: z.array(z.string()).optional().describe('Group-only field. Node IDs to include in a generic group node. Prefer canvas_group {action:"create"} for groups.'),
      axCapabilities: z.object({
        enabled: z.boolean().optional(),
        allowed: z.array(z.string()).optional(),
      }).optional().describe('Opt an html node into AX interactions (e.g. { enabled: true, allowed: ["ax.work.create"] }) so its sandboxed UI can emit ax.* via window.PMX_AX.emit. html nodes are AX-disabled by default; merged into node data, clamped to the node-type ceiling server-side.'),
      ...fullVerboseShape,
    },
    buildInput: (input) => {
      if (input.type === 'webpage') {
        const url = (typeof input.url === 'string' ? input.url : undefined)
          ?? (typeof input.content === 'string' ? input.content : undefined);
        if (!url) {
          throw new OperationError('Webpage nodes require a page URL via "url" (preferred) or "content".');
        }
      }
      return input;
    },
    formatResult: (result, input) => {
      const body = isRecord(result) ? result : {};
      if (input.type === 'webpage') {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(body) }],
          ...(body.ok === false ? { isError: true } : {}),
        };
      }
      const node = body.node as CanvasNodeState | undefined;
      const payload = node ? createdNodePayloadFromNode(node, input) : { ok: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  },
  handler: async (input, ctx) => {
    const body: Record<string, unknown> = input;
    const type = typeof body.type === 'string' ? body.type : '';
    // Report #50: require a resolvable type rather than silently defaulting to a
    // markdown node — an empty / type-less body created a phantom node before.
    if (!type) {
      throw new OperationError(
        `node creation requires a 'type' — pass it in the JSON body ({ "type": "markdown", ... }) or as a ?type= query param. Valid types: ${NODE_TYPES.join(', ')} (json-render / graph / web-artifact have dedicated endpoints).`,
      );
    }
    if (!NODE_TYPE_SET.has(type)) {
      if (type === 'json-render') {
        throw new OperationError('Node type "json-render" is created via POST /api/canvas/json-render. See /api/canvas/schema for the required spec shape.');
      }
      if (type === 'graph') {
        throw new OperationError('Node type "graph" is created via POST /api/canvas/graph. See /api/canvas/schema for graphType + data fields.');
      }
      if (type === 'web-artifact') {
        throw new OperationError('Node type "web-artifact" is created via POST /api/canvas/web-artifact with appTsx + title.');
      }
      if (type === 'html-primitive') {
        return createHtmlPrimitiveNode(body);
      }
      throw new OperationError(`Invalid node type: "${type}".`);
    }
    if (type === 'webpage') {
      return await createWebpageNode(body, ctx);
    }
    if (type === 'html' && (typeof body.primitive === 'string' || typeof body.kind === 'string')) {
      return createHtmlPrimitiveNode(body);
    }
    if (type === 'group') {
      return createGroupNode(body);
    }
    const { node, needsCodeGraphRecompute } = createBasicCanvasNode(body, { fileMode: 'auto' });
    if (needsCodeGraphRecompute) {
      scheduleCodeGraphRecompute(() => {
        ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
      });
    }
    return { node };
  },
  serialize: ({ node, extras }) => ({ ...buildNodeResponse(node), ...(extras ?? {}) }),
});

// ── node.get ──────────────────────────────────────────────────

const nodeGetShape = {
  id: z.string().describe('The node ID to retrieve'),
  includeBlobs: z.unknown().optional().describe('Include full blob payloads instead of blob summaries.'),
};

const nodeGetSchema = z.looseObject(nodeGetShape);

const nodeGetOperation = defineOperation<z.infer<typeof nodeGetSchema>, SerializedCanvasNode>({
  name: 'node.get',
  mutates: false,
  input: nodeGetSchema,
  inputShape: nodeGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/node/:id',
  },
  mcp: {
    toolName: 'canvas_get_node',
    description: 'Get a single node by ID. Defaults to compact metadata; pass full:true to include full data/tool results.',
    extraShape: {
      full: z.boolean().optional().describe('Include full node data, including mcp-app tool results. Default false.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    buildInput: (input) => ({ id: input.id, includeBlobs: true }),
    formatResult: (result, input) => {
      const node = result as CanvasNodeState;
      const payload = wantsFullPayload(input) ? serializeCanvasNodeForAgent(node) : compactNodePayload(node);
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  },
  handler: ({ id, includeBlobs }) => {
    const full = includeBlobs === true || includeBlobs === 'true';
    const node = full ? canvasState.getNode(id) : canvasState.getNodeForPersistence(id);
    if (!node) throw new OperationError(`Node "${id}" not found.`, 404);
    const responseNode = withContextPinReadState(node);
    return full
      ? serializeCanvasNode(responseNode)
      : serializeCanvasNodeWithBlobSummaries(responseNode);
  },
});

// ── node.update ───────────────────────────────────────────────

const nodeUpdateShape = {
  id: z.string().describe('Node ID to update'),
  intentId: z.string().optional().catch(undefined).describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
  title: z.unknown().optional().describe('New title'),
  content: z.unknown().optional().describe('New content'),
  x: z.number().optional().catch(undefined).describe('New X position'),
  y: z.number().optional().catch(undefined).describe('New Y position'),
  width: z.number().optional().catch(undefined).describe('New width'),
  height: z.number().optional().catch(undefined).describe('New height'),
  position: z.unknown().optional().describe('Geometry alias: { x, y } object form.'),
  size: z.unknown().optional().describe('Geometry alias: { width, height } object form.'),
  spec: z.unknown().optional().describe('New json-render spec, or a graph payload with graphType/data for graph nodes'),
  graphType: z.unknown().optional().describe('Graph type when updating a graph node'),
  data: z.unknown().optional().describe('Graph dataset (array) when updating a graph node, or extra data fields (object) merged into the node data'),
  xKey: z.unknown().optional().describe('Graph x/category key'),
  yKey: z.unknown().optional().describe('Graph y/value key'),
  chartHeight: z.unknown().optional().describe('Graph chart content height, distinct from node height'),
  toolName: z.string().optional().catch(undefined).describe('Trace node tool or operation label'),
  category: z.string().optional().catch(undefined).describe('Trace node category: mcp, file, subagent, or other'),
  status: z.string().optional().catch(undefined).describe('Trace node status: running, success, or failed'),
  duration: z.string().optional().catch(undefined).describe('Trace node duration badge text'),
  resultSummary: z.string().optional().catch(undefined).describe('Trace node result summary'),
  error: z.string().optional().catch(undefined).describe('Trace node error message'),
  collapsed: z.unknown().optional().describe('Collapse or expand the node'),
  dockPosition: z.unknown().optional().describe('Dock the node to the left/right HUD column, or pass null to return it to the canvas'),
  pinned: z.unknown().optional().describe('Pin or unpin the node to exclude it from auto-arrange'),
  arrangeLocked: z.boolean().optional().catch(undefined).describe('Prevent auto-arrange from moving this node. Pinned nodes are also skipped.'),
  strictSize: z.boolean().optional().catch(undefined).describe('Keep explicit width/height fixed and scroll overflowing content.'),
  axCapabilities: z.unknown().optional().describe('Enable/disable AX interactions on an existing node. Merged into the node data; clamped to the node-type ceiling server-side.'),
  html: z.unknown().optional().describe('New HTML document/fragment (html nodes only).'),
  url: z.unknown().optional().describe('New URL for webpage nodes.'),
  refresh: z.unknown().optional().describe('Webpage nodes: pass true to re-fetch the page instead of patching fields.'),
  children: z.unknown().optional().describe('Group nodes: replacement child node ID list.'),
  childIds: z.unknown().optional().describe('Group nodes: alias for children.'),
};

const nodeUpdateSchema = z.looseObject(nodeUpdateShape);

const nodeUpdateOperation = defineOperation<z.infer<typeof nodeUpdateSchema>, Record<string, unknown>>({
  name: 'node.update',
  mutates: true,
  input: nodeUpdateSchema,
  inputShape: nodeUpdateShape,
  http: {
    method: 'PATCH',
    path: '/api/canvas/node/:id',
    // The webpage refresh delegation keeps the legacy non-2xx status when the
    // re-fetch fails ({ ok:false, id, error } with HTTP 400).
    status: (result) => (isRecord(result) && result.ok === false ? 400 : 200),
  },
  mcp: {
    toolName: 'canvas_update_node',
    description: 'Update an existing node. You can change its content, title, position, size, dock placement, or data.',
    extraShape: {
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      spec: z.record(z.string(), z.unknown()).optional().describe('New json-render spec, or a graph payload with graphType/data for graph nodes'),
      graphType: z.string().optional().describe('Graph type when updating a graph node'),
      data: z.array(z.record(z.string(), z.unknown())).optional().describe('Graph dataset when updating a graph node'),
      xKey: z.string().optional().describe('Graph x/category key'),
      yKey: z.string().optional().describe('Graph y/value key'),
      chartHeight: z.number().optional().describe('Graph chart content height, distinct from node height'),
      collapsed: z.boolean().optional().describe('Collapse or expand the node'),
      dockPosition: z.enum(['left', 'right']).nullable().optional().describe('Dock the node to the left/right HUD column, or pass null to return it to the canvas'),
      pinned: z.boolean().optional().describe('Pin or unpin the node to exclude it from auto-arrange'),
      arrangeLocked: z.boolean().optional().describe('Prevent auto-arrange from moving this node. Pinned nodes are also skipped.'),
      axCapabilities: z.object({
        enabled: z.boolean().optional(),
        allowed: z.array(z.string()).optional(),
      }).optional().describe('Enable/disable AX interactions on an existing node (e.g. flip an html node on with { enabled: true, allowed: ["ax.work.create"] }). Merged into the node data; clamped to the node-type ceiling server-side.'),
      full: z.boolean().optional().describe('Return the full updated node payload. Default false returns compact metadata.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    buildInput: (input) => {
      // A graph dataset update (`data` array) and an axCapabilities toggle collide
      // on the node-data merge (array vs object) — reject rather than silently
      // dropping the dataset.
      if (input.axCapabilities !== undefined && Array.isArray(input.data)) {
        throw new OperationError('Update the graph dataset and axCapabilities in separate canvas_update_node calls.');
      }
      return input;
    },
    formatResult: (result, input) => {
      const body = isRecord(result) ? result : {};
      const node = body.node as CanvasNodeState | undefined;
      if (node) {
        const payload = createdNodePayloadFromNode(node, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
      }
      // No `node` field: a webpage-refresh result ({ ok, id, fetch?, error? }) or
      // the node-vanished fallback. Pass the body through verbatim and surface a
      // FAILED refresh as isError — matching the HTTP 400 status mapping above and
      // the legacy canvas_refresh_webpage_node tool. Without this, a failed
      // refresh via canvas_node { action:'update', refresh:true } leaked back as a
      // false { ok:true } over the local invoker (no isError).
      const payload = body.ok !== undefined ? body : { ok: true, id: input.id };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        ...(payload.ok === false ? { isError: true } : {}),
      };
    },
  },
  handler: async (input) => {
    const body: Record<string, unknown> = input;
    const id = input.id;
    const existing = canvasState.getNode(id);
    if (!existing) throw new OperationError(`Node "${id}" not found.`, 404);
    if (existing.type === 'webpage' && body.refresh === true) {
      const rawUrl = typeof body.url === 'string' ? body.url : undefined;
      let url: string | undefined;
      if (rawUrl && rawUrl.trim().length > 0) {
        try {
          url = normalizeWebpageUrl(rawUrl);
        } catch (error) {
          throw new OperationError(error instanceof Error ? error.message : 'Invalid webpage URL.');
        }
      }
      const result = await refreshCanvasWebpageNode(id, { ...(url ? { url } : {}) });
      return result as unknown as Record<string, unknown>;
    }
    const { patch, groupChildIds } = buildNodePatch(existing, body);
    canvasState.updateNode(id, patch);
    if (groupChildIds !== undefined && !setGroupChildrenFromApi(id, groupChildIds)) {
      throw new OperationError(`Group "${id}" not found.`, 404);
    }
    const updated = canvasState.getNode(id);
    return updated ? buildNodeResponse(updated) : { ok: true, id };
  },
});

// ── node.remove ───────────────────────────────────────────────

const nodeRemoveShape = {
  id: z.string().describe('Node ID to remove'),
  intentId: z.string().optional().catch(undefined).describe('Ghost intent id returned by canvas_intent signal. A vetoed or expired intent blocks this mutation.'),
};

const nodeRemoveSchema = z.looseObject(nodeRemoveShape);

const nodeRemoveOperation = defineOperation<z.infer<typeof nodeRemoveSchema>, Record<string, unknown>>({
  name: 'node.remove',
  mutates: true,
  input: nodeRemoveSchema,
  inputShape: nodeRemoveShape,
  http: {
    method: 'DELETE',
    path: '/api/canvas/node/:id',
  },
  mcp: {
    toolName: 'canvas_remove_node',
    description: 'Remove a node from the canvas. Also removes all edges connected to it.',
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: ({ id }, ctx) => {
    const { needsCodeGraphRecompute } = removeNodeCore(id);
    if (needsCodeGraphRecompute) {
      scheduleCodeGraphRecompute(() => {
        ctx.emit('canvas-layout-update', { layout: canvasState.getLayout() });
      });
    }
    return { ok: true, removed: id };
  },
});

// ── layout.get ────────────────────────────────────────────────

const layoutGetShape = {
  includeBlobs: z.unknown().optional().describe('Include full blob payloads instead of blob summaries.'),
};

const layoutGetSchema = z.looseObject(layoutGetShape);

const layoutGetOperation = defineOperation<z.infer<typeof layoutGetSchema>, Record<string, unknown>>({
  name: 'layout.get',
  mutates: false,
  input: layoutGetSchema,
  inputShape: layoutGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/state',
  },
  mcp: {
    toolName: 'canvas_get_layout',
    description: 'Get the canvas layout. Defaults to a compact agent-safe projection; pass full:true for full node data.',
    extraShape: {
      full: z.boolean().optional().describe('Return the full layout including node data. Default false keeps responses compact.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    buildInput: () => ({ includeBlobs: true }),
    formatResult: async (result, input, host) => {
      const layout = result as CanvasLayout;
      const payload = wantsFullPayload(input)
        ? agentSafeFullLayoutPayload(layout)
        : compactLayoutPayload(layout, await host.getPinnedNodeIds());
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  },
  handler: ({ includeBlobs }) => {
    const full = includeBlobs === true || includeBlobs === 'true';
    return (full
      ? serializeCanvasLayout(canvasState.getLayout())
      : serializeCanvasLayoutWithBlobSummaries(withContextPinLayoutReadState(canvasState.getLayoutForPersistence()))
    ) as unknown as Record<string, unknown>;
  },
});

export const nodeOperations: Operation[] = [
  nodeAddOperation,
  nodeGetOperation,
  nodeUpdateOperation,
  nodeRemoveOperation,
  layoutGetOperation,
];
