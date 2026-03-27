/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 *
 * Persistence: canvas state auto-saves to `.pmx-canvas.json` in the workspace
 * root on every mutation (debounced). Auto-loads on `loadFromDisk()`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CANVAS_STATE_FILENAME = '.pmx-canvas.json';
const SNAPSHOTS_DIR = '.pmx-canvas-snapshots';
const SAVE_DEBOUNCE_MS = 500;

interface PersistedCanvasState {
  version: number;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  contextPins: string[];
}

export interface CanvasSnapshot {
  id: string;
  name: string;
  createdAt: string;
  nodeCount: number;
  edgeCount: number;
}

export interface CanvasNodeState {
  id: string;
  type: 'markdown' | 'mcp-app' | 'status' | 'context' | 'ledger' | 'trace' | 'file';
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

export interface CanvasLayout {
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
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
  operationType: string;
  description: string;
  forward: () => void;
  inverse: () => void;
}

class CanvasStateManager {
  private nodes = new Map<string, CanvasNodeState>();
  private edges = new Map<string, CanvasEdge>();
  private _viewport: ViewportState = { x: 0, y: 0, scale: 1 };
  private _contextPinnedNodeIds = new Set<string>();

  // ── Change listeners (for MCP resource notifications) ──────
  private _changeListeners: ((type: CanvasChangeType) => void)[] = [];

  /** Register a listener for state changes. Used by MCP server to emit resource notifications. */
  onChange(cb: (type: CanvasChangeType) => void): void {
    this._changeListeners.push(cb);
  }

  private notifyChange(type: CanvasChangeType): void {
    for (const cb of this._changeListeners) {
      try { cb(type); } catch { /* listener errors are non-fatal */ }
    }
  }

  // ── Mutation recorder (for undo/redo history) ─────────────
  private _mutationRecorder: ((info: MutationRecordInfo) => void) | null = null;
  /** When true, mutating methods skip the recorder (used during undo/redo replay). */
  _suppressRecording = false;

  /** Register a mutation recorder. Used by mutation-history to capture undo/redo closures. */
  onMutation(cb: (info: MutationRecordInfo) => void): void {
    this._mutationRecorder = cb;
  }

  private recordMutation(info: MutationRecordInfo): void {
    if (this._suppressRecording || !this._mutationRecorder) return;
    try { this._mutationRecorder(info); } catch { /* non-fatal */ }
  }

  // ── Persistence ────────────────────────────────────────────
  private _stateFilePath: string | null = null;
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Set the workspace root to enable auto-persistence. */
  setWorkspaceRoot(workspaceRoot: string): void {
    const override = (process.env.PMX_CANVAS_STATE_FILE ?? '').trim();
    this._stateFilePath = override || join(workspaceRoot, CANVAS_STATE_FILENAME);
  }

