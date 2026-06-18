import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ContextNode } from '../nodes/ContextNode';
import { FileNode } from '../nodes/FileNode';
import { LedgerNode } from '../nodes/LedgerNode';
import { MarkdownNode } from '../nodes/MarkdownNode';
import { McpAppNode } from '../nodes/McpAppNode';
import { StatusNode } from '../nodes/StatusNode';
import { ImageNode } from '../nodes/ImageNode';
import { GroupNode } from '../nodes/GroupNode';
import { WebpageNode } from '../nodes/WebpageNode';
import { HtmlNode } from '../nodes/HtmlNode';
import { PromptNode } from '../nodes/PromptNode';
import { ResponseNode } from '../nodes/ResponseNode';
import { TraceNode } from '../nodes/TraceNode';
import {
  activeNodeId,
  cancelViewportAnimation,
  commitViewport,
  clearSelection,
  draggingEdge,
  edges,
  expandedNodeId,
  annotations,
  nodes,
  selectNodes,
  setViewport,
  viewport,
  createAnnotationFromClient,
  removeAnnotationFromClient,
} from '../state/canvas-store';
import { createEdgeFromClient, createNodeFromClient } from '../state/intent-bridge';
import type { CanvasAnnotation, CanvasNodeState } from '../types';
import { FocusFieldLayer } from './FocusFieldLayer';
import { IntentLayer } from './IntentLayer';
import { CanvasNode } from './CanvasNode';
import { EdgeLayer } from './EdgeLayer';
import { AnnotationLayer } from './AnnotationLayer';
import { activeGuides } from './snap-guides';
import { usePanZoom } from './use-pan-zoom';

function renderNodeContent(node: CanvasNodeState) {
  switch (node.type) {
    case 'markdown':
      return <MarkdownNode node={node} />;
    case 'mcp-app':
      return <McpAppNode node={node} />;
    case 'webpage':
      return <WebpageNode node={node} />;
    case 'json-render':
      return <McpAppNode node={node} />;
    case 'graph':
      return <McpAppNode node={node} />;
    case 'prompt':
      return <PromptNode node={node} />;
    case 'response':
      return <ResponseNode node={node} />;
    case 'status':
      return <StatusNode node={node} />;
    case 'context':
      return <ContextNode node={node} />;
    case 'ledger':
      return <LedgerNode node={node} />;
    case 'trace':
      return <TraceNode node={node} />;
    case 'file':
      return <FileNode node={node} />;
    case 'image':
      return <ImageNode node={node} />;
    case 'html':
      return <HtmlNode node={node} />;
    case 'group':
      return <GroupNode node={node} />;
    default:
      return <div>Unknown node type</div>;
  }
}

function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function findAnnotationAtPoint(
  annotationList: CanvasAnnotation[],
  point: { x: number; y: number },
  hitRadius: number,
): CanvasAnnotation | null {
  for (let i = annotationList.length - 1; i >= 0; i--) {
    const annotation = annotationList[i];
    if (!annotation) continue;
    const pad = hitRadius + annotation.width;
    if (
      point.x < annotation.bounds.x - pad ||
      point.x > annotation.bounds.x + annotation.bounds.width + pad ||
      point.y < annotation.bounds.y - pad ||
      point.y > annotation.bounds.y + annotation.bounds.height + pad
    ) continue;
    if (annotation.type === 'text') return annotation;
    for (let index = 1; index < annotation.points.length; index++) {
      const start = annotation.points[index - 1];
      const end = annotation.points[index];
      if (start && end && distanceToSegment(point, start, end) <= hitRadius + annotation.width / 2) {
        return annotation;
      }
    }
  }
  return null;
}

