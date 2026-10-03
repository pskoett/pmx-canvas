import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { resolve } from 'node:path';
import {
  canonicalWorkspace,
  ensurePmxServer,
  explicitServerUrl,
  findPmxServer,
  preferredPort,
  runtimeCommand,
} from '../../.github/extensions/pmx-canvas/runtime.mjs';

export type CanvasDefinition = {
  actions: Array<{ name: string; handler: (ctx: Record<string, unknown>) => Promise<unknown> }>;
  open: (ctx: Record<string, unknown>) => Promise<{ url: string }>;
  onClose: (ctx: Record<string, unknown>) => Promise<void>;
};

// Exercise the real adapter without connecting to a native Copilot session.
export function loadCopilotCanvas(fetchImpl = globalThis.fetch): CanvasDefinition {
  const source = readFileSync(resolve('.github/extensions/pmx-canvas/extension.mjs'), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace('const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));', 'const EXTENSION_DIR = process.cwd();')
    .split('\ncopilotSession = await joinSession({')[0]
    .concat('\nreturn pmxCanvas;');

  class TestCanvasError extends Error {}
  const load = new Function(
    'spawn',
    'existsSync',
    'createHttpServer',
    'createNetServer',
    'resolve',
    'CanvasError',
    'createCanvas',
    'fetch',
    'canonicalWorkspace',
    'ensurePmxServer',
    'explicitServerUrl',
    'findPmxServer',
    'preferredPort',
    'runtimeCommand',
    source,
  );
  return load(
    spawn,
    existsSync,
    createHttpServer,
    createNetServer,
    resolve,
    TestCanvasError,
    (definition: CanvasDefinition) => definition,
    fetchImpl,
    canonicalWorkspace,
    ensurePmxServer,
    explicitServerUrl,
    (workspace: string, input: Record<string, unknown>) => findPmxServer(workspace, input, fetchImpl),
    preferredPort,
    runtimeCommand,
  );
}
