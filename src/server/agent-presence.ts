/**
 * Agent presence registry (rail-chrome-v2 phase 2).
 *
 * Lives beside IntentRegistry and follows its discipline: in-memory, TTL-swept,
 * count-capped, and emitting through an injected workbench emitter so this
 * module never imports server.ts. One `agent-presence` SSE frame carries the
 * full snapshot on every change, so a reconnecting client is never stale and
 * never needs its own expiry ticker.
 *
 * Presence is derived, not declared: agent-originated mutations (anything
 * `executeOperation` runs without the workbench marker) and AX activity
 * ingests (`tool-start`, `session-start`, …) touch a writer; adapters with
 * richer hooks may `set` a phase, cursor, or focus explicitly.
 */
import { z } from 'zod';
import {
  AGENT_PHASES,
  type AgentPhase,
  type AgentPresence,
  type AgentPresenceSnapshot,
  CONTEXT_BUDGET_DEFAULT_TOKENS,
  type ContextBudget,
  estimateTokens,
  isSessionActive,
  MAX_PRESENCES,
  PRESENCE_ACTIVITY_TTL_MS,
  PRESENCE_ATTACHED_IDLE_TTL_MS,
  PRESENCE_TOOLING_SETTLE_MS,
  TRANSPORT_SOURCES,
} from '../shared/agent-presence.js';
import { serializeNodeForAgentContext } from './agent-context.js';
import type { PmxAxActivityKind } from './ax-state.js';
import { type CanvasNodeState, canvasState } from './canvas-state.js';
import { OperationError } from './operations/types.js';

type PresenceEmitter = (event: string, payload: Record<string, unknown>) => void;

export interface PresenceTouch {
  source: string;
  agentId?: string | null;
  label?: string;
  phase?: AgentPhase;
  detail?: string | null;
  focusNodeId?: string | null;
  cursor?: { x: number; y: number } | null;
  attached?: boolean;
  /** Count this touch as an agent write. */
  op?: boolean;
}

const presenceSetSchema = z.object({
  source: z.string().min(1).max(40).optional(),
  agentId: z.string().min(1).max(80).nullable().optional(),
  label: z.string().min(1).max(120).optional(),
  phase: z.enum(AGENT_PHASES as [AgentPhase, ...AgentPhase[]]).optional(),
  detail: z.string().max(200).nullable().optional(),
  focusNodeId: z.string().max(200).nullable().optional(),
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
  attached: z.boolean().optional(),
});

interface StoredPresence extends AgentPresence {
  lastSeenMs: number;
  /** Explicit phases (`thinking`) hold until the next touch; derived `tooling` decays. */
  toolingUntilMs: number | null;
}

function presenceKey(source: string, agentId: string | null | undefined): string {
  return agentId && agentId.trim() ? agentId.trim() : source;
}

function contextBudgetTotal(): number {
  const raw = Number(process.env.PMX_CANVAS_CONTEXT_BUDGET_TOKENS ?? '');
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : CONTEXT_BUDGET_DEFAULT_TOKENS;
}

/** Token estimate of the pinned-context payload — the same serialization the MCP resource ships. */
export function estimateContextBudget(): ContextBudget {
  const nodes = Array.from(canvasState.contextPinnedNodeIds)
    .map((id) => canvasState.getNode(id))
    .filter((node): node is CanvasNodeState => node !== undefined);
  const payload = nodes.map((node) =>
    serializeNodeForAgentContext(node, { defaultTextLength: 700, webpageTextLength: 1600, includePosition: true }),
  );
  return { used: nodes.length === 0 ? 0 : estimateTokens(JSON.stringify(payload)), total: contextBudgetTotal() };
}

export class AgentPresenceRegistry {
  private readonly presences = new Map<string, StoredPresence>();
  private emit: PresenceEmitter = () => {};
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Inject the workbench SSE emitter (server.ts wires this at module load). */
  setEmitter(emitter: PresenceEmitter | null): void {
    this.emit = emitter ?? (() => {});
  }

