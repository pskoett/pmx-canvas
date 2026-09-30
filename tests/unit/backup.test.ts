import { Database } from 'bun:sqlite';
import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDueBackup } from '../../src/server/backup.ts';
import { canvasState } from '../../src/server/canvas-state.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, getAvailablePort, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

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
  canvasState.close();
  for (const root of roots.splice(0)) removeTestWorkspace(root);
});

function createSignalFixture(root: string, entry: string): { fixture: string; signal: () => void } {
  const markerPrefix = join(root, 'emit-sigterm-');
  const fixture = join(root, 'signal-fixture.ts');
  writeFileSync(
    fixture,
    `import { existsSync } from 'node:fs';
let seen = 0;
setInterval(() => {
  if (!existsSync(${JSON.stringify(markerPrefix)} + (seen + 1))) return;
  seen++;
  process.emit('SIGTERM');
}, 10);
await import(${JSON.stringify(entry)});
`,
  );
  let count = 0;
  return { fixture, signal: () => writeFileSync(`${markerPrefix}${++count}`, '') };
}

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
  test('CLI rejects unknown backup flags without writing or changing the schedule', async () => {
    const root = startWorkspace();
    const entry = fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url));
    const run = async (args: string[]) => {
      const proc = Bun.spawn([process.execPath, entry, '--server-url', baseUrl, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { code, output: stdout + stderr };
    };
    const before = (await call('GET', '/api/canvas/backup')).body;
    for (const args of [
      ['backup', '--folder', join(root, 'wrong')],
      ['backup', 'schedule', '--every=1m', '--folder=wrong'],
      ['backup', 'status', '--bogus'],
      ['restore', 'missing.db', '--bogus'],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Unknown');
      expect(result.output).toContain(args.some((arg) => arg.startsWith('--folder')) ? '--folder' : '--bogus');
    }
    for (const args of [
      ['backup', '--to'],
      ['backup', '--keep'],
      ['backup', 'schedule', '--every'],
    ]) {
      const result = await run(args);
      expect(result.code).toBe(1);
      expect(result.output).toContain('Missing value');
    }
    expect((await call('GET', '/api/canvas/backup')).body).toEqual(before);
    const valid = await run(['backup', '--to', join(root, 'chosen'), '--keep=2']);
    expect(valid.code).toBe(0);
    expect(readdirSync(join(root, 'chosen')).some((file) => file.endsWith('.db'))).toBe(true);
    expect((await run(['backup', 'schedule', '--every=1m', '--to', join(root, 'chosen')])).code).toBe(0);
    expect((await run(['backup', 'schedule', '--off'])).code).toBe(0);
  });

  test('CLI shutdown stays alive on save failure and exits durably after recovery', async () => {
    const root = createTestWorkspace('pmx-canvas-shutdown-');
    roots.push(root);
    const port = await getAvailablePort();
    const url = `http://127.0.0.1:${port}`;
    const path = join(root, 'canvas.db');
    const { fixture, signal } = createSignalFixture(
      root,
      fileURLToPath(new URL('../../src/cli/index.ts', import.meta.url)),
    );
    const proc = Bun.spawn(['bun', fixture, '--no-open', `--port=${port}`], {
      cwd: root,
      env: { ...process.env, PMX_CANVAS_DB_PATH: path, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
      stdout: 'ignore',
      stderr: 'ignore',
    });
    let db: Database | undefined;
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          await fetch(`${url}/health`)
            .then((r) => r.ok)
            .catch(() => false)
        )
          break;
        await Bun.sleep(20);
      }
      db = new Database(path);
      db.exec("CREATE TRIGGER reject_save BEFORE INSERT ON nodes BEGIN SELECT RAISE(FAIL, 'shutdown blocked'); END");
      const result = await fetch(`${url}/api/canvas/node`, {
        method: 'POST',
        headers: HUMAN,
        body: JSON.stringify({ type: 'markdown', title: 'Keep through shutdown', content: 'durable' }),
      });
      expect(result.ok).toBe(true);
      signal();
      await Bun.sleep(100);
      expect(proc.exitCode).toBeNull();
      const state = (await (await fetch(`${url}/api/canvas/state`)).json()) as {
        nodes: Array<{ data: { title: string } }>;
      };
      expect(state.nodes.map((node) => node.data.title)).toEqual(['Keep through shutdown']);
      db.exec('DROP TRIGGER reject_save');
      signal();
      expect(await proc.exited).toBe(0);
      expect(
        db
          .query<{ data: string }, []>('SELECT data FROM nodes')
          .all()
          .map((row) => JSON.parse(row.data).title),
      ).toEqual(['Keep through shutdown']);
    } finally {
      db?.exec('DROP TRIGGER IF EXISTS reject_save');
      db?.close();
      if (proc.exitCode === null) proc.kill('SIGTERM');
      await proc.exited;
    }
  });

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
    const previous = restored.body.previous as string;
    expect(previous).toBe(join(target, '.pmx-canvas', 'canvas.db.before-restore'));
    expect(existsSync(previous)).toBe(true);

    const restoredPrevious = await call('POST', '/api/canvas/backup/restore', { file: previous });
    expect(restoredPrevious.status).toBe(200);
    const previousState = (await call('GET', '/api/canvas/state')).body as {
      nodes: Array<{ data: { title?: string } }>;
    };
    expect(previousState.nodes.map((node) => node.data.title)).toEqual(['Scratch']);
    expect(existsSync(previous)).toBe(true);
  });

  test('backup and restore fail instead of claiming success when pending state cannot be flushed', async () => {
    const root = startWorkspace();
    await addNote('Durable');
    const backup = (
      (await call('POST', '/api/canvas/backup', { to: join(root, 'backups') })).body.backup as { path: string }
    ).path;
    await addNote('Unsaved');

    const db = new Database(canvasState.databasePath as string);
    db.exec("CREATE TRIGGER reject_node_save BEFORE INSERT ON nodes BEGIN SELECT RAISE(FAIL, 'save rejected'); END");
    try {
      expect((await call('POST', '/api/canvas/backup', { to: join(root, 'failed-backups') })).status).toBe(500);
      expect((await call('POST', '/api/canvas/backup/restore', { file: backup })).status).toBe(500);
      const state = (await call('GET', '/api/canvas/state')).body as { nodes: Array<{ data: { title?: string } }> };
      expect(state.nodes.map((node) => node.data.title)).toEqual(['Durable', 'Unsaved']);
    } finally {
      db.exec('DROP TRIGGER reject_node_save');
      db.close();
    }
  });

  test('restore rolls back when a SQLite backup cannot load its board', async () => {
    const root = startWorkspace();
    await addNote('Keep the live board');
    const backup = ((await call('POST', '/api/canvas/backup')).body.backup as { path: string }).path;
    const broken = new Database(backup);
    broken.run('UPDATE nodes SET data = ?', ['{invalid json']);
    broken.close();
    const active = canvasState.activeBoardId;
    const result = await call('POST', '/api/canvas/backup/restore', { file: backup });
    expect(result.status).toBe(500);
    expect(canvasState.activeBoardId).toBe(active);
    expect(canvasState.getLayout().nodes.map((node) => node.data.title)).toEqual(['Keep the live board']);
    // Recovery is durable, not merely the old in-memory view.
    stopCanvasServer();
    resetCanvasForTests(root);
    expect(canvasState.loadFromDisk({ clearExisting: true })).toBe(true);
    expect(canvasState.getLayout().nodes.map((node) => node.data.title)).toEqual(['Keep the live board']);
    expect(readdirSync(join(root, '.pmx-canvas')).some((name) => name.includes('.restore-'))).toBe(false);
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
