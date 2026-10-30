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
export function loadCopilotCanvas(
  fetchImpl = globalThis.fetch,
  session?: { send: (options: { prompt: string; mode?: 'immediate' | 'enqueue' }) => Promise<unknown> },
): CanvasDefinition & { runSteeringOnce: () => Promise<number> } {
  const source = readFileSync(resolve('.github/extensions/pmx-canvas/extension.mjs'), 'utf8')
    .replace(/^import .*;$/gm, '')
    .replace('const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));', 'const EXTENSION_DIR = process.cwd();');
  const delivery = readFileSync(resolve('.github/extensions/pmx-canvas/steering-delivery.mjs'), 'utf8').replace(
    'export function createSteeringDeliveryPump',
    'function createSteeringDeliveryPump',
  );
  // Keep the production pump wiring, but let tests advance it without a background loop.
  const pump = source
    .slice(source.indexOf('steeringDeliveryPump = createSteeringDeliveryPump({'))
    .split('\nvoid steeringDeliveryPump.start();')[0];
  const body = source
    .split('\ncopilotSession = await joinSession({')[0]
    .concat(
      '\ncopilotSession = session;\n',
      delivery,
      pump,
      '\nreturn { ...pmxCanvas, runSteeringOnce: () => steeringDeliveryPump.runOnce() };',
    );

  class TestCanvasError extends Error {
    constructor(code: string, message: string) {
      super(message);
      this.name = code;
    }
  }
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
    'session',
    body,
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
    session,
  );
}
