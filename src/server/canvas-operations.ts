import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { recomputeCodeGraph } from './code-graph.js';
import {
  canvasState,
  type CanvasEdge,
  type CanvasNodeState,
  type CanvasNodeUpdate,
  type CanvasSnapshot,
} from './canvas-state.js';
import { rewatchAllFileNodes, unwatchAll, unwatchFileForNode, watchFileForNode } from './file-watcher.js';
import {
  closeMcpAppSession,
  hasMcpAppSession,
  listMcpAppSessionIds,
  openMcpApp,
  type ExternalMcpTransportConfig,
} from './mcp-app-runtime.js';
import { mutationHistory } from './mutation-history.js';
import { computeGroupBounds, findOpenCanvasPosition } from './placement.js';
import { searchNodes } from './spatial-analysis.js';
import { getCanvasNodeTitle } from './canvas-serialization.js';
import { computeAutoArrange } from '../shared/auto-arrange.js';
import {
  applyJsonRenderStreamPatches,
  buildGraphSpec,
  buildGraphConfig,
  createJsonRenderNodeData,
  emptyStreamingSpec,
  GRAPH_NODE_SIZE,
  inferJsonRenderNodeTitle,
  JSON_RENDER_NODE_SIZE,
  normalizeAndValidateJsonRenderSpec,
  type GraphNodeInput,
  type JsonRenderNodeInput,
  type JsonRenderSpec,
} from '../json-render/server.js';
import { fetchWebpageSnapshot, getWebpageFetchErrorDetails, normalizeWebpageUrl } from './webpage-node.js';
import { validateLocalImageFile } from './image-source.js';
import {
  buildExcalidrawRestoreCheckpointToolInput,
  ensureExcalidrawCheckpointId,
  isExcalidrawCreateView,
} from './diagram-presets.js';

export type CanvasArrangeMode = 'grid' | 'column' | 'flow';
export type CanvasPinMode = 'set' | 'add' | 'remove';

let canvasLayoutUpdateEmitter: (() => void) | null = null;

export function setCanvasLayoutUpdateEmitter(emitter: (() => void) | null): void {
  canvasLayoutUpdateEmitter = emitter;
}

export function emitCanvasLayoutUpdate(): void {
  canvasLayoutUpdateEmitter?.();
}

export interface CanvasFitViewOptions {
  width?: number;
  height?: number;
  padding?: number;
  maxScale?: number;
  nodeIds?: string[];
}

export interface CanvasFitViewResult {
  ok: true;
  viewport: { x: number; y: number; scale: number };
  nodeCount: number;
  bounds: { x: number; y: number; width: number; height: number } | null;
}

export interface CanvasGraphNodeUpdateInput extends Partial<GraphNodeInput> {
  spec?: unknown;
  type?: string;
}

export interface CanvasStructuredNodeUpdateInput extends Omit<CanvasGraphNodeUpdateInput, 'data'> {
  content?: unknown;
  data?: unknown;
  arrangeLocked?: unknown;
  strictSize?: boolean;
  chartHeight?: unknown;
}

interface CanvasAddNodeInput {
  type: CanvasNodeState['type'];
  title?: string;
  content?: string;
  data?: Record<string, unknown>;
  toolName?: string;
  category?: string;
  status?: string;
  duration?: string;
  resultSummary?: string;
  error?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  defaultWidth?: number;
  defaultHeight?: number;
  fileMode?: 'path' | 'inline' | 'auto';
  strictSize?: boolean;
}

export const MARKDOWN_NODE_DEFAULT_SIZE = { width: 640, height: 420 };
export const MCP_APP_NODE_DEFAULT_SIZE = { width: 960, height: 600 };
// Image and ledger nodes previously fell through to the generic 360x200 frame,
// which clipped content (a 360-wide image / log stream is cramped). Give them
// roomier defaults; height still auto-fits to content (see auto-fit.ts), so the
// width bump is the reliable lever.
export const IMAGE_NODE_DEFAULT_SIZE = { width: 480, height: 360 };
export const LEDGER_NODE_DEFAULT_SIZE = { width: 420, height: 280 };

interface CanvasCreateGroupInput {
  title?: string;
  childIds?: string[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
  childLayout?: CanvasArrangeMode;
}

interface CanvasNodeLookupInput {
  id?: string;
  search?: string;
}

const MAX_CONTEXT_PINS = 20;
const TRACE_DATA_FIELDS = ['toolName', 'category', 'status', 'duration', 'resultSummary', 'error'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function pickString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function pickNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function pickStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return strings.length > 0 ? strings : undefined;
}

function pickGraphData(record: Record<string, unknown>, key: string): Array<Record<string, unknown>> | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((item): item is Record<string, unknown> => isRecord(item));
  return rows.length === value.length ? rows : undefined;
}

function pickAggregate(record: Record<string, unknown>, key: string): GraphNodeInput['aggregate'] | undefined {
  const value = record[key];
  return value === 'sum' || value === 'count' || value === 'avg' ? value : undefined;
}

function isJsonRenderSpecLike(value: unknown): boolean {
  return isRecord(value) && typeof value.root === 'string' && isRecord(value.elements);
}

function isGraphPayloadLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    !isJsonRenderSpecLike(value) &&
    (Array.isArray(value.data) || typeof value.graphType === 'string')
  );
}

function hasGraphUpdateFields(input: Record<string, unknown>): boolean {
  return (
    input.graphType !== undefined ||
    input.type !== undefined ||
    Array.isArray(input.data) ||
    input.xKey !== undefined ||
    input.yKey !== undefined ||
    input.zKey !== undefined ||
    input.nameKey !== undefined ||
    input.valueKey !== undefined ||
    input.showLegend !== undefined ||
    input.showLabels !== undefined ||
    input.axisKey !== undefined ||
    input.metrics !== undefined ||
    input.series !== undefined ||
    input.barKey !== undefined ||
    input.lineKey !== undefined ||
    input.aggregate !== undefined ||
    input.color !== undefined ||
    input.barColor !== undefined ||
    input.lineColor !== undefined ||
    input.chartHeight !== undefined
  );
}

function graphUpdateInput(input: CanvasStructuredNodeUpdateInput): CanvasGraphNodeUpdateInput {
  const data = pickGraphData(input as Record<string, unknown>, 'data');
  const { data: _data, content: _content, arrangeLocked: _arrangeLocked, chartHeight, ...graphFields } = input;
  return {
    ...graphFields,
    ...(data ? { data } : {}),
    ...(typeof chartHeight === 'number' ? { height: chartHeight } : {}),
  };
}

function mergeNodeDataFields(
  base: Record<string, unknown>,
  input: CanvasStructuredNodeUpdateInput,
): Record<string, unknown> {
  return {
    ...base,
    ...(isRecord(input.data) ? input.data : {}),
    ...(typeof input.arrangeLocked === 'boolean' ? { arrangeLocked: input.arrangeLocked } : {}),
    ...(typeof input.strictSize === 'boolean' ? { strictSize: input.strictSize } : {}),
  };
}

export function hasStructuredNodeUpdateFields(input: Record<string, unknown>): boolean {
  return input.spec !== undefined || hasGraphUpdateFields(input);
}

