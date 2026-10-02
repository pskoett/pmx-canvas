import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';
import { version } from '../../package.json';
import {
  CANVAS_APP_URI,
  CANVAS_APP_WRITE_CONTRACT,
  canvasAppContext,
  canvasAppSnapshotSchema,
} from '../../src/shared/canvas-app.js';
import { createTestWorkspace, getAvailablePort, removeTestWorkspace } from './helpers.ts';

const root = createTestWorkspace('pmx-app-test-');
const client = new Client({ name: 'pmx-app-test', version: '1' });
let transport: StdioClientTransport;
let base: string;

beforeAll(async () => {
  const port = await getAvailablePort();
  base = `http://127.0.0.1:${port}`;
  transport = new StdioClientTransport({
    command: 'bun',
    args: [
      'run',
      process.env.PMX_APP_TEST_CLI ?? fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url)),
      '--mcp-app',
    ],
    cwd: root,
    env: {
      ...process.env,
      PMX_CANVAS_WORKSPACE_ROOT: root,
      PMX_CANVAS_DB_PATH: `${root}/canvas.db`,
      PMX_CANVAS_PORT: String(port),
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    },
    stderr: 'pipe',
  });
  await client.connect(transport);
}, 30_000);

afterAll(async () => {
  await client.close();
  await transport?.close();
  removeTestWorkspace(root);
});

async function read() {
  const result = await client.callTool({ name: 'pmx_read_canvas', arguments: {} });
  expect(result.isError).not.toBe(true);
  return { result, snapshot: canvasAppSnapshotSchema.parse(result._meta?.canvas) };
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.json();
}

test('private profile has only focused tools, standard resource, and both ChatGPT entrypoints', async () => {
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'pmx_add_note',
    'pmx_connect_nodes',
    'pmx_create_board',
    'pmx_move_node',
    'pmx_open_board',
    'pmx_open_canvas',
    'pmx_pin_nodes',
    'pmx_read_canvas',
    'pmx_read_node',
    'pmx_update_note',
    'pmx_workbench_request',
  ]);
  const open = tools.find((tool) => tool.name === 'pmx_open_canvas')!;
  expect(open._meta?.ui).toMatchObject({ resourceUri: CANVAS_APP_URI });
  expect(open._meta?.['openai/ui']).toMatchObject({ entrypoints: [{ type: 'global' }, { type: 'thread' }] });
  expect(open.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  for (const tool of tools.filter((tool) => ['pmx_add_note', 'pmx_connect_nodes'].includes(tool.name))) {
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, openWorldHint: false });
  }
  const resource = (await client.readResource({ uri: CANVAS_APP_URI })).contents[0]!;
  expect(resource.mimeType).toBe('text/html;profile=mcp-app');
  if (!('text' in resource)) throw new Error('Expected an HTML text resource');
  expect(resource.text).toContain('<div id="app"></div>');
  expect(resource.text).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
  expect(resource._meta?.ui).toMatchObject({ csp: { connectDomains: [], resourceDomains: [], frameDomains: [] } });
});

test('real stdio writes preserve board, attribution, fence and errors; previews stay out of model results', async () => {
  await read(); // Lazy-start the workspace daemon.
  const { board } = await post('/api/canvas/boards', { name: 'Plugin board' });
  await post('/api/canvas/boards/open', { id: board.id });
  const add = await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId: board.id, title: 'Decision', content: 'Private preview text', x: -120, y: 70 },
  });
  expect(add.isError).not.toBe(true);
  const first = await read();
  const note = first.snapshot.nodes.find((node) => node.title === 'Decision')!;
  expect(note.position).toEqual({ x: -120, y: 70 });
  expect(note.text).toBe('Private preview text');
  expect(JSON.stringify(first.result.structuredContent)).not.toContain('Private preview text');
  const persisted = await (await fetch(`${base}/api/canvas/node/${note.id}`)).json();
  expect(persisted.createdBy.actor).toBe('agent');

  await post('/api/canvas/context-pins', { nodeIds: [note.id], mode: 'set' });
  const pinned = await read();
  expect(pinned.snapshot.pinnedNodeIds).toEqual([note.id]);
  expect(pinned.snapshot.revision).not.toBe(first.snapshot.revision);
  const second = await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId: board.id, title: 'Action', content: 'Follow up', x: 600, y: 190 },
  });
  expect(second.isError).not.toBe(true);
  const other = (await read()).snapshot.nodes.find((node) => node.title === 'Action')!;
  expect(
    (
      await client.callTool({
        name: 'pmx_connect_nodes',
        arguments: { boardId: board.id, from: note.id, to: other.id, type: 'flow', label: 'next' },
      })
    ).isError,
  ).not.toBe(true);
  expect((await read()).snapshot.edges).toMatchObject([{ from: note.id, to: other.id, label: 'next' }]);

  const html = await (await fetch(`${base}/workbench`)).text();
  const token = JSON.parse(html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)![1]!);
  const human = { 'x-pmx-workbench': '1', 'x-pmx-workbench-token': token };
  await post('/api/canvas/ax/policy', { scope: { nodeIds: [note.id], padding: 0 } }, human);
  const fenced = await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId: board.id, title: 'Outside', content: 'Must not appear', x: 5000, y: 5000 },
  });
  expect(fenced.isError).toBe(true);
  expect(JSON.stringify(fenced.content)).toContain('scope');
  expect((await read()).snapshot.nodes).toHaveLength(2);
  await post('/api/canvas/ax/policy', { scope: null }, human);

  const { board: different } = await post('/api/canvas/boards', { name: 'Other board' });
  await post('/api/canvas/boards/open', { id: different.id });
  const stale = await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId: board.id, title: 'Stale', content: 'Must not appear', x: 0, y: 0 },
  });
  expect(stale.isError).toBe(true);
  const next = await read();
  expect(next.snapshot).toMatchObject({
    boardId: different.id,
    boardName: 'Other board',
    nodes: [],
    pinnedNodeIds: [],
  });
  await post('/api/canvas/boards/open', { id: null });
  expect((await read()).snapshot).toMatchObject({ boardId: null, nodes: [] });
}, 30_000);

