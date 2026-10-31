import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type {
  AgentStartEvent,
  PluginAPI,
  PluginEventContext,
  PluginHandlerResult,
  PluginCommandContext,
  PluginToolContext,
  PluginToolDefinition,
  ToolCallEvent,
  ToolCallResult,
} from '@ampcode/plugin';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import plugin from '../../plugins/amp/index.js';
import { runtimeVersion } from '../../plugins/amp/runtime.js';
import { ensurePmxServer } from '../../plugins/amp/mcp-runtime.js';
import { removeTempDirWithRetry } from './helpers.js';

const sourceRoot = realpathSync(process.cwd());
let root: string;
const first = `T-test-${crypto.randomUUID()}` as const;
const second = `T-test-${crypto.randomUUID()}` as const;
const originalUrl = process.env.PMX_CANVAS_URL;
let server: ReturnType<typeof Bun.serve>;
let workspace: string;
let version: string;
let activeBoardId: string | null;
let catalog: Array<{ id: string; name: string }>;
let methods: string[];
let abortOnList: AbortController | undefined;
const disposers: Array<() => void> = [];

async function host() {
  let tool: PluginToolDefinition | undefined;
  let route: ((event: ToolCallEvent) => Promise<ToolCallResult>) | undefined;
  let start:
    | ((event: AgentStartEvent, ctx: PluginEventContext<'agent.start'>) => PluginHandlerResult<'agent.start'>)
    | undefined;
  const commands = new Map<string, (ctx: PluginCommandContext) => Promise<void>>();
  // Only host registration surfaces are stubbed. The plugin performs real HTTP and disk I/O.
  const api = {
    system: { workspaceRoot: { toString: () => `file://${root}` } },
    helpers: { filePathFromURI: () => root },
    on: (event: string, handler: unknown) => {
      if (event === 'tool.call') route = handler as typeof route;
      if (event === 'agent.start') start = handler as typeof start;
    },
    onDispose: (dispose: () => void) => disposers.push(dispose),
    threads: { get: () => ({ messages: async () => [], appendUserMessage: async () => {} }) },
    logger: { log: () => {} },
    registerSkill: async () => ({ unsubscribe() {} }),
    registerTool: (definition: PluginToolDefinition) => {
      if (definition.name === 'pmx_canvas_session') tool = definition;
      return { unsubscribe() {} };
    },
    registerCommand: (name: string, _options: unknown, handler: (ctx: PluginCommandContext) => Promise<void>) => {
      commands.set(name, handler);
      return { unsubscribe() {} };
    },
  } as unknown as PluginAPI;
  await plugin(api);
  return {
    commands,
    start: (id: string) =>
      start!({ id, message: 'Continue', thread: { id: first } }, {
        thread: { id: first, cancel: async () => {} },
      } as PluginEventContext<'agent.start'>),
    route: (input: Record<string, unknown>, threadId = first, name = 'canvas_node') =>
      route!({
        toolUseID: crypto.randomUUID(),
        tool: `mcp__pmx_canvas__${name}`,
        input,
        thread: { id: threadId },
      }),
    async call(action: string, threadId = first, boardId?: string, signal = new AbortController().signal) {
      const result = await tool!.execute({ action, ...(boardId ? { boardId } : {}) }, {
        thread: { id: threadId },
        signal,
      } as PluginToolContext);
      if (typeof result !== 'string') throw new Error('Expected session JSON.');
      return JSON.parse(result);
    },
  };
}

beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'amp-session-')));
  workspace = root;
  version = runtimeVersion;
  activeBoardId = 'visible-board';
  catalog = [
    { id: 'left', name: 'Same title' },
    { id: 'right', name: 'Same title' },
  ];
  methods = [];
  abortOnList = undefined;
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      methods.push(request.method);
      if (new URL(request.url).pathname === '/health')
        return Response.json({ ok: true, workspace, version, bundleStamp: 'test-bundle' });
      abortOnList?.abort();
      return Response.json({ boards: catalog, activeBoardId });
    },
  });
  process.env.PMX_CANVAS_URL = `http://127.0.0.1:${server.port}`;
});

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  server.stop(true);
  if (originalUrl === undefined) delete process.env.PMX_CANVAS_URL;
  else process.env.PMX_CANVAS_URL = originalUrl;
  for (const thread of [first, second])
    rmSync(join(root, '.pmx-canvas/amp-bindings', `${thread}.json`), { force: true });
  removeTempDirWithRetry(root);
});

