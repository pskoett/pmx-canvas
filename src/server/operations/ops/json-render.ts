/**
 * Slice 4 operations (plan-005, migration item 6): jsonrender.add /
 * jsonrender.stream / graph.add / schema.describe / spec.validate — plus the
 * shared `streamJsonRenderCore` the SDK wraps directly.
 *
 * Frame-height alias triangle (graph nodes), absorbed into ONE schema here:
 * - `height`      = CHART CONTENT height (goes into the json-render spec /
 *                   graphConfig, NOT the node frame). Same name on every
 *                   surface.
 * - `nodeHeight`  = node FRAME height as named by the HTTP body and the MCP
 *                   tool argument.
 * - `heightPx`    = node FRAME height as named by the SDK's GraphNodeInput
 *                   (createCanvasGraphNode's own input field); the legacy
 *                   RemoteCanvasAccess re-mapped heightPx → nodeHeight over
 *                   HTTP.
 * - `size.height` = node FRAME height in the `{ size: { width, height } }`
 *                   object-alias form shared with other node-create routes.
 * Resolution order (legacy-exact): nodeHeight ?? heightPx ?? size.height.
 *
 * Unification notes (documented deltas from legacy):
 * - spec.validate's graph branch now honors the full graph payload surface
 *   (colorBy, highlight, labelKey, targetKey, rangesKey, beforeKey, afterKey,
 *   beforeLabel, afterLabel, sort, fill, showEndDot, showMinMax, showValue,
 *   colorByDirection). The legacy HTTP handler silently dropped these fields
 *   while the legacy MCP tool (and the graph CREATE route) honored them —
 *   exactly the one-of-N-paths drift this registry erases.
 * - jsonrender.stream's `nodeHeight` MCP alias is mapped onto the HTTP body's
 *   `height` in buildInput, so local and remote MCP invocations are identical.
 *
 * This module must never import server.ts or index.ts.
 */
import { z } from 'zod';
import { canvasState, type CanvasNodeState } from '../../canvas-state.js';
import {
  appendCanvasJsonRenderStream,
  createCanvasGraphNode,
  createCanvasJsonRenderNode,
  createCanvasStreamingJsonRenderNode,
} from '../../canvas-operations.js';
import { describeCanvasSchema, validateStructuredCanvasPayload } from '../../canvas-schema.js';
import { isHtmlPrimitiveKind } from '../../html-primitives.js';
import { defineOperation, OperationError, type Operation } from '../types.js';
import {
  buildNodeResponse,
  compactNodePayload,
  createdNodePayloadFromNode,
  getRecord,
  isRecord,
  pickFiniteNumber,
  pickPositiveNumber,
  resolveCreateGeometry,
} from './nodes.js';

/** Legacy server.ts parseGraphPayloadData: a graph dataset must be an array of records. */
export function parseGraphPayloadData(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  if (value.some((item) => !isRecord(item))) return null;
  return value as Array<Record<string, unknown>>;
}

