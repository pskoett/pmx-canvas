#!/usr/bin/env bun
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentCli } from './agent.js';
import { createCanvas } from '../server/index.js';

const args = process.argv.slice(2);

// ── --version / -v ─────────────────────────────────────────────
// Print the installed package version and exit. Resolved from the
// sibling package.json so it stays accurate through bunx, global npm
// installs, and repo-local runs (no hard-coded string, no build step
// required).
if (args.includes('--version') || args.includes('-v')) {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    console.log(pkg.version ?? 'unknown');
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`pmx-canvas: failed to read package.json (${message})`);
    process.exit(1);
  }
}

// ── Agent CLI subcommands ────────────────────────────────────
// If first arg is a known subcommand (not a --flag), route to the agent CLI.
const AGENT_COMMANDS = new Set([
  'node', 'edge', 'search', 'layout', 'status', 'arrange', 'focus',
  'pin', 'undo', 'redo', 'history', 'snapshot', 'diff', 'group', 'webview', 'open',
  'clear', 'code-graph', 'spatial', 'watch', 'web-artifact', 'batch', 'validate', 'serve',
]);

const firstArg = args[0] ?? '';
const cliDir = dirname(fileURLToPath(import.meta.url));
const mcpServerEntry = resolve(cliDir, '..', 'mcp', 'server.ts');

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function readOption(name: string): string | undefined {
  const inlinePrefix = `--${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);

  const index = args.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < args.length && !args[index + 1].startsWith('-')) {
    return args[index + 1];
  }
  return undefined;
}

function readNumberOption(name: string): number | undefined {
  const raw = readOption(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readCsvOption(name: string): string[] | undefined {
  const raw = readOption(name);
  if (!raw) return undefined;
  const values = raw.split(',').map((value) => value.trim()).filter((value) => value.length > 0);
  return values.length > 0 ? values : undefined;
}

function stripOption(argv: string[], name: string): string[] {
  const stripped: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === `--${name}`) {
      if (index + 1 < argv.length && !argv[index + 1].startsWith('-')) {
        index++;
      }
      continue;
    }
    if (arg.startsWith(`--${name}=`)) continue;
    stripped.push(arg);
  }
  return stripped;
}

function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function readPidFile(path: string): number | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8').trim();
    if (!raw) return null;
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
    return false;
  }
}

function removePidFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    // Ignore cleanup failures for stale pid files.
  }
}

async function isHealthy(url: string): Promise<boolean> {
  try {
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}

function readLogTail(path: string, maxLines = 20): string | null {
  try {
    if (!existsSync(path)) return null;
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    return lines.slice(-maxLines).join('\n') || null;
  } catch {
    return null;
  }
}

async function waitForHealth(
  healthUrl: string,
  timeoutMs: number,
  getExitMessage: () => string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy(healthUrl)) {
      return { ok: true };
    }
    const exitMessage = getExitMessage();
    if (exitMessage) {
      return { ok: false, reason: exitMessage };
    }
    await Bun.sleep(250);
  }
  return { ok: false, reason: `Timed out waiting for ${healthUrl}` };
}

async function waitForShutdown(
  healthUrl: string,
  timeoutMs: number,
  pid: number | null,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const responsive = await isHealthy(healthUrl);
    const alive = pid ? isProcessRunning(pid) : false;
    if (!responsive && !alive) {
      return true;
    }
    await Bun.sleep(250);
  }
  return false;
}

async function startDaemonMode(options: {
  port: number;
  baseArgs: string[];
  logFile: string;
  pidFile: string;
  waitMs: number;
}): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const workbenchUrl = `http://localhost:${options.port}/workbench`;
  const existingPid = readPidFile(options.pidFile);

  if (await isHealthy(healthUrl)) {
    outputJson({
      ok: true,
      daemon: true,
      alreadyRunning: true,
      pid: existingPid,
      url: workbenchUrl,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  mkdirSync(dirname(options.logFile), { recursive: true });
  const logFd = openSync(options.logFile, 'a');
  const childArgs = options.baseArgs.includes('--no-open')
    ? options.baseArgs
    : [...options.baseArgs, '--no-open'];
  const child = spawn(process.execPath, ['run', fileURLToPath(import.meta.url), ...childArgs], {
    cwd: process.cwd(),
    detached: true,
    env: process.env,
    stdio: ['ignore', logFd, logFd],
  });

  let exitMessage: string | null = null;
  child.once('exit', (code, signal) => {
    exitMessage = signal
      ? `Daemon exited via signal ${signal}`
      : `Daemon exited with code ${code ?? 'unknown'}`;
  });
  child.unref();

  const health = await waitForHealth(healthUrl, options.waitMs, () => exitMessage);
  if (!health.ok) {
    const logTail = readLogTail(options.logFile);
    const details = logTail ? `${health.reason}\n\nRecent log output:\n${logTail}` : health.reason;
    console.error(details);
    process.exit(1);
  }

  mkdirSync(dirname(options.pidFile), { recursive: true });
  writeFileSync(options.pidFile, `${child.pid}\n`, 'utf-8');

  outputJson({
    ok: true,
    daemon: true,
    pid: child.pid,
    url: workbenchUrl,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
  });
  process.exit(0);
}

async function showServeStatus(options: {
  port: number;
  logFile: string;
  pidFile: string;
}): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const url = `http://localhost:${options.port}/workbench`;
  const pid = readPidFile(options.pidFile);
  const pidRunning = pid ? isProcessRunning(pid) : false;
  const responsive = await isHealthy(healthUrl);
  const running = responsive || pidRunning;
  if (!running && existsSync(options.pidFile) && !pidRunning) {
    removePidFile(options.pidFile);
  }

  outputJson({
    ok: true,
    daemon: true,
    running,
    responsive,
    pid,
    pidRunning,
    url,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
    pidFileExists: existsSync(options.pidFile),
  });
  process.exit(0);
}

async function stopServeDaemon(options: {
  port: number;
  logFile: string;
  pidFile: string;
  waitMs: number;
}): Promise<void> {
  const healthUrl = `http://localhost:${options.port}/health`;
  const url = `http://localhost:${options.port}/workbench`;
  const pid = readPidFile(options.pidFile);
  const responsive = await isHealthy(healthUrl);

  if (!pid) {
    if (!responsive) {
      removePidFile(options.pidFile);
      outputJson({
        ok: true,
        daemon: true,
        stopped: false,
        running: false,
        reason: 'No running daemon found.',
        url,
        healthUrl,
        logFile: options.logFile,
        pidFile: options.pidFile,
      });
      process.exit(0);
    }

    outputJson({
      ok: false,
      daemon: true,
      error: `Server on port ${options.port} is responsive, but no pid file was found at ${options.pidFile}.`,
      hint: 'Restart with `pmx-canvas serve --daemon` or provide the correct --pid-file.',
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(1);
  }

  if (!isProcessRunning(pid)) {
    removePidFile(options.pidFile);
    outputJson({
      ok: true,
      daemon: true,
      stopped: false,
      running: responsive,
      reason: `Removed stale pid file for ${pid}.`,
      pid,
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  process.kill(pid, 'SIGTERM');
  const stopped = await waitForShutdown(healthUrl, options.waitMs, pid);
  const stillResponsive = await isHealthy(healthUrl);
  const pidRunning = isProcessRunning(pid);
  if (stopped || (!stillResponsive && !pidRunning)) {
    removePidFile(options.pidFile);
    outputJson({
      ok: true,
      daemon: true,
      stopped: true,
      pid,
      url,
      healthUrl,
      logFile: options.logFile,
      pidFile: options.pidFile,
    });
    process.exit(0);
  }

  outputJson({
    ok: false,
    daemon: true,
    stopped: false,
    error: `Timed out waiting for daemon ${pid} to stop.`,
    pid,
    responsive: stillResponsive,
    pidRunning,
    url,
    healthUrl,
    logFile: options.logFile,
    pidFile: options.pidFile,
  });
  process.exit(1);
}

function runMcpServerProcess(): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['run', mcpServerEntry], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', rejectPromise);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(
        signal
          ? `MCP server exited via signal ${signal}`
          : `MCP server exited with code ${code ?? 'unknown'}`,
      ));
    });
  });
}

