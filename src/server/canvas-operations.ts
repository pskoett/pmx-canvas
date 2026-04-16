import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { recomputeCodeGraph } from './code-graph.js';
import {
  canvasState,
  type CanvasEdge,
  IMAGE_MIME_MAP,
  type CanvasNodeState,
  type CanvasNodeUpdate,
  type CanvasSnapshot,
} from './canvas-state.js';
import { rewatchAllFileNodes, unwatchAll, unwatchFileForNode, watchFileForNode } from './file-watcher.js';
import { mutationHistory } from './mutation-history.js';
import { computeGroupBounds, findOpenCanvasPosition } from './placement.js';
import { searchNodes } from './spatial-analysis.js';
import { getCanvasNodeTitle, serializeCanvasNode, type SerializedCanvasNode } from './canvas-serialization.js';
import {
  buildGraphSpec,
  createJsonRenderNodeData,
  GRAPH_NODE_SIZE,
  JSON_RENDER_NODE_SIZE,
  normalizeAndValidateJsonRenderSpec,
  type GraphNodeInput,
  type JsonRenderNodeInput,
  type JsonRenderSpec,
} from '../json-render/server.js';
import {
  fetchWebpageSnapshot,
  getWebpageFetchErrorDetails,
  normalizeWebpageUrl,
} from './webpage-node.js';

export type CanvasArrangeMode = 'grid' | 'column' | 'flow';
export type CanvasPinMode = 'set' | 'add' | 'remove';

interface CanvasAddNodeInput {
  type: CanvasNodeState['type'];
  title?: string;
  content?: string;
  data?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  fileMode?: 'path' | 'inline' | 'auto';
}

interface CanvasCreateGroupInput {
  title?: string;
  childIds?: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  childLayout?: CanvasArrangeMode;
}

export interface CanvasBatchOperation {
  op: string;
  assign?: string;
  args?: Record<string, unknown>;
}

interface CanvasNodeLookupInput {
  id?: string;
  search?: string;
}

const MAX_CONTEXT_PINS = 20;

export function validateCanvasNodePatch(patch: {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}): string | null {
  if (patch.position) {
    if (!Number.isFinite(patch.position.x) || !Number.isFinite(patch.position.y)) {
      return 'Position must contain finite x and y values.';
    }
  }
  if (patch.size) {
    if (!Number.isFinite(patch.size.width) || !Number.isFinite(patch.size.height)) {
      return 'Size must contain finite width and height values.';
    }
    if (patch.size.width <= 0 || patch.size.height <= 0) {
      return 'Size width and height must be greater than zero.';
    }
  }
  return null;
}

let codeGraphTimer: ReturnType<typeof setTimeout> | null = null;

function shouldTreatFileContentAsPath(input: CanvasAddNodeInput): boolean {
  if (input.fileMode === 'path') return true;
  if (input.fileMode === 'inline') return false;

  const content = input.content?.trim() ?? '';
  if (!content || content.includes('\n') || content.includes('\r')) return false;
  if (typeof input.data?.path === 'string' && input.data.path.length > 0) return true;
  if (existsSync(resolve(content))) return true;
  if (!input.title) return true;
  return content.startsWith('/') || content.startsWith('./') || content.startsWith('../') || content.includes('/');
}

function buildFileNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  if (!shouldTreatFileContentAsPath(input)) {
    return {
      ...(input.data ?? {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.content ? { content: input.content } : {}),
      ...(input.content && input.title
        ? {
            fileContent: input.content,
            lineCount: input.content.split('\n').length,
          }
        : {}),
    };
  }

  const rawPath = typeof input.data?.path === 'string' && input.data.path.length > 0
    ? input.data.path
    : (input.content ?? '');
  const resolved = resolve(rawPath);
  const fileName = resolved.split('/').pop() ?? rawPath;
  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    path: resolved,
    title: input.title ?? fileName,
  };

  try {
    if (existsSync(resolved)) {
      const fileContent = readFileSync(resolved, 'utf-8');
      const stat = statSync(resolved);
      data.fileContent = fileContent;
      data.lineCount = fileContent.split('\n').length;
      data.updatedAt = new Date(stat.mtimeMs).toISOString();
    }
  } catch {
    // Missing or unreadable files still render as path-backed file nodes.
  }

  return data;
}

function buildImageNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  const src = input.content ?? '';
  const isDataUri = src.startsWith('data:');
  const isUrl = src.startsWith('http://') || src.startsWith('https://');
  if (!isDataUri && !isUrl && src) {
    const resolved = resolve(src);
    const fileName = resolved.split('/').pop() ?? src;
    return {
      ...(input.data ?? {}),
      src: resolved,
      title: input.title ?? fileName,
      path: resolved,
      ...(IMAGE_MIME_MAP[resolved.split('.').pop()?.toLowerCase() ?? '']
        ? { mimeType: IMAGE_MIME_MAP[resolved.split('.').pop()?.toLowerCase() ?? ''] }
        : {}),
    };
  }

  return {
    ...(input.data ?? {}),
    src,
    title: input.title ?? (isUrl ? src.split('/').pop() ?? 'Image' : 'Image'),
  };
}

function buildWebpageNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  const rawUrl = typeof input.data?.url === 'string' && input.data.url.length > 0
    ? input.data.url
    : (input.content ?? '');
  const url = normalizeWebpageUrl(rawUrl);
  const explicitTitle = typeof input.title === 'string' && input.title.trim().length > 0
    ? input.title.trim()
    : typeof input.data?.title === 'string' && input.data.title.trim().length > 0
      ? input.data.title.trim()
      : '';

  return {
    ...(input.data ?? {}),
    url,
    title: explicitTitle || url,
    titleSource: explicitTitle ? 'user' : 'page',
    status: 'idle',
    content: typeof input.data?.content === 'string' ? input.data.content : '',
    excerpt: typeof input.data?.excerpt === 'string' ? input.data.excerpt : '',
  };
}

function buildNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  if (input.type === 'file') return buildFileNodeData(input);
  if (input.type === 'image') return buildImageNodeData(input);
  if (input.type === 'webpage') return buildWebpageNodeData(input);
  return {
    ...(input.data ?? {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.content ? { content: input.content } : {}),
  };
}

export function scheduleCodeGraphRecompute(onComplete?: () => void): void {
  if (codeGraphTimer) clearTimeout(codeGraphTimer);
  codeGraphTimer = setTimeout(() => {
    codeGraphTimer = null;
    recomputeCodeGraph();
    onComplete?.();
  }, 300);
}

export function addCanvasNode(input: CanvasAddNodeInput): {
  id: string;
  node: CanvasNodeState;
  needsCodeGraphRecompute: boolean;
} {
  if (input.type === 'json-render' || input.type === 'graph') {
    throw new Error(`Use the dedicated ${input.type} node APIs for structured viewer nodes.`);
  }

  const width = input.width ?? input.defaultWidth ?? 720;
  const height = input.height ?? input.defaultHeight ?? 600;
  const position = input.x !== undefined && input.y !== undefined
    ? { x: input.x, y: input.y }
    : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data = buildNodeData(input);
  const node: CanvasNodeState = {
    id,
    type: input.type,
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };

  canvasState.addNode(node);

  const filePath = input.type === 'file' && typeof data.path === 'string' ? data.path : null;
  if (filePath) {
    watchFileForNode(id, filePath);
  }

  return { id, node, needsCodeGraphRecompute: input.type === 'file' };
}

