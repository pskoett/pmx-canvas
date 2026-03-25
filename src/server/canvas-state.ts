/**
 * Server-side canvas state manager.
 *
 * Maintains the authoritative node layout so that:
 * - Agent tools (Phase 3) can read/mutate canvas state
 * - Client syncs bidirectionally (SSE for server→client, POST for client→server)
 */

export interface CanvasNodeState {
  id: string;
  type: 'markdown' | 'mcp-app' | 'status' | 'context' | 'ledger' | 'trace' | 'prompt' | 'response';
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

class CanvasStateManager {
  private nodes = new Map<string, CanvasNodeState>();
  private edges = new Map<string, CanvasEdge>();
  private _viewport: ViewportState = { x: 0, y: 0, scale: 1 };
  private _contextPinnedNodeIds = new Set<string>();

  get viewport(): ViewportState {
    return this._viewport;
  }

  addNode(node: CanvasNodeState): void {
    this.nodes.set(node.id, node);
  }

  updateNode(id: string, patch: Partial<CanvasNodeState>): void {
    const existing = this.nodes.get(id);
    if (!existing) return;
    this.nodes.set(id, { ...existing, ...patch });
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
    this.removeEdgesForNode(id);
  }

  getNode(id: string): CanvasNodeState | undefined {
    return this.nodes.get(id);
  }

  // ── Edge CRUD ──────────────────────────────────────────────

  addEdge(edge: CanvasEdge): boolean {
    if (edge.from === edge.to) return false;
    // Reject duplicate same-type edges between same pair
    for (const existing of this.edges.values()) {
      if (existing.from === edge.from && existing.to === edge.to && existing.type === edge.type) {
        return false;
      }
    }
    this.edges.set(edge.id, edge);
    return true;
  }

  removeEdge(id: string): boolean {
    return this.edges.delete(id);
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
    return { applied, skipped };
  }

  setViewport(v: Partial<ViewportState>): void {
    this._viewport = { ...this._viewport, ...v };
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
  }

  clearContextPins(): void {
    this._contextPinnedNodeIds.clear();
  }

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this._contextPinnedNodeIds.clear();
    this._viewport = { x: 0, y: 0, scale: 1 };
  }
}

// Module-level singleton — safe because Bun is single-threaded and this
// module is imported once per process. Agent tools and the HTTP server share
// the same instance; no locking needed.
export const canvasState = new CanvasStateManager();
