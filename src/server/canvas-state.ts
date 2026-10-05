/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas/canvas.db` (SQLite WAL mode)
 * in the workspace root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 * Legacy pre-0.2 formats (`.pmx-canvas/state.json`, `.pmx-canvas.json`,
 * `.pmx-canvas-snapshots/`, loose blob files) are no longer imported as of 0.4.0 —
 * the one-shot boot migration into SQLite was retired.
 */

import { createHash, randomUUID } from 'node:crypto';
import { tourSchema, type Tour } from '../shared/tour.js';
import {
  copyFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { basename, isAbsolute, join, dirname, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { normalizeCanvasNodeData } from './canvas-provenance.js';
import {
  openCanvasDb,
  saveStateToDB,
  loadStateFromDB,
  saveSnapshotToDB,
  loadSnapshotFromDB,
  listSnapshotsFromDB,
  deleteSnapshotFromDB,
  renameSnapshotInDB,
  writeBlobToDB,
  readBlobFromDB,
  checkpointCanvasDb,
  createBoardInDB,
  createBoardWithStateInDB,
  readContextBriefCursor,
  advanceContextBriefCursor,
  deleteBoardFromDB,
  getActiveBoardIdFromDB,
  getBoardFromDB,
  listBoardsFromDB,
  readMetaFromDB,
  readThemeFromDB,
  updateBoardInDB,
  writeMetaToDB,
  saveThemeToDB,
  setActiveBoardIdInDB,
  type CanvasBoard,
  finalizeCanvasDbForClose,
  type ContextPinMeta,
  type PersistedCanvasState,
  type CanvasTheme,
  type AxTimelineQuery,
} from './canvas-db.js';
import {
  copyBoardAttachments,
  createImport,
  getAttachment,
  getImport,
  listImports,
  readAttachmentBytes,
  storeAttachment,
  updateImport,
  type DocumentImport,
  type DocumentImportStatus,
  type ImportSection,
  type Attachment,
} from './document-import.js';
import { normalizeCanvasTheme } from './canvas-db.js';
import {
  type CanvasPlacementRect,
  computeGroupBounds,
  computePackedGroupLayout,
  GROUP_PAD,
  GROUP_TITLEBAR_HEIGHT,
  resolveGroupCollision,
} from './placement.js';
import {
  createEmptyAxState,
  type PmxAxActivityKind,
  type PmxAxElicitation,
  type PmxAxModeRequest,
  type PmxAxMode,
  type PmxAxCommandDescriptor,
  type PmxAxPolicy,
  type PmxAxFocusState,
  type PmxAxSource,
  type PmxAxState,
  type PmxAxWorkItem,
  type PmxAxWorkItemStatus,
  type PmxAxApprovalGate,
  type PmxAxReviewAnnotation,
  type PmxAxReviewKind,
  type PmxAxReviewSeverity,
  type PmxAxReviewStatus,
  type PmxAxReviewAnchorType,
  type PmxAxReviewRegion,
  type PmxAxEvent,
  type PmxAxEventKind,
  type PmxAxEvidence,
  type PmxAxEvidenceKind,
  type PmxAxSteeringMessage,
  type PmxAxHostCapability,
  type PmxAxTimelineSummary,
} from './ax-state.js';
import { AxStateManager } from './ax-state-manager.js';
import { currentActor, unknownActor, type ActorAttribution } from './attribution.js';
import {
  appendContextReadToDB,
  loadContextReadsFromDB,
  loadNodeReadStatusFromDB,
  type ContextRead,
  type ContextReadConsumerSummary,
  type ContextReadInput,
  type NodeReadStatus,
} from './context-reads.js';

function logCanvasStateWarning(action: string, error: unknown, details?: Record<string, unknown>): void {
  console.warn(`[canvas-state] ${action}`, { error, ...(details ?? {}) });
}

function normalizePositiveInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.floor(value);
}

function normalizeSnapshotTimestamp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export const PMX_CANVAS_DIR = '.pmx-canvas';
const DB_FILENAME = 'canvas.db';
const SNAPSHOTS_SUBDIR = 'snapshots';
const BLOBS_SUBDIR = 'blobs';
const SAVE_DEBOUNCE_MS = 500;
const BLOB_JSON_THRESHOLD_BYTES = Number(process.env.PMX_CANVAS_BLOB_THRESHOLD_BYTES ?? '2048');
const BLOB_DATA_FIELDS = new Set([
  'html',
  'toolInput',
  'toolResult',
  'toolDefinition',
  'resourceMeta',
  'appModelContext',
  'appCheckpoint',
]);

export interface PersistedBlobRef {
  __pmxCanvasBlob: 'v1';
  path: string;
  sha256: string;
  encoding: 'json+gzip';
  bytes: number;
  jsonBytes: number;
}

// Re-export for backward compat — canonical definition is now in canvas-db.ts
export type { PersistedCanvasState } from './canvas-db.js';

interface LoadFromDiskOptions {
  clearExisting?: boolean;
}

export const IMAGE_MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
};

export interface CanvasSnapshot {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface CanvasSnapshotListOptions {
  limit?: number;
  query?: string;
  before?: string;
  after?: string;
  all?: boolean;
}

export interface CanvasSnapshotGcOptions {
  keep?: number;
  dryRun?: boolean;
}

export interface CanvasSnapshotGcResult {
  ok: boolean;
  kept: number;
  deleted: CanvasSnapshot[];
  dryRun: boolean;
}

export interface CanvasNodeState {
  id: string;
  type:
    | 'markdown'
    | 'mcp-app'
    | 'webpage'
    | 'json-render'
    | 'graph'
    | 'board'
    | 'prompt'
    | 'response'
    | 'status'
    | 'context'
    | 'ledger'
    | 'trace'
    | 'file'
    | 'diff'
    | 'mermaid'
    | 'image'
    | 'html'
    | 'group';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
  data: Record<string, unknown>;
  /** Server-owned provenance. Legacy rows normalize to unknown. */
  createdBy?: ActorAttribution;
  lastEditedBy?: ActorAttribution;
  /** Board-monotonic revision of this node's latest semantic content. */
  contentRevision?: number;
}

export interface NodeDeletionTombstone {
  nodeId: string;
  revision: number;
  deletedBy: ActorAttribution;
}

export interface BoardContentRevision {
  revision: number;
  /** Cursors below this value are expired and must perform a full reset. */
  retentionFloor: number;
}

export interface BoardContentDelta extends BoardContentRevision {
  since: number;
  reset: boolean;
  nodes: CanvasNodeState[];
  deleted: NodeDeletionTombstone[];
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  to: string;
  type: 'relation' | 'depends-on' | 'flow' | 'references';
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
  animated?: boolean;
}

export interface CanvasAnnotationPoint {
  x: number;
  y: number;
}

export interface CanvasAnnotation {
  id: string;
  type: 'freehand' | 'text';
  points: CanvasAnnotationPoint[];
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  width: number;
  text?: string;
  label?: string;
  createdAt: string;
}

export interface CanvasLayout {
  tour?: Tour;
  viewport: ViewportState;
  theme: CanvasTheme;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations: CanvasAnnotation[];
}

export interface CanvasNodeUpdate {
  id: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  collapsed?: boolean;
}

export type CanvasChangeType = 'pins' | 'nodes' | 'ax' | 'ax-timeline';

/** Name for a board nobody named yet: when it was made, to the minute. */
export function defaultBoardName(): string {
  return `Board ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
}

export interface MutationRecordInfo {
  operationType:
    | 'addNode'
    | 'updateNode'
    | 'removeNode'
    | 'addEdge'
    | 'updateEdge'
    | 'removeEdge'
    | 'addAnnotation'
    | 'removeAnnotation'
    | 'clear'
    | 'restoreSnapshot'
    | 'setPins'
    | 'setAxFocus'
    | 'addWorkItem'
    | 'updateWorkItem'
    | 'requestApproval'
    | 'resolveApproval'
    | 'addReviewAnnotation'
    | 'updateReviewAnnotation'
    | 'requestElicitation'
    | 'respondElicitation'
    | 'requestMode'
    | 'resolveModeRequest'
    | 'setPolicy'
    | 'arrange'
    | 'batch'
    | 'groupNodes'
    | 'releaseGroupChildren'
    | 'viewport';
  description: string;
  forward: () => void;
  inverse: () => void;
}

interface GroupNodesOptions {
  preservePositions?: boolean;
  layout?: 'grid' | 'column' | 'flow';
  keepGroupFrame?: boolean;
}

interface ApplyUpdatesOptions {
  skipGroupChildTranslation?: boolean;
}

function formatBatchUpdateDescription(updates: CanvasNodeUpdate[]): string {
  let moved = 0;
  let resized = 0;
  let collapsed = 0;

  for (const update of updates) {
    if (update.position) moved++;
    if (update.size) resized++;
    if (update.collapsed !== undefined) collapsed++;
  }

  const parts: string[] = [];
  if (moved > 0) parts.push(`${moved} moved`);
  if (resized > 0) parts.push(`${resized} resized`);
  if (collapsed > 0) parts.push(`${collapsed} collapsed`);

  const prefix = `Updated ${updates.length} node${updates.length === 1 ? '' : 's'}`;
  return parts.length > 0 ? `${prefix} (${parts.join(', ')})` : prefix;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function replaceById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const copy = list.slice();
  copy[idx] = item;
  return copy;
}

function isPersistedBlobRef(value: unknown): value is PersistedBlobRef {
  return (
    isRecord(value) &&
    value.__pmxCanvasBlob === 'v1' &&
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    value.encoding === 'json+gzip' &&
    typeof value.bytes === 'number' &&
    typeof value.jsonBytes === 'number'
  );
}

class CanvasStateManager {
  private nodes = new Map<string, CanvasNodeState>();
  private edges = new Map<string, CanvasEdge>();
  private annotations = new Map<string, CanvasAnnotation>();
  private _viewport: ViewportState = { x: 0, y: 0, scale: 1 };
  private _tour: Tour | undefined;
  private _theme: CanvasTheme = 'harbor';
  private _contextPinnedNodeIds = new Set<string>();
  /** Who pinned each pin, when and why; kept only for ids in `_contextPinnedNodeIds`. */
  private _contextPinMeta = new Map<string, ContextPinMeta>();
  private _workspaceRoot = process.cwd();
  private _contentRevision = 0;
  private _revisionFloor = 0;
  private _deletionTombstones: NodeDeletionTombstone[] = [];

  // ── AX state (canvas-bound + timeline + host partitions) ──────────
  // Extracted into a dedicated manager (plan-007 Slice A). CanvasStateManager
  // holds it and delegates its public AX methods so the SDK/HTTP/MCP surface is
  // byte-stable; the manager receives the host hooks it needs as injected deps.
  private readonly ax = new AxStateManager({
    getNodeIds: () => this.currentNodeIdSet(),
    getDb: () => this._db,
    scheduleSave: () => this.scheduleSave(),
    notifyChange: (type) => this.notifyChange(type),
    recordMutation: (info) => this.recordMutation(info),
    suppressed: (fn) => this.suppressed(fn),
  });

  // ── Change listeners (for MCP resource notifications) ──────
  private _changeListeners: ((type: CanvasChangeType) => void)[] = [];

  /**
   * Register a listener for state changes. Used by MCP server to emit resource
   * notifications and by the blocking-wait endpoints to await an AX transition.
   * Returns a disposer that unregisters the listener (callers that don't need it
   * — e.g. the long-lived MCP subscription — may ignore the return value).
   */
  onChange(cb: (type: CanvasChangeType) => void): () => void {
    this._changeListeners.push(cb);
    return () => {
      const i = this._changeListeners.indexOf(cb);
      if (i >= 0) this._changeListeners.splice(i, 1);
    };
  }

  // ── Work-item change listener (single slot, for live workboard refresh) ──
  private _workItemsChangedListener: (() => void) | null = null;

  /**
   * Register THE work-item change listener (single slot, last-write-wins).
   * Fired after addWorkItem/updateWorkItem completes (including the node
   * status mirror), so live views like the workboard can rebuild from the
   * fresh work-item list.
   */
  setWorkItemsChangedListener(listener: (() => void) | null): void {
    this._workItemsChangedListener = listener;
  }

  private notifyWorkItemsChanged(): void {
    if (!this._workItemsChangedListener) return;
    try {
      this._workItemsChangedListener();
    } catch (error) {
      logCanvasStateWarning('work-items-changed listener failed', error);
    }
  }

  private notifyChange(type: CanvasChangeType): void {
    // Iterate a snapshot: a listener (e.g. a blocking-wait via onChange) may dispose
    // itself synchronously here, and splicing the live array mid-iteration would skip
    // the next listener for this notification.
    for (const cb of [...this._changeListeners]) {
      try {
        cb(type);
      } catch (error) {
        logCanvasStateWarning('change-listener failed', error, { type });
      }
    }
  }

