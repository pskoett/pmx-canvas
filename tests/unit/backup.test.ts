import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runDueBackup } from '../../src/server/backup.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

const HUMAN = { 'Content-Type': 'application/json', 'x-pmx-workbench': '1' };
const roots: string[] = [];
let baseUrl = '';

function startWorkspace(): string {
  const root = createTestWorkspace('pmx-canvas-backup-');
  roots.push(root);
  resetCanvasForTests(root);
  const base = startCanvasServer({ workspaceRoot: root, port: 0 });
  if (!base) throw new Error('Failed to start canvas server for tests.');
  baseUrl = base.replace(/\/$/, '');
  return root;
}

afterEach(() => {
  stopCanvasServer();
  for (const root of roots.splice(0)) removeTestWorkspace(root);
});

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: HUMAN,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const addNote = (title: string) => call('POST', '/api/canvas/node', { type: 'markdown', title, content: title });
const boardNames = async () =>
  ((await call('GET', '/api/canvas/boards')).body.boards as Array<{ name: string }>).map((b) => b.name).sort();

describe('library backup', () => {
  test('a backup holds every board, and old backups beyond keep are removed', async () => {
    const root = startWorkspace();
    await addNote('On the first board');
    await call('POST', '/api/canvas/boards', { name: 'Second' });
    const folder = join(root, 'backups');

    const first = await call('POST', '/api/canvas/backup', { to: folder, keep: 2 });
    expect(first.status).toBe(200);
    const path = (first.body.backup as { path: string }).path;
    const copy = new Database(path, { readonly: true });
    expect(copy.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM boards').get()?.n).toBe(2);
    expect(copy.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM nodes').get()?.n).toBe(1);
    copy.close();

    await call('POST', '/api/canvas/backup', { to: folder, keep: 2 });
    const third = await call('POST', '/api/canvas/backup', { to: folder, keep: 2 });
    expect(readdirSync(folder)).toHaveLength(2);
    expect(existsSync(path)).toBe(false);
    expect((third.body.removed as string[]).length).toBe(1);
  });

  test('a backup restores every board on a clean machine, keeping the file it replaced', async () => {
    const source = startWorkspace();
    await addNote('Objective one');
    await call('POST', '/api/canvas/boards', { name: 'Discovery' });
    const backup = (
      (await call('POST', '/api/canvas/backup', { to: join(source, 'backups') })).body.backup as { path: string }
    ).path;
    stopCanvasServer();

    // A fresh workspace somewhere else: nothing on it but a scratch board.
    const target = startWorkspace();
    await addNote('Scratch');
    const restored = await call('POST', '/api/canvas/backup/restore', { file: backup });
    expect(restored.status).toBe(200);
    expect(await boardNames()).toEqual([expect.stringMatching(/^Board /), 'Discovery']);
    const state = (await call('GET', '/api/canvas/state')).body as { nodes: Array<{ data: { title?: string } }> };
    expect(state.nodes.map((node) => node.data.title)).toEqual(['Objective one']);
    expect(existsSync(join(target, '.pmx-canvas', 'canvas.db.before-restore'))).toBe(true);
  });

  test('restore refuses files that are not canvas databases', async () => {
    const root = startWorkspace();
    await addNote('Keep me');
    const junk = join(root, 'junk.db');
    writeFileSync(junk, 'not sqlite');
    expect((await call('POST', '/api/canvas/backup/restore', { file: junk })).status).toBe(400);
    expect((await call('POST', '/api/canvas/backup/restore', { file: join(root, 'missing.db') })).status).toBe(400);
    const live = join(root, '.pmx-canvas', 'canvas.db');
    expect((await call('POST', '/api/canvas/backup/restore', { file: live })).status).toBe(400);
    const state = (await call('GET', '/api/canvas/state')).body as { nodes: unknown[] };
    expect(state.nodes).toHaveLength(1);
  });

  test('the schedule backs up only when due, and validates its interval', async () => {
    const root = startWorkspace();
    await addNote('Scheduled');
    const folder = join(root, 'scheduled');
    expect((await call('POST', '/api/canvas/backup/schedule', { every: 'soon' })).status).toBe(400);
    expect((await call('POST', '/api/canvas/backup/schedule', { every: '10s' })).status).toBe(400);
    const set = await call('POST', '/api/canvas/backup/schedule', { every: '24h', to: folder, keep: 3 });
    expect(set.body).toMatchObject({ everyMs: 86_400_000, folder, keep: 3 });

    expect(runDueBackup()).toBe(true); // never backed up: due now
    expect(runDueBackup()).toBe(false); // just backed up
    expect(runDueBackup(Date.now() + 86_400_000 + 1_000)).toBe(true);
    expect(readdirSync(folder).length).toBeGreaterThanOrEqual(1);

    await call('POST', '/api/canvas/backup/schedule', { every: 'off' });
    expect(runDueBackup(Date.now() + 10 * 86_400_000)).toBe(false);
  });
});
