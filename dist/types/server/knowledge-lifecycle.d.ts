import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { type MemoryTarget } from '../shared/memory-graph.js';
import { type ActorAttribution } from './attribution.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
import type { CanvasNodeState } from './canvas-state.js';
import { type RelationPreset } from '../shared/relations.js';
import { type KnowledgeCategory, type Lifecycle } from '../shared/knowledge-lifecycle.js';
export { categorySchema, lifecycleSchema, type KnowledgeCategory, type Lifecycle, } from '../shared/knowledge-lifecycle.js';
export interface ReviewCardSummary {
    boardId: string;
    cardId: string;
    boardTitle: string;
    folder: string | null;
    title: string;
}
export declare const folderPropertiesSchema: z.ZodObject<{
    path: z.ZodString;
    categoryId: z.ZodNullable<z.ZodString>;
    lifecycleOverride: z.ZodNullable<z.ZodObject<{
        decayType: z.ZodEnum<{
            reality: "reality";
            decision: "decision";
            dependency: "dependency";
            relevance: "relevance";
        }>;
        rate: z.ZodEnum<{
            fast: "fast";
            medium: "medium";
            slow: "slow";
            durable: "durable";
        }>;
        triggers: z.ZodArray<z.ZodString>;
        revalidationMethod: z.ZodString;
        cadenceDays: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
}, z.core.$strip>;
export type FolderProperties = z.infer<typeof folderPropertiesSchema>;
export interface ReviewRecord {
    id: string;
    boardId: string;
    nodeId: string;
    outcome: 'retain' | 'revise' | 'externalize' | 'retire' | 'unresolved' | 'restore';
    evidence: string;
    applied: boolean;
    who: ActorAttribution;
    when: string;
    /** Exact semantic version reviewed; old unversioned records remain unknown. */
    contentRevision: number | null;
    sourceRevisions?: Record<string, number | null>;
}
export type KnowledgeInput = {
    action: 'list';
} | {
    action: 'category-set';
    category: KnowledgeCategory;
} | {
    action: 'category-remove';
    id: string;
} | {
    action: 'relation-preset-set';
    preset: RelationPreset;
} | {
    action: 'relation-preset-remove';
    id: string;
} | ({
    action: 'folder-set';
} & FolderProperties);
export interface KnowledgeResults {
    list: {
        ok: true;
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
        relationPresets: RelationPreset[];
        cards: Record<string, LifecycleQualification>;
        reviewCards: ReviewCardSummary[];
        resolvedFolders: Record<string, ReturnType<KnowledgeLifecycle['resolve']>>;
    };
    'category-set': {
        ok: true;
        category: KnowledgeCategory;
    };
    'category-remove': {
        ok: true;
        id: string;
    };
    'relation-preset-set': {
        ok: true;
        preset: RelationPreset;
    };
    'relation-preset-remove': {
        ok: true;
        id: string;
    };
    'folder-set': {
        ok: true;
        folder: FolderProperties;
    };
}
export type LifecycleInput = {
    action: 'get';
    id: string;
    board?: string;
} | {
    action: 'set';
    id: string;
    expectedBoardId?: string | null;
    lifecycleOverride: Lifecycle | null;
} | {
    action: 'review';
    id: string;
    expectedBoardId?: string | null;
    outcome: Exclude<ReviewRecord['outcome'], 'restore'>;
    evidence: string;
    applied: boolean;
    expectedContentRevision?: number;
    expectedSources?: Record<string, number | null>;
} | {
    action: 'restore';
    id: string;
    expectedBoardId?: string | null;
    evidence: string;
};
export interface LifecycleResults {
    get: {
        ok: true;
        boardId: string;
        nodeId: string;
        contentRevision: number;
        qualification: LifecycleQualification;
    } & ReturnType<KnowledgeLifecycle['resolve']> & ReturnType<KnowledgeLifecycle['reviews']>;
    set: {
        ok: true;
    };
    review: {
        ok: true;
        record: ReviewRecord;
    };
    restore: {
        ok: true;
        record: ReviewRecord;
    };
}
/** Workspace-owned data, deliberately outside board snapshots and read clocks. */
export declare class KnowledgeLifecycle {
    private readonly getDb;
    private readonly changed;
    private readonly getContentRevision;
    private readonly flush;
    constructor(getDb: () => Database | null, changed: () => void, getContentRevision: (boardId: string, nodeId: string) => number, flush: () => void);
    private db;
    list(): {
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
        relationPresets: RelationPreset[];
    };
    setRelationPreset(value: RelationPreset): RelationPreset;
    removeRelationPreset(id: string): string;
    setCategory(value: KnowledgeCategory): KnowledgeCategory;
    removeCategory(id: string): string;
    setFolder(value: FolderProperties): FolderProperties;
    resolve(folderPath: string | null, override?: Lifecycle | null, catalog?: {
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
        relationPresets: RelationPreset[];
    }): {
        category: {
            decayType: "reality" | "decision" | "dependency" | "relevance";
            rate: "fast" | "medium" | "slow" | "durable";
            triggers: string[];
            revalidationMethod: string;
            id: string;
            name: string;
            glyph: string;
            cadenceDays?: number | undefined;
        } | null;
        categorySourceFolder: string | null;
        lifecycle: {
            decayType: "reality" | "decision" | "dependency" | "relevance";
            rate: "fast" | "medium" | "slow" | "durable";
            triggers: string[];
            revalidationMethod: string;
            cadenceDays?: number | undefined;
        } | null;
        lifecycleSourceFolder: string | null;
        lifecycleSource: "unknown" | "card" | "folder";
    };
    resolveCard(folderPath: string | null, node: Pick<CanvasNodeState, 'type' | 'data'>, catalog?: {
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
        relationPresets: RelationPreset[];
    }): {
        category: {
            decayType: "reality" | "decision" | "dependency" | "relevance";
            rate: "fast" | "medium" | "slow" | "durable";
            triggers: string[];
            revalidationMethod: string;
            id: string;
            name: string;
            glyph: string;
            cadenceDays?: number | undefined;
        } | null;
        categorySourceFolder: string | null;
        lifecycle: {
            decayType: "reality" | "decision" | "dependency" | "relevance";
            rate: "fast" | "medium" | "slow" | "durable";
            triggers: string[];
            revalidationMethod: string;
            cadenceDays?: number | undefined;
        } | null;
        lifecycleSourceFolder: string | null;
        lifecycleSource: "unknown" | "card" | "folder";
    };
    private indexedDb;
    /** Stored owners of semantic sources; the caller overlays the active board's unsaved edges. */
    incomingSourceBoards(target: MemoryTarget, activeBoardId: string | null): string[];
    /** One indexed latest validation and retirement per card, never its full audit history. */
    reviewSummaries(targets: MemoryTarget[]): Map<string, {
        lastValidation: ReviewRecord | null;
        retired: boolean;
    }>;
    /** Resolve a current card's location when evidence was recorded, without rewriting that evidence. */
    locationAtReview(review: ReviewRecord, target: MemoryTarget): MemoryTarget;
    reviews(boardId: string, nodeId: string): {
        records: ReviewRecord[];
        retired: boolean;
        lastValidation: ReviewRecord | null;
    };
    record(boardId: string, nodeId: string, input: Pick<ReviewRecord, 'outcome' | 'evidence' | 'applied'> & {
        expectedContentRevision?: number;
    }, sourceRevisions?: Record<string, number | null>): ReviewRecord;
}