test('app editing preserves full drafts, rejects concurrent content and board changes, and keeps unrelated pins', async () => {
  const home = (await read()).snapshot;
  expect((await client.callTool({ name: 'pmx_create_board', arguments: { name: 'Editable' } })).isError).not.toBe(true);
  const created = (await read()).snapshot;
  expect(created.boardId).toBe(home.boardId); // Creation does not silently switch everyone.
  const boardId = created.boards.find((board) => board.name === 'Editable')!.id;
  expect(
    (await client.callTool({ name: 'pmx_open_board', arguments: { id: boardId, expectedBoardId: home.boardId } }))
      .isError,
  ).not.toBe(true);
  const original = `${'Full editable content\n'.repeat(500)}TAIL`;
  await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId, title: 'Long note', content: original, x: -30, y: 75 },
  });
  await client.callTool({
    name: 'pmx_add_note',
    arguments: { boardId, title: 'Other pin', content: 'Keep pinned', x: 420, y: 90 },
  });
  const initial = (await read()).snapshot;
  const note = initial.nodes.find((node) => node.title === 'Long note')!;
  const other = initial.nodes.find((node) => node.title === 'Other pin')!;
  expect(note.editableContent).toBe(original);
  expect(note.text.length).toBeLessThan(original.length);
  const outcomes = await Promise.all(
    ['First competing edit', 'Second competing edit'].map((content) =>
      client.callTool({
        name: 'pmx_update_note',
        arguments: { boardId, id: note.id, expectedContentRevision: note.contentRevision, title: 'Edited', content },
      }),
    ),
  );
  expect(outcomes.filter((result) => !result.isError)).toHaveLength(1);
  expect(JSON.stringify(outcomes.find((result) => result.isError)?.content)).toContain('This node changed');
  const edited = (await read()).snapshot.nodes.find((node) => node.id === note.id)!;
  expect(['First competing edit', 'Second competing edit']).toContain(edited.editableContent!);
  expect(edited.contentRevision).toBeGreaterThan(note.contentRevision);
  expect(
    (await client.callTool({ name: 'pmx_move_node', arguments: { boardId, id: note.id, x: 245, y: -135 } })).isError,
  ).not.toBe(true);
  expect((await read()).snapshot.nodes.find((node) => node.id === note.id)).toMatchObject({
    position: { x: 245, y: -135 },
    contentRevision: edited.contentRevision,
  });
  for (const id of [other.id, note.id]) {
    expect(
      (await client.callTool({ name: 'pmx_pin_nodes', arguments: { boardId, nodeIds: [id], mode: 'add' } })).isError,
    ).not.toBe(true);
  }
  await client.callTool({ name: 'pmx_pin_nodes', arguments: { boardId, nodeIds: [note.id], mode: 'remove' } });
  expect((await read()).snapshot.pinnedNodeIds).toEqual([other.id]);

  expect(
    (
      await fetch(`${base}/api/canvas/node/${other.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { path: '/read-only-source.md' } }),
      })
    ).ok,
  ).toBe(true);
  expect((await read()).snapshot.nodes.find((node) => node.id === other.id)?.editableContent).toBeUndefined();
  expect(
    (
      await client.callTool({
        name: 'pmx_update_note',
        arguments: {
          boardId,
          id: other.id,
          expectedContentRevision: other.contentRevision,
          title: 'No',
          content: 'No',
        },
      })
    ).isError,
  ).toBe(true);
  expect(
    (
      await fetch(`${base}/api/canvas/node/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x'.repeat(50_001) }),
      })
    ).ok,
  ).toBe(true);
  expect((await read()).snapshot.nodes.find((node) => node.id === note.id)?.editableContent).toBeUndefined();

  await client.callTool({ name: 'pmx_open_board', arguments: { id: null, expectedBoardId: boardId } });
  for (const input of [
    { name: 'pmx_move_node', arguments: { boardId, id: note.id, x: 800, y: 900 } },
    { name: 'pmx_pin_nodes', arguments: { boardId, nodeIds: [note.id], mode: 'add' } },
    { name: 'pmx_connect_nodes', arguments: { boardId, from: note.id, to: other.id, type: 'flow' } },
  ]) {
    const refused = await client.callTool(input);
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.content)).toContain('active board changed');
  }
  expect((await read()).snapshot.boardId).toBeNull(); // Stale writes must not auto-open a board from Home.
}, 30_000);

