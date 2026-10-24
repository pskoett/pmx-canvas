import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCopilotCanvas, type CanvasDefinition } from '../helpers/copilot-adapter.js';

const workspaceA = realpathSync(mkdtempSync(join(tmpdir(), 'pmx-adapter-a-')));
const workspaceB = realpathSync(mkdtempSync(join(tmpdir(), 'pmx-adapter-b-')));
let reportedWorkspaceA = workspaceA;
const writesA: string[] = [];
const writesB: string[] = [];
const axContext = { pinned: { count: 1, nodes: [{ id: 'pinned', content: 'Full context '.repeat(2500) }] } };

function fixture(workspace: () => string, writes: string[]) {
  return Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      if (url.pathname === '/health') return Response.json({ ok: true, workspace: workspace() });
      if (request.method !== 'GET') writes.push(url.pathname);
      if (url.pathname === '/api/canvas/ax') {
        return Response.json({
          state: { focus: { nodeIds: ['focused'] }, workItems: [{ id: 'work', status: 'blocked' }] },
          host: { host: 'copilot' },
          ...(url.searchParams.get('includeContext') === 'false' ? {} : { context: axContext }),
        });
      }
      if (url.pathname === '/api/canvas/ax/context') return Response.json(axContext);
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
  canvas = loadCopilotCanvas();
});

