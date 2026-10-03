import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadCopilotCanvas } from '../helpers/copilot-adapter.js';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'pmx-plugin-mcp-')));
const plugin = join(root, 'installed-plugin');
const workspace = join(root, 'project');
const otherWorkspace = join(root, 'other-project');
let client: Client;
let transport: StdioClientTransport;
let occupied: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
  for (const path of [plugin, workspace, otherWorkspace]) mkdirSync(path);
  mkdirSync(join(plugin, '..project'));
  for (const file of ['start-mcp.mjs', 'runtime.json', 'tools.json']) {
    copyFileSync(resolve('plugins/pmx-canvas', file), join(plugin, file));
  }
  // Use the current checkout instead of downloading an unpublished future package during CI.
  writeFileSync(
    join(plugin, 'runtime.mjs'),
    `
import { canonicalWorkspace, ensurePmxServer as ensure, runtimeVersion } from ${JSON.stringify(pathToFileURL(resolve('.github/extensions/pmx-canvas/runtime.mjs')).href)};
export { canonicalWorkspace, runtimeVersion, probePmxServer } from ${JSON.stringify(pathToFileURL(resolve('.github/extensions/pmx-canvas/runtime.mjs')).href)};
export function runtimeCommand() { return { command: ${JSON.stringify(process.execPath)}, args: ["run", ${JSON.stringify(resolve('src/cli/index.ts'))}] }; }
export function ensurePmxServer(root, input) { return ensure(root, input, runtimeCommand()); }
`,
  );
  occupied = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ ok: true, workspace: otherWorkspace }),
  });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && !['PMX_CANVAS_URL', 'PMX_CANVAS_WORKSPACE_ROOT'].includes(entry[0]),
    ),
  );
  client = new Client({ name: 'portable-plugin-test', version: '1' }, { capabilities: {} });
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(plugin, 'start-mcp.mjs')],
    cwd: plugin,
    env: { ...env, PMX_CANVAS_PORT: String(occupied.port), PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
    stderr: 'pipe',
  });
  await client.connect(transport);
});

afterAll(async () => {
  await client?.close();
  await transport?.close();
  occupied?.stop(true);
  const directory = join(workspace, '.pmx-canvas');
  if (existsSync(directory)) {
    for (const file of readdirSync(directory).filter((name) => /^daemon-\d+\.pid$/.test(name))) {
      const port = /^daemon-(\d+)\.pid$/.exec(file)?.[1];
      execFileSync(process.execPath, ['run', resolve('src/cli/index.ts'), 'serve', 'stop', `--port=${port}`], {
        cwd: workspace,
        env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: workspace },
        timeout: 15_000,
        stdio: 'pipe',
      });
    }
  }
  rmSync(root, { recursive: true, force: true });
});