test('model-visible note reads preserve the unseen tail when appending', async () => {
  await read();
  const { board } = await post('/api/canvas/boards', { name: 'Model source read' });
  await post('/api/canvas/boards/open', { id: board.id });
  const original = `${'Reference material\n'.repeat(500)}UNSEEN TAIL`;
  await post('/api/canvas/node', { type: 'markdown', title: 'Long source', content: original, x: -91, y: 237 });
  await post('/api/canvas/node', { type: 'markdown', title: 'Unrelated', content: 'Not requested', x: 430, y: 0 });
  // Only model-visible results, never _meta or the app's snapshot schema.
  const list = await client.callTool({ name: 'pmx_read_canvas', arguments: {} });
  const summary = z
    .object({ boardId: z.string(), nodes: z.array(z.object({ id: z.string(), title: z.string() })) })
    .parse(list.structuredContent);
  const id = summary.nodes.find((node) => node.title === 'Long source')!.id;
  const readResult = await client.callTool({ name: 'pmx_read_node', arguments: { boardId: summary.boardId, id } });
  const source = z
    .object({
      boardId: z.string(),
      id: z.string(),
      title: z.string(),
      content: z.string(),
      contentRevision: z.number(),
      position: z.object({ x: z.number(), y: z.number() }),
    })
    .parse(readResult.structuredContent);
  expect(source.content).toBe(original);
  expect(source.position).toEqual({ x: -91, y: 237 });
  expect(JSON.stringify(readResult.content)).toContain('UNSEEN TAIL');
  expect(JSON.stringify(readResult)).not.toContain('Not requested');
  const saved = await client.callTool({
    name: 'pmx_update_note',
    arguments: {
      boardId: source.boardId,
      id: source.id,
      title: source.title,
      content: `${source.content}\nAppended`,
      expectedContentRevision: source.contentRevision,
    },
  });
  expect(saved.isError).not.toBe(true);
  expect((await (await fetch(`${base}/api/canvas/node/${id}`)).json()).data.content).toBe(`${original}\nAppended`);
});

test('app refuses an old same-version daemon and rechecks a cached attachment', async () => {
  for (const explicitUrl of [false, true]) {
    let guarded = false;
    let writes = 0;
    const daemon = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === '/health')
          return Response.json({
            ok: true,
            workspace: root,
            version,
            ...(guarded
              ? { contracts: [CANVAS_APP_WRITE_CONTRACT] }
              : explicitUrl
                ? { contracts: ['pmx-guarded-writes-v1'] }
                : {}),
          });
        writes++;
        return Response.json({ ok: true }); // Old loose schemas would accept any preconditions.
      },
    });
    const peerTransport = new StdioClientTransport({
      command: 'bun',
      args: [
        'run',
        process.env.PMX_APP_TEST_CLI ?? fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url)),
        '--mcp-app',
      ],
      cwd: root,
      stderr: 'pipe',
      env: {
        ...process.env,
        PMX_CANVAS_WORKSPACE_ROOT: root,
        PMX_CANVAS_PORT: String(daemon.port),
        PMX_CANVAS_URL: explicitUrl ? `http://127.0.0.1:${daemon.port}` : '',
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
      },
    });
    const peer = new Client({ name: 'old-daemon-regression', version: '1' });
    try {
      await peer.connect(peerTransport);
      for (const request of [
        {
          name: 'pmx_update_note',
          arguments: {
            boardId: 'old',
            id: 'note',
            title: 'Stale',
            content: 'Must not overwrite',
            expectedContentRevision: 1,
          },
        },
        { name: 'pmx_open_board', arguments: { id: 'new', expectedBoardId: 'old' } },
      ]) {
        const result = await peer.callTool(request);
        expect(result.isError).toBe(true);
        expect(JSON.stringify(result.content)).toContain('Restart the PMX daemon');
      }
      expect(writes).toBe(0);
      guarded = true;
      expect((await peer.callTool({ name: 'pmx_create_board', arguments: { name: 'Supported' } })).isError).not.toBe(
        true,
      );
      expect(writes).toBe(1);
      guarded = false;
      expect(
        (await peer.callTool({ name: 'pmx_create_board', arguments: { name: 'Refused after replacement' } })).isError,
      ).toBe(true);
      expect(writes).toBe(1);
    } finally {
      await peer.close();
      await peerTransport.close();
      await daemon.stop(true);
    }
  }
}, 30_000);

