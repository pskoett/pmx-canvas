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
    | 'prompt'
    | 'response'
    | 'status'
    | 'context'
    | 'ledger'
    | 'trace'
    | 'file'
    | 'image'
    | 'group';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
  dockPosition: 'left' | 'right' | null;
  data: Record<string, unknown>;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type: 'relation' | 'depends-on' | 'flow' | 'references';
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  animated?: boolean;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

// ── Shared constants for node type display ──────────────────

export const TYPE_LABELS: Record<CanvasNodeState['type'], string> = {
  markdown: 'MD',
  'mcp-app': 'APP',
  webpage: 'WEB',
  'json-render': 'UI',
  graph: 'GRAPH',
  prompt: 'ASK',
  response: 'ANS',
  status: 'STATUS',
  context: 'CONTEXT',
  ledger: 'LOG',
  trace: 'TRACE',
  file: 'FILE',
  image: 'IMG',
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
  'image',
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
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
}
