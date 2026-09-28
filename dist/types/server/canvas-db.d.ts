/**
 * SQLite persistence layer for canvas state.
 *
 * Uses Bun's built-in `bun:sqlite` for zero-dependency, synchronous,
 * WAL-mode persistence. Replaces the previous JSON file-based approach.
 */
import { Database } from 'bun:sqlite';
import { type Tour } from '../shared/tour.js';
import { type CanvasThemeName } from '../shared/themes.js';
import type { CanvasAnnotation, CanvasEdge, CanvasNodeState, CanvasSnapshot, CanvasSnapshotListOptions, ViewportState } from './canvas-state.js';
import { type PmxAxState, type PmxAxEvent, type PmxAxEvidence, type PmxAxSteeringMessage, type PmxAxHostCapability, type PmxAxTimelineSummary } from './ax-state.js';
export type CanvasTheme = CanvasThemeName;
export declare function normalizeCanvasTheme(value: unknown, fallback?: CanvasTheme): CanvasTheme;
export interface PersistedCanvasState {
    tour?: Tour;
    version: number;
    theme?: CanvasTheme;
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations?: CanvasAnnotation[];
    contextPins: string[];
    ax?: PmxAxState;
    revisionState?: PersistedRevisionState;
}
export interface PersistedRevisionState {
    revision: number;
    floor: number;
    tombstones: Array<{
        nodeId: string;
        revision: number;
        deletedBy: import('./attribution.js').ActorAttribution;
    }>;
}
/** Durable, delivery-based context cursor. This is separate from the bounded diagnostic read log. */
export declare function readContextBriefCursor(db: Database, boardId: string, consumer: string): number | null;
/** Monotonic update prevents a stale concurrent response from regressing a consumer. */
export declare function advanceContextBriefCursor(db: Database, boardId: string, consumer: string, revision: number): void;
export interface OpenCanvasDbOptions {
    /** Name for the board a pre-boards (0.6.x) database migrates into. */
    migratedBoardName?: string;
}
export declare function openCanvasDb(dbPath: string, options?: OpenCanvasDbOptions): Database;
export declare function createBoardId(): string;
export declare function checkpointCanvasDb(db: Database): void;
/**
 * Delete blob rows nothing references any more. Blobs are content-addressed and
 * written with INSERT OR IGNORE, so editing a node's html supersedes its old blob
 * and leaves it orphaned — without this, `canvas.db` (which is git-committable)
 * would grow without bound once externalization applies to ordinary html nodes.
 *
 * References are collected by scanning the raw persisted JSON for sha256 fields
 * rather than parsing every node. That deliberately OVER-approximates: a stray
 * 64-hex string keeps a blob alive that could have been dropped, which wastes a
 * little space. The opposite error would delete live content, so the scan is
 * biased to the safe side on purpose. Snapshot rows are scanned too — a snapshot
 * restore must still find its blobs.
 */
