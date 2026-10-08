import type { CanvasThemeName } from '../shared/themes.js';

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasNodeState {
  id: string;
  type:
    | 'markdown'
    | 'mcp-app'
    | 'webpage'
    | 'json-render'
    | 'graph'
    | 'board'
    | 'prompt'
    | 'response'
    | 'status'
    | 'context'
    | 'ledger'
    | 'trace'
    | 'file'
    | 'diff'
    | 'mermaid'
    | 'image'
    | 'html'
    | 'group';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
  contentRevision?: number;
  /** Revision of this node's latest link change, kept apart from its text. */
  linksRevision?: number;
  /** Who created / last edited the node's content (server attribution). */
  createdBy?: NodeActor;
  lastEditedBy?: NodeActor;
  data: Record<string, unknown>;
}

export interface NodeActor {
  actor: 'human' | 'agent' | 'system' | 'unknown';
  source: string;
  agentId?: string;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type: 'relation' | 'depends-on' | 'flow' | 'references';
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  animated?: boolean;
  /** Board revision of this link's latest add, retype or relabel. */
  revision?: number;
  changedBy?: NodeActor;
}

export interface CanvasAnnotationPoint {
  x: number;
  y: number;
}

export interface CanvasAnnotation {
  id: string;
  type: 'freehand' | 'text';
  points: CanvasAnnotationPoint[];
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  width: number;
  text?: string;
  label?: string;
  createdAt: string;
}

/** The rail's annotate modes; null = not annotating. */
export type AnnotationTool = 'pen' | 'eraser' | 'text' | null;

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

// ── Shared constants for node type display ──────────────────

export const TYPE_LABELS: Record<CanvasNodeState['type'], string> = {
  markdown: 'MD',
  'mcp-app': 'APP',
  webpage: 'WEB',
  'json-render': 'UI',
  graph: 'GRAPH',
  board: 'BOARD',
  prompt: 'ASK',
  response: 'ANS',
  status: 'STATUS',
  context: 'CONTEXT',
  ledger: 'LOG',
  trace: 'TRACE',
  file: 'FILE',
  diff: 'DIFF',
  mermaid: 'MERMAID',
  image: 'IMG',
  html: 'HTML',
  group: 'GROUP',
};

/** Node types that support the full-viewport expand/focus overlay. */
export const EXPANDABLE_TYPES = new Set<CanvasNodeState['type']>([
  'markdown',
  'mcp-app',
  'webpage',
  'json-render',
  'graph',
  'context',
  'ledger',
  'file',
  'diff',
  'mermaid',
  'image',
  'html',
]);

export const EXCALIDRAW_SERVER_NAME = 'Excalidraw';
export const EXCALIDRAW_CREATE_VIEW_TOOL = 'create_view';

export function isExcalidrawNode(node: CanvasNodeState): boolean {
  return (
    node.type === 'mcp-app' &&
    node.data.mode === 'ext-app' &&
    node.data.serverName === EXCALIDRAW_SERVER_NAME &&
    node.data.toolName === EXCALIDRAW_CREATE_VIEW_TOOL
  );
}

export interface CanvasLayout {
  viewport: ViewportState;
  theme?: CanvasThemeName;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
}
