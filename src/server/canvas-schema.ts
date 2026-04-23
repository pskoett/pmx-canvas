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
  fields: CanvasCreateField[];
  example: Record<string, unknown>;
  notes?: string[];
}

export interface StructuredValidationResult {
  ok: true;
  type: 'json-render' | 'graph';
  normalizedSpec: JsonRenderSpec;
  summary: Record<string, unknown>;
}

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
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional node title.' },
      { name: 'content', type: 'string', required: false, description: 'Markdown body.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
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
    fields: [
      { name: 'title', type: 'string', required: false, description: 'Optional title.' },
      { name: 'content', type: 'string', required: false, description: 'Trace summary.' },
    ],
    example: {
      type: 'trace',
      title: 'Execution Trace',
      content: 'Canvas actions and tool events.',
    },
  },
  {
    type: 'file',
    kind: 'node',
    description: 'Workspace file viewer.',
    endpoint: '/api/canvas/node',
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
    fields: [
      { name: 'content', type: 'string', required: true, description: 'Image path, URL, or data URI.' },
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
    fields: [
      { name: 'url', type: 'string', required: true, description: 'HTTP(S) URL to fetch and cache.', aliases: ['content'] },
      { name: 'title', type: 'string', required: false, description: 'Optional title override.' },
      { name: 'x', type: 'number', required: false, description: 'Optional X position.' },
      { name: 'y', type: 'number', required: false, description: 'Optional Y position.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'height', type: 'number', required: false, description: 'Optional node height.' },
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
    type: 'mcp-app',
    kind: 'node',
    description: 'Hosted iframe/app node.',
    endpoint: '/api/canvas/node',
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
    type: 'group',
    kind: 'node',
    description: 'Canvas group frame.',
    endpoint: '/api/canvas/group',
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
    fields: [
      { name: 'title', type: 'string', required: true, description: 'Rendered node title.' },
      { name: 'spec', type: 'JsonRenderSpec', required: true, description: 'Complete json-render spec.' },
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
    fields: [
      { name: 'graphType', type: '"line" | "bar" | "pie"', required: true, description: 'Chart type. Aliases are normalized server-side.' },
      { name: 'data', type: 'Record<string, unknown>[]', required: true, description: 'Chart dataset.' },
      { name: 'title', type: 'string', required: false, description: 'Optional graph title.' },
      { name: 'xKey', type: 'string', required: false, description: 'X-axis key for line/bar graphs.' },
      { name: 'yKey', type: 'string', required: false, description: 'Y-axis key for line/bar graphs.' },
      { name: 'nameKey', type: 'string', required: false, description: 'Slice name key for pie graphs.' },
      { name: 'valueKey', type: 'string', required: false, description: 'Slice value key for pie graphs.' },
      { name: 'aggregate', type: '"sum" | "count" | "avg"', required: false, description: 'Optional aggregation for repeated keys.' },
      { name: 'color', type: 'string', required: false, description: 'Optional series color.' },
      { name: 'height', type: 'number', required: false, description: 'Optional chart content height.' },
      { name: 'width', type: 'number', required: false, description: 'Optional node width.' },
      { name: 'nodeHeight', type: 'number', required: false, description: 'Optional node height.' },
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
  },
  {
    type: 'web-artifact',
    kind: 'virtual-node',
    description: 'Bundled single-file HTML artifact that can open as an embedded canvas node.',
    endpoint: '/api/canvas/web-artifact',
    fields: [
      { name: 'title', type: 'string', required: true, description: 'Artifact title used for default paths.' },
      { name: 'appTsx', type: 'string', required: true, description: 'Contents for src/App.tsx.', aliases: ['stdin', 'app-file', 'app-tsx'] },
      { name: 'indexCss', type: 'string', required: false, description: 'Optional src/index.css contents.', aliases: ['index-css-file', 'index-css'] },
      { name: 'mainTsx', type: 'string', required: false, description: 'Optional src/main.tsx contents.', aliases: ['main-file', 'main-tsx'] },
      { name: 'indexHtml', type: 'string', required: false, description: 'Optional index.html contents.', aliases: ['index-html-file', 'index-html'] },
      { name: 'projectPath', type: 'string', required: false, description: 'Optional project directory.' },
      { name: 'outputPath', type: 'string', required: false, description: 'Optional output HTML path.' },
      { name: 'openInCanvas', type: 'boolean', required: false, description: 'Open the built artifact on the canvas (default true).' },
      { name: 'includeLogs', type: 'boolean', required: false, description: 'Include raw build stdout/stderr in the response (default false).' },
    ],
    example: {
      title: 'Dashboard Artifact',
      appTsx: 'export default function App() { return <main>Artifact</main>; }',
      indexCss: 'body { background: #123456; color: white; }',
    },
  },
];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function describeCanvasSchema(): {
  ok: true;
  source: 'running-server';
  version: string | null;
  nodeTypes: CanvasCreateTypeSchema[];
  jsonRender: {
    rootShape: Record<string, string>;
    components: JsonRenderComponentDescriptor[];
  };
  graph: {
    graphTypes: Array<'line' | 'bar' | 'pie'>;
  };
  mcp: {
    tools: string[];
    resources: string[];
  };
} {
  return {
    ok: true,
    source: 'running-server',
    version: readPackageVersion(),
    nodeTypes: clone(CANVAS_CREATE_TYPES),
    jsonRender: {
      rootShape: {
        root: 'string',
        elements: 'record<string, { type, props, children, visible? }>',
        state: 'record<string, unknown> | optional',
      },
      components: clone(describeJsonRenderCatalog()),
    },
    graph: {
      graphTypes: ['line', 'bar', 'pie'],
    },
    mcp: {
      tools: [
        'canvas_add_node',
        'canvas_add_json_render_node',
        'canvas_add_graph_node',
        'canvas_build_web_artifact',
        'canvas_describe_schema',
        'canvas_validate_spec',
      ],
      resources: ['canvas://schema'],
    },
  };
}

export function validateStructuredCanvasPayload(input: {
  type: 'json-render' | 'graph';
  spec?: unknown;
  graph?: GraphNodeInput;
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