export function resolveCanvasNode(nodeRef: CanvasNodeLookupInput): {
  ok: true;
  node: CanvasNodeState;
} | {
  ok: false;
  error: string;
} {
  if (typeof nodeRef.id === 'string' && nodeRef.id.trim().length > 0) {
    const node = canvasState.getNode(nodeRef.id.trim());
    if (!node) {
      return { ok: false, error: `Node "${nodeRef.id}" not found.` };
    }
    return { ok: true, node };
  }

  if (typeof nodeRef.search === 'string' && nodeRef.search.trim().length > 0) {
    const query = nodeRef.search.trim();
    const layout = canvasState.getLayout();
    const exactTitleMatches = layout.nodes.filter((node) => {
      const title = getCanvasNodeTitle(node);
      return title !== null && title.toLowerCase() === query.toLowerCase();
    });
    if (exactTitleMatches.length === 1) {
      return { ok: true, node: exactTitleMatches[0]! };
    }
    if (exactTitleMatches.length > 1) {
      return {
        ok: false,
        error: `Search "${query}" is ambiguous. Exact title matches: ${exactTitleMatches.map((node) => `${getCanvasNodeTitle(node) ?? node.id} (${node.id})`).join(', ')}`,
      };
    }

    const matches = searchNodes(layout.nodes, query);
    if (matches.length === 0) {
      return { ok: false, error: `No node matches search "${query}".` };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `Search "${query}" is ambiguous. Matches: ${matches.slice(0, 5).map((match) => `${match.title ?? match.id} (${match.id})`).join(', ')}`,
      };
    }
    const node = canvasState.getNode(matches[0]!.id);
    if (!node) {
      return { ok: false, error: `Resolved node "${matches[0]!.id}" disappeared.` };
    }
    return { ok: true, node };
  }

  return { ok: false, error: 'Missing node reference. Provide either an id or a search query.' };
}

export async function refreshCanvasWebpageNode(
  id: string,
  options: { url?: string } = {},
): Promise<{ ok: boolean; id: string; error?: string }> {
  const existing = canvasState.getNode(id);
  if (!existing || existing.type !== 'webpage') {
    return { ok: false, id, error: `Webpage node "${id}" not found.` };
  }

  const currentData = existing.data;
  const configuredUrl = typeof options.url === 'string' && options.url.trim().length > 0
    ? options.url
    : typeof currentData.url === 'string'
      ? currentData.url
      : '';

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeWebpageUrl(configuredUrl);
  } catch (error) {
    canvasState.updateNode(id, {
      data: {
        ...currentData,
        status: 'error',
        error: error instanceof Error ? error.message : 'Invalid webpage URL.',
      },
    });
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : 'Invalid webpage URL.',
    };
  }

  const fetchingData: Record<string, unknown> = {
    ...currentData,
    url: normalizedUrl,
    status: 'fetching',
  };
  delete fetchingData.error;
  canvasState.updateNode(id, { data: fetchingData });

  try {
    const snapshot = await fetchWebpageSnapshot(normalizedUrl);
    const latest = canvasState.getNode(id);
    if (!latest || latest.type !== 'webpage') {
      return { ok: false, id, error: `Webpage node "${id}" disappeared during refresh.` };
    }

    const latestData = latest.data;
    const titleSource = latestData.titleSource === 'user' ? 'user' : 'page';
    const currentTitle = typeof latestData.title === 'string' ? latestData.title.trim() : '';
    const nextTitle = titleSource === 'user' && currentTitle.length > 0
      ? currentTitle
      : snapshot.pageTitle ?? snapshot.url;

    const nextData: Record<string, unknown> = {
      ...latestData,
      url: snapshot.url,
      title: nextTitle,
      titleSource,
      pageTitle: snapshot.pageTitle,
      description: snapshot.description,
      imageUrl: snapshot.imageUrl,
      content: snapshot.content,
      excerpt: snapshot.excerpt,
      fetchedAt: snapshot.fetchedAt,
      status: 'ready',
      statusCode: snapshot.statusCode,
      contentType: snapshot.contentType,
    };
    delete nextData.error;

    canvasState.updateNode(id, { data: nextData });
    return { ok: true, id };
  } catch (error) {
    const details = getWebpageFetchErrorDetails(error);
    const latest = canvasState.getNode(id);
    if (latest?.type === 'webpage') {
      canvasState.updateNode(id, {
        data: {
          ...latest.data,
          url: normalizedUrl,
          fetchedAt: new Date().toISOString(),
          status: 'error',
          error: details.message,
          ...(details.statusCode !== null ? { statusCode: details.statusCode } : {}),
          ...(details.contentType !== null ? { contentType: details.contentType } : {}),
        },
      });
    }
    return { ok: false, id, error: details.message };
  }
}