test('context excludes uncurated content, stale ids and images; selected and pin budgets agree', () => {
  const snapshot = canvasAppSnapshotSchema.parse({
    boardId: 'board',
    boardName: 'Context',
    boards: [],
    revision: 'one',
    edges: [],
    pinnedNodeIds: ['n0', 'missing'],
    nodes: Array.from({ length: 25 }, (_, i) => ({
      id: `n${i}`,
      type: 'markdown',
      title: `Note ${i}`,
      text: `${i}:`.padEnd(800, 'x'),
      contentRevision: i,
      position: { x: i * 10, y: 0 },
      size: { width: 200, height: 100 },
      image: 'data:image/png;base64,AAAA',
    })),
  });
  const context = canvasAppContext(snapshot, ['missing', 'n2']);
  expect(context.selectedNodeIds).toEqual(['n2']);
  expect(context.pinnedNodeIds).toEqual(['n0']);
  expect(context.nodes.map((node) => node.id)).toEqual(['n0', 'n2']);
  expect(context.nodes[0]!.text).toHaveLength(700);
  expect(JSON.stringify(context)).not.toContain('base64');
  const bounded = canvasAppContext(
    snapshot,
    snapshot.nodes.slice(1).map((node) => node.id),
  );
  expect(bounded.selectedNodeIds).toHaveLength(20);
  expect(bounded.nodes).toHaveLength(21);
  expect(bounded.nodes.some((node) => node.id === 'n21')).toBe(false);
});

