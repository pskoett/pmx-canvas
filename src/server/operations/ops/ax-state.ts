/**
 * Plan-007 Slice B.1 operations: the four AX "state" reads/mutators —
 * ax.get / ax.focus.set / ax.policy.set / ax.host-capability.report.
 *
 * These do NOT change the node/edge layout, so every op is `mutates: false`
 * (no `canvas-layout-update`). The three mutators emit the SAME AX SSE frame
 * the legacy handlers emitted — `ax-state-changed` via `ctx.emit` — and the
 * injected emitter adds the `sessionId`/`timestamp` envelope fields the legacy
 * handlers set explicitly (see server.ts emitPrimaryWorkbenchEvent).
 *
 * Source defaulting matches the legacy surfaces exactly: MCP `buildInput`
 * injects `source: 'mcp'`; the HTTP handlers default an absent source to 'api'.
 *
 * Cross-surface unification (documented, same class as plan-005 slices 1–4):
 * the legacy HTTP `GET /api/canvas/ax` served only `{ ok, state }`, while the
 * legacy `canvas_get_ax` MCP tool aggregated `{ ok, state, host, context }` via
 * three separate access calls. One op = one wire body, so `ax.get` now serves
 * the FULL aggregate over HTTP too. (No HTTP test asserted the slim body; they
 * only read `state.*`.) MCP `buildInput` passes `consumer: 'mcp'` so the
 * context's compact delivery lead block stays loop-filtered for MCP, as before.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState } from '../../canvas-state.js';
import { buildCanvasAxContext } from '../../ax-context.js';
import type { PmxAxPolicy } from '../../ax-state.js';
import { defineOperation, type Operation } from '../types.js';
import { isRecord } from './nodes.js';
import { AX_SOURCES, normalizeAxNodeIds, normalizeAxSource } from './ax-shared.js';

// ── ax.get (canvas_get_ax) ────────────────────────────────────

const axGetShape = {
  includeContext: z.unknown().optional().describe('Include serialized agent-ready AX context. Default true.'),
  // `consumer` is read by the handler (HTTP callers may pass ?consumer=) but is
  // intentionally NOT in the advertised shape: agents must not override it (MCP
  // buildInput forces 'mcp' for loop-safe delivery filtering). The loose schema
  // still passes a query-supplied `consumer` through to the handler.
};

const axGetSchema = z.looseObject(axGetShape);

const axGetOperation = defineOperation<z.infer<typeof axGetSchema>, Record<string, unknown>>({
  name: 'ax.get',
  mutates: false,
  input: axGetSchema,
  inputShape: axGetShape,
  http: {
    method: 'GET',
    path: '/api/canvas/ax',
  },
  mcp: {
    toolName: 'canvas_get_ax',
    description:
      'Read the host-agnostic PMX AX state and agent-ready AX context. Use this when you need pinned context plus the current focus field.',
    extraShape: {
      includeContext: z.boolean().optional().describe('Include serialized agent-ready AX context. Default true.'),
    },
    // The legacy MCP tool aggregated state + host + (consumer:'mcp') context.
    buildInput: (input) => ({
      ...(input.includeContext === false ? { includeContext: false } : {}),
      consumer: 'mcp',
    }),
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }),
  },
  handler: (input) => {
    const state = canvasState.getAxState();
    const host = canvasState.getHostCapability();
    const consumer = typeof input.consumer === 'string' ? input.consumer : undefined;
    // `false` over MCP (boolean) or `'false'` over HTTP query (string) both skip context.
    const excludeContext = input.includeContext === false || input.includeContext === 'false';
    const context = excludeContext ? undefined : buildCanvasAxContext(consumer);
    return {
      ok: true,
      state,
      host,
      ...(context ? { context } : {}),
    } as unknown as Record<string, unknown>;
  },
});

// ── ax.focus.set (canvas_set_ax_focus) ────────────────────────

const axFocusSetShape = {
  nodeIds: z.unknown().optional().describe('Node IDs to place in the AX focus field. Missing nodes are ignored.'),
  source: z
    .unknown()
    .optional()
    .describe(
      'Optional host/source label for adapter-originated focus. Defaults to mcp. Use codex from the Codex app adapter.',
    ),
};

const axFocusSetSchema = z.looseObject(axFocusSetShape);

const axFocusSetOperation = defineOperation<z.infer<typeof axFocusSetSchema>, Record<string, unknown>>({
  name: 'ax.focus.set',
  mutates: false,
  input: axFocusSetSchema,
  inputShape: axFocusSetShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/focus',
  },
  mcp: {
    toolName: 'canvas_set_ax_focus',
    description:
      'Set the PMX AX focus field without requiring viewport movement. Focus is persisted and available through canvas://ax-context.',
    extraShape: {
      nodeIds: z.array(z.string()).describe('Node IDs to place in the AX focus field. Missing nodes are ignored.'),
      source: z
        .enum(AX_SOURCES)
        .optional()
        .describe(
          'Optional host/source label for adapter-originated focus. Defaults to mcp. Use codex from the Codex app adapter.',
        ),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, focus: body.focus }) }],
      };
    },
  },
  handler: (input, ctx) => {
    const nodeIds = normalizeAxNodeIds(input.nodeIds);
    const source = normalizeAxSource(input.source, 'api');
    const focus = canvasState.setAxFocus(nodeIds, { source });
    ctx.emit('ax-state-changed', { focus });
    return { ok: true, focus } as unknown as Record<string, unknown>;
  },
});

// ── ax.policy.set (canvas_set_ax_policy) ──────────────────────

const axPolicySetShape = {
  tools: z.unknown().optional().describe('Tool policy patch: allowed/excluded/approvalRequired arrays.'),
  prompt: z.unknown().optional().describe('Prompt policy patch: systemAppend/mode.'),
  scope: z
    .unknown()
    .optional()
    .describe(
      'Scope fence (human-owned, set from the workbench): { nodeIds, padding? } limits agent WRITES to those nodes plus padding px around them; null clears it. Agent calls that include it are refused (403) — read policy.scope instead.',
    ),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axPolicySetSchema = z.looseObject(axPolicySetShape);

/**
 * A fence is a granted REGION: fencing a group frame grants everything inside
 * it, so group ids expand to their members (nested groups included). Without
 * this, "Fence to selection" on a frame lets the agent touch the frame only.
 */
