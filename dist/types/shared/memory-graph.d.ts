/** Board-qualified identities: card IDs alone are not unique across a library. */
export interface MemoryTarget {
    boardId: string;
    cardId?: string;
}
export interface WikiLink {
    ref: string;
    target?: MemoryTarget;
}
export declare function wikiLinksFromData(data: Record<string, unknown>): WikiLink[];
export declare const memoryKey: (target: MemoryTarget) => string;
export interface MemoryGraphNode extends MemoryTarget {
    key: string;
    kind: 'board' | 'card';
    title: string;
    summary: string;
    folder: string | null;
    inContext: boolean;
    summaryOnly: true;
    /** False when the focused view omits incident relations; cannot acknowledge all links. */
    linksComplete?: boolean;
    /** Card link revision captured with this projection. */
    linksRevision?: number;
    type?: string;
    nodeCount?: number;
    position?: {
        x: number;
        y: number;
    };
}
export interface MemoryGraphEdge {
    id: string;
    from: string;
    to: string;
    kind: 'member' | 'portal' | 'wiki' | 'card' | 'previous';
    label?: string;
    type?: string;
    source: MemoryTarget;
    target: MemoryTarget;
    missing: boolean;
}
export interface MemoryGraph {
    nodes: MemoryGraphNode[];
    edges: MemoryGraphEdge[];
    unresolvedLinks: Array<{
        source: MemoryTarget;
        ref: string;
    }>;
    focus: string | null;
    depth: number;
}
