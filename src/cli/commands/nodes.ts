// Node/content commands: node add|schema|list|get|update|remove, json-render,
// html primitive add|schema, and graph add.

import {
  applyCommonGeometryFlags,
  applyStrictSizeFlags,
  buildGraphRequestBody,
  buildHtmlPrimitiveRequestBody,
  buildJsonRenderRequestBody,
  cmd,
  die,
  getStringFlag,
  invokeOperation,
  isRecord,
  optionalBooleanFlag,
  optionalFiniteFlag,
  optionalPositiveFiniteFlag,
  optionalPositiveFiniteFlagWithAliases,
  output,
  parseFlags,
  parseJsonValue,
  readOptionalTextInput,
  readStdin,
  runWebArtifactBuildCommand,
  showCommandHelp,
} from '../shared.js';

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
    graphTypes: Array<'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'radar' | 'stacked-bar' | 'composed'>;
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

function collectRequestedFields(args: string[], flags: Record<string, string | true>): string[] {
  const requested = [
    ...collectFlagValues(args, 'field'),
    ...(typeof flags.fields === 'string'
      ? flags.fields
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
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
    body.spec = parseJsonValue(
      specRaw,
      'JSON spec',
      'Use: pmx-canvas node update <node-id> --spec-file ./new-spec.json',
    );
  }

  const graphPatch = await buildGraphRequestBody(flags, { requireData: false, allowStdin: false });
  for (const [key, value] of Object.entries(graphPatch)) {
    body[key === 'height' ? 'chartHeight' : key] = value;
  }
}

async function loadCanvasSchema(): Promise<CanvasSchemaResponse> {
  const result = await invokeOperation('schema.describe', {});
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
    const aliases = field.aliases?.length ? ` (aliases: ${field.aliases.map((alias) => `--${alias}`).join(', ')})` : '';
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
        die(
          `Unknown json-render component: ${componentName}`,
          'Run: pmx-canvas node schema --type json-render --summary',
        );
      }
      const requestedField = getStringFlag(flags, 'field');
      if (requestedField) {
        const prop = component.props.find((entry) => entry.name === requestedField);
        if (!prop) {
          die(
            `Unknown json-render prop: ${requestedField}`,
            `Run: pmx-canvas node schema --type json-render --component ${componentName}`,
          );
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
      die(
        `Unknown json-render prop: ${requestedField}`,
        `Run: pmx-canvas node schema --type json-render --component ${componentName}`,
      );
    }
    return {
      component: componentName,
      prop,
    };
  }

  return flags.summary ? summarizeJsonRenderComponent(component) : component;
}

