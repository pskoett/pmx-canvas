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
  type AgentActivityEntry,
  type AgentPhase,
  type AgentPresence,
  type AgentPresenceSnapshot,
  CONTEXT_BUDGET_DEFAULT_TOKENS,
  type ContextBudget,
  estimateTokens,
  HUMAN_STARTED_SESSION_LABEL,
  isSessionActive,
  MAX_ACTIVITY_ENTRIES,
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

/** A legal writer label: short, alphanumeric/dash, letter-first (header and env values). */
export const SOURCE_LABEL_RE = /^[a-z][a-z0-9-]{0,39}$/i;

export interface PresenceTouch {
  source: string;
  agentId?: string | null;
  label?: string;
  phase?: AgentPhase;
  detail?: string | null;
  focusNodeId?: string | null;
  parentAgentId?: string | null;
  /** Op-derived tooling: overlay the phase without clobbering the explicit one. */
  derivedTooling?: boolean;
  cursor?: { x: number; y: number } | null;
  attached?: boolean;
  /** With `attached: false`: who ended it (receipt transparency). Default 'agent'. */
  endedBy?: 'human' | 'agent';
  /** The host's real token usage for this agent, if it knows it. */
  contextUsage?: { used: number; total: number } | null;
  /** Count this touch as an agent write. */
  op?: boolean;
  /** What the write did, for the activity feed (only meaningful with `op`). */
  activity?: { op: string; summary: string; nodeId: string | null };
}

/** Title a write's summary can name, or a type-based fallback. */
function nodeTitle(nodeId: string | null | undefined): string | null {
  const node = nodeId ? canvasState.getNode(nodeId) : undefined;
  if (!node) return null;
  const title = typeof node.data.title === 'string' ? node.data.title.trim() : '';
  return title || `${node.type} node`;
}

function quote(title: string | null, fallback: string): string {
  return title ? `“${title}”` : fallback;
}

/**
 * One sentence for the activity feed, from the op name plus whatever the
 * input/result name. Titles are read AFTER the op ran, so creates and updates
 * resolve; removes describe what is gone by id.
 */
