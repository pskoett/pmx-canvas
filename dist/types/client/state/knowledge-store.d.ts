export declare const knowledge: import("@preact/signals-core").Signal<{
    ok: true;
    categories: import("../../server/knowledge-lifecycle.js").KnowledgeCategory[];
    folders: import("../../server/knowledge-lifecycle.js").FolderProperties[];
    relationPresets: import("../../shared/relations.js").RelationPreset[];
    cards: Record<string, import("../../shared/lifecycle-status.js").LifecycleQualification>;
    resolvedFolders: Record<string, ReturnType<import("../../server/knowledge-lifecycle.js").KnowledgeLifecycle["resolve"]>>;
} | null>;
export declare const knowledgeUnavailable: import("@preact/signals-core").Signal<boolean>;
export declare const lifecycleFilter: import("@preact/signals-core").Signal<"All" | "To review" | "Retired">;
export declare const lifecycleTarget: import("@preact/signals-core").Signal<{
    boardId: string;
    nodeId: string;
    incarnation: number;
} | null>;
export declare const retirementUndo: import("@preact/signals-core").Signal<{
    boardId: string;
    nodeId: string;
    incarnation: number;
} | null>;
export declare function refreshKnowledge(): Promise<void>;
export declare function cardQualification(nodeId: string): import("../../shared/lifecycle-status.js").LifecycleQualification | undefined;
export declare function openLifecycle(nodeId: string): void;
