import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describeJsonRenderCatalog, type JsonRenderComponentDescriptor } from '../json-render/catalog.js';
import {
  buildGraphSpec,
  normalizeAndValidateJsonRenderSpec,
  normalizeGraphType,
  type GraphNodeInput,
  type JsonRenderSpec,
} from '../json-render/server.js';
import {
  buildHtmlPrimitive,
  isHtmlPrimitiveKind,
  listHtmlPrimitiveDescriptors,
  type HtmlPrimitiveDescriptor,
} from './html-primitives.js';

export interface CanvasCreateField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  aliases?: string[];
}

export interface CanvasCreateTypeSchema {
  type: string;
  kind: 'node' | 'virtual-node';
  description: string;
  endpoint: string;
  mcpTool?: string;
  fields: CanvasCreateField[];
  example: Record<string, unknown>;
  notes?: string[];
}

export interface StructuredValidationResult {
  ok: true;
  type: 'json-render' | 'graph' | 'html-primitive';
  normalizedSpec?: JsonRenderSpec;
  normalizedPrimitive?: {
    kind: string;
    title: string;
    htmlBytes: number;
    defaultSize: { width: number; height: number };
  };
  summary: Record<string, unknown>;
}

const CANONICAL_GRAPH_TYPES = [
  'line',
  'bar',
  'pie',
  'area',
  'scatter',
  'radar',
  'stacked-bar',
  'composed',
  'sparkline',
  'dot-plot',
  'bullet',
  'slopegraph',
] as const;

type CanvasGraphType = typeof CANONICAL_GRAPH_TYPES[number];

