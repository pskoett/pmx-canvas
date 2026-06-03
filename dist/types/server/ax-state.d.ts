import type { CanvasLayout, CanvasNodeState } from './canvas-state.js';
import type { AgentContextNode } from './agent-context.js';
export type PmxAxSource = 'agent' | 'api' | 'browser' | 'cli' | 'codex' | 'copilot' | 'mcp' | 'sdk' | 'system';
export interface PmxAxFocusState {
    nodeIds: string[];
    primaryNodeId: string | null;
    updatedAt: string | null;
    source: PmxAxSource | null;
}
export interface PmxAxState {
    version: 1;
    focus: PmxAxFocusState;
}
export interface PmxAxPinnedContext {
    preamble: string;
    nodeIds: string[];
    count: number;
    nodes: AgentContextNode[];
}
export interface PmxAxFocusContext extends PmxAxFocusState {
    nodes: AgentContextNode[];
}
export interface PmxAxContext {
    version: 1;
    generatedAt: string;
    surface: {
        nodeCount: number;
        edgeCount: number;
    };
    pinned: PmxAxPinnedContext;
    focus: PmxAxFocusContext;
}
export declare function createEmptyAxFocusState(): PmxAxFocusState;
export declare function createEmptyAxState(): PmxAxState;
export declare function normalizeAxFocusState(input: unknown, validNodeIds?: Set<string>): PmxAxFocusState;
export declare function normalizeAxState(input: unknown, validNodeIds?: Set<string>): PmxAxState;
export declare function buildAxContext(input: {
    layout: CanvasLayout;
    pinned: PmxAxPinnedContext;
    focus: PmxAxFocusState;
    focusNodes: AgentContextNode[];
}): PmxAxContext;
export declare function nodeSetFromLayout(nodes: CanvasNodeState[]): Set<string>;
