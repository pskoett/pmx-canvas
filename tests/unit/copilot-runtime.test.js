import { afterEach, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ensurePmxServer,
  findPmxServer,
  probePmxServer,
  runtimeCommand,
  runtimeVersion,
} from '../../.github/extensions/pmx-canvas/runtime.mjs';

const directories = [];
const servers = [];
function workspace() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'pmx-plugin-runtime-')));
  directories.push(directory);
  return directory;
}
function fixture(root, port = 0) {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => Response.json({ ok: true, workspace: root }),
  });
  servers.push(server);
  return server;
}
function register(root, port) {
  mkdirSync(join(root, '.pmx-canvas'), { recursive: true });
  writeFileSync(join(root, '.pmx-canvas', `daemon-${port}.pid`), '123');
}

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('shared plugin runtime', () => {
  test('uses one exact published package pin and never needs a global pmx executable', () => {
    expect(runtimeVersion).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    expect(runtimeCommand()).toEqual({ command: 'bun', args: ['x', '--bun', `pmx-canvas@${runtimeVersion}`] });
  });

  test('finds the matching workspace daemon on an arbitrary port, not a foreign preferred server', async () => {
    const root = workspace();
    const owned = fixture(root);
    const foreign = fixture(workspace());
    register(root, owned.port);
    const result = await findPmxServer(root, { port: foreign.port });
    expect(result.ok).toBe(true);
    expect(result.baseUrl).toBe(`http://127.0.0.1:${owned.port}`);
    expect(result.health.workspace).toBe(root);
  });

  test('pid filenames are only discovery hints and cannot authorize a foreign server', async () => {
    const root = workspace();
    const foreign = fixture(workspace());
    register(root, foreign.port);
    const result = await findPmxServer(root, { port: foreign.port });
    expect(result.ok).toBe(false);
  });

  test('an explicit target failure never falls through to another daemon', async () => {
    const root = workspace();
    const owned = fixture(root);
    const foreign = fixture(workspace());
    register(root, owned.port);
    const result = await findPmxServer(root, { serverUrl: `http://127.0.0.1:${foreign.port}` });
    expect(result.ok).toBe(false);
    expect(result.baseUrl).toBe(`http://127.0.0.1:${foreign.port}`);
    await expect(ensurePmxServer(root, { serverUrl: result.baseUrl })).rejects.toThrow('belongs to');
  });

  test('an unreachable explicit target reports no server, not the raw fetch error', async () => {
    const result = await findPmxServer(workspace(), { serverUrl: 'http://127.0.0.1:4313' }, async () => {
      throw new Error('fetch failed');
    });
    expect(result).toMatchObject({ ok: false, error: 'No matching PMX Canvas server is running.' });
  });

  test('canonicalizes symlinked macOS temporary roots', async () => {
    const root = workspace();
    const server = fixture(root);
    const alias = process.platform === 'darwin' ? root.replace(/^\/private\/var\//, '/var/') : root;
    expect((await probePmxServer(`http://127.0.0.1:${server.port}`, alias)).ok).toBe(true);
  });

  test('does not start a process when autoStart is false', async () => {
    const root = workspace();
    const foreign = fixture(workspace());
    expect((await ensurePmxServer(root, { port: foreign.port, autoStart: false })).ok).toBe(false);
    expect(readdirMaybe(root)).toEqual([]);
  });

  test('reports a missing runtime executable rather than returning a healthy-looking fallback', async () => {
    const root = workspace();
    const emptyPort = fixture(workspace()).port;
    await expect(
      ensurePmxServer(
        root,
        { port: emptyPort },
        {
          command: join(root, 'missing-bun'),
          args: [],
        },
      ),
    ).rejects.toThrow('startup failed');
    expect(readdirMaybe(join(root, '.pmx-canvas'))).not.toContain('plugin-start.lock');
  });

  test('concurrent plugin clients start only one workspace daemon', async () => {
    const root = workspace();
    const foreign = fixture(workspace());
    const command = { command: process.execPath, args: ['run', resolve('src/cli/index.ts')] };
    let port;
    try {
      const [first, second] = await Promise.all([
        ensurePmxServer(root, { port: foreign.port }, command),
        ensurePmxServer(root, { port: foreign.port }, command),
      ]);
      port = new URL(first.baseUrl).port;
      expect(first.baseUrl).toBe(second.baseUrl);
      expect(first.health.workspace).toBe(root);
      expect(second.health.workspace).toBe(root);
      expect(readdirMaybe(join(root, '.pmx-canvas')).filter((name) => name.endsWith('.pid'))).toEqual([
        `daemon-${port}.pid`,
      ]);
      expect((await fetch(`${first.baseUrl}/workbench`)).status).toBe(200);
    } finally {
      for (const name of readdirMaybe(join(root, '.pmx-canvas')).filter((name) => /^daemon-\d+\.pid$/.test(name))) {
        const ownedPort = /^daemon-(\d+)\.pid$/.exec(name)[1];
        execFileSync(command.command, [...command.args, 'serve', 'stop', `--port=${ownedPort}`], {
          cwd: root,
          env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: root, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
          timeout: 15_000,
          stdio: 'pipe',
        });
      }
    }
  }, 30_000);
});

function readdirMaybe(path) {
  try {
    return readdirSync(path).sort();
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
