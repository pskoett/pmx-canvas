/**
 * Canvas Mutation History — Time Travel for PMX Canvas
 *
 * Records every canvas mutation in an in-memory ring buffer with forward/inverse
 * closures for undo/redo. Provides a human-readable history timeline and
 * snapshot diff capabilities.
 *
 * Design decisions:
 * - In-memory only (not persisted) — history is session-scoped
 * - Ring buffer caps at 200 entries to bound memory
 * - forward/inverse closures capture cloned state at record time
 * - _replaying flag prevents undo/redo from recording new entries
 */

import type { CanvasNodeState, CanvasEdge, CanvasLayout } from './canvas-state.js';

// ── Types ────────────────────────────────────────────────────────────

export type MutationOp =
  | 'addNode'
  | 'updateNode'
  | 'removeNode'
  | 'addEdge'
  | 'removeEdge'
  | 'clear'
  | 'arrange'
  | 'restoreSnapshot'
  | 'setPins'
  | 'batch'
  | 'groupNodes'
  | 'ungroupNodes';

export interface MutationEntry {
  id: string;
  timestamp: string;
  description: string;
  operationType: MutationOp;
  forward: () => void;
  inverse: () => void;
}

export interface MutationSummary {
  id: string;
  timestamp: string;
  description: string;
  operationType: MutationOp;
  isCurrent: boolean;
  isUndone: boolean;
}

export interface SnapshotDiffResult {
  snapshotName: string;
  addedNodes: { id: string; type: string; title: string | null }[];
  removedNodes: { id: string; type: string; title: string | null }[];
  modifiedNodes: {
    id: string;
    type: string;
    title: string | null;
    changes: string[];
  }[];
  addedEdges: { id: string; from: string; to: string; type: string }[];
  removedEdges: { id: string; from: string; to: string; type: string }[];
}

// ── Ring Buffer ──────────────────────────────────────────────────────

const MAX_ENTRIES = 200;

class MutationHistory {
  private entries: MutationEntry[] = [];
  /** Index of the last applied mutation. -1 means nothing applied / all undone. */
  private cursor = -1;
  /** When true, mutations triggered by undo/redo are not recorded. */
  private _replaying = false;

  get isReplaying(): boolean {
    return this._replaying;
  }

  /**
   * Record a new mutation. Truncates any redo-able future, then appends.
   * If called while replaying (undo/redo), the call is silently ignored.
   */
  record(entry: Omit<MutationEntry, 'id' | 'timestamp'>): void {
    if (this._replaying) return;

    const full: MutationEntry = {
      ...entry,
      id: `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };

    // Truncate redo future
    this.entries.length = this.cursor + 1;
    this.entries.push(full);

    // Evict oldest if over capacity
    if (this.entries.length > MAX_ENTRIES) {
      const excess = this.entries.length - MAX_ENTRIES;
      this.entries.splice(0, excess);
    }

    this.cursor = this.entries.length - 1;
  }

  /** Undo the last applied mutation. Returns the entry that was undone, or null. */
  undo(): MutationEntry | null {
    if (this.cursor < 0) return null;

    const entry = this.entries[this.cursor];
    this._replaying = true;
    try {
      entry.inverse();
    } finally {
      this._replaying = false;
    }
    this.cursor--;
    return entry;
  }

  /** Redo the next undone mutation. Returns the entry that was redone, or null. */
  redo(): MutationEntry | null {
    if (this.cursor >= this.entries.length - 1) return null;

    this.cursor++;
    const entry = this.entries[this.cursor];
    this._replaying = true;
    try {
      entry.forward();
    } finally {
      this._replaying = false;
    }
    return entry;
  }

  canUndo(): boolean {
    return this.cursor >= 0;
  }

  canRedo(): boolean {
    return this.cursor < this.entries.length - 1;
  }

  /** Get all entries with current/undone status for display. */
  getSummaries(): MutationSummary[] {
    return this.entries.map((e, i) => ({
      id: e.id,
      timestamp: e.timestamp,
      description: e.description,
      operationType: e.operationType,
      isCurrent: i === this.cursor,
      isUndone: i > this.cursor,
    }));
  }

  /** Human-readable timeline for the canvas://history resource. */
  toHumanReadable(): string {
    if (this.entries.length === 0) {
      return 'Canvas History: empty (no mutations recorded this session)';
    }

    const lines: string[] = [
      `Canvas History (${this.entries.length} mutations, position ${this.cursor + 1}/${this.entries.length})`,
      '',
    ];

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const ts = new Date(e.timestamp);
      const time = ts.toLocaleTimeString('en-US', { hour12: false });
      const marker = i === this.cursor ? ' <<< current' : i > this.cursor ? '  (undone)' : '';
      lines.push(`  #${i + 1}  [${time}] ${e.description}${marker}`);
    }

    lines.push('');
    lines.push(`Can undo: ${this.canUndo() ? 'yes' : 'no'} | Can redo: ${this.canRedo() ? 'yes' : 'no'}`);

    return lines.join('\n');
  }

  /** Number of recorded entries. */
  get length(): number {
    return this.entries.length;
  }

  /** Clear all recorded mutations. Useful for isolated test runs. */
  reset(): void {
    this.entries = [];
    this.cursor = -1;
    this._replaying = false;
  }
}

// ── Diff Logic ───────────────────────────────────────────────────────

/**
 * Compare two canvas layouts and produce a structured diff.
 */
