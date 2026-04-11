import { afterEach, describe, expect, test } from 'bun:test';
import { createCanvas } from '../../src/server/index.ts';
import {
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

const supportsWebView = typeof Bun.WebView === 'function';

describe('canvas WebView automation', () => {
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

  test('starts, evaluates, resizes, and screenshots through the SDK', async () => {
    if (!supportsWebView) {
      expect(typeof Bun.WebView).toBe('undefined');
      return;
    }

    workspaceRoot = createTestWorkspace('pmx-canvas-webview-');
    resetCanvasForTests(workspaceRoot);

    const canvas = createCanvas({ port: 4540 });

    try {
      await canvas.start({ open: false });

      const started = await canvas.startAutomationWebView({ width: 900, height: 700 });
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
  }, 15000);
});
