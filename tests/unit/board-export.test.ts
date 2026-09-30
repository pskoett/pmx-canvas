import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { buildBoardExport, writeBoardExport } from '../../src/server/board-export.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

const HUMAN = { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' };
let root = '';
let baseUrl = '';

beforeAll(() => {
  root = createTestWorkspace('pmx-canvas-export-');
  resetCanvasForTests(root);
  const base = startCanvasServer({ workspaceRoot: root, port: 0 });
  if (!base) throw new Error('Failed to start canvas server for tests.');
  baseUrl = base.replace(/\/$/, '');
});

afterAll(() => {
  stopCanvasServer();
  removeTestWorkspace(root);
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HUMAN,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

interface Manifest {
  cards: number;
  frames: number;
  placeholders: Array<{ title: string }>;
  files: Array<{ nodeId: string; path: string; included: boolean }>;
  links: string[];
  frameNetworkDestinations: string[];
  embeddedCodeCanAccessNetwork: boolean;
}

describe('static board export', () => {
  test('does not overwrite exports whose timestamp names collide and serves their suffixed URLs', async () => {
    const clock = spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-09-27T00:00:00.000Z');
    let paths: string[];
    try {
      paths = Array.from({ length: 20 }, (_, index) => writeBoardExport(`export ${index}`, 'Collision'));
    } finally {
      clock.mockRestore();
    }
    expect(new Set(paths).size).toBe(paths.length);
    paths.forEach((path, index) => {
      expect(readFileSync(path, 'utf-8')).toBe(`export ${index}`);
    });
    const suffixed = paths.find((path) => /-\d+\.html$/.test(path));
    expect(suffixed).toBeDefined();
    const served = await fetch(`${baseUrl}/api/canvas/exports/${basename(suffixed ?? '')}`);
    expect(served.status).toBe(200);
    expect(await served.text()).toStartWith('export ');
  });

  test('does not serve an export symlink that escapes the exports folder', async () => {
    const secretPath = join(root, 'export-route-secret.txt');
    writeFileSync(secretPath, 'must not be served');
    const exported = writeBoardExport('safe export', 'Escape');
    const symlink = join(exported, '..', 'escape-20000101T000000000Z.html');
    symlinkSync(secretPath, symlink);

    const served = await fetch(`${baseUrl}/api/canvas/exports/${basename(symlink)}`);
    expect(served.status).toBe(404);
    expect(await served.text()).not.toContain('must not be served');
  });

  test('writes one self-contained, read-only file and lists what leaves the machine', async () => {
    const secretPath = join(root, 'notes.txt');
    writeFileSync(secretPath, 'private file body');
    const artifactDir = join(root, '.pmx-canvas', 'artifacts', 'reviewed-app');
    mkdirSync(artifactDir, { recursive: true });
    const artifactPath = join(artifactDir, 'bundle.html');
    writeFileSync(
      artifactPath,
      '<h1>Owned artifact body</h1><img src="https://cdn.example/artifact.png"><script>fetch(dynamicUrl)</script>',
    );
    const artifactSymlink = join(root, '.pmx-canvas', 'artifacts', 'escaped.html');
    symlinkSync(secretPath, artifactSymlink);
    await call('POST', '/api/canvas/node', {
      type: 'markdown',
      title: 'Plan',
      content: '# Plan\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)',
    });
    await call('POST', '/api/canvas/node', {
      type: 'webpage',
      title: 'Reference',
      url: 'http://127.0.0.1:1/reviewed-export',
    });
    await call('POST', '/api/canvas/node', {
      type: 'html',
      title: 'Widget',
      html: '<h1>Widget body</h1><script src="https://scripts.example/widget.js"></script>',
    });
    for (const title of ['Chart A', 'Chart B']) {
      await call('POST', '/api/canvas/graph', {
        title,
        graphType: 'bar',
        data: [{ label: 'x', value: 1 }],
        xKey: 'label',
        yKey: 'value',
      });
    }
    await call('POST', '/api/canvas/node', { type: 'file', content: secretPath });
    await call('POST', '/api/canvas/node', {
      type: 'mcp-app',
      title: 'Live app',
      data: { url: 'https://apps.example/app', title: 'Live app' },
    });
    await call('POST', '/api/canvas/node', {
      type: 'mcp-app',
      title: 'Owned app',
      data: { viewerType: 'web-artifact', path: artifactPath },
    });
    await call('POST', '/api/canvas/node', {
      type: 'mcp-app',
      title: 'Forged app',
      data: { viewerType: 'web-artifact', path: secretPath },
    });
    await call('POST', '/api/canvas/node', {
      type: 'mcp-app',
      title: 'Symlink app',
      data: { viewerType: 'web-artifact', path: artifactSymlink },
    });

    const preview = (await call('GET', '/api/canvas/export/preview')).body.manifest as Manifest;
    expect(preview.cards).toBe(10);
    expect(preview.frames).toBe(4);
    expect(preview.placeholders.map((entry) => entry.title)).toEqual(['Live app', 'Forged app', 'Symlink app']);
    expect(preview.files).toEqual([{ nodeId: expect.any(String), path: secretPath, included: false }]);
    expect(preview.links).toEqual(['https://example.com', 'http://127.0.0.1:1/reviewed-export']);
    expect(preview.frameNetworkDestinations).toEqual([
      'https://scripts.example/widget.js',
      'https://cdn.example/artifact.png',
    ]);
    expect(preview.embeddedCodeCanAccessNetwork).toBe(true);

    const exported = await call('POST', '/api/canvas/export', {});
    expect(exported.status).toBe(200);
    const html = readFileSync(exported.body.path as string, 'utf-8');

    // Author markup never runs in the export's own page.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href=\\"https://example.com\\"');
    // File contents stay out unless the owner opts in.
    expect(html).not.toContain('private file body');
    expect(html).toContain('Owned artifact body');
    // The chart viewer bundle is stored once, shared by both charts.
    const marker = '__PMX_EXPORT_JSONRENDER_JS__';
    expect(html.split(marker).length - 1).toBe(3); // two frames + one asset key
    expect(html).toContain('<h1>Widget body</h1>'.replace(/</g, '\\u003c'));

    const served = await fetch(`${baseUrl}${exported.body.url}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-security-policy')).toContain('sandbox allow-scripts');
    expect((await fetch(`${baseUrl}/api/canvas/exports/..%2Fcanvas.db`)).status).toBe(404);
  });

  test('file contents are included only on request, and any board can be exported', async () => {
    const withFiles = await call('POST', '/api/canvas/export', { includeFiles: true });
    const html = readFileSync(withFiles.body.path as string, 'utf-8');
    expect(html).toContain('private file body');
    // The content appears once as the opted-in file card, never again through either forged app path.
    expect(html.split('private file body')).toHaveLength(2);

    const other = (await call('POST', '/api/canvas/boards', { name: 'Quiet board' })).body.board as { id: string };
    const exported = await call('POST', '/api/canvas/export', { board: other.id });
    expect((exported.body.manifest as Manifest & { boardName: string }).boardName).toBe('Quiet board');
    expect((exported.body.manifest as Manifest).cards).toBe(0);
    expect((await call('POST', '/api/canvas/export', { board: 'board-missing' })).status).toBe(404);
  });

  test('uses one board snapshot when state changes while export collection awaits', async () => {
    const boardId = canvasState.activeBoardId;
    if (!boardId) throw new Error('Expected an active board.');
    canvasState.setTheme('dark');
    const before = canvasState.getLayout();
    const [from, to] = before.nodes;
    if (!from || !to) throw new Error('Expected at least two nodes.');

    const pending = buildBoardExport(boardId, false);
    canvasState.setTheme('light');
    const edgeId = 'edge-added-while-export-awaits';
    expect(canvasState.addEdge({ id: edgeId, from: from.id, to: to.id, type: 'relation' })).toBe(true);

    const exported = await pending;
    expect(exported).not.toBeNull();
    expect(exported?.manifest.connections).toBe(before.edges.length);
    expect(exported?.html).toContain('<html lang="en" data-scheme="dark">');
    const boardJson = exported?.html.match(/<script type="application\/json" id="pmx-board">(.*?)<\/script>/s)?.[1];
    expect(boardJson).toBeDefined();
    expect((JSON.parse(boardJson ?? '{}') as { edges: unknown[] }).edges).toHaveLength(before.edges.length);

    canvasState.removeEdge(edgeId);
    canvasState.setTheme('dark');
  });

  test('renders readable tables and preserves the display content of plain node types', async () => {
    const { body } = await call('POST', '/api/canvas/boards', { name: 'Export formatting' });
    const board = body.board as { id: string };
    await call('POST', '/api/canvas/boards/open', { id: board.id });
    const fixtures = [
      { type: 'markdown', title: 'Table', content: '| Team | Cost |\n| :--- | ---: |\n| **News** | 37.80 |' },
      { type: 'file', title: 'teams.csv', content: 'Team,Note\n"News, sports","<script>bad()</script>"\n' },
      { type: 'status', title: 'Status', content: 'Review complete' },
      { type: 'context', title: 'Context', content: 'Context fallback body' },
      { type: 'trace', title: 'Trace', content: 'Trace fallback body', data: { error: 'Trace error detail' } },
    ];
    for (const fixture of fixtures) expect((await call('POST', '/api/canvas/node', fixture)).status).toBe(200);
    const exported = await buildBoardExport(board.id, false);
    const payload = exported!.html.match(/id="pmx-board">(.*?)<\/script>/s)![1];
    const cards = (JSON.parse(payload) as { cards: Array<{ title: string; html: string }> }).cards;
    const html = (title: string) => cards.find((card) => card.title === title)!.html;
    expect(html('Table')).toContain('class="table-scroll"');
    expect(html('Table')).toContain('<strong>News</strong>');
    expect(html('Table')).toContain('align="right"');
    expect(html('teams.csv')).toContain('<td>News, sports</td>');
    expect(html('teams.csv')).toContain('&lt;script&gt;bad()&lt;/script&gt;');
    expect(html('teams.csv')).not.toContain('<script>');
    expect(html('Status')).toContain('Review complete');
    expect(html('Context')).toContain('Context fallback body');
    expect(html('Trace')).toContain('Trace fallback body');
    expect(html('Trace')).toContain('Trace error detail');
  });

  test('bounds delimited table previews without losing rows beyond the limit', async () => {
    const { body } = await call('POST', '/api/canvas/boards', { name: 'Table preview limits' });
    const board = body.board as { id: string };
    await call('POST', '/api/canvas/boards/open', { id: board.id });
    for (const count of [500, 501]) {
      const content = `Item\tValue\n${Array.from({ length: count }, (_, i) => `Row ${i + 1}\t${i + 17}`).join('\n')}`;
      expect((await call('POST', '/api/canvas/node', { type: 'file', title: `${count}.tsv`, content })).status).toBe(
        200,
      );
    }
    const exported = await buildBoardExport(board.id, false);
    const payload = exported!.html.match(/id="pmx-board">(.*?)<\/script>/s)![1];
    const cards = (JSON.parse(payload) as { cards: Array<{ title: string; html: string }> }).cards;
    for (const card of cards) {
      expect(card.html.match(/<tr>/g)).toHaveLength(501); // header plus 500 data rows
      expect(card.html).toContain('<td>Row 500</td><td>516</td>');
      if (card.title === '500.tsv') {
        expect(card.html).not.toContain('<details>');
      } else {
        expect(card.html).toContain('Showing 500 of 501 rows');
        expect(card.html).not.toContain('<td>Row 501</td>');
        expect(card.html).toContain('Row 501\t517'); // retained in full-text disclosure
      }
    }
  });
});
