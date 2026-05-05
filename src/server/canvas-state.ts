/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas/state.json` in the
 * workspace root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { isAbsolute, join, dirname, relative } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { normalizeCanvasNodeData } from './canvas-provenance.js';
import {
  type CanvasPlacementRect,
  computeGroupBounds,
  computePackedGroupLayout,
  GROUP_PAD,
  GROUP_TITLEBAR_HEIGHT,
  resolveGroupCollision,
} from './placement.js';

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
const STATE_FILENAME = 'state.json';
const SNAPSHOTS_SUBDIR = 'snapshots';
const BLOBS_SUBDIR = 'blobs';
const LEGACY_STATE_FILENAME = '.pmx-canvas.json';
const LEGACY_SNAPSHOTS_DIR = '.pmx-canvas-snapshots';
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

interface PersistedCanvasState {
  version: number;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations?: CanvasAnnotation[];
  contextPins: string[];
}

interface LoadFromDiskOptions {
  clearExisting?: boolean;
}

export const IMAGE_MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
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
    | 'prompt'
    | 'response'
    | 'status'
    | 'context'
    | 'ledger'
    | 'trace'
    | 'file'
    | 'image'
    | 'html'
    | 'group';
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  collapsed: boolean;
  pinned: boolean;
  dockPosition: 'left' | 'right' | null;
  data: Record<string, unknown>;
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
  type: 'freehand';
  points: CanvasAnnotationPoint[];
  bounds: { x: number; y: number; width: number; height: number };
  color: string;
  width: number;
  label?: string;
  createdAt: string;
}

export interface CanvasLayout {
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  annotations: CanvasAnnotation[];
}

export interface CanvasNodeUpdate {
  id: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  collapsed?: boolean;
  dockPosition?: 'left' | 'right' | null;
}

export type CanvasChangeType = 'pins' | 'nodes';

export interface MutationRecordInfo {
  operationType: 'addNode' | 'updateNode' | 'removeNode' | 'addEdge' | 'removeEdge' | 'addAnnotation' | 'removeAnnotation' | 'clear' | 'restoreSnapshot' | 'setPins' | 'arrange' | 'batch' | 'groupNodes' | 'ungroupNodes' | 'viewport';
  description: string;
  forward: () => void;
  inverse: () => void;
}

interface GroupNodesOptions {
  preservePositions?: boolean;
  layout?: 'grid' | 'column' | 'flow';
  keepGroupFrame?: boolean;
}

function formatBatchUpdateDescription(updates: CanvasNodeUpdate[]): string {
  let moved = 0;
  let resized = 0;
  let collapsed = 0;
  let docked = 0;

  for (const update of updates) {
    if (update.position) moved++;
    if (update.size) resized++;
    if (update.collapsed !== undefined) collapsed++;
    if (update.dockPosition !== undefined) docked++;
  }

  const parts: string[] = [];
  if (moved > 0) parts.push(`${moved} moved`);
  if (resized > 0) parts.push(`${resized} resized`);
  if (collapsed > 0) parts.push(`${collapsed} collapsed`);
  if (docked > 0) parts.push(`${docked} docked`);

  const prefix = `Updated ${updates.length} node${updates.length === 1 ? '' : 's'}`;
  return parts.length > 0 ? `${prefix} (${parts.join(', ')})` : prefix;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPersistedBlobRef(value: unknown): value is PersistedBlobRef {
  return isRecord(value) &&
    value.__pmxCanvasBlob === 'v1' &&
    typeof value.path === 'string' &&
    typeof value.sha256 === 'string' &&
    value.encoding === 'json+gzip' &&
    typeof value.bytes === 'number' &&
    typeof value.jsonBytes === 'number';
}

class CanvasStateManager {
  private nodes = new Map<string, CanvasNodeState>();
  private edges = new Map<string, CanvasEdge>();
  private annotations = new Map<string, CanvasAnnotation>();
  private _viewport: ViewportState = { x: 0, y: 0, scale: 1 };
  private _contextPinnedNodeIds = new Set<string>();
  private _workspaceRoot = process.cwd();

  // ── Change listeners (for MCP resource notifications) ──────
  private _changeListeners: ((type: CanvasChangeType) => void)[] = [];

  /** Register a listener for state changes. Used by MCP server to emit resource notifications. */
  onChange(cb: (type: CanvasChangeType) => void): void {
    this._changeListeners.push(cb);
  }

  private notifyChange(type: CanvasChangeType): void {
    for (const cb of this._changeListeners) {
      try {
        cb(type);
      } catch (error) {
        logCanvasStateWarning('change-listener failed', error, { type });
      }
    }
  }

  // ── Mutation recorder (for undo/redo history) ─────────────
  private _mutationRecorder: ((info: MutationRecordInfo) => void) | null = null;
  private _suppressRecordingDepth = 0;

  /** Register a mutation recorder. Used by mutation-history to capture undo/redo closures. */
  onMutation(cb: (info: MutationRecordInfo) => void): void {
    this._mutationRecorder = cb;
  }

  /** Run a function with mutation recording suppressed (for undo/redo replay and computed edges). */
  withSuppressedRecording(fn: () => void): void {
    this._suppressRecordingDepth++;
    try { fn(); } finally { this._suppressRecordingDepth--; }
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

  private applyResolvedGroupBounds(
    group: CanvasNodeState,
    groupId: string,
    childIds: string[],
    bounds: { x: number; y: number; width: number; height: number },
    existingGroups?: CanvasPlacementRect[],
  ): void {
    const otherGroups = existingGroups ?? Array.from(this.nodes.values()).filter(
      (node) => node.id !== groupId && node.type === 'group',
    );
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
    const normalized: CanvasNodeState = {
      ...node,
      data: normalizeCanvasNodeData(node.type, node.data),
    };
    // Context nodes are always docked to the right side as a pill/panel widget
    // (see DockedNode.tsx). They start collapsed so the user sees the slim
    // pill first; expanding reveals the full context overview panel.
    if (normalized.type === 'context' && normalized.dockPosition !== 'right') {
      normalized.dockPosition = 'right';
      normalized.collapsed = true;
    }
    return normalized;
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

  private translateGroupChildren(groupId: string, deltaX: number, deltaY: number, skipIds: ReadonlySet<string> = new Set()): void {
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

  private recomputeParentGroupBounds(groupId: string | undefined): void {
    if (!groupId) return;
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
  }

  private compactGroupChildren(groupId: string, layout: 'grid' | 'column' | 'flow' = 'grid'): void {
    const snapshot = this.getGroupSnapshot(groupId);
    if (!snapshot || snapshot.children.length === 0) return;
    if (snapshot.group.data.frameMode === 'manual') {
      const sorted = [...snapshot.children].sort(
        (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
      );
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
  private _stateFilePath: string | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set the workspace root to enable auto-persistence. */
  setWorkspaceRoot(workspaceRoot: string): void {
    this._workspaceRoot = workspaceRoot;
    this.migrateLegacyLayout(workspaceRoot);
    const override = (process.env.PMX_CANVAS_STATE_FILE ?? '').trim();
    this._stateFilePath = override || join(workspaceRoot, PMX_CANVAS_DIR, STATE_FILENAME);
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
    const dir = this.blobsDir;
    if (!dir) return null;
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return null;
    const jsonBytes = Buffer.byteLength(json);
    if (jsonBytes < BLOB_JSON_THRESHOLD_BYTES) return null;
    const sha256 = createHash('sha256').update(json).digest('hex');
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
    if (node.type !== 'mcp-app') return node;
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
    if (node.type !== 'mcp-app') return node;
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
      nodes: Array.isArray(state.nodes)
        ? state.nodes.map((node) => this.externalizeNodeDataBlobs(node))
        : [],
    };
  }

  /**
   * One-time migration: rename files from the pre-consolidation layout
   * (`.pmx-canvas.json` + `.pmx-canvas-snapshots/`) into `.pmx-canvas/`.
   * No-op when the new layout already exists.
   */
  private migrateLegacyLayout(workspaceRoot: string): void {
    const newDir = join(workspaceRoot, PMX_CANVAS_DIR);
    const legacyState = join(workspaceRoot, LEGACY_STATE_FILENAME);
    const newState = join(newDir, STATE_FILENAME);
    const legacySnapshots = join(workspaceRoot, LEGACY_SNAPSHOTS_DIR);
    const newSnapshots = join(newDir, SNAPSHOTS_SUBDIR);

    try {
      if (existsSync(legacyState) && !existsSync(newState)) {
        mkdirSync(newDir, { recursive: true });
        renameSync(legacyState, newState);
      }
      if (existsSync(legacySnapshots) && !existsSync(newSnapshots)) {
        mkdirSync(newDir, { recursive: true });
        renameSync(legacySnapshots, newSnapshots);
      }
    } catch (error) {
      logCanvasStateWarning('legacy layout migration failed', error, {
        workspaceRoot,
      });
    }
  }

  getWorkspaceRoot(): string {
    return this._workspaceRoot;
  }

  private emptyPersistedState(): PersistedCanvasState {
    return {
      version: 1,
      viewport: { x: 0, y: 0, scale: 1 },
      nodes: [],
      edges: [],
      annotations: [],
      contextPins: [],
    };
  }

  /** Load canvas state from disk. Call once on server startup. */
  loadFromDisk(options: LoadFromDiskOptions = {}): boolean {
    if (!this._stateFilePath || !existsSync(this._stateFilePath)) {
      if (options.clearExisting) {
        this.applyPersistedState(this.emptyPersistedState());
      }
      return false;
    }
    try {
      const raw = readFileSync(this._stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedCanvasState;
      if (!parsed || parsed.version !== 1) return false;
      this.applyPersistedState(parsed);
      return true;
    } catch (error) {
      logCanvasStateWarning('load state from disk failed', error, {
        path: this._stateFilePath ?? undefined,
      });
      return false;
    }
  }

  /** Debounced save — coalesces rapid mutations into a single disk write. */
  private scheduleSave(): void {
    if (!this._stateFilePath) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.saveToDisk();
    }, SAVE_DEBOUNCE_MS);
  }

  flushToDisk(): void {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    this.saveToDisk();
  }

  /** Write current state to disk immediately. */
  private saveToDisk(): void {
    if (!this._stateFilePath) return;
    try {
      const dir = dirname(this._stateFilePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const payload = this.externalizePersistedStateBlobs({
        version: 1,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        annotations: Array.from(this.annotations.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
      });
      writeFileSync(this._stateFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      logCanvasStateWarning('save state to disk failed', error, {
        path: this._stateFilePath ?? undefined,
      });
    }
  }

  // ── Snapshots ───────────────────────────────────────────────

  private get snapshotsDir(): string | null {
    if (!this._workspaceRoot) return null;
    return join(this._workspaceRoot, PMX_CANVAS_DIR, SNAPSHOTS_SUBDIR);
  }

  private applyPersistedState(state: PersistedCanvasState): void {
    this.nodes.clear();
    this.edges.clear();
    this.annotations.clear();
    this._contextPinnedNodeIds.clear();

    this._viewport = {
      x: state.viewport?.x ?? 0,
      y: state.viewport?.y ?? 0,
      scale: state.viewport?.scale ?? 1,
    };

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
        if (this.nodes.has(pinId)) this._contextPinnedNodeIds.add(pinId);
      }
    }
  }

  private readResolvedSnapshot(idOrName: string): {
    snapshot: CanvasSnapshot;
    state: PersistedCanvasState;
  } | null {
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
    const dir = this.snapshotsDir;
    if (!dir) return null;

    const id = `snap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const snapshot: CanvasSnapshot = {
      id,
      name,
      createdAt: new Date().toISOString(),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
    };

    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const payload = this.externalizePersistedStateBlobs({
        version: 1,
        snapshot,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        annotations: Array.from(this.annotations.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
      });
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload, null, 2), 'utf-8');
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
    const dir = this.snapshotsDir;
    if (!dir || !existsSync(dir)) return [];

    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
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
      viewport: structuredClone(this._viewport),
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(node)),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: Array.from(this.annotations.values(), (annotation) => structuredClone(annotation)),
      contextPins: Array.from(this._contextPinnedNodeIds),
    });
    const nextState: PersistedCanvasState = {
      version: 1,
      viewport: structuredClone(resolved.state.viewport),
      nodes: Array.isArray(resolved.state.nodes) ? resolved.state.nodes.map((node) => structuredClone(node)) : [],
      edges: Array.isArray(resolved.state.edges) ? resolved.state.edges.map((edge) => structuredClone(edge)) : [],
      annotations: Array.isArray(resolved.state.annotations) ? resolved.state.annotations.map((annotation) => structuredClone(annotation)) : [],
      contextPins: Array.isArray(resolved.state.contextPins) ? [...resolved.state.contextPins] : [],
    };

    try {
      this.applyPersistedState(nextState);
      this.scheduleSave();
      this.notifyChange('nodes');
      this.notifyChange('pins');
      this.recordMutation({
        operationType: 'restoreSnapshot',
        description: `Restored snapshot "${resolved.snapshot.name}"`,
        forward: this.suppressed(() => {
          this.applyPersistedState(nextState);
          this.scheduleSave();
          this.notifyChange('nodes');
          this.notifyChange('pins');
        }),
        inverse: this.suppressed(() => {
          this.applyPersistedState(previousState);
          this.scheduleSave();
          this.notifyChange('nodes');
          this.notifyChange('pins');
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
  getSnapshotData(idOrName: string): { name: string; nodes: CanvasNodeState[]; edges: CanvasEdge[]; annotations: CanvasAnnotation[] } | null {
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
      nodes: Array.isArray(state.nodes) ? state.nodes.map((node) => structuredClone(node)) : [],
      edges: Array.isArray(state.edges) ? state.edges.map((edge) => structuredClone(edge)) : [],
      annotations: Array.isArray(state.annotations) ? state.annotations.map((annotation) => structuredClone(annotation)) : [],
    };
  }

  /** Delete a snapshot. */
  deleteSnapshot(id: string): boolean {
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

  // ── Node CRUD ──────────────────────────────────────────────

  get viewport(): ViewportState {
    return structuredClone(this._viewport);
  }

  addNode(node: CanvasNodeState): void {
    const cloned = structuredClone(this.normalizeNode(node));
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
    const oldSnapshot = structuredClone(existing);
    if (existing.type === 'group' && patch.position) {
      this.translateGroupChildren(
        id,
        patch.position.x - existing.position.x,
        patch.position.y - existing.position.y,
      );
    }
    const nextNode = this.normalizeNode({ ...existing, ...patch });
    this.nodes.set(id, nextNode);
    const parentGroupId = existing.data.parentGroup as string | undefined;
    if (parentGroupId) {
      if (patch.size) {
        this.compactGroupChildren(parentGroupId);
      } else {
        this.recomputeParentGroupBounds(parentGroupId);
      }
      this.reflowAllGroups();
    }
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'updateNode',
      description: `Updated node "${(existing.data.title as string) ?? id}"`,
      forward: this.suppressed(() => this.updateNode(id, structuredClone(patch))),
      inverse: this.suppressed(() => { this.nodes.set(id, structuredClone(oldSnapshot)); this.scheduleSave(); this.notifyChange('nodes'); }),
    });
  }

  removeNode(id: string): void {
    const existing = this.nodes.get(id);
    const connectedEdges = existing ? this.getEdgesForNode(id).map((e) => structuredClone(e)) : [];
    const cloned = existing ? structuredClone(existing) : null;

    // Prune from parent group's children list
    if (existing) {
      const parentGroupId = existing.data.parentGroup as string | undefined;
      if (parentGroupId) {
        const parent = this.nodes.get(parentGroupId);
        if (parent && parent.type === 'group') {
          const children = (parent.data.children as string[]) ?? [];
          const pruned = children.filter((cid) => cid !== id);
          this.nodes.set(parentGroupId, { ...parent, data: { ...parent.data, children: pruned } });
        }
      }
      // If removing a group, clear parentGroup on all its children
      if (existing.type === 'group') {
        const childIds = (existing.data.children as string[]) ?? [];
        for (const cid of childIds) {
          const child = this.nodes.get(cid);
          if (!child) continue;
          const d = { ...child.data };
          delete d.parentGroup;
          this.nodes.set(cid, { ...child, data: d });
        }
      }
    }

    this.nodes.delete(id);
    this.removeEdgesForNode(id);
    this._contextPinnedNodeIds.delete(id);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
    if (cloned) {
      this.recordMutation({
        operationType: 'removeNode',
        description: `Removed ${cloned.type} node "${(cloned.data.title as string) ?? id}"`,
        forward: this.suppressed(() => this.removeNode(id)),
        inverse: this.suppressed(() => {
          this.addNode(structuredClone(cloned));
          for (const edge of connectedEdges) this.addEdge(structuredClone(edge));
        }),
      });
    }
  }

  getNode(id: string): CanvasNodeState | undefined {
    const node = this.nodes.get(id);
    return node ? structuredClone(this.resolveNodeDataBlobs(node)) : undefined;
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
      viewport: structuredClone(this._viewport),
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(node)),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: this.getAnnotations(),
    };
  }

  getLayoutForPersistence(): CanvasLayout {
    return {
      viewport: structuredClone(this._viewport),
      nodes: Array.from(this.nodes.values(), (node) => structuredClone(this.externalizeNodeDataBlobs(node))),
      edges: Array.from(this.edges.values(), (edge) => structuredClone(edge)),
      annotations: this.getAnnotations(),
    };
  }

  applyUpdates(updates: CanvasNodeUpdate[]): { applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    const touchedParentGroups = new Map<string, { compact: boolean }>();
    const oldSnapshots = new Map<string, CanvasNodeState>();
    const appliedUpdates: CanvasNodeUpdate[] = [];
    const explicitPositionUpdateIds = new Set(
      updates
        .filter((update) => update.position !== undefined)
        .map((update) => update.id),
    );

    for (const update of updates) {
      const existing = this.nodes.get(update.id);
      if (!existing) {
        skipped++;
        continue;
      }
      const nextPatch: Partial<CanvasNodeState> = {};
      if (
        update.position &&
        (update.position.x !== existing.position.x || update.position.y !== existing.position.y)
      ) {
        nextPatch.position = update.position;
      }
      if (
        update.size &&
        (update.size.width !== existing.size.width || update.size.height !== existing.size.height)
      ) {
        nextPatch.size = update.size;
      }
      if (update.collapsed !== undefined && update.collapsed !== existing.collapsed) {
        nextPatch.collapsed = update.collapsed;
      }
      if (update.dockPosition !== undefined && update.dockPosition !== existing.dockPosition) {
        nextPatch.dockPosition = update.dockPosition;
      }
      if (Object.keys(nextPatch).length === 0) {
        skipped++;
        continue;
      }
      oldSnapshots.set(update.id, structuredClone(existing));
      appliedUpdates.push({ id: update.id, ...structuredClone(nextPatch) });
      if (existing.type === 'group' && nextPatch.position) {
        this.translateGroupChildren(
          update.id,
          nextPatch.position.x - existing.position.x,
          nextPatch.position.y - existing.position.y,
          explicitPositionUpdateIds,
        );
      }
      this.nodes.set(update.id, this.normalizeNode({
        ...existing,
        ...nextPatch,
      }));
      const parentGroupId = existing.data.parentGroup as string | undefined;
      if (parentGroupId) {
        const entry = touchedParentGroups.get(parentGroupId) ?? { compact: false };
        entry.compact = entry.compact || nextPatch.size !== undefined;
        touchedParentGroups.set(parentGroupId, entry);
      }
      applied++;
    }

    for (const [groupId, entry] of touchedParentGroups) {
      if (entry.compact) {
        this.compactGroupChildren(groupId);
      } else {
        this.recomputeParentGroupBounds(groupId);
      }
    }
    if (touchedParentGroups.size > 0) this.reflowAllGroups();

    if (applied > 0) {
      this.scheduleSave();
      this.notifyChange('nodes');
      const inverseSnapshots = Array.from(oldSnapshots.entries()).map(([id, node]) => ({ id, node }));
      this.recordMutation({
        operationType: 'batch',
        description: formatBatchUpdateDescription(appliedUpdates),
        forward: this.suppressed(() => {
          this.applyUpdates(appliedUpdates.map((update) => structuredClone(update)));
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

  // ── Context pins ─────────────────────────────────────────────

  get contextPinnedNodeIds(): Set<string> {
    return new Set(this._contextPinnedNodeIds);
  }

  setContextPins(nodeIds: string[]): void {
    const oldPins = Array.from(this._contextPinnedNodeIds);
    this._contextPinnedNodeIds.clear();
    for (const id of nodeIds) {
      if (this.nodes.has(id)) {
        this._contextPinnedNodeIds.add(id);
      }
    }
    this.scheduleSave();
    this.notifyChange('pins');
    this.recordMutation({
      operationType: 'setPins',
      description: `Set context pins (${this._contextPinnedNodeIds.size} nodes)`,
      forward: this.suppressed(() => this.setContextPins([...nodeIds])),
      inverse: this.suppressed(() => this.setContextPins(oldPins)),
    });
  }

  clearContextPins(): void {
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
    this.nodes.set(groupId, { ...group, data: { ...group.data, children: merged } });
    for (const id of validIds) {
      const child = this.nodes.get(id)!;
      this.nodes.set(id, { ...child, data: { ...child.data, parentGroup: groupId } });
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
        if (g) this.nodes.set(groupId, { ...g, data: { ...g.data, children: oldChildren } });
        for (const [id, oldParent] of oldParents) {
          const c = this.nodes.get(id);
          if (!c) continue;
          const d = { ...c.data };
          if (oldParent) d.parentGroup = oldParent; else delete d.parentGroup;
          this.nodes.set(id, { ...c, data: d });
        }
        this.scheduleSave();
        this.notifyChange('nodes');
      }),
    });
    return true;
  }

  /** Remove all children from a group, clearing their parentGroup. */
  ungroupNodes(groupId: string): boolean {
    const group = this.nodes.get(groupId);
    if (!group || group.type !== 'group') return false;

    const childIds = (group.data.children as string[]) ?? [];
    if (childIds.length === 0) return false;

    const snapshot = childIds.slice();

    // Clear children from group
    this.nodes.set(groupId, { ...group, data: { ...group.data, children: [] } });
    // Clear parentGroup from each child
    for (const id of childIds) {
      const child = this.nodes.get(id);
      if (!child) continue;
      const d = { ...child.data };
      delete d.parentGroup;
      this.nodes.set(id, { ...child, data: d });
    }

    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'ungroupNodes',
      description: `Ungrouped ${childIds.length} nodes from "${(group.data.title as string) ?? groupId}"`,
      forward: this.suppressed(() => this.ungroupNodes(groupId)),
      inverse: this.suppressed(() => this.groupNodes(groupId, snapshot)),
    });
    return true;
  }

  clear(): void {
    const oldNodes = Array.from(this.nodes.values()).map((n) => structuredClone(n));
    const oldEdges = Array.from(this.edges.values()).map((e) => structuredClone(e));
    const oldAnnotations = Array.from(this.annotations.values()).map((annotation) => structuredClone(annotation));
    const oldPins = Array.from(this._contextPinnedNodeIds);
    const oldViewport = { ...this._viewport };
    this.nodes.clear();
    this.edges.clear();
    this.annotations.clear();
    this._contextPinnedNodeIds.clear();
    this._viewport = { x: 0, y: 0, scale: 1 };
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.recordMutation({
      operationType: 'clear',
      description: `Cleared canvas (was ${oldNodes.length} nodes, ${oldEdges.length} edges)`,
      forward: this.suppressed(() => this.clear()),
      inverse: this.suppressed(() => {
        for (const n of oldNodes) this.addNode(structuredClone(n));
        for (const e of oldEdges) this.addEdge(structuredClone(e));
        for (const annotation of oldAnnotations) this.addAnnotation(structuredClone(annotation));
        this.setContextPins(oldPins);
        this.setViewport(oldViewport);
      }),
    });
  }
}

// Module-level singleton — safe because Bun is single-threaded and this
// module is imported once per process. Agent tools and the HTTP server share
// the same instance; no locking needed.
export const canvasState = new CanvasStateManager();
