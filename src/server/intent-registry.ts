/**
 * IntentRegistry — the server-side home of the Ghost Cursor of Intent.
 *
 * Intents are EPHEMERAL PRESENCE, deliberately modelled like the attention /
 * timeline ephemerality layer rather than canvas-bound state:
 *  - an in-memory Map (NOT CanvasStateManager) — never serialized, never
 *    snapshotted, never returned by canvas_get_layout;
 *  - count-capped (oldest evicted) and TTL-swept so a ghost can never linger;
 *  - emitted over the same workbench SSE stream as `ax-intent` /
 *    `ax-intent-clear` frames via an INJECTED emitter (server.ts wires it,
 *    mirroring setOperationEventEmitter) so this module never imports server.ts.
 *
 * The single trust boundary is `signal()` / `update()`: every envelope is
 * zod-validated and per-kind-checked here, so HTTP, MCP, and the SDK all funnel
 * through the same validation (consistent with applyAxInteraction).
 */
import { z } from 'zod';
import {
  DEFAULT_INTENT_TTL_MS,
  INTENT_EDGE_TYPES,
  INTENT_KINDS,
  MAX_INTENT_TTL_MS,
  MAX_LIVE_INTENTS,
  type PmxAxIntent,
  type PmxAxIntentKind,
} from '../shared/ax-intent.js';
import { OperationError } from './operations/types.js';

type IntentEmitter = (event: string, payload: Record<string, unknown>) => void;

const positionSchema = z.object({ x: z.number().finite(), y: z.number().finite() });

const intentSignalSchema = z.looseObject({
  id: z.string().min(1).max(200).optional(),
  kind: z.enum(INTENT_KINDS),
  position: positionSchema.optional(),
  nodeId: z.string().min(1).max(200).optional(),
  edge: z
    .object({
      from: z.string().min(1).max(200),
      to: z.string().min(1).max(200),
      type: z.enum(INTENT_EDGE_TYPES),
    })
    .optional(),
  nodeType: z.string().max(60).optional(),
  label: z.string().max(120).optional(),
  reason: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1).optional(),
  seq: z.number().int().min(0).max(9999).optional(),
  ttlMs: z.number().positive().max(MAX_INTENT_TTL_MS).optional(),
  source: z.string().max(60).optional(),
});

const intentUpdateSchema = z.looseObject({
  position: positionSchema.optional(),
  nodeType: z.string().max(60).optional(),
  label: z.string().max(120).optional(),
  reason: z.string().max(400).optional(),
  confidence: z.number().min(0).max(1).optional(),
  seq: z.number().int().min(0).max(9999).optional(),
  ttlMs: z.number().positive().max(MAX_INTENT_TTL_MS).optional(),
});

function parseOrThrow<T>(schema: z.ZodType<T>, raw: unknown, label: string): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
      .join('; ');
    throw new OperationError(`Invalid ${label}: ${detail}`);
  }
  return parsed.data;
}

/** Each kind needs the spatial anchor it renders against — fail loud otherwise. */
function requireKindFields(kind: PmxAxIntentKind, value: z.infer<typeof intentSignalSchema>): void {
  switch (kind) {
    case 'create':
      if (!value.position) throw new OperationError('intent kind "create" requires a position.');
      break;
    case 'move':
      if (!value.nodeId) throw new OperationError('intent kind "move" requires a nodeId.');
      if (!value.position) throw new OperationError('intent kind "move" requires a destination position.');
      break;
    case 'connect':
      if (!value.edge) throw new OperationError('intent kind "connect" requires an edge { from, to, type }.');
      break;
    case 'remove':
    case 'edit':
      if (!value.nodeId) throw new OperationError(`intent kind "${kind}" requires a nodeId.`);
      break;
  }
}

let intentSeq = 0;

function nextIntentId(): string {
  intentSeq += 1;
  return `intent-${Date.now().toString(36)}-${intentSeq.toString(36)}`;
}

export class IntentRegistry {
  private readonly intents = new Map<string, PmxAxIntent>();
  private emit: IntentEmitter = () => {};
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  /** Inject the workbench SSE emitter (server.ts wires this at module load). */
  setEmitter(emitter: IntentEmitter | null): void {
    this.emit = emitter ?? (() => {});
  }

  list(): PmxAxIntent[] {
    return [...this.intents.values()];
  }

