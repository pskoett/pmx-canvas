import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { type ActorAttribution } from './attribution.js';
import type { LifecycleQualification } from '../shared/lifecycle-status.js';
export declare const lifecycleSchema: z.ZodObject<{
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
}, z.core.$strict>;
export declare const categorySchema: z.ZodObject<{
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
    id: z.ZodString;
    name: z.ZodString;
    glyph: z.ZodString;
}, z.core.$strict>;
export type Lifecycle = z.infer<typeof lifecycleSchema>;
export type KnowledgeCategory = z.infer<typeof categorySchema>;
export interface FolderProperties {
    path: string;
    categoryId: string | null;
    lifecycleOverride: Lifecycle | null;
}
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
} | ({
    action: 'folder-set';
} & FolderProperties);
export interface KnowledgeResults {
    list: {
        ok: true;
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
        cards: Record<string, LifecycleQualification>;
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
    };
    setCategory(value: KnowledgeCategory): KnowledgeCategory;
    removeCategory(id: string): string;
    setFolder(value: FolderProperties): FolderProperties;
    resolve(folderPath: string | null, override?: Lifecycle | null, catalog?: {
        categories: KnowledgeCategory[];
        folders: FolderProperties[];
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
    reviews(boardId: string, nodeId: string): {
        records: ReviewRecord[];
        retired: boolean;
        lastValidation: ReviewRecord | null;
    };
    record(boardId: string, nodeId: string, input: Pick<ReviewRecord, 'outcome' | 'evidence' | 'applied'> & {
        expectedContentRevision?: number;
    }, sourceRevisions?: Record<string, number | null>): ReviewRecord;
}
