// Behavior tests for src/server/canvas-schema.ts — the agent-facing
// self-describing schema (`canvas://schema` / GET /api/canvas/schema).
//
// The high-value invariant here is stale-tool drift (the M12 bug class):
// every MCP tool name mentioned anywhere in the schema text must be one of
// the 27 frozen public tool names, and every nodeTypeRouting entry must point
// at a composite in action syntax — never at a removed legacy standalone
// (e.g. canvas_add_html_node). FROZEN_TOOL_NAMES mirrors
// tests/unit/mcp-tool-freeze.test.ts; update both deliberately.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  type CanvasCreateTypeSchema,
  describeCanvasSchema,
  validateStructuredCanvasPayload,
} from '../../src/server/canvas-schema.ts';
import { HTML_PRIMITIVE_KINDS } from '../../src/server/html-primitives.ts';

const FROZEN_TOOL_NAMES = [
  'canvas_app',
  'canvas_ax_delivery',
  'canvas_ax_gate',
  'canvas_ax_interaction',
  'canvas_ax_state',
  'canvas_ax_timeline',
  'canvas_ax_work',
  'canvas_batch',
  'canvas_edge',
  'canvas_group',
  'canvas_history',
  'canvas_ingest_activity',
  'canvas_intent',
  'canvas_invoke_command',
  'canvas_node',
  'canvas_pin_nodes',
  'canvas_query',
  'canvas_render',
  'canvas_screenshot',
  'canvas_snapshot',
  'canvas_view',
  'canvas_webview',
];

const COMPOSITE_TOOL_NAMES = [
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
];

function getNodeType(type: string): CanvasCreateTypeSchema {
  const entry = describeCanvasSchema().nodeTypes.find((candidate) => candidate.type === type);
  if (!entry) throw new Error(`Schema does not describe node type: ${type}`);
  return entry;
}

