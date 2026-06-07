#!/usr/bin/env bun
/**
 * Agent-native CLI for pmx-canvas.
 *
 * Designed for non-interactive use by coding agents:
 * - Every input is a flag (no interactive prompts)
 * - JSON output by default
 * - Progressive --help discovery
 * - Fail fast with actionable errors
 * - Idempotent operations where possible
 * - --yes for destructive actions, --dry-run for preview
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openUrlInExternalBrowser, wrapCanvasAutomationScript } from '../server/server.js';
import { DEFAULT_EXCALIDRAW_ELEMENTS } from '../server/diagram-presets.js';
import {
  ALL_SEMANTIC_WATCH_EVENT_TYPES,
  formatCompactWatchEvent,
  parseSemanticEventFilter,
  parseSseStream,
  SemanticWatchReducer,
} from './watch.js';

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_PORT = 4313;
const defaultConsoleLog = console.log;
const TRACE_NODE_FIELDS = ['toolName', 'category', 'status', 'duration', 'resultSummary', 'error'] as const;

interface CanvasSchemaField {
  name: string;
  type: string;
  required: boolean;
  description: string;
  aliases?: string[];
}

interface CanvasSchemaType {
  type: string;
  kind: 'node' | 'virtual-node';
  description: string;
  endpoint: string;
  fields: CanvasSchemaField[];
  example: Record<string, unknown>;
  notes?: string[];
}

interface JsonRenderComponentSchema {
  type: string;
  description: string;
  slots: string[];
  example: unknown;
  props: Array<{
    name: string;
    type: string;
    required: boolean;
    nullable: boolean;
  }>;
}

interface CanvasSchemaResponse {
  ok: true;
  source: 'running-server';
  version: string | null;
  nodeTypes: CanvasSchemaType[];
  jsonRender: {
    rootShape: Record<string, string>;
    components: JsonRenderComponentSchema[];
  };
  graph: {
    graphTypes: Array<
      'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'stacked-bar' | 'composed'
    >;
  };
  htmlPrimitives?: Array<{
    kind: string;
    title: string;
    description: string;
    useWhen: string;
    defaultSize: { width: number; height: number };
    dataShape: string;
    example: Record<string, unknown>;
  }>;
  mcp: {
    tools: string[];
    resources: string[];
  };
}

function getBaseUrl(): string {
  const envUrl = process.env.PMX_CANVAS_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const port = process.env.PMX_CANVAS_PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

function die(message: string, hint?: string): never {
  const out: Record<string, string> = { error: message };
  if (hint) out.hint = hint;
  console.error(JSON.stringify(out));
  process.exit(1);
}

function output(data: unknown): void {
  const text = JSON.stringify(data, null, 2);
  if (console.log !== defaultConsoleLog) {
    console.log(text);
    return;
  }
  process.stdout.write(`${text}\n`);
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options?: { allowErrorJson?: boolean },
): Promise<unknown> {
  const base = getBaseUrl();
  const url = `${base}${path}`;
  const opts: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body) opts.body = JSON.stringify(body);

  let res: Response;
  try {
    res = await fetch(url, opts);
  } catch (error) {
    die(
      `Cannot connect to pmx-canvas at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      `Start the server first: pmx-canvas --no-open`,
    );
  }

  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!res.ok) die(`HTTP ${res.status}: ${text}`);
    console.debug('[cli] response was not JSON', error);
    return text;
  }

  if (!res.ok) {
    if (options?.allowErrorJson) return json;
    const err = json as Record<string, unknown>;
    die(
      err.error ? String(err.error) : `HTTP ${res.status}`,
      typeof err.hint === 'string' ? err.hint : undefined,
    );
  }
  return json;
}

// ── Flag parsing ─────────────────────────────────────────────

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  // Boolean-only flags (never take a value argument)
  const BOOL_FLAGS = new Set([
    'help', 'h', 'ids', 'stdin', 'yes', 'list', 'clear', 'set', 'animated', 'dry-run', 'all',
    'no-open-in-canvas', 'lock-arrange', 'unlock-arrange', 'json', 'compact',
    'verbose', 'include-logs', 'no-pan', 'schema', 'example', 'examples', 'strict-size', 'scroll-overflow',
    'report', 'canvas', 'hooks', 'tools', 'session-messaging', 'permissions', 'files', 'ui-prompts',
  ]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else {
        const key = arg.slice(2);
        // If not a boolean flag and next arg exists and isn't a flag, consume it as value
        if (!BOOL_FLAGS.has(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
          flags[key] = args[++i];
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      if (!BOOL_FLAGS.has(key) && i + 1 < args.length && !args[i + 1].startsWith('-')) {
        flags[key] = args[++i];
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function requireFlag(flags: Record<string, string | true>, name: string, hint: string): string {
  const val = flags[name];
  if (!val || val === true) {
    die(`Missing required flag: --${name}`, hint);
  }
  return val;
}

function getStringFlag(
  flags: Record<string, string | true>,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = flags[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function optionalNumberFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined {
  const val = flags[name];
  if (!val || val === true) return undefined;
  const parsed = Number(val);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    die(`Invalid value for --${name}: ${String(val)}`, hint);
  }
  return Math.floor(parsed);
}

function optionalFiniteFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined {
  const val = flags[name];
  if (!val || val === true) return undefined;
  const parsed = Number(val);
  if (!Number.isFinite(parsed)) {
    die(`Invalid value for --${name}: ${String(val)}`, hint);
  }
  return parsed;
}

function optionalPositiveFiniteFlag(flags: Record<string, string | true>, name: string, hint: string): number | undefined {
  const parsed = optionalFiniteFlag(flags, name, hint);
  if (parsed === undefined) return undefined;
  if (parsed <= 0) {
    die(`Invalid value for --${name}: ${String(flags[name])}`, hint);
  }
  return parsed;
}

function optionalPositiveFiniteFlagWithAliases(
  flags: Record<string, string | true>,
  hint: string,
  ...names: string[]
): number | undefined {
  for (const name of names) {
    const parsed = optionalPositiveFiniteFlag(flags, name, hint);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function optionalBooleanFlag(flags: Record<string, string | true>, name: string, hint: string): boolean | undefined {
  const val = flags[name];
  if (val === undefined) return undefined;
  if (val === true || val === 'true') return true;
  if (val === 'false') return false;
  die(`Invalid value for --${name}: ${String(val)}`, hint);
}

function applyStrictSizeFlags(body: Record<string, unknown>, flags: Record<string, string | true>): void {
  if (flags['strict-size'] || flags['scroll-overflow']) body.strictSize = true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStringListFlag(
  flags: Record<string, string | true>,
  name: string,
  hint: string,
  ...aliases: string[]
): string[] | undefined {
  const raw = getStringFlag(flags, name, ...aliases);
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) {
    die(`Invalid value for --${name}: expected at least one string.`, hint);
  }

  if (trimmed.startsWith('[')) {
    const parsed = parseJsonValue(trimmed, `value for --${name}`, hint);
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
      die(`Invalid value for --${name}: expected a JSON array of non-empty strings.`, hint);
    }
    return parsed.map((item) => item.trim());
  }

  const values = trimmed
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (values.length === 0) {
    die(`Invalid value for --${name}: expected a comma-separated list of keys.`, hint);
  }
  return values;
}

function truncateText(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength <= 1) return normalized.slice(0, maxLength);
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function summarizeGraphConfig(config: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === 'data' && Array.isArray(value)) {
      summary.dataPoints = value.length;
      const first = value[0];
      if (isRecord(first)) summary.dataKeys = Object.keys(first);
      continue;
    }
    summary[key] = value;
  }
  return summary;
}

function summarizeNodeResult(node: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(node.data) ? node.data : {};
  const hiddenDataKeys = new Set(['content', 'fileContent', 'html', 'rendered', 'spec', 'toolResult']);
  const dataKeys = Object.keys(data)
    .filter((key) => !hiddenDataKeys.has(key))
    .sort();

  return {
    ...(node.ok !== undefined ? { ok: node.ok } : {}),
    id: node.id ?? null,
    type: node.type ?? null,
    ...(typeof node.kind === 'string' ? { kind: node.kind } : {}),
    title: node.title ?? null,
    ...(typeof node.content === 'string' ? { contentPreview: truncateText(node.content) } : {}),
    ...(node.position !== undefined ? { position: node.position } : {}),
    ...(node.size !== undefined ? { size: node.size } : {}),
    ...(node.collapsed !== undefined ? { collapsed: node.collapsed } : {}),
    ...(node.pinned !== undefined ? { pinned: node.pinned } : {}),
    ...(node.dockPosition !== undefined ? { dockPosition: node.dockPosition } : {}),
    ...(node.path !== undefined ? { path: node.path } : {}),
    ...(node.url !== undefined ? { url: node.url } : {}),
    ...(node.provenance !== undefined ? { provenance: node.provenance } : {}),
    ...(typeof data.mode === 'string' ? { mode: data.mode } : {}),
    ...(typeof data.viewerType === 'string' ? { viewerType: data.viewerType } : {}),
    ...(typeof data.serverName === 'string' ? { serverName: data.serverName } : {}),
    ...(typeof data.toolName === 'string' ? { toolName: data.toolName } : {}),
    ...(typeof data.appSessionId === 'string' ? { appSessionId: data.appSessionId } : {}),
    ...(typeof data.sessionStatus === 'string' ? { sessionStatus: data.sessionStatus } : {}),
    ...(typeof data.hostMode === 'string' ? { hostMode: data.hostMode } : {}),
    ...(typeof data.resourceUri === 'string' ? { resourceUri: data.resourceUri } : {}),
    ...(isRecord(data.graphConfig) ? { graph: summarizeGraphConfig(data.graphConfig) } : {}),
    ...(dataKeys.length > 0 ? { dataKeys } : {}),
  };
}

function collectFlagValues(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const prefix = `--${name}=`;
    if (arg.startsWith(prefix)) {
      const value = arg.slice(prefix.length).trim();
      if (value) values.push(value);
      continue;
    }
    if (arg === `--${name}` && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      values.push(args[i + 1] as string);
      i++;
    }
  }
  return values;
}

function collectRequestedFields(
  args: string[],
  flags: Record<string, string | true>,
): string[] {
  const requested = [
    ...collectFlagValues(args, 'field'),
    ...((typeof flags.fields === 'string')
      ? flags.fields.split(',').map((value) => value.trim()).filter(Boolean)
      : []),
  ];
  return Array.from(new Set(requested));
}

function resolvePathValue(source: unknown, path: string[]): unknown {
  let current = source;
  for (const segment of path) {
    if (!isRecord(current) && !Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function resolveNodeFieldValue(node: Record<string, unknown>, field: string): unknown {
  if (field.includes('.')) {
    const direct = resolvePathValue(node, field.split('.'));
    if (direct !== undefined) return direct;
  }
  if (field in node) return node[field];

  const data = isRecord(node.data) ? node.data : null;
  if (!data) return undefined;
  if (field in data) return data[field];
  return field.includes('.') ? resolvePathValue(data, field.split('.')) : undefined;
}

function listAvailableNodeFields(node: Record<string, unknown>): string[] {
  const topLevel = Object.keys(node).filter((key) => key !== 'data');
  const data = isRecord(node.data) ? Object.keys(node.data).flatMap((key) => [key, `data.${key}`]) : [];
  return Array.from(new Set([...topLevel, ...data])).sort();
}

function summarizeHistoryResult(result: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(result.entries)
    ? result.entries.filter(isRecord)
    : [];
  const countsByOperation: Record<string, number> = {};
  let currentIndex = 0;

  entries.forEach((entry, index) => {
    const op = typeof entry.operationType === 'string' ? entry.operationType : 'unknown';
    countsByOperation[op] = (countsByOperation[op] ?? 0) + 1;
    if (entry.isCurrent === true) currentIndex = index + 1;
  });

  const recent = entries.slice(-10).map((entry, index) => ({
    index: entries.length - Math.min(entries.length, 10) + index + 1,
    operationType: entry.operationType,
    description: entry.description,
    status: entry.isCurrent === true ? 'current' : entry.isUndone === true ? 'undone' : 'applied',
  }));

  return {
    totalMutations: entries.length,
    currentIndex,
    canUndo: result.canUndo === true,
    canRedo: result.canRedo === true,
    countsByOperation,
    recent,
  };
}

function compactHistoryResult(result: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(result.entries)
    ? result.entries.filter(isRecord)
    : [];
  return {
    totalMutations: entries.length,
    canUndo: result.canUndo === true,
    canRedo: result.canRedo === true,
    entries: entries.slice(-20).map((entry, index) => ({
      index: entries.length - Math.min(entries.length, 20) + index + 1,
      operationType: entry.operationType,
      description: entry.description,
      status: entry.isCurrent === true ? 'current' : entry.isUndone === true ? 'undone' : 'applied',
    })),
  };
}

function parseRecordArrayJson(raw: string, hint: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    die(
      `Invalid JSON dataset: ${error instanceof Error ? error.message : String(error)}`,
      hint,
    );
  }

  if (!Array.isArray(parsed) || parsed.some((item) => !isRecord(item))) {
    die('Graph data must be a JSON array of objects.', hint);
  }

  return parsed;
}

function parseJsonValue(raw: string, label: string, hint: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    die(
      `Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`,
      hint,
    );
  }
}

function parseJsonRecord(raw: string, label: string, hint: string): Record<string, unknown> {
  const parsed = parseJsonValue(raw, label, hint);
  if (!isRecord(parsed)) {
    die(`${label} must be a JSON object.`, hint);
  }
  return parsed;
}

async function readTextInput(
  flags: Record<string, string | true>,
  options: {
    fileFlags?: string[];
    valueFlags?: string[];
    allowStdin?: boolean;
    label: string;
    hint: string;
    requiredMessage: string;
  },
): Promise<string> {
  for (const name of options.fileFlags ?? []) {
    const path = getStringFlag(flags, name);
    if (!path) continue;
    try {
      return readFileSync(path, 'utf-8');
    } catch (error) {
      die(
        `Unable to read --${name}: ${error instanceof Error ? error.message : String(error)}`,
        options.hint,
      );
    }
  }

  for (const name of options.valueFlags ?? []) {
    const value = getStringFlag(flags, name);
    if (value !== undefined) return value;
  }

  if (options.allowStdin && flags.stdin) {
    return await readStdin();
  }

  die(options.requiredMessage, options.hint);
}

async function readOptionalTextInput(
  flags: Record<string, string | true>,
  options: {
    fileFlags?: string[];
    valueFlags?: string[];
    allowStdin?: boolean;
    label: string;
    hint: string;
  },
): Promise<string | undefined> {
  for (const name of options.fileFlags ?? []) {
    const path = getStringFlag(flags, name);
    if (!path) continue;
    try {
      return readFileSync(path, 'utf-8');
    } catch (error) {
      die(
        `Unable to read --${name}: ${error instanceof Error ? error.message : String(error)}`,
        options.hint,
      );
    }
  }

  for (const name of options.valueFlags ?? []) {
    const value = getStringFlag(flags, name);
    if (value !== undefined) return value;
  }

  if (options.allowStdin && flags.stdin) {
    return await readStdin();
  }

  return undefined;
}

function applyCommonGeometryFlags(
  body: Record<string, unknown>,
  flags: Record<string, string | true>,
  hints: { x: string; y: string; width: string; height: string },
): void {
  const x = optionalFiniteFlag(flags, 'x', hints.x);
  const y = optionalFiniteFlag(flags, 'y', hints.y);
  const width = optionalPositiveFiniteFlag(flags, 'width', hints.width);
  const height = optionalPositiveFiniteFlag(flags, 'height', hints.height);
  if (x !== undefined) body.x = x;
  if (y !== undefined) body.y = y;
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;
}

async function applyStructuredNodeUpdateFlags(
  body: Record<string, unknown>,
  flags: Record<string, string | true>,
): Promise<void> {
  const specRaw = await readOptionalTextInput(flags, {
    fileFlags: ['spec-file'],
    valueFlags: ['spec-json'],
    allowStdin: false,
    label: 'JSON spec',
    hint: 'Use: pmx-canvas node update <node-id> --spec-file ./new-spec.json',
  });
  if (specRaw !== undefined) {
    body.spec = parseJsonValue(specRaw, 'JSON spec', 'Use: pmx-canvas node update <node-id> --spec-file ./new-spec.json');
  }

  const graphPatch = await buildGraphRequestBody(flags, { requireData: false, allowStdin: false });
  for (const [key, value] of Object.entries(graphPatch)) {
    body[key === 'height' ? 'chartHeight' : key] = value;
  }
}

async function buildJsonRenderRequestBody(
  flags: Record<string, string | true>,
): Promise<Record<string, unknown>> {
  const hint =
    'Use: pmx-canvas node add --type json-render --spec-file ./dashboard.json --title "Ops Dashboard"';
  const title = typeof flags.title === 'string' ? flags.title.trim() : '';

  const rawSpec = await readTextInput(flags, {
    fileFlags: ['spec-file'],
    valueFlags: ['spec-json'],
    allowStdin: true,
    label: 'JSON spec',
    hint,
    requiredMessage: 'json-render nodes require --spec-file, --spec-json, or --stdin.',
  });

  const spec = parseJsonValue(rawSpec, 'JSON spec', hint);
  const body: Record<string, unknown> = { ...(title ? { title } : {}), spec };
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 840',
    height: 'Use a positive number, e.g. --height 620',
  });
  applyStrictSizeFlags(body, flags);
  return body;
}

async function buildHtmlPrimitiveRequestBody(
  flags: Record<string, string | true>,
): Promise<Record<string, unknown>> {
  const hint = 'Use: pmx-canvas html primitive add --kind choice-grid --data-file ./primitive.json --title "Options"';
  const kind = getStringFlag(flags, 'kind', 'primitive');
  if (!kind) die('HTML primitives require --kind.', hint);
  const body: Record<string, unknown> = { type: 'html', primitive: kind };
  if (typeof flags.title === 'string') body.title = flags.title;
  const rawData = await readOptionalTextInput(flags, {
    fileFlags: ['data-file'],
    valueFlags: ['data-json', 'data'],
    allowStdin: true,
    label: 'HTML primitive data',
    hint,
  });
  if (rawData !== undefined) {
    body.data = parseJsonRecord(rawData, 'HTML primitive data', hint);
  }
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 980',
    height: 'Use a positive number, e.g. --height 720',
  });
  applyStrictSizeFlags(body, flags);
  return body;
}

async function buildGraphRequestBody(
  flags: Record<string, string | true>,
  options: { requireData?: boolean; allowStdin?: boolean } = {},
): Promise<Record<string, unknown>> {
  const requireData = options.requireData !== false;
  const allowStdin = options.allowStdin !== false;
  const hint =
    'Use: pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value';

  const body: Record<string, unknown> = {
    ...(requireData ? { graphType: getStringFlag(flags, 'graph-type', 'graphType') ?? 'line' } : {}),
  };
  const rawData = await readOptionalTextInput(flags, {
    fileFlags: ['data-file'],
    valueFlags: ['data-json', 'data'],
    allowStdin,
    label: 'graph JSON dataset',
    hint,
  });
  if (rawData !== undefined) {
    body.data = parseRecordArrayJson(rawData, hint);
  } else if (requireData) {
    die('Graph nodes require --data-file, --data-json, --data, or --stdin JSON data.', hint);
  }
  const graphType = getStringFlag(flags, 'graph-type', 'graphType');
  if (graphType) body.graphType = graphType;
  if (typeof flags.title === 'string') body.title = flags.title;
  const xKey = getStringFlag(flags, 'x-key', 'xKey');
  const yKey = getStringFlag(flags, 'y-key', 'yKey');
  const zKey = getStringFlag(flags, 'z-key', 'zKey');
  const nameKey = getStringFlag(flags, 'name-key', 'nameKey');
  const valueKey = getStringFlag(flags, 'value-key', 'valueKey');
  const axisKey = getStringFlag(flags, 'axis-key', 'axisKey');
  if (xKey) body.xKey = xKey;
  if (yKey) body.yKey = yKey;
  if (zKey) body.zKey = zKey;
  if (nameKey) body.nameKey = nameKey;
  if (valueKey) body.valueKey = valueKey;
  if (axisKey) body.axisKey = axisKey;
  const metrics = parseStringListFlag(flags, 'metrics', 'Use a comma-separated list, e.g. --metrics north,south');
  const series = parseStringListFlag(flags, 'series', 'Use a comma-separated list, e.g. --series north,south');
  if (metrics) body.metrics = metrics;
  if (series) body.series = series;
  const barKey = getStringFlag(flags, 'bar-key', 'barKey');
  const lineKey = getStringFlag(flags, 'line-key', 'lineKey');
  if (barKey) body.barKey = barKey;
  if (lineKey) body.lineKey = lineKey;
  if (flags.aggregate === 'sum' || flags.aggregate === 'count' || flags.aggregate === 'avg') {
    body.aggregate = flags.aggregate;
  }
  const color = getStringFlag(flags, 'color');
  const barColor = getStringFlag(flags, 'bar-color', 'barColor');
  const lineColor = getStringFlag(flags, 'line-color', 'lineColor');
  if (color) body.color = color;
  if (barColor) body.barColor = barColor;
  if (lineColor) body.lineColor = lineColor;
  const showLegend = optionalBooleanFlag(flags, 'show-legend', 'Use --show-legend true or --show-legend false');
  const showLabels = optionalBooleanFlag(flags, 'show-labels', 'Use --show-labels true or --show-labels false');
  if (showLegend !== undefined) body.showLegend = showLegend;
  if (showLabels !== undefined) body.showLabels = showLabels;

  const chartHeight = optionalPositiveFiniteFlag(flags, 'chart-height', 'Use a positive number, e.g. --chart-height 300');
  const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 500');
  const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 300');
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 760');
  const nodeHeight = optionalPositiveFiniteFlagWithAliases(
    flags,
    'Use a positive number, e.g. --node-height 520',
    'node-height',
    'nodeHeight',
    'height',
  );
  if (chartHeight !== undefined) body.height = chartHeight;
  if (x !== undefined) body.x = x;
  if (y !== undefined) body.y = y;
  if (width !== undefined) body.width = width;
  if (nodeHeight !== undefined) body.nodeHeight = nodeHeight;
  applyStrictSizeFlags(body, flags);
  return body;
}

async function buildWebArtifactRequestBody(
  flags: Record<string, string | true>,
): Promise<Record<string, unknown>> {
  const hint = 'Use: pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx';
  const title = requireFlag(flags, 'title', hint);
  const appTsx = await readTextInput(flags, {
    fileFlags: ['app-file'],
    valueFlags: ['app-tsx'],
    allowStdin: true,
    label: 'App.tsx',
    hint,
    requiredMessage: 'web-artifact build requires --app-file, --app-tsx, or --stdin.',
  });

  const body: Record<string, unknown> = { title, appTsx };

  const indexCssFile = getStringFlag(flags, 'index-css-file');
  const indexCss = getStringFlag(flags, 'index-css');
  if (indexCssFile) {
    body.indexCss = readFileSync(indexCssFile, 'utf-8');
  } else if (indexCss !== undefined) {
    body.indexCss = indexCss;
  }

  const mainFile = getStringFlag(flags, 'main-file');
  const mainTsx = getStringFlag(flags, 'main-tsx');
  if (mainFile) {
    body.mainTsx = readFileSync(mainFile, 'utf-8');
  } else if (mainTsx !== undefined) {
    body.mainTsx = mainTsx;
  }

  const indexHtmlFile = getStringFlag(flags, 'index-html-file');
  const indexHtml = getStringFlag(flags, 'index-html');
  if (indexHtmlFile) {
    body.indexHtml = readFileSync(indexHtmlFile, 'utf-8');
  } else if (indexHtml !== undefined) {
    body.indexHtml = indexHtml;
  }

  if (typeof flags['project-path'] === 'string') body.projectPath = flags['project-path'];
  if (typeof flags['output-path'] === 'string') body.outputPath = flags['output-path'];
  if (typeof flags['init-script-path'] === 'string') body.initScriptPath = flags['init-script-path'];
  if (typeof flags['bundle-script-path'] === 'string') body.bundleScriptPath = flags['bundle-script-path'];
  const deps = parseStringListFlag(flags, 'deps', 'Use a comma-separated list, e.g. --deps recharts,zod');
  if (deps) body.deps = deps;
  if (flags['no-open-in-canvas']) body.openInCanvas = false;
  if (flags.verbose || flags['include-logs']) body.includeLogs = true;

  const timeoutMs = optionalPositiveFiniteFlag(flags, 'timeout-ms', 'Use a positive number, e.g. --timeout-ms 600000');
  if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;

  return body;
}

async function runWebArtifactBuildCommand(flags: Record<string, string | true>): Promise<void> {
  const body = await buildWebArtifactRequestBody(flags);
  // The build (init + dependency install + bundle) runs server-side and only
  // returns a single HTTP response on completion, which can take minutes on a
  // cold workspace. With no output an agent's tool wait expires before the node
  // appears and the build looks hung. Emit a default-on heartbeat to stderr
  // while the request is in flight — stdout (output) and the JSON response body
  // stay untouched, so anything parsing stdout is unaffected.
  const startedMs = Date.now();
  process.stderr.write(
    `[web-artifact] building "${String(body.title)}" — init + install + bundle (this can take a few minutes)...\n`,
  );
  const heartbeat = setInterval(() => {
    const elapsedSeconds = Math.round((Date.now() - startedMs) / 1000);
    process.stderr.write(`[web-artifact] still building... ${elapsedSeconds}s elapsed\n`);
  }, 10_000);
  if (typeof heartbeat.unref === 'function') heartbeat.unref();
  let result: unknown;
  try {
    result = await api('POST', '/api/canvas/web-artifact', body, { allowErrorJson: true });
  } finally {
    clearInterval(heartbeat);
  }
  output(result);
  if (isRecord(result) && result.ok === false) {
    process.exit(1);
  }
}

async function loadCanvasSchema(): Promise<CanvasSchemaResponse> {
  const result = await api('GET', '/api/canvas/schema');
  return result as CanvasSchemaResponse;
}

function fieldMatches(field: { name: string; aliases?: string[] }, requested: string): boolean {
  return field.name === requested || field.aliases?.includes(requested) === true;
}

function summarizeNodeSchema(schema: CanvasSchemaType): Record<string, unknown> {
  return {
    type: schema.type,
    kind: schema.kind,
    endpoint: schema.endpoint,
    description: schema.description,
    requiredFields: schema.fields.filter((field) => field.required).map((field) => field.name),
    optionalFields: schema.fields.filter((field) => !field.required).map((field) => field.name),
    exampleKeys: Object.keys(schema.example),
  };
}

function summarizeJsonRenderComponent(component: JsonRenderComponentSchema): Record<string, unknown> {
  return {
    type: component.type,
    description: component.description,
    slots: component.slots,
    requiredProps: component.props.filter((prop) => prop.required).map((prop) => prop.name),
    optionalProps: component.props.filter((prop) => !prop.required).map((prop) => prop.name),
  };
}

function printObjectJson(value: unknown): void {
  output(value);
}

function printNodeSchemaHelp(schema: CanvasSchemaType): void {
  console.log(`\npmx-canvas node add --type ${schema.type} — ${schema.description}\n`);
  console.log(`Endpoint: ${schema.endpoint}`);
  console.log('Flags:');
  for (const field of schema.fields) {
    const aliases = field.aliases?.length
      ? ` (aliases: ${field.aliases.map((alias) => `--${alias}`).join(', ')})`
      : '';
    console.log(
      `  --${field.name}${field.required ? ' [required]' : ''} <${field.type}>  ${field.description}${aliases}`,
    );
  }
  if (schema.notes?.length) {
    console.log('\nNotes:');
    for (const note of schema.notes) {
      console.log(`  - ${note}`);
    }
  }
  console.log('\nCanonical example:');
  console.log(JSON.stringify(schema.example, null, 2));
  console.log('');
}

async function showNodeAddTypeHelp(flags: Record<string, string | true>): Promise<void> {
  const requestedType = getStringFlag(flags, 'type');
  if (!requestedType) {
    showCommandHelp('node add');
    return;
  }

  const schema = await loadCanvasSchema();
  let payload: Record<string, unknown> | CanvasSchemaType | JsonRenderComponentSchema | undefined;
  if (requestedType === 'json-render') {
    const componentName = getStringFlag(flags, 'component');
    if (componentName) {
      const component = schema.jsonRender.components.find((entry) => entry.type === componentName);
      if (!component) {
        die(`Unknown json-render component: ${componentName}`, 'Run: pmx-canvas node schema --type json-render --summary');
      }
      const requestedField = getStringFlag(flags, 'field');
      if (requestedField) {
        const prop = component.props.find((entry) => entry.name === requestedField);
        if (!prop) {
          die(`Unknown json-render prop: ${requestedField}`, `Run: pmx-canvas node schema --type json-render --component ${componentName}`);
        }
        payload = {
          command: 'node add',
          type: requestedType,
          component: componentName,
          prop,
        };
      } else {
        payload = flags.summary ? summarizeJsonRenderComponent(component) : component;
      }
    } else {
      payload = flags.summary
        ? {
            type: 'json-render',
            description: 'Native structured UI panel rendered from a validated json-render spec.',
            rootShape: schema.jsonRender.rootShape,
            components: schema.jsonRender.components.map((entry) => summarizeJsonRenderComponent(entry)),
          }
        : {
            type: 'json-render',
            rootShape: schema.jsonRender.rootShape,
            components: schema.jsonRender.components,
          };
    }
  } else if (requestedType === 'graph') {
    const graphSchema = schema.nodeTypes.find((entry) => entry.type === 'graph');
    if (!graphSchema) die('Graph schema is unavailable on the running server.');
    const requestedField = getStringFlag(flags, 'field');
    if (requestedField) {
      const field = graphSchema.fields.find((entry) => fieldMatches(entry, requestedField));
      if (!field) {
        die(`Unknown graph field: ${requestedField}`, 'Run: pmx-canvas node schema --type graph');
      }
      payload = {
        command: 'node add',
        ...field,
      };
    } else {
      payload = flags.summary ? summarizeNodeSchema(graphSchema) : graphSchema;
    }
  } else {
    const nodeType = schema.nodeTypes.find((entry) => entry.type === requestedType);
    if (!nodeType) {
      die(`Unknown node type: ${requestedType}`, 'Run: pmx-canvas node schema --summary');
    }
    const requestedField = getStringFlag(flags, 'field');
    if (requestedField) {
      const field = nodeType.fields.find((entry) => fieldMatches(entry, requestedField));
      if (!field) {
        die(`Unknown node field: ${requestedField}`, `Run: pmx-canvas node schema --type ${requestedType}`);
      }
      payload = {
        command: 'node add',
        type: requestedType,
        field,
      };
    } else {
      payload = flags.summary ? summarizeNodeSchema(nodeType) : nodeType;
    }
  }

  if (flags.json) {
    printObjectJson(payload);
    return;
  }

  if ('fields' in (payload as CanvasSchemaType)) {
    printNodeSchemaHelp(payload as CanvasSchemaType);
    return;
  }

  console.log('');
  console.log(JSON.stringify(payload, null, 2));
  console.log('');
}

function filterNodeSchemaView(
  schema: CanvasSchemaType,
  flags: Record<string, string | true>,
): CanvasSchemaType | Record<string, unknown> {
  const requestedField = getStringFlag(flags, 'field');
  if (requestedField) {
    const field = schema.fields.find((entry) => fieldMatches(entry, requestedField));
    if (!field) {
      die(`Unknown field: ${requestedField}`, `Run: pmx-canvas node schema --type ${schema.type}`);
    }
    return {
      type: schema.type,
      field,
    };
  }

  return flags.summary ? summarizeNodeSchema(schema) : schema;
}

function filterJsonRenderSchemaView(
  schema: CanvasSchemaResponse['jsonRender'],
  flags: Record<string, string | true>,
): Record<string, unknown> | JsonRenderComponentSchema {
  const componentName = getStringFlag(flags, 'component');
  if (!componentName) {
    return flags.summary
      ? {
          rootShape: schema.rootShape,
          components: schema.components.map((entry) => summarizeJsonRenderComponent(entry)),
        }
      : schema;
  }

  const component = schema.components.find((entry) => entry.type === componentName);
  if (!component) {
    die(`Unknown json-render component: ${componentName}`, 'Run: pmx-canvas node schema --type json-render --summary');
  }

  const requestedField = getStringFlag(flags, 'field');
  if (requestedField) {
    const prop = component.props.find((entry) => entry.name === requestedField);
    if (!prop) {
      die(`Unknown json-render prop: ${requestedField}`, `Run: pmx-canvas node schema --type json-render --component ${componentName}`);
    }
    return {
      component: componentName,
      prop,
    };
  }

  return flags.summary ? summarizeJsonRenderComponent(component) : component;
}

function summarizeHtmlPrimitive(primitive: NonNullable<CanvasSchemaResponse['htmlPrimitives']>[number]): Record<string, unknown> {
  return {
    kind: primitive.kind,
    title: primitive.title,
    description: primitive.description,
    useWhen: primitive.useWhen,
    defaultSize: primitive.defaultSize,
    dataShape: primitive.dataShape,
  };
}

function filterHtmlPrimitiveSchemaView(
  schema: CanvasSchemaResponse,
  flags: Record<string, string | true>,
): Record<string, unknown> {
  const primitives = schema.htmlPrimitives ?? [];
  const kind = getStringFlag(flags, 'kind', 'primitive');
  if (!kind) {
    return {
      primitives: flags.summary ? primitives.map((entry) => summarizeHtmlPrimitive(entry)) : primitives,
    };
  }
  const primitive = primitives.find((entry) => entry.kind === kind);
  if (!primitive) {
    die(`Unknown HTML primitive: ${kind}`, 'Run: pmx-canvas html primitive schema --summary');
  }
  return flags.summary ? summarizeHtmlPrimitive(primitive) : primitive;
}

// ── Commands ─────────────────────────────────────────────────

const COMMANDS: Record<string, { run: (args: string[]) => Promise<void>; help: string; examples: string[] }> = {};
const RESOURCE_COMMAND_ALIASES: Record<string, Record<string, string>> = {
  node: {
    delete: 'remove',
    rm: 'remove',
  },
  edge: {
    delete: 'remove',
    rm: 'remove',
  },
  ax: {
    // Single-subcommand AX groups: the bare verb maps to its only action so
    // `ax event` / `ax evidence` suggest the full command instead of erroring.
    event: 'event add',
    evidence: 'evidence add',
  },
};
const RESOURCE_SUBCOMMAND_HINTS: Record<string, Record<string, string>> = {
  node: {
    pin: 'Use the top-level pin command instead: pmx-canvas pin <node-id>',
  },
  ax: {
    // Multi-subcommand AX groups: point at the available actions.
    host: 'Pick an action: pmx-canvas ax host report | pmx-canvas ax host status',
    work: 'Pick an action: pmx-canvas ax work add | update | list',
    approval: 'Pick an action: pmx-canvas ax approval request | resolve | list',
    review: 'Pick an action: pmx-canvas ax review add | list',
    delivery: 'Pick an action: pmx-canvas ax delivery list | mark',
    elicitation: 'Pick an action: pmx-canvas ax elicitation request | respond | list',
    mode: 'Pick an action: pmx-canvas ax mode request | resolve | list',
    command: 'Pick an action: pmx-canvas ax command list | invoke',
    policy: 'Pick an action: pmx-canvas ax policy get | set',
  },
};

function cmd(
  name: string,
  help: string,
  examples: string[],
  run: (args: string[]) => Promise<void>,
) {
  COMMANDS[name] = { run, help, examples };
}

cmd('open', 'Open the current workbench in the browser', [
  'pmx-canvas open',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('open');

  const base = getBaseUrl();
  try {
    const response = await fetch(`${base}/health`);
    if (!response.ok) {
      die(`Cannot reach pmx-canvas health endpoint at ${base}: HTTP ${response.status}`);
    }
  } catch (error) {
    die(
      `Cannot connect to pmx-canvas at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      'Start the server first: pmx-canvas --no-open',
    );
  }

  const url = `${base}/workbench`;
  if (!openUrlInExternalBrowser(url)) {
    die(`Failed to open browser for ${url}`);
  }
  output({ ok: true, url });
});

// ── node add ─────────────────────────────────────────────────
cmd('node add', 'Add a node to the canvas', [
  'pmx-canvas node add --type markdown --title "Design Doc" --content "# Overview"',
  'pmx-canvas node add --type status --title "Build" --content "passing"',
  'pmx-canvas node add --type file --content "src/index.ts"',
  'pmx-canvas node add --type webpage --url "https://example.com/docs"',
  'pmx-canvas node add --type html --title "Widget" --content "<main>Hello</main>"',
  'pmx-canvas node add --type html --title "Showcase" --content ./report.html   (a .html path is read from disk; otherwise --content is raw HTML)',
  'pmx-canvas node add --type html --primitive choice-grid --data-file ./options.json --title "Options"',
  'pmx-canvas node add --type markdown --title "Note" --x 100 --y 200',
  'pmx-canvas node add --type json-render --title "Ops Dashboard" --spec-file ./dashboard.json',
  'pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
  'pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showNodeAddTypeHelp(flags);

  const type = (flags.type as string) || 'markdown';

  if (type === 'json-render') {
    const result = await api('POST', '/api/canvas/json-render', await buildJsonRenderRequestBody(flags));
    output(result);
    return;
  }

  if (type === 'graph') {
    const result = await api('POST', '/api/canvas/graph', await buildGraphRequestBody(flags));
    output(result);
    return;
  }

  if (type === 'web-artifact') {
    await runWebArtifactBuildCommand(flags);
    return;
  }

  if (type === 'html-primitive') {
    const result = await api('POST', '/api/canvas/node', await buildHtmlPrimitiveRequestBody(flags));
    output(result);
    return;
  }

  if (type === 'html' && getStringFlag(flags, 'primitive', 'kind')) {
    const result = await api('POST', '/api/canvas/node', await buildHtmlPrimitiveRequestBody(flags));
    output(result);
    return;
  }

  if (type === 'mcp-app') {
    die(
      'mcp-app nodes require tool-backed app metadata and cannot be created with generic node add.',
      'Use: pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx, or pmx-canvas external-app add --kind excalidraw --title "Diagram"',
    );
  }

  const body: Record<string, unknown> = { type };
  if (flags.title) body.title = flags.title;
  const webpageUrl = getStringFlag(flags, 'url');
  const imagePath = getStringFlag(flags, 'path');
  if (type === 'webpage' && webpageUrl) {
    body.url = webpageUrl;
  } else if (type === 'image' && imagePath && !flags.content) {
    body.content = imagePath;
  } else if (type === 'html') {
    const html = getStringFlag(flags, 'html') ?? getStringFlag(flags, 'content');
    if (html !== undefined) body.html = html;
    const summary = getStringFlag(flags, 'summary');
    const agentSummary = getStringFlag(flags, 'agent-summary', 'agentSummary');
    const description = getStringFlag(flags, 'description');
    if (summary !== undefined) body.summary = summary;
    if (agentSummary !== undefined) body.agentSummary = agentSummary;
    if (description !== undefined) body.description = description;
    if (optionalBooleanFlag(flags, 'presentation', 'Use --presentation true or --presentation false') === true) body.presentation = true;
    if (typeof flags['slide-title'] === 'string') body.slideTitles = [flags['slide-title']];
    if (typeof flags['embedded-node-id'] === 'string') body.embeddedNodeIds = [flags['embedded-node-id']];
  } else if (flags.content) {
    body.content = flags.content;
  }
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 500',
    height: 'Use a positive number, e.g. --height 280',
  });
  applyStrictSizeFlags(body, flags);
  if (type === 'trace') {
    for (const field of TRACE_NODE_FIELDS) {
      const value = getStringFlag(flags, field, field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`));
      if (value !== undefined) body[field] = value;
    }
  }

  // Support --stdin for piping content
  if (flags.stdin) {
    if (type === 'webpage') {
      body.url = await readStdin();
    } else if (type === 'html') {
      body.html = await readStdin();
    } else {
      body.content = await readStdin();
    }
  }

  const result = await api('POST', '/api/canvas/node', body);
  output(result);
});

cmd('json-render', 'Show json-render schema and canonical examples', [
  'pmx-canvas json-render --schema --summary',
  'pmx-canvas json-render --examples',
  'pmx-canvas json-render --example --component Table',
  'pmx-canvas json-render --schema --component Badge --field variant',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('json-render');

  const schema = await loadCanvasSchema();
  const componentName = getStringFlag(flags, 'component');
  const fieldName = getStringFlag(flags, 'field');

  if (flags.example || flags.examples) {
    if (fieldName) die('--field is only supported with --schema.', 'Use: pmx-canvas json-render --schema --component Table --field rows');
    if (componentName) {
      const component = schema.jsonRender.components.find((entry) => entry.type === componentName);
      if (!component) die(`Unknown json-render component: ${componentName}`, 'Run: pmx-canvas json-render --schema --summary');
      output({ component: component.type, example: component.example });
      return;
    }
    output({
      rootShape: schema.jsonRender.rootShape,
      examples: Object.fromEntries(schema.jsonRender.components.map((entry) => [entry.type, entry.example])),
    });
    return;
  }

  output(filterJsonRenderSchemaView(schema.jsonRender, flags));
});

cmd('html primitive add', 'Create a reusable sandboxed HTML communication primitive', [
  'pmx-canvas html primitive add --kind choice-grid --data-file ./options.json --title "Options"',
  'pmx-canvas html primitive add --kind plan-timeline --data-json \'{"milestones":[{"title":"Ship","detail":"Implement and verify","status":"next"}]}\'',
  'pmx-canvas html primitive add --kind triage-board --data-file ./tickets.json --strict-size',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('html primitive add');
  const result = await api('POST', '/api/canvas/node', await buildHtmlPrimitiveRequestBody(flags));
  output(result);
});

cmd('html primitive schema', 'Describe reusable HTML communication primitives', [
  'pmx-canvas html primitive schema --summary',
  'pmx-canvas html primitive schema --kind choice-grid',
  'pmx-canvas html primitive schema --kind triage-board --summary',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('html primitive schema');
  const schema = await loadCanvasSchema();
  output(filterHtmlPrimitiveSchemaView(schema, flags));
});

cmd('graph add', 'Add a graph node to the canvas', [
  'pmx-canvas graph add --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
  'pmx-canvas graph add --graphType composed --data \'[{"day":"Mon","visits":10,"conversion":0.4}]\' --xKey day --barKey visits --lineKey conversion',
  'pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('graph add');

  const result = await api('POST', '/api/canvas/graph', await buildGraphRequestBody(flags));
  output(result);
});

cmd('node schema', 'Describe server-supported node create schemas and canonical examples', [
  'pmx-canvas node schema',
  'pmx-canvas node schema --type webpage',
  'pmx-canvas node schema --type json-render',
  'pmx-canvas json-render --schema --summary',
  'pmx-canvas node schema --type json-render --component Table',
  'pmx-canvas node schema --type webpage --field url',
  'pmx-canvas node schema --summary',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node schema');

  const result = await loadCanvasSchema();
  if (getStringFlag(flags, 'component') && flags.type !== 'json-render') {
    die('--component is only supported with --type json-render.');
  }

  if (typeof flags.type !== 'string') {
    if (flags.summary) {
      output({
        source: result.source,
        version: result.version,
        nodeTypes: result.nodeTypes.map((entry) => summarizeNodeSchema(entry)),
        jsonRender: {
          componentCount: result.jsonRender.components.length,
          rootShape: result.jsonRender.rootShape,
        },
        graph: result.graph,
        htmlPrimitives: result.htmlPrimitives?.map((entry) => summarizeHtmlPrimitive(entry)) ?? [],
        mcp: result.mcp,
      });
      return;
    }
    output(result);
    return;
  }

  const requested = flags.type;
  if (requested === 'json-render') {
    output(filterJsonRenderSchemaView(result.jsonRender, flags));
    return;
  }
  if (requested === 'graph') {
    const graphSchema = result.nodeTypes.find((entry) => entry.type === 'graph');
    if (graphSchema) {
      output(filterNodeSchemaView(graphSchema, flags));
      return;
    }
    output(flags.summary ? result.graph : { ...result.graph });
    return;
  }
  const nodeType = result.nodeTypes.find((entry) => entry.type === requested);
  if (nodeType) {
    output(filterNodeSchemaView(nodeType, flags));
    return;
  }
  die(`Unknown schema type: ${requested}`, 'Run: pmx-canvas node schema');
});

// ── node list ────────────────────────────────────────────────
cmd('node list', 'List all nodes on the canvas', [
  'pmx-canvas node list',
  'pmx-canvas node list --type markdown',
  'pmx-canvas node list --type mcp-app',
  'pmx-canvas node list --ids',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node list');

  const layout = (await api('GET', '/api/canvas/state')) as { nodes: Array<Record<string, unknown>> };
  let nodes = layout.nodes;

  if (flags.type && flags.type !== true) {
    nodes = nodes.filter((n) => n.type === flags.type || n.kind === flags.type);
  }

  if (flags.ids) {
    output(nodes.map((n) => n.id));
  } else {
    const shouldSummarize =
      flags.summary === true ||
      flags.compact === true ||
      flags.type === 'mcp-app';
    output(shouldSummarize ? nodes.map((node) => summarizeNodeResult(node)) : nodes);
  }
});

// ── node get ─────────────────────────────────────────────────
cmd('node get', 'Get a node by ID', [
  'pmx-canvas node get <node-id>',
  'pmx-canvas node get node-abc123',
  'pmx-canvas node get node-abc123 --summary',
  'pmx-canvas node get node-abc123 --field title --field graphConfig',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node get');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node get <node-id>');

  const result = await api('GET', `/api/canvas/node/${encodeURIComponent(id)}`) as Record<string, unknown>;
  const requestedFields = collectRequestedFields(args, flags);
  if (requestedFields.length > 0) {
    const picked = Object.fromEntries(requestedFields.map((field) => [field, resolveNodeFieldValue(result, field)]));
    const missing = requestedFields.filter((field) => picked[field] === undefined);
    if (missing.length > 0) {
      die(
        `Unknown node field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
        `Available fields: ${listAvailableNodeFields(result).join(', ')}`,
      );
    }
    output({
      id: result.id ?? id,
      fields: picked,
    });
    return;
  }

  if (flags.summary || flags.compact) {
    output(summarizeNodeResult(result));
    return;
  }
  output(result);
});

// ── node update ──────────────────────────────────────────────
cmd('node update', 'Update a node by ID', [
  'pmx-canvas node update <node-id> --title "New Title"',
  'pmx-canvas node update <node-id> --content "Updated content"',
  'pmx-canvas node update <node-id> --title "Moved" --x 500 --y 300',
  'pmx-canvas node update <node-id> --width 840 --height 620',
  'pmx-canvas node update <node-id> --spec-file ./dashboard.json',
  'pmx-canvas node update <graph-id> --data-file ./metrics.json --chart-height 420',
  'pmx-canvas node update <node-id> --pinned true',
  'pmx-canvas node update <node-id> --lock-arrange',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node update');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node update <node-id> --title "New Title"');

  const body: Record<string, unknown> = {};
  await applyStructuredNodeUpdateFlags(body, flags);
  if (flags.title && flags.title !== true) body.title = flags.title;
  if (flags.content && flags.content !== true) body.content = flags.content;
  if (flags.stdin) body.content = await readStdin();

  const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 500');
  const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 300');
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 840');
  const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 620');
  const nodeHeight = optionalPositiveFiniteFlagWithAliases(
    flags,
    'Use a positive number, e.g. --node-height 620',
    'node-height',
    'nodeHeight',
  );
  if (height !== undefined && nodeHeight !== undefined) {
    die('Use either --height/--node-height, not both.');
  }
  const frameHeight = height ?? nodeHeight;
  const pinned = optionalBooleanFlag(flags, 'pinned', 'Use --pinned true or --pinned false');
  if (flags['lock-arrange'] && flags['unlock-arrange']) {
    die('Use either --lock-arrange or --unlock-arrange, not both.');
  }
  const arrangeLocked = flags['lock-arrange']
    ? true
    : flags['unlock-arrange']
      ? false
      : undefined;

  applyStrictSizeFlags(body, flags);

  for (const field of TRACE_NODE_FIELDS) {
    const value = getStringFlag(flags, field, field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`));
    if (value !== undefined) body[field] = value;
  }

  if (x !== undefined || y !== undefined || width !== undefined || frameHeight !== undefined || arrangeLocked !== undefined) {
    const existing = await api('GET', `/api/canvas/node/${encodeURIComponent(id)}`) as {
      position: { x: number; y: number };
      size: { width: number; height: number };
      data: Record<string, unknown>;
    };

    if (x !== undefined || y !== undefined) {
      body.position = {
        x: x ?? existing.position.x,
        y: y ?? existing.position.y,
      };
    }

    if (width !== undefined || frameHeight !== undefined) {
      body.size = {
        width: width ?? existing.size.width,
        height: frameHeight ?? existing.size.height,
      };
    }

    if (arrangeLocked !== undefined) {
      body.arrangeLocked = arrangeLocked;
    }
  }

  if (pinned !== undefined) body.pinned = pinned;

  if (Object.keys(body).length === 0) {
    die(
      'No updates specified',
      'Use --title, --content, --x, --y, --width, --height, --strict-size, --pinned, trace fields, --lock-arrange, --unlock-arrange, or --stdin',
    );
  }

  const result = await api('PATCH', `/api/canvas/node/${encodeURIComponent(id)}`, body);
  output(result);
});

// ── node remove ──────────────────────────────────────────────
cmd('node remove', 'Remove a node from the canvas', [
  'pmx-canvas node remove <node-id>',
  'pmx-canvas node remove node-abc123',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node remove');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node remove <node-id>');

  const result = await api('DELETE', `/api/canvas/node/${encodeURIComponent(id)}`);
  output(result);
});

// ── edge add ─────────────────────────────────────────────────
cmd('edge add', 'Add an edge between two nodes', [
  'pmx-canvas edge add --from <node-id> --to <node-id> --type flow',
  'pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
  'pmx-canvas edge add --from n1 --to n2 --type depends-on --label "imports"',
  'pmx-canvas edge add --from n1 --to n2 --type references --style dashed --animated',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge add');

  const type = (flags.type as string) || 'flow';
  const from = typeof flags.from === 'string' ? flags.from : undefined;
  const to = typeof flags.to === 'string' ? flags.to : undefined;
  const fromSearch = typeof flags['from-search'] === 'string' ? flags['from-search'] : undefined;
  const toSearch = typeof flags['to-search'] === 'string' ? flags['to-search'] : undefined;

  if (!from && !fromSearch) {
    die(
      'Missing source selector',
      'Use --from <id> or --from-search "query". Search queries must resolve to exactly one node. Example: pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
    );
  }
  if (!to && !toSearch) {
    die(
      'Missing target selector',
      'Use --to <id> or --to-search "query". Search queries must resolve to exactly one node. Example: pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation',
    );
  }

  const body: Record<string, unknown> = {
    type,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(fromSearch ? { fromSearch } : {}),
    ...(toSearch ? { toSearch } : {}),
  };
  if (flags.label && flags.label !== true) body.label = flags.label;
  if (typeof flags.style === 'string') body.style = flags.style;
  if (flags.animated) body.animated = true;

  const result = await api('POST', '/api/canvas/edge', body);
  output(result);
});

// ── edge list ────────────────────────────────────────────────
cmd('edge list', 'List all edges on the canvas', [
  'pmx-canvas edge list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge list');

  const layout = (await api('GET', '/api/canvas/state')) as { edges: unknown[] };
  output(layout.edges);
});

// ── edge remove ──────────────────────────────────────────────
cmd('edge remove', 'Remove an edge by ID', [
  'pmx-canvas edge remove <edge-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('edge remove');

  const id = positional[0];
  if (!id) die('Missing edge ID', 'pmx-canvas edge remove <edge-id>');

  const result = await api('DELETE', '/api/canvas/edge', { edge_id: id });
  output(result);
});

// ── search ───────────────────────────────────────────────────
cmd('search', 'Search nodes by title or content', [
  'pmx-canvas search "design doc"',
  'pmx-canvas search --query "TODO"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('search');

  const query = positional[0] || (typeof flags.query === 'string' ? flags.query : '');
  if (!query) die('Missing search query', 'pmx-canvas search "query"');

  const result = await api('GET', `/api/canvas/search?q=${encodeURIComponent(query)}`);
  output(result);
});

// ── layout ───────────────────────────────────────────────────
cmd('layout', 'Get the full canvas layout (nodes, edges, viewport)', [
  'pmx-canvas layout',
  'pmx-canvas layout --summary',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('layout');

  if (flags.summary || flags.compact) {
    output(await api('GET', '/api/canvas/summary'));
    return;
  }
  const result = await api('GET', '/api/canvas/state');
  output(result);
});

// ── status ───────────────────────────────────────────────────
cmd('status', 'Quick canvas summary', [
  'pmx-canvas status',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('status');

  const layout = (await api('GET', '/api/canvas/state')) as {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
    viewport: unknown;
  };
  const pinned = (await api('GET', '/api/canvas/pinned-context')) as { count: number; nodeIds: string[] };

  const typeCounts: Record<string, number> = {};
  for (const n of layout.nodes) {
    const data = isRecord(n.data) ? n.data : {};
    const t = typeof n.kind === 'string'
      ? n.kind
      : n.type === 'mcp-app' && data.hostMode === 'hosted' && typeof data.path === 'string'
      ? 'web-artifact'
      : n.type as string;
    typeCounts[t] = (typeCounts[t] || 0) + 1;
  }

  output({
    nodes: layout.nodes.length,
    edges: layout.edges.length,
    pinned: pinned.count,
    types: typeCounts,
    viewport: layout.viewport,
  });
});

// ── arrange ──────────────────────────────────────────────────
cmd('arrange', 'Auto-arrange nodes on the canvas', [
  'pmx-canvas arrange',
  'pmx-canvas arrange --layout column',
  'pmx-canvas arrange --layout flow',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('arrange');

  const body: Record<string, unknown> = {};
  if (flags.layout && flags.layout !== true) body.layout = flags.layout;

  const result = await api('POST', '/api/canvas/arrange', body);
  output(result);
});

// ── focus ────────────────────────────────────────────────────
cmd('focus', 'Pan viewport to center on a node', [
  'pmx-canvas focus <node-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('focus');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas focus <node-id>');

  const result = await api('POST', '/api/canvas/focus', { id, ...(flags['no-pan'] ? { noPan: true } : {}) });
  output(result);
});

cmd('fit', 'Fit the viewport to all nodes or a selected subset', [
  'pmx-canvas fit',
  'pmx-canvas fit --width 1440 --height 900 --padding 80',
  'pmx-canvas fit node-a node-b',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('fit');

  const body: Record<string, unknown> = {};
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 1440');
  const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 900');
  const padding = optionalPositiveFiniteFlag(flags, 'padding', 'Use a positive number, e.g. --padding 80');
  const maxScale = optionalPositiveFiniteFlag(flags, 'max-scale', 'Use a positive number, e.g. --max-scale 1');
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;
  if (padding !== undefined) body.padding = padding;
  if (maxScale !== undefined) body.maxScale = maxScale;
  if (positional.length > 0) body.nodeIds = positional;

  const result = await api('POST', '/api/canvas/fit', body);
  output(result);
});

// ── external-app add ─────────────────────────────────────────
cmd('external-app add', 'Create a hosted external app node', [
  'pmx-canvas external-app add --kind excalidraw --title "Diagram"',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('external-app add');

  const kind = typeof flags.kind === 'string' ? flags.kind.trim() : '';
  if (kind !== 'excalidraw') {
    die('Unsupported external app kind.', 'Use: pmx-canvas external-app add --kind excalidraw --title "Diagram"');
  }

  const body: Record<string, unknown> = {
    title: typeof flags.title === 'string' ? flags.title : 'Excalidraw Diagram',
    elements: DEFAULT_EXCALIDRAW_ELEMENTS,
  };
  const nodeId = getStringFlag(flags, 'node-id', 'nodeId', 'id');
  if (nodeId) body.nodeId = nodeId;
  const elementsJson = getStringFlag(flags, 'elements-json', 'elements');
  if (elementsJson !== undefined) body.elements = parseJsonValue(elementsJson, 'Excalidraw elements', 'Use --elements-json \'[{"type":"rectangle","id":"r1","x":0,"y":0,"width":120,"height":80}]\'');
  const elementsFile = getStringFlag(flags, 'elements-file', 'initial-file');
  if (elementsFile) body.elements = parseJsonValue(readFileSync(elementsFile, 'utf-8'), 'Excalidraw elements file', 'Use --elements-file ./scene.excalidraw');
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 960',
    height: 'Use a positive number, e.g. --height 720',
  });
  const timeoutMs = optionalPositiveFiniteFlag(flags, 'timeout-ms', 'Use a positive number, e.g. --timeout-ms 120000');
  if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;

  const result = await api('POST', '/api/canvas/diagram', body);
  output(result && typeof result === 'object' && !Array.isArray(result) && 'nodeId' in result && !('id' in result)
    ? { id: (result as { nodeId?: unknown }).nodeId, ...result }
    : result);
});

cmd('diagram add', 'Create an Excalidraw diagram node', [
  'pmx-canvas diagram add --title "Architecture"',
  'pmx-canvas diagram add --title "Architecture" --elements \'[{"type":"rectangle","id":"r1","x":0,"y":0,"width":120,"height":80}]\'',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('diagram add');
  const externalAppAdd = COMMANDS['external-app add'];
  await externalAppAdd.run([...args, '--kind', 'excalidraw']);
});

// ── pin ──────────────────────────────────────────────────────
cmd('pin', 'Manage context pins', [
  'pmx-canvas pin node1 node2 node3',
  'pmx-canvas pin --set node1 node2 node3',
  'pmx-canvas pin --list',
  'pmx-canvas pin --clear',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('pin');

  if (flags.list) {
    const result = await api('GET', '/api/canvas/pinned-context');
    output(result);
    return;
  }

  if (flags.clear) {
    const result = await api('POST', '/api/canvas/context-pins', { nodeIds: [] });
    output(result);
    return;
  }

  // --set: positional args are node IDs
  if (positional.length > 0 || flags.set) {
    const result = await api('POST', '/api/canvas/context-pins', { nodeIds: positional });
    output(result);
    return;
  }

  // Default: list
  const result = await api('GET', '/api/canvas/pinned-context');
  output(result);
});

// ── AX ────────────────────────────────────────────────────────
cmd('ax status', 'Read host-agnostic PMX AX state', [
  'pmx-canvas ax status',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax status');

  output(await api('GET', '/api/canvas/ax'));
});

cmd('ax context', 'Read agent-ready PMX AX context', [
  'pmx-canvas ax context',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax context');

  output(await api('GET', '/api/canvas/ax/context'));
});

cmd('ax focus', 'Set or clear PMX AX focus without moving the viewport', [
  'pmx-canvas ax focus node1 node2',
  'pmx-canvas ax focus --clear',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax focus');

  const nodeIds = flags.clear ? [] : positional;
  if (!flags.clear && nodeIds.length === 0) {
    die('Missing node ID', 'pmx-canvas ax focus <node-id> [more-node-ids]');
  }

  output(await api('POST', '/api/canvas/ax/focus', { nodeIds, source: 'cli' }));
});

cmd('ax event add', 'Record a normalized AX timeline event', [
  'pmx-canvas ax event add --kind tool-start --summary "ran tests"',
  'pmx-canvas ax event add --kind failure --summary "build broke" --detail "..." node1 node2',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax event add');

  const kind = requireFlag(flags, 'kind', 'pmx-canvas ax event add --kind <kind> --summary <text>');
  const summary = requireFlag(flags, 'summary', 'pmx-canvas ax event add --kind <kind> --summary <text>');
  const detail = getStringFlag(flags, 'detail');

  output(await api('POST', '/api/canvas/ax/event', {
    kind,
    summary,
    ...(detail ? { detail } : {}),
    ...(positional.length > 0 ? { nodeIds: positional } : {}),
    source: 'cli',
  }));
});

cmd('ax steer', 'Send a steering message to the active agent session', [
  'pmx-canvas ax steer "focus on the failing test first"',
  'pmx-canvas ax steer --message "stop and re-plan"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax steer');

  const message = getStringFlag(flags, 'message') ?? positional.join(' ').trim();
  if (!message) {
    die('Missing steering message', 'pmx-canvas ax steer <message>');
  }

  output(await api('POST', '/api/canvas/ax/steer', { message, source: 'cli' }));
});

cmd('ax interaction', 'Submit a node-originated AX interaction (capability-gated)', [
  'pmx-canvas ax interaction --type ax.work.create --node node-1 --payload \'{"title":"Wire auth"}\'',
  'pmx-canvas ax interaction --type ax.focus.set --node node-2',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax interaction');

  const type = getStringFlag(flags, 'type');
  if (!type) die('Missing --type', 'pmx-canvas ax interaction --type <ax.*> --node <id> [--payload <json>]');
  const sourceNodeId = getStringFlag(flags, 'node');
  if (!sourceNodeId) die('Missing --node', 'pmx-canvas ax interaction --type <ax.*> --node <id>');

  let payload: unknown;
  const payloadRaw = getStringFlag(flags, 'payload');
  if (payloadRaw) {
    try {
      payload = JSON.parse(payloadRaw);
    } catch {
      die('Invalid --payload JSON', 'pmx-canvas ax interaction --payload \'{"title":"..."}\'');
    }
  }

  output(await api('POST', '/api/canvas/ax/interaction', {
    type,
    sourceNodeId,
    ...(payload !== undefined ? { payload } : {}),
    source: 'cli',
  }));
});

cmd('ax delivery list', 'List pending AX steering for a consumer (loop-safe)', [
  'pmx-canvas ax delivery list',
  'pmx-canvas ax delivery list --consumer copilot --limit 20',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax delivery list');
  const consumer = getStringFlag(flags, 'consumer');
  const limit = optionalNumberFlag(flags, 'limit', 'pmx-canvas ax delivery list --limit <n>');
  const params = new URLSearchParams();
  if (consumer) params.set('consumer', consumer);
  if (limit) params.set('limit', String(limit));
  const qs = params.toString();
  output(await api('GET', `/api/canvas/ax/delivery/pending${qs ? `?${qs}` : ''}`));
});

cmd('ax delivery mark', 'Mark an AX steering message as delivered', [
  'pmx-canvas ax delivery mark <steering-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax delivery mark');
  const id = getStringFlag(flags, 'id') ?? positional[0];
  if (!id) die('Missing steering id', 'pmx-canvas ax delivery mark <steering-id>');
  output(await api('POST', `/api/canvas/ax/delivery/${encodeURIComponent(id)}/mark`, {}));
});

cmd('ax elicitation request', 'Request structured human input', [
  'pmx-canvas ax elicitation request --prompt "Who owns this migration?"',
  'pmx-canvas ax elicitation request --prompt "Pick a region" --fields region,owner',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax elicitation request');
  const prompt = requireFlag(flags, 'prompt', 'pmx-canvas ax elicitation request --prompt <text>');
  const fields = getStringFlag(flags, 'fields');
  output(await api('POST', '/api/canvas/ax/elicitation', {
    prompt,
    ...(fields ? { fields: fields.split(',').map((f) => f.trim()).filter(Boolean) } : {}),
    source: 'cli',
  }));
});

cmd('ax elicitation respond', 'Answer a pending elicitation', [
  'pmx-canvas ax elicitation respond <id> --response \'{"owner":"alice"}\'',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax elicitation respond');
  const id = getStringFlag(flags, 'id') ?? positional[0];
  if (!id) die('Missing elicitation id', 'pmx-canvas ax elicitation respond <id> --response <json>');
  let response: unknown = {};
  const raw = getStringFlag(flags, 'response');
  if (raw) {
    try { response = JSON.parse(raw); } catch { die('Invalid --response JSON', '--response \'{"k":"v"}\''); }
  }
  output(await api('POST', `/api/canvas/ax/elicitation/${encodeURIComponent(id)}/respond`, { response, source: 'cli' }));
});

cmd('ax elicitation list', 'List elicitations', ['pmx-canvas ax elicitation list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax elicitation list');
  output(await api('GET', '/api/canvas/ax/elicitation'));
});

cmd('ax mode request', 'Request a workflow mode transition (plan/execute/autonomous)', [
  'pmx-canvas ax mode request --mode execute --reason "plan approved"',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax mode request');
  const mode = requireFlag(flags, 'mode', 'pmx-canvas ax mode request --mode plan|execute|autonomous');
  const reason = getStringFlag(flags, 'reason');
  output(await api('POST', '/api/canvas/ax/mode', { mode, ...(reason ? { reason } : {}), source: 'cli' }));
});

cmd('ax mode resolve', 'Resolve a pending mode request', [
  'pmx-canvas ax mode resolve <id> --decision approved',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax mode resolve');
  const id = getStringFlag(flags, 'id') ?? positional[0];
  if (!id) die('Missing mode request id', 'pmx-canvas ax mode resolve <id> --decision approved|rejected');
  const decision = getStringFlag(flags, 'decision');
  if (decision !== 'approved' && decision !== 'rejected') die('Invalid --decision', '--decision approved|rejected');
  const resolution = getStringFlag(flags, 'resolution');
  output(await api('POST', `/api/canvas/ax/mode/${encodeURIComponent(id)}/resolve`, {
    decision,
    ...(resolution ? { resolution } : {}),
    source: 'cli',
  }));
});

cmd('ax mode list', 'List mode requests', ['pmx-canvas ax mode list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax mode list');
  output(await api('GET', '/api/canvas/ax/mode'));
});

cmd('ax command list', 'List the PMX command registry', ['pmx-canvas ax command list'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax command list');
  output(await api('GET', '/api/canvas/ax/command'));
});

cmd('ax command invoke', 'Invoke a registry-gated PMX command intent', [
  'pmx-canvas ax command invoke pmx.plan',
  'pmx-canvas ax command invoke pmx.promote-context --args \'{"nodeIds":["n1"]}\'',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax command invoke');
  const name = getStringFlag(flags, 'name') ?? positional[0];
  if (!name) die('Missing command name', 'pmx-canvas ax command invoke <name>');
  let cmdArgs: unknown;
  const raw = getStringFlag(flags, 'args');
  if (raw) {
    try { cmdArgs = JSON.parse(raw); } catch { die('Invalid --args JSON', '--args \'{"k":"v"}\''); }
  }
  output(await api('POST', '/api/canvas/ax/command', { name, ...(cmdArgs !== undefined ? { args: cmdArgs } : {}), source: 'cli' }));
});

cmd('ax policy get', 'Show the current declarative AX policy', ['pmx-canvas ax policy get'], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax policy get');
  output(await api('GET', '/api/canvas/ax/policy'));
});

cmd('ax policy set', 'Set the declarative AX policy (stored by PMX, enforced by adapters)', [
  'pmx-canvas ax policy set --excluded-tools shell,write --mode concise',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax policy set');
  const csv = (v?: string) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
  const allowed = csv(getStringFlag(flags, 'allowed-tools'));
  const excluded = csv(getStringFlag(flags, 'excluded-tools'));
  const approvalRequired = csv(getStringFlag(flags, 'approval-tools'));
  const mode = getStringFlag(flags, 'mode');
  const systemAppend = getStringFlag(flags, 'system-append');
  const tools = (allowed || excluded || approvalRequired)
    ? { ...(allowed ? { allowed } : {}), ...(excluded ? { excluded } : {}), ...(approvalRequired ? { approvalRequired } : {}) }
    : undefined;
  const prompt = (mode || systemAppend)
    ? { ...(mode ? { mode } : {}), ...(systemAppend ? { systemAppend } : {}) }
    : undefined;
  output(await api('POST', '/api/canvas/ax/policy', { ...(tools ? { tools } : {}), ...(prompt ? { prompt } : {}), source: 'cli' }));
});

cmd('ax timeline', 'Read the bounded AX timeline (events, evidence, steering)', [
  'pmx-canvas ax timeline',
  'pmx-canvas ax timeline --limit 100',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax timeline');

  const limit = optionalNumberFlag(flags, 'limit', 'pmx-canvas ax timeline --limit <n>');
  output(await api('GET', `/api/canvas/ax/timeline${limit ? `?limit=${limit}` : ''}`));
});

cmd('ax work add', 'Add a canvas-bound AX work item', [
  'pmx-canvas ax work add --title "Wire up auth" --status in-progress',
  'pmx-canvas ax work add --title "Review API" node1 node2',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax work add');

  const title = requireFlag(flags, 'title', 'pmx-canvas ax work add --title <text>');
  const status = getStringFlag(flags, 'status');
  const detail = getStringFlag(flags, 'detail');

  output(await api('POST', '/api/canvas/ax/work', {
    title,
    ...(status ? { status } : {}),
    ...(detail ? { detail } : {}),
    ...(positional.length > 0 ? { nodeIds: positional } : {}),
    source: 'cli',
  }));
});

cmd('ax work update', 'Update a canvas-bound AX work item by ID', [
  'pmx-canvas ax work update <id> --status done',
  'pmx-canvas ax work update <id> --title "New title" --detail "..."',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax work update');

  const id = positional[0];
  if (!id) die('Missing work item ID', 'pmx-canvas ax work update <id> --status <status>');
  const title = getStringFlag(flags, 'title');
  const status = getStringFlag(flags, 'status');
  const detail = getStringFlag(flags, 'detail');

  output(await api('PATCH', `/api/canvas/ax/work/${encodeURIComponent(id)}`, {
    ...(title ? { title } : {}),
    ...(status ? { status } : {}),
    ...(detail ? { detail } : {}),
    ...(positional.length > 1 ? { nodeIds: positional.slice(1) } : {}),
    source: 'cli',
  }));
});

cmd('ax work list', 'List canvas-bound AX work items', [
  'pmx-canvas ax work list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax work list');

  output(await api('GET', '/api/canvas/ax/work'));
});

cmd('ax approval request', 'Request a canvas-bound AX approval gate', [
  'pmx-canvas ax approval request --title "Deploy to prod"',
  'pmx-canvas ax approval request --title "Drop table" --action db.drop node1',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax approval request');

  const title = requireFlag(flags, 'title', 'pmx-canvas ax approval request --title <text>');
  const detail = getStringFlag(flags, 'detail');
  const action = getStringFlag(flags, 'action');

  output(await api('POST', '/api/canvas/ax/approval', {
    title,
    ...(detail ? { detail } : {}),
    ...(action ? { action } : {}),
    ...(positional.length > 0 ? { nodeIds: positional } : {}),
    source: 'cli',
  }));
});

cmd('ax approval resolve', 'Resolve a pending AX approval gate by ID', [
  'pmx-canvas ax approval resolve <id> --decision approved',
  'pmx-canvas ax approval resolve <id> --decision rejected --resolution "too risky"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax approval resolve');

  const id = positional[0];
  if (!id) die('Missing approval gate ID', 'pmx-canvas ax approval resolve <id> --decision <approved|rejected>');
  const decision = requireFlag(flags, 'decision', 'pmx-canvas ax approval resolve <id> --decision <approved|rejected>');
  if (decision !== 'approved' && decision !== 'rejected') {
    die('Invalid decision', 'pmx-canvas ax approval resolve <id> --decision <approved|rejected>');
  }
  const resolution = getStringFlag(flags, 'resolution');

  output(await api('POST', `/api/canvas/ax/approval/${encodeURIComponent(id)}/resolve`, {
    decision,
    ...(resolution ? { resolution } : {}),
    source: 'cli',
  }));
});

cmd('ax approval list', 'List canvas-bound AX approval gates', [
  'pmx-canvas ax approval list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax approval list');

  output(await api('GET', '/api/canvas/ax/approval'));
});

cmd('ax evidence add', 'Record an AX evidence item on the timeline', [
  'pmx-canvas ax evidence add --kind test-output --title "unit pass" --body "..."',
  'pmx-canvas ax evidence add --kind screenshot --title "before" --ref /tmp/before.png node1',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax evidence add');

  const kind = requireFlag(flags, 'kind', 'pmx-canvas ax evidence add --kind <kind> --title <text>');
  const title = requireFlag(flags, 'title', 'pmx-canvas ax evidence add --kind <kind> --title <text>');
  const body = getStringFlag(flags, 'body');
  const ref = getStringFlag(flags, 'ref');

  output(await api('POST', '/api/canvas/ax/evidence', {
    kind,
    title,
    ...(body ? { body } : {}),
    ...(ref ? { ref } : {}),
    ...(positional.length > 0 ? { nodeIds: positional } : {}),
    source: 'cli',
  }));
});

cmd('ax review add', 'Add a canvas-bound AX review annotation', [
  'pmx-canvas ax review add --body "needs a test" --node node1',
  'pmx-canvas ax review add --body "off-by-one" --kind finding --severity error --file src/x.ts',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax review add');

  const body = requireFlag(flags, 'body', 'pmx-canvas ax review add --body <text>');
  const kind = getStringFlag(flags, 'kind');
  const severity = getStringFlag(flags, 'severity');
  const anchorType = getStringFlag(flags, 'anchor');
  const nodeId = getStringFlag(flags, 'node');
  const file = getStringFlag(flags, 'file');
  const author = getStringFlag(flags, 'author');

  output(await api('POST', '/api/canvas/ax/review', {
    body,
    ...(kind ? { kind } : {}),
    ...(severity ? { severity } : {}),
    ...(anchorType ? { anchorType } : {}),
    ...(nodeId ? { nodeId } : {}),
    ...(file ? { file } : {}),
    ...(author ? { author } : {}),
    source: 'cli',
  }));
});

cmd('ax review list', 'List canvas-bound AX review annotations', [
  'pmx-canvas ax review list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax review list');

  output(await api('GET', '/api/canvas/ax/review'));
});

cmd('ax host report', 'Report host/session capability to the canvas', [
  'pmx-canvas ax host report --host copilot --canvas --tools --session-messaging',
  'pmx-canvas ax host report --host codex --canvas --files',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax host report');

  const host = getStringFlag(flags, 'host');

  output(await api('PUT', '/api/canvas/ax/host-capability', {
    ...(host ? { host } : {}),
    canvas: flags.canvas === true,
    hooks: flags.hooks === true,
    tools: flags.tools === true,
    sessionMessaging: flags['session-messaging'] === true,
    permissions: flags.permissions === true,
    files: flags.files === true,
    uiPrompts: flags['ui-prompts'] === true,
    source: 'cli',
  }));
});

cmd('ax host status', 'Read the reported host/session capability', [
  'pmx-canvas ax host status',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('ax host status');

  output(await api('GET', '/api/canvas/ax/host-capability'));
});

// ── copilot install-extension ────────────────────────────────
cmd('copilot install-extension', 'Install the bundled GitHub Copilot extension adapter', [
  'pmx-canvas copilot install-extension --dry-run',
  'pmx-canvas copilot install-extension --target .github/extensions/pmx-canvas/extension.mjs --yes',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('copilot install-extension');

  const sourcePath = fileURLToPath(new URL('../../.github/extensions/pmx-canvas/extension.mjs', import.meta.url));
  if (!existsSync(sourcePath)) {
    die('Bundled Copilot extension adapter not found.', `Expected at ${sourcePath}`);
  }

  const targetPath = getStringFlag(flags, 'target')
    ?? join(process.cwd(), '.github', 'extensions', 'pmx-canvas', 'extension.mjs');
  const dryRun = flags['dry-run'] === true;
  const targetExists = existsSync(targetPath);

  if (dryRun) {
    output({ ok: true, dryRun: true, sourcePath, targetPath, targetExists, wrote: false });
    return;
  }

  if (targetExists && flags.yes !== true) {
    die('Target already exists. Re-run with --yes to overwrite.', `Target: ${targetPath}`);
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  copyFileSync(sourcePath, targetPath);
  output({ ok: true, dryRun: false, sourcePath, targetPath, wrote: true });
});

// ── undo ─────────────────────────────────────────────────────
cmd('undo', 'Undo the last canvas mutation', [
  'pmx-canvas undo',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('undo');

  const result = await api('POST', '/api/canvas/undo');
  output(result);
});

// ── redo ─────────────────────────────────────────────────────
cmd('redo', 'Redo the last undone mutation', [
  'pmx-canvas redo',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('redo');

  const result = await api('POST', '/api/canvas/redo');
  output(result);
});

// ── history ──────────────────────────────────────────────────
cmd('history', 'Show canvas mutation history', [
  'pmx-canvas history',
  'pmx-canvas history --summary',
  'pmx-canvas history --compact',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('history');

  const result = await api('GET', '/api/canvas/history') as Record<string, unknown>;
  if (flags.summary) {
    output(summarizeHistoryResult(result));
    return;
  }
  if (flags.compact) {
    output(compactHistoryResult(result));
    return;
  }
  output(result);
});

// ── snapshot save ────────────────────────────────────────────
cmd('snapshot save', 'Save a named snapshot of the current canvas', [
  'pmx-canvas snapshot save --name "before-refactor"',
  'pmx-canvas snapshot save --name checkpoint-1',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot save');

  const name = requireFlag(flags, 'name', 'pmx-canvas snapshot save --name "my-snapshot"');
  const result = await api('POST', '/api/canvas/snapshots', { name });
  output(result);
});

// ── snapshot list ────────────────────────────────────────────
cmd('snapshot list', 'List saved snapshots', [
  'pmx-canvas snapshot list',
  'pmx-canvas snapshot list --limit 50 --query baseline',
  'pmx-canvas snapshot list --after 2026-05-01T00:00:00Z --before 2026-05-05T00:00:00Z',
  'pmx-canvas snapshot list --all',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot list');

  const params = new URLSearchParams();
  const limit = optionalNumberFlag(flags, 'limit', 'Use a positive integer, e.g. --limit 50');
  const query = getStringFlag(flags, 'query', 'q');
  const before = getStringFlag(flags, 'before');
  const after = getStringFlag(flags, 'after');
  if (limit !== undefined) params.set('limit', String(limit));
  if (query) params.set('q', query);
  if (before) params.set('before', before);
  if (after) params.set('after', after);
  if (flags.all) params.set('all', 'true');
  const result = await api('GET', `/api/canvas/snapshots${params.size > 0 ? `?${params.toString()}` : ''}`);
  output(result);
});

// ── snapshot gc ──────────────────────────────────────────────
cmd('snapshot gc', 'Delete old snapshots, keeping the newest N', [
  'pmx-canvas snapshot gc --keep 20 --dry-run',
  'pmx-canvas snapshot gc --keep 50 --yes',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot gc');

  const keep = optionalNumberFlag(flags, 'keep', 'Use a positive integer, e.g. --keep 20');
  const dryRun = flags['dry-run'] === true;
  if (!dryRun && !flags.yes) {
    die('Destructive operation requires --yes flag', 'Preview with: pmx-canvas snapshot gc --keep 20 --dry-run');
  }
  const result = await api('POST', '/api/canvas/snapshots/gc', {
    ...(keep !== undefined ? { keep } : {}),
    dryRun,
  });
  output(result);
});

// ── snapshot restore ─────────────────────────────────────────
cmd('snapshot restore', 'Restore canvas from a snapshot', [
  'pmx-canvas snapshot restore <snapshot-id-or-name>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot restore');

  const id = positional[0];
  if (!id) die('Missing snapshot ID or name', 'pmx-canvas snapshot restore <snapshot-id-or-name>');

  const result = await api('POST', `/api/canvas/snapshots/${encodeURIComponent(id)}`);
  output(result);
});

// ── snapshot delete ──────────────────────────────────────────
cmd('snapshot delete', 'Delete a saved snapshot', [
  'pmx-canvas snapshot delete <snapshot-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot delete');

  const id = positional[0];
  if (!id) die('Missing snapshot ID', 'pmx-canvas snapshot delete <snapshot-id>');

  const result = await api('DELETE', `/api/canvas/snapshots/${encodeURIComponent(id)}`);
  output(result);
});

async function runSnapshotDiff(args: string[]): Promise<void> {
  const { positional, flags } = parseFlags(args);
  const snapshot = positional[0];
  if (!snapshot) die('Missing snapshot ID or name', 'pmx-canvas snapshot diff <snapshot-id-or-name>');
  const result = await api('GET', `/api/canvas/snapshots/${encodeURIComponent(snapshot)}/diff`);
  output(result);
}

// ── snapshot diff ────────────────────────────────────────────
cmd('snapshot diff', 'Compare current canvas against a saved snapshot', [
  'pmx-canvas snapshot diff <snapshot-id>',
  'pmx-canvas snapshot diff "before-refactor"',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot diff');
  await runSnapshotDiff(args);
});

// ── diff ─────────────────────────────────────────────────────
cmd('diff', 'Compare current canvas against a snapshot', [
  'pmx-canvas diff <snapshot-id>',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('diff');
  await runSnapshotDiff(args);
});

// ── group create ─────────────────────────────────────────────
cmd('group create', 'Create a group node', [
  'pmx-canvas group create --title "API Layer" node1 node2',
  'pmx-canvas group create --title "Quarterly board" --x 40 --y 60 --width 1600 --height 900 --child-layout column node1 node2',
  'pmx-canvas group create --title "Frontend" --color "#ff6b6b"',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group create');

  const body: Record<string, unknown> = {};
  if (flags.title && flags.title !== true) body.title = flags.title;
  if (flags.color && flags.color !== true) body.color = flags.color;
  const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 40');
  const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 60');
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 1600');
  const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 900');
  if (x !== undefined) body.x = x;
  if (y !== undefined) body.y = y;
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;
  if (typeof flags['child-layout'] === 'string') body.childLayout = flags['child-layout'];
  if (positional.length > 0) body.childIds = positional;

  const result = await api('POST', '/api/canvas/group', body);
  output(result);
});

// ── group add ────────────────────────────────────────────────
cmd('group add', 'Add nodes to an existing group', [
  'pmx-canvas group add --group <group-id> node1 node2',
  'pmx-canvas group add --group <group-id> --child-layout flow node1 node2',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group add');

  const groupId = requireFlag(flags, 'group', 'pmx-canvas group add --group <group-id> node1 node2');
  if (positional.length === 0) die('No node IDs provided', 'pmx-canvas group add --group <group-id> node1 node2');

  const result = await api('POST', '/api/canvas/group/add', {
    groupId,
    childIds: positional,
    ...(typeof flags['child-layout'] === 'string' ? { childLayout: flags['child-layout'] } : {}),
  });
  output(result);
});

// ── batch ────────────────────────────────────────────────────
cmd('batch', 'Run a batch of canvas operations from JSON', [
  'pmx-canvas batch --file ./canvas-ops.json',
  'pmx-canvas batch --json \'[{\"op\":\"node.add\",\"assign\":\"a\",\"args\":{\"type\":\"markdown\",\"title\":\"A\"}}]\'',
  'pmx-canvas batch --json \'[{\"op\":\"graph.add\",\"assign\":\"g\",\"args\":{\"graphType\":\"bar\",\"data\":[{\"label\":\"Docs\",\"value\":5}],\"xKey\":\"label\",\"yKey\":\"value\"}}]\'',
  'cat ops.json | pmx-canvas batch --stdin',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('batch');

  let raw = '';
  if (typeof flags.file === 'string') {
    try {
      raw = readFileSync(flags.file, 'utf-8');
    } catch (error) {
      die(
        `Unable to read --file: ${error instanceof Error ? error.message : String(error)}`,
        'Use: pmx-canvas batch --file ./canvas-ops.json',
      );
    }
  } else if (typeof flags.json === 'string') {
    raw = flags.json;
  } else if (flags.stdin) {
    raw = await readStdin();
  } else {
    die(
      'Batch operations require --file, --json, or --stdin.',
      'Use: pmx-canvas batch --file ./canvas-ops.json',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    die(
      `Invalid batch JSON: ${error instanceof Error ? error.message : String(error)}`,
      'Use a JSON array of operations or an object with an "operations" array.',
    );
  }

  const result = await api('POST', '/api/canvas/batch', Array.isArray(parsed) ? { operations: parsed } : parsed as Record<string, unknown>);
  output(result);
});

// ── validate ─────────────────────────────────────────────────
cmd('validate', 'Validate the current layout for collisions and missing edge endpoints', [
  'pmx-canvas validate',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('validate');

  const result = await api('GET', '/api/canvas/validate');
  output(result);
});

cmd('validate spec', 'Validate a json-render spec or graph payload without creating a node', [
  'pmx-canvas validate spec --type json-render --spec-file ./dashboard.json',
  'pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
  'pmx-canvas validate spec --type html-primitive --kind choice-grid --data-file ./options.json',
  'pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('validate spec');

  const type = getStringFlag(flags, 'type');
  if (type !== 'json-render' && type !== 'graph' && type !== 'html-primitive') {
    die('validate spec requires --type json-render, --type graph, or --type html-primitive.');
  }

  let body: Record<string, unknown>;
  if (type === 'json-render') {
    body = { type, spec: (await buildJsonRenderRequestBody({ ...flags, title: String(flags.title ?? 'Validation') })).spec };
  } else if (type === 'html-primitive') {
    const primitiveBody = await buildHtmlPrimitiveRequestBody(flags);
    body = {
      type,
      kind: primitiveBody.primitive,
      ...(typeof primitiveBody.title === 'string' ? { title: primitiveBody.title } : {}),
      ...(isRecord(primitiveBody.data) ? { data: primitiveBody.data } : {}),
    };
  } else {
    body = { type, ...(await buildGraphRequestBody(flags)) };
  }

  const result = await api('POST', '/api/canvas/schema/validate', body) as Record<string, unknown>;
  if (flags.summary) {
    output({
      ok: result.ok,
      type: result.type,
      summary: result.summary,
    });
    return;
  }
  output(result);
});

// ── group remove ─────────────────────────────────────────────
cmd('group remove', 'Ungroup all children from a group', [
  'pmx-canvas group remove <group-id>',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('group remove');

  const id = positional[0];
  if (!id) die('Missing group ID', 'pmx-canvas group remove <group-id>');

  const result = await api('POST', '/api/canvas/group/ungroup', { groupId: id });
  output(result);
});

// ── web-artifact build ───────────────────────────────────────
cmd('web-artifact build', 'Build a bundled HTML web artifact and optionally open it on the canvas', [
  'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx',
  'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --index-css-file ./index.css',
  'pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --include-logs',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('web-artifact build');
  await runWebArtifactBuildCommand(flags);
});

// ── clear ────────────────────────────────────────────────────
cmd('clear', 'Remove all nodes and edges from the canvas', [
  'pmx-canvas clear --yes',
  'pmx-canvas clear --dry-run',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('clear');

  if (flags['dry-run']) {
    const layout = (await api('GET', '/api/canvas/state')) as { nodes: unknown[]; edges: unknown[] };
    output({
      dry_run: true,
      would_remove: { nodes: layout.nodes.length, edges: layout.edges.length },
      message: 'No changes made. Pass --yes to confirm.',
    });
    return;
  }

  if (!flags.yes) {
    die('Destructive operation requires --yes flag', 'pmx-canvas clear --yes (or preview with --dry-run)');
  }

  const result = await api('POST', '/api/canvas/clear');
  output(result);
});

// ── webview status ────────────────────────────────────────────
cmd('webview status', 'Show Bun.WebView automation status', [
  'pmx-canvas webview status',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview status');

  const result = await api('GET', '/api/workbench/webview');
  output(result);
});

// ── webview start ─────────────────────────────────────────────
cmd('webview start', 'Start or replace the Bun.WebView automation session', [
  'pmx-canvas webview start',
  'pmx-canvas webview start --backend chrome --width 1440 --height 900',
  'pmx-canvas webview start --chrome-path /Applications/Google\\ Chrome.app/.../Google\\ Chrome',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview start');

  const backend = flags.backend;
  if (backend && backend !== true && backend !== 'chrome' && backend !== 'webkit') {
    die('Invalid value for --backend', 'Use: --backend chrome or --backend webkit');
  }

  const body: Record<string, unknown> = {};
  if (backend && backend !== true) body.backend = backend;

  const width = optionalNumberFlag(flags, 'width', 'Use a positive integer width, e.g. --width 1440');
  const height = optionalNumberFlag(flags, 'height', 'Use a positive integer height, e.g. --height 900');
  if (width !== undefined) body.width = width;
  if (height !== undefined) body.height = height;

  if (flags['chrome-path'] && flags['chrome-path'] !== true) {
    body.chromePath = flags['chrome-path'];
  }

  if (flags['data-dir'] && flags['data-dir'] !== true) {
    body.dataStoreDir = flags['data-dir'];
  }

  if (flags['chrome-argv'] && flags['chrome-argv'] !== true) {
    const chromeArgv = String(flags['chrome-argv'])
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (chromeArgv.length > 0) body.chromeArgv = chromeArgv;
  }

  const result = await api('POST', '/api/workbench/webview/start', body, { allowErrorJson: true });
  output(result);
});

// ── webview stop ──────────────────────────────────────────────
cmd('webview stop', 'Stop the active Bun.WebView automation session', [
  'pmx-canvas webview stop',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview stop');

  const result = await api('DELETE', '/api/workbench/webview');
  output(result);
});

// ── webview evaluate ──────────────────────────────────────────
cmd('webview evaluate', 'Evaluate JavaScript in the active Bun.WebView automation session', [
  'pmx-canvas webview evaluate --expression "document.title"',
  'pmx-canvas webview evaluate --script "const title = document.title; return title.toUpperCase()"',
  'pmx-canvas webview evaluate --file ./probe.js',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview evaluate');

  const sourceCount = [flags.expression, flags.script, flags.file].filter(Boolean).length;
  if (sourceCount > 1) {
    die('Use only one of --expression, --script, or --file.', 'pmx-canvas webview evaluate --expression "document.title"');
  }

  let expression = '';
  if (typeof flags.file === 'string') {
    let script = '';
    try {
      script = readFileSync(flags.file, 'utf-8');
    } catch (error) {
      die(
        `Unable to read --file: ${error instanceof Error ? error.message : String(error)}`,
        'pmx-canvas webview evaluate --file ./probe.js',
      );
    }
    expression = wrapCanvasAutomationScript(script);
  } else if (typeof flags.script === 'string') {
    expression = wrapCanvasAutomationScript(flags.script);
  } else {
    expression = requireFlag(
      flags,
      'expression',
      'pmx-canvas webview evaluate --expression "document.title"',
    );
  }

  const result = await api('POST', '/api/workbench/webview/evaluate', { expression });
  output(result);
});

// ── webview resize ────────────────────────────────────────────
cmd('webview resize', 'Resize the active Bun.WebView automation session viewport', [
  'pmx-canvas webview resize --width 1280 --height 800',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview resize');

  const width = optionalNumberFlag(flags, 'width', 'Use: pmx-canvas webview resize --width 1280 --height 800');
  const height = optionalNumberFlag(flags, 'height', 'Use: pmx-canvas webview resize --width 1280 --height 800');
  if (width === undefined || height === undefined) {
    die('Missing required flags: --width, --height', 'Use: pmx-canvas webview resize --width 1280 --height 800');
  }

  const result = await api('POST', '/api/workbench/webview/resize', { width, height });
  output(result);
});

// ── webview screenshot ────────────────────────────────────────
cmd('webview screenshot', 'Capture a screenshot from the active Bun.WebView automation session', [
  'pmx-canvas webview screenshot --output ./canvas.png',
  'pmx-canvas webview screenshot --output ./canvas.webp --format webp --quality 80',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('webview screenshot');

  const outputPath = requireFlag(
    flags,
    'output',
    'pmx-canvas webview screenshot --output ./canvas.png',
  );

  const body: Record<string, unknown> = {};
  if (flags.format && flags.format !== true) {
    const format = String(flags.format);
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
      die('Invalid value for --format', 'Use: --format png, jpeg, or webp');
    }
    body.format = format;
  }

  if (flags.quality && flags.quality !== true) {
    const quality = Number(flags.quality);
    if (!Number.isFinite(quality)) {
      die(`Invalid value for --quality: ${String(flags.quality)}`, 'Use a numeric quality, e.g. --quality 80');
    }
    body.quality = quality;
  }

  const base = getBaseUrl();
  const response = await fetch(`${base}/api/workbench/webview/screenshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      die(
        json.error ? String(json.error) : `HTTP ${response.status}`,
        typeof json.hint === 'string' ? json.hint : undefined,
      );
    } catch {
      die(`HTTP ${response.status}: ${text}`);
    }
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  writeFileSync(outputPath, bytes);
  output({
    ok: true,
    output: outputPath,
    bytes: bytes.byteLength,
    mimeType: response.headers.get('Content-Type') ?? 'application/octet-stream',
  });
});

cmd('screenshot', 'Capture a screenshot from the active Bun.WebView automation session', [
  'pmx-canvas screenshot --output ./canvas.png',
  'pmx-canvas screenshot --output ./canvas.webp --format webp --quality 80',
], async (args) => {
  if (args.includes('--help') || args.includes('-h')) return showCommandHelp('screenshot');
  const screenshotCommand = COMMANDS['webview screenshot'];
  if (!screenshotCommand) die('Internal error: webview screenshot command is unavailable.');
  await screenshotCommand.run(args);
});

// ── code-graph ───────────────────────────────────────────────
cmd('code-graph', 'Show auto-detected file dependency graph', [
  'pmx-canvas code-graph',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('code-graph');

  const result = await api('GET', '/api/canvas/code-graph');
  output(result);
});

// ── spatial ──────────────────────────────────────────────────
cmd('spatial', 'Spatial analysis: clusters, reading order, neighborhoods', [
  'pmx-canvas spatial',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('spatial');

  const result = await api('GET', '/api/canvas/spatial-context');
  output(result);
});

// ── watch ────────────────────────────────────────────────────
cmd('watch', 'Watch low-token semantic canvas changes over the existing SSE stream', [
  'pmx-canvas watch',
  'pmx-canvas watch --json',
  'pmx-canvas watch --events context-pin,move-end',
  'pmx-canvas watch --json --events connect --max-events 1',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('watch');

  if (flags.json && flags.compact) {
    die('Use either --json or --compact, not both.');
  }

  const filtersRaw = typeof flags.events === 'string' ? flags.events : undefined;
  const requestedFilters = filtersRaw
    ? Array.from(new Set(filtersRaw.split(',').map((value) => value.trim()).filter((value) => value.length > 0)))
    : [];
  const invalidFilter = requestedFilters.find((value) => !ALL_SEMANTIC_WATCH_EVENT_TYPES.includes(value as typeof ALL_SEMANTIC_WATCH_EVENT_TYPES[number]));
  if (invalidFilter) {
    die(
      `Invalid value in --events: ${invalidFilter}`,
      'Use a comma-separated subset of: context-pin,move-end,group,connect,remove',
    );
  }
  const filters = parseSemanticEventFilter(filtersRaw);
  if (filtersRaw && filters.size === 0) {
    die(
      `Invalid value for --events: ${filtersRaw}`,
      'Use a comma-separated subset of: context-pin,move-end,group,connect,remove',
    );
  }

  const maxEvents = optionalNumberFlag(flags, 'max-events', 'Use a positive integer, e.g. --max-events 1');
  const jsonMode = Boolean(flags.json);
  const reducer = new SemanticWatchReducer();
  const pinned = await api('GET', '/api/canvas/pinned-context') as { nodeIds?: string[] };
  reducer.setInitialPins(Array.isArray(pinned.nodeIds) ? pinned.nodeIds : []);

  const base = getBaseUrl();
  const controller = new AbortController();
  let response: Response;
  try {
    response = await fetch(`${base}/api/workbench/events`, {
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    });
  } catch (error) {
    die(
      `Cannot connect to pmx-canvas event stream at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      'Start the server first: pmx-canvas --no-open',
    );
  }

  if (!response.ok) {
    const text = await response.text();
    die(`Failed to open event stream: HTTP ${response.status}`, text);
  }
  if (!response.body) {
    die('Workbench event stream did not return a readable body.');
  }

  let emitted = 0;
  try {
    for await (const message of parseSseStream(response.body)) {
      const semanticEvents = reducer
        .handleMessage(message)
        .filter((event) => filters.has(event.type));

      for (const event of semanticEvents) {
        console.log(jsonMode ? JSON.stringify(event) : formatCompactWatchEvent(event));
        emitted++;
        if (maxEvents !== undefined && emitted >= maxEvents) {
          controller.abort();
          return;
        }
      }
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    die(
      `Watch stream failed: ${error instanceof Error ? error.message : String(error)}`,
      'Ensure the server is still running and reachable.',
    );
  }
});

// ── serve (delegates back to original CLI) ───────────────────
cmd('serve', 'Start the canvas server', [
  'pmx-canvas serve',
  'pmx-canvas serve --port=8080 --no-open',
  'pmx-canvas serve --demo --theme=light',
  'pmx-canvas --no-open --webview-automation',
], async (_args) => {
  console.log('Use: pmx-canvas [--port=PORT] [--demo] [--no-open] [--theme=THEME] [--webview-automation]');
});

// ── Help ─────────────────────────────────────────────────────

function showCommandHelp(name: string): void {
  const cmd = COMMANDS[name];
  if (!cmd) return;
  console.log(`\npmx-canvas ${name} — ${cmd.help}\n`);
  console.log('Examples:');
  for (const ex of cmd.examples) {
    console.log(`  ${ex}`);
  }
  if (name === 'node add') {
    console.log('\nSchema help:');
    console.log('  pmx-canvas node add --help --type webpage');
    console.log('  pmx-canvas node add --help --type html');
    console.log('  pmx-canvas node add --help --type json-render --component Table');
    console.log('  pmx-canvas node add --help --type graph');
    console.log('  pmx-canvas html primitive schema --summary');
    console.log('  pmx-canvas node add --help --type webpage --json');
    console.log('  Use --strict-size to keep explicit width/height fixed and scroll overflowing content.');
    console.log('\nHTML sidecar flags:');
    console.log('  --summary <text>           Explicit human/agent-readable summary');
    console.log('  --agent-summary <text>     Semantic summary for search, pinned context, and spatial context');
    console.log('  --description <text>       Optional longer semantic description');
    console.log('  --presentation true        Mark raw HTML as an explicit presentation deck');
    console.log('  --slide-title <text>       Add a presentation slide title sidecar');
    console.log('  --embedded-node-id <id>    Link represented/embedded canvas node ID');
  }
  if (name === 'html primitive add' || name === 'html primitive schema') {
    console.log('\nPrimitive flags:');
    console.log('  --kind <name>              Run `pmx-canvas html primitive schema --summary` for the full catalog');
    console.log('  --data-file <path>         JSON object payload for the primitive');
    console.log('  --data-json, --data <json> Inline JSON object payload');
    console.log('  --stdin                    Read JSON object payload from stdin');
  }
  if (name === 'json-render') {
    console.log('\nOptions:');
    console.log('  --schema                  Show json-render catalog schema (default)');
    console.log('  --summary                 Show compact component summaries');
    console.log('  --component <name>        Focus on one component');
    console.log('  --field <name>            Focus on one component prop');
    console.log('  --example, --examples     Print canonical component examples');
  }
  if (name === 'node add' || name === 'graph add' || name === 'validate spec') {
    console.log('\nGraph flags:');
    console.log('  Graph fields accept kebab-case CLI flags and camelCase schema names, e.g. --graph-type/--graphType and --x-key/--xKey');
    console.log('  Use --node-height/--nodeHeight for canvas frame height; use --chart-height for chart content height. --height is kept as a frame-height alias for compatibility.');
    console.log('  Pass --show-legend false to hide legends in compact node layouts.');
  }
  if (name === 'validate spec') {
    console.log('\nHTML primitive flags:');
    console.log('  --type html-primitive --kind <name> --data-file ./payload.json');
  }
  if (name === 'node schema') {
    console.log('\nFilters:');
    console.log('  --summary                 Show compact schema summaries');
    console.log('  --field <name>            Focus on one node field');
    console.log('  --component <name>        Focus on one json-render component');
  }
  if (name === 'validate spec') {
    console.log('\nOutput control:');
    console.log('  --summary                 Return only validation summary metadata');
    console.log('  For --type html-primitive, pass --kind plus optional --data-file/--data-json.');
  }
  if (name === 'snapshot list') {
    console.log('\nOptions:');
    console.log('  --limit <number>          Maximum snapshots to return (default 20)');
    console.log('  --query <text>            Case-insensitive ID/name filter');
    console.log('  --before <timestamp>      Only return snapshots created at or before this ISO timestamp');
    console.log('  --after <timestamp>       Only return snapshots created at or after this ISO timestamp');
    console.log('  --all                     Return all snapshots');
  }
  if (name === 'node update') {
    console.log('\nTrace fields:');
    console.log('  --tool-name, --toolName   Trace tool or operation label');
    console.log('  --category <name>         Trace category, e.g. mcp, file, subagent, other');
    console.log('  --status <status>         Trace status, e.g. running, success, failed');
    console.log('  --duration <text>         Trace duration badge text');
    console.log('  --result-summary, --resultSummary <text>');
    console.log('                            Trace result summary');
    console.log('  --error <text>            Trace error message');
  }
  if (name === 'snapshot gc') {
    console.log('\nOptions:');
    console.log('  --keep <number>           Number of newest snapshots to keep (default 20)');
    console.log('  --dry-run                 Preview deletions without removing files');
    console.log('  --yes                     Confirm deletion');
  }
  if (name === 'web-artifact build') {
    console.log('\nDependencies:');
    console.log('  --deps <list>              Add npm dependencies before bundling, e.g. --deps recharts,zod');
    console.log('\nOutput control:');
    console.log('  --include-logs            Include raw build stdout/stderr in the response');
    console.log('  --verbose                 Alias for --include-logs');
    console.log('  --timeout-ms <number>     Optional init/install/build timeout in milliseconds');
  }
  if (name === 'focus') {
    console.log('\nViewport:');
    console.log('  --no-pan                  Select/raise the node without moving the viewport');
  }
  if (name === 'fit') {
    console.log('\nViewport:');
    console.log('  --width <px>              Viewport width used for fit math (default 1440)');
    console.log('  --height <px>             Viewport height used for fit math (default 900)');
    console.log('  --padding <px>            World-space padding around fitted nodes (default 60)');
    console.log('  --max-scale <scale>       Maximum zoom scale (default 1)');
  }
  if (name === 'screenshot' || name === 'webview screenshot') {
    console.log('\nOptions:');
    console.log('  --output <path>           Required output image path');
    console.log('  --format <type>           png, jpeg, or webp');
    console.log('  --quality <number>        Encoder quality for lossy formats');
    console.log('  Requires an active automation session: pmx-canvas webview start');
  }
  if (name === 'external-app add') {
    console.log('\nOptions:');
    console.log('  --kind excalidraw          External app kind to create');
    console.log('  --title <title>            Node title');
    console.log('  --node-id <id>             Existing Excalidraw app node to update in place');
    console.log('  --elements <json>          Optional Excalidraw elements array JSON');
    console.log('  --elements-json <json>     Optional Excalidraw elements array JSON');
    console.log('  --elements-file <path>     Optional file containing Excalidraw elements JSON');
    console.log('  --initial-file <path>      Alias for --elements-file');
    console.log('  --timeout-ms <number>      Optional downstream MCP timeout for cold starts');
  }
  if (name === 'diagram add') {
    console.log('\nAlias:');
    console.log('  Equivalent to: pmx-canvas external-app add --kind excalidraw ...');
  }
  console.log('');
}

function showTopLevelHelp(): void {
  console.log(`
  pmx-canvas — Agent-native CLI for spatial canvas workbench

Usage:
  pmx-canvas <command> [options]
  pmx-canvas [server-options]

Server:
  pmx-canvas                          Start server + open browser
  pmx-canvas --no-open --demo         Start server headless with sample data
  pmx-canvas --no-open --webview-automation  Start server + headless Bun.WebView automation
  pmx-canvas --mcp                    Run as MCP server (stdio)

Node commands:
  pmx-canvas node add [options]       Add a node
  pmx-canvas node list [--type TYPE]  List all nodes
  pmx-canvas node get <id>            Get a node by ID
  pmx-canvas node update <id> [opts]  Update a node
  pmx-canvas node remove <id>         Remove a node
  pmx-canvas json-render              Show json-render schema/examples
  pmx-canvas graph add [options]      Add a graph node
  pmx-canvas html primitive add        Add an HTML communication primitive
  pmx-canvas html primitive schema     List HTML primitive kinds and shapes
  pmx-canvas diagram add               Add an Excalidraw diagram node

Edge commands:
  pmx-canvas edge add [options]       Add an edge between nodes
  pmx-canvas edge list                List all edges
  pmx-canvas edge remove <id>         Remove an edge

Canvas commands:
  pmx-canvas layout                   Full canvas state (JSON)
  pmx-canvas status                   Quick summary
  pmx-canvas search <query>           Search nodes by content
  pmx-canvas open                     Open the current workbench in a browser
  pmx-canvas arrange [--layout MODE]  Auto-arrange (grid|column|flow)
  pmx-canvas batch [--file FILE]      Run many canvas operations at once
  pmx-canvas validate                 Check collisions and containment issues
  pmx-canvas validate spec            Validate json-render/graph payloads without creating nodes
  pmx-canvas watch [options]          Watch semantic canvas changes over SSE
  pmx-canvas focus <id>               Pan viewport to node
  pmx-canvas fit [id ...]             Fit viewport to canvas or selected nodes
  pmx-canvas screenshot               Save automation screenshot to disk
  pmx-canvas external-app add          Add hosted external apps like Excalidraw
  pmx-canvas webview status           Show WebView automation status
  pmx-canvas webview start [options]  Start or replace automation session
  pmx-canvas webview evaluate         Evaluate JS in automation session
  pmx-canvas webview resize           Resize automation viewport
  pmx-canvas webview screenshot       Save automation screenshot to disk
  pmx-canvas webview stop             Stop automation session
  pmx-canvas web-artifact build       Build bundled web artifact HTML
  pmx-canvas clear --yes              Clear all nodes and edges
  pmx-canvas node schema              Describe running-server node schemas

Context pins:
  pmx-canvas pin <id1> <id2> ...      Set pinned nodes (same as --set)
  pmx-canvas pin --list               List pinned context
  pmx-canvas pin --clear              Clear all pins

History:
  pmx-canvas undo                     Undo last mutation
  pmx-canvas redo                     Redo last undone
  pmx-canvas history                  Show mutation timeline

Snapshots:
  pmx-canvas snapshot save --name X   Save a named snapshot
  pmx-canvas snapshot list            List snapshots
  pmx-canvas snapshot gc --keep 20    Delete old snapshots
  pmx-canvas snapshot restore <id>    Restore from snapshot
  pmx-canvas snapshot diff <id>       Compare current canvas to snapshot
  pmx-canvas snapshot delete <id>     Delete a snapshot

Groups:
  pmx-canvas group create [options]   Create a group
  pmx-canvas group add --group <id>   Add nodes to group
  pmx-canvas group remove <id>        Ungroup children

Analysis:
  pmx-canvas code-graph               File dependency graph
  pmx-canvas spatial                   Spatial clusters & neighborhoods

Global flags:
  --help, -h                          Show help for any command

Environment:
  PMX_CANVAS_URL    Server URL (default: http://localhost:4313)
  PMX_CANVAS_PORT   Client target port when PMX_CANVAS_URL is unset (default: 4313)

Examples:
  pmx-canvas node add --type markdown --title "API Design" --content "# REST API"
  pmx-canvas node add --type webpage --url "https://example.com/docs"
  pmx-canvas node add --type json-render --title "Dashboard" --spec-file ./dashboard.json
  pmx-canvas json-render --schema --summary
  pmx-canvas json-render --example --component Table
  pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx
  pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas graph add --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas html primitive add --kind choice-grid --data-file ./options.json --title "Options"
  pmx-canvas html primitive schema --summary
  pmx-canvas diagram add --title "Architecture"
  pmx-canvas node add --help --type webpage
  pmx-canvas node schema --type json-render
  pmx-canvas node schema --type json-render --component Table --summary
  pmx-canvas node list --type file --ids
  pmx-canvas node get node-abc123 --summary
  pmx-canvas node get node-abc123 --field title --field graphConfig
  pmx-canvas edge add --from node-abc --to node-def --type depends-on
  pmx-canvas edge add --from-search "DVT O3 — GitOps" --to-search "deep work trend" --type relation
  pmx-canvas search "authentication"
  pmx-canvas open
  pmx-canvas fit --width 1440 --height 900
  pmx-canvas layout --summary
  pmx-canvas arrange --layout column
  pmx-canvas batch --file ./canvas-ops.json
  pmx-canvas validate
  pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary
  pmx-canvas history --summary
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx
  pmx-canvas external-app add --kind excalidraw --title "Diagram"
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx --include-logs
  pmx-canvas webview evaluate --script "const title = document.title; return title"
  pmx-canvas snapshot save --name "pre-refactor"
  pmx-canvas clear --dry-run
  cat design.md | pmx-canvas node add --type markdown --title "Design" --stdin
`);
}

// ── Stdin reader ─────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

// ── Router ───────────────────────────────────────────────────

export async function runAgentCli(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showTopLevelHelp();
    return;
  }

  const threeWord = `${args[0]} ${args[1] ?? ''} ${args[2] ?? ''}`.trim();
  if (COMMANDS[threeWord]) {
    await COMMANDS[threeWord].run(args.slice(3));
    return;
  }

  // Try two-word command first (e.g., "node add"), then one-word (e.g., "search")
  const twoWord = `${args[0]} ${args[1] ?? ''}`.trim();
  if (COMMANDS[twoWord]) {
    await COMMANDS[twoWord].run(args.slice(2));
    return;
  }

  const oneWord = args[0];
  if (COMMANDS[oneWord]) {
    await COMMANDS[oneWord].run(args.slice(1));
    return;
  }

  // Unknown command — show help for the resource if it exists
  const resourceCommands = Object.keys(COMMANDS).filter((k) => k.startsWith(oneWord + ' '));
  if (resourceCommands.length > 0) {
    if (args[1] === '--help' || args[1] === '-h') {
      console.log(`\nAvailable "${oneWord}" commands:\n`);
      for (const k of resourceCommands) {
        console.log(`  pmx-canvas ${k.padEnd(20)} ${COMMANDS[k].help}`);
      }
      console.log('\nRun any command with --help for details.\n');
      return;
    }
    const subcommand = args[1];
    const suggestion = subcommand ? RESOURCE_COMMAND_ALIASES[oneWord]?.[subcommand] : undefined;
    const extraHint = subcommand ? RESOURCE_SUBCOMMAND_HINTS[oneWord]?.[subcommand] : undefined;
    const available = resourceCommands
      .map((k) => k.slice(oneWord.length + 1))
      .sort()
      .join(', ');
    const hints = [
      suggestion ? `Did you mean: pmx-canvas ${oneWord} ${suggestion}?` : undefined,
      extraHint,
      `Available subcommands: ${available}`,
    ].filter((hint): hint is string => typeof hint === 'string');
    die(
      subcommand
        ? `Unknown ${oneWord} subcommand: "${subcommand}".`
        : `Missing ${oneWord} subcommand.`,
      hints.join(' '),
    );
  }

  die(`Unknown command: ${oneWord}`, 'Run: pmx-canvas --help');
}
