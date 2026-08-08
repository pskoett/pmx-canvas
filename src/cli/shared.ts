/**
 * Shared core for the agent-native CLI.
 *
 * Holds the command registry (COMMANDS + cmd()), flag parsing, output/die,
 * target resolution (getBaseUrl + global --port/--server-url handling), the
 * operation invoker, and every helper used by two or more command domains.
 * Command modules in src/cli/commands/ import from here only — this module
 * must never import from agent.ts or any command module (cycle-free).
 */

import { readFileSync } from 'node:fs';
import { HttpOperationInvoker, OperationError } from '../server/operations/index.js';

// ── Helpers ──────────────────────────────────────────────────

const DEFAULT_PORT = 4313;
const defaultConsoleLog = console.log;

// Per-invocation target override from the global --server-url / --port flags.
// Before these existed, `--port 4750` on any agent command was SILENTLY ignored
// and the command hit the default 4313 daemon — which once pointed a test
// automation WebView at a live production board.
let cliTargetOverride: string | null = null;

function getBaseUrl(): string {
  if (cliTargetOverride) return cliTargetOverride;
  const envUrl = process.env.PMX_CANVAS_URL;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const port = process.env.PMX_CANVAS_PORT || DEFAULT_PORT;
  return `http://localhost:${port}`;
}

/**
 * Extract the global `--port <n>` / `--server-url <url>` flags (any position,
 * `=` or space-separated value) and set the invocation's target override.
 * Returns the remaining args for command dispatch. Invalid values are a loud
 * `die` — never a silent fallback to the default port. `--server-url` wins
 * over `--port` when both are given.
 */
export function extractGlobalTargetFlags(args: string[]): string[] {
  cliTargetOverride = null;
  let portOverride: number | null = null;
  let urlOverride: string | null = null;
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    let name: 'port' | 'server-url' | null = null;
    let value: string | undefined;
    if (arg === '--port' || arg === '--server-url') {
      name = arg.slice(2) as 'port' | 'server-url';
      value = args[i + 1];
      i += 1;
    } else if (arg.startsWith('--port=')) {
      name = 'port';
      value = arg.slice('--port='.length);
    } else if (arg.startsWith('--server-url=')) {
      name = 'server-url';
      value = arg.slice('--server-url='.length);
    } else {
      rest.push(arg);
      continue;
    }

    if (name === 'port') {
      const port = Number(value);
      if (!value || !Number.isInteger(port) || port <= 0 || port > 65535) {
        die(
          `--port requires a port number, got ${value === undefined ? 'no value' : JSON.stringify(value)}.`,
          'Example: --port 4313. Without the flag, PMX_CANVAS_PORT / PMX_CANVAS_URL pick the target.',
        );
      }
      portOverride = port;
    } else {
      if (!value || !/^https?:\/\//.test(value)) {
        die(
          `--server-url requires an http(s) URL, got ${value === undefined ? 'no value' : JSON.stringify(value)}.`,
          'Example: --server-url http://localhost:4313. Without the flag, PMX_CANVAS_URL picks the target.',
        );
      }
      urlOverride = value.replace(/\/$/, '');
    }
  }

  if (urlOverride) cliTargetOverride = urlOverride;
  else if (portOverride) cliTargetOverride = `http://localhost:${portOverride}`;
  return rest;
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

// Operation-registry invoker (plan-005): every server-backed command builds
// its HTTP request from the shared route table instead of hand-written paths.
// Operation failures and connection failures die with the same JSON error
// shape ({ error, hint? } on stderr, exit 1); routes declaring
// errorBodyAsResult return their failure envelope instead of throwing.
async function invokeOperation(name: string, input: Record<string, unknown>): Promise<unknown> {
  const base = getBaseUrl();
  try {
    return await new HttpOperationInvoker(base).invoke(name, input);
  } catch (error) {
    if (error instanceof OperationError) {
      die(error.message);
    }
    die(
      `Cannot connect to pmx-canvas at ${base}: ${error instanceof Error ? error.message : String(error)}`,
      `Start the server first: pmx-canvas --no-open`,
    );
  }
}

