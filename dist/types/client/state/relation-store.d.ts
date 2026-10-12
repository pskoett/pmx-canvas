export declare const relationFilter: import("@preact/signals-core").Signal<{
    boardId: string;
    kind: string;
} | null>;
export declare const relationFocus: import("@preact/signals-core").ReadonlySignal<string | null>;
/** View-only highlights. They never infer evidence, change a decision or execute a flow. */
export declare const relationHighlight: import("@preact/signals-core").ReadonlySignal<{
    cards: Set<string>;
    links: Set<string>;
} | null>;