export function removeCanvasNode(id: string): {
  removed: boolean;
  needsCodeGraphRecompute: boolean;
} {
  const existing = canvasState.getNode(id);
  if (!existing) {
    return { removed: false, needsCodeGraphRecompute: false };
  }

  if (existing.type === 'file') {
    unwatchFileForNode(id, typeof existing.data.path === 'string' ? existing.data.path : undefined);
  }

  canvasState.removeNode(id);
  return { removed: true, needsCodeGraphRecompute: existing.type === 'file' };
}

function isArrangeLocked(node: CanvasNodeState): boolean {
  return node.pinned || node.data.arrangeLocked === true;
}

function collectArrangeExcludedNodeIds(nodes: CanvasNodeState[]): Set<string> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const excludedGroupIds = new Set<string>();

  for (const node of nodes) {
    if (node.type !== 'group') continue;
    const childIds = Array.isArray(node.data.children)
      ? node.data.children.filter((id): id is string => typeof id === 'string')
      : [];
    const hasLockedChild = childIds.some((childId) => {
      const child = nodesById.get(childId);
      return child ? isArrangeLocked(child) : false;
    });
    if (isArrangeLocked(node) || hasLockedChild) {
      excludedGroupIds.add(node.id);
    }
  }

  const excluded = new Set<string>();
  for (const node of nodes) {
    const parentGroup = typeof node.data.parentGroup === 'string' ? node.data.parentGroup : null;
    if (isArrangeLocked(node) || (parentGroup && excludedGroupIds.has(parentGroup))) {
      excluded.add(node.id);
    }
  }

  for (const groupId of excludedGroupIds) {
    excluded.add(groupId);
    const group = nodesById.get(groupId);
    const childIds = Array.isArray(group?.data.children)
      ? group.data.children.filter((id): id is string => typeof id === 'string')
      : [];
    for (const childId of childIds) excluded.add(childId);
  }

  return excluded;
}

export function arrangeCanvasNodes(layout: CanvasArrangeMode): { arranged: number; layout: CanvasArrangeMode } {
  const nodes = canvasState.getLayout().nodes;
  const excludedIds = collectArrangeExcludedNodeIds(nodes);
  const movableNodes = nodes.filter((node) => !excludedIds.has(node.id));
  const gap = 24;
  const oldPositions = nodes.map((node) => ({ id: node.id, position: { ...node.position } }));

  canvasState.withSuppressedRecording(() => {
    if (layout === 'column') {
      let y = 80;
      for (const node of movableNodes) {
        canvasState.updateNode(node.id, { position: { x: 40, y } });
        y += node.size.height + gap;
      }
      return;
    }

    if (layout === 'flow') {
      let x = 40;
      for (const node of movableNodes) {
        canvasState.updateNode(node.id, { position: { x, y: 80 } });
        x += node.size.width + gap;
      }
      return;
    }

    const cols = Math.max(1, Math.floor(1440 / (360 + gap)));
    let col = 0;
    let rowY = 80;
    let rowMaxHeight = 0;
    for (const node of movableNodes) {
      const x = 40 + col * (360 + gap);
      canvasState.updateNode(node.id, { position: { x, y: rowY } });
      rowMaxHeight = Math.max(rowMaxHeight, node.size.height);
      col++;
      if (col >= cols) {
        col = 0;
        rowY += rowMaxHeight + gap;
        rowMaxHeight = 0;
      }
    }
  });

  const newPositions = nodes.map((node) => {
    const updated = canvasState.getNode(node.id);
    return { id: node.id, position: updated ? { ...updated.position } : { ...node.position } };
  });
  mutationHistory.record({
    description: `Auto-arranged ${movableNodes.length} nodes (${layout})`,
    operationType: 'arrange',
    forward: () => canvasState.withSuppressedRecording(() => {
      for (const position of newPositions) canvasState.updateNode(position.id, { position: position.position });
    }),
    inverse: () => canvasState.withSuppressedRecording(() => {
      for (const position of oldPositions) canvasState.updateNode(position.id, { position: position.position });
    }),
  });

  return { arranged: movableNodes.length, layout };
}

export function applyCanvasNodeUpdates(updates: CanvasNodeUpdate[]): { applied: number; skipped: number } {
  const safe = updates.filter((update) => validateCanvasNodePatch(update) === null);
  return canvasState.applyUpdates(safe);
}

