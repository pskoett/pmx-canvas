import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAppHtml } from '@json-render/mcp/build-app-html';
import { allComponentDefinitions, catalog, validateShadcnElementProps, type JsonRenderIssue } from './catalog.js';

export interface JsonRenderSpec {
  root: string;
  elements: Record<string, unknown>;
  state?: Record<string, unknown>;
}

export interface JsonRenderNodeInput {
  title: string;
  spec: unknown;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface GraphNodeInput {
  title?: string;
  graphType: string;
  data: Array<Record<string, unknown>>;
  xKey?: string;
  yKey?: string;
  nameKey?: string;
  valueKey?: string;
  aggregate?: 'sum' | 'count' | 'avg';
  color?: string;
  height?: number;
  x?: number;
  y?: number;
  width?: number;
  heightPx?: number;
}

export const JSON_RENDER_NODE_SIZE = { width: 840, height: 620 };
export const GRAPH_NODE_SIZE = { width: 760, height: 520 };

const GRAPH_TYPE_ALIASES: Record<string, 'LineChart' | 'BarChart' | 'PieChart'> = {
  line: 'LineChart',
  linechart: 'LineChart',
  chart: 'LineChart',
  graph: 'LineChart',
  bar: 'BarChart',
  barchart: 'BarChart',
  pie: 'PieChart',
  piechart: 'PieChart',
};

const COERCIBLE_STRING_PROPS = [
  'title',
  'text',
  'message',
  'label',
  'name',
  'content',
  'description',
  'placeholder',
] as const;

let rebuildInFlight: Promise<void> | null = null;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function hasString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function bundleDir(): string {
  const candidates = [
    join(import.meta.dir, '..', '..', 'dist', 'json-render'),
    join(process.cwd(), 'dist', 'json-render'),
  ];
  for (const dir of candidates) {
    if (existsSync(join(dir, 'index.js'))) return dir;
  }
  return candidates[candidates.length - 1];
}

function escapeInlineScriptSource(source: string): string {
  return source.replace(/<\/script/gi, '<\\/script');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildErrorHtml(message: string): string {
  const safe = escapeHtml(message);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>PMX Canvas json-render error</title>
  </head>
  <body style="margin:0;background:#0b1120;color:#f8fafc;font:14px/1.5 system-ui,sans-serif;">
    <main style="padding:20px;">
      <h1 style="margin:0 0 10px;font-size:16px;">json-render unavailable</h1>
      <pre style="white-space:pre-wrap;margin:0;">${safe}</pre>
    </main>
  </body>
</html>`;
}

function rebuildJsonRenderBundle(): Promise<void> {
  if (rebuildInFlight) return rebuildInFlight;
  rebuildInFlight = new Promise<void>((resolvePromise) => {
    const child = spawn('bun', ['run', 'build:json-render'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 60_000);
    child.on('close', () => {
      clearTimeout(timer);
      rebuildInFlight = null;
      resolvePromise();
    });
    child.on('error', () => {
      clearTimeout(timer);
      rebuildInFlight = null;
      resolvePromise();
    });
  });
  return rebuildInFlight;
}

async function ensureJsonRenderBundle(): Promise<void> {
  const dir = bundleDir();
  const jsPath = join(dir, 'index.js');
  const cssPath = join(dir, 'index.css');
  // The renderer bundle is shipped in dist/ and built explicitly via bun run build.
  // Avoid live source-vs-dist rebuild checks here because Bun's bundler can stall on
  // the @json-render/shadcn dependency graph during request-time viewer generation.
  const needsBuild =
    !existsSync(jsPath) ||
    !existsSync(cssPath) ||
    process.env.PMX_CANVAS_FORCE_JSON_RENDER_REBUILD === '1';

  if (needsBuild) {
    await rebuildJsonRenderBundle();
  }
}

function formatValidationError(
  error: { issues?: Array<{ path?: PropertyKey[]; message?: string }> } | undefined,
): string {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (issues.length === 0) return 'Invalid json-render spec.';

  const summary = issues
    .slice(0, 5)
    .map((issue) => {
      const path = Array.isArray(issue.path) && issue.path.length > 0 ? issue.path.join('.') : 'spec';
      return `${path}: ${issue.message ?? 'invalid value'}`;
    })
    .join('; ');

  const extra = issues.length > 5 ? `; +${issues.length - 5} more issue(s)` : '';
  return `Invalid json-render spec: ${summary}${extra}`;
}

function stripNullishDeep(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return value.map((item) => stripNullishDeep(item)).filter((item) => item !== undefined);
  }
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, nested]) => {
      const normalized = stripNullishDeep(nested);
      return normalized === undefined ? [] : [[key, normalized]];
    }),
  );
}

function normalizeLabelArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item, index) => {
    if (hasString(item)) return item;
    const record = asRecord(item);
    if (record) {
      if (hasString(record.label)) return record.label;
      if (hasString(record.value)) return record.value;
    }
    return `Option ${index + 1}`;
  });
}

function normalizeItemArray(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item, index) => {
    if (hasString(item)) return { label: item, value: item };
    const record = asRecord(item);
    const label = hasString(record?.label) ? record.label : hasString(record?.text) ? record.text : null;
    const resolvedValue = hasString(record?.value) ? record.value : label ?? `option-${index + 1}`;
    return {
      label: label ?? resolvedValue,
      value: resolvedValue,
    };
  });
}

function normalizeStringMatrix(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((row) => (
    Array.isArray(row)
      ? row.map((cell) => String(cell ?? ''))
      : [String(row ?? '')]
  ));
}

function normalizeButtonVariant(value: unknown): unknown {
  if (value === 'default') return 'primary';
  if (value === 'outline') return 'secondary';
  if (value === 'destructive') return 'danger';
  return value;
}

function deriveElementName(elementKey: string): string {
  const normalized = elementKey.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'field';
}

const COMPONENT_KEYS = Object.keys(allComponentDefinitions);
const TYPE_ALIASES: Record<string, string> = {
  NativePanel: 'Card',
  Panel: 'Card',
  Container: 'Stack',
  Section: 'Card',
  FormField: 'Input',
  Paragraph: 'Text',
  Label: 'Text',
  Header: 'Heading',
  Title: 'Heading',
  Chart: 'LineChart',
  Line: 'LineChart',
  Graph: 'LineChart',
  Bar: 'BarChart',
  Pie: 'PieChart',
};
let canonicalTypeMap: Map<string, string> | null = null;

function buildCanonicalTypeMap(componentKeys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const key of componentKeys) {
    map.set(key.toLowerCase().replace(/[-_\s]/g, ''), key);
  }
  for (const [alias, canonical] of Object.entries(TYPE_ALIASES)) {
    map.set(alias.toLowerCase().replace(/[-_\s]/g, ''), canonical);
  }
  return map;
}

function normalizeElementType(rawType: string): string {
  if (COMPONENT_KEYS.includes(rawType)) return rawType;
  if (!canonicalTypeMap) canonicalTypeMap = buildCanonicalTypeMap(COMPONENT_KEYS);
  const normalized = rawType.toLowerCase().replace(/[-_\s]/g, '');
  return canonicalTypeMap.get(normalized) ?? 'Card';
}

function normalizeElementProps(
  elementKey: string,
  type: string,
  rawProps: Record<string, unknown>,
): Record<string, unknown> {
  const props = (stripNullishDeep(rawProps) as Record<string, unknown> | undefined) ?? {};

  for (const key of COERCIBLE_STRING_PROPS) {
    if (key in props && typeof props[key] !== 'string' && props[key] !== undefined) {
      props[key] = String(props[key]);
    }
  }

  if (!hasString(props.name) && ['Input', 'Textarea', 'Select', 'Checkbox', 'Radio', 'Switch'].includes(type)) {
    props.name = deriveElementName(elementKey);
  }

  if (!hasString(props.text) && hasString(props.content) && ['Text', 'Heading', 'Badge'].includes(type)) {
    props.text = props.content;
  }

  if (type === 'Select' || type === 'Radio') {
    if (!Array.isArray(props.options) && Array.isArray(props.items)) {
      props.options = normalizeLabelArray(props.items);
    } else if (Array.isArray(props.options)) {
      props.options = normalizeLabelArray(props.options);
    }
  }

  if (type === 'ToggleGroup') {
    if (!Array.isArray(props.items) && Array.isArray(props.options)) {
      props.items = normalizeItemArray(props.options);
    } else if (Array.isArray(props.items)) {
      props.items = normalizeItemArray(props.items);
    }
  }

  if (type === 'ButtonGroup') {
    if (!Array.isArray(props.buttons) && Array.isArray(props.items)) {
      props.buttons = normalizeItemArray(props.items);
    } else if (!Array.isArray(props.buttons) && Array.isArray(props.options)) {
      props.buttons = normalizeItemArray(props.options);
    } else if (Array.isArray(props.buttons)) {
      props.buttons = normalizeItemArray(props.buttons);
    }
  }

  if (type === 'DropdownMenu') {
    if (!Array.isArray(props.items) && Array.isArray(props.options)) {
      props.items = normalizeItemArray(props.options);
    } else if (Array.isArray(props.items)) {
      props.items = normalizeItemArray(props.items);
    }
  }

  if (type === 'Tabs') {
    if (!Array.isArray(props.tabs) && Array.isArray(props.items)) {
      props.tabs = normalizeItemArray(props.items);
    } else if (Array.isArray(props.tabs)) {
      props.tabs = normalizeItemArray(props.tabs);
    }
  }

  if (type === 'Button') {
    props.variant = normalizeButtonVariant(props.variant);
  }

  if (type === 'Table') {
    if (Array.isArray(props.columns)) {
      props.columns = props.columns.map((column) => String(column ?? ''));
    }
    if (Array.isArray(props.rows)) {
      props.rows = normalizeStringMatrix(props.rows);
    }
  }

  return props;
}

function normalizeSpec(spec: Record<string, unknown>): Record<string, unknown> {
  const elements = asRecord(spec.elements);
  if (!elements) return spec;

  let changed = false;
  const normalizedElements: Record<string, unknown> = {};

  for (const [elementKey, rawElement] of Object.entries(elements)) {
    const element = asRecord(rawElement);
    if (!element || typeof element.type !== 'string') {
      normalizedElements[elementKey] = rawElement;
      continue;
    }

    const resolvedType = normalizeElementType(element.type);
    const rawProps = asRecord(element.props) ?? {};
    const normalizedProps = normalizeElementProps(elementKey, resolvedType, rawProps);
    const normalizedChildren = Array.isArray(element.children)
      ? element.children.filter((child: unknown) => typeof child === 'string')
      : [];
    const elementChanged =
      resolvedType !== element.type ||
      JSON.stringify(normalizedProps) !== JSON.stringify(rawProps) ||
      !Array.isArray(element.children) ||
      normalizedChildren.length !== element.children.length;

    normalizedElements[elementKey] = elementChanged
      ? {
          ...element,
          type: resolvedType,
          props: normalizedProps,
          children: normalizedChildren,
        }
      : rawElement;
    changed ||= elementChanged;
  }

  return changed ? { ...spec, elements: normalizedElements } : spec;
}

export function normalizeAndValidateJsonRenderSpec(spec: unknown): JsonRenderSpec {
  const specRecord = asRecord(spec);
  if (!specRecord || typeof specRecord.root !== 'string' || !asRecord(specRecord.elements)) {
    throw new Error('Missing root and elements in spec.');
  }

  const normalizedSpec = normalizeSpec(specRecord);
  const validation = catalog.validate(normalizedSpec);
  if (!validation.success || !validation.data) {
    throw new Error(formatValidationError(validation.error));
  }

  const propsValidation = validateShadcnElementProps(validation.data);
  if (!propsValidation.success || !propsValidation.data) {
    throw new Error(formatValidationError(propsValidation.error));
  }

  return propsValidation.data as JsonRenderSpec;
}

export function normalizeGraphType(value: string): 'LineChart' | 'BarChart' | 'PieChart' {
  const normalized = value.toLowerCase().replace(/[-_\s]/g, '');
  return GRAPH_TYPE_ALIASES[normalized] ?? 'LineChart';
}

export function buildGraphSpec(input: GraphNodeInput): JsonRenderSpec {
  const title = input.title?.trim() || 'Graph';
  const chartType = normalizeGraphType(input.graphType);
  if (!Array.isArray(input.data)) {
    throw new Error('Graph data must be an array of objects.');
  }

  const chartProps: Record<string, unknown> = {
    data: input.data,
    height: input.height ?? 320,
  };

  if (chartType === 'PieChart') {
    chartProps.nameKey = input.nameKey ?? 'name';
    chartProps.valueKey = input.valueKey ?? 'value';
  } else {
    chartProps.xKey = input.xKey ?? 'label';
    chartProps.yKey = input.yKey ?? 'value';
    chartProps.aggregate = input.aggregate ?? null;
    chartProps.color = input.color ?? null;
  }

  return normalizeAndValidateJsonRenderSpec({
    root: 'card',
    elements: {
      card: {
        type: 'Card',
        props: {
          title,
          description: null,
          maxWidth: 'full',
          centered: false,
        },
        children: ['chart'],
      },
      chart: {
        type: chartType,
        props: chartProps,
        children: [],
      },
    },
  });
}

export function createJsonRenderNodeData(
  nodeId: string,
  title: string,
  spec: JsonRenderSpec,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title,
    spec,
    url: `/api/canvas/json-render/view?nodeId=${encodeURIComponent(nodeId)}`,
    trustedDomain: true,
    sourceServer: 'pmx-canvas',
    hostMode: 'hosted',
    ...extra,
  };
}

export async function buildJsonRenderViewerHtml(options: {
  title: string;
  spec: JsonRenderSpec;
  theme?: 'dark' | 'light' | 'high-contrast';
}): Promise<string> {
  try {
    await ensureJsonRenderBundle();
    const dir = bundleDir();
    const jsPath = join(dir, 'index.js');
    const cssPath = join(dir, 'index.css');
    const jsBundle = existsSync(jsPath)
      ? readFileSync(jsPath, 'utf-8')
      : 'document.body.innerHTML = "<pre>json-render bundle missing</pre>";';
    const cssBundle = existsSync(cssPath) ? readFileSync(cssPath, 'utf-8') : '';
    const boot = [
      `window.__PMX_CANVAS_JSON_RENDER_SPEC__ = ${JSON.stringify(options.spec)};`,
      ...(options.theme ? [`window.__PMX_CANVAS_JSON_RENDER_THEME__ = ${JSON.stringify(options.theme)};`] : []),
      jsBundle,
    ].join('\n');
    return buildAppHtml({
      title: options.title,
      css: cssBundle,
      js: escapeInlineScriptSource(boot),
      head: '<meta name="color-scheme" content="light dark" />',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return buildErrorHtml(`Failed to load the json-render viewer bundle.\n\n${message}`);
  }
}