function withGroupMembers(nodeIds: string[]): string[] {
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const node = canvasState.getNode(id);
    if (node?.type === 'group' && Array.isArray(node.data.children)) {
      for (const child of node.data.children) if (typeof child === 'string') visit(child);
    }
  };
  for (const id of nodeIds) visit(id);
  return [...out];
}

const axPolicySetOperation = defineOperation<z.infer<typeof axPolicySetSchema>, Record<string, unknown>>({
  name: 'ax.policy.set',
  mutates: false,
  input: axPolicySetSchema,
  inputShape: axPolicySetShape,
  http: {
    method: 'POST',
    path: '/api/canvas/ax/policy',
  },
  mcp: {
    toolName: 'canvas_set_ax_policy',
    description:
      'Set the declarative AX policy (allowed/excluded/approval-required tools; prompt mode/append). PMX stores it and exposes it via canvas://ax-context; host adapters READ and enforce it. Merges with the existing policy.',
    extraShape: {
      tools: z
        .object({
          allowed: z.array(z.string()).optional(),
          excluded: z.array(z.string()).optional(),
          approvalRequired: z.array(z.string()).optional(),
        })
        .optional(),
      prompt: z.object({ systemAppend: z.string().optional(), mode: z.string().optional() }).optional(),
      source: z.enum(AX_SOURCES).optional(),
    },
    // Legacy MCP tool forwarded only the present tools/prompt fields (source split out).
    // The scope fence is human-owned (see checkScopeOwnership) — MCP callers
    // are agents, so the tool neither advertises nor forwards `scope`.
    buildInput: (input) => ({
      ...(input.tools ? { tools: input.tools } : {}),
      ...(input.prompt ? { prompt: input.prompt } : {}),
      source: normalizeAxSource(input.source, 'mcp'),
    }),
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, policy: body.policy }) }],
      };
    },
  },
  handler: (input, ctx) => {
    const patch: {
      tools?: Partial<PmxAxPolicy['tools']>;
      prompt?: Partial<PmxAxPolicy['prompt']>;
      scope?: { nodeIds: string[]; padding?: number } | null;
    } = {};
    if (isRecord(input.tools)) patch.tools = input.tools as Partial<PmxAxPolicy['tools']>;
    if (isRecord(input.prompt)) patch.prompt = input.prompt as Partial<PmxAxPolicy['prompt']>;
    if (input.scope === null) patch.scope = null;
    else if (isRecord(input.scope)) {
      const nodeIds = withGroupMembers(
        Array.isArray(input.scope.nodeIds)
          ? input.scope.nodeIds.filter((id): id is string => typeof id === 'string')
          : [],
      );
      const padding = Number(input.scope.padding);
      patch.scope = nodeIds.length > 0 ? { nodeIds, ...(Number.isFinite(padding) ? { padding } : {}) } : null;
    }
    const policy = canvasState.setPolicy(patch, { source: normalizeAxSource(input.source, 'api') });
    ctx.emit('ax-state-changed', { policy });
    if (patch.scope !== undefined) {
      // The agent reads the timeline — tell it the fence moved, and why its
      // next write outside it will be refused.
      const event = canvasState.recordAxEvent(
        {
          kind: 'policy',
          summary: policy.scope
            ? `Scope fence set: agent writes limited to ${policy.scope.nodeIds.length} node${policy.scope.nodeIds.length === 1 ? '' : 's'} (reads unaffected).`
            : 'Scope fence cleared: the agent may write anywhere on the board.',
          nodeIds: policy.scope?.nodeIds ?? [],
          data: { policy: 'scope-fence', nodeIds: policy.scope?.nodeIds ?? [] },
        },
        { source: normalizeAxSource(input.source, 'browser') },
      );
      ctx.emit('ax-event-created', { event });
    }
    return { ok: true, policy } as unknown as Record<string, unknown>;
  },
});