describe('describeCanvasSchema — MCP tool surface', () => {
  test('advertised mcp.tools and resources match the frozen public surface', () => {
    const { mcp } = describeCanvasSchema();
    expect([...mcp.tools].sort()).toEqual(FROZEN_TOOL_NAMES);
    expect(mcp.resources).toEqual(['canvas://schema']);
  });

  test('every canvas_* tool token mentioned anywhere in the schema is a current tool name', () => {
    // Guards the M12 bug class: agent-facing schema text (mcpTool strings,
    // descriptions, notes) silently referencing tools removed in v0.3.0.
    const serialized = JSON.stringify(describeCanvasSchema());
    const mentioned = [...new Set(serialized.match(/canvas_[a-z_]+/g) ?? [])].sort();
    expect(mentioned.length).toBeGreaterThan(0);
    const stale = mentioned.filter((token) => !FROZEN_TOOL_NAMES.includes(token));
    expect(stale).toEqual([]);
  });

  test('nodeTypeRouting covers every node type and routes each to a composite in action syntax', () => {
    const schema = describeCanvasSchema();
    const routing = schema.mcp.nodeTypeRouting;
    expect(Object.keys(routing).sort()).toEqual(schema.nodeTypes.map((entry) => entry.type).sort());
    for (const [type, route] of Object.entries(routing)) {
      // e.g. 'canvas_node (action:"add", type:"html")' — never a bare legacy tool name.
      const match = route.match(/^(canvas_[a-z_]+) \(action:"[a-z-]+"(?:, [a-zA-Z]+:"[^"]*")*\)$/);
      expect(match, `node type "${type}" has malformed mcpTool routing: ${route}`).not.toBeNull();
      expect(COMPOSITE_TOOL_NAMES, `node type "${type}" routes to a non-composite tool`).toContain(match?.[1] ?? '');
    }
  });

  test('reports the package version and running-server identity envelope', () => {
    const schema = describeCanvasSchema();
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf-8')) as {
      version: string;
    };
    expect(schema.ok).toBe(true);
    expect(schema.source).toBe('running-server');
    expect(schema.version).toBe(pkg.version);
  });

  test('repeated calls return independent copies — callers cannot corrupt the schema', () => {
    const pristine = JSON.parse(JSON.stringify(describeCanvasSchema()));
    const tampered = describeCanvasSchema();
    tampered.nodeTypes[0].fields.pop();
    tampered.nodeTypes[0].example.injected = true;
    tampered.mcp.nodeTypeRouting.markdown = 'canvas_add_node';
    tampered.mcp.tools.pop();
    tampered.graph.graphTypes.pop();
    tampered.jsonRender.components.pop();
    tampered.htmlPrimitives.pop();
    expect(describeCanvasSchema()).toEqual(pristine);
  });
});

describe('describeCanvasSchema — node type create schemas', () => {
  test('advertises exactly the current 18 creatable node types', () => {
    const types = describeCanvasSchema()
      .nodeTypes.map((entry) => entry.type)
      .sort();
    expect(types).toEqual(
      [
        'markdown',
        'status',
        'context',
        'ledger',
        'trace',
        'file',
        'diff',
        'mermaid',
        'image',
        'webpage',
        'html',
        'html-primitive',
        'mcp-app',
        'external-app',
        'group',
        'json-render',
        'graph',
        'web-artifact',
      ].sort(),
    );
  });

  test('required create fields match the creation contract for every node type', () => {
    const requiredByType: Record<string, string[]> = {};
    for (const entry of describeCanvasSchema().nodeTypes) {
      requiredByType[entry.type] = entry.fields
        .filter((field) => field.required)
        .map((field) => field.name)
        .sort();
    }
    expect(requiredByType).toEqual({
      markdown: [],
      status: [],
      context: [],
      ledger: [],
      trace: [],
      file: ['content'],
      diff: [],
      mermaid: [],
      image: ['content'],
      webpage: ['url'],
      html: [],
      'html-primitive': ['kind'],
      'mcp-app': [],
      'external-app': ['toolName', 'transport'],
      group: [],
      'json-render': ['spec'],
      graph: ['data', 'graphType'],
      'web-artifact': ['appTsx', 'title'],
    });
  });

  test('every required field is demonstrated in its node type example', () => {
    for (const entry of describeCanvasSchema().nodeTypes) {
      const exampleKeys = Object.keys(entry.example);
      for (const field of entry.fields.filter((candidate) => candidate.required)) {
        const accepted = [field.name, ...(field.aliases ?? [])];
        expect(
          accepted.some((name) => exampleKeys.includes(name)),
          `example for "${entry.type}" omits required field "${field.name}"`,
        ).toBe(true);
      }
    }
  });

  test('examples for /api/canvas/node types carry a matching type discriminator', () => {
    const nodeEndpointTypes = describeCanvasSchema().nodeTypes.filter((entry) => entry.endpoint === '/api/canvas/node');
    expect(nodeEndpointTypes.length).toBeGreaterThan(0);
    for (const entry of nodeEndpointTypes) {
      expect(entry.example.type, `example for "${entry.type}" is missing its type discriminator`).toBe(entry.type);
    }
  });

  test('documents the backward-compat field aliases the HTTP/CLI layers accept', () => {
    const aliasesOf = (type: string, field: string): string[] => {
      const found = getNodeType(type).fields.find((candidate) => candidate.name === field);
      if (!found) throw new Error(`node type "${type}" does not describe field "${field}"`);
      return found.aliases ?? [];
    };
    expect(aliasesOf('html', 'html')).toEqual(expect.arrayContaining(['content', 'stdin']));
    expect(aliasesOf('webpage', 'url')).toContain('content');
    expect(aliasesOf('image', 'content')).toContain('path');
    expect(aliasesOf('graph', 'graphType')).toContain('graph-type');
  });
});

describe('describeCanvasSchema — json-render catalog and graph types', () => {
  test('json-render catalog is present and the schema example only uses cataloged components', () => {
    const schema = describeCanvasSchema();
    const componentTypes = schema.jsonRender.components.map((component) => component.type);
    expect(componentTypes.length).toBeGreaterThan(0);
    expect(new Set(componentTypes).size).toBe(componentTypes.length);
    for (const component of schema.jsonRender.components) {
      expect(component.type.length).toBeGreaterThan(0);
      expect(component.description.length).toBeGreaterThan(0);
      expect(Array.isArray(component.props)).toBe(true);
    }
    const example = getNodeType('json-render').example as {
      spec: { elements: Record<string, { type: string }> };
    };
    for (const element of Object.values(example.spec.elements)) {
      expect(componentTypes).toContain(element.type);
    }
  });

  test('documents the full directive set, each with self-referencing usage', () => {
    const { directives } = describeCanvasSchema().jsonRender;
    expect(directives.map((directive) => directive.name).sort()).toEqual(
      ['$concat', '$count', '$format', '$join', '$math', '$pluralize', '$state', '$truncate'].sort(),
    );
    for (const directive of directives) {
      expect(directive.usage).toContain(directive.name);
    }
  });

  test('advertises exactly the 12 canonical graph types', () => {
    expect(([...describeCanvasSchema().graph.graphTypes] as string[]).sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  // Rows carry every default key buildGraphSpec infers (label/axis/name/x/y/
  // value/before/after) so all 12 types validate without explicit key options.
  const GRAPH_PROBE_DATA = [
    { label: 'a', axis: 'a', name: 'alpha', x: 1, y: 2, value: 3, before: 4, after: 5 },
    { label: 'b', axis: 'b', name: 'beta', x: 2, y: 1, value: 5, before: 2, after: 6 },
  ];

  test('every advertised graph type is accepted and normalizes to a distinct chart', () => {
    // normalizeGraphType falls back to LineChart for unknown input, so a stale
    // advertised type would collide with "line" — distinctness catches drift.
    const normalized = describeCanvasSchema().graph.graphTypes.map((graphType) => {
      const result = validateStructuredCanvasPayload({ type: 'graph', graph: { graphType, data: GRAPH_PROBE_DATA } });
      expect(result.ok).toBe(true);
      expect(result.summary.dataPoints).toBe(2);
      return result.summary.graphType;
    });
    expect(new Set(normalized).size).toBe(normalized.length);
  });

  test('graph alias normalization promised in the schema notes holds', () => {
    const normalize = (graphType: string): unknown =>
      validateStructuredCanvasPayload({ type: 'graph', graph: { graphType, data: GRAPH_PROBE_DATA } }).summary
        .graphType;
    expect(normalize('stack')).toBe(normalize('stacked-bar'));
    expect(normalize('combo')).toBe(normalize('composed'));
    expect(normalize('stack')).not.toBe(normalize('line'));
    expect(normalize('combo')).not.toBe(normalize('line'));
  });

  test('html primitive descriptors match the supported primitive kinds exactly', () => {
    const kinds = describeCanvasSchema().htmlPrimitives.map((descriptor) => descriptor.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect([...kinds].sort()).toEqual([...HTML_PRIMITIVE_KINDS].sort());
  });
});

describe('validateStructuredCanvasPayload — canonical schema examples validate', () => {
  test('the json-render node type example passes validation with the expected summary', () => {
    const example = getNodeType('json-render').example as { spec: unknown };
    const result = validateStructuredCanvasPayload({ type: 'json-render', spec: example.spec });
    expect(result.ok).toBe(true);
    expect(result.type).toBe('json-render');
    expect(result.summary).toEqual({ root: 'card', elementCount: 2, stateKeys: 0 });
    const elements = result.normalizedSpec?.elements as Record<string, { type?: string }> | undefined;
    expect(elements?.card?.type).toBe('Card');
  });

  test('the graph node type example passes validation with the expected summary', () => {
    const example = getNodeType('graph').example as {
      graphType: string;
      data: Array<Record<string, unknown>>;
      xKey?: string;
      yKey?: string;
      title?: string;
    };
    const result = validateStructuredCanvasPayload({ type: 'graph', graph: example });
    expect(result.ok).toBe(true);
    expect(result.type).toBe('graph');
    expect(result.summary.graphType).toBe('LineChart');
    expect(result.summary.dataPoints).toBe(3);
    expect(result.normalizedSpec?.root.length).toBeGreaterThan(0);
  });

  test('every html primitive descriptor example builds into a renderable primitive', () => {
    for (const descriptor of describeCanvasSchema().htmlPrimitives) {
      const example = descriptor.example as { kind?: string; title?: string; data?: Record<string, unknown> };
      expect(example.kind, `descriptor example for "${descriptor.kind}" declares the wrong kind`).toBe(descriptor.kind);
      const result = validateStructuredCanvasPayload({
        type: 'html-primitive',
        primitive: {
          kind: descriptor.kind,
          ...(typeof example.title === 'string' ? { title: example.title } : {}),
          ...(example.data ? { data: example.data } : {}),
        },
      });
      expect(result.ok).toBe(true);
      expect(result.normalizedPrimitive?.kind).toBe(descriptor.kind);
      expect(result.normalizedPrimitive?.htmlBytes ?? 0).toBeGreaterThan(0);
      expect(result.normalizedPrimitive?.defaultSize).toEqual(descriptor.defaultSize);
    }
  });

  test('rejects payloads missing their type-specific body', () => {
    expect(() => validateStructuredCanvasPayload({ type: 'graph' })).toThrow(
      'Graph validation requires a graph payload.',
    );
    expect(() => validateStructuredCanvasPayload({ type: 'html-primitive' })).toThrow(
      'HTML primitive validation requires a primitive payload.',
    );
  });

  test('rejects unknown primitive kinds and structurally invalid json-render specs', () => {
    expect(() =>
      validateStructuredCanvasPayload({ type: 'html-primitive', primitive: { kind: 'not-a-primitive' } }),
    ).toThrow('Unknown HTML primitive: not-a-primitive');
    expect(() => validateStructuredCanvasPayload({ type: 'json-render', spec: {} })).toThrow(
      'Missing root and elements in spec.',
    );
  });
});