export function setCanvasContextPins(
  nodeIds: string[],
  mode: CanvasPinMode = 'set',
): { count: number; nodeIds: string[] } {
  const normalizePins = (ids: string[]): string[] => ids.filter((id, index) => ids.indexOf(id) === index).slice(0, MAX_CONTEXT_PINS);
  const normalizedNodeIds = normalizePins(nodeIds);
  if (mode === 'set') {
    canvasState.setContextPins(normalizedNodeIds);
  } else if (mode === 'add') {
    const current = Array.from(canvasState.contextPinnedNodeIds);
    canvasState.setContextPins(normalizePins([...current, ...normalizedNodeIds]));
  } else {
    const current = Array.from(canvasState.contextPinnedNodeIds);
    canvasState.setContextPins(current.filter((id) => !normalizedNodeIds.includes(id)));
  }

  return {
    count: canvasState.contextPinnedNodeIds.size,
    nodeIds: Array.from(canvasState.contextPinnedNodeIds),
  };
}

export function listCanvasSnapshots(): CanvasSnapshot[] {
  return canvasState.listSnapshots();
}

export function saveCanvasSnapshot(name: string): CanvasSnapshot | null {
  return canvasState.saveSnapshot(name);
}

export function restoreCanvasSnapshot(id: string): { ok: boolean } {
  const ok = canvasState.restoreSnapshot(id);
  if (ok) {
    rewatchAllFileNodes();
  }
  return { ok };
}

export function deleteCanvasSnapshot(id: string): { ok: boolean } {
  return { ok: canvasState.deleteSnapshot(id) };
}

export function addCanvasEdge(input: {
  from?: string;
  to?: string;
  fromSearch?: string;
  toSearch?: string;
  type: CanvasEdge['type'];
  label?: string;
  style?: CanvasEdge['style'];
  animated?: boolean;
}): { id: string; from: string; to: string } {
  const fromResult = resolveCanvasNode({
    ...(typeof input.from === 'string' ? { id: input.from } : {}),
    ...(typeof input.fromSearch === 'string' ? { search: input.fromSearch } : {}),
  });
  if (!fromResult.ok) {
    throw new Error(fromResult.error);
  }
  const toResult = resolveCanvasNode({
    ...(typeof input.to === 'string' ? { id: input.to } : {}),
    ...(typeof input.toSearch === 'string' ? { search: input.toSearch } : {}),
  });
  if (!toResult.ok) {
    throw new Error(toResult.error);
  }

  const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const edge: CanvasEdge = {
    id,
    from: fromResult.node.id,
    to: toResult.node.id,
    type: input.type,
    ...(input.label ? { label: input.label } : {}),
    ...(input.style ? { style: input.style } : {}),
    ...(input.animated !== undefined ? { animated: input.animated } : {}),
  };
  const added = canvasState.addEdge(edge);
  if (!added) {
    throw new Error('Duplicate or self-edge.');
  }
  return { id, from: fromResult.node.id, to: toResult.node.id };
}

export function removeCanvasEdge(id: string): { removed: boolean } {
  return { removed: canvasState.removeEdge(id) };
}

export function createCanvasGroup(input: CanvasCreateGroupInput): { id: string; node: CanvasNodeState } {
  let x = input.x;
  let y = input.y;
  let width = input.width ?? 600;
  let height = input.height ?? 400;
  const explicitFrame = input.x !== undefined || input.y !== undefined || input.width !== undefined || input.height !== undefined;

  const childIds = input.childIds ?? [];
  if (childIds.length > 0 && x === undefined && y === undefined) {
    const childRects = childIds
      .map((cid) => canvasState.getNode(cid))
      .filter((node): node is CanvasNodeState => node !== undefined);
    const bounds = computeGroupBounds(childRects);
    if (bounds) {
      x = bounds.x;
      y = bounds.y;
      width = bounds.width;
      height = bounds.height;
    }
  }

  const position = x !== undefined && y !== undefined
    ? { x, y }
    : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);

  const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data: Record<string, unknown> = {
    title: input.title ?? 'Group',
    children: [],
    frameMode: explicitFrame ? 'manual' : 'fit',
    ...(input.color ? { color: input.color } : {}),
  };

  canvasState.addNode({
    id,
    type: 'group',
    position,
    size: { width, height },
    zIndex: 0,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  });

  if (childIds.length > 0) {
    canvasState.groupNodes(id, childIds, {
      preservePositions: input.childLayout === undefined,
      ...(input.childLayout ? { layout: input.childLayout } : {}),
      keepGroupFrame: explicitFrame,
    });
  }

  const node = canvasState.getNode(id);
  if (!node) {
    throw new Error(`Group "${id}" was not created.`);
  }
  return { id, node };
}

