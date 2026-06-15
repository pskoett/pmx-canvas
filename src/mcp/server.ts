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

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { canvasState, describeCanvasSchema } from '../server/index.js';
import { AX_INTERACTION_TYPES } from '../server/ax-interaction.js';
import { buildPendingAxActivity } from '../server/ax-state.js';
import { isHtmlPrimitiveKind } from '../server/html-primitives.js';
import type { HtmlPrimitiveKind } from '../server/html-primitives.js';
import { registerOperationTools, registerCompositeTools } from '../server/operations/index.js';
import { createCanvasAccess, refreshCanvasAccess, type CanvasAccess } from './canvas-access.js';
import { serializeNodeForAgentContext } from '../server/agent-context.js';
import { buildSpatialContext, findNeighborhoods } from '../server/spatial-analysis.js';
import {
  getCanvasNodeTitle,
  serializeCanvasLayoutForAgent,
  serializeCanvasNode,
  serializeCanvasNodeForAgent,
  summarizeCanvasAnnotationForContext,
} from '../server/canvas-serialization.js';
import { listBundledSkills, readBundledSkill } from '../server/bundled-skills.js';

let canvas: CanvasAccess | null = null;
let resourceNotificationServer: McpServer | null = null;
let localResourceNotificationsStarted = false;
let remoteResourceNotificationsBaseUrl: string | null = null;

const htmlPrimitiveKindSchema = z.string().refine(isHtmlPrimitiveKind, 'Unknown HTML primitive kind');

function structuredSchemaDescription(): string {
  const routing = describeCanvasSchema().mcp.nodeTypeRouting;
  return Object.entries(routing)
    .map(([type, tool]) => `${type}: ${tool}`)
    .join(', ');
}

// workspaceRoot / isPathInside / safeWorkspacePath removed with the
// canvas_build_web_artifact MCP tool (plan-008 Wave 4). The webartifact.build op
// sandboxes projectPath/outputPath via web-artifacts.ts resolveWorkspacePath.

