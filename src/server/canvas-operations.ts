import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { recomputeCodeGraph } from './code-graph.js';
import { canvasState, IMAGE_MIME_MAP, type CanvasNodeState } from './canvas-state.js';
import { unwatchFileForNode, watchFileForNode } from './file-watcher.js';
import { mutationHistory } from './mutation-history.js';
import { findOpenCanvasPosition } from './placement.js';

export type CanvasArrangeMode = 'grid' | 'column' | 'flow';

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

function buildNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  if (input.type === 'file') return buildFileNodeData(input);
  if (input.type === 'image') return buildImageNodeData(input);
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

  return { id, needsCodeGraphRecompute: input.type === 'file' };
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

export function arrangeCanvasNodes(layout: CanvasArrangeMode): { arranged: number; layout: CanvasArrangeMode } {
  const nodes = canvasState.getLayout().nodes;
  const gap = 24;
  const oldPositions = nodes.map((node) => ({ id: node.id, position: { ...node.position } }));

  canvasState.withSuppressedRecording(() => {
    if (layout === 'column') {
      let y = 80;
      for (const node of nodes) {
        canvasState.updateNode(node.id, { position: { x: 40, y } });
        y += node.size.height + gap;
      }
      return;
    }

    if (layout === 'flow') {
      let x = 40;
      for (const node of nodes) {
        canvasState.updateNode(node.id, { position: { x, y: 80 } });
        x += node.size.width + gap;
      }
      return;
    }

    const cols = Math.max(1, Math.floor(1440 / (360 + gap)));
    let col = 0;
    let rowY = 80;
    let rowMaxHeight = 0;
    for (const node of nodes) {
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
    description: `Auto-arranged ${nodes.length} nodes (${layout})`,
    operationType: 'arrange',
    forward: () => canvasState.withSuppressedRecording(() => {
      for (const position of newPositions) canvasState.updateNode(position.id, { position: position.position });
    }),
    inverse: () => canvasState.withSuppressedRecording(() => {
      for (const position of oldPositions) canvasState.updateNode(position.id, { position: position.position });
    }),
  });

  return { arranged: nodes.length, layout };
}
