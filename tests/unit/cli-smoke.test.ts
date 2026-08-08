import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { runAgentCli } from '../../src/cli/agent.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

interface SmokeResult {
  ok: boolean;
  target: string;
  cliVersion: string;
  serverVersion: string | null;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
}

async function runSmoke(args: string[]): Promise<SmokeResult> {
  const log = mock((..._args: unknown[]) => {});
  const originalLog = console.log;
  console.log = log;
  try {
    await runAgentCli(['smoke', ...args]);
  } finally {
    console.log = originalLog;
  }
  return JSON.parse(log.mock.calls[0]?.[0] as string) as SmokeResult;
}

describe('pmx-canvas smoke', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-smoke-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4548, autoOpenBrowser: false });
    if (!base) throw new Error('Failed to start canvas server for smoke tests.');
    baseUrl = base;
    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) process.env.PMX_CANVAS_URL = previousUrl;
    else delete process.env.PMX_CANVAS_URL;
    if (previousPort) process.env.PMX_CANVAS_PORT = previousPort;
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  test('health endpoint reports the package version for skew detection', async () => {
    const response = await fetch(`${baseUrl}/health`);
    const body = (await response.json()) as { ok: boolean; version?: string };
    expect(body.ok).toBe(true);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('passes against a healthy server and cleans up its temp node', async () => {
    const before = (await (await fetch(`${baseUrl}/api/canvas/state`)).json()) as { nodes: unknown[] };

    const result = await runSmoke(['--skip-mcp']);
    expect(result.ok).toBe(true);
    expect(result.serverVersion).toBe(result.cliVersion);
    expect(result.checks.map((c) => c.name)).toEqual(['health', 'node-lifecycle', 'validate']);
    for (const check of result.checks) expect(check.ok).toBe(true);

    // The temp node is gone: board is byte-count identical to before the smoke.
    const after = (await (await fetch(`${baseUrl}/api/canvas/state`)).json()) as { nodes: unknown[] };
    expect(after.nodes.length).toBe(before.nodes.length);
  });

  test('runs the MCP initialize handshake', async () => {
    const result = await runSmoke([]);
    const mcpCheck = result.checks.find((c) => c.name === 'mcp-initialize');
    expect(mcpCheck?.ok).toBe(true);
    expect(mcpCheck?.detail).toContain('initialize ok');
  }, 20_000);

  test('reports an unreachable server as a failed health check without throwing', async () => {
    process.env.PMX_CANVAS_URL = 'http://localhost:4549';
    const originalExit = process.exit;
    let exitCode: number | undefined;
    // The smoke command exits 1 on failure; intercept so the test can assert the report.
    process.exit = ((code?: number) => {
      exitCode = code;
      throw new Error('exit-intercepted');
    }) as typeof process.exit;
    try {
      await expect(runSmoke(['--skip-mcp'])).rejects.toThrow('exit-intercepted');
    } finally {
      process.exit = originalExit;
      process.env.PMX_CANVAS_URL = baseUrl;
    }
    expect(exitCode).toBe(1);
  });
});
