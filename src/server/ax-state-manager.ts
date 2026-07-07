/**
 * AX state manager.
 *
 * Owns the agent-experience (AX) state that previously lived inline in
 * `CanvasStateManager`. Splits cleanly into the three documented partitions
 * (see `docs/ax-state-contract.md`):
 *
 *   • Canvas-bound (`_axState`): focus, work items, approval gates, review
 *     annotations, elicitations, mode requests, policy. Snapshotted, cleared by
 *     `canvas_view` (`clear` action), replaced by `restore`. Mutators record
 *     undo/redo history (via the injected `recordMutation` / `suppressed`
 *     callbacks).
 *   • Timeline (audit-only): agent events, evidence, steering. DB-direct, NOT in
 *     `_axState`, NOT history-recorded, NOT snapshotted, retention-bounded.
 *   • Host/session: a single host-capability row in its own table.
 *
 * `CanvasStateManager` holds one of these and DELEGATES its public AX methods to
 * it, so the SDK/HTTP/MCP surface is byte-stable. The manager takes injected
 * callbacks for everything it does not own: a node-id-validity provider (used by
 * normalization on write), the live DB handle, `scheduleSave`, `notifyChange`,
 * `recordMutation`, and a `suppressed` wrapper for history closures.
 */

import {
  appendAxEventToDB,
  appendAxEvidenceToDB,
  appendAxSteeringToDB,
  markAxSteeringDeliveredInDB,
  loadAxEventsFromDB,
  loadAxEvidenceFromDB,
  loadAxSteeringFromDB,
  loadPendingAxSteeringFromDB,
  loadNewestPendingAxSteeringFromDB,
  countPendingAxSteeringFromDB,
  loadAxTimelineSummaryFromDB,
  upsertAxHostCapabilityToDB,
  loadAxHostCapabilityFromDB,
  type AxTimelineQuery,
} from './canvas-db.js';
import {
  createEmptyAxState,
  createEmptyAxHostCapability,
  normalizeAxState,
  normalizeAxHostCapability,
  createAxWorkItem,
  createAxApprovalGate,
  createAxReviewAnnotation,
  createAxEvent,
  createAxEvidence,
  createAxSteeringMessage,
  createAxElicitation,
  createAxModeRequest,
  isAxCommand,
  listAxCommands,
  AX_COMMAND_REGISTRY,
  normalizeAxPolicy,
  mapAxActivityKindToEventKind,
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
import type { CanvasChangeType, MutationRecordInfo } from './canvas-state.js';

type Database = import('bun:sqlite').Database;

/** Host-environment hooks the AX manager needs from its owner (CanvasStateManager). */
export interface AxStateManagerDeps {
  /** Current valid node-id set — used by normalization on write to prune dangling refs. */
  getNodeIds(): Set<string>;
  /** Live DB handle for the timeline tables / host-capability table (null when no workspace). */
  getDb(): Database | null;
  /** Debounced save of the canvas-bound blob (timeline ops do NOT trigger this — they are DB-direct). */
  scheduleSave(): void;
  /** Emit a change notification (drives MCP resource notifications + blocking-wait endpoints). */
  notifyChange(type: CanvasChangeType): void;
  /** Record an undo/redo history entry. */
  recordMutation(info: MutationRecordInfo): void;
  /** Wrap a closure so it runs with mutation recording suppressed (for undo/redo replay). */
  suppressed(fn: () => void): () => void;
}

function replaceById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const copy = list.slice();
  copy[idx] = item;
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function logAxStateWarning(action: string, error: unknown, details?: Record<string, unknown>): void {
  console.warn(`[ax-state] ${action}`, { error, ...(details ?? {}) });
}

export class AxStateManager {
  private _axState: PmxAxState = createEmptyAxState();
  private _axHostCapability: PmxAxHostCapability | null = null;

  constructor(private readonly deps: AxStateManagerDeps) {}

  // ── Normalization (against the owner's current node set) ──────────
  private normalizeForCurrentNodes(state: unknown): PmxAxState {
    return normalizeAxState(state, this.deps.getNodeIds());
  }

  private applyAxState(state: PmxAxState): void {
    this._axState = this.normalizeForCurrentNodes(state);
  }

  // ── Load / snapshot / clear integration (called by CanvasStateManager) ──

  /** Reset the canvas-bound partition to empty (used by clear() and applyPersistedState()). */
  resetCanvasBound(): void {
    this._axState = createEmptyAxState();
  }

  /** Replace the canvas-bound partition from a persisted/restored blob, normalized against current nodes. */
  applyPersistedAx(ax: unknown): void {
    this._axState = this.normalizeForCurrentNodes(ax);
  }

  /** Load the host-capability row from its own table (own partition; not snapshotted). */
  loadHostCapabilityFromDb(): void {
    const db = this.deps.getDb();
    if (!db) return;
    try {
      this._axHostCapability = loadAxHostCapabilityFromDB(db);
    } catch (error) {
      logAxStateWarning('load host capability failed', error, {});
    }
  }

  /**
   * Re-normalize the canvas-bound partition against the current node set after a
   * node was removed, and report what the removal orphaned. Work items / approval
   * gates / elicitations / mode requests keep the item but strip the dangling node
   * id ("re-anchored"); node-anchored review annotations are dropped ("removed").
   * Returns the affected ids so the owner can record one audit timeline event.
   */
  revalidateAfterNodeRemoval(removedNodeId: string): {
    reanchoredIds: string[];
    removedReviewIds: string[];
    reanchoredFocus: boolean;
  } {
    const before = this._axState;
    const referencedNode = (ids: string[]): boolean => ids.includes(removedNodeId);
    const reanchoredIds: string[] = [];
    for (const w of before.workItems) if (referencedNode(w.nodeIds)) reanchoredIds.push(w.id);
    for (const g of before.approvalGates) if (referencedNode(g.nodeIds)) reanchoredIds.push(g.id);
    for (const e of before.elicitations) if (referencedNode(e.nodeIds)) reanchoredIds.push(e.id);
    for (const m of before.modeRequests) if (referencedNode(m.nodeIds)) reanchoredIds.push(m.id);
    const removedReviewIds = before.reviewAnnotations
      .filter((r) => r.anchorType === 'node' && r.nodeId === removedNodeId)
      .map((r) => r.id);
    // Focus is re-anchored too (the dangling id is normalized out) — reported so
    // the audit note does not undercount what the deletion changed.
    const reanchoredFocus = before.focus.nodeIds.includes(removedNodeId);

    // The actual re-normalization (strips dangling refs, drops node-anchored reviews).
    this.applyAxState(before);

    return { reanchoredIds, removedReviewIds, reanchoredFocus };
  }

  // ── Canvas-bound readers ──────────────────────────────────────────
  getAxState(): PmxAxState {
    return structuredClone(this.normalizeForCurrentNodes(this._axState));
  }

  getAxFocus(): PmxAxFocusState {
    return this.getAxState().focus;
  }

  setAxFocus(nodeIds: string[], options: { source?: PmxAxSource; recordHistory?: boolean } = {}): PmxAxFocusState {
    const oldAxState = this.getAxState();
    const nextAxState: PmxAxState = {
      ...oldAxState,
      focus: {
        nodeIds,
        primaryNodeId: nodeIds[0] ?? null,
        updatedAt: new Date().toISOString(),
        source: options.source ?? 'api',
      },
    };
    this.applyAxState(nextAxState);
    const appliedAxState = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    if (options.recordHistory === false) return appliedAxState.focus;
    this.deps.recordMutation({
      operationType: 'setAxFocus',
      description: `Set AX focus (${appliedAxState.focus.nodeIds.length} nodes)`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(appliedAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return appliedAxState.focus;
  }

  clearAxFocus(): PmxAxFocusState {
    return this.setAxFocus([], { source: 'system' });
  }

  // ── Work items (canvas-bound; snapshotted via getAxState blob) ────
  getWorkItems(): PmxAxWorkItem[] {
    return this.getAxState().workItems;
  }

  addWorkItem(
    input: { title: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxWorkItem {
    const oldAxState = this.getAxState();
    const item = createAxWorkItem(input, options.source ?? 'api', this.deps.getNodeIds());
    this.applyAxState({ ...oldAxState, workItems: [...oldAxState.workItems, item] });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'addWorkItem',
      description: `Added work item "${item.title}"`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.workItems.find((w) => w.id === item.id) ?? item;
  }

  updateWorkItem(
    id: string,
    patch: { title?: string; status?: PmxAxWorkItemStatus; detail?: string | null; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxWorkItem | null {
    const oldAxState = this.getAxState();
    const existing = oldAxState.workItems.find((w) => w.id === id);
    if (!existing) return null;
    const validNodeIds = this.deps.getNodeIds();
    const merged: PmxAxWorkItem = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
      ...(patch.nodeIds !== undefined ? { nodeIds: patch.nodeIds.filter((n) => validNodeIds.has(n)) } : {}),
      updatedAt: new Date().toISOString(),
      source: options.source ?? existing.source,
    };
    this.applyAxState({ ...oldAxState, workItems: replaceById(oldAxState.workItems, merged) });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'updateWorkItem',
      description: `Updated work item ${id}`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.workItems.find((w) => w.id === id) ?? null;
  }

  // ── Approval gates (canvas-bound) ─────────────────────────────────
  getApprovalGates(): PmxAxApprovalGate[] {
    return this.getAxState().approvalGates;
  }

  requestApproval(
    input: { title: string; detail?: string | null; action?: string | null; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxApprovalGate {
    const oldAxState = this.getAxState();
    const gate = createAxApprovalGate(input, options.source ?? 'api', this.deps.getNodeIds());
    this.applyAxState({ ...oldAxState, approvalGates: [...oldAxState.approvalGates, gate] });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'requestApproval',
      description: `Requested approval "${gate.title}"`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.approvalGates.find((g) => g.id === gate.id) ?? gate;
  }

  resolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    options: { resolution?: string; source?: PmxAxSource } = {},
  ): PmxAxApprovalGate | null {
    const oldAxState = this.getAxState();
    const gate = oldAxState.approvalGates.find((g) => g.id === id);
    if (!gate || gate.status !== 'pending') return null;
    const resolved: PmxAxApprovalGate = {
      ...gate,
      status: decision,
      resolvedAt: new Date().toISOString(),
      resolution: options.resolution ?? null,
      source: options.source ?? gate.source,
    };
    this.applyAxState({ ...oldAxState, approvalGates: replaceById(oldAxState.approvalGates, resolved) });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'resolveApproval',
      description: `Resolved approval ${id} -> ${decision}`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.approvalGates.find((g) => g.id === id) ?? null;
  }

  // ── Review annotations (canvas-bound) ─────────────────────────────
  getReviewAnnotations(): PmxAxReviewAnnotation[] {
    return this.getAxState().reviewAnnotations;
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
    // Validate the node anchor up front. A node-anchored review whose nodeId is
    // missing or unknown would otherwise be silently dropped by
    // normalizeForCurrentNodes after apply, yet still returned as a phantom
    // success object — false success / silent data loss. Reject instead so the
    // HTTP/MCP layers surface ok:false / 4xx.
    // Context-aware default: only fall back to a node anchor when a usable nodeId
    // is present; otherwise treat it as an unanchored (body-only) note so a
    // `{ body }`-only annotation succeeds (anchorType is documented optional).
    const anchorType = input.anchorType ?? (typeof input.nodeId === 'string' && input.nodeId ? 'node' : 'file');
    // An EXPLICIT node anchor still requires a real nodeId — reject a phantom
    // node-anchored review rather than silently dropping it post-apply.
    if (anchorType === 'node' && (typeof input.nodeId !== 'string' || !this.deps.getNodeIds().has(input.nodeId))) {
      return null;
    }
    const oldAxState = this.getAxState();
    const annotation = createAxReviewAnnotation(input, options.source ?? 'api');
    this.applyAxState({ ...oldAxState, reviewAnnotations: [...oldAxState.reviewAnnotations, annotation] });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'addReviewAnnotation',
      description: `Added review ${annotation.kind} (${annotation.severity})`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.reviewAnnotations.find((r) => r.id === annotation.id) ?? annotation;
  }

  updateReviewAnnotation(
    id: string,
    patch: { body?: string; status?: PmxAxReviewStatus; severity?: PmxAxReviewSeverity; kind?: PmxAxReviewKind },
    options: { source?: PmxAxSource } = {},
  ): PmxAxReviewAnnotation | null {
    const oldAxState = this.getAxState();
    const existing = oldAxState.reviewAnnotations.find((r) => r.id === id);
    if (!existing) return null;
    const merged: PmxAxReviewAnnotation = {
      ...existing,
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      updatedAt: new Date().toISOString(),
      source: options.source ?? existing.source,
    };
    this.applyAxState({ ...oldAxState, reviewAnnotations: replaceById(oldAxState.reviewAnnotations, merged) });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'updateReviewAnnotation',
      description: `Updated review ${id}`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.reviewAnnotations.find((r) => r.id === id) ?? null;
  }

  // ── Host capability (own table; reported by adapters) ─────────────
  getHostCapability(): PmxAxHostCapability | null {
    return this._axHostCapability;
  }

  // ── Elicitations (canvas-bound) ───────────────────────────────────
  getElicitations(): PmxAxElicitation[] {
    return this.getAxState().elicitations;
  }

  requestElicitation(
    input: { prompt: string; fields?: string[]; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxElicitation {
    const oldAxState = this.getAxState();
    const elicitation = createAxElicitation(input, options.source ?? 'api', this.deps.getNodeIds());
    this.applyAxState({ ...oldAxState, elicitations: [...oldAxState.elicitations, elicitation] });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'requestElicitation',
      description: `Requested elicitation "${elicitation.prompt}"`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.elicitations.find((e) => e.id === elicitation.id) ?? elicitation;
  }

  respondElicitation(
    id: string,
    response: Record<string, unknown>,
    options: { source?: PmxAxSource } = {},
  ): PmxAxElicitation | null {
    const oldAxState = this.getAxState();
    const existing = oldAxState.elicitations.find((e) => e.id === id);
    if (!existing || existing.status !== 'pending') return null;
    const merged: PmxAxElicitation = {
      ...existing,
      status: 'answered',
      response,
      resolvedAt: new Date().toISOString(),
      source: options.source ?? existing.source,
    };
    this.applyAxState({ ...oldAxState, elicitations: replaceById(oldAxState.elicitations, merged) });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'respondElicitation',
      description: `Answered elicitation ${id}`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.elicitations.find((e) => e.id === id) ?? null;
  }

  // ── Mode requests (canvas-bound) ──────────────────────────────────
  getModeRequests(): PmxAxModeRequest[] {
    return this.getAxState().modeRequests;
  }

  requestMode(
    input: { mode: PmxAxMode; reason?: string | null; nodeIds?: string[] },
    options: { source?: PmxAxSource } = {},
  ): PmxAxModeRequest {
    const oldAxState = this.getAxState();
    const request = createAxModeRequest(input, options.source ?? 'api', this.deps.getNodeIds());
    this.applyAxState({ ...oldAxState, modeRequests: [...oldAxState.modeRequests, request] });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'requestMode',
      description: `Requested mode "${request.mode}"`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.modeRequests.find((m) => m.id === request.id) ?? request;
  }

  resolveModeRequest(
    id: string,
    decision: 'approved' | 'rejected',
    options: { resolution?: string; source?: PmxAxSource } = {},
  ): PmxAxModeRequest | null {
    const oldAxState = this.getAxState();
    const existing = oldAxState.modeRequests.find((m) => m.id === id);
    if (!existing || existing.status !== 'pending') return null;
    const merged: PmxAxModeRequest = {
      ...existing,
      status: decision,
      resolvedAt: new Date().toISOString(),
      resolution: options.resolution ?? null,
      source: options.source ?? existing.source,
    };
    this.applyAxState({ ...oldAxState, modeRequests: replaceById(oldAxState.modeRequests, merged) });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'resolveModeRequest',
      description: `Resolved mode request ${id} -> ${decision}`,
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.modeRequests.find((m) => m.id === id) ?? null;
  }

  // ── Single-item AX readers (canvas-bound; for the blocking-wait endpoints) ──
  getApproval(id: string): PmxAxApprovalGate | null {
    return this.getAxState().approvalGates.find((g) => g.id === id) ?? null;
  }

  getElicitation(id: string): PmxAxElicitation | null {
    return this.getAxState().elicitations.find((e) => e.id === id) ?? null;
  }

  getModeRequest(id: string): PmxAxModeRequest | null {
    return this.getAxState().modeRequests.find((m) => m.id === id) ?? null;
  }

  getCommandRegistry(): PmxAxCommandDescriptor[] {
    return listAxCommands();
  }

  /** Invoke a registry-gated PMX command intent — records a timeline event (no execution). */
  invokeCommand(
    name: string,
    args: Record<string, unknown> | null = null,
    options: { source?: PmxAxSource } = {},
  ): PmxAxEvent | null {
    if (!isAxCommand(name)) return null;
    return this.recordAxEvent(
      {
        kind: 'command',
        summary: name,
        detail: AX_COMMAND_REGISTRY[name].description,
        data: { command: name, ...(args ? { args } : {}) },
      },
      options,
    );
  }

  getPolicy(): PmxAxPolicy {
    return this.getAxState().policy;
  }

  /** Merge a declarative tool/prompt policy patch (canvas-bound, snapshotted). */
  setPolicy(
    patch: { tools?: Partial<PmxAxPolicy['tools']>; prompt?: Partial<PmxAxPolicy['prompt']> },
    _options: { source?: PmxAxSource } = {},
  ): PmxAxPolicy {
    const oldAxState = this.getAxState();
    const merged = normalizeAxPolicy({
      tools: { ...oldAxState.policy.tools, ...(patch.tools ?? {}) },
      prompt: { ...oldAxState.policy.prompt, ...(patch.prompt ?? {}) },
    });
    this.applyAxState({ ...oldAxState, policy: merged });
    const applied = this.getAxState();
    this.deps.scheduleSave();
    this.deps.notifyChange('ax');
    this.deps.recordMutation({
      operationType: 'setPolicy',
      description: 'Updated AX policy',
      forward: this.deps.suppressed(() => {
        this.applyAxState(applied);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
      inverse: this.deps.suppressed(() => {
        this.applyAxState(oldAxState);
        this.deps.scheduleSave();
        this.deps.notifyChange('ax');
      }),
    });
    return applied.policy;
  }

  setHostCapability(input: unknown, _options: { source?: PmxAxSource } = {}): PmxAxHostCapability {
    const cap =
      normalizeAxHostCapability(
        isRecord(input) ? { ...input, reportedAt: new Date().toISOString() } : { reportedAt: new Date().toISOString() },
      ) ?? createEmptyAxHostCapability();
    this._axHostCapability = cap;
    const db = this.deps.getDb();
    if (db) {
      try {
        upsertAxHostCapabilityToDB(db, cap);
      } catch (error) {
        logAxStateWarning('save host capability failed', error, {});
      }
    }
    this.deps.notifyChange('ax');
    return cap;
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
    options: { source?: PmxAxSource } = {},
  ): PmxAxEvent {
    const draft = createAxEvent(input, options.source ?? 'api');
    const db = this.deps.getDb();
    if (db) {
      try {
        const ev = appendAxEventToDB(db, draft);
        this.deps.notifyChange('ax-timeline');
        return ev;
      } catch (error) {
        logAxStateWarning('record ax event failed', error, { id: draft.id });
      }
    }
    this.deps.notifyChange('ax-timeline');
    return { ...draft, seq: 0 };
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
    const draft = createAxEvidence(input, options.source ?? 'api');
    const db = this.deps.getDb();
    if (db) {
      try {
        const ev = appendAxEvidenceToDB(db, draft);
        this.deps.notifyChange('ax-timeline');
        return ev;
      } catch (error) {
        logAxStateWarning('add evidence failed', error, { id: draft.id });
      }
    }
    this.deps.notifyChange('ax-timeline');
    return { ...draft, seq: 0 };
  }

  recordSteeringMessage(message: string, options: { source?: PmxAxSource } = {}): PmxAxSteeringMessage {
    const draft = createAxSteeringMessage(message, options.source ?? 'api');
    const db = this.deps.getDb();
    if (db) {
      try {
        const s = appendAxSteeringToDB(db, draft);
        this.deps.notifyChange('ax-timeline');
        return s;
      } catch (error) {
        logAxStateWarning('record steering failed', error, { id: draft.id });
      }
    }
    this.deps.notifyChange('ax-timeline');
    return { ...draft, seq: 0 };
  }

  markSteeringDelivered(id: string): boolean {
    const db = this.deps.getDb();
    if (!db) return false;
    try {
      const ok = markAxSteeringDeliveredInDB(db, id);
      if (ok) this.deps.notifyChange('ax-timeline');
      return ok;
    } catch (error) {
      logAxStateWarning('mark steering delivered failed', error, { id });
      return false;
    }
  }

  /**
   * Ingest a normalized agent activity (a tool/session event a harness forwards)
   * and apply kind-driven board reactions, so the agent's real work flows back into
   * the board without it remembering to push each item (report primitive A — makes
   * AX bidirectional). Always records a timeline event; then, unless the caller
   * overrides/suppresses via `reactions`, applies defaults by kind/outcome:
   *   • failure | error | outcome==='failure' → work item (blocked) + review
   *     (finding/error, anchored to a valid nodeId else the `ref` file) + evidence (logs)
   *   • tool-result + outcome==='success'      → evidence (tool-result)
   *   • everything else (tool-start, session-*, command, note) → event only
   * A reaction value of `false` suppresses it; an object overrides its fields/forces it on.
   */
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
    const source = options.source ?? 'api';
    const summary = input.summary ?? input.title;
    const isFailure = input.kind === 'failure' || input.kind === 'error' || input.outcome === 'failure';
    const isToolSuccess = input.kind === 'tool-result' && input.outcome === 'success';
    const nodeIds = input.nodeIds ?? [];
    const validNodeIds = this.deps.getNodeIds();
    const anchorNodeId = nodeIds.find((n) => validNodeIds.has(n)) ?? null;

    // (1) Always record the activity on the timeline (precise kind on data.activityKind).
    const event = this.recordAxEvent(
      {
        kind: mapAxActivityKindToEventKind(input.kind),
        summary: input.title,
        detail: input.summary ?? null,
        nodeIds,
        // Caller data first so the canonical fields always win — a malformed/hostile
        // payload can't overwrite activityKind/outcome/ref (which the docstring +
        // reaction logic treat as authoritative).
        data: {
          ...(input.data ?? {}),
          activityKind: input.kind,
          ...(input.outcome ? { outcome: input.outcome } : {}),
          ...(input.ref ? { ref: input.ref } : {}),
        },
      },
      { source },
    );

    // (2) Resolve reactions: kind-driven defaults, overridable per call.
    const r = input.reactions ?? {};
    const wantWorkItem = r.workItem === false ? null : (r.workItem ?? (isFailure ? {} : null));
    const wantEvidence =
      r.evidence === false
        ? null
        : (r.evidence ??
          (isFailure
            ? { kind: 'logs' as PmxAxEvidenceKind }
            : isToolSuccess
              ? { kind: 'tool-result' as PmxAxEvidenceKind }
              : null));
    const wantReview = r.review === false ? null : (r.review ?? (isFailure ? {} : null));

    let workItem: PmxAxWorkItem | null = null;
    if (wantWorkItem) {
      workItem = this.addWorkItem(
        {
          title: input.title,
          status: wantWorkItem.status ?? 'blocked',
          detail: wantWorkItem.detail ?? summary,
          nodeIds,
        },
        { source },
      );
    }

    let evidence: PmxAxEvidence | null = null;
    if (wantEvidence) {
      evidence = this.addEvidence(
        {
          kind: wantEvidence.kind ?? 'logs',
          title: input.title,
          body: wantEvidence.body ?? input.summary ?? null,
          ref: input.ref ?? null,
          nodeIds,
        },
        { source },
      );
    }

    let review: PmxAxReviewAnnotation | null = null;
    if (wantReview) {
      const reviewNodeId = wantReview.nodeId ?? anchorNodeId;
      // addReviewAnnotation returns null on a bad node anchor — that just skips the
      // review; it never fails the whole ingest (the event + other reactions stand).
      review = this.addReviewAnnotation(
        {
          body: summary,
          kind: wantReview.kind ?? 'finding',
          severity: wantReview.severity ?? 'error',
          ...(wantReview.anchorType ? { anchorType: wantReview.anchorType } : {}),
          ...(reviewNodeId ? { nodeId: reviewNodeId } : {}),
          ...(input.ref ? { file: input.ref } : {}),
        },
        { source },
      );
    }

    return { event, workItem, evidence, review };
  }

  getAxEvents(q: AxTimelineQuery = {}): PmxAxEvent[] {
    const db = this.deps.getDb();
    return db ? loadAxEventsFromDB(db, q) : [];
  }

  getAxEvidence(q: AxTimelineQuery = {}): PmxAxEvidence[] {
    const db = this.deps.getDb();
    return db ? loadAxEvidenceFromDB(db, q) : [];
  }

  getAxSteering(q: AxTimelineQuery & { onlyPending?: boolean } = {}): PmxAxSteeringMessage[] {
    const db = this.deps.getDb();
    return db ? loadAxSteeringFromDB(db, q) : [];
  }

  /**
   * Undelivered steering for a consumer (Phase 4 delivery). Excludes messages
   * whose source equals the consumer to prevent delivery loops (e.g. Copilot
   * should not be handed back steering it originated).
   */
  getPendingSteering(options: { consumer?: string; limit?: number } = {}): PmxAxSteeringMessage[] {
    const db = this.deps.getDb();
    return db ? loadPendingAxSteeringFromDB(db, options) : [];
  }

  /**
   * NEWEST undelivered steering first, for the compact AX context lead block (report
   * #57) — so a fresh steer is visible even behind a long backlog. Loop-safe like
   * getPendingSteering, but ordered DESC instead of the FIFO ASC delivery queue.
   */
  getPendingSteeringForContext(options: { consumer?: string; limit?: number } = {}): PmxAxSteeringMessage[] {
    const db = this.deps.getDb();
    return db ? loadNewestPendingAxSteeringFromDB(db, options) : [];
  }

  /** Total undelivered steering for a consumer (loop-safe), for the context backlog counts. */
  getPendingSteeringCount(consumer?: string): number {
    const db = this.deps.getDb();
    return db ? countPendingAxSteeringFromDB(db, consumer) : 0;
  }

  getAxTimelineSummary(): PmxAxTimelineSummary {
    const db = this.deps.getDb();
    return db
      ? loadAxTimelineSummaryFromDB(db)
      : { recentEvents: [], recentEvidence: [], pendingSteering: [], counts: { events: 0, evidence: 0, steering: 0 } };
  }

  getAxTimeline(q: AxTimelineQuery = {}): {
    events: PmxAxEvent[];
    evidence: PmxAxEvidence[];
    steering: PmxAxSteeringMessage[];
    summary: PmxAxTimelineSummary;
  } {
    return {
      events: this.getAxEvents(q),
      evidence: this.getAxEvidence(q),
      steering: this.getAxSteering(q),
      summary: this.getAxTimelineSummary(),
    };
  }
}
