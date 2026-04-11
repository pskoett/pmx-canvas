import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

describe('agent CLI webview commands', () => {
  let workspaceRoot = '';
  let previousPort = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-webview-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4541 });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI tests.');
    }

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    process.env.PMX_CANVAS_PORT = '4541';
  });

  afterAll(() => {
    if (previousPort) {
      process.env.PMX_CANVAS_PORT = previousPort;
    } else {
      delete process.env.PMX_CANVAS_PORT;
    }
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
  });

  beforeEach(async () => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();

    const response = await fetch('http://localhost:4541/api/workbench/webview', { method: 'DELETE' });
    expect(response.ok).toBe(true);
  });

  test('status and stop commands return JSON output', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['webview', 'status']);
      await runAgentCli(['webview', 'stop']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);

    const statusOutput = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      supported: boolean;
      active: boolean;
      headlessOnly: boolean;
    };
    expect(statusOutput.active).toBe(false);
    expect(statusOutput.headlessOnly).toBe(true);

    const stopOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      stopped: boolean;
      webview: { active: boolean };
    };
    expect(stopOutput.ok).toBe(true);
    expect(stopOutput.webview.active).toBe(false);
  });

  test('start command sends backend and size options', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'webview',
        'start',
        '--backend',
        process.platform === 'darwin' ? 'webkit' : 'chrome',
        '--width',
        '1440',
        '--height',
        '900',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok?: boolean;
      error?: string;
      webview?: {
        supported: boolean;
        active: boolean;
        width: number | null;
        height: number | null;
        backend: 'webkit' | 'chrome' | null;
      };
    };

    if (output.ok === false) {
      expect(output.error).toBeDefined();
      expect(output.webview?.active).toBe(false);
      return;
    }

    expect(output.ok).toBe(true);
    expect(output.webview?.active).toBe(true);
    expect(output.webview?.width).toBe(1440);
    expect(output.webview?.height).toBe(900);
    expect(output.webview?.backend).toBe(process.platform === 'darwin' ? 'webkit' : 'chrome');
  }, 15000);

  test('evaluate, resize, and screenshot commands work against the HTTP API', async () => {
    const screenshotPath = join(workspaceRoot, 'cli-webview-test.png');
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'webview',
        'start',
        '--backend',
        process.platform === 'darwin' ? 'webkit' : 'chrome',
      ]);

      if (JSON.parse(log.mock.calls[0]?.[0] as string).ok === false) {
        return;
      }

      await runAgentCli(['webview', 'evaluate', '--expression', 'document.title']);
      await runAgentCli(['webview', 'resize', '--width', '1024', '--height', '768']);
      await runAgentCli(['webview', 'screenshot', '--output', screenshotPath]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(4);

    const evaluateOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      value: unknown;
    };
    expect(evaluateOutput.ok).toBe(true);
    expect(evaluateOutput.value).toBe('PMX Canvas');

    const resizeOutput = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      ok: boolean;
      webview: { width: number | null; height: number | null };
    };
    expect(resizeOutput.ok).toBe(true);
    expect(resizeOutput.webview.width).toBe(1024);
    expect(resizeOutput.webview.height).toBe(768);

    const screenshotOutput = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      ok: boolean;
      output: string;
      bytes: number;
      mimeType: string;
    };
    expect(screenshotOutput.ok).toBe(true);
    expect(screenshotOutput.output).toBe(screenshotPath);
    expect(screenshotOutput.bytes).toBeGreaterThan(0);
    expect(screenshotOutput.mimeType).toBe('image/png');
    expect(existsSync(screenshotPath)).toBe(true);
    expect(readFileSync(screenshotPath).byteLength).toBeGreaterThan(0);
  }, 15000);
});