export function describeWrite(
  op: string,
  rawInput: unknown,
  result: unknown,
): { summary: string; nodeId: string | null } {
  const input = rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {};
  const res = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
  const resNode = res.node && typeof res.node === 'object' ? (res.node as Record<string, unknown>) : {};
  const nodeId =
    (typeof input.id === 'string' && input.id) ||
    (typeof input.nodeId === 'string' && input.nodeId) ||
    (typeof res.id === 'string' && res.id) ||
    (typeof resNode.id === 'string' && resNode.id) ||
    null;
  const title = nodeTitle(nodeId);
  const str = (value: unknown): string => (typeof value === 'string' ? value : '');
  switch (op) {
    case 'node.add':
      return { summary: `Created ${str(input.type) || 'a'} ${quote(title, 'node')}`, nodeId };
    case 'jsonrender.add':
    case 'graph.add':
      return { summary: `Created ${quote(title, 'a rendered node')}`, nodeId };
    case 'jsonrender.stream':
      return { summary: `Streamed into ${quote(title, 'a rendered node')}`, nodeId };
    case 'node.update':
      return { summary: `Updated ${quote(title, 'a node')}`, nodeId };
    case 'node.remove':
      return { summary: 'Removed a node', nodeId };
    case 'edge.add':
      return {
        summary: `Connected ${quote(nodeTitle(str(input.from)), 'a node')} → ${quote(nodeTitle(str(input.to)), 'a node')}`,
        nodeId: str(input.to) || null,
      };
    case 'edge.remove':
      return { summary: 'Removed an edge', nodeId: null };
    case 'group.create':
      return { summary: `Grouped nodes into ${quote(title, 'a group')}`, nodeId };
    case 'group.add':
      return {
        summary: `Changed membership of ${quote(nodeTitle(str(input.groupId)), 'a group')}`,
        nodeId: str(input.groupId) || null,
      };
    case 'group.remove':
      // The frame is gone by now — the op returns the title it had.
      return { summary: `Dissolved group ${quote(str(res.title) || null, 'a group')}`, nodeId: null };
    case 'arrange':
      return { summary: `Arranged the board${str(input.layout) ? ` (${str(input.layout)})` : ''}`, nodeId: null };
    case 'canvas.clear':
      return { summary: 'Cleared the board', nodeId: null };
    case 'snapshot.restore':
      return { summary: 'Restored a snapshot', nodeId: null };
    case 'annotation.add':
      return { summary: 'Drew an annotation', nodeId: null };
    case 'ax.work.create':
      return { summary: `Opened work item ${quote(str(input.title) || null, '')}`.trimEnd(), nodeId };
    case 'ax.work.update':
      return { summary: `Updated a work item${str(input.status) ? ` → ${str(input.status)}` : ''}`, nodeId };
    case 'ax.approval.request':
      return { summary: `Requested approval: ${quote(str(input.title) || null, 'a gate')}`, nodeId };
    case 'ax.approval.resolve':
      return { summary: `Resolved a gate${str(input.decision) ? ` → ${str(input.decision)}` : ''}`, nodeId };
    case 'ax.evidence.add':
    case 'ax.event.record':
    case 'ax.steer':
      // Already first-class timeline rows (Evidence / the event kind / Steer):
      // an empty summary keeps them out of the activity feed.
      return { summary: '', nodeId };
    case 'intent.signal':
      return {
        summary: `Proposed ${quote(str(input.label) || null, 'a change')}${str(input.kind) ? ` (${str(input.kind)})` : ''}`,
        nodeId,
      };
    case 'intent.update':
      return { summary: 'Updated a proposal', nodeId };
    case 'intent.clear':
      return { summary: 'Withdrew a proposal', nodeId };
    case 'ax.focus.set':
      return { summary: 'Set the AX focus', nodeId: null };
    case 'ax.policy.set':
      return { summary: 'Updated the tool policy', nodeId: null };
    default:
      return { summary: op.replace(/\./g, ' '), nodeId };
  }
}

/**
 * The one validation schema for an explicit presence update. The HTTP/MCP op
 * spreads these fields into its tool shape so the two cannot drift.
 *
 * Identity note: presence is a UX signal, not an authenticated identity — any
 * local process can assert any `source`/`agentId` (the single-workspace trust
 * model). It shows the human WHO claims to be working; it grants no write
 * capability that the caller did not already have.
 */
export const PRESENCE_SET_SHAPE = {
  source: z.string().min(1).max(40).optional(),
  agentId: z.string().min(1).max(80).nullable().optional(),
  label: z.string().min(1).max(120).optional(),
  phase: z.enum(AGENT_PHASES as [AgentPhase, ...AgentPhase[]]).optional(),
  detail: z.string().max(200).nullable().optional(),
  focusNodeId: z.string().max(200).nullable().optional(),
  cursor: z.object({ x: z.number().finite(), y: z.number().finite() }).nullable().optional(),
  attached: z.boolean().optional(),
  parentAgentId: z.string().min(1).max(80).nullable().optional(),
  // Who is ending the session when attached:false — the browser's End button
  // declares 'human'; anything else defaults to 'agent'. Self-reported, like
  // the workbench marker (the local trust model).
  endedBy: z.enum(['human', 'agent']).optional(),
  contextUsage: z
    .object({ used: z.number().finite().min(0), total: z.number().finite().positive() })
    .nullable()
    .optional(),
};
const presenceSetSchema = z.object(PRESENCE_SET_SHAPE);

