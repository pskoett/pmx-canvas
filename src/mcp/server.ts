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
import {
  createCanvas,
  canvasState,
  describeCanvasSchema,
  validateStructuredCanvasPayload,
  type PmxCanvas,
} from '../server/index.js';
import { serializeNodeForAgentContext } from '../server/agent-context.js';
import { emitPrimaryWorkbenchEvent } from '../server/server.js';
import { searchNodes, buildSpatialContext, findNeighborhoods } from '../server/spatial-analysis.js';
import { mutationHistory, diffLayouts, formatDiff } from '../server/mutation-history.js';
import { buildCodeGraphSummary, formatCodeGraph } from '../server/code-graph.js';
import { buildCanvasSummary, serializeCanvasLayout, serializeCanvasNode } from '../server/canvas-serialization.js';
import { listBundledSkills, readBundledSkill } from '../server/bundled-skills.js';

let canvas: PmxCanvas | null = null;

const jsonRenderSpecSchema = z.object({
  root: z.string(),
  elements: z.record(z.string(), z.unknown()),
  state: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

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

async function ensureCanvas(): Promise<PmxCanvas> {
  if (!canvas) {
    const port = parseInt(process.env.PMX_CANVAS_PORT ?? '4313');
    canvas = createCanvas({ port });
    await canvas.start({ open: true });
  }
  return canvas;
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function createdNodePayload(c: PmxCanvas, id: string): Record<string, unknown> {
  const node = c.getNode(id);
  return node ? { ok: true, ...serializeCanvasNode(node) } : { ok: true, id };
}

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: 'pmx-canvas',
    version: '0.1.0',
  });

  // ── canvas_get_layout ──────────────────────────────────────────
  server.tool(
    'canvas_get_layout',
    'Get the full canvas state: all nodes, edges, and viewport. Call this first to understand what is on the canvas.',
    {},
    async () => {
      const c = await ensureCanvas();
      const layout = serializeCanvasLayout(c.getLayout());
      return {
        content: [{ type: 'text', text: JSON.stringify(layout, null, 2) }],
      };
    },
  );

  // ── canvas_get_node ────────────────────────────────────────────
  server.tool(
    'canvas_get_node',
    'Get a single node by ID, including its full data.',
    { id: z.string().describe('The node ID to retrieve') },
    async ({ id }) => {
      const c = await ensureCanvas();
      const node = c.getNode(id);
      if (!node) {
        return {
          content: [{ type: 'text', text: `Node "${id}" not found.` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(serializeCanvasNode(node), null, 2) }],
      };
    },
  );

  // ── canvas_add_node ────────────────────────────────────────────
  server.tool(
    'canvas_add_node',
    'Add a basic node to the canvas. Returns the created node with normalized title/content and rendered geometry. Supported here: markdown, status, context, ledger, trace, file, image, webpage, mcp-app, group. Dedicated node tools: json-render -> canvas_add_json_render_node, graph -> canvas_add_graph_node, web-artifact -> canvas_build_web_artifact, external apps -> canvas_open_mcp_app, groups -> canvas_create_group. Call canvas_describe_schema for the full nodeTypeRouting table.',
    {
      type: z.enum(['markdown', 'status', 'context', 'ledger', 'trace', 'file', 'image', 'webpage', 'mcp-app', 'group'])
        .describe('Node type (prefer canvas_create_group for groups)'),
      title: z.string().optional().describe('Node title'),
      content: z.string().optional().describe('Node content (markdown for markdown nodes, file path for file nodes, image path/URL/data-URI for image nodes, URL for webpage nodes)'),
      url: z.string().optional().describe('Canonical webpage URL field for webpage nodes. Overrides content when both are provided.'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 600)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      if (input.type === 'webpage') {
        const url = input.url ?? input.content;
        if (!url) {
          return {
            content: [{ type: 'text', text: 'Webpage nodes require a page URL via "url" (preferred) or "content".' }],
            isError: true,
          };
        }
        const result = await c.addWebpageNode({
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          url,
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          ...(result.ok ? {} : { isError: true }),
        };
      }
      const id = c.addNode(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(createdNodePayload(c, id), null, 2) }],
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
      title: z.string().optional().describe('Optional canvas node title override'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 500)'),
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
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
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
      title: z.string().optional().describe('Optional canvas node title override'),
      x: z.number().optional().describe('X position (auto-placed if omitted)'),
      y: z.number().optional().describe('Y position (auto-placed if omitted)'),
      width: z.number().optional().describe('Width in pixels (default: 720)'),
      height: z.number().optional().describe('Height in pixels (default: 500)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      try {
        const result = await c.addDiagram({
          elements: input.elements,
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
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
    'canvas_describe_schema',
    'Describe the current server-supported canvas create schemas, json-render component catalog, canonical examples, and related MCP entry points. Includes mcp.nodeTypeRouting, the authoritative map from node type to MCP creation tool.',
    {},
    async () => ({
      content: [{ type: 'text', text: JSON.stringify(describeCanvasSchema(), null, 2) }],
    }),
  );

  server.tool(
    'canvas_validate_spec',
    'Validate a json-render spec or graph payload without creating a node. Returns the normalized json-render spec that the server would accept.',
    {
      type: z.enum(['json-render', 'graph']).describe('Structured payload type to validate'),
      spec: jsonRenderSpecSchema.optional().describe('json-render spec to validate when type="json-render"'),
      title: z.string().optional().describe('Optional graph title'),
      graphType: z.string().optional().describe('Graph type when type="graph"'),
      data: z.array(z.record(z.string(), z.unknown())).optional().describe('Graph dataset when type="graph"'),
      xKey: z.string().optional().describe('X-axis key for line/bar graphs'),
      yKey: z.string().optional().describe('Y-axis key for line/bar graphs'),
      zKey: z.string().optional().describe('Optional bubble-size key for scatter charts'),
      nameKey: z.string().optional().describe('Slice name key for pie graphs'),
      valueKey: z.string().optional().describe('Slice value key for pie graphs'),
      axisKey: z.string().optional().describe('Category key for radar charts'),
      metrics: z.array(z.string()).optional().describe('Series keys to plot as radar polygons'),
      series: z.array(z.string()).optional().describe('Series keys for stacked-bar segments'),
      barKey: z.string().optional().describe('Bar series key for composed charts'),
      lineKey: z.string().optional().describe('Line series key for composed charts'),
      aggregate: z.enum(['sum', 'count', 'avg']).optional().describe('Optional aggregation for repeated keys'),
      color: z.string().optional().describe('Optional graph color'),
      barColor: z.string().optional().describe('Optional bar color for composed charts'),
      lineColor: z.string().optional().describe('Optional line color for composed charts'),
      height: z.number().optional().describe('Optional graph content height'),
    },
    async (input) => {
      try {
        const result = input.type === 'json-render'
          ? validateStructuredCanvasPayload({
              type: 'json-render',
              spec: input.spec,
            })
          : validateStructuredCanvasPayload({
              type: 'graph',
              graph: {
                title: input.title,
                graphType: input.graphType ?? 'line',
                data: input.data ?? [],
                ...(typeof input.xKey === 'string' ? { xKey: input.xKey } : {}),
                ...(typeof input.yKey === 'string' ? { yKey: input.yKey } : {}),
                ...(typeof input.zKey === 'string' ? { zKey: input.zKey } : {}),
                ...(typeof input.nameKey === 'string' ? { nameKey: input.nameKey } : {}),
                ...(typeof input.valueKey === 'string' ? { valueKey: input.valueKey } : {}),
                ...(typeof input.axisKey === 'string' ? { axisKey: input.axisKey } : {}),
                ...(Array.isArray(input.metrics) ? { metrics: input.metrics } : {}),
                ...(Array.isArray(input.series) ? { series: input.series } : {}),
                ...(typeof input.barKey === 'string' ? { barKey: input.barKey } : {}),
                ...(typeof input.lineKey === 'string' ? { lineKey: input.lineKey } : {}),
                ...(typeof input.aggregate === 'string' ? { aggregate: input.aggregate } : {}),
                ...(typeof input.color === 'string' ? { color: input.color } : {}),
                ...(typeof input.barColor === 'string' ? { barColor: input.barColor } : {}),
                ...(typeof input.lineColor === 'string' ? { lineColor: input.lineColor } : {}),
                ...(typeof input.height === 'number' ? { height: input.height } : {}),
              },
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
    'Build a bundled single-file HTML web artifact from React/Tailwind source files using the bundled web-artifacts-builder skill scripts. MCP callers pass source content in appTsx (the CLI app-file flag reads a file before calling this path). Builds commonly take 45-60s on cold workspaces; use a long client timeout. Optionally opens the generated artifact as an embedded node on the canvas. Read canvas://skills/web-artifacts-builder for the full workflow, stack, and anti-slop design guidelines before calling.',
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
      initScriptPath: z.string().optional().describe('Optional absolute script path override for tests/debugging'),
      bundleScriptPath: z.string().optional().describe('Optional absolute script path override for tests/debugging'),
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

  // ── canvas_add_json_render_node ───────────────────────────
  server.tool(
    'canvas_add_json_render_node',
    'Create a native json-render canvas node from a complete spec. Use this for structured dashboards, forms, tables, and other interactive UI panels that should render directly inside PMX Canvas.',
    {
      title: z.string().describe('Node title'),
      spec: jsonRenderSpecSchema.describe('Complete json-render spec with root, elements, and optional state'),
      x: z.number().optional().describe('Optional X position'),
      y: z.number().optional().describe('Optional Y position'),
      width: z.number().optional().describe('Optional node width'),
      height: z.number().optional().describe('Optional node height'),
    },
    async (input) => {
      const c = await ensureCanvas();
      try {
        const result = c.addJsonRenderNode({
          title: input.title,
          spec: input.spec,
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...createdNodePayload(c, result.id),
              url: result.url,
              spec: result.spec,
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

  // ── canvas_add_graph_node ─────────────────────────────────
  server.tool(
    'canvas_add_graph_node',
    'Create a native graph node backed by the json-render chart catalog. Supports line, bar, pie, area, scatter, radar, stacked-bar, and composed (bar+line) graphs rendered directly inside PMX Canvas.',
    {
      title: z.string().optional().describe('Optional node title'),
      graphType: z.string().describe('Graph type: line, bar, pie, area, scatter, radar, stacked-bar (or "stack"), composed (or "combo")'),
      data: z.array(z.record(z.string(), z.unknown())).describe('Array of chart data objects'),
      xKey: z.string().optional().describe('X-axis key (line/bar/area/scatter/stacked/composed)'),
      yKey: z.string().optional().describe('Y-axis key (line/bar/area/scatter); falls back to barKey for composed'),
      zKey: z.string().optional().describe('Optional bubble-size key for scatter charts'),
      nameKey: z.string().optional().describe('Name key for pie graphs'),
      valueKey: z.string().optional().describe('Value key for pie graphs'),
      axisKey: z.string().optional().describe('Category key for radar charts'),
      metrics: z.array(z.string()).optional().describe('Series keys to plot as radar polygons (defaults to non-axis numeric columns)'),
      series: z.array(z.string()).optional().describe('Series keys for stacked-bar segments (defaults to non-x numeric columns)'),
      barKey: z.string().optional().describe('Bar series key for composed charts'),
      lineKey: z.string().optional().describe('Line series key for composed charts'),
      aggregate: z.enum(['sum', 'count', 'avg']).optional().describe('Optional aggregation for repeated x-axis values (line/bar/area/stacked)'),
      color: z.string().optional().describe('Optional series color (line/bar/area/scatter)'),
      barColor: z.string().optional().describe('Optional bar color for composed charts'),
      lineColor: z.string().optional().describe('Optional line color for composed charts'),
      height: z.number().optional().describe('Optional chart content height'),
      x: z.number().optional().describe('Optional X position'),
      y: z.number().optional().describe('Optional Y position'),
      width: z.number().optional().describe('Optional node width'),
      nodeHeight: z.number().optional().describe('Optional node height'),
    },
    async (input) => {
      const c = await ensureCanvas();
      try {
        const result = c.addGraphNode({
          graphType: input.graphType,
          data: input.data,
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          ...(typeof input.xKey === 'string' ? { xKey: input.xKey } : {}),
          ...(typeof input.yKey === 'string' ? { yKey: input.yKey } : {}),
          ...(typeof input.zKey === 'string' ? { zKey: input.zKey } : {}),
          ...(typeof input.nameKey === 'string' ? { nameKey: input.nameKey } : {}),
          ...(typeof input.valueKey === 'string' ? { valueKey: input.valueKey } : {}),
          ...(typeof input.axisKey === 'string' ? { axisKey: input.axisKey } : {}),
          ...(Array.isArray(input.metrics) ? { metrics: input.metrics } : {}),
          ...(Array.isArray(input.series) ? { series: input.series } : {}),
          ...(typeof input.barKey === 'string' ? { barKey: input.barKey } : {}),
          ...(typeof input.lineKey === 'string' ? { lineKey: input.lineKey } : {}),
          ...(typeof input.aggregate === 'string' ? { aggregate: input.aggregate } : {}),
          ...(typeof input.color === 'string' ? { color: input.color } : {}),
          ...(typeof input.barColor === 'string' ? { barColor: input.barColor } : {}),
          ...(typeof input.lineColor === 'string' ? { lineColor: input.lineColor } : {}),
          ...(typeof input.height === 'number' ? { height: input.height } : {}),
          ...(typeof input.x === 'number' ? { x: input.x } : {}),
          ...(typeof input.y === 'number' ? { y: input.y } : {}),
          ...(typeof input.width === 'number' ? { width: input.width } : {}),
          ...(typeof input.nodeHeight === 'number' ? { heightPx: input.nodeHeight } : {}),
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...createdNodePayload(c, result.id),
              url: result.url,
              spec: result.spec,
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

  // ── canvas_update_node ─────────────────────────────────────────
  server.tool(
    'canvas_update_node',
    'Update an existing node. You can change its content, title, position, size, or data.',
    {
      id: z.string().describe('Node ID to update'),
      title: z.string().optional().describe('New title'),
      content: z.string().optional().describe('New content'),
      x: z.number().optional().describe('New X position'),
      y: z.number().optional().describe('New Y position'),
      width: z.number().optional().describe('New width'),
      height: z.number().optional().describe('New height'),
      collapsed: z.boolean().optional().describe('Collapse or expand the node'),
      arrangeLocked: z.boolean().optional().describe('Prevent auto-arrange from moving this node. Pinned nodes are also skipped.'),
    },
    async ({ id, title, content, x, y, width, height, collapsed, arrangeLocked }) => {
      const c = await ensureCanvas();
      const node = c.getNode(id);
      if (!node) {
        return {
          content: [{ type: 'text', text: `Node "${id}" not found.` }],
          isError: true,
        };
      }
      const patch: Record<string, unknown> = {};
      if (x !== undefined || y !== undefined) {
        patch.position = { x: x ?? node.position.x, y: y ?? node.position.y };
      }
      if (width !== undefined || height !== undefined) {
        patch.size = { width: width ?? node.size.width, height: height ?? node.size.height };
      }
      if (collapsed !== undefined) {
        patch.collapsed = collapsed;
      }
      if (title !== undefined || content !== undefined) {
        patch.data = {
          ...node.data,
          ...(title !== undefined ? { title } : {}),
          ...(content !== undefined ? { content } : {}),
        };
      }
      if (arrangeLocked !== undefined) {
        patch.data = {
          ...(patch.data && typeof patch.data === 'object' ? patch.data as Record<string, unknown> : node.data),
          arrangeLocked,
        };
      }
      c.updateNode(id, patch);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, id }) }],
      };
    },
  );

  // ── canvas_remove_node ─────────────────────────────────────────
  server.tool(
    'canvas_remove_node',
    'Remove a node from the canvas. Also removes all edges connected to it.',
    { id: z.string().describe('Node ID to remove') },
    async ({ id }) => {
      const c = await ensureCanvas();
      c.removeNode(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, removed: id }) }],
      };
    },
  );

  // ── canvas_add_edge ────────────────────────────────────────────
  server.tool(
    'canvas_add_edge',
    'Add an edge (connection) between two nodes. Edge types: flow (sequential), depends-on (dependency), relation (general), references (cross-reference).',
    {
      from: z.string().optional().describe('Source node ID'),
      to: z.string().optional().describe('Target node ID'),
      fromSearch: z.string().optional().describe('Resolve the source node by exact or fuzzy title/content search'),
      toSearch: z.string().optional().describe('Resolve the target node by exact or fuzzy title/content search'),
      type: z.enum(['flow', 'depends-on', 'relation', 'references']).describe('Edge type'),
      label: z.string().optional().describe('Edge label text'),
      style: z.enum(['solid', 'dashed', 'dotted']).optional().describe('Optional edge stroke style'),
      animated: z.boolean().optional().describe('Animate the edge stroke'),
    },
    async (input) => {
      const c = await ensureCanvas();
      if (!input.from && !input.fromSearch) {
        return {
          content: [{ type: 'text', text: 'Provide either "from" or "fromSearch".' }],
          isError: true,
        };
      }
      if (!input.to && !input.toSearch) {
        return {
          content: [{ type: 'text', text: 'Provide either "to" or "toSearch".' }],
          isError: true,
        };
      }
      try {
        const id = c.addEdge(input);
        const edge = c.getLayout().edges.find((entry) => entry.id === id);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(edge ? { id, from: edge.from, to: edge.to, type: edge.type, label: edge.label, style: edge.style, animated: edge.animated } : { id }, null, 2),
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

  // ── canvas_remove_edge ─────────────────────────────────────────
  server.tool(
    'canvas_remove_edge',
    'Remove an edge from the canvas.',
    { id: z.string().describe('Edge ID to remove') },
    async ({ id }) => {
      const c = await ensureCanvas();
      c.removeEdge(id);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, removed: id }) }],
      };
    },
  );

  // ── canvas_arrange ─────────────────────────────────────────────
  server.tool(
    'canvas_arrange',
    'Auto-arrange all nodes on the canvas. Layouts: grid (default), column (vertical stack), flow (horizontal row).',
    {
      layout: z.enum(['grid', 'column', 'flow']).optional().describe('Arrangement layout (default: grid)'),
    },
    async ({ layout }) => {
      const c = await ensureCanvas();
      c.arrange(layout ?? 'grid');
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, layout: layout ?? 'grid' }) }],
      };
    },
  );

  // ── canvas_focus_node ──────────────────────────────────────────
  server.tool(
    'canvas_focus_node',
    'Bring a node into focus. By default the viewport pans so the node is centered. Pass noPan=true to raise/select the node without moving the human\'s camera (useful when reacting to background events without disrupting the human\'s current view).',
    {
      id: z.string().describe('Node ID to focus on'),
      noPan: z
        .boolean()
        .optional()
        .describe('If true, raise/select the node without panning the viewport. Default false.'),
    },
    async ({ id, noPan }) => {
      const c = await ensureCanvas();
      const result = c.focusNode(id, { ...(noPan === true ? { noPan: true } : {}) });
      if (!result) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, error: `Node "${id}" not found.` }),
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ ok: true, focused: result.focused, panned: result.panned }),
          },
        ],
      };
    },
  );

  // ── canvas_clear ───────────────────────────────────────────────
  server.tool(
    'canvas_clear',
    'Remove all nodes and edges from the canvas. Use with caution.',
    {},
    async () => {
      const c = await ensureCanvas();
      c.clear();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, cleared: true }) }],
      };
    },
  );

  // ── canvas_search ───────────────────────────────────────────
  server.tool(
    'canvas_search',
    'Search for nodes by title or content keywords. Returns matching nodes ranked by relevance with snippets. Much faster than reading the full layout when you need to find specific nodes.',
    {
      query: z.string().describe('Search query — matches against node titles, content, and file paths'),
      limit: z.number().optional().describe('Max results to return (default: 10)'),
    },
    async ({ query, limit }) => {
      await ensureCanvas();
      const results = searchNodes(canvasState.getLayout().nodes, query);
      const capped = results.slice(0, limit ?? 10);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ query, resultCount: results.length, results: capped }, null, 2),
        }],
      };
    },
  );

  // ── canvas_undo ────────────────────────────────────────────────
  server.tool(
    'canvas_undo',
    'Undo the last canvas mutation. Returns a description of what was undone. Use this to backtrack when an approach is wrong — explore without fear.',
    {},
    async () => {
      const c = await ensureCanvas();
      const result = await c.undo();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, canUndo: mutationHistory.canUndo(), canRedo: mutationHistory.canRedo() }) }],
      };
    },
  );

  // ── canvas_redo ────────────────────────────────────────────────
  server.tool(
    'canvas_redo',
    'Redo the last undone canvas mutation. Use after undo to re-apply a change.',
    {},
    async () => {
      const c = await ensureCanvas();
      const result = await c.redo();
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...result, canUndo: mutationHistory.canUndo(), canRedo: mutationHistory.canRedo() }) }],
      };
    },
  );

  // ── canvas_diff ────────────────────────────────────────────────
  server.tool(
    'canvas_diff',
    'Compare the current canvas state against a saved snapshot. Shows added/removed/modified nodes and edges. Pass either a snapshot name or ID.',
    {
      snapshot: z.string().describe('Snapshot name or ID to compare against'),
    },
    async ({ snapshot }) => {
      await ensureCanvas();
      const snapData = canvasState.getSnapshotData(snapshot);
      if (!snapData) {
        return { content: [{ type: 'text', text: `Snapshot "${snapshot}" not found. Use canvas_snapshot to save one first.` }], isError: true };
      }
      const current = canvasState.getLayout();
      const diff = diffLayouts(snapData.name, snapData, current);
      return {
        content: [{ type: 'text', text: formatDiff(diff) }],
      };
    },
  );

  // ── canvas_webview_status ─────────────────────────────────────
  server.tool(
    'canvas_webview_status',
    'Get the current Bun.WebView automation status for the PMX Canvas workbench. Returns whether Bun.WebView is supported, whether an automation session is active, backend, viewport size, and the current workbench URL if active.',
    {},
    async () => {
      const c = await ensureCanvas();
      return {
        content: [{ type: 'text', text: JSON.stringify(c.getAutomationWebViewStatus(), null, 2) }],
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
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ok: true,
              stopped,
              webview: c.getAutomationWebViewStatus(),
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
      script: z.string().optional().describe('Multi-statement JavaScript body. The MCP server wraps it in an IIFE and evaluates the return value.'),
    },
    async ({ expression, script }) => {
      const c = await ensureCanvas();
      if ((expression ? 1 : 0) + (script ? 1 : 0) !== 1) {
        return {
          content: [{ type: 'text', text: 'Pass exactly one of "expression" or "script".' }],
          isError: true,
        };
      }

      const source = script ? `(() => {\n${script}\n})()` : expression!;
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
        const status = c.getAutomationWebViewStatus();
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
      const pinnedIds = canvasState.contextPinnedNodeIds;
      const layout = c.getLayout();

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
      const layout = serializeCanvasLayout(c.getLayout());
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
      await ensureCanvas();
      return {
        contents: [
          {
            uri: 'canvas://summary',
            mimeType: 'application/json',
            text: JSON.stringify(buildCanvasSummary(), null, 2),
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
      await ensureCanvas();
      const layout = canvasState.getLayout();
      const spatial = buildSpatialContext(layout.nodes, layout.edges, canvasState.contextPinnedNodeIds);
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
      await ensureCanvas();
      return {
        contents: [
          {
            uri: 'canvas://history',
            mimeType: 'text/plain',
            text: mutationHistory.toHumanReadable(),
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
      await ensureCanvas();
      const summary = buildCodeGraphSummary();
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

  // ── canvas_create_group ──────────────────────────────────────
  server.tool(
    'canvas_create_group',
    'Create a group (frame) on the canvas that visually contains other nodes. Groups are spatial containers — they communicate "these nodes belong together." If childIds are provided, grouping preserves child positions by default; pass childLayout to auto-pack them. You can also provide an explicit frame (x/y/width/height) and auto-arrange children inside it.',
    {
      title: z.string().optional().describe('Group title (default: "Group")'),
      childIds: z.array(z.string()).optional().describe('Node IDs to include in the group. Group auto-sizes to fit them.'),
      color: z.string().optional().describe('Group accent color (CSS color string, e.g. "#4a9eff")'),
      x: z.number().optional().describe('X position (auto-computed from children if omitted)'),
      y: z.number().optional().describe('Y position (auto-computed from children if omitted)'),
      width: z.number().optional().describe('Width (auto-computed from children if omitted)'),
      height: z.number().optional().describe('Height (auto-computed from children if omitted)'),
      childLayout: z.enum(['grid', 'column', 'flow']).optional().describe('Optional child auto-layout. Omit to preserve current child positions.'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const id = c.createGroup(input);
      return {
        content: [{ type: 'text', text: JSON.stringify(createdNodePayload(c, id), null, 2) }],
      };
    },
  );

  // ── canvas_group_nodes ──────────────────────────────────────
  server.tool(
    'canvas_group_nodes',
    'Add nodes to an existing group. The nodes will be visually contained within the group frame.',
    {
      groupId: z.string().describe('The group node ID'),
      childIds: z.array(z.string()).describe('Node IDs to add to the group'),
      childLayout: z.enum(['grid', 'column', 'flow']).optional().describe('Optional child layout to apply while grouping'),
    },
    async ({ groupId, childIds, childLayout }) => {
      const c = await ensureCanvas();
      const ok = c.groupNodes(groupId, childIds, childLayout ? { childLayout } : undefined);
      if (!ok) {
        return { content: [{ type: 'text', text: 'Group not found or no valid children.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groupId }) }] };
    },
  );

  server.tool(
    'canvas_batch',
    'Run a batch of canvas operations with optional assigned references. Supports node.add, node.update, graph.add, edge.add, group.create, group.add, group.remove, pin.set/add/remove, snapshot.save, and arrange.',
    {
      operations: z.array(z.object({
        op: z.string().describe('Operation name, e.g. "node.add" or "edge.add"'),
        assign: z.string().optional().describe('Optional reference name for later operations'),
        args: z.record(z.string(), z.unknown()).optional().describe('Operation arguments'),
      })).describe('Ordered array of batch operations'),
    },
    async ({ operations }) => {
      const c = await ensureCanvas();
      const result = await c.runBatch(operations);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
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
        content: [{ type: 'text', text: JSON.stringify(c.validate(), null, 2) }],
      };
    },
  );

  // ── canvas_ungroup ──────────────────────────────────────────
  server.tool(
    'canvas_ungroup',
    'Remove all children from a group, releasing them as independent nodes. The group node itself remains (delete it separately with canvas_remove_node if desired).',
    {
      groupId: z.string().describe('The group node ID to ungroup'),
    },
    async ({ groupId }) => {
      const c = await ensureCanvas();
      const ok = c.ungroupNodes(groupId);
      if (!ok) {
        return { content: [{ type: 'text', text: 'Group not found or already empty.' }], isError: true };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, groupId }) }] };
    },
  );

  // ── canvas_pin_nodes ─────────────────────────────────────────
  server.tool(
    'canvas_pin_nodes',
    'Pin nodes to include them in the agent context. Pinned nodes appear in the canvas://pinned-context resource. The human can also pin nodes by clicking in the browser.',
    {
      nodeIds: z.array(z.string()).describe('Array of node IDs to pin'),
      mode: z.enum(['set', 'add', 'remove']).optional()
        .describe('set: replace all pins, add: add to existing pins, remove: unpin these nodes (default: set)'),
    },
    async ({ nodeIds, mode }) => {
      const c = await ensureCanvas();
      const result = c.setContextPins(nodeIds, mode ?? 'set');

      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: true,
            pinnedNodeIds: result.nodeIds,
          }),
        }],
      };
    },
  );

  // ── canvas_snapshot ──────────────────────────────────────────
  server.tool(
    'canvas_snapshot',
    'Save the current canvas state as a named snapshot. Snapshots persist to disk and can be restored later.',
    {
      name: z.string().describe('Name for this snapshot (e.g., "before refactor", "investigation v2")'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const snapshot = c.saveSnapshot(input.name);
      if (!snapshot) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Failed to save snapshot' }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ ok: true, snapshot }) }] };
    },
  );

  // ── canvas_list_snapshots ───────────────────────────────────
  server.tool(
    'canvas_list_snapshots',
    'List all saved canvas snapshots with IDs, names, timestamps, and node/edge counts.',
    {},
    async () => {
      const c = await ensureCanvas();
      return {
        content: [{ type: 'text', text: JSON.stringify({ snapshots: c.listSnapshots() }, null, 2) }],
      };
    },
  );

  // ── canvas_restore ──────────────────────────────────────────
  server.tool(
    'canvas_restore',
    'Restore the canvas to a previously saved snapshot. Use canvas_snapshot to save first. Pass either the snapshot ID or name to restore.',
    {
      id: z.string().describe('Snapshot ID or name to restore (from canvas_snapshot or snapshot list)'),
    },
    async (input) => {
      const c = await ensureCanvas();
      const result = await c.restoreSnapshot(input.id);
      if (!result.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Snapshot not found' }) }] };
      }
      emitPrimaryWorkbenchEvent('canvas-layout-update', { layout: canvasState.getLayout() });
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, layout: serializeCanvasLayout(canvasState.getLayout()) }) }],
      };
    },
  );

  // ── canvas_delete_snapshot ──────────────────────────────────
  server.tool(
    'canvas_delete_snapshot',
    'Delete a saved snapshot by ID.',
    {
      id: z.string().describe('Snapshot ID to delete'),
    },
    async ({ id }) => {
      const c = await ensureCanvas();
      const result = c.deleteSnapshot(id);
      if (!result.ok) {
        return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Snapshot not found' }) }], isError: true };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, deleted: id }) }],
      };
    },
  );

  // ── Resource change notifications ──────────────────────────
  // When canvas state changes (nodes, edges, pins), notify MCP clients
  // so they can re-read resources like canvas://pinned-context.
  canvasState.onChange((type) => {
    try {
      if (type === 'pins') {
        server.server.sendResourceUpdated({ uri: 'canvas://pinned-context' });
      }
      server.server.sendResourceUpdated({ uri: 'canvas://layout' });
      server.server.sendResourceUpdated({ uri: 'canvas://summary' });
      server.server.sendResourceUpdated({ uri: 'canvas://spatial-context' });
      server.server.sendResourceUpdated({ uri: 'canvas://history' });
      server.server.sendResourceUpdated({ uri: 'canvas://code-graph' });
    } catch (error) {
      console.debug('[mcp] resource notification failed', error);
    }
  });

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
