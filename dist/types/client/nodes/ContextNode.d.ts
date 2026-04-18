import type { CanvasNodeState } from '../types';
interface ContextCard {
    key?: string;
    title?: string;
    label?: string;
    summary?: string;
    path?: string;
    pathDisplay?: string;
    category?: string;
    sourceKind?: string;
    state?: string;
    required?: boolean;
}
export interface ContextCardDisplay {
    title: string;
    summary: string;
    pathDisplay: string;
    category?: string;
    sourceKind: string;
    status: string;
    required: boolean;
}
export interface ContextNodeFallbackDisplay {
    title: string;
    summary: string;
    path: string;
}
export declare function normalizeContextCardDisplay(card: ContextCard): ContextCardDisplay;
export declare function normalizeContextNodeFallback(nodeData: Record<string, unknown>): ContextNodeFallbackDisplay | null;
export declare function ContextNode({ node, expanded, }: {
    node: CanvasNodeState;
    expanded?: boolean;
}): import("preact/src").JSX.Element;
export {};
