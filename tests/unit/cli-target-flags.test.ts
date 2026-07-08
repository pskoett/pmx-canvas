import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import { extractGlobalTargetFlags, runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Global --port / --server-url flags. Before these existed, `--port` on any
// agent command was SILENTLY ignored and the command targeted the default
// 4313 daemon — which once attached a test automation WebView to a live
// production board (LRN-20260708-003).
describe('agent CLI global target flags', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let serverPort = 0;
  let previousPort = '';
  let previousUrl = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-target-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4547, autoOpenBrowser: false });
    if (!base) throw new Error('Failed to start canvas server for CLI target-flag tests.');
    baseUrl = base;
    serverPort = Number(new URL(base).port);

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    // Point the env at a dead target: only the flag override can make calls succeed.
    process.env.PMX_CANVAS_URL = 'http://127.0.0.1:9';
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) process.env.PMX_CANVAS_URL = previousUrl;
    else delete process.env.PMX_CANVAS_URL;
    if (previousPort) process.env.PMX_CANVAS_PORT = previousPort;
    else delete process.env.PMX_CANVAS_PORT;
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  async function runCli(args: string[]): Promise<string> {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;
    try {
      await runAgentCli(args);
    } finally {
      console.log = originalLog;
    }
    return (log.mock.calls[0]?.[0] as string) ?? '';
  }

  test('--port overrides PMX_CANVAS_URL for the invocation (space and = forms)', async () => {
    canvasState.withSuppressedRecording(() => canvasState.clear());
    const spaced = JSON.parse(await runCli(['node', 'list', '--port', String(serverPort)])) as unknown[];
    expect(spaced).toEqual([]);
    const inline = JSON.parse(await runCli(['node', 'list', `--port=${serverPort}`])) as unknown[];
    expect(inline).toEqual([]);
  });

  test('--server-url overrides PMX_CANVAS_URL and wins over --port', async () => {
    canvasState.withSuppressedRecording(() => canvasState.clear());
    const viaUrl = JSON.parse(await runCli(['node', 'list', '--server-url', baseUrl])) as unknown[];
    expect(viaUrl).toEqual([]);
    // --server-url (live) must win over --port (dead): the call still succeeds.
    const both = JSON.parse(await runCli(['node', 'list', '--server-url', baseUrl, '--port', '9'])) as unknown[];
    expect(both).toEqual([]);
  });

  test('the flags work in any argv position (before the command name)', async () => {
    canvasState.withSuppressedRecording(() => canvasState.clear());
    const result = JSON.parse(await runCli(['--port', String(serverPort), 'node', 'list'])) as unknown[];
    expect(result).toEqual([]);
  });

  test('an invalid --port value dies loudly instead of silently hitting the default port', () => {
    const originalExit = process.exit;
    const originalError = console.error;
    const errors: string[] = [];
    console.error = ((message: string) => {
      errors.push(String(message));
    }) as typeof console.error;
    process.exit = ((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as typeof process.exit;
    try {
      expect(() => extractGlobalTargetFlags(['node', 'list', '--port', 'banana'])).toThrow('exit:1');
      expect(() => extractGlobalTargetFlags(['node', 'list', '--port'])).toThrow('exit:1');
      expect(() => extractGlobalTargetFlags(['node', 'list', '--server-url', 'not-a-url'])).toThrow('exit:1');
      const parsed = JSON.parse(errors[0] ?? '{}') as { error?: string; hint?: string };
      expect(parsed.error).toContain('--port');
      expect(parsed.hint).toContain('PMX_CANVAS_PORT');
    } finally {
      process.exit = originalExit;
      console.error = originalError;
    }
  });

  test('extraction strips the global flags and leaves command args untouched', () => {
    expect(extractGlobalTargetFlags(['webview', 'start', '--port', '4750', '--backend', 'webkit'])).toEqual([
      'webview',
      'start',
      '--backend',
      'webkit',
    ]);
    expect(extractGlobalTargetFlags(['node', 'list'])).toEqual(['node', 'list']);
  });
});
