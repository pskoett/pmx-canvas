import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentCli } from '../../src/cli/agent.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { mutationHistory } from '../../src/server/mutation-history.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import {
  createFakeWebArtifactScripts,
  createTestWorkspace,
  removeTestWorkspace,
  resetCanvasForTests,
} from './helpers.ts';

const fixtureMcpAppServerPath = fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url));

describe('agent CLI node commands', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousPort = '';
  let previousUrl = '';

  async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, init);
    expect(response.ok).toBe(true);
    return await response.json() as T;
  }

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-node-');
    resetCanvasForTests(workspaceRoot);
    createFakeWebArtifactScripts(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4542, autoOpenBrowser: false });
    if (!base) {
      throw new Error('Failed to start canvas server for CLI node tests.');
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

  beforeEach(() => {
    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();
  });

  test('node update merges partial geometry flags with existing node state', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Resize me',
        x: 80,
        y: 120,
        width: 360,
        height: 200,
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--width', '640', '--y', '240']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
    };
    expect(output.ok).toBe(true);
    expect(output.id).toBe(created.id);

    const updated = await jsonRequest<{
      position: { x: number; y: number };
      size: { width: number; height: number };
    }>(`/api/canvas/node/${created.id}`);
    expect(updated.position).toEqual({ x: 80, y: 240 });
    expect(updated.size).toEqual({ width: 640, height: 200 });
  });

  test('node add returns rendered geometry for immediate layout scripting', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'markdown',
        '--title',
        'Immediate geometry',
        '--x',
        '420',
        '--y',
        '260',
        '--width',
        '500',
        '--height',
        '280',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    };
    expect(output.ok).toBe(true);
    expect(output.position).toEqual({ x: 420, y: 260 });
    expect(output.size).toEqual({ width: 500, height: 280 });
  });

  test('node update supports explicit arrange locking', async () => {
    const created = await jsonRequest<{
      ok: boolean;
      id: string;
    }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'markdown',
        title: 'Lock me',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'update', created.id, '--lock-arrange']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const node = await jsonRequest<{ data: Record<string, unknown> }>(`/api/canvas/node/${created.id}`);
    expect(node.data.arrangeLocked).toBe(true);
  });

  test('node add supports graph nodes from a JSON data file', async () => {
    const dataPath = join(workspaceRoot, 'graph-data.json');
    writeFileSync(dataPath, JSON.stringify([
      { label: 'Docs', value: 5 },
      { label: 'Tests', value: 8 },
      { label: 'Release', value: 3 },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'CLI Graph',
        '--graph-type',
        'bar',
        '--data-file',
        dataPath,
        '--x-key',
        'label',
        '--y-key',
        'value',
        '--width',
        '880',
        '--height',
        '640',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      size: { width: number; height: number };
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('graph');
    expect(node.size).toEqual({ width: 880, height: 640 });
    expect((node.data.graphConfig as Record<string, unknown>).graphType).toBe('bar');
  });

  test('node add exposes the full graph flag surface for newer chart types', async () => {
    const radarPath = join(workspaceRoot, 'graph-radar.json');
    const stackedPath = join(workspaceRoot, 'graph-stacked.json');
    writeFileSync(radarPath, JSON.stringify([
      { axis: 'Q1', north: 5, south: 7 },
      { axis: 'Q2', north: 6, south: 4 },
    ]), 'utf-8');
    writeFileSync(stackedPath, JSON.stringify([
      { month: 'Jan', north: 5, south: 2 },
      { month: 'Feb', north: 7, south: 3 },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Radar Graph',
        '--graph-type',
        'radar',
        '--data-file',
        radarPath,
        '--axis-key',
        'axis',
        '--metrics',
        'north,south',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Scatter Graph',
        '--graph-type',
        'scatter',
        '--data-json',
        JSON.stringify([
          { x: 1, y: 2, size: 9 },
          { x: 3, y: 4, size: 12 },
        ]),
        '--x-key',
        'x',
        '--y-key',
        'y',
        '--z-key',
        'size',
        '--color',
        '#3366ff',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Stacked Graph',
        '--graph-type',
        'stacked-bar',
        '--data-file',
        stackedPath,
        '--x-key',
        'month',
        '--series',
        'north,south',
      ]);
      await runAgentCli([
        'node',
        'add',
        '--type',
        'graph',
        '--title',
        'Composed Graph',
        '--graph-type',
        'composed',
        '--data-json',
        JSON.stringify([
          { month: 'Jan', visits: 120, conversion: 0.24 },
          { month: 'Feb', visits: 160, conversion: 0.31 },
        ]),
        '--x-key',
        'month',
        '--bar-key',
        'visits',
        '--line-key',
        'conversion',
        '--bar-color',
        '#f97316',
        '--line-color',
        '#0ea5e9',
      ]);
    } finally {
      console.log = originalLog;
    }

    const outputs = log.mock.calls.map((call) => JSON.parse(call[0] as string) as { id: string });
    expect(outputs).toHaveLength(4);

    const radarNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[0]?.id}`);
    expect(radarNode.data.graphConfig).toMatchObject({
      graphType: 'radar',
      axisKey: 'axis',
      metrics: ['north', 'south'],
    });

    const scatterNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[1]?.id}`);
    expect(scatterNode.data.graphConfig).toMatchObject({
      graphType: 'scatter',
      xKey: 'x',
      yKey: 'y',
      zKey: 'size',
      color: '#3366ff',
    });

    const stackedNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[2]?.id}`);
    expect(stackedNode.data.graphConfig).toMatchObject({
      graphType: 'stacked-bar',
      xKey: 'month',
      series: ['north', 'south'],
    });

    const composedNode = await jsonRequest<{ data: { graphConfig: Record<string, unknown> } }>(`/api/canvas/node/${outputs[3]?.id}`);
    expect(composedNode.data.graphConfig).toMatchObject({
      graphType: 'composed',
      xKey: 'month',
      barKey: 'visits',
      lineKey: 'conversion',
      barColor: '#f97316',
      lineColor: '#0ea5e9',
    });
  });

  test('node add supports json-render nodes from a spec file', async () => {
    const specPath = join(workspaceRoot, 'dashboard.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'card',
      elements: {
        card: {
          type: 'Card',
          props: {
            title: 'CLI Dashboard',
          },
          children: ['copy'],
        },
        copy: {
          type: 'Text',
          props: {
            text: 'Rendered from the CLI',
          },
          children: [],
        },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'json-render',
        '--title',
        'CLI Dashboard',
        '--spec-file',
        specPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      url: string;
    };
    expect(output.ok).toBe(true);
    expect(output.url).toContain('/api/canvas/json-render/view?nodeId=');

    const node = await jsonRequest<{
      type: string;
      data: Record<string, unknown>;
    }>(`/api/canvas/node/${output.id}`);
    expect(node.type).toBe('json-render');
    expect((node.data.spec as Record<string, unknown>).root).toBe('card');
  });

  test('node add supports webpage nodes with the canonical --url flag', async () => {
    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'webpage',
        '--title',
        'CLI Webpage',
        '--url',
        'https://example.com/docs',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      data: { url?: string };
    };
    expect(output.ok).toBe(true);
    expect(output.data.url).toBe('https://example.com/docs');
  }, 15000);

  test('node add supports web-artifact as a symmetric create flow', async () => {
    const appPath = join(workspaceRoot, 'NodeAddArtifact.tsx');
    writeFileSync(appPath, 'export default function App() { return <main>Node add artifact</main>; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'node',
        'add',
        '--type',
        'web-artifact',
        '--title',
        'Node Add Artifact',
        '--app-file',
        appPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
    };
    expect(output.ok).toBe(true);
    expect(output.openedInCanvas).toBe(true);
    expect(output.nodeId).toBeDefined();
    expect(output.url).toContain('/artifact?path=');
  });

  test('node schema and validate spec expose running-server schema/validation info', async () => {
    const specPath = join(workspaceRoot, 'validation-dashboard.json');
    writeFileSync(specPath, JSON.stringify({
      root: 'table',
      elements: {
        table: {
          type: 'Table',
          props: {
            columns: ['Metric', 'Value'],
            rows: [
              ['Builds', 12],
              ['Deploys', 4],
            ],
          },
          children: [],
        },
      },
    }), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'schema', '--type', 'webpage', '--field', 'url']);
      await runAgentCli(['node', 'schema', '--type', 'json-render', '--component', 'Table', '--summary']);
      await runAgentCli(['node', 'add', '--help', '--type', 'webpage', '--json']);
      await runAgentCli(['validate', 'spec', '--type', 'json-render', '--spec-file', specPath, '--summary']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(4);

    const webpageSchema = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      type: string;
      field: { name: string; aliases?: string[] };
    };
    expect(webpageSchema.type).toBe('webpage');
    expect(webpageSchema.field.name).toBe('url');
    expect(webpageSchema.field.aliases).toContain('content');

    const tableSummary = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      type: string;
      requiredProps: string[];
      optionalProps: string[];
    };
    expect(tableSummary.type).toBe('Table');
    expect(tableSummary.requiredProps).toContain('columns');
    expect(tableSummary.requiredProps).toContain('rows');
    expect(tableSummary.requiredProps).not.toContain('caption');
    expect(tableSummary.optionalProps).toContain('caption');

    const webpageHelp = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      type: string;
      endpoint: string;
      fields: Array<{ name: string }>;
    };
    expect(webpageHelp.type).toBe('webpage');
    expect(webpageHelp.endpoint).toBe('/api/canvas/node');
    expect(webpageHelp.fields.some((field) => field.name === 'url')).toBe(true);

    const validation = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      ok: boolean;
      type: string;
      summary: { elementCount: number };
    };
    expect(validation.ok).toBe(true);
    expect(validation.type).toBe('json-render');
    expect(validation.summary.elementCount).toBe(1);
  });

  test('edge add supports search-based node resolution', async () => {
    const from = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'DVT O2', content: 'source' }),
    });
    const to = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'deep work', content: 'target' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'edge',
        'add',
        '--from-search',
        'DVT O2',
        '--to-search',
        'deep work',
        '--type',
        'relation',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      from: string;
      to: string;
    };
    expect(output.ok).toBe(true);
    expect(output.from).toBe(from.id);
    expect(output.to).toBe(to.id);
  });

  test('group create accepts explicit frames and batch/validate commands work from the CLI', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Frame A', x: 900, y: 180, width: 240, height: 160 }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Frame B', x: 1240, y: 420, width: 240, height: 160 }),
    });

    const groupLog = mock(() => {});
    const originalLog = console.log;
    console.log = groupLog;

    try {
      await runAgentCli([
        'group',
        'create',
        '--title',
        'CLI Frame',
        '--x',
        '40',
        '--y',
        '60',
        '--width',
        '960',
        '--height',
        '720',
        '--child-layout',
        'column',
        first.id,
        second.id,
      ]);
    } finally {
      console.log = originalLog;
    }

    const grouped = JSON.parse(groupLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      id: string;
      position: { x: number; y: number };
      size: { width: number; height: number };
    };
    expect(grouped.ok).toBe(true);
    expect(grouped.position).toEqual({ x: 40, y: 60 });
    expect(grouped.size).toEqual({ width: 960, height: 720 });

    canvasState.withSuppressedRecording(() => {
      canvasState.clear();
    });
    mutationHistory.reset();

    const batchPath = join(workspaceRoot, 'cli-batch.json');
    writeFileSync(batchPath, JSON.stringify([
      {
        op: 'node.add',
        assign: 'child',
        args: { type: 'markdown', title: 'CLI batch child', x: 200, y: 200, width: 220, height: 140 },
      },
      {
        op: 'group.create',
        assign: 'frame',
        args: { title: 'CLI batch frame', childIds: ['$child.id'] },
      },
    ]), 'utf-8');

    const batchLog = mock(() => {});
    console.log = batchLog;
    try {
      await runAgentCli(['batch', '--file', batchPath]);
    } finally {
      console.log = originalLog;
    }
    const batchOutput = JSON.parse(batchLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      refs: Record<string, { id: string }>;
    };
    expect(batchOutput.ok).toBe(true);
    expect(typeof batchOutput.refs.child?.id).toBe('string');
    expect(typeof batchOutput.refs.frame?.id).toBe('string');

    const validateLog = mock(() => {});
    console.log = validateLog;
    try {
      await runAgentCli(['validate']);
    } finally {
      console.log = originalLog;
    }
    const validation = JSON.parse(validateLog.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      containments: Array<{ groupId: string; childId: string }>;
      collisions: unknown[];
    };
    expect(validation.ok).toBe(true);
    expect(validation.collisions).toEqual([]);
    expect(validation.containments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupId: batchOutput.refs.frame.id,
        childId: batchOutput.refs.child.id,
      }),
    ]));
  });

  test('batch supports graph.add from the CLI surface', async () => {
    const batchPath = join(workspaceRoot, 'cli-graph-batch.json');
    writeFileSync(batchPath, JSON.stringify([
      {
        op: 'graph.add',
        assign: 'graph',
        args: {
          title: 'CLI batch graph',
          graphType: 'bar',
          data: [
            { label: 'Docs', value: 5 },
            { label: 'Tests', value: 8 },
          ],
          xKey: 'label',
          yKey: 'value',
          width: 840,
          nodeHeight: 600,
        },
      },
    ]), 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['batch', '--file', batchPath]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      refs: Record<string, { id: string }>;
      results: Array<{
        type: string;
        size: { width: number; height: number };
        data: Record<string, unknown>;
      }>;
    };
    expect(output.ok).toBe(true);
    expect(typeof output.refs.graph?.id).toBe('string');
    expect(output.results[0]?.type).toBe('graph');
    expect(output.results[0]?.size).toEqual({ width: 840, height: 600 });
    expect((output.results[0]?.data.graphConfig as Record<string, unknown>)?.graphType).toBe('bar');
  });

  test('web-artifact build creates a bundled artifact and opens it on the canvas', async () => {
    const appPath = join(workspaceRoot, 'App.tsx');
    const cssPath = join(workspaceRoot, 'index.css');
    writeFileSync(appPath, 'export default function App() { return <main>CLI Artifact</main>; }', 'utf-8');
    writeFileSync(cssPath, 'body { background: #123456; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'CLI Artifact',
        '--app-file',
        appPath,
        '--index-css-file',
        cssPath,
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      path: string;
      openedInCanvas: boolean;
      nodeId?: string;
      url?: string;
    };
    expect(output.ok).toBe(true);
    expect(output.openedInCanvas).toBe(true);
    expect(output.nodeId).toBeDefined();
    expect(output.url).toContain('/artifact?path=');

    const node = output.nodeId
      ? await jsonRequest<{ type: string; data: Record<string, unknown> }>(`/api/canvas/node/${output.nodeId}`)
      : null;
    expect(node?.type).toBe('mcp-app');
    expect(node?.data.title).toBe('CLI Artifact');
  });

  test('web-artifact build suppresses raw logs by default and includes them on demand', async () => {
    const initScriptPath = join(workspaceRoot, 'emit-init.sh');
    const bundleScriptPath = join(workspaceRoot, 'emit-bundle.sh');
    writeFileSync(initScriptPath, `#!/bin/bash
set -e
PROJECT_NAME="$1"
mkdir -p "$PROJECT_NAME/src"
echo "init stdout"
echo "init stderr" 1>&2
cat > "$PROJECT_NAME/package.json" <<'EOF'
{"name":"noisy-web-artifact"}
EOF
cat > "$PROJECT_NAME/index.html" <<'EOF'
<!DOCTYPE html><html><body><div id="root"></div></body></html>
EOF
cat > "$PROJECT_NAME/src/main.tsx" <<'EOF'
console.log("main");
EOF
cat > "$PROJECT_NAME/src/App.tsx" <<'EOF'
export default function App() { return null; }
EOF
`, 'utf-8');
    writeFileSync(bundleScriptPath, `#!/bin/bash
set -e
echo "bundle stdout"
echo "bundle stderr" 1>&2
echo '<!DOCTYPE html><html><body>artifact</body></html>' > bundle.html
`, 'utf-8');
    await Bun.$`chmod +x ${initScriptPath} ${bundleScriptPath}`;

    const appPath = join(workspaceRoot, 'NoisyApp.tsx');
    writeFileSync(appPath, 'export default function App() { return <main>Noisy Artifact</main>; }', 'utf-8');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'Quiet Artifact',
        '--app-file',
        appPath,
        '--init-script-path',
        initScriptPath,
        '--bundle-script-path',
        bundleScriptPath,
      ]);
      await runAgentCli([
        'web-artifact',
        'build',
        '--title',
        'Verbose Artifact',
        '--app-file',
        appPath,
        '--init-script-path',
        initScriptPath,
        '--bundle-script-path',
        bundleScriptPath,
        '--include-logs',
      ]);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(2);
    const quietOutput = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      logs?: {
        stdout?: { lineCount: number; excerpt: string[] };
        stderr?: { lineCount: number; excerpt: string[] };
      };
      stdout?: string;
      stderr?: string;
    };
    expect(quietOutput.ok).toBe(true);
    expect(quietOutput.stdout).toBeUndefined();
    expect(quietOutput.stderr).toBeUndefined();
    expect(quietOutput.logs?.stdout?.lineCount).toBeGreaterThan(0);
    expect(quietOutput.logs?.stderr?.excerpt).toContain('bundle stderr');

    const verboseOutput = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      ok: boolean;
      stdout?: string;
      stderr?: string;
    };
    expect(verboseOutput.ok).toBe(true);
    expect(verboseOutput.stdout).toContain('bundle stdout');
    expect(verboseOutput.stderr).toContain('bundle stderr');
  });

  test('node list and node get expose the same normalized title/content fields', async () => {
    const filePath = join(workspaceRoot, 'normalized-node.ts');
    writeFileSync(filePath, 'export const normalized = true;\n', 'utf-8');

    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'file', content: filePath }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'file']);
      await runAgentCli(['node', 'get', created.id]);
    } finally {
      console.log = originalLog;
    }

    const listed = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    }>;
    const fetched = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      id: string;
      title: string | null;
      content: string | null;
      path: string | null;
    };

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: created.id,
      title: 'normalized-node.ts',
      content: 'export const normalized = true;\n',
      path: filePath,
    }));
    expect(fetched).toEqual(expect.objectContaining({
      id: created.id,
      title: listed[0]?.title,
      content: listed[0]?.content,
      path: listed[0]?.path,
    }));
  });

  test('node list --type mcp-app defaults to compact summaries', async () => {
    const opened = await jsonRequest<{
      ok: boolean;
      nodeId: string | null;
      sessionId: string;
    }>('/api/canvas/mcp-app/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        toolName: 'show_counter',
        toolArguments: { initial: 3 },
        transport: {
          type: 'stdio',
          command: 'bun',
          args: ['run', fixtureMcpAppServerPath],
          cwd: workspaceRoot,
        },
      }),
    });
    expect(opened.ok).toBe(true);
    expect(typeof opened.nodeId).toBe('string');

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'list', '--type', 'mcp-app']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(1);
    const listed = JSON.parse(log.mock.calls[0]?.[0] as string) as Array<{
      id: string;
      type: string;
      title: string | null;
      mode?: string;
      serverName?: string;
      toolName?: string;
      sessionStatus?: string;
      dataKeys?: string[];
      data?: Record<string, unknown>;
      content?: string;
    }>;

    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(expect.objectContaining({
      id: opened.nodeId,
      type: 'mcp-app',
      title: 'Counter App',
      mode: 'ext-app',
      appSessionId: opened.sessionId,
      hostMode: 'hosted',
      toolName: 'show_counter',
      sessionStatus: 'ready',
    }));
    expect(Array.isArray(listed[0]?.dataKeys)).toBe(true);
    expect(listed[0]?.data).toBeUndefined();
    expect(listed[0]?.content).toBeUndefined();
  });

  test('node get, layout, and history expose compact inspection modes', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Compact Graph',
        graphType: 'composed',
        data: [
          { month: 'Jan', visits: 120, conversion: 0.24 },
          { month: 'Feb', visits: 160, conversion: 0.31 },
        ],
        xKey: 'month',
        barKey: 'visits',
        lineKey: 'conversion',
      }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['node', 'get', created.id, '--summary']);
      await runAgentCli(['node', 'get', created.id, '--field', 'title', '--field', 'graphConfig']);
      await runAgentCli(['layout', '--summary']);
      await runAgentCli(['history', '--summary']);
      await runAgentCli(['history', '--compact']);
    } finally {
      console.log = originalLog;
    }

    expect(log).toHaveBeenCalledTimes(5);

    const nodeSummary = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      id: string;
      graph?: { graphType: string; dataPoints: number; lineKey: string };
      data?: unknown;
      dataKeys?: string[];
    };
    expect(nodeSummary.id).toBe(created.id);
    expect(nodeSummary.graph).toEqual(expect.objectContaining({
      graphType: 'composed',
      dataPoints: 2,
      lineKey: 'conversion',
    }));
    expect(nodeSummary.data).toBeUndefined();
    expect(nodeSummary.dataKeys).toContain('graphConfig');

    const nodeFields = JSON.parse(log.mock.calls[1]?.[0] as string) as {
      id: string;
      fields: {
        title: string;
        graphConfig: { graphType: string; barKey: string };
      };
    };
    expect(nodeFields.id).toBe(created.id);
    expect(nodeFields.fields.title).toBe('Compact Graph');
    expect(nodeFields.fields.graphConfig).toEqual(expect.objectContaining({
      graphType: 'composed',
      barKey: 'visits',
    }));

    const layoutSummary = JSON.parse(log.mock.calls[2]?.[0] as string) as {
      totalNodes: number;
      totalEdges: number;
      nodesByType: Record<string, number>;
    };
    expect(layoutSummary.totalNodes).toBe(1);
    expect(layoutSummary.totalEdges).toBe(0);
    expect(layoutSummary.nodesByType.graph).toBe(1);

    const historySummary = JSON.parse(log.mock.calls[3]?.[0] as string) as {
      totalMutations: number;
      countsByOperation: Record<string, number>;
      recent: Array<{ description: string }>;
    };
    expect(historySummary.totalMutations).toBeGreaterThan(0);
    expect(historySummary.countsByOperation.addNode).toBeGreaterThan(0);
    expect(historySummary.recent.length).toBeGreaterThan(0);

    const historyCompact = JSON.parse(log.mock.calls[4]?.[0] as string) as {
      totalMutations: number;
      entries: Array<{ description: string; status: string }>;
    };
    expect(historyCompact.totalMutations).toBe(historySummary.totalMutations);
    expect(historyCompact.entries.length).toBeGreaterThan(0);
    expect(['applied', 'current', 'undone']).toContain(historyCompact.entries[0]?.status);
  });

  test('snapshot diff works from the CLI', async () => {
    const created = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Snapshot target', content: 'before' }),
    });
    const snapshot = await jsonRequest<{ ok: boolean; snapshot: { id: string } }>('/api/canvas/snapshots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'cli-snapshot' }),
    });
    await jsonRequest<{ ok: boolean; id: string }>(`/api/canvas/node/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'after' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli(['snapshot', 'diff', snapshot.snapshot.id]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as {
      ok: boolean;
      text: string;
    };
    expect(output.ok).toBe(true);
    expect(output.text).toContain('Modified nodes (1):');
    expect(output.text).toContain('content changed');
  });

  test('edge add supports style and animated flags', async () => {
    const first = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge start' }),
    });
    const second = await jsonRequest<{ ok: boolean; id: string }>('/api/canvas/node', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: 'Edge end' }),
    });

    const log = mock(() => {});
    const originalLog = console.log;
    console.log = log;

    try {
      await runAgentCli([
        'edge',
        'add',
        '--from',
        first.id,
        '--to',
        second.id,
        '--type',
        'references',
        '--style',
        'dashed',
        '--animated',
      ]);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(log.mock.calls[0]?.[0] as string) as { ok: boolean; id: string };
    expect(output.ok).toBe(true);

    const state = await jsonRequest<{
      edges: Array<{ id: string; style?: string; animated?: boolean }>;
    }>('/api/canvas/state');
    expect(state.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: output.id,
        style: 'dashed',
        animated: true,
      }),
    ]));
  });
});
