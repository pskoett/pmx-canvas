import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import {
  canonicalWorkspace,
  ensurePmxServer as ensureLocalServer,
  explicitServerUrl,
  findPmxServer,
  preferredPort,
  probePmxServer as probeWorkspace,
  runtimeCommand as registryCommand,
  runtimeVersion,
  type RuntimeCommand,
  type RuntimeInput,
  type ServerProbe,
} from '../../.github/extensions/pmx-canvas/runtime.mjs';

export { canonicalWorkspace, runtimeVersion };

/** Use the project's exact installed package, including packed builds not yet on npm. */
export function runtimeCommand(root = process.cwd()): RuntimeCommand {
  let entry: string;
  try {
    entry = createRequire(join(root, 'package.json')).resolve('pmx-canvas');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') return registryCommand();
    throw error;
  }
  const packageRoot = resolve(dirname(entry), '../..');
  const metadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version: string };
  if (metadata.version !== runtimeVersion)
    throw new Error(`Installed PMX Canvas ${metadata.version} differs from plugin runtime ${runtimeVersion}.`);
  return { command: 'bun', args: ['run', join(packageRoot, 'src/cli/index.ts')] };
}

function compatible(target: ServerProbe) {
  if (!target.ok || !target.baseUrl || !target.health)
    throw new Error(target.error ?? 'Canvas unavailable. Use PMX Canvas: Open.');
  const health = target.health as NonNullable<ServerProbe['health']> & { version?: string; bundleStamp?: string };
  if (health.version !== runtimeVersion)
    throw new Error(
      `Canvas ${health.version} differs from plugin runtime ${runtimeVersion}. Restart the intended service after upgrading.`,
    );
  if (!health.bundleStamp || health.bundleStamp === 'unknown')
    throw new Error('Canvas did not identify its served bundle.');
  return { serverUrl: target.baseUrl, version: health.version, bundleStamp: health.bundleStamp };
}

export async function probePmxServer(url: string, root: string) {
  const target = await probeWorkspace(url, root);
  if (target.ok) compatible(target);
  return target;
}

// Connection hint only. Health remains authoritative, including after service restart.
async function findServer(root: string, input: RuntimeInput = {}) {
  const target = await findPmxServer(root, input);
  if (target.ok || explicitServerUrl(input)) return target;
  const path = join(root, '.pmx-canvas/amp-server.json');
  if (!existsSync(path)) return target;
  const hint = JSON.parse(readFileSync(path, 'utf8')) as { serverUrl: string };
  const cached = await probeWorkspace(hint.serverUrl, root);
  return cached.ok ? cached : target;
}

function rememberServer(root: string, target: ServerProbe) {
  compatible(target);
  const path = join(root, '.pmx-canvas/amp-server.json');
  mkdirSync(join(root, '.pmx-canvas'), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify({ serverUrl: target.baseUrl }), { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
  return target;
}

export function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 90_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${command} failed: ${stderr || stdout || error.message}`));
      else resolve(stdout);
    });
  });
}

const starting = new Map<string, Promise<ServerProbe>>();

/** Shared by commands and the existing MCP bootstrap. Never attach to a foreign workspace. */
export async function ensurePmxServer(root: string, input: RuntimeInput = {}, command = runtimeCommand(root)) {
  root = canonicalWorkspace(root);
  if (!process.env.AMP_ORB) {
    const target = await ensureLocalServer(root, input, command);
    compatible(target);
    return target;
  }
  const pending = starting.get(root);
  if (pending) return pending;
  const start = ensureOrbServer(root, input, command).then((target) => {
    compatible(target);
    return target;
  });
  starting.set(root, start);
  try {
    return await start;
  } finally {
    starting.delete(root);
  }
}

async function ensureOrbServer(root: string, input: RuntimeInput, command: RuntimeCommand): Promise<ServerProbe> {
  const existing = await findServer(root, input);
  if (existing.ok || input.autoStart === false) return existing;
  if (input.serverUrl || process.env.PMX_CANVAS_URL)
    throw new Error(existing.error ?? 'Configured server unavailable.');
  if (existsSync(join(root, '.amp/services.yaml'))) {
    const ensured = JSON.parse(await run('amp', ['orb', 'services', 'ensure', '--json'], root)) as {
      services: Array<{ port: number; tls: boolean }>;
    };
    for (const service of ensured.services) {
      const target = await probeWorkspace(`${service.tls ? 'https' : 'http'}://127.0.0.1:${service.port}`, root);
      if (target.ok) return rememberServer(root, target);
    }
  }
  // The project's services may only contain its application, not Canvas.
  {
    const name = `pmx-canvas-${createHash('sha256').update(root).digest('hex').slice(0, 12)}`;
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const shell = `PMX_CANVAS_WORKSPACE_ROOT=${quote(root)} ${[command.command, ...command.args].map(quote).join(' ')} --no-open --port="$PORT"`;
    await run(
      'amp',
      [
        'orb',
        'service',
        'start',
        name,
        '--cwd',
        root,
        '--port',
        String(preferredPort(input)),
        '--command',
        shell,
        '--portal',
        '--title',
        'PMX Canvas',
      ],
      root,
    );
  }
  const target = await findPmxServer(root, input);
  if (!target.ok) throw new Error(target.error ?? 'Canvas service did not become healthy in this workspace.');
  return rememberServer(root, target);
}

export async function inspectServer(root: string, start: boolean) {
  return compatible(start ? await ensurePmxServer(root) : await findServer(root));
}

/** Register with the invocation's thread, not whichever thread last set an environment variable. */
export async function portal(root: string, threadId: string, serverUrl: string): Promise<string> {
  if (!process.env.AMP_ORB) return `${serverUrl}/workbench`;
  const name = `pmx-canvas-${threadId}`;
  await run('amp', ['orb', 'portal', serverUrl, '--thread', threadId, '--name', name, '--title', 'PMX Canvas'], root);
  const manifest = JSON.parse(readFileSync(join(root, '.amp/portals', `${name}.json`), 'utf8')) as {
    links: Array<{ url: string }>;
  };
  const url = new URL(manifest.links[0].url);
  if (url.protocol !== 'https:') throw new Error('Amp did not return an HTTPS Portal.');
  url.pathname = '/workbench';
  return url.toString();
}