export function groupCanvasNodes(
  groupId: string,
  childIds: string[],
  options: { childLayout?: CanvasArrangeMode } = {},
): { ok: boolean } {
  return {
    ok: canvasState.groupNodes(groupId, childIds, {
      ...(options.childLayout ? { layout: options.childLayout } : {}),
    }),
  };
}

export function ungroupCanvasNodes(groupId: string): { ok: boolean } {
  return { ok: canvasState.ungroupNodes(groupId) };
}

export function clearCanvas(): { ok: boolean } {
  unwatchAll();
  canvasState.clear();
  return { ok: true };
}

export function createCanvasJsonRenderNode(
  input: JsonRenderNodeInput,
): { id: string; url: string; spec: JsonRenderSpec; node: CanvasNodeState } {
  const spec = normalizeAndValidateJsonRenderSpec(input.spec);
  const width = input.width ?? JSON_RENDER_NODE_SIZE.width;
  const height = input.height ?? JSON_RENDER_NODE_SIZE.height;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node: CanvasNodeState = {
    id,
    type: 'json-render',
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: createJsonRenderNodeData(id, input.title, spec, {
      viewerType: 'json-render',
    }),
  };

  canvasState.addJsonRenderNode(node);
  return { id, url: String(node.data.url), spec, node };
}