function readPackageVersion(): string | null {
  try {
    const raw = readFileSync(join(import.meta.dir, '..', '..', 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

const CANVAS_CREATE_TYPES: CanvasCreateTypeSchema[] = [
  {
    type: 'markdown',
    kind: 'node',
    description: 'Freeform markdown note.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional node title.' },
      { name: 'content', type: 'string', required: false, description: 'Markdown body.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
      { name: 'strictSize', type: 'boolean', required: false, description: 'Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting.', aliases: ['strict-size', 'scroll-overflow'] },
    ],
    example: {
      type: 'markdown',
      title: 'Design Doc',
      content: '# Overview\n\nCapture the working plan here.',
    },
    notes: [
      'When a markdown node is path-backed (`data.path`), the server persists `data.provenance` so snapshots keep a refreshable file source.',
    ],
  },
  {
    type: 'status',
    kind: 'node',
    description: 'Compact status indicator.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Status label.' },
      { name: 'content', type: 'string', required: false, description: 'Rendered status text.' },
    ],
    example: {
      type: 'status',
      title: 'Build',
      content: 'passing',
    },
  },
  {
    type: 'context',
    kind: 'node',
    description: 'Agent context card container.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional title override.' },
      { name: 'content', type: 'string', required: false, description: 'Optional context body.' },
    ],
    example: {
      type: 'context',
      title: 'Pinned Context',
      content: 'Human-curated context summary.',
    },
  },
  {
    type: 'ledger',
    kind: 'node',
    description: 'Structured ledger/log node.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional title.' },
      { name: 'content', type: 'string', required: false, description: 'Ledger body text.' },
    ],
    example: {
      type: 'ledger',
      title: 'Decision Log',
      content: '- Chose SSE for realtime sync',
    },
  },
  {
    type: 'trace',
    kind: 'node',
    description: 'Execution trace viewer.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional title.' },
      { name: 'content', type: 'string', required: false, description: 'Trace summary.' },
      { name: 'toolName', type: 'string', required: false, description: 'Tool or operation label shown in the trace pill; defaults to title.' },
      { name: 'category', type: 'string', required: false, description: 'Trace category color key: mcp, file, subagent, or other.' },
      { name: 'status', type: 'string', required: false, description: 'Trace status: running, success, or failed.' },
      { name: 'duration', type: 'string', required: false, description: 'Optional duration badge text.' },
      { name: 'resultSummary', type: 'string', required: false, description: 'Short trace result summary; defaults to content.' },
      { name: 'error', type: 'string', required: false, description: 'Short error message shown in failed traces.' },
    ],
    example: {
      type: 'trace',
      title: 'Execution Trace',
      content: 'Canvas actions and tool events.',
      status: 'success',
    },
  },
  {
    type: 'file',
    kind: 'node',
    description: 'Workspace file viewer.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'content', type: 'string', required: true, description: 'Workspace-relative or absolute file path.' },
      { name: 'title', type: 'string', required: false, description: 'Optional title override.' },
    ],
    example: {
      type: 'file',
      content: 'src/server/server.ts',
    },
    notes: [
      'Path-backed file nodes automatically persist `data.provenance` with a file URI and file-watch refresh strategy.',
    ],
  },
  {
    type: 'image',
    kind: 'node',
    description: 'Image node backed by a path, URL, or data URI.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'content', type: 'string', required: true, description: 'Image path, URL, or data URI.', aliases: ['path'] },
      { name: 'title', type: 'string', required: false, description: 'Optional title override.' },
      { name: 'data.warning', type: 'string | { title?: string; detail: string }', required: false, description: 'Optional agent-supplied warning shown above the image.' },
      { name: 'data.warnings', type: 'Array<string | { title?: string; detail: string }>', required: false, description: 'Optional list of agent-supplied image warnings.' },
      { name: 'data.validationStatus', type: '"passed" | "failed" | "invalid"', required: false, description: 'Optional agent validation result for evidence-style images.' },
      { name: 'data.validationMessage', type: 'string', required: false, description: 'Optional detail shown when validation fails.' },
    ],
    example: {
      type: 'image',
      content: 'artifacts/architecture.png',
      data: {
        validationStatus: 'failed',
        validationMessage: 'Captured login page instead of the intended dashboard.',
      },
    },
    notes: [
      'File-backed and HTTP(S)-backed images automatically persist `data.provenance` so agents can tell whether the node came from disk or a remote URL.',
    ],
  },
  {
    type: 'webpage',
    kind: 'node',
    description: 'Persisted webpage snapshot with server-side fetch and refresh.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add")',
    fields: [
      { name: 'url', type: 'string', required: true, description: 'HTTP(S) URL to fetch and cache.', aliases: ['content'] },
      { name: 'title', type: 'string', required: false, description: 'Optional title override.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
      { name: 'strictSize', type: 'boolean', required: false, description: 'Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting.', aliases: ['strict-size', 'scroll-overflow'] },
    ],
    example: {
      type: 'webpage',
      title: 'PMX Canvas README',
      url: 'https://example.com/docs',
    },
    notes: [
      '`url` is the canonical field. `content` is still accepted for backward compatibility.',
      'Webpage nodes persist `data.provenance` with the source URL and refresh strategy so reopened snapshots can be re-fetched.',
    ],
  },
  {
    type: 'html',
    kind: 'node',
    description: 'Sandboxed iframe node rendered from inline HTML.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add", type:"html")',
    fields: [
      { name: 'html', type: 'string', required: false, description: 'HTML document or fragment rendered in the sandboxed iframe.', aliases: ['content', 'stdin'] },
      { name: 'summary', type: 'string', required: false, description: 'Explicit agent-readable summary. If omitted, PMX derives one from visible HTML text.' },
      { name: 'agentSummary', type: 'string', required: false, description: 'Explicit semantic sidecar used by search, pinned context, and spatial context.', aliases: ['agent-summary'] },
      { name: 'embeddedNodeIds', type: 'string[]', required: false, description: 'Canvas node IDs represented or iframe-embedded by this HTML surface.', aliases: ['embedded-node-id', 'embedded-node-ids'] },
      { name: 'embeddedUrls', type: 'string[]', required: false, description: 'URLs represented or iframe-embedded by this HTML surface.', aliases: ['embedded-url', 'embedded-urls'] },
      { name: 'presentation', type: 'boolean', required: false, description: 'Marks this HTML surface as a fullscreen presentation/deck.' },
      { name: 'slideTitles', type: 'string[]', required: false, description: 'Agent-readable slide titles for presentation HTML.', aliases: ['slide-title', 'slide-titles'] },
      { name: 'primitive', type: 'HtmlPrimitiveKind', required: false, description: 'Generate HTML from a built-in communication primitive instead of passing raw HTML.', aliases: ['kind'] },
      { name: 'data', type: 'record<string, unknown>', required: false, description: 'Primitive data when --primitive is used, or arbitrary node metadata.' },
      { name: 'title', type: 'string', required: false, description: 'Optional node title.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
      { name: 'strictSize', type: 'boolean', required: false, description: 'Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting.', aliases: ['strict-size', 'scroll-overflow'] },
    ],
    example: {
      type: 'html',
      title: 'HTML Widget',
      html: '<main><h1>Hello from PMX Canvas</h1></main>',
    },
    notes: [
      'The CLI accepts --content as an alias and stores it as data.html so the renderer can load it.',
      'Normal html nodes are the default. Presentation mode is opt-in via presentation:true or the presentation primitive.',
      'HTML nodes persist data.contentSummary and data.agentSummary so agents can understand rich visual HTML without parsing the full iframe payload.',
      'Only presentation-marked HTML nodes expose a browser Present button for fullscreen review; use the presentation primitive for PowerPoint-like decks.',
      'Use `primitive` / `kind` with `data` to create reusable agent communication artifacts such as choice grids, plans, review sheets, explainers, and editors.',
      'HTML runs in a sandboxed iframe without same-origin access to the canvas host.',
    ],
  },
  {
    type: 'html-primitive',
    kind: 'virtual-node',
    description: 'Reusable sandboxed HTML communication primitive rendered as an html node.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_node (action:"add", type:"html", primitive:"<kind>")',
    fields: [
      { name: 'kind', type: 'HtmlPrimitiveKind', required: true, description: 'Primitive kind. See top-level htmlPrimitives for the supported catalog.' },
      { name: 'data', type: 'record<string, unknown>', required: false, description: 'Primitive-specific JSON object payload.' },
      { name: 'title', type: 'string', required: false, description: 'Optional node title.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width; defaults per primitive.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height; defaults per primitive.' },
      { name: 'strictSize', type: 'boolean', required: false, description: 'Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting.', aliases: ['strict-size', 'scroll-overflow'] },
    ],
    example: {
      type: 'html-primitive',
      kind: 'choice-grid',
      title: 'Implementation Options',
      data: {
        items: [
          { title: 'Small patch', summary: 'Least disruption.', pros: ['Fast'], cons: ['Limited flexibility'] },
        ],
      },
    },
    notes: [
      'HTTP callers may POST { type: "html-primitive", kind, data } or { type: "html", primitive: kind, data }; both create a normal html node with primitive metadata.',
      'Use kind "presentation" only when a PowerPoint-like deck is requested; created nodes persist presentation, slideCount, slideTitles, and optional presentationTheme metadata for agents.',
      'Presentation primitive data supports theme: "canvas" | "midnight" | "paper" | "aurora" or a custom color object with bg, panel, surface, border, text, textSecondary, textMuted, accent, and colorScheme.',
      'Interactive editor primitives include copy/export controls so the human can send edited state back to the agent.',
    ],
  },
  {
    type: 'mcp-app',
    kind: 'node',
    description: 'Hosted iframe/app node.',
    endpoint: '/api/canvas/node',
    mcpTool: 'canvas_app (action:"open-mcp-app")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'App title.' },
      { name: 'content', type: 'string', required: false, description: 'Optional inline content.' },
    ],
    example: {
      type: 'mcp-app',
      title: 'Embedded App',
      content: 'Use the dedicated tool for artifact builds when possible.',
    },
    notes: [
      'Tool-backed MCP app nodes and hosted artifact nodes persist `data.provenance` when the server can infer a reopen or rehydrate path.',
    ],
  },
  {
    type: 'external-app',
    kind: 'virtual-node',
    description: 'Tool-backed hosted app opened from an external MCP server, such as Excalidraw.',
    endpoint: '/api/canvas/mcp-app/open',
    mcpTool: 'canvas_app (action:"open-mcp-app")',
    fields: [
      { name: 'toolName', type: 'string', required: true, description: 'Tool name on the external MCP server.' },
      { name: 'transport', type: '{ type: "stdio", command, args? } | { type: "http", url, headers? }', required: true, description: 'External MCP transport definition.' },
      { name: 'toolArguments', type: 'record<string, unknown>', required: false, description: 'Arguments passed to the external MCP tool.' },
      { name: 'title', type: 'string', required: false, description: 'Optional canvas node title override.' },
    ],
    example: {
      toolName: 'create_view',
      transport: { type: 'http', url: 'https://mcp.excalidraw.com/mcp' },
      toolArguments: { elements: '[]' },
      title: 'Excalidraw Diagram',
    },
    notes: [
      'For Excalidraw specifically, prefer canvas_app (action:"diagram") because it fills in the built-in transport, toolName, and checkpoint wiring.',
      'The CLI convenience command `external-app add --kind excalidraw` maps to this built-in Excalidraw preset; MCP canvas_app (action:"open-mcp-app") is the lower-level transport form.',
    ],
  },
  {
    type: 'group',
    kind: 'node',
    description: 'Canvas group frame.',
    endpoint: '/api/canvas/group',
    mcpTool: 'canvas_group (action:"create")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Group title.' },
      { name: 'childIds', type: 'string[]', required: false, description: 'Initial child node IDs.' },
      { name: 'childLayout', type: '"grid" | "column" | "flow"', required: false, description: 'Optional layout for grouped children.' },
    ],
    example: {
      title: 'API Layer',
      childIds: ['node-a', 'node-b'],
      childLayout: 'column',
    },
  },
  {
    type: 'json-render',
    kind: 'virtual-node',
    description: 'Native structured UI panel rendered from a validated json-render spec.',
    endpoint: '/api/canvas/json-render',
    mcpTool: 'canvas_render (action:"add-json-render")',
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional rendered node title; inferred from the root element when omitted.' },
      { name: 'spec', type: 'JsonRenderSpec | JsonRenderElement', required: true, description: 'Complete {root, elements} json-render spec, or a legacy single bare component object with a type field.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
    ],
    example: {
      title: 'Ops Dashboard',
      spec: {
        root: 'card',
        elements: {
          card: {
            type: 'Card',
            props: { title: 'Ops Dashboard' },
            children: ['copy'],
          },
          copy: {
            type: 'Text',
            props: { text: 'Live service summary' },
            children: [],
          },
        },
      },
    },
  },
  {
    type: 'graph',
    kind: 'virtual-node',
    description: 'Native chart node backed by the json-render chart catalog.',
    endpoint: '/api/canvas/graph',
    mcpTool: 'canvas_render (action:"add-graph")',
    fields: [
      {
        name: 'graphType',
        type: '"line" | "bar" | "pie" | "area" | "scatter" | "radar" | "stacked-bar" | "composed" | "sparkline" | "dot-plot" | "bullet" | "slopegraph"',
        required: true,
        description: 'Chart type. Includes the Tufte primitives sparkline, dot-plot (Cleveland), bullet (Few KPI vs target), and slopegraph (paired before/after). Aliases like "stack", "combo", "dot", and "slope" are normalized server-side.',
        aliases: ['graph-type'],
      },
      { name: 'data', type: 'Record<string, unknown>[]', required: true, description: 'Chart dataset. The CLI also accepts piped JSON via --stdin.', aliases: ['data-json', 'data-file'] },
      { name: 'title', type: 'string', required: false, description: 'Optional graph title.' },
      { name: 'xKey', type: 'string', required: false, description: 'X-axis/category key for line, bar, area, scatter, stacked-bar, and composed charts.', aliases: ['x-key'] },
      { name: 'yKey', type: 'string', required: false, description: 'Y-axis value key for line, bar, area, and scatter charts. Also used as a fallback bar key for composed charts.', aliases: ['y-key'] },
      { name: 'zKey', type: 'string', required: false, description: 'Optional bubble-size key for scatter charts.', aliases: ['z-key'] },
      { name: 'nameKey', type: 'string', required: false, description: 'Slice name key for pie graphs.', aliases: ['name-key'] },
      { name: 'valueKey', type: 'string', required: false, description: 'Value key for pie slices, sparkline, dot-plot, and the bullet measure.', aliases: ['value-key'] },
      { name: 'axisKey', type: 'string', required: false, description: 'Category key for radar charts.', aliases: ['axis-key'] },
      { name: 'metrics', type: 'string[]', required: false, description: 'Series keys to plot as radar polygons. Defaults to non-axis numeric columns.' },
      { name: 'series', type: 'string[]', required: false, description: 'Series keys for stacked-bar segments. Defaults to non-x numeric columns.' },
      { name: 'barKey', type: 'string', required: false, description: 'Bar series key for composed charts.', aliases: ['bar-key'] },
      { name: 'lineKey', type: 'string', required: false, description: 'Line series key for composed charts.', aliases: ['line-key'] },
      { name: 'aggregate', type: '"sum" | "count" | "avg"', required: false, description: 'Optional aggregation for repeated x-axis values in line, bar, area, and stacked-bar charts.' },
      { name: 'color', type: 'string', required: false, description: 'Optional series color for line, bar, area, and scatter charts.' },
      { name: 'barColor', type: 'string', required: false, description: 'Optional bar color for composed charts.', aliases: ['bar-color'] },
      { name: 'lineColor', type: 'string', required: false, description: 'Optional line color for composed charts.', aliases: ['line-color'] },
      { name: 'colorBy', type: '"series" | "category" | "value" | "none"', required: false, description: 'Bar charts only: how bars are colored. Default "series" (single accent + one highlighted bar). "category" rotates the palette, "value" shades by magnitude, "none" is flat. Color should encode data, not decorate.', aliases: ['color-by'] },
      { name: 'highlight', type: 'number | "max" | "min"', required: false, description: 'Bar charts (colorBy="series") only: which bar gets the accent — "max" (default), "min", a 0-based index, or null for no emphasis.' },
      { name: 'labelKey', type: 'string', required: false, description: 'Category label key for dot-plot, bullet, and slopegraph rows.', aliases: ['label-key'] },
      { name: 'targetKey', type: 'string', required: false, description: 'Per-row target value key for bullet charts.', aliases: ['target-key'] },
      { name: 'rangesKey', type: 'string', required: false, description: 'Per-row qualitative band thresholds (number[]) key for bullet charts.', aliases: ['ranges-key'] },
      { name: 'beforeKey', type: 'string', required: false, description: 'Left-column value key for slopegraph.', aliases: ['before-key'] },
      { name: 'afterKey', type: 'string', required: false, description: 'Right-column value key for slopegraph.', aliases: ['after-key'] },
      { name: 'sort', type: '"asc" | "desc" | "none"', required: false, description: 'Row sort order for dot-plot (defaults to desc).' },
      { name: 'height', type: 'number', required: false, description: 'Optional chart content height.', aliases: ['chart-height'] },
      { name: 'showLegend', type: 'boolean', required: false, description: 'Show chart legend when supported; pass false for compact node layouts.', aliases: ['show-legend'] },
      { name: 'showLabels', type: 'boolean', required: false, description: 'Show direct labels when supported, such as pie slice labels; defaults to true.', aliases: ['show-labels'] },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'nodeHeight', type: 'number', required: false, description: 'Optional node height (canvas frame). Distinct from `height`, which sets only the chart content height inside the node.', aliases: ['node-height'] },
      { name: 'strictSize', type: 'boolean', required: false, description: 'Keep explicit node size fixed and scroll overflowing content instead of browser auto-fitting.', aliases: ['strict-size', 'scroll-overflow'] },
    ],
    example: {
      title: 'Deploy Trend',
      graphType: 'line',
      data: [
        { day: 'Mon', value: 3 },
        { day: 'Tue', value: 5 },
        { day: 'Wed', value: 4 },
      ],
      xKey: 'day',
      yKey: 'value',
    },
    notes: [
      'Canonical graph types are line, bar, pie, area, scatter, radar, stacked-bar, and composed.',
      'Server-side validation normalizes aliases like "stack" -> "stacked-bar" and "combo" -> "composed".',
    ],
  },
  {
    type: 'web-artifact',
    kind: 'virtual-node',
    description: 'Bundled single-file HTML artifact that can open as an embedded canvas node.',
    endpoint: '/api/canvas/web-artifact',
    mcpTool: 'canvas_app (action:"build-artifact")',
    fields: [
      { name: 'title', type: 'string', required: true, description: 'Artifact title used for default paths.' },
      { name: 'appTsx', type: 'string', required: true, description: 'Contents for src/App.tsx. The CLI also accepts piped contents via --stdin.', aliases: ['app-file', 'app-tsx'] },
      { name: 'indexCss', type: 'string', required: false, description: 'Optional src/index.css contents.', aliases: ['index-css-file', 'index-css'] },
      { name: 'mainTsx', type: 'string', required: false, description: 'Optional src/main.tsx contents.', aliases: ['main-file', 'main-tsx'] },
      { name: 'indexHtml', type: 'string', required: false, description: 'Optional index.html contents.', aliases: ['index-html-file', 'index-html'] },
      { name: 'projectPath', type: 'string', required: false, description: 'Optional project directory.' },
      { name: 'outputPath', type: 'string', required: false, description: 'Optional output HTML path.' },
      { name: 'openInCanvas', type: 'boolean', required: false, description: 'Open the built artifact on the canvas (default true).' },
      { name: 'includeLogs', type: 'boolean', required: false, description: 'Include raw build stdout/stderr in the response (default false).' },
      { name: 'deps', type: 'string[]', required: false, description: 'Optional npm dependencies to add before bundling, e.g. recharts.', aliases: ['deps'] },
      { name: 'timeoutMs', type: 'number', required: false, description: 'Build command timeout in milliseconds. This controls subprocess timeout, not the MCP client request timeout.' },
    ],
    example: {
      title: 'Dashboard Artifact',
      appTsx: 'export default function App() { return <main>Artifact</main>; }',
      indexCss: 'body { background: #123456; color: white; }',
    },
    notes: [
      'Cold builds can exceed default 60s MCP client timeouts; configure a longer MCP call timeout or retry with the same projectPath/outputPath if the first call times out.',
    ],
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function buildMcpNodeTypeRouting(nodeTypes: CanvasCreateTypeSchema[]): Record<string, string> {
  const routing: Record<string, string> = {};
  for (const entry of nodeTypes) {
    if (typeof entry.mcpTool === 'string') {
      routing[entry.type] = entry.mcpTool;
    }
  }
  return routing;
}

export function describeCanvasSchema(): {
  ok: true;
  source: 'running-server';
  version: string | null;
  nodeTypes: CanvasCreateTypeSchema[];
  jsonRender: {
    rootShape: Record<string, string>;
    components: JsonRenderComponentDescriptor[];
    directives: Array<{ name: string; usage: string }>;
  };
  graph: {
    graphTypes: CanvasGraphType[];
  };
  htmlPrimitives: HtmlPrimitiveDescriptor[];
  mcp: {
    tools: string[];
    resources: string[];
    nodeTypeRouting: Record<string, string>;
  };
} {
  const nodeTypes = clone(CANVAS_CREATE_TYPES);
  return {
    ok: true,
    source: 'running-server',
    version: readPackageVersion(),
    nodeTypes,
    jsonRender: {
      rootShape: {
        root: 'string',
        elements: 'record<string, { type, props, children, visible? }>',
        state: 'record<string, unknown> | optional',
      },
      components: clone(describeJsonRenderCatalog()),
      directives: [
        { name: '$state', usage: '{ "$state": "/path/to/value" } — read a value from the state model by path (one-way). Use this to bind a value by path; there is no $path directive.' },
        { name: '$format', usage: '{ "$format": "currency"|"number"|"percent"|"date", "value": <num|state-ref>, "currency"?: "USD", "locale"?, "style"?, "options"? } — Intl-formatted string' },
        { name: '$math', usage: '{ "$math": "add"|"subtract"|"multiply"|"divide"|"mod"|"min"|"max"|"round"|"floor"|"ceil"|"abs", "a": <num>, "b"?: <num> }' },
        { name: '$concat', usage: '{ "$concat": [<value>, <value>, ...] } — join values into one string' },
        { name: '$count', usage: '{ "$count": <array|state-ref> } — length of an array' },
        { name: '$truncate', usage: '{ "$truncate": <string>, "length": <num>, "suffix"?: "…" }' },
        { name: '$pluralize', usage: '{ "$pluralize": <count>, "one": "item", "other": "items" }' },
        { name: '$join', usage: '{ "$join": <array>, "separator"?: ", " }' },
      ],
    },
    graph: {
      graphTypes: [...CANONICAL_GRAPH_TYPES],
    },
    htmlPrimitives: listHtmlPrimitiveDescriptors(),
    mcp: {
      tools: [
        // 15 composites
        'canvas_node',
        'canvas_render',
        'canvas_edge',
        'canvas_group',
        'canvas_history',
        'canvas_view',
        'canvas_query',
        'canvas_webview',
        'canvas_app',
        'canvas_ax_state',
        'canvas_ax_work',
        'canvas_ax_gate',
        'canvas_ax_timeline',
        'canvas_ax_delivery',
        'canvas_intent',
        // 6 standalones
        'canvas_batch',
        'canvas_pin_nodes',
        'canvas_invoke_command',
        'canvas_ax_interaction',
        'canvas_ingest_activity',
        'canvas_screenshot',
        // 6 snapshot tools (deprecated; fold into canvas_snapshot composite in v0.4)
        'canvas_snapshot',
        'canvas_list_snapshots',
        'canvas_restore',
        'canvas_delete_snapshot',
        'canvas_gc_snapshots',
        'canvas_diff',
      ],
      resources: ['canvas://schema'],
      nodeTypeRouting: buildMcpNodeTypeRouting(nodeTypes),
    },
  };
}

export function validateStructuredCanvasPayload(input: {
  type: 'json-render' | 'graph' | 'html-primitive';
  spec?: unknown;
  graph?: GraphNodeInput;
  primitive?: { kind: string; title?: string; data?: Record<string, unknown> };
}): StructuredValidationResult {
  if (input.type === 'json-render') {
    const normalizedSpec = normalizeAndValidateJsonRenderSpec(input.spec);
    return {
      ok: true,
      type: 'json-render',
      normalizedSpec,
      summary: {
        root: normalizedSpec.root,
        elementCount: Object.keys(normalizedSpec.elements).length,
        stateKeys: Object.keys(normalizedSpec.state ?? {}).length,
      },
    };
  }

  if (input.type === 'html-primitive') {
    if (!input.primitive) {
      throw new Error('HTML primitive validation requires a primitive payload.');
    }
    if (!isHtmlPrimitiveKind(input.primitive.kind)) {
      throw new Error(`Unknown HTML primitive: ${input.primitive.kind}`);
    }
    const built = buildHtmlPrimitive({
      kind: input.primitive.kind,
      ...(typeof input.primitive.title === 'string' ? { title: input.primitive.title } : {}),
      ...(input.primitive.data ? { data: input.primitive.data } : {}),
    });
    return {
      ok: true,
      type: 'html-primitive',
      normalizedPrimitive: {
        kind: built.kind,
        title: built.title,
        htmlBytes: Buffer.byteLength(built.html, 'utf-8'),
        defaultSize: built.defaultSize,
      },
      summary: {
        kind: built.kind,
        title: built.title,
        dataKeys: Object.keys(built.data),
      },
    };
  }

  if (!input.graph) {
    throw new Error('Graph validation requires a graph payload.');
  }

  const normalizedSpec = buildGraphSpec(input.graph);
  return {
    ok: true,
    type: 'graph',
    normalizedSpec,
    summary: {
      graphType: normalizeGraphType(input.graph.graphType),
      dataPoints: input.graph.data.length,
      root: normalizedSpec.root,
      elementCount: Object.keys(normalizedSpec.elements).length,
    },
  };
}
