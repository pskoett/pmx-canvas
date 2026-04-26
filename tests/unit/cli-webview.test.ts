import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

const cliIndexPath = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Failed to resolve an ephemeral port.'));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(address.port);
      });
    });
  });
}

describe('agent CLI webview commands', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-webview-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4541, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI tests.');
    }
    baseUrl = base;

    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
  });

  afterAll(() => {
    if (previousUrl) {
      process.env.PMX_CANVAS_URL = previousUrl;
    } else {
      delete process.env.PMX_CANVAS_URL;
    }
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

    const response = await fetch(`${baseUrl}/api/workbench/webview`, { method: 'DELETE' });
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

  test('evaluate supports --script for multi-statement JavaScript', async () => {
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

      await runAgentCli([
        'webview',
        'evaluate',
        '--script',
        'const title = document.title; return title.toUpperCase();',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const evaluateOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      value: unknown;
    };
    expect(evaluateOutput.ok).toBe(true);
    expect(evaluateOutput.value).toBe('PMX CANVAS');
  }, 15000);

  test('evaluate supports --file for multi-statement JavaScript', async () => {
    const scriptPath = join(workspaceRoot, 'probe.js');
    writeFileSync(scriptPath, 'const title = document.title; return `${title} from file`;');

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

      await runAgentCli([
        'webview',
        'evaluate',
        '--file',
        scriptPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const evaluateOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      value: unknown;
    };
    expect(evaluateOutput.ok).toBe(true);
    expect(evaluateOutput.value).toBe('PMX Canvas from file');
  }, 15000);

  test('serve subcommand routes to server startup instead of agent CLI help', async () => {
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const originalLog = console.log;
    const log = mock(() => {});
    const exitMock = mock(() => undefined as never);

    console.log = log;
    process.exit = exitMock as typeof process.exit;
    process.argv = ['bun', 'src/cli/index.ts', 'serve', '--help'];

    try {
      await import(`../../src/cli/index.ts?serve-test=${Date.now()}`);
    } finally {
      process.argv = originalArgv;
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(exitMock).toHaveBeenCalled();
    const output = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('Server options:');
    expect(output).not.toContain('pmx-canvas serve — Start the canvas server');
  });

  test('graph subcommand routes to agent CLI instead of server startup', async () => {
    const originalArgv = process.argv;
    const originalExit = process.exit;
    const originalLog = console.log;
    const log = mock(() => {});
    const exitMock = mock((code?: number) => {
      throw new Error(`exit:${code}`);
    });

    console.log = log;
    process.exit = exitMock as typeof process.exit;
    process.argv = ['bun', 'src/cli/index.ts', 'graph', 'add', '--help'];

    try {
      await import(`../../src/cli/index.ts?graph-route-test=${Date.now()}`);
    } finally {
      process.argv = originalArgv;
      process.exit = originalExit;
      console.log = originalLog;
    }

    expect(exitMock).not.toHaveBeenCalled();
    const output = log.mock.calls.map((call) => String(call[0] ?? '')).join('\n');
    expect(output).toContain('pmx-canvas graph add');
    expect(output).not.toContain('Server options:');
  });

  test('serve --daemon waits for health and returns machine-readable startup info', async () => {
    const port = await getAvailablePort();
    const logPath = join(workspaceRoot, `daemon-${port}.log`);
    const pidPath = join(workspaceRoot, `daemon-${port}.pid`);

    const proc = Bun.spawn({
      cmd: ['bun', 'run', cliIndexPath, 'serve', '--daemon', '--no-open', `--port=${port}`, `--log-file=${logPath}`, `--pid-file=${pidPath}`, '--wait-ms=15000'],
      cwd: workspaceRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
      },
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');

    const payload = JSON.parse(stdout) as {
      ok: boolean;
      daemon: boolean;
      pid: number;
      url: string;
      healthUrl: string;
      logFile: string;
      pidFile: string;
    };
    expect(payload.ok).toBe(true);
    expect(payload.daemon).toBe(true);
    expect(payload.pid).toBeGreaterThan(0);
    expect(payload.logFile).toBe(logPath);
    expect(payload.pidFile).toBe(pidPath);
    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(pidPath)).toBe(true);

    const health = await fetch(payload.healthUrl);
    expect(health.ok).toBe(true);

    process.kill(payload.pid, 'SIGTERM');
  }, 20000);

  test('serve status and serve stop manage daemon lifecycle', async () => {
    const port = await getAvailablePort();
    const logPath = join(workspaceRoot, `status-stop-${port}.log`);
    const pidPath = join(workspaceRoot, `status-stop-${port}.pid`);

    const startProc = Bun.spawn({
      cmd: ['bun', 'run', cliIndexPath, 'serve', '--daemon', '--no-open', `--port=${port}`, `--log-file=${logPath}`, `--pid-file=${pidPath}`, '--wait-ms=15000'],
      cwd: workspaceRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
      },
    });

    const startStdout = await new Response(startProc.stdout).text();
    const startExitCode = await startProc.exited;
    expect(startExitCode).toBe(0);
    const started = JSON.parse(startStdout) as { pid: number; healthUrl: string };
    expect(started.pid).toBeGreaterThan(0);

    const statusProc = Bun.spawn({
      cmd: ['bun', 'run', cliIndexPath, 'serve', 'status', `--port=${port}`, `--log-file=${logPath}`, `--pid-file=${pidPath}`],
      cwd: workspaceRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const statusStdout = await new Response(statusProc.stdout).text();
    const statusExitCode = await statusProc.exited;
    expect(statusExitCode).toBe(0);
    const statusPayload = JSON.parse(statusStdout) as {
      ok: boolean;
      running: boolean;
      responsive: boolean;
      pid: number | null;
      pidRunning: boolean;
    };
    expect(statusPayload.ok).toBe(true);
    expect(statusPayload.running).toBe(true);
    expect(statusPayload.responsive).toBe(true);
    expect(statusPayload.pid).toBe(started.pid);
    expect(statusPayload.pidRunning).toBe(true);

    const stopProc = Bun.spawn({
      cmd: ['bun', 'run', cliIndexPath, 'serve', 'stop', `--port=${port}`, `--log-file=${logPath}`, `--pid-file=${pidPath}`, '--wait-ms=15000'],
      cwd: workspaceRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stopStdout = await new Response(stopProc.stdout).text();
    const stopExitCode = await stopProc.exited;
    expect(stopExitCode).toBe(0);
    const stopPayload = JSON.parse(stopStdout) as {
      ok: boolean;
      stopped: boolean;
      pid: number;
    };
    expect(stopPayload.ok).toBe(true);
    expect(stopPayload.stopped).toBe(true);
    expect(stopPayload.pid).toBe(started.pid);

    const health = await fetch(started.healthUrl).catch(() => null);
    expect(health).toBeNull();
    expect(existsSync(pidPath)).toBe(false);
  }, 25000);
});
