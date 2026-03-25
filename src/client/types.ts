export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasNodeState {
  id: string;
  type: 'markdown' | 'mcp-app' | 'status' | 'context' | 'ledger' | 'trace' | 'prompt' | 'response';
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
  status: 'STATUS',
  context: 'CONTEXT',
  ledger: 'LOG',
  trace: 'TRACE',
  prompt: 'ASK',
  response: 'REPLY',
};

/** Node types that support the full-viewport expand/focus overlay. */
export const EXPANDABLE_TYPES = new Set<CanvasNodeState['type']>([
  'markdown',
  'mcp-app',
  'response',
  'context',
  'ledger',
  'prompt',
]);

export interface CanvasLayout {
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
}
