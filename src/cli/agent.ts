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

import { readFileSync, writeFileSync } from 'node:fs';
import { openUrlInExternalBrowser } from '../server/server.js';
import {
  ALL_SEMANTIC_WATCH_EVENT_TYPES,
  formatCompactWatchEvent,
  parseSemanticEventFilter,
  parseSseStream,
  SemanticWatchReducer,
} from './watch.js';

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_PORT = 4313;

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
  console.log(JSON.stringify(data, null, 2));
}

async function api(
  method: string,
  path: string,
  body?: Record<string, unknown>,
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
    'help', 'h', 'ids', 'stdin', 'yes', 'list', 'clear', 'set', 'animated', 'dry-run',
    'no-open-in-canvas', 'lock-arrange', 'unlock-arrange', 'json', 'compact', 'summary',
    'verbose', 'include-logs',
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
      flags[arg.slice(1)] = true;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseStringListFlag(
  flags: Record<string, string | true>,
  name: string,
  hint: string,
): string[] | undefined {
  const raw = getStringFlag(flags, name);
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

async function buildJsonRenderRequestBody(
  flags: Record<string, string | true>,
): Promise<Record<string, unknown>> {
  const hint =
    'Use: pmx-canvas node add --type json-render --title "Ops Dashboard" --spec-file ./dashboard.json';
  const title = typeof flags.title === 'string' ? flags.title.trim() : '';
  if (!title) {
    die('json-render nodes require --title.', hint);
  }

  const rawSpec = await readTextInput(flags, {
    fileFlags: ['spec-file'],
    valueFlags: ['spec-json'],
    allowStdin: true,
    label: 'JSON spec',
    hint,
    requiredMessage: 'json-render nodes require --spec-file, --spec-json, or --stdin.',
  });

  const spec = parseJsonValue(rawSpec, 'JSON spec', hint);
  const body: Record<string, unknown> = { title, spec };
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 840',
    height: 'Use a positive number, e.g. --height 620',
  });
  return body;
}

async function buildGraphRequestBody(
  flags: Record<string, string | true>,
): Promise<Record<string, unknown>> {
  const hint =
    'Use: pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value';
  const rawData = await readTextInput(flags, {
    fileFlags: ['data-file'],
    valueFlags: ['data-json'],
    allowStdin: true,
    label: 'graph JSON dataset',
    hint,
    requiredMessage: 'Graph nodes require --data-file, --data-json, or --stdin JSON data.',
  });
  const data = parseRecordArrayJson(rawData, hint);

  const body: Record<string, unknown> = {
    graphType: getStringFlag(flags, 'graph-type') ?? 'line',
    data,
  };
  if (typeof flags.title === 'string') body.title = flags.title;
  if (typeof flags['x-key'] === 'string') body.xKey = flags['x-key'];
  if (typeof flags['y-key'] === 'string') body.yKey = flags['y-key'];
  if (typeof flags['z-key'] === 'string') body.zKey = flags['z-key'];
  if (typeof flags['name-key'] === 'string') body.nameKey = flags['name-key'];
  if (typeof flags['value-key'] === 'string') body.valueKey = flags['value-key'];
  if (typeof flags['axis-key'] === 'string') body.axisKey = flags['axis-key'];
  const metrics = parseStringListFlag(flags, 'metrics', 'Use a comma-separated list, e.g. --metrics north,south');
  const series = parseStringListFlag(flags, 'series', 'Use a comma-separated list, e.g. --series north,south');
  if (metrics) body.metrics = metrics;
  if (series) body.series = series;
  if (typeof flags['bar-key'] === 'string') body.barKey = flags['bar-key'];
  if (typeof flags['line-key'] === 'string') body.lineKey = flags['line-key'];
  if (flags.aggregate === 'sum' || flags.aggregate === 'count' || flags.aggregate === 'avg') {
    body.aggregate = flags.aggregate;
  }
  if (typeof flags.color === 'string') body.color = flags.color;
  if (typeof flags['bar-color'] === 'string') body.barColor = flags['bar-color'];
  if (typeof flags['line-color'] === 'string') body.lineColor = flags['line-color'];

  const chartHeight = optionalPositiveFiniteFlag(flags, 'chart-height', 'Use a positive number, e.g. --chart-height 300');
  const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 500');
  const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 300');
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 760');
  const nodeHeight = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 520');
  if (chartHeight !== undefined) body.height = chartHeight;
  if (x !== undefined) body.x = x;
  if (y !== undefined) body.y = y;
  if (width !== undefined) body.width = width;
  if (nodeHeight !== undefined) body.nodeHeight = nodeHeight;
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
  if (flags['no-open-in-canvas']) body.openInCanvas = false;
  if (flags.verbose || flags['include-logs']) body.includeLogs = true;

  const timeoutMs = optionalPositiveFiniteFlag(flags, 'timeout-ms', 'Use a positive number, e.g. --timeout-ms 600000');
  if (timeoutMs !== undefined) body.timeoutMs = timeoutMs;

  return body;
}

