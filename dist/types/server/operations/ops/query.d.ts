import { type Operation } from '../types.js';
/**
 * The brief's page size in UTF-16 characters (canvas://context?budget=N). It is
 * not shown to the human: a brief longer than one page continues on the next read.
 */
export declare const DEFAULT_CONTEXT_BRIEF_BUDGET = 16000;
export declare const MAX_CONTEXT_BRIEF_BUDGET = 100000;
/** Search without opening boards; HTTP, MCP and SDK share discovery and ranking. */
export declare function searchCanvasNodes(q: string, options?: {
    scope?: 'active' | 'library';
    boardId?: string;
    folder?: string;
    limit?: number | string;
}): {
    results: {
        qualification?: import("../../../shared/lifecycle-status.js").LifecycleQualification | undefined;
        boardId: string | null;
        cardId: string;
        id: string;
        type: string;
        title: string | null;
        snippet: string;
        score: number;
    }[];
    query: string;
};
export declare const queryOperations: Operation[];
