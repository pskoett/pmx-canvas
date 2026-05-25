/**
 * SQLite persistence layer for canvas state.
 *
 * Uses Bun's built-in `bun:sqlite` for zero-dependency, synchronous,
 * WAL-mode persistence. Replaces the previous JSON file-based approach.
 */
import { Database } from 'bun:sqlite';
import type { CanvasAnnotation, CanvasEdge, CanvasNodeState, CanvasSnapshot, CanvasSnapshotListOptions, ViewportState } from './canvas-state.js';
export interface PersistedCanvasState {
    version: number;
    viewport: ViewportState;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations?: CanvasAnnotation[];
    contextPins: string[];
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
