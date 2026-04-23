import type { CanvasNodeState } from './canvas-state.js';
export interface AgentContextNode {
    id: string;
    type: CanvasNodeState['type'];
    title: string | null;
    content: string | null;
    metadata?: Record<string, unknown>;
    position?: {
        x: number;
        y: number;
    };
}
interface AgentContextOptions {
    defaultTextLength?: number;
    webpageTextLength?: number;
    includePosition?: boolean;
}
export declare function summarizeNodeForAgentContext(node: CanvasNodeState, options?: AgentContextOptions): string;
export declare function serializeNodeForAgentContext(node: CanvasNodeState, options?: AgentContextOptions): AgentContextNode;
export declare function buildAgentContextPreamble(nodes: CanvasNodeState[], options?: AgentContextOptions): string;
export {};