export function createCanvasGraphNode(
  input: GraphNodeInput,
): { id: string; url: string; spec: JsonRenderSpec; node: CanvasNodeState } {
  const title = input.title?.trim() || 'Graph';
  const spec = buildGraphSpec(input);
  const width = input.width ?? GRAPH_NODE_SIZE.width;
  const height = input.heightPx ?? GRAPH_NODE_SIZE.height;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node: CanvasNodeState = {
    id,
    type: 'graph',
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: createJsonRenderNodeData(id, title, spec, {
      viewerType: 'graph',
      graphConfig: {
        title,
        graphType: input.graphType,
        data: input.data,
        ...(input.xKey ? { xKey: input.xKey } : {}),
        ...(input.yKey ? { yKey: input.yKey } : {}),
        ...(input.nameKey ? { nameKey: input.nameKey } : {}),
        ...(input.valueKey ? { valueKey: input.valueKey } : {}),
        ...(input.aggregate ? { aggregate: input.aggregate } : {}),
        ...(input.color ? { color: input.color } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
      },
    }),
  };

  canvasState.addGraphNode(node);
  return { id, url: String(node.data.url), spec, node };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolveBatchRefs(value: unknown, refs: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) {
    const path = value.slice(1).split('.');
    let current: unknown = refs[path[0] ?? ''];
    for (const segment of path.slice(1)) {
      if (!isPlainRecord(current) && !Array.isArray(current)) return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }
  if (Array.isArray(value)) return value.map((item) => resolveBatchRefs(item, refs));
  if (isPlainRecord(value)) {
    const resolved: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      resolved[key] = resolveBatchRefs(child, refs);
    }
    return resolved;
  }
  return value;
}

function serializeCreatedNode(node: CanvasNodeState): SerializedCanvasNode {
  return serializeCanvasNode(node);
}

export async function executeCanvasBatch(
  operations: CanvasBatchOperation[],
): Promise<{
  ok: boolean;
  results: Array<Record<string, unknown>>;
  refs: Record<string, unknown>;
  failedIndex?: number;
  error?: string;
}> {
  const refs: Record<string, unknown> = {};
  const results: Array<Record<string, unknown>> = [];

  for (let index = 0; index < operations.length; index++) {
    const operation = operations[index];
    const args = isPlainRecord(operation.args) ? resolveBatchRefs(operation.args, refs) : {};
    if (!isPlainRecord(args)) {
      return {
        ok: false,
        failedIndex: index,
        error: `Operation ${index} has invalid args.`,
        results,
        refs,
      };
    }

    try {
      let result: Record<string, unknown>;
      switch (operation.op) {
        case 'node.add': {
          const type = typeof args.type === 'string' ? args.type : 'markdown';
          if (type === 'webpage') {
            const created = addCanvasNode({
              type: 'webpage',
              ...(typeof args.title === 'string' ? { title: args.title } : {}),
              ...(typeof args.content === 'string' ? { content: args.content } : {}),
              ...(isPlainRecord(args.data) ? { data: args.data } : {}),
              ...(typeof args.x === 'number' ? { x: args.x } : {}),
              ...(typeof args.y === 'number' ? { y: args.y } : {}),
              ...(typeof args.width === 'number' ? { width: args.width } : {}),
              ...(typeof args.height === 'number' ? { height: args.height } : {}),
              defaultWidth: 520,
              defaultHeight: 420,
            });
            const fetch = await refreshCanvasWebpageNode(created.id);
            const refreshed = canvasState.getNode(created.id) ?? created.node;
            result = {
              ok: true,
              ...serializeCreatedNode(refreshed),
              fetch: fetch.ok
                ? { ok: true }
                : { ok: false, error: fetch.error ?? 'Failed to fetch webpage content.' },
              ...(fetch.ok ? {} : { error: fetch.error }),
            };
          } else {
            const created = addCanvasNode({
              type: type as CanvasNodeState['type'],
              ...(typeof args.title === 'string' ? { title: args.title } : {}),
              ...(typeof args.content === 'string' ? { content: args.content } : {}),
              ...(isPlainRecord(args.data) ? { data: args.data } : {}),
              ...(typeof args.x === 'number' ? { x: args.x } : {}),
              ...(typeof args.y === 'number' ? { y: args.y } : {}),
              ...(typeof args.width === 'number' ? { width: args.width } : {}),
              ...(typeof args.height === 'number' ? { height: args.height } : {}),
              defaultWidth: 360,
              defaultHeight: 200,
              fileMode: 'auto',
            });
            result = { ok: true, ...serializeCreatedNode(created.node) };
          }
          break;
        }
        case 'node.update': {
          const id = typeof args.id === 'string' ? args.id : '';
          const node = canvasState.getNode(id);
          if (!node) throw new Error(`Node "${id}" not found.`);
          const patch: Partial<CanvasNodeState> = {};
          if (typeof args.x === 'number' || typeof args.y === 'number') {
            patch.position = {
              x: typeof args.x === 'number' ? args.x : node.position.x,
              y: typeof args.y === 'number' ? args.y : node.position.y,
            };
          }
          if (typeof args.width === 'number' || typeof args.height === 'number') {
            patch.size = {
              width: typeof args.width === 'number' ? args.width : node.size.width,
              height: typeof args.height === 'number' ? args.height : node.size.height,
            };
          }
          if (typeof args.collapsed === 'boolean') patch.collapsed = args.collapsed;
          if (typeof args.pinned === 'boolean') patch.pinned = args.pinned;
          if (args.dockPosition === null || args.dockPosition === 'left' || args.dockPosition === 'right') {
            patch.dockPosition = args.dockPosition;
          }
          if (typeof args.title === 'string' || typeof args.content === 'string' || typeof args.arrangeLocked === 'boolean' || isPlainRecord(args.data)) {
            patch.data = {
              ...node.data,
              ...(typeof args.title === 'string' ? { title: args.title } : {}),
              ...(typeof args.content === 'string' ? { content: args.content } : {}),
              ...(typeof args.arrangeLocked === 'boolean' ? { arrangeLocked: args.arrangeLocked } : {}),
              ...(isPlainRecord(args.data) ? args.data : {}),
            };
          }
          canvasState.updateNode(id, patch);
          const updated = canvasState.getNode(id);
          result = { ok: true, ...(updated ? serializeCreatedNode(updated) : { id }) };
          break;
        }
        case 'edge.add': {
          const added = addCanvasEdge({
            ...(typeof args.from === 'string' ? { from: args.from } : {}),
            ...(typeof args.to === 'string' ? { to: args.to } : {}),
            ...(typeof args.fromSearch === 'string' ? { fromSearch: args.fromSearch } : {}),
            ...(typeof args.toSearch === 'string' ? { toSearch: args.toSearch } : {}),
            type: String(args.type) as CanvasEdge['type'],
            ...(typeof args.label === 'string' ? { label: args.label } : {}),
            ...(typeof args.style === 'string' ? { style: args.style as CanvasEdge['style'] } : {}),
            ...(typeof args.animated === 'boolean' ? { animated: args.animated } : {}),
          });
          result = { ok: true, ...added };
          break;
        }
        case 'group.create': {
          const created = createCanvasGroup({
            ...(typeof args.title === 'string' ? { title: args.title } : {}),
            ...(Array.isArray(args.childIds) ? { childIds: args.childIds.filter((id): id is string => typeof id === 'string') } : {}),
            ...(typeof args.x === 'number' ? { x: args.x } : {}),
            ...(typeof args.y === 'number' ? { y: args.y } : {}),
            ...(typeof args.width === 'number' ? { width: args.width } : {}),
            ...(typeof args.height === 'number' ? { height: args.height } : {}),
            ...(typeof args.color === 'string' ? { color: args.color } : {}),
            ...(args.childLayout === 'grid' || args.childLayout === 'column' || args.childLayout === 'flow'
              ? { childLayout: args.childLayout }
              : {}),
          });
          result = { ok: true, ...serializeCreatedNode(created.node) };
          break;
        }
        case 'group.add': {
          const groupId = typeof args.groupId === 'string' ? args.groupId : '';
          const childIds = Array.isArray(args.childIds) ? args.childIds.filter((id): id is string => typeof id === 'string') : [];
          const ok = canvasState.groupNodes(groupId, childIds, {
            preservePositions: args.childLayout === undefined,
            ...(args.childLayout === 'grid' || args.childLayout === 'column' || args.childLayout === 'flow'
              ? { layout: args.childLayout }
              : {}),
          });
          if (!ok) throw new Error('Group not found or no valid children.');
          const group = canvasState.getNode(groupId);
          result = { ok: true, ...(group ? serializeCreatedNode(group) : { id: groupId }) };
          break;
        }
        case 'group.remove': {
          const groupId = typeof args.groupId === 'string' ? args.groupId : '';
          const ok = canvasState.ungroupNodes(groupId);
          if (!ok) throw new Error('Group not found or empty.');
          result = { ok: true, groupId };
          break;
        }
        case 'pin.set':
        case 'pin.add':
        case 'pin.remove': {
          const ids = Array.isArray(args.nodeIds) ? args.nodeIds.filter((id): id is string => typeof id === 'string') : [];
          result = {
            ok: true,
            ...setCanvasContextPins(ids, operation.op === 'pin.set' ? 'set' : operation.op === 'pin.add' ? 'add' : 'remove'),
          };
          break;
        }
        case 'snapshot.save': {
          const snapshot = saveCanvasSnapshot(typeof args.name === 'string' ? args.name : '');
          if (!snapshot) throw new Error('Failed to save snapshot.');
          result = { ok: true, snapshot };
          break;
        }
        case 'arrange': {
          const layout =
            args.layout === 'column' || args.layout === 'flow' || args.layout === 'grid'
              ? args.layout
              : 'grid';
          result = { ok: true, ...arrangeCanvasNodes(layout) };
          break;
        }
        default:
          throw new Error(`Unsupported batch operation "${operation.op}".`);
      }

      results.push(result);
      if (typeof operation.assign === 'string' && operation.assign.trim().length > 0) {
        refs[operation.assign] = result;
      }
    } catch (error) {
      return {
        ok: false,
        failedIndex: index,
        error: error instanceof Error ? error.message : String(error),
        results,
        refs,
      };
    }
  }

  return { ok: true, results, refs };
}