// ── ax.host-capability.report (canvas_report_host_capability) ──

const axHostCapabilityReportShape = {
  host: z.unknown().optional().describe('Host identifier (e.g. copilot, codex).'),
  canvas: z.unknown().optional(),
  hooks: z.unknown().optional(),
  tools: z.unknown().optional(),
  sessionMessaging: z.unknown().optional(),
  permissions: z.unknown().optional(),
  files: z.unknown().optional(),
  uiPrompts: z.unknown().optional(),
  raw: z.unknown().optional().describe('Optional raw capability payload for diagnostics.'),
  source: z.unknown().optional().describe('Optional host/source label. Defaults to mcp.'),
};

const axHostCapabilityReportSchema = z.looseObject(axHostCapabilityReportShape);

const axHostCapabilityReportOperation = defineOperation<
  z.infer<typeof axHostCapabilityReportSchema>,
  Record<string, unknown>
>({
  name: 'ax.host-capability.report',
  mutates: false,
  input: axHostCapabilityReportSchema,
  inputShape: axHostCapabilityReportShape,
  http: {
    // Legacy route is PUT (not POST) /api/canvas/ax/host-capability.
    method: 'PUT',
    path: '/api/canvas/ax/host-capability',
  },
  mcp: {
    toolName: 'canvas_report_host_capability',
    description:
      'Report host/session capability from an adapter: what the host can do (canvas/hooks/tools/sessionMessaging/permissions/files/uiPrompts). Stored for diagnostics; core does not depend on a host.',
    extraShape: {
      host: z.string().optional().describe('Host identifier (e.g. copilot, codex).'),
      canvas: z.boolean().optional(),
      hooks: z.boolean().optional(),
      tools: z.boolean().optional(),
      sessionMessaging: z.boolean().optional(),
      permissions: z.boolean().optional(),
      files: z.boolean().optional(),
      uiPrompts: z.boolean().optional(),
      raw: z.record(z.string(), z.unknown()).optional().describe('Optional raw capability payload for diagnostics.'),
      source: z.enum(AX_SOURCES).optional().describe('Optional host/source label. Defaults to mcp.'),
    },
    buildInput: (input) => ({ ...input, source: normalizeAxSource(input.source, 'mcp') }),
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, host: body.host }) }],
      };
    },
  },
  handler: (input, ctx) => {
    // setHostCapability normalizes only the known capability keys; an extra
    // `source` field is ignored, so passing the whole input (legacy HTTP) and
    // passing source-stripped capability (legacy MCP) are equivalent.
    const host = canvasState.setHostCapability(input, { source: normalizeAxSource(input.source, 'api') });
    ctx.emit('ax-state-changed', { host });
    return { ok: true, host } as unknown as Record<string, unknown>;
  },
});

export const axStateOperations: Operation[] = [
  axGetOperation,
  axFocusSetOperation,
  axPolicySetOperation,
  axHostCapabilityReportOperation,
];
