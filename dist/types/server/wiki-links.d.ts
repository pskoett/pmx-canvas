import type { MemoryTarget, WikiLink } from '../shared/memory-graph.js';
export declare function wikiReferences(content: string): string[];
export interface WikiBoard {
    id: string;
    name: string;
    cards: Array<{
        id: string;
        title: string;
    }>;
}
/** IDs win over names; title matches must be unique. Never retarget an already bound link. */
export declare function resolveWikiLinks(content: string, previous: WikiLink[], boards: WikiBoard[]): WikiLink[];
/** Only server-owned bindings may navigate; the client still sanitizes rendered HTML. */
export declare function renderWikiMarkdown(content: string, links: WikiLink[], exists: (target: MemoryTarget) => boolean): string;