describe('Amp Canvas session', () => {
  test('an active turn cannot follow unbind or rebind, including after plugin reload', async () => {
    const session = await host();
    await session.call('bind', first, 'left');
    await session.start('bound-turn');
    await session.call('unbind', first);
    expect(await session.route({ action: 'add' })).toMatchObject({ action: 'reject-and-continue' });
    const reloaded = await host();
    await reloaded.call('bind', first, 'right');
    expect(await reloaded.route({ action: 'add' })).toMatchObject({ action: 'reject-and-continue' });
    await reloaded.start('bound-turn');
    expect(await reloaded.route({ action: 'add' })).toMatchObject({ action: 'reject-and-continue' });
    await reloaded.start('new-turn');
    expect(await reloaded.route({ action: 'add' })).toMatchObject({
      action: 'modify',
      input: { targetBoardId: 'right' },
    });
  });

  test('a binding first used during an unbound turn remains fenced after unbind and reload', async () => {
    const session = await host();
    await session.start('initially-unbound');
    await session.call('bind', first, 'left');
    expect(await session.route({ action: 'get' })).toMatchObject({
      action: 'modify',
      input: { targetBoardId: 'left' },
    });
    await session.call('unbind', first);
    expect(await session.route({ action: 'add' })).toMatchObject({ action: 'reject-and-continue' });
    const reloaded = await host();
    await reloaded.call('bind', first, 'right');
    expect(await reloaded.route({ action: 'add' })).toMatchObject({ action: 'reject-and-continue' });
    await reloaded.start('next-turn');
    expect(await reloaded.route({ action: 'add' })).toMatchObject({
      action: 'modify',
      input: { targetBoardId: 'right' },
    });
  });

  test('native thread identity supplies routing and refuses conflicting destinations', async () => {
    const session = await host();
    await Promise.all([session.call('bind', first, 'left'), session.call('bind', second, 'right')]);
    const input = { action: 'add', type: 'markdown', content: 'Bound output', agentId: 'model-supplied' };
    expect(await session.route(input, first)).toEqual({
      action: 'modify',
      input: {
        ...input,
        targetBoardId: 'left',
        agentId: `amp:${first}`,
      },
    });
    expect(await session.route(input, second)).toEqual({
      action: 'modify',
      input: {
        ...input,
        targetBoardId: 'right',
        agentId: `amp:${second}`,
      },
    });
    expect(await session.route({ ...input, destinationBoardId: 'right' }, first)).toMatchObject({
      action: 'reject-and-continue',
    });
    await session.call('unbind', first);
    expect(await session.route(input, first)).toEqual({ action: 'allow' });
  });

  test('thread bindings survive reload independently without following navigation or missing boards', async () => {
    const one = await host();
    await Promise.all([one.call('bind', first, 'left'), one.call('bind', second, 'right')]);
    activeBoardId = 'right';
    const reloaded = await host();
    expect((await reloaded.call('status', first)).binding).toEqual({
      id: expect.any(String),
      workspace: root,
      threadId: first,
      boardId: 'left',
      consumerId: `amp:${first}`,
    });
    expect((await reloaded.call('status', second)).binding.boardId).toBe('right');
    catalog = catalog.filter((board) => board.id !== 'left');
    expect(await reloaded.call('status', first)).toMatchObject({
      binding: { boardId: 'left' },
      boundBoardExists: false,
      activeBoardId: 'right',
    });
    await reloaded.call('unbind', first);
    await reloaded.call('unbind', first);
    expect((await reloaded.call('status', first)).binding).toBeNull();
    expect((await reloaded.call('status', second)).binding.boardId).toBe('right');
    expect(methods.every((method) => method === 'GET')).toBe(true);
  });

  test('rejects invalid destinations, foreign workspaces and versions without overwriting a binding', async () => {
    const session = await host();
    await session.call('bind', first, 'left');
    await expect(session.call('bind', first, 'missing')).rejects.toThrow('existing board');
    const foreign = mkdtempSync(join(tmpdir(), 'amp-foreign-'));
    try {
      workspace = foreign;
      await expect(session.call('bind', first, 'right')).rejects.toThrow('belongs to');
      await expect(ensurePmxServer(foreign)).rejects.toThrow('executor');
    } finally {
      rmSync(foreign, { recursive: true, force: true });
    }
    workspace = root;
    version = '0.0.0';
    await expect(session.call('bind', first, 'right')).rejects.toThrow('differs from plugin runtime');
    version = runtimeVersion;
    expect((await session.call('status')).binding.boardId).toBe('left');
    server.stop(true);
    await expect(session.call('status')).rejects.toThrow();
    expect(await session.call('unbind')).toEqual({ binding: null });
  });

  test('cancelled tool and picker do not bind, duplicate titles select by ID', async () => {
    const session = await host();
    const controller = new AbortController();
    abortOnList = controller;
    await expect(session.call('bind', first, 'left', controller.signal)).rejects.toThrow();
    abortOnList = undefined;
    const command = session.commands.get('bind')!;
    let selection: string | undefined;
    const context = {
      thread: { id: first },
      ui: {
        select: async ({ options }: { options: string[] }) =>
          selection ? options.find((option) => option.endsWith(`(${selection})`)) : undefined,
        notify: async () => {},
      },
    } as unknown as PluginCommandContext;
    await command(context);
    expect((await session.call('status')).binding).toBeNull();
    selection = 'right';
    await command(context);
    expect((await session.call('status')).binding.boardId).toBe('right');
    expect(activeBoardId).toBe('visible-board');
  });

  test('bundles canonical guidance and explicit MCP filters without source checkout dependencies', () => {
    const build = Bun.spawnSync(['bun', 'run', 'scripts/build-amp-plugin.ts'], { cwd: sourceRoot });
    expect(build.exitCode).toBe(0);
    const output = join(sourceRoot, 'dist/amp-plugin/pmx-canvas');
    for (const name of ['pmx-canvas', 'pmx-canvas-testing', 'pmx-canvas-orchestration']) {
      expect(readFileSync(join(output, 'skills', name, 'SKILL.md'), 'utf8')).toBe(
        readFileSync(join(sourceRoot, 'skills', name, 'SKILL.md'), 'utf8'),
      );
    }
    const mcp = JSON.parse(readFileSync(join(output, 'skills/pmx-canvas/mcp.json'), 'utf8'));
    expect(mcp['pmx-canvas'].includeTools).toContain('canvas_connect_workspace');
    expect(mcp['pmx-canvas'].includeTools).toContain('canvas_board');
    const entry = readFileSync(join(output, 'index.js'), 'utf8');
    expect(entry).not.toContain('from "../../');
    expect(entry).not.toContain('from "@ampcode/plugin"');
  });

  test('generated MCP refuses initial and post-connect version mismatches', async () => {
    const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'amp-mcp-')));
    const installed = join(project, '.amp/plugins/pmx-canvas');
    mkdirSync(join(project, '.amp/plugins'), { recursive: true });
    cpSync(join(sourceRoot, 'dist/amp-plugin/pmx-canvas'), installed, { recursive: true });
    // Exercise installed-package resolution without selecting a cached registry build.
    mkdirSync(join(project, 'node_modules'));
    symlinkSync(sourceRoot, join(project, 'node_modules/pmx-canvas'), 'junction');
    workspace = project;
    version = '0.0.0';
    const client = new Client({ name: 'amp-plugin-test', version: '1' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(installed, 'start-mcp.mjs')],
      cwd: project,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter((item): item is [string, string] => item[1] !== undefined),
        ),
        PMX_CANVAS_WORKSPACE_ROOT: project,
      },
      stderr: 'pipe',
    });
    try {
      await client.connect(transport);
      const initial = await client.callTool({
        name: 'canvas_connect_workspace',
        arguments: { workspaceRoot: project },
      });
      expect(initial.isError).toBe(true);
      expect(JSON.stringify(initial.content)).toContain('differs from plugin runtime');
      version = runtimeVersion;
      expect(
        (await client.callTool({ name: 'canvas_connect_workspace', arguments: { workspaceRoot: project } })).isError,
      ).not.toBe(true);
      expect((await client.listResources()).resources.length).toBeGreaterThan(0);
      version = '0.0.0';
      // Bun on Windows can stall .rejects on an MCP response even after the child sent its error.
      const refusal = (request: Promise<unknown>) =>
        request.then(
          () => 'resolved',
          (error) => String(error),
        );
      expect(await refusal(client.listResources())).toContain('differs from plugin runtime');
      expect(await refusal(client.callTool({ name: 'canvas_board', arguments: { action: 'list' } }))).toContain(
        'differs from plugin runtime',
      );
    } finally {
      await client.close();
      await transport.close();
      rmSync(project, { recursive: true, force: true });
    }
  }, 15_000);
});
