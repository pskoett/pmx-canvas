import { describe, expect, test } from 'bun:test';
import { webviewOperations } from '../../src/server/operations/ops/webview.ts';
import type { OperationMcpToolHost } from '../../src/server/operations/types.ts';
import type { WebviewStatus } from '../../src/server/operations/webview-runner.ts';

// Report #66: on a start failure (e.g. the Bun.WebView startup timeout) the
// canvas_webview composite (and its legacy standalone) must return PARSEABLE JSON
// — { ok:false, error, webview } — not a bare error string, so MCP clients can tell
// a failure/timeout apart from valid content instead of choking on non-JSON text.
describe('#66: canvas_webview start failure result shape', () => {
  const startOp = webviewOperations.find((op) => op.name === 'webview.start');

  const host: OperationMcpToolHost = {
    getPinnedNodeIds: async () => [],
    invoker: () => ({ invoke: async () => ({}) }),
  };

  const timeoutMessage =
    'Timed out after 5000ms while starting the workbench automation WebView. Bun.WebView may be unavailable in this environment.';

  const webviewStatus: WebviewStatus = {
    supported: true,
    active: false,
    headlessOnly: true,
    url: null,
    backend: null,
    width: null,
    height: null,
    dataStoreDir: null,
    startedAt: null,
    lastError: timeoutMessage,
  };

  test('a supported-but-failed start serializes to parseable JSON, not a bare message', async () => {
    expect(startOp?.mcp?.formatResult).toBeDefined();
    // The serialized wire body for a supported runtime whose start failed.
    const failureBody = { ok: false, error: timeoutMessage, webview: webviewStatus };

    const result = await startOp!.mcp!.formatResult!(failureBody, {}, host);

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    // The #66 regression returned `text` === the bare timeout message — JSON.parse
    // would throw on "Timed out ...". It must parse cleanly now.
    const parsed = JSON.parse(text) as { ok: boolean; error: string; webview?: { supported?: boolean } };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Timed out');
    expect(parsed.webview?.supported).toBe(true);
  });

  test('a start failure with no webview status still returns parseable { ok:false, error }', async () => {
    const serverNotRunning = { ok: false, error: 'Canvas server is not running.' };

    const result = await startOp!.mcp!.formatResult!(serverNotRunning, {}, host);

    expect(result.isError).toBe(true);
    const parsed = JSON.parse((result.content[0] as { text: string }).text) as { ok: boolean; error: string };
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('not running');
  });
});
