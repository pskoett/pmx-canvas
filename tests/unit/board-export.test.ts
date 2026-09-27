import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
}

describe('static board export', () => {
  test('writes one self-contained, read-only file and lists what leaves the machine', async () => {
    const secretPath = join(root, 'notes.txt');
    writeFileSync(secretPath, 'private file body');
    await call('POST', '/api/canvas/node', {
      type: 'markdown',
      title: 'Plan',
      content: '# Plan\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.com)',
    });
    await call('POST', '/api/canvas/node', { type: 'html', title: 'Widget', html: '<h1>Widget body</h1>' });
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

    const preview = (await call('GET', '/api/canvas/export/preview')).body.manifest as Manifest;
    expect(preview.cards).toBe(6);
    expect(preview.frames).toBe(3);
    expect(preview.placeholders.map((entry) => entry.title)).toEqual(['Live app']);
    expect(preview.files).toEqual([{ nodeId: expect.any(String), path: secretPath, included: false }]);

    const exported = await call('POST', '/api/canvas/export', {});
    expect(exported.status).toBe(200);
    const html = readFileSync(exported.body.path as string, 'utf-8');

    // Author markup never runs in the export's own page.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('javascript:alert');
    expect(html).toContain('href=\\"https://example.com\\"');
    // File contents stay out unless the owner opts in.
    expect(html).not.toContain('private file body');
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
    expect(readFileSync(withFiles.body.path as string, 'utf-8')).toContain('private file body');

    const other = (await call('POST', '/api/canvas/boards', { name: 'Quiet board' })).body.board as { id: string };
    const exported = await call('POST', '/api/canvas/export', { board: other.id });
    expect((exported.body.manifest as Manifest & { boardName: string }).boardName).toBe('Quiet board');
    expect((exported.body.manifest as Manifest).cards).toBe(0);
    expect((await call('POST', '/api/canvas/export', { board: 'board-missing' })).status).toBe(404);
  });
});
