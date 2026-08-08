import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
});