function summarizeHtmlPrimitive(
  primitive: NonNullable<CanvasSchemaResponse['htmlPrimitives']>[number],
): Record<string, unknown> {
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

// ── node add ─────────────────────────────────────────────────
cmd(
  'node add',
  'Add a node to the canvas',
  [
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
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showNodeAddTypeHelp(flags);

    const type = (flags.type as string) || 'markdown';

    if (type === 'json-render') {
      const result = await invokeOperation('jsonrender.add', await buildJsonRenderRequestBody(flags));
      output(result);
      return;
    }

    if (type === 'graph') {
      const result = await invokeOperation('graph.add', await buildGraphRequestBody(flags));
      output(result);
      return;
    }

    if (type === 'web-artifact') {
      await runWebArtifactBuildCommand(flags);
      return;
    }

    if (type === 'html-primitive') {
      const result = await invokeOperation('node.add', await buildHtmlPrimitiveRequestBody(flags));
      output(result);
      return;
    }

    if (type === 'html' && getStringFlag(flags, 'primitive', 'kind')) {
      const result = await invokeOperation('node.add', await buildHtmlPrimitiveRequestBody(flags));
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
      if (optionalBooleanFlag(flags, 'presentation', 'Use --presentation true or --presentation false') === true)
        body.presentation = true;
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
        const value = getStringFlag(
          flags,
          field,
          field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
        );
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

    const result = await invokeOperation('node.add', body);
    output(result);
  },
);

cmd(
  'json-render',
  'Show json-render schema and canonical examples',
  [
    'pmx-canvas json-render --schema --summary',
    'pmx-canvas json-render --examples',
    'pmx-canvas json-render --example --component Table',
    'pmx-canvas json-render --schema --component Badge --field variant',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('json-render');

    const schema = await loadCanvasSchema();
    const componentName = getStringFlag(flags, 'component');
    const fieldName = getStringFlag(flags, 'field');

    if (flags.example || flags.examples) {
      if (fieldName)
        die(
          '--field is only supported with --schema.',
          'Use: pmx-canvas json-render --schema --component Table --field rows',
        );
      if (componentName) {
        const component = schema.jsonRender.components.find((entry) => entry.type === componentName);
        if (!component)
          die(`Unknown json-render component: ${componentName}`, 'Run: pmx-canvas json-render --schema --summary');
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
  },
);

cmd(
  'html primitive add',
  'Create a reusable sandboxed HTML communication primitive',
  [
    'pmx-canvas html primitive add --kind choice-grid --data-file ./options.json --title "Options"',
    'pmx-canvas html primitive add --kind plan-timeline --data-json \'{"milestones":[{"title":"Ship","detail":"Implement and verify","status":"next"}]}\'',
    'pmx-canvas html primitive add --kind triage-board --data-file ./tickets.json --strict-size',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('html primitive add');
    const result = await invokeOperation('node.add', await buildHtmlPrimitiveRequestBody(flags));
    output(result);
  },
);

cmd(
  'html primitive schema',
  'Describe reusable HTML communication primitives',
  [
    'pmx-canvas html primitive schema --summary',
    'pmx-canvas html primitive schema --kind choice-grid',
    'pmx-canvas html primitive schema --kind triage-board --summary',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('html primitive schema');
    const schema = await loadCanvasSchema();
    output(filterHtmlPrimitiveSchemaView(schema, flags));
  },
);

cmd(
  'graph add',
  'Add a graph node to the canvas',
  [
    'pmx-canvas graph add --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
    'pmx-canvas graph add --graphType composed --data \'[{"day":"Mon","visits":10,"conversion":0.4}]\' --xKey day --barKey visits --lineKey conversion',
    'pmx-canvas node add --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('graph add');

    const result = await invokeOperation('graph.add', await buildGraphRequestBody(flags));
    output(result);
  },
);

cmd(
  'node schema',
  'Describe server-supported node create schemas and canonical examples',
  [
    'pmx-canvas node schema',
    'pmx-canvas node schema --type webpage',
    'pmx-canvas node schema --type json-render',
    'pmx-canvas json-render --schema --summary',
    'pmx-canvas node schema --type json-render --component Table',
    'pmx-canvas node schema --type webpage --field url',
    'pmx-canvas node schema --summary',
  ],
  async (args) => {
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
  },
);

// ── node list ────────────────────────────────────────────────
cmd(
  'node list',
  'List all nodes on the canvas',
  [
    'pmx-canvas node list',
    'pmx-canvas node list --type markdown',
    'pmx-canvas node list --type mcp-app',
    'pmx-canvas node list --ids',
  ],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('node list');

    const layout = (await invokeOperation('layout.get', {})) as { nodes: Array<Record<string, unknown>> };
    let nodes = layout.nodes;

    if (flags.type && flags.type !== true) {
      nodes = nodes.filter((n) => n.type === flags.type || n.kind === flags.type);
    }

    if (flags.ids) {
      output(nodes.map((n) => n.id));
    } else {
      const shouldSummarize = flags.summary === true || flags.compact === true || flags.type === 'mcp-app';
      output(shouldSummarize ? nodes.map((node) => summarizeNodeResult(node)) : nodes);
    }
  },
);

// ── node get ─────────────────────────────────────────────────
cmd(
  'node get',
  'Get a node by ID',
  [
    'pmx-canvas node get <node-id>',
    'pmx-canvas node get node-abc123',
    'pmx-canvas node get node-abc123 --summary',
    'pmx-canvas node get node-abc123 --field title --field graphConfig',
  ],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('node get');

    const id = positional[0];
    if (!id) die('Missing node ID', 'pmx-canvas node get <node-id>');

    const result = (await invokeOperation('node.get', { id })) as Record<string, unknown>;
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
  },
);

// ── node update ──────────────────────────────────────────────
cmd(
  'node update',
  'Update a node by ID',
  [
    'pmx-canvas node update <node-id> --title "New Title"',
    'pmx-canvas node update <node-id> --content "Updated content"',
    'pmx-canvas node update <node-id> --title "Moved" --x 500 --y 300',
    'pmx-canvas node update <node-id> --width 840 --height 620',
    'pmx-canvas node update <node-id> --spec-file ./dashboard.json',
    'pmx-canvas node update <graph-id> --data-file ./metrics.json --chart-height 420',
    'pmx-canvas node update <node-id> --pinned true',
    'pmx-canvas node update <node-id> --dock-position right',
    'pmx-canvas node update <node-id> --dock-position none   # undock back to the canvas',
    'pmx-canvas node update <node-id> --lock-arrange',
  ],
  async (args) => {
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
    const arrangeLocked = flags['lock-arrange'] ? true : flags['unlock-arrange'] ? false : undefined;

    applyStrictSizeFlags(body, flags);

    for (const field of TRACE_NODE_FIELDS) {
      const value = getStringFlag(
        flags,
        field,
        field.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`),
      );
      if (value !== undefined) body[field] = value;
    }

    if (
      x !== undefined ||
      y !== undefined ||
      width !== undefined ||
      frameHeight !== undefined ||
      arrangeLocked !== undefined
    ) {
      const existing = (await invokeOperation('node.get', { id })) as {
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

    // --dock-position left|right|none : dock a node into the top HUD or undock it.
    // `none`/`null`/empty map to JS null (undock). Assigned with a !== undefined
    // guard so the null survives JSON.stringify to the server (which accepts a
    // top-level dockPosition: null). HTTP PATCH already supports this; this is the
    // CLI path the report (#40) found missing.
    const dockRaw = getStringFlag(flags, 'dock-position', 'dockPosition');
    let dockPosition: 'left' | 'right' | null | undefined;
    if (dockRaw !== undefined) {
      const v = dockRaw.trim().toLowerCase();
      if (v === 'left' || v === 'right') dockPosition = v;
      else if (v === 'none' || v === 'null' || v === '') dockPosition = null;
      else die(`Invalid --dock-position "${dockRaw}".`, 'Use left, right, or none (to undock).');
    }
    if (dockPosition !== undefined) body.dockPosition = dockPosition;

    if (Object.keys(body).length === 0) {
      die(
        'No updates specified',
        'Use --title, --content, --x, --y, --width, --height, --strict-size, --pinned, --dock-position, trace fields, --lock-arrange, --unlock-arrange, or --stdin',
      );
    }

    const result = await invokeOperation('node.update', { id, ...body });
    output(result);
  },
);

// ── node remove ──────────────────────────────────────────────
cmd(
  'node remove',
  'Remove a node from the canvas',
  ['pmx-canvas node remove <node-id>', 'pmx-canvas node remove node-abc123'],
  async (args) => {
    const { positional, flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('node remove');

    const id = positional[0];
    if (!id) die('Missing node ID', 'pmx-canvas node remove <node-id>');

    const result = await invokeOperation('node.remove', { id });
    output(result);
  },
);
