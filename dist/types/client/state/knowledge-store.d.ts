export { lifecycleFilter, lifecycleTarget } from './boards-store';
export declare const knowledge: import("@preact/signals-core").Signal<{
    ok: true;
    categories: import("../../server").KnowledgeCategory[];
    folders: import("../../server").FolderProperties[];
    relationPresets: import("../../shared/relations").RelationPreset[];
    cards: Record<string, import("../../shared/lifecycle-status").LifecycleQualification>;
    reviewCards: import("../../server/knowledge-lifecycle.js").ReviewCardSummary[];
    resolvedFolders: Record<string, ReturnType<import("../../server/knowledge-lifecycle.js").KnowledgeLifecycle["resolve"]>>;
} | null>;
export declare const knowledgeUnavailable: import("@preact/signals-core").Signal<boolean>;
export declare const effectiveLifecycleFilter: import("@preact/signals-core").ReadonlySignal<"All" | "To review" | "Retired">;
export declare const retirementUndo: import("@preact/signals-core").Signal<{
    boardId: string;
    nodeId: string;
    incarnation: number;
} | null>;
export declare function refreshKnowledge(): Promise<void>;
export declare function cardQualification(nodeId: string): import("../../shared/lifecycle-status").LifecycleQualification | undefined;
/** Raw pin membership survives retirement, but retired cards are not delivered. */
export declare const activeContextPinnedNodeIds: import("@preact/signals-core").ReadonlySignal<Set<string>>;
export declare function openLifecycle(nodeId: string): void;