  // ── Mutation recorder (for undo/redo history) ─────────────
  //
  // Single slot BY DESIGN, last-write-wins (plan-009 L5): the only logical
  // consumer is the `mutationHistory` singleton, wired by `startCanvasServer()`
  // (server.ts) on every fresh start. A listener LIST here would record every
  // mutation twice into the history ring (breaking undo) if a second wire ever
  // appeared, so keep it a single slot and wire recorders in one place only.
  private _mutationRecorder: ((info: MutationRecordInfo) => void) | null = null;
  // The ONE recording-suppression counter (depth-counted so nested suppressed
  // scopes compose). Two related mechanisms are deliberately NOT merged into
  // it: `mutationHistory._replaying` guards direct `record()` calls during
  // undo/redo replay, and the operation registry's `suppressEmitDepth`
  // suppresses SSE emits during meta-ops (canvas.batch) — whose sub-ops must
  // still record history, just as undo/redo still emits SSE while recording is
  // suppressed here. The three counters are active at different times.
  private _suppressRecordingDepth = 0;

  /** Register THE mutation recorder (single slot, last-write-wins — see note above). */
  onMutation(cb: (info: MutationRecordInfo) => void): void {
    this._mutationRecorder = cb;
  }

  /** Run a function with mutation recording suppressed (for undo/redo replay and computed edges). */
  withSuppressedRecording(fn: () => void): void {
    this._suppressRecordingDepth++;
    try {
      fn();
    } finally {
      this._suppressRecordingDepth--;
    }
  }

  /** Create a closure that runs with recording suppressed. */
  private suppressed(fn: () => void): () => void {
    return () => this.withSuppressedRecording(fn);
  }

  private recordMutation(info: MutationRecordInfo): void {
    if (this._suppressRecordingDepth > 0 || !this._mutationRecorder) return;
    try {
      this._mutationRecorder(info);
    } catch (error) {
      logCanvasStateWarning('mutation-recorder failed', error, { description: info.description });
    }
  }

  private currentNodeIdSet(): Set<string> {
    return new Set(this.nodes.keys());
  }

  private applyResolvedGroupBounds(
    group: CanvasNodeState,
    groupId: string,
    childIds: string[],
    bounds: { x: number; y: number; width: number; height: number },
    existingGroups?: CanvasPlacementRect[],
  ): void {
    const otherGroups =
      existingGroups ?? Array.from(this.nodes.values()).filter((node) => node.id !== groupId && node.type === 'group');
    const resolved = resolveGroupCollision(bounds, otherGroups);
    const deltaX = resolved.x - bounds.x;
    const deltaY = resolved.y - bounds.y;

    if (deltaX !== 0 || deltaY !== 0) {
      for (const childId of childIds) {
        const child = this.nodes.get(childId);
        if (!child || child.type === 'group') continue;
        this.nodes.set(childId, {
          ...child,
          position: {
            x: child.position.x + deltaX,
            y: child.position.y + deltaY,
          },
        });
      }
    }

    this.nodes.set(groupId, {
      ...group,
      position: { x: resolved.x, y: resolved.y },
      size: { width: bounds.width, height: bounds.height },
    });
  }

  private getGroupSnapshot(groupId: string): {
    group: CanvasNodeState;
    childIds: string[];
    children: CanvasNodeState[];
  } | null {
    const group = this.nodes.get(groupId);
    if (!group || group.type !== 'group') return null;

    const childIds = (group.data.children as string[]) ?? [];
    const children = childIds
      .map((id) => this.nodes.get(id))
      .filter((node): node is CanvasNodeState => node !== undefined && node.type !== 'group');

    return { group, childIds, children };
  }

  private normalizeNode(node: CanvasNodeState): CanvasNodeState {
    const data = { ...node.data };
    delete data.createdBy;
    delete data.lastEditedBy;
    delete data.contentRevision;
    return {
      ...node,
      data: normalizeCanvasNodeData(node.type, data),
      createdBy: node.createdBy ?? unknownActor(),
      lastEditedBy: node.lastEditedBy ?? unknownActor(),
      contentRevision: Number.isSafeInteger(node.contentRevision) ? node.contentRevision : 0,
    };
  }

  private nextContentRevision(): number {
    this._contentRevision += 1;
    return this._contentRevision;
  }

  private revisionState() {
    return {
      revision: this._contentRevision,
      floor: this._revisionFloor,
      tombstones: structuredClone(this._deletionTombstones),
    };
  }

  /**
   * Stable delta cursor contract: revisions strictly increase per active board;
   * geometry-only writes do not advance them. `reset` means `since` predates
   * retained tombstones, so callers must replace their view with `nodes`.
   */
  readContentDelta(since = this._contentRevision): BoardContentDelta {
    const cursor = Math.max(0, Math.floor(since));
    const reset = cursor < this._revisionFloor;
    return {
      since: cursor,
      revision: this._contentRevision,
      retentionFloor: this._revisionFloor,
      reset,
      nodes: Array.from(this.nodes.values())
        .filter((node) => reset || (node.contentRevision ?? 0) > cursor)
        .map((node) => structuredClone(this.nodeForRead(node))),
      deleted: reset
        ? []
        : this._deletionTombstones.filter((item) => item.revision > cursor).map((item) => structuredClone(item)),
    };
  }

  getContentRevision(): BoardContentRevision {
    return { revision: this._contentRevision, retentionFloor: this._revisionFloor };
  }

  private nodeForRead(node: CanvasNodeState): CanvasNodeState {
    const resolved = this.resolveNodeDataBlobs(node);
    return {
      ...resolved,
      pinned: resolved.pinned || this._contextPinnedNodeIds.has(resolved.id),
    };
  }

  private reflowAllGroups(): void {
    const groups = Array.from(this.nodes.values())
      .filter((node): node is CanvasNodeState => node.type === 'group')
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

    for (const group of groups) {
      const snapshot = this.getGroupSnapshot(group.id);
      if (!snapshot) continue;
      if (snapshot.group.data.frameMode === 'manual') {
        continue;
      }
      const bounds = computeGroupBounds(snapshot.children);
      if (!bounds) continue;
      this.nodes.set(group.id, {
        ...snapshot.group,
        position: { x: bounds.x, y: bounds.y },
        size: { width: bounds.width, height: bounds.height },
      });
    }
  }

  private translateGroupChildren(
    groupId: string,
    deltaX: number,
    deltaY: number,
    skipIds: ReadonlySet<string> = new Set(),
  ): void {
    if (deltaX === 0 && deltaY === 0) return;
    const snapshot = this.getGroupSnapshot(groupId);
    if (!snapshot) return;

    for (const child of snapshot.children) {
      if (skipIds.has(child.id)) continue;
      this.nodes.set(child.id, {
        ...child,
        position: {
          x: child.position.x + deltaX,
          y: child.position.y + deltaY,
        },
      });
    }
  }

  private recomputeParentGroupBounds(groupId: string | undefined, visited = new Set<string>()): void {
    if (!groupId || visited.has(groupId)) return;
    visited.add(groupId);
    const snapshot = this.getGroupSnapshot(groupId);
    if (!snapshot) return;
    if (snapshot.group.data.frameMode === 'manual') return;

    const bounds = computeGroupBounds(snapshot.children);
    if (!bounds) return;

    this.nodes.set(groupId, {
      ...snapshot.group,
      position: { x: bounds.x, y: bounds.y },
      size: { width: bounds.width, height: bounds.height },
    });
    // Only the affected ancestor chain may re-fit. Never repair unrelated
    // automatic frames as a side effect of an otherwise scoped child update.
    const parentId = snapshot.group.data.parentGroup;
    if (typeof parentId === 'string') this.recomputeParentGroupBounds(parentId, visited);
  }

  private compactGroupChildren(groupId: string, layout: 'grid' | 'column' | 'flow' = 'grid'): void {
    const snapshot = this.getGroupSnapshot(groupId);
    if (!snapshot || snapshot.children.length === 0) return;
    if (snapshot.group.data.frameMode === 'manual') {
      const sorted = [...snapshot.children].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
      const left = snapshot.group.position.x + GROUP_PAD;
      const top = snapshot.group.position.y + GROUP_TITLEBAR_HEIGHT + GROUP_PAD;
      const right = snapshot.group.position.x + snapshot.group.size.width - GROUP_PAD;
      const gap = 24;
      let cursorX = left;
      let cursorY = top;
      let rowHeight = 0;

      for (const child of sorted) {
        if (layout === 'column') {
          this.nodes.set(child.id, { ...child, position: { x: left, y: cursorY } });
          cursorY += child.size.height + gap;
          continue;
        }

        if (layout === 'flow') {
          this.nodes.set(child.id, { ...child, position: { x: cursorX, y: top } });
          cursorX += child.size.width + gap;
          continue;
        }

        if (cursorX > left && cursorX + child.size.width > right) {
          cursorX = left;
          cursorY += rowHeight + gap;
          rowHeight = 0;
        }

        this.nodes.set(child.id, { ...child, position: { x: cursorX, y: cursorY } });
        cursorX += child.size.width + gap;
        rowHeight = Math.max(rowHeight, child.size.height);
      }
      return;
    }

    const { positions, bounds } = computePackedGroupLayout(
      snapshot.children.map((child) => ({
        id: child.id,
        position: child.position,
        size: child.size,
      })),
    );

    for (const child of snapshot.children) {
      const position = positions.get(child.id);
      if (!position) continue;
      this.nodes.set(child.id, { ...child, position });
    }

    const updatedGroup = this.nodes.get(groupId);
    if (bounds && updatedGroup?.type === 'group') {
      this.applyResolvedGroupBounds(updatedGroup, groupId, snapshot.childIds, bounds);
    }
  }

  // ── Persistence ────────────────────────────────────────────
  private _db: import('bun:sqlite').Database | null = null;
  private _dbPath: string | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Workspace root backing persistence and workspace-relative path resolution. */
  get workspaceRoot(): string {
    return this._workspaceRoot;
  }

  /** Set the workspace root to enable auto-persistence. */
  setWorkspaceRoot(workspaceRoot: string): void {
    this.close();
    this._workspaceRoot = workspaceRoot;

    // Determine DB path. PMX_CANVAS_DB_PATH wins; PMX_CANVAS_STATE_FILE is
    // honored only as a legacy alias when it points at a `.db` file.
    const dbOverride = (process.env.PMX_CANVAS_DB_PATH ?? '').trim();
    const stateFileOverride = (process.env.PMX_CANVAS_STATE_FILE ?? '').trim();
    let dbPath: string;
    if (dbOverride) {
      dbPath = dbOverride;
    } else if (stateFileOverride && stateFileOverride.endsWith('.db')) {
      dbPath = stateFileOverride;
    } else {
      dbPath = join(workspaceRoot, PMX_CANVAS_DIR, DB_FILENAME);
    }
    if (stateFileOverride && !stateFileOverride.endsWith('.db')) {
      logCanvasStateWarning(
        'PMX_CANVAS_STATE_FILE ignored',
        'legacy JSON state files are no longer supported as of 0.4.0 — use PMX_CANVAS_DB_PATH',
        { stateFileOverride },
      );
    }

    // Legacy pre-0.2 formats (`.pmx-canvas/state.json`, `.pmx-canvas.json`,
    // `.pmx-canvas-snapshots/`, loose blob files) are no longer imported as of
    // 0.4.0 — the one-shot boot migration that copied them into SQLite and
    // renamed the originals to `.bak` was retired.
    try {
      this._db = openCanvasDb(dbPath, { migratedBoardName: basename(workspaceRoot) || 'Board' });
      this._dbPath = dbPath;
    } catch (error) {
      logCanvasStateWarning('open canvas database failed', error, { dbPath });
    }
  }

  private get blobsDir(): string | null {
    if (!this._workspaceRoot) return null;
    return join(this._workspaceRoot, PMX_CANVAS_DIR, BLOBS_SUBDIR);
  }

  private relativeBlobPath(filePath: string): string {
    const base = join(this._workspaceRoot, PMX_CANVAS_DIR);
    const rel = relative(base, filePath);
    return rel || filePath;
  }

  private resolveBlobPath(ref: PersistedBlobRef): string | null {
    if (isAbsolute(ref.path)) return null;
    const base = join(this._workspaceRoot, PMX_CANVAS_DIR);
    const resolved = join(base, ref.path);
    const rel = relative(base, resolved);
    if (rel === '' || rel.startsWith('..') || rel === '..' || isAbsolute(rel)) return null;
    return resolved;
  }

