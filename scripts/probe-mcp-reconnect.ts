/** Local stdio stress probe for plan 019's unresolved MCP -32001 timeout. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { canvasState } from '../src/server/canvas-state.js';
import { startCanvasServer, stopCanvasServer } from '../src/server/server.js';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from '../tests/unit/helpers.js';

const root = createTestWorkspace('pmx-reconnect-probe-');
process.env.PMX_CANVAS_DISABLE_BROWSER_OPEN = '1';
process.env.PMX_MCP_APP_HOST_STATE_FILE = `${root}/host-state.json`;
process.env.PMX_CANVAS_DB_PATH = `${root}/canvas.db`;
const fixture = fileURLToPath(new URL('../tests/fixtures/mcp-app-fixture.ts', import.meta.url));
const count = 12;
resetCanvasForTests(root);
let base = startCanvasServer({ workspaceRoot: root, port: 0 })!;
assert(base);

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pmx-workbench': '1' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json();
  assert(response.ok, JSON.stringify(value));
  return value;
}

try {
  await Promise.all(
    Array.from({ length: count }, (_, i) =>
      post('/api/canvas/mcp-app/open', {
        title: `Reconnect ${i}`,
        toolName: 'show_counter',
        toolArguments: { initial: i },
        transport: { type: 'stdio', command: 'bun', args: ['run', fixture], cwd: root },
      }),
    ),
  );
  const results: Array<{ round: number; sessions: number; milliseconds: number }> = [];
  for (let round = 1; round <= 5; round++) {
    const before = new Set(canvasState.getLayout().nodes.map((node) => node.data.appSessionId));
    stopCanvasServer();
    const start = performance.now();
    base = startCanvasServer({ workspaceRoot: root, port: 0 })!;
    assert(base);
    while (true) {
      const nodes = canvasState.getLayout().nodes;
      assert.equal(nodes.length, count);
      assert(
        !nodes.some((node) => node.data.sessionStatus === 'error'),
        JSON.stringify(nodes.map((node) => node.data.sessionError)),
      );
      if (nodes.every((node) => node.data.sessionStatus === 'ready')) break;
      assert(performance.now() - start < 30_000, 'Rehydration exceeded 30 seconds');
      await Bun.sleep(25);
    }
    const nodes = canvasState.getLayout().nodes;
    assert(
      nodes.every((node) => !before.has(node.data.appSessionId)),
      'Old session reused',
    );
    await Promise.all(
      nodes.map(async (node) => {
        const result = await post('/api/ext-app/list-tools', { sessionId: node.data.appSessionId });
        assert(JSON.stringify(result).includes('increment'), 'Live tool catalog missing increment');
      }),
    );
    results.push({ round, sessions: nodes.length, milliseconds: Math.round(performance.now() - start) });
  }
  console.log(
    JSON.stringify({ runtime: Bun.version, transport: 'local stdio', concurrentOpens: count, results, timeouts: 0 }),
  );
} finally {
  stopCanvasServer();
  removeTestWorkspace(root);
}
