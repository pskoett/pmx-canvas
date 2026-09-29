import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { join } from 'node:path';

type CanvasDefinition = {
  actions: Array<{ name: string; handler: (ctx: Record<string, unknown>) => Promise<unknown> }>;
  open: (ctx: Record<string, unknown>) => Promise<{ url: string }>;
  onClose: (ctx: Record<string, unknown>) => Promise<void>;
};

const workspaceA = '/tmp/pmx-adapter-workspace-a';
const workspaceB = '/tmp/pmx-adapter-workspace-b';
let reportedWorkspaceA = workspaceA;
const writesA: string[] = [];
const writesB: string[] = [];

function fixture(workspace: () => string, writes: string[]) {
  return Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/health') return Response.json({ ok: true, workspace: workspace() });
      if (request.method !== 'GET') writes.push(url.pathname);
      if (url.pathname === '/api/canvas/ax') return Response.json({ workspace: workspace() });
      return Response.json({ ok: true, path: url.pathname });
    },
  });
}

let serverA: ReturnType<typeof fixture>;
let serverB: ReturnType<typeof fixture>;
let canvas: CanvasDefinition;

beforeAll(async () => {
  serverA = fixture(() => reportedWorkspaceA, writesA);
  serverB = fixture(() => workspaceB, writesB);

  const source = readFileSync(join(process.cwd(), '.github/extensions/pmx-canvas/extension.mjs'), 'utf8')
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
    'dirname',
    'resolve',
    'fileURLToPath',
    'CanvasError',
    'createCanvas',
    source,
  );
  canvas = load(
    spawn,
    existsSync,
    createHttpServer,
    createNetServer,
    () => '',
    join,
    () => '',
    TestCanvasError,
    (definition: CanvasDefinition) => definition,
  );
});

afterAll(() => {
  serverA.stop(true);
  serverB.stop(true);
});

function action(name: string) {
  const found = canvas.actions.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing action ${name}`);
  return found.handler;
}

describe('GitHub Copilot canvas adapter targeting', () => {
  test('adapter source exposes the expected native surfaces', () => {
    const extension = readFileSync(join(process.cwd(), '.github/extensions/pmx-canvas/extension.mjs'), 'utf8');
    expect(extension).toContain('id: "pmx-canvas"');
    expect(extension).toContain('url: `${pmx.baseUrl}/workbench?theme=light`');
    expect(extension).toContain('"/api/canvas/ax/context"');
    expect(extension).toContain('onUserPromptSubmitted');
    expect(extension).toContain('createSteeringDeliveryPump');
    expect(extension).toContain('name: "focus_nodes"');
    expect(extension).toContain('name: "send_instruction"');
    expect(extension).toContain('/api/canvas/ax/delivery/pending?consumer=');
    const deliveryRuntime = extension.slice(
      extension.indexOf('async function claimCopilotSteering'),
      extension.indexOf('async function getAxTimeline'),
    );
    expect(deliveryRuntime).toContain('const workspaceRoot = PROJECT_ROOT;');
    expect(deliveryRuntime).not.toContain('copilotSession.workspacePath');
    expect(extension).toContain('{ attached: true });');
    expect(extension).not.toContain('{ attached: true, phase: "idle" });');
    expect(extension).not.toContain('console.log');
  });

  test('actions follow the explicit server displayed by their panel instance', async () => {
    const serverUrl = `http://127.0.0.1:${serverA.port}`;
    const opened = await canvas.open({
      instanceId: 'panel-a',
      input: { serverUrl, workspaceRoot: workspaceA, autoStart: false },
    });
    expect(opened.url).toBe(`${serverUrl}/workbench?theme=light`);

    const result = (await action('add_work_item')({
      instanceId: 'panel-a',
      input: { title: 'Targets the visible board' },
      session: { workingDirectory: workspaceB },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(writesA).toContain('/api/canvas/ax/work');
    expect(writesB).toEqual([]);
  });

  test('withholds mutation when the displayed target no longer matches its workspace', async () => {
    reportedWorkspaceA = workspaceB;
    const writesBefore = writesA.length;
    const result = (await action('add_review_annotation')({
      instanceId: 'panel-a',
      input: { body: 'Must not leak to another workspace' },
    })) as { ok: boolean; error: string };
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Action withheld');
    expect(writesA).toHaveLength(writesBefore);
    expect(writesB).toEqual([]);
    reportedWorkspaceA = workspaceA;
  });

  test('an explicit workspace override does not authorize replacement of the displayed workspace', async () => {
    await canvas.open({
      instanceId: 'override-panel',
      input: {
        serverUrl: `http://127.0.0.1:${serverA.port}`,
        workspaceRoot: workspaceB,
        allowWorkspaceMismatch: true,
        autoStart: false,
      },
    });
    reportedWorkspaceA = workspaceB;
    const writesBefore = writesA.length;
    try {
      const result = (await action('add_work_item')({
        instanceId: 'override-panel',
        input: { title: 'Withheld after workspace replacement' },
      })) as { ok: boolean };
      expect(result.ok).toBe(false);
      expect(writesA).toHaveLength(writesBefore);
    } finally {
      reportedWorkspaceA = workspaceA;
      await canvas.onClose({ instanceId: 'override-panel' });
    }
  });
});