  /**
   * Attribute a transport-labelled, agent-less write to the one attached
   * session, so the session's cursor and phase follow its own work no matter
   * which transport carried it. Ambiguous (several sessions) or identified
   * (agentId / host label) writes keep their own key.
   */
  private attributedKey(input: PresenceTouch): string {
    const own = presenceKey(input.source, input.agentId);
    // Identified writers and lifecycle touches (attach/detach) keep their key.
    if (input.agentId?.trim() || input.attached !== undefined) return own;
    // Only transport labels are attributable — and a transport label that is
    // itself the attached session (an MCP agent that attached as 'mcp') stays.
    if (!TRANSPORT_SOURCES.includes(input.source) || this.presences.get(own)?.attached) return own;
    const attached = [...this.presences.values()].filter((presence) => presence.attached);
    return attached.length === 1 ? attached[0]!.sessionId : own;
  }

  /** Touch a writer: upsert, bump lastSeen, apply the patch. Derived `tooling` decays on its own. */
  touch(input: PresenceTouch, now = Date.now()): AgentPresence {
    const key = this.attributedKey(input);
    const own = presenceKey(input.source, input.agentId);
    if (key !== own) {
      // The write was attributed to the session: fold any unattached shadow
      // writer the same transport left behind (pre-attach writes) into it.
      const shadow = this.presences.get(own);
      if (shadow && !shadow.attached) {
        this.presences.delete(own);
        const session = this.presences.get(key);
        if (session) session.opCount += shadow.opCount;
      }
    }
    const existing = this.presences.get(key);
    const stored: StoredPresence = existing ?? {
      sessionId: key,
      source: input.source,
      agentId: input.agentId?.trim() || null,
      label: input.label ?? input.agentId?.trim() ?? input.source,
      phase: 'idle',
      detail: null,
      focusNodeId: null,
      cursor: null,
      attached: false,
      opCount: 0,
      lastSeenAt: new Date(now).toISOString(),
      lastSeenMs: now,
      toolingUntilMs: null,
    };
    stored.lastSeenMs = now;
    stored.lastSeenAt = new Date(now).toISOString();
    if (input.label) stored.label = input.label;
    if (input.op) stored.opCount += 1;
    if (input.attached !== undefined) stored.attached = input.attached;
    if (input.focusNodeId !== undefined) stored.focusNodeId = input.focusNodeId;
    if (input.cursor !== undefined) stored.cursor = input.cursor;
    if (input.phase !== undefined) {
      stored.phase = input.phase;
      stored.detail = input.detail !== undefined ? input.detail : input.phase === 'tooling' ? stored.detail : null;
      stored.toolingUntilMs = input.phase === 'tooling' ? now + PRESENCE_TOOLING_SETTLE_MS : null;
    } else if (input.detail !== undefined) {
      stored.detail = input.detail;
    }
    this.presences.set(key, stored);
    this.evictOverflow();
    this.ensureSweeper();
    this.scheduleEmit();
    return this.publicView(stored, now);
  }