  private writeBlobValue(value: unknown): PersistedBlobRef | null {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return null;
    const jsonBytes = Buffer.byteLength(json);
    if (jsonBytes < BLOB_JSON_THRESHOLD_BYTES) return null;
    const sha256 = createHash('sha256').update(json).digest('hex');

    // Write to SQLite if DB is available
    if (this._db) {
      try {
        const bytes = writeBlobToDB(this._db, sha256, json);
        return {
          __pmxCanvasBlob: 'v1',
          path: `blobs/${sha256}`,
          sha256,
          encoding: 'json+gzip',
          bytes,
          jsonBytes,
        };
      } catch (error) {
        logCanvasStateWarning('write blob to db failed', error, { sha256 });
        return null;
      }
    }

    // Fallback to filesystem (for when DB is not yet initialized)
    const dir = this.blobsDir;
    if (!dir) return null;
    const prefix = sha256.slice(0, 2);
    const filePath = join(dir, prefix, `${sha256}.json.gz`);
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(dirname(filePath))) mkdirSync(dirname(filePath), { recursive: true });
      const compressed = gzipSync(json);
      if (!existsSync(filePath)) writeFileSync(filePath, compressed);
      return {
        __pmxCanvasBlob: 'v1',
        path: this.relativeBlobPath(filePath),
        sha256,
        encoding: 'json+gzip',
        bytes: compressed.byteLength,
        jsonBytes,
      };
    } catch (error) {
      logCanvasStateWarning('write blob failed', error, { filePath });
      return null;
    }
  }

  private readBlobValue(ref: PersistedBlobRef): unknown {
    // Try SQLite first
    if (this._db) {
      try {
        const json = readBlobFromDB(this._db, ref.sha256);
        if (json) {
          const sha256 = createHash('sha256').update(json).digest('hex');
          if (sha256 !== ref.sha256) {
            logCanvasStateWarning('blob checksum mismatch (db)', 'checksum mismatch', { sha256: ref.sha256 });
            return ref;
          }
          return JSON.parse(json) as unknown;
        }
      } catch (error) {
        logCanvasStateWarning('read blob from db failed', error, { sha256: ref.sha256 });
      }
    }

    // Fallback to filesystem (legacy on-disk blobs are still readable in place)
    const filePath = this.resolveBlobPath(ref);
    if (!filePath) return ref;
    try {
      const compressed = readFileSync(filePath);
      const json = gunzipSync(compressed).toString('utf-8');
      const sha256 = createHash('sha256').update(json).digest('hex');
      if (sha256 !== ref.sha256) {
        logCanvasStateWarning('blob checksum mismatch', 'checksum mismatch', { filePath });
        return ref;
      }
      return JSON.parse(json) as unknown;
    } catch (error) {
      logCanvasStateWarning('read blob failed', error, { filePath });
      return ref;
    }
  }

  private externalizeNodeDataBlobs(node: CanvasNodeState): CanvasNodeState {
    if (node.type !== 'mcp-app' && node.type !== 'html') return node;
    let changed = false;
    const data = { ...node.data };
    for (const [key, value] of Object.entries(data)) {
      if (!BLOB_DATA_FIELDS.has(key) || isPersistedBlobRef(value)) continue;
      const ref = this.writeBlobValue(value);
      if (!ref) continue;
      data[key] = ref;
      changed = true;
    }
    return changed ? { ...node, data } : node;
  }

  private resolveNodeDataBlobs(node: CanvasNodeState): CanvasNodeState {
    if (node.type !== 'mcp-app' && node.type !== 'html') return node;
    let changed = false;
    const data = { ...node.data };
    for (const [key, value] of Object.entries(data)) {
      if (!BLOB_DATA_FIELDS.has(key) || !isPersistedBlobRef(value)) continue;
      data[key] = this.readBlobValue(value);
      changed = true;
    }
    return changed ? { ...node, data } : node;
  }

  isBlobReference(value: unknown): value is PersistedBlobRef {
    return isPersistedBlobRef(value);
  }

  resolveBlobReference(value: unknown): unknown {
    return isPersistedBlobRef(value) ? this.readBlobValue(value) : value;
  }

  private externalizePersistedStateBlobs<T extends PersistedCanvasState>(state: T): T {
    return {
      ...state,
      nodes: Array.isArray(state.nodes) ? state.nodes.map((node) => this.externalizeNodeDataBlobs(node)) : [],
    };
  }

  getWorkspaceRoot(): string {
    return this._workspaceRoot;
  }

  private emptyPersistedState(): PersistedCanvasState {
    return {
      version: 1,
      theme: this._theme,
      viewport: { x: 0, y: 0, scale: 1 },
      nodes: [],
      edges: [],
      annotations: [],
      contextPins: [],
      ax: createEmptyAxState(),
      revisionState: { revision: 0, floor: 0, tombstones: [] },
    };
  }

  /**
   * Load the board that was open last. Call once on server startup. With no
   * such board the workspace starts on Home (no board open).
   */
  loadFromDisk(options: LoadFromDiskOptions = {}): boolean {
    // Host capability lives in its own table (not snapshotted / not in PmxAxState).
    this.ax.loadHostCapabilityFromDb();
    if (this._db) {
      try {
        const boardId = getActiveBoardIdFromDB(this._db);
        const state = boardId ? loadStateFromDB(this._db, boardId) : null;
        if (boardId && state) {
          this.applyPersistedState(state);
          this._activeBoardId = boardId;
          return true;
        }
        this._theme = normalizeCanvasTheme(readThemeFromDB(this._db), this._theme);
      } catch (error) {
        logCanvasStateWarning('load state from sqlite failed', error, {});
      }
    }

    if (options.clearExisting) {
      this.applyPersistedState(this.emptyPersistedState());
    }
    return false;
  }

  // ── Library file (backup / restore) ─────────────────────────

  /** The SQLite file holding every board, or null without a workspace database. */
  get databasePath(): string | null {
    return this._db ? this._dbPath : null;
  }

  readWorkspaceMeta(key: string): string | null {
    return this._db ? readMetaFromDB(this._db, key) : null;
  }

  writeWorkspaceMeta(key: string, value: string | null): void {
    if (this._db) writeMetaToDB(this._db, key, value);
  }

  /** A consistent copy of the whole library, safe while the server runs. */
  backupDatabaseTo(path: string): void {
    if (!this._db) throw new Error('No workspace database to back up.');
    this.flushToDisk();
    this._db.run('VACUUM INTO ?', [path]);
  }

  /**
   * Replace the library with `file`: the current file is kept beside it as
   * `<db>.before-restore`, then the restored file opens (migrating an older
   * layout) on the board it had open last.
   */
  replaceDatabase(file: string): void {
    const dbPath = this.databasePath;
    if (!dbPath) throw new Error('No workspace database to restore into.');
    const root = this._workspaceRoot;
    const recoveryPath = `${dbPath}.before-restore`;
    const stagedPath = `${dbPath}.restore-${process.pid}-${Date.now()}`;
    this.flushToDisk();
    copyFileSync(file, stagedPath);
    let closed = false;
    let recoveryReady = false;
    try {
      this.close();
      closed = true;
      copyFileSync(dbPath, recoveryPath);
      recoveryReady = true;
      for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
      copyFileSync(stagedPath, dbPath);
      this.setWorkspaceRoot(root);
      if (!this._db) throw new Error('Could not open the restored database.');
      const expectedBoard = getActiveBoardIdFromDB(this._db);
      const loaded = this.loadFromDisk({ clearExisting: true });
      if (expectedBoard && !loaded) throw new Error('Could not load the restored board.');
    } catch (error) {
      if (closed) {
        this.close();
        if (recoveryReady) {
          for (const suffix of ['-wal', '-shm']) rmSync(`${dbPath}${suffix}`, { force: true });
          copyFileSync(recoveryPath, dbPath);
        }
        this.setWorkspaceRoot(root);
        this.loadFromDisk({ clearExisting: true });
      }
      throw error;
    } finally {
      rmSync(stagedPath, { force: true });
    }
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.notifyChange('ax');
  }

  // ── Boards ──────────────────────────────────────────────────

  private _activeBoardId: string | null = null;
  private _boardGeneration = 0;

  /** Invalidates asynchronous work whenever the loaded board state is replaced. */
  get boardGeneration(): number {
    return this._boardGeneration;
  }

  /** The open board, or null on Home. */
  get activeBoardId(): string | null {
    return this._activeBoardId;
  }

  getActiveBoard(): CanvasBoard | null {
    if (!this._db || !this._activeBoardId) return null;
    const board = getBoardFromDB(this._db, this._activeBoardId);
    return board ? { ...board, nodeCount: this.nodes.size } : null;
  }

  /**
   * One board's content without opening it: the open board from memory, any
   * other straight from SQLite. Null when there is no such board.
   */
  readBoard(
    id: string,
    includeBlobs = true,
  ): { board: CanvasBoard; state: PersistedCanvasState; layout: CanvasLayout } | null {
    if (!this._db) return null;
    const board = this.listBoards().find((entry) => entry.id === id);
    if (!board) return null;
    if (id === this._activeBoardId) {
      const layout = includeBlobs ? this.getLayout() : this.getLayoutForPersistence();
      if (!includeBlobs)
        layout.nodes = layout.nodes.map((node) => ({
          ...node,
          pinned: node.pinned || this._contextPinnedNodeIds.has(node.id),
        }));
      return {
        board,
        layout,
        state: {
          version: 1,
          theme: this._theme,
          tour: layout.tour,
          ax: this.getAxState(),
          viewport: layout.viewport,
          nodes: layout.nodes,
          edges: layout.edges,
          annotations: layout.annotations,
          contextPins: Array.from(this._contextPinnedNodeIds),
          contextPinMeta: this.pinMetaRecord(),
          revisionState: this.revisionState(),
        },
      };
    }
    const state = loadStateFromDB(this._db, id);
    if (!state) return null;
    const pins = new Set(state.contextPins);
    state.nodes = state.nodes.map((node) => ({
      ...(includeBlobs ? this.resolveNodeDataBlobs(node) : node),
      pinned: node.pinned || pins.has(node.id),
    }));
    return {
      board,
      state,
      layout: {
        tour: state.tour,
        theme: state.theme ?? this._theme,
        viewport: state.viewport,
        nodes: state.nodes,
        edges: state.edges,
        annotations: state.annotations ?? [],
      },
    };
  }

  /** Every board in the workspace, most recently opened first. */
  listBoards(): CanvasBoard[] {
    if (!this._db) return [];
    return listBoardsFromDB(this._db).map((board) =>
      board.id === this._activeBoardId ? { ...board, nodeCount: this.nodes.size } : board,
    );
  }

  storeAttachment(input: { boardId: string; name: string; mime: string; bytes: Uint8Array }): Attachment | null {
    if (!this._db) return null;
    if (input.boardId === this._activeBoardId) this.flushToDisk();
    if (!getBoardFromDB(this._db, input.boardId)) return null;
    return storeAttachment(this._db, input);
  }
  getAttachment(id: string): Attachment | null {
    return this._db ? getAttachment(this._db, id) : null;
  }
  readAttachmentBytes(id: string): Uint8Array | null {
    return this._db ? readAttachmentBytes(this._db, id) : null;
  }
  createDocumentImport(attachmentId: string, position: { x: number; y: number }): DocumentImport | null {
    return this._db ? createImport(this._db, attachmentId, position) : null;
  }
  getDocumentImport(id: string): DocumentImport | null {
    return this._db ? getImport(this._db, id) : null;
  }
  listDocumentImports(boardId?: string): DocumentImport[] {
    return this._db ? listImports(this._db, boardId) : [];
  }
  updateDocumentImport(
    id: string,
    status: DocumentImportStatus,
    fields?: {
      sections?: ImportSection[];
      warnings?: string[];
      agentDescription?: string;
      reason?: string;
      committedNodeIds?: string[];
    },
  ): DocumentImport | null {
    return this._db ? updateImport(this._db, id, status, fields) : null;
  }
  commitDocumentImport(id: string, nodeIds: string[]): DocumentImport | null {
    if (!this._db) return null;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    return this._db.transaction(() => {
      if (!this.saveToDisk()) throw new Error(this._lastPersistenceError?.message ?? 'Failed to save canvas state.');
      return updateImport(this._db!, id, 'committed', { committedNodeIds: nodeIds });
    })();
  }

  getContextBriefCursor(boardId: string, consumer: string): number | null {
    return this._db ? readContextBriefCursor(this._db, boardId, consumer) : null;
  }

  advanceContextBriefCursor(boardId: string, consumer: string, revision: number): void {
    // A durable cursor must never get ahead of the board content it describes.
    if (boardId === this._activeBoardId) this.flushToDisk();
    if (this._db) advanceContextBriefCursor(this._db, boardId, consumer, revision);
  }

  /** Creates a board without opening it. */
  createBoard(name: string, category: string | null = null): CanvasBoard | null {
    if (!this._db) return null;
    return createBoardInDB(this._db, name, category);
  }

  updateBoard(id: string, patch: { name?: string; category?: string | null }): boolean {
    return this._db ? updateBoardInDB(this._db, id, patch) : false;
  }

  setBoardReadme(id: string, nodeId: string | null): boolean {
    if (!this._db) return false;
    const read = this.readBoard(id, false);
    if (!read) return false;
    if (nodeId && !read.layout.nodes.some((node) => node.id === nodeId && node.type === 'markdown')) return false;
    return updateBoardInDB(this._db, id, { readmeNodeId: nodeId });
  }

  /** Bounded inactive-board creation; never replaces the state the human has open. */
  createBoardFromBoard(input: {
    sourceBoardId: string;
    name: string;
    category?: string | null;
    nodeIds?: string[];
    includeReadme?: boolean;
    includeStructure?: boolean;
  }): CanvasBoard | null {
    if (!this._db) return null;
    const source = this.readBoard(input.sourceBoardId, true);
    if (!source) return null;
    const selected = new Set(input.nodeIds ?? []);
    if (input.includeReadme && source.board.readmeNodeId) selected.add(source.board.readmeNodeId);
    if (input.includeStructure) {
      for (const node of source.layout.nodes) {
        if (node.type === 'group') selected.add(node.id);
      }
    }
    const copied = source.layout.nodes.filter(
      (node) => selected.has(node.id) && !['prompt', 'response', 'trace', 'mcp-app'].includes(node.type),
    );
    const ids = new Map(copied.map((node) => [node.id, randomUUID()]));
    const referenceKeys = new Set([
      'nodeId',
      'nodeIds',
      'sourceNodeId',
      'targetNodeId',
      'embeddedNodeId',
      'embeddedNodeIds',
      'embeddedGraphId',
    ]);
    const remap = (value: unknown, key = ''): unknown => {
      if (typeof value === 'string') return referenceKeys.has(key) ? (ids.get(value) ?? null) : value;
      if (Array.isArray(value)) return value.map((item) => remap(item, key)).filter((item) => item !== null);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, remap(item, key)]),
        );
      }
      return value;
    };
    const actor = currentActor();
    const nodes: CanvasNodeState[] = copied.map((node, index) => {
      const data = remap(node.data) as Record<string, unknown>;
      if (node.type === 'graph' || node.type === 'json-render') {
        data.url = `/api/canvas/json-render/view?nodeId=${encodeURIComponent(ids.get(node.id)!)}`;
      }
      delete data.axStep;
      delete data.axWorkStatus;
      delete data.workItemId;
      delete data.approvalGateId;
      delete data.parentGroup;
      if (typeof node.data.parentGroup === 'string' && ids.has(node.data.parentGroup)) {
        data.parentGroup = ids.get(node.data.parentGroup);
      }
      if (node.type === 'group')
        data.children = Array.isArray(node.data.children)
          ? node.data.children.flatMap((id) => (typeof id === 'string' && ids.has(id) ? [ids.get(id)!] : []))
          : [];
      return {
        ...node,
        id: ids.get(node.id)!,
        pinned: false,
        data,
        createdBy: actor,
        lastEditedBy: actor,
        contentRevision: index + 1,
      };
    });
    nodes.push({
      id: randomUUID(),
      type: 'board' as const,
      position: { x: 40, y: Math.max(40, ...nodes.map((node) => node.position.y + node.size.height + 40)) },
      size: { width: 360, height: 160 },
      zIndex: 1,
      collapsed: false,
      pinned: false,
      data: { title: source.board.name, boardId: source.board.id },
      createdBy: actor,
      lastEditedBy: actor,
      contentRevision: nodes.length + 1,
    });
    const edges = source.layout.edges
      .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
      .map((edge) => ({ ...edge, id: randomUUID(), from: ids.get(edge.from)!, to: ids.get(edge.to)! }));
    const state: PersistedCanvasState = {
      version: 1,
      theme: source.state.theme,
      viewport: { x: 0, y: 0, scale: 1 },
      nodes,
      edges,
      annotations: [],
      contextPins: [],
      ax: createEmptyAxState(),
      revisionState: { revision: nodes.length, floor: 0, tombstones: [] },
    };
    const board = createBoardWithStateInDB(
      this._db,
      input.name,
      input.category ?? null,
      this.externalizePersistedStateBlobs(state),
      input.includeReadme && source.board.readmeNodeId ? (ids.get(source.board.readmeNodeId) ?? null) : null,
    );
    const referencedAttachmentIds = new Set<string>();
    for (const node of nodes) {
      if (typeof node.data.attachmentId === 'string') referencedAttachmentIds.add(node.data.attachmentId);
      const provenance = node.data.source;
      if (provenance && typeof provenance === 'object') {
        const sourceAttachmentId = (provenance as Record<string, unknown>).attachmentId;
        if (typeof sourceAttachmentId === 'string') referencedAttachmentIds.add(sourceAttachmentId);
      }
      delete node.data.importId;
    }
    const attachmentIds = copyBoardAttachments(this._db, source.board.id, board.id, referencedAttachmentIds);
    if (attachmentIds.size > 0) {
      const createdImportAttachments = new Set<string>();
      for (const row of this._db
        .query<{ id: string; data: string }, [string]>('SELECT id,data FROM nodes WHERE board_id=?')
        .all(board.id)) {
        const data = JSON.parse(row.data) as Record<string, unknown>;
        const old = typeof data.attachmentId === 'string' ? data.attachmentId : null;
        const sourceData =
          data.source && typeof data.source === 'object' ? (data.source as Record<string, unknown>) : null;
        const sourceOld = typeof sourceData?.attachmentId === 'string' ? sourceData.attachmentId : null;
        if (old && attachmentIds.has(old)) data.attachmentId = attachmentIds.get(old);
        if (sourceOld && attachmentIds.has(sourceOld))
          data.source = { ...sourceData, attachmentId: attachmentIds.get(sourceOld) };
        delete data.importId;
        this._db.run('UPDATE nodes SET data=? WHERE board_id=? AND id=?', [JSON.stringify(data), board.id, row.id]);
        if (old && attachmentIds.has(old) && !createdImportAttachments.has(old)) {
          createImport(this._db, attachmentIds.get(old)!, { x: 40, y: 260 });
          createdImportAttachments.add(old);
        }
      }
    }
    return board;
  }

  /** Deletes a board and its snapshots; deleting the open board returns to Home first. */
  deleteBoard(id: string): boolean {
    if (!this._db) return false;
    if (id === this._activeBoardId && !this.switchBoard(null)) return false;
    return deleteBoardFromDB(this._db, id);
  }

  /**
   * Save the open board, then open `id` (or Home for null). The canvas state is
   * replaced wholesale; callers own the runtime side (undo history, app
   * sessions, watchers, SSE) — see `openCanvasBoard` in canvas-operations.
   */
  switchBoard(id: string | null): boolean {
    if (!this._db) return false;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this.saveToDisk()) {
      throw new Error(this._lastPersistenceError?.message ?? 'Failed to save canvas state before switching boards.');
    }
    let next = this.emptyPersistedState();
    if (id) {
      const state = loadStateFromDB(this._db, id);
      if (!state) return false;
      next = state;
    }
    this.applyPersistedState(next);
    this._activeBoardId = id;
    setActiveBoardIdInDB(this._db, id);
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.notifyChange('ax');
    return true;
  }

  /**
   * Content written while no board is open (Home) lands on a new board, which
   * opens: nothing the human was looking at is displaced.
   */
  private ensureActiveBoard(): string | null {
    if (!this._db) return null;
    if (this._activeBoardId) return this._activeBoardId;
    const board = createBoardInDB(this._db, defaultBoardName());
    this._activeBoardId = board.id;
    setActiveBoardIdInDB(this._db, board.id);
    return board.id;
  }

  private hasBoardContent(): boolean {
    const ax = this.getAxState();
    return (
      this._tour !== undefined ||
      this.nodes.size > 0 ||
      this.edges.size > 0 ||
      this.annotations.size > 0 ||
      ax.workItems.length > 0 ||
      ax.approvalGates.length > 0 ||
      ax.reviewAnnotations.length > 0
    );
  }

  /** Debounced save — coalesces rapid mutations into a single write. */
  private scheduleSave(): void {
    if (!this._db) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveToDisk();
    }, SAVE_DEBOUNCE_MS);
  }

  flushToDisk(): void {
    if (!this._db) return;
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this.saveToDisk()) {
      throw new Error(this._lastPersistenceError?.message ?? 'Failed to save canvas state.');
    }
    if (this._db) {
      try {
        checkpointCanvasDb(this._db);
      } catch (error) {
        logCanvasStateWarning('checkpoint database failed', error, {});
        throw error;
      }
    }
  }

  /** Write current state to SQLite immediately. */
  private saveToDisk(): boolean {
    if (!this._db) return false;
    try {
      if (!this._activeBoardId && !this.hasBoardContent()) {
        saveThemeToDB(this._db, this._theme);
        this._lastPersistenceError = null;
        return true;
      }
      const boardId = this.ensureActiveBoard();
      if (!boardId) return false;
      const payload = this.externalizePersistedStateBlobs({
        version: 1,
        theme: this._theme,
        tour: this._tour,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        annotations: Array.from(this.annotations.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
        contextPinMeta: this.pinMetaRecord(),
        ax: this.getAxState(),
        revisionState: this.revisionState(),
      });
      saveStateToDB(this._db, boardId, payload);
      this._lastPersistenceError = null;
      return true;
    } catch (error) {
      // Persistence failures are otherwise warn-and-continue (the canvas keeps
      // working from memory) — record the failure so /health can report a
      // degraded persistence state instead of silently losing durability (M4).
      this._lastPersistenceError = {
        message: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
      };
      logCanvasStateWarning('save state to sqlite failed', error, {});
      return false;
    }
  }

  private _lastPersistenceError: { message: string; at: string } | null = null;

  /** Health view of state persistence: ok until a save fails, ok again after the next success. */
  get persistenceHealth(): { ok: boolean; lastError: { message: string; at: string } | null } {
    return { ok: this._lastPersistenceError === null, lastError: this._lastPersistenceError };
  }

  /** Close the SQLite database cleanly. Call on server shutdown. */
  close(): void {
    // A failed debounce has no timer left, but its edits still need saving.
    // Leave the database and memory intact if the retry fails.
    if (this._saveTimer || this._lastPersistenceError) this.flushToDisk();
    if (this._db) {
      try {
        finalizeCanvasDbForClose(this._db);
      } catch (error) {
        logCanvasStateWarning('finalize database failed', error, {});
      }
      try {
        this._db.close();
      } catch (error) {
        logCanvasStateWarning('close database failed', error, {});
      }
      this._db = null;
    }
    this._activeBoardId = null;
    this._boardGeneration += 1;
  }

  // ── Snapshots ───────────────────────────────────────────────

  private get snapshotsDir(): string | null {
    if (!this._workspaceRoot) return null;
    return join(this._workspaceRoot, PMX_CANVAS_DIR, SNAPSHOTS_SUBDIR);
  }

  private applyPersistedState(state: PersistedCanvasState): void {
    this._boardGeneration += 1;
    this._tour = state.tour ? structuredClone(state.tour) : undefined;
    this.nodes.clear();
    this.edges.clear();
    this.annotations.clear();
    this._contextPinnedNodeIds.clear();
    this._contextPinMeta.clear();
    this.ax.resetCanvasBound();
    this._contentRevision = state.revisionState?.revision ?? 0;
    this._revisionFloor = state.revisionState?.floor ?? 0;
    this._deletionTombstones = structuredClone(state.revisionState?.tombstones ?? []);

    this._viewport = {
      x: state.viewport?.x ?? 0,
      y: state.viewport?.y ?? 0,
      scale: state.viewport?.scale ?? 1,
    };
    this._theme = normalizeCanvasTheme(state.theme, this._theme);

    if (Array.isArray(state.nodes)) {
      for (const node of state.nodes) {
        if (node?.id) {
          this.nodes.set(node.id, structuredClone(this.normalizeNode(node)));
        }
      }
    }
    if (Array.isArray(state.edges)) {
      for (const edge of state.edges) {
        if (edge?.id) this.edges.set(edge.id, structuredClone(edge));
      }
    }
    if (Array.isArray(state.annotations)) {
      for (const annotation of state.annotations) {
        if (annotation?.id) this.annotations.set(annotation.id, structuredClone(annotation));
      }
    }
    if (Array.isArray(state.contextPins)) {
      for (const pinId of state.contextPins) {
        if (!this.nodes.has(pinId)) continue;
        this._contextPinnedNodeIds.add(pinId);
        const meta = state.contextPinMeta?.[pinId];
        if (meta) this._contextPinMeta.set(pinId, structuredClone(meta));
      }
    }
    this.ax.applyPersistedAx(state.ax);
  }

  private readResolvedSnapshot(idOrName: string): {
    snapshot: CanvasSnapshot;
    state: PersistedCanvasState;
  } | null {
    if (!this._activeBoardId) return null;

    // Try SQLite first
    if (this._db) {
      const result = loadSnapshotFromDB(this._db, idOrName, this._activeBoardId);
      if (result) return result;
      const ownedByAnotherBoard = this._db
        .query<{ found: number }, [string, string]>('SELECT 1 AS found FROM snapshots WHERE id = ? OR name = ? LIMIT 1')
        .get(idOrName, idOrName);
      if (ownedByAnotherBoard) return null;
    }

    // Fallback to filesystem (legacy on-disk snapshots are still readable in place)
    const dir = this.snapshotsDir;
    if (!dir || !existsSync(dir)) return null;

    const directPath = join(dir, `${idOrName}.json`);
    if (existsSync(directPath)) {
      try {
        const raw = readFileSync(directPath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedCanvasState & { snapshot?: CanvasSnapshot };
        if (parsed.snapshot) {
          return { snapshot: parsed.snapshot, state: parsed };
        }
      } catch (error) {
        logCanvasStateWarning('read snapshot by id failed', error, { idOrName, directPath });
      }
    }

    try {
      const matches: Array<{ snapshot: CanvasSnapshot; path: string }> = [];
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const snapshotPath = join(dir, file);
          const raw = readFileSync(snapshotPath, 'utf-8');
          const parsed = JSON.parse(raw) as PersistedCanvasState & { snapshot?: CanvasSnapshot };
          if (!parsed.snapshot) continue;
          if (parsed.snapshot.name === idOrName || parsed.snapshot.id === idOrName) {
            matches.push({ snapshot: parsed.snapshot, path: snapshotPath });
          }
        } catch (error) {
          logCanvasStateWarning('skip unreadable snapshot while searching by name', error, {
            idOrName,
            file,
          });
        }
      }
      matches.sort((a, b) => b.snapshot.createdAt.localeCompare(a.snapshot.createdAt));
      const match = matches[0];
      if (!match) return null;
      try {
        const raw = readFileSync(match.path, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedCanvasState & { snapshot?: CanvasSnapshot };
        if (parsed.snapshot) return { snapshot: parsed.snapshot, state: parsed };
      } catch (error) {
        logCanvasStateWarning('read matched snapshot by name failed', error, { idOrName, path: match.path });
      }
      return null;
    } catch (error) {
      logCanvasStateWarning('search snapshots by name failed', error, { idOrName, dir });
      return null;
    }
  }

  getSnapshotDataForPersistence(idOrName: string): { snapshot: CanvasSnapshot; state: PersistedCanvasState } | null {
    const resolved = this.readResolvedSnapshot(idOrName);
    if (!resolved) return null;
    return {
      snapshot: resolved.snapshot,
      state: structuredClone(resolved.state),
    };
  }

  /** Save current canvas state as a named snapshot. */
  saveSnapshot(name: string): CanvasSnapshot | null {
    if (!this._db) return null;

    const id = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const snapshot: CanvasSnapshot = {
      id,
      name,
      createdAt: new Date().toISOString(),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
    };

    try {
      const payload = this.externalizePersistedStateBlobs({
        version: 1,
        theme: this._theme,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        annotations: Array.from(this.annotations.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
        contextPinMeta: this.pinMetaRecord(),
        ax: this.getAxState(),
        revisionState: this.revisionState(),
      });
      const boardId = this.ensureActiveBoard();
      if (!boardId) return null;
      saveSnapshotToDB(this._db, boardId, snapshot, { ...payload, tour: this._tour });
      snapshot.nodeCount = payload.nodes.length;
      snapshot.edgeCount = payload.edges.length;
      return snapshot;
    } catch (error) {
      logCanvasStateWarning('save snapshot failed', error, { id, name });
      return null;
    }
  }

  /** List saved snapshots, newest first. */
  listSnapshots(options: CanvasSnapshotListOptions = {}): CanvasSnapshot[] {
    if (this._db) {
      try {
        return this._activeBoardId ? listSnapshotsFromDB(this._db, this._activeBoardId, options) : [];
      } catch (error) {
        logCanvasStateWarning('list snapshots from db failed', error, {});
      }
    }

    // Fallback to filesystem
    const dir = this.snapshotsDir;
    if (!dir || !existsSync(dir)) return [];

    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .sort();
      const snapshots: CanvasSnapshot[] = [];
      for (const file of files) {
        try {
          const raw = readFileSync(join(dir, file), 'utf-8');
          const parsed = JSON.parse(raw) as { snapshot?: CanvasSnapshot };
          if (parsed.snapshot) snapshots.push(parsed.snapshot);
        } catch (error) {
          logCanvasStateWarning('skip corrupt snapshot file', error, { file });
        }
      }
      const query = options.query?.trim().toLowerCase();
      const before = normalizeSnapshotTimestamp(options.before);
      const after = normalizeSnapshotTimestamp(options.after);
      const filtered = snapshots.filter((snapshot) => {
        if (query && !snapshot.id.toLowerCase().includes(query) && !snapshot.name.toLowerCase().includes(query)) {
          return false;
        }
        if (before && snapshot.createdAt > before) return false;
        if (after && snapshot.createdAt < after) return false;
        return true;
      });
      const sorted = filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const limit = options.all ? undefined : (normalizePositiveInteger(options.limit) ?? 20);
      return limit === undefined ? sorted : sorted.slice(0, limit);
    } catch (error) {
      logCanvasStateWarning('list snapshots failed', error, { dir });
      return [];
    }
  }

  gcSnapshots(options: CanvasSnapshotGcOptions = {}): CanvasSnapshotGcResult {
    const keep = normalizePositiveInteger(options.keep) ?? 20;
    const dryRun = options.dryRun ?? false;
    const snapshots = this.listSnapshots({ all: true });
    const deleted = snapshots.slice(keep);

    if (!dryRun) {
      for (const snapshot of deleted) {
        this.deleteSnapshot(snapshot.id);
      }
    }

    return {
      ok: true,
      kept: Math.min(keep, snapshots.length),
      deleted,
      dryRun,
    };
  }

  /** Restore canvas state from a snapshot. */
  restoreSnapshot(idOrName: string): boolean {
    const resolved = this.readResolvedSnapshot(idOrName);
    if (!resolved || resolved.state.version !== 1) return false;

    const previousState: PersistedCanvasState = this.externalizePersistedStateBlobs({
      version: 1,
      tour: this._tour,
      theme: this._theme,
      viewport: structuredClone(this._viewport),
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(node)),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: Array.from(this.annotations.values(), (annotation) => structuredClone(annotation)),
      contextPins: Array.from(this._contextPinnedNodeIds),
      contextPinMeta: this.pinMetaRecord(),
      ax: this.getAxState(),
      revisionState: this.revisionState(),
    });
    const nextState: PersistedCanvasState = {
      version: 1,
      tour: resolved.state.tour,
      theme: normalizeCanvasTheme(resolved.state.theme, this._theme),
      viewport: structuredClone(resolved.state.viewport),
      nodes: Array.isArray(resolved.state.nodes) ? resolved.state.nodes.map((node) => structuredClone(node)) : [],
      edges: Array.isArray(resolved.state.edges) ? resolved.state.edges.map((edge) => structuredClone(edge)) : [],
      annotations: Array.isArray(resolved.state.annotations)
        ? resolved.state.annotations.map((annotation) => structuredClone(annotation))
        : [],
      contextPins: Array.isArray(resolved.state.contextPins) ? [...resolved.state.contextPins] : [],
      contextPinMeta: resolved.state.contextPinMeta ? structuredClone(resolved.state.contextPinMeta) : undefined,
      ax: resolved.state.ax ? structuredClone(resolved.state.ax) : createEmptyAxState(),
      revisionState: resolved.state.revisionState ? structuredClone(resolved.state.revisionState) : undefined,
    };

    try {
      const revisionBeforeRestore = this._contentRevision;
      this.applyPersistedState({ ...nextState, revisionState: this.revisionState() });
      this.restampRestoredContent(previousState.nodes, revisionBeforeRestore);
      this.scheduleSave();
      this.notifyChange('nodes');
      this.notifyChange('pins');
      this.notifyChange('ax');
      this.recordMutation({
        operationType: 'restoreSnapshot',
        description: `Restored snapshot "${resolved.snapshot.name}"`,
        forward: this.suppressed(() => {
          const before = Array.from(this.nodes.values(), (node) => structuredClone(node));
          const revisionBeforeReplay = this._contentRevision;
          this.applyPersistedState({ ...nextState, revisionState: this.revisionState() });
          this.restampRestoredContent(before, revisionBeforeReplay);
          this.scheduleSave();
          this.notifyChange('nodes');
          this.notifyChange('pins');
          this.notifyChange('ax');
        }),
        inverse: this.suppressed(() => {
          const before = Array.from(this.nodes.values(), (node) => structuredClone(node));
          const revisionBeforeReplay = this._contentRevision;
          this.applyPersistedState({ ...previousState, revisionState: this.revisionState() });
          this.restampRestoredContent(before, revisionBeforeReplay);
          this.scheduleSave();
          this.notifyChange('nodes');
          this.notifyChange('pins');
          this.notifyChange('ax');
        }),
      });
      return true;
    } catch (error) {
      logCanvasStateWarning('restore snapshot failed', error, {
        idOrName,
        snapshotId: resolved.snapshot.id,
        snapshotName: resolved.snapshot.name,
      });
      return false;
    }
  }

  /** Read a snapshot's data without restoring it (for diff). Resolves by ID or name. */
  getSnapshotData(idOrName: string): {
    name: string;
    nodes: CanvasNodeState[];
    edges: CanvasEdge[];
    annotations: CanvasAnnotation[];
    tour?: Tour;
  } | null {
    const resolved = this.readResolvedSnapshot(idOrName);
    if (!resolved) return null;
    const state = {
      ...resolved.state,
      nodes: Array.isArray(resolved.state.nodes)
        ? resolved.state.nodes.map((node) => this.resolveNodeDataBlobs(node))
        : [],
    };
    return {
      name: resolved.snapshot.name,
      ...(state.tour ? { tour: structuredClone(state.tour) } : {}),
      nodes: Array.isArray(state.nodes) ? state.nodes.map((node) => structuredClone(node)) : [],
      edges: Array.isArray(state.edges) ? state.edges.map((edge) => structuredClone(edge)) : [],
      annotations: Array.isArray(state.annotations)
        ? state.annotations.map((annotation) => structuredClone(annotation))
        : [],
    };
  }

  /** Delete a snapshot. */
  renameSnapshot(id: string, name: string): boolean {
    if (!this._db || !this._activeBoardId) return false;
    try {
      return renameSnapshotInDB(this._db, this._activeBoardId, id, name);
    } catch (error) {
      logCanvasStateWarning('rename snapshot failed', error, { id, name });
      return false;
    }
  }

  deleteSnapshot(id: string): boolean {
    if (!this._activeBoardId) return false;
    // Try SQLite first
    if (this._db) {
      try {
        const snapshot = this._db
          .query<{ board_id: string }, [string]>('SELECT board_id FROM snapshots WHERE id = ?')
          .get(id);
        if (snapshot) {
          if (snapshot.board_id !== this._activeBoardId) return false;
          return deleteSnapshotFromDB(this._db, id);
        }
      } catch (error) {
        logCanvasStateWarning('delete snapshot from db failed', error, { id });
        return false;
      }
    }

    // Fallback to filesystem
    const dir = this.snapshotsDir;
    if (!dir) return false;
    const filePath = join(dir, `${id}.json`);
    if (!existsSync(filePath)) return false;
    try {
      unlinkSync(filePath);
      return true;
    } catch (error) {
      logCanvasStateWarning('delete snapshot failed', error, { id, filePath });
      return false;
    }
  }

  /** Remove all snapshots from the DB. Used by test teardown. */
  clearAllSnapshots(): void {
    if (this._db) {
      this._db.run('DELETE FROM snapshots');
      this._db.run('DELETE FROM snapshot_nodes');
      this._db.run('DELETE FROM snapshot_edges');
      this._db.run('DELETE FROM snapshot_annotations');
      this._db.run('DELETE FROM snapshot_pins');
      this._db.run('DELETE FROM snapshot_meta');
    }
    // Also clear filesystem snapshots dir
    const dir = this.snapshotsDir;
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── Node CRUD ──────────────────────────────────────────────

  private restampRestoredContent(beforeNodes: CanvasNodeState[], minimumRevision: number): void {
    this._contentRevision = Math.max(this._contentRevision, minimumRevision);
    const before = new Map(beforeNodes.map((node) => [node.id, node]));
    const restoredIds = new Set(this.nodes.keys());
    for (const [id, node] of this.nodes) {
      const old = before.get(id);
      if (old && !this.nodeContentChanged(old, node)) {
        this.nodes.set(id, { ...node, contentRevision: old.contentRevision, lastEditedBy: old.lastEditedBy });
        continue;
      }
      const revision = this.nextContentRevision();
      this.nodes.set(id, { ...node, lastEditedBy: currentActor(), contentRevision: revision });
    }
    for (const old of beforeNodes) {
      if (!restoredIds.has(old.id)) this.recordDeletion(old.id);
    }
  }

  private semanticData(data: Record<string, unknown>): Record<string, unknown> {
    const copy = { ...data };
    delete copy.strictSize;
    delete copy.arrangeLocked;
    return copy;
  }

  private nodeContentChanged(a: CanvasNodeState, b: CanvasNodeState): boolean {
    return a.type !== b.type || JSON.stringify(this.semanticData(a.data)) !== JSON.stringify(this.semanticData(b.data));
  }

  private setSemanticNode(node: CanvasNodeState): void {
    const existing = this.nodes.get(node.id);
    if (!existing || !this.nodeContentChanged(existing, node)) {
      this.nodes.set(node.id, node);
      return;
    }
    const data = { ...node.data };
    if (data.agentSummary === existing.data.agentSummary) delete data.agentSummary;
    if (data.summary === existing.data.summary) delete data.summary;
    this.nodes.set(node.id, {
      ...node,
      data,
      createdBy: existing.createdBy,
      lastEditedBy: currentActor(),
      contentRevision: this.nextContentRevision(),
    });
  }

  private recordDeletion(nodeId: string): void {
    const tombstone = { nodeId, revision: this.nextContentRevision(), deletedBy: currentActor() };
    this._deletionTombstones.push(tombstone);
    const limit = 500;
    if (this._deletionTombstones.length > limit) {
      const removed = this._deletionTombstones.splice(0, this._deletionTombstones.length - limit);
      this._revisionFloor = Math.max(this._revisionFloor, removed.at(-1)?.revision ?? 0);
    }
  }

  get viewport(): ViewportState {
    return structuredClone(this._viewport);
  }

  addNode(node: CanvasNodeState): void {
    const actor = currentActor();
    const cloned = structuredClone(
      this.normalizeNode({
        ...node,
        createdBy: actor,
        lastEditedBy: actor,
        contentRevision: this.nextContentRevision(),
      }),
    );
    this.nodes.set(node.id, cloned);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'addNode',
      description: `Added ${node.type} node "${(node.data.title as string) ?? node.id}"`,
      forward: this.suppressed(() => this.addNode(structuredClone(cloned))),
      inverse: this.suppressed(() => this.removeNode(node.id)),
    });
  }

  addJsonRenderNode(node: CanvasNodeState): void {
    this.addNode(node);
  }

  addGraphNode(node: CanvasNodeState): void {
    this.addNode(node);
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    const existing = this.nodes.get(id);
    if (!existing) return;
    if (patch.data) {
      const attachmentId = existing.data.attachmentId;
      if (typeof attachmentId === 'string' && patch.data.attachmentId !== attachmentId) {
        throw new Error('Attachment identity is immutable.');
      }
      const source = existing.data.source;
      const importedSource =
        source && typeof source === 'object' && typeof (source as Record<string, unknown>).attachmentId === 'string';
      if (importedSource && JSON.stringify(patch.data.source) !== JSON.stringify(source)) {
        throw new Error('Import provenance is immutable.');
      }
    }
    const oldSnapshot = structuredClone(existing);
    if (existing.type === 'group' && patch.position) {
      this.translateGroupChildren(id, patch.position.x - existing.position.x, patch.position.y - existing.position.y);
    }
    let nextNode = this.normalizeNode({ ...existing, ...patch });
    if (this.nodeContentChanged(existing, nextNode)) {
      const data = { ...nextNode.data };
      const suppliedData = patch.data;
      if (!suppliedData || suppliedData.agentSummary === existing.data.agentSummary) delete data.agentSummary;
      if (!suppliedData || suppliedData.summary === existing.data.summary) delete data.summary;
      nextNode = {
        ...nextNode,
        data,
        createdBy: existing.createdBy ?? unknownActor(),
        lastEditedBy: currentActor(),
        contentRevision: this.nextContentRevision(),
      };
    } else {
      nextNode = {
        ...nextNode,
        createdBy: existing.createdBy,
        lastEditedBy: existing.lastEditedBy,
        contentRevision: existing.contentRevision,
      };
    }
    this.nodes.set(id, nextNode);
    const parentGroupId = existing.data.parentGroup as string | undefined;
    if (parentGroupId) {
      // Moving or resizing a grouped child re-fits the group frame but must NOT
      // repack siblings — that would discard their explicit positions and the
      // moved child's requested coordinates. Compaction is opt-in (group
      // create/add with childLayout, or arrange).
      this.recomputeParentGroupBounds(parentGroupId);
    }
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'updateNode',
      description: `Updated node "${(existing.data.title as string) ?? id}"`,
      forward: this.suppressed(() => this.updateNode(id, structuredClone(patch))),
      inverse: this.suppressed(() => {
        const restored = structuredClone(oldSnapshot);
        const current = this.nodes.get(id);
        if (current && this.nodeContentChanged(current, restored)) {
          restored.contentRevision = this.nextContentRevision();
          restored.lastEditedBy = currentActor();
        } else if (current) {
          restored.contentRevision = current.contentRevision;
          restored.lastEditedBy = current.lastEditedBy;
        }
        this.nodes.set(id, restored);
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
    });
  }

  removeNode(id: string): void {
    const existing = this.nodes.get(id);
    const connectedEdges = existing ? this.getEdgesForNode(id).map((e) => structuredClone(e)) : [];
    const cloned = existing ? structuredClone(existing) : null;
    const oldAxState = this.getAxState();
    const wasPinned = this._contextPinnedNodeIds.has(id);
    const pinMeta = this._contextPinMeta.get(id);
    // The enclosing group's membership before this removal — restored verbatim on undo.
    let enclosingBefore: { id: string; children: string[] } | null = null;
    // A removed group DISSOLVES: its children are released — into the enclosing
    // group when nested, else to the board. This is the one implementation of
    // ungroup, so the human's Ungroup and the agent's `group.remove` cannot differ.
    let released: string[] = [];

    if (existing) {
      this.recordDeletion(id);
      const parentGroupId = existing.data.parentGroup as string | undefined;
      const parent = parentGroupId ? this.nodes.get(parentGroupId) : undefined;
      const enclosing = parent && parent.type === 'group' ? parent : null;
      if (enclosing)
        enclosingBefore = { id: enclosing.id, children: ((enclosing.data.children as string[]) ?? []).slice() };
      if (existing.type === 'group') {
        released = ((existing.data.children as string[]) ?? []).filter((cid) => this.nodes.has(cid));
        for (const cid of released) {
          const child = this.nodes.get(cid)!;
          const d = { ...child.data };
          if (enclosing) d.parentGroup = enclosing.id;
          else delete d.parentGroup;
          this.setSemanticNode({ ...child, data: d });
        }
      }
      if (enclosing && enclosingBefore) {
        // The removed node leaves the enclosing group; a dissolved group's children take its place.
        const children = enclosingBefore.children.flatMap((cid) => (cid === id ? released : [cid]));
        this.setSemanticNode({ ...enclosing, data: { ...enclosing.data, children } });
      }
    }

    this.nodes.delete(id);
    this.removeEdgesForNode(id);
    this._contextPinnedNodeIds.delete(id);
    this._contextPinMeta.delete(id);
    // Re-normalize canvas-bound AX against the surviving node set. This strips the
    // dangling node ref from work items / approval gates / elicitations / mode
    // requests (re-anchored) and drops node-anchored review annotations (removed).
    // Previously SILENT — now audited (plan-007 Slice A): if the deleted node
    // orphaned anything, record one `note` timeline event so the human and a
    // resuming agent can see the work that changed instead of it changing quietly.
    const orphaned = this.ax.revalidateAfterNodeRemoval(id);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.notifyChange('ax');
    // Only record the audit note on a real (user-initiated) deletion. Undo/redo
    // replay removeNode inside `suppressed()` (_suppressRecordingDepth > 0); the
    // original deletion already recorded the note, so replaying must NOT append a
    // duplicate (the timeline is append-only). `revalidateAfterNodeRemoval` above
    // still runs unconditionally — only the timeline note is gated.
    const affected =
      orphaned.reanchoredIds.length > 0 || orphaned.removedReviewIds.length > 0 || orphaned.reanchoredFocus;
    if (existing && this._suppressRecordingDepth === 0 && affected) {
      const title = (existing.data.title as string) ?? id;
      const focusNote = orphaned.reanchoredFocus ? ' (focus anchor cleared)' : '';
      this.recordAxEvent(
        {
          kind: 'note',
          summary: `Node "${title}" deleted — re-anchored ${orphaned.reanchoredIds.length} AX item(s), removed ${orphaned.removedReviewIds.length} node-anchored review annotation(s).${focusNote}`,
          data: {
            systemEvent: 'ax-node-orphan',
            removedNodeId: id,
            reanchoredIds: orphaned.reanchoredIds,
            removedReviewIds: orphaned.removedReviewIds,
            reanchoredFocus: orphaned.reanchoredFocus,
          },
        },
        { source: 'system' },
      );
    }
    if (cloned) {
      const title = (cloned.data.title as string) ?? id;
      this.recordMutation({
        operationType: 'removeNode',
        description:
          cloned.type === 'group'
            ? `Dissolved group "${title}" — ${released.length} node${released.length === 1 ? '' : 's'} released`
            : `Removed ${cloned.type} node "${title}"`,
        forward: this.suppressed(() => this.removeNode(id)),
        inverse: this.suppressed(() => {
          this.addNode(structuredClone(cloned));
          const restored = this.nodes.get(id);
          if (restored) this.nodes.set(id, { ...restored, createdBy: cloned.createdBy ?? unknownActor() });
          // A restored group takes its children back; the enclosing group's membership is restored verbatim.
          for (const cid of released) {
            const child = this.nodes.get(cid);
            if (child) this.setSemanticNode({ ...child, data: { ...child.data, parentGroup: id } });
          }
          if (enclosingBefore) {
            const enclosing = this.nodes.get(enclosingBefore.id);
            if (enclosing) {
              this.setSemanticNode({
                ...enclosing,
                data: { ...enclosing.data, children: enclosingBefore.children },
              });
            }
          }
          for (const edge of connectedEdges) this.addEdge(structuredClone(edge));
          if (wasPinned) {
            this._contextPinnedNodeIds.add(id);
            if (pinMeta) this._contextPinMeta.set(id, pinMeta);
          }
          this.ax.applyPersistedAx(oldAxState);
          this.scheduleSave();
          this.notifyChange('nodes');
          this.notifyChange('pins');
          this.notifyChange('ax');
        }),
      });
    }
  }

  getNode(id: string): CanvasNodeState | undefined {
    const node = this.nodes.get(id);
    return node ? structuredClone(this.nodeForRead(node)) : undefined;
  }

  getNodeForPersistence(id: string): CanvasNodeState | undefined {
    const node = this.nodes.get(id);
    return node ? structuredClone(this.externalizeNodeDataBlobs(node)) : undefined;
  }

  // ── Edge CRUD ──────────────────────────────────────────────

  addEdge(edge: CanvasEdge): boolean {
    if (edge.from === edge.to) return false;
    for (const existing of this.edges.values()) {
      if (existing.from === edge.from && existing.to === edge.to && existing.type === edge.type) {
        return false;
      }
    }
    const cloned = structuredClone(edge);
    this.edges.set(edge.id, edge);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'addEdge',
      description: `Added ${edge.type} edge ${edge.from} → ${edge.to}`,
      forward: this.suppressed(() => this.addEdge(structuredClone(cloned))),
      inverse: this.suppressed(() => this.removeEdge(edge.id)),
    });
    return true;
  }

  updateEdge(id: string, patch: Partial<Pick<CanvasEdge, 'type' | 'label' | 'style' | 'animated'>>): CanvasEdge | null {
    const existing = this.edges.get(id);
    if (!existing) return null;
    // Retyping onto an existing from/to/type triple would create the duplicate
    // addEdge refuses.
    if (patch.type && patch.type !== existing.type) {
      for (const other of this.edges.values()) {
        if (other.id !== id && other.from === existing.from && other.to === existing.to && other.type === patch.type) {
          return null;
        }
      }
    }
    const before = structuredClone(existing);
    const updated: CanvasEdge = { ...existing, ...patch };
    // An explicit undefined in the patch clears the field (label/style/animated
    // are optional on the wire shape — never store undefined values).
    for (const key of ['label', 'style', 'animated'] as const) {
      if (key in patch && patch[key] === undefined) delete updated[key];
    }
    const after = structuredClone(updated);
    this.edges.set(id, updated);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'updateEdge',
      description: `Updated ${updated.type} edge ${updated.from} → ${updated.to}`,
      forward: this.suppressed(() => {
        this.edges.set(id, structuredClone(after));
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
      inverse: this.suppressed(() => {
        this.edges.set(id, structuredClone(before));
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
    });
    return structuredClone(updated);
  }

  removeEdge(id: string): boolean {
    const existing = this.edges.get(id);
    const cloned = existing ? structuredClone(existing) : null;
    const removed = this.edges.delete(id);
    if (removed && cloned) {
      this.scheduleSave();
      this.notifyChange('nodes');
      this.recordMutation({
        operationType: 'removeEdge',
        description: `Removed ${cloned.type} edge ${cloned.from} → ${cloned.to}`,
        forward: this.suppressed(() => this.removeEdge(id)),
        inverse: this.suppressed(() => this.addEdge(structuredClone(cloned))),
      });
    }
    return removed;
  }

  getEdges(): CanvasEdge[] {
    return Array.from(this.edges.values(), (edge) => structuredClone(edge));
  }

  getEdgesForNode(nodeId: string): CanvasEdge[] {
    return Array.from(this.edges.values())
      .filter((edge) => edge.from === nodeId || edge.to === nodeId)
      .map((edge) => structuredClone(edge));
  }

  addAnnotation(annotation: CanvasAnnotation): void {
    const cloned = structuredClone(annotation);
    this.annotations.set(annotation.id, cloned);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'addAnnotation',
      description: `Added annotation ${annotation.id}`,
      forward: this.suppressed(() => this.addAnnotation(structuredClone(cloned))),
      inverse: this.suppressed(() => this.removeAnnotation(annotation.id)),
    });
  }

  removeAnnotation(id: string): boolean {
    const existing = this.annotations.get(id);
    const removed = this.annotations.delete(id);
    if (removed && existing) {
      const cloned = structuredClone(existing);
      this.scheduleSave();
      this.notifyChange('nodes');
      this.recordMutation({
        operationType: 'removeAnnotation',
        description: `Removed annotation ${id}`,
        forward: this.suppressed(() => this.removeAnnotation(id)),
        inverse: this.suppressed(() => this.addAnnotation(structuredClone(cloned))),
      });
    }
    return removed;
  }

  getAnnotations(): CanvasAnnotation[] {
    return Array.from(this.annotations.values(), (annotation) => structuredClone(annotation));
  }

  private removeEdgesForNode(nodeId: string): void {
    for (const [id, edge] of this.edges) {
      if (edge.from === nodeId || edge.to === nodeId) {
        this.edges.delete(id);
      }
    }
  }

  getLayout(): CanvasLayout {
    return {
      tour: this.getTour(),
      viewport: structuredClone(this._viewport),
      theme: this._theme,
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(this.nodeForRead(node))),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: this.getAnnotations(),
    };
  }

  getLayoutForPersistence(): CanvasLayout {
    return {
      tour: this.getTour(),
      viewport: structuredClone(this._viewport),
      theme: this._theme,
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(this.externalizeNodeDataBlobs(node))),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: this.getAnnotations(),
    };
  }

  getTour(): Tour | undefined {
    return this._tour ? structuredClone(this._tour) : undefined;
  }

  setTour(tour: Tour | null): void {
    const previous = this.getTour();
    this._tour = tour === null ? undefined : tourSchema.parse(tour);
    const next = this.getTour();
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'viewport',
      description: 'Updated board tour',
      forward: this.suppressed(() => this.setTour(next ?? null)),
      inverse: this.suppressed(() => this.setTour(previous ?? null)),
    });
  }

  applyUpdates(updates: CanvasNodeUpdate[], options: ApplyUpdatesOptions = {}): { applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    const touchedParentGroups = new Set<string>();
    const oldSnapshots = new Map<string, CanvasNodeState>();
    const appliedUpdates: CanvasNodeUpdate[] = [];
    const explicitPositionUpdateIds = new Set(
      updates.filter((update) => update.position !== undefined).map((update) => update.id),
    );

    for (const update of updates) {
      const existing = this.nodes.get(update.id);
      if (!existing) {
        skipped++;
        continue;
      }
      const nextPatch: Partial<CanvasNodeState> = {};
      if (update.position && (update.position.x !== existing.position.x || update.position.y !== existing.position.y)) {
        nextPatch.position = update.position;
      }
      if (update.size && (update.size.width !== existing.size.width || update.size.height !== existing.size.height)) {
        nextPatch.size = update.size;
      }
      if (update.collapsed !== undefined && update.collapsed !== existing.collapsed) {
        nextPatch.collapsed = update.collapsed;
      }
      if (Object.keys(nextPatch).length === 0) {
        skipped++;
        continue;
      }
      oldSnapshots.set(update.id, structuredClone(existing));
      appliedUpdates.push({ id: update.id, ...structuredClone(nextPatch) });
      if (existing.type === 'group' && nextPatch.position && options.skipGroupChildTranslation !== true) {
        this.translateGroupChildren(
          update.id,
          nextPatch.position.x - existing.position.x,
          nextPatch.position.y - existing.position.y,
          explicitPositionUpdateIds,
        );
      }
      this.nodes.set(
        update.id,
        this.normalizeNode({
          ...existing,
          ...nextPatch,
        }),
      );
      const parentGroupId = existing.data.parentGroup as string | undefined;
      if (parentGroupId) {
        touchedParentGroups.add(parentGroupId);
      }
      applied++;
    }

    // Moving or resizing a grouped child re-fits the group frame, but must NOT
    // repack siblings — that would discard their explicit positions and the
    // moved child's requested coordinates. Compaction is opt-in, applied only
    // through an explicit layout (group create/add with childLayout, or arrange).
    for (const groupId of touchedParentGroups) {
      this.recomputeParentGroupBounds(groupId);
    }

    if (applied > 0) {
      this.scheduleSave();
      this.notifyChange('nodes');
      const inverseSnapshots = Array.from(oldSnapshots.entries()).map(([id, node]) => ({ id, node }));
      this.recordMutation({
        operationType: 'batch',
        description: formatBatchUpdateDescription(appliedUpdates),
        forward: this.suppressed(() => {
          this.applyUpdates(
            appliedUpdates.map((update) => structuredClone(update)),
            options,
          );
        }),
        inverse: this.suppressed(() => {
          for (const snapshot of inverseSnapshots) {
            this.nodes.set(snapshot.id, structuredClone(snapshot.node));
          }
          this.reflowAllGroups();
          this.scheduleSave();
          this.notifyChange('nodes');
        }),
      });
    }
    return { applied, skipped };
  }

  setViewport(v: Partial<ViewportState>): void {
    const oldViewport = { ...this._viewport };
    this._viewport = { ...this._viewport, ...v };
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'viewport',
      description: 'Updated viewport',
      forward: this.suppressed(() => this.setViewport({ ...v })),
      inverse: this.suppressed(() => {
        this._viewport = oldViewport;
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
    });
  }

  get theme(): CanvasTheme {
    return this._theme;
  }

  setTheme(theme: CanvasTheme): CanvasTheme {
    const next = normalizeCanvasTheme(theme, this._theme);
    if (next === this._theme) return this._theme;
    this._theme = next;
    this.scheduleSave();
    this.notifyChange('nodes');
    return this._theme;
  }

  // ── Context pins ─────────────────────────────────────────────

  get contextPinnedNodeIds(): Set<string> {
    return new Set(this._contextPinnedNodeIds);
  }

  // ── AX state delegation (canvas-bound + timeline + host) ──────────
  // All AX state lives in `this.ax` (AxStateManager); these are byte-stable
  // delegations so SDK/HTTP/MCP keep calling canvasState.<method>(...) unchanged.
  getAxState(): PmxAxState {
    return this.ax.getAxState();
  }

  /**
   * Replace the canvas-bound AX partition from a persisted blob, normalized against
   * the current node set — the same operation snapshot restore performs internally
   * (`applyPersistedState`), exposed for the demo seed. Both restore nodes whose
   * `data.axStep.workItemId` only resolves if the work items come back with their
   * original ids, so this preserves them verbatim rather than re-creating them.
   */
  applyPersistedAxState(ax: unknown): void {
    this.ax.applyPersistedAx(ax);
  }

  getAxFocus(): PmxAxFocusState {
    return this.ax.getAxFocus();
  }

  setAxFocus(nodeIds: string[], options: { source?: PmxAxSource; recordHistory?: boolean } = {}): PmxAxFocusState {
    return this.ax.setAxFocus(nodeIds, options);
  }

  clearAxFocus(): PmxAxFocusState {
    return this.ax.clearAxFocus();
  }

  // ── Work items (canvas-bound; snapshotted via getAxState blob) ────
  getWorkItems(): PmxAxWorkItem[] {
    return this.ax.getWorkItems();
  }

  addWorkItem(
    input: {
      title: string;
      status?: PmxAxWorkItemStatus;
      detail?: string | null;
      nodeIds?: string[];
      agentId?: string | null;
    },
    options: { source?: PmxAxSource } = {},
  ): PmxAxWorkItem {
    const item = this.ax.addWorkItem(input, options);
    this.mirrorAxWorkStatusToNodes(item.nodeIds, [], item.status);
    this.notifyWorkItemsChanged();
    return item;
  }

  updateWorkItem(
    id: string,
    patch: {
      title?: string;
      status?: PmxAxWorkItemStatus;
      detail?: string | null;
      nodeIds?: string[];
      agentId?: string | null;
    },
    options: { source?: PmxAxSource } = {},
  ): PmxAxWorkItem | null {
    const previousNodeIds = this.ax.getWorkItems().find((w) => w.id === id)?.nodeIds ?? [];
    const item = this.ax.updateWorkItem(id, patch, options);
    if (!item) return null;
    this.mirrorAxWorkStatusToNodes(item.nodeIds, previousNodeIds, item.status);
    this.notifyWorkItemsChanged();
    return item;
  }

  /**
   * Mirror a work item's status onto every linked canvas node's `data.axWorkStatus`,
   * through the standard node-update path (persistence + undo/redo, same as any other
   * node data change). Nodes unlinked by an updateWorkItem nodeIds change have the
   * mirrored status cleared.
   */
  private mirrorAxWorkStatusToNodes(nodeIds: string[], previousNodeIds: string[], status: PmxAxWorkItemStatus): void {
    for (const nodeId of nodeIds) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      // No-op guard: a title-/agentId-only work-item patch must not push
      // history entries and SSE churn for chips that aren't changing.
      if (node.data.axWorkStatus === status) continue;
      this.updateNode(nodeId, { data: { ...node.data, axWorkStatus: status } });
    }
    for (const nodeId of previousNodeIds) {
      if (nodeIds.includes(nodeId)) continue;
      const node = this.nodes.get(nodeId);
      if (!node || node.data.axWorkStatus === undefined) continue;
      const data = { ...node.data };
      delete data.axWorkStatus;
      this.updateNode(nodeId, { data });
    }
  }

  // ── Approval gates (canvas-bound) ─────────────────────────────────
  getApprovalGates(): PmxAxApprovalGate[] {
    return this.ax.getApprovalGates();
  }

  requestApproval(
    input: { title: string; detail?: string | null; action?: string | null; nodeIds?: string[]; ttlMs?: number },
    options: { source?: PmxAxSource } = {},
  ): PmxAxApprovalGate {
    return this.ax.requestApproval(input, options);
  }

  resolveApproval(
    id: string,
    decision: 'approved' | 'rejected' | 'held',
    options: { resolution?: string; source?: PmxAxSource } = {},
  ): PmxAxApprovalGate | null {
    return this.ax.resolveApproval(id, decision, options);
  }

  /** Reopen a resolved (typically auto-held) gate with a fresh TTL. */
  reopenApproval(id: string, options: { ttlMs?: number; source?: PmxAxSource } = {}): PmxAxApprovalGate | null {
    return this.ax.reopenApproval(id, options);
  }

  // ── Review annotations (canvas-bound) ─────────────────────────────
  getReviewAnnotations(): PmxAxReviewAnnotation[] {
    return this.ax.getReviewAnnotations();
  }

  addReviewAnnotation(
    input: {
      body: string;
      kind?: PmxAxReviewKind;
      severity?: PmxAxReviewSeverity;
      anchorType?: PmxAxReviewAnchorType;
      nodeId?: string | null;
      file?: string | null;
      region?: PmxAxReviewRegion | null;
      author?: string | null;
    },
    options: { source?: PmxAxSource } = {},
  ): PmxAxReviewAnnotation | null {
    return this.ax.addReviewAnnotation(input, options);
  }

  updateReviewAnnotation(
    id: string,
    patch: { body?: string; status?: PmxAxReviewStatus; severity?: PmxAxReviewSeverity; kind?: PmxAxReviewKind },
    options: { source?: PmxAxSource } = {},
  ): PmxAxReviewAnnotation | null {
    return this.ax.updateReviewAnnotation(id, patch, options);
  }

  // ── Host capability (own table; reported by adapters) ─────────────
  getHostCapability(): PmxAxHostCapability | null {
    return this.ax.getHostCapability();
  }

  getElicitations(): PmxAxElicitation[] {
    return this.ax.getElicitations();
  }

  requestElicitation(
    input: { prompt: string; fields?: string[]; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxElicitation {
    return this.ax.requestElicitation(input, options);
  }

  respondElicitation(
    id: string,
    response: Record<string, unknown>,
    options: { source?: PmxAxSource } = {},
  ): PmxAxElicitation | null {
    return this.ax.respondElicitation(id, response, options);
  }

  getModeRequests(): PmxAxModeRequest[] {
    return this.ax.getModeRequests();
  }

  requestMode(
    input: { mode: PmxAxMode; reason?: string | null; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxModeRequest {
    return this.ax.requestMode(input, options);
  }

  resolveModeRequest(
    id: string,
    decision: 'approved' | 'rejected',
    options: { resolution?: string; source?: PmxAxSource } = {},
  ): PmxAxModeRequest | null {
    return this.ax.resolveModeRequest(id, decision, options);
  }

  // ── Single-item AX readers (canvas-bound; for the blocking-wait endpoints) ──
  getApproval(id: string): PmxAxApprovalGate | null {
    return this.ax.getApproval(id);
  }

  getElicitation(id: string): PmxAxElicitation | null {
    return this.ax.getElicitation(id);
  }

  getModeRequest(id: string): PmxAxModeRequest | null {
    return this.ax.getModeRequest(id);
  }

  getCommandRegistry(): PmxAxCommandDescriptor[] {
    return this.ax.getCommandRegistry();
  }

  /** Invoke a registry-gated PMX command intent — records a timeline event (no execution). */
  invokeCommand(
    name: string,
    args: Record<string, unknown> | null = null,
    options: { source?: PmxAxSource } = {},
  ): PmxAxEvent | null {
    return this.ax.invokeCommand(name, args, options);
  }

  getPolicy(): PmxAxPolicy {
    return this.ax.getPolicy();
  }

  /** Merge a declarative tool/prompt policy patch (canvas-bound, snapshotted). */
  setPolicy(
    patch: {
      tools?: Partial<PmxAxPolicy['tools']>;
      prompt?: Partial<PmxAxPolicy['prompt']>;
      scope?: { nodeIds: string[]; padding?: number } | null;
    },
    options: { source?: PmxAxSource } = {},
  ): PmxAxPolicy {
    return this.ax.setPolicy(patch, options);
  }

  setHostCapability(input: unknown, options: { source?: PmxAxSource } = {}): PmxAxHostCapability {
    return this.ax.setHostCapability(input, options);
  }

  // ── Timeline (DB-direct; NOT in _axState; NOT history-recorded) ───
  recordAxEvent(
    input: {
      kind: PmxAxEventKind;
      summary: string;
      detail?: string | null;
      nodeIds?: string[];
      data?: Record<string, unknown> | null;
    },
    options: { source?: PmxAxSource; agentId?: string | null } = {},
  ): PmxAxEvent {
    return this.ax.recordAxEvent(input, options);
  }

  addEvidence(
    input: {
      kind: PmxAxEvidenceKind;
      title: string;
      body?: string | null;
      ref?: string | null;
      nodeIds?: string[];
      data?: Record<string, unknown> | null;
    },
    options: { source?: PmxAxSource } = {},
  ): PmxAxEvidence {
    return this.ax.addEvidence(input, options);
  }

  recordSteeringMessage(
    message: string,
    options: { source?: PmxAxSource; agentId?: string | null; target?: string | null } = {},
  ): PmxAxSteeringMessage {
    return this.ax.recordSteeringMessage(message, options);
  }

  markSteeringDelivered(id: string, consumer?: string | null): boolean {
    return this.ax.markSteeringDelivered(id, consumer);
  }

  ingestActivity(
    input: {
      kind: PmxAxActivityKind;
      title: string;
      summary?: string | null;
      outcome?: 'success' | 'failure';
      ref?: string | null;
      nodeIds?: string[];
      data?: Record<string, unknown> | null;
      reactions?: {
        workItem?: false | { status?: PmxAxWorkItemStatus; detail?: string | null };
        evidence?: false | { kind?: PmxAxEvidenceKind; body?: string | null };
        review?:
          | false
          | {
              severity?: PmxAxReviewSeverity;
              kind?: PmxAxReviewKind;
              anchorType?: PmxAxReviewAnchorType;
              nodeId?: string | null;
            };
      };
    },
    options: { source?: PmxAxSource } = {},
  ): {
    event: PmxAxEvent;
    workItem: PmxAxWorkItem | null;
    evidence: PmxAxEvidence | null;
    review: PmxAxReviewAnnotation | null;
  } {
    return this.ax.ingestActivity(input, options);
  }

  getAxEvents(q: AxTimelineQuery = {}): PmxAxEvent[] {
    return this.ax.getAxEvents(q);
  }

  getAxEvidence(q: AxTimelineQuery = {}): PmxAxEvidence[] {
    return this.ax.getAxEvidence(q);
  }

  getAxSteering(q: AxTimelineQuery & { onlyPending?: boolean } = {}): PmxAxSteeringMessage[] {
    return this.ax.getAxSteering(q);
  }

  getPendingSteering(options: { consumer?: string; limit?: number } = {}): PmxAxSteeringMessage[] {
    return this.ax.getPendingSteering(options);
  }

  getPendingSteeringForContext(options: { consumer?: string; limit?: number } = {}): PmxAxSteeringMessage[] {
    return this.ax.getPendingSteeringForContext(options);
  }

  getPendingSteeringCount(consumer?: string): number {
    return this.ax.getPendingSteeringCount(consumer);
  }

  getAxTimelineSummary(): PmxAxTimelineSummary {
    return this.ax.getAxTimelineSummary();
  }

  /** Records one agent context read (diagnostics; never notifies, so a read cannot trigger reads). */
  recordContextRead(input: ContextReadInput, boardId: string | null = this._activeBoardId): ContextRead | null {
    if (!this._db) return null;
    try {
      return appendContextReadToDB(this._db, input, boardId, this.readRevisions(input, boardId));
    } catch (error) {
      logCanvasStateWarning('record context read failed', error);
      return null;
    }
  }

  /** The delivered ids that are nodes on the read board, each with its content revision now. */
  private readRevisions(input: ContextReadInput, boardId: string | null): Record<string, number> {
    if (!boardId) return {};
    const nodes =
      boardId === this._activeBoardId ? [...this.nodes.values()] : (this.readBoard(boardId, false)?.state.nodes ?? []);
    const byId = new Map(nodes.map((node) => [node.id, node.contentRevision ?? 0]));
    const revisions: Record<string, number> = {};
    for (const id of input.readNodeIds ?? input.deliveredNodeIds) {
      const revision = byId.get(id);
      if (revision !== undefined) revisions[id] = revision;
    }
    return revisions;
  }

  /** Per node on a board, the latest agent read that delivered its content. */
  getNodeReadStatus(boardId: string | null = this._activeBoardId): NodeReadStatus[] {
    if (!this._db || !boardId) return [];
    return loadNodeReadStatusFromDB(this._db, boardId);
  }

  getContextReads(limit?: number): { reads: ContextRead[]; summary: ContextReadConsumerSummary[] } {
    return this._db ? loadContextReadsFromDB(this._db, limit) : { reads: [], summary: [] };
  }

  getAxTimeline(q: AxTimelineQuery = {}): {
    events: PmxAxEvent[];
    evidence: PmxAxEvidence[];
    steering: PmxAxSteeringMessage[];
    summary: PmxAxTimelineSummary;
  } {
    return this.ax.getAxTimeline(q);
  }

  /**
   * Replace the pin set. Newly pinned nodes are attributed to the current
   * actor (with `reason` when given); pins that stay keep their attribution.
   * `restore` re-applies saved attribution, so undo does not re-attribute.
   */
  setContextPins(nodeIds: string[], options: { reason?: string; restore?: Map<string, ContextPinMeta> } = {}): void {
    const oldPins = Array.from(this._contextPinnedNodeIds);
    const oldMeta = new Map(this._contextPinMeta);
    const pinnedAt = new Date().toISOString();
    this._contextPinnedNodeIds.clear();
    for (const id of nodeIds) {
      if (!this.nodes.has(id)) continue;
      this._contextPinnedNodeIds.add(id);
      const meta =
        options.restore?.get(id) ??
        (oldPins.includes(id) ? oldMeta.get(id) : undefined) ??
        (oldPins.includes(id)
          ? undefined
          : { pinnedBy: currentActor(), pinnedAt, ...(options.reason ? { reason: options.reason } : {}) });
      if (meta) this._contextPinMeta.set(id, meta);
    }
    for (const id of [...this._contextPinMeta.keys()]) {
      if (!this._contextPinnedNodeIds.has(id)) this._contextPinMeta.delete(id);
    }
    const newMeta = new Map(this._contextPinMeta);
    this.scheduleSave();
    this.notifyChange('pins');
    this.recordMutation({
      operationType: 'setPins',
      description: `Set context pins (${this._contextPinnedNodeIds.size} nodes)`,
      forward: this.suppressed(() => this.setContextPins([...nodeIds], { restore: newMeta })),
      inverse: this.suppressed(() => this.setContextPins(oldPins, { restore: oldMeta })),
    });
  }

  /** Who pinned each current pin, when and why (pins with an unknown pinner are absent). */
  getContextPinMeta(): Record<string, ContextPinMeta> {
    return this.pinMetaRecord();
  }

  private pinMetaRecord(): Record<string, ContextPinMeta> {
    const record: Record<string, ContextPinMeta> = {};
    for (const id of this._contextPinnedNodeIds) {
      const meta = this._contextPinMeta.get(id);
      if (meta) record[id] = structuredClone(meta);
    }
    return record;
  }

  clearContextPins(): void {
    this._contextPinMeta.clear();
    this._contextPinnedNodeIds.clear();
    this.scheduleSave();
    this.notifyChange('pins');
  }

  /** Move child nodes into a group. Sets data.parentGroup on children and data.children on the group. */
  groupNodes(groupId: string, childIds: string[], options: GroupNodesOptions = {}): boolean {
    const group = this.nodes.get(groupId);
    if (!group || group.type !== 'group') return false;

    const validIds: string[] = [];
    for (const id of childIds) {
      const child = this.nodes.get(id);
      if (child && id !== groupId) validIds.push(id);
    }
    if (validIds.length === 0) return false;

    const oldChildren = ((group.data.children as string[]) ?? []).slice();
    const merged = [...new Set([...oldChildren, ...validIds])];

    // Snapshot for undo
    const oldParents = new Map<string, string | undefined>();
    for (const id of validIds) {
      const child = this.nodes.get(id)!;
      oldParents.set(id, child.data.parentGroup as string | undefined);
    }

    // Apply
    this.setSemanticNode({ ...group, data: { ...group.data, children: merged } });
    for (const id of validIds) {
      const child = this.nodes.get(id)!;
      this.setSemanticNode({ ...child, data: { ...child.data, parentGroup: groupId } });
    }
    if (options.preservePositions === true) {
      if (options.keepGroupFrame !== true && group.data.frameMode !== 'manual') {
        this.recomputeParentGroupBounds(groupId);
      }
    } else {
      this.compactGroupChildren(groupId, options.layout ?? 'grid');
    }
    if (options.preservePositions !== true && options.keepGroupFrame !== true) {
      this.reflowAllGroups();
    } else if (options.keepGroupFrame !== true && group.data.frameMode !== 'manual') {
      this.recomputeParentGroupBounds(groupId);
    }

    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'groupNodes',
      description: `Grouped ${validIds.length} nodes into "${(group.data.title as string) ?? groupId}"`,
      forward: this.suppressed(() => this.groupNodes(groupId, validIds, options)),
      inverse: this.suppressed(() => {
        const g = this.nodes.get(groupId);
        if (g) this.setSemanticNode({ ...g, data: { ...g.data, children: oldChildren } });
        for (const [id, oldParent] of oldParents) {
          const c = this.nodes.get(id);
          if (!c) continue;
          const d = { ...c.data };
          if (oldParent) d.parentGroup = oldParent;
          else delete d.parentGroup;
          this.setSemanticNode({ ...c, data: d });
        }
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
    });
    return true;
  }

  /**
   * Ungroup = dissolve: the children become independent nodes (members of the
   * enclosing group when nested) and the frame is removed, in one undo step.
   * Delegates to `removeNode` so the human's Ungroup and the agent's
   * `group.remove` are the same operation. False when `groupId` is not a group.
   */
  ungroupNodes(groupId: string): boolean {
    const group = this.nodes.get(groupId);
    if (!group || group.type !== 'group') return false;
    this.removeNode(groupId);
    return true;
  }

  /**
   * Internal membership step: release every child but keep the frame (the
   * first half of "set this group's children to …"). Not an ungroup — a
   * human or agent ungroup dissolves the frame (`ungroupNodes`).
   */
  releaseGroupChildren(groupId: string): boolean {
    const group = this.nodes.get(groupId);
    if (!group || group.type !== 'group') return false;

    const childIds = (group.data.children as string[]) ?? [];
    if (childIds.length === 0) return false;

    const snapshot = childIds.slice();

    this.setSemanticNode({ ...group, data: { ...group.data, children: [] } });
    for (const id of childIds) {
      const child = this.nodes.get(id);
      if (!child) continue;
      const d = { ...child.data };
      delete d.parentGroup;
      this.setSemanticNode({ ...child, data: d });
    }

    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'releaseGroupChildren',
      description: `Released ${childIds.length} nodes from "${(group.data.title as string) ?? groupId}"`,
      forward: this.suppressed(() => this.releaseGroupChildren(groupId)),
      inverse: this.suppressed(() => this.groupNodes(groupId, snapshot)),
    });
    return true;
  }

  clear(): void {
    const oldTour = this.getTour();
    this._tour = undefined;
    const oldNodes = Array.from(this.nodes.values()).map((n) => structuredClone(n));
    const oldEdges = Array.from(this.edges.values()).map((e) => structuredClone(e));
    const oldAnnotations = Array.from(this.annotations.values()).map((annotation) => structuredClone(annotation));
    const oldPins = Array.from(this._contextPinnedNodeIds);
    const oldAxState = this.getAxState();
    const oldViewport = { ...this._viewport };
    for (const node of oldNodes) this.recordDeletion(node.id);
    this.nodes.clear();
    this.edges.clear();
    this.annotations.clear();
    this._contextPinnedNodeIds.clear();
    this._contextPinMeta.clear();
    // Clears canvas-bound AX state (focus, work items, approvals, review annotations).
    // Timeline tables (ax_events/ax_evidence/ax_steering) and host capability are
    // deliberately retained per the AX state-partition policy.
    this.ax.resetCanvasBound();
    this._viewport = { x: 0, y: 0, scale: 1 };
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.notifyChange('ax');
    this.recordMutation({
      operationType: 'clear',
      description: `Cleared canvas (was ${oldNodes.length} nodes, ${oldEdges.length} edges)`,
      forward: this.suppressed(() => this.clear()),
      inverse: this.suppressed(() => {
        for (const n of oldNodes) this.addNode(structuredClone(n));
        for (const e of oldEdges) this.addEdge(structuredClone(e));
        for (const annotation of oldAnnotations) this.addAnnotation(structuredClone(annotation));
        this.setContextPins(oldPins);
        this.setTour(oldTour ?? null);
        this.ax.applyPersistedAx(oldAxState);
        this.setViewport(oldViewport);
        this.notifyChange('ax');
      }),
    });
  }
}

// Module-level singleton — safe because Bun is single-threaded and this
// module is imported once per process. Agent tools and the HTTP server share
// the same instance; no locking needed.
export const canvasState = new CanvasStateManager();
