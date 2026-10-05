export type AttentionTone = 'context' | 'relationship' | 'group' | 'cluster' | 'neighborhood' | 'remove';
export interface AttentionEntry {
    id: string;
    tone: AttentionTone;
    title: string;
    detail: string;
    nodeIds: string[];
    createdAt: number;
}
export declare const attentionToast: import("@preact/signals-core").Signal<AttentionEntry | null>;
export declare const attentionHistory: import("@preact/signals-core").Signal<AttentionEntry[]>;
export declare const attentionPulseNodeIds: import("@preact/signals-core").Signal<Set<string>>;
export declare const attentionHistoryOpen: import("@preact/signals-core").Signal<boolean>;
export declare const attentionHistoryUnread: import("@preact/signals-core").Signal<number>;
export declare function resetAttentionState(): void;
export declare function openAttentionHistory(): void;
export declare function closeAttentionHistory(): void;
export declare function setAttentionToast(entry: AttentionEntry | null): void;
export declare function pushAttentionHistory(entry: AttentionEntry, limit?: number): void;
export declare function setAttentionPulse(nodeIds: string[]): void;