export function buildStructuredNodeUpdate(
  node: CanvasNodeState,
  input: CanvasStructuredNodeUpdateInput,
): { data: Record<string, unknown> } {
  const inputRecord = input as Record<string, unknown>;
  const hasSpec = inputRecord.spec !== undefined;
  const hasGraphFields = hasGraphUpdateFields(inputRecord);

  if (node.type === 'json-render') {
    if (hasGraphFields) {
      throw new Error(`Graph update fields can only be used with graph nodes, not ${node.type} nodes.`);
    }
    if (!hasSpec) {
      throw new Error('json-render structured updates require a spec.');
    }
    return {
      data: mergeNodeDataFields(
        buildJsonRenderNodeUpdate(node, {
          ...(typeof input.title === 'string' ? { title: input.title } : {}),
          spec: input.spec,
        }).data,
        input,
      ),
    };
  }

  if (node.type === 'graph') {
    return {
      data: mergeNodeDataFields(buildGraphNodeUpdate(node, graphUpdateInput(input)).data, input),
    };
  }

  throw new Error(
    `Structured spec and graph updates can only be used with json-render or graph nodes, not ${node.type} nodes.`,
  );
}

function graphConfigToInput(config: Record<string, unknown>, fallbackTitle: string): GraphNodeInput | null {
  const data = pickGraphData(config, 'data');
  if (!data) return null;
  return {
    title: pickString(config, 'title') ?? fallbackTitle,
    graphType: pickString(config, 'graphType') ?? 'line',
    data,
    ...(pickString(config, 'xKey') ? { xKey: pickString(config, 'xKey') } : {}),
    ...(pickString(config, 'yKey') ? { yKey: pickString(config, 'yKey') } : {}),
    ...(pickString(config, 'zKey') ? { zKey: pickString(config, 'zKey') } : {}),
    ...(pickString(config, 'nameKey') ? { nameKey: pickString(config, 'nameKey') } : {}),
    ...(pickString(config, 'valueKey') ? { valueKey: pickString(config, 'valueKey') } : {}),
    ...(typeof config.showLegend === 'boolean' ? { showLegend: config.showLegend } : {}),
    ...(typeof config.showLabels === 'boolean' ? { showLabels: config.showLabels } : {}),
    ...(pickString(config, 'axisKey') ? { axisKey: pickString(config, 'axisKey') } : {}),
    ...(pickStringArray(config, 'metrics') ? { metrics: pickStringArray(config, 'metrics') } : {}),
    ...(pickStringArray(config, 'series') ? { series: pickStringArray(config, 'series') } : {}),
    ...(pickString(config, 'barKey') ? { barKey: pickString(config, 'barKey') } : {}),
    ...(pickString(config, 'lineKey') ? { lineKey: pickString(config, 'lineKey') } : {}),
    ...(pickAggregate(config, 'aggregate') ? { aggregate: pickAggregate(config, 'aggregate') } : {}),
    ...(pickString(config, 'color') ? { color: pickString(config, 'color') } : {}),
    ...(pickString(config, 'barColor') ? { barColor: pickString(config, 'barColor') } : {}),
    ...(pickString(config, 'lineColor') ? { lineColor: pickString(config, 'lineColor') } : {}),
    ...(pickNumber(config, 'height') !== undefined ? { height: pickNumber(config, 'height') } : {}),
  };
}

function mergeGraphInput(source: Record<string, unknown>, fallback: GraphNodeInput | null): GraphNodeInput {
  const data = pickGraphData(source, 'data') ?? fallback?.data;
  if (!data)
    throw new Error('Graph update requires a data array, either in the update payload or the existing graphConfig.');
  return {
    title: pickString(source, 'title') ?? fallback?.title ?? 'Graph',
    graphType: pickString(source, 'graphType') ?? pickString(source, 'type') ?? fallback?.graphType ?? 'line',
    data,
    ...((pickString(source, 'xKey') ?? fallback?.xKey) ? { xKey: pickString(source, 'xKey') ?? fallback?.xKey } : {}),
    ...((pickString(source, 'yKey') ?? fallback?.yKey) ? { yKey: pickString(source, 'yKey') ?? fallback?.yKey } : {}),
    ...((pickString(source, 'zKey') ?? fallback?.zKey) ? { zKey: pickString(source, 'zKey') ?? fallback?.zKey } : {}),
    ...((pickString(source, 'nameKey') ?? fallback?.nameKey)
      ? { nameKey: pickString(source, 'nameKey') ?? fallback?.nameKey }
      : {}),
    ...((pickString(source, 'valueKey') ?? fallback?.valueKey)
      ? { valueKey: pickString(source, 'valueKey') ?? fallback?.valueKey }
      : {}),
    ...(typeof source.showLegend === 'boolean' || typeof fallback?.showLegend === 'boolean'
      ? { showLegend: typeof source.showLegend === 'boolean' ? source.showLegend : fallback?.showLegend }
      : {}),
    ...(typeof source.showLabels === 'boolean' || typeof fallback?.showLabels === 'boolean'
      ? { showLabels: typeof source.showLabels === 'boolean' ? source.showLabels : fallback?.showLabels }
      : {}),
    ...((pickString(source, 'axisKey') ?? fallback?.axisKey)
      ? { axisKey: pickString(source, 'axisKey') ?? fallback?.axisKey }
      : {}),
    ...((pickStringArray(source, 'metrics') ?? fallback?.metrics)
      ? { metrics: pickStringArray(source, 'metrics') ?? fallback?.metrics }
      : {}),
    ...((pickStringArray(source, 'series') ?? fallback?.series)
      ? { series: pickStringArray(source, 'series') ?? fallback?.series }
      : {}),
    ...((pickString(source, 'barKey') ?? fallback?.barKey)
      ? { barKey: pickString(source, 'barKey') ?? fallback?.barKey }
      : {}),
    ...((pickString(source, 'lineKey') ?? fallback?.lineKey)
      ? { lineKey: pickString(source, 'lineKey') ?? fallback?.lineKey }
      : {}),
    ...((pickAggregate(source, 'aggregate') ?? fallback?.aggregate)
      ? { aggregate: pickAggregate(source, 'aggregate') ?? fallback?.aggregate }
      : {}),
    ...((pickString(source, 'color') ?? fallback?.color)
      ? { color: pickString(source, 'color') ?? fallback?.color }
      : {}),
    ...((pickString(source, 'barColor') ?? fallback?.barColor)
      ? { barColor: pickString(source, 'barColor') ?? fallback?.barColor }
      : {}),
    ...((pickString(source, 'lineColor') ?? fallback?.lineColor)
      ? { lineColor: pickString(source, 'lineColor') ?? fallback?.lineColor }
      : {}),
    ...((pickNumber(source, 'height') ?? fallback?.height) !== undefined
      ? { height: pickNumber(source, 'height') ?? fallback?.height }
      : {}),
  };
}

export function buildJsonRenderNodeUpdate(
  node: CanvasNodeState,
  input: { title?: string; spec: unknown },
): { data: Record<string, unknown>; spec: JsonRenderSpec } {
  if (node.type !== 'json-render') throw new Error(`Node "${node.id}" is not a json-render node.`);
  const spec = normalizeAndValidateJsonRenderSpec(input.spec);
  const title = input.title?.trim() || inferJsonRenderNodeTitle(spec);
  return {
    spec,
    data: {
      ...node.data,
      ...createJsonRenderNodeData(node.id, title, spec, { viewerType: 'json-render' }),
    },
  };
}