  /** Signal a new (or replace an existing) intent. Returns the stored envelope. */
  signal(raw: unknown): PmxAxIntent {
    const input = parseOrThrow(intentSignalSchema, raw, 'intent');
    requireKindFields(input.kind, input);

    const now = Date.now();
    const ttl = typeof input.ttlMs === 'number' ? input.ttlMs : DEFAULT_INTENT_TTL_MS;
    const id = input.id && this.intents.has(input.id) ? input.id : input.id ?? nextIntentId();
    const existing = this.intents.get(id);

    const intent: PmxAxIntent = {
      id,
      kind: input.kind,
      ...(input.position ? { position: input.position } : {}),
      ...(input.nodeId ? { nodeId: input.nodeId } : {}),
      ...(input.edge ? { edge: input.edge } : {}),
      ...(input.nodeType ? { nodeType: input.nodeType } : {}),
      ...(input.label ? { label: input.label } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      ...(typeof input.confidence === 'number' ? { confidence: input.confidence } : {}),
      ...(typeof input.seq === 'number' ? { seq: input.seq } : {}),
      ...(input.source ? { source: input.source } : {}),
      createdAt: existing?.createdAt ?? now,
      expiresAt: now + ttl,
    };

    this.intents.set(id, intent);
    this.evictOverflow();
    this.ensureSweeper();
    this.emit('ax-intent', { intent });
    return intent;
  }

  /** Patch a live intent (position/label/reason/confidence/seq) and bump its TTL. */
  update(id: string, raw: unknown): PmxAxIntent {
    const existing = this.intents.get(id);
    if (!existing) throw new OperationError(`No live intent "${id}".`, 404);
    const patch = parseOrThrow(intentUpdateSchema, raw, 'intent update');
    const now = Date.now();
    const ttl = typeof patch.ttlMs === 'number' ? patch.ttlMs : DEFAULT_INTENT_TTL_MS;

    const intent: PmxAxIntent = {
      ...existing,
      ...(patch.position ? { position: patch.position } : {}),
      ...(patch.nodeType ? { nodeType: patch.nodeType } : {}),
      ...(patch.label ? { label: patch.label } : {}),
      ...(patch.reason ? { reason: patch.reason } : {}),
      ...(typeof patch.confidence === 'number' ? { confidence: patch.confidence } : {}),
      ...(typeof patch.seq === 'number' ? { seq: patch.seq } : {}),
      expiresAt: now + ttl,
    };
    this.intents.set(id, intent);
    this.emit('ax-intent', { intent });
    return intent;
  }

  /**
   * Clear an intent. `settledNodeId` resolves it INTO a real node (the settle
   * morph); `vetoed` marks a human pre-emptive veto. Either way the ghost
   * dissolves. Returns true when an intent was actually removed.
   */
  clear(id: string, opts: { settledNodeId?: string; vetoed?: boolean } = {}): boolean {
    if (!this.intents.delete(id)) return false;
    this.emit('ax-intent-clear', {
      id,
      ...(opts.settledNodeId ? { nodeId: opts.settledNodeId, settled: true } : {}),
      ...(opts.vetoed ? { vetoed: true } : {}),
    });
    this.maybeStopSweeper();
    return true;
  }

  /** Drop every live intent without per-id SSE (used on hard resets). */
  reset(): void {
    this.intents.clear();
    this.maybeStopSweeper();
  }

  private evictOverflow(): void {
    while (this.intents.size > MAX_LIVE_INTENTS) {
      // Map preserves insertion order; the first key is the oldest live intent.
      const oldest = this.intents.keys().next().value as string | undefined;
      if (!oldest) break;
      this.intents.delete(oldest);
      this.emit('ax-intent-clear', { id: oldest, evicted: true });
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [id, intent] of this.intents) {
      if (intent.expiresAt <= now) {
        this.intents.delete(id);
        this.emit('ax-intent-clear', { id, expired: true });
      }
    }
    this.maybeStopSweeper();
  }

  private ensureSweeper(): void {
    if (this.sweepTimer || this.intents.size === 0) return;
    this.sweepTimer = setInterval(() => this.sweep(), 1000);
    // Don't keep the process (or a test runner) alive just for ghost expiry.
    (this.sweepTimer as { unref?: () => void }).unref?.();
  }

  private maybeStopSweeper(): void {
    if (this.sweepTimer && this.intents.size === 0) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }
}

/** Process-wide singleton, shared across HTTP handlers, MCP ops, and the SDK. */
export const intentRegistry = new IntentRegistry();
