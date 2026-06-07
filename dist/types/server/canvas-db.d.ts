/**
 * SQLite persistence layer for canvas state.
 *
 * Uses Bun's built-in `bun:sqlite` for zero-dependency, synchronous,
 * WAL-mode persistence. Replaces the previous JSON file-based approach.
 */
import { Database } from 'bun:sqlite';
import type { CanvasAnnotation, CanvasEdge, CanvasNodeState, CanvasSnapshot, CanvasSnapshotListOptions, ViewportState } from './canvas-state.js';
import { type PmxAxState, type PmxAxEvent, type PmxAxEvidence, type PmxAxSteeringMessage, type PmxAxHostCapability, type PmxAxTimelineSummary } from './ax-state.js';
export type CanvasTheme = 'dark' | 'light' | 'high-contrast';
export declare function normalizeCanvasTheme(value: unknown, fallback?: CanvasTheme): CanvasTheme;
export interface PersistedCanvasState {
    version: number;
    theme?: CanvasTheme;
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations?: CanvasAnnotation[];
    contextPins: string[];
    ax?: PmxAxState;
}
export declare function openCanvasDb(dbPath: string): Database;
export declare function checkpointCanvasDb(db: Database): void;
export declare function finalizeCanvasDbForClose(db: Database): void;
export declare function saveStateToDB(db: Database, state: PersistedCanvasState): void;
/** Check if the DB has been populated with canvas state at least once. */
export declare function isDbPopulated(db: Database): boolean;
export declare function loadStateFromDB(db: Database): PersistedCanvasState | null;
export declare function saveSnapshotToDB(db: Database, snapshot: CanvasSnapshot, state: PersistedCanvasState): void;
export declare function loadSnapshotFromDB(db: Database, idOrName: string): {
    snapshot: CanvasSnapshot;
    state: PersistedCanvasState;
} | null;
export declare function listSnapshotsFromDB(db: Database, options?: CanvasSnapshotListOptions): CanvasSnapshot[];
export declare function deleteSnapshotFromDB(db: Database, id: string): boolean;
export declare function writeBlobToDB(db: Database, sha256: string, jsonValue: string): number;
export declare function readBlobFromDB(db: Database, sha256: string): string | null;
export declare function hasBlobInDB(db: Database, sha256: string): boolean;
export interface AxTimelineQuery {
    limit?: number;
    sessionId?: string;
}
export declare function appendAxEventToDB(db: Database, ev: Omit<PmxAxEvent, 'seq'>): PmxAxEvent;
export declare function appendAxEvidenceToDB(db: Database, ev: Omit<PmxAxEvidence, 'seq'>): PmxAxEvidence;
export declare function appendAxSteeringToDB(db: Database, s: Omit<PmxAxSteeringMessage, 'seq'>): PmxAxSteeringMessage;
export declare function markAxSteeringDeliveredInDB(db: Database, id: string): boolean;
export declare function loadAxEventsFromDB(db: Database, q?: AxTimelineQuery): PmxAxEvent[];
export declare function loadAxEvidenceFromDB(db: Database, q?: AxTimelineQuery): PmxAxEvidence[];
export declare function loadAxSteeringFromDB(db: Database, q?: AxTimelineQuery & {
    onlyPending?: boolean;
}): PmxAxSteeringMessage[];
export declare function loadPendingAxSteeringFromDB(db: Database, options?: {
    consumer?: string;
    limit?: number;
}): PmxAxSteeringMessage[];
export declare function loadAxTimelineSummaryFromDB(db: Database): PmxAxTimelineSummary;
export declare function upsertAxHostCapabilityToDB(db: Database, cap: PmxAxHostCapability): void;
export declare function loadAxHostCapabilityFromDB(db: Database): PmxAxHostCapability | null;
