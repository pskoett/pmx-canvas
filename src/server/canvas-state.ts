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

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const CANVAS_STATE_FILENAME = '.pmx-canvas.json';
const SAVE_DEBOUNCE_MS = 500;

interface PersistedCanvasState {
  version: number;
  viewport: ViewportState;
  nodes: CanvasNodeState[];
  edges: CanvasEdge[];
  contextPins: string[];
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

  // ── Node CRUD ──────────────────────────────────────────────

  get viewport(): ViewportState {
    return this._viewport;
  }

  addNode(node: CanvasNodeState): void {
    this.nodes.set(node.id, node);
    this.scheduleSave();
    this.notifyChange('nodes');
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    const existing = this.nodes.get(id);
    if (!existing) return;
    this.nodes.set(id, { ...existing, ...patch });
    this.scheduleSave();
    this.notifyChange('nodes');
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.removeEdgesForNode(id);
    this.scheduleSave();
    this.notifyChange('nodes');
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
    this.edges.set(edge.id, edge);
    this.scheduleSave();
    this.notifyChange('nodes');
    return true;
  }

  removeEdge(id: string): boolean {
    const removed = this.edges.delete(id);
    if (removed) {
      this.scheduleSave();
      this.notifyChange('nodes');
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
    this._contextPinnedNodeIds.clear();
    for (const id of nodeIds) {
      if (this.nodes.has(id)) {
        this._contextPinnedNodeIds.add(id);
      }
    }
    this.scheduleSave();
    this.notifyChange('pins');
  }

  clearContextPins(): void {
    this._contextPinnedNodeIds.clear();
    this.scheduleSave();
    this.notifyChange('pins');
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this._contextPinnedNodeIds.clear();
    this._viewport = { x: 0, y: 0, scale: 1 };
    this.scheduleSave();
    this.notifyChange('nodes');
    this.notifyChange('pins');
  }
}

// Module-level singleton — safe because Bun is single-threaded and this
// module is imported once per process. Agent tools and the HTTP server share
// the same instance; no locking needed.
export const canvasState = new CanvasStateManager();