interface LassoRect {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface AnnotationDraft {
  id: string;
  type: 'freehand' | 'text';
  points: Array<{ x: number; y: number }>;
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  width: number;
  text?: string;
  createdAt: string;
}

interface TextAnnotationDraft {
  x: number;
  y: number;
  value: string;
}

const ANNOTATION_COLOR = 'currentColor';
const ANNOTATION_WIDTH = 4;
const TEXT_ANNOTATION_WIDTH = 24;
const ERASER_HIT_RADIUS = 14;

type AnnotationTool = 'pen' | 'eraser' | 'text' | null;

interface CanvasViewportProps {
  onNodeContextMenu?: (e: MouseEvent, nodeId: string) => void;
  onCanvasContextMenu?: (e: MouseEvent, canvasX: number, canvasY: number) => void;
  annotationMode?: boolean;
  annotationTool?: AnnotationTool;
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif']);
const MD_EXTS = new Set(['md', 'mdx', 'markdown']);
const WEBPAGE_NODE_SIZE = { width: 520, height: 420 };

function normalizeUrlCandidate(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;

  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrlsFromText(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const rawCandidates = trimmed.includes('\n')
    ? trimmed.split(/\r?\n/)
    : trimmed.split(/\s+/);
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const candidate of rawCandidates) {
    const value = candidate.trim();
    if (!value || value.startsWith('#')) continue;
    const normalized = normalizeUrlCandidate(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}

function getTransferUrls(dataTransfer: DataTransfer): string[] {
  const uriList = extractUrlsFromText(dataTransfer.getData('text/uri-list'));
  if (uriList.length > 0) return uriList;
  return extractUrlsFromText(dataTransfer.getData('text/plain'));
}

function hasUrlPayload(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return dataTransfer.types.includes('text/uri-list') || dataTransfer.types.includes('text/plain');
}

function isEditableElement(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return Boolean(element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function nodeTypeFromFilename(name: string): 'image' | 'markdown' | 'file' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MD_EXTS.has(ext)) return 'markdown';
  return 'file';
}

export function getRenderableWorldNodes(
  allNodes: Iterable<CanvasNodeState>,
  focusedNodeId: string | null,
): CanvasNodeState[] {
  const worldNodes: CanvasNodeState[] = [];
  let insertIdx = 0; // groups fill from the front
  for (const n of allNodes) {
    if (n.dockPosition !== null) continue;
    // Focus mode renders the node inside the overlay. Skip the original world
    // instance so embedded apps do not mount twice.
    if (focusedNodeId && n.id === focusedNodeId) continue;
    if (n.type === 'group') {
      worldNodes.splice(insertIdx++, 0, n);
    } else {
      worldNodes.push(n);
    }
  }
  return worldNodes;
}

export function CanvasViewport({ onNodeContextMenu, onCanvasContextMenu, annotationMode = false, annotationTool = null }: CanvasViewportProps) {
  const v = viewport.value;
  const isLassoing = useRef(false);
  const isAnnotating = useRef(false);
  const annotationPoints = useRef<Array<{ x: number; y: number }>>([]);
  const [lasso, setLasso] = useState<LassoRect | null>(null);
  const [draftAnnotation, setDraftAnnotation] = useState<AnnotationDraft | null>(null);
  const [textDraft, setTextDraftState] = useState<TextAnnotationDraft | null>(null);
  const textDraftRef = useRef<TextAnnotationDraft | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dropCounter = useRef(0);
  // Ref mirrors lasso state so pointer handlers always read the latest value
  // without stale-closure issues from useCallback dependency capture.
  const lassoRef = useRef<LassoRect | null>(null);

  const containerRef = usePanZoom({
    viewport,
    disabled: annotationMode,
    onViewportChange: (next) => {
      // Don't pan while lassoing — usePanZoom's pointerdown still fires
      // (native listener) before our Preact handler can stopPropagation.
      if (isLassoing.current || annotationMode) return;
      cancelViewportAnimation();
      setViewport(next);
    },
    onViewportCommit: (next) => {
      if (isLassoing.current || annotationMode) return;
      cancelViewportAnimation();
      commitViewport(next);
    },
  });

  const setTextDraft = useCallback((next: TextAnnotationDraft | null) => {
    textDraftRef.current = next;
    setTextDraftState(next);
  }, []);

  const createWebpageNodes = useCallback(async (urls: string[], centerX: number, centerY: number) => {
    if (urls.length === 0) return;

    const nodeW = WEBPAGE_NODE_SIZE.width;
    const nodeH = WEBPAGE_NODE_SIZE.height;
    const spacing = 24;
    const cols = Math.ceil(Math.sqrt(urls.length));
    const rows = Math.ceil(urls.length / cols);
    const totalW = cols * nodeW + Math.max(0, cols - 1) * spacing;
    const totalH = rows * nodeH + Math.max(0, rows - 1) * spacing;

    for (let index = 0; index < urls.length; index++) {
      const col = index % cols;
      const row = Math.floor(index / cols);
      const x = centerX - totalW / 2 + col * (nodeW + spacing);
      const y = centerY - totalH / 2 + row * (nodeH + spacing);
      await createNodeFromClient({
        type: 'webpage',
        content: urls[index],
        x,
        y,
        width: nodeW,
        height: nodeH,
      });
    }
  }, []);

  // Lasso: Shift+pointerdown on background starts lasso selection
  const handlePointerDown = useCallback(
    (e: PointerEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (annotationTool === 'eraser') {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('.hud-layer, .snapshot-panel, .context-menu, .command-palette')) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = container.getBoundingClientRect();
        const vp = viewport.value;
        const point = {
          x: (e.clientX - rect.left - vp.x) / vp.scale,
          y: (e.clientY - rect.top - vp.y) / vp.scale,
        };
        const hit = findAnnotationAtPoint(Array.from(annotations.value.values()), point, ERASER_HIT_RADIUS / vp.scale);
        if (hit) void removeAnnotationFromClient(hit.id);
        return;
      }

      if (annotationTool === 'text') {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('.hud-layer, .snapshot-panel, .context-menu, .command-palette')) return;
        e.preventDefault();
        e.stopPropagation();
        activeNodeId.value = null;
        clearSelection();
        const rect = container.getBoundingClientRect();
        const vp = viewport.value;
        setTextDraft({
          x: (e.clientX - rect.left - vp.x) / vp.scale,
          y: (e.clientY - rect.top - vp.y) / vp.scale,
          value: '',
        });
        return;
      }

      if (annotationTool === 'pen') {
        const target = e.target instanceof Element ? e.target : null;
        if (target?.closest('.hud-layer, .snapshot-panel, .context-menu, .command-palette')) return;
        e.preventDefault();
        e.stopPropagation();
        activeNodeId.value = null;
        clearSelection();
        isAnnotating.current = true;
        const rect = container.getBoundingClientRect();
        const vp = viewport.value;
        const point = {
          x: (e.clientX - rect.left - vp.x) / vp.scale,
          y: (e.clientY - rect.top - vp.y) / vp.scale,
        };
        annotationPoints.current = [point];
        setDraftAnnotation({
          id: 'draft-annotation',
          type: 'freehand',
          points: [point],
          bounds: { x: 0, y: 0, width: 0, height: 0 },
          color: ANNOTATION_COLOR,
          width: ANNOTATION_WIDTH,
          createdAt: '',
        });
        container.setPointerCapture(e.pointerId);
        return;
      }

      if (e.target !== container) return;

      if (!e.shiftKey) {
        if (!lassoRef.current) {
          activeNodeId.value = null;
          clearSelection();
        }
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      isLassoing.current = true;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const initial = { startX: x, startY: y, currentX: x, currentY: y };
      lassoRef.current = initial;
      setLasso(initial);
      container.setPointerCapture(e.pointerId);
    },
    [annotationTool, containerRef],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (isAnnotating.current) {
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const vp = viewport.value;
        const point = {
          x: (e.clientX - rect.left - vp.x) / vp.scale,
          y: (e.clientY - rect.top - vp.y) / vp.scale,
        };
        const previous = annotationPoints.current.at(-1);
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 2) return;
        annotationPoints.current = [...annotationPoints.current, point];
        setDraftAnnotation((draft) => draft ? { ...draft, points: annotationPoints.current } : null);
        return;
      }

      if (!isLassoing.current || !lassoRef.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const updated = {
        ...lassoRef.current,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      };
      lassoRef.current = updated;
      setLasso(updated);
    },
    [containerRef],
  );

  const handlePointerUp = useCallback((e: PointerEvent) => {
    if (isAnnotating.current) {
      isAnnotating.current = false;
      const points = annotationPoints.current;
      annotationPoints.current = [];
      setDraftAnnotation(null);
      if (points.length >= 2) {
        void createAnnotationFromClient({ points, color: ANNOTATION_COLOR, width: ANNOTATION_WIDTH });
      }
      const container = containerRef.current;
      if (container?.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }
      return;
    }

    const current = lassoRef.current;
    if (!isLassoing.current || !current) return;
    isLassoing.current = false;
    lassoRef.current = null;

    // Compute lasso rectangle in screen space
    const minX = Math.min(current.startX, current.currentX);
    const maxX = Math.max(current.startX, current.currentX);
    const minY = Math.min(current.startY, current.currentY);
    const maxY = Math.max(current.startY, current.currentY);

    // Only commit if the lasso was dragged at least a few pixels
    if (maxX - minX > 5 || maxY - minY > 5) {
      // Convert screen lasso rect to world-space
      const vp = viewport.value;
      const worldMinX = (minX - vp.x) / vp.scale;
      const worldMaxX = (maxX - vp.x) / vp.scale;
      const worldMinY = (minY - vp.y) / vp.scale;
      const worldMaxY = (maxY - vp.y) / vp.scale;

      // Find intersecting nodes (AABB intersection)
      const hits: string[] = [];
      for (const node of nodes.value.values()) {
        if (node.dockPosition !== null) continue;
        const nx = node.position.x;
        const ny = node.position.y;
        if (
          nx + node.size.width > worldMinX &&
          nx < worldMaxX &&
          ny + node.size.height > worldMinY &&
          ny < worldMaxY
        ) {
          hits.push(node.id);
        }
      }
      if (hits.length > 0) {
        selectNodes(hits);
      }
    }

    setLasso(null);
  }, []);

  useEffect(() => {
    if (annotationMode) return;
    if (!isAnnotating.current && !draftAnnotation && !textDraft) return;
    isAnnotating.current = false;
    annotationPoints.current = [];
    setDraftAnnotation(null);
    setTextDraft(null);
  }, [annotationMode, draftAnnotation, setTextDraft, textDraft]);

  const commitTextDraft = useCallback(() => {
    const draft = textDraftRef.current;
    if (!draft) return;
    const text = draft.value.trim();
    setTextDraft(null);
    if (!text) return;
    const point = { x: draft.x, y: draft.y };
    void createAnnotationFromClient({
      type: 'text',
      points: [point],
      color: ANNOTATION_COLOR,
      width: TEXT_ANNOTATION_WIDTH,
      text,
    });
  }, [setTextDraft]);

  useEffect(() => {
    if (annotationTool !== 'text' && textDraft) setTextDraft(null);
  }, [annotationTool, setTextDraft, textDraft]);

  // ── Drag-to-connect: track cursor in world space, hit-test on drop ──
  useEffect(() => {
    function handleMove(e: PointerEvent) {
      if (!draggingEdge.value) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const v = viewport.value;
      draggingEdge.value = {
        ...draggingEdge.value,
        cursorX: (e.clientX - rect.left - v.x) / v.scale,
        cursorY: (e.clientY - rect.top - v.y) / v.scale,
      };
    }

    function handleUp(e: PointerEvent) {
      const drag = draggingEdge.value;
      if (!drag) return;
      draggingEdge.value = null;

      // Hit-test: find node under cursor
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const v = viewport.value;
      const wx = (e.clientX - rect.left - v.x) / v.scale;
      const wy = (e.clientY - rect.top - v.y) / v.scale;

      for (const node of nodes.value.values()) {
        if (node.id === drag.fromId || node.dockPosition !== null) continue;
        if (
          wx >= node.position.x &&
          wx <= node.position.x + node.size.width &&
          wy >= node.position.y &&
          wy <= node.position.y + node.size.height
        ) {
          createEdgeFromClient(drag.fromId, node.id, 'relation');
          return;
        }
      }
    }

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [containerRef]);

  // ── Double-click on background → create new markdown node ──
  const handleDblClick = useCallback(
    (e: MouseEvent) => {
      if (annotationMode) return;
      const container = containerRef.current;
      if (!container || e.target !== container) return;
      const rect = container.getBoundingClientRect();
      const v = viewport.value;
      const wx = (e.clientX - rect.left - v.x) / v.scale;
      const wy = (e.clientY - rect.top - v.y) / v.scale;
      // Offset so node centers on click point
      const nodeW = 520;
      const nodeH = 360;
      createNodeFromClient({
        type: 'markdown',
        title: 'New note',
        x: wx - nodeW / 2,
        y: wy - nodeH / 2,
        width: nodeW,
        height: nodeH,
      });
    },
    [annotationMode, containerRef],
  );

  const handleContextMenu = useCallback(
    (e: MouseEvent) => {
      if (annotationMode) return;
      if (!onCanvasContextMenu) return;

      const container = containerRef.current;
      if (!container) return;

      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('.canvas-node')) return;

      const rect = container.getBoundingClientRect();
      const v = viewport.value;
      const canvasX = (e.clientX - rect.left - v.x) / v.scale;
      const canvasY = (e.clientY - rect.top - v.y) / v.scale;
      onCanvasContextMenu(e, canvasX, canvasY);
    },
    [annotationMode, containerRef, onCanvasContextMenu],
  );

  // ── Drag-and-drop files from filesystem ──
  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    dropCounter.current++;
    if (e.dataTransfer?.types.includes('Files') || hasUrlPayload(e.dataTransfer)) {
      setDropActive(true);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    dropCounter.current--;
    if (dropCounter.current <= 0) {
      dropCounter.current = 0;
      setDropActive(false);
          }
  }, []);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    setDropActive(false);
        dropCounter.current = 0;

