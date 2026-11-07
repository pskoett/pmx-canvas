import { afterEach, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '../../src/server/index.ts';
import {
  getCanvasAutomationWebViewStatus,
  startCanvasAutomationWebView,
  startCanvasServer,
  stopCanvasAutomationWebView,
  stopCanvasServer,
} from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

const supportsWebView = typeof (Bun as { WebView?: unknown }).WebView === 'function';

// WebView automation is not supported on Windows yet: the start path fails
// mid-flight without recording lastError, and no backend is validated there.
describe.skipIf(process.platform === 'win32')('canvas WebView automation', () => {
  let workspaceRoot = '';

  afterEach(async () => {
    try {
      if (workspaceRoot) {
        resetCanvasForTests(workspaceRoot);
      }
    } finally {
      if (workspaceRoot) {
        removeTestWorkspace(workspaceRoot);
        workspaceRoot = '';
      }
    }
  });

  // Navigation has a 15s server timeout; allow its error response and cleanup
  // to finish before the test runner advances to the next shared-server test.
  test('starts, evaluates, resizes, and screenshots through the SDK', async () => {
    if (!supportsWebView) {
      expect(typeof (Bun as { WebView?: unknown }).WebView).toBe('undefined');
      return;
    }

    workspaceRoot = createTestWorkspace('pmx-canvas-webview-');
    resetCanvasForTests(workspaceRoot);

    const canvas = createCanvas({ port: 4540 });

    try {
      await canvas.start({ open: false });

      let started: Awaited<ReturnType<typeof canvas.startAutomationWebView>>;
      try {
        started = await canvas.startAutomationWebView({ width: 900, height: 700 });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = canvas.getAutomationWebViewStatus();
        expect(status.active).toBe(false);
        expect(status.lastError).toBe(message);
        expect(message).toMatch(/Bun\.WebView|Timed out|Failed to spawn Chrome/);
        return;
      }

      expect(started.active).toBe(true);
      expect(started.width).toBe(900);
      expect(started.height).toBe(700);

      const title = await canvas.evaluateAutomationWebView('document.title');
      expect(title).toBe('PMX Canvas');

      const resized = await canvas.resizeAutomationWebView(1024, 768);
      expect(resized.width).toBe(1024);
      expect(resized.height).toBe(768);

      const screenshot = await canvas.screenshotAutomationWebView({ format: 'png' });
      expect(screenshot.byteLength).toBeGreaterThan(0);
    } finally {
      try {
        await canvas.stopAutomationWebView();
      } finally {
        canvas.stop();
      }
    }
  }, 30000);

  test('reports Chrome constructor failures through the SDK and HTTP status', async () => {
    if (!supportsWebView) {
      expect(typeof (Bun as { WebView?: unknown }).WebView).toBe('undefined');
      return;
    }

    workspaceRoot = createTestWorkspace('pmx-canvas-webview-constructor-');
    // Bun keeps a process-wide Chrome backend after view.close(). A previous
    // successful launch can bypass construction even with an invalid path.
    const child = Bun.spawn(
      [process.execPath, fileURLToPath(new URL('../fixtures/webview-constructor-failure.ts', import.meta.url))],
      {
        cwd: workspaceRoot,
        env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: workspaceRoot },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, failure: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, failure: '' });
  });

  test('stopping the server while a WebView is still starting closes that WebView', async () => {
    if (!supportsWebView) return;
    workspaceRoot = createTestWorkspace('pmx-canvas-webview-stop-race-');
    resetCanvasForTests(workspaceRoot);
    startCanvasServer({ workspaceRoot, port: 0 });
    // A slow page keeps the start navigating until after the server has stopped.
    const page = Bun.serve({
      port: 0,
      fetch: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return new Response('<title>slow</title>', { headers: { 'Content-Type': 'text/html' } });
      },
    });
    try {
      // Chrome may be unavailable on this host; then the start fails at once and there is no view to leak.
      const started = startCanvasAutomationWebView(`http://127.0.0.1:${page.port}/`).then(
        () => true,
        () => false,
      );
      await new Promise((resolve) => setTimeout(resolve, 100));
      stopCanvasServer();
      if (!(await started)) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(getCanvasAutomationWebViewStatus().active).toBe(false);
    } finally {
      await stopCanvasAutomationWebView().catch(() => undefined);
      page.stop(true);
    }
  }, 30_000);
});
