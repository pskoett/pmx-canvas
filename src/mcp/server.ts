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
import { isAbsolute, relative, resolve } from 'node:path';
import { z } from 'zod';
import { canvasState, describeCanvasSchema } from '../server/index.js';
import { AX_INTERACTION_TYPES } from '../server/ax-interaction.js';
import { buildPendingAxActivity } from '../server/ax-state.js';
import { isHtmlPrimitiveKind } from '../server/html-primitives.js';
import type { HtmlPrimitiveKind } from '../server/html-primitives.js';
import { registerOperationTools, registerCompositeTools } from '../server/operations/index.js';
import { createCanvasAccess, refreshCanvasAccess, type CanvasAccess } from './canvas-access.js';
import { serializeNodeForAgentContext } from '../server/agent-context.js';
import { wrapCanvasAutomationScript } from '../server/server.js';
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

function workspaceRoot(): string {
  return resolve(process.cwd());
}

function isPathInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  if (rel === '') return true;
  return !rel.startsWith('..') && rel !== '..' && !isAbsolute(rel);
}

function safeWorkspacePath(pathLike: string): string {
  const workspace = workspaceRoot();
  const resolved = resolve(workspace, pathLike);
  if (!isPathInside(workspace, resolved)) {
    throw new Error(`Path "${pathLike}" resolves outside workspace.`);
  }
  return resolved;
}

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

function compactBatchValue(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const nodeLike = typeof record.id === 'string' && typeof record.type === 'string';
  const compact: Record<string, unknown> = {};
  for (const key of ['ok', 'id', 'type', 'kind', 'title', 'content', 'position', 'size', 'fetch', 'error', 'from', 'to', 'groupId', 'nodeIds', 'snapshot', 'arranged', 'layout']) {
    if (record[key] !== undefined) compact[key] = record[key];
  }
  if (nodeLike) return compact;
  return record;
}