const serveSubcommand = firstArg === 'serve' ? args[1] ?? '' : '';

if (firstArg === 'serve' && (serveSubcommand === 'status' || serveSubcommand === 'stop')) {
  const port = parseInt(readOption('port') ?? process.env.PMX_WEB_CANVAS_PORT ?? '4313');
  const daemonLogFile = resolve(readOption('log-file') ?? `.pmx-canvas/daemon-${port}.log`);
  const daemonPidFile = resolve(readOption('pid-file') ?? `.pmx-canvas/daemon-${port}.pid`);
  const daemonWaitMs = readNumberOption('wait-ms') ?? 10_000;

  if (hasFlag('help') || args.includes('-h')) {
    console.log(`
pmx-canvas serve ${serveSubcommand}

Usage:
  pmx-canvas serve ${serveSubcommand} [--port=PORT] [--pid-file=PATH] [--log-file=PATH]${serveSubcommand === 'stop' ? ' [--wait-ms=MS]' : ''}
`);
    process.exit(0);
  }

  if (serveSubcommand === 'status') {
    await showServeStatus({
      port,
      logFile: daemonLogFile,
      pidFile: daemonPidFile,
    });
  } else {
    await stopServeDaemon({
      port,
      logFile: daemonLogFile,
      pidFile: daemonPidFile,
      waitMs: daemonWaitMs,
    });
  }
}