afterAll(() => {
  serverA.stop(true);
  serverB.stop(true);
  rmSync(workspaceA, { recursive: true, force: true });
  rmSync(workspaceB, { recursive: true, force: true });
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
    expect(extension).toContain('url: `${pmx.baseUrl}/workbench?theme=daylight`');
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
    expect(deliveryRuntime).toContain('const workspaceRoot = sessionWorkspaceRoot;');
    expect(extension).not.toContain('copilotSession.workspacePath');
    expect(extension).toContain('copilotSession.rpc.metadata.snapshot()');
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
    expect(opened.url).toBe(`${serverUrl}/workbench?theme=daylight`);

    const result = (await action('add_work_item')({
      instanceId: 'panel-a',
      input: { title: 'Targets the visible board' },
      session: { workingDirectory: workspaceB },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(writesA).toContain('/api/canvas/ax/work');
    expect(writesB).toEqual([]);
  });

  test('status excludes serialized context; get_ax_context still returns it on demand', async () => {
    const ctx = { instanceId: 'panel-a' };
    const status = (await action('status')(ctx)) as { ax: { context?: unknown; state: unknown } };
    expect(status.ax.context).toBeUndefined();
    expect(status.ax.state).toEqual({
      focus: { nodeIds: ['focused'] },
      workItems: [{ id: 'work', status: 'blocked' }],
    });
    expect(JSON.stringify(status).length).toBeLessThan(1500);
    expect(await action('get_ax_context')(ctx)).toEqual(axContext);
  });

  for (const endpoint of ['status', 'start']) {
    test(`fallback /${endpoint} recovers the original target and refuses workspace replacement`, async () => {
      const instanceId = `recover-${endpoint}`;
      reportedWorkspaceA = workspaceB;
      const opened = await canvas.open({
        instanceId,
        input: { serverUrl: `http://127.0.0.1:${serverA.port}`, workspaceRoot: workspaceA, autoStart: false },
      });
      try {
        const html = await (await fetch(opened.url)).text();
        expect(html).toContain('Home and recent boards will appear');
        expect(html).not.toContain('<iframe');
        const unavailable = (await action('status')({
          instanceId,
          input: { serverUrl: `http://127.0.0.1:${serverB.port}`, workspaceRoot: workspaceB },
        })) as { ok: boolean };
        expect(unavailable.ok).toBe(false);

        reportedWorkspaceA = workspaceA;
        const recovered = await (
          await fetch(`${opened.url}${endpoint}`, { method: endpoint === 'start' ? 'POST' : 'GET' })
        ).json();
        expect(recovered.ok).toBe(true);
        const writesBefore = writesA.length;
        await action('add_work_item')({ instanceId, input: { title: 'Recovered target' } });
        expect(writesA.length).toBe(writesBefore + 1);
        expect(writesB).toEqual([]);

        reportedWorkspaceA = workspaceB;
        const replaced = await (await fetch(`${opened.url}status`)).json();
        expect(replaced.ok).toBe(false);
        expect(replaced.error).toContain('Action withheld');
        expect(
          ((await action('add_work_item')({ instanceId, input: { title: 'Refuse' } })) as { ok: boolean }).ok,
        ).toBe(false);
        expect(writesA.length).toBe(writesBefore + 1);
      } finally {
        reportedWorkspaceA = workspaceA;
        await canvas.onClose({ instanceId });
      }
    });
  }

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

type SteeringPath = 'panel' | 'action' | 'pump';

async function steeringHarness(path: SteeringPath, session?: Parameters<typeof loadCopilotCanvas>[1]) {
  let available = path !== 'panel';
  const writes: string[] = [];
  const fetchImpl: typeof fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], options?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/health') {
        if (!available) throw new Error('Server unavailable');
        return Response.json({ ok: true, workspace: process.cwd() });
      }
      if (options?.method === 'POST') writes.push(url.pathname);
      if (url.pathname === '/api/canvas/ax/delivery/pending') {
        return Response.json({
          pending: [{ id: 'steer-mode', message: 'Use the checked source', createdAt: new Date().toISOString() }],
        });
      }
      return Response.json({ ok: true });
    },
    { preconnect: fetch.preconnect },
  );
  const adapter = loadCopilotCanvas(fetchImpl, session);
  const opened = path === 'panel' ? await adapter.open({ instanceId: 'steering', input: { autoStart: false } }) : null;
  available = true;
  if (opened) {
    // The fallback panel must rediscover its target before it can mirror instructions.
    const status = await (await fetch(`${opened.url}status`)).json();
    expect(status.ok).toBe(true);
  }
  return {
    writes,
    close: () => adapter.onClose({ instanceId: 'steering' }),
    async send() {
      if (opened) {
        const response = await fetch(`${opened.url}send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: 'Use the checked source' }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        expect(result.ok).toBe(true);
      } else if (path === 'action') {
        const instruction = adapter.actions.find((candidate) => candidate.name === 'send_instruction')!;
        expect(await instruction.handler({ input: { prompt: 'Use the checked source' } })).toEqual({ ok: true });
      } else {
        await adapter.runSteeringOnce();
      }
      // Settle the action's asynchronous timeline mirror before checking side effects.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

describe('Copilot immediate steering', () => {
  for (const path of ['panel', 'action', 'pump'] as const) {
    test(`${path} requests immediate delivery and does not acknowledge a refused send`, async () => {
      let fail = true;
      const requests: Array<{ prompt: string; mode?: string }> = [];
      const harness = await steeringHarness(path, {
        send: async (options) => {
          requests.push(options);
          if (fail) throw new Error('Host refused the send');
          return 'accepted-message';
        },
      });
      try {
        await expect(harness.send()).rejects.toThrow('Host refused the send');
        expect(harness.writes).toEqual([]);
        fail = false;
        await harness.send();
        expect(requests).toEqual([
          { prompt: 'Use the checked source', mode: 'immediate' },
          { prompt: 'Use the checked source', mode: 'immediate' },
        ]);
        expect(harness.writes).toEqual([
          path === 'pump' ? '/api/canvas/ax/delivery/steer-mode/mark' : '/api/canvas/ax/steer',
        ]);
      } finally {
        await harness.close();
      }
    });
  }

  for (const path of ['panel', 'action'] as const) {
    test(`${path} refuses instructions before a Copilot session is available`, async () => {
      const harness = await steeringHarness(path);
      try {
        await expect(harness.send()).rejects.toThrow('Copilot session is unavailable');
        expect(harness.writes).toEqual([]);
      } finally {
        await harness.close();
      }
    });
  }
});