function compactBatchResult(result: { ok: boolean; results: Array<Record<string, unknown>>; refs: Record<string, unknown>; failedIndex?: number; error?: string }): Record<string, unknown> {
  return {
    ok: result.ok,
    ...(result.failedIndex !== undefined ? { failedIndex: result.failedIndex } : {}),
    ...(result.error ? { error: result.error } : {}),
    results: result.results.map((entry) => compactBatchValue(entry)),
    refs: Object.fromEntries(Object.entries(result.refs).map(([key, value]) => [key, compactBatchValue(value)])),
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
  // canvas_view, canvas_query). Each action dispatches to the same registered
  // operation as its standalone tool, so behavior is identical. Additive in
  // v0.2 (legacy tools still registered below); legacy removed in v0.3 per
  // docs/api-stability.md. (canvas_snapshot composite is deferred to v0.3 — its
  // name is still held by the legacy save-snapshot tool.)
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

  server.tool(
    'canvas_open_mcp_app',
    'Connect to an external MCP server that declares a ui:// app resource, call the specified tool, and open the resulting MCP App inside a canvas mcp-app node. This is a full external-MCP transport call, not the CLI kind shortcut; use canvas_add_diagram for the built-in Excalidraw preset.',
    {
      toolName: z.string().describe('Tool name on the external MCP server'),
      serverName: z.string().optional().describe('Optional display name for the external MCP server'),
      toolArguments: z.record(z.string(), z.unknown()).optional().describe('Arguments passed to the external tool call'),
      nodeId: z.string().optional().describe('Existing mcp-app node ID to update in place instead of creating a new node.'),
      title: z.string().optional().describe('Optional canvas node title override'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 500)'),
      timeoutMs: z.number().optional().describe('Optional MCP request timeout in milliseconds for cold external app servers'),
      transport: z.union([
        z.object({
          type: z.literal('stdio'),
          command: z.string().describe('Executable used to start the external MCP server'),
          args: z.array(z.string()).optional().describe('Arguments for the executable'),
          cwd: z.string().optional().describe('Optional working directory'),
          env: z.record(z.string(), z.string()).optional().describe('Optional environment overrides'),
        }),
        z.object({
          type: z.literal('http'),
          url: z.string().describe('Streamable HTTP MCP endpoint URL'),
          headers: z.record(z.string(), z.string()).optional().describe('Optional HTTP headers'),
        }),
      ]).describe('How PMX Canvas should connect to the external MCP server'),
    },
    async (input) => {
      const c = await ensureCanvas();
      try {
        const result = await c.openMcpApp({
          transport: input.transport,
          toolName: input.toolName,
          ...(typeof input.serverName === 'string' ? { serverName: input.serverName } : {}),
          ...(input.toolArguments ? { toolArguments: input.toolArguments } : {}),
          ...(typeof input.nodeId === 'string' ? { nodeId: input.nodeId } : {}),
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
          ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'canvas_add_diagram',
    'Draw a hand-drawn diagram on the canvas via the hosted Excalidraw MCP app. Pass an array of Excalidraw elements (rectangles, ellipses, diamonds, arrows, text). The diagram opens inside an mcp-app node that supports fullscreen editing. For other MCP apps, use canvas_open_mcp_app.',
    {
      elements: z.union([
        z.string().describe('JSON array string of Excalidraw elements'),
        z.array(z.record(z.string(), z.unknown())).describe('Array of Excalidraw elements'),
      ]).describe('Excalidraw elements to render. See https://github.com/excalidraw/excalidraw-mcp for the element format.'),
      nodeId: z.string().optional().describe('Existing Excalidraw mcp-app node ID to update in place instead of creating a new node.'),
      title: z.string().optional().describe('Optional canvas node title override'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 500)'),
      timeoutMs: z.number().optional().describe('Optional MCP request timeout in milliseconds for Excalidraw cold starts. Client-side MCP hosts may still enforce their own total request timeout.'),
    },
    async (input, extra) => {
      const c = await ensureCanvas();
      try {
        const result = await c.addDiagram({
          elements: input.elements,
          ...(typeof input.nodeId === 'string' ? { nodeId: input.nodeId } : {}),
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
          ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        if (extra.signal.aborted) {
          return {
            content: [{ type: 'text', text: 'canvas_add_diagram was cancelled by the MCP client before Excalidraw finished. Retry with a higher client request timeout and pass timeoutMs to PMX Canvas for the downstream Excalidraw call.' }],
            isError: true,
          };
        }
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

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

  // ── canvas_build_web_artifact ───────────────────────────────
  server.tool(
    'canvas_build_web_artifact',
    'Build a bundled single-file HTML web artifact from React/Tailwind source files using the bundled web-artifacts-builder skill scripts. MCP callers pass source content in appTsx (the CLI app-file flag reads a file before calling this path). Builds can exceed default 60s MCP client timeouts on cold workspaces; set a long client timeout or retry with the same projectPath/outputPath if the client times out. Optionally opens the generated artifact as an embedded node on the canvas. Read canvas://skills/web-artifacts-builder for the full workflow, stack, and anti-slop design guidelines before calling.',
    {
      title: z.string().describe('Artifact title used for default project and output paths'),
      appTsx: z.string().describe('Contents for src/App.tsx'),
      indexCss: z.string().optional().describe('Optional contents for src/index.css'),
      mainTsx: z.string().optional().describe('Optional contents for src/main.tsx'),
      indexHtml: z.string().optional().describe('Optional contents for index.html'),
      files: z.record(z.string(), z.string()).optional().describe('Optional map of additional project-relative file paths to file contents'),
      deps: z.array(z.string()).optional().describe('Optional npm dependencies to install before bundling (e.g. ["recharts", "framer-motion@^11"]). Validated against npm-name format; flags and shell metacharacters are rejected.'),
      projectPath: z.string().optional().describe('Optional workspace-relative reusable project path. Defaults to .pmx-canvas/artifacts/.web-artifacts/<slug>'),
      outputPath: z.string().optional().describe('Optional workspace-relative HTML output path. Defaults to .pmx-canvas/artifacts/<slug>.html'),
      openInCanvas: z.boolean().optional().describe('Open the generated artifact in canvas after build (default true)'),
      includeLogs: z.boolean().optional().describe('Include raw build stdout/stderr in the response (default false)'),
      initScriptPath: z.string().optional().describe('Optional script path override for tests/debugging. Must resolve inside the workspace.'),
      bundleScriptPath: z.string().optional().describe('Optional script path override for tests/debugging. Must resolve inside the workspace.'),
      timeoutMs: z.number().optional().describe('Optional timeout in milliseconds for init and bundle commands'),
    },
    async (input) => {
      const c = await ensureCanvas();
      try {
        const result = await c.buildWebArtifact({
          title: input.title,
          appTsx: input.appTsx,
          ...(typeof input.indexCss === 'string' ? { indexCss: input.indexCss } : {}),
          ...(typeof input.mainTsx === 'string' ? { mainTsx: input.mainTsx } : {}),
          ...(typeof input.indexHtml === 'string' ? { indexHtml: input.indexHtml } : {}),
          ...(input.files ? { files: input.files } : {}),
          ...(Array.isArray(input.deps) ? { deps: input.deps } : {}),
          ...(typeof input.projectPath === 'string'
            ? { projectPath: safeWorkspacePath(input.projectPath) }
            : {}),
          ...(typeof input.outputPath === 'string'
            ? { outputPath: safeWorkspacePath(input.outputPath) }
            : {}),
          ...(typeof input.initScriptPath === 'string'
            ? { initScriptPath: input.initScriptPath }
            : {}),
          ...(typeof input.bundleScriptPath === 'string'
            ? { bundleScriptPath: input.bundleScriptPath }
            : {}),
          ...(typeof input.timeoutMs === 'number' ? { timeoutMs: input.timeoutMs } : {}),
          ...(typeof input.openInCanvas === 'boolean' ? { openInCanvas: input.openInCanvas } : {}),
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              path: result.filePath,
              bytes: result.fileSize,
              projectPath: result.projectPath,
              openedInCanvas: result.openedInCanvas,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              durationMs: result.durationMs,
              timeoutMs: result.timeoutMs,
              // `id` only present when a canvas node was actually created.
              // See the matching block in src/server/server.ts handleCanvasBuildWebArtifact.
              ...(typeof result.nodeId === 'string' ? { id: result.nodeId } : {}),
              nodeId: result.nodeId,
              url: result.url,
              metadata: result.metadata,
              logs: result.logs,
              ...(input.includeLogs === true ? {
                stdout: result.stdout,
                stderr: result.stderr,
              } : {}),
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // ── canvas_remove_annotation ─────────────────────────────────────
  server.tool(
    'canvas_remove_annotation',
    'Remove a human-drawn canvas annotation by ID.',
    { id: z.string().describe('Annotation ID to remove') },
    async ({ id }) => {
      const c = await ensureCanvas();
      const removed = await c.removeAnnotation(id);
      if (!removed) {
        return {
          content: [{ type: 'text', text: `Annotation "${id}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, removed: id }) }],
      };
    },
  );

  // ── AX context and focus ───────────────────────────────────────
  // canvas_get_ax + canvas_set_ax_focus migrated to the operation registry
  // (plan-007 Slice B.1): src/server/operations/ops/ax-state.ts.

  server.tool(
    'canvas_record_ax_event',
    'Record a normalized AX timeline event (prompt/assistant-message/tool-start/tool-result/failure/approval/steering). Timeline events persist for diagnostics and continuity but are not restored by snapshots.',
    {
      kind: z.enum(['prompt', 'assistant-message', 'tool-start', 'tool-result', 'failure', 'approval', 'steering'])
        .describe('Normalized event kind.'),
      summary: z.string().describe('Short human-readable summary of the event.'),
      detail: z.string().optional().describe('Optional longer detail or payload text.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this event relates to.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Optional structured data payload.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ kind, summary, detail, nodeIds, data, source }) => {
      const c = await ensureCanvas();
      const event = await c.recordAxEvent(
        {
          kind,
          summary,
          ...(typeof detail === 'string' ? { detail } : {}),
          ...(Array.isArray(nodeIds) ? { nodeIds } : {}),
          ...(data ? { data } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, event }),
          },
        ],
      };
    },
  );

  server.tool(
    'canvas_send_steering',
    'Record a steering message: a user instruction from the surface to the active agent session. Persisted on the AX timeline and exposed via canvas://ax-timeline.',
    {
      message: z.string().describe('The steering instruction to deliver to the active agent session.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ message, source }) => {
      const c = await ensureCanvas();
      const steering = await c.sendSteering(message, { source: source ?? 'mcp' });
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, steering }),
          },
        ],
      };
    },
  );

  server.tool(
    'canvas_get_ax_timeline',
    'Read the bounded AX timeline: recent agent-events, evidence, and steering messages plus counts. Use this for diagnostics and session continuity.',
    {
      limit: z.number().optional().describe('Max rows per timeline table (default 50, max 200).'),
    },
    async ({ limit }) => {
      const c = await ensureCanvas();
      const timeline = await c.getAxTimeline(
        typeof limit === 'number' && limit > 0 ? { limit } : undefined,
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, ...timeline }),
          },
        ],
      };
    },
  );

  server.tool(
    'canvas_add_work_item',
    'Add a canvas-bound AX work item: a visible task/plan/status tied to nodes and agent work. Work items participate in snapshots and are exposed via canvas://ax-work.',
    {
      title: z.string().describe('Short title of the work item.'),
      status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])
        .optional()
        .describe('Work item status. Defaults to todo.'),
      detail: z.string().optional().describe('Optional longer description.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this work item is tied to.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ title, status, detail, nodeIds, source }) => {
      const c = await ensureCanvas();
      const workItem = await c.addWorkItem(
        {
          title,
          ...(status ? { status } : {}),
          ...(typeof detail === 'string' ? { detail } : {}),
          ...(Array.isArray(nodeIds) ? { nodeIds } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, workItem }) }],
      };
    },
  );

  server.tool(
    'canvas_update_work_item',
    'Update a canvas-bound AX work item by ID (title/status/detail/nodeIds). Returns null if the work item does not exist.',
    {
      id: z.string().describe('Work item ID to update.'),
      title: z.string().optional().describe('New title.'),
      status: z.enum(['todo', 'in-progress', 'blocked', 'done', 'cancelled'])
        .optional()
        .describe('New status.'),
      detail: z.string().optional().describe('New detail text.'),
      nodeIds: z.array(z.string()).optional().describe('Replacement node IDs.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ id, title, status, detail, nodeIds, source }) => {
      const c = await ensureCanvas();
      const workItem = await c.updateWorkItem(
        id,
        {
          ...(typeof title === 'string' ? { title } : {}),
          ...(status ? { status } : {}),
          ...(typeof detail === 'string' ? { detail } : {}),
          ...(Array.isArray(nodeIds) ? { nodeIds } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: workItem !== null, workItem }) }],
      };
    },
  );

  server.tool(
    'canvas_request_approval',
    'Request human approval before a high-impact AX action: creates a pending approval gate tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work.',
    {
      title: z.string().describe('Short title of what needs approval.'),
      detail: z.string().optional().describe('Optional explanation of the action and its impact.'),
      action: z.string().optional().describe('Optional machine-readable action identifier the approval gates.'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this approval relates to.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ title, detail, action, nodeIds, source }) => {
      const c = await ensureCanvas();
      const approvalGate = await c.requestApproval(
        {
          title,
          ...(typeof detail === 'string' ? { detail } : {}),
          ...(typeof action === 'string' ? { action } : {}),
          ...(Array.isArray(nodeIds) ? { nodeIds } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, approvalGate }) }],
      };
    },
  );

  server.tool(
    'canvas_resolve_approval',
    'Resolve a pending approval gate by ID with approved or rejected. Returns null if the gate does not exist or is already resolved.',
    {
      id: z.string().describe('Approval gate ID to resolve.'),
      decision: z.enum(['approved', 'rejected']).describe('Approval decision.'),
      resolution: z.string().optional().describe('Optional human-readable resolution note.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ id, decision, resolution, source }) => {
      const c = await ensureCanvas();
      const approvalGate = await c.resolveApproval(id, decision, {
        ...(typeof resolution === 'string' ? { resolution } : {}),
        source: source ?? 'mcp',
      });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: approvalGate !== null, approvalGate }) }],
      };
    },
  );

  server.tool(
    'canvas_add_evidence',
    'Record an AX evidence item (logs/tool-result/screenshot/file/diff/test-output) on the timeline. Evidence persists for diagnostics and continuity but is not restored by snapshots; exposed via canvas://ax-timeline.',
    {
      kind: z.enum(['logs', 'tool-result', 'screenshot', 'file', 'diff', 'test-output'])
        .describe('Evidence kind.'),
      title: z.string().describe('Short human-readable title for the evidence.'),
      body: z.string().optional().describe('Optional inline body/content.'),
      ref: z.string().optional().describe('Optional reference (path, URL, or external locator).'),
      nodeIds: z.array(z.string()).optional().describe('Optional node IDs this evidence relates to.'),
      data: z.record(z.string(), z.unknown()).optional().describe('Optional structured data payload.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ kind, title, body, ref, nodeIds, data, source }) => {
      const c = await ensureCanvas();
      const evidence = await c.addEvidence(
        {
          kind,
          title,
          ...(typeof body === 'string' ? { body } : {}),
          ...(typeof ref === 'string' ? { ref } : {}),
          ...(Array.isArray(nodeIds) ? { nodeIds } : {}),
          ...(data ? { data } : {}),
        },
        { source: source ?? 'mcp' },
      );
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, evidence }) }],
      };
    },
  );

  server.tool(
    'canvas_add_review_annotation',
    'Add a canvas-bound review annotation: a comment or finding anchored to a node, file, or region. Review annotations participate in snapshots and are exposed via canvas://ax-work.',
    {
      body: z.string().describe('Annotation body text.'),
      kind: z.enum(['comment', 'finding']).optional().describe('Annotation kind. Default comment.'),
      severity: z.enum(['info', 'warning', 'error']).optional().describe('Severity. Default info.'),
      anchorType: z.enum(['node', 'file', 'region']).optional().describe('Anchor type. Default node.'),
      nodeId: z.string().optional().describe('Node ID when anchorType is node.'),
      file: z.string().optional().describe('File path when anchorType is file.'),
      region: z.object({
        line: z.number().optional(),
        endLine: z.number().optional(),
        label: z.string().optional(),
      }).optional().describe('Region descriptor when anchorType is region.'),
      author: z.string().optional().describe('Optional author label.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system'])
        .optional()
        .describe('Optional host/source label. Defaults to mcp.'),
    },
    async ({ body, kind, severity, anchorType, nodeId, file, region, author, source }) => {
      const c = await ensureCanvas();
      const reviewAnnotation = await c.addReviewAnnotation(
        {
          body,
          ...(kind ? { kind } : {}),
          ...(severity ? { severity } : {}),
          ...(anchorType ? { anchorType } : {}),
          ...(typeof nodeId === 'string' ? { nodeId } : {}),
          ...(typeof file === 'string' ? { file } : {}),
          ...(region ? { region } : {}),
          ...(typeof author === 'string' ? { author } : {}),
        },
        { source: source ?? 'mcp' },
      );
      if (!reviewAnnotation) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'node-anchored review annotation requires a nodeId that exists on the canvas.' }) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, reviewAnnotation }) }],
      };
    },
  );

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

  server.tool(
    'canvas_claim_ax_delivery',
    'Claim pending PMX AX deliveries for a consumer (adapterless delivery). Returns `pending` undelivered steering (mark each with canvas_mark_ax_delivery after acting) AND `pendingActivity`: open canvas-bound AX items awaiting the agent (open work items, pending approval gates / elicitations / mode requests) — typically created by the human in the browser. Both exclude items the consumer itself originated (loop prevention). pendingActivity is read-only here: resolve each via its own tool (canvas_resolve_approval / canvas_respond_elicitation / canvas_resolve_mode / canvas_update_work_item), not canvas_mark_ax_delivery.',
    {
      consumer: z.string().optional().describe('Consumer/source label to exclude from results (e.g. copilot, mcp).'),
      limit: z.number().optional().describe('Max steering messages to return.'),
    },
    async ({ consumer, limit }) => {
      const c = await ensureCanvas();
      const pending = await c.getPendingSteering({
        ...(consumer ? { consumer } : {}),
        ...(typeof limit === 'number' ? { limit } : {}),
      });
      const pendingActivity = buildPendingAxActivity(await c.getAxState(), consumer);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, pending, pendingActivity }) }] };
    },
  );

  server.tool(
    'canvas_mark_ax_delivery',
    'Mark a PMX AX steering message as delivered so it is not handed out again.',
    {
      id: z.string().describe('The steering message id to mark delivered.'),
    },
    async ({ id }) => {
      const c = await ensureCanvas();
      const delivered = await c.markSteeringDelivered(id);
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, delivered }) }] };
    },
  );

  server.tool(
    'canvas_request_elicitation',
    'Request structured human input (an elicitation): a pending question/form tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work. Answer it with canvas_respond_elicitation.',
    {
      prompt: z.string().describe('The question or instruction for the human.'),
      fields: z.array(z.string()).optional().describe('Optional field names to request (a simple structured form).'),
      nodeIds: z.array(z.string()).optional(),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ prompt, fields, nodeIds, source }) => {
      const c = await ensureCanvas();
      const elicitation = await c.requestElicitation(
        { prompt, ...(fields ? { fields } : {}), ...(Array.isArray(nodeIds) ? { nodeIds } : {}) },
        { source: source ?? 'mcp' },
      );
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, elicitation }) }] };
    },
  );

  server.tool(
    'canvas_respond_elicitation',
    'Answer a pending elicitation with a structured response.',
    {
      id: z.string().describe('The elicitation id.'),
      response: z.record(z.string(), z.unknown()).describe('The structured answer.'),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ id, response, source }) => {
      const c = await ensureCanvas();
      const elicitation = await c.respondElicitation(id, response, { source: source ?? 'mcp' });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: Boolean(elicitation), elicitation }) }] };
    },
  );

  server.tool(
    'canvas_request_mode',
    'Request a workflow mode transition (plan/execute/autonomous): a pending mode request tied to nodes. Canvas-bound and snapshotted; exposed via canvas://ax-work. Resolve with canvas_resolve_mode.',
    {
      mode: z.enum(['plan', 'execute', 'autonomous']).describe('Requested target mode.'),
      reason: z.string().optional(),
      nodeIds: z.array(z.string()).optional(),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ mode, reason, nodeIds, source }) => {
      const c = await ensureCanvas();
      const modeRequest = await c.requestMode(
        { mode, ...(typeof reason === 'string' ? { reason } : {}), ...(Array.isArray(nodeIds) ? { nodeIds } : {}) },
        { source: source ?? 'mcp' },
      );
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, modeRequest }) }] };
    },
  );

  server.tool(
    'canvas_resolve_mode',
    'Resolve a pending mode request (approved or rejected).',
    {
      id: z.string(),
      decision: z.enum(['approved', 'rejected']),
      resolution: z.string().optional(),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ id, decision, resolution, source }) => {
      const c = await ensureCanvas();
      const modeRequest = await c.resolveModeRequest(id, decision, {
        ...(typeof resolution === 'string' ? { resolution } : {}),
        source: source ?? 'mcp',
      });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: Boolean(modeRequest), modeRequest }) }] };
    },
  );

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

  server.tool(
    'canvas_await_approval',
    'Block until an approval gate resolves (the human approves/rejects it in the browser) or the timeout elapses — primitive D, gates that actually gate. timeoutMs 0 = read immediately without waiting. Returns { approvalGate, pending } (pending=true → still unresolved after the wait).',
    {
      id: z.string(),
      timeoutMs: z.number().int().min(0).max(120000).optional().describe('Max ms to block (default 30000; 0 = immediate read; capped at 120000).'),
    },
    async ({ id, timeoutMs }) => {
      const c = await ensureCanvas();
      const result = await c.awaitApproval(id, timeoutMs !== undefined ? { timeoutMs } : {});
      return { content: [{ type: 'text', text: JSON.stringify({ ok: result.approvalGate !== null, ...result }) }] };
    },
  );

  server.tool(
    'canvas_await_elicitation',
    'Block until an elicitation is answered (the human responds in the browser) or the timeout elapses — primitive D. timeoutMs 0 = read immediately. Returns { elicitation, pending }.',
    {
      id: z.string(),
      timeoutMs: z.number().int().min(0).max(120000).optional().describe('Max ms to block (default 30000; 0 = immediate read; capped at 120000).'),
    },
    async ({ id, timeoutMs }) => {
      const c = await ensureCanvas();
      const result = await c.awaitElicitation(id, timeoutMs !== undefined ? { timeoutMs } : {});
      return { content: [{ type: 'text', text: JSON.stringify({ ok: result.elicitation !== null, ...result }) }] };
    },
  );

  server.tool(
    'canvas_await_mode',
    'Block until a mode request resolves (approved/rejected in the browser) or the timeout elapses — primitive D. timeoutMs 0 = read immediately. Returns { modeRequest, pending }.',
    {
      id: z.string(),
      timeoutMs: z.number().int().min(0).max(120000).optional().describe('Max ms to block (default 30000; 0 = immediate read; capped at 120000).'),
    },
    async ({ id, timeoutMs }) => {
      const c = await ensureCanvas();
      const result = await c.awaitMode(id, timeoutMs !== undefined ? { timeoutMs } : {});
      return { content: [{ type: 'text', text: JSON.stringify({ ok: result.modeRequest !== null, ...result }) }] };
    },
  );

  server.tool(
    'canvas_invoke_command',
    'Invoke a registry-gated PMX command intent (pmx.plan | pmx.execute | pmx.promote-context | pmx.summarize | pmx.review). Records a timeline event a host/agent can observe — NOT arbitrary execution; unknown names are rejected.',
    {
      name: z.string().describe('A command name from the PMX command registry.'),
      args: z.record(z.string(), z.unknown()).optional(),
      source: z.enum(['agent', 'api', 'browser', 'cli', 'codex', 'copilot', 'mcp', 'sdk', 'system']).optional(),
    },
    async ({ name, args, source }) => {
      const c = await ensureCanvas();
      const event = await c.invokeCommand(name, args ?? null, { source: source ?? 'mcp' });
      return { content: [{ type: 'text', text: JSON.stringify({ ok: Boolean(event), event }) }] };
    },
  );

  // canvas_set_ax_policy migrated to the operation registry
  // (plan-007 Slice B.1): src/server/operations/ops/ax-state.ts.

  // ── canvas_webview_status ─────────────────────────────────────
  server.tool(
    'canvas_webview_status',
    'Get the current Bun.WebView automation status for the PMX Canvas workbench. Returns whether Bun.WebView is supported, whether an automation session is active, backend, viewport size, and the current workbench URL if active.',
    {},
    async () => {
      const c = await ensureCanvas();
      return {
        content: [{ type: 'text', text: JSON.stringify(await c.getAutomationWebViewStatus(), null, 2) }],
      };
    },
  );

  // ── canvas_webview_start ──────────────────────────────────────
  server.tool(
    'canvas_webview_start',
    'Start or replace the headless Bun.WebView automation session for the current PMX Canvas workbench. Use this before screenshot, evaluate, or resize when no automation session is active.',
    {
      backend: z.enum(['chrome', 'webkit']).optional()
        .describe('Automation backend. Default: webkit on macOS, chrome elsewhere.'),
      width: z.number().optional().describe('Viewport width in pixels (default: 1280)'),
      height: z.number().optional().describe('Viewport height in pixels (default: 800)'),
      chromePath: z.string().optional().describe('Optional Chrome/Chromium executable path'),
      chromeArgv: z.array(z.string()).optional().describe('Optional extra Chrome launch args'),
      dataStoreDir: z.string().optional().describe('Optional persistent data store directory'),
    },
    async ({ backend, width, height, chromePath, chromeArgv, dataStoreDir }) => {
      const c = await ensureCanvas();
      try {
        const status = await c.startAutomationWebView({
          ...(backend ? { backend } : {}),
          ...(typeof width === 'number' ? { width } : {}),
          ...(typeof height === 'number' ? { height } : {}),
          ...(typeof chromePath === 'string' ? { chromePath } : {}),
          ...(Array.isArray(chromeArgv) ? { chromeArgv } : {}),
          ...(typeof dataStoreDir === 'string' ? { dataStoreDir: safeWorkspacePath(dataStoreDir) } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // ── canvas_webview_stop ───────────────────────────────────────
  server.tool(
    'canvas_webview_stop',
    'Stop the current Bun.WebView automation session if one is active.',
    {},
    async () => {
      const c = await ensureCanvas();
      try {
        const stopped = await c.stopAutomationWebView();
        const webview = await c.getAutomationWebViewStatus();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              stopped,
              webview,
            }, null, 2),
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // ── canvas_evaluate ───────────────────────────────────────────
  server.tool(
    'canvas_evaluate',
    'Evaluate JavaScript in the active Bun.WebView automation session for the workbench page. Use this to inspect rendered browser state. Requires an active automation session started via canvas_webview_start.',
    {
      expression: z.string().optional().describe('JavaScript expression to evaluate in the page context'),
      script: z.string().optional().describe('Multi-statement JavaScript body. The MCP server wraps it in an async IIFE and evaluates the resolved return value.'),
    },
    async ({ expression, script }) => {
      const c = await ensureCanvas();
      if ((expression ? 1 : 0) + (script ? 1 : 0) !== 1) {
        return {
          content: [{ type: 'text', text: 'Pass exactly one of "expression" or "script".' }],
          isError: true,
        };
      }

      const source = script ? wrapCanvasAutomationScript(script) : expression!;
      try {
        const value = await c.evaluateAutomationWebView(source);
        return {
          content: [{ type: 'text', text: JSON.stringify({ value }, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

  // ── canvas_resize ─────────────────────────────────────────────
  server.tool(
    'canvas_resize',
    'Resize the active Bun.WebView automation viewport. Requires an active automation session started via canvas_webview_start.',
    {
      width: z.number().describe('Viewport width in pixels'),
      height: z.number().describe('Viewport height in pixels'),
    },
    async ({ width, height }) => {
      const c = await ensureCanvas();
      try {
        const status = await c.resizeAutomationWebView(width, height);
        return {
          content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );

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

  server.tool(
    'canvas_batch',
    'Run a non-atomic batch of canvas operations with optional assigned references. Use assign to name a result, then reference it later as "$name" for the created node id or "$name.id" for a specific result field. On failure, earlier successful operations remain applied and the response includes ok:false, failedIndex, error, results, and refs. Supports node.add, node.update, node.remove, graph.add, edge.add, group.create, group.add, group.remove, pin.set/add/remove, snapshot.save, and arrange.',
    {
      operations: z.array(z.object({
        op: z.string().describe('Operation name, e.g. "node.add" or "edge.add"'),
        assign: z.string().optional().describe('Optional reference name for later operations'),
        args: z.record(z.string(), z.unknown()).optional().describe('Operation arguments'),
      })).describe('Ordered array of batch operations'),
      full: z.boolean().optional().describe('Return full batch operation results. Default false compacts node-like payloads.'),
      verbose: z.boolean().optional().describe('Alias for full:true.'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const result = await c.runBatch(input.operations);
      const payload = wantsFullPayload(input) ? result : compactBatchResult(result);
      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        ...(result.ok ? {} : { isError: true }),
      };
    },
  );

  server.tool(
    'canvas_validate',
    'Validate the current canvas layout. Distinguishes true node collisions from expected group-child containment and reports missing edge endpoints.',
    {},
    async () => {
      const c = await ensureCanvas();
      return {
        content: [{ type: 'text', text: JSON.stringify(await c.validate(), null, 2) }],
      };
    },
  );

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