/** MCP json-render spec schema (moved from mcp/server.ts): full document or bare component. */
const jsonRenderSpecSchema = z.union([
  z.object({
    root: z.string(),
    elements: z.record(z.string(), z.unknown()),
    state: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
  z.object({
    type: z.string(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(z.string()).optional(),
  }).passthrough(),
]);

const htmlPrimitiveKindSchema = z.string().refine(isHtmlPrimitiveKind, 'Unknown HTML primitive kind');

/** MCP node-create payload for json-render/graph adds (legacy `createdNodePayload` + url + spec). */
function structuredNodeToolResult(result: unknown): { content: Array<{ type: 'text'; text: string }> } {
  const body = isRecord(result) ? result : {};
  const node = body.node as CanvasNodeState | undefined;
  const payload = {
    ...(node ? createdNodePayloadFromNode(node) : { ok: true }),
    url: body.url,
    spec: body.spec,
  };
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

// ── jsonrender.add ────────────────────────────────────────────

const jsonRenderAddShape = {
  title: z.string().optional().catch(undefined).describe('Optional node title. If omitted, PMX Canvas infers one from the root element.'),
  spec: z.unknown().describe('json-render spec. Prefer a complete {root, elements, state?} document; a single bare component object is accepted for legacy callers.'),
  x: z.number().optional().catch(undefined).describe('Optional X position'),
  y: z.number().optional().catch(undefined).describe('Optional Y position'),
  width: z.number().optional().catch(undefined).describe('Optional node width'),
  height: z.number().optional().catch(undefined).describe('Optional node height'),
  strictSize: z.boolean().optional().catch(undefined).describe('Keep explicit width/height fixed and scroll overflowing content instead of browser auto-fitting'),
};

const jsonRenderAddSchema = z.looseObject(jsonRenderAddShape);

const jsonRenderAddOperation = defineOperation<
  z.infer<typeof jsonRenderAddSchema>,
  ReturnType<typeof createCanvasJsonRenderNode>
>({
  name: 'jsonrender.add',
  mutates: true,
  input: jsonRenderAddSchema,
  inputShape: jsonRenderAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/json-render',
  },
  mcp: {
    toolName: 'canvas_add_json_render_node',
    description: 'Create a native json-render canvas node from a complete spec. Use this for structured dashboards, forms, tables, and other interactive UI panels that should render directly inside PMX Canvas.',
    formatResult: (result) => structuredNodeToolResult(result),
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    // Legacy fallback: a body without an object `spec` is treated as the spec
    // itself (bare-component compatibility path).
    const rawSpec =
      body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec) ? body.spec : body;
    const geometry = resolveCreateGeometry(body);
    try {
      return createCanvasJsonRenderNode({
        ...(title ? { title } : {}),
        spec: rawSpec,
        ...(body.strictSize === true ? { strictSize: true } : {}),
        ...geometry,
      });
    } catch (error) {
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
  },
  serialize: (result) => ({ ...buildNodeResponse(result.node), url: result.url, spec: result.spec }),
});

// ── jsonrender.stream ─────────────────────────────────────────

export interface StreamJsonRenderInput {
  nodeId?: string;
  title?: string;
  patches?: unknown[];
  done?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  strictSize?: boolean;
}

export interface StreamJsonRenderResult {
  id: string;
  url: string;
  ok: true;
  applied: number;
  skipped: number;
  specVersion: number;
  elementCount: number;
  streamStatus: 'open' | 'closed';
}

/**
 * Create-or-append core for streaming json-render nodes (the SDK's
 * streamJsonRenderNode wraps this directly). Throws OperationError(400) when
 * the append target is missing or not a json-render node.
 */
export function streamJsonRenderCore(input: StreamJsonRenderInput): StreamJsonRenderResult {
  const patches = Array.isArray(input.patches) ? input.patches : [];
  const done = input.done === true;
  let nodeId = typeof input.nodeId === 'string' && input.nodeId ? input.nodeId : undefined;
  let url = '';
  if (!nodeId) {
    const created = createCanvasStreamingJsonRenderNode({
      ...(typeof input.title === 'string' ? { title: input.title } : {}),
      ...(input.strictSize === true ? { strictSize: true } : {}),
      ...(input.x !== undefined ? { x: input.x } : {}),
      ...(input.y !== undefined ? { y: input.y } : {}),
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
    });
    nodeId = created.id;
    url = created.url;
  }
  const result = appendCanvasJsonRenderStream(nodeId, patches, done);
  if (!result.ok) throw new OperationError(result.error);
  const node = canvasState.getNode(nodeId);
  return { id: nodeId, url: url || String(node?.data.url ?? ''), ...result };
}

const jsonRenderStreamShape = {
  nodeId: z.string().optional().catch(undefined).describe('Existing streaming node id to append to; omit to create a new streaming node'),
  title: z.string().optional().catch(undefined).describe('Title when creating a new streaming node'),
  patches: z.unknown().optional().describe('SpecStream patches to apply this call: JSON-Patch objects ({op,path,value}) or raw JSONL patch lines'),
  done: z.boolean().optional().catch(undefined).describe('Set true on the final call to mark the stream complete'),
  x: z.number().optional().catch(undefined).describe('Optional X position (new node)'),
  y: z.number().optional().catch(undefined).describe('Optional Y position (new node)'),
  width: z.number().optional().catch(undefined).describe('Optional node width (new node)'),
  nodeHeight: z.number().optional().catch(undefined).describe('Optional node height (new node)'),
  strictSize: z.boolean().optional().catch(undefined).describe('Keep explicit node size fixed and scroll overflowing content (new node)'),
};

const jsonRenderStreamSchema = z.looseObject(jsonRenderStreamShape);

const jsonRenderStreamOperation = defineOperation<
  z.infer<typeof jsonRenderStreamSchema>,
  StreamJsonRenderResult
>({
  name: 'jsonrender.stream',
  mutates: true,
  input: jsonRenderStreamSchema,
  inputShape: jsonRenderStreamShape,
  http: {
    method: 'POST',
    path: '/api/canvas/json-render/stream',
  },
  mcp: {
    toolName: 'canvas_stream_json_render_node',
    description: 'Progressively build a json-render node by streaming SpecStream patches, so a panel fills in live as you generate it. Omit nodeId on the first call to create a new streaming node (returns its id); pass that same nodeId on later calls to append more patches; set done=true on the final call. Each call updates the live node. Patches are JSON-Patch operations, e.g. {"op":"add","path":"/elements/card","value":{"type":"Card","props":{"title":"Live"},"children":[]}}, {"op":"replace","path":"/root","value":"card"}, {"op":"add","path":"/elements/card/children/-","value":"row1"}. Build the spec incrementally: set /root, add container elements, then append children. The server accumulates the spec (it is the source of truth); partial specs render what they can.',
    extraShape: {
      // Strict patch typing for the MCP surface only; the operation schema
      // stays loose so the HTTP route keeps tolerating malformed patch lists
      // (they fall through to the skipped counter, legacy behavior).
      patches: z
        .array(z.union([z.string(), z.record(z.string(), z.unknown())]))
        .optional()
        .describe('SpecStream patches to apply this call: JSON-Patch objects ({op,path,value}) or raw JSONL patch lines'),
    },
    buildInput: (input) => {
      // MCP names the frame height `nodeHeight`; the HTTP body uses `height`.
      const { nodeHeight, ...rest } = input;
      return { ...rest, ...(typeof nodeHeight === 'number' ? { height: nodeHeight } : {}) };
    },
    formatResult: async (result, _input, host) => {
      const body = isRecord(result) ? result : {};
      const id = typeof body.id === 'string' ? body.id : '';
      // Legacy createdNodePayload(c, id): a follow-up node read; a missing
      // node degrades to the bare { ok, id, nodeId } payload.
      let created: Record<string, unknown> = { ok: true, id, nodeId: id };
      try {
        const node = await host.invoker().invoke('node.get', { id, includeBlobs: true }) as CanvasNodeState;
        created = { ok: true, node: compactNodePayload(node), id, nodeId: id };
      } catch {
        // keep the bare payload (legacy c.getNode → undefined path)
      }
      const payload = {
        ...created,
        url: body.url,
        applied: body.applied,
        skipped: body.skipped,
        specVersion: body.specVersion,
        elementCount: body.elementCount,
        streamStatus: body.streamStatus,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    },
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const geometry = resolveCreateGeometry(body);
    return streamJsonRenderCore({
      ...(typeof body.nodeId === 'string' ? { nodeId: body.nodeId } : {}),
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(Array.isArray(body.patches) ? { patches: body.patches } : {}),
      ...(body.done === true ? { done: true } : {}),
      ...(body.strictSize === true ? { strictSize: true } : {}),
      ...geometry,
    });
  },
  // Wire shape is `{ id, url, ok, applied, ... }` — handler output verbatim.
});

// ── graph.add ─────────────────────────────────────────────────

const graphAddShape = {
  title: z.string().optional().catch(undefined).describe('Optional node title'),
  graphType: z.string().optional().catch(undefined).describe('Graph type: line, bar, pie, area, scatter, radar, stacked-bar (or "stack"), composed (or "combo"), sparkline, dot-plot (or "dot"), bullet, slopegraph (or "slope")'),
  data: z.unknown().optional().describe('Array of chart data objects'),
  xKey: z.string().optional().catch(undefined).describe('X-axis key (line/bar/area/scatter/stacked/composed)'),
  yKey: z.string().optional().catch(undefined).describe('Y-axis key (line/bar/area/scatter); falls back to barKey for composed'),
  zKey: z.string().optional().catch(undefined).describe('Optional bubble-size key for scatter charts'),
  nameKey: z.string().optional().catch(undefined).describe('Name key for pie graphs'),
  valueKey: z.string().optional().catch(undefined).describe('Value key for pie slices, sparkline, dot-plot, and the bullet measure'),
  axisKey: z.string().optional().catch(undefined).describe('Category key for radar charts'),
  metrics: z.array(z.string()).optional().catch(undefined).describe('Series keys to plot as radar polygons (defaults to non-axis numeric columns)'),
  series: z.array(z.string()).optional().catch(undefined).describe('Series keys for stacked-bar segments (defaults to non-x numeric columns)'),
  barKey: z.string().optional().catch(undefined).describe('Bar series key for composed charts'),
  lineKey: z.string().optional().catch(undefined).describe('Line series key for composed charts'),
  aggregate: z.enum(['sum', 'count', 'avg']).optional().catch(undefined).describe('Optional aggregation for repeated x-axis values (line/bar/area/stacked)'),
  color: z.string().optional().catch(undefined).describe('Optional series color (line/bar/area/scatter)'),
  colorBy: z
    .enum(['series', 'category', 'value', 'none'])
    .optional()
    .catch(undefined)
    .describe("Bar charts only: how bars are colored. 'series' (default) = single accent with one highlighted bar; 'category' = rotate palette per bar; 'value' = shade by magnitude; 'none' = flat. Prefer 'series' — color should encode data, not decorate."),
  highlight: z
    .union([z.number(), z.enum(['max', 'min'])])
    .nullable()
    .optional()
    .catch(undefined)
    .describe("Bar charts only, for colorBy='series': which bar gets the accent — 'max' (default), 'min', a 0-based index, or null for no emphasis."),
  barColor: z.string().optional().catch(undefined).describe('Optional bar color for composed charts'),
  lineColor: z.string().optional().catch(undefined).describe('Optional line color for composed charts'),
  labelKey: z.string().optional().catch(undefined).describe('Category label key for dot-plot / bullet / slopegraph rows'),
  targetKey: z.string().optional().catch(undefined).describe('Per-row target value key for bullet charts'),
  rangesKey: z.string().optional().catch(undefined).describe('Per-row qualitative band thresholds key (number[]) for bullet charts'),
  beforeKey: z.string().optional().catch(undefined).describe('Left-column value key for slopegraph'),
  afterKey: z.string().optional().catch(undefined).describe('Right-column value key for slopegraph'),
  beforeLabel: z.string().optional().catch(undefined).describe('Header label for the slopegraph left column'),
  afterLabel: z.string().optional().catch(undefined).describe('Header label for the slopegraph right column'),
  sort: z.enum(['asc', 'desc', 'none']).optional().catch(undefined).describe('Row sort order for dot-plot (defaults to desc)'),
  fill: z.boolean().optional().catch(undefined).describe('Sparkline: draw a light area fill under the line'),
  showEndDot: z.boolean().optional().catch(undefined).describe('Sparkline: draw a dot at the last point (default true)'),
  showMinMax: z.boolean().optional().catch(undefined).describe('Sparkline: mark the min and max points'),
  showValue: z.boolean().optional().catch(undefined).describe('Sparkline: print the last value inline'),
  colorByDirection: z.boolean().optional().catch(undefined).describe('Slopegraph: accent rising lines and mute falling ones (default off — lines use one neutral ink)'),
  // CHART CONTENT height — see the alias-triangle note at the top of this file.
  height: z.number().optional().catch(undefined).describe('Optional chart content height'),
  showLegend: z.boolean().optional().catch(undefined).describe('Show chart legend when supported; pass false for compact node layouts'),
  showLabels: z.boolean().optional().catch(undefined).describe('Show direct labels when supported, such as pie slice labels (defaults to true)'),
  x: z.number().optional().catch(undefined).describe('Optional X position'),
  y: z.number().optional().catch(undefined).describe('Optional Y position'),
  width: z.number().optional().catch(undefined).describe('Optional node width'),
  // Node FRAME height (HTTP/MCP name) — see the alias-triangle note.
  nodeHeight: z.number().optional().catch(undefined).describe('Optional node height'),
  // Node FRAME height (SDK GraphNodeInput field name) — see the alias-triangle note.
  heightPx: z.number().optional().catch(undefined).describe('SDK alias for nodeHeight (node frame height)'),
  strictSize: z.boolean().optional().catch(undefined).describe('Keep explicit node size fixed and scroll overflowing content instead of browser auto-fitting'),
};

const graphAddSchema = z.looseObject(graphAddShape);

const graphAddOperation = defineOperation<
  z.infer<typeof graphAddSchema>,
  ReturnType<typeof createCanvasGraphNode>
>({
  name: 'graph.add',
  mutates: true,
  input: graphAddSchema,
  inputShape: graphAddShape,
  http: {
    method: 'POST',
    path: '/api/canvas/graph',
  },
  mcp: {
    toolName: 'canvas_add_graph_node',
    description: 'Create a native graph node backed by the json-render chart catalog. Supports line, bar, pie, area, scatter, radar, stacked-bar, composed (bar+line), sparkline, dot-plot (Cleveland), bullet (Few KPI vs target), and slopegraph (paired before/after) graphs rendered directly inside PMX Canvas.',
    extraShape: {
      graphType: z.string().describe('Graph type: line, bar, pie, area, scatter, radar, stacked-bar (or "stack"), composed (or "combo"), sparkline, dot-plot (or "dot"), bullet, slopegraph (or "slope")'),
      data: z.array(z.record(z.string(), z.unknown())).describe('Array of chart data objects'),
    },
    formatResult: (result) => structuredNodeToolResult(result),
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Graph';
    // `type` is the legacy HTTP-only graphType alias (not advertised over MCP).
    const graphType = typeof body.graphType === 'string' ? body.graphType : typeof body.type === 'string' ? body.type : 'line';
    const data = parseGraphPayloadData(body.data);
    if (!data) {
      throw new OperationError('Missing required field: data.');
    }
    try {
      const aggregate =
        body.aggregate === 'sum' || body.aggregate === 'count' || body.aggregate === 'avg'
          ? body.aggregate
          : undefined;
      const metrics = Array.isArray(body.metrics)
        ? body.metrics.filter((m: unknown): m is string => typeof m === 'string')
        : null;
      const series = Array.isArray(body.series)
        ? body.series.filter((s: unknown): s is string => typeof s === 'string')
        : null;
      const position = getRecord(body.position);
      const size = getRecord(body.size);
      const x = pickFiniteNumber(body, 'x') ?? (position ? pickFiniteNumber(position, 'x') : undefined);
      const y = pickFiniteNumber(body, 'y') ?? (position ? pickFiniteNumber(position, 'y') : undefined);
      const width = pickPositiveNumber(body, 'width') ?? (size ? pickPositiveNumber(size, 'width') : undefined);
      // Node FRAME height. `body.height` is the CHART plot height (passed
      // through as `height` below) — see the alias-triangle note at the top.
      const nodeHeight = pickPositiveNumber(body, 'nodeHeight')
        ?? pickPositiveNumber(body, 'heightPx')
        ?? (size ? pickPositiveNumber(size, 'height') : undefined);
      const showLegend = typeof body.showLegend === 'boolean' ? body.showLegend : undefined;
      const showLabels = typeof body.showLabels === 'boolean' ? body.showLabels : undefined;
      const colorBy =
        body.colorBy === 'series' || body.colorBy === 'category' || body.colorBy === 'value' || body.colorBy === 'none'
          ? body.colorBy
          : undefined;
      const highlight =
        typeof body.highlight === 'number' || body.highlight === 'max' || body.highlight === 'min' || body.highlight === null
          ? body.highlight
          : undefined;
      const sort =
        body.sort === 'asc' || body.sort === 'desc' || body.sort === 'none' ? body.sort : undefined;
      return createCanvasGraphNode({
        title,
        graphType,
        data,
        ...(typeof body.xKey === 'string' ? { xKey: body.xKey } : {}),
        ...(typeof body.yKey === 'string' ? { yKey: body.yKey } : {}),
        ...(typeof body.zKey === 'string' ? { zKey: body.zKey } : {}),
        ...(typeof body.nameKey === 'string' ? { nameKey: body.nameKey } : {}),
        ...(typeof body.valueKey === 'string' ? { valueKey: body.valueKey } : {}),
        ...(typeof body.axisKey === 'string' ? { axisKey: body.axisKey } : {}),
        ...(metrics ? { metrics } : {}),
        ...(series ? { series } : {}),
        ...(typeof body.barKey === 'string' ? { barKey: body.barKey } : {}),
        ...(typeof body.lineKey === 'string' ? { lineKey: body.lineKey } : {}),
        ...(aggregate ? { aggregate } : {}),
        ...(typeof body.color === 'string' ? { color: body.color } : {}),
        ...(colorBy ? { colorBy } : {}),
        ...(highlight !== undefined ? { highlight } : {}),
        ...(typeof body.barColor === 'string' ? { barColor: body.barColor } : {}),
        ...(typeof body.lineColor === 'string' ? { lineColor: body.lineColor } : {}),
        ...(typeof body.labelKey === 'string' ? { labelKey: body.labelKey } : {}),
        ...(typeof body.targetKey === 'string' ? { targetKey: body.targetKey } : {}),
        ...(typeof body.rangesKey === 'string' ? { rangesKey: body.rangesKey } : {}),
        ...(typeof body.beforeKey === 'string' ? { beforeKey: body.beforeKey } : {}),
        ...(typeof body.afterKey === 'string' ? { afterKey: body.afterKey } : {}),
        ...(typeof body.beforeLabel === 'string' ? { beforeLabel: body.beforeLabel } : {}),
        ...(typeof body.afterLabel === 'string' ? { afterLabel: body.afterLabel } : {}),
        ...(sort ? { sort } : {}),
        ...(typeof body.fill === 'boolean' ? { fill: body.fill } : {}),
        ...(typeof body.showEndDot === 'boolean' ? { showEndDot: body.showEndDot } : {}),
        ...(typeof body.showMinMax === 'boolean' ? { showMinMax: body.showMinMax } : {}),
        ...(typeof body.showValue === 'boolean' ? { showValue: body.showValue } : {}),
        ...(typeof body.colorByDirection === 'boolean' ? { colorByDirection: body.colorByDirection } : {}),
        ...(typeof body.height === 'number' ? { height: body.height } : {}),
        ...(showLegend !== undefined ? { showLegend } : {}),
        ...(showLabels !== undefined ? { showLabels } : {}),
        ...(body.strictSize === true ? { strictSize: true } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(nodeHeight !== undefined ? { heightPx: nodeHeight } : {}),
      });
    } catch (error) {
      if (error instanceof OperationError) throw error;
      throw new OperationError(error instanceof Error ? error.message : String(error));
    }
  },
  serialize: (result) => ({ ...buildNodeResponse(result.node), url: result.url, spec: result.spec }),
});

// ── schema.describe ───────────────────────────────────────────

const schemaDescribeShape = {};

const schemaDescribeSchema = z.looseObject(schemaDescribeShape);

const schemaDescribeOperation = defineOperation<
  z.infer<typeof schemaDescribeSchema>,
  ReturnType<typeof describeCanvasSchema>
>({
  name: 'schema.describe',
  mutates: false,
  input: schemaDescribeSchema,
  inputShape: schemaDescribeShape,
  http: {
    method: 'GET',
    path: '/api/canvas/schema',
  },
  mcp: {
    toolName: 'canvas_describe_schema',
    description: 'Describe the current server-supported canvas create schemas, json-render component catalog, canonical examples, and related MCP entry points. Includes mcp.nodeTypeRouting, the authoritative map from node type to MCP creation tool.',
    formatResult: (result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }),
  },
  handler: () => describeCanvasSchema(),
});

// ── spec.validate ─────────────────────────────────────────────

const specValidateShape = {
  type: z.unknown().optional().describe('Structured payload type to validate'),
  spec: z.unknown().optional().describe('json-render spec to validate when type="json-render"'),
  kind: z.unknown().optional().describe('HTML primitive kind when type="html-primitive"'),
  primitive: z.unknown().optional().describe('Alias for kind when type="html-primitive"'),
  // MCP names the primitive payload `primitiveData`; the HTTP body uses `data`
  // (which doubles as the graph dataset field). buildInput maps one onto the other.
  primitiveData: z.unknown().optional().describe('HTML primitive data payload when type="html-primitive"'),
  data: z.unknown().optional().describe('Graph dataset when type="graph"'),
  title: z.string().optional().catch(undefined).describe('Optional graph title'),
  graphType: z.string().optional().catch(undefined).describe('Graph type when type="graph"'),
  xKey: z.string().optional().catch(undefined).describe('X-axis key for line/bar graphs'),
  yKey: z.string().optional().catch(undefined).describe('Y-axis key for line/bar graphs'),
  zKey: z.string().optional().catch(undefined).describe('Optional bubble-size key for scatter charts'),
  nameKey: z.string().optional().catch(undefined).describe('Slice name key for pie graphs'),
  valueKey: z.string().optional().catch(undefined).describe('Value key for pie slices, sparkline, dot-plot, and the bullet measure'),
  axisKey: z.string().optional().catch(undefined).describe('Category key for radar charts'),
  metrics: z.array(z.string()).optional().catch(undefined).describe('Series keys to plot as radar polygons'),
  series: z.array(z.string()).optional().catch(undefined).describe('Series keys for stacked-bar segments'),
  barKey: z.string().optional().catch(undefined).describe('Bar series key for composed charts'),
  lineKey: z.string().optional().catch(undefined).describe('Line series key for composed charts'),
  aggregate: z.enum(['sum', 'count', 'avg']).optional().catch(undefined).describe('Optional aggregation for repeated keys'),
  color: z.string().optional().catch(undefined).describe('Optional graph color'),
  colorBy: z.enum(['series', 'category', 'value', 'none']).optional().catch(undefined).describe("Bar charts only: how bars are colored (default 'series')"),
  highlight: z.union([z.number(), z.enum(['max', 'min'])]).nullable().optional().catch(undefined).describe("Bar charts only, colorBy='series': which bar gets the accent"),
  barColor: z.string().optional().catch(undefined).describe('Optional bar color for composed charts'),
  lineColor: z.string().optional().catch(undefined).describe('Optional line color for composed charts'),
  labelKey: z.string().optional().catch(undefined).describe('Category label key for dot-plot / bullet / slopegraph rows'),
  targetKey: z.string().optional().catch(undefined).describe('Per-row target value key for bullet charts'),
  rangesKey: z.string().optional().catch(undefined).describe('Per-row qualitative band thresholds key (number[]) for bullet charts'),
  beforeKey: z.string().optional().catch(undefined).describe('Left-column value key for slopegraph'),
  afterKey: z.string().optional().catch(undefined).describe('Right-column value key for slopegraph'),
  beforeLabel: z.string().optional().catch(undefined).describe('Header label for the slopegraph left column'),
  afterLabel: z.string().optional().catch(undefined).describe('Header label for the slopegraph right column'),
  sort: z.enum(['asc', 'desc', 'none']).optional().catch(undefined).describe('Row sort order for dot-plot (defaults to desc)'),
  fill: z.boolean().optional().catch(undefined).describe('Sparkline: draw a light area fill under the line'),
  showEndDot: z.boolean().optional().catch(undefined).describe('Sparkline: draw a dot at the last point (default true)'),
  showMinMax: z.boolean().optional().catch(undefined).describe('Sparkline: mark the min and max points'),
  showValue: z.boolean().optional().catch(undefined).describe('Sparkline: print the last value inline'),
  colorByDirection: z.boolean().optional().catch(undefined).describe('Slopegraph: accent rising lines and mute falling ones (default off)'),
  height: z.number().optional().catch(undefined).describe('Optional graph content height'),
};

const specValidateSchema = z.looseObject(specValidateShape);

const specValidateOperation = defineOperation<
  z.infer<typeof specValidateSchema>,
  Record<string, unknown>
>({
  name: 'spec.validate',
  mutates: false,
  input: specValidateSchema,
  inputShape: specValidateShape,
  http: {
    method: 'POST',
    path: '/api/canvas/schema/validate',
    // Legacy: validation throws become `{ ok:false, error, type }` with 400.
    status: (result) => (isRecord(result) && result.ok === false ? 400 : 200),
  },
  mcp: {
    toolName: 'canvas_validate_spec',
    description: 'Validate a json-render spec, graph payload, or HTML primitive payload without creating a node. Returns normalized metadata the server would accept.',
    extraShape: {
      type: z.enum(['json-render', 'graph', 'html-primitive']).describe('Structured payload type to validate'),
      spec: jsonRenderSpecSchema.optional().describe('json-render spec to validate when type="json-render"'),
      kind: htmlPrimitiveKindSchema.optional().describe('HTML primitive kind when type="html-primitive"'),
      primitive: htmlPrimitiveKindSchema.optional().describe('Alias for kind when type="html-primitive"'),
      primitiveData: z.record(z.string(), z.unknown()).optional().describe('HTML primitive data payload when type="html-primitive"'),
      data: z.array(z.record(z.string(), z.unknown())).optional().describe('Graph dataset when type="graph"'),
    },
    buildInput: (input) => {
      if (input.type === 'html-primitive') {
        const { primitiveData, ...rest } = input;
        return { ...rest, ...(primitiveData !== undefined ? { data: primitiveData } : {}) };
      }
      if (input.type === 'graph') {
        // Legacy MCP defaulted a missing graph dataset to [].
        return { ...input, data: input.data ?? [] };
      }
      return input;
    },
    formatResult: (result) => {
      const body = isRecord(result) ? result : {};
      if (body.ok === false) {
        // Legacy MCP surfaced the bare validation message with isError.
        return {
          content: [{ type: 'text' as const, text: typeof body.error === 'string' ? body.error : 'Validation failed.' }],
          isError: true,
        };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  },
  handler: (input) => {
    const body: Record<string, unknown> = input;
    const rawType = typeof body.type === 'string' ? body.type.trim() : '';
    if (rawType !== 'json-render' && rawType !== 'graph' && rawType !== 'html-primitive') {
      throw new OperationError('Validation type must be "json-render", "graph", or "html-primitive".');
    }

    try {
      if (rawType === 'json-render') {
        const rawSpec =
          body.spec && typeof body.spec === 'object' && !Array.isArray(body.spec)
            ? body.spec
            : body;
        return validateStructuredCanvasPayload({
          type: 'json-render',
          spec: rawSpec,
        }) as unknown as Record<string, unknown>;
      }

      if (rawType === 'html-primitive') {
        const kind = typeof body.kind === 'string'
          ? body.kind
          : typeof body.primitive === 'string'
            ? body.primitive
            : '';
        const data = isRecord(body.data) ? body.data : {};
        return validateStructuredCanvasPayload({
          type: 'html-primitive',
          primitive: {
            kind,
            ...(typeof body.title === 'string' ? { title: body.title } : {}),
            data,
          },
        }) as unknown as Record<string, unknown>;
      }

      const data = parseGraphPayloadData(body.data);
      if (!data) {
        throw new OperationError('Graph validation requires a data array.');
      }

      const aggregate =
        body.aggregate === 'sum' || body.aggregate === 'count' || body.aggregate === 'avg'
          ? body.aggregate
          : undefined;
      const colorBy =
        body.colorBy === 'series' || body.colorBy === 'category' || body.colorBy === 'value' || body.colorBy === 'none'
          ? body.colorBy
          : undefined;
      const highlight =
        typeof body.highlight === 'number' || body.highlight === 'max' || body.highlight === 'min' || body.highlight === null
          ? body.highlight
          : undefined;
      const sort =
        body.sort === 'asc' || body.sort === 'desc' || body.sort === 'none' ? body.sort : undefined;

      return validateStructuredCanvasPayload({
        type: 'graph',
        graph: {
          title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Graph',
          // `typeName` is the legacy HTTP-only graphType alias on this route.
          graphType: typeof body.graphType === 'string'
            ? body.graphType
            : typeof body.typeName === 'string'
              ? body.typeName
              : 'line',
          data,
          ...(typeof body.xKey === 'string' ? { xKey: body.xKey } : {}),
          ...(typeof body.yKey === 'string' ? { yKey: body.yKey } : {}),
          ...(typeof body.zKey === 'string' ? { zKey: body.zKey } : {}),
          ...(typeof body.nameKey === 'string' ? { nameKey: body.nameKey } : {}),
          ...(typeof body.valueKey === 'string' ? { valueKey: body.valueKey } : {}),
          ...(typeof body.axisKey === 'string' ? { axisKey: body.axisKey } : {}),
          ...(Array.isArray(body.metrics)
            ? { metrics: body.metrics.filter((m: unknown): m is string => typeof m === 'string') }
            : {}),
          ...(Array.isArray(body.series)
            ? { series: body.series.filter((s: unknown): s is string => typeof s === 'string') }
            : {}),
          ...(typeof body.barKey === 'string' ? { barKey: body.barKey } : {}),
          ...(typeof body.lineKey === 'string' ? { lineKey: body.lineKey } : {}),
          ...(aggregate ? { aggregate } : {}),
          ...(typeof body.color === 'string' ? { color: body.color } : {}),
          ...(colorBy ? { colorBy } : {}),
          ...(highlight !== undefined ? { highlight } : {}),
          ...(typeof body.barColor === 'string' ? { barColor: body.barColor } : {}),
          ...(typeof body.lineColor === 'string' ? { lineColor: body.lineColor } : {}),
          ...(typeof body.labelKey === 'string' ? { labelKey: body.labelKey } : {}),
          ...(typeof body.targetKey === 'string' ? { targetKey: body.targetKey } : {}),
          ...(typeof body.rangesKey === 'string' ? { rangesKey: body.rangesKey } : {}),
          ...(typeof body.beforeKey === 'string' ? { beforeKey: body.beforeKey } : {}),
          ...(typeof body.afterKey === 'string' ? { afterKey: body.afterKey } : {}),
          ...(typeof body.beforeLabel === 'string' ? { beforeLabel: body.beforeLabel } : {}),
          ...(typeof body.afterLabel === 'string' ? { afterLabel: body.afterLabel } : {}),
          ...(sort ? { sort } : {}),
          ...(typeof body.fill === 'boolean' ? { fill: body.fill } : {}),
          ...(typeof body.showEndDot === 'boolean' ? { showEndDot: body.showEndDot } : {}),
          ...(typeof body.showMinMax === 'boolean' ? { showMinMax: body.showMinMax } : {}),
          ...(typeof body.showValue === 'boolean' ? { showValue: body.showValue } : {}),
          ...(typeof body.colorByDirection === 'boolean' ? { colorByDirection: body.colorByDirection } : {}),
          ...(typeof body.height === 'number' ? { height: body.height } : {}),
        },
      }) as unknown as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OperationError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      // Legacy HTTP error body includes the requested `type` — clients parse it.
      return { ok: false, error: message, type: rawType };
    }
  },
});

export const jsonRenderOperations: Operation[] = [
  jsonRenderAddOperation,
  jsonRenderStreamOperation,
  graphAddOperation,
  schemaDescribeOperation,
  specValidateOperation,
];
