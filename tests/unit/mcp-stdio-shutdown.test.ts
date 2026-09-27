import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type ChildProcess, spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace, getAvailablePort, removeTestWorkspace } from './helpers.ts';

const mcpEntry = fileURLToPath(new URL('../../src/mcp/server.ts', import.meta.url));

describe('MCP stdio lifecycle', () => {
  test('the server process exits when the client closes the stdio channel', async () => {
    // Finding Y (0.4.5): a client completing the official close sequence left
    // the MCP process orphaned — its timers kept the event loop alive.
    const child = spawn(process.execPath, ['run', mcpEntry], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: process.env,
    });

    // Complete an initialize handshake first so the transport is genuinely live.
    const initialized = new Promise<void>((resolveInit, rejectInit) => {
      let buffer = '';
      const timer = setTimeout(() => rejectInit(new Error('no initialize response within 10s')), 10_000);
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8');
        if (buffer.includes('"id":1')) {
          clearTimeout(timer);
          resolveInit();
        }
      });
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'shutdown-test', version: '0' },
        },
      })}\n`,
    );
    await initialized;

    // Close the channel the way a finished client does; the process must exit
    // on its own — no kill.
    child.stdin.end();
    const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
      const timer = setTimeout(() => {
        child.kill();
        rejectExit(new Error('MCP server did not exit within 8s of stdin close'));
      }, 8_000);
      child.on('exit', (code) => {
        clearTimeout(timer);
        resolveExit(code);
      });
    });
    expect(exitCode).toBe(0);
  }, 25_000);

  test('shutdown refusal keeps unsaved MCP state alive and a retry exits durably', async () => {
    const root = createTestWorkspace('pmx-canvas-mcp-shutdown-');
    const dbPath = join(root, 'canvas.db');
    const port = await getAvailablePort();
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', mcpEntry],
      cwd: root,
      env: {
        ...process.env,
        PMX_CANVAS_DB_PATH: dbPath,
        PMX_CANVAS_DISABLE_BROWSER_OPEN: '1',
        PMX_CANVAS_PORT: String(port),
        PMX_CANVAS_WORKSPACE_ROOT: root,
      },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'shutdown-recovery-test', version: '0' }, { capabilities: {} });
    let db: Database | undefined;
    let child: ChildProcess | undefined;
    let stderr = '';

    try {
      await client.connect(transport);
      child = (transport as unknown as { _process?: ChildProcess })._process;
      if (!child?.pid) throw new Error('MCP stdio transport did not expose its subprocess');
      transport.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf-8');
      });

      // The real MCP tool starts the local canvas server and initializes its DB.
      const started = await client.callTool({ name: 'canvas_query', arguments: { action: 'layout' } });
      expect(started.isError).not.toBe(true);
      db = new Database(dbPath);
      db.exec("CREATE TRIGGER reject_save BEFORE INSERT ON nodes BEGIN SELECT RAISE(FAIL, 'shutdown blocked'); END");

      const added = await client.callTool({
        name: 'canvas_node',
        arguments: { action: 'add', type: 'markdown', title: 'Keep through MCP shutdown', content: 'durable' },
      });
      expect(added.isError).not.toBe(true);

      child.kill('SIGTERM');
      for (let attempt = 0; attempt < 100 && !stderr.includes('Shutdown refused:'); attempt++) {
        await Bun.sleep(20);
      }
      expect(stderr).toContain('Shutdown refused: canvas changes could not be saved.');
      expect(child.exitCode).toBeNull();

      db.exec('DROP TRIGGER reject_save');
      const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child?.once('exit', (code, signal) => resolve({ code, signal }));
      });
      child.kill('SIGTERM');
      expect(await exited).toEqual({ code: 0, signal: null });
      expect(
        db
          .query<{ data: string }, []>('SELECT data FROM nodes')
          .all()
          .map((row) => JSON.parse(row.data).title),
      ).toEqual(['Keep through MCP shutdown']);
    } finally {
      db?.exec('DROP TRIGGER IF EXISTS reject_save');
      db?.close();
      if (child?.exitCode === null) child.kill('SIGKILL');
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
      removeTestWorkspace(root);
    }
  }, 25_000);
});