interface StoredPresence extends AgentPresence {
  lastSeenMs: number;
  /** Explicit phases (`thinking`) hold until the next touch; derived `tooling` decays. */
  toolingUntilMs: number | null;
  lastActivityNodeId: string | null;
  /** Snapshot of the board taken when this session attached (the receipt diffs against it). */
  startSnapshotId: string | null;
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

/** Returns the id of the pre-session snapshot the server took, if any. */
type SessionStartListener = (presence: AgentPresence) => string | null;
export type SessionEndReason = 'human' | 'agent' | 'idle-timeout';
type SessionEndListener = (presence: AgentPresence, startSnapshotId: string | null, endedBy: SessionEndReason) => void;

export class AgentPresenceRegistry {
  private readonly presences = new Map<string, StoredPresence>();
  /** Newest first; bounded. Survives a writer fading — the feed is history, the writer list is presence. */
  private activity: AgentActivityEntry[] = [];
  private activitySeq = 0;
  private emit: PresenceEmitter = () => {};
  /** Single slots (like the emitter): server.ts owns the pre-session snapshot + receipt. */
  private onSessionStart: SessionStartListener = () => null;
  private onSessionEnd: SessionEndListener = () => {};
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private emitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Inject the workbench SSE emitter (server.ts wires this at module load). */
  setEmitter(emitter: PresenceEmitter | null): void {
    this.emit = emitter ?? (() => {});
  }

  /**
   * Fires when a session attaches (false → true). The listener may snapshot the
   * board and return the snapshot id; the receipt at session end diffs against it.
   */
  setSessionStartListener(listener: SessionStartListener | null): void {
    this.onSessionStart = listener ?? (() => null);
  }

  /**
   * Fires once when an ATTACHED session ends — by `session-end`, by an explicit
   * `attached: false`, or by the idle-TTL sweep — with the presence as it was
   * and the pre-session snapshot id. Unattached writers fading away never fire it.
   */
  setSessionEndListener(listener: SessionEndListener | null): void {
    this.onSessionEnd = listener ?? (() => {});
  }

  /**
   * Attribute an agent-less write to the one attached session, so the
   * session's cursor and phase follow its own work no matter which transport
   * carried it. An agent-started session absorbs transport labels only
   * (api/mcp/sdk/cli); a human-started one (`browser`, *Start agent session*)
   * is a placeholder for whichever agent comes next and absorbs any label.
   * Ambiguous (several sessions) or identified (agentId) writes, and a writer
   * that is itself attached, keep their own key.
   */
  private attributedKey(input: PresenceTouch): string {
    const own = presenceKey(input.source, input.agentId);
    // Identified writers keep their key; attaches run the twin-merge in touch().
    if (input.agentId?.trim() || input.attached === true || this.presences.get(own)?.attached) return own;
    // A channel that attach-merged into a session stays that session's — its
    // writes AND its detach belong to the merged session, however many other
    // sessions are attached.
    const alias = this.aliases.get(own);
    if (alias && this.presences.get(alias)?.attached) return alias;
    if (input.attached !== undefined) return own;
    const attached = [...this.presences.values()].filter((presence) => presence.attached);
    if (attached.length !== 1) return own;
    const session = attached[0]!;
    return session.source === 'browser' || TRANSPORT_SOURCES.includes(input.source) ? session.sessionId : own;
  }

  /**
   * Fold an unattached writer into a session: its ops and feed entries were
   * the session's work all along. A human-started session still carrying its
   * placeholder label takes the writer's name.
   */
  private fold(shadowKey: string, session: StoredPresence): void {
    const shadow = this.presences.get(shadowKey);
    if (!shadow || shadow.attached) return;
    this.presences.delete(shadowKey);
    if (session.label === HUMAN_STARTED_SESSION_LABEL && !TRANSPORT_SOURCES.includes(shadow.source)) {
      session.label = shadow.label;
    }
    session.opCount += shadow.opCount;
    for (const entry of this.activity) {
      if (entry.sessionId === shadowKey) {
        entry.sessionId = session.sessionId;
        entry.label = session.label;
      }
    }
  }

  /** Aliased channels: a key that attach-merged into another session (extension + its MCP server). */
  private aliases = new Map<string, string>();

  /** Consumer keys that have claimed steering deliveries this server-run. */
  private steeringConsumers = new Set<string>();