test('workbench transport preserves guards and authority, keeps hydration private, and rejects proxy escapes', async () => {
  const { board } = await post('/api/canvas/boards', { name: 'Real workbench transport' });
  await post('/api/canvas/boards/open', { id: board.id });
  const request = async (path: string, method = 'GET', body?: unknown, expectedBoardId: string | null = board.id) => {
    const result = await client.callTool({
      name: 'pmx_workbench_request',
      arguments: {
        path,
        method,
        expectedBoardId,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).not.toContain('Private full source');
    return z.object({ status: z.number(), body: z.string() }).parse(result._meta?.response);
  };
  const descriptor = (await client.listTools()).tools.find((tool) => tool.name === 'pmx_workbench_request')!;
  expect(descriptor._meta?.ui).toEqual({ visibility: ['app'] });
  expect(descriptor.annotations?.openWorldHint).toBe(true);
  const created = await request('/api/canvas/node', 'POST', {
    type: 'markdown',
    title: 'Transport',
    content: 'Private full source',
    x: 31,
    y: -74,
  });
  expect(created.status).toBeLessThan(300);
  const node = JSON.parse(created.body);
  expect(node.createdBy.actor).toBe('agent');
  const poll = await request('/api/workbench/poll');
  expect(poll.status).toBe(200);
  expect(poll.body).toContain('Private full source');
  const edit = { content: 'Kept', expectedContentRevision: node.contentRevision };
  expect((await request(`/api/canvas/node/${node.id}`, 'PATCH', edit, 'stale-board')).status).toBe(409);
  expect((await request(`/api/canvas/node/${node.id}`, 'PATCH', { content: 'No revision' })).status).toBe(409);
  expect((await request(`/api/canvas/node/${node.id}`, 'PATCH', edit)).status).toBe(200);
  expect((await request(`/api/canvas/node/${node.id}`, 'PATCH', edit)).status).toBe(409);
  expect((await request(`/api/canvas/boards/${board.id}`, 'DELETE', { humanAuthor: true })).status).toBe(403);
  for (const path of ['/workbench', '//example.com', '/api/workbench/webview', '/api/canvas/../..//workbench']) {
    expect((await request(path)).status).toBe(403);
  }
  expect((await request('/api/file/save', 'POST', { path: 'README.md', content: 'No' })).status).toBe(403);
  expect((await request('/api/workbench/webview/evaluate', 'POST', { script: '1+1' })).status).toBe(403);
});

test('local and attached app profiles cannot launch saved backends, forge sources, or resolve approvals', async () => {
  const peer = new Client({ name: 'attached-app-safety', version: '1' });
  const peerTransport = new StdioClientTransport({
    command: 'bun',
    args: [
      'run',
      process.env.PMX_APP_TEST_CLI ?? fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url)),
      '--mcp-app',
    ],
    cwd: root,
    env: {
      ...process.env,
      PMX_CANVAS_URL: base,
      PMX_CANVAS_WORKSPACE_ROOT: root,
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    },
    stderr: 'pipe',
  });
  const marker = `${root}/external-process-started`;
  const preload = `${root}/mark-start.ts`;
  writeFileSync(
    preload,
    `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'started');`,
  );
  const launch = {
    mode: 'ext-app',
    toolName: 'show_counter',
    transportConfig: {
      type: 'stdio',
      command: 'bun',
      args: ['--preload', preload, fileURLToPath(new URL('../fixtures/mcp-app-fixture.ts', import.meta.url))],
    },
  };
  const waitForSession = async (id: string, status: string) => {
    for (let i = 0; i < 100; i++) {
      const node = await (await fetch(`${base}/api/canvas/node/${id}`)).json();
      if (node.data.sessionStatus === status) return node;
      await Bun.sleep(50);
    }
    throw new Error(`Session did not become ${status}`);
  };
  try {
    await peer.connect(peerTransport);
    for (const app of [client, peer]) {
      const { board } = await post('/api/canvas/boards', { name: 'Saved backend safety' });
      await post('/api/canvas/boards/open', { id: board.id });
      const request = async (
        path: string,
        method: string,
        body?: unknown,
        expectedBoardId: string | null = board.id,
      ) => {
        const result = await app.callTool({
          name: 'pmx_workbench_request',
          arguments: {
            path,
            method,
            expectedBoardId,
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          },
        });
        expect(result.isError).not.toBe(true);
        return z.object({ status: z.number(), body: z.string() }).parse(result._meta?.response);
      };
      // Both fresh executable metadata and updates to existing nodes are refused.
      expect((await request('/api/canvas/node', 'POST', { type: 'mcp-app', data: launch })).status).toBe(403);
      const saved = await post('/api/canvas/node', { type: 'mcp-app', title: 'Locally configured app', data: launch });
      expect((await request(`/api/canvas/node/${saved.id}`, 'PATCH', { data: launch })).status).toBe(403);
      const { id: snapshotId } = await post('/api/canvas/snapshots', { name: 'Saved external backend' });
      await post('/api/canvas/boards/open', { id: null });
      expect(
        (await request('/api/canvas/boards/open', 'POST', { id: board.id, allowExternalMcp: true }, null)).status,
      ).toBe(200);
      expect((await waitForSession(saved.id, 'error')).data.sessionError).toContain('embedded actions cannot launch');
      expect(existsSync(marker)).toBe(false);
      expect((await request(`/api/canvas/snapshots/${snapshotId}`, 'POST', { allowExternalMcp: true })).status).toBe(
        200,
      );
      await waitForSession(saved.id, 'error');
      expect(existsSync(marker)).toBe(false);
      await post('/api/canvas/boards/open', { id: null });
      const opened = await app.callTool({ name: 'pmx_open_board', arguments: { id: board.id, expectedBoardId: null } });
      expect(opened.isError).not.toBe(true);
      await waitForSession(saved.id, 'error');
      expect(existsSync(marker)).toBe(false);

      const gate = await post('/api/canvas/ax/approval', { title: 'Must stay pending' });
      const gateId = gate.approvalGate.id;
      expect(
        (await request(`/api/canvas/ax/approval/${gateId}/resolve`, 'POST', { status: 'approved', source: 'system' }))
          .status,
      ).toBe(403);
      expect((await request(`/api/canvas/ax/approval/${gateId}/reopen`, 'POST', { source: 'browser' })).status).toBe(
        403,
      );
      expect(
        (
          await request('/api/canvas/ax/interaction', 'POST', {
            type: 'ax.approval.resolve',
            sourceNodeId: saved.id,
            payload: { approvalId: gateId, status: 'approved' },
          })
        ).status,
      ).toBe(403);
      const steer = await request('/api/canvas/ax/steer', 'POST', {
        message: 'Embedded feedback',
        source: 'system',
        agentId: 'forged-writer',
      });
      expect(steer.status).toBe(200);
      expect(JSON.parse(steer.body).steering.source).toBe('mcp');
      expect(JSON.parse(steer.body).steering.agentId).not.toBe('forged-writer');
      const gateState = await (await fetch(`${base}/api/canvas/ax/approval/${gateId}`)).json();
      expect(gateState.approvalGate.status).toBe('pending');

      // DELETE on Home travels through a custom reader and a remote query string.
      await post('/api/canvas/boards/open', { id: null });
      const { intent } = await post('/api/canvas/ax/intent', {
        kind: 'create',
        position: { x: 12, y: 35 },
        nodeType: 'markdown',
      });
      const clear = await request(`/api/canvas/ax/intent/${intent.id}?vetoed=true`, 'DELETE', undefined, null);
      expect(clear.status).toBe(200);
      expect(JSON.parse(clear.body).cleared).toBe(true);

      // Independent local action still launches the same valid backend.
      await post('/api/canvas/boards/open', { id: board.id });
      await waitForSession(saved.id, 'ready');
      expect(existsSync(marker)).toBe(true);
      await post('/api/canvas/boards/open', { id: null });
      rmSync(marker);
    }
  } finally {
    await peer.close();
    await peerTransport.close();
  }
}, 30_000);

