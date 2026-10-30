/**
 * PMX Canvas MCP Server
 *
 * Exposes the canvas as an MCP tool server so any MCP-capable agent
 * (Claude Code, Codex, Cursor, Windsurf, pi, etc.) can control the
 * canvas with zero configuration beyond adding the server to their config.
 *
 * Auto-starts the HTTP server and opens the browser on first tool call.
 *
 * Usage in agent MCP config:
 * ```json
 * {
 *   "mcpServers": {
 *     "canvas": {
 *       "command": "bunx",
 *       "args": ["pmx-canvas", "--mcp"]
 *     }
 *   }
 * }
 * ```
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AX_SOURCES } from '../server/operations/ops/ax-shared.js';
import { describeCanvasSchema, stopCanvasServer } from '../server/index.js';
import { AX_INTERACTION_TYPES } from '../server/ax-interaction.js';
import { buildPendingAxActivity } from '../server/ax-state.js';
import {
  registerOperationTools,
  registerCompositeTools,
  registerOperationHelpTool,
} from '../server/operations/index.js';
import { agentSourceLabel } from '../server/operations/invoker.js';
import { contextReadFromPayload, pinnedBoardReads, graphReads } from '../server/context-reads.js';
import type { MemoryGraph } from '../shared/memory-graph.js';
import { createCanvasAccess, refreshCanvasAccess, type CanvasAccess } from './canvas-access.js';
import { buildSpatialContext } from '../server/spatial-analysis.js';
import {
  getCanvasNodeTitle,
  serializeCanvasLayoutForAgent,
  serializeCanvasNode,
  summarizeCanvasAnnotationForContext,
} from '../server/canvas-serialization.js';
import { listBundledSkills, readBundledSkill } from '../server/bundled-skills.js';
import { registerSkillExtension } from './skills.js';
import { ContextUriTemplate } from './context-uri-template.js';
import { registerResourceSubscriptions } from './resource-subscriptions.js';

// Resolved from the sibling package.json so it stays accurate through bunx,
// global npm installs, and repo-local runs (no hard-coded string, no build
// step required) — same mechanism as --version in src/cli/index.ts.
function readPackageVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function structuredSchemaDescription(): string {
  const routing = describeCanvasSchema().mcp.nodeTypeRouting;
  return Object.entries(routing)
    .map(([type, tool]) => `${type}: ${tool}`)
    .join(', ');
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function agentSafeFullLayoutPayload(layout: Awaited<ReturnType<CanvasAccess['getLayout']>>): Record<string, unknown> {
  return {
    ...serializeCanvasLayoutForAgent(layout),
    annotations: (layout.annotations ?? []).map((annotation) =>
      summarizeCanvasAnnotationForContext(annotation, layout.nodes),
    ),
  };
}

function buildSummaryFromLayout(
  layout: Awaited<ReturnType<CanvasAccess['getLayout']>>,
  pinnedIds: string[],
): Record<string, unknown> {
  const pinned = new Set(pinnedIds);
  const nodesByType: Record<string, number> = {};
  const pinnedTitles: string[] = [];
  for (const node of layout.nodes) {
    const serialized = serializeCanvasNode(node);
    nodesByType[serialized.kind] = (nodesByType[serialized.kind] ?? 0) + 1;
    if (pinned.has(node.id)) pinnedTitles.push(getCanvasNodeTitle(node) ?? node.id);
  }
  return {
    totalNodes: layout.nodes.length,
    totalEdges: layout.edges.length,
    totalAnnotations: (layout.annotations ?? []).length,
    annotations: (layout.annotations ?? []).map((annotation) =>
      summarizeCanvasAnnotationForContext(annotation, layout.nodes),
    ),
    nodesByType,
    pinnedCount: pinned.size,
    pinnedTitles,
    viewport: layout.viewport,
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'pmx-canvas', version: readPackageVersion() },
    {
      instructions:
        'Bundled workbench guidance: skill://pmx-canvas/SKILL.md. Discover skills via skills/list when supported, or canvas://skills; read files through resources/read. Skill delivery does not grant permission to execute bundled scripts.',
    },
  );
  let canvas: Promise<CanvasAccess> | undefined;
  const subscriptions = registerResourceSubscriptions(server, ensureCanvas);
  async function ensureCanvas(): Promise<CanvasAccess> {
    canvas = canvas ? canvas.then(refreshCanvasAccess) : createCanvasAccess();
    try {
      const access = await canvas;
      subscriptions.attach(access);
      return access;
    } catch (error) {
      canvas = undefined;
      throw error;
    }
  }
  registerSkillExtension(server);

  /**
   * Records what the agent actually received from a context resource or
   * prompt (plan-011). Instrumentation must never fail the read itself.
   */
  async function recordContextRead(
    c: CanvasAccess,
    channel: 'mcp-resource' | 'mcp-prompt',
    resource: string,
    text: string,
    target: { boardId: string | null; pinnedNodeIds: string[] },
  ): Promise<void> {
    try {
      const read = contextReadFromPayload(
        {
          channel,
          resource,
          source: agentSourceLabel('mcp'),
          consumer: server.server.getClientVersion()?.name ?? null,
          agentId: null,
          pinnedNodeIds: target.pinnedNodeIds,
          boardId: target.boardId,
        },
        text,
      );
      await c.recordContextRead(read);
    } catch (error) {
      console.error('[pmx-canvas mcp] recording a context read failed:', error);
    }
  }

  // ── Operation-registry tools (plan-005) ────────────────────────
  // Standalone tools are registered from the shared operation registry for
  // every op not folded into a composite (registerOperationTools skips
  // composite-folded ops — see compositeFoldedOpNames in composites.ts).
  // canvas_get_layout / canvas_get_node / canvas_add_node / canvas_update_node /
  // canvas_remove_node were folded into canvas_query / canvas_node and removed
  // as standalone tools in v0.3.0; they remain reachable via their composite
  // and canvas_batch. Remaining standalone tool names and compact/full payload
  // behavior are frozen (tests/unit/mcp-tool-freeze.test.ts, operation-parity.test.ts).
  registerOperationHelpTool(server);
  registerOperationTools(server, ensureCanvas);

  // ── Composite (action-discriminated) tools (plan-006) ───────────
  // Consolidate single-purpose tools into action-routed composites
  // (canvas_node, canvas_render, canvas_edge, canvas_group, canvas_history,
  // canvas_view, canvas_query, plus the AX composites). Each action dispatches
  // to the same registered operation as its standalone tool, so behavior is
  // identical. The legacy single-purpose tools these composites replace are
  // removed as of v0.3.0 per docs/api-stability.md. (canvas_snapshot composite
  // is deferred to v0.4 — its name is still held by the legacy save-snapshot
  // tool; the 6 snapshot standalones are deprecated in v0.3.0 and fold into it.)
  registerCompositeTools(server, ensureCanvas);

  const interactionResult = z.looseObject({
    ok: z.literal(true),
    type: z.enum(AX_INTERACTION_TYPES),
    sourceNodeId: z.string(),
    primitive: z.unknown(),
  });
  server.registerTool(
    'canvas_ax_interaction',
    {
      description:
        'Submit a capability-gated node AX interaction (work, evidence, approval, review, focus, steering or event). Rejected interactions return isError with { ok: false, code, error }.',
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
      outputSchema: interactionResult,
      inputSchema: {
        type: z
          .enum(AX_INTERACTION_TYPES)
          .describe('Interaction type, e.g. ax.work.create, ax.evidence.add, ax.focus.set.'),
        sourceNodeId: z.string().describe('The node emitting the interaction.'),
        payload: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Type-specific payload, e.g. {"title":"..."} for ax.work.create.'),
        sourceSurface: z.enum(['native-node', 'json-render', 'html-node', 'mcp-app', 'adapter']).optional(),
        correlationId: z.string().optional(),
        source: z.enum(AX_SOURCES).optional().describe('Optional host/source label. Defaults to mcp.'),
      },
    },
    async ({ type, sourceNodeId, payload, sourceSurface, correlationId, source }, extra) => {
      try {
        const c = await ensureCanvas();
        extra.signal.throwIfAborted();
        const result = await c.invoker().invoke(
          'ax.interaction.submit',
          {
            type,
            sourceNodeId,
            ...(payload ? { payload } : {}),
            ...(sourceSurface ? { sourceSurface } : {}),
            ...(correlationId ? { correlationId } : {}),
            source: source ?? 'mcp',
          },
          { signal: extra.signal },
        );
        const failure = z
          .object({ ok: z.literal(false), status: z.number(), code: z.string(), error: z.string() })
          .safeParse(result);
        const body = failure.success ? failure.data : interactionResult.parse(result);
        return {
          content: [{ type: 'text', text: JSON.stringify(body) }],
          // SDK clients validate structuredContent even on isError results.
          ...(failure.success ? { isError: true } : { structuredContent: body }),
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // canvas_claim_ax_delivery / canvas_mark_ax_delivery migrated to the operation
  // registry (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

  // canvas_request_elicitation / canvas_respond_elicitation / canvas_request_mode /
  // canvas_resolve_mode migrated to the operation registry (plan-007 Slice B
  // wave 2): src/server/operations/ops/ax-work.ts.

  const activityResult = z.object({
    ok: z.literal(true),
    event: z.looseObject({ id: z.string() }),
    workItem: z.looseObject({ id: z.string() }).nullable(),
    evidence: z.looseObject({ id: z.string() }).nullable(),
    review: z.looseObject({ id: z.string() }).nullable(),
  });
  server.registerTool(
    'canvas_ingest_activity',
    {
      description:
        'Ingest a harness activity. Always records an event. failure/error also creates blocked work, a review and log evidence; successful tool-result creates evidence. Override or suppress defaults with reactions. Returns IDs and records for event, workItem, evidence and review.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      outputSchema: activityResult,
      inputSchema: {
        kind: z.enum([
          'tool-start',
          'tool-result',
          'failure',
          'error',
          'session-start',
          'session-end',
          'command',
          'note',
        ]),
        title: z.string(),
        summary: z.string().optional(),
        outcome: z.enum(['success', 'failure']).optional(),
        ref: z
          .string()
          .optional()
          .describe(
            'A file path, URL, or commit the activity refers to (used as the review file anchor for failures).',
          ),
        nodeIds: z.array(z.string()).optional(),
        data: z.record(z.string(), z.unknown()).optional(),
        reactions: z
          .object({
            workItem: z
              .union([
                z.literal(false),
                z.object({
                  status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled']).optional(),
                  detail: z.string().nullable().optional(),
                }),
              ])
              .optional(),
            evidence: z
              .union([
                z.literal(false),
                z.object({
                  kind: z.enum(['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output']).optional(),
                  body: z.string().nullable().optional(),
                }),
              ])
              .optional(),
            review: z
              .union([
                z.literal(false),
                z.object({
                  severity: z.enum(['info', 'warning', 'error']).optional(),
                  kind: z.enum(['comment', 'finding']).optional(),
                  anchorType: z.enum(['node', 'file', 'region']).optional(),
                  nodeId: z.string().nullable().optional(),
                }),
              ])
              .optional(),
          })
          .optional()
          .describe('Override or suppress the kind-driven default reactions.'),
        source: z.enum(AX_SOURCES).optional(),
      },
    },
    async ({ kind, title, summary, outcome, ref, nodeIds, data, reactions, source }, extra) => {
      try {
        const c = await ensureCanvas();
        extra.signal.throwIfAborted();
        const result = await c.invoker().invoke(
          'ax.activity.ingest',
          {
            kind,
            title,
            ...(summary !== undefined ? { summary } : {}),
            ...(outcome !== undefined ? { outcome } : {}),
            ...(ref !== undefined ? { ref } : {}),
            ...(nodeIds !== undefined ? { nodeIds } : {}),
            ...(data !== undefined ? { data } : {}),
            ...(reactions !== undefined ? { reactions } : {}),
            source: source ?? 'mcp',
          },
          { signal: extra.signal },
        );
        const body = activityResult.parse(result);
        return { content: [{ type: 'text', text: JSON.stringify(body) }], structuredContent: body };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // canvas_await_approval / canvas_await_elicitation / canvas_await_mode migrated
  // to the operation registry (plan-007 Slice B wave 4):
  // src/server/operations/ops/ax-await.ts.

  // canvas_invoke_command migrated to the operation registry (plan-007 Slice B
  // wave 3): src/server/operations/ops/ax-timeline.ts.

  // canvas_set_ax_policy migrated to the operation registry
  // (plan-007 Slice B.1): src/server/operations/ops/ax-state.ts.

  // canvas_webview_status / canvas_webview_start / canvas_webview_stop /
  // canvas_evaluate / canvas_resize migrated to the operation registry
  // (plan-008 Wave 3): src/server/operations/ops/webview.ts (via the injected
  // webview runner). canvas_screenshot stays hand-written below — it returns a
  // binary image payload, which the registry's JSON wire shape does not model.

  // ── canvas_screenshot ─────────────────────────────────────────
  const screenshotResult = z.object({
    bytes: z.number().int().nonnegative(),
    backend: z.enum(['webkit', 'chrome']).nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  });
  server.registerTool(
    'canvas_screenshot',
    {
      description:
        'Capture an image and metadata from the active Bun.WebView session. Start it with canvas_webview action "start" first.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      outputSchema: screenshotResult,
      inputSchema: {
        format: z
          .enum(['png', 'jpeg', 'webp'])
          .optional()
          .describe('Screenshot format (default depends on Bun; png recommended)'),
        quality: z.number().optional().describe('Optional quality for lossy formats'),
      },
    },
    async ({ format, quality }, extra) => {
      try {
        const c = await ensureCanvas();
        extra.signal.throwIfAborted();
        const bytes = await c.screenshotAutomationWebView(
          {
            ...(format ? { format } : {}),
            ...(typeof quality === 'number' ? { quality } : {}),
          },
          extra.signal,
        );
        extra.signal.throwIfAborted();
        const status = await c.getAutomationWebViewStatus();
        const metadata = screenshotResult.parse({
          bytes: bytes.byteLength,
          backend: status.backend,
          width: status.width,
          height: status.height,
          mimeType: format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
        });
        return {
          structuredContent: metadata,
          content: [
            {
              type: 'image',
              data: encodeBase64(bytes),
              mimeType: format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png',
            },
            {
              type: 'text',
              text: JSON.stringify(metadata),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // ── MCP Resources: Canvas as Context ──────────────────────────
  //
  // The human pins nodes on the canvas → those nodes become the agent's
  // working context. Spatial arrangement IS semantic curation.

  server.resource(
    'schema',
    'canvas://schema',
    {
      description: `Machine-readable create schemas, canonical examples, json-render catalog details, and MCP node-type routing from the running PMX Canvas server version. Routing: ${structuredSchemaDescription()}.`,
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'canvas://schema',
          mimeType: 'application/json',
          text: JSON.stringify(describeCanvasSchema(), null, 2),
        },
      ],
    }),
  );

  server.resource(
    'pinned-context',
    'canvas://pinned-context',
    {
      description:
        'Content of all pinned nodes on the canvas. When the human pins nodes, ' +
        'they are telling the agent "this is what matters right now." Read this ' +
        'resource to get structured context from the canvas. pinnedBoards lists the ' +
        'boards in the working set (README summary and pinned card titles); their ' +
        'content arrives through canvas://context.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const readTarget = await c.prepareContextRead();
      const board = readTarget.boardId ?? undefined;
      // Content and lifecycle are captured by one synchronous server operation,
      // never joined across separate HTTP reads with different retirement state.
      const context = await c.invoker().invoke('pinned-context.get', { board });
      const text = JSON.stringify(context, null, 2);
      await recordContextRead(c, 'mcp-resource', 'canvas://pinned-context', text, readTarget);
      return {
        contents: [
          {
            uri: 'canvas://pinned-context',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'context',
    new ResourceTemplate(new ContextUriTemplate(), { list: undefined }),
    {
      description:
        'Budgeted cross-board context brief. budget is a maximum number of UTF-16 characters; consumer selects a durable board-scoped delivery cursor, while since requests an explicit revision.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const c = await ensureCanvas();
      const input: Record<string, unknown> = {};
      if (uri.searchParams.has('consumer')) input.consumer = uri.searchParams.get('consumer');
      if (uri.searchParams.has('budget')) input.budget = uri.searchParams.get('budget');
      if (uri.searchParams.has('since')) input.since = uri.searchParams.get('since');
      // MCP invokers skip registry recording (proxied reads), so record here like
      // the other context resources: the open board, then each pinned board
      // delivered in full.
      const readTarget = await c.prepareContextRead();
      const document = await c.invoker().invoke('context.get', { ...input, expectedBoardId: readTarget.boardId });
      const text = JSON.stringify(document);
      await recordContextRead(c, 'mcp-resource', 'canvas://context', text, readTarget);
      try {
        const base = {
          channel: 'mcp-resource' as const,
          resource: 'canvas://context',
          source: agentSourceLabel('mcp'),
          consumer: server.server.getClientVersion()?.name ?? null,
          agentId: null,
        };
        for (const read of pinnedBoardReads(base, text)) await c.recordContextRead(read);
      } catch (error) {
        console.error('[pmx-canvas mcp] recording a pinned-board read failed:', error);
      }
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'memory-graph',
    new ResourceTemplate(new ContextUriTemplate('graph', ['focus', 'depth']), { list: undefined }),
    {
      description:
        'The same connected-memory projection Home draws. Focus on a board ID, qualified card key, or pins; depth 0–4. Summaries are seen, not full reads.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const c = await ensureCanvas();
      const input: Record<string, unknown> = {};
      if (uri.searchParams.has('focus')) input.focus = uri.searchParams.get('focus');
      if (uri.searchParams.has('depth')) input.depth = uri.searchParams.get('depth');
      const graph = (await c.invoker().invoke('memory-graph.get', input)) as MemoryGraph;
      for (const read of graphReads(
        {
          channel: 'mcp-resource',
          resource: 'canvas://graph',
          source: agentSourceLabel('mcp'),
          consumer: server.server.getClientVersion()?.name ?? null,
          agentId: null,
        },
        graph,
      ))
        await c.recordContextRead(read);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(graph) }] };
    },
  );

  server.resource(
    'ax-state',
    'canvas://ax',
    {
      description:
        'Host-agnostic PMX AX state. This includes canvas-bound collaboration primitives such as the current AX focus.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const state = await c.getAxState();
      return {
        contents: [
          {
            uri: 'canvas://ax',
            mimeType: 'application/json',
            text: JSON.stringify({ state }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'ax-context',
    'canvas://ax-context',
    {
      description: 'Agent-ready PMX AX context combining pinned context, focus, and surface metadata.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const context = await c.getAxContext({ consumer: 'mcp' });
      const text = JSON.stringify(context, null, 2);
      await recordContextRead(c, 'mcp-resource', 'canvas://ax-context', text, {
        boardId: context.boardId,
        pinnedNodeIds: context.pinned.nodeIds,
      });
      return {
        contents: [
          {
            uri: 'canvas://ax-context',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'ax-timeline',
    'canvas://ax-timeline',
    {
      description:
        'Bounded PMX AX timeline: recent agent-events, evidence, and steering messages with counts. Persisted for diagnostics and continuity; not restored by snapshots.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const timeline = await c.getAxTimeline();
      return {
        contents: [
          {
            uri: 'canvas://ax-timeline',
            mimeType: 'application/json',
            text: JSON.stringify(timeline, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'ax-work',
    'canvas://ax-work',
    {
      description:
        'Canvas-bound PMX AX work state: work items, approval gates, and review annotations. Participates in snapshots and restore.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const [workItems, approvalGates] = await Promise.all([c.listWorkItems(), c.listApprovalGates()]);
      const state = await c.getAxState();
      return {
        contents: [
          {
            uri: 'canvas://ax-work',
            mimeType: 'application/json',
            text: JSON.stringify(
              {
                workItems,
                approvalGates,
                reviewAnnotations: state.reviewAnnotations,
                elicitations: state.elicitations,
                modeRequests: state.modeRequests,
                policy: state.policy,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.resource(
    'ax-pending-steering',
    'canvas://ax-pending-steering',
    {
      description:
        'Adapterless AX delivery surface. `pending`: undelivered steering messages to claim and act on, then mark via canvas_ax_delivery { action: "mark" }. `pendingActivity`: open canvas-bound AX items awaiting the agent (open work items, pending approval gates / elicitations / mode requests) — usually created by the human in the browser; these fire ax-state-changed (resource-subscribers are also pushed canvas://ax-work). Resolve pendingActivity via its own tool, not the delivery mark action. Use canvas_ax_delivery { action: "claim" } for the loop-safe, consumer-scoped view.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const [pending, state] = await Promise.all([c.getPendingSteering(), c.getAxState()]);
      const pendingActivity = buildPendingAxActivity(state);
      return {
        contents: [
          {
            uri: 'canvas://ax-pending-steering',
            mimeType: 'application/json',
            text: JSON.stringify({ pending, pendingActivity }, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    'ax-delivery',
    'canvas://ax-delivery',
    {
      description:
        'PMX AX steering delivery state: recent steering messages with their delivered flag, for delivery diagnostics.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const timeline = await c.getAxTimeline();
      return {
        contents: [
          {
            uri: 'canvas://ax-delivery',
            mimeType: 'application/json',
            text: JSON.stringify({ steering: timeline.steering }, null, 2),
          },
        ],
      };
    },
  );

  server.prompt(
    'pmx-current-context',
    'Inject the current PMX Canvas AX context (pins, focus, work items, approvals, review, timeline) so an MCP-aware client can ground its next action without a host-native adapter.',
    async () => {
      const c = await ensureCanvas();
      const context = await c.getAxContext({ consumer: 'mcp' });
      const text = `Current PMX Canvas context:\n\n${JSON.stringify(context, null, 2)}`;
      await recordContextRead(c, 'mcp-prompt', 'pmx-current-context', text, {
        boardId: context.boardId,
        pinnedNodeIds: context.pinned.nodeIds,
      });
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text },
          },
        ],
      };
    },
  );

  server.resource(
    'canvas-layout',
    'canvas://layout',
    {
      description:
        'The full canvas layout — all nodes, edges, and viewport state. ' +
        'Use this to understand the complete spatial workspace.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const readTarget = await c.prepareContextRead();
      const layout = agentSafeFullLayoutPayload(await c.getLayout(readTarget.boardId ?? undefined));
      const text = JSON.stringify(layout, null, 2);
      await recordContextRead(c, 'mcp-resource', 'canvas://layout', text, readTarget);
      return {
        contents: [
          {
            uri: 'canvas://layout',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'canvas-boards',
    'canvas://boards',
    {
      description:
        'The boards in this workspace with their folders, most recently opened first, and which one is ' +
        'open (activeBoardId; null = Home). Writes go to the open board; use canvas_board action "open" to switch the shared workbench.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const boards = await c.invoker().invoke('board.list', {});
      return {
        contents: [{ uri: 'canvas://boards', mimeType: 'application/json', text: JSON.stringify(boards, null, 2) }],
      };
    },
  );

  server.resource(
    'canvas-summary',
    'canvas://summary',
    {
      description:
        'A compact summary of the canvas: node count by type, edge count, ' +
        'pinned node titles. Useful for quick orientation without reading all content.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const readTarget = await c.prepareContextRead();
      const text = JSON.stringify(
        buildSummaryFromLayout(await c.getLayout(readTarget.boardId ?? undefined), readTarget.pinnedNodeIds),
        null,
        2,
      );
      await recordContextRead(c, 'mcp-resource', 'canvas://summary', text, readTarget);
      return {
        contents: [
          {
            uri: 'canvas://summary',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'spatial-context',
    'canvas://spatial-context',
    {
      description:
        'Spatial intelligence for the canvas. Detects proximity clusters (nodes the human ' +
        'grouped together), provides reading order (top-left to bottom-right), and shows ' +
        'neighborhoods around pinned nodes (nearby unpinned nodes the human implicitly associated). ' +
        'This makes "spatial arrangement is communication" real — read this to understand the ' +
        "human's spatial intent, not just which nodes are pinned.",
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const readTarget = await c.prepareContextRead();
      const layout = await c.getLayout(readTarget.boardId ?? undefined);
      const spatial = buildSpatialContext(
        layout.nodes,
        layout.edges,
        new Set(readTarget.pinnedNodeIds),
        layout.annotations ?? [],
      );
      const text = JSON.stringify(spatial, null, 2);
      await recordContextRead(c, 'mcp-resource', 'canvas://spatial-context', text, readTarget);
      return {
        contents: [
          {
            uri: 'canvas://spatial-context',
            mimeType: 'application/json',
            text,
          },
        ],
      };
    },
  );

  server.resource(
    'history',
    'canvas://history',
    {
      description:
        'Mutation history timeline for the canvas. Shows what changed and when, ' +
        'with undo/redo position. Read this to understand how the canvas evolved ' +
        'during this session — useful for metacognition and tracking your own actions.',
      mimeType: 'text/plain',
    },
    async () => {
      const c = await ensureCanvas();
      return {
        contents: [
          {
            uri: 'canvas://history',
            mimeType: 'text/plain',
            text: (await c.getHistory()).text,
          },
        ],
      };
    },
  );

  server.resource(
    'code-graph',
    'canvas://code-graph',
    {
      description:
        'Auto-detected dependency graph between file nodes on the canvas. Shows which files import ' +
        'which other files, central files (most depended on), and isolated files. Dependencies are ' +
        'parsed from import/require/from statements in JS/TS/Python/Go/Rust. Edges are created and ' +
        'updated automatically as file nodes are added or files change.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const summary = (await c.getCodeGraph()).summary;
      return {
        contents: [
          {
            uri: 'canvas://code-graph',
            mimeType: 'application/json',
            text: JSON.stringify(summary, null, 2),
          },
        ],
      };
    },
  );

  // ── canvas://skills ────────────────────────────────────────
  // Discoverability for the skill prompts bundled with the npm package
  // (skills/<name>/SKILL.md). Before 0.1.2 these files shipped but were
  // invisible to agents — building web artifacts without the companion
  // `web-artifacts-builder` skill led to predictable misuse.
  // The index lists every bundled skill with its frontmatter description;
  // individual skills are served verbatim at canvas://skills/<name>.
  server.resource(
    'bundled-skills',
    'canvas://skills',
    {
      description:
        'Index of agent skills bundled with this PMX Canvas install. Lists name, ' +
        'description, and per-skill URI (canvas://skills/<name>). Read a specific ' +
        'skill for workflow guidance — notably web-artifacts-builder for ' +
        'canvas_app { action: "build-artifact" }, and pmx-canvas for the broader workbench.',
      mimeType: 'application/json',
    },
    async () => {
      const skills = listBundledSkills();
      const index = {
        count: skills.length,
        skills: skills.map((s) => ({ name: s.name, description: s.description, uri: s.uri })),
      };
      return {
        contents: [
          {
            uri: 'canvas://skills',
            mimeType: 'application/json',
            text: JSON.stringify(index, null, 2),
          },
        ],
      };
    },
  );

  // Register each bundled skill as its own resource so agents can address
  // them individually (canvas://skills/web-artifacts-builder, etc.) and
  // MCP clients can display them with per-skill descriptions.
  for (const skill of listBundledSkills()) {
    server.resource(
      `skill-${skill.name}`,
      skill.uri,
      {
        description: skill.description || `Bundled PMX Canvas skill: ${skill.name}`,
        mimeType: 'text/markdown',
      },
      async () => {
        const markdown = readBundledSkill(skill.name);
        return {
          contents: [
            {
              uri: skill.uri,
              mimeType: 'text/markdown',
              text: markdown ?? `# ${skill.name}\n\n_Skill file not found on disk._\n`,
            },
          ],
        };
      },
    );
  }

  // canvas_batch migrated to the operation registry (plan-008 Wave 2):
  // src/server/operations/ops/batch.ts.
  // canvas_validate migrated to the operation registry (plan-008 Wave 1):
  // src/server/operations/ops/validate.ts.

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Exit when the stdio channel closes (0.4.5 report Finding Y): without this,
  // a client that completes the official close sequence leaves this process
  // orphaned — the auto-started canvas server and its timers keep the event
  // loop alive forever. stopCanvasServer() checkpoints the SQLite DB before
  // exit and is a no-op when this process only attached to a remote daemon.
  const disposeSubscriptions = server.server.onclose;
  const shutdown = (): void => {
    disposeSubscriptions?.();
    try {
      stopCanvasServer();
      process.exit(0);
    } catch (error) {
      console.error('Shutdown refused: canvas changes could not be saved. Fix persistence and retry shutdown.', error);
    }
  };
  server.server.onclose = shutdown;
  process.stdin.on('end', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Allow direct execution: bun run src/mcp/server.ts
if (import.meta.main) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