export function buildGraphNodeUpdate(
  node: CanvasNodeState,
  input: CanvasGraphNodeUpdateInput,
): { data: Record<string, unknown>; spec: JsonRenderSpec; graphConfig: Record<string, unknown> } {
  if (node.type !== 'graph') throw new Error(`Node "${node.id}" is not a graph node.`);
  const currentConfig = isRecord(node.data.graphConfig) ? node.data.graphConfig : {};
  const fallbackTitle = typeof node.data.title === 'string' ? node.data.title : 'Graph';
  const fallback = graphConfigToInput(currentConfig, fallbackTitle);
  const source = isGraphPayloadLike(input.spec)
    ? input.spec
    : Object.fromEntries(Object.entries(input).filter(([key, value]) => key !== 'spec' && value !== undefined));

  if (input.spec !== undefined && !isGraphPayloadLike(input.spec)) {
    const spec = normalizeAndValidateJsonRenderSpec(input.spec);
    const title = input.title?.trim() || fallbackTitle;
    return {
      spec,
      graphConfig: currentConfig,
      data: {
        ...node.data,
        ...createJsonRenderNodeData(node.id, title, spec, {
          viewerType: 'graph',
          graphConfig: currentConfig,
        }),
      },
    };
  }

  const graphInput = mergeGraphInput(source, fallback);
  const spec = buildGraphSpec(graphInput);
  const graphConfig = buildGraphConfig(graphInput);
  const title = graphInput.title?.trim() || 'Graph';
  return {
    spec,
    graphConfig,
    data: {
      ...node.data,
      ...createJsonRenderNodeData(node.id, title, spec, {
        viewerType: 'graph',
        graphConfig,
      }),
    },
  };
}

function getStoredExcalidrawCheckpointId(node: CanvasNodeState): string | null {
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  const checkpointId = appCheckpoint?.id;
  return typeof checkpointId === 'string' && checkpointId.trim().length > 0 ? checkpointId.trim() : null;
}

function resolveExtAppRehydratedToolInput(
  node: CanvasNodeState,
  openedToolInput: Record<string, unknown>,
): Record<string, unknown> {
  if (!isExcalidrawCreateView(node.data.serverName, node.data.toolName)) return openedToolInput;
  const checkpointId = getStoredExcalidrawCheckpointId(node);
  if (!checkpointId) return openedToolInput;
  const appCheckpoint = isRecord(node.data.appCheckpoint) ? node.data.appCheckpoint : null;
  return {
    ...openedToolInput,
    elements: buildExcalidrawRestoreCheckpointToolInput(
      checkpointId,
      typeof appCheckpoint?.data === 'string' ? appCheckpoint.data : undefined,
    ),
  };
}

function isExtAppNode(node: CanvasNodeState | undefined): node is CanvasNodeState {
  return node?.type === 'mcp-app' && node.data.mode === 'ext-app';
}

function getExtAppSessionId(node: CanvasNodeState | undefined): string | null {
  if (!isExtAppNode(node)) return null;
  const sessionId = node.data.appSessionId;
  return typeof sessionId === 'string' && sessionId.trim().length > 0 ? sessionId.trim() : null;
}

function normalizeTransportConfig(value: unknown): ExternalMcpTransportConfig | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;

  if (value.type === 'http') {
    const url = typeof value.url === 'string' ? value.url.trim() : '';
    if (!url) return null;
    const headers = isRecord(value.headers)
      ? Object.fromEntries(
          Object.entries(value.headers)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([key, headerValue]) => [key, headerValue]),
        )
      : undefined;
    return {
      type: 'http',
      url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }

  if (value.type === 'stdio') {
    const command = typeof value.command === 'string' ? value.command.trim() : '';
    if (!command) return null;
    const args = Array.isArray(value.args)
      ? value.args.filter((entry): entry is string => typeof entry === 'string')
      : undefined;
    const env = isRecord(value.env)
      ? Object.fromEntries(
          Object.entries(value.env)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([key, envValue]) => [key, envValue]),
        )
      : undefined;
    return {
      type: 'stdio',
      command,
      ...(args && args.length > 0 ? { args } : {}),
      ...(typeof value.cwd === 'string' && value.cwd.trim().length > 0 ? { cwd: value.cwd.trim() } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    };
  }

  return null;
}

function setExtAppRuntimeState(
  nodeId: string,
  patch: {
    appSessionId?: string | null;
    html?: string;
    toolInput?: Record<string, unknown>;
    toolResult?: unknown;
    resourceUri?: string;
    toolDefinition?: unknown;
    resourceMeta?: unknown;
    serverName?: string;
    toolName?: string;
    transportConfig?: ExternalMcpTransportConfig;
    sessionStatus?: 'ready' | 'rehydrating' | 'error';
    sessionError?: string | null;
  },
): void {
  const current = canvasState.getNode(nodeId);
  if (!isExtAppNode(current)) return;

  const nextData: Record<string, unknown> = { ...current.data };
  if ('appSessionId' in patch) {
    if (typeof patch.appSessionId === 'string' && patch.appSessionId.trim().length > 0) {
      nextData.appSessionId = patch.appSessionId;
    } else {
      delete nextData.appSessionId;
    }
  }
  if ('html' in patch && typeof patch.html === 'string') nextData.html = patch.html;
  if ('toolInput' in patch && patch.toolInput) nextData.toolInput = patch.toolInput;
  if ('toolResult' in patch && patch.toolResult !== undefined) nextData.toolResult = patch.toolResult;
  if ('resourceUri' in patch && typeof patch.resourceUri === 'string') nextData.resourceUri = patch.resourceUri;
  if ('toolDefinition' in patch && patch.toolDefinition !== undefined) nextData.toolDefinition = patch.toolDefinition;
  if ('resourceMeta' in patch && patch.resourceMeta !== undefined) nextData.resourceMeta = patch.resourceMeta;
  if ('serverName' in patch && typeof patch.serverName === 'string') nextData.serverName = patch.serverName;
  if ('toolName' in patch && typeof patch.toolName === 'string') nextData.toolName = patch.toolName;
  if ('transportConfig' in patch && patch.transportConfig) nextData.transportConfig = patch.transportConfig;
  if ('sessionStatus' in patch && patch.sessionStatus) nextData.sessionStatus = patch.sessionStatus;
  if ('sessionError' in patch) {
    if (typeof patch.sessionError === 'string' && patch.sessionError.trim().length > 0) {
      nextData.sessionError = patch.sessionError;
    } else {
      delete nextData.sessionError;
    }
  }

  canvasState.updateNode(nodeId, { data: nextData });
}

function prepareExtAppNodesForSessionSync(forceRehydrate: boolean): string[] {
  const currentLayout = canvasState.getLayout();
  const targetIds: string[] = [];

  canvasState.withSuppressedRecording(() => {
    for (const node of currentLayout.nodes) {
      if (!isExtAppNode(node)) continue;
      const sessionId = getExtAppSessionId(node);
      const needsRehydrate = forceRehydrate || !sessionId || !hasMcpAppSession(sessionId);
      if (!needsRehydrate) continue;

      const transportConfig = normalizeTransportConfig(node.data.transportConfig);
      if (!transportConfig) {
        setExtAppRuntimeState(node.id, {
          appSessionId: null,
          sessionStatus: 'error',
          sessionError:
            'Saved app session cannot be restored because its transport details are missing. Reopen the app to restore interactivity.',
        });
        continue;
      }

      setExtAppRuntimeState(node.id, {
        appSessionId: null,
        transportConfig,
        sessionStatus: 'rehydrating',
        sessionError: null,
      });
      targetIds.push(node.id);
    }
  });

  return targetIds;
}