    const container = containerRef.current;
    if (!container || !e.dataTransfer) return;

    const rect = container.getBoundingClientRect();
    const vp = viewport.value;
    const baseWx = (e.clientX - rect.left - vp.x) / vp.scale;
    const baseWy = (e.clientY - rect.top - vp.y) / vp.scale;

    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) {
      const urls = getTransferUrls(e.dataTransfer);
      await createWebpageNodes(urls, baseWx, baseWy);
      return;
    }

    const nodeW = 400;
    const nodeH = 300;
    const spacing = 20;
    const cols = Math.ceil(Math.sqrt(files.length));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const wx = baseWx - (cols * (nodeW + spacing)) / 2 + col * (nodeW + spacing);
      const wy = baseWy - nodeH / 2 + row * (nodeH + spacing);

      const type = nodeTypeFromFilename(file.name);
      const fileName = file.name;

      if (type === 'image') {
        const reader = new FileReader();
        const dataUri: string = await new Promise((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        await createNodeFromClient({ type: 'image', title: fileName, content: dataUri, x: wx, y: wy, width: nodeW, height: nodeH });
      } else {
        const text = await file.text();
        const isWide = type === 'markdown' || type === 'file';
        await createNodeFromClient({ type, title: fileName, content: text, x: wx, y: wy, width: isWide ? 720 : nodeW, height: isWide ? 500 : nodeH });
      }
    }
  }, [containerRef, createWebpageNodes]);

  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableElement(e.target instanceof Element ? e.target : null)) return;
      if (isEditableElement(document.activeElement)) return;

      const text = e.clipboardData?.getData('text/plain') ?? '';
      const urls = extractUrlsFromText(text);
      if (urls.length === 0) return;

      const container = containerRef.current;
      if (!container) return;

      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const vp = viewport.value;
      const centerX = (rect.width / 2 - vp.x) / vp.scale;
      const centerY = (rect.height / 2 - vp.y) / vp.scale;
      await createWebpageNodes(urls, centerX, centerY);
    };

    document.addEventListener('paste', handlePaste);
    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [containerRef, createWebpageNodes]);

  // Only render world-space nodes (dockPosition === null); docked nodes are in the HUD layer.
  // Do NOT sort by zIndex here — CSS z-index handles visual stacking. Sorting would
  // reorder DOM children when bringToFront() changes zIndex, causing browsers to
  // detach/reattach iframe elements (which forces them to reload/reconnect).
  // Group nodes render first (behind) so they serve as visual containers.
  const worldNodes = getRenderableWorldNodes(nodes.value.values(), expandedNodeId.value);

  // Compute lasso overlay rect in screen space
  let lassoStyle: Record<string, string> | null = null;
  if (lasso) {
    const l = Math.min(lasso.startX, lasso.currentX);
    const t = Math.min(lasso.startY, lasso.currentY);
    const w = Math.abs(lasso.currentX - lasso.startX);
    const h = Math.abs(lasso.currentY - lasso.startY);
    lassoStyle = {
      position: 'absolute',
      left: `${l}px`,
      top: `${t}px`,
      width: `${w}px`,
      height: `${h}px`,
      pointerEvents: 'none',
    };
  }

  return (
    <div
      class="canvas-viewport"
      ref={containerRef}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onDblClick={handleDblClick}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        cursor: annotationTool === 'eraser'
          ? 'cell'
          : annotationTool === 'text'
            ? 'text'
          : annotationMode || draggingEdge.value || isLassoing.current
            ? 'crosshair'
            : 'grab',
      }}
    >
      {/* D4: CSS matrix(a,b,c,d,tx,ty) — scale uniformly (a=d=scale, b=c=0)
          then translate (tx=v.x, ty=v.y). transformOrigin: '0 0' ensures
          the scale pivot is the top-left corner of the world layer. */}
      <div
        style={{
          transform: `matrix(${v.scale}, 0, 0, ${v.scale}, ${v.x}, ${v.y})`,
          transformOrigin: '0 0',
          willChange: 'transform',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
      >
        <FocusFieldLayer />
        <IntentLayer />
        <EdgeLayer nodes={nodes} edges={edges} />
        <AnnotationLayer annotations={Array.from(annotations.value.values())} />
        {draftAnnotation && draftAnnotation.points.length >= 2 && <AnnotationLayer annotations={[draftAnnotation]} />}
        {worldNodes.map((node) => (
          <CanvasNode key={node.id} node={node} onContextMenu={onNodeContextMenu}>
            {renderNodeContent(node)}
          </CanvasNode>
        ))}
        {/* Snap alignment guide lines */}
        {activeGuides.value && (
          <svg class="snap-guides-svg" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
            {activeGuides.value.map((g, i) =>
              g.axis === 'x' ? (
                <line key={i} x1={g.pos} y1={g.from - 20} x2={g.pos} y2={g.to + 20} class="snap-guide-line" />
              ) : (
                <line key={i} x1={g.from - 20} y1={g.pos} x2={g.to + 20} y2={g.pos} class="snap-guide-line" />
              ),
            )}
          </svg>
        )}
      </div>
      {annotationMode && <div class={`annotation-capture-layer${annotationTool === 'eraser' ? ' erasing' : ''}${annotationTool === 'text' ? ' text' : ''}`} aria-hidden="true" />}
      {textDraft && (
        <input
          class="annotation-text-input"
          value={textDraft.value}
          autoFocus
          style={{
            left: `${textDraft.x * v.scale + v.x}px`,
            top: `${textDraft.y * v.scale + v.y}px`,
            fontSize: `${TEXT_ANNOTATION_WIDTH * v.scale}px`,
          }}
          onInput={(e) => setTextDraft({ ...textDraft, value: (e.target as HTMLInputElement).value })}
          onBlur={commitTextDraft}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitTextDraft();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setTextDraft(null);
            }
          }}
        />
      )}
      {lassoStyle && <div class="lasso-rect" style={lassoStyle} />}
      {dropActive && (
        <div class="drop-zone-overlay">
          <div class="drop-zone-indicator">
            <div class="drop-zone-icon">+</div>
            <div class="drop-zone-label">Drop files or URLs to add to canvas</div>
          </div>
        </div>
      )}
    </div>
  );
}