async function runWebArtifactBuildCommand(flags: Record<string, string | true>): Promise<void> {
  const result = await api('POST', '/api/canvas/web-artifact', await buildWebArtifactRequestBody(flags));
  output(result);
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

// ── Commands ─────────────────────────────────────────────────

const COMMANDS: Record<string, { run: (args: string[]) => Promise<void>; help: string; examples: string[] }> = {};

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

  const body: Record<string, unknown> = { type };
  if (flags.title) body.title = flags.title;
  const webpageUrl = getStringFlag(flags, 'url');
  if (type === 'webpage' && webpageUrl) {
    body.url = webpageUrl;
  } else if (flags.content) {
    body.content = flags.content;
  }
  applyCommonGeometryFlags(body, flags, {
    x: 'Use a finite number, e.g. --x 500',
    y: 'Use a finite number, e.g. --y 300',
    width: 'Use a positive number, e.g. --width 500',
    height: 'Use a positive number, e.g. --height 280',
  });

  // Support --stdin for piping content
  if (flags.stdin) {
    if (type === 'webpage') {
      body.url = await readStdin();
    } else {
      body.content = await readStdin();
    }
  }

  const result = await api('POST', '/api/canvas/node', body);
  output(result);
});

cmd('node schema', 'Describe server-supported node create schemas and canonical examples', [
  'pmx-canvas node schema',
  'pmx-canvas node schema --type webpage',
  'pmx-canvas node schema --type json-render',
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
    nodes = nodes.filter((n) => n.type === flags.type);
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
  'pmx-canvas node update <node-id> --lock-arrange',
], async (args) => {
  const { positional, flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('node update');

  const id = positional[0];
  if (!id) die('Missing node ID', 'pmx-canvas node update <node-id> --title "New Title"');

  const body: Record<string, unknown> = {};
  if (flags.title && flags.title !== true) body.title = flags.title;
  if (flags.content && flags.content !== true) body.content = flags.content;
  if (flags.stdin) body.content = await readStdin();

  const x = optionalFiniteFlag(flags, 'x', 'Use a finite number, e.g. --x 500');
  const y = optionalFiniteFlag(flags, 'y', 'Use a finite number, e.g. --y 300');
  const width = optionalPositiveFiniteFlag(flags, 'width', 'Use a positive number, e.g. --width 840');
  const height = optionalPositiveFiniteFlag(flags, 'height', 'Use a positive number, e.g. --height 620');
  if (flags['lock-arrange'] && flags['unlock-arrange']) {
    die('Use either --lock-arrange or --unlock-arrange, not both.');
  }
  const arrangeLocked = flags['lock-arrange']
    ? true
    : flags['unlock-arrange']
      ? false
      : undefined;

  if (x !== undefined || y !== undefined || width !== undefined || height !== undefined || arrangeLocked !== undefined) {
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

    if (width !== undefined || height !== undefined) {
      body.size = {
        width: width ?? existing.size.width,
        height: height ?? existing.size.height,
      };
    }

    if (arrangeLocked !== undefined) {
      body.data = {
        ...existing.data,
        arrangeLocked,
      };
    }
  }

  if (Object.keys(body).length === 0) {
    die(
      'No updates specified',
      'Use --title, --content, --x, --y, --width, --height, --lock-arrange, --unlock-arrange, or --stdin',
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
    const t = n.type as string;
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

  const result = await api('POST', '/api/canvas/focus', { id });
  output(result);
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
cmd('snapshot list', 'List all saved snapshots', [
  'pmx-canvas snapshot list',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('snapshot list');

  const result = await api('GET', '/api/canvas/snapshots');
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
  'pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary',
], async (args) => {
  const { flags } = parseFlags(args);
  if (flags.help || flags.h) return showCommandHelp('validate spec');

  const type = getStringFlag(flags, 'type');
  if (type !== 'json-render' && type !== 'graph') {
    die('validate spec requires --type json-render or --type graph.');
  }

  const body = type === 'json-render'
    ? { type, spec: (await buildJsonRenderRequestBody({ ...flags, title: String(flags.title ?? 'Validation') })).spec }
    : { type, ...(await buildGraphRequestBody(flags)) };

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

  const result = await api('POST', '/api/workbench/webview/start', body);
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
    expression = `(() => {\n${script}\n})()`;
  } else if (typeof flags.script === 'string') {
    expression = `(() => {\n${flags.script}\n})()`;
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
    console.log('  pmx-canvas node add --help --type json-render --component Table');
    console.log('  pmx-canvas node add --help --type webpage --json');
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
  }
  if (name === 'web-artifact build') {
    console.log('\nOutput control:');
    console.log('  --include-logs            Include raw build stdout/stderr in the response');
    console.log('  --verbose                 Alias for --include-logs');
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
  pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx
  pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
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
  pmx-canvas layout --summary
  pmx-canvas arrange --layout column
  pmx-canvas batch --file ./canvas-ops.json
  pmx-canvas validate
  pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas validate spec --type json-render --spec-file ./dashboard.json --summary
  pmx-canvas history --summary
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx
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
    console.log(`\nAvailable "${oneWord}" commands:\n`);
    for (const k of resourceCommands) {
      console.log(`  pmx-canvas ${k.padEnd(20)} ${COMMANDS[k].help}`);
    }
    console.log('\nRun any command with --help for details.\n');
    return;
  }

  die(`Unknown command: ${oneWord}`, 'Run: pmx-canvas --help');
}
