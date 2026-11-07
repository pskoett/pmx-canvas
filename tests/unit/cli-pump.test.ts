import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgentCli } from '../../src/cli/agent.ts';
import { renderExecTemplate } from '../../src/cli/commands/pump.ts';
import { startCanvasServer, stopCanvasServer } from '../../src/server/server.ts';
import { createTestWorkspace, removeTestWorkspace, resetCanvasForTests } from './helpers.ts';

describe('pmx-canvas pump', () => {
  let workspaceRoot = '';
  let baseUrl = '';
  let previousUrl = '';
  let previousPort = '';
  let scratch = '';
  let sinkScript = '';

  beforeAll(() => {
    workspaceRoot = createTestWorkspace('pmx-canvas-cli-pump-');
    resetCanvasForTests(workspaceRoot);
    const base = startCanvasServer({ workspaceRoot, port: 4548, autoOpenBrowser: false });
    if (!base) throw new Error('Failed to start canvas server for pump tests.');
    baseUrl = base;
    previousUrl = process.env.PMX_CANVAS_URL ?? '';
    previousPort = process.env.PMX_CANVAS_PORT ?? '';
    process.env.PMX_CANVAS_URL = baseUrl;
    delete process.env.PMX_CANVAS_PORT;
    scratch = mkdtempSync(join(tmpdir(), 'pump-test-'));
    // `cat > file` is Unix-only and the Windows shell has no equivalent one-liner;
    // Bun is guaranteed on PATH here, so drain stdin to the file it is given.
    sinkScript = join(scratch, 'sink.mjs');
    writeFileSync(
      sinkScript,
      [
        "import { writeFileSync } from 'node:fs';",
        'const chunks = [];',
        'for await (const chunk of process.stdin) chunks.push(chunk);',
        'writeFileSync(process.argv[2], Buffer.concat(chunks));',
      ].join('\n'),
    );
  });

  afterAll(() => {
    if (previousUrl) process.env.PMX_CANVAS_URL = previousUrl;
    else delete process.env.PMX_CANVAS_URL;
    if (previousPort) process.env.PMX_CANVAS_PORT = previousPort;
    else delete process.env.PMX_CANVAS_PORT;
    stopCanvasServer();
    removeTestWorkspace(workspaceRoot);
    rmSync(scratch, { recursive: true, force: true });
  });

  async function steer(message: string, target: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/canvas/ax/steer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, source: 'browser', target }),
    });
    expect(res.ok).toBe(true);
    return ((await res.json()) as { steering: { id: string } }).steering.id;
  }

  async function pendingFor(consumer: string): Promise<number> {
    const res = await fetch(`${baseUrl}/api/canvas/ax/delivery/pending?consumer=${consumer}&limit=10`);
    return ((await res.json()) as { pending: unknown[] }).pending.length;
  }

  test('sweeps the startup backlog silently, then delivers a fresh steer to the exec and marks it', async () => {
    await steer('stale backlog one', 'pumptest');
    await steer('stale backlog two', 'pumptest');
    expect(await pendingFor('pumptest')).toBe(2);

    const outFile = join(scratch, 'delivered.txt');
    // Fresh steer lands while the pump is parked on the long-poll.
    const late = setTimeout(() => {
      void steer('the fresh instruction', 'pumptest');
    }, 700);
    await runAgentCli([
      'pump',
      '--consumer',
      'pumptest',
      '--exec',
      `bun "${sinkScript}" "${outFile}"`,
      '--once',
      '--wait-ms',
      '8000',
    ]);
    clearTimeout(late);

    // Backlog swept without running the exec for it; the fresh one ran + marked.
    expect(readFileSync(outFile, 'utf-8')).toBe('the fresh instruction');
    expect(await pendingFor('pumptest')).toBe(0);
  }, 20_000);

  test('a failing exec is retried, then left pending instead of falsely marked delivered', async () => {
    await steer('cannot be handled', 'pumpfail');
    await expect(
      runAgentCli([
        'pump',
        '--consumer',
        'pumpfail',
        '--exec',
        'exit 1',
        '--once',
        '--backlog',
        'deliver',
        '--wait-ms',
        '2000',
        '--retry-delay-ms',
        '50',
      ]),
    ).rejects.toThrow('steer remains pending');
    expect(await pendingFor('pumpfail')).toBe(1);
  }, 20_000);

  test('a mark that fails once is retried, so the steer runs exactly once and ends delivered', async () => {
    await steer('run me once', 'pumpmark');
    let failedMarks = 0;
    // Forwards to the canvas server, but the first delivery mark fails as if the daemon were restarting.
    const proxy = Bun.serve({
      port: 0,
      hostname: '127.0.0.1',
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method !== 'GET' && url.pathname.includes('delivery') && failedMarks === 0) {
          failedMarks += 1;
          return new Response('restarting', { status: 503 });
        }
        return fetch(`${baseUrl}${url.pathname}${url.search}`, {
          method: request.method,
          headers: request.headers,
          body: request.method === 'GET' ? undefined : await request.arrayBuffer(),
        });
      },
    });
    const runs = join(scratch, 'runs.txt');
    writeFileSync(runs, '');
    const command = `bun -e "require('node:fs').appendFileSync(process.argv[1], 'x')" "${runs}"`;
    try {
      // A child process: before the fix, a failed mark exited the whole process.
      const child = Bun.spawn(
        [
          'bun',
          join(import.meta.dir, '../../src/cli/index.ts'),
          'pump',
          '--consumer',
          'pumpmark',
          '--exec',
          command,
          '--once',
          '--backlog',
          'deliver',
          '--wait-ms',
          '2000',
          '--retry-delay-ms',
          '50',
        ],
        { env: { ...process.env, PMX_CANVAS_URL: `http://127.0.0.1:${proxy.port}` }, stdout: 'pipe', stderr: 'pipe' },
      );
      const exitCode = await child.exited;
      expect({ exitCode, failedMarks, runs: readFileSync(runs, 'utf-8') }).toEqual({
        exitCode: 0,
        failedMarks: 1,
        runs: 'x',
      });
      expect(await pendingFor('pumpmark')).toBe(0);
    } finally {
      proxy.stop(true);
    }
  }, 30_000);

  test('the {message} placeholder is refused on Windows, where cmd.exe would re-parse it', () => {
    // POSIX: substituted as a variable reference, never spliced in.
    expect(renderExecTemplate('agent {message}', false)).toBe('agent "$PMX_STEER_MESSAGE"');
    // Windows: cmd.exe expands %VAR% and re-parses, so `& del ...` in a steer
    // would execute — refuse rather than reintroduce the injection.
    expect(() => renderExecTemplate('agent {message}', true)).toThrow(/not supported on Windows/);
    expect(() => renderExecTemplate('agent {id}', true)).toThrow(/not supported on Windows/);
    // A stdin-based exec is fine on both.
    expect(renderExecTemplate('my-agent', true)).toBe('my-agent');
  });
});