export function primeCanvasRuntimeBackends(options: { forceRehydrateExtApps?: boolean } = {}): { targetIds: string[] } {
  const forceRehydrateExtApps = options.forceRehydrateExtApps === true;
  rewatchAllFileNodes();

  const layout = canvasState.getLayout();
  const referencedSessionIds = new Set(
    layout.nodes
      .map((node) => getExtAppSessionId(node))
      .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
  );

  for (const sessionId of listMcpAppSessionIds()) {
    if (forceRehydrateExtApps || !referencedSessionIds.has(sessionId)) {
      closeMcpAppSession(sessionId);
    }
  }

  return { targetIds: prepareExtAppNodesForSessionSync(forceRehydrateExtApps) };
}

export async function syncCanvasRuntimeBackends(
  options: { forceRehydrateExtApps?: boolean; alreadyPrimed?: boolean } = {},
): Promise<{ rehydrated: number; failed: number }> {
  const targetIds =
    options.alreadyPrimed === true
      ? canvasState
          .getLayout()
          .nodes.filter((node) => isExtAppNode(node) && node.data.sessionStatus === 'rehydrating')
          .map((node) => node.id)
      : primeCanvasRuntimeBackends(options).targetIds;
  let rehydrated = 0;
  let failed = 0;

  for (const nodeId of targetIds) {
    const current = canvasState.getNode(nodeId);
    if (!isExtAppNode(current)) continue;

    const transport = normalizeTransportConfig(current.data.transportConfig);
    const toolName = typeof current.data.toolName === 'string' ? current.data.toolName.trim() : '';
    if (!transport || !toolName) {
      canvasState.withSuppressedRecording(() => {
        setExtAppRuntimeState(nodeId, {
          appSessionId: null,
          sessionStatus: 'error',
          sessionError:
            'Saved app session cannot be restored because its launch metadata is incomplete. Reopen the app to restore interactivity.',
        });
      });
      failed++;
      continue;
    }

    try {
      const opened = await openMcpApp({
        transport,
        toolName,
        ...(isRecord(current.data.toolInput) ? { toolArguments: current.data.toolInput } : {}),
        ...(typeof current.data.serverName === 'string' && current.data.serverName.trim().length > 0
          ? { serverName: current.data.serverName.trim() }
          : {}),
      });
      const toolInput = resolveExtAppRehydratedToolInput(current, opened.toolInput);
      const storedCheckpointId = getStoredExcalidrawCheckpointId(current);
      const toolResult = isExcalidrawCreateView(opened.serverName, opened.toolName)
        ? ensureExcalidrawCheckpointId(opened.toolResult, nodeId, storedCheckpointId)
        : opened.toolResult;

      canvasState.withSuppressedRecording(() => {
        setExtAppRuntimeState(nodeId, {
          appSessionId: opened.sessionId,
          html: opened.html,
          toolInput,
          toolResult,
          resourceUri: opened.resourceUri,
          toolDefinition: opened.tool,
          resourceMeta: opened.resourceMeta,
          serverName: opened.serverName,
          toolName: opened.toolName,
          transportConfig: transport,
          sessionStatus: 'ready',
          sessionError: null,
        });
      });
      rehydrated++;
    } catch (error) {
      canvasState.withSuppressedRecording(() => {
        setExtAppRuntimeState(nodeId, {
          appSessionId: null,
          sessionStatus: 'error',
          sessionError: error instanceof Error ? error.message : String(error),
        });
      });
      failed++;
    }
  }

  return { rehydrated, failed };
}

export function validateCanvasNodePatch(patch: {
  position?: { x: number; y: number };
  size?: { width: number; height: number };
}): string | null {
  if (patch.position) {
    if (!Number.isFinite(patch.position.x) || !Number.isFinite(patch.position.y)) {
      return 'Position must contain finite x and y values.';
    }
  }
  if (patch.size) {
    if (!Number.isFinite(patch.size.width) || !Number.isFinite(patch.size.height)) {
      return 'Size must contain finite width and height values.';
    }
    if (patch.size.width <= 0 || patch.size.height <= 0) {
      return 'Size width and height must be greater than zero.';
    }
  }
  return null;
}

let codeGraphTimer: ReturnType<typeof setTimeout> | null = null;

function shouldTreatFileContentAsPath(input: CanvasAddNodeInput): boolean {
  if (input.fileMode === 'path') return true;
  if (input.fileMode === 'inline') return false;

  const content = input.content?.trim() ?? '';
  if (!content || content.includes('\n') || content.includes('\r')) return false;
  if (typeof input.data?.path === 'string' && input.data.path.length > 0) return true;
  if (existsSync(resolve(content))) return true;
  if (!input.title) return true;
  return content.startsWith('/') || content.startsWith('./') || content.startsWith('../') || content.includes('/');
}

function buildFileNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  if (!shouldTreatFileContentAsPath(input)) {
    return {
      ...(input.data ?? {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.content ? { content: input.content } : {}),
      ...(input.content && input.title
        ? {
            fileContent: input.content,
            lineCount: input.content.split('\n').length,
          }
        : {}),
    };
  }

  const rawPath =
    typeof input.data?.path === 'string' && input.data.path.length > 0 ? input.data.path : (input.content ?? '');
  const resolved = resolve(rawPath);
  const fileName = basename(resolved) || rawPath;
  const data: Record<string, unknown> = {
    ...(input.data ?? {}),
    path: resolved,
    title: input.title ?? fileName,
  };

  try {
    if (existsSync(resolved)) {
      const fileContent = readFileSync(resolved, 'utf-8');
      const stat = statSync(resolved);
      data.fileContent = fileContent;
      data.lineCount = fileContent.split('\n').length;
      data.updatedAt = new Date(stat.mtimeMs).toISOString();
    }
  } catch {
    // Missing or unreadable files still render as path-backed file nodes.
  }

  return data;
}

function buildImageNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  const src = input.content ?? '';
  const isDataUri = src.startsWith('data:');
  const isUrl = src.startsWith('http://') || src.startsWith('https://');

  if (isDataUri) {
    // Basic data-URI sanity: must be an image/* mediatype.
    const header = src.slice(5, src.indexOf(',') >= 0 ? src.indexOf(',') : src.length);
    if (!/^image\//i.test(header)) {
      throw new Error(
        `Invalid image node: data URI must be an image/* media type (got "${header.slice(0, 40)}"). ` +
          `Accepted: png, jpeg, gif, svg+xml, webp, bmp, avif, x-icon.`,
      );
    }
  }

  if (!isDataUri && !isUrl && src) {
    const resolved = resolve(src);
    const fileName = basename(resolved) || src;
    const { mimeType } = validateLocalImageFile(resolved);
    return {
      ...(input.data ?? {}),
      src: resolved,
      title: input.title ?? fileName,
      path: resolved,
      mimeType,
    };
  }

  return {
    ...(input.data ?? {}),
    src,
    title: input.title ?? (isUrl ? (src.split('/').pop() ?? 'Image') : 'Image'),
  };
}

function buildWebpageNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  const rawUrl =
    typeof input.data?.url === 'string' && input.data.url.length > 0 ? input.data.url : (input.content ?? '');
  const url = normalizeWebpageUrl(rawUrl);
  const explicitTitle =
    typeof input.title === 'string' && input.title.trim().length > 0
      ? input.title.trim()
      : typeof input.data?.title === 'string' && input.data.title.trim().length > 0
        ? input.data.title.trim()
        : '';

  return {
    ...(input.data ?? {}),
    url,
    title: explicitTitle || url,
    titleSource: explicitTitle ? 'user' : 'page',
    status: 'idle',
    content: typeof input.data?.content === 'string' ? input.data.content : '',
    excerpt: typeof input.data?.excerpt === 'string' ? input.data.excerpt : '',
  };
}

function normalizeTraceNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  const data: Record<string, unknown> = { ...(input.data ?? {}) };
  for (const field of TRACE_DATA_FIELDS) {
    const value = input[field];
    if (typeof value === 'string') data[field] = value;
  }
  if (input.title) data.title = input.title;
  if (input.content) data.content = input.content;
  if (input.strictSize) data.strictSize = true;
  return data;
}

function buildNodeData(input: CanvasAddNodeInput): Record<string, unknown> {
  if (input.type === 'file') return buildFileNodeData(input);
  if (input.type === 'image') return buildImageNodeData(input);
  if (input.type === 'webpage') return buildWebpageNodeData(input);
  if (input.type === 'trace') return normalizeTraceNodeData(input);
  return {
    ...(input.data ?? {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.content ? { content: input.content } : {}),
    ...(input.strictSize ? { strictSize: true } : {}),
  };
}

export function mergeTraceNodeDataFields(
  base: Record<string, unknown>,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...base };
  for (const field of TRACE_DATA_FIELDS) {
    if (typeof input[field] === 'string') next[field] = input[field];
  }
  return next;
}

export function hasTraceNodeDataFields(input: Record<string, unknown>): boolean {
  return TRACE_DATA_FIELDS.some((field) => typeof input[field] === 'string');
}

export function scheduleCodeGraphRecompute(onComplete?: () => void): void {
  if (codeGraphTimer) clearTimeout(codeGraphTimer);
  codeGraphTimer = setTimeout(() => {
    codeGraphTimer = null;
    recomputeCodeGraph();
    onComplete?.();
  }, 300);
}

/**
 * Resolve an html-node `html` field that may be a path to a local .html/.htm file.
 *
 * If the string looks like a bare filesystem path to an existing HTML file
 * (no markup, no newlines, short, ends in .html/.htm, exists on disk), read the
 * file and return its contents. Otherwise return the string unchanged as raw HTML.
 * On read failure, fall back to the raw string and warn — never throw.
 *
 * This is a local dev tool, so reading a user-pointed-at local file is acceptable;
 * the markup/newline guards prevent misclassifying genuine HTML as a path.
 */
