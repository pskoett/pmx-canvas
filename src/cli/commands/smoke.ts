// One-command environment check: does a running canvas actually work here?
//
// Runs the checks every host test report hand-rolls — health + workspace,
// MCP stdio initialize, a temp-node create/search/remove round-trip, and
// structural board validation — and reports them as a single JSON result
// with a pass/fail exit code. Designed for fresh orbs/hosts: `pmx-canvas
// smoke` answers "does the canvas work in this environment?" in one call.
//
// The command tests a RUNNING server (like every other agent command); it
// never starts one. Board validation gates only on structural issues
// (missing edge endpoints) — node overlaps are a layout choice on real
// boards, so collisions are reported but never fail the smoke.

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpOperationInvoker } from '../../server/operations/index.js';
import { cmd, getBaseUrl, isRecord, output, parseFlags, showCommandHelp } from '../shared.js';

interface SmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

const MCP_INITIALIZE_TIMEOUT_MS = 10_000;

function cliPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf-8')) as {
      version?: string;
    };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

async function checkHealth(baseUrl: string, cliVersion: string): Promise<SmokeCheck & { serverVersion?: string }> {
  const name = 'health';
  let body: unknown;
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) return { name, ok: false, detail: `GET /health returned HTTP ${response.status}` };
    body = await response.json();
  } catch (error) {
    return {
      name,
      ok: false,
      detail: `Cannot connect to pmx-canvas at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}. Start the server first: pmx-canvas --no-open`,
    };
  }
  if (!isRecord(body) || body.ok !== true) {
    return { name, ok: false, detail: `GET /health returned an unhealthy body: ${JSON.stringify(body)}` };
  }
  const serverVersion = typeof body.version === 'string' ? body.version : 'unknown';
  const persistence = isRecord(body.persistence) && body.persistence.ok === false ? 'DEGRADED' : 'ok';
  const skew =
    serverVersion !== 'unknown' && serverVersion !== cliVersion
      ? ` — differs from CLI v${cliVersion} (version skew)`
      : '';
  return {
    name,
    ok: true,
    serverVersion,
    detail: `workspace ${String(body.workspace)}, server v${serverVersion}${skew}, pid ${String(body.pid)}, persistence ${persistence}`,
  };
}

/**
 * Spawn the bundled MCP server over stdio (same entry `pmx-canvas --mcp`
 * runs) and verify a JSON-RPC initialize handshake completes. The transport
 * is newline-delimited JSON; the child is killed as soon as the response
 * with our request id arrives.
 */
function checkMcpInitialize(cliVersion: string): Promise<SmokeCheck> {
  const name = 'mcp-initialize';
  const entry = fileURLToPath(new URL('../../mcp/server.ts', import.meta.url));
  return new Promise((resolveCheck) => {
    const child = spawn(process.execPath, ['run', entry], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: process.env,
    });
    let settled = false;
    let stdoutBuffer = '';
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      resolveCheck({ name, ok, detail });
    };
    const timer = setTimeout(
      () => finish(false, `no initialize response within ${MCP_INITIALIZE_TIMEOUT_MS}ms`),
      MCP_INITIALIZE_TIMEOUT_MS,
    );
    child.on('error', (error) => finish(false, `failed to spawn MCP server: ${error.message}`));
    child.on('exit', (code) => finish(false, `MCP server exited before responding (code ${code ?? 'unknown'})`));
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (!isRecord(message) || message.id !== 1) continue;
        const result = isRecord(message.result) ? message.result : null;
        const serverInfo = result && isRecord(result.serverInfo) ? result.serverInfo : null;
        if (serverInfo) {
          finish(true, `initialize ok: ${String(serverInfo.name)} v${String(serverInfo.version)}`);
        } else {
          finish(false, `initialize returned an error: ${JSON.stringify(message.error ?? message)}`);
        }
        return;
      }
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'pmx-canvas-smoke', version: cliVersion },
        },
      })}\n`,
    );
  });
}

async function checkNodeLifecycle(invoker: HttpOperationInvoker): Promise<SmokeCheck> {
  const name = 'node-lifecycle';
  const marker = `pmx-smoke-${Math.random().toString(36).slice(2, 10)}`;
  const searchHits = async (): Promise<Set<string>> => {
    const result = await invoker.invoke('search', { q: marker });
    const results = isRecord(result) && Array.isArray(result.results) ? result.results : [];
    return new Set(results.filter(isRecord).map((entry) => String(entry.id)));
  };
  let nodeId: string | null = null;
  try {
    const added = await invoker.invoke('node.add', {
      type: 'markdown',
      title: marker,
      content: `Temporary smoke-check node (${marker}). Safe to remove.`,
      x: 100_000,
      y: 100_000,
    });
    const node = isRecord(added) && isRecord(added.node) ? added.node : null;
    nodeId = node && typeof node.id === 'string' ? node.id : null;
    if (!nodeId) return { name, ok: false, detail: `node.add returned no node id: ${JSON.stringify(added)}` };
    if (!(await searchHits()).has(nodeId)) {
      return { name, ok: false, detail: `search did not find the created node ${nodeId}` };
    }
    await invoker.invoke('node.remove', { id: nodeId });
    nodeId = null;
    return { name, ok: true, detail: 'create → search → remove round-trip ok' };
  } catch (error) {
    // Best-effort cleanup so a failed smoke never leaves its temp node behind.
    if (nodeId) await invoker.invoke('node.remove', { id: nodeId }).catch(() => {});
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function checkValidation(invoker: HttpOperationInvoker): Promise<SmokeCheck> {
  const name = 'validate';
  try {
    const result = await invoker.invoke('validate.get', {});
    const summary = isRecord(result) && isRecord(result.summary) ? result.summary : {};
    const missingEdgeEndpoints = Number(summary.missingEdgeEndpoints ?? 0);
    const detail = `${String(summary.nodes ?? '?')} nodes, ${String(summary.edges ?? '?')} edges, ${String(
      summary.collisions ?? '?',
    )} collisions (informational), ${missingEdgeEndpoints} broken edges`;
    return { name, ok: missingEdgeEndpoints === 0, detail };
  } catch (error) {
    return { name, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

cmd(
  'smoke',
  'One-command check that a running canvas works in this environment',
  ['pmx-canvas smoke', 'pmx-canvas smoke --skip-mcp', 'pmx-canvas smoke --port 4750'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help || flags.h) return showCommandHelp('smoke');

    const baseUrl = getBaseUrl();
    const cliVersion = cliPackageVersion();
    const invoker = new HttpOperationInvoker(baseUrl);
    const checks: SmokeCheck[] = [];

    const health = await checkHealth(baseUrl, cliVersion);
    checks.push({ name: health.name, ok: health.ok, detail: health.detail });
    if (health.ok) {
      if (!flags['skip-mcp']) checks.push(await checkMcpInitialize(cliVersion));
      checks.push(await checkNodeLifecycle(invoker));
      checks.push(await checkValidation(invoker));
    }

    const ok = checks.every((check) => check.ok);
    output({ ok, target: baseUrl, cliVersion, serverVersion: health.serverVersion ?? null, checks });
    if (!ok) process.exit(1);
  },
);