  /** A delivery claim proves this consumer polls steering — its presence turns steerable. */
  noteSteeringConsumer(consumer: string): void {
    if (!consumer || this.steeringConsumers.has(consumer)) return;
    this.steeringConsumers.add(consumer);
    this.scheduleEmit();
  }

  /** Drop aliases that point at a session that no longer exists. */
  private dropAliasesTo(sessionId: string): void {
    for (const [channel, target] of this.aliases) {
      if (target === sessionId) this.aliases.delete(channel);
    }
  }

  /** Touch a writer: upsert, bump lastSeen, apply the patch. Derived `tooling` decays on its own. */
  touch(input: PresenceTouch, now = Date.now()): AgentPresence {
    let key = this.attributedKey(input);
    const own = presenceKey(input.source, input.agentId);
    if (input.attached === true && !input.agentId?.trim()) {
      // One agent, two channels: an attach whose label matches an ALREADY
      // attached session (Copilot's extension presence + its MCP server both
      // announcing "GitHub Copilot") is the same agent — merge instead of
      // showing a second session, and remember the alias so this channel's
      // later writes and detach land on the merged session too.
      const label = input.label ?? input.source;
      const twin = [...this.presences.values()].find(
        (presence) => presence.attached && presence.sessionId !== own && !presence.agentId && presence.label === label,
      );
      if (twin) {
        this.aliases.set(own, twin.sessionId);
        this.fold(own, twin);
        key = twin.sessionId;
      }
    }
    if (key !== own) {
      const session = this.presences.get(key);
      if (session) {
        // A human-started session takes the name of the agent that fills it.
        if (session.label === HUMAN_STARTED_SESSION_LABEL && !TRANSPORT_SOURCES.includes(input.source)) {
          session.label = input.label ?? input.source;
        }
        // The write was attributed to the session: fold any unattached shadow
        // writer the same label left behind (pre-attach writes) into it.
        this.fold(own, session);
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
      parentAgentId: null,
      lastActivityNodeId: null,
      opCount: 0,
      contextUsage: null,
      lastSeenAt: new Date(now).toISOString(),
      lastSeenMs: now,
      toolingUntilMs: null,
      startSnapshotId: null,
    };
    const wasAttached = stored.attached;
    stored.lastSeenMs = now;
    stored.lastSeenAt = new Date(now).toISOString();
    if (input.label) stored.label = input.label;
    if (input.op) {
      stored.opCount += 1;
      if (input.activity?.summary) {
        this.activitySeq += 1;
        this.activity.unshift({
          id: `act-${this.activitySeq}`,
          at: stored.lastSeenAt,
          sessionId: key,
          label: stored.label,
          op: input.activity.op,
          summary: input.activity.summary,
          nodeId: input.activity.nodeId,
        });
        if (input.activity.nodeId) stored.lastActivityNodeId = input.activity.nodeId;
        if (this.activity.length > MAX_ACTIVITY_ENTRIES) this.activity.length = MAX_ACTIVITY_ENTRIES;
      }
    }
    if (input.attached !== undefined) stored.attached = input.attached;
    if (!wasAttached && input.attached === true) {
      // *Start agent session* with one agent-less writer already on the board
      // adopts that writer — the human is claiming the agent they can see.
      if (stored.source === 'browser') {
        const loose = [...this.presences.values()].filter((presence) => !presence.attached && !presence.agentId);
        const adopted = loose.length === 1 ? loose[0]! : null;
        if (adopted) this.fold(adopted.sessionId, stored);
        // Start must SAY what it adopted — "Idle · Agent session" with no
        // explanation left the human guessing whether anything was picked up.
        try {
          canvasState.recordAxEvent(
            {
              kind: 'note',
              summary: adopted
                ? `Started agent session — adopted writer "${adopted.label}" (${adopted.opCount} op${adopted.opCount === 1 ? '' : 's'} folded in).`
                : loose.length === 0
                  ? 'Started agent session — no loose writer to adopt; agents that attach appear as their own chips.'
                  : `Started agent session — ${loose.length} loose writers on the board, none adopted (adoption needs exactly one).`,
              nodeIds: [],
              data: { session: 'start-adoption', adopted: adopted?.sessionId ?? null, looseCount: loose.length },
            },
            { source: 'browser' },
          );
        } catch {
          // presence bookkeeping must never fail an attach
        }
      }
      // The human's still-unused placeholder TURNS INTO the first real agent
      // session that attaches (user call 2026-08-24): a third "Agent session ·
      // Idle" chip next to the agent's own is noise, and the human's Start
      // moment stays the receipt baseline via the inherited snapshot. A
      // placeholder that already adopted work is a real session and stays.
      let inheritedSnapshotId: string | null = null;
      if (stored.source !== 'browser') {
        const placeholder = [...this.presences.values()].find(
          (presence) =>
            presence.attached &&
            presence.sessionId !== key &&
            presence.source === 'browser' &&
            presence.label === HUMAN_STARTED_SESSION_LABEL &&
            presence.opCount === 0,
        );
        if (placeholder) {
          this.presences.delete(placeholder.sessionId);
          for (const [channel, target] of this.aliases) {
            if (target === placeholder.sessionId) this.aliases.set(channel, key);
          }
          inheritedSnapshotId = placeholder.startSnapshotId;
        }
      }
      stored.startSnapshotId = inheritedSnapshotId ?? this.onSessionStart(this.publicView(stored, now));
    }
    if (wasAttached && input.attached === false) {
      this.onSessionEnd(this.publicView(stored, now), stored.startSnapshotId, input.endedBy ?? 'agent');
      // An ended session is gone — like `session-end` on the activity feed, it
      // must not linger as an "external writer" until the activity TTL.
      this.presences.delete(key);
      this.dropAliasesTo(key);
      this.maybeStopSweeper();
      this.scheduleEmit();
      return this.publicView({ ...stored, startSnapshotId: null }, now);
    }
    if (input.focusNodeId !== undefined) stored.focusNodeId = input.focusNodeId;
    if (input.parentAgentId !== undefined) stored.parentAgentId = input.parentAgentId;
    if (input.cursor !== undefined) stored.cursor = input.cursor;
    if (input.contextUsage !== undefined) stored.contextUsage = input.contextUsage;
    if (input.phase === 'tooling' && input.derivedTooling) {
      // Copilot's finding: an op-derived tooling touch used to CLOBBER the
      // explicit phase, and the sweep then decayed to idle — an agent whose
      // host said "thinking" read as Idle while hard at work. Derived tooling
      // is an OVERLAY: bump the window + detail, keep the explicit phase.
      stored.toolingUntilMs = now + PRESENCE_TOOLING_SETTLE_MS;
      if (input.detail !== undefined) stored.detail = input.detail;
    } else if (input.phase !== undefined) {
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

  /**
   * A host reported the agent's real context window without naming the
   * writer (the legacy `context-usage` workbench event): it belongs to the
   * single attached session, if there is exactly one. Returns false otherwise.
   */
  reportContextUsage(usage: { used: number; total: number }): boolean {
    const attached = [...this.presences.values()].filter((presence) => presence.attached);
    if (attached.length !== 1) return false;
    const session = attached[0]!;
    this.touch({ source: session.source, agentId: session.agentId, contextUsage: usage });
    return true;
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
      ...(input.parentAgentId !== undefined ? { parentAgentId: input.parentAgentId } : {}),
      ...(input.cursor !== undefined ? { cursor: input.cursor } : {}),
      ...(input.attached !== undefined ? { attached: input.attached } : {}),
      ...(input.endedBy !== undefined ? { endedBy: input.endedBy } : {}),
      ...(input.contextUsage !== undefined ? { contextUsage: input.contextUsage } : {}),
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

  /**
   * Re-emit the snapshot after something the phase is DERIVED from changed
   * (a gate opened or resolved) without any writer being touched.
   */
  refresh(): void {
    if (this.presences.size > 0) this.scheduleEmit();
  }

  /** Remove a writer (session-end). */
  detach(sessionId: string): boolean {
    const stored = this.presences.get(sessionId);
    const removed = this.presences.delete(sessionId);
    if (removed) {
      this.dropAliasesTo(sessionId);
      if (stored?.attached) this.onSessionEnd(this.publicView(stored, Date.now()), stored.startSnapshotId, 'agent');
      this.scheduleEmit();
    }
    this.maybeStopSweeper();
    return removed;
  }

  snapshot(now = Date.now()): AgentPresenceSnapshot {
    this.sweep(now, { emit: false });
    const presences = [...this.presences.values()].map((stored) => this.publicView(stored, now));
    return {
      presences,
      budget: estimateContextBudget(),
      sessionActive: isSessionActive(presences),
      activity: this.activity.map((entry) => ({ ...entry })),
    };
  }

  /** Test / shutdown hook. */
  reset(): void {
    this.steeringConsumers.clear();
    this.presences.clear();
    this.aliases.clear();
    this.activity = [];
    if (this.emitTimer) {
      clearTimeout(this.emitTimer);
      this.emitTimer = null;
    }
    this.maybeStopSweeper();
  }

  private publicView(stored: StoredPresence, now: number): AgentPresence {
    const {
      lastSeenMs: _lastSeenMs,
      toolingUntilMs,
      startSnapshotId: _startSnapshotId,
      lastActivityNodeId,
      ...presence
    } = stored;
    let phase = presence.phase;
    let detail = presence.detail;
    if (toolingUntilMs !== null && toolingUntilMs > now) {
      // Live tooling overlay (derived or explicit).
      phase = 'tooling';
    } else if (phase === 'tooling' && toolingUntilMs !== null && toolingUntilMs <= now) {
      // Explicit tooling settles to idle; a derived overlay just falls away
      // and the explicit phase (thinking, waiting…) stands.
      phase = 'idle';
      detail = null;
    }
    // Park-at fallback (joint-gaps #3): an attached-but-focusless writer is
    // invisible everywhere — fall back to the last node its activity touched.
    if (!presence.focusNodeId && lastActivityNodeId) presence.focusNodeId = lastActivityNodeId;
    // An attached session blocked on a human decision reads as waiting — the
    // gate itself lives in the AX state, this is only the presence view of it.
    // It overrides tooling too: the gate REQUEST is itself a write, and the
    // human's decision is the state that matters while it is pending.
    if (presence.attached && this.hasPendingGate()) {
      phase = 'waiting-approval';
      detail = null;
    }
    // Steerable = a steer addressed to this writer can actually reach it: an
    // attached session (its adapter loop reads steering), or a consumer key
    // that has claimed deliveries this server-run. A one-shot writer (curl,
    // the CLI) is presence without an inbox — offering it as a steer target
    // reads as steerable while the steer would sit unclaimed forever.
    const steerable =
      presence.attached ||
      this.steeringConsumers.has(presence.sessionId) ||
      this.steeringConsumers.has(presence.source);
    return { ...presence, phase, detail, steerable };
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
      this.dropAliasesTo(oldestKey);
    }
  }

  private sweep(now = Date.now(), options: { emit?: boolean } = {}): void {
    let changed = false;
    for (const [key, presence] of this.presences) {
      const ttl = presence.attached ? PRESENCE_ATTACHED_IDLE_TTL_MS : PRESENCE_ACTIVITY_TTL_MS;
      if (presence.lastSeenMs + ttl <= now) {
        this.presences.delete(key);
        this.dropAliasesTo(key);
        if (presence.attached)
          this.onSessionEnd(this.publicView(presence, now), presence.startSnapshotId, 'idle-timeout');
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

// The attached session's phase and budget DERIVE from AX state (pending gates)
// and context pins. Re-emit on every AX / pin change — whatever transport made
// it — so no caller has to remember to refresh, and the SDK paths that bypass
// the operation registry are covered too.
canvasState.onChange((type) => {
  if (type === 'ax' || type === 'pins') agentPresence.refresh();
});
