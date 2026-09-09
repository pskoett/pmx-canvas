import { afterEach, describe, expect, test } from 'bun:test';
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
    resetCanvasForTests(workspaceRoot);

    const canvas = createCanvas({ port: 4540 });
    const chromePath = '/definitely/not/a/chrome-binary-pmx-canvas-test';

    try {
      await canvas.start({ open: false });

      let sdkError = '';
      try {
        await canvas.startAutomationWebView({ backend: 'chrome', chromePath });
      } catch (error) {
        sdkError = error instanceof Error ? error.message : String(error);
      }

      expect(sdkError).not.toBe('');
      expect(canvas.getAutomationWebViewStatus()).toMatchObject({ active: false, lastError: sdkError });

      const response = await fetch(`http://127.0.0.1:${canvas.port}/api/workbench/webview/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backend: 'chrome', chromePath }),
      });
      const body = (await response.json()) as {
        ok: boolean;
        error: string;
        webview: { active: boolean; lastError: string | null };
      };

      expect(response.status).toBe(500);
      expect(body).toMatchObject({
        ok: false,
        webview: { active: false, lastError: body.error },
      });
      expect(body.error).toBe(sdkError);
    } finally {
      canvas.stop();
    }
  });
});