export function diffLayouts(
  snapshotName: string,
  snapshotLayout: { nodes: CanvasNodeState[]; edges: CanvasEdge[] },
  currentLayout: { nodes: CanvasNodeState[]; edges: CanvasEdge[] },
): SnapshotDiffResult {
  const snapNodes = new Map(snapshotLayout.nodes.map((n) => [n.id, n]));
  const curNodes = new Map(currentLayout.nodes.map((n) => [n.id, n]));
  const snapEdges = new Map(snapshotLayout.edges.map((e) => [e.id, e]));
  const curEdges = new Map(currentLayout.edges.map((e) => [e.id, e]));

  const addedNodes: SnapshotDiffResult['addedNodes'] = [];
  const removedNodes: SnapshotDiffResult['removedNodes'] = [];
  const modifiedNodes: SnapshotDiffResult['modifiedNodes'] = [];

  // Nodes added (in current but not snapshot)
  for (const [id, node] of curNodes) {
    if (!snapNodes.has(id)) {
      addedNodes.push({ id, type: node.type, title: (node.data.title as string) ?? null });
    }
  }

  // Nodes removed (in snapshot but not current)
  for (const [id, node] of snapNodes) {
    if (!curNodes.has(id)) {
      removedNodes.push({ id, type: node.type, title: (node.data.title as string) ?? null });
    }
  }

  // Nodes modified (in both, check for differences)
  for (const [id, curNode] of curNodes) {
    const snapNode = snapNodes.get(id);
    if (!snapNode) continue;

    const changes: string[] = [];

    if (snapNode.position.x !== curNode.position.x || snapNode.position.y !== curNode.position.y) {
      changes.push(`moved (${snapNode.position.x},${snapNode.position.y}) → (${curNode.position.x},${curNode.position.y})`);
    }
    if (snapNode.size.width !== curNode.size.width || snapNode.size.height !== curNode.size.height) {
      changes.push(`resized ${snapNode.size.width}x${snapNode.size.height} → ${curNode.size.width}x${curNode.size.height}`);
    }
    if (snapNode.collapsed !== curNode.collapsed) {
      changes.push(curNode.collapsed ? 'collapsed' : 'expanded');
    }

    const snapTitle = (snapNode.data.title as string) ?? '';
    const curTitle = (curNode.data.title as string) ?? '';
    if (snapTitle !== curTitle) {
      changes.push(`title: "${snapTitle}" → "${curTitle}"`);
    }

    const snapContent = (snapNode.data.content as string) ?? '';
    const curContent = (curNode.data.content as string) ?? '';
    if (snapContent !== curContent) {
      const lenDiff = curContent.length - snapContent.length;
      changes.push(`content changed (${lenDiff >= 0 ? '+' : ''}${lenDiff} chars)`);
    }

    if (changes.length > 0) {
      modifiedNodes.push({
        id,
        type: curNode.type,
        title: (curNode.data.title as string) ?? null,
        changes,
      });
    }
  }

  // Edges
  const addedEdges: SnapshotDiffResult['addedEdges'] = [];
  const removedEdges: SnapshotDiffResult['removedEdges'] = [];

  for (const [id, edge] of curEdges) {
    if (!snapEdges.has(id)) {
      addedEdges.push({ id, from: edge.from, to: edge.to, type: edge.type });
    }
  }
  for (const [id, edge] of snapEdges) {
    if (!curEdges.has(id)) {
      removedEdges.push({ id, from: edge.from, to: edge.to, type: edge.type });
    }
  }

  return { snapshotName, addedNodes, removedNodes, modifiedNodes, addedEdges, removedEdges };
}

/**
 * Format a diff result as human-readable text for MCP.
 */
export function formatDiff(diff: SnapshotDiffResult): string {
  const lines: string[] = [`Diff: current canvas vs snapshot "${diff.snapshotName}"`, ''];

  const total = diff.addedNodes.length + diff.removedNodes.length + diff.modifiedNodes.length
    + diff.addedEdges.length + diff.removedEdges.length;

  if (total === 0) {
    lines.push('No differences — canvas matches the snapshot exactly.');
    return lines.join('\n');
  }

  if (diff.addedNodes.length > 0) {
    lines.push(`Added nodes (${diff.addedNodes.length}):`);
    for (const n of diff.addedNodes) {
      lines.push(`  + [${n.type}] ${n.title ?? n.id}`);
    }
    lines.push('');
  }

  if (diff.removedNodes.length > 0) {
    lines.push(`Removed nodes (${diff.removedNodes.length}):`);
    for (const n of diff.removedNodes) {
      lines.push(`  - [${n.type}] ${n.title ?? n.id}`);
    }
    lines.push('');
  }

  if (diff.modifiedNodes.length > 0) {
    lines.push(`Modified nodes (${diff.modifiedNodes.length}):`);
    for (const n of diff.modifiedNodes) {
      lines.push(`  ~ [${n.type}] ${n.title ?? n.id}`);
      for (const c of n.changes) {
        lines.push(`      ${c}`);
      }
    }
    lines.push('');
  }

  if (diff.addedEdges.length > 0) {
    lines.push(`Added edges (${diff.addedEdges.length}):`);
    for (const e of diff.addedEdges) {
      lines.push(`  + ${e.type}: ${e.from} → ${e.to}`);
    }
    lines.push('');
  }

  if (diff.removedEdges.length > 0) {
    lines.push(`Removed edges (${diff.removedEdges.length}):`);
    for (const e of diff.removedEdges) {
      lines.push(`  - ${e.type}: ${e.from} → ${e.to}`);
    }
    lines.push('');
  }

  lines.push(`Summary: +${diff.addedNodes.length} -${diff.removedNodes.length} ~${diff.modifiedNodes.length} nodes, +${diff.addedEdges.length} -${diff.removedEdges.length} edges`);

  return lines.join('\n');
}

// ── Singleton ────────────────────────────────────────────────────────

export const mutationHistory = new MutationHistory();