async function ensureCanvas(): Promise<CanvasAccess> {
  if (!canvas) {
    canvas = await createCanvasAccess();
  } else {
    canvas = await refreshCanvasAccess(canvas);
  }
  startResourceNotifications(canvas);
  return canvas;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function sendCanvasResourceNotifications(type: 'nodes' | 'pins' | 'ax' | 'ax-timeline' = 'nodes'): void {
  const server = resourceNotificationServer;
  if (!server) return;
  try {
    if (type === 'pins') {
      server.server.sendResourceUpdated({ uri: 'canvas://pinned-context' });
    }
    if (type === 'pins' || type === 'ax') {
      server.server.sendResourceUpdated({ uri: 'canvas://ax' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-context' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-timeline' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-work' });
    }
    if (type === 'ax-timeline') {
      server.server.sendResourceUpdated({ uri: 'canvas://ax-timeline' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-context' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-pending-steering' });
      server.server.sendResourceUpdated({ uri: 'canvas://ax-delivery' });
    }
    server.server.sendResourceUpdated({ uri: 'canvas://layout' });
    server.server.sendResourceUpdated({ uri: 'canvas://summary' });
    server.server.sendResourceUpdated({ uri: 'canvas://spatial-context' });
    server.server.sendResourceUpdated({ uri: 'canvas://history' });
    server.server.sendResourceUpdated({ uri: 'canvas://code-graph' });
  } catch (error) {
    console.debug('[mcp] resource notification failed', error);
  }
}

function handleRemoteSseFrame(frame: string): void {
  const eventLine = frame.split('\n').find((line) => line.startsWith('event: '));
  const event = eventLine?.slice('event: '.length).trim() ?? '';
  if (!event || event === 'connected' || event === 'ping') return;
  sendCanvasResourceNotifications(
    event === 'context-pins-changed'
      ? 'pins'
      : event === 'ax-state-changed'
        ? 'ax'
        : event === 'ax-event-created'
          ? 'ax-timeline'
          : 'nodes',
  );
}

async function watchRemoteCanvasEvents(baseUrl: string): Promise<void> {
  const decoder = new TextDecoder();
  while (true) {
    try {
      const response = await fetch(`${baseUrl}/api/workbench/events`);
      if (!response.ok || !response.body) {
        await sleep(1_000);
        continue;
      }

      const reader = response.body.getReader();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) handleRemoteSseFrame(frame);
      }
    } catch (error) {
      console.debug('[mcp] remote canvas event stream failed', error);
    }
    await sleep(1_000);
  }
}

function startResourceNotifications(c: CanvasAccess): void {
  const server = resourceNotificationServer;
  if (!server) return;

  if (c.remoteBaseUrl) {
    if (remoteResourceNotificationsBaseUrl !== c.remoteBaseUrl) {
      remoteResourceNotificationsBaseUrl = c.remoteBaseUrl;
      void watchRemoteCanvasEvents(c.remoteBaseUrl);
    }
    return;
  }

  if (localResourceNotificationsStarted) return;
  localResourceNotificationsStarted = true;

  canvasState.onChange((type) => {
    sendCanvasResourceNotifications(type);
  });
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function wantsFullPayload(input: { full?: boolean; verbose?: boolean; includeData?: boolean } = {}): boolean {
  return input.full === true || input.verbose === true || input.includeData === true;
}

function compactNodePayload(node: Awaited<ReturnType<CanvasAccess['getNode']>>): Record<string, unknown> | null {
  if (!node) return null;
  const serialized = serializeCanvasNode(node);
  return {
    id: serialized.id,
    type: serialized.type,
    kind: serialized.kind,
    title: serialized.title,
    content: serialized.content,
    position: serialized.position,
    size: serialized.size,
    pinned: serialized.pinned,
    collapsed: serialized.collapsed,
    dockPosition: serialized.dockPosition,
    provenance: serialized.provenance,
  };
}

function compactLayoutPayload(layout: Awaited<ReturnType<CanvasAccess['getLayout']>>, pinnedIds: string[]): Record<string, unknown> {
  return {
    summary: buildSummaryFromLayout(layout, pinnedIds),
    viewport: layout.viewport,
    annotations: (layout.annotations ?? []).map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
    nodes: layout.nodes.map((node) => compactNodePayload(node)).filter((node): node is Record<string, unknown> => node !== null),
    edges: layout.edges.map((edge) => ({
      id: edge.id,
      from: edge.from,
      to: edge.to,
      type: edge.type,
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.style ? { style: edge.style } : {}),
      ...(edge.animated !== undefined ? { animated: edge.animated } : {}),
    })),
  };
}

function agentSafeFullLayoutPayload(layout: Awaited<ReturnType<CanvasAccess['getLayout']>>): Record<string, unknown> {
  return {
    ...serializeCanvasLayoutForAgent(layout),
    annotations: (layout.annotations ?? []).map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
  };
}

async function createdNodePayload(c: CanvasAccess, id: string, options: { full?: boolean; verbose?: boolean; includeData?: boolean } = {}): Promise<Record<string, unknown>> {
  // Expose both `id` and a `nodeId` alias on every node-create response so
  // agents using either key (or a cached schema) work — matching the
  // external-app / web-artifact responses that already return both.
  const node = await c.getNode(id);
  if (!node) return { ok: true, id, nodeId: id };
  if (!wantsFullPayload(options)) {
    return { ok: true, node: compactNodePayload(node), id, nodeId: id };
  }
  const serialized = serializeCanvasNodeForAgent(node);
  return { ok: true, node: serialized, ...serialized, nodeId: node.id };
}

function buildSummaryFromLayout(layout: Awaited<ReturnType<CanvasAccess['getLayout']>>, pinnedIds: string[]): Record<string, unknown> {
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
    annotations: (layout.annotations ?? []).map((annotation) => summarizeCanvasAnnotationForContext(annotation, layout.nodes)),
    nodesByType,
    pinnedCount: pinned.size,
    pinnedTitles,
    viewport: layout.viewport,
  };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'pmx-canvas',
    version: '0.1.0',
  });
  resourceNotificationServer = server;

  // ── Operation-registry tools (plan-005) ────────────────────────
  // canvas_get_layout / canvas_get_node / canvas_add_node /
  // canvas_update_node / canvas_remove_node are registered from the shared
  // operation registry. Tool names and compact/full payload behavior are
  // frozen (tests/unit/mcp-tool-freeze.test.ts, operation-parity.test.ts).
  registerOperationTools(server, ensureCanvas);

  // ── Composite (action-discriminated) tools (plan-006) ───────────
  // Consolidate single-purpose tools into action-routed composites
  // (canvas_node, canvas_render, canvas_edge, canvas_group, canvas_history,
  // canvas_view, canvas_query, plus the AX composites). Each action dispatches
  // to the same registered operation as its standalone tool, so behavior is
  // identical. Additive in v0.2 (legacy tools still registered below); legacy
  // removed in v0.3 per docs/api-stability.md. (canvas_snapshot composite is
  // deferred to v0.3 — its name is still held by the legacy save-snapshot tool.)
  registerCompositeTools(server, ensureCanvas);

  // ── canvas_add_html_node ────────────────────────────────────────
  server.tool(
    'canvas_add_html_node',
    'Add a normal html node: a self-contained HTML document (with optional inline <script> and CDN <script src="...">) rendered inside a sandboxed iframe (sandbox="allow-scripts"). This is the default HTML surface for reports, widgets, and bespoke visualizations. Presentation mode is opt-in: only pass presentation:true when the user explicitly asks for a deck/fullscreen presentation, or use canvas_add_html_primitive with kind="presentation". The iframe inherits live canvas theme tokens via injected CSS custom properties (both --c-* and common --color-* aliases) so authored HTML using var(--color-text-secondary), var(--color-bg), etc. renders cohesively. No same-origin access; no top-navigation; no forms. For declarative-only views with zero JS, prefer canvas_add_json_render_node. For React + shadcn + routing or multi-component apps, use canvas_build_web_artifact.',
    {
      html: z.string().describe('HTML document or fragment. Full <html>...</html> documents are passed through with theme styles injected into <head>; bare fragments are wrapped in a minimal document. Inline <script> and remote CDN <script src="..."> are allowed. If this is a bare path to an existing local .html/.htm file, the file contents are read and used as the HTML.'),
      title: z.string().optional().describe('Node title shown in the canvas titlebar.'),
      summary: z.string().optional().describe('Agent-readable semantic summary for this HTML node. If omitted, PMX derives one from visible HTML text.'),
      agentSummary: z.string().optional().describe('Explicit agent-readable summary. Alias for summary with higher priority when both are provided.'),
      description: z.string().optional().describe('Short description included in search and pinned/spatial context.'),
      presentation: z.boolean().optional().describe('Marks this HTML surface as a fullscreen presentation/deck. Omit unless the user explicitly requested presentation mode.'),
      slideTitles: z.array(z.string()).optional().describe('Agent-readable slide titles for presentation HTML.'),
      embeddedNodeIds: z.array(z.string()).optional().describe('Canvas node IDs embedded or represented by this HTML surface.'),
      embeddedUrls: z.array(z.string()).optional().describe('URLs embedded or represented by this HTML surface.'),
      x: z.number().optional().describe('X position (auto-placed if omitted).'),
      y: z.number().optional().describe('Y position (auto-placed if omitted).'),
      width: z.number().optional().describe('Width in pixels (default: 720).'),
      height: z.number().optional().describe('Height in pixels (default: 640).'),
      strictSize: z.boolean().optional().describe('Keep explicit width/height fixed; iframe scrolls overflow internally.'),
      axCapabilities: z.object({
        enabled: z.boolean().optional(),
        allowed: z.array(z.string()).optional().describe('AX interaction types this node may emit (e.g. ax.work.create, ax.work.update, ax.steer, ax.focus.set, ax.evidence.add, ax.event.record). Clamped to the html capability ceiling server-side; cannot escalate.'),
      }).optional().describe('Opt this html node into AX interactions so its sandboxed UI can emit ax.* via window.PMX_AX.emit(type, payload) (and reflect live AX state). html nodes are AX-disabled by default; set { enabled: true, allowed: [...] } to turn the bridge on. Build interactive boards (work queues, review boards, inboxes) this way.'),
      full: z.boolean().optional().describe('Return the full created node payload. Default false returns compact metadata.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const id = await c.addHtmlNode({
        html: input.html,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(input.axCapabilities ? { axCapabilities: input.axCapabilities } : {}),
        ...(typeof input.summary === 'string' ? { summary: input.summary } : {}),
        ...(typeof input.agentSummary === 'string' ? { agentSummary: input.agentSummary } : {}),
        ...(typeof input.description === 'string' ? { description: input.description } : {}),
        ...(input.presentation === true ? { presentation: true } : {}),
        ...(Array.isArray(input.slideTitles) ? { slideTitles: input.slideTitles } : {}),
        ...(Array.isArray(input.embeddedNodeIds) ? { embeddedNodeIds: input.embeddedNodeIds } : {}),
        ...(Array.isArray(input.embeddedUrls) ? { embeddedUrls: input.embeddedUrls } : {}),
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
        ...(typeof input.width === 'number' ? { width: input.width } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
        ...(input.strictSize === true ? { strictSize: true } : {}),
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(await createdNodePayload(c, id, input), null, 2) }],
      };
    },
  );

  server.tool(
    'canvas_add_html_primitive',
    'Create a reusable HTML communication primitive as a normal sandboxed html node. Use this instead of long markdown for side-by-side choices, implementation plans, PR review sheets, module maps, design sheets, component galleries, flowcharts, explainers, status reports, and throwaway editors with export/copy paths. Use kind="presentation" only when the user explicitly asks for a PowerPoint-like deck, pitch, briefing, workshop walkthrough, or fullscreen story.',
    {
      kind: htmlPrimitiveKindSchema.describe('Primitive kind. Call canvas_describe_schema and read htmlPrimitives for data shapes and examples.'),
      title: z.string().optional().describe('Node title shown in the canvas titlebar.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Primitive-specific data payload. For kind="presentation", data may include theme:"canvas"|"midnight"|"paper"|"aurora" or a custom color object. See canvas_describe_schema.htmlPrimitives for each shape.'),
      x: z.number().optional().describe('X position (auto-placed if omitted).'),
      y: z.number().optional().describe('Y position (auto-placed if omitted).'),
      width: z.number().optional().describe('Width in pixels (defaults per primitive).'),
      height: z.number().optional().describe('Height in pixels (defaults per primitive).'),
      strictSize: z.boolean().optional().describe('Keep explicit width/height fixed; iframe scrolls overflow internally.'),
      full: z.boolean().optional().describe('Return the full created node payload. Default false returns compact metadata.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const kind = input.kind as HtmlPrimitiveKind;
      const result = await c.addHtmlPrimitive({
        kind,
        ...(typeof input.title === 'string' ? { title: input.title } : {}),
        ...(input.data ? { data: input.data } : {}),
        ...(typeof input.x === 'number' ? { x: input.x } : {}),
        ...(typeof input.y === 'number' ? { y: input.y } : {}),
        ...(typeof input.width === 'number' ? { width: input.width } : {}),
        ...(typeof input.height === 'number' ? { height: input.height } : {}),
        ...(input.strictSize === true ? { strictSize: true } : {}),
      });
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ...(await createdNodePayload(c, result.id, input)),
            primitive: { kind: result.kind, title: result.title, htmlBytes: result.htmlBytes },
          }, null, 2),
        }],
      };
    },
  );

  // canvas_open_mcp_app + canvas_add_diagram migrated to the operation registry
  // (plan-008 Wave 4): src/server/operations/ops/app.ts (mcpapp.open /
  // diagram.open). Folded into the canvas_app composite.

  server.tool(
    'canvas_refresh_webpage_node',
    'Refresh a webpage node from its persisted URL so the server re-fetches and caches the latest page text and metadata.',
    {
      id: z.string().describe('Webpage node ID to refresh'),
      url: z.string().optional().describe('Optional replacement URL before refresh'),
    },
    async ({ id, url }) => {
      const c = await ensureCanvas();
      const result = await c.refreshWebpageNode(id, url);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        ...(result.ok ? {} : { isError: true }),
      };
    },
  );

  // canvas_build_web_artifact migrated to the operation registry (plan-008
  // Wave 4): src/server/operations/ops/app.ts (webartifact.build). Folded into
  // the canvas_app composite.

  // canvas_remove_annotation migrated to the operation registry (plan-008
  // Wave 1): src/server/operations/ops/annotation.ts.

  // ── AX context and focus ───────────────────────────────────────
  // canvas_get_ax + canvas_set_ax_focus migrated to the operation registry
  // (plan-007 Slice B.1): src/server/operations/ops/ax-state.ts.

  // canvas_record_ax_event / canvas_send_steering / canvas_get_ax_timeline
  // migrated to the operation registry (plan-007 Slice B wave 3):
  // src/server/operations/ops/ax-timeline.ts.

  // canvas_add_work_item / canvas_update_work_item / canvas_request_approval /
  // canvas_resolve_approval migrated to the operation registry (plan-007 Slice B
  // wave 2): src/server/operations/ops/ax-work.ts.

  // canvas_add_evidence migrated to the operation registry (plan-007 Slice B
  // wave 3): src/server/operations/ops/ax-timeline.ts.

  // canvas_add_review_annotation migrated to the operation registry (plan-007
  // Slice B wave 2): src/server/operations/ops/ax-work.ts.

  // canvas_report_host_capability migrated to the operation registry
  // (plan-007 Slice B.1): src/server/operations/ops/ax-state.ts.

  server.tool(
    'canvas_ax_interaction',
    'Submit a node-originated AX interaction: a capability-gated, validated event from an eligible node that maps onto an AX operation (work item, evidence, approval, review, focus, steering, event). Returns { ok: false, code } if the node type/metadata does not allow the interaction type or the payload is invalid.',
    {
      type: z.enum(AX_INTERACTION_TYPES).describe('Interaction type, e.g. ax.work.create, ax.evidence.add, ax.focus.set.'),
      sourceNodeId: z.string().describe('The node emitting the interaction.'),
      payload: z.record(z.string(), z.unknown()).optional().describe('Type-specific payload, e.g. {"title":"..."} for ax.work.create.'),
      sourceSurface: z.enum(['native-node', 'json-render', 'html-node', 'mcp-app', 'adapter']).optional(),
      correlationId: z.string().optional(),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ type, sourceNodeId, payload, sourceSurface, correlationId, source }) => {
      const c = await ensureCanvas();
      const result = await c.submitAxInteraction(
        {
          type,
          sourceNodeId,
          ...(payload ? { payload } : {}),
          ...(sourceSurface ? { sourceSurface } : {}),
          ...(correlationId ? { correlationId } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  // canvas_claim_ax_delivery / canvas_mark_ax_delivery migrated to the operation
  // registry (plan-007 Slice B wave 3): src/server/operations/ops/ax-timeline.ts.

  // canvas_request_elicitation / canvas_respond_elicitation / canvas_request_mode /
  // canvas_resolve_mode migrated to the operation registry (plan-007 Slice B
  // wave 2): src/server/operations/ops/ax-work.ts.

  server.tool(
    'canvas_ingest_activity',
    'Ingest a normalized agent activity (a tool/session event your harness forwards) so the board reacts automatically — primitive A, makes AX bidirectional. Always records a timeline event; kind-driven default reactions (overridable per call via `reactions`): failure/error → work item (blocked) + review finding + evidence (logs); tool-result + outcome:"success" → evidence (tool-result); everything else (tool-start, session-*, command, note) → event only. Set any reaction to false to suppress it, or to an object to override its fields. Returns { event, workItem, evidence, review }.',
    {
      kind: z.enum(['tool-start', 'tool-result', 'failure', 'error', 'session-start', 'session-end', 'command', 'note']),
      title: z.string(),
      summary: z.string().optional(),
      outcome: z.enum(['success', 'failure']).optional(),
      ref: z.string().optional().describe('A file path, URL, or commit the activity refers to (used as the review file anchor for failures).'),
      nodeIds: z.array(z.string()).optional(),
      data: z.record(z.string(), z.unknown()).optional(),
      reactions: z.object({
        workItem: z.union([z.literal(false), z.object({
          status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled']).optional(),
          detail: z.string().nullable().optional(),
        })]).optional(),
        evidence: z.union([z.literal(false), z.object({
          kind: z.enum(['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output']).optional(),
          body: z.string().nullable().optional(),
        })]).optional(),
        review: z.union([z.literal(false), z.object({
          severity: z.enum(['info', 'warning', 'error']).optional(),
          kind: z.enum(['comment', 'finding']).optional(),
          anchorType: z.enum(['node', 'file', 'region']).optional(),
          nodeId: z.string().nullable().optional(),
        })]).optional(),
      }).optional().describe('Override or suppress the kind-driven default reactions.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ kind, title, summary, outcome, ref, nodeIds, data, reactions, source }) => {
      const c = await ensureCanvas();
      const result = await c.ingestActivity(
        {
          kind,
          title,
          ...(summary !== undefined ? { summary } : {}),
          ...(outcome !== undefined ? { outcome } : {}),
          ...(ref !== undefined ? { ref } : {}),
          ...(nodeIds !== undefined ? { nodeIds } : {}),
          ...(data !== undefined ? { data } : {}),
          ...(reactions !== undefined ? { reactions } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, ...result }) }] };
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
  server.tool(
    'canvas_screenshot',
    'Capture a screenshot from the active Bun.WebView automation session. Returns both an MCP image payload and JSON metadata. Requires an active automation session started via canvas_webview_start.',
    {
      format: z.enum(['png', 'jpeg', 'webp']).optional().describe('Screenshot format (default depends on Bun; png recommended)'),
      quality: z.number().optional().describe('Optional quality for lossy formats'),
    },
    async ({ format, quality }) => {
      const c = await ensureCanvas();
      try {
        const bytes = await c.screenshotAutomationWebView({
          ...(format ? { format } : {}),
          ...(typeof quality === 'number' ? { quality } : {}),
        });
        const status = await c.getAutomationWebViewStatus();
        return {
          content: [
            {
              type: 'image',
              data: encodeBase64(bytes),
              mimeType:
                format === 'jpeg'
                  ? 'image/jpeg'
                  : format === 'webp'
                    ? 'image/webp'
                    : 'image/png',
            },
            {
              type: 'text',
              text: JSON.stringify({
                bytes: bytes.byteLength,
                backend: status.backend,
                width: status.width,
                height: status.height,
                mimeType:
                  format === 'jpeg'
                    ? 'image/jpeg'
                    : format === 'webp'
                      ? 'image/webp'
                      : 'image/png',
              }, null, 2),
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
      description:
        `Machine-readable create schemas, canonical examples, json-render catalog details, and MCP node-type routing from the running PMX Canvas server version. Routing: ${structuredSchemaDescription()}.`,
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
        'resource to get structured context from the canvas.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const pinnedIds = new Set(await c.getPinnedNodeIds());
      const layout = await c.getLayout();

      const pinnedNodes = layout.nodes.filter((n) => pinnedIds.has(n.id));
      const pinnedEdges = layout.edges.filter(
        (e) => pinnedIds.has(e.from) && pinnedIds.has(e.to),
      );

      // Compute neighborhoods: for each pinned node, find nearby unpinned nodes
      const neighborhoods = findNeighborhoods(layout.nodes, pinnedIds);

      const context = {
        pinnedCount: pinnedNodes.length,
        nodes: pinnedNodes.map((n) => serializeNodeForAgentContext(n, {
          defaultTextLength: 700,
          webpageTextLength: 1600,
          includePosition: true,
        })),
        edges: pinnedEdges.map((e) => ({
          id: e.id,
          from: e.from,
          to: e.to,
          type: e.type,
          label: e.label ?? null,
        })),
        neighborhoods: neighborhoods.map((nh) => ({
          pinnedNodeId: nh.pinnedNodeId,
          pinnedNodeTitle: nh.pinnedNodeTitle,
          nearbyNodes: nh.neighbors,
        })),
      };

      return {
        contents: [
          {
            uri: 'canvas://pinned-context',
            mimeType: 'application/json',
            text: JSON.stringify(context, null, 2),
          },
        ],
      };
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
      description:
        'Agent-ready PMX AX context combining pinned context, focus, and surface metadata.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const context = await c.getAxContext({ consumer: 'mcp' });
      return {
        contents: [
          {
            uri: 'canvas://ax-context',
            mimeType: 'application/json',
            text: JSON.stringify(context, null, 2),
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
            text: JSON.stringify({
              workItems,
              approvalGates,
              reviewAnnotations: state.reviewAnnotations,
              elicitations: state.elicitations,
              modeRequests: state.modeRequests,
              policy: state.policy,
            }, null, 2),
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
        'Adapterless AX delivery surface. `pending`: undelivered steering messages to claim and act on, then mark via canvas_mark_ax_delivery. `pendingActivity`: open canvas-bound AX items awaiting the agent (open work items, pending approval gates / elicitations / mode requests) — usually created by the human in the browser; these fire ax-state-changed (resource-subscribers are also pushed canvas://ax-work). Resolve pendingActivity via its own tool, not canvas_mark_ax_delivery. Use canvas_claim_ax_delivery for the loop-safe, consumer-scoped view.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const [pending, state] = await Promise.all([c.getPendingSteering(), c.getAxState()]);
      const pendingActivity = buildPendingAxActivity(state);
      return {
        contents: [
          { uri: 'canvas://ax-pending-steering', mimeType: 'application/json', text: JSON.stringify({ pending, pendingActivity }, null, 2) },
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
          { uri: 'canvas://ax-delivery', mimeType: 'application/json', text: JSON.stringify({ steering: timeline.steering }, null, 2) },
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
      return {
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Current PMX Canvas context:\n\n${JSON.stringify(context, null, 2)}` },
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
      const layout = agentSafeFullLayoutPayload(await c.getLayout());
      return {
        contents: [
          {
            uri: 'canvas://layout',
            mimeType: 'application/json',
            text: JSON.stringify(layout, null, 2),
          },
        ],
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
      return {
        contents: [
          {
            uri: 'canvas://summary',
            mimeType: 'application/json',
            text: JSON.stringify(buildSummaryFromLayout(await c.getLayout(), await c.getPinnedNodeIds()), null, 2),
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
        'human\'s spatial intent, not just which nodes are pinned.',
      mimeType: 'application/json',
    },
    async () => {
      const c = await ensureCanvas();
      const layout = await c.getLayout();
      const spatial = buildSpatialContext(layout.nodes, layout.edges, new Set(await c.getPinnedNodeIds()), layout.annotations ?? []);
      return {
        contents: [
          {
            uri: 'canvas://spatial-context',
            mimeType: 'application/json',
            text: JSON.stringify(spatial, null, 2),
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
  // invisible to agents — calling canvas_build_web_artifact without the
  // companion `web-artifacts-builder` skill led to predictable misuse.
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
        'canvas_build_web_artifact, and pmx-canvas for the broader workbench.',
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

  // Connect via stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Allow direct execution: bun run src/mcp/server.ts
if (import.meta.main) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
