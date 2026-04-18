export interface ViewportState {
    x: number;
    y: number;
    scale: number;
}
export interface CanvasNodeState {
    id: string;
    type: 'markdown' | 'mcp-app' | 'webpage' | 'json-render' | 'graph' | 'prompt' | 'response' | 'status' | 'context' | 'ledger' | 'trace' | 'file' | 'image' | 'group';
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
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
export declare const TYPE_LABELS: Record<CanvasNodeState['type'], string>;
/** Node types that support the full-viewport expand/focus overlay. */
export declare const EXPANDABLE_TYPES: Set<"markdown" | "mcp-app" | "webpage" | "json-render" | "graph" | "prompt" | "response" | "status" | "context" | "ledger" | "trace" | "file" | "image" | "group">;
export interface CanvasLayout {
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
}