if (firstArg === 'serve') {
  args.shift();
}

if (AGENT_COMMANDS.has(firstArg) && firstArg !== 'serve') {
  await runAgentCli(args);
} else if (args.includes('--mcp')) {
  // MCP server mode: stdio transport, auto-starts canvas on first tool call
  await runMcpServerProcess();
} else {
  // "serve" is also accessible via flags (backward compat)
  const port = parseInt(readOption('port') ?? process.env.PMX_WEB_CANVAS_PORT ?? '4313');
  const demo = hasFlag('demo');
  const noOpen = hasFlag('no-open');
  const daemon = hasFlag('daemon');
  const themeArg = readOption('theme');
  const webviewAutomation = hasFlag('webview-automation');
  const webviewBackend = readOption('webview-backend');
  const webviewChromePath = readOption('webview-chrome-path');
  const webviewChromeArgv = readCsvOption('webview-chrome-argv');
  const webviewDataDir = readOption('webview-data-dir');
  const webviewWidth = readNumberOption('webview-width');
  const webviewHeight = readNumberOption('webview-height');
  const daemonLogFile = resolve(readOption('log-file') ?? `.pmx-canvas/daemon-${port}.log`);
  const daemonPidFile = resolve(readOption('pid-file') ?? `.pmx-canvas/daemon-${port}.pid`);
  const daemonWaitMs = readNumberOption('wait-ms') ?? 10_000;
  const webviewBackendOption: 'chrome' | 'webkit' | undefined =
    webviewBackend === 'chrome' || webviewBackend === 'webkit'
      ? webviewBackend
      : undefined;
  if (themeArg && ['dark', 'light', 'high-contrast'].includes(themeArg)) {
    process.env.PMX_CANVAS_THEME = themeArg;
  }
  const help = hasFlag('help') || args.includes('-h');

  if (help) {
    console.log(`
pmx-canvas — Spatial canvas workbench for coding agents

Usage:
  pmx-canvas [server-options]         Start the canvas server
  pmx-canvas <command> [options]      Run agent CLI commands

Server options:
  --port=PORT    Server port (default: 4313)
  --demo         Start with sample nodes
  --no-open      Don't open browser automatically
  --daemon       Start in detached background mode and wait for health
  --log-file=PATH  Daemon log file (default: ./.pmx-canvas/daemon-${port}.log)
  --pid-file=PATH  Optional daemon PID file (default: ./.pmx-canvas/daemon-${port}.pid)
  --wait-ms=MS   Health-check wait budget for daemon mode (default: 10000)
  --theme=THEME  Theme: dark (default), light, high-contrast
  --webview-automation        Start a headless Bun.WebView automation session for /workbench
  --webview-backend=BACKEND   Bun.WebView backend: chrome or webkit
  --webview-width=PX          Automation WebView width (default: 1280)
  --webview-height=PX         Automation WebView height (default: 800)
  --webview-chrome-path=PATH  Chrome/Chromium executable for Bun.WebView
  --webview-chrome-argv=CSV   Extra Chrome args for Bun.WebView, comma-separated
  --webview-data-dir=PATH     Persist automation browser storage in PATH
  --mcp          Run as MCP server (stdio transport)
  --help, -h     Show this help

Agent CLI (works against running server):
  node add|list|get|update|remove     Manage nodes
  edge add|list|remove                Manage edges
  webview status|start|evaluate|resize|screenshot|stop
                                      Manage Bun.WebView automation session
  search <query>                      Search nodes
  open                                Open the current workbench in a browser
  layout                              Full canvas state
  status                              Quick summary
  serve status                        Show daemon status for a given port/pid file
  serve stop                          Stop a daemon started with serve --daemon
  arrange [--layout grid|column|flow] Auto-arrange nodes
  batch --file ./ops.json             Run a JSON batch of operations
  validate                            Check layout collisions and containment
  validate spec                       Validate json-render/graph payloads without creating nodes
  watch [--json] [--events ...]       Watch low-token semantic canvas changes
  focus <node-id>                     Pan to node
  pin <ids...> | --list | --clear     Manage context pins
  undo / redo / history               Time travel
  snapshot save|list|restore|diff|delete
                                      Manage snapshots
  group create|add|remove             Manage groups
  web-artifact build                  Build bundled web artifacts
  clear --yes                         Clear canvas
  code-graph                          File dependencies
  spatial                             Spatial analysis
  watch                               Semantic watch stream

Run any command with --help for details and examples:
  pmx-canvas node add --help
  pmx-canvas edge --help

MCP Integration:
  Add to your agent's MCP config:
  {
    "mcpServers": {
      "canvas": {
        "command": "bunx",
        "args": ["pmx-canvas", "--mcp"]
      }
    }
  }

Examples:
  pmx-canvas                                                  Start server + browser
  pmx-canvas --no-open --demo                                 Start server headless with sample data
  pmx-canvas serve --daemon --no-open                         Start a reliable background daemon
  pmx-canvas serve status                                     Show daemon health and pid status
  pmx-canvas serve stop                                       Stop the default daemon for this port
  pmx-canvas --no-open --webview-automation                   Start server + headless Bun.WebView automation
  pmx-canvas --webview-automation --webview-backend=chrome    Start browser + Chrome-backed automation
  pmx-canvas node add --type markdown --title "Hello World"   Add a node
  pmx-canvas node add --type webpage --url "https://example.com"  Add a webpage node
  pmx-canvas node add --type json-render --title "Dashboard" --spec-file ./dashboard.json
  pmx-canvas node add --type web-artifact --title "Dashboard" --app-file ./App.tsx
  pmx-canvas node list                                        List all nodes
  pmx-canvas node schema --type json-render                   Show running-server schema info
  pmx-canvas web-artifact build --title "Dashboard" --app-file ./App.tsx
  pmx-canvas validate spec --type graph --graph-type bar --data-file ./metrics.json --x-key label --y-key value
  pmx-canvas open                                             Open the workbench in a browser
  pmx-canvas webview status                                   Show WebView automation status
  pmx-canvas webview screenshot --output ./canvas.png         Save a WebView screenshot
  pmx-canvas search "auth"                                    Find nodes
  pmx-canvas arrange --layout column                          Auto-arrange
  pmx-canvas batch --file ./canvas-ops.json                   Run batch canvas ops
  pmx-canvas validate                                         Check layout collisions
  pmx-canvas watch --events context-pin,move-end              Watch semantic deltas
  pmx-canvas clear --dry-run                                  Preview destructive op
`);
    process.exit(0);
  }

  if (daemon) {
    const baseArgs = stripOption(stripOption(stripOption(stripOption(args, 'daemon'), 'log-file'), 'pid-file'), 'wait-ms');
    await startDaemonMode({
      port,
      baseArgs,
      logFile: daemonLogFile,
      pidFile: daemonPidFile,
      waitMs: daemonWaitMs,
    });
  }

  const canvas = createCanvas({ port });
  const automationWebView =
    webviewAutomation
      ? {
          ...(webviewBackendOption ? { backend: webviewBackendOption } : {}),
          ...(webviewChromePath ? { chromePath: webviewChromePath } : {}),
          ...(webviewChromeArgv ? { chromeArgv: webviewChromeArgv } : {}),
          ...(webviewDataDir ? { dataStoreDir: webviewDataDir } : {}),
          ...(webviewWidth !== undefined ? { width: webviewWidth } : {}),
          ...(webviewHeight !== undefined ? { height: webviewHeight } : {}),
        }
      : false;
  try {
    await canvas.start({ open: !noOpen, automationWebView });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to start PMX Canvas: ${message}`);
    process.exit(1);
  }

  if (demo && canvas.getLayout().nodes.length === 0) {
    const n1 = canvas.addNode({
      type: 'markdown',
      title: 'Welcome to PMX Canvas',
      content: '# PMX Canvas Workbench\n\nA spatial canvas for coding agents.\n\n## Features\n- Infinite 2D canvas with pan/zoom\n- Multiple node types\n- Edges between nodes\n- Real-time SSE updates\n- HTTP API for agent control',
    });

    const n2 = canvas.addNode({
      type: 'markdown',
      title: 'Getting Started',
      content: `# Quick Start\n\n\`\`\`bash\n# Add a node via CLI\npmx-canvas node add --type markdown --title "Hello" --content "# World"\n\n# List nodes\npmx-canvas node list\n\n# Get canvas state\npmx-canvas layout\n\`\`\``,
    });

    const n3 = canvas.addNode({
      type: 'status',
      title: 'Agent Status',
      content: 'Ready',
    });

    canvas.addEdge({ from: n1, to: n2, type: 'flow', label: 'next' });
    canvas.addEdge({ from: n2, to: n3, type: 'flow' });
    canvas.arrange('grid');
  }

  console.log(`\n  PMX Canvas running at http://localhost:${canvas.port}`);
  console.log(`  Health: http://localhost:${canvas.port}/health\n`);
  if (webviewAutomation) {
    const webviewStatus = canvas.getAutomationWebViewStatus();
    console.log(`  Bun.WebView automation: ${webviewStatus.active ? 'active' : 'inactive'}`);
    if (webviewStatus.lastError) {
      console.log(`    Last WebView error: ${webviewStatus.lastError}`);
    }
  }
  console.log('  Agent CLI:');
  console.log('    pmx-canvas node add --type markdown --title "Hello"');
  console.log('    pmx-canvas node list');
  console.log('    pmx-canvas search "query"');
  console.log('    pmx-canvas --help          (all commands)');
  console.log('\n  Press Ctrl+C to stop\n');

  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    canvas.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    canvas.stop();
    process.exit(0);
  });
}