test('app cold start does not execute launch metadata from the saved database', async () => {
  const workspace = createTestWorkspace('pmx-app-cold-');
  const marker = `${workspace}/launched`;
  const cli = process.env.PMX_APP_TEST_CLI ?? fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
  const stateModule = new URL('../server/canvas-state.ts', pathToFileURL(cli)).href;
  const env = {
    ...process.env,
    PMX_CANVAS_WORKSPACE_ROOT: workspace,
    PMX_CANVAS_DB_PATH: `${workspace}/canvas.db`,
    PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    PMX_CANVAS_URL: '',
    PMX_CANVAS_PORT: String(await getAvailablePort()),
  };
  const node = {
    id: 'saved-backend',
    type: 'mcp-app',
    zIndex: 1,
    position: { x: 0, y: 0 },
    size: { width: 400, height: 300 },
    data: {
      mode: 'ext-app',
      toolName: 'show_counter',
      transportConfig: { type: 'stdio', command: '/usr/bin/touch', args: [marker] },
    },
  };
  const seed = Bun.spawn(
    [
      'bun',
      '-e',
      `import { canvasState } from ${JSON.stringify(stateModule)};
    canvasState.setWorkspaceRoot(${JSON.stringify(workspace)}); canvasState.loadFromDisk();
    const board = canvasState.createBoard('Persisted backend'); canvasState.switchBoard(board.id);
    canvasState.addNode(${JSON.stringify(node)}); canvasState.close();`,
    ],
    { env, stdout: 'pipe', stderr: 'pipe' },
  );
  expect(await seed.exited, await new Response(seed.stderr).text()).toBe(0);
  const coldTransport = new StdioClientTransport({
    command: 'bun',
    args: ['run', cli, '--mcp-app'],
    cwd: workspace,
    env,
    stderr: 'pipe',
  });
  const cold = new Client({ name: 'app-cold-start', version: '1' });
  try {
    await cold.connect(coldTransport);
    expect((await cold.callTool({ name: 'pmx_read_canvas', arguments: {} })).isError).not.toBe(true);
    const response = await cold.callTool({
      name: 'pmx_workbench_request',
      arguments: { path: '/api/canvas/node/saved-backend', method: 'GET', expectedBoardId: null },
    });
    const wire = z.object({ status: z.number(), body: z.string() }).parse(response._meta?.response);
    expect(wire.status).toBe(200);
    expect(JSON.parse(wire.body).data.sessionError).toContain('embedded actions cannot launch');
    expect(existsSync(marker)).toBe(false);
  } finally {
    await cold.close();
    await coldTransport.close();
    removeTestWorkspace(workspace);
  }
}, 15_000);

async function withAppProfiles(run: (app: Client) => Promise<void>) {
  const peer = new Client({ name: 'app-policy-regression', version: '1' });
  const peerTransport = new StdioClientTransport({
    command: 'bun',
    args: [
      'run',
      process.env.PMX_APP_TEST_CLI ?? fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url)),
      '--mcp-app',
    ],
    cwd: root,
    env: {
      ...process.env,
      PMX_CANVAS_URL: base,
      PMX_CANVAS_WORKSPACE_ROOT: root,
      PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
    },
    stderr: 'pipe',
  });
  try {
    await peer.connect(peerTransport);
    for (const app of [client, peer]) await run(app);
  } finally {
    await peer.close();
    await peerTransport.close();
  }
}

async function appRequest(app: Client, boardId: string, path: string, body: unknown, method = 'POST') {
  const result = await app.callTool({
    name: 'pmx_workbench_request',
    arguments: {
      path,
      method,
      expectedBoardId: boardId,
      body: JSON.stringify(body),
    },
  });
  expect(result.isError).not.toBe(true);
  return z.object({ status: z.number(), body: z.string() }).parse(result._meta?.response);
}

async function humanHeaders() {
  const html = await (await fetch(`${base}/workbench`)).text();
  const token = JSON.parse(html.match(/window\.__PMX_WORKBENCH_TOKEN = ("[^"]+")/)![1]!);
  return { 'x-pmx-workbench': '1', 'x-pmx-workbench-token': token };
}

test('both app profiles leave flow materialization local-only, preserving fenced and held nodes', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'Flow policy' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const source = await post('/api/canvas/node', {
      type: 'html',
      title: 'Flow',
      x: 100,
      y: 100,
      data: { html: '<p>Flow</p>', axCapabilities: { enabled: true, allowed: ['ax.flow.materialize'] } },
    });
    const flow = {
      type: 'ax.flow.materialize',
      sourceNodeId: source.id,
      sourceSurface: 'html-node',
      payload: { title: 'Flow', steps: [{ title: 'Original step' }] },
    };
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [source.id], padding: 0 } }, human);
    expect((await appRequest(app, board.id, '/api/canvas/ax/interaction', flow)).status).toBe(403);
    expect((await (await fetch(`${base}/api/canvas/state`)).json()).nodes).toHaveLength(1);
    // Local materialization is unchanged, even when its output lies outside the fence.
    await post('/api/canvas/ax/interaction', flow, human);
    const stepId = `axflow-${source.id}-step-1`;
    const before = await (await fetch(`${base}/api/canvas/node/${stepId}`)).json();
    await post('/api/canvas/human-presence', { clientId: 'flow-guard-test', grabbingNodeId: stepId }, human);
    expect(
      (
        await appRequest(app, board.id, '/api/canvas/ax/interaction', {
          ...flow,
          payload: { title: 'Flow', steps: [{ title: 'Must not replace held step' }] },
        })
      ).status,
    ).toBe(403);
    expect(await (await fetch(`${base}/api/canvas/node/${stepId}`)).json()).toEqual(before);
    await post('/api/canvas/human-presence', { clientId: 'flow-guard-test', left: true }, human);
  });
}, 15_000);

