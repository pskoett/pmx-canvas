import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

// Malformed JSON bodies must 400 on both legacy and registry routes instead
// of silently no-oping, and HTTP search must honor ?limit= like the MCP tool.

let workspaceRoot: string;
let baseUrl: string;

beforeAll(() => {
  workspaceRoot = createTestWorkspace('pmx-canvas-http-hygiene-');
  resetCanvasForTests(workspaceRoot);
  const base = startCanvasServer({ workspaceRoot, port: 0 });
  if (!base) {
    throw new Error('Failed to start canvas server for tests.');
  }
  baseUrl = base;
});

afterAll(() => {
  stopCanvasServer();
  removeTestWorkspace(workspaceRoot);
});

test('malformed JSON body returns 400 on a legacy route', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/viewport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"x": 1,',
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok?: boolean; error?: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain('Malformed');
});

test('malformed JSON body returns 400 on a registry route', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/node`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok?: boolean; error?: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain('Malformed');
});

test('an empty body is still treated as empty input, not rejected', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/viewport`, { method: 'POST' });
  expect(res.status).toBe(200);
});

test('a bare-array batch body still works (issue #49 non-regression)', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ op: 'node.add', args: { type: 'markdown', title: 'batch bare', content: 'x' } }]),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok?: boolean; results?: unknown[] };
  expect(body.ok).toBe(true);
  expect(body.results?.length).toBe(1);
});

test('batch supports edge.remove (0.3.1 test-report Finding M)', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      operations: [
        { op: 'node.add', assign: 'a', args: { type: 'markdown', title: 'edge batch a', content: 'x' } },
        { op: 'node.add', assign: 'b', args: { type: 'markdown', title: 'edge batch b', content: 'y' } },
        { op: 'edge.add', assign: 'e', args: { from: '$a', to: '$b', type: 'relation' } },
        { op: 'edge.remove', args: { id: '$e' } },
        { op: 'node.remove', args: { id: '$a' } },
        { op: 'node.remove', args: { id: '$b' } },
      ],
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { ok?: boolean; results?: Array<Record<string, unknown>> };
  expect(body.ok).toBe(true);
  expect(body.results?.length).toBe(6);
});

test('a malformed batch body returns 400, not a partial-failure envelope', async () => {
  const res = await fetch(`${baseUrl}/api/canvas/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '[{"op":"node.add",',
  });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { ok?: boolean; error?: string };
  expect(body.ok).toBe(false);
  expect(body.error).toContain('Malformed');
});

test('HTTP search honors the limit parameter', async () => {
  for (let i = 0; i < 3; i += 1) {
    const res = await fetch(`${baseUrl}/api/canvas/node`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'markdown', title: `hygiene needle ${i}`, content: 'hygiene-needle' }),
    });
    expect(res.status).toBe(200);
  }

  const limited = await fetch(`${baseUrl}/api/canvas/search?q=hygiene-needle&limit=2`);
  expect(limited.status).toBe(200);
  const limitedBody = (await limited.json()) as { results: unknown[] };
  expect(limitedBody.results.length).toBe(2);

  const unlimited = await fetch(`${baseUrl}/api/canvas/search?q=hygiene-needle`);
  const unlimitedBody = (await unlimited.json()) as { results: unknown[] };
  expect(unlimitedBody.results.length).toBeGreaterThanOrEqual(3);
});