// ── Flag parsing ─────────────────────────────────────────────

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  // Boolean-only flags (never take a value argument)
  const BOOL_FLAGS = new Set([
    'help',
    'h',
    'ids',
    'stdin',
    'yes',
    'list',
    'clear',
    'set',
    'animated',
    'dry-run',
    'all',
    'no-open-in-canvas',
    'lock-arrange',
    'unlock-arrange',
    'json',
    'compact',
    'verbose',
    'full',
    'include-logs',
    'no-pan',
    'schema',
    'example',
    'examples',
    'strict-size',
    'scroll-overflow',
    'report',
    'canvas',
    'hooks',
    'tools',
    'session-messaging',
    'permissions',
    'files',
    'ui-prompts',
    'check',
    'skip-mcp',
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

function getStringFlag(flags: Record<string, string | true>, ...names: string[]): string | undefined {
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

/**
 * AX `source` for a CLI-originated action. Defaults to `cli`, but honors an
 * explicit `--source <label>` so an adapterless agent using the CLI as a fallback
 * transport (e.g. `--source codex`) attributes its actions correctly — keeping
 * loop-safety (a consumer never gets back its own steering) accurate (report #69).
 */
function resolveAxSource(flags: Record<string, string | true>): string {
  return getStringFlag(flags, 'source') ?? 'cli';
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

function optionalPositiveFiniteFlag(
  flags: Record<string, string | true>,
  name: string,
  hint: string,
): number | undefined {
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

function parseRecordArrayJson(raw: string, hint: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    die(`Invalid JSON dataset: ${error instanceof Error ? error.message : String(error)}`, hint);
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
    die(`Invalid ${label}: ${error instanceof Error ? error.message : String(error)}`, hint);
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
      die(`Unable to read --${name}: ${error instanceof Error ? error.message : String(error)}`, options.hint);
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
      die(`Unable to read --${name}: ${error instanceof Error ? error.message : String(error)}`, options.hint);
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

async function buildJsonRenderRequestBody(flags: Record<string, string | true>): Promise<Record<string, unknown>> {
  const hint = 'Use: pmx-canvas node add --type json-render --spec-file ./dashboard.json --title "Ops Dashboard"';
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

async function buildHtmlPrimitiveRequestBody(flags: Record<string, string | true>): Promise<Record<string, unknown>> {
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

  const chartHeight = optionalPositiveFiniteFlag(
    flags,
    'chart-height',
    'Use a positive number, e.g. --chart-height 300',
  );
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

async function buildWebArtifactRequestBody(flags: Record<string, string | true>): Promise<Record<string, unknown>> {
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
    // webartifact.build declares errorBodyAsResult, so build-failure envelopes
    // ({ ok:false, error }) are returned here and printed on stdout before the
    // exit-1 branch below (cli-node.test.ts pins that contract).
    result = await invokeOperation('webartifact.build', body);
  } finally {
    clearInterval(heartbeat);
  }
  output(result);
  if (isRecord(result) && result.ok === false) {
    process.exit(1);
  }
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

function cmd(name: string, help: string, examples: string[], run: (args: string[]) => Promise<void>) {
  COMMANDS[name] = { run, help, examples };
}

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
    console.log(
      '  Graph fields accept kebab-case CLI flags and camelCase schema names, e.g. --graph-type/--graphType and --x-key/--xKey',
    );
    console.log(
      '  Use --node-height/--nodeHeight for canvas frame height; use --chart-height for chart content height. --height is kept as a frame-height alias for compatibility.',
    );
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

// ── Stdin reader ─────────────────────────────────────────────

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export {
  COMMANDS,
  RESOURCE_COMMAND_ALIASES,
  RESOURCE_SUBCOMMAND_HINTS,
  applyCommonGeometryFlags,
  applyStrictSizeFlags,
  buildGraphRequestBody,
  buildHtmlPrimitiveRequestBody,
  buildJsonRenderRequestBody,
  cmd,
  die,
  getBaseUrl,
  getStringFlag,
  invokeOperation,
  isRecord,
  optionalBooleanFlag,
  optionalFiniteFlag,
  optionalNumberFlag,
  optionalPositiveFiniteFlag,
  optionalPositiveFiniteFlagWithAliases,
  output,
  parseFlags,
  parseJsonValue,
  readOptionalTextInput,
  readStdin,
  requireFlag,
  resolveAxSource,
  runWebArtifactBuildCommand,
  showCommandHelp,
};