  /** Explicit update from an adapter / MCP client (validated). */
  set(raw: unknown, fallbackSource: string): AgentPresence {
    const parsed = presenceSetSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OperationError(`Invalid presence: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
    }
    const input = parsed.data;
    const source = input.source ?? fallbackSource;
    if (input.focusNodeId && !canvasState.getNode(input.focusNodeId)) {
      throw new OperationError(`focusNodeId "${input.focusNodeId}" does not exist.`, 404);
    }
    return this.touch({
      source,
      agentId: input.agentId ?? null,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.detail !== undefined ? { detail: input.detail } : {}),
      ...(input.focusNodeId !== undefined ? { focusNodeId: input.focusNodeId } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.attached !== undefined ? { attached: input.attached } : {}),
    });
  }

  /** Map an AX activity ingest onto presence — the feed that already exists. */
  observeActivity(
    kind: PmxAxActivityKind,
    input: { source: string; agentId?: string | null; title: string },
    now = Date.now(),
  ): void {
    const base = { source: input.source, agentId: input.agentId ?? null };
    switch (kind) {
      case 'session-start':
        this.touch({ ...base, attached: true, phase: 'idle', detail: null, label: input.title }, now);
        return;
      case 'session-end':
        this.detach(presenceKey(base.source, base.agentId));
        return;
      case 'tool-start':
        this.touch({ ...base, phase: 'tooling', detail: input.title }, now);
        return;
      case 'tool-result':
      case 'failure':
      case 'error':
        this.touch({ ...base, phase: 'idle', detail: null }, now);
        return;
      default:
        this.touch(base, now);
    }
  }

  /** Remove a writer (session-end). */
  detach(sessionId: string): boolean {
    const removed = this.presences.delete(sessionId);
    if (removed) this.scheduleEmit();
    this.maybeStopSweeper();
    return removed;
  }

  snapshot(now = Date.now()): AgentPresenceSnapshot {
    this.sweep(now, { emit: false });
    const presences = [...this.presences.values()].map((stored) => this.publicView(stored, now));
    return { presences, budget: estimateContextBudget(), sessionActive: isSessionActive(presences) };
  }

  /** Test / shutdown hook. */
  reset(): void {
    this.presences.clear();
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.maybeStopSweeper();
  }

  private publicView(stored: StoredPresence, now: number): AgentPresence {
    const { lastSeenMs: _lastSeenMs, toolingUntilMs, ...presence } = stored;
    let phase = presence.phase;
    let detail = presence.detail;
    if (phase === 'tooling' && toolingUntilMs !== null && toolingUntilMs <= now) {
      phase = 'idle';
      detail = null;
    }
    // An attached session blocked on a human decision reads as waiting — the
    // gate itself lives in the AX state, this is only the presence view of it.
    // It overrides tooling too: the gate REQUEST is itself a write, and the
    // human's decision is the state that matters while it is pending.
    if (presence.attached && this.hasPendingGate()) {
      phase = 'waiting-approval';
      detail = null;
    }
    return { ...presence, phase, detail };
  }

  private hasPendingGate(): boolean {
    return canvasState.getAxState().approvalGates.some((gate) => gate.status === 'pending');
  }

  private evictOverflow(): void {
    while (this.presences.size > MAX_PRESENCES) {
      let oldestKey: string | null = null;
      let oldestMs = Number.POSITIVE_INFINITY;
      for (const [key, presence] of this.presences) {
        if (presence.lastSeenMs < oldestMs) {
          oldestMs = presence.lastSeenMs;
          oldestKey = key;
        }
      }
      if (!oldestKey) break;
      this.presences.delete(oldestKey);
    }
  }

  private sweep(now = Date.now(), options: { emit?: boolean } = {}): void {
    let changed = false;
    for (const [key, presence] of this.presences) {
      const ttl = presence.attached ? PRESENCE_ATTACHED_IDLE_TTL_MS : PRESENCE_ACTIVITY_TTL_MS;
      if (presence.lastSeenMs + ttl <= now) {
        this.presences.delete(key);
        changed = true;
        continue;
      }
      // A decayed `tooling` is a visible change too — emit so the chip settles.
      if (presence.phase === 'tooling' && presence.toolingUntilMs !== null && presence.toolingUntilMs <= now) {
        presence.phase = 'idle';
        presence.detail = null;
        presence.toolingUntilMs = null;
        changed = true;
      }
    }
    if (changed && options.emit !== false) this.scheduleEmit();
    this.maybeStopSweeper();
  }

  /** Coalesce bursts (batch churn) into one frame per tick. */
  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('agent-presence', this.snapshot() as unknown as Record<string, unknown>);
    }, 50);
    (this.emitTimer as { unref?: () => void }).unref?.();
  }

  private ensureSweeper(): void {
    if (this.sweepTimer || this.presences.size === 0) return;
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    (this.sweepTimer as { unref?: () => void }).unref?.();
  }

  private maybeStopSweeper(): void {
    if (this.sweepTimer && this.presences.size === 0) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

/** Process-wide singleton, shared across HTTP handlers, MCP ops, and the SDK. */
export const agentPresence = new AgentPresenceRegistry();