test('both app profiles refuse undo and redo without replaying excluded held history targets', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'History policy' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const inside = await post('/api/canvas/node', { type: 'markdown', title: 'Inside', x: 100, y: 100 }, human);
    const outside = await post('/api/canvas/node', { type: 'markdown', title: 'Outside', x: 2000, y: 2000 }, human);
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [inside.id], padding: 0 } }, human);
    await post('/api/canvas/update', { updates: [{ id: outside.id, position: { x: 2300, y: 2100 } }] }, human);
    await post('/api/canvas/human-presence', { clientId: 'history-guard-test', grabbingNodeId: outside.id }, human);
    const position = async () => (await (await fetch(`${base}/api/canvas/node/${outside.id}`)).json()).position;
    expect((await appRequest(app, board.id, '/api/canvas/undo', {})).status).toBe(403);
    expect(await position()).toEqual({ x: 2300, y: 2100 });
    await post('/api/canvas/undo', {}, human);
    expect(await position()).toEqual({ x: 2000, y: 2000 });
    expect((await appRequest(app, board.id, '/api/canvas/redo', {})).status).toBe(403);
    expect(await position()).toEqual({ x: 2000, y: 2000 });
    await post('/api/canvas/redo', {}, human);
    expect(await position()).toEqual({ x: 2300, y: 2100 });
    await post('/api/canvas/human-presence', { clientId: 'history-guard-test', left: true }, human);
  });
}, 15_000);

test('both app profiles guard automatic parent frames on child move and resize, but not manual frames', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'Parent frame policy' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const child = await post('/api/canvas/node', { type: 'markdown', title: 'Child', x: 100, y: 100 }, human);
    const group = await post('/api/canvas/group', { title: 'Auto frame', childIds: [child.id] }, human);
    const get = async (id: string) => await (await fetch(`${base}/api/canvas/node/${id}`)).json();
    const beforeChild = await get(child.id);
    const beforeGroup = await get(group.id);
    const position = { x: beforeChild.position.x + 20, y: beforeChild.position.y + 30 };
    const move = { updates: [{ id: child.id, position }] };
    const resize = {
      updates: [{ id: child.id, size: { width: beforeChild.size.width + 45, height: beforeChild.size.height + 70 } }],
    };
    await post('/api/canvas/human-presence', { clientId: 'parent-guard-test', grabbingNodeId: group.id }, human);
    for (const update of [move, resize]) {
      expect((await appRequest(app, board.id, '/api/canvas/update', update)).status).toBe(409);
      expect(await get(child.id)).toEqual(beforeChild);
      expect(await get(group.id)).toEqual(beforeGroup);
    }
    expect((await appRequest(app, board.id, `/api/canvas/node/${child.id}`, position, 'PATCH')).status).toBe(409);
    await post('/api/canvas/human-presence', { clientId: 'parent-guard-test', left: true }, human);
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [child.id], padding: 80 } }, human);
    expect((await appRequest(app, board.id, '/api/canvas/update', move)).status).toBe(403);
    expect(await get(group.id)).toEqual(beforeGroup);
    // Granting the parent (which also grants its children) allows the same move.
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [group.id], padding: 80 } }, human);
    expect((await appRequest(app, board.id, '/api/canvas/update', move)).status).toBe(200);
    expect((await get(child.id)).position).toEqual(position);
    expect((await get(group.id)).position).toEqual({ x: beforeGroup.position.x + 20, y: beforeGroup.position.y + 30 });
    // A manual parent's geometry is not affected, so holding it does not lock its child.
    const manual = await fetch(`${base}/api/canvas/node/${group.id}`, {
      method: 'PATCH',
      headers: { ...human, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { frameMode: 'manual' } }),
    });
    expect(manual.ok).toBe(true);
    const manualBefore = await get(group.id);
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [child.id], padding: 80 } }, human);
    await post('/api/canvas/human-presence', { clientId: 'parent-guard-test', grabbingNodeId: group.id }, human);
    expect((await appRequest(app, board.id, '/api/canvas/update', resize)).status).toBe(200);
    expect((await get(child.id)).size).toEqual(resize.updates[0]!.size);
    expect((await get(group.id)).position).toEqual(manualBefore.position);
    expect((await get(group.id)).size).toEqual(manualBefore.size);
    await post('/api/canvas/human-presence', { clientId: 'parent-guard-test', left: true }, human);
  });
}, 15_000);

