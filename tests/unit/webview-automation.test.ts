import { afterEach, describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '../../src/server/index.ts';
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
});