export function resolveHtmlContent(html: string): string {
  const trimmed = html.trim();
  const looksLikePath =
    trimmed.length > 0 &&
    trimmed.length <= 1024 &&
    !trimmed.includes('\n') &&
    !trimmed.includes('<') &&
    /\.html?$/i.test(trimmed);
  if (!looksLikePath) return html;

  const resolved = resolve(trimmed);
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return html;

  try {
    return readFileSync(resolved, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[pmx-canvas] html node: failed to read "${resolved}" (${message}); treating --content as raw HTML.`);
    return html;
  }
}

export function addCanvasNode(input: CanvasAddNodeInput): {
  id: string;
  node: CanvasNodeState;
  needsCodeGraphRecompute: boolean;
} {
  if (input.type === 'json-render' || input.type === 'graph') {
    throw new Error(`Use the dedicated ${input.type} node APIs for structured viewer nodes.`);
  }

  const width = input.width ?? input.defaultWidth ?? 720;
  const height = input.height ?? input.defaultHeight ?? 600;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data = buildNodeData(input);
  const node: CanvasNodeState = {
    id,
    type: input.type,
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  };

  canvasState.addNode(node);
  const storedNode = canvasState.getNode(id) ?? node;

  const filePath = input.type === 'file' && typeof data.path === 'string' ? data.path : null;
  if (filePath) {
    watchFileForNode(id, filePath);
  }

  return { id, node: storedNode, needsCodeGraphRecompute: input.type === 'file' };
}

export function resolveCanvasNode(nodeRef: CanvasNodeLookupInput):
  | {
      ok: true;
      node: CanvasNodeState;
    }
  | {
      ok: false;
      error: string;
    } {
  if (typeof nodeRef.id === 'string' && nodeRef.id.trim().length > 0) {
    const node = canvasState.getNode(nodeRef.id.trim());
    if (!node) {
      return { ok: false, error: `Node "${nodeRef.id}" not found.` };
    }
    return { ok: true, node };
  }

  if (typeof nodeRef.search === 'string' && nodeRef.search.trim().length > 0) {
    const query = nodeRef.search.trim();
    const layout = canvasState.getLayout();
    const exactTitleMatches = layout.nodes.filter((node) => {
      const title = getCanvasNodeTitle(node);
      return title !== null && title.toLowerCase() === query.toLowerCase();
    });
    if (exactTitleMatches.length === 1) {
      return { ok: true, node: exactTitleMatches[0]! };
    }
    if (exactTitleMatches.length > 1) {
      return {
        ok: false,
        error: `Search "${query}" is ambiguous. Exact title matches: ${exactTitleMatches.map((node) => `${getCanvasNodeTitle(node) ?? node.id} (${node.id})`).join(', ')}`,
      };
    }

    const matches = searchNodes(layout.nodes, query);
    if (matches.length === 0) {
      return { ok: false, error: `No node matches search "${query}".` };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        error: `Search "${query}" is ambiguous. Matches: ${matches
          .slice(0, 5)
          .map((match) => `${match.title ?? match.id} (${match.id})`)
          .join(', ')}`,
      };
    }
    const node = canvasState.getNode(matches[0]!.id);
    if (!node) {
      return { ok: false, error: `Resolved node "${matches[0]!.id}" disappeared.` };
    }
    return { ok: true, node };
  }

  return { ok: false, error: 'Missing node reference. Provide either an id or a search query.' };
}

export async function refreshCanvasWebpageNode(
  id: string,
  options: { url?: string } = {},
): Promise<{ ok: boolean; id: string; error?: string }> {
  const existing = canvasState.getNode(id);
  if (!existing || existing.type !== 'webpage') {
    return { ok: false, id, error: `Webpage node "${id}" not found.` };
  }

  const currentData = existing.data;
  const configuredUrl =
    typeof options.url === 'string' && options.url.trim().length > 0
      ? options.url
      : typeof currentData.url === 'string'
        ? currentData.url
        : '';

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeWebpageUrl(configuredUrl);
  } catch (error) {
    canvasState.updateNode(id, {
      data: {
        ...currentData,
        status: 'error',
        error: error instanceof Error ? error.message : 'Invalid webpage URL.',
      },
    });
    return {
      ok: false,
      id,
      error: error instanceof Error ? error.message : 'Invalid webpage URL.',
    };
  }

  const fetchingData: Record<string, unknown> = {
    ...currentData,
    url: normalizedUrl,
    status: 'fetching',
  };
  delete fetchingData.error;
  canvasState.updateNode(id, { data: fetchingData });

  try {
    const snapshot = await fetchWebpageSnapshot(normalizedUrl);
    const latest = canvasState.getNode(id);
    if (!latest || latest.type !== 'webpage') {
      return { ok: false, id, error: `Webpage node "${id}" disappeared during refresh.` };
    }

    const latestData = latest.data;
    const titleSource = latestData.titleSource === 'user' ? 'user' : 'page';
    const currentTitle = typeof latestData.title === 'string' ? latestData.title.trim() : '';
    const nextTitle =
      titleSource === 'user' && currentTitle.length > 0 ? currentTitle : (snapshot.pageTitle ?? snapshot.url);

    const nextData: Record<string, unknown> = {
      ...latestData,
      url: snapshot.url,
      title: nextTitle,
      titleSource,
      pageTitle: snapshot.pageTitle,
      description: snapshot.description,
      imageUrl: snapshot.imageUrl,
      content: snapshot.content,
      excerpt: snapshot.excerpt,
      fetchedAt: snapshot.fetchedAt,
      status: 'ready',
      statusCode: snapshot.statusCode,
      contentType: snapshot.contentType,
      frameBlocked: snapshot.frameBlocked,
      frameBlockedReason: snapshot.frameBlockedReason,
    };
    delete nextData.error;

    canvasState.updateNode(id, { data: nextData });
    return { ok: true, id };
  } catch (error) {
    const details = getWebpageFetchErrorDetails(error);
    const latest = canvasState.getNode(id);
    if (latest?.type === 'webpage') {
      canvasState.updateNode(id, {
        data: {
          ...latest.data,
          url: normalizedUrl,
          fetchedAt: new Date().toISOString(),
          status: 'error',
          error: details.message,
          ...(details.statusCode !== null ? { statusCode: details.statusCode } : {}),
          ...(details.contentType !== null ? { contentType: details.contentType } : {}),
        },
      });
    }
    return { ok: false, id, error: details.message };
  }
}

export function removeCanvasNode(id: string): {
  removed: boolean;
  needsCodeGraphRecompute: boolean;
} {
  const existing = canvasState.getNode(id);
  if (!existing) {
    return { removed: false, needsCodeGraphRecompute: false };
  }

  if (existing.type === 'file') {
    unwatchFileForNode(id, typeof existing.data.path === 'string' ? existing.data.path : undefined);
  }

  canvasState.removeNode(id);
  return { removed: true, needsCodeGraphRecompute: existing.type === 'file' };
}

function isArrangeLocked(node: CanvasNodeState): boolean {
  return node.pinned || node.dockPosition !== null || node.data.arrangeLocked === true;
}

function collectArrangeExcludedNodeIds(nodes: CanvasNodeState[]): Set<string> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const excludedGroupIds = new Set<string>();

  for (const node of nodes) {
    if (node.type !== 'group') continue;
    const childIds = Array.isArray(node.data.children)
      ? node.data.children.filter((id): id is string => typeof id === 'string')
      : [];
    const hasLockedChild = childIds.some((childId) => {
      const child = nodesById.get(childId);
      return child ? isArrangeLocked(child) : false;
    });
    if (isArrangeLocked(node) || hasLockedChild) {
      excludedGroupIds.add(node.id);
    }
  }

  const excluded = new Set<string>();
  for (const node of nodes) {
    const parentGroup = typeof node.data.parentGroup === 'string' ? node.data.parentGroup : null;
    if (parentGroup || isArrangeLocked(node)) {
      excluded.add(node.id);
    }
  }

  for (const groupId of excludedGroupIds) {
    excluded.add(groupId);
    const group = nodesById.get(groupId);
    const childIds = Array.isArray(group?.data.children)
      ? group.data.children.filter((id): id is string => typeof id === 'string')
      : [];
    for (const childId of childIds) excluded.add(childId);
  }

  return excluded;
}

function collectGridArrangeExcludedNodeIds(nodes: CanvasNodeState[]): Set<string> {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const excluded = new Set<string>();

  for (const node of nodes) {
    if (isArrangeLocked(node)) excluded.add(node.id);
  }

  for (const node of nodes) {
    if (node.type !== 'group') continue;
    const childIds = Array.isArray(node.data.children)
      ? node.data.children.filter((id): id is string => typeof id === 'string')
      : [];
    const hasLockedChild = childIds.some((childId) => {
      const child = nodesById.get(childId);
      return child ? isArrangeLocked(child) : false;
    });
    if (!excluded.has(node.id) && !hasLockedChild) continue;

    excluded.add(node.id);
    for (const childId of childIds) excluded.add(childId);
  }

  return excluded;
}

interface ArrangeObstacleRect {
  id: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
}

const GRID_OBSTACLE_GAP_Y = 72;

function rectsOverlap(a: ArrangeObstacleRect, b: ArrangeObstacleRect): boolean {
  return (
    a.position.x < b.position.x + b.size.width &&
    a.position.x + a.size.width > b.position.x &&
    a.position.y < b.position.y + b.size.height &&
    a.position.y + a.size.height > b.position.y
  );
}

function collectGridArrangeObstacles(nodes: CanvasNodeState[], excludedIds: Set<string>): ArrangeObstacleRect[] {
  return nodes
    .filter((node) => excludedIds.has(node.id) && node.dockPosition === null)
    .map((node) => ({
      id: node.id,
      position: { ...node.position },
      size: { ...node.size },
    }));
}

function buildUpdatedArrangeRect(
  update: CanvasNodeUpdate,
  nodesById: Map<string, CanvasNodeState>,
): ArrangeObstacleRect | null {
  const node = nodesById.get(update.id);
  if (!node) return null;
  return {
    id: update.id,
    position: update.position ? { ...update.position } : { ...node.position },
    size: update.size ? { ...update.size } : { ...node.size },
  };
}

function shiftGridUpdatesBelowObstacles(
  updates: CanvasNodeUpdate[],
  nodes: CanvasNodeState[],
  obstacles: ArrangeObstacleRect[],
): CanvasNodeUpdate[] {
  if (updates.length === 0 || obstacles.length === 0) return updates;

  // Grid arrange only sees movable nodes, so preserved locked/docked-group frames
  // need a separate obstacle pass before applying the planned positions.
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  let shifted = updates;

  for (let attempt = 0; attempt <= obstacles.length; attempt++) {
    const plannedRects = shifted
      .map((update) => buildUpdatedArrangeRect(update, nodesById))
      .filter((rect): rect is ArrangeObstacleRect => rect !== null);
    if (plannedRects.length === 0) return shifted;

    const blockers = obstacles.filter((obstacle) =>
      plannedRects.some((rect) => rect.id !== obstacle.id && rectsOverlap(rect, obstacle)),
    );
    if (blockers.length === 0) return shifted;

    const minPlannedY = Math.min(...plannedRects.map((rect) => rect.position.y));
    const blockerBottom = Math.max(...blockers.map((rect) => rect.position.y + rect.size.height));
    const deltaY = blockerBottom + GRID_OBSTACLE_GAP_Y - minPlannedY;
    if (deltaY <= 0) return shifted;

    shifted = shifted.map((update) =>
      update.position ? { ...update, position: { x: update.position.x, y: update.position.y + deltaY } } : update,
    );
  }

  return shifted;
}

export function arrangeCanvasNodes(layout: CanvasArrangeMode): { arranged: number; layout: CanvasArrangeMode } {
  const nodes = canvasState.getLayoutForPersistence().nodes;
  const excludedIds =
    layout === 'grid' ? collectGridArrangeExcludedNodeIds(nodes) : collectArrangeExcludedNodeIds(nodes);
  const movableNodes = nodes.filter((node) => !excludedIds.has(node.id));
  const oldPositions = nodes.map((node) => ({ id: node.id, position: { ...node.position } }));
  const oldSizes = nodes.map((node) => ({ id: node.id, size: { ...node.size } }));
  const newSizesById = new Map<string, CanvasNodeUpdate['size']>();
  const oldSizesById = new Map(oldSizes.map((entry) => [entry.id, entry.size]));
  const updates: CanvasNodeUpdate[] = [];

  if (layout === 'column' || layout === 'flow') {
    const gap = 24;
    let x = 40;
    let y = 80;
    for (const node of movableNodes) {
      updates.push({ id: node.id, position: { x, y } });
      if (layout === 'column') {
        y += node.size.height + gap;
      } else {
        x += node.size.width + gap;
      }
    }
  } else {
    const result = computeAutoArrange(movableNodes, canvasState.getEdges(), 'grid');
    for (const [id, position] of result.nodePositions.entries()) {
      updates.push({ id, position });
    }
    for (const [groupId, bounds] of result.groupBounds.entries()) {
      updates.push({
        id: groupId,
        position: { x: bounds.x, y: bounds.y },
        size: { width: bounds.width, height: bounds.height },
      });
    }
    const obstacles = collectGridArrangeObstacles(nodes, excludedIds);
    const shiftedUpdates = shiftGridUpdatesBelowObstacles(updates, nodes, obstacles);
    updates.splice(0, updates.length, ...shiftedUpdates);
  }

  canvasState.withSuppressedRecording(() => {
    canvasState.applyUpdates(updates, layout === 'grid' ? { skipGroupChildTranslation: true } : {});
  });

  const newPositions = nodes.map((node) => {
    const updated = canvasState.getNode(node.id);
    return { id: node.id, position: updated ? { ...updated.position } : { ...node.position } };
  });
  for (const node of nodes) {
    const updated = canvasState.getNode(node.id);
    const size = updated ? { ...updated.size } : { ...node.size };
    newSizesById.set(node.id, size);
  }
  mutationHistory.record({
    description: `Auto-arranged ${movableNodes.length} nodes (${layout})`,
    operationType: 'arrange',
    forward: () =>
      canvasState.withSuppressedRecording(() => {
        canvasState.applyUpdates(
          newPositions.map((position) => {
            const size = newSizesById.get(position.id);
            return {
              id: position.id,
              position: position.position,
              ...(size ? { size } : {}),
            };
          }),
          layout === 'grid' ? { skipGroupChildTranslation: true } : {},
        );
      }),
    inverse: () =>
      canvasState.withSuppressedRecording(() => {
        canvasState.applyUpdates(
          oldPositions.map((position) => {
            const size = oldSizesById.get(position.id);
            return {
              id: position.id,
              position: position.position,
              ...(size ? { size } : {}),
            };
          }),
          layout === 'grid' ? { skipGroupChildTranslation: true } : {},
        );
      }),
  });

  return { arranged: movableNodes.length, layout };
}

export function applyCanvasNodeUpdates(updates: CanvasNodeUpdate[]): { applied: number; skipped: number } {
  const safe = updates.filter((update) => validateCanvasNodePatch(update) === null);
  return canvasState.applyUpdates(safe);
}

export function setCanvasContextPins(
  nodeIds: string[],
  mode: CanvasPinMode = 'set',
): { count: number; nodeIds: string[] } {
  const normalizePins = (ids: string[]): string[] =>
    ids.filter((id, index) => ids.indexOf(id) === index).slice(0, MAX_CONTEXT_PINS);
  const normalizedNodeIds = normalizePins(nodeIds);
  if (mode === 'set') {
    canvasState.setContextPins(normalizedNodeIds);
  } else if (mode === 'add') {
    const current = Array.from(canvasState.contextPinnedNodeIds);
    canvasState.setContextPins(normalizePins([...current, ...normalizedNodeIds]));
  } else {
    const current = Array.from(canvasState.contextPinnedNodeIds);
    canvasState.setContextPins(current.filter((id) => !normalizedNodeIds.includes(id)));
  }

  return {
    count: canvasState.contextPinnedNodeIds.size,
    nodeIds: Array.from(canvasState.contextPinnedNodeIds),
  };
}

export function listCanvasSnapshots(options?: Parameters<typeof canvasState.listSnapshots>[0]): CanvasSnapshot[] {
  return canvasState.listSnapshots(options);
}

export function saveCanvasSnapshot(name: string): CanvasSnapshot | null {
  return canvasState.saveSnapshot(name);
}

export async function restoreCanvasSnapshot(idOrName: string): Promise<{ ok: boolean }> {
  const ok = canvasState.restoreSnapshot(idOrName);
  if (ok) {
    primeCanvasRuntimeBackends({ forceRehydrateExtApps: true });
    void syncCanvasRuntimeBackends({ forceRehydrateExtApps: true, alreadyPrimed: true }).finally(() => {
      emitCanvasLayoutUpdate();
    });
    canvasState.flushToDisk();
  }
  return { ok };
}

export function deleteCanvasSnapshot(id: string): { ok: boolean } {
  return { ok: canvasState.deleteSnapshot(id) };
}

export function gcCanvasSnapshots(
  options?: Parameters<typeof canvasState.gcSnapshots>[0],
): ReturnType<typeof canvasState.gcSnapshots> {
  return canvasState.gcSnapshots(options);
}

export function addCanvasEdge(input: {
  from?: string;
  to?: string;
  fromSearch?: string;
  toSearch?: string;
  type: CanvasEdge['type'];
  label?: string;
  style?: CanvasEdge['style'];
  animated?: boolean;
}): CanvasEdge {
  const fromResult = resolveCanvasNode({
    ...(typeof input.from === 'string' ? { id: input.from } : {}),
    ...(typeof input.fromSearch === 'string' ? { search: input.fromSearch } : {}),
  });
  if (!fromResult.ok) {
    throw new Error(fromResult.error);
  }
  const toResult = resolveCanvasNode({
    ...(typeof input.to === 'string' ? { id: input.to } : {}),
    ...(typeof input.toSearch === 'string' ? { search: input.toSearch } : {}),
  });
  if (!toResult.ok) {
    throw new Error(toResult.error);
  }

  const id = `edge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const edge: CanvasEdge = {
    id,
    from: fromResult.node.id,
    to: toResult.node.id,
    type: input.type,
    ...(input.label ? { label: input.label } : {}),
    ...(input.style ? { style: input.style } : {}),
    ...(input.animated !== undefined ? { animated: input.animated } : {}),
  };
  const added = canvasState.addEdge(edge);
  if (!added) {
    throw new Error('Duplicate or self-edge.');
  }
  return edge;
}

export function removeCanvasEdge(id: string): { removed: boolean } {
  return { removed: canvasState.removeEdge(id) };
}

export function createCanvasGroup(input: CanvasCreateGroupInput): { id: string; node: CanvasNodeState } {
  let x = input.x;
  let y = input.y;
  let width = input.width ?? 600;
  let height = input.height ?? 400;
  const explicitFrame =
    input.x !== undefined || input.y !== undefined || input.width !== undefined || input.height !== undefined;

  const childIds = input.childIds ?? [];
  if (childIds.length > 0 && x === undefined && y === undefined) {
    const childRects = childIds
      .map((cid) => canvasState.getNode(cid))
      .filter((node): node is CanvasNodeState => node !== undefined);
    const bounds = computeGroupBounds(childRects);
    if (bounds) {
      x = bounds.x;
      y = bounds.y;
      width = bounds.width;
      height = bounds.height;
    }
  }

  const position =
    x !== undefined && y !== undefined
      ? { x, y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);

  const id = `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const data: Record<string, unknown> = {
    title: input.title ?? 'Group',
    children: [],
    frameMode: explicitFrame ? 'manual' : 'fit',
    ...(input.color ? { color: input.color } : {}),
  };

  canvasState.addNode({
    id,
    type: 'group',
    position,
    size: { width, height },
    zIndex: 0,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data,
  });

  if (childIds.length > 0) {
    canvasState.groupNodes(id, childIds, {
      preservePositions: input.childLayout === undefined,
      ...(input.childLayout ? { layout: input.childLayout } : {}),
      keepGroupFrame: explicitFrame,
    });
  }

  const node = canvasState.getNode(id);
  if (!node) {
    throw new Error(`Group "${id}" was not created.`);
  }
  return { id, node };
}

export function groupCanvasNodes(
  groupId: string,
  childIds: string[],
  options: { childLayout?: CanvasArrangeMode } = {},
): { ok: boolean } {
  return {
    ok: canvasState.groupNodes(groupId, childIds, {
      // Preserve existing child positions unless an explicit layout is asked
      // for — matching createCanvasGroup and the batch group.add path. Without
      // this, grouping silently auto-packs the nodes into a grid.
      preservePositions: options.childLayout === undefined,
      ...(options.childLayout ? { layout: options.childLayout } : {}),
    }),
  };
}

export function ungroupCanvasNodes(groupId: string): { ok: boolean } {
  return { ok: canvasState.ungroupNodes(groupId) };
}

export function clearCanvas(): { ok: boolean } {
  unwatchAll();
  canvasState.clear();
  return { ok: true };
}

export function createCanvasJsonRenderNode(input: JsonRenderNodeInput): {
  id: string;
  url: string;
  spec: JsonRenderSpec;
  node: CanvasNodeState;
} {
  const spec = normalizeAndValidateJsonRenderSpec(input.spec);
  const width = input.width ?? JSON_RENDER_NODE_SIZE.width;
  const height = input.height ?? JSON_RENDER_NODE_SIZE.height;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node: CanvasNodeState = {
    id,
    type: 'json-render',
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: createJsonRenderNodeData(id, input.title?.trim() || inferJsonRenderNodeTitle(spec), spec, {
      viewerType: 'json-render',
      ...(input.strictSize ? { strictSize: true } : {}),
    }),
  };

  canvasState.addJsonRenderNode(node);
  return { id, url: String(node.data.url), spec, node };
}

/**
 * Create an empty streaming json-render node. Unlike createCanvasJsonRenderNode
 * this does NOT validate a complete spec — the node starts blank and is filled
 * in by appendCanvasJsonRenderStream as SpecStream patches arrive.
 */
export function createCanvasStreamingJsonRenderNode(input: {
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  strictSize?: boolean;
}): { id: string; url: string; spec: JsonRenderSpec; node: CanvasNodeState } {
  const spec = emptyStreamingSpec();
  const width = input.width ?? JSON_RENDER_NODE_SIZE.width;
  const height = input.height ?? JSON_RENDER_NODE_SIZE.height;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node: CanvasNodeState = {
    id,
    type: 'json-render',
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: createJsonRenderNodeData(id, input.title?.trim() || 'Streaming', spec, {
      viewerType: 'json-render',
      streamStatus: 'open',
      specVersion: 0,
      ...(input.strictSize ? { strictSize: true } : {}),
    }),
  };

  canvasState.addJsonRenderNode(node);
  return { id, url: String(node.data.url), spec, node };
}

/**
 * Apply a batch of SpecStream patches to an existing json-render node, bumping
 * its specVersion so the browser reloads the viewer with the accumulated spec.
 */
export function appendCanvasJsonRenderStream(
  nodeId: string,
  patches: unknown[],
  done: boolean,
):
  | {
      ok: true;
      applied: number;
      skipped: number;
      specVersion: number;
      elementCount: number;
      streamStatus: 'open' | 'closed';
    }
  | { ok: false; error: string } {
  const node = canvasState.getNode(nodeId);
  if (!node) return { ok: false, error: `Node "${nodeId}" not found.` };
  if (node.type !== 'json-render') return { ok: false, error: `Node "${nodeId}" is not a json-render node.` };

  const currentSpec = (node.data.spec as JsonRenderSpec | undefined) ?? emptyStreamingSpec();
  const { spec, applied, skipped } = applyJsonRenderStreamPatches(currentSpec, patches);
  const prevVersion = typeof node.data.specVersion === 'number' ? node.data.specVersion : 0;
  const specVersion = prevVersion + 1;
  const streamStatus: 'open' | 'closed' = done ? 'closed' : 'open';

  canvasState.updateNode(nodeId, {
    data: { ...node.data, spec, specVersion, streamStatus },
  });

  const elementCount = spec.elements && typeof spec.elements === 'object' ? Object.keys(spec.elements).length : 0;
  return { ok: true, applied, skipped, specVersion, elementCount, streamStatus };
}

export function createCanvasGraphNode(input: GraphNodeInput): {
  id: string;
  url: string;
  spec: JsonRenderSpec;
  node: CanvasNodeState;
} {
  const title = input.title?.trim() || 'Graph';
  const spec = buildGraphSpec(input);
  const width = input.width ?? GRAPH_NODE_SIZE.width;
  const height = input.heightPx ?? GRAPH_NODE_SIZE.height;
  const position =
    input.x !== undefined && input.y !== undefined
      ? { x: input.x, y: input.y }
      : findOpenCanvasPosition(canvasState.getLayout().nodes, width, height);
  const id = `graph-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const node: CanvasNodeState = {
    id,
    type: 'graph',
    position,
    size: { width, height },
    zIndex: 1,
    collapsed: false,
    pinned: false,
    dockPosition: null,
    data: createJsonRenderNodeData(id, title, spec, {
      viewerType: 'graph',
      graphConfig: buildGraphConfig(input),
      ...(input.strictSize ? { strictSize: true } : {}),
    }),
  };

  canvasState.addGraphNode(node);
  return { id, url: String(node.data.url), spec, node };
}

export function fitCanvasView(options: CanvasFitViewOptions = {}): CanvasFitViewResult {
  const width = positiveNumber(options.width, 1440);
  const height = positiveNumber(options.height, 900);
  const padding = positiveNumber(options.padding, 60);
  const maxScale = positiveNumber(options.maxScale, 1);
  const nodeIdFilter = options.nodeIds && options.nodeIds.length > 0 ? new Set(options.nodeIds) : null;
  const targetNodes = canvasState.getLayout().nodes.filter((node) => !nodeIdFilter || nodeIdFilter.has(node.id));

  if (targetNodes.length === 0) {
    const viewport = canvasState.viewport;
    return { ok: true, viewport, nodeCount: 0, bounds: null };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const node of targetNodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + node.size.width);
    maxY = Math.max(maxY, node.position.y + node.size.height);
  }

  const bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  const worldWidth = Math.max(1, bounds.width + padding * 2);
  const worldHeight = Math.max(1, bounds.height + padding * 2);
  const scale = Math.min(maxScale, width / worldWidth, height / worldHeight);
  const centerX = minX + bounds.width / 2;
  const centerY = minY + bounds.height / 2;
  const viewport = {
    x: width / 2 - centerX * scale,
    y: height / 2 - centerY * scale,
    scale,
  };

  canvasState.setViewport(viewport);
  return { ok: true, viewport: canvasState.viewport, nodeCount: targetNodes.length, bounds };
}