  /** Load canvas state from disk. Call once on server startup. */
  loadFromDisk(): boolean {
    if (!this._stateFilePath || !existsSync(this._stateFilePath)) return false;
    try {
      const raw = readFileSync(this._stateFilePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedCanvasState;
      if (!parsed || parsed.version !== 1) return false;

      // Restore viewport
      if (parsed.viewport) {
        this._viewport = {
          x: parsed.viewport.x ?? 0,
          y: parsed.viewport.y ?? 0,
          scale: parsed.viewport.scale ?? 1,
        };
      }

      // Restore nodes
      if (Array.isArray(parsed.nodes)) {
        for (const node of parsed.nodes) {
          if (node && typeof node.id === 'string') {
            this.nodes.set(node.id, node);
          }
        }
      }

      // Restore edges
      if (Array.isArray(parsed.edges)) {
        for (const edge of parsed.edges) {
          if (edge && typeof edge.id === 'string') {
            this.edges.set(edge.id, edge);
          }
        }
      }

      // Restore context pins (only for nodes that exist)
      if (Array.isArray(parsed.contextPins)) {
        for (const id of parsed.contextPins) {
          if (this.nodes.has(id)) {
            this._contextPinnedNodeIds.add(id);
          }
        }
      }

      return true;
    } catch {
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

  /** Write current state to disk immediately. */
  private saveToDisk(): void {
    if (!this._stateFilePath) return;
    try {
      const dir = dirname(this._stateFilePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const payload: PersistedCanvasState = {
        version: 1,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
      };
      writeFileSync(this._stateFilePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Persistence failures are non-fatal — runtime continues.
    }
  }

  // ── Snapshots ───────────────────────────────────────────────

  private get snapshotsDir(): string | null {
    if (!this._stateFilePath) return null;
    return join(dirname(this._stateFilePath), SNAPSHOTS_DIR);
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

      const payload: PersistedCanvasState & { snapshot: CanvasSnapshot } = {
        version: 1,
        snapshot,
        viewport: this._viewport,
        nodes: Array.from(this.nodes.values()),
        edges: Array.from(this.edges.values()),
        contextPins: Array.from(this._contextPinnedNodeIds),
      };
      writeFileSync(join(dir, `${id}.json`), JSON.stringify(payload, null, 2), 'utf-8');
      return snapshot;
    } catch {
      return null;
    }
  }

  /** List all saved snapshots. */
  listSnapshots(): CanvasSnapshot[] {
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
        } catch { /* skip corrupt files */ }
      }
      return snapshots.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  /** Restore canvas state from a snapshot. */
  restoreSnapshot(id: string): boolean {
    const dir = this.snapshotsDir;
    if (!dir) return false;

    const filePath = join(dir, `${id}.json`);
    if (!existsSync(filePath)) return false;

    try {
      const raw = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as PersistedCanvasState;
      if (!parsed || parsed.version !== 1) return false;

      // Clear current state
      this.nodes.clear();
      this.edges.clear();
      this._contextPinnedNodeIds.clear();

      // Restore from snapshot
      if (parsed.viewport) {
        this._viewport = {
          x: parsed.viewport.x ?? 0,
          y: parsed.viewport.y ?? 0,
          scale: parsed.viewport.scale ?? 1,
        };
      }
      if (Array.isArray(parsed.nodes)) {
        for (const node of parsed.nodes) {
          if (node?.id) this.nodes.set(node.id, node);
        }
      }
      if (Array.isArray(parsed.edges)) {
        for (const edge of parsed.edges) {
          if (edge?.id) this.edges.set(edge.id, edge);
        }
      }
      if (Array.isArray(parsed.contextPins)) {
        for (const pinId of parsed.contextPins) {
          if (this.nodes.has(pinId)) this._contextPinnedNodeIds.add(pinId);
        }
      }

      this.scheduleSave();
      this.notifyChange('nodes');
      this.notifyChange('pins');
      return true;
    } catch {
      return false;
    }
  }

  /** Read a snapshot's data without restoring it (for diff). Resolves by ID or name. */
  getSnapshotData(idOrName: string): { name: string; nodes: CanvasNodeState[]; edges: CanvasEdge[] } | null {
    const dir = this.snapshotsDir;
    if (!dir || !existsSync(dir)) return null;

    // Try direct ID first
    const directPath = join(dir, `${idOrName}.json`);
    if (existsSync(directPath)) {
      try {
        const raw = readFileSync(directPath, 'utf-8');
        const parsed = JSON.parse(raw) as PersistedCanvasState & { snapshot?: CanvasSnapshot };
        return { name: parsed.snapshot?.name ?? idOrName, nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
      } catch { return null; }
    }

    // Search by name
    try {
      const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = readFileSync(join(dir, file), 'utf-8');
          const parsed = JSON.parse(raw) as PersistedCanvasState & { snapshot?: CanvasSnapshot };
          if (parsed.snapshot?.name === idOrName || parsed.snapshot?.id === idOrName) {
            return { name: parsed.snapshot.name, nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
          }
        } catch { /* skip */ }
      }
    } catch { /* skip */ }

    return null;
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
    } catch {
      return false;
    }
  }

  // ── Node CRUD ──────────────────────────────────────────────

  get viewport(): ViewportState {
    return this._viewport;
  }

  addNode(node: CanvasNodeState): void {
    const cloned = structuredClone(node);
    this.nodes.set(node.id, node);
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'addNode',
      description: `Added ${node.type} node "${(node.data.title as string) ?? node.id}"`,
      forward: () => { this._suppressRecording = true; try { this.addNode(structuredClone(cloned)); } finally { this._suppressRecording = false; } },
      inverse: () => { this._suppressRecording = true; try { this.removeNode(node.id); } finally { this._suppressRecording = false; } },
    });
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    const existing = this.nodes.get(id);
    if (!existing) return;
    const oldSnapshot = structuredClone(existing);
    this.nodes.set(id, { ...existing, ...patch });
    this.scheduleSave();
    this.notifyChange('nodes');
    this.recordMutation({
      operationType: 'updateNode',
      description: `Updated node "${(existing.data.title as string) ?? id}"`,
      forward: () => { this._suppressRecording = true; try { this.updateNode(id, structuredClone(patch)); } finally { this._suppressRecording = false; } },
      inverse: () => { this._suppressRecording = true; try { this.nodes.set(id, structuredClone(oldSnapshot)); this.scheduleSave(); this.notifyChange('nodes'); } finally { this._suppressRecording = false; } },
    });
  }

