import assert from 'node:assert/strict';
import { createCanvas } from '../../src/server/index.ts';

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
  assert.notEqual(sdkError, '');
  assert.equal(canvas.getAutomationWebViewStatus().active, false);
  assert.equal(canvas.getAutomationWebViewStatus().lastError, sdkError);

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
  assert.equal(response.status, 500);
  assert.equal(body.ok, false);
  assert.equal(body.webview.active, false);
  assert.equal(body.error, sdkError);
  assert.equal(body.webview.lastError, sdkError);
} finally {
  await canvas.stopAutomationWebView();
  canvas.stop();
}