test('both app profiles refit only affected frames, leaving an unrelated held frame unchanged', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'Unrelated frames' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const a = await post('/api/canvas/node', { type: 'markdown', title: 'A', x: 100, y: 100 }, human);
    const b = await post('/api/canvas/node', { type: 'markdown', title: 'B', x: 2000, y: 1000 }, human);
    const ga = await post('/api/canvas/group', { title: 'Frame A', childIds: [a.id] }, human);
    const gb = await post('/api/canvas/group', { title: 'Frame B', childIds: [b.id] }, human);
    const get = async (id: string) => await (await fetch(`${base}/api/canvas/node/${id}`)).json();
    const originalB = await get(gb.id);
    await post(
      '/api/canvas/update',
      {
        updates: [{ id: gb.id, size: { width: originalB.size.width + 700, height: originalB.size.height + 400 } }],
      },
      human,
    );
    const resizedB = await get(gb.id);
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [ga.id], padding: 80 } }, human);
    await post('/api/canvas/human-presence', { clientId: 'unrelated-frame-test', grabbingNodeId: gb.id }, human);
    for (const method of ['POST', 'PATCH']) {
      const before = await get(a.id);
      const frame = await get(ga.id);
      const position = { x: before.position.x + 10, y: before.position.y + 10 };
      const path = method === 'POST' ? '/api/canvas/update' : `/api/canvas/node/${a.id}`;
      const body = method === 'POST' ? { updates: [{ id: a.id, position }] } : { position };
      expect((await appRequest(app, board.id, path, body, method)).status).toBe(200);
      expect((await get(a.id)).position).toEqual(position);
      expect((await get(ga.id)).position).toEqual({ x: frame.position.x + 10, y: frame.position.y + 10 });
      expect(await get(gb.id)).toEqual(resizedB);
    }
    await post('/api/canvas/human-presence', { clientId: 'unrelated-frame-test', left: true }, human);
  });
}, 15_000);

test('both app profiles guard normalized group destinations and translated children', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'Group destinations' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const child = await post('/api/canvas/node', { type: 'markdown', title: 'Child', x: 100, y: 100 }, human);
    const group = await post('/api/canvas/group', { title: 'Frame', childIds: [child.id] }, human);
    const get = async (id: string) => await (await fetch(`${base}/api/canvas/node/${id}`)).json();
    const before = await get(group.id);
    const beforeChild = await get(child.id);
    const right = before.position.x + before.size.width;
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [group.id], padding: 0 } }, human);
    for (const patch of [
      { position: { x: 9000, y: 9000 } },
      { x: 9000 },
      { position: { y: 9000 } },
      { x: right, y: before.position.y },
    ]) {
      expect((await appRequest(app, board.id, `/api/canvas/node/${group.id}`, patch, 'PATCH')).status).toBe(403);
      expect(await get(group.id)).toEqual(before);
      expect(await get(child.id)).toEqual(beforeChild);
    }
    // Both origin destinations remain inside: top-level x takes precedence over its nested alias.
    expect(
      (
        await appRequest(
          app,
          board.id,
          `/api/canvas/node/${group.id}`,
          {
            x: before.position.x + 5,
            position: { x: 9000 },
          },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await get(group.id)).position).toEqual({ x: before.position.x + 5, y: before.position.y });
    expect((await get(child.id)).position).toEqual({ x: beforeChild.position.x + 5, y: beforeChild.position.y });
    await post('/api/canvas/human-presence', { clientId: 'translated-child-test', grabbingNodeId: child.id }, human);
    expect(
      (await appRequest(app, board.id, `/api/canvas/node/${group.id}`, { x: before.position.x + 6 }, 'PATCH')).status,
    ).toBe(409);
    await post('/api/canvas/human-presence', { clientId: 'translated-child-test', left: true }, human);
  });
}, 15_000);

test('both app profiles discard invalid bulk overrides before calculating translated destinations', async () => {
  await withAppProfiles(async (app) => {
    const { board } = await post('/api/canvas/boards', { name: 'Validated overrides' });
    await post('/api/canvas/boards/open', { id: board.id });
    const human = await humanHeaders();
    const child = await post('/api/canvas/node', { type: 'markdown', title: 'Child', x: 100, y: 100 }, human);
    const group = await post('/api/canvas/group', { title: 'Frame', childIds: [child.id] }, human);
    const get = async (id: string) => await (await fetch(`${base}/api/canvas/node/${id}`)).json();
    const before = await get(group.id);
    const beforeChild = await get(child.id);
    const move = { id: group.id, position: { x: before.position.x + before.size.width, y: before.position.y } };
    await post('/api/canvas/ax/policy', { scope: { nodeIds: [group.id], padding: 0 } }, human);
    expect(
      (
        await appRequest(app, board.id, '/api/canvas/update', {
          updates: [move, { id: child.id, position: beforeChild.position, size: { width: -1, height: 100 } }],
        })
      ).status,
    ).toBe(403);
    expect(await get(group.id)).toEqual(before);
    expect(await get(child.id)).toEqual(beforeChild);
    // A VALID explicit child position does suppress translation, even if that position is unchanged.
    expect(
      (
        await appRequest(app, board.id, '/api/canvas/update', {
          updates: [move, { id: child.id, position: beforeChild.position }],
        })
      ).status,
    ).toBe(200);
    expect((await get(group.id)).position).toEqual(move.position);
    expect((await get(child.id)).position).toEqual(beforeChild.position);
  });
}, 15_000);