  removeNode(id: string): void {
    const existing = this.nodes.get(id);
    const connectedEdges = existing ? this.getEdgesForNode(id).map((e) => structuredClone(e)) : [];
    const cloned = existing ? structuredClone(existing) : null;
    this.nodes.delete(id);
    this.removeEdgesForNode(id);
    this.scheduleSave();
    this.notifyChange('nodes');
    if (cloned) {
      this.recordMutation({
        operationType: 'removeNode',
        description: `Removed ${cloned.type} node "${(cloned.data.title as string) ?? id}"`,
        forward: () => { this._suppressRecording = true; try { this.removeNode(id); } finally { this._suppressRecording = false; } },
        inverse: () => {
          this._suppressRecording = true;
          try {
            this.addNode(structuredClone(cloned));
            for (const edge of connectedEdges) this.addEdge(structuredClone(edge));
          } finally { this._suppressRecording = false; }
        },
      });
    }
  }

  getNode(id: string): CanvasNodeState | undefined {
    return this.nodes.get(id);
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
      forward: () => { this._suppressRecording = true; try { this.addEdge(structuredClone(cloned)); } finally { this._suppressRecording = false; } },
      inverse: () => { this._suppressRecording = true; try { this.removeEdge(edge.id); } finally { this._suppressRecording = false; } },
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
        forward: () => { this._suppressRecording = true; try { this.removeEdge(id); } finally { this._suppressRecording = false; } },
        inverse: () => { this._suppressRecording = true; try { this.addEdge(structuredClone(cloned)); } finally { this._suppressRecording = false; } },
      });
    }
    return removed;
  }

  getEdges(): CanvasEdge[] {
    return Array.from(this.edges.values());
  }

  getEdgesForNode(nodeId: string): CanvasEdge[] {
    return Array.from(this.edges.values()).filter((e) => e.from === nodeId || e.to === nodeId);
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
      viewport: this._viewport,
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
    };
  }

  applyUpdates(updates: CanvasNodeUpdate[]): { applied: number; skipped: number } {
    let applied = 0;
    let skipped = 0;
    for (const update of updates) {
      const existing = this.nodes.get(update.id);
      if (!existing) {
        skipped++;
        continue;
      }
      this.nodes.set(update.id, {
        ...existing,
        ...(update.position && { position: update.position }),
        ...(update.size && { size: update.size }),
        ...(update.collapsed !== undefined && { collapsed: update.collapsed }),
        ...(update.dockPosition !== undefined && { dockPosition: update.dockPosition }),
      });
      applied++;
    }
    if (applied > 0) this.scheduleSave();
    return { applied, skipped };
  }

  setViewport(v: Partial<ViewportState>): void {
    this._viewport = { ...this._viewport, ...v };
    this.scheduleSave();
  }

  // ── Context pins ─────────────────────────────────────────────

  get contextPinnedNodeIds(): Set<string> {
    return this._contextPinnedNodeIds;
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
      forward: () => { this._suppressRecording = true; try { this.setContextPins([...nodeIds]); } finally { this._suppressRecording = false; } },
      inverse: () => { this._suppressRecording = true; try { this.setContextPins(oldPins); } finally { this._suppressRecording = false; } },
    });
  }

  clearContextPins(): void {
    this._contextPinnedNodeIds.clear();
    this.scheduleSave();
    this.notifyChange('pins');
  }

  clear(): void {
    const oldNodes = Array.from(this.nodes.values()).map((n) => structuredClone(n));
    const oldEdges = Array.from(this.edges.values()).map((e) => structuredClone(e));
    const oldPins = Array.from(this._contextPinnedNodeIds);
    const oldViewport = { ...this._viewport };
    this.nodes.clear();
    this.edges.clear();
    this._contextPinnedNodeIds.clear();
    this._viewport = { x: 0, y: 0, scale: 1 };
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
    this.recordMutation({
      operationType: 'clear',
      description: `Cleared canvas (was ${oldNodes.length} nodes, ${oldEdges.length} edges)`,
      forward: () => { this._suppressRecording = true; try { this.clear(); } finally { this._suppressRecording = false; } },
      inverse: () => {
        this._suppressRecording = true;
        try {
          for (const n of oldNodes) this.addNode(structuredClone(n));
          for (const e of oldEdges) this.addEdge(structuredClone(e));
          this.setContextPins(oldPins);
          this.setViewport(oldViewport);
        } finally { this._suppressRecording = false; }
      },
    });
  }
}

// Module-level singleton — safe because Bun is single-threaded and this
// module is imported once per process. Agent tools and the HTTP server share
// the same instance; no locking needed.
export const canvasState = new CanvasStateManager();