describe('portable plugin MCP workspace connector', () => {
  test('initialization from the installed plugin creates no board or daemon', async () => {
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain('canvas_connect_workspace');
    expect(tools).toContain('canvas_node');
    expect((await client.listResources()).resources).toEqual([]);
    expect(existsSync(join(plugin, '.pmx-canvas'))).toBe(false);
    expect(existsSync(join(workspace, '.pmx-canvas'))).toBe(false);
  });

  test('rejects relative roots and the plugin installation directory without creating state', async () => {
    for (const workspaceRoot of ['.', plugin, join(plugin, '..project')]) {
      const result = await client.callTool({ name: 'canvas_connect_workspace', arguments: { workspaceRoot } });
      expect(result.isError).toBe(true);
    }
    expect(existsSync(join(plugin, '.pmx-canvas'))).toBe(false);
  });

  test('withholds board operations until the agent selects a workspace', async () => {
    await expect(
      client.callTool({ name: 'canvas_node', arguments: { action: 'add', type: 'markdown' } }),
    ).rejects.toThrow('absolute project directory first');
  });

  test('connects MCP and the native panel to one project despite a foreign occupied port', async () => {
    const connection = await client.callTool({
      name: 'canvas_connect_workspace',
      arguments: { workspaceRoot: workspace },
    });
    expect(connection.isError).not.toBe(true);
    const content = connection.structuredContent;
    if (!content || typeof content !== 'object' || !('serverUrl' in content) || typeof content.serverUrl !== 'string') {
      throw new Error('Workspace connection did not return its server URL.');
    }
    const serverUrl = content.serverUrl;
    expect(new URL(serverUrl).port).not.toBe(String(occupied.port));
    expect((await client.listTools()).tools.some((tool) => tool.name === 'canvas_node')).toBe(true);
    expect((await client.listResources()).resources.some((resource) => resource.uri === 'canvas://layout')).toBe(true);

    const created = await client.callTool({
      name: 'canvas_node',
      arguments: { action: 'add', type: 'markdown', title: 'Portable board', content: 'Shared MCP and native panel' },
    });
    expect(created.isError).not.toBe(true);
    const adapter = loadCopilotCanvas();
    const panel = await adapter.open({
      instanceId: 'portable-proof',
      input: { workspaceRoot: workspace, serverUrl, autoStart: false },
    });
    expect(panel.url).toBe(`${serverUrl}/workbench?theme=light`);
    const health = await (await fetch(`${serverUrl}/health`)).json();
    expect(realpathSync(health.workspace)).toBe(workspace);
    expect(JSON.stringify(await (await fetch(`${serverUrl}/api/canvas/state`)).json())).toContain(
      'Shared MCP and native panel',
    );
    expect(existsSync(join(plugin, '.pmx-canvas'))).toBe(false);
    await adapter.onClose({ instanceId: 'portable-proof' });
  }, 30_000);

  test('reconnection is idempotent, and cannot silently redirect an existing session', async () => {
    const again = await client.callTool({
      name: 'canvas_connect_workspace',
      arguments: { workspaceRoot: workspace },
    });
    expect(again.isError).not.toBe(true);
    const redirected = await client.callTool({
      name: 'canvas_connect_workspace',
      arguments: { workspaceRoot: otherWorkspace },
    });
    expect(redirected.isError).toBe(true);
    expect(existsSync(join(otherWorkspace, '.pmx-canvas'))).toBe(false);
  });

  test('automatically connects a client advertising exactly one standard file root', async () => {
    const rooted = new Client({ name: 'rooted-plugin-test', version: '1' }, { capabilities: { roots: {} } });
    let rootRequests = 0;
    rooted.setRequestHandler(ListRootsRequestSchema, () => {
      rootRequests++;
      return { roots: [{ uri: pathToFileURL(workspace).href }] };
    });
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] =>
          entry[1] !== undefined && !['PMX_CANVAS_URL', 'PMX_CANVAS_WORKSPACE_ROOT'].includes(entry[0]),
      ),
    );
    const rootedTransport = new StdioClientTransport({
      command: process.execPath,
      args: [join(plugin, 'start-mcp.mjs')],
      cwd: plugin,
      env,
      stderr: 'pipe',
    });
    try {
      await rooted.connect(rootedTransport);
      let connected = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        connected = (await rooted.listResources()).resources.some((resource) => resource.uri === 'canvas://layout');
        if (connected) break;
        await new Promise((resolveWait) => setTimeout(resolveWait, 50));
      }
      expect(rootRequests).toBeGreaterThan(0);
      expect(connected).toBe(true);
      expect(existsSync(join(plugin, '.pmx-canvas'))).toBe(false);
    } finally {
      await rooted.close();
      await rootedTransport.close();
    }
  }, 15_000);

  test('refuses tools and resources if a foreign workspace replaces the selected server', async () => {
    const connection = await client.callTool({
      name: 'canvas_connect_workspace',
      arguments: { workspaceRoot: workspace },
    });
    const content = connection.structuredContent;
    if (!content || typeof content !== 'object' || !('serverUrl' in content) || typeof content.serverUrl !== 'string') {
      throw new Error('Missing bound server URL.');
    }
    const port = new URL(content.serverUrl).port;
    execFileSync(process.execPath, ['run', resolve('src/cli/index.ts'), 'serve', 'stop', `--port=${port}`], {
      cwd: workspace,
      env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: workspace },
      timeout: 15_000,
      stdio: 'pipe',
    });
    const foreign = Bun.serve({
      hostname: '127.0.0.1',
      port: Number(port),
      fetch: () => Response.json({ ok: true, workspace: otherWorkspace }),
    });
    try {
      await expect(
        client.callTool({
          name: 'canvas_node',
          arguments: { action: 'add', type: 'markdown', title: 'Must not leak' },
        }),
      ).rejects.toThrow('another workspace');
      await expect(client.readResource({ uri: 'canvas://layout' })).rejects.toThrow('another workspace');
    } finally {
      foreign.stop(true);
    }
  }, 20_000);
});