export declare function gcBlobsInDB(db: Database): number;
export declare function finalizeCanvasDbForClose(db: Database): void;
/** The theme is workspace-wide: it is saved even while no board is open. */
export declare function saveThemeToDB(db: Database, theme: CanvasTheme | undefined): void;
export declare function readThemeFromDB(db: Database): CanvasTheme | undefined;
/** Saves one board's state; every other board's rows are untouched. */
export declare function saveStateToDB(db: Database, boardId: string, state: PersistedCanvasState): void;
/** Loads one board (the open board when `boardId` is omitted); null when there is no such board. */
export declare function loadStateFromDB(db: Database, boardId?: string): PersistedCanvasState | null;
export interface CanvasBoard {
    id: string;
    name: string;
    /** A human-chosen shelf on Home ("Planning", "Research"); null is uncategorized. */
    category: string | null;
    createdAt: string;
    lastOpenedAt: string | null;
    nodeCount: number;
    /** Markdown node used as this board's introduction. */
    readmeNodeId: string | null;
}
/** Most recently opened first, then never-opened boards, newest first. */
export declare function listBoardsFromDB(db: Database): CanvasBoard[];
export declare function getBoardFromDB(db: Database, id: string): CanvasBoard | null;
export declare function createBoardInDB(db: Database, name: string, category?: string | null): CanvasBoard;
/** Rename and/or re-shelve a board; `category: null` removes it from its category. */
export declare function updateBoardInDB(db: Database, id: string, patch: {
    name?: string;
    category?: string | null;
    readmeNodeId?: string | null;
}): boolean;
/** Create and populate an inactive board as one SQLite transaction. */
export declare function createBoardWithStateInDB(db: Database, name: string, category: string | null, state: PersistedCanvasState, readmeNodeId: string | null): CanvasBoard;
/** Deletes a board with its rows and its snapshots. */
export declare function deleteBoardFromDB(db: Database, id: string): boolean;
export declare function readMetaFromDB(db: Database, key: string): string | null;
/** Write a workspace-wide meta value; null removes it. */
export declare function writeMetaToDB(db: Database, key: string, value: string | null): void;
/** The board that was open last, if it still exists. */
export declare function getActiveBoardIdFromDB(db: Database): string | null;
export declare function setActiveBoardIdInDB(db: Database, id: string | null): void;
export declare function saveSnapshotToDB(db: Database, boardId: string, snapshot: CanvasSnapshot, state: PersistedCanvasState): void;
/** By id on any board, else by name (most recent match) on `boardId`. */
export declare function loadSnapshotFromDB(db: Database, idOrName: string, boardId: string | null): {
    snapshot: CanvasSnapshot;
    state: PersistedCanvasState;
} | null;
export declare function listSnapshotsFromDB(db: Database, boardId: string, options?: CanvasSnapshotListOptions): CanvasSnapshot[];
export declare function renameSnapshotInDB(db: Database, id: string, name: string): boolean;
export declare function deleteSnapshotFromDB(db: Database, id: string): boolean;
export declare function writeBlobToDB(db: Database, sha256: string, jsonValue: string): number;
export declare function readBlobFromDB(db: Database, sha256: string): string | null;
export interface AxTimelineQuery {
    limit?: number;
    sessionId?: string;
}
export declare function appendAxEventToDB(db: Database, ev: Omit<PmxAxEvent, 'seq'>): PmxAxEvent;
export declare function appendAxEvidenceToDB(db: Database, ev: Omit<PmxAxEvidence, 'seq'>): PmxAxEvidence;
export declare function appendAxSteeringToDB(db: Database, s: Omit<PmxAxSteeringMessage, 'seq'>): PmxAxSteeringMessage;
export declare function markAxSteeringDeliveredInDB(db: Database, id: string, consumer?: string | null): boolean;
export declare function loadAxEventsFromDB(db: Database, q?: AxTimelineQuery): PmxAxEvent[];
export declare function loadAxEvidenceFromDB(db: Database, q?: AxTimelineQuery): PmxAxEvidence[];
/**
 * Broadcasts age out of PENDING (they stay on the timeline): per-consumer
 * delivery otherwise means every broadcast greets every FUTURE consumer key
 * forever — a brand-new pump inherited two-day-old "all workers" calls.
 * Addressed steers never expire here; they wait for their named consumer.
 */
export declare const BROADCAST_PENDING_TTL_MS: number;
export declare function loadAxSteeringFromDB(db: Database, q?: AxTimelineQuery & {
    onlyPending?: boolean;
}): PmxAxSteeringMessage[];
export declare function loadPendingAxSteeringFromDB(db: Database, options?: {
    consumer?: string;
    limit?: number;
}): PmxAxSteeringMessage[];
/**
 * NEWEST undelivered steering first (report #57) for the compact AX context lead
 * block — so a fresh steer is visible even behind a long backlog. Loop-safe: excludes
 * the consumer's own steering and steering targeted at a different consumer in SQL
 * so the LIMIT applies after both filters.
 * Distinct from loadPendingAxSteeringFromDB (FIFO oldest-first) which the claim/ack
 * delivery queue uses for ordered processing.
 */
export declare function loadNewestPendingAxSteeringFromDB(db: Database, options?: {
    consumer?: string;
    limit?: number;
}): PmxAxSteeringMessage[];
/** Total undelivered steering for a consumer (loop-safe — excludes the consumer's own; target-scoped). */
export declare function countPendingAxSteeringFromDB(db: Database, consumer?: string): number;
export declare function loadAxTimelineSummaryFromDB(db: Database): PmxAxTimelineSummary;
export declare function upsertAxHostCapabilityToDB(db: Database, cap: PmxAxHostCapability): void;
export declare function loadAxHostCapabilityFromDB(db: Database): PmxAxHostCapability | null;
